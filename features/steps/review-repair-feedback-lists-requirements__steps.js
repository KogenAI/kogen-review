'use strict';
// Acceptance of review-repair-feedback-lists-requirements: the feedback that returns a reviewer to
// another round after the candidate changed lists the requirements an accepted submission of the
// review already listed. The step writes a Go test of package contract
// (zz_repair_feedback_requirements_test.go, written by this step, not by the Build) into a
// disposable copy of the checkout and runs it with
// `go test -v ./contract -run TestZZRepairFeedbackRequirementsDriver -count=1`. The test reuses the
// contract suite's scripted Env, fake executor and temporary Git candidate, runs five scripted
// reviews (native green and red final passes, external, no requirement, multi-line requirement)
// and writes the last feedback of each as JSON. It passes on the unchanged tree too; the
// scenarios fail on the observed values.
// `node <this file> --control good|bad` runs the observer controls alone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const prefix = 'review-repair-feedback-lists-requirements: ';
const TEST = 'TestZZRepairFeedbackRequirementsDriver';
const COMMAND = `go test -v ./contract -run ${TEST} -count=1`;
const CASES = ['green', 'red', 'external', 'none', 'multiline'];

function observeEnds(actual, expected, label) {
  const T = `repair feedback driver (${COMMAND}), ${label}, go test output:\n${actual.ran || '(control)'}\n`;
  assert.equal(typeof actual.feedback, 'string', `${T}: no feedback was observed`);
  assert.ok(actual.feedback.endsWith(expected), `${T}: the feedback must end with ${JSON.stringify(expected)} but was ${JSON.stringify(actual.feedback)}`);
}

function observeAbsent(actual, text, label) {
  const T = `repair feedback driver (${COMMAND}), ${label}, go test output:\n${actual.ran || '(control)'}\n`;
  assert.equal(typeof actual.feedback, 'string', `${T}: no feedback was observed`);
  assert.ok(!actual.feedback.includes(text), `${T}: the feedback must not contain ${JSON.stringify(text)} but was ${JSON.stringify(actual.feedback)}`);
}

function observeRequests(actual, expected, label) {
  const T = `repair feedback driver (${COMMAND}), ${label}, go test output:\n${actual.ran || '(control)'}\n`;
  assert.equal(actual.requests, expected, `${T}: requests the reviewer made`);
  assert.equal(actual.verdict, 'approve', `${T}: verdict of the review`);
}

function control(which) {
  const block = 'do not restart the whole critique.\n\nRequirements already listed in this review (your next approval must list each of them, with this text and with evidence observed on the current tree):\n- R1\n- R2';
  observeEnds({feedback: 'Your verdict was not applied.\n' + block}, block, 'control');
  observeAbsent({feedback: 'tail do not restart the whole critique.'}, 'Requirements already listed', 'control');
  observeRequests({requests: 2, verdict: 'approve'}, 2, 'control');
  // The unchanged tree's actual outcome: the feedback ends without the block.
  try {
    observeEnds({feedback: 'Your verdict was not applied.\ndo not restart the whole critique.'}, block, 'control');
  } catch {
    if (which === 'bad') {
      console.log('repair feedback observer rejected a feedback without the requirements block');
      process.exitCode = 1;
      return;
    }
    console.log('repair feedback observer accepted controls');
    return;
  }
  throw new Error('repair feedback observer accepted a feedback without the requirements block');
}

