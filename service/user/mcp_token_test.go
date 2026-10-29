package user

import (
	"testing"
	"time"

	"github.com/cloudreve/Cloudreve/v4/inventory/types"
	"github.com/samber/lo"
	"github.com/stretchr/testify/require"
)

func TestExpiryFor(t *testing.T) {
	now := time.Now()
	ceiling := now.Add(30 * 24 * time.Hour)

	// Finite ttl below the ceiling is taken as-is.
	got := expiryFor(now, 3600, ceiling)
	require.Equal(t, now.Add(time.Hour), got)

	// "Never" with a binding ceiling clamps to the ceiling; a far-future
	// (non-binding) or absent ceiling allows a real never.
	got = expiryFor(now, 0, ceiling)
	require.Equal(t, ceiling, got)
	got = expiryFor(now, 0, now.Add(100*365*24*time.Hour))
	require.True(t, got.IsZero())
	got = expiryFor(now, -5, ceiling)
	require.Equal(t, ceiling, got)

	// A ttl past the ceiling clamps as well.
	got = expiryFor(now, int64(365*24*3600), ceiling)
	require.Equal(t, ceiling, got)

	// No ceiling: never stays zero, any ttl applies.
	got = expiryFor(now, 0, time.Time{})
	require.True(t, got.IsZero())
	got = expiryFor(now, 3600, time.Time{})
	require.Equal(t, now.Add(time.Hour), got)
}

func TestNormalizeScopes(t *testing.T) {
	got, err := normalizeScopes(nil)
	require.NoError(t, err)
	require.Empty(t, got)

	got, err = normalizeScopes([]string{types.ScopeFilesRead, types.ScopeFilesRead, types.ScopeSharesWrite})
	require.NoError(t, err)
	require.Equal(t, []string{types.ScopeFilesRead, types.ScopeSharesWrite}, got)

	_, err = normalizeScopes([]string{types.ScopeAdminWrite})
	require.Error(t, err)

	_, err = normalizeScopes([]string{"bogus"})
	require.Error(t, err)
}

func TestNormalizeRoots(t *testing.T) {
	got, err := normalizeRoots([]string{"Documents", "/Photos", "cloudreve://my/Code"})
	require.NoError(t, err)
	require.Equal(t, []string{
		"cloudreve://my/Documents",
		"cloudreve://my/Photos",
		"cloudreve://my/Code",
	}, got)

	// Whole-drive root is allowed; other filesystems are not.
	got, err = normalizeRoots([]string{"cloudreve://my"})
	require.NoError(t, err)
	require.Equal(t, []string{"cloudreve://my"}, got)

	_, err = normalizeRoots([]string{"cloudreve://trash"})
	require.Error(t, err)
	_, err = normalizeRoots([]string{"cloudreve://shared_with_me/x"})
	require.Error(t, err)
	_, err = normalizeRoots([]string{"https://evil"})
	require.Error(t, err)

	require.Empty(t, lo.Must(normalizeRoots(nil)))
}
