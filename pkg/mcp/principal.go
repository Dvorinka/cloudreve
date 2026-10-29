package mcp

import (
	"fmt"
	"strings"

	"github.com/cloudreve/Cloudreve/v4/ent"
	"github.com/cloudreve/Cloudreve/v4/pkg/filemanager/fs"
)

// Principal is the user an MCP session is allowed to act as. Scoped is false
// for first-party access tokens, which are not limited to OAuth scopes.
// Scoped is true for OAuth access tokens, which must carry each required scope.
// Roots limits the session to those folders; empty means anywhere.
type Principal struct {
	User   *ent.User
	Scopes []string
	Scoped bool
	Roots  []*fs.URI
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

// allowURI requires every URI to be equal to or under one of the Roots.
func (p Principal) allowURI(uid string, uris ...*fs.URI) error {
	if len(p.Roots) == 0 {
		return nil
	}
	for _, u := range uris {
		allowed := false
		for _, root := range p.Roots {
			if u.EqualOrIsDescendantOf(root, uid) {
				allowed = true
				break
			}
		}
		if !allowed {
			return fmt.Errorf("outside token scope: %s", u.String())
		}
	}
	return nil
}
