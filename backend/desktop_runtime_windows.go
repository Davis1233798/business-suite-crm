//go:build windows && cgo && libsqlite3

package main

import (
	"database/sql"
	"errors"
	"net/url"
	"path/filepath"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

func init() {
	openDesktopDatabase = openCRMEncryptedDatabase
}

func openCRMEncryptedDatabase(file, key string) (*sql.DB, error) {
	absolute, err := filepath.Abs(file)
	if err != nil {
		return nil, errors.New("invalid CRM desktop database path")
	}
	query := url.Values{"hexkey": {key}}
	uri := url.URL{Scheme: "file", Path: "/" + strings.TrimPrefix(filepath.ToSlash(absolute), "/"), RawQuery: query.Encode()}
	db, err := sql.Open("sqlite3", uri.String())
	if err != nil {
		return nil, errors.New("cannot open encrypted CRM database")
	}
	var version string
	if err := db.QueryRow("PRAGMA cipher_version").Scan(&version); err != nil || version == "" {
		db.Close()
		return nil, errors.New("CRM desktop requires a working SQLCipher engine")
	}
	if _, err := initializeCRMDatabase(db); err != nil {
		return nil, errors.New("cannot initialize encrypted CRM database; check the key and database format")
	}
	return db, nil
}
