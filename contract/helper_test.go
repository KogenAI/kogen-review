package contract

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"

	gitpkg "github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-loop/sys"
	"github.com/KogenAI/kogen-loop/tools"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
)

// eq fails the test when got differs from want; item names the contract item.
func eq[T comparable](t testing.TB, item string, got, want T) {
	t.Helper()
	if got != want {
		t.Errorf("%s: got %#v, want %#v", item, got, want)
	}
}

// deepEq is eq for values that are not comparable.
func deepEq(t testing.TB, item string, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s: got %#v, want %#v", item, got, want)
	}
}

// wantError fails unless err is a *sys.Error of the class and reason; it returns the error.
func wantError(t testing.TB, item string, err error, class, reason string) *sys.Error {
	t.Helper()
	if err == nil {
		t.Fatalf("%s: no error, want %s/%s", item, class, reason)
	}
	e, ok := sys.AsError(err)
	if !ok {
		t.Fatalf("%s: error %v is not a *sys.Error, want %s/%s", item, err, class, reason)
	}
	if e.Class != class || e.Reason != reason {
		t.Errorf("%s: error %s/%s (%s), want %s/%s", item, e.Class, e.Reason, e.Detail, class, reason)
	}
	return e
}

// The fixture's trees: the green candidate tree of the pass under review and another tree, the
// candidate after a further edit of app.txt (otherText). Git names a tree by its contents alone,
// so every fixture checkout has the same two.
var (
	greenTree, otherTree string
	treesOnce            sync.Once
)

const otherText = "candidate, edited after the green pass\n"

// reviewRole is the review model of the fixture's configuration.
var reviewRole = project.Role{Provider: "chatgpt", Model: "fixture-review-model", Effort: "medium"}

// greenPass is the green pass of greenTree a review is given.
func greenPass() verify.Pass { return verify.Pass{N: 1, Clean: true, Green: true, Tree: greenTree} }

// fakeEnv is a review's Env as a test scripts it: the model's answers and the verification
// passes. It records what the reviewer asks of its caller. No Build is involved: the input is a
// saved candidate in a temporary Git checkout and a run folder.
type fakeEnv struct {
	t   *testing.T
	dir string

	mu        sync.Mutex
	answers   []*provider.Response // one per Request, in order
	requests  []review.Request
	stages    []string            // the stage of every Save and "tool" for every Boundary, in order
	saves     []review.Checkpoint // every Save
	events    []map[string]any
	progress  []string
	tracks    int
	verifies  []verify.Pass // what Verify returns, in order
	last      *core.ReviewRecord
	repairs   int
	executor  *core.ExecutorState
	unread    []string // Unread's answer
	materials int      // Delivered calls
}

// newReview is a review of a saved candidate in a temporary Git checkout with a run folder: its
// Input (review number 1 of greenPass) and the fake Env serving it. The start commit holds
// app.txt, deleted.txt and the approved Intent's feature; the candidate (greenTree, in the
// checkout) changed app.txt and deleted deleted.txt.
func newReview(t *testing.T) (review.Input, *fakeEnv) {
	t.Helper()
	root := t.TempDir()
	git(t, root, nil, "init", "-q", "-b", "main")
	writeFile(t, filepath.Join(root, ".gitignore"), ".kogen/local/\n")
	writeFile(t, filepath.Join(root, "app.txt"), "start\n")
	writeFile(t, filepath.Join(root, "deleted.txt"), "gone\n")
	writeFile(t, filepath.Join(root, project.FeaturePath("fixture")), "Feature: Fixture\n")
	git(t, root, nil, "add", "-A")
	git(t, root, nil, "commit", "-q", "-m", "start")
	start := git(t, root, nil, "rev-parse", "HEAD")
	writeFile(t, filepath.Join(root, "app.txt"), "candidate\n")
	if err := os.Remove(filepath.Join(root, "deleted.txt")); err != nil {
		t.Fatal(err)
	}
	// Both trees are written to this checkout's repository (the review reads them there).
	repo := gitpkg.New(root, nil)
	green, err := repo.Tree(start, nil)
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(root, "app.txt"), otherText)
	other, err := repo.Tree(start, nil)
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(root, "app.txt"), "candidate\n")
	treesOnce.Do(func() { greenTree, otherTree = green, other })
	if green != greenTree || other != otherTree {
		t.Fatalf("the fixture's trees differ between checkouts: %s %s, %s %s", green, other, greenTree, otherTree)
	}
	dir := filepath.Join(root, ".kogen/local/runs/fixture-run")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	env := &fakeEnv{t: t, dir: dir}
	in := review.Input{
		Candidate: review.Candidate{Root: root, Repo: repo, Start: start, Tree: greenTree},
		Intent:    review.Intent{Slug: "fixture", Text: "# Fixture intent\n", Role: reviewRole},
		Evidence:  review.Evidence{Pass: greenPass()},
		Tools: review.Tools{
			Native: func(enabled []string) *tools.Tools { return &tools.Tools{Root: root, Enabled: enabled} },
			Record: func(tools.Call, tools.Output) map[string]any { return nil },
			Round: func(ctx context.Context, sess executor.Session, in executor.Input) (executor.RoundResult, error) {
				return sess.Round(ctx, in)
			},
			Home: os.Getenv("HOME"),
		},
		Number: 1,
		Run:    review.Run{ID: "fixture-run", Dir: dir},
	}
	return in, env
}

