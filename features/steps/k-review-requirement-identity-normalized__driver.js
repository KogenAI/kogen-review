// The review driver of Intent k-review-requirement-identity-normalized: the Go source of a
// program that the steps (k-review-requirement-identity-normalized__steps.js) build in a copy of
// this checkout. It makes a saved candidate in a temporary Git checkout (the start commit holds
// total.sh, which prints 0, and the approved Intent "total"; the candidate changes total.sh to
// print the total of its two arguments), runs the native reviewer (review.Independent) on it once
// with a scripted model on the role openai-compatible/scripted, given a green pass of the
// candidate, and writes what the review observed as one JSON object.
//
// Its environment: IDENTITY_ANSWERS (a JSON file: one list of tool calls {name, args} per model
// request, in order; a request without an answer fails with the stop
// candidate/script_exhausted) and IDENTITY_OUT (the observation file). The source has no
// backquote, so it is a raw template here.
module.exports = String.raw`// Command identitydriver runs the native reviewer once on a saved candidate with a scripted
// model and writes what the review observed as one JSON object (Intent
// k-review-requirement-identity-normalized).
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
		fmt.Fprintln(os.Stderr, "identitydriver: "+err.Error())
		os.Exit(1)
	}
}

// env is the review's Env: the scripted model and a run folder. It keeps the last input item of
// each request.
type env struct {
	dir      string
	answers  [][]map[string]any
	requests int
	last     []any
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
		return nil, nil, sys.Fail("candidate", "script_exhausted", fmt.Sprintf("the scripted reviewer has no answer for request %d", e.requests), 1)
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
	return []any{map[string]any{"role": "user", "content": "OPENING"}}, nil
}

func (e *env) Unread([]any) ([]string, error) { return nil, nil }
func (e *env) Delivered([]any) error          { return nil }
func (e *env) Custody() error                 { return nil }
func (e *env) Prefill(_ project.Role, _ string, _, input []any) ([]any, error) {
	return input, nil
}
func (e *env) Verify(context.Context) (verify.Pass, error) {
	return verify.Pass{}, errors.New("the scripted review verifies no repair")
}
func (e *env) Feedback(p verify.Pass, completion string) string { return "" }
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
	raw, err := os.ReadFile(os.Getenv("IDENTITY_ANSWERS"))
	if err != nil {
		return err
	}
	var answers [][]map[string]any
	if err := json.Unmarshal(raw, &answers); err != nil {
		return fmt.Errorf("the scripted answers are not a JSON list of tool-call lists: %v", err)
	}
	// The saved candidate: the start commit holds total.sh and the approved Intent; the
	// candidate, the checkout's files, changes total.sh.
	root, err := os.MkdirTemp("", "identity-candidate-")
	if err != nil {
		return err
	}
	if _, err := run(root, "init", "-q", "-b", "main"); err != nil {
		return err
	}
	intent := "# Print a total\n\nSlug: total\nModel: not applicable — one command\nAcceptance:\n- .kogen/intents/total/acceptance.feature\n\nThe tool prints a total: sh total.sh A B prints A + B.\n"
	for path, text := range map[string]string{".gitignore": ".kogen/local/\n", "total.sh": "echo 0\n", project.IntentDir("total") + "/intent.md": intent, project.FeaturePath("total"): "Feature: Total\n"} {
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
	if err := write(filepath.Join(root, "total.sh"), "echo $(($1 + $2))\n"); err != nil {
		return err
	}
	repo := git.New(root, nil)
	tree, err := repo.Tree(start, nil)
	if err != nil {
		return err
	}
	dir := filepath.Join(root, ".kogen/local/runs/identity-run")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	s := sys.New()
	s.Stdout = os.Stderr
	e := &env{dir: dir, answers: answers, last: []any{}}
	in := review.Input{
		Candidate: review.Candidate{Root: root, Repo: repo, Start: start, Tree: tree},
		Intent:    review.Intent{Slug: "total", Text: intent, Approval: []byte(intent), Role: project.Role{Provider: "openai-compatible", Model: "scripted", Effort: "medium"}},
		Evidence:  review.Evidence{Pass: verify.Pass{N: 1, Clean: true, Green: true, Tree: tree, Model: verify.ModelNone}},
		Tools: review.Tools{
			Native: func(enabled []string) *tools.Tools { return &tools.Tools{Root: root, Session: s, Enabled: enabled} },
			Record: func(tools.Call, tools.Output) map[string]any { return nil },
			Round: func(ctx context.Context, sess executor.Session, in executor.Input) (executor.RoundResult, error) {
				return sess.Round(ctx, in)
			},
			Home: s.Getenv("HOME"),
		},
		Number: 1,
		Run:    review.Run{ID: "identity-run", Dir: dir},
	}
	res, rerr := review.Independent{}.Review(context.Background(), in, e)
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
	b, err := json.Marshal(map[string]any{
		"requests": e.requests, "last_inputs": e.last, "verdict": verdict, "stop": stop, "problems": problems, "requirements": requirements,
	})
	if err != nil {
		return err
	}
	return os.WriteFile(os.Getenv("IDENTITY_OUT"), b, 0o600)
}
`;
