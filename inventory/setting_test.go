package inventory

import (
	"context"
	"testing"

	"github.com/cloudreve/Cloudreve/v4/ent/enttest"
	"github.com/stretchr/testify/require"
)

// Settings added after an installation shipped (e.g. shop_nav, share_score_rate)
// have no DB row; Set must insert them instead of silently updating zero rows.
func TestSettingSetUpsertsMissingRows(t *testing.T) {
	client := enttest.Open(t, "sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	defer client.Close()
	c := NewSettingClient(client, nil)
	ctx := context.Background()

	// New key: inserted, not silently dropped.
	err := c.Set(ctx, map[string]string{"shop_nav": "1", "share_score_rate": "100"})
	require.NoError(t, err)

	v, err := c.Get(ctx, "shop_nav")
	require.NoError(t, err)
	require.Equal(t, "1", v)

	got, err := c.Gets(ctx, []string{"shop_nav", "share_score_rate"})
	require.NoError(t, err)
	require.Equal(t, "100", got["share_score_rate"])

	// Existing key: updated in place, still a single row.
	err = c.Set(ctx, map[string]string{"shop_nav": "0"})
	require.NoError(t, err)

	v, err = c.Get(ctx, "shop_nav")
	require.NoError(t, err)
	require.Equal(t, "0", v)

	count, err := client.Setting.Query().Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 2, count)
}
