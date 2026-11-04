// The review driver of Intent k-review-denied-check-is-environment: the Go source of a program
// that the steps (k-review-denied-check-is-environment__steps.js) build in a copy of this
// checkout. It runs the native reviewer (review.Independent) once on the saved candidate of a Git
// checkout with a scripted model, under a simulated execution restriction, and writes what the
// review observed as one JSON object.
//
// Its environment: DENIED_ROOT (the checkout), DENIED_START (the commit the candidate was built
// on), DENIED_SLUG (the approved Intent), DENIED_RESTRICTION (the restriction's name),
// DENIED_RESTRICTION_LOG (the restriction's own log: the operations it refused, one per line,
// written by the fixture's simulated restriction), DENIED_ANSWERS (a JSON file: one list of tool
// calls {name, args} per model request, in order) and DENIED_OUT (the observation file). The
// review is given a green pass of the candidate that records acceptance not_run. The driver sets
// review.Tools.Restriction and reads review.Result.Environment by reflection, by the names the
// Intent specifies, so it builds on a tree without them and reports their absence in the
// observation. The source has no backquote, so it is a raw template here.
module.exports = String.raw`// Command denieddriver runs the native reviewer once on a saved candidate with a scripted model,
// under a simulated execution restriction, and writes what the review observed (Intent
// k-review-denied-check-is-environment).
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
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
		fmt.Fprintln(os.Stderr, "denieddriver: "+err.Error())
		os.Exit(1)
	}
}

// env is the review's Env over the checkout: the scripted model and a run folder; it records
// what the review asked. The review is given a green pass of the saved candidate, so no
// verification of an edit is expected: Verify counts the request and refuses it.
type env struct {
	dir      string
	answers  [][]map[string]any
	requests int
	last     []any
	input    []any
	verified int
}

func (e *env) Request(ctx context.Context, r review.Request) (*provider.Response, []any, error) {
	e.requests++
	e.input = r.Input
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

func (e *env) Verify(context.Context) (verify.Pass, error) {
	e.verified++
	return verify.Pass{}, fmt.Errorf("the scripted review asked Kogen to verify an edit of the reviewer")
}

func (e *env) Feedback(verify.Pass, string) string { return "" }
func (e *env) BaselineIntact() error              { return nil }
func (e *env) Comparison() []string               { return nil }
func (e *env) Save(review.Checkpoint) error       { return nil }
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

// refusals is the simulated restriction's own report of what it refused during a shell call:
// the lines the fixture's restriction appended to its log, which is emptied for the next call.
func refusals(log string) func(tools.Call) []string {
	return func(tools.Call) []string {
		b, err := os.ReadFile(log)
		if err != nil {
			return nil
		}
		_ = os.WriteFile(log, nil, 0o600)
		var out []string
		for _, line := range strings.Split(string(b), "\n") {
			if line != "" {
				out = append(out, line)
			}
		}
		return out
	}
}

// restrict sets t.Restriction to a restriction with the name and the report refused, by the
// field names the Intent specifies; it returns why it could not ("" when it did).
func restrict(t *review.Tools, name string, refused func(tools.Call) []string) (problem string) {
	defer func() {
		if p := recover(); p != nil {
			problem = fmt.Sprintf("review.Tools.Restriction is not a *struct{Name string; Refused func(tools.Call) []string}: %v", p)
		}
	}()
	f := reflect.ValueOf(t).Elem().FieldByName("Restriction")
	if !f.IsValid() {
		return "review.Tools has no field Restriction"
	}
	r := reflect.New(f.Type().Elem())
	r.Elem().FieldByName("Name").SetString(name)
	r.Elem().FieldByName("Refused").Set(reflect.ValueOf(refused))
	f.Set(r)
	return ""
}

// shellResults are the shell calls of input with their outputs, in order: {command, output}.
func shellResults(input []any) []any {
	commands := map[any]string{}
	out := []any{}
	for _, item := range input {
		m, _ := item.(map[string]any)
		switch m["type"] {
		case "function_call":
			if m["name"] == "shell" {
				args, _ := m["arguments"].(string)
				var a map[string]any
				_ = json.Unmarshal([]byte(args), &a)
				c, _ := a["command"].(string)
				commands[m["call_id"]] = c
			}
		case "function_call_output":
			if c, ok := commands[m["call_id"]]; ok {
				out = append(out, map[string]any{"command": c, "output": m["output"]})
			}
		}
	}
	return out
}

func drive() error {
	root, start, slug := os.Getenv("DENIED_ROOT"), os.Getenv("DENIED_START"), os.Getenv("DENIED_SLUG")
	raw, err := os.ReadFile(os.Getenv("DENIED_ANSWERS"))
	if err != nil {
		return err
	}
	var answers [][]map[string]any
	if err := json.Unmarshal(raw, &answers); err != nil {
		return fmt.Errorf("the scripted answers are not a JSON list of tool-call lists: %v", err)
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
	dir, err := os.MkdirTemp("", "denied-driver-run-")
	if err != nil {
		return err
	}
	s := sys.New()
	s.Stdout = os.Stderr
	e := &env{dir: dir, answers: answers, last: []any{}}
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
		Run:    review.Run{ID: "denied-driver", Dir: dir},
	}
	setup := restrict(&in.Tools, os.Getenv("DENIED_RESTRICTION"), refusals(os.Getenv("DENIED_RESTRICTION_LOG")))
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
	var record any
	if b, err := os.ReadFile(filepath.Join(dir, review.File(1))); err == nil {
		var full map[string]any
		if err := json.Unmarshal(b, &full); err != nil {
			return err
		}
		kept := map[string]any{"findings": full["findings"], "requirements": full["requirements"]}
		if v, ok := full["environment"]; ok {
			kept["environment"] = v
		}
		record = kept
	}
	var resultEnv any = "review.Result has no field Environment"
	if f := reflect.ValueOf(res).FieldByName("Environment"); f.IsValid() {
		b, err := json.Marshal(f.Interface())
		if err != nil {
			return err
		}
		resultEnv = nil
		if err := json.Unmarshal(b, &resultEnv); err != nil {
			return err
		}
	}
	out, err := json.Marshal(map[string]any{
		"requests": e.requests, "last_inputs": e.last, "shell_results": shellResults(e.input),
		"verdict": verdict, "stop": stop, "problems": problems, "record": record,
		"result_environment": resultEnv, "restriction_setup": setup, "verifications": e.verified,
	})
	if err != nil {
		return err
	}
	return os.WriteFile(os.Getenv("DENIED_OUT"), out, 0o600)
}
`;
