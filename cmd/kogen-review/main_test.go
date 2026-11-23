package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-loop/sys"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
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

func TestReportVerificationErrorRetainsSubmittedEvidence(t *testing.T) {
	findings := []map[string]any{{"path": "value.txt", "line": 1, "severity": "note", "message": "Corrected the count"}}
	e := sys.Fail("review", "repair_unverified", "not verified", 1)
	e.Lines = []string{"original line"}
	out, code := report(review.Result{Record: core.ReviewRecord{Verdict: "approve", Tree: "edited", Findings: findings}, Repairs: 2}, e)
	if code == 0 || out.Verdict != "error" || out.Error.Class != "review" || out.Error.Reason != "repair_unverified" || out.Error.Detail != "not verified" || len(out.Error.Lines) != 1 || out.Error.Lines[0] != "original line" || out.Tree != "edited" || out.Submitted == nil || out.Submitted.Verdict != "approve" || len(out.Findings) != 1 || out.Repairs != 2 {
		t.Fatalf("report: %+v code %d", out, code)
	}
}

func TestUsageErrors(t *testing.T) {
	// The root does not exist: a run that wrongly got past the usage check would refuse with
	// another message instead of starting any review work.
	missing := filepath.Join(t.TempDir(), "missing")
	for _, tc := range []struct {
		name string
		args []string
	}{
		{"no arguments", nil},
		{"missing -start", []string{"-root", missing, "-slug", "tiny", "-model", "test"}},
		{"missing -slug", []string{"-root", missing, "-start", "HEAD", "-model", "test"}},
		{"missing -model", []string{"-root", missing, "-start", "HEAD", "-slug", "tiny"}},
		{"positional argument", []string{"-root", missing, "-start", "HEAD", "-slug", "tiny", "-model", "test", "extra"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var out, stderr bytes.Buffer
			if code := run(tc.args, &out, &stderr); code != 2 {
				t.Fatalf("exit %d, want 2; stderr %q", code, stderr.String())
			}
			if out.Len() != 0 {
				t.Fatalf("stdout %q, want empty", out.String())
			}
			if !strings.HasPrefix(stderr.String(), "usage: kogen-review -start REV ") || strings.Count(stderr.String(), "\n") != 1 {
				t.Fatalf("stderr %q, want the usage line alone", stderr.String())
			}
		})
	}
}

func TestUnusableInputsAreRefused(t *testing.T) {
	const intent = "# Tiny\n\nSlug: tiny\nModel: not applicable — simple\nAcceptance:\n- .kogen/intents/tiny/acceptance.feature\n"
	for _, tc := range []struct {
		name    string
		files   map[string]string
		start   string
		message string
	}{
		{"no intent", map[string]string{"README.md": "x\n"}, "HEAD", "intent.md"},
		{"no acceptance feature", map[string]string{".kogen/intents/tiny/intent.md": intent}, "HEAD", "acceptance.feature"},
		{"invalid project.yaml", map[string]string{
			".kogen/intents/tiny/intent.md":          intent,
			".kogen/intents/tiny/acceptance.feature": "Feature: Tiny\n",
			".kogen/project.yaml":                    "version: seven\n",
		}, "HEAD", "project.yaml"},
		{"start is not a commit", map[string]string{
			".kogen/intents/tiny/intent.md":          intent,
			".kogen/intents/tiny/acceptance.feature": "Feature: Tiny\n",
		}, "no-such-revision", "-start no-such-revision is not a commit"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			tmp := t.TempDir()
			git := func(args ...string) {
				t.Helper()
				c := exec.Command("git", args...)
				c.Dir = root
				if b, e := c.CombinedOutput(); e != nil {
					t.Fatalf("git: %v %s", e, b)
				}
			}
			git("init", "-q")
			for name, text := range tc.files {
				p := filepath.Join(root, name)
				if e := os.MkdirAll(filepath.Dir(p), 0755); e != nil {
					t.Fatal(e)
				}
				if e := os.WriteFile(p, []byte(text), 0644); e != nil {
					t.Fatal(e)
				}
			}
			git("add", "-A")
			git("commit", "-qm", "start")
			// A review would make its run folder in the temporary directory.
			t.Setenv("TMPDIR", tmp)
			var out, stderr bytes.Buffer
			code := run([]string{"-root", root, "-start", tc.start, "-slug", "tiny", "-model", "test"}, &out, &stderr)
			if code != 2 {
				t.Fatalf("exit %d, want 2; stdout %q stderr %q", code, out.String(), stderr.String())
			}
			if out.Len() != 0 {
				t.Fatalf("stdout %q, want empty", out.String())
			}
			line := stderr.String()
			if !strings.HasPrefix(line, "kogen-review: ") || strings.Count(line, "\n") != 1 || !strings.HasSuffix(line, "\n") || strings.Contains(line, "usage:") {
				t.Fatalf("stderr %q, want one kogen-review: refusal", line)
			}
			if !strings.Contains(line, tc.message) {
				t.Fatalf("stderr %q does not name the case (%q)", line, tc.message)
			}
			if left, e := os.ReadDir(tmp); e != nil || len(left) != 0 {
				t.Fatalf("a refusal left %v in the temporary directory (%v)", left, e)
			}
		})
	}
}

