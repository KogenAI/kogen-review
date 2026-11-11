package main

import (
	"os"
	"strings"
	"testing"
)

// TestMain isolates the fixture repositories from the caller's Git setup: no inherited GIT_*
// variable, no global or system configuration (so no global hooks or signing), a HOME of its
// own and a fixture identity.
func TestMain(m *testing.M) {
	for _, kv := range os.Environ() {
		k, _, _ := strings.Cut(kv, "=")
		if strings.HasPrefix(k, "GIT_") {
			os.Unsetenv(k)
		}
	}
	home, err := os.MkdirTemp("", "kogen-review-cmd-home-")
	if err != nil {
		panic(err)
	}
	os.Setenv("HOME", home)
	os.Setenv("GIT_CONFIG_GLOBAL", "/dev/null")
	os.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	os.Setenv("GIT_TERMINAL_PROMPT", "0")
	os.Setenv("GIT_AUTHOR_NAME", "Fixture")
	os.Setenv("GIT_AUTHOR_EMAIL", "fixture@example.invalid")
	os.Setenv("GIT_COMMITTER_NAME", "Fixture")
	os.Setenv("GIT_COMMITTER_EMAIL", "fixture@example.invalid")
	code := m.Run()
	os.RemoveAll(home)
	os.Exit(code)
}
