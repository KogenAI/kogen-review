package contract

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

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

// The saved-candidate harness: a review of a candidate saved as a Git commit, scored without any
// Build. Its Env is the harness's own (savedEnv): the candidate's trees come from Git, the model's
// answers are scripted, a repair would be verified by a plain green pass of the tree, and the
// review's checkpoints and records stay in the harness. Nothing of kogen-build is involved: no
// Build attempt, no Build state, no Build checkpoint.

// savedEnv is the Env of a review of a saved candidate in a Git checkout.
type savedEnv struct {
	t          *testing.T
	root, dir  string
	start      string
	intent     string
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

// Tree is the tree of the checkout's files as they are now (through a private index).
func (e *savedEnv) Tree() (string, error) {
	index := []string{"GIT_INDEX_FILE=" + filepath.Join(e.t.TempDir(), "index")}
	git(e.t, e.root, index, "read-tree", "HEAD")
	git(e.t, e.root, index, "add", "-A")
	return git(e.t, e.root, index, "write-tree"), nil
}

func (e *savedEnv) Changed(from, to string) ([]string, error) {
	return strings.Fields(git(e.t, e.root, nil, "diff", "--name-only", from, to)), nil
}

func (e *savedEnv) Diff(from, to string, paths []string) (string, error) {
	return git(e.t, e.root, nil, append([]string{"diff", from, to, "--"}, paths...)...), nil
}

func (e *savedEnv) InStart(path string) bool {
	return exec.Command("git", "-C", e.root, "cat-file", "-e", e.start+":"+path).Run() == nil
}

func (e *savedEnv) Drift(observed, green string) string { return observed + " is not " + green }

// Material is the saved candidate's review material: the approved Intent, and the diff and full
// text of every changed file.
func (e *savedEnv) Material(pass verify.Pass) (core.MaterialSet, error) {
	paths, _ := e.Changed(e.start, pass.Tree)
	diff, _ := e.Diff(e.start, pass.Tree, paths)
	source := "# Checks\n" + pass.Results() + "\n# Diff\n" + diff + "\n"
	var files []map[string]any
	for _, p := range paths {
		source += "--- " + p + "\n" + git(e.t, e.root, nil, "show", pass.Tree+":"+p) + "\n"
		files = append(files, map[string]any{"path": p, "status": "changed"})
	}
	return core.MaterialSet{Authority: "# Approved Intent\n" + e.intent, Source: source, Files: files}, nil
}

func (e *savedEnv) Blocks(string, core.MaterialSet) ([]core.MaterialSegment, error) { return nil, nil }

func (e *savedEnv) Prepare(tree string, m core.MaterialSet, role project.Role, instructions string, defs, diagnostic []any) ([]any, error) {
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
	tree, _ := e.Tree()
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

// savedCandidate is a Git checkout whose HEAD is a saved candidate commit on top of its start
// commit, and the review Input of that candidate: the exact approved Intent, the green pass of
// its tree, the permitted native tools of the checkout and no checkpoint.
func savedCandidate(t *testing.T) (review.Input, *savedEnv) {
	t.Helper()
	root := t.TempDir()
	git(t, root, nil, "init", "-q", "-b", "main")
	writeFile(t, filepath.Join(root, "greeting.txt"), "hello\n")
	git(t, root, nil, "add", "-A")
	git(t, root, nil, "commit", "-q", "-m", "start")
	start := git(t, root, nil, "rev-parse", "HEAD")
	writeFile(t, filepath.Join(root, "greeting.txt"), "hello, world\n")
	git(t, root, nil, "commit", "-q", "-am", "saved candidate")
	tree := git(t, root, nil, "rev-parse", "HEAD^{tree}")
	dir := t.TempDir()
	intent := "# Greet the world\n\nThe greeting says hello, world.\n"
	env := &savedEnv{t: t, root: root, dir: dir, start: start, intent: intent}
	s := sys.NewWith(os.Environ(), root)
	in := review.Input{
		Candidate: review.Candidate{Root: root, Start: start, Tree: tree},
		Intent:    review.Intent{Approval: []byte(intent), Role: reviewRole},
		Evidence:  review.Evidence{Pass: verify.Pass{N: 1, Clean: true, Green: true, Tree: tree}},
		Tools: review.Tools{
			Native: func(enabled []string) *tools.Tools { return &tools.Tools{Root: root, Session: s, Enabled: enabled} },
			Record: func(tools.Call, tools.Output) map[string]any { return nil },
			Round: func(ctx context.Context, sess executor.Session, in executor.Input) (executor.RoundResult, error) {
				return sess.Round(ctx, in)
			},
		},
		Number: 1,
		Run:    review.Run{ID: "saved-candidate", Dir: dir},
	}
	return in, env
}

// readFile is a model answer calling read_file on path.
func readFile(path string) *provider.Response {
	return &provider.Response{Items: []map[string]any{{
		"type": "function_call", "call_id": "call-read", "name": "read_file", "arguments": `{"path":"` + path + `"}`,
	}}, Usage: provider.Usage{Input: 10, Output: 2}}
}

// TestReviewOfASavedCandidateWithoutABuild runs the native Review on a candidate saved as a Git
// commit, with no Build attempt at all: the reviewer is given the exact approved Intent and the
// candidate's diff, reads the candidate's file with its permitted tool and approves. The Result
// is the verdict, the findings and no repairs on the green pass of the saved tree; the review's
// checkpoint, kept by the harness, resumes the same review without a new request (item
// saved-candidate).
func TestReviewOfASavedCandidateWithoutABuild(t *testing.T) {
	t.Parallel()
	in, env := savedCandidate(t)
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
	for _, want := range []string{"# Greet the world", "+hello, world"} {
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

	// The harness keeps the review's checkpoint; a resume judges its verdict again, with no
	// new request and still no Build.
	if env.checkpoint == nil || env.checkpoint.Stage != route.StageReviewVerify {
		t.Fatalf("saved-candidate checkpoint: %+v", env.checkpoint)
	}
	in.Checkpoint = env.checkpoint
	again, err := review.Independent{}.Resume(context.Background(), in, env)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "saved-candidate resumed verdict", again.Record.Verdict, "approve")
	eq(t, "saved-candidate resumed requests", len(env.requests), 2)
}