const DRIVER = String.raw`package contract

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
)

// TestZZRepairFeedbackRequirementsDriver runs five scripted reviews that change the candidate
// after the first approval and writes the last feedback of each to the file named by
// ZZ_REPAIR_FEEDBACK_OUT.
func TestZZRepairFeedbackRequirementsDriver(t *testing.T) {
	out := os.Getenv("ZZ_REPAIR_FEEDBACK_OUT")
	if out == "" {
		t.Fatal("ZZ_REPAIR_FEEDBACK_OUT is not set")
	}
	const two = ` + "`" + `{"verdict":"approve","findings":[],"requirements":[{"requirement":"R1","evidence":"test","ref":"t","met":true},{"requirement":"R2","evidence":"test","ref":"t","met":true}]}` + "`" + `
	const one = ` + "`" + `{"verdict":"approve","findings":[],"requirements":[{"requirement":"R1","evidence":"test","ref":"t","met":true}]}` + "`" + `
	const none = ` + "`" + `{"verdict":"approve","findings":[]}` + "`" + `
	const multi = ` + "`" + `{"verdict":"approve","findings":[],"requirements":[{"requirement":"R1\\n  second   line","evidence":"test","ref":"t","met":true}]}` + "`" + `
	green := func() []verify.Pass { return []verify.Pass{{N: 2, Clean: true, Green: true, Tree: otherTree}} }
	red := func() []verify.Pass {
		return []verify.Pass{{N: 2, Clean: true, Green: false, Tree: otherTree, Failing: []string{"check:lint"}}, {N: 3, Clean: true, Green: true, Tree: otherTree}}
	}
	result := map[string]any{}
	native := func(name string, first, second string, passes func() []verify.Pass) {
		in, h := newReview(t)
		writeFile(t, filepath.Join(in.Candidate.Root, "app.txt"), otherText)
		h.answers = []*provider.Response{submitReview(first), submitReview(second)}
		h.verifies = passes()
		res, err := review.Independent{}.Review(context.Background(), in, h)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if len(h.requests) != 2 {
			t.Fatalf("%s: %d requests, want 2", name, len(h.requests))
		}
		sent := h.requests[1].Input
		last, _ := sent[len(sent)-1].(map[string]any)
		content, _ := last["content"].(string)
		result[name] = map[string]any{"feedback": content, "requests": len(h.requests), "verdict": res.Record.Verdict}
	}
	native("green", two, two, green)
	native("red", one, one, red)
	native("none", none, none, green)
	native("multiline", multi, multi, green)

	in, h := newReview(t)
	// An external review is refused a candidate that changed before it was sent, so the candidate
	// changes during the first executor round.
	rounds := 0
	in.Tools.Round = func(ctx context.Context, sess executor.Session, input executor.Input) (executor.RoundResult, error) {
		rounds++
		if rounds == 1 {
			writeFile(t, filepath.Join(in.Candidate.Root, "app.txt"), otherText)
		}
		return sess.Round(ctx, input)
	}
	x := &fakeExecutor{t: t, results: []executor.RoundResult{structured(two), structured(two)}}
	h.verifies = green()
	res, err := review.NewExternal(x, externalDescriptor(), 4).Review(context.Background(), in, h)
	if err != nil {
		t.Fatalf("external: %v", err)
	}
	if len(x.inputs) != 2 {
		t.Fatalf("external: %d executor requests, want 2", len(x.inputs))
	}
	result["external"] = map[string]any{"feedback": x.inputs[1].Feedback, "requests": len(x.inputs), "verdict": res.Record.Verdict}

	b, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, b, 0o600); err != nil {
		t.Fatal(err)
	}
}
`;

let cached;
function runDriver() {
  if (cached) return cached;
  const root = process.cwd(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-repair-feedback-'));
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
    fs.writeFileSync(path.join(dir, 'contract', 'zz_repair_feedback_requirements_test.go'), DRIVER);
    const output = path.join(dir, 'repair-feedback.json');
    const run = spawnSync('go', ['test', '-v', './contract', '-run', TEST, '-count=1'], {cwd: dir, encoding: 'utf8', timeout: 110000, env: {...process.env, ZZ_REPAIR_FEEDBACK_OUT: output}});
    assert.equal(run.status, 0, `repair feedback driver: ${COMMAND} failed with status ${run.status} ${run.error || ''}\n${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, new RegExp(`--- PASS: ${TEST} `), `repair feedback driver: ${COMMAND} exited 0 but ${TEST} did not report a pass\n${run.stdout}\n${run.stderr}`);
    assert.ok(fs.existsSync(output), `repair feedback driver: ${COMMAND} ran ${TEST} without writing its observations\n${run.stdout}\n${run.stderr}`);
    cached = JSON.parse(fs.readFileSync(output, 'utf8'));
    for (const k of Object.keys(cached)) cached[k].ran = run.stdout.trim();
    return cached;
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

if (require.main === module) {
  if (process.argv[2] !== '--control') throw new Error('usage: node ' + path.basename(__filename) + ' --control good|bad');
  control(process.argv[3]);
} else {
  const {When, Then} = require('@cucumber/cucumber');
  When(prefix + 'the {word} scripted review is run', {timeout: 120000}, function (name) {
    assert.ok(CASES.includes(name), `no scripted case ${name}`);
    this.repairOutcome = runDriver()[name];
    assert.ok(this.repairOutcome, `the driver observed no case ${name}`);
  });
  Then(prefix + 'the feedback of the second request ends with:', function (doc) {
    assert.ok(this.repairOutcome, 'the scripted review must run first');
    observeEnds(this.repairOutcome, JSON.parse(doc), 'scenario');
  });
  Then(prefix + 'the feedback of the second request does not contain {string}', function (text) {
    assert.ok(this.repairOutcome, 'the scripted review must run first');
    observeAbsent(this.repairOutcome, text, 'scenario');
  });
  Then(prefix + 'the reviewer made {int} requests and approved', function (n) {
    assert.ok(this.repairOutcome, 'the scripted review must run first');
    observeRequests(this.repairOutcome, n, 'scenario');
  });
}
