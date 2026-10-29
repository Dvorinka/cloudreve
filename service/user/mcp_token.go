package user

import (
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/cloudreve/Cloudreve/v4/application/constants"
	"github.com/cloudreve/Cloudreve/v4/application/dependency"
	"github.com/cloudreve/Cloudreve/v4/inventory"
	"github.com/cloudreve/Cloudreve/v4/inventory/types"
	"github.com/cloudreve/Cloudreve/v4/pkg/auth"
	"github.com/cloudreve/Cloudreve/v4/pkg/filemanager/fs"
	"github.com/cloudreve/Cloudreve/v4/pkg/serializer"
	"github.com/gin-gonic/gin"
	"github.com/gofrs/uuid"
	"github.com/samber/lo"
)

const (
	maxAgentTokens = 10
	// agentTokenJWTLife is the lifetime baked into agent JWTs. The real,
	// editable expiry lives in the token record, so the JWT itself only has
	// to outlive every selectable lifetime.
	agentTokenJWTLife = 100 * 365 * 24 * time.Hour
	defaultAgentTTL   = 30 * 24 * time.Hour
	// expiryCapHorizon hides the artificial JWT lifetime in token views:
	// ceilings further out than this are reported as "no cap".
	expiryCapHorizon = 50 * 365 * 24 * time.Hour
)

// AgentTokenView is what the settings page shows. ExpiresAt is nil for
// never-expiring tokens; ExpiresCap is set when the underlying JWT caps how
// far the expiry can be pushed. AccessToken is set only on the create
// response.
type AgentTokenView struct {
	ID          string     `json:"id"`
	CreatedAt   time.Time  `json:"created_at"`
	ExpiresAt   *time.Time `json:"expires_at"`
	ExpiresCap  *time.Time `json:"expires_cap,omitempty"`
	Scopes      []string   `json:"scopes"`
	Roots       []string   `json:"roots"`
	AccessToken string     `json:"access_token,omitempty"`
}

// AgentTokenPatch carries the editable fields of a token. Nil fields keep
// their current value on PATCH; on POST nil means defaults (30 days, full
// access, all folders).
type AgentTokenPatch struct {
	// TTLSeconds is the token lifetime; <= 0 means it never expires.
	TTLSeconds *int64 `json:"ttl_seconds"`
	// Scopes limits which tools the token may call; empty means everything.
	Scopes *[]string `json:"scopes"`
	// Roots limits which folders the token may touch; empty means anywhere.
	Roots *[]string `json:"roots"`
}

// agentTokenScopes are the only scope values a token policy may grant.
var agentTokenScopes = []string{
	types.ScopeFilesRead,
	types.ScopeFilesWrite,
	types.ScopeSharesRead,
	types.ScopeSharesWrite,
}

// ListAgentTokens returns the caller's unexpired MCP tokens, without secrets.
func ListAgentTokens(c *gin.Context) ([]AgentTokenView, error) {
	dep := dependency.FromContext(c)
	user := inventory.UserFromContext(c)
	records, err := auth.LoadAgentTokens(dep.KV(), user.ID)
	if err != nil {
		return nil, err
	}
	records, changed := dropExpiredAgentTokens(records, time.Now())
	if changed {
		if err := auth.SaveAgentTokens(dep.KV(), user.ID, records); err != nil {
			return nil, err
		}
	}
	return viewsFrom(records, ""), nil
}

// IssueAgentToken creates an access token that acts as the caller on the MCP
// endpoint. The optional JSON body sets the lifetime, permission scope and
// folder roots. The secret is returned once.
func IssueAgentToken(c *gin.Context) (*AgentTokenView, error) {
	if err := auth.CheckScope(c, types.ScopeFilesWrite, types.ScopeSharesWrite); err != nil {
		return nil, err
	}
	var req AgentTokenPatch
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		return nil, serializer.NewError(serializer.CodeParamErr, "Parameter error", err)
	}
	dep := dependency.FromContext(c)
	user := inventory.UserFromContext(c)
	records, err := auth.LoadAgentTokens(dep.KV(), user.ID)
	if err != nil {
		return nil, err
	}
	records, _ = dropExpiredAgentTokens(records, time.Now())
	if len(records) >= maxAgentTokens {
		return nil, serializer.NewError(serializer.CodeParamErr, "Too many agent tokens", nil)
	}

	scopes, roots, err := normalizePolicy(req.Scopes, req.Roots)
	if err != nil {
		return nil, err
	}

	rootID := uuid.Must(uuid.NewV4())
	token, err := dep.TokenAuth().Issue(c, &auth.IssueTokenArgs{
		User:              user,
		RootTokenID:       &rootID,
		Revocable:         true,
		AccessTTLOverride: agentTokenJWTLife,
		Agent:             true,
	})
	if err != nil {
		return nil, serializer.NewError(serializer.CodeEncryptError, "Failed to issue agent token", err)
	}

	now := time.Now()
	record := auth.AgentTokenMeta{
		ID:      rootID.String(),
		Created: now,
		Expires: expiryFor(now, ttlOrDefault(req.TTLSeconds), token.AccessExpires),
		Ceiling: token.AccessExpires,
		Scopes:  scopes,
		Roots:   roots,
	}
	records = append(records, record)
	if err := auth.SaveAgentTokens(dep.KV(), user.ID, records); err != nil {
		return nil, err
	}
	view := viewsFrom([]auth.AgentTokenMeta{record}, token.AccessToken)[0]
	return &view, nil
}

