// Steps of Intent k-review-round-cap-outcome. The driver below is a Go program that the steps run
// with "go run -overlay" in a kogen-review tree. That tree is either the candidate checkout itself
// or, for the reproduction, the files of an earlier kogen-review commit (its Go module version,
// copied from the module cache). It reviews a saved Git candidate
// whose reviewer "keeps breaking it": every round writes the same wrong calc.py and approves, and
// every verification of the repaired tree is red with the same failing item, acceptance. This is
// the shape of kogen's spec scenario "External round caps preserve the candidate and do not
// restart another role" (fake claude script lineup-review-red-forever, the claude-code review
// role's round cap of 6). The driver writes one JSON observation; the Then step compares the keys
// the scenario states.
//
// Run directly, the file is the observer control: "good" runs the external case on e5005fa and
// expects the spec outcome, "bad" runs it on b1cdd8d and expects the observer to reject it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');

const P = 'k-review-round-cap-outcome';
const DRIVER_DIR = 'internal/k-review-round-cap-outcome-driver';

// The driver's Go source (no backquote). @LOOP@ is kogen-loop's module path in the target tree.
const DRIVER = String.raw`// Command k-review-round-cap-outcome-driver runs one red-forever review of a saved Git
// candidate (Intent k-review-round-cap-outcome) and writes what it observed as JSON.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"

	"github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
	"@LOOP@/provider"
	"@LOOP@/sys"
	"@LOOP@/tools"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
)

const (
	stub    = "def is_even(n):\n    raise NotImplementedError\n"
	correct = "def is_even(n):\n    return n % 2 == 0\n"
	wrong   = "def is_even(n):\n    return n % 2 == 1\n"
	approve = "{\"verdict\":\"approve\",\"findings\":[]}"
	// capRounds is the claude-code review role's round cap the Build passes to NewExternal.
	capRounds = 6
)

// env is the review's Env: scripted native answers (write the wrong calc.py, then approve) and
// verifications that are always red with the failing item acceptance.
type env struct {
	repo                         *git.Repo
	start, dir                   string
	requests, verified, repaired int
	reviewed                     []string
}

func (e *env) Request(ctx context.Context, r review.Request) (*provider.Response, []any, error) {
	e.requests++
	if e.requests > 2*capRounds {
		return nil, nil, fmt.Errorf("the scripted native reviewer has no answer for request %d", e.requests)
	}
	name, args := "submit_review", approve
	if e.requests%2 == 1 {
		b, _ := json.Marshal(map[string]any{"path": "calc.py", "content": wrong})
		name, args = "write_file", string(b)
	}
	item := map[string]any{"type": "function_call", "call_id": fmt.Sprintf("call-%d", e.requests), "name": name, "arguments": args}
	return &provider.Response{Items: []map[string]any{item}, Usage: provider.Usage{Input: 10, Output: 2}}, r.Input, nil
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
	if e.verified > 2*capRounds {
		return verify.Pass{}, fmt.Errorf("the scripted verifications have no result for verification %d", e.verified)
	}
	tree, err := e.repo.Tree(e.start, nil)
	if err != nil {
		return verify.Pass{}, err
	}
	return verify.Pass{N: 1 + e.verified, Clean: true, Tree: tree, Failing: []string{"acceptance"}}, nil
}

func (e *env) Feedback(verify.Pass, string) string { return "acceptance failed: is_even(2) is not True" }
func (e *env) BaselineIntact() error               { return nil }
func (e *env) Comparison() []string                { return nil }
func (e *env) Save(review.Checkpoint) error        { return nil }
func (e *env) Boundary([]any, *review.Done) error  { return nil }
func (e *env) Reviewed(r core.ReviewRecord) error {
	e.reviewed = append(e.reviewed, r.Verdict)
	return nil
}
func (e *env) Repaired() error              { e.repaired++; return nil }
func (e *env) Executor(*core.ExecutorState) {}
func (e *env) Track() error                 { return nil }
func (e *env) Facts(string) error           { return nil }
func (e *env) Progress(string)              {}
func (e *env) Event(map[string]any)         {}
func (e *env) Err() error                   { return nil }
func (e *env) Write(name string, data any) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(e.dir, name), b, 0o600)
}

// xexec is the external reviewer's executor: every round writes the wrong calc.py into the
// candidate and submits an approval, like the fake claude's red-forever review role.
type xexec struct {
	root                    string
	starts, rounds, maxSeen int
}

func (x *xexec) Describe() executor.Descriptor { return descriptor() }

func (x *xexec) Start(ctx context.Context, task executor.Task, emit executor.Sink) (executor.Session, error) {
	x.starts++
	x.maxSeen = task.MaxRounds
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
	s.x.rounds++
	if err := os.WriteFile(filepath.Join(s.x.root, "calc.py"), []byte(wrong), 0o644); err != nil {
		return executor.RoundResult{}, err
	}
	return executor.RoundResult{
		Ending: executor.EndFinish, Structured: json.RawMessage(approve), Handle: s.Handle(),
		Usage: executor.Usage{Input: core.Count(10), Cached: core.Count(0), Output: core.Count(2), Reasoning: core.Count(0), State: executor.UsageComplete},
	}, nil
}

func descriptor() executor.Descriptor {
	return executor.Descriptor{Name: "fixture-executor", Contract: "1", Version: "1.0.0",
		RoleCapabilities: map[string]executor.RoleCapabilities{executor.RoleReview: {}}}
}

func main() {
	if err := drive(os.Args[1], os.Args[2]); err != nil {
		fmt.Fprintln(os.Stderr, "driver: "+err.Error())
		os.Exit(1)
	}
}

func drive(mode, output string) error {
	if mode != "external" && mode != "native" {
		return fmt.Errorf("unknown mode %q", mode)
	}
	root, err := os.MkdirTemp("", "round-cap-candidate-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	run := func(args ...string) (string, error) {
		c := exec.Command("git", append([]string{"-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false"}, args...)...)
		c.Dir = root
		b, err := c.CombinedOutput()
		if err != nil {
			return "", fmt.Errorf("git %v: %v: %s", args, err, b)
		}
		return strings.TrimSpace(string(b)), nil
	}
	intent := "# Add is_even\n\nSlug: is-even\n\nis_even(n) in calc.py returns whether n is even.\n"
	files := map[string]string{
		"calc.py":                                stub,
		".kogen/intents/is-even/intent.md":       intent,
		".kogen/intents/is-even/acceptance.feature": "Feature: is_even\n  Scenario: Two is even\n    Then is_even(2) is true\n",
	}
	for name, text := range files {
		p := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
			return err
		}
	}
	if _, err := run("init", "-q"); err != nil {
		return err
	}
	if _, err := run("add", "-A"); err != nil {
		return err
	}
	if _, err := run("commit", "-qm", "start"); err != nil {
		return err
	}
	start, err := run("rev-parse", "HEAD")
	if err != nil {
		return err
	}
	// The builder's candidate: the correct calc.py, uncommitted, with a green pass.
	if err := os.WriteFile(filepath.Join(root, "calc.py"), []byte(correct), 0o644); err != nil {
		return err
	}
	repo := git.New(root, nil)
	tree, err := repo.Tree(start, nil)
	if err != nil {
		return err
	}
	dir, err := os.MkdirTemp("", "round-cap-run-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	e := &env{repo: repo, start: start, dir: dir}
	x := &xexec{root: root}
	s := sys.New()
	in := review.Input{
		Candidate: review.Candidate{Root: root, Repo: repo, Start: start, Tree: tree},
		Intent: review.Intent{Slug: "is-even", Text: intent, Approval: []byte(intent),
			Role: project.Role{Provider: "openai-compatible", Model: "scripted", Effort: "medium"}},
		Evidence: review.Evidence{Pass: verify.Pass{N: 1, Clean: true, Green: true, Tree: tree}},
		Tools: review.Tools{
			Native: func(enabled []string) *tools.Tools { return &tools.Tools{Root: root, Session: s, Enabled: enabled} },
			Record: func(tools.Call, tools.Output) map[string]any { return nil },
			Round: func(ctx context.Context, sess executor.Session, in executor.Input) (executor.RoundResult, error) {
				return sess.Round(ctx, in)
			},
			Home: os.Getenv("HOME"),
		},
		Number: 1,
		Run:    review.Run{ID: "round-cap", Dir: dir},
	}
	var reviewer review.Reviewer = review.Independent{}
	if mode == "external" {
		reviewer = review.NewExternal(x, descriptor(), capRounds)
	}
	_, rerr := reviewer.Review(context.Background(), in, e)
	stop, detail := "", ""
	if rerr != nil {
		if se, ok := sys.AsError(rerr); ok {
			stop, detail = se.Class+"/"+se.Reason, se.Detail
		} else {
			stop, detail = "error", rerr.Error()
		}
	}
	calc, err := os.ReadFile(filepath.Join(root, "calc.py"))
	if err != nil {
		return err
	}
	record := ""
	if b, err := os.ReadFile(filepath.Join(dir, review.File(1))); err == nil {
		var r struct{ Verdict string }
		if err := json.Unmarshal(b, &r); err != nil {
			return err
		}
		record = r.Verdict
	}
	out, err := json.Marshal(map[string]any{
		"mode": mode, "stop": stop, "detail": detail,
		"sessions": x.starts, "rounds": x.rounds, "task_max_rounds": x.maxSeen, "requests": e.requests,
		"verifications": e.verified, "repairs_recorded": e.repaired,
		"calc": string(calc), "record": record, "changes_recorded": slices.Contains(e.reviewed, "changes"),
	})
	if err != nil {
		return err
	}
	return os.WriteFile(output, out, 0o600)
}
`;

