package payment

import (
	"fmt"
	"testing"
	"time"

	"github.com/stripe/stripe-go/v83/webhook"
	"github.com/stretchr/testify/require"
)

func signPayload(t *testing.T, payload []byte, secret string) string {
	ts := time.Now()
	return fmt.Sprintf("t=%d,v1=%x", ts.Unix(), webhook.ComputeSignature(ts, payload, secret))
}

func TestVerifyWebhook(t *testing.T) {
	secret := "whsec_testsecret"

	payload := []byte(`{
		"type": "checkout.session.completed",
		"api_version": "2025-09-30.clover",
		"data": {"object": {"id": "cs_test_123"}}
	}`)

	// Wrong signature is rejected.
	_, _, err := Stripe.VerifyWebhook(payload, "t=1,v1=deadbeef", secret)
	require.Error(t, err)

	// Wrong secret is rejected.
	_, _, err = Stripe.VerifyWebhook(payload, signPayload(t, payload, "whsec_wrong"), secret)
	require.Error(t, err)

	// Valid signature on the completed-checkout event yields the session id.
	sessionID, completed, err := Stripe.VerifyWebhook(payload, signPayload(t, payload, secret), secret)
	require.NoError(t, err)
	require.True(t, completed)
	require.Equal(t, "cs_test_123", sessionID)

	// Other event types verify but are not treated as completed checkouts.
	other := []byte(`{"type": "invoice.paid", "api_version": "2025-09-30.clover", "data": {"object": {"id": "in_1"}}}`)
	_, completed, err = Stripe.VerifyWebhook(other, signPayload(t, other, secret), secret)
	require.NoError(t, err)
	require.False(t, completed)
}
