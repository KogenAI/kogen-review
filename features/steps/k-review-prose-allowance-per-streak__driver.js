// The review driver of Intent k-review-prose-allowance-per-streak: the Go source of a program that
// the steps (k-review-prose-allowance-per-streak__steps.js) build in a copy of this checkout. It
// makes a saved candidate in a temporary Git checkout (the start commit holds app.txt and an
// approved feature; the candidate changes app.txt, whose pinned part stays unread until a
// read_file call of app.txt is in the conversation) and runs the native reviewer
// (review.Independent) on it with a scripted model, then writes what the review observed as one
// JSON object.
//
// Its environment: PROSE_ROUTE (forced: the role openai-compatible/scripted, whose route
// supports forced tool choice; text: the role anthropic/scripted-text, whose route does not),
// PROSE_ANSWERS (a JSON file: one scripted answer per model request, in order: {"prose": text},
// {"calls": [{name, args}]} or {"interrupt": true}, which fails the request; the driver then
// resumes the review from its latest checkpoint, as a caller does after an interruption) and
// PROSE_OUT (the observation file). The source has no backquote, so it is a raw template here.
module.exports = String.raw`// Command prosedriver runs the native reviewer once on a saved candidate with a scripted model
// and writes what the review observed as one JSON object (Intent
// k-review-prose-allowance-per-streak).
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
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
	if err := drive(); err != nil {
		fmt.Fprintln(os.Stderr, "prosedriver: "+err.Error())
		os.Exit(1)
	}
}

// errInterrupted is the scripted interruption of one model request.
var errInterrupted = errors.New("the scripted reviewer interrupted this request")

// env is the review's Env: the scripted model and a run folder. It records every request, every
// event and every checkpoint. The pinned part app.txt is unread until a read_file call of it is
// in the conversation.
type env struct {
	dir      string
	answers  []map[string]any
	requests []any
	mode     string
	events   []map[string]any
	saves    []review.Checkpoint
}

func (e *env) Request(ctx context.Context, r review.Request) (*provider.Response, []any, error) {
	req := map[string]any{"force": r.ForceTool, "mode": e.mode}
	e.mode = ""
	if n := len(r.Input); n == 1 {
		req["last"] = map[string]any{"user": "<opening>"}
	} else if n > 1 {
		m, _ := r.Input[n-1].(map[string]any)
		if m["type"] == "function_call_output" {
			req["last"] = map[string]any{"tool_result": m["output"]}
		} else {
			req["last"] = map[string]any{"user": m["content"]}
		}
	}
	if len(e.answers) == 0 {
		req["answer"] = "none"
		e.requests = append(e.requests, req)
		return nil, nil, fmt.Errorf("the scripted reviewer has no answer for request %d", len(e.requests))
	}
	a := e.answers[0]
	e.answers = e.answers[1:]
	n := len(e.requests) + 1
	switch {
	case a["interrupt"] == true:
		req["answer"] = "interrupted"
		e.requests = append(e.requests, req)
		return nil, nil, errInterrupted
	case a["prose"] != nil:
		req["answer"] = "prose"
		e.requests = append(e.requests, req)
		return &provider.Response{Items: []map[string]any{{"type": "message", "role": "assistant",
			"content": []any{map[string]any{"type": "output_text", "text": a["prose"]}}}}, Usage: provider.Usage{Input: 10, Output: 2}}, r.Input, nil
	}
	calls, _ := a["calls"].([]any)
	var items []map[string]any
	var names []any
	for i, c := range calls {
		m, _ := c.(map[string]any)
		args, err := json.Marshal(m["args"])
		if err != nil {
			return nil, nil, err
		}
		names = append(names, m["name"])
		items = append(items, map[string]any{"type": "function_call", "call_id": fmt.Sprintf("call-%d-%d", n, i+1), "name": m["name"], "arguments": string(args)})
	}
	req["answer"] = names
	e.requests = append(e.requests, req)
	return &provider.Response{Items: items, Usage: provider.Usage{Input: 10, Output: 2}}, r.Input, nil
}

func (e *env) Prepare(tree string, m review.MaterialSet, role project.Role, instructions string, defs, diagnostic []any) ([]any, error) {
	return []any{map[string]any{"role": "user", "content": m.Authority + "\n" + m.Source}}, nil
}

func (e *env) Unread(input []any) ([]string, error) {
	for _, item := range input {
		m, _ := item.(map[string]any)
		if m["type"] != "function_call" || m["name"] != "read_file" {
			continue
		}
		args, _ := m["arguments"].(string)
		if p, _ := tools.DecodeArguments(args)["path"].(string); p == "app.txt" {
			return nil, nil
		}
	}
	return []string{"app.txt"}, nil
}

func (e *env) Delivered([]any) error { return nil }
func (e *env) Custody() error        { return nil }
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

// Event records the run log; a review_tool_choice event is kept as the mode of the next request.
func (e *env) Event(ev map[string]any) {
	if ev["event"] == "review_tool_choice" {
		e.mode, _ = ev["mode"].(string)
	}
	e.events = append(e.events, ev)
}

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
	raw, err := os.ReadFile(os.Getenv("PROSE_ANSWERS"))
	if err != nil {
		return err
	}
	var answers []map[string]any
	if err := json.Unmarshal(raw, &answers); err != nil {
		return fmt.Errorf("the scripted answers are not a JSON list of objects: %v", err)
	}
	role := project.Role{Provider: "openai-compatible", Model: "scripted", Effort: "medium"}
	switch os.Getenv("PROSE_ROUTE") {
	case "forced":
	case "text":
		role = project.Role{Provider: "anthropic", Model: "scripted-text", Effort: "medium"}
	default:
		return fmt.Errorf("PROSE_ROUTE %q is neither forced nor text", os.Getenv("PROSE_ROUTE"))
	}
	// The saved candidate: the start commit holds app.txt and the approved feature; the
	// candidate, the checkout's files, changes app.txt.
	root, err := os.MkdirTemp("", "prose-candidate-")
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
	start := out[:len(out)-1]
	if err := write(filepath.Join(root, "app.txt"), "candidate\n"); err != nil {
		return err
	}
	repo := git.New(root, nil)
	tree, err := repo.Tree(start, nil)
	if err != nil {
		return err
	}
	dir := filepath.Join(root, ".kogen/local/runs/prose-run")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	s := sys.New()
	s.Stdout = os.Stderr
	e := &env{dir: dir, answers: answers, requests: []any{}, events: []map[string]any{}}
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
		Run:    review.Run{ID: "prose-run", Dir: dir},
	}
	resumed := []any{}
	res, rerr := review.Independent{}.Review(context.Background(), in, e)
	for errors.Is(rerr, errInterrupted) {
		// Resume from the review's latest checkpoint, as a caller does after an interruption.
		c := e.saves[len(e.saves)-1]
		var session map[string]any
		if err := json.Unmarshal(c.Session, &session); err != nil {
			return err
		}
		delete(session, "input")
		delete(session, "tools")
		resumed = append(resumed, map[string]any{"stage": c.Stage, "session": session})
		in.Checkpoint = &c
		res, rerr = review.Independent{}.Resume(context.Background(), in, e)
	}
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
			b, err := json.Marshal(res.Invalid)
			if err != nil {
				return err
			}
			var m map[string]any
			if err := json.Unmarshal(b, &m); err != nil {
				return err
			}
			delete(m, "Pass")
			delete(m, "Base")
			invalid = m
		}
	}
	var faults, ends []any
	for _, ev := range e.events {
		switch {
		case ev["event"] == "provider_fault":
			faults = append(faults, ev)
		case ev["event"] == "review" && ev["verdict"] == "invalid":
			ends = append(ends, ev)
		}
	}
	b, err := json.Marshal(map[string]any{
		"requests": e.requests, "verdict": verdict, "stop": stop, "invalid": invalid,
		"faults": core.NonNil(faults), "invalid_events": core.NonNil(ends), "resumed": resumed,
	})
	if err != nil {
		return err
	}
	return os.WriteFile(os.Getenv("PROSE_OUT"), b, 0o600)
}
`;
