package inventory

import (
	"context"
	"sync"
	"testing"

	"github.com/cloudreve/Cloudreve/v4/ent"
	"github.com/cloudreve/Cloudreve/v4/ent/paymentorder"
	"github.com/cloudreve/Cloudreve/v4/ent/sku"
	"github.com/stretchr/testify/require"
)

func paymentFixture(t *testing.T, client *ent.Client) (*ent.User, *ent.Sku) {
	ctx := context.Background()
	_, u := vasFixture(t, client)
	s := client.Sku.Create().
		SetName("Stream Pack").
		SetType(sku.TypeStreamTraffic).
		SetAmount(1024).
		SetPrice(199).
		SaveX(ctx)
	return u, s
}

func TestPaymentOrderLifecycle(t *testing.T) {
	ctx := context.Background()
	client, c := newVasClient(t)
	u, s := paymentFixture(t, client)

	order, err := c.CreatePaymentOrder(ctx, u.ID, s.ID, "stripe", s.Price, "usd")
	require.NoError(t, err)
	require.Equal(t, paymentorder.StatusPending, order.Status)

	// Session binds once; a second bind is rejected so sessions cannot be
	// reassigned to a different order.
	require.NoError(t, c.BindPaymentSession(ctx, order.ID, "cs_test_1"))
	require.Error(t, c.BindPaymentSession(ctx, order.ID, "cs_test_2"))

	got, err := c.PaymentOrderBySession(ctx, "cs_test_1")
	require.NoError(t, err)
	require.Equal(t, order.ID, got.ID)
	require.NotNil(t, got.Edges.Sku)

	_, err = c.PaymentOrderBySession(ctx, "cs_unknown")
	require.ErrorIs(t, err, ErrPaymentOrderNotFound)

	orders, total, err := c.ListPaymentOrders(ctx, u.ID, 1, 10)
	require.NoError(t, err)
	require.Equal(t, 1, total)
	require.Len(t, orders, 1)
}

func TestFulfillPaymentOrder(t *testing.T) {
	ctx := context.Background()
	client, c := newVasClient(t)
	u, s := paymentFixture(t, client)
	// Finite stream balance so the grant adds to it.
	client.User.UpdateOne(u).SetStreamTraffic(4096).SaveX(ctx)

	order, err := c.CreatePaymentOrder(ctx, u.ID, s.ID, "stripe", s.Price, "usd")
	require.NoError(t, err)

	fulfilled, err := c.FulfillPaymentOrder(ctx, order.ID)
	require.NoError(t, err)
	require.True(t, fulfilled)
	require.Equal(t, int64(5120), client.User.GetX(ctx, u.ID).StreamTraffic)
	require.Equal(t, paymentorder.StatusPaid,
		client.PaymentOrder.GetX(ctx, order.ID).Status)

	// Webhook replays are no-ops: no second grant.
	fulfilled, err = c.FulfillPaymentOrder(ctx, order.ID)
	require.NoError(t, err)
	require.False(t, fulfilled)
	require.Equal(t, int64(5120), client.User.GetX(ctx, u.ID).StreamTraffic)

	_, err = c.FulfillPaymentOrder(ctx, order.ID+999)
	require.ErrorIs(t, err, ErrPaymentOrderNotFound)
}

func TestFulfillPaymentOrderConcurrent(t *testing.T) {
	ctx := context.Background()
	client, c := newVasClient(t)
	u, s := paymentFixture(t, client)
	client.User.UpdateOne(u).SetStreamTraffic(0).SaveX(ctx)

	order, err := c.CreatePaymentOrder(ctx, u.ID, s.ID, "stripe", s.Price, "usd")
	require.NoError(t, err)

	var wg sync.WaitGroup
	results := make(chan bool, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ok, err := c.FulfillPaymentOrder(ctx, order.ID)
			require.NoError(t, err)
			results <- ok
		}()
	}
	wg.Wait()
	close(results)

	wins := 0
	for ok := range results {
		if ok {
			wins++
		}
	}
	require.Equal(t, 1, wins)
	// Exactly one fulfiller won: the grant applies once.
	require.Equal(t, int64(1024), client.User.GetX(ctx, u.ID).StreamTraffic)
}
