package contract

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	gitpkg "github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-coordinator/route"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
	"kogen-loop/provider"
	"kogen-loop/sys"
	"kogen-loop/tools"
)

// The saved-candidate harness: a review of a candidate saved as a Git commit and a version 4
// checkpoint in its run folder, scored without any Build. The review's Input and Env come from
// the saved state read back from disk. Its Env is the harness's own (savedEnv): the candidate's
// trees come from Git, the model's answers are scripted, a repair would be verified by a plain
// green pass of the tree, and the review's records go into the run folder. Nothing of kogen-build
// is involved: no Build attempt, no Build state type, no import.

// savedEnv is the Env of a review of a saved candidate in a Git checkout.
type savedEnv struct {
	t          *testing.T
	root, dir  string
	answers    []*provider.Response
	requests   []review.Request
	checkpoint *review.Checkpoint
	last       *core.ReviewRecord
	events     []map[string]any
}

func git(t *testing.T, dir string, env []string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false"}, args...)...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), env...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

// tree is the tree of the checkout's files as they are now (through a private index).
func (e *savedEnv) tree() (string, error) {
	index := []string{"GIT_INDEX_FILE=" + filepath.Join(e.t.TempDir(), "index")}
	git(e.t, e.root, index, "read-tree", "HEAD")
	git(e.t, e.root, index, "add", "-A")
	return git(e.t, e.root, index, "write-tree"), nil
}

func (e *savedEnv) Prepare(tree string, m review.MaterialSet, role project.Role, instructions string, defs, diagnostic []any) ([]any, error) {
	return append([]any{map[string]any{"role": "user", "content": m.Authority}}, append(diagnostic,
		map[string]any{"role": "user", "content": m.Source})...), nil
}

func (e *savedEnv) Unread([]any) ([]string, error) { return nil, nil }
func (e *savedEnv) Delivered([]any) error          { return nil }
func (e *savedEnv) Custody() error                 { return nil }
func (e *savedEnv) Prefill(_ project.Role, _ string, _, input []any) ([]any, error) {
	return input, nil
}

func (e *savedEnv) Request(_ context.Context, r review.Request) (*provider.Response, []any, error) {
	e.requests = append(e.requests, r)
	resp := e.answers[0]
	e.answers = e.answers[1:]
	return resp, r.Input, nil
}

// Verify is the harness's verification of a repaired tree: a green pass of it.
func (e *savedEnv) Verify(context.Context) (verify.Pass, error) {
	tree, _ := e.tree()
	return verify.Pass{N: 2, Clean: true, Green: true, Tree: tree}, nil
}

func (e *savedEnv) Feedback(verify.Pass, string) string { return "" }
func (e *savedEnv) BaselineIntact() error               { return nil }
func (e *savedEnv) Comparison() []string                { return nil }

func (e *savedEnv) Save(c review.Checkpoint) error     { e.checkpoint = &c; return nil }
func (e *savedEnv) Boundary([]any, *review.Done) error { return nil }
func (e *savedEnv) Reviewed(r core.ReviewRecord) error { e.last = &r; return nil }
func (e *savedEnv) Repaired() error                    { return nil }
func (e *savedEnv) Executor(*core.ExecutorState)       {}
func (e *savedEnv) Track() error                       { return nil }
func (e *savedEnv) Facts(string) error                 { return nil }
func (e *savedEnv) Progress(string)                    {}
func (e *savedEnv) Event(ev map[string]any)            { e.events = append(e.events, ev) }
func (e *savedEnv) Err() error                         { return nil }
func (e *savedEnv) Write(name string, data any) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(e.dir, name), b, 0o600)
}

// savedEnvelope is a version 4 checkpoint as kogen-build writes it to a run folder: the test
// declares the envelope itself (it does not import kogen-build) and keeps the state raw, to be
// decoded into the executor's core.State.
type savedEnvelope struct {
	Version   int             `json:"version"`
	Identity  string          `json:"identity"`
	Candidate string          `json:"candidate"`
	Index     string          `json:"index"`
	Approval  string          `json:"approval"`
	State     json.RawMessage `json:"state"`
	Recovery  json.RawMessage `json:"recovery_raw"`
}

const savedIntent = "# Greet the world\n\nThe greeting says hello, world.\n"

