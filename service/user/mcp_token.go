package user

import (
	"encoding/gob"
	"strconv"
	"time"

	"github.com/cloudreve/Cloudreve/v4/application/dependency"
	"github.com/cloudreve/Cloudreve/v4/inventory"
	"github.com/cloudreve/Cloudreve/v4/inventory/types"
	"github.com/cloudreve/Cloudreve/v4/pkg/auth"
	"github.com/cloudreve/Cloudreve/v4/pkg/serializer"
	"github.com/gin-gonic/gin"
	"github.com/gofrs/uuid"
)

const (
	agentTokenTTL      = 30 * 24 * time.Hour
	maxAgentTokens     = 10
	agentTokenKVPrefix = "mcp_agents_"
)

// agentTokenRecord is the persisted metadata for one revocable MCP token.
// The secret itself is only returned when the token is created.
type agentTokenRecord struct {
	ID      string
	Created time.Time
	Expires time.Time
}

func init() {
	gob.Register(agentTokenRecord{})
	gob.Register([]agentTokenRecord{})
}

// AgentTokenView is what the settings page shows. AccessToken is set only
// on the create response.
type AgentTokenView struct {
	ID          string    `json:"id"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   time.Time `json:"expires_at"`
	AccessToken string    `json:"access_token,omitempty"`
}

// ListAgentTokens returns the caller's unexpired MCP tokens, without secrets.
func ListAgentTokens(c *gin.Context) ([]AgentTokenView, error) {
	dep := dependency.FromContext(c)
	user := inventory.UserFromContext(c)
	records, err := loadAgentTokens(dep, user.ID)
	if err != nil {
		return nil, err
	}
	records, changed := dropExpiredAgentTokens(records, time.Now())
	if changed {
		if err := saveAgentTokens(dep, user.ID, records); err != nil {
			return nil, err
		}
	}
	return viewsFrom(records, ""), nil
}

// IssueAgentToken creates a 30-day access token that acts as the caller.
// OAuth clients must already hold file and share write scopes. The secret is
// returned once.
func IssueAgentToken(c *gin.Context) (*AgentTokenView, error) {
	if err := auth.CheckScope(c, types.ScopeFilesWrite, types.ScopeSharesWrite); err != nil {
		return nil, err
	}
	dep := dependency.FromContext(c)
	user := inventory.UserFromContext(c)
	records, err := loadAgentTokens(dep, user.ID)
	if err != nil {
		return nil, err
	}
	records, _ = dropExpiredAgentTokens(records, time.Now())
	if len(records) >= maxAgentTokens {
		return nil, serializer.NewError(serializer.CodeParamErr, "Too many agent tokens", nil)
	}

	rootID := uuid.Must(uuid.NewV4())
	token, err := dep.TokenAuth().Issue(c, &auth.IssueTokenArgs{
		User:              user,
		RootTokenID:       &rootID,
		Revocable:         true,
		AccessTTLOverride: agentTokenTTL,
	})
	if err != nil {
		return nil, serializer.NewError(serializer.CodeEncryptError, "Failed to issue agent token", err)
	}

	record := agentTokenRecord{ID: rootID.String(), Created: time.Now(), Expires: token.AccessExpires}
	records = append(records, record)
	if err := saveAgentTokens(dep, user.ID, records); err != nil {
		return nil, err
	}
	view := viewsFrom([]agentTokenRecord{record}, token.AccessToken)[0]
	return &view, nil
}

// RevokeAgentToken invalidates one of the caller's MCP tokens.
func RevokeAgentToken(c *gin.Context, id string) error {
	if _, err := uuid.FromString(id); err != nil {
		return serializer.NewError(serializer.CodeParamErr, "Unknown token", nil)
	}
	dep := dependency.FromContext(c)
	user := inventory.UserFromContext(c)
	records, err := loadAgentTokens(dep, user.ID)
	if err != nil {
		return err
	}
	kept := records[:0]
	var found *agentTokenRecord
	for i := range records {
		if records[i].ID == id {
			copy := records[i]
			found = &copy
			continue
		}
		kept = append(kept, records[i])
	}
	if found == nil {
		return serializer.NewError(serializer.CodeNotFound, "Unknown token", nil)
	}
	ttl := int(time.Until(found.Expires).Seconds()) + 60
	if ttl < 60 {
		ttl = 60
	}
	if err := dep.KV().Set(auth.RevokeTokenPrefix+id, true, ttl); err != nil {
		return serializer.NewError(serializer.CodeCacheOperation, "Failed to revoke token", err)
	}
	return saveAgentTokens(dep, user.ID, kept)
}

func loadAgentTokens(dep dependency.Dep, uid int) ([]agentTokenRecord, error) {
	raw, ok := dep.KV().Get(agentTokenKey(uid))
	if !ok || raw == nil {
		return nil, nil
	}
	records, ok := raw.([]agentTokenRecord)
	if !ok {
		return nil, serializer.NewError(serializer.CodeCacheOperation, "Failed to read agent tokens", nil)
	}
	return records, nil
}

func saveAgentTokens(dep dependency.Dep, uid int, records []agentTokenRecord) error {
	ttl := 60
	now := time.Now()
	for _, record := range records {
		if remaining := int(record.Expires.Sub(now).Seconds()) + 60; remaining > ttl {
			ttl = remaining
		}
	}
	if err := dep.KV().Set(agentTokenKey(uid), records, ttl); err != nil {
		return serializer.NewError(serializer.CodeCacheOperation, "Failed to store agent tokens", err)
	}
	return nil
}

func dropExpiredAgentTokens(records []agentTokenRecord, now time.Time) ([]agentTokenRecord, bool) {
	kept := make([]agentTokenRecord, 0, len(records))
	for _, record := range records {
		if record.Expires.After(now) {
			kept = append(kept, record)
		}
	}
	return kept, len(kept) != len(records)
}

func viewsFrom(records []agentTokenRecord, secret string) []AgentTokenView {
	out := make([]AgentTokenView, 0, len(records))
	for _, record := range records {
		out = append(out, AgentTokenView{
			ID:          record.ID,
			CreatedAt:   record.Created,
			ExpiresAt:   record.Expires,
			AccessToken: secret,
		})
	}
	return out
}

func agentTokenKey(uid int) string {
	return agentTokenKVPrefix + strconv.Itoa(uid)
}
