package user

import (
	"bytes"
	"encoding/gob"
	"testing"

	"github.com/stretchr/testify/require"
)

// ssoState is persisted through dep.KV(); the Redis driver gob-encodes values
// behind `any`, which fails with "type not registered for interface" unless the
// concrete type is registered. Regression test for the Redis SSO login failure.
func TestSSOStateGobRoundTrip(t *testing.T) {
	state := ssoState{Nonce: "n", Redirect: "/home", LinkUserID: 42}

	var buf bytes.Buffer
	var v any = state
	require.NoError(t, gob.NewEncoder(&buf).Encode(&v))

	var decoded any
	require.NoError(t, gob.NewDecoder(&buf).Decode(&decoded))
	got, ok := decoded.(ssoState)
	require.True(t, ok)
	require.Equal(t, state, got)
}
