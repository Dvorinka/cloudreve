package inventory

import (
	"context"
	rawsql "database/sql"
	"database/sql/driver"
	"fmt"
	"strings"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/cloudreve/Cloudreve/v4/ent"
	_ "github.com/cloudreve/Cloudreve/v4/ent/runtime"
	"github.com/cloudreve/Cloudreve/v4/inventory/debug"
	"github.com/cloudreve/Cloudreve/v4/pkg/cache"
	"github.com/cloudreve/Cloudreve/v4/pkg/conf"
	"github.com/cloudreve/Cloudreve/v4/pkg/logging"
	"github.com/cloudreve/Cloudreve/v4/pkg/util"
	_ "github.com/go-sql-driver/mysql"
	_ "github.com/lib/pq"
	"modernc.org/sqlite"
)

const (
	DBVersionPrefix           = "db_version_"
	EnvDefaultOverwritePrefix = "CR_SETTING_DEFAULT_"
	EnvEnableAria2            = "CR_ENABLE_ARIA2"
)

// InitializeDBClient runs migration and returns a new ent.Client with additional configurations
// for hooks and interceptors.
func InitializeDBClient(l logging.Logger,
	client *ent.Client, kv cache.Driver, requiredDbVersion string) (*ent.Client, error) {
	ctx := context.WithValue(context.Background(), logging.LoggerCtx{}, l)
	if needMigration(client, ctx, requiredDbVersion) {
		// Run the auto migration tool.
		if err := migrate(l, client, ctx, kv, requiredDbVersion); err != nil {
			return nil, fmt.Errorf("failed to migrate database: %w", err)
		}
	} else {
		// Version is current, but additive schema changes (new columns)
		// still need to reach existing databases between releases.
		RepairHeatWaveNotSecondary(l, client, ctx)
		if err := client.Schema.Create(ctx); err != nil {
			return nil, fmt.Errorf("failed to apply additive schema changes: %w", err)
		}
		l.Info("Database schema is up to date.")
	}

	//createMockData(client, ctx)
	return client, nil
}

// NewRawEntClient returns a new ent.Client without additional configurations.
func NewRawEntClient(l logging.Logger, config conf.ConfigProvider) (*ent.Client, error) {
	l.Info("Initializing database connection...")
	dbConfig := config.Database()
	confDBType := dbConfig.Type
	if confDBType == conf.SQLite3DB || confDBType == "" {
		confDBType = conf.SQLiteDB
	}
	if confDBType == conf.MariaDB {
		confDBType = conf.MySqlDB
	}

	var (
		err    error
		client *sql.Driver
	)

	// Check if the database type is supported.
	if confDBType != conf.SQLiteDB && confDBType != conf.MySqlDB && confDBType != conf.PostgresDB {
		return nil, fmt.Errorf("unsupported database type: %s", confDBType)
	}
	// If Database connection string provided, use it directly.
	if dbConfig.DatabaseURL != "" {
		l.Info("Connect to database with connection string")
		client, err = sql.Open(string(confDBType), ensureMySQLParseTime(confDBType, dbConfig.DatabaseURL))
	} else {

		switch confDBType {
		case conf.SQLiteDB:
			dbFile := util.RelativePath(dbConfig.DBFile)
			l.Info("Connect to SQLite database %q.", dbFile)
			client, err = sql.Open("sqlite3", util.RelativePath(dbConfig.DBFile))
		case conf.PostgresDB:
			l.Info("Connect to Postgres database %q.", dbConfig.Host)
			client, err = sql.Open("postgres", fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%d sslmode=disable",
				dbConfig.Host,
				dbConfig.User,
				dbConfig.Password,
				dbConfig.Name,
				dbConfig.Port))
		case conf.MySqlDB, conf.MsSqlDB:
			l.Info("Connect to MySQL/SQLServer database %q.", dbConfig.Host)
			var host string
			if dbConfig.UnixSocket {
				host = fmt.Sprintf("unix(%s)",
					dbConfig.Host)
			} else {
				host = fmt.Sprintf("(%s:%d)",
					dbConfig.Host,
					dbConfig.Port)
			}

			client, err = sql.Open(string(confDBType), fmt.Sprintf("%s:%s@%s/%s?charset=%s&parseTime=True&loc=Local",
				dbConfig.User,
				dbConfig.Password,
				host,
				dbConfig.Name,
				dbConfig.Charset))
		default:
			return nil, fmt.Errorf("unsupported database type %q", confDBType)
		}

		if err != nil {
			return nil, fmt.Errorf("failed to open database: %w", err)
		}

	}
	// Set connection pool
	open, idle, warn := poolLimits(confDBType, dbConfig.MaxOpenConns)
	if warn != "" {
		l.Warning("%s", warn)
	}
	configureDBPool(client.DB(), open, idle)

	driverOpt := ent.Driver(client)

	// Enable verbose logging for debug mode.
	if config.System().Debug {
		l.Debug("Debug mode is enabled for DB client.")
		driverOpt = ent.Driver(debug.DebugWithContext(client, func(ctx context.Context, i ...any) {
			logging.FromContext(ctx).Debug(i[0].(string), i[1:]...)
		}))
	}

	return ent.NewClient(driverOpt), nil
}

