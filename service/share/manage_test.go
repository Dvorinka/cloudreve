package share

import (
	"context"
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/cloudreve/Cloudreve/v4/application/dependency"
	"github.com/cloudreve/Cloudreve/v4/ent"
	"github.com/cloudreve/Cloudreve/v4/ent/enttest"
	"github.com/cloudreve/Cloudreve/v4/inventory"
	"github.com/cloudreve/Cloudreve/v4/inventory/types"
	"github.com/cloudreve/Cloudreve/v4/pkg/boolset"
	"github.com/cloudreve/Cloudreve/v4/pkg/cache"
	"github.com/cloudreve/Cloudreve/v4/pkg/conf"
	"github.com/cloudreve/Cloudreve/v4/pkg/hashid"
	"github.com/cloudreve/Cloudreve/v4/pkg/logging"
	"github.com/cloudreve/Cloudreve/v4/pkg/util"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// TestNormalizeSlug covers the filecloud-style custom link names: the
// relaxed charset, tolerant "/s/" input, clearing, hashid collision
// prevention and duplicate detection.
func TestNormalizeSlug(t *testing.T) {
	gin.SetMode(gin.TestMode)
	client := enttest.Open(t, "sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	ctx := context.Background()

	hasher, err := hashid.New("test-salt")
	require.NoError(t, err)

	group := client.Group.Create().SetName("g").SetPermissions(&boolset.BooleanSet{}).SaveX(ctx)
	owner := client.User.Create().
		SetEmail("owner@example.com").
		SetNick("owner").
		SetStatus("active").
		SetGroup(group).
		SetSettings(&types.UserSetting{}).
		SaveX(ctx)
	file := client.File.Create().SetName("f.txt").SetType(int(types.FileTypeFile)).SetOwner(owner).SaveX(ctx)

	// Existing slug holder — every duplicate check runs against this row.
	client.Share.Create().SetUser(owner).SetFile(file).SetSlug("taken-name").SaveX(ctx)

	// A real hashid for the collision check: encode a fresh share id, then
	// lowercase it the way the service would before validating.
	hashidShare := client.Share.Create().SetUser(owner).SetFile(file).SaveX(ctx)
	hashidRaw, err := hasher.Encode([]int{hashidShare.ID})
	require.NoError(t, err)

	dep := dependency.NewDependency(
		dependency.WithKV(cache.NewMemoStore("", nil)),
		dependency.WithLogger(logging.NewConsoleLogger(logging.LevelDebug)),
		dependency.WithShareClient(inventory.NewShareClient(client, conf.SQLiteDB, hasher)),
		dependency.WithHashIDEncoder(hasher),
	)

	w := httptest.NewRecorder()
	engine := gin.New()
	engine.ContextWithFallback = true
	c := gin.CreateTestContextOnly(w, engine)
	c.Request = httptest.NewRequest("POST", "/", nil)
	util.WithValue(c, dependency.DepCtx{}, dep)

	str := func(s string) *string { return &s }

	t.Run("relaxed charset accepted", func(t *testing.T) {
		for _, in := range []string{
			"random-test", "random_thing", "random.test", "random~thing",
			"abc", "a.b_c-d~e",
		} {
			got, err := normalizeSlug(c, dep, str(in), 0)
			require.NoError(t, err, in)
			require.NotNil(t, got, in)
			require.Equal(t, in, *got, in)
		}
	})

	t.Run("uppercase is lowercased", func(t *testing.T) {
		got, err := normalizeSlug(c, dep, str("My-Link"), 0)
		require.NoError(t, err)
		require.Equal(t, "my-link", *got)
	})

	t.Run("leading slash and /s/ prefix tolerated", func(t *testing.T) {
		for _, in := range []string{"/tolerant-one", "/s/tolerant-two", "s/tolerant-three"} {
			got, err := normalizeSlug(c, dep, str(in), 0)
			require.NoError(t, err, in)
			require.NotNil(t, got, in)
		}
	})

	t.Run("empty and cleared forms", func(t *testing.T) {
		for _, in := range []string{"", "   ", "/", "/s/"} {
			got, err := normalizeSlug(c, dep, str(in), 0)
			require.NoError(t, err, in)
			require.NotNil(t, got, in)
			require.Equal(t, "", *got, in)
		}
	})

	t.Run("nil leaves unchanged", func(t *testing.T) {
		got, err := normalizeSlug(c, dep, nil, 0)
		require.NoError(t, err)
		require.Nil(t, got)
	})

	t.Run("invalid values rejected", func(t *testing.T) {
		for _, in := range []string{
			"ab",         // too short
			"a b",        // space
			"UPPER_OK!",  // invalid char
			"-badstart",  // must start alphanumeric
			".bad",       // must start alphanumeric
			"//s//weird", // nested prefix leftovers
			"averyveryveryveryveryverylongslugnamethatkeepsgoingandgoingandgoingx", // >64
		} {
			got, err := normalizeSlug(c, dep, str(in), 0)
			require.Error(t, err, in)
			require.Nil(t, got, in)
		}
	})

	t.Run("hashid-like names rejected", func(t *testing.T) {
		got, err := normalizeSlug(c, dep, str(hashidRaw), 0)
		require.Error(t, err)
		require.Nil(t, got)
	})

	t.Run("duplicate rejected but self-update allowed", func(t *testing.T) {
		got, err := normalizeSlug(c, dep, str("taken-name"), 0)
		require.Error(t, err)
		require.Nil(t, got)

		// The slug's owner may re-submit the same value.
		holder, err := inventory.NewShareClient(client, conf.SQLiteDB, hasher).
			GetBySlug(context.Background(), "taken-name")
		require.NoError(t, err)
		got, err = normalizeSlug(c, dep, str("taken-name"), holder.ID)
		require.NoError(t, err)
		require.Equal(t, "taken-name", *got)
	})
}

func TestShareEditDiff(t *testing.T) {
	newShare := func() *ent.Share {
		return &ent.Share{
			Slug:           "docs",
			PricePoints:    0,
			ListedPublicly: false,
			Props: &types.ShareProps{
				PreviewOnly: true,
			},
		}
	}

	t.Run("create surfaces only non-default fields", func(t *testing.T) {
		diff := shareEditDiff(nil, newShare())
		require.Contains(t, diff, "slug")
		require.Contains(t, diff, "preview_only")
		require.NotContains(t, diff, "note")
		require.NotContains(t, diff, "price_points")
		require.NotContains(t, diff, "password")
	})

	t.Run("edit reports changes only", func(t *testing.T) {
		before := newShare()
		after := newShare()
		after.Slug = "docs-v2"
		after.Password = "secret"
		after.Props.PreviewOnly = false
		diff := shareEditDiff(before, after)
		require.Equal(t, "docs", diff["slug"].(map[string]any)["from"])
		require.Equal(t, "docs-v2", diff["slug"].(map[string]any)["to"])
		require.Equal(t, "set", diff["password"].(map[string]any)["to"])
		require.Equal(t, true, diff["preview_only"].(map[string]any)["from"])
		require.Equal(t, false, diff["preview_only"].(map[string]any)["to"])
		require.NotContains(t, diff, "allow_upload")
	})

	t.Run("password transitions never leak the value", func(t *testing.T) {
		before := newShare()
		before.Password = "old-secret"
		after := newShare()
		after.Password = ""
		diff := shareEditDiff(before, after)
		require.Equal(t, "cleared", diff["password"].(map[string]any)["to"])
		raw := fmt.Sprintf("%v", diff)
		require.NotContains(t, raw, "old-secret")
	})
}
