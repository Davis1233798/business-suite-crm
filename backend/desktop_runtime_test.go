package main

import (
	"strings"
	"testing"
)

func TestDesktopDatabaseKey(t *testing.T) {
	valid := strings.Repeat("ab", 32)
	for _, input := range []string{"", strings.Repeat("ab", 31), strings.Repeat("zz", 32), valid + "extra"} {
		if _, err := readDesktopDatabaseKey(strings.NewReader(input)); err == nil {
			t.Fatal("invalid desktop key was accepted")
		}
	}
	if key, err := readDesktopDatabaseKey(strings.NewReader(valid + "\n")); err != nil || key != valid {
		t.Fatal("valid desktop key was rejected")
	}
}
