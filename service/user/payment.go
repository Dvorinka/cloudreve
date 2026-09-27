package user

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/cloudreve/Cloudreve/v4/application/dependency"
	"github.com/cloudreve/Cloudreve/v4/ent"
	"github.com/cloudreve/Cloudreve/v4/ent/paymentorder"
	"github.com/cloudreve/Cloudreve/v4/inventory"
	"github.com/cloudreve/Cloudreve/v4/inventory/types"
	"github.com/cloudreve/Cloudreve/v4/pkg/activity"
	"github.com/cloudreve/Cloudreve/v4/pkg/hashid"
	"github.com/cloudreve/Cloudreve/v4/pkg/payment"
	"github.com/cloudreve/Cloudreve/v4/pkg/serializer"
	"github.com/cloudreve/Cloudreve/v4/pkg/setting"
	"github.com/cloudreve/Cloudreve/v4/pkg/util"
	"github.com/gin-gonic/gin"
)

const (
	// stripeCustomerKVPrefix caches the Stripe customer id per user so
	// checkout sessions reuse one provider-side customer.
	stripeCustomerKVPrefix = "payment:stripe:customer:"
	stripeProvider         = "stripe"
)

type (
	// CheckoutSessionService opens a hosted cash checkout for a SKU.
	CheckoutSessionService struct {
		Sku string `json:"sku" form:"sku" binding:"required,max=64"`
	}
	CheckoutSessionParamCtx struct{}

	// PaymentOrderService reports one of the caller's payment orders. When
	// the order is still pending it also asks the provider for the session
	// state and settles the order locally — covers deployments where the
	// webhook cannot reach the server.
	PaymentOrderService struct {
		ID string `uri:"id" binding:"required,max=64"`
	}
	PaymentOrderParamCtx struct{}

	// StripeWebhookService ingests Stripe webhook events. The payload is
	// only a trigger: the session is re-fetched from Stripe before any
	// fulfillment happens.
	StripeWebhookService  struct{}
	StripeWebhookParamCtx struct{}

	CheckoutResponse struct {
		OrderID string `json:"order_id"`
		URL     string `json:"url"`
	}

	PaymentOrderResponse struct {
		ID        string `json:"id"`
		SkuID     string `json:"sku_id"`
		SkuName   string `json:"sku_name"`
		Provider  string `json:"provider"`
		Amount    int64  `json:"amount"`
		Currency  string `json:"currency"`
		Status    string `json:"status"`
		CreatedAt int64  `json:"created_at"`
	}
)

func (service *CheckoutSessionService) Create(c *gin.Context) (*CheckoutResponse, error) {
	dep := dependency.FromContext(c)
	u := inventory.UserFromContext(c)

	cfg := dep.SettingProvider().Payment(c)
	if !cfg.Enabled || cfg.SecretKey == "" {
		return nil, serializer.NewError(serializer.CodeNotFound, "Cash checkout is not enabled", nil)
	}

	skuID, err := dep.HashIDEncoder().Decode(service.Sku, hashid.SkuID)
	if err != nil {
		return nil, serializer.NewError(serializer.CodeParamErr, "Invalid product", err)
	}
	s, err := dep.VasClient().GetSku(c, skuID)
	if err != nil || !s.Enabled {
		return nil, serializer.NewError(serializer.CodeNotFound, "Product not found", err)
	}
	if s.Price <= 0 {
		return nil, serializer.NewError(serializer.CodeParamErr, "Product is not purchasable with cash", nil)
	}

	customerID, err := ensureStripeCustomer(c, dep, cfg, u)
	if err != nil {
		return nil, serializer.NewError(serializer.CodeDBError, "Failed to create payment customer", err)
	}

	order, err := dep.VasClient().CreatePaymentOrder(c, u.ID, s.ID, stripeProvider, s.Price, cfg.Currency)
	if err != nil {
		return nil, serializer.NewError(serializer.CodeDBError, "Failed to create payment order", err)
	}

	siteURL := dep.SettingProvider().SiteURL(c).String()
	orderHash := hashid.EncodePaymentID(dep.HashIDEncoder(), order.ID)
	session, err := payment.Stripe.CreateCheckoutSession(c, cfg.SecretKey, payment.CheckoutParams{
		OrderID:     order.ID,
		ProductName: s.Name,
		Amount:      s.Price,
		Currency:    cfg.Currency,
		SuccessURL:  fmt.Sprintf("%s/shop?checkout=%s", siteURL, orderHash),
		CancelURL:   fmt.Sprintf("%s/shop", siteURL),
		CustomerID:  customerID,
	})
	if err != nil {
		return nil, serializer.NewError(serializer.CodeDBError, "Failed to create checkout session", err)
	}
	if err := dep.VasClient().BindPaymentSession(c, order.ID, session.SessionID); err != nil {
		return nil, serializer.NewError(serializer.CodeDBError, "Failed to bind checkout session", err)
	}

	return &CheckoutResponse{OrderID: orderHash, URL: session.URL}, nil
}

func (service *PaymentOrderService) Get(c *gin.Context) (*PaymentOrderResponse, error) {
	dep := dependency.FromContext(c)
	u := inventory.UserFromContext(c)

	orderID, err := dep.HashIDEncoder().Decode(service.ID, hashid.PaymentID)
	if err != nil {
		return nil, serializer.NewError(serializer.CodeParamErr, "Invalid order id", err)
	}
	order, err := dep.VasClient().PaymentOrder(c, int(orderID))
	if err != nil {
		if errors.Is(err, inventory.ErrPaymentOrderNotFound) {
			return nil, serializer.NewError(serializer.CodeNotFound, "Order not found", err)
		}
		return nil, serializer.NewError(serializer.CodeDBError, "Failed to get order", err)
	}
	if order.UserID != u.ID {
		return nil, serializer.NewError(serializer.CodeNotFound, "Order not found", nil)
	}

	if err := settlePaymentOrder(c, dep, order); err != nil {
		return nil, err
	}
	return paymentOrderResponse(dep, order), nil
}

