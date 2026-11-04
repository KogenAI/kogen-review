// The review driver of Intent k-review-cost-and-effect-record: the Go source of a program that
// the steps (k-review-cost-and-effect-record__steps.js) build in a copy of this checkout. It runs
// one scripted review of the saved candidate of a Git checkout (the native reviewer,
// review.Independent, or the external one, review.NewExternal, over a scripted executor) and
// writes what the review observed as one JSON object.
//
// Its environment: COST_ROOT (the checkout), COST_START (the commit the candidate was built on),
// COST_SLUG (the approved Intent), COST_PLAN (a JSON file: the scripted review, see plan) and
// COST_OUT (the observation file). The review is given a green pass of the candidate that
// records acceptance not_run. The driver sets review.Input.Attempt and reads
// review.Result.Account by reflection, by the names and JSON keys the Intent specifies, so it
// builds on a tree without them and reports their absence in the observation. The source has
// no backquote, so it is a raw template here.
module.exports = String.raw`// Command costdriver runs a scripted review of a saved candidate once (the native reviewer,
// review.Independent, or the external one, review.NewExternal) and writes what the review
// observed (Intent k-review-cost-and-effect-record).
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"time"

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
		fmt.Fprintln(os.Stderr, "costdriver: "+err.Error())
		os.Exit(1)
	}
}

// plan is the scripted review: the reviewer (native or external); the usage every model call
// reports (input, cached, output) and the milliseconds it takes (Delay); the native answers, one
// per model request (a list of tool calls {name, args}, or {"error": text}: the request fails);
// the external rounds, one structured verdict text per round; the results of Kogen's
// verifications of the candidate in order (green or red); Gap, the milliseconds Kogen takes for
// each pending review record (between the parts of a review in parts); Resume: after a blocked
// stop, the driver waits Pause milliseconds and resumes the review from its latest checkpoint;
// Attempt, review.Input.Attempt by the Intent's JSON names (null: not set); Prior, the usage the
// reviewer's executor state in the Build already holds (null: none).
type plan struct {
	Reviewer string
	Usage    map[string]int
	Delay    int
	Answers  []json.RawMessage
	Rounds   []string
	Verify   []string
	Gap      int
	Resume   bool
	Pause    int
	Attempt  json.RawMessage
	Prior    map[string]int
}

// env is the review's Env over the checkout: the scripted model and verifications and a run
// folder; it keeps the latest checkpoint and the run log's events.
type env struct {
	p        plan
	repo     *git.Repo
	start    string
	dir      string
	answers  []json.RawMessage
	requests int
	verified int
	saved    *review.Checkpoint
	events   []map[string]any
}

func (e *env) Request(ctx context.Context, r review.Request) (*provider.Response, []any, error) {
	e.requests++
	time.Sleep(time.Duration(e.p.Delay) * time.Millisecond)
	if len(e.answers) == 0 {
		return nil, nil, fmt.Errorf("the scripted reviewer has no answer for request %d", e.requests)
	}
	raw := e.answers[0]
	e.answers = e.answers[1:]
	var failure struct{ Error string }
	if json.Unmarshal(raw, &failure) == nil && failure.Error != "" {
		return nil, nil, sys.Fail("provider", "scripted_failure", failure.Error, 1)
	}
	var calls []struct {
		Name string
		Args map[string]any
	}
	if err := json.Unmarshal(raw, &calls); err != nil {
		return nil, nil, fmt.Errorf("answer %d is neither a list of tool calls nor an error: %v", e.requests, err)
	}
	var items []map[string]any
	for i, c := range calls {
		args, err := json.Marshal(c.Args)
		if err != nil {
			return nil, nil, err
		}
		items = append(items, map[string]any{"type": "function_call", "call_id": fmt.Sprintf("call-%d-%d", e.requests, i+1), "name": c.Name, "arguments": string(args)})
	}
	u := e.p.Usage
	return &provider.Response{Items: items, Usage: provider.Usage{Input: u["input"], Cached: u["cached"], Output: u["output"]}}, r.Input, nil
}

func (e *env) Prepare(tree string, m review.MaterialSet, role project.Role, instructions string, defs, diagnostic []any) ([]any, error) {
	input := []any{map[string]any{"role": "user", "content": m.Authority}}
	input = append(input, diagnostic...)
	return append(input, map[string]any{"role": "user", "content": m.Source}), nil
}

func (e *env) Unread([]any) ([]string, error) { return nil, nil }
func (e *env) Delivered([]any) error          { return nil }
func (e *env) Custody() error                 { return nil }
func (e *env) Prefill(_ project.Role, _ string, _, input []any) ([]any, error) {
	return input, nil
}

// Verify is the next scripted verification of the checkout's current files.
func (e *env) Verify(context.Context) (verify.Pass, error) {
	e.verified++
	if e.verified > len(e.p.Verify) {
		return verify.Pass{}, fmt.Errorf("the scripted verifications have no result for verification %d", e.verified)
	}
	tree, err := e.repo.Tree(e.start, nil)
	if err != nil {
		return verify.Pass{}, err
	}
	p := verify.Pass{N: 1 + e.verified, Clean: true, Green: e.p.Verify[e.verified-1] == "green", Tree: tree, Model: verify.ModelNone}
	if !p.Green {
		p.Failing = []string{"check:fixture"}
	}
	return p, nil
}

func (e *env) Feedback(verify.Pass, string) string { return "check fixture failed" }
func (e *env) BaselineIntact() error               { return nil }
func (e *env) Comparison() []string                { return nil }

func (e *env) Save(c review.Checkpoint) error {
	c.Session = append(json.RawMessage(nil), c.Session...)
	e.saved = &c
	return nil
}

func (e *env) Boundary([]any, *review.Done) error { return nil }

func (e *env) Reviewed(r core.ReviewRecord) error {
	if r.Verdict == "pending" {
		time.Sleep(time.Duration(e.p.Gap) * time.Millisecond)
	}
	return nil
}

func (e *env) Repaired() error              { return nil }
func (e *env) Executor(*core.ExecutorState) {}
func (e *env) Track() error                 { return nil }
func (e *env) Facts(string) error           { return nil }
func (e *env) Progress(line string)         { fmt.Fprintln(os.Stderr, line) }
func (e *env) Event(event map[string]any)   { e.events = append(e.events, event) }
func (e *env) Err() error                   { return nil }

func (e *env) Write(name string, data any) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(e.dir, name), b, 0o600)
}

var _ review.Env = (*env)(nil)

// xexec is the external reviewer's executor: one session per Start, whose rounds return the
// scripted structured verdicts in order, each with the plan's usage after the plan's delay.
type xexec struct {
	p      plan
	starts int
	rounds int
}

func (x *xexec) Describe() executor.Descriptor { return descriptor() }

func (x *xexec) Start(ctx context.Context, task executor.Task, emit executor.Sink) (executor.Session, error) {
	x.starts++
	return &xsession{x: x, id: fmt.Sprintf("review-session-%d", x.starts)}, nil
}

type xsession struct {
	x  *xexec
	id string
}

func (s *xsession) Handle() executor.Handle {
	return executor.Handle{Role: executor.RoleReview, Executor: "fixture-executor", Version: "1.0.0", SessionID: s.id}
}

func (s *xsession) Close() error { return nil }

func (s *xsession) Round(ctx context.Context, in executor.Input) (executor.RoundResult, error) {
	x := s.x
	x.rounds++
	time.Sleep(time.Duration(x.p.Delay) * time.Millisecond)
	if x.rounds > len(x.p.Rounds) {
		return executor.RoundResult{}, fmt.Errorf("the scripted executor has no result for round %d", x.rounds)
	}
	u := x.p.Usage
	return executor.RoundResult{
		Ending: executor.EndFinish, Structured: json.RawMessage(x.p.Rounds[x.rounds-1]), Handle: s.Handle(),
		Usage: executor.Usage{Input: core.Count(u["input"]), Cached: core.Count(u["cached"]), Output: core.Count(u["output"]), Reasoning: core.Count(0), State: executor.UsageComplete},
	}, nil
}

func descriptor() executor.Descriptor {
	return executor.Descriptor{Name: "fixture-executor", Contract: "1", Version: "1.0.0",
		RoleCapabilities: map[string]executor.RoleCapabilities{executor.RoleReview: {}}}
}

// field is the JSON of v's field name by reflection, or why v has none.
func field(v any, name string) (any, error) {
	f := reflect.ValueOf(v).FieldByName(name)
	if !f.IsValid() {
		return fmt.Sprintf("%T has no field %s", v, name), nil
	}
	b, err := json.Marshal(f.Interface())
	if err != nil {
		return nil, err
	}
	var out any
	return out, json.Unmarshal(b, &out)
}

// ending is a review's verdict (approve, changes, invalid or error), its stop ("class/reason"
// or "") and the stop's lines.
func ending(res review.Result, err error) (string, string, []string, error) {
	if err == nil {
		return res.Record.Verdict, "", []string{}, nil
	}
	se, ok := sys.AsError(err)
	if !ok {
		return "error", "error/" + err.Error(), []string{}, nil
	}
	stop := se.Class + "/" + se.Reason
	verdict := "error"
	switch {
	case stop == "candidate/review_blocked":
		verdict = "changes"
	case stop == "candidate/review_invalid":
		verdict = "invalid"
	}
	return verdict, stop, core.NonNil(se.Lines), nil
}

func drive() error {
	root, start, slug := os.Getenv("COST_ROOT"), os.Getenv("COST_START"), os.Getenv("COST_SLUG")
	raw, err := os.ReadFile(os.Getenv("COST_PLAN"))
	if err != nil {
		return err
	}
	var p plan
	if err := json.Unmarshal(raw, &p); err != nil {
		return fmt.Errorf("the plan is not a JSON object of the driver's plan: %v", err)
	}
	text, err := os.ReadFile(filepath.Join(root, project.IntentDir(slug), "intent.md"))
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
	dir, err := os.MkdirTemp("", "cost-driver-run-")
	if err != nil {
		return err
	}
	s := sys.New()
	s.Stdout = os.Stderr
	e := &env{p: p, repo: repo, start: commit, dir: dir, answers: p.Answers}
	pass := verify.Pass{N: 1, Clean: true, Green: true, Tree: tree, Model: verify.ModelNone}
	in := review.Input{
		Candidate: review.Candidate{Root: root, Repo: repo, Start: commit, Tree: tree},
		Intent: review.Intent{Slug: slug, Text: string(text), Approval: text,
			Role: project.Role{Provider: "openai-compatible", Model: "scripted", Effort: "medium"}},
		Evidence: review.Evidence{Pass: pass},
		Tools: review.Tools{
			Native: func(enabled []string) *tools.Tools { return &tools.Tools{Root: root, Session: s, Enabled: enabled} },
			Record: func(tools.Call, tools.Output) map[string]any { return nil },
			Round: func(ctx context.Context, sess executor.Session, in executor.Input) (executor.RoundResult, error) {
				return sess.Round(ctx, in)
			},
			Home: s.Getenv("HOME"),
		},
		Number: 1,
		Run:    review.Run{ID: "cost-driver", Dir: dir},
	}
	if p.Prior != nil {
		in.Executor = &core.ExecutorState{Name: "fixture-executor", Version: "1.0.0", SessionID: "earlier-review-session", Rounds: 1,
			Usage: core.ExecutorUsage{Input: core.Count(p.Prior["input"]), Cached: core.Count(p.Prior["cached"]), Output: core.Count(p.Prior["output"]),
				Reasoning: core.Count(0), State: executor.UsageComplete, CostUSD: new(float64)}}
	}
	setup := ""
	if len(p.Attempt) > 0 && string(p.Attempt) != "null" {
		f := reflect.ValueOf(&in).Elem().FieldByName("Attempt")
		if !f.IsValid() {
			setup = "review.Input has no field Attempt"
		} else if err := json.Unmarshal(p.Attempt, f.Addr().Interface()); err != nil {
			setup = "review.Input.Attempt does not read the attempt's JSON: " + err.Error()
		}
	}
	var reviewer review.Reviewer = review.Independent{}
	x := &xexec{p: p}
	if p.Reviewer == "external" {
		reviewer = review.NewExternal(x, descriptor(), 4)
	}
	calls := []int64{}
	began := time.Now()
	res, rerr := reviewer.Review(s.Context(), in, e)
	calls = append(calls, time.Since(began).Milliseconds())
	verdict, stop, lines, err := ending(res, rerr)
	if err != nil {
		return err
	}
	first := map[string]any{"verdict": verdict, "stop": stop, "lines": lines}
	var resumed any
	if p.Resume && stop == "candidate/review_blocked" && e.saved != nil {
		var sess map[string]any
		if err := json.Unmarshal(e.saved.Session, &sess); err != nil {
			return err
		}
		resumed = map[string]any{"stage": e.saved.Stage, "wall_ms": sess["wall_ms"], "blockers": sess["blockers"]}
		time.Sleep(time.Duration(p.Pause) * time.Millisecond)
		again := in
		cp := *e.saved
		again.Checkpoint = &cp
		began = time.Now()
		res, rerr = review.Independent{}.Resume(s.Context(), again, e)
		calls = append(calls, time.Since(began).Milliseconds())
		if verdict, stop, lines, err = ending(res, rerr); err != nil {
			return err
		}
	}
	account, err := field(res, "Account")
	if err != nil {
		return err
	}
	parts := 0
	for _, ev := range e.events {
		if ev["event"] == "review_parts" {
			parts, _ = ev["parts"].(int)
		}
	}
	after, err := repo.Tree(commit, nil)
	if err != nil {
		return err
	}
	out, err := json.Marshal(map[string]any{
		"verdict": verdict, "stop": stop, "lines": lines, "repairs": res.Repairs, "account": account,
		"attempt_setup": setup, "calls_ms": calls, "first": first, "resumed": resumed, "parts": parts,
		"requests": e.requests, "rounds": x.rounds, "sessions": x.starts, "verifications": e.verified,
		"candidate_tree": tree, "tree_after": after,
	})
	if err != nil {
		return err
	}
	return os.WriteFile(os.Getenv("COST_OUT"), out, 0o600)
}
`;
