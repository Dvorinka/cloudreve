package auth

import (
	"encoding/gob"
	"strconv"
	"time"

	"github.com/cloudreve/Cloudreve/v4/pkg/cache"
	"github.com/cloudreve/Cloudreve/v4/pkg/serializer"
)

const agentTokenKVPrefix = "mcp_agents_"

// AgentTokenMeta is the editable policy attached to one MCP agent token. The
// JWT only carries the Agent marker and the root id; everything stored here
// can be changed later without re-issuing the secret.
type AgentTokenMeta struct {
	ID      string
	Created time.Time
	// Expires is the effective expiry. The zero time means never.
	Expires time.Time
	// Ceiling is the expiry baked into the JWT itself and can never be
	// exceeded. Zero on records issued before this field existed: those
	// tokens cannot outlive their original Expires.
	Ceiling time.Time
	// Scopes limits which tools the token may call; empty means everything.
	Scopes []string
	// Roots limits which folders the token may touch; empty means anywhere.
	Roots []string
}

func init() {
	// The first release of this feature persisted records under the type
	// name "user.agentTokenRecord". Keep those gob names so previously
	// stored entries still decode.
	gob.RegisterName("user.agentTokenRecord", AgentTokenMeta{})
	gob.RegisterName("[]user.agentTokenRecord", []AgentTokenMeta{})
}

// HardCeiling returns the latest instant the token could ever be valid.
func (m AgentTokenMeta) HardCeiling() time.Time {
	if m.Ceiling.IsZero() {
		return m.Expires
	}
	return m.Ceiling
}

// Expired reports whether the record stopped being valid at the given time.
func (m AgentTokenMeta) Expired(now time.Time) bool {
	return !m.Expires.IsZero() && !m.Expires.After(now)
}

func AgentTokenKey(uid int) string {
	return agentTokenKVPrefix + strconv.Itoa(uid)
}

// LoadAgentTokens returns the stored token records for one user.
func LoadAgentTokens(kv cache.Driver, uid int) ([]AgentTokenMeta, error) {
	raw, ok := kv.Get(AgentTokenKey(uid))
	if !ok || raw == nil {
		return nil, nil
	}
	records, ok := raw.([]AgentTokenMeta)
	if !ok {
		return nil, serializer.NewError(serializer.CodeCacheOperation, "Failed to read agent tokens", nil)
	}
	return records, nil
}

// SaveAgentTokens persists the records. When any record never expires the
// entry is kept indefinitely.
func SaveAgentTokens(kv cache.Driver, uid int, records []AgentTokenMeta) error {
	ttl := 60
	now := time.Now()
	for i := range records {
		if records[i].Expires.IsZero() {
			ttl = 0
			continue
		}
		if remaining := int(records[i].Expires.Sub(now).Seconds()) + 60; remaining > ttl {
			ttl = remaining
		}
	}
	if err := kv.Set(AgentTokenKey(uid), records, ttl); err != nil {
		return serializer.NewError(serializer.CodeCacheOperation, "Failed to store agent tokens", err)
	}
	return nil
}

// FindAgentToken returns the record with the given id, or nil.
func FindAgentToken(kv cache.Driver, uid int, id string) (*AgentTokenMeta, error) {
	records, err := LoadAgentTokens(kv, uid)
	if err != nil {
		return nil, err
	}
	for i := range records {
		if records[i].ID == id {
			return &records[i], nil
		}
	}
	return nil, nil
}
