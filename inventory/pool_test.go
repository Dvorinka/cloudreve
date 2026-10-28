package inventory

import (
	"testing"

	"github.com/cloudreve/Cloudreve/v4/pkg/conf"
	"github.com/stretchr/testify/require"
)

func TestPoolLimits(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		dbType     conf.DBType
		configured int
		open       int
		idle       int
		warn       bool
	}{
		{name: "mysql default", dbType: conf.MySqlDB, configured: 0, open: 100, idle: 50},
		{name: "postgres unset", dbType: conf.PostgresDB, configured: -1, open: 100, idle: 50},
		{name: "small instance", dbType: conf.PostgresDB, configured: 20, open: 20, idle: 20},
		{name: "raised pool", dbType: conf.MySqlDB, configured: 200, open: 200, idle: 50},
		{name: "clamped", dbType: conf.PostgresDB, configured: 9000, open: 5000, idle: 50, warn: true},
		{name: "sqlite ignores config", dbType: conf.SQLiteDB, configured: 200, open: sqliteMaxOpenConns, idle: sqliteMaxOpenConns, warn: true},
		{name: "sqlite default is quiet", dbType: conf.SQLiteDB, configured: 0, open: sqliteMaxOpenConns, idle: sqliteMaxOpenConns},
		{name: "unset type matches sqlite", dbType: "UNSET", configured: 0, open: sqliteMaxOpenConns, idle: sqliteMaxOpenConns},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			open, idle, warn := poolLimits(tt.dbType, tt.configured)
			require.Equal(t, tt.open, open)
			require.Equal(t, tt.idle, idle)
			require.Equal(t, tt.warn, warn != "")
		})
	}
}
