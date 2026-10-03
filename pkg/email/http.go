package email

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/cloudreve/Cloudreve/v4/inventory"
	"github.com/cloudreve/Cloudreve/v4/pkg/logging"
	"github.com/cloudreve/Cloudreve/v4/pkg/request"
	"github.com/cloudreve/Cloudreve/v4/pkg/setting"
)

// HTTPPool delivers email through a generic HTTP API endpoint instead of
// SMTP. It exists for hosts where outbound SMTP ports are blocked: any mail
// service reachable over HTTPS - hosted APIs or a self-hosted gateway such
// as poste.io - can be wired in via the admin's endpoint/body templates,
// no vendor SDK needed.
type HTTPPool struct {
	config *setting.HTTPMail
	from   *setting.SMTP // sender identity is shared with the SMTP driver
	client request.Client
	ch     chan *HTTPMailRequest
	chOpen bool
	l      logging.Logger
}

// HTTPMailRequest is one fully rendered outbound HTTP mail request.
type HTTPMailRequest struct {
	To       string
	Subject  string
	Method   string
	Endpoint string
	Header   http.Header
	Body     string
	cid      string
	userID   int
}

// NewHTTPPool initializes a new HTTP based email sending queue.
func NewHTTPPool(config setting.Provider, client request.Client, logger logging.Logger) *HTTPPool {
	pool := &HTTPPool{
		config: config.HTTPMail(context.Background()),
		from:   config.SMTP(context.Background()),
		client: client,
		ch:     make(chan *HTTPMailRequest, 30),
		l:      logger,
	}

	pool.Init()
	return pool
}

// Send queues an email for delivery through the configured HTTP endpoint.
func (client *HTTPPool) Send(ctx context.Context, to, title, body string) error {
	if !client.chOpen {
		return fmt.Errorf("HTTP mail queue is closed")
	}

	// 忽略通过QQ登录的邮箱
	if strings.HasSuffix(to, "@login.qq.com") {
		return nil
	}

	msg := RenderHTTPMail(client.config, client.from, to, title, body)
	msg.cid = logging.CorrelationID(ctx).String()
	msg.userID = inventory.UserIDFromContext(ctx)
	client.ch <- msg
	return nil
}

// Close 关闭发送队列
func (client *HTTPPool) Close() {
	if client.ch != nil {
		close(client.ch)
	}
}

// Init starts the queue worker unless the endpoint is unconfigured. The
// endpoint is admin-configured and deliberately not SSRF-validated: the
// whole point of this driver is reaching mail gateways on arbitrary hosts
// and ports, including LAN-only ones like a poste.io container.
func (client *HTTPPool) Init() {
	if client.config == nil || client.config.Endpoint == "" {
		client.l.Info("HTTP mail endpoint is not configured, email queue will not start.")
		return
	}
	client.chOpen = true
	go func() {
		client.l.Info("Initializing and starting HTTP mail queue...")
		defer func() {
			if err := recover(); err != nil {
				client.chOpen = false
				client.l.Error("Exception while sending email: %s, queue will be reset in 10 seconds.", err)
				time.Sleep(time.Duration(10) * time.Second)
				client.Init()
			}
		}()

		for m := range client.ch {
			l := client.l.CopyWithPrefix(fmt.Sprintf("[Cid: %s]", m.cid))
			_, err := client.client.
				Request(m.Method, m.Endpoint, strings.NewReader(m.Body),
					request.WithContext(context.Background()),
					request.WithTimeout(15*time.Second),
					request.WithHeader(m.Header),
					request.WithContentLength(int64(len(m.Body))),
					request.WithLogger(client.l),
				).
				CheckHTTPResponse(http.StatusOK, http.StatusCreated, http.StatusAccepted, http.StatusNoContent).
				GetResponse()
			if err != nil {
				l.Warning("Failed to send email: %s, Cid=%s", err, m.cid)
			} else {
				l.Info("Email sent to %q, title: %q.", m.To, m.Subject)
			}
		}

		client.l.Info("Email queue closing...")
		client.chOpen = false
	}()
}

// RenderHTTPMail renders cfg's endpoint and body templates for one message.
// Placeholder values are substituted as JSON string content (surrounding
// quotes stripped) so JSON templates like `"to": "{to}"` stay valid even
// when the subject or HTML body contains quotes and newlines. GET requests
// carry no body; the endpoint template then holds all placeholders.
func RenderHTTPMail(cfg *setting.HTTPMail, identity *setting.SMTP, to, subject, body string) *HTTPMailRequest {
	replacer := strings.NewReplacer(
		"{to}", jsonStringContent(to),
		"{subject}", jsonStringContent(subject),
		"{body}", jsonStringContent(body),
		"{from}", jsonStringContent(identity.From),
		"{from_name}", jsonStringContent(identity.FromName),
		"{reply_to}", jsonStringContent(identity.ReplyTo),
	)

	header := http.Header{}
	for _, line := range strings.Split(cfg.Headers, "\n") {
		k, v, ok := strings.Cut(line, ":")
		if k = strings.TrimSpace(k); !ok || k == "" {
			continue
		}
		header.Set(k, strings.TrimSpace(v))
	}

	method := strings.ToUpper(strings.TrimSpace(cfg.Method))
	payload := ""
	if method != http.MethodGet {
		if method == "" {
			method = http.MethodPost
		}
		payload = replacer.Replace(cfg.BodyTemplate)
		if header.Get("Content-Type") == "" {
			header.Set("Content-Type", "application/json")
		}
	}

	return &HTTPMailRequest{
		To:       to,
		Subject:  subject,
		Method:   method,
		Endpoint: replacer.Replace(cfg.Endpoint),
		Header:   header,
		Body:     payload,
	}
}

// jsonStringContent encodes s as the inside of a JSON string literal -
// surrounding quotes stripped, HTML escaping disabled so email bodies keep
// their real '<', '>' and '&' characters instead of '<' noise.
func jsonStringContent(s string) string {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(s); err != nil {
		return s
	}
	out := buf.String()
	return out[1 : len(out)-2] // leading quote, trailing quote+newline
}