func partialEvents(events ...map[string]any) *verificationLog {
	l := &verificationLog{}
	for _, e := range events {
		l.Log(e)
	}
	return l
}

func TestPartialKeepsCompletedResultsOnTheirOwnCommands(t *testing.T) {
	cfg := &project.Config{
		Setup:  []string{"setup one", "setup two"},
		Checks: []project.Check{{Name: "format", Run: "fmt run"}, {Name: "compile", Run: "build run"}},
	}
	intent := &project.Intent{Model: &project.ModelSpec{None: true}}
	// Commands start together and finish in another order, so each result must find its own command.
	l := partialEvents(
		map[string]any{"event": "command", "name": "setup-1", "command": "setup one"},
		map[string]any{"event": "command", "name": "setup-2", "command": "setup two"},
		map[string]any{"event": "command", "name": "acceptance", "command": "accept run"},
		map[string]any{"event": "command", "name": "format", "command": "fmt run"},
		map[string]any{"event": "command", "name": "compile", "command": "build run"},
		map[string]any{"event": "command_result", "name": "compile", "status": 3, "output": "compile output\n"},
		map[string]any{"event": "command_result", "name": "setup-2", "status": 0, "output": "second setup output"},
		map[string]any{"event": "command_result", "name": "acceptance", "status": 0, "output": "accepted"},
		map[string]any{"event": "command_result", "name": "format", "status": 2, "output": "format output"},
		map[string]any{"event": "command_result", "name": "setup-1", "status": 5, "output": "first setup output"},
	)
	want := verify.Pass{
		N: 1, Tree: "tree-1", Model: verify.ModelNone,
		Setup: []verify.CommandResult{
			{Name: "setup-1", Command: "setup one", Status: 5, Output: "first setup output"},
			{Name: "setup-2", Command: "setup two", Status: 0, Output: "second setup output"},
		},
		Checks: []verify.CommandResult{
			{Name: "format", Command: "fmt run", Status: 2, Output: "format output"},
			{Name: "compile", Command: "build run", Status: 3, Output: "compile output\n"},
		},
		NotRun: []string{},
	}
	if got := l.partial("tree-1", cfg, intent); !reflect.DeepEqual(got, want) {
		t.Fatalf("partial:\n got %+v\nwant %+v", got, want)
	}
}

func TestPartialListsMissingWorkInOrder(t *testing.T) {
	cfg := &project.Config{
		Setup:  []string{"setup one", "setup two"},
		Checks: []project.Check{{Name: "format", Run: "fmt run"}, {Name: "compile", Run: "build run"}},
	}
	// Only the first setup command and the second check completed; a command that started but never
	// reported a result is still missing.
	events := []map[string]any{
		{"event": "command", "name": "setup-1", "command": "setup one"},
		{"event": "command_result", "name": "setup-1", "status": 0, "output": "ok"},
		{"event": "command", "name": "setup-2", "command": "setup two"},
		{"event": "command", "name": "compile", "command": "build run"},
		{"event": "command_result", "name": "compile", "status": 1, "output": "broken"},
	}
	for _, tc := range []struct {
		name   string
		intent *project.Intent
		model  verify.ModelResult
		notRun []string
	}{
		{"no model required", &project.Intent{Model: &project.ModelSpec{None: true}}, verify.ModelNone, []string{"setup-2", "acceptance", "format"}},
		{"model required", &project.Intent{Model: &project.ModelSpec{Path: "model.qnt"}}, verify.ModelNotRun, []string{"setup-2", "acceptance", "model", "format"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			want := verify.Pass{
				N: 1, Tree: "tree-2", Model: tc.model,
				Setup:  []verify.CommandResult{{Name: "setup-1", Command: "setup one", Status: 0, Output: "ok"}},
				Checks: []verify.CommandResult{{Name: "compile", Command: "build run", Status: 1, Output: "broken"}},
				NotRun: tc.notRun,
			}
			if got := partialEvents(events...).partial("tree-2", cfg, tc.intent); !reflect.DeepEqual(got, want) {
				t.Fatalf("partial:\n got %+v\nwant %+v", got, want)
			}
		})
	}
	// Nothing completed: every item is listed, in order.
	none := (&verificationLog{}).partial("tree-3", cfg, &project.Intent{Model: &project.ModelSpec{Path: "model.qnt"}})
	want := verify.Pass{
		N: 1, Tree: "tree-3", Model: verify.ModelNotRun,
		Setup: []verify.CommandResult{}, Checks: []verify.CommandResult{},
		NotRun: []string{"setup-1", "setup-2", "acceptance", "model", "format", "compile"},
	}
	if !reflect.DeepEqual(none, want) {
		t.Fatalf("partial with no events:\n got %+v\nwant %+v", none, want)
	}
}