// The spec outcome (kogen spec/features/claude-code-full-lineup.feature, "External round caps
// preserve the candidate and do not restart another role") as the driver observes it; the
// observer control checks the e5005fa and b1cdd8d trees against it.
const SPEC_OUTCOME = {
  stop: 'candidate/executor_round_limit',
  detail: 'the executor used its 6 rounds without a verified, reviewed candidate; the candidate is left in place',
  sessions: 1, rounds: 6, task_max_rounds: 6, verifications: 6,
  calc: 'def is_even(n):\n    return n % 2 == 1\n', record: 'approve', changes_recorded: false,
};

// release copies the files of kogen-review at a module version (the Go module proxy's copy of a
// commit, read through the module cache, so no Git history is needed) into dir.
function release(version, dir) {
  const args = ['mod', 'download', '-json', `github.com/KogenAI/kogen-review@${version}`];
  const r = spawnSync('go', args, {cwd: dir, encoding: 'utf8', timeout: 120000, env: {...process.env, GOWORK: 'off', GOFLAGS: ''}});
  let info = {};
  try { info = JSON.parse(r.stdout); } catch {}
  if (r.status !== 0 || !info.Dir) throw new Error(`${P}: go ${args.join(' ')} exited ${r.status} without a module directory: ${r.stdout}${r.stderr}`);
  const root = path.join(dir, 'tree');
  for (const [cmd, a] of [['cp', ['-R', info.Dir, root]], ['chmod', ['-R', 'u+w', root]]]) {
    const c = spawnSync(cmd, a, {encoding: 'utf8'});
    if (c.status !== 0) throw new Error(`${P}: ${cmd} ${a.join(' ')} exited ${c.status}: ${c.stderr}`);
  }
  return root;
}

