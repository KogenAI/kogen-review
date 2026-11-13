'use strict';
// Acceptance of review-reminder-reads-unread-parts: scripted native reviews run through
// review.Independent Review (converse, which calls review/reminder.go) over a scripted Env and a
// real temporary Git candidate, in a disposable copy of the checkout (`go run ./zz-reminder-driver`).
// `node <this file> --control good|bad` runs the observer controls alone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const prefix = 'review-reminder-reads-unread-parts: ';
const COMMAND = 'go run ./zz-reminder-driver';
const FEATURE = path.join(__dirname, '..', '..', '.kogen', 'intents', 'review-reminder-reads-unread-parts', 'acceptance.feature');

function observe(actual, expected, label) {
  const T = `reminder driver (${COMMAND}) case ${label}`;
  assert.deepEqual(actual.requests, expected.requests, `${T}: per request the forced tool and the reminder it carried`);
  assert.deepEqual(actual.choices, expected.choices, `${T}: review_tool_choice events (tool, mode, unread)`);
  assert.equal(actual.verdict, expected.verdict, `${T}: verdict`);
  assert.deepEqual(actual.stop, expected.stop, `${T}: stop`);
}

function docs() {
  const text = fs.readFileSync(FEATURE, 'utf8');
  return [...text.matchAll(/"""\n([\s\S]*?)\n\s*"""/g)].map((m) => JSON.parse(m[1]));
}

function control(which) {
  const expected = docs()[0];
  observe(structuredClone(expected), expected, 'control');
  const bad = structuredClone(expected);
  bad.requests[1].force = 'submit_review';
  bad.choices[0].tool = 'submit_review';
  try {
    observe(bad, expected, 'control');
  } catch {
    if (which === 'bad') {
      console.log('reminder observer rejected a forced submit_review with unread parts');
      process.exitCode = 1;
      return;
    }
    console.log('reminder observer accepted controls');
    return;
  }
  throw new Error('reminder observer accepted a forced submit_review with unread parts');
}

