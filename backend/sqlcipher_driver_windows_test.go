//go:build windows && cgo && libsqlite3

package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mattn/go-sqlite3"
)

const (
	windowsSQLCipherVersion = "4.20.0"
	windowsSQLiteVersion    = "3.54.1"
)

// This acceptance probe uses mattn/go-sqlite3's external-library build tag
// against the pinned official SQLCipher/OpenSSL build in Windows CI. SQLCipher
// consumes `hexkey` from the file URI during sqlite3_open, before driver PRAGMAs.
func TestWindowsExternalSQLCipherRejectsPlaintextWrongAndMissingKeys(t *testing.T) {
	path := filepath.Join(t.TempDir(), "crm-encrypted.sqlite")
	keyBytes := make([]byte, 32)
	if _, err := rand.Read(keyBytes); err != nil {
		t.Fatal("generate test key")
	}
	key := hex.EncodeToString(keyBytes)

	libVersion, _, _ := sqlite3.Version()
	if libVersion != windowsSQLiteVersion {
		t.Fatalf("unexpected SQLite engine version %q", libVersion)
	}
	db := openSQLCipherURI(t, path, key)
	db.SetMaxOpenConns(2)
	if _, err := db.Exec(`CREATE TABLE audit_events(id TEXT PRIMARY KEY, action TEXT NOT NULL)`); err != nil {
		t.Fatal("create encrypted table")
	}
	if _, err := db.Exec(`INSERT INTO audit_events VALUES('audit-fixture', 'TEST')`); err != nil {
		t.Fatal("insert encrypted fixture")
	}
	if err := db.Close(); err != nil {
		t.Fatal("close encrypted database")
	}

	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("read encrypted database bytes")
	}
	if len(contents) < 16 || string(contents[:16]) == "SQLite format 3\x00" {
		t.Fatal("encrypted database has a plaintext SQLite header")
	}

	// Hold two pool connections simultaneously to prove each open receives the
	// URI key and is backed by the same SQLCipher engine.
	db = openSQLCipherURI(t, path, key)
	db.SetMaxOpenConns(2)
	ctx := context.Background()
	first, err := db.Conn(ctx)
	if err != nil {
		t.Fatal("open first keyed pool connection")
	}
	defer first.Close()
	second, err := db.Conn(ctx)
	if err != nil {
		t.Fatal("open second keyed pool connection")
	}
	defer second.Close()
	for _, conn := range []*sql.Conn{first, second} {
		var cipherVersion, action string
		if err := conn.QueryRowContext(ctx, `PRAGMA cipher_version`).Scan(&cipherVersion); err != nil || !strings.Contains(cipherVersion, windowsSQLCipherVersion) {
			t.Fatal("connection is not using the pinned SQLCipher engine")
		}
		if err := conn.QueryRowContext(ctx, `SELECT action FROM audit_events WHERE id='audit-fixture'`).Scan(&action); err != nil || action != "TEST" {
			t.Fatal("keyed connection could not read encrypted fixture")
		}
	}
	if err := db.Close(); err != nil {
		t.Fatal("close reopened encrypted database")
	}

	wrongKey := strings.Repeat("f", 64)
	wrong := openSQLCipherURI(t, path, wrongKey)
	var count int
	if err := wrong.QueryRow(`SELECT count(*) FROM sqlite_master`).Scan(&count); err == nil {
		t.Fatal("wrong key unexpectedly read encrypted schema")
	}
	_ = wrong.Close()

	missing := openSQLCipherURIWithoutKey(t, path)
	if err := missing.QueryRow(`SELECT count(*) FROM sqlite_master`).Scan(&count); err == nil {
		t.Fatal("missing key unexpectedly read encrypted schema")
	}
	_ = missing.Close()
}

func openSQLCipherURI(t *testing.T, path, key string) *sql.DB {
	t.Helper()
	if len(key) != 64 {
		t.Fatal("test database key must be 32 bytes")
	}
	uri := sqlcipherFileURI(path)
	query := url.Values{"hexkey": []string{key}}
	db, err := sql.Open("sqlite3", uri+"?"+query.Encode())
	if err != nil {
		t.Fatal("open encrypted database")
	}
	return db
}

func openSQLCipherURIWithoutKey(t *testing.T, path string) *sql.DB {
	t.Helper()
	uri := sqlcipherFileURI(path)
	db, err := sql.Open("sqlite3", uri)
	if err != nil {
		t.Fatal("open database without key")
	}
	return db
}

func sqlcipherFileURI(path string) string {
	path = filepath.ToSlash(path)
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return (&url.URL{Scheme: "file", Path: path}).String()
}