// UpdateAgentToken edits one of the caller's MCP tokens. The expiry cannot
// exceed the lifetime baked into the JWT when the token was issued.
func UpdateAgentToken(c *gin.Context, id string) (*AgentTokenView, error) {
	if _, err := uuid.FromString(id); err != nil {
		return nil, serializer.NewError(serializer.CodeParamErr, "Unknown token", nil)
	}
	var req AgentTokenPatch
	if err := c.ShouldBindJSON(&req); err != nil {
		return nil, serializer.NewError(serializer.CodeParamErr, "Parameter error", err)
	}
	dep := dependency.FromContext(c)
	user := inventory.UserFromContext(c)
	records, err := auth.LoadAgentTokens(dep.KV(), user.ID)
	if err != nil {
		return nil, err
	}
	idx := -1
	for i := range records {
		if records[i].ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		return nil, serializer.NewError(serializer.CodeNotFound, "Unknown token", nil)
	}
	record := &records[idx]
	now := time.Now()
	if req.TTLSeconds != nil {
		record.Expires = expiryFor(now, *req.TTLSeconds, record.HardCeiling())
	}
	if req.Scopes != nil || req.Roots != nil {
		scopes := record.Scopes
		roots := record.Roots
		if req.Scopes != nil {
			if scopes, err = normalizeScopes(*req.Scopes); err != nil {
				return nil, err
			}
		}
		if req.Roots != nil {
			if roots, err = normalizeRoots(*req.Roots); err != nil {
				return nil, err
			}
		}
		record.Scopes, record.Roots = scopes, roots
	}
	if err := auth.SaveAgentTokens(dep.KV(), user.ID, records); err != nil {
		return nil, err
	}
	view := viewsFrom([]auth.AgentTokenMeta{*record}, "")[0]
	return &view, nil
}

// RevokeAgentToken invalidates one of the caller's MCP tokens.
func RevokeAgentToken(c *gin.Context, id string) error {
	if _, err := uuid.FromString(id); err != nil {
		return serializer.NewError(serializer.CodeParamErr, "Unknown token", nil)
	}
	dep := dependency.FromContext(c)
	user := inventory.UserFromContext(c)
	records, err := auth.LoadAgentTokens(dep.KV(), user.ID)
	if err != nil {
		return err
	}
	kept := records[:0]
	var found *auth.AgentTokenMeta
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
	return auth.SaveAgentTokens(dep.KV(), user.ID, kept)
}

// ttlOrDefault applies the create-time default when no lifetime was sent.
func ttlOrDefault(ttl *int64) int64 {
	if ttl == nil {
		return int64(defaultAgentTTL.Seconds())
	}
	return *ttl
}

// expiryFor resolves a requested ttl against the JWT ceiling. ttl <= 0 means
// "never", which is only representable when the ceiling does not bind —
// otherwise it clamps to the ceiling.
func expiryFor(now time.Time, ttlSeconds int64, ceiling time.Time) time.Time {
	if ttlSeconds <= 0 {
		if ceiling.IsZero() || ceiling.After(now.Add(expiryCapHorizon)) {
			return time.Time{}
		}
		return ceiling
	}
	expires := now.Add(time.Duration(ttlSeconds) * time.Second)
	if !ceiling.IsZero() && expires.After(ceiling) {
		return ceiling
	}
	return expires
}

func normalizePolicy(scopes, roots *[]string) ([]string, []string, error) {
	var outScopes, outRoots []string
	var err error
	if scopes != nil {
		if outScopes, err = normalizeScopes(*scopes); err != nil {
			return nil, nil, err
		}
	}
	if roots != nil {
		if outRoots, err = normalizeRoots(*roots); err != nil {
			return nil, nil, err
		}
	}
	return outScopes, outRoots, nil
}

func normalizeScopes(raw []string) ([]string, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	out := make([]string, 0, len(raw))
	for _, scope := range raw {
		if !lo.Contains(agentTokenScopes, scope) {
			return nil, serializer.NewError(serializer.CodeParamErr, fmt.Sprintf("Unknown scope: %s", scope), nil)
		}
		if !lo.Contains(out, scope) {
			out = append(out, scope)
		}
	}
	return out, nil
}

func normalizeRoots(raw []string) ([]string, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if !strings.Contains(item, "://") {
			if !strings.HasPrefix(item, "/") {
				item = "/" + item
			}
			item = "cloudreve://my" + item
		}
		uri, err := fs.NewUriFromString(item)
		if err != nil {
			return nil, serializer.NewError(serializer.CodeParamErr, fmt.Sprintf("Invalid folder %q", item), err)
		}
		if uri.FileSystem() != constants.FileSystemMy {
			return nil, serializer.NewError(serializer.CodeParamErr, "Folders must live under My Files", nil)
		}
		uri.U.RawQuery = ""
		uri.U.Fragment = ""
		if !lo.Contains(out, uri.String()) {
			out = append(out, uri.String())
		}
	}
	return out, nil
}

func dropExpiredAgentTokens(records []auth.AgentTokenMeta, now time.Time) ([]auth.AgentTokenMeta, bool) {
	kept := make([]auth.AgentTokenMeta, 0, len(records))
	for _, record := range records {
		if !record.Expired(now) {
			kept = append(kept, record)
		}
	}
	return kept, len(kept) != len(records)
}

func viewsFrom(records []auth.AgentTokenMeta, secret string) []AgentTokenView {
	out := make([]AgentTokenView, 0, len(records))
	for _, record := range records {
		view := AgentTokenView{
			ID:          record.ID,
			CreatedAt:   record.Created,
			Scopes:      record.Scopes,
			Roots:       record.Roots,
			AccessToken: secret,
		}
		if !record.Expires.IsZero() {
			expires := record.Expires
			view.ExpiresAt = &expires
		}
		if ceiling := record.HardCeiling(); !ceiling.IsZero() && ceiling.Before(time.Now().Add(expiryCapHorizon)) {
			view.ExpiresCap = &ceiling
		}
		out = append(out, view)
	}
	return out
}
