//go:build windows && cgo

package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	sqlcipher "github.com/mutecomm/go-sqlcipher/v4"
)

// This verifies the real bundled SQLCipher driver and crypto on Windows CI.
// It does not claim the CRM plaintext migration or backup flow is implemented.
func TestSQLCipherDriverEncryptsAndRejectsWrongKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "crm-encrypted.sqlite")
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal("generate key:", err)
	}
	db := openSQLCipherTestDB(t, path, hex.EncodeToString(key))
	if _, err := db.Exec(`CREATE TABLE audit_events(id TEXT PRIMARY KEY, action TEXT NOT NULL)`); err != nil {
		t.Fatal("create encrypted table:", err)
	}
	if _, err := db.Exec(`INSERT INTO audit_events VALUES('audit-fixture', 'TEST')`); err != nil {
		t.Fatal("insert encrypted fixture:", err)
	}
	if err := db.Close(); err != nil {
		t.Fatal("close encrypted database:", err)
	}

	encrypted, err := sqlcipher.IsEncrypted(path)
	if err != nil || !encrypted {
		t.Fatalf("SQLCipher encryption check: encrypted=%v err=%v", encrypted, err)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("read encrypted bytes:", err)
	}
	if len(contents) < 16 || string(contents[:16]) == "SQLite format 3\x00" {
		t.Fatal("database has a plaintext SQLite header")
	}

	good := openSQLCipherTestDB(t, path, hex.EncodeToString(key))
	var cipherVersion string
	if err := good.QueryRow(`PRAGMA cipher_version`).Scan(&cipherVersion); err != nil || cipherVersion == "" {
		t.Fatal("the keyed connection did not report an active SQLCipher engine")
	}
	var action string
	if err := good.QueryRow(`SELECT action FROM audit_events WHERE id='audit-fixture'`).Scan(&action); err != nil || action != "TEST" {
		t.Fatal("correct key could not read fixture")
	}
	if err := good.Close(); err != nil {
		t.Fatal("close correctly keyed database:", err)
	}

	wrongKey := make([]byte, 32)
	for i := range wrongKey {
		wrongKey[i] = 0xff
	}
	bad := openSQLCipherTestDB(t, path, hex.EncodeToString(wrongKey))
	var count int
	if err := bad.QueryRow(`SELECT count(*) FROM sqlite_master`).Scan(&count); err == nil {
		t.Fatal("wrong key unexpectedly read encrypted schema")
	}
	_ = bad.Close()

	missing := openSQLCipherTestDBWithoutKey(t, path)
	if err := missing.QueryRow(`SELECT count(*) FROM sqlite_master`).Scan(&count); err == nil {
		t.Fatal("a missing key unexpectedly read encrypted schema")
	}
	_ = missing.Close()
}

func openSQLCipherTestDB(t *testing.T, path, key string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite3", path+"?_pragma_key="+url.QueryEscape("x'"+key+"'"))
	if err != nil {
		t.Fatal("open SQLCipher database")
	}
	db.SetMaxOpenConns(1)
	return db
}

func openSQLCipherTestDBWithoutKey(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal("open database without key")
	}
	db.SetMaxOpenConns(1)
	return db
}
