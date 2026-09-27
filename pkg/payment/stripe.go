// Package payment wraps payment processors used by the shop's cash
// checkout. The processor interface stays minimal so tests can stub it and
// additional providers can slot in later.
package payment

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/stripe/stripe-go/v83"
	"github.com/stripe/stripe-go/v83/webhook"
)

type (
	// CheckoutParams carries everything a provider needs to open a hosted
	// checkout for one payment order.
	CheckoutParams struct {
		OrderID     int
		ProductName string
		// Amount is the order total in the currency's minor units.
		Amount   int64
		Currency string
		// SuccessURL/CancelURL are where the provider sends the buyer back.
		SuccessURL string
		CancelURL  string
		// CustomerID is the provider-side customer handle; empty means the
		// provider creates a guest-scoped session.
		CustomerID string
	}
	CheckoutResult struct {
		SessionID string
		URL       string
	}

	// Processor abstracts the hosted-checkout provider. Stripe is the only
	// implementation today.
	Processor interface {
		// EnsureCustomer returns the provider customer id for the user,
		// creating the customer when missing. The caller caches the result.
		EnsureCustomer(ctx context.Context, apiKey string, userID int, email string) (string, error)
		// CreateCheckoutSession opens a hosted checkout and returns the
		// redirect URL plus the provider session id.
		CreateCheckoutSession(ctx context.Context, apiKey string, p CheckoutParams) (*CheckoutResult, error)
		// SessionPaid pulls the session fresh from the provider — never
		// trust webhook payloads — and reports whether it is paid.
		SessionPaid(ctx context.Context, apiKey, sessionID string) (bool, error)
		// VerifyWebhook validates the signature header against the raw
		// payload and returns the referenced checkout session id when the
		// event reports a completed checkout.
		VerifyWebhook(payload []byte, sigHeader, webhookSecret string) (sessionID string, completed bool, err error)
	}

	stripeProcessor struct{}
)

// Stripe is the Stripe-backed Processor implementation.
var Stripe Processor = stripeProcessor{}

func (stripeProcessor) EnsureCustomer(ctx context.Context, apiKey string, userID int, email string) (string, error) {
	client := stripe.NewClient(apiKey)
	c, err := client.V1Customers.Create(ctx, &stripe.CustomerCreateParams{
		Email: stripe.String(email),
		Metadata: map[string]string{
			"cloudreve_user_id": strconv.Itoa(userID),
		},
	})
	if err != nil {
		return "", err
	}
	return c.ID, nil
}

func (stripeProcessor) CreateCheckoutSession(ctx context.Context, apiKey string, p CheckoutParams) (*CheckoutResult, error) {
	client := stripe.NewClient(apiKey)
	params := &stripe.CheckoutSessionCreateParams{
		Mode:              stripe.String(string(stripe.CheckoutSessionModePayment)),
		ClientReferenceID: stripe.String(strconv.Itoa(p.OrderID)),
		SuccessURL:        stripe.String(p.SuccessURL),
		CancelURL:         stripe.String(p.CancelURL),
		LineItems: []*stripe.CheckoutSessionCreateLineItemParams{
			{
				Quantity: stripe.Int64(1),
				PriceData: &stripe.CheckoutSessionCreateLineItemPriceDataParams{
					Currency:   stripe.String(p.Currency),
					UnitAmount: stripe.Int64(p.Amount),
					ProductData: &stripe.CheckoutSessionCreateLineItemPriceDataProductDataParams{
						Name: stripe.String(p.ProductName),
					},
				},
			},
		},
	}
	if p.CustomerID != "" {
		params.Customer = stripe.String(p.CustomerID)
	}
	params.AddMetadata("payment_order_id", strconv.Itoa(p.OrderID))

	s, err := client.V1CheckoutSessions.Create(ctx, params)
	if err != nil {
		return nil, err
	}
	return &CheckoutResult{SessionID: s.ID, URL: s.URL}, nil
}

func (stripeProcessor) SessionPaid(ctx context.Context, apiKey, sessionID string) (bool, error) {
	client := stripe.NewClient(apiKey)
	s, err := client.V1CheckoutSessions.Retrieve(ctx, sessionID, nil)
	if err != nil {
		return false, err
	}
	return s.PaymentStatus == stripe.CheckoutSessionPaymentStatusPaid ||
		s.PaymentStatus == stripe.CheckoutSessionPaymentStatusNoPaymentRequired, nil
}

func (stripeProcessor) VerifyWebhook(payload []byte, sigHeader, webhookSecret string) (string, bool, error) {
	event, err := webhook.ConstructEvent(payload, sigHeader, webhookSecret)
	if err != nil {
		return "", false, err
	}
	if event.Type != "checkout.session.completed" {
		return "", false, nil
	}
	var obj struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(event.Data.Raw, &obj); err != nil {
		return "", false, fmt.Errorf("failed to parse checkout session id: %w", err)
	}
	if obj.ID == "" {
		return "", false, fmt.Errorf("checkout.session.completed carried no session id")
	}
	return obj.ID, true, nil
}
