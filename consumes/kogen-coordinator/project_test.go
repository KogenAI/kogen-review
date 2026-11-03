package consumes

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
)

func TestProjectPaths(t *testing.T) {
	eq(t, "project.IntentDir", project.IntentDir("my-slug"), ".kogen/intents/my-slug")
	eq(t, "project.FeaturePath", project.FeaturePath("my-slug"), ".kogen/intents/my-slug/acceptance.feature")
	eq(t, "project.ModelPath", project.ModelPath("my-slug"), ".kogen/intents/my-slug/model.qnt")
	eq(t, "project.ConfigPath", project.ConfigPath, ".kogen/project.yaml")

	// cmd/kogen-review reads the Intent, its feature and the configuration under the root, and
	// review/material.go the model: the paths are relative to the repository root.
	root := t.TempDir()
	write(t, root, project.IntentDir("s")+"/intent.md", "# S\n", 0o644)
	write(t, root, project.FeaturePath("s"), "Feature: s\n", 0o644)
	write(t, root, project.ModelPath("s"), "module s {}\n", 0o644)
	write(t, root, project.ConfigPath, "version: 1\n", 0o644)
	for item, c := range map[string][2]string{
		"project.IntentDir":   {filepath.Join(project.IntentDir("s"), "intent.md"), "# S\n"},
		"project.FeaturePath": {project.FeaturePath("s"), "Feature: s\n"},
		"project.ModelPath":   {project.ModelPath("s"), "module s {}\n"},
		"project.ConfigPath":  {project.ConfigPath, "version: 1\n"},
	} {
		b, err := os.ReadFile(filepath.Join(root, c[0]))
		eq(t, item, err, nil)
		eq(t, item, string(b), c[1])
	}
}

// The configuration of this very repository's shape: what cmd/kogen-review reads of it.
const configYAML = `version: 1
commands:
  setup: []
  fix:
    - 'gofmt -w .'
    - 'echo "it''s done"'
  checks:
    - name: format
      run: 'test -z "$(gofmt -l .)"'
    - name: go-test
      run: 'go test -race -count=1 ./...'
  acceptance:
    run: 'NODE_PATH="$KOGEN_CUCUMBER" node cucumber.js --strict'
    steps_dir: 'features/steps'
models:
  review:
    executor: claude-code
    model: claude-opus-5-5
    effort: high
    max_rounds: 2
`

func TestLoadConfigReadsTheCommands(t *testing.T) {
	root := t.TempDir()
	write(t, root, project.ConfigPath, configYAML, 0o644)
	cfg, err := project.LoadConfig(root)
	eq(t, "project.LoadConfig", err, nil)
	if cfg == nil {
		t.Fatal("project.LoadConfig: nil Config")
	}
	deepEq(t, "project.Config.Fix", cfg.Fix, []string{"gofmt -w .", `echo "it's done"`})
	eq(t, "project.Config.Checks", len(cfg.Checks), 2)
	// Checks in the file's order, each with its name and its command as written.
	var checks []project.Check = cfg.Checks
	eq(t, "project.Check.Name", checks[0].Name, "format")
	eq(t, "project.Check.Run", checks[0].Run, `test -z "$(gofmt -l .)"`)
	eq(t, "project.Check.Name", checks[1].Name, "go-test")
	eq(t, "project.Check.Run", checks[1].Run, "go test -race -count=1 ./...")
	var acceptance *project.Acceptance = cfg.Acceptance
	if acceptance == nil {
		t.Fatal("project.Config.Acceptance: nil with an acceptance command configured")
	}
	eq(t, "project.Acceptance.Run", acceptance.Run, `NODE_PATH="$KOGEN_CUCUMBER" node cucumber.js --strict`)
}

func TestLoadConfigWithoutAcceptanceHasNone(t *testing.T) {
	root := t.TempDir()
	write(t, root, project.ConfigPath, "version: 1\ncommands:\n  checks:\n    - name: build\n      run: 'go build ./...'\n", 0o644)
	cfg, err := project.LoadConfig(root)
	eq(t, "project.LoadConfig", err, nil)
	// cmd/kogen-review tests Acceptance for nil before reading its Run.
	eq(t, "project.Config.Acceptance", cfg.Acceptance == nil, true)
	eq(t, "project.Config.Fix", len(cfg.Fix), 0)
	eq(t, "project.Config.Checks", len(cfg.Checks), 1)
	eq(t, "project.Check.Name", cfg.Checks[0].Name, "build")
	eq(t, "project.Check.Run", cfg.Checks[0].Run, "go build ./...")
}

// renderable is the part of kogen-loop's stop that renders its detail lines.
type renderable interface{ Render() string }

