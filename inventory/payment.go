package inventory

import (
	"context"
	"errors"

	"github.com/cloudreve/Cloudreve/v4/ent"
	"github.com/cloudreve/Cloudreve/v4/ent/paymentorder"
)

var ErrPaymentOrderNotFound = errors.New("payment order not found")

// CreatePaymentOrder implements VasClient.CreatePaymentOrder.
func (c *vasClient) CreatePaymentOrder(ctx context.Context, userID, skuID int, provider string, amount int64, currency string) (*ent.PaymentOrder, error) {
	return c.client.PaymentOrder.Create().
		SetUserID(userID).
		SetSkuID(skuID).
		SetProvider(provider).
		SetAmount(amount).
		SetCurrency(currency).
		Save(ctx)
}

var ErrPaymentSessionBound = errors.New("payment order already bound to a session")

// BindPaymentSession implements VasClient.BindPaymentSession.
func (c *vasClient) BindPaymentSession(ctx context.Context, orderID int, sessionID string) error {
	n, err := c.client.PaymentOrder.Update().
		Where(paymentorder.ID(orderID), paymentorder.SessionIDIsNil()).
		SetSessionID(sessionID).
		Save(ctx)
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrPaymentSessionBound
	}
	return nil
}

// PaymentOrder implements VasClient.PaymentOrder.
func (c *vasClient) PaymentOrder(ctx context.Context, id int) (*ent.PaymentOrder, error) {
	o, err := c.client.PaymentOrder.Query().
		Where(paymentorder.ID(id)).
		WithSku().
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, ErrPaymentOrderNotFound
		}
		return nil, err
	}
	return o, nil
}

// PaymentOrderBySession implements VasClient.PaymentOrderBySession.
func (c *vasClient) PaymentOrderBySession(ctx context.Context, sessionID string) (*ent.PaymentOrder, error) {
	o, err := c.client.PaymentOrder.Query().
		Where(paymentorder.SessionID(sessionID)).
		WithSku().
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, ErrPaymentOrderNotFound
		}
		return nil, err
	}
	return o, nil
}

// ListPaymentOrders implements VasClient.ListPaymentOrders.
func (c *vasClient) ListPaymentOrders(ctx context.Context, userID, page, pageSize int) ([]*ent.PaymentOrder, int, error) {
	q := c.client.PaymentOrder.Query().
		Where(paymentorder.UserID(userID)).
		WithSku()
	total, err := q.Clone().Count(ctx)
	if err != nil {
		return nil, 0, err
	}
	orders, err := q.
		Order(ent.Desc(paymentorder.FieldCreatedAt)).
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		All(ctx)
	return orders, total, err
}

// FulfillPaymentOrder implements VasClient.FulfillPaymentOrder.
func (c *vasClient) FulfillPaymentOrder(ctx context.Context, orderID int) (bool, error) {
	// Atomic claim in autocommit: only one fulfiller can flip pending→paid.
	// Same pattern as gift-code redemption — keeps webhook retries and the
	// user-facing status poll from double-granting.
	n, err := c.client.PaymentOrder.Update().
		Where(paymentorder.ID(orderID), paymentorder.StatusEQ(paymentorder.StatusPending)).
		SetStatus(paymentorder.StatusPaid).
		Save(ctx)
	if err != nil {
		return false, err
	}
	if n == 0 {
		if _, qErr := c.client.PaymentOrder.Get(ctx, orderID); qErr != nil {
			if ent.IsNotFound(qErr) {
				return false, ErrPaymentOrderNotFound
			}
			return false, qErr
		}
		return false, nil
	}

	o, err := c.PaymentOrder(ctx, orderID)
	if err != nil {
		return false, err
	}

	txVc, tx, txCtx, err := WithTx(ctx, c)
	if err != nil {
		return false, err
	}
	grantErr := txVc.applySkuGrant(txCtx, o.UserID, o.Edges.Sku)
	if grantErr == nil {
		grantErr = Commit(tx)
	} else {
		_ = Rollback(tx)
	}
	if grantErr != nil {
		// Compensate the paid flip so a failed grant does not strand the
		// order in a paid-but-unfulfilled state — the next webhook retry or
		// status poll can settle it again.
		_, _ = c.client.PaymentOrder.Update().
			Where(paymentorder.ID(orderID), paymentorder.StatusEQ(paymentorder.StatusPaid)).
			SetStatus(paymentorder.StatusPending).
			Save(ctx)
		return false, grantErr
	}
	return true, nil
}