// sqliteMaxOpenConns bounds the SQLite pool. WAL lets readers proceed while a
// writer holds a transaction; writers still serialize at the engine level and
// surface SQLITE_BUSY after busy_timeout instead of queueing invisibly.
const sqliteMaxOpenConns = 10

// defaultMaxOpenConns is the historical pool size for MySQL and Postgres.
const defaultMaxOpenConns = 100

// maxAllowedOpenConns rejects accidental huge pools (a typo of 100000) while
// still letting a busy instance raise the old hard-coded 100.
const maxAllowedOpenConns = 5000

const defaultMaxIdleConns = 50

// poolLimits sizes the database/sql pool. SQLite used to be capped at a
// single connection, which let one held or stuck transaction starve every
// other query — including WebDAV auth — until the process was restarted
// (cloudreve/cloudreve#3608). With WAL + busy_timeout (sqlite3Driver) a small
// pool is safe: readers never block behind the writer. A configured value is
// ignored for SQLite because a large pool only queues SQLITE_BUSY.
//
// configured <= 0 keeps defaultMaxOpenConns. Values above maxAllowedOpenConns
// are clamped. warn is empty when nothing was adjusted.
func poolLimits(dbType conf.DBType, configured int) (open, idle int, warn string) {
	if dbType == conf.SQLiteDB || dbType == conf.SQLite3DB || dbType == "" || dbType == "UNSET" {
		if configured > 0 {
			warn = "Database.MaxOpenConns is ignored for SQLite"
		}
		return sqliteMaxOpenConns, sqliteMaxOpenConns, warn
	}

	switch {
	case configured <= 0:
		open = defaultMaxOpenConns
	case configured > maxAllowedOpenConns:
		open = maxAllowedOpenConns
		warn = fmt.Sprintf("Database.MaxOpenConns %d exceeds %d; clamped", configured, maxAllowedOpenConns)
	default:
		open = configured
	}

	idle = open
	if idle > defaultMaxIdleConns {
		idle = defaultMaxIdleConns
	}
	return open, idle, warn
}

func configureDBPool(db *rawsql.DB, open, idle int) {
	db.SetMaxIdleConns(idle)
	db.SetMaxOpenConns(open)
	db.SetConnMaxLifetime(time.Second * 30)
}

// ensureMySQLParseTime appends parseTime=True to a user-provided MySQL DSN
// when absent. Without it the driver returns DATETIME columns as strings,
// which fail to scan into time.Time fields (cloudreve/cloudreve#2872).
func ensureMySQLParseTime(dbType conf.DBType, dsn string) string {
	if dbType != conf.MySqlDB {
		return dsn
	}
	idx := strings.IndexByte(dsn, '?')
	if idx < 0 {
		return dsn + "?parseTime=True"
	}
	for _, p := range strings.Split(dsn[idx+1:], "&") {
		if strings.HasPrefix(strings.ToLower(p), "parsetime=") {
			return dsn
		}
	}
	return dsn + "&parseTime=True"
}

type sqlite3Driver struct {
	*sqlite.Driver
}

type sqlite3DriverConn interface {
	Exec(string, []driver.Value) (driver.Result, error)
}

func (d sqlite3Driver) Open(name string) (conn driver.Conn, err error) {
	conn, err = d.Driver.Open(name)
	if err != nil {
		return
	}
	// WAL lets readers coexist with the writer; busy_timeout makes a brief
	// lock wait instead of failing instantly with SQLITE_BUSY (#2917).
	for _, pragma := range []string{
		"PRAGMA journal_mode = WAL;",
		"PRAGMA synchronous = NORMAL;",
		"PRAGMA busy_timeout = 5000;",
		"PRAGMA foreign_keys = ON;",
	} {
		if _, err = conn.(sqlite3DriverConn).Exec(pragma, nil); err != nil {
			_ = conn.Close()
			return
		}
	}
	return
}

func init() {
	rawsql.Register("sqlite3", sqlite3Driver{Driver: &sqlite.Driver{}})
}
