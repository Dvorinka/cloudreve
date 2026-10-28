package mcp

import (
	"fmt"
	"strings"

	"github.com/cloudreve/Cloudreve/v4/ent"
)

// Principal is the user an MCP session is allowed to act as. Scoped is false
// for first-party access tokens, which are not limited to OAuth scopes.
// Scoped is true for OAuth access tokens, which must carry each required scope.
type Principal struct {
	User   *ent.User
	Scopes []string
	Scoped bool
}

func (p Principal) allow(required ...string) error {
	if !p.Scoped {
		return nil
	}
	granted := make(map[string]struct{}, len(p.Scopes)*2)
	for _, scope := range p.Scopes {
		granted[scope] = struct{}{}
		if resource, ok := strings.CutSuffix(scope, ".Write"); ok && resource != "" {
			granted[resource+".Read"] = struct{}{}
		}
	}
	for _, scope := range required {
		if _, ok := granted[scope]; !ok {
			return fmt.Errorf("insufficient scope: %s", scope)
		}
	}
	return nil
}
