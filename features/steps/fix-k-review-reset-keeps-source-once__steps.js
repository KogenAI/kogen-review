'use strict';
// Acceptance of fix-k-review-reset-keeps-source-once: a scripted native review whose request
// after a working-context reset is refused again, resumed from its last review checkpoint, whose
// resumed request is refused once more. The driver program below (`go run ./zz-fix-reset-driver`)
// runs it in a disposable copy of the checkout, through review.Independent Review and Resume over
// a scripted Env and a real temporary Git candidate. The Env refuses, before sending, every
// request over the ceiling and two scripted requests that fit (candidate/context_budget_exceeded).
// `node <this file> --control good|bad` runs the observer controls alone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const prefix = 'fix-k-review-reset-keeps-source-once: ';
const COMMAND = 'go run ./zz-fix-reset-driver';
const FEATURE = path.join(__dirname, '..', '..', '.kogen', 'intents', 'fix-k-review-reset-keeps-source-once', 'acceptance.feature');

function observe(actual, expected) {
  const T = `reset driver (${COMMAND})`;
  assert.deepEqual(actual.review_stop, expected.review_stop, `${T}: the review stops with the Env's refusal of the request after its first reset`);
  assert.deepEqual(actual.checkpoint_items, expected.checkpoint_items, `${T}: items after the opening in the last review checkpoint, which the resume continues`);
  const calls = actual.calls || [];
  expected.calls.forEach((want, i) => {
    assert.deepEqual(calls[i], want, `${T}: request ${i + 1} to the Env (${want.phase}, ${want.outcome})`);
  });
  assert.equal(calls.length, expected.calls.length, `${T}: requests to the Env`);
  assert.deepEqual(actual.resets, expected.resets, `${T}: review_window_reset events (window, trigger)`);
  assert.deepEqual(actual.resume_stop, expected.resume_stop, `${T}: the resumed review ends without a stop`);
  assert.equal(actual.verdict, expected.verdict, `${T}: verdict of the resumed review`);
}

// expectedOf is the outcome the feature's scenario expects, read from its doc string.
function expectedOf() {
  const text = fs.readFileSync(FEATURE, 'utf8');
  const m = text.match(/"""\n([\s\S]*?)\n\s*"""/);
  assert.ok(m, `${FEATURE}: no expected outcome doc string`);
  return JSON.parse(m[1]);
}

function control(which) {
  const expected = expectedOf();
  observe(structuredClone(expected), expected);
  // The unchanged tree's actual outcome: the request after the resumed reset drops the
  // rejected-verdict feedback.
  const bad = structuredClone(expected);
  Object.assign(bad.calls[5], {items: ['handoff'], feedback: 0});
  try {
    observe(bad, expected);
  } catch {
    if (which === 'bad') {
      console.log('fix reset observer rejected the resumed reset without the rejected-verdict feedback');
      process.exitCode = 1;
      return;
    }
    console.log('fix reset observer accepted controls');
    return;
  }
  throw new Error('fix reset observer accepted the resumed reset without the rejected-verdict feedback');
}