// observe runs the driver in mode on target ("the candidate" or a kogen-review module version) and
// returns its observation.
function observe(mode, target) {
  const repo = fs.realpathSync(process.cwd());
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'round-cap-')));
  try {
    let root = repo, where = 'the candidate checkout';
    if (target !== 'the candidate') {
      root = release(target, tmp);
      where = `kogen-review ${target} (module copy)`;
    }
    const gomod = fs.readFileSync(path.join(root, 'go.mod'), 'utf8');
    const loop = /^\s*(require\s+)?kogen-loop\s+v/m.test(gomod) ? 'kogen-loop' : 'github.com/KogenAI/kogen-loop';
    const source = path.join(tmp, 'main.go'), overlay = path.join(tmp, 'overlay.json'), output = path.join(tmp, 'observation.json');
    fs.writeFileSync(source, DRIVER.replaceAll('@LOOP@', loop));
    fs.writeFileSync(overlay, JSON.stringify({Replace: {[path.join(root, DRIVER_DIR, 'main.go')]: source}}));
    const args = ['run', '-overlay', overlay, './' + DRIVER_DIR, mode, output];
    const r = spawnSync('go', args, {cwd: root, encoding: 'utf8', timeout: 280000, maxBuffer: 64 * 1024 * 1024, env: {...process.env, GOWORK: 'off', PWD: root}});
    if (r.status !== 0 || !fs.existsSync(output)) {
      throw new Error(`${P}: go ${args.join(' ')} in ${where} exited ${r.status}${r.error ? ' (' + r.error.message + ')' : ''} without an observation:\n${r.stdout}${r.stderr}`);
    }
    return JSON.parse(fs.readFileSync(output, 'utf8'));
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
}

// check compares every key the expectation states with the observation.
function check(actual, expected, label) {
  for (const [key, want] of Object.entries(expected)) {
    assert.deepStrictEqual(actual[key], want, `${P}: ${label}: ${key} is ${JSON.stringify(actual[key])}, expected ${JSON.stringify(want)}; observation ${JSON.stringify(actual)}`);
  }
}

if (require.main === module) {
  const control = process.argv[2];
  const target = {good: 'v0.0.0-20261103161351-e5005fa1daf8', bad: 'v0.0.0-20261104034934-b1cdd8d7f5f8'}[control];
  if (!target) {
    console.log('usage: good|bad');
    process.exit(2);
  }
  let actual;
  try {
    actual = observe('external', target);
  } catch (err) {
    console.log(`driver failed on ${target.slice(-12, -5)}`);
    console.error(err.message);
    process.exit(2);
  }
  try {
    check(actual, SPEC_OUTCOME, 'spec outcome');
  } catch {
    console.log(`observer rejected ${target.slice(-12, -5)}`);
    process.exit(1);
  }
  console.log(`observer accepted ${target.slice(-12, -5)}`);
} else {
  const {When, Then} = require('@cucumber/cucumber');
  When('k-review-round-cap-outcome: the {string} red-forever review runs on the candidate', {timeout: 300000}, function (mode) {
    this.roundCapObservation = observe(mode, 'the candidate');
  });
  When('k-review-round-cap-outcome: the {string} red-forever review runs on kogen-review version {string}', {timeout: 300000}, function (mode, version) {
    this.roundCapObservation = observe(mode, version);
  });
  Then('k-review-round-cap-outcome: the review observation is:', function (doc) {
    assert.ok(this.roundCapObservation, `${P}: no review observation was recorded`);
    check(this.roundCapObservation, JSON.parse(doc), 'review observation');
  });
}
