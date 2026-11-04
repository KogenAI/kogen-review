// The review driver of Intent k-review-unrun-evidence-not-met: the Go source of a program that
// the steps (k-review-unrun-evidence-not-met__steps.js) build in a copy of this checkout. It runs
// the native reviewer (review.Independent) once on the saved candidate of a Git checkout with a
// scripted model and writes what the review observed as one JSON object.
//
// Its environment: UNRUN_ROOT (the checkout), UNRUN_START (the commit the candidate was built
// on), UNRUN_SLUG (the approved Intent), UNRUN_PASS (not_run: the review is given a green pass
// that records acceptance not_run; verified: Kogen's verification of the candidate, which must be
// complete), UNRUN_ANSWERS (a JSON file: one list of tool calls {name, args} per model request,
// in order) and UNRUN_OUT (the observation file). Env.Verify, the verification of the reviewer's
// edits, is Kogen's verification (verify.Verify) of the checkout, as a Build runs it. The source
// has no backquote, so it is a raw template here.
module.exports = String.raw`// Command unrundriver runs the native reviewer once on a saved candidate with a scripted model
// and writes what the review observed (Intent k-review-unrun-evidence-not-met).
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
		fmt.Fprintln(os.Stderr, "unrundriver: "+err.Error())
		os.Exit(1)
	}
}

// logger drops the verification's events.
type logger struct{}

func (logger) Log(map[string]any) {}

// env is the review's Env over the checkout: the scripted model, Kogen's verification of the
// reviewer's edits and a run folder; it records what the review asked.
type env struct {
	s        *sys.Session
	repo     *git.Repo
	start    string
	dir      string
	answers  [][]map[string]any
	verifyIn verify.Input
	run      string
	requests int
	last     []any
	verified []any
}

// view is what an observation keeps of a pass: whether it is green, whether its tree is the
// candidate's tree now, and its acceptance ("not_run" or each scenario's name and status).
func (e *env) view(p verify.Pass) map[string]any {
	now, err := e.repo.Tree(e.start, nil)
	v := map[string]any{"green": p.Green, "current": err == nil && now == p.Tree, "acceptance": "not_run"}
	if p.Acceptance != nil {
		scenarios := []any{}
		for _, s := range p.Acceptance.Scenarios {
			scenarios = append(scenarios, map[string]any{"name": s.Name, "status": s.Status})
		}
		v["acceptance"] = scenarios
	}
	return v
}

func (e *env) Request(ctx context.Context, r review.Request) (*provider.Response, []any, error) {
	e.requests++
	last := map[string]any{}
	if n := len(r.Input); n > 0 {
		if m, ok := r.Input[n-1].(map[string]any); ok {
			if m["type"] == "function_call_output" {
				last = map[string]any{"tool_result": m["output"]}
			} else {
				last = map[string]any{"role": m["role"], "content": m["content"]}
			}
		}
	}
	e.last = append(e.last, last)
	if len(e.answers) == 0 {
		return nil, nil, fmt.Errorf("the scripted reviewer has no answer for request %d", e.requests)
	}
	calls := e.answers[0]
	e.answers = e.answers[1:]
	var items []map[string]any
	for i, c := range calls {
		args, err := json.Marshal(c["args"])
		if err != nil {
			return nil, nil, err
		}
		items = append(items, map[string]any{"type": "function_call", "call_id": fmt.Sprintf("call-%d-%d", e.requests, i+1), "name": c["name"], "arguments": string(args)})
	}
	return &provider.Response{Items: items, Usage: provider.Usage{Input: 10, Output: 2}}, r.Input, nil
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

// Verify is Kogen's verification of the checkout's candidate (the reviewer's edits).
func (e *env) Verify(ctx context.Context) (verify.Pass, error) {
	in := e.verifyIn
	in.N = 2 + len(e.verified)
	p, err := verify.Verify(ctx, e.s, in)
	if err != nil {
		return p, err
	}
	e.verified = append(e.verified, e.view(p))
	return p, nil
}

func (e *env) Feedback(p verify.Pass, completion string) string { return p.Feedback(e.run, completion) }
func (e *env) BaselineIntact() error                            { return nil }
func (e *env) Comparison() []string                             { return nil }
func (e *env) Save(review.Checkpoint) error                     { return nil }
func (e *env) Boundary([]any, *review.Done) error               { return nil }
func (e *env) Reviewed(core.ReviewRecord) error                 { return nil }
func (e *env) Repaired() error                                  { return nil }
func (e *env) Executor(*core.ExecutorState)                     {}
func (e *env) Track() error                                     { return nil }
func (e *env) Facts(string) error                               { return nil }
func (e *env) Progress(line string)                             { fmt.Fprintln(os.Stderr, line) }
func (e *env) Event(map[string]any)                             {}
func (e *env) Err() error                                       { return nil }

func (e *env) Write(name string, data any) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(e.dir, name), b, 0o600)
}

var _ review.Env = (*env)(nil)

func drive() error {
	root, start, slug, mode := os.Getenv("UNRUN_ROOT"), os.Getenv("UNRUN_START"), os.Getenv("UNRUN_SLUG"), os.Getenv("UNRUN_PASS")
	raw, err := os.ReadFile(os.Getenv("UNRUN_ANSWERS"))
	if err != nil {
		return err
	}
	var answers [][]map[string]any
	if err := json.Unmarshal(raw, &answers); err != nil {
		return fmt.Errorf("the scripted answers are not a JSON list of tool-call lists: %v", err)
	}
	cfg, err := project.LoadConfig(root)
	if err != nil {
		return err
	}
	if cfg.Acceptance == nil {
		return fmt.Errorf("the fixture configures no acceptance command")
	}
	intent, err := project.LoadIntent(root, slug)
	if err != nil {
		return err
	}
	text, err := os.ReadFile(filepath.Join(root, project.IntentDir(slug), "intent.md"))
	if err != nil {
		return err
	}
	feature, err := os.ReadFile(filepath.Join(root, project.FeaturePath(slug)))
	if err != nil {
		return err
	}
	expected, err := project.ParseGherkin(string(feature))
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
	dir, err := os.MkdirTemp("", "unrun-driver-run-")
	if err != nil {
		return err
	}
	s := sys.New()
	s.Stdout = os.Stderr
	e := &env{s: s, repo: repo, start: commit, dir: dir, answers: answers, run: cfg.Acceptance.Run, last: []any{}, verified: []any{},
		verifyIn: verify.Input{Root: root, Repo: repo, Config: cfg, Intent: intent, Start: commit, RunDir: dir, Log: logger{},
			Tools: verify.Tools{Node: os.Getenv("KOGEN_NODE"), Quint: os.Getenv("KOGEN_QUINT"), Cucumber: os.Getenv("KOGEN_CUCUMBER")}}}
	var pass verify.Pass
	switch mode {
	case "not_run":
		pass = verify.Pass{N: 1, Clean: true, Green: true, Tree: tree, Model: verify.ModelNone}
	case "verified":
		in := e.verifyIn
		in.N = 1
		if pass, err = verify.Verify(s.Context(), s, in); err != nil {
			return err
		}
		if !pass.Complete(cfg, expected, intent.Model) || pass.Tree != tree {
			return fmt.Errorf("the fixture's verification of the candidate is not complete and green (a broken fixture, not a review result):\n%s", pass.Feedback(cfg.Acceptance.Run, ""))
		}
	default:
		return fmt.Errorf("UNRUN_PASS %q is neither not_run nor verified", mode)
	}
	initial := e.view(pass)
	in := review.Input{
		Candidate: review.Candidate{Root: root, Repo: repo, Start: commit, Tree: pass.Tree},
		Intent: review.Intent{Slug: slug, Text: string(text), Approval: text,
			Role: project.Role{Provider: "openai-compatible", Model: "scripted", Effort: "medium"}},
		Evidence: review.Evidence{Pass: pass, Commands: review.Commands{Fix: cfg.Fix, Checks: cfg.Checks, Acceptance: cfg.Acceptance.Run}},
		Tools: review.Tools{
			Native: func(enabled []string) *tools.Tools { return &tools.Tools{Root: root, Session: s, Enabled: enabled} },
			Record: func(tools.Call, tools.Output) map[string]any { return nil },
			Round: func(ctx context.Context, sess executor.Session, in executor.Input) (executor.RoundResult, error) {
				return sess.Round(ctx, in)
			},
			Home: s.Getenv("HOME"),
		},
		Number: 1,
		Run:    review.Run{ID: "unrun-driver", Dir: dir},
	}
	res, rerr := review.Independent{}.Review(s.Context(), in, e)
	verdict, stop, problems := res.Record.Verdict, "", []string{}
	if rerr != nil {
		se, ok := sys.AsError(rerr)
		if !ok {
			return rerr
		}
		stop = se.Class + "/" + se.Reason
		switch {
		case stop == "candidate/review_blocked":
			verdict = "changes"
		case stop == "candidate/review_invalid" && res.Invalid != nil:
			verdict, problems = "invalid", core.NonNil(res.Invalid.Problems)
		default:
			verdict = "error"
		}
	}
	var requirements any
	if b, err := os.ReadFile(filepath.Join(dir, review.File(1))); err == nil {
		var record map[string]any
		if err := json.Unmarshal(b, &record); err != nil {
			return err
		}
		requirements = record["requirements"]
	}
	out, err := json.Marshal(map[string]any{
		"requests": e.requests, "last_inputs": e.last, "verdict": verdict, "stop": stop, "problems": problems,
		"requirements": requirements, "initial": initial, "verifications": e.verified,
	})
	if err != nil {
		return err
	}
	return os.WriteFile(os.Getenv("UNRUN_OUT"), out, 0o600)
}
`;
