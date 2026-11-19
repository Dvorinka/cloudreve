package admin

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseIDList(t *testing.T) {
	ids, err := parseIDList(" 1, 2,2, 3 ")
	require.NoError(t, err)
	require.Equal(t, []int{1, 2, 3}, ids)

	ids, err = parseIDList("   ")
	require.NoError(t, err)
	require.Nil(t, ids)

	_, err = parseIDList("1,x")
	require.Error(t, err)

	_, err = parseIDList("0")
	require.Error(t, err)
}
