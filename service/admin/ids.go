package admin

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
)

// overlapsID reports that a positive included id is also excluded.
// An empty include (id <= 0) is not a filter, so it cannot conflict.
func overlapsID(id int, ids []int) bool {
	return id > 0 && slices.Contains(ids, id)
}

// parseIDList splits a comma-separated list of positive integer ids.
// Empty input is no filter. Duplicates are dropped. Order is kept.
func parseIDList(raw string) ([]int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}

	parts := strings.Split(raw, ",")
	ids := make([]int, 0, len(parts))
	seen := make(map[int]struct{}, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		id, err := strconv.Atoi(part)
		if err != nil || id <= 0 {
			return nil, fmt.Errorf("invalid id %q", part)
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids, nil
}