func TestLoadConfigRefusals(t *testing.T) {
	// cmd/kogen-review prints err.Error() of a configuration it cannot use and exits 2.
	root := t.TempDir()
	_, err := project.LoadConfig(root)
	if err == nil {
		t.Fatal("project.LoadConfig: a root without a configuration loaded")
	}
	eq(t, "project.LoadConfig", err.Error(), "environment/not_initialized: "+root+" has no .kogen/project.yaml; run kogen init")

	write(t, root, project.ConfigPath, "version: 2\ncommands:\n  fix: []\n", 0o644)
	cfg, err := project.LoadConfig(root)
	if err == nil || cfg != nil {
		t.Fatalf("project.LoadConfig: an invalid configuration loaded: %v, %v", cfg, err)
	}
	file := filepath.Join(root, project.ConfigPath)
	eq(t, "project.LoadConfig", err.Error(), "environment/project_config_invalid: "+file)
	r, ok := err.(renderable)
	eq(t, "project.LoadConfig", ok, true)
	eq(t, "project.LoadConfig", r.Render(), "environment/project_config_invalid: "+file+"\n  line 1: version must be 1\n")

	write(t, root, project.ConfigPath, "commands:\n  fix: []\n", 0o644)
	_, err = project.LoadConfig(root)
	if err == nil || !strings.HasPrefix(err.Error(), "environment/old_kogen_config: ") {
		t.Errorf("project.LoadConfig: a configuration without a version gave %v, want environment/old_kogen_config", err)
	}
}

func TestRoleKeepsTheCheckpointBytes(t *testing.T) {
	// kogen-review's session checkpoint holds the review role as the JSON of project.Role.
	b, err := json.Marshal(project.Role{Provider: "chatgpt", Model: "m", Effort: "medium"})
	eq(t, "project.Role", err, nil)
	eq(t, "project.Role.Provider", string(b), `{"Provider":"chatgpt","Model":"m","Effort":"medium"}`)
	b, err = json.Marshal(project.Role{Provider: "openai-compatible", Model: "m2", Effort: "high", BaseURL: "http://127.0.0.1:1/v1"})
	eq(t, "project.Role.BaseURL", err, nil)
	eq(t, "project.Role.BaseURL", string(b), `{"Provider":"openai-compatible","Model":"m2","Effort":"high","BaseURL":"http://127.0.0.1:1/v1"}`)
	var back project.Role
	eq(t, "project.Role", json.Unmarshal(b, &back), nil)
	eq(t, "project.Role.Provider", back.Provider, "openai-compatible")
	eq(t, "project.Role.Model", back.Model, "m2")
	eq(t, "project.Role.Effort", back.Effort, "high")
	eq(t, "project.Role.BaseURL", back.BaseURL, "http://127.0.0.1:1/v1")
	// The role of the configuration's review model has the model and the effort it names.
	root := t.TempDir()
	write(t, root, project.ConfigPath, configYAML, 0o644)
	cfg, err := project.LoadConfig(root)
	eq(t, "project.Role", err, nil)
	review := cfg.Models["review"]
	eq(t, "project.Role.Model", review.Model, "claude-opus-5-5")
	eq(t, "project.Role.Effort", review.Effort, "high")
	eq(t, "project.Role.Provider", review.Provider, "")
	eq(t, "project.Role.BaseURL", review.BaseURL, "")
}

func TestSourceMessage(t *testing.T) {
	eq(t, "project.SourceMessage", project.SourceMessage(nil), "Source provenance: unavailable (legacy)")
	ref := &project.SourceRef{Path: "/receipts/current.json", SHA256: "aa11", ContractSHA256: "bb22"}
	eq(t, "project.SourceRef", project.SourceMessage(ref), "Diagnostic source provenance (not authority): /receipts/current.json\n"+
		"Manifest sha256: aa11; contract: bb22. Retrieve full originals with read_file. "+
		"Only the approved Intent authorizes implementation; omissions require ordinary Refine and new exact approval. Mapping is an aid, not proof.")
}

func TestValidateSource(t *testing.T) {
	// No receipt (a legacy approval) is valid.
	eq(t, "project.ValidateSource", project.ValidateSource(nil), nil)

	root := t.TempDir()
	dir := filepath.Join(root, ".kogen", "local", "provenance", "slug")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, d := range []string{dir, filepath.Dir(dir)} {
		if err := os.Chmod(d, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	body := []byte(`{"comparison":"x"}`)
	path := filepath.Join(dir, "current.json")
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(body)
	ref := &project.SourceRef{Path: path, SHA256: hex.EncodeToString(sum[:])}
	eq(t, "project.ValidateSource", project.ValidateSource(ref), nil)

	// Custody that is missing, changed or unsafe is the candidate/source_provenance_changed
	// stop, naming the receipt and its digest.
	refused := "candidate/source_provenance_changed: source provenance custody missing, changed or unsafe: " +
		path + " (expected SHA-256 " + ref.SHA256 + "); restore the named exact custody from preserved native receipt history, then run the card; if unavailable, stop"
	check := func(what string) {
		t.Helper()
		err := project.ValidateSource(ref)
		if err == nil {
			t.Errorf("project.ValidateSource: %s was accepted", what)
			return
		}
		eq(t, "project.ValidateSource: "+what, err.Error(), refused)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	check("a receipt readable by others")
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}
	eq(t, "project.ValidateSource", project.ValidateSource(ref), nil)
	if err := os.Chmod(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	check("a receipt folder open to others")
	if err := os.Chmod(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"comparison":"y"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	check("a receipt whose bytes changed")
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	check("a missing receipt")
}