// writeSavedCandidate creates the saved candidate in a new checkout: a start commit (the ignore
// rule that keeps the run folder out of the candidate's tree, the approved Intent and the
// greeting), the candidate commit that changes the greeting, and the version 4 checkpoint an
// earlier Build left in the run folder. It returns the checkpoint's path.
func writeSavedCandidate(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	git(t, root, nil, "init", "-q", "-b", "main")
	writeFile(t, filepath.Join(root, ".gitignore"), ".kogen/local/\n")
	writeFile(t, filepath.Join(root, ".kogen/intents/fixture/intent.md"), savedIntent)
	writeFile(t, filepath.Join(root, "greeting.txt"), "hello\n")
	writeFile(t, filepath.Join(root, project.FeaturePath("fixture")), "Feature: Greeting\n  Scenario: The greeting\n    Then it says hello, world\n")
	git(t, root, nil, "add", "-A")
	git(t, root, nil, "commit", "-q", "-m", "start")
	start := git(t, root, nil, "rev-parse", "HEAD")
	startTree := git(t, root, nil, "rev-parse", "HEAD^{tree}")
	writeFile(t, filepath.Join(root, "greeting.txt"), "hello, world\n")
	git(t, root, nil, "commit", "-q", "-am", "saved candidate")
	tree := git(t, root, nil, "rev-parse", "HEAD^{tree}")

	dir := filepath.Join(root, ".kogen/local/runs/a1b2c3d4")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	green := verify.Pass{N: 1, Clean: true, Green: true, Tree: tree}
	session, err := review.Session{
		Role:     reviewRole,
		Attempts: []review.Submitted{{Pass: 1, Tree: tree, Verdict: "approve"}},
		Verdict:  &review.Verdict{Verdict: "approve"},
		Tree:     tree,
	}.Encode()
	if err != nil {
		t.Fatal(err)
	}
	intent := []byte(savedIntent)
	state := core.State{
		Root:       root,
		Slug:       "fixture",
		Config:     &project.Config{Models: map[string]project.Role{"review": reviewRole}},
		IntentText: savedIntent,
		Start:      start,
		StartTree:  startTree,
		Baseline:   []string{".kogen/project.yaml"},
		BaselineDigests: map[string]string{
			".kogen/project.yaml": "0000000000000000000000000000000000000000000000000000000000000000",
		},
		Excluded:     []string{},
		Run:          &core.Run{ID: "a1b2c3d4", Dir: dir, LogPath: filepath.Join(dir, "log.jsonl")},
		GitIndex:     filepath.Join(root, ".git/kogen-index"),
		Phase:        "building",
		Usage:        core.ZeroTokens(),
		AttemptUsage: core.ZeroTokens(),
		Round:        1,
		Pass:         1,
		Review:       1,
		LastPass:     &green,
		LastReview:   &core.ReviewRecord{N: 1, Verdict: "approve", Findings: []map[string]any{}, Tree: tree},
		Continuation: core.Continuation{
			Stage:  route.StageReviewVerify,
			Pass:   &green,
			Base:   &green,
			Review: session,
		},
		ApprovalBytes: base64.StdEncoding.EncodeToString(intent),
	}
	rawState, err := core.EncodeJSON(state)
	if err != nil {
		t.Fatal(err)
	}
	data, err := core.EncodeJSON(savedEnvelope{
		Version:   4,
		Identity:  "fixture",
		Candidate: tree,
		Index:     base64.StdEncoding.EncodeToString([]byte("index")),
		Approval:  base64.StdEncoding.EncodeToString(intent),
		State:     rawState,
		Recovery:  json.RawMessage("null"),
	})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "checkpoint.json")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// savedCandidate loads the saved candidate from the checkpoint in its run folder and returns the
// review Input and the Env built from the loaded state only, the checkpoint the state's
// continuation holds, and the candidate's tree. The Input has no checkpoint.
func savedCandidate(t *testing.T) (review.Input, *savedEnv, review.Checkpoint, string) {
	t.Helper()
	data, err := os.ReadFile(writeSavedCandidate(t))
	if err != nil {
		t.Fatal(err)
	}
	var env savedEnvelope
	if err := json.Unmarshal(data, &env); err != nil {
		t.Fatal(err)
	}
	var state core.State
	if err := json.Unmarshal(env.State, &state); err != nil {
		t.Fatal(err)
	}
	tree := env.Candidate
	eq(t, "saved-candidate version", env.Version, 4)
	eq(t, "saved-candidate candidate", tree, git(t, state.Root, nil, "rev-parse", "HEAD^{tree}"))
	eq(t, "saved-candidate last pass tree", state.LastPass.Tree, tree)
	eq(t, "saved-candidate continuation pass tree", state.Continuation.Pass.Tree, tree)
	saved, err := review.DecodeSession(state.Continuation.Review)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "saved-candidate session tree", saved.Tree, tree)
	approval, err := base64.StdEncoding.DecodeString(state.ApprovalBytes)
	if err != nil {
		t.Fatal(err)
	}

	envr := &savedEnv{t: t, root: state.Root, dir: state.Run.Dir}
	s := sys.NewWith(os.Environ(), state.Root)
	in := review.Input{
		Candidate: review.Candidate{Root: state.Root, Repo: gitpkg.New(state.Root, nil), Start: state.Start, Tree: tree},
		Intent:    review.Intent{Slug: state.Slug, Text: state.IntentText, Approval: approval, Role: state.Config.Models["review"]},
		Evidence: review.Evidence{Pass: *state.LastPass,
			Commands: review.Commands{Checks: []project.Check{{Name: "unit", Run: "make unit"}}}},
		Tools: review.Tools{
			Native: func(enabled []string) *tools.Tools {
				return &tools.Tools{Root: state.Root, Session: s, Enabled: enabled}
			},
			Record: func(tools.Call, tools.Output) map[string]any { return nil },
			Round: func(ctx context.Context, sess executor.Session, in executor.Input) (executor.RoundResult, error) {
				return sess.Round(ctx, in)
			},
		},
		Number: state.Review,
		Run:    review.Run{ID: state.Run.ID, Dir: state.Run.Dir},
	}
	cont := state.Continuation
	return in, envr, review.Checkpoint{Stage: cont.Stage, Pass: cont.Pass, Base: cont.Base, Session: cont.Review}, tree
}

