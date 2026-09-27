package user

import (
	"bytes"
	"context"
	"strconv"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/cloudreve/Cloudreve/v4/application/dependency"
	"github.com/cloudreve/Cloudreve/v4/ent"
	"github.com/cloudreve/Cloudreve/v4/ent/enttest"
	"github.com/cloudreve/Cloudreve/v4/ent/paymentorder"
	"github.com/cloudreve/Cloudreve/v4/ent/sku"
	"github.com/cloudreve/Cloudreve/v4/inventory"
	"github.com/cloudreve/Cloudreve/v4/inventory/types"
	"github.com/cloudreve/Cloudreve/v4/pkg/boolset"
	"github.com/cloudreve/Cloudreve/v4/pkg/cache"
	"github.com/cloudreve/Cloudreve/v4/pkg/conf"
	"github.com/cloudreve/Cloudreve/v4/pkg/hashid"
	"github.com/cloudreve/Cloudreve/v4/pkg/logging"
	"github.com/cloudreve/Cloudreve/v4/pkg/payment"
	"github.com/cloudreve/Cloudreve/v4/pkg/setting"
	"github.com/cloudreve/Cloudreve/v4/pkg/util"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// fakeProcessor records calls and lets each test stub the provider's
// behavior without touching api.stripe.com.
type fakeProcessor struct {
	customerID   string
	sessionID    string
	sessionURL   string
	paid         bool
	completed    bool
	verifyErr    error
	sessionErr   error
	verifyCalls  int
	sessionCalls int
}

func (f *fakeProcessor) EnsureCustomer(context.Context, string, int, string) (string, error) {
	return f.customerID, nil
}
func (f *fakeProcessor) CreateCheckoutSession(context.Context, string, payment.CheckoutParams) (*payment.CheckoutResult, error) {
	return &payment.CheckoutResult{SessionID: f.sessionID, URL: f.sessionURL}, nil
}
func (f *fakeProcessor) SessionPaid(context.Context, string, string) (bool, error) {
	f.sessionCalls++
	return f.paid, f.sessionErr
}
func (f *fakeProcessor) VerifyWebhook([]byte, string, string) (string, bool, error) {
	f.verifyCalls++
	return f.sessionID, f.completed, f.verifyErr
}

type paymentSettingProvider struct {
	setting.Provider
	payment *setting.PaymentSettings
}

func (p paymentSettingProvider) Payment(context.Context) *setting.PaymentSettings {
	return p.payment
}
func (p paymentSettingProvider) SiteURL(context.Context) *url.URL {
	u, _ := url.Parse("https://example.com")
	return u
}
func (p paymentSettingProvider) AuditLogEnabled(context.Context, int) bool {
	return false
}

func swapProcessor(t *testing.T, p payment.Processor) {
	orig := payment.Stripe
	payment.Stripe = p
	t.Cleanup(func() { payment.Stripe = orig })
}

func newPaymentDep(t *testing.T, client *ent.Client, enabled bool) (dependency.Dep, *paymentSettingProvider) {
	logger := logging.NewConsoleLogger(logging.LevelError)
	cfg, err := conf.NewIniConfigProvider(t.TempDir()+"/conf.ini", logger)
	require.NoError(t, err)
	sp := &paymentSettingProvider{payment: &setting.PaymentSettings{
		Enabled:       enabled,
		SecretKey:     "sk_test_x",
		WebhookSecret: "whsec_x",
		Currency:      "usd",
	}}
	dep := dependency.NewDependency(
		dependency.WithDbClient(client),
		dependency.WithConfigProvider(cfg),
		dependency.WithLogger(logger),
		dependency.WithKV(cache.NewMemoStore("", logger)),
		dependency.WithSettingProvider(sp),
		dependency.WithHashIDEncoder(mustHasher(t)),
	)
	return dep, sp
}

func paymentTestCtx(t *testing.T, dep dependency.Dep, u *ent.User, body []byte) *gin.Context {
	engine := gin.New()
	engine.ContextWithFallback = true
	c := gin.CreateTestContextOnly(httptest.NewRecorder(), engine)
	if body != nil {
		c.Request = httptest.NewRequest("POST", "/", bytes.NewReader(body))
	} else {
		c.Request = httptest.NewRequest("GET", "/", nil)
	}
	util.WithValue(c, dependency.DepCtx{}, dep)
	if u != nil {
		util.WithValue(c, inventory.UserCtx{}, u)
	}
	return c
}

func mustHasher(t *testing.T) hashid.Encoder {
	h, err := hashid.New("payment-test-salt")
	require.NoError(t, err)
	return h
}

func paymentFixtureSvc(t *testing.T, client *ent.Client) (*ent.User, *ent.Sku) {
	ctx := context.Background()
	g := client.Group.Create().SetName("g").SetPermissions(&boolset.BooleanSet{}).SaveX(ctx)
	u := client.User.Create().SetEmail("p@example.com").SetNick("p").SetStatus("active").
		SetGroup(g).SetSettings(&types.UserSetting{}).SetStreamTraffic(0).SaveX(ctx)
	s := client.Sku.Create().SetName("Stream").SetType(sku.TypeStreamTraffic).
		SetAmount(2048).SetPrice(499).SetEnabled(true).SaveX(ctx)
	return u, s
}

func TestCheckoutSessionCreatesOrder(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := enttest.Open(t, "sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	ctx := context.Background()
	u, s := paymentFixtureSvc(t, client)
	dep, _ := newPaymentDep(t, client, true)
	enc := mustHasher(t)

	fake := &fakeProcessor{customerID: "cus_1", sessionID: "cs_sess_1", sessionURL: "https://checkout.stripe.com/x"}
	swapProcessor(t, fake)

	c := paymentTestCtx(t, dep, u, nil)
	res, err := (&CheckoutSessionService{Sku: hashid.EncodeSkuID(enc, s.ID)}).Create(c)
	require.NoError(t, err)
	require.Equal(t, "https://checkout.stripe.com/x", res.URL)

	order, err := dep.VasClient().PaymentOrderBySession(ctx, "cs_sess_1")
	require.NoError(t, err)
	require.Equal(t, u.ID, order.UserID)
	require.Equal(t, paymentorder.StatusPending, order.Status)
	require.Equal(t, int64(499), order.Amount)

	// Stripe customer id was cached in KV.
	raw, ok := dep.KV().Get(stripeCustomerKVPrefix + strconv.Itoa(u.ID))
	require.True(t, ok)
	require.Equal(t, "cus_1", raw.(string))
}

func TestCheckoutSessionRejects(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := enttest.Open(t, "sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	ctx := context.Background()
	u, s := paymentFixtureSvc(t, client)
	dep, _ := newPaymentDep(t, client, false)
	enc := mustHasher(t)
	swapProcessor(t, &fakeProcessor{})

	// Payments disabled.
	_, err := (&CheckoutSessionService{Sku: hashid.EncodeSkuID(enc, s.ID)}).Create(paymentTestCtx(t, dep, u, nil))
	require.Error(t, err)

	dep, _ = newPaymentDep(t, client, true)
	// Disabled SKU.
	s2 := client.Sku.Create().SetName("Off").SetType(sku.TypeStorage).SetAmount(1).SetPrice(100).SetEnabled(false).SaveX(ctx)
	_, err = (&CheckoutSessionService{Sku: hashid.EncodeSkuID(enc, s2.ID)}).Create(paymentTestCtx(t, dep, u, nil))
	require.Error(t, err)
	// Zero-price SKU cannot go through cash checkout.
	s3 := client.Sku.Create().SetName("Free").SetType(sku.TypeStorage).SetAmount(1).SetPrice(0).SetEnabled(true).SaveX(ctx)
	_, err = (&CheckoutSessionService{Sku: hashid.EncodeSkuID(enc, s3.ID)}).Create(paymentTestCtx(t, dep, u, nil))
	require.Error(t, err)
}

func TestStripeWebhookFulfillsOnce(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := enttest.Open(t, "sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	ctx := context.Background()
	u, s := paymentFixtureSvc(t, client)
	dep, _ := newPaymentDep(t, client, true)

	order, err := dep.VasClient().CreatePaymentOrder(ctx, u.ID, s.ID, "stripe", s.Price, "usd")
	require.NoError(t, err)
	require.NoError(t, dep.VasClient().BindPaymentSession(ctx, order.ID, "cs_paid"))

	fake := &fakeProcessor{sessionID: "cs_paid", completed: true, paid: true}
	swapProcessor(t, fake)

	svc := &StripeWebhookService{}
	res, err := svc.Create(paymentTestCtx(t, dep, nil, []byte("{}")))
	require.NoError(t, err)
	require.Equal(t, "ok", res)
	require.Equal(t, int64(2048), client.User.GetX(ctx, u.ID).StreamTraffic)
	require.Equal(t, paymentorder.StatusPaid, client.PaymentOrder.GetX(ctx, order.ID).Status)

	// Webhook replay: no second grant.
	res, err = svc.Create(paymentTestCtx(t, dep, nil, []byte("{}")))
	require.NoError(t, err)
	require.Equal(t, "ok", res)
	require.Equal(t, int64(2048), client.User.GetX(ctx, u.ID).StreamTraffic)

	// Unpaid session does not fulfill.
	fake.paid = false
	order2, err := dep.VasClient().CreatePaymentOrder(ctx, u.ID, s.ID, "stripe", s.Price, "usd")
	require.NoError(t, err)
	require.NoError(t, dep.VasClient().BindPaymentSession(ctx, order2.ID, "cs_unpaid"))
	fake.sessionID = "cs_unpaid"
	res, err = svc.Create(paymentTestCtx(t, dep, nil, []byte("{}")))
	require.NoError(t, err)
	require.Equal(t, "ignored", res)
	require.Equal(t, paymentorder.StatusPending, client.PaymentOrder.GetX(ctx, order2.ID).Status)
}

func TestPaymentOrderGetSettlesAndProtects(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := enttest.Open(t, "sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	ctx := context.Background()
	u, s := paymentFixtureSvc(t, client)
	u2 := client.User.Create().SetEmail("q@example.com").SetNick("q").SetStatus("active").
		SetGroupID(u.GroupUsers).SetSettings(&types.UserSetting{}).SaveX(ctx)
	dep, _ := newPaymentDep(t, client, true)
	enc := mustHasher(t)

	order, err := dep.VasClient().CreatePaymentOrder(ctx, u.ID, s.ID, "stripe", s.Price, "usd")
	require.NoError(t, err)
	require.NoError(t, dep.VasClient().BindPaymentSession(ctx, order.ID, "cs_poll"))
	orderHash := hashid.EncodePaymentID(enc, order.ID)

	// Provider reports paid -> the poll settles the order itself (webhook
	// may never reach a dev deployment).
	fake := &fakeProcessor{paid: true}
	swapProcessor(t, fake)
	res, err := (&PaymentOrderService{ID: orderHash}).Get(paymentTestCtx(t, dep, u, nil))
	require.NoError(t, err)
	require.Equal(t, "paid", res.Status)
	require.Equal(t, int64(2048), client.User.GetX(ctx, u.ID).StreamTraffic)

	// Another user cannot read the order.
	_, err = (&PaymentOrderService{ID: orderHash}).Get(paymentTestCtx(t, dep, u2, nil))
	require.Error(t, err)
}
