package contract

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-verification/verify"
	"kogen-loop/provider"
	"kogen-loop/sys"
	"kogen-loop/tools"
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

// The fixture's trees: the green candidate tree of the pass under review and another tree.
const (
	greenTree = "1111111111111111111111111111111111111111"
	otherTree = "2222222222222222222222222222222222222222"
)

// reviewRole is the review model of the fixture's configuration.
var reviewRole = project.Role{Provider: "chatgpt", Model: "fixture-review-model", Effort: "medium"}

// greenPass is the green pass of greenTree a review is given.
func greenPass() verify.Pass { return verify.Pass{N: 1, Clean: true, Green: true, Tree: greenTree} }

// fakeHost is the Build's side of core.Attempt, as kogen-build's host implements it, reduced
// to what a test scripts: a candidate tree, the checkout's files, the model's answers and the
// executor's rounds. It records what the reviewer asks of the Build. Methods a case does not
// expect fail the test through the nil embedded interface (a panic).
type fakeHost struct {
	core.Host
	t     *testing.T
	state *core.State

	mu        sync.Mutex
	tree      string
	answers   []*provider.Response // one per Request, in order
	requests  []core.RequestSpec
	saves     []core.Continuation
	progress  []string
	tracks    int
	verifies  []verify.Pass // what Verify returns, in order
	invalid   *core.InvalidEnd
	unread    []string // MaterialUnread's answer
	material  core.MaterialSet
	materials int // MaterialEvent calls
}

// newAttempt is a Build in progress over a temporary checkout with a run folder: the state a
// reviewer works on and the fake host serving it.
func newAttempt(t *testing.T) (*core.Attempt, *fakeHost) {
	t.Helper()
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "app.txt"), "candidate\n")
	run, err := core.StartRun(root)
	if err != nil {
		t.Fatal(err)
	}
	st := &core.State{
		Root: root, Slug: "fixture", Start: otherTree, Run: run, Usage: core.ZeroTokens(),
		Config:         &project.Config{Models: map[string]project.Role{"review": reviewRole}},
		WorkingContext: map[string]*core.OwnerContext{},
	}
	h := &fakeHost{t: t, state: st, tree: greenTree,
		material: core.MaterialSet{Authority: "fixture authority", Source: "fixture source", Files: []map[string]any{{"path": "app.txt"}}}}
	return &core.Attempt{State: st, Host: h}, h
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

func (h *fakeHost) Save(c core.Continuation) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.saves = append(h.saves, c)
	h.state.Continuation = c
	return nil
}

func (h *fakeHost) Track() error                      { h.tracks++; return nil }
func (h *fakeHost) PublishFacts(string) error         { return nil }
func (h *fakeHost) Progress(line string)              { h.progress = append(h.progress, line) }
func (h *fakeHost) Err() error                        { return nil }
func (h *fakeHost) Getenv(name string) string         { return os.Getenv(name) }
func (h *fakeHost) BaselineIntact() error             { return nil }
func (h *fakeHost) BaselineFailing() bool             { return false }
func (h *fakeHost) ComparisonLines() []string         { return nil }
func (h *fakeHost) DiagnosticMessages() []any         { return nil }
func (h *fakeHost) BaselineMessage(verify.Pass) []any { return nil }
func (h *fakeHost) ValidateWorkingContext() error     { return nil }
func (h *fakeHost) OnDemand() bool                    { return false }
func (h *fakeHost) Tree() (string, error)             { return h.tree, nil }
func (h *fakeHost) InStart(path string) bool          { return path == "deleted.txt" }
func (h *fakeHost) Invalid(end *core.InvalidEnd)      { h.invalid = end }

func (h *fakeHost) Changed(from, to string) ([]string, error) { return []string{"app.txt"}, nil }

func (h *fakeHost) Diff(from, to string, paths []string) (string, error) {
	return "fixture diff of " + strings.Join(paths, ", "), nil
}

func (h *fakeHost) TreeDrift(observed, green string) string {
	return "the tree is " + observed + ", not " + green
}

func (h *fakeHost) PassFeedback(pass verify.Pass, completion string) string {
	return "fixture feedback of pass " + itoa(pass.N) + "; call " + completion
}

func (h *fakeHost) Verify(context.Context) (verify.Pass, error) {
	if len(h.verifies) == 0 {
		h.t.Fatal("Verify was not expected")
	}
	p := h.verifies[0]
	h.verifies = h.verifies[1:]
	return p, nil
}

func (h *fakeHost) NativeTools(enabled []string) *tools.Tools {
	return &tools.Tools{Root: h.state.Root, Enabled: enabled}
}

func (h *fakeHost) ToolRecord(tools.Call, tools.Output) map[string]any { return nil }

func (h *fakeHost) Material(verify.Pass) (core.MaterialSet, error) { return h.material, nil }

func (h *fakeHost) MaterialPrepare(tree string, m core.MaterialSet, role project.Role, instructions string, defs, diagnostic []any, force bool) ([]any, error) {
	return []any{map[string]any{"role": "user", "content": m.Authority + "\n" + m.Source}}, nil
}

func (h *fakeHost) MaterialUnread([]any) ([]string, error)         { return h.unread, nil }
func (h *fakeHost) MaterialRequiredUnread([]any) ([]string, error) { return h.unread, nil }
func (h *fakeHost) MaterialEvent([]any) error                      { h.materials++; return nil }

func (h *fakeHost) PrefillSource(role project.Role, instructions string, defs, input []any) ([]any, error) {
	return input, nil
}

func (h *fakeHost) Request(ctx context.Context, sp core.RequestSpec) (*provider.Response, []any, error) {
	h.requests = append(h.requests, sp)
	if len(h.answers) == 0 {
		h.t.Fatal("no scripted answer left for a model request")
	}
	resp := h.answers[0]
	h.answers = h.answers[1:]
	return resp, sp.Input, nil
}

func (h *fakeHost) GuardedRound(ctx context.Context, sess executor.Session, in executor.Input) (executor.RoundResult, error) {
	return sess.Round(ctx, in)
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

// events are the run log's events, decoded.
func events(t *testing.T, b *core.Attempt) []map[string]any {
	t.Helper()
	data, err := os.ReadFile(b.Run.LogPath)
	if err != nil {
		t.Fatal(err)
	}
	var out []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		var e map[string]any
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			t.Fatal(err)
		}
		out = append(out, e)
	}
	return out
}

// eventsNamed are the run log's events of one kind.
func eventsNamed(t *testing.T, b *core.Attempt, name string) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, e := range events(t, b) {
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