// readFile is a model answer calling read_file on path.
func readFile(path string) *provider.Response {
	return &provider.Response{Items: []map[string]any{{
		"type": "function_call", "call_id": "call-read", "name": "read_file", "arguments": `{"path":"` + path + `"}`,
	}}, Usage: provider.Usage{Input: 10, Output: 2}}
}

// TestReviewOfASavedCandidateWithoutABuild runs the native Review on a candidate saved as a Git
// commit and its saved state, with no Build attempt at all: the review makes its material from its
// Input (the exact approved Intent and its feature, the configured commands and the candidate's
// diff), reads the candidate's file with its permitted tool and approves. The Result is the
// verdict, the findings and no repairs on the green pass of the saved tree; the continuation of
// the saved state read from disk resumes the same review without a new request (item
// saved-candidate).
func TestReviewOfASavedCandidateWithoutABuild(t *testing.T) {
	t.Parallel()
	in, env, saved, tree := savedCandidate(t)
	env.answers = []*provider.Response{
		readFile("greeting.txt"),
		submitReview(`{"verdict":"approve","findings":[{"path":"greeting.txt","line":1,"severity":"note","message":"says hello, world"}]}`),
	}
	res, err := review.Independent{}.Review(context.Background(), in, env)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "saved-candidate verdict", res.Record.Verdict, "approve")
	eq(t, "saved-candidate findings", len(res.Record.Findings), 1)
	eq(t, "saved-candidate finding", res.Record.Findings[0]["message"], any("says hello, world"))
	eq(t, "saved-candidate tree", res.Record.Tree, in.Candidate.Tree)
	eq(t, "saved-candidate pass", res.Pass.Tree, in.Candidate.Tree)
	eq(t, "saved-candidate repairs", res.Repairs, 0)
	eq(t, "saved-candidate requests", len(env.requests), 2)

	first, _ := json.Marshal(env.requests[0].Input)
	// The review made its material from the Input alone: the Intent, its feature, the configured
	// check and the candidate's diff against the saved start commit.
	for _, want := range []string{"# Intent\\n\\n# Greet the world", "# acceptance.feature\\n\\nFeature: Greeting", "Project checks: unit: make unit.",
		"# Diff of existing/deleted paths against start HEAD " + in.Candidate.Start[:8], "+hello, world"} {
		if !strings.Contains(string(first), want) {
			t.Errorf("saved-candidate: the first request lacks %q: %s", want, first)
		}
	}
	second, _ := json.Marshal(env.requests[1].Input)
	if !strings.Contains(string(second), `1\thello, world`) {
		t.Errorf("saved-candidate: the read_file result did not reach the reviewer: %s", second)
	}
	if _, err := os.Stat(filepath.Join(env.dir, review.File(1))); err != nil {
		t.Errorf("saved-candidate: no review record: %v", err)
	}

	// The review saved its review_verify checkpoint; a resume from the saved state's
	// continuation judges its approval again, with no new request and still no Build.
	if env.checkpoint == nil || env.checkpoint.Stage != route.StageReviewVerify {
		t.Fatalf("saved-candidate checkpoint: %+v", env.checkpoint)
	}
	in.Checkpoint = &saved
	again, err := review.Independent{}.Resume(context.Background(), in, env)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "saved-candidate resumed verdict", again.Record.Verdict, "approve")
	eq(t, "saved-candidate resumed tree", again.Record.Tree, tree)
	eq(t, "saved-candidate resumed pass", again.Pass.Tree, tree)
	eq(t, "saved-candidate resumed requests", len(env.requests), 2)
}
