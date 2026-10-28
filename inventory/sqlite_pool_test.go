package inventory

import (
	"context"
	rawsql "database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/cloudreve/Cloudreve/v4/pkg/conf"
	"github.com/stretchr/testify/require"
)

// The sqlite3Driver must apply WAL/busy_timeout/foreign_keys on every pooled
// connection — these pragmas are what make a multi-connection pool safe.
func TestSQLiteDriverPragmas(t *testing.T) {
	db, err := rawsql.Open("sqlite3", filepath.Join(t.TempDir(), "app.db"))
	require.NoError(t, err)
	defer db.Close()

	var (
		journalMode string
		busyTimeout int
		foreignKeys int
	)
	require.NoError(t, db.QueryRow("PRAGMA journal_mode").Scan(&journalMode))
	require.Equal(t, "wal", journalMode)
	require.NoError(t, db.QueryRow("PRAGMA busy_timeout").Scan(&busyTimeout))
	require.Equal(t, 5000, busyTimeout)
	require.NoError(t, db.QueryRow("PRAGMA foreign_keys").Scan(&foreignKeys))
	require.Equal(t, 1, foreignKeys)
}

// Regression for cloudreve/cloudreve#3608: with the old single-connection
// pool, one held transaction starved every other query — WebDAV auth included
// — until the process was restarted. Under WAL a reader on another connection
// must proceed while a writer transaction is still open.
func TestSQLitePoolReadsDuringHeldTx(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	db, err := rawsql.Open("sqlite3", filepath.Join(t.TempDir(), "app.db"))
	require.NoError(t, err)
	defer db.Close()
	open, idle, _ := poolLimits(conf.SQLiteDB, 0)
	configureDBPool(db, open, idle)

	_, err = db.ExecContext(ctx, "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
	require.NoError(t, err)

	tx, err := db.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, "INSERT INTO t (v) VALUES ('held')")
	require.NoError(t, err)

	// Reader must see pre-transaction state on a separate connection — with
	// MaxOpenConns(1) this blocked on pool acquire until the ctx deadline.
	var n int
	require.NoError(t, db.QueryRowContext(ctx, "SELECT COUNT(*) FROM t").Scan(&n))
	require.Equal(t, 0, n)
}
