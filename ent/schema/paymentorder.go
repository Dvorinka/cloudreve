package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// PaymentOrder records a cash checkout for a SKU. One row per checkout
// attempt; session_id is the provider's checkout session and doubles as the
// idempotency key for fulfillment.
type PaymentOrder struct {
	ent.Schema
}

// Fields of the PaymentOrder.
func (PaymentOrder) Fields() []ent.Field {
	return []ent.Field{
		field.Int("user_id"),
		field.Int("sku_id"),
		field.String("provider").
			Default("stripe"),
		// session_id stays NULL until the provider returns a checkout
		// session; uniqueness only constrains bound sessions.
		field.String("session_id").
			Optional().
			Unique(),
		// amount is the charged total in the currency's minor units.
		field.Int64("amount"),
		field.String("currency").
			Default("usd"),
		field.Enum("status").
			Values("pending", "paid", "expired").
			Default("pending"),
	}
}

// Edges of the PaymentOrder.
func (PaymentOrder) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).
			Ref("payment_orders").
			Field("user_id").
			Unique().
			Required(),
		edge.From("sku", Sku.Type).
			Ref("payment_orders").
			Field("sku_id").
			Unique().
			Required(),
	}
}

func (PaymentOrder) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id"),
	}
}

func (PaymentOrder) Mixin() []ent.Mixin {
	return []ent.Mixin{
		CommonMixin{},
	}
}
