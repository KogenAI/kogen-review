// The review driver of Intent review-focus-check-before-evidence-only-stop: the Go source of a
// program that the steps (review-focus-check-before-evidence-only-stop__steps.js) build in a copy
// of this checkout. It runs the native reviewer (review.Independent) once on the saved candidate
// of a Git checkout with a scripted model, optionally interrupts it before a request and resumes
// it from its last checkpoint, and writes what the review observed as one JSON object.
//
// Its environment: FOCUS_ROOT (the checkout), FOCUS_START (the commit the candidate was built
// on), FOCUS_SLUG (the approved Intent), FOCUS_ANSWERS (a JSON file: one list of tool calls
// {name, args} per model request, in order), FOCUS_OUT (the observation file), FOCUS_RESTRICTION
// (optional: the name of an execution restriction that reports refusing every shell command that
// names grant.sh) and FOCUS_INTERRUPT (optional: the number of a request that is interrupted
// before it is sent, after which the review resumes from the last saved checkpoint). The review
// is given a green pass of the candidate that records acceptance not run; Env.Verify answers a
// green pass of the checkout's current tree. The source has no backquote, so it is a raw
// template here.
module.exports = String.raw`// Command focusdriver runs the native reviewer once on a saved candidate with a scripted model
// and writes what the review observed (Intent review-focus-check-before-evidence-only-stop).
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

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
		fmt.Fprintln(os.Stderr, "focusdriver: "+err.Error())
		os.Exit(1)
	}
}

// env is the review's Env over the checkout: the scripted model and a run folder; it records what
// the review asked and keeps the last checkpoint it was asked to save.
type env struct {
	repo        *git.Repo
	start       string
	dir         string
	run         string
	answers     [][]map[string]any
	interruptAt int
	interrupted bool
	checkpoint  *review.Checkpoint
	verified    int
	requests    int
	last        []any
}

func (e *env) Request(ctx context.Context, r review.Request) (*provider.Response, []any, error) {
	if e.interruptAt > 0 && !e.interrupted && e.requests+1 == e.interruptAt {
		e.interrupted = true
		return nil, nil, sys.Fail("candidate", "interrupted", "fixture: the request was interrupted before it was sent", 1)
	}
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

// Verify answers a green pass of the checkout's current tree.
func (e *env) Verify(ctx context.Context) (verify.Pass, error) {
	tree, err := e.repo.Tree(e.start, nil)
	if err != nil {
		return verify.Pass{}, err
	}
	e.verified++
	return verify.Pass{N: 1 + e.verified, Clean: true, Green: true, Tree: tree, Model: verify.ModelNone}, nil
}

func (e *env) Feedback(p verify.Pass, completion string) string { return p.Feedback(e.run, completion) }
func (e *env) BaselineIntact() error                            { return nil }
func (e *env) Comparison() []string                             { return nil }
func (e *env) Save(c review.Checkpoint) error {
	saved := c
	e.checkpoint = &saved
	return nil
}
func (e *env) Boundary([]any, *review.Done) error { return nil }
func (e *env) Reviewed(core.ReviewRecord) error   { return nil }
func (e *env) Repaired() error                    { return nil }
func (e *env) Executor(*core.ExecutorState)       {}
func (e *env) Track() error                       { return nil }
func (e *env) Facts(string) error                 { return nil }
func (e *env) Progress(line string)               { fmt.Fprintln(os.Stderr, line) }
func (e *env) Event(map[string]any)               {}
func (e *env) Err() error                         { return nil }

func (e *env) Write(name string, data any) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(e.dir, name), b, 0o600)
}

var _ review.Env = (*env)(nil)

func drive() error {
	root, start, slug := os.Getenv("FOCUS_ROOT"), os.Getenv("FOCUS_START"), os.Getenv("FOCUS_SLUG")
	raw, err := os.ReadFile(os.Getenv("FOCUS_ANSWERS"))
	if err != nil {
		return err
	}
	var answers [][]map[string]any
	if err := json.Unmarshal(raw, &answers); err != nil {
		return fmt.Errorf("the scripted answers are not a JSON list of tool-call lists: %v", err)
	}
	interruptAt := 0
	if v := os.Getenv("FOCUS_INTERRUPT"); v != "" {
		if interruptAt, err = strconv.Atoi(v); err != nil {
			return err
		}
	}
	cfg, err := project.LoadConfig(root)
	if err != nil {
		return err
	}
	if cfg.Acceptance == nil {
		return fmt.Errorf("the fixture configures no acceptance command")
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
	dir, err := os.MkdirTemp("", "focus-driver-run-")
	if err != nil {
		return err
	}
	s := sys.New()
	s.Stdout = os.Stderr
	e := &env{repo: repo, start: commit, dir: dir, run: cfg.Acceptance.Run, answers: answers, interruptAt: interruptAt, last: []any{}}
	pass := verify.Pass{N: 1, Clean: true, Green: true, Tree: tree, Model: verify.ModelNone}
	tl := review.Tools{
		Native: func(enabled []string) *tools.Tools { return &tools.Tools{Root: root, Session: s, Enabled: enabled} },
		Record: func(tools.Call, tools.Output) map[string]any { return nil },
		Round: func(ctx context.Context, sess executor.Session, in executor.Input) (executor.RoundResult, error) {
			return sess.Round(ctx, in)
		},
		Home: s.Getenv("HOME"),
	}
	if name := os.Getenv("FOCUS_RESTRICTION"); name != "" {
		tl.Restriction = &review.Restriction{Name: name, Refused: func(call tools.Call) []string {
			if command, _ := call.Args()["command"].(string); strings.Contains(command, "grant.sh") {
				return []string{"bind: operation not permitted"}
			}
			return nil
		}}
	}
	in := review.Input{
		Candidate: review.Candidate{Root: root, Repo: repo, Start: commit, Tree: pass.Tree},
		Intent: review.Intent{Slug: slug, Text: string(text), Approval: text,
			Role: project.Role{Provider: "openai-compatible", Model: "scripted", Effort: "medium"}},
		Evidence: review.Evidence{Pass: pass, Commands: review.Commands{Fix: cfg.Fix, Checks: cfg.Checks, Acceptance: cfg.Acceptance.Run}},
		Tools:    tl,
		Number:   1,
		Run:      review.Run{ID: "focus-driver", Dir: dir},
	}
	res, rerr := review.Independent{}.Review(s.Context(), in, e)
	if se, ok := sys.AsError(rerr); ok && se.Class == "candidate" && se.Reason == "interrupted" {
		if e.checkpoint == nil {
			return fmt.Errorf("the interrupted review saved no checkpoint")
		}
		in.Checkpoint = e.checkpoint
		res, rerr = review.Independent{}.Resume(s.Context(), in, e)
	}
	verdict, stop, problems, lines := res.Record.Verdict, "", []string{}, []string{}
	if rerr != nil {
		se, ok := sys.AsError(rerr)
		if !ok {
			return rerr
		}
		stop = se.Class + "/" + se.Reason
		lines = append(lines, se.Lines...)
		switch {
		case stop == "candidate/review_blocked":
			verdict = "changes"
		case stop == "candidate/review_invalid" && res.Invalid != nil:
			verdict, problems = "invalid", core.NonNil(res.Invalid.Problems)
		default:
			verdict = "error"
		}
	}
	var requirements, unverified any = nil, []any{}
	if b, err := os.ReadFile(filepath.Join(dir, review.File(1))); err == nil {
		var record map[string]any
		if err := json.Unmarshal(b, &record); err != nil {
			return err
		}
		requirements = record["requirements"]
		if u, ok := record["unverified"]; ok {
			unverified = u
		}
	}
	out, err := json.Marshal(map[string]any{
		"requests": e.requests, "last_inputs": e.last, "verdict": verdict, "stop": stop, "problems": problems,
		"lines": lines, "requirements": requirements, "unverified": unverified,
	})
	if err != nil {
		return err
	}
	return os.WriteFile(os.Getenv("FOCUS_OUT"), out, 0o600)
}
`;