// settlePaymentOrder pushes a pending, session-bound order through
// fulfillment when the provider confirms payment. Safe to call from both the
// status poll and the webhook — FulfillPaymentOrder claims the order
// atomically.
func settlePaymentOrder(c *gin.Context, dep dependency.Dep, order *ent.PaymentOrder) error {
	if order.Status != paymentorder.StatusPending || order.SessionID == "" {
		return nil
	}
	cfg := dep.SettingProvider().Payment(c)
	if !cfg.Enabled || cfg.SecretKey == "" || order.Provider != stripeProvider {
		return nil
	}
	paid, err := payment.Stripe.SessionPaid(c, cfg.SecretKey, order.SessionID)
	if err != nil {
		// Transient provider failures should not fail the status endpoint —
		// the order stays pending and the next poll settles it.
		dep.Logger().Warning("Failed to retrieve checkout session %s: %s", order.SessionID, err)
		return nil
	}
	if !paid {
		return nil
	}
	fulfilled, err := dep.VasClient().FulfillPaymentOrder(c, order.ID)
	if err != nil {
		return serializer.NewError(serializer.CodeDBError, "Failed to fulfill order", err)
	}
	if fulfilled {
		order.Status = paymentorder.StatusPaid
		activity.Record(c, dep.SettingProvider(), dep.ActivityClient(), types.EventPaymentFulfilled,
			activity.Extra(map[string]any{"order": order.ID, "amount": order.Amount, "currency": order.Currency}))
	}
	return nil
}

func (service *StripeWebhookService) Create(c *gin.Context) (string, error) {
	dep := dependency.FromContext(c)
	cfg := dep.SettingProvider().Payment(c)
	if !cfg.Enabled || cfg.WebhookSecret == "" || cfg.SecretKey == "" {
		return "", serializer.NewError(serializer.CodeParamErr, "Webhook is not configured", nil)
	}

	payload, err := c.GetRawData()
	if err != nil {
		return "", serializer.NewError(serializer.CodeParamErr, "Failed to read payload", err)
	}
	sessionID, completed, err := payment.Stripe.VerifyWebhook(payload, c.GetHeader("Stripe-Signature"), cfg.WebhookSecret)
	if err != nil {
		return "", serializer.NewError(serializer.CodeParamErr, "Invalid webhook signature", err)
	}
	if !completed {
		return "ignored", nil
	}

	// Authoritative check: never trust the event payload for money.
	paid, err := payment.Stripe.SessionPaid(c, cfg.SecretKey, sessionID)
	if err != nil {
		return "", serializer.NewError(serializer.CodeDBError, "Failed to retrieve session", err)
	}
	if !paid {
		return "ignored", nil
	}

	order, err := dep.VasClient().PaymentOrderBySession(c, sessionID)
	if err != nil {
		if errors.Is(err, inventory.ErrPaymentOrderNotFound) {
			return "ignored", nil
		}
		return "", serializer.NewError(serializer.CodeDBError, "Failed to load order", err)
	}
	if order.Provider != stripeProvider {
		return "ignored", nil
	}

	fulfilled, err := dep.VasClient().FulfillPaymentOrder(c, order.ID)
	if err != nil {
		activity.Record(c, dep.SettingProvider(), dep.ActivityClient(), types.EventPaymentFulfillFailed,
			activity.Extra(map[string]any{"order": order.ID, "error": err.Error()}))
		return "", serializer.NewError(serializer.CodeDBError, "Failed to fulfill order", err)
	}
	if fulfilled {
		dep.Logger().Info("Payment order %d fulfilled via webhook (session %s)", order.ID, sessionID)
		activity.Record(c, dep.SettingProvider(), dep.ActivityClient(), types.EventPaymentFulfilled,
			activity.Extra(map[string]any{"order": order.ID, "session": sessionID}))
	}
	return "ok", nil
}

// ensureStripeCustomer returns the cached Stripe customer id for the user,
// creating the customer on first use.
func ensureStripeCustomer(c *gin.Context, dep dependency.Dep, cfg *setting.PaymentSettings, u *ent.User) (string, error) {
	key := stripeCustomerKVPrefix + strconv.Itoa(u.ID)
	if raw, ok := dep.KV().Get(key); ok {
		if id, ok := raw.(string); ok && id != "" {
			return id, nil
		}
	}
	id, err := payment.Stripe.EnsureCustomer(c, cfg.SecretKey, u.ID, u.Email)
	if err != nil {
		return "", err
	}
	if err := dep.KV().Set(key, id, 0); err != nil {
		util.Log().Warning("Failed to cache Stripe customer id: %s", err)
	}
	return id, nil
}

func paymentOrderResponse(dep dependency.Dep, o *ent.PaymentOrder) *PaymentOrderResponse {
	res := &PaymentOrderResponse{
		ID:        hashid.EncodePaymentID(dep.HashIDEncoder(), o.ID),
		SkuID:     hashid.EncodeSkuID(dep.HashIDEncoder(), o.SkuID),
		Provider:  o.Provider,
		Amount:    o.Amount,
		Currency:  o.Currency,
		Status:    string(o.Status),
		CreatedAt: o.CreatedAt.Unix(),
	}
	if o.Edges.Sku != nil {
		res.SkuName = o.Edges.Sku.Name
	}
	return res
}