// The Go driver program, written to zz-fix-reset-driver/main.go of the disposable copy. It uses
// only the public API of package review and its dependencies.
const DRIVER = String.raw`// Command zz-fix-reset-driver runs one scripted native review whose request after a reset is
// refused again, resumes it from its last checkpoint and writes its observations as JSON:
// zz-fix-reset-driver <output>. Its Env refuses, before sending, every request that does not fit
// the ceiling (candidate/context_budget_exceeded), and the scripted calls listed in refuse.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	gitpkg "github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-coordinator/route"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-loop/sys"
	"github.com/KogenAI/kogen-loop/tools"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
)

const (
	handoffHeader = "Kogen review working-context reset\n"
	feedbackText  = "missing.txt is not a file of the repository"
)

var role = project.Role{Provider: "chatgpt", Model: "fixture-review-model", Effort: "medium"}

type env struct {
	dir     string
	phase   string
	opening []any
	refuse  map[int]bool
	steps   []string
	calls   []map[string]any
	sent    int
	saves   []review.Checkpoint
	events  []map[string]any
}

func measure(r review.Request, input []any) (int, int) {
	pr := core.ProviderRole(r.Role)
	body := (&provider.Client{}).Body(provider.Request{Role: pr, Instructions: r.Instructions, Input: input, Tools: r.Tools, ToolChoice: r.ForceTool})
	m, err := tools.Measure(body, pr)
	if err != nil {
		panic(err)
	}
	return m.RenderedBytes, m.InputBudgetBytes
}

func encode(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}

func (h *env) Prepare(string, review.MaterialSet, project.Role, string, []any, []any) ([]any, error) {
	h.opening = []any{map[string]any{"role": "user", "content": "OPENING of the fixture review\n"}}
	return h.opening, nil
}
func (h *env) Unread([]any) ([]string, error) { return nil, nil }
func (h *env) Delivered([]any) error          { return nil }
func (h *env) Prefill(_ project.Role, _ string, _, input []any) ([]any, error) {
	return input, nil
}
func (h *env) Custody() error { return nil }
func (h *env) Verify(context.Context) (verify.Pass, error) {
	return verify.Pass{}, fmt.Errorf("fixture: verification was not expected")
}
func (h *env) Feedback(verify.Pass, string) string { return "" }
func (h *env) BaselineIntact() error               { return nil }
func (h *env) Comparison() []string                { return nil }
func (h *env) Save(c review.Checkpoint) error      { h.saves = append(h.saves, c); return nil }
func (h *env) Boundary([]any, *review.Done) error  { return nil }
func (h *env) Reviewed(core.ReviewRecord) error    { return nil }
func (h *env) Repaired() error                     { return nil }
func (h *env) Executor(*core.ExecutorState)        {}
func (h *env) Track() error                        { return nil }
func (h *env) Facts(string) error                  { return nil }
func (h *env) Progress(string)                     {}
func (h *env) Event(e map[string]any)              { h.events = append(h.events, e) }
func (h *env) Err() error                          { return nil }
func (h *env) Write(name string, data any) error {
	return os.WriteFile(filepath.Join(h.dir, name), []byte(encode(data)), 0o600)
}

// kinds names the items of input after the opening: the handoff, the rejected-verdict feedback
// message, the budget notice, or the item's type (role for a message without one).
func (h *env) kinds(input []any) []string {
	out := []string{}
	for i, item := range input {
		if i < len(h.opening) && encode(item) == encode(h.opening[i]) {
			continue
		}
		m, _ := item.(map[string]any)
		text, _ := m["content"].(string)
		switch {
		case m["role"] == "user" && strings.HasPrefix(text, handoffHeader):
			out = append(out, "handoff")
		case m["role"] == "user" && strings.Contains(text, feedbackText):
			out = append(out, "feedback")
		case m["type"] != nil:
			out = append(out, fmt.Sprint(m["type"]))
		default:
			out = append(out, fmt.Sprint(m["role"]))
		}
	}
	return out
}

func (h *env) handoffWindow(input []any) string {
	for _, item := range input {
		m, _ := item.(map[string]any)
		if text, _ := m["content"].(string); m["role"] == "user" && strings.HasPrefix(text, handoffHeader) {
			var doc map[string]any
			if json.Unmarshal([]byte(strings.TrimPrefix(text, handoffHeader)), &doc) != nil {
				return "unparsable"
			}
			window, _ := doc["window"].(map[string]any)
			return fmt.Sprint(window["file"])
		}
	}
	return ""
}

func (h *env) Request(ctx context.Context, r review.Request) (*provider.Response, []any, error) {
	n := len(h.calls) + 1
	bytes, limit := measure(r, r.Input)
	encoded := encode(r.Input)
	row := map[string]any{
		"phase": h.phase, "items": h.kinds(r.Input), "feedback": strings.Count(encoded, feedbackText),
		"handoff": h.handoffWindow(r.Input), "opening": len(r.Input) > 0 && encode(r.Input[0]) == encode(h.opening[0]),
	}
	h.calls = append(h.calls, row)
	switch {
	case bytes > limit:
		row["outcome"] = "refused over the ceiling"
	case h.refuse[n]:
		row["outcome"] = "refused"
	}
	if row["outcome"] != nil {
		return nil, nil, sys.Fail("candidate", "context_budget_exceeded", fmt.Sprintf("fixture provider: request %d refused; nothing was sent", n), 1)
	}
	row["outcome"] = "sent"
	h.sent++
	if h.sent > len(h.steps) {
		return nil, nil, fmt.Errorf("fixture: no scripted answer for sent request %d", h.sent)
	}
	call := func(name, args string) map[string]any {
		return map[string]any{"type": "function_call", "call_id": fmt.Sprintf("fix-call-%d", h.sent), "name": name, "arguments": args}
	}
	var items []map[string]any
	switch h.steps[h.sent-1] {
	case "read":
		items = append(items, call("read_file", encode(map[string]any{"path": "app.txt"})))
	case "fill+bad":
		items = append(items,
			map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": strings.Repeat("w", limit-bytes+1000)}}},
			call("submit_review", encode(map[string]any{"verdict": "approve", "findings": []any{map[string]any{"path": "missing.txt", "line": 1, "severity": "note", "message": "fixture"}}})))
	case "approve":
		items = append(items, call("submit_review", encode(map[string]any{"verdict": "approve", "findings": []any{}})))
	}
	return &provider.Response{Items: items, Usage: provider.Usage{Input: 10, Output: 2}}, r.Input, nil
}

func git(dir string, args ...string) string {
	cmd := exec.Command("git", append([]string{"-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false"}, args...)...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		panic(fmt.Sprintf("git %s: %v\n%s", strings.Join(args, " "), err, out))
	}
	return strings.TrimSpace(string(out))
}

func write(path, text string) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		panic(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		panic(err)
	}
}

// candidate is a saved candidate that changes app.txt.
func candidate(root string) (review.Input, string) {
	git(root, "init", "-q", "-b", "main")
	write(filepath.Join(root, ".gitignore"), ".kogen/local/\n")
	write(filepath.Join(root, "app.txt"), "start\n")
	write(filepath.Join(root, project.FeaturePath("fixture")), "Feature: Fixture\n")
	git(root, "add", "-A")
	git(root, "commit", "-q", "-m", "start")
	start := git(root, "rev-parse", "HEAD")
	write(filepath.Join(root, "app.txt"), "candidate\n")
	repo := gitpkg.New(root, nil)
	tree, err := repo.Tree(start, nil)
	if err != nil {
		panic(err)
	}
	dir := filepath.Join(root, ".kogen/local/runs/fixture-run")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		panic(err)
	}
	in := review.Input{
		Candidate: review.Candidate{Root: root, Repo: repo, Start: start, Tree: tree},
		Intent:    review.Intent{Slug: "fixture", Text: "# Fixture intent\n", Role: role},
		Evidence:  review.Evidence{Pass: verify.Pass{N: 1, Clean: true, Green: true, Tree: tree}},
		Tools: review.Tools{
			Native: func(enabled []string) *tools.Tools { return &tools.Tools{Root: root, Enabled: enabled} },
			Record: func(tools.Call, tools.Output) map[string]any { return nil },
			Round: func(ctx context.Context, sess executor.Session, in executor.Input) (executor.RoundResult, error) {
				return sess.Round(ctx, in)
			},
			Home: os.Getenv("HOME"),
		},
		Number: 1,
		Run:    review.Run{ID: "fixture-run", Dir: dir},
	}
	return in, dir
}

func stop(err error) map[string]any {
	if err == nil {
		return nil
	}
	e, _ := sys.AsError(err)
	if e == nil {
		return map[string]any{"error": err.Error()}
	}
	return map[string]any{"class": e.Class, "reason": e.Reason}
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: zz-fix-reset-driver <output>")
		os.Exit(2)
	}
	root, err := os.MkdirTemp("", "fix-reset-candidate-")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(root)
	in, dir := candidate(root)
	// Sent requests: a read, a rejected verdict after a filler that outgrows the ceiling, and,
	// after the resume, an approval. Calls 4 (the request after the first reset) and 5 (the
	// resumed request) are refused although they fit.
	h := &env{dir: dir, phase: "review", refuse: map[int]bool{4: true, 5: true}, steps: []string{"read", "fill+bad", "approve"}}
	_, err = review.Independent{}.Review(context.Background(), in, h)
	data := map[string]any{"review_stop": stop(err)}
	var last *review.Checkpoint
	for i := range h.saves {
		if h.saves[i].Stage == route.StageReview {
			last = &h.saves[i]
		}
	}
	if last == nil {
		panic("fixture: the review saved no review checkpoint")
	}
	saved, err := review.DecodeSession(last.Session)
	if err != nil {
		panic(err)
	}
	data["checkpoint_items"] = h.kinds(saved.Input)
	h.phase = "resume"
	in.Checkpoint = last
	res, err := review.Independent{}.Resume(context.Background(), in, h)
	data["resume_stop"] = stop(err)
	data["verdict"] = res.Record.Verdict
	data["calls"] = h.calls
	resets := []map[string]any{}
	for _, e := range h.events {
		if e["event"] == "review_window_reset" {
			resets = append(resets, map[string]any{"window": e["window"], "trigger": e["trigger"]})
		}
	}
	data["resets"] = resets
	if err := os.WriteFile(os.Args[1], []byte(encode(data)), 0o600); err != nil {
		panic(err)
	}
}
`;

