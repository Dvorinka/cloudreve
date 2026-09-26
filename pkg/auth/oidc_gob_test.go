package auth

import (
	"bytes"
	"encoding/gob"
	"testing"

	"github.com/stretchr/testify/require"
)

// OIDCDiscovery and JWKSet are cached through dep.KV(); the Redis driver
// gob-encodes values behind `any`, which fails with "type not registered for
// interface" unless the concrete type is registered.
func TestOIDCKVTypesGobRoundTrip(t *testing.T) {
	cases := map[string]any{
		"OIDCDiscovery": OIDCDiscovery{Issuer: "i", AuthorizationEndpoint: "a", TokenEndpoint: "t", UserinfoEndpoint: "u", JWKSURI: "j"},
		"JWKSet":        JWKSet{Keys: []JWK{{Kty: "RSA", Use: "sig", Alg: "RS256", Kid: "k", N: "n", E: "e"}}},
	}

	for name, v := range cases {
		var buf bytes.Buffer
		require.NoError(t, gob.NewEncoder(&buf).Encode(&v), name)

		var decoded any
		require.NoError(t, gob.NewDecoder(&buf).Decode(&decoded), name)
		require.Equal(t, v, decoded, name)
	}
}
