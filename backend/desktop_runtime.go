package main

import (
	"bufio"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"strings"
)

var openDesktopDatabase = func(string, string) (*sql.DB, error) {
	return nil, errors.New("CRM desktop requires the SQLCipher build")
}

func readDesktopDatabaseKey(input io.Reader) (string, error) {
	reader := bufio.NewReaderSize(input, 128)
	line, err := reader.ReadSlice('\n')
	if err != nil {
		return "", errors.New("missing or invalid CRM desktop database key")
	}
	key := strings.TrimSuffix(strings.TrimSuffix(string(line), "\n"), "\r")
	if _, err := hex.DecodeString(key); len(key) != 64 || err != nil {
		return "", errors.New("invalid CRM desktop database key")
	}
	return key, nil
}