// capturedRequest is the first request a fake provider received.
type capturedRequest struct {
	path string
	body map[string]any
}

// reviewWithFakeProvider runs the command on a temporary Git checkout whose initial verification
// passes, against a loopback server that records the first provider request and refuses it. The
// flags are given the server's URL as the base URL of an openai-compatible provider. It returns
// the recorded request.
func reviewWithFakeProvider(t *testing.T, flags func(baseURL string) []string, seam bool) capturedRequest {
	t.Helper()
	var mu sync.Mutex
	var first *capturedRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		body := map[string]any{}
		_ = json.Unmarshal(b, &body)
		mu.Lock()
		if first == nil {
			first = &capturedRequest{path: r.URL.Path, body: body}
		}
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		io.WriteString(w, `{"error":{"code":"refused_by_fake","type":"invalid_request_error","message":"refused by the fake provider"}}`)
	}))
	defer srv.Close()

	// A saved login for the default provider, in a home of its own, and the loopback seam that
	// sends its requests to the fake provider.
	home := t.TempDir()
	t.Setenv("HOME", home)
	creds := filepath.Join(home, ".kogen", "credentials")
	if err := os.MkdirAll(creds, 0o700); err != nil {
		t.Fatal(err)
	}
	login, _ := json.Marshal(map[string]any{
		"access_token": "fake-access", "refresh_token": "fake-refresh", "client_id": "oaiapp_fakeclient",
		"expires_at": time.Now().Add(24 * time.Hour).Unix(),
	})
	if err := os.WriteFile(filepath.Join(creds, "chatgpt.json"), login, 0o600); err != nil {
		t.Fatal(err)
	}
	if seam {
		t.Setenv("KOGEN_PROVIDER_URL", srv.URL)
	}
	tmp := t.TempDir()
	t.Setenv("TMPDIR", tmp)

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
		if e := os.MkdirAll(filepath.Dir(p), 0o755); e != nil {
			t.Fatal(e)
		}
		if e := os.WriteFile(p, []byte(text), 0o644); e != nil {
			t.Fatal(e)
		}
	}
	git("init", "-q")
	git("config", "user.email", "test@example.invalid")
	git("config", "user.name", "Test")
	write(".kogen/intents/tiny/intent.md", "# Tiny\n\nSlug: tiny\nModel: not applicable — simple\nAcceptance:\n- .kogen/intents/tiny/acceptance.feature\n")
	write(".kogen/intents/tiny/acceptance.feature", "Feature: Tiny\n")
	write(".kogen/project.yaml", "version: 1\ncommands:\n  setup: []\n  fix: []\n  checks:\n    - name: ok\n      run: 'true'\n  acceptance:\n    run: 'echo {} > \"$KOGEN_ACCEPTANCE_REPORT\"'\n    steps_dir: features/steps\n")
	git("add", "-A")
	git("commit", "-qm", "start")
	start := git("rev-parse", "HEAD")

	args := append([]string{"-root", root, "-start", start, "-slug", "tiny"}, flags(srv.URL+"/v1")...)
	var out, stderr bytes.Buffer
	run(args, &out, &stderr)
	var res result
	if e := json.Unmarshal(out.Bytes(), &res); e != nil {
		t.Fatalf("%v: stdout %q stderr %q", e, out.String(), stderr.String())
	}
	defer os.RemoveAll(res.Run)
	mu.Lock()
	defer mu.Unlock()
	if first == nil {
		t.Fatalf("the fake provider received no request; stdout %q stderr %q", out.String(), stderr.String())
	}
	return *first
}

func TestSuppliedRoleFlagsReachTheProviderRequest(t *testing.T) {
	got := reviewWithFakeProvider(t, func(baseURL string) []string {
		return []string{"-provider", "openai-compatible", "-model", "supplied-model", "-effort", "high", "-base-url", baseURL}
	}, false)
	if got.path != "/v1/chat/completions" {
		t.Errorf("route %q, want /v1/chat/completions under the supplied base URL", got.path)
	}
	if got.body["model"] != "supplied-model" {
		t.Errorf("model %v, want supplied-model", got.body["model"])
	}
	if got.body["reasoning_effort"] != "high" {
		t.Errorf("reasoning_effort %v, want high", got.body["reasoning_effort"])
	}
}

func TestOmittedRoleFlagsUseTheDocumentedDefaults(t *testing.T) {
	got := reviewWithFakeProvider(t, func(string) []string { return []string{"-model", "supplied-model"} }, true)
	if !strings.HasSuffix(got.path, "/responses") {
		t.Errorf("route %q, want the chatgpt Responses route (ending /responses)", got.path)
	}
	if got.body["model"] != "supplied-model" {
		t.Errorf("model %v, want supplied-model", got.body["model"])
	}
	reasoning, _ := got.body["reasoning"].(map[string]any)
	if reasoning["effort"] != "medium" {
		t.Errorf("reasoning.effort %v, want medium", got.body["reasoning"])
	}
}
