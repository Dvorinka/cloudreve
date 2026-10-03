package email

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/cloudreve/Cloudreve/v4/pkg/logging"
	"github.com/cloudreve/Cloudreve/v4/pkg/request"
	"github.com/cloudreve/Cloudreve/v4/pkg/setting"
	"github.com/stretchr/testify/assert"
)

func TestRenderHTTPMail(t *testing.T) {
	cfg := &setting.HTTPMail{
		Endpoint:     "https://mail.example.com/api/send",
		Method:       "POST",
		Headers:      "Authorization: Bearer tok\nX-Custom: yes\nbroken-line\n: novalue",
		BodyTemplate: `{"to":"{to}","subject":"{subject}","html":"{body}","from":"{from}","from_name":"{from_name}","reply_to":"{reply_to}"}`,
	}
	identity := &setting.SMTP{From: "noreply@example.com", FromName: "Cloudreve Test", ReplyTo: "reply@example.com"}

	req := RenderHTTPMail(cfg, identity, "user@example.com", `Hi "there"`, "<p>Body & more</p>\nsecond line")
	assert.Equal(t, http.MethodPost, req.Method)
	assert.Equal(t, "https://mail.example.com/api/send", req.Endpoint)
	assert.Equal(t, "Bearer tok", req.Header.Get("Authorization"))
	assert.Equal(t, "yes", req.Header.Get("X-Custom"))
	assert.Equal(t, "application/json", req.Header.Get("Content-Type"))

	// Rendered body must stay valid JSON even when values contain quotes,
	// HTML and newlines.
	var decoded map[string]string
	assert.NoError(t, json.Unmarshal([]byte(req.Body), &decoded))
	assert.Equal(t, "user@example.com", decoded["to"])
	assert.Equal(t, `Hi "there"`, decoded["subject"])
	assert.Equal(t, "<p>Body & more</p>\nsecond line", decoded["html"])
	assert.Equal(t, "noreply@example.com", decoded["from"])
	assert.Equal(t, "Cloudreve Test", decoded["from_name"])
	assert.Equal(t, "reply@example.com", decoded["reply_to"])
}

func TestRenderHTTPMailGet(t *testing.T) {
	cfg := &setting.HTTPMail{
		Endpoint: "https://mail.example.com/send?to={to}&subject={subject}",
		Method:   "GET",
		Headers:  "Authorization: Bearer tok",
	}
	req := RenderHTTPMail(cfg, &setting.SMTP{}, "user@example.com", "Hi", "<p>x</p>")
	assert.Equal(t, http.MethodGet, req.Method)
	assert.Equal(t, "", req.Body)
	assert.Equal(t, "", req.Header.Get("Content-Type"))
	assert.Contains(t, req.Endpoint, "to=user@example.com")
}

func TestRenderHTTPMailDefaults(t *testing.T) {
	// Empty method falls back to POST; configured Content-Type is not
	// overridden.
	cfg := &setting.HTTPMail{
		Endpoint:     "https://mail.example.com/send",
		Headers:      "Content-Type: application/vnd.api+json",
		BodyTemplate: `{"to":"{to}"}`,
	}
	req := RenderHTTPMail(cfg, &setting.SMTP{}, "u@e.com", "s", "b")
	assert.Equal(t, http.MethodPost, req.Method)
	assert.Equal(t, "application/vnd.api+json", req.Header.Get("Content-Type"))
}

func TestHTTPPoolSend(t *testing.T) {
	type received struct {
		auth   string
		method string
		body   string
	}
	resCh := make(chan received, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		resCh <- received{auth: r.Header.Get("Authorization"), method: r.Method, body: string(b)}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	pool := &HTTPPool{
		config: &setting.HTTPMail{
			Endpoint:     srv.URL,
			Method:       "POST",
			Headers:      "Authorization: Bearer tok",
			BodyTemplate: `{"to":"{to}","subject":"{subject}","html":"{body}"}`,
		},
		from:   &setting.SMTP{From: "noreply@example.com"},
		client: request.NewClient(nil),
		ch:     make(chan *HTTPMailRequest, 30),
		l:      logging.NewConsoleLogger(logging.LevelError),
	}
	pool.Init()
	defer pool.Close()

	assert.NoError(t, pool.Send(context.Background(), "user@example.com", "Hello", "<p>hi</p>"))

	select {
	case got := <-resCh:
		assert.Equal(t, "Bearer tok", got.auth)
		assert.Equal(t, http.MethodPost, got.method)
		var decoded map[string]string
		assert.NoError(t, json.Unmarshal([]byte(got.body), &decoded))
		assert.Equal(t, "user@example.com", decoded["to"])
		assert.Equal(t, "Hello", decoded["subject"])
		assert.Equal(t, "<p>hi</p>", decoded["html"])
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for mail request")
	}
}
