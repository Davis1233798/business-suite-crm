//go:build windows && cgo && libsqlite3

package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestWindowsExternalSQLCipherExportsCRMCommittedWAL(t *testing.T) {
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "crm plain.sqlite")
	source, err := openDB(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	source.SetMaxOpenConns(2)
	space := token()
	login(t, &App{db: source}, "admin@suite.test", space)
	org := "org_test_" + space

	reader, err := source.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Rollback()
	var originalCount int
	if err := reader.QueryRow("SELECT count(*) FROM audit_events").Scan(&originalCount); err != nil {
		t.Fatal(err)
	}
	const action = "crm-wal-export-probe-committed-audit"
	if _, err := source.Exec(`INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id)
		VALUES(?, ?, ?, 'admin', ?, 'crm', ?)`, token(), org, org+"_admin", action, org); err != nil {
		t.Fatal(err)
	}

	files := []string{sourcePath, sourcePath + "-wal"}
	before := make([][]byte, len(files))
	for i, file := range files {
		before[i], err = os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal("generate export fixture key")
	}
	keyHex := hex.EncodeToString(key)
	targetPath := filepath.Join(dir, "crm encrypted.sqlite")
	target := openSQLCipherURI(t, targetPath, keyHex)
	target.SetMaxOpenConns(1)
	if _, err := target.Exec("ATTACH DATABASE ? AS crm_source KEY ''", sqlcipherFileURI(sourcePath)+"?mode=ro"); err != nil {
		t.Fatal("attach the read-only CRM source:", err)
	}
	var output any
	if err := target.QueryRow("SELECT sqlcipher_export('main', 'crm_source')").Scan(&output); err != nil {
		t.Fatal("export the CRM SQLite schema and committed rows:", err)
	}
	if _, err := target.Exec("DETACH DATABASE crm_source"); err != nil {
		t.Fatal("detach CRM source:", err)
	}
	if err := target.Close(); err != nil {
		t.Fatal("close encrypted export:", err)
	}

	for i, file := range files {
		after, err := os.ReadFile(file)
		if err != nil || !bytes.Equal(before[i], after) {
			t.Fatalf("CRM export modified source file %s", filepath.Base(file))
		}
	}
	encrypted, err := os.ReadFile(targetPath)
	if err != nil || len(encrypted) < 16 || string(encrypted[:16]) == "SQLite format 3\x00" || bytes.Contains(encrypted, []byte(action)) {
		t.Fatal("CRM export is missing or contains plaintext")
	}
	reopened := openSQLCipherURI(t, targetPath, keyHex)
	defer reopened.Close()
	for _, table := range []string{"crm_accounts", "station_accounts", "station_grants", "audit_events"} {
		var sourceCount, targetCount int
		if err := source.QueryRow("SELECT count(*) FROM " + table).Scan(&sourceCount); err != nil {
			t.Fatal(err)
		}
		if err := reopened.QueryRow("SELECT count(*) FROM " + table).Scan(&targetCount); err != nil || sourceCount != targetCount {
			t.Fatalf("CRM export changed %s row count: %d vs %d", table, sourceCount, targetCount)
		}
	}
	var matching int
	if err := reopened.QueryRow("SELECT count(*) FROM audit_events WHERE organization_id=? AND action=?", org, action).Scan(&matching); err != nil || matching != 1 {
		t.Fatal("encrypted export lost the committed CRM WAL audit")
	}
}
