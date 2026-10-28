package mcp

import (
	"fmt"
	"strings"

	"github.com/cloudreve/Cloudreve/v4/pkg/filemanager/fs"
)

const (
	defaultRoot = "cloudreve://my"
	maxPageSize = 200
	defaultPage = 50
)

// parseURI accepts a cloudreve URI or a plain path. A plain path is rooted at
// cloudreve://my so an agent can pass "Documents/a.txt".
func parseURI(raw string) (*fs.URI, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = defaultRoot
	}
	if !strings.Contains(raw, "://") {
		if !strings.HasPrefix(raw, "/") {
			raw = "/" + raw
		}
		raw = "cloudreve://my" + raw
	}
	uri, err := fs.NewUriFromString(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid uri %q: %w", raw, err)
	}
	return uri, nil
}

func parseURIs(raw []string) ([]*fs.URI, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("at least one uri is required")
	}
	out := make([]*fs.URI, 0, len(raw))
	for _, item := range raw {
		uri, err := parseURI(item)
		if err != nil {
			return nil, err
		}
		out = append(out, uri)
	}
	return out, nil
}

func searchURI(root, name, kind string) (*fs.URI, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("query is required")
	}
	uri, err := parseURI(root)
	if err != nil {
		return nil, err
	}
	q := uri.U.Query()
	q.Set(fs.QuerySearchName, name)
	q.Set(fs.QuerySearchCaseFolding, "1")
	switch kind {
	case "", "any":
	case "file", "folder":
		q.Set(fs.QuerySearchType, kind)
	default:
		return nil, fmt.Errorf("type must be file, folder, or any")
	}
	uri.U.RawQuery = q.Encode()
	return uri, nil
}

func clampPage(n int) int {
	if n <= 0 {
		return defaultPage
	}
	if n > maxPageSize {
		return maxPageSize
	}
	return n
}

func validName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\") {
		return fmt.Errorf("invalid file name %q", name)
	}
	return nil
}
