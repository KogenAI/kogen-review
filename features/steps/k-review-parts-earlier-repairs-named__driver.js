// The review driver of Intent k-review-parts-earlier-repairs-named: the Go source of a program
// that the steps (k-review-parts-earlier-repairs-named__steps.js) build in a copy of a tree of
// this repository. It runs one external review (review.NewExternal over a scripted executor) of
// the saved candidate of a Git checkout and records what every session was sent.
//
// Its environment: PARTS_ROOT (the checkout), PARTS_START (the commit the candidate was built
// on), PARTS_PLAN (a JSON file: the scripted review, see plan) and PARTS_OUT (an empty folder).
// It writes PARTS_OUT/observation.json ({verdict, stop, lines, sessions, run}: run is the run
// folder, whose executor-review folder holds the review material evidence) and, for the i-th
// session started (1-based), PARTS_OUT/stable-<i>.txt and PARTS_OUT/dynamic-<i>.txt: the exact
// stable and dynamic text of the brief that session was started with. Kogen's verifications of
// the candidate are always green. The driver uses only review's public API that exists before
// the Intent, so it builds on the tree before it too. The source has no backquote, so it is a
// raw template here.
module.exports = String.raw`// Command partsdriver runs a scripted external review of a saved candidate once and records
// the brief every session was started with (Intent k-review-parts-earlier-repairs-named).
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-loop/sys"
	"github.com/KogenAI/kogen-loop/tools"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
)

func main() {
	sys.MaybeSupervise(os.Args[1:])
	sys.EnableSupervisor()
	if err := drive(); err != nil {
		fmt.Fprintln(os.Stderr, "partsdriver: "+err.Error())
		os.Exit(1)
	}
}

// round is one scripted executor round: the files the reviewer writes in the checkout before it
// answers (path relative to the checkout: content) and its structured verdict.
type round struct {
	Write   map[string]string
	Verdict json.RawMessage
}

// plan is the scripted review: Parts[i] are the rounds of the (i+1)-th session started, in
// order; a session without an entry approves in its first round without writing anything.
type plan struct {
	Parts [][]round
}

// env is the review's Env over the checkout: every verification is green on the checkout's
// current files.
type env struct {
	repo     *git.Repo
	start    string
	dir      string
	verified int
}

func (e *env) Request(context.Context, review.Request) (*provider.Response, []any, error) {
	return nil, nil, fmt.Errorf("the external review made a native model request")
}

func (e *env) Prepare(tree string, m review.MaterialSet, role project.Role, instructions string, defs, diagnostic []any) ([]any, error) {
	return nil, fmt.Errorf("the external review prepared a native conversation")
}

func (e *env) Unread([]any) ([]string, error) { return nil, nil }
func (e *env) Delivered([]any) error          { return nil }
func (e *env) Custody() error                 { return nil }
func (e *env) Prefill(_ project.Role, _ string, _, input []any) ([]any, error) {
	return input, nil
}

func (e *env) Verify(context.Context) (verify.Pass, error) {
	e.verified++
	tree, err := e.repo.Tree(e.start, nil)
	if err != nil {
		return verify.Pass{}, err
	}
	return verify.Pass{N: 1 + e.verified, Clean: true, Green: true, Tree: tree, Model: verify.ModelNone}, nil
}

func (e *env) Feedback(verify.Pass, string) string    { return "" }
func (e *env) BaselineIntact() error                  { return nil }
func (e *env) Comparison() []string                   { return nil }
func (e *env) Save(review.Checkpoint) error           { return nil }
func (e *env) Boundary([]any, *review.Done) error     { return nil }
func (e *env) Reviewed(core.ReviewRecord) error       { return nil }
func (e *env) Repaired() error                        { return nil }
func (e *env) Executor(*core.ExecutorState)           {}
func (e *env) Track() error                           { return nil }
func (e *env) Facts(string) error                     { return nil }
func (e *env) Progress(line string)                   { fmt.Fprintln(os.Stderr, line) }
func (e *env) Event(map[string]any)                   {}
func (e *env) Err() error                             { return nil }
func (e *env) Write(name string, data any) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(e.dir, name), b, 0o600)
}

var _ review.Env = (*env)(nil)

// xexec is the external reviewer's executor: the i-th session started records its brief and
// plays the plan's rounds for it.
type xexec struct {
	p      plan
	out    string
	starts int
}

func (x *xexec) Describe() executor.Descriptor { return descriptor() }

func (x *xexec) Start(ctx context.Context, task executor.Task, emit executor.Sink) (executor.Session, error) {
	x.starts++
	n := x.starts
	if err := os.WriteFile(filepath.Join(x.out, fmt.Sprintf("stable-%d.txt", n)), []byte(task.Brief.Stable), 0o600); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(x.out, fmt.Sprintf("dynamic-%d.txt", n)), []byte(task.Brief.Dynamic), 0o600); err != nil {
		return nil, err
	}
	rounds := []round{{Verdict: json.RawMessage("{\"verdict\":\"approve\",\"findings\":[]}")}}
	if n <= len(x.p.Parts) {
		rounds = x.p.Parts[n-1]
	}
	return &xsession{id: fmt.Sprintf("review-session-%d", n), root: task.Root, rounds: rounds}, nil
}

type xsession struct {
	id     string
	root   string
	rounds []round
	played int
}

func (s *xsession) Handle() executor.Handle {
	return executor.Handle{Role: executor.RoleReview, Executor: "fixture-executor", Version: "1.0.0", SessionID: s.id}
}

func (s *xsession) Close() error { return nil }

func (s *xsession) Round(ctx context.Context, in executor.Input) (executor.RoundResult, error) {
	if s.played >= len(s.rounds) {
		return executor.RoundResult{}, fmt.Errorf("the scripted session %s has no round %d", s.id, s.played+1)
	}
	r := s.rounds[s.played]
	s.played++
	for rel, content := range r.Write {
		file := filepath.Join(s.root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			return executor.RoundResult{}, err
		}
		if err := os.WriteFile(file, []byte(content), 0o644); err != nil {
			return executor.RoundResult{}, err
		}
	}
	return executor.RoundResult{
		Ending: executor.EndFinish, Structured: r.Verdict, Handle: s.Handle(),
		Usage: executor.Usage{Input: core.Count(0), Cached: core.Count(0), Output: core.Count(0), Reasoning: core.Count(0), State: executor.UsageComplete},
	}, nil
}

func descriptor() executor.Descriptor {
	return executor.Descriptor{Name: "fixture-executor", Contract: "1", Version: "1.0.0",
		RoleCapabilities: map[string]executor.RoleCapabilities{executor.RoleReview: {}}}
}

func drive() error {
	root, start, out := os.Getenv("PARTS_ROOT"), os.Getenv("PARTS_START"), os.Getenv("PARTS_OUT")
	raw, err := os.ReadFile(os.Getenv("PARTS_PLAN"))
	if err != nil {
		return err
	}
	var p plan
	if err := json.Unmarshal(raw, &p); err != nil {
		return fmt.Errorf("the plan is not a JSON object of the driver's plan: %v", err)
	}
	text, err := os.ReadFile(filepath.Join(root, project.IntentDir("fixture"), "intent.md"))
	if err != nil {
		return err
	}
	repo := git.New(root, nil)
	commit, err := repo.Resolve(start + "^{commit}")
	if err != nil {
		return err
	}
	tree, err := repo.Tree(commit, nil)
	if err != nil {
		return err
	}
	dir, err := os.MkdirTemp("", "parts-driver-run-")
	if err != nil {
		return err
	}
	s := sys.New()
	s.Stdout = os.Stderr
	e := &env{repo: repo, start: commit, dir: dir}
	in := review.Input{
		Candidate: review.Candidate{Root: root, Repo: repo, Start: commit, Tree: tree},
		Intent: review.Intent{Slug: "fixture", Text: string(text), Approval: text,
			Role: project.Role{Provider: "openai-compatible", Model: "scripted", Effort: "medium"}},
		Evidence: review.Evidence{Pass: verify.Pass{N: 1, Clean: true, Green: true, Tree: tree, Model: verify.ModelNone}},
		Tools: review.Tools{
			Native: func(enabled []string) *tools.Tools { return &tools.Tools{Root: root, Session: s, Enabled: enabled} },
			Record: func(tools.Call, tools.Output) map[string]any { return nil },
			Round: func(ctx context.Context, sess executor.Session, in executor.Input) (executor.RoundResult, error) {
				return sess.Round(ctx, in)
			},
			Home: s.Getenv("HOME"),
		},
		Number: 1,
		Run:    review.Run{ID: "parts-driver", Dir: dir},
	}
	x := &xexec{p: p, out: out}
	res, rerr := review.NewExternal(x, descriptor(), 4).Review(s.Context(), in, e)
	verdict, stop, lines := res.Record.Verdict, "", []string{}
	if rerr != nil {
		verdict, stop = "error", "error/"+rerr.Error()
		if se, ok := sys.AsError(rerr); ok {
			stop, lines = se.Class+"/"+se.Reason, core.NonNil(se.Lines)
		}
	}
	b, err := json.Marshal(map[string]any{"verdict": verdict, "stop": stop, "lines": lines, "sessions": x.starts, "run": dir})
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(out, "observation.json"), b, 0o600)
}
`;
