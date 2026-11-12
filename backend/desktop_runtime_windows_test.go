//go:build windows && cgo && libsqlite3

package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPackagedCRMDesktopDatabase(t *testing.T) {
	path := filepath.Join(t.TempDir(), "crm desktop.sqlite")
	key := strings.Repeat("ab", 32)
	db, err := openDesktopDatabase(path, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) < 16 || bytes.HasPrefix(data, []byte("SQLite format 3\x00")) {
		t.Fatal("desktop database is empty or plaintext")
	}
	if wrong, err := openDesktopDatabase(path, strings.Repeat("cd", 32)); err == nil {
		wrong.Close()
		t.Fatal("desktop database accepted the wrong key")
	}
	reopened, err := openDesktopDatabase(path, key)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	var version int
	if err := reopened.QueryRow("SELECT version FROM crm_repository_schema").Scan(&version); err != nil || version != 1 {
		t.Fatalf("CRM schema was not restored: version=%d error=%v", version, err)
	}
}
