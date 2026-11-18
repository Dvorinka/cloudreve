package fs

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestShareUriPasswordRoundTrip(t *testing.T) {
	for _, password := range []string{"plain", "with space", "a:b@c/d?e", "😀😴😭", "$%^&*"} {
		u, err := NewUriFromString(NewShareUri("abc123", password))
		require.NoError(t, err, "password %q", password)
		require.Equal(t, "abc123", u.ID(""))
		require.Equal(t, password, u.Password(), "password %q", password)
	}

	u, err := NewUriFromString(NewShareUri("abc123", ""))
	require.NoError(t, err)
	require.Equal(t, "abc123", u.ID(""))
	require.Equal(t, "", u.Password())
}

func TestSearchParametersContent(t *testing.T) {
	u, err := NewUriFromString("cloudreve://my?content=hello+world")
	require.NoError(t, err)
	params := u.SearchParameters()
	require.NotNil(t, params)
	require.Equal(t, "hello world", params.Content)

	// Empty content does not trigger search mode.
	u, err = NewUriFromString("cloudreve://my?content=")
	require.NoError(t, err)
	require.Nil(t, u.SearchParameters())

	// Content combines with other search parameters.
	u, err = NewUriFromString("cloudreve://my?content=report&name=budget&case_folding=")
	require.NoError(t, err)
	params = u.SearchParameters()
	require.NotNil(t, params)
	require.Equal(t, "report", params.Content)
	require.Equal(t, []string{"budget"}, params.Name)
	require.True(t, params.CaseFolding)
}