const DRIVER = String.raw`// Command zz-reminder-driver runs scripted native reviews and writes observations as JSON.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	gitpkg "github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-coordinator/route"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-loop/tools"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
)

var role = project.Role{Provider: "chatgpt", Model: "fixture-review-model", Effort: "medium"}

type env struct {
	dir      string
	unread   []string
	steps    []string
	sent     int
	requests []map[string]any
	choices  []map[string]any
}

func encode(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}

func (h *env) Prepare(string, review.MaterialSet, project.Role, string, []any, []any) ([]any, error) {
	return []any{map[string]any{"role": "user", "content": "OPENING of the fixture review\n"}}, nil
}
func (h *env) Unread([]any) ([]string, error) { return append([]string{}, h.unread...), nil }
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
func (h *env) Save(review.Checkpoint) error        { return nil }
func (h *env) Boundary([]any, *review.Done) error  { return nil }
func (h *env) Reviewed(core.ReviewRecord) error    { return nil }
func (h *env) Repaired() error                     { return nil }
func (h *env) Executor(*core.ExecutorState)        {}
func (h *env) Track() error                        { return nil }
func (h *env) Facts(string) error                  { return nil }
func (h *env) Progress(string)                     {}
func (h *env) Err() error                          { return nil }
func (h *env) Write(name string, data any) error {
	return os.WriteFile(filepath.Join(h.dir, name), []byte(encode(data)), 0o600)
}
func (h *env) Event(e map[string]any) {
	if e["event"] == "review_tool_choice" {
		h.choices = append(h.choices, map[string]any{"tool": e["tool"], "mode": e["mode"], "unread": e["unread"]})
	}
}

var partRe = regexp.MustCompile("part-[0-9]+")
var countRe = regexp.MustCompile("([0-9]+) pinned part[(]s[)] unread")

func (h *env) Request(ctx context.Context, r review.Request) (*provider.Response, []any, error) {
	row := map[string]any{"force": r.ForceTool, "reminder": false, "reminder_parts": []string{}, "reminder_unread": 0}
	if n := len(r.Input); n > 0 {
		m, _ := r.Input[n-1].(map[string]any)
		if text, _ := m["content"].(string); m["role"] == "user" && strings.HasPrefix(text, "Not a valid verdict") {
			row["reminder"] = true
			parts := partRe.FindAllString(text, -1)
			if parts == nil {
				parts = []string{}
			}
			row["reminder_parts"] = parts
			if c := countRe.FindStringSubmatch(text); c != nil {
				row["reminder_unread"], _ = strconv.Atoi(c[1])
			}
		}
	}
	h.requests = append(h.requests, row)
	h.sent++
	if h.sent > len(h.steps) {
		return nil, nil, fmt.Errorf("fixture: no scripted answer for request %d", h.sent)
	}
	call := func(name, args string) map[string]any {
		return map[string]any{"type": "function_call", "call_id": fmt.Sprintf("rem-call-%d", h.sent), "name": name, "arguments": args}
	}
	var items []map[string]any
	switch h.steps[h.sent-1] {
	case "prose":
		items = append(items, map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "I looked at the change."}}})
	case "readall":
		h.unread = nil
		items = append(items, call("read_file", encode(map[string]any{"path": "app.txt"})))
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
	return review.Input{
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
	}, dir
}

func runCase(unread int, steps []string) map[string]any {
	root, err := os.MkdirTemp("", "reminder-candidate-")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(root)
	in, dir := candidate(root)
	h := &env{dir: dir, steps: steps}
	for i := 1; i <= unread; i++ {
		h.unread = append(h.unread, fmt.Sprintf("part-%03d", i))
	}
	res, err := review.Independent{}.Review(context.Background(), in, h)
	var stop any
	if err != nil {
		stop = err.Error()
	}
	choices := h.choices
	if choices == nil {
		choices = []map[string]any{}
	}
	return map[string]any{"requests": h.requests, "choices": choices, "verdict": res.Record.Verdict, "stop": stop}
}

func main() {
	_ = route.StageReview
	data := map[string]any{
		"unread":    runCase(86, []string{"prose", "readall", "approve"}),
		"no_unread": runCase(0, []string{"prose", "approve"}),
	}
	if err := os.WriteFile(os.Args[1], []byte(encode(data)), 0o600); err != nil {
		panic(err)
	}
}
`;

function runDriver() {
  const root = process.cwd(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-reminder-'));
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
    fs.mkdirSync(path.join(dir, 'zz-reminder-driver'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'zz-reminder-driver', 'main.go'), DRIVER);
    const output = path.join(dir, 'reminder.json');
    const run = spawnSync('go', ['run', './zz-reminder-driver', output], {cwd: dir, encoding: 'utf8', timeout: 220000});
    assert.equal(run.status, 0, `reminder driver: ${COMMAND} failed with status ${run.status} ${run.error || ''}\n${run.stdout}\n${run.stderr}`);
    assert.ok(fs.existsSync(output), `reminder driver: ${COMMAND} wrote no observations\n${run.stdout}\n${run.stderr}`);
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
  When(prefix + 'a fake reviewer answers without a tool call while {int} pinned parts are unread, then reads them and submits approve', {timeout: 240000}, function (n) {
    assert.equal(n, 86);
    this.reminderOutcome = this.reminderOutcome || runDriver();
    this.reminderCase = 'unread';
  });
  When(prefix + 'a fake reviewer answers without a tool call while no pinned parts are unread, then submits approve', {timeout: 240000}, function () {
    this.reminderOutcome = this.reminderOutcome || runDriver();
    this.reminderCase = 'no_unread';
  });
  Then(prefix + 'the outcome is:', function (doc) {
    assert.ok(this.reminderOutcome, 'the scripted review must run first');
    observe(this.reminderOutcome[this.reminderCase], JSON.parse(doc), this.reminderCase);
  });
}
