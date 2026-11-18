package basic

import (
	"testing"

	"github.com/cloudreve/Cloudreve/v4/pkg/setting"
	"github.com/stretchr/testify/require"
)

func TestVisibleCustomNavItems(t *testing.T) {
	items := []setting.CustomNavItem{
		{Name: "docs", URL: "https://example.com/docs"},
		{Name: "public", URL: "https://example.com/p", Scope: "public"},
		{Name: "members", URL: "https://example.com/members", Scope: "user"},
	}

	got := visibleCustomNavItems(items, true)
	require.Equal(t, []setting.CustomNavItem{items[0], items[1]}, got)

	require.Equal(t, items, visibleCustomNavItems(items, false))

	onlyUser := []setting.CustomNavItem{{Name: "members", URL: "https://example.com/members", Scope: "user"}}
	require.Nil(t, visibleCustomNavItems(onlyUser, true))
	require.Nil(t, visibleCustomNavItems(nil, true))
}
