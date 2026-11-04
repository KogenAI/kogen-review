// The review driver of Intent k-review-ignored-call-after-rejected-verdict: the Go source of a
// program that the steps (k-review-ignored-call-after-rejected-verdict__steps.js) build in a copy
// of this checkout. It makes a saved candidate in a temporary Git checkout (the start commit holds
// app.txt and an approved feature; the candidate changes app.txt to "candidate\n", whose pinned
// part is unread until a read_file output holding its text has reached the model, that is, is
// followed by a later model item) and runs the native reviewer (review.Independent) on it with a
// scripted model on the role openai-compatible/scripted, then writes what the review observed as
// one JSON object.
//
// Its environment: REJECTED_ANSWERS (a JSON file: one scripted answer per model request, in
// order, each {"calls": [{name, args}]}; a request without an answer fails with the stop
// candidate/script_exhausted) and REJECTED_OUT (the observation file). The source has no
// backquote, so it is a raw template here.
module.exports = String.raw`// Command rejecteddriver runs the native reviewer once on a saved candidate with a scripted
// model and writes what the review observed as one JSON object (Intent
// k-review-ignored-call-after-rejected-verdict).
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
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
	if err := drive(); err != nil {
		fmt.Fprintln(os.Stderr, "rejecteddriver: "+err.Error())
		os.Exit(1)
	}
}

// env is the review's Env: the scripted model and a run folder. It keeps the input of the latest
// request, the delivered conversation, every event and every checkpoint.
type env struct {
	dir       string
	answers   []map[string]any
	requests  int
	last      []any
	delivered []any
	events    []map[string]any
	saves     []review.Checkpoint
}

func (e *env) Request(ctx context.Context, r review.Request) (*provider.Response, []any, error) {
	e.requests++
	e.last = r.Input
	if len(e.answers) == 0 {
		return nil, nil, sys.Fail("candidate", "script_exhausted", fmt.Sprintf("the scripted reviewer has no answer for request %d", e.requests), 1)
	}
	a := e.answers[0]
	e.answers = e.answers[1:]
	calls, _ := a["calls"].([]any)
	var items []map[string]any
	for i, c := range calls {
		m, _ := c.(map[string]any)
		args, err := json.Marshal(m["args"])
		if err != nil {
			return nil, nil, err
		}
		items = append(items, map[string]any{"type": "function_call", "call_id": fmt.Sprintf("call-%d-%d", e.requests, i+1), "name": m["name"], "arguments": string(args)})
	}
	return &provider.Response{Items: items, Usage: provider.Usage{Input: 10, Output: 2}}, r.Input, nil
}

func (e *env) Prepare(tree string, m review.MaterialSet, role project.Role, instructions string, defs, diagnostic []any) ([]any, error) {
	return []any{map[string]any{"role": "user", "content": "OPENING"}}, nil
}

// Unread: app.txt is read once a tool output holding its text has reached the model: a later
// function_call or assistant item follows it.
func (e *env) Unread(input []any) ([]string, error) {
	seen := false
	for _, item := range input {
		m, _ := item.(map[string]any)
		if seen && (m["type"] == "function_call" || m["role"] == "assistant") {
			return nil, nil
		}
		if out, _ := m["output"].(string); m["type"] == "function_call_output" && strings.Contains(out, "\tcandidate") {
			seen = true
		}
	}
	return []string{"app.txt"}, nil
}

func (e *env) Delivered(input []any) error { e.delivered = input; return nil }
func (e *env) Custody() error              { return nil }
func (e *env) Prefill(_ project.Role, _ string, _, input []any) ([]any, error) {
	return input, nil
}
func (e *env) Verify(context.Context) (verify.Pass, error) {
	return verify.Pass{}, errors.New("the scripted review verifies no repair")
}
func (e *env) Feedback(p verify.Pass, completion string) string { return "" }
func (e *env) BaselineIntact() error                            { return nil }
func (e *env) Comparison() []string                             { return nil }
func (e *env) Save(c review.Checkpoint) error                   { e.saves = append(e.saves, c); return nil }
func (e *env) Boundary([]any, *review.Done) error               { return nil }
func (e *env) Reviewed(core.ReviewRecord) error                 { return nil }
func (e *env) Repaired() error                                  { return nil }
func (e *env) Executor(*core.ExecutorState)                     {}
func (e *env) Track() error                                     { return nil }
func (e *env) Facts(string) error                               { return nil }
func (e *env) Progress(line string)                             { fmt.Fprintln(os.Stderr, line) }
func (e *env) Err() error                                       { return nil }
func (e *env) Event(ev map[string]any)                          { e.events = append(e.events, ev) }

func (e *env) Write(name string, data any) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(e.dir, name), b, 0o600)
}

var _ review.Env = (*env)(nil)

func run(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false"}, args...)...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git %v: %v: %s", args, err, out)
	}
	return string(out), nil
}

func write(path, text string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(text), 0o600)
}

func drive() error {
	raw, err := os.ReadFile(os.Getenv("REJECTED_ANSWERS"))
	if err != nil {
		return err
	}
	var answers []map[string]any
	if err := json.Unmarshal(raw, &answers); err != nil {
		return fmt.Errorf("the scripted answers are not a JSON list of objects: %v", err)
	}
	role := project.Role{Provider: "openai-compatible", Model: "scripted", Effort: "medium"}
	// The saved candidate: the start commit holds app.txt and the approved feature; the
	// candidate, the checkout's files, changes app.txt.
	root, err := os.MkdirTemp("", "rejected-candidate-")
	if err != nil {
		return err
	}
	if _, err := run(root, "init", "-q", "-b", "main"); err != nil {
		return err
	}
	for path, text := range map[string]string{".gitignore": ".kogen/local/\n", "app.txt": "start\n", project.FeaturePath("fixture"): "Feature: Fixture\n"} {
		if err := write(filepath.Join(root, path), text); err != nil {
			return err
		}
	}
	if _, err := run(root, "add", "-A"); err != nil {
		return err
	}
	if _, err := run(root, "commit", "-q", "-m", "start"); err != nil {
		return err
	}
	out, err := run(root, "rev-parse", "HEAD")
	if err != nil {
		return err
	}
	start := strings.TrimSpace(out)
	if err := write(filepath.Join(root, "app.txt"), "candidate\n"); err != nil {
		return err
	}
	repo := git.New(root, nil)
	tree, err := repo.Tree(start, nil)
	if err != nil {
		return err
	}
	dir := filepath.Join(root, ".kogen/local/runs/rejected-run")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	s := sys.New()
	s.Stdout = os.Stderr
	e := &env{dir: dir, answers: answers, events: []map[string]any{}}
	pass := verify.Pass{N: 1, Clean: true, Green: true, Tree: tree}
	in := review.Input{
		Candidate: review.Candidate{Root: root, Repo: repo, Start: start, Tree: tree},
		Intent:    review.Intent{Slug: "fixture", Text: "# Fixture intent\n", Role: role},
		Evidence:  review.Evidence{Pass: pass},
		Tools: review.Tools{
			Native: func(enabled []string) *tools.Tools { return &tools.Tools{Root: root, Session: s, Enabled: enabled} },
			Record: func(tools.Call, tools.Output) map[string]any { return nil },
			Round: func(ctx context.Context, sess executor.Session, in executor.Input) (executor.RoundResult, error) {
				return sess.Round(ctx, in)
			},
			Home: s.Getenv("HOME"),
		},
		Number: 1,
		Run:    review.Run{ID: "rejected-run", Dir: dir},
	}
	res, rerr := review.Independent{}.Review(context.Background(), in, e)
	verdict, stop := res.Record.Verdict, ""
	var invalid any
	if rerr != nil {
		se, ok := sys.AsError(rerr)
		if !ok {
			return rerr
		}
		stop = se.Class + "/" + se.Reason
		verdict = "error"
		if stop == "candidate/review_invalid" && res.Invalid != nil {
			verdict = "invalid"
			invalid = map[string]any{"Reason": res.Invalid.Reason, "Problems": res.Invalid.Problems, "RejectedVerdict": res.Invalid.RejectedVerdict, "NoToolReminder": res.Invalid.NoToolReminder}
		}
	}
	// The final conversation: the delivered one after a verdict, else the latest request's input.
	final := e.delivered
	if final == nil {
		final = e.last
	}
	outputs := map[string]any{}
	for _, item := range final {
		m, _ := item.(map[string]any)
		if m["type"] == "function_call_output" {
			id, _ := m["call_id"].(string)
			outputs[id] = m["output"]
		}
	}
	responses := []any{}
	for n, a := range answers {
		calls, _ := a["calls"].([]any)
		list := []any{}
		for i, c := range calls {
			m, _ := c.(map[string]any)
			output, ok := outputs[fmt.Sprintf("call-%d-%d", n+1, i+1)]
			if !ok {
				output = nil
			}
			list = append(list, map[string]any{"name": m["name"], "output": output})
		}
		responses = append(responses, list)
	}
	allowances, ran := []any{}, []any{}
	for _, ev := range e.events {
		switch ev["event"] {
		case "review_allowance":
			allowances = append(allowances, map[string]any{"why": ev["why"], "rejected_verdicts": ev["rejected_verdicts"], "no_tool_reminders": ev["no_tool_reminders"]})
		case "review_tool_call":
			ran = append(ran, ev["name"])
		}
	}
	probes, probeRuns := []any{}, []any{}
	if len(e.saves) > 0 {
		var session map[string]any
		if err := json.Unmarshal(e.saves[len(e.saves)-1].Session, &session); err != nil {
			return err
		}
		if p, ok := session["probes"].([]any); ok {
			probes = p
		}
		if p, ok := session["probe_runs"].([]any); ok {
			for _, pr := range p {
				m, _ := pr.(map[string]any)
				probeRuns = append(probeRuns, m["command"])
			}
		}
	}
	app, err := os.ReadFile(filepath.Join(root, "app.txt"))
	if err != nil {
		return err
	}
	b, err := json.Marshal(map[string]any{
		"requests": e.requests, "responses": responses, "verdict": verdict, "stop": stop, "invalid": invalid,
		"allowances": allowances, "ran": ran, "probes": probes, "probe_runs": probeRuns, "app": string(app),
	})
	if err != nil {
		return err
	}
	return os.WriteFile(os.Getenv("REJECTED_OUT"), b, 0o600)
}
`;
