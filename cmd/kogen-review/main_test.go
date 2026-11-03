package main

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestInitialVerificationStops(t *testing.T) {
	for _, tc := range []struct{ name, setup, feature, acceptance, state string }{
		{"no setup", "", "Feature: Tiny\n", "", "no_checks"},
		{"setup red", "false", "Feature: Tiny\n", "", "failed"},
		{"acceptance red", "true", "Feature: Tiny\n  Scenario: failure\n    Given failure\n", "  acceptance:\n    run: 'false'\n    steps_dir: features/steps\n", "failed"},
		{"model missing", "true", "Feature: Tiny\n", "  acceptance:\n    run: 'echo {} > \"$KOGEN_ACCEPTANCE_REPORT\"'\n", "unavailable"},
		{"baseline drift", "printf changed > ", "Feature: Tiny\n", "", "unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			git := func(args ...string) string {
				t.Helper()
				c := exec.Command("git", args...)
				c.Dir = root
				b, e := c.CombinedOutput()
				if e != nil {
					t.Fatalf("git: %v %s", e, b)
				}
				return string(bytes.TrimSpace(b))
			}
			write := func(name, text string) {
				t.Helper()
				p := filepath.Join(root, name)
				if e := os.MkdirAll(filepath.Dir(p), 0755); e != nil {
					t.Fatal(e)
				}
				if e := os.WriteFile(p, []byte(text), 0644); e != nil {
					t.Fatal(e)
				}
			}
			git("init", "-q")
			git("config", "user.email", "test@example.invalid")
			git("config", "user.name", "Test")
			write(".kogen/intents/tiny/intent.md", "# Tiny\n\nSlug: tiny\nModel: not applicable — simple\nAcceptance:\n- .kogen/intents/tiny/acceptance.feature\n")

			if tc.name == "model missing" {
				write(".kogen/intents/tiny/intent.md", "# Tiny\n\nSlug: tiny\nModel: .kogen/intents/tiny/model.qnt invariants=ExactGreen seed=1 samples=30 steps=8\nAcceptance:\n- .kogen/intents/tiny/acceptance.feature\n")
			}
			write(".kogen/intents/tiny/acceptance.feature", tc.feature)
			setup := tc.setup
			if tc.name == "baseline drift" {
				setup += filepath.Join(root, ".kogen/intents/tiny/intent.md")
			}
			setupList := "['" + setup + "']"
			if tc.name == "no setup" {
				setupList = "[]"
			}
			write(".kogen/project.yaml", "version: 1\ncommands:\n  setup: "+setupList+"\n  fix: []\n  checks: []\n"+tc.acceptance)
			git("add", "-A")
			git("commit", "-qm", "start")
			start := git("rev-parse", "HEAD")
			var out, stderr bytes.Buffer
			if code := run([]string{"-root", root, "-start", start, "-slug", "tiny", "-model", "test"}, &out, &stderr); code == 0 {
				t.Fatal("failed setup accepted")
			}
			var result result
			if e := json.Unmarshal(out.Bytes(), &result); e != nil {
				t.Fatalf("%v: %s %s", e, out.String(), stderr.String())
			}
			defer os.RemoveAll(result.Run)
			var record struct {
				State string `json:"state"`
			}
			b, e := os.ReadFile(filepath.Join(result.Run, "initial-verification.json"))
			if e != nil {
				t.Fatal(e)
			}
			if e = json.Unmarshal(b, &record); e != nil {
				t.Fatal(e)
			}
			if record.State != tc.state {
				t.Fatalf("state %q: %s", record.State, b)
			}
		})
	}
}