func writeFile(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func (h *fakeEnv) Save(c review.Checkpoint) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.saves = append(h.saves, c)
	h.stages = append(h.stages, c.Stage)
	return nil
}

func (h *fakeEnv) Boundary([]any, *review.Done) error {
	h.stages = append(h.stages, "tool")
	return nil
}

func (h *fakeEnv) Reviewed(r core.ReviewRecord) error { h.last = &r; h.tracks++; return nil }
func (h *fakeEnv) Repaired() error                    { h.repairs++; h.tracks++; return nil }
func (h *fakeEnv) Executor(x *core.ExecutorState)     { h.executor = x }
func (h *fakeEnv) Track() error                       { h.tracks++; return nil }
func (h *fakeEnv) Facts(string) error                 { return nil }
func (h *fakeEnv) Progress(line string)               { h.progress = append(h.progress, line) }
func (h *fakeEnv) Event(e map[string]any)             { h.events = append(h.events, e) }
func (h *fakeEnv) Err() error                         { return nil }
func (h *fakeEnv) BaselineIntact() error              { return nil }
func (h *fakeEnv) Comparison() []string               { return nil }
func (h *fakeEnv) Custody() error                     { return nil }

// Write writes a file of the run folder as JSON.
func (h *fakeEnv) Write(name string, data any) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(h.dir, name), b, 0o600)
}

func (h *fakeEnv) Feedback(pass verify.Pass, completion string) string {
	return "fixture feedback of pass " + itoa(pass.N) + "; call " + completion
}

func (h *fakeEnv) Verify(context.Context) (verify.Pass, error) {
	if len(h.verifies) == 0 {
		h.t.Fatal("Verify was not expected")
	}
	p := h.verifies[0]
	h.verifies = h.verifies[1:]
	return p, nil
}

func (h *fakeEnv) Prepare(tree string, m review.MaterialSet, role project.Role, instructions string, defs, diagnostic []any) ([]any, error) {
	return []any{map[string]any{"role": "user", "content": m.Authority + "\n" + m.Source}}, nil
}

func (h *fakeEnv) Unread([]any) ([]string, error) { return h.unread, nil }
func (h *fakeEnv) Delivered([]any) error          { h.materials++; return nil }

func (h *fakeEnv) Prefill(role project.Role, instructions string, defs, input []any) ([]any, error) {
	return input, nil
}

func (h *fakeEnv) Request(ctx context.Context, r review.Request) (*provider.Response, []any, error) {
	h.requests = append(h.requests, r)
	if len(h.answers) == 0 {
		h.t.Fatal("no scripted answer left for a model request")
	}
	resp := h.answers[0]
	h.answers = h.answers[1:]
	return resp, r.Input, nil
}

// submitReview is a model answer calling submit_review with args.
func submitReview(args string) *provider.Response {
	return &provider.Response{Items: []map[string]any{{
		"type": "function_call", "call_id": "call-submit", "name": "submit_review", "arguments": args,
	}}, Usage: provider.Usage{Input: 10, Output: 2}}
}

// prose is a model answer without a tool call.
func prose(text string) *provider.Response {
	return &provider.Response{Items: []map[string]any{{
		"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": text}},
	}}, Usage: provider.Usage{Input: 10, Output: 2}}
}

// fakeExecutor is an external executor serving the review role: one session per Start, whose
// rounds return the scripted structured results in order.
type fakeExecutor struct {
	t       *testing.T
	results []executor.RoundResult
	tasks   []executor.Task
	inputs  []executor.Input
	starts  int
}

func (x *fakeExecutor) Describe() executor.Descriptor { return externalDescriptor() }

func (x *fakeExecutor) Start(ctx context.Context, task executor.Task, emit executor.Sink) (executor.Session, error) {
	x.starts++
	x.tasks = append(x.tasks, task)
	return &fakeSession{x: x, id: "review-session-" + itoa(x.starts)}, nil
}

type fakeSession struct {
	x  *fakeExecutor
	id string
}

func (s *fakeSession) Handle() executor.Handle {
	return executor.Handle{Role: executor.RoleReview, Executor: "fixture-executor", Version: "1.0.0", SessionID: s.id}
}

func (s *fakeSession) Close() error { return nil }

func (s *fakeSession) Round(ctx context.Context, in executor.Input) (executor.RoundResult, error) {
	s.x.inputs = append(s.x.inputs, in)
	if len(s.x.results) == 0 {
		s.x.t.Fatal("no scripted executor round left")
	}
	r := s.x.results[0]
	s.x.results = s.x.results[1:]
	r.Handle = s.Handle()
	return r, nil
}

func externalDescriptor() executor.Descriptor {
	return executor.Descriptor{Name: "fixture-executor", Contract: "1", Version: "1.0.0",
		RoleCapabilities: map[string]executor.RoleCapabilities{executor.RoleReview: {}}}
}

// structured is an executor round that finished with the structured submission text.
func structured(text string) executor.RoundResult {
	return executor.RoundResult{Ending: executor.EndFinish, Structured: json.RawMessage(text)}
}

// eventsNamed are the run log's events of one kind.
func eventsNamed(t *testing.T, h *fakeEnv, name string) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, e := range h.events {
		if e["event"] == name {
			out = append(out, e)
		}
	}
	return out
}

// readJSON decodes a JSON file of the run folder.
func readJSON(t *testing.T, path string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var v map[string]any
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}