function runDriver() {
  const root = process.cwd(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-review-reset-'));
  try {
    const files = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {cwd: root, encoding: 'utf8'});
    assert.equal(files.status, 0, files.stderr);
    for (const file of new Set(files.stdout.split('\0').filter(Boolean))) {
      const src = path.join(root, file);
      if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
      const dest = path.join(dir, file);
      fs.mkdirSync(path.dirname(dest), {recursive: true});
      fs.copyFileSync(src, dest);
    }
    fs.mkdirSync(path.join(dir, 'zz-fix-reset-driver'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'zz-fix-reset-driver', 'main.go'), DRIVER);
    const output = path.join(dir, 'fix-reset.json');
    const run = spawnSync('go', ['run', './zz-fix-reset-driver', output], {cwd: dir, encoding: 'utf8', timeout: 220000});
    assert.equal(run.status, 0, `reset driver: ${COMMAND} failed with status ${run.status} ${run.error || ''}\n${run.stdout}\n${run.stderr}`);
    assert.ok(fs.existsSync(output), `reset driver: ${COMMAND} exited 0 without writing its observations\n${run.stdout}\n${run.stderr}`);
    return JSON.parse(fs.readFileSync(output, 'utf8'));
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

if (require.main === module) {
  if (process.argv[2] !== '--control') throw new Error('usage: node ' + path.basename(__filename) + ' --control good|bad');
  control(process.argv[3]);
} else {
  const {When, Then} = require('@cucumber/cucumber');
  When(prefix + 'a review whose request after a reset is refused again is resumed and refused once more', {timeout: 240000}, function () {
    this.fixResetOutcome = runDriver();
  });
  Then(prefix + 'the outcome is:', function (doc) {
    assert.ok(this.fixResetOutcome, 'the scripted review must run first');
    observe(this.fixResetOutcome, JSON.parse(doc));
  });
}
