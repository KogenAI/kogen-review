'use strict';
// Acceptance of review-changed-after-delivery-line-names-paths: the progress line printed when
// the candidate changed after its contents were delivered names the changed paths, and the
// reviewer feedback is unchanged. The step writes a Go test of package contract
// (zz_delivery_names_paths_test.go, written by this step, not by the Build) into a disposable copy
// of the checkout and runs it with `go test -v ./contract -run TestZZDeliveryNamesPathsDriver -count=1`.
// The test reuses the contract suite's scripted Env and temporary Git candidate, runs
// review.Independent Review twice (three and seven paths changed after delivery) and writes its
// observations as JSON. It passes on the unchanged tree too; the scenarios fail on the observed values.
// `node <this file> --control good|bad` runs the observer controls alone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const prefix = 'review-changed-after-delivery-line-names-paths: ';
const TEST = 'TestZZDeliveryNamesPathsDriver';
const COMMAND = `go test -v ./contract -run ${TEST} -count=1`;
const FEATURE = path.join(__dirname, '..', '..', '.kogen', 'intents', 'review-changed-after-delivery-line-names-paths', 'acceptance.feature');

function observeProgress(actual, expected, label) {
  const T = `delivery driver (${COMMAND}), ${label}, go test output:\n${actual.ran || '(control)'}\n`;
  assert.deepEqual(actual.progress, expected, `${T}: progress lines about the candidate changing after delivery`);
}

function observeFeedback(actual, expected, label) {
  const T = `delivery driver (${COMMAND}), ${label}, go test output:\n${actual.ran || '(control)'}\n`;
  assert.equal(actual.feedback_head, expected.feedback_head, `${T}: reviewer feedback up to its diff`);
  assert.equal(actual.diff_files, expected.diff_files, `${T}: files in the diff of the reviewer feedback`);
  assert.equal(actual.feedback_tail, expected.feedback_tail, `${T}: reviewer feedback after its diff`);
}

function expectedOf() {
  const text = fs.readFileSync(FEATURE, 'utf8');
  const blocks = [...text.matchAll(/"""\n([\s\S]*?)\n\s*"""/g)].map((m) => JSON.parse(m[1]));
  assert.ok(blocks.length >= 3, `${FEATURE}: expected outcome doc strings missing`);
  return blocks;
}

function control(which) {
  const [three, , feedback] = expectedOf();
  observeProgress({progress: structuredClone(three)}, three, 'control');
  observeFeedback({...feedback}, feedback, 'control');
  // The unchanged tree's actual outcome: the progress line names no path.
  const bad = ['kogen: review 1: the candidate changed after its contents were delivered; returning the changes to the reviewer'];
  try {
    observeProgress({progress: bad}, three, 'control');
  } catch {
    if (which === 'bad') {
      console.log('delivery observer rejected a progress line without the changed paths');
      process.exitCode = 1;
      return;
    }
    console.log('delivery observer accepted controls');
    return;
  }
  throw new Error('delivery observer accepted a progress line without the changed paths');
}

const DRIVER = String.raw`package contract

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
)

// TestZZDeliveryNamesPathsDriver reviews a candidate that changes after delivery and writes the
// progress lines and the reviewer feedback to the file named by ZZ_DELIVERY_OUT.
func TestZZDeliveryNamesPathsDriver(t *testing.T) {
	out := os.Getenv("ZZ_DELIVERY_OUT")
	if out == "" {
		t.Fatal("ZZ_DELIVERY_OUT is not set")
	}
	cases := map[string][]string{
		"three": {"alpha/one.txt", "zeta.txt"},
		"seven": {"g1.txt", "g2.txt", "g3.txt", "g4.txt", "g5.txt", "g6.txt"},
	}
	result := map[string]any{}
	for name, extra := range cases {
		in, h := newReview(t)
		writeFile(t, filepath.Join(in.Candidate.Root, "app.txt"), otherText)
		for _, p := range extra {
			writeFile(t, filepath.Join(in.Candidate.Root, p), "added\n")
		}
		tree, err := in.Candidate.Repo.Tree(in.Candidate.Start, nil)
		if err != nil {
			t.Fatal(err)
		}
		h.answers = []*provider.Response{submitReview(` + "`" + `{"verdict":"approve","findings":[]}` + "`" + `), submitReview(` + "`" + `{"verdict":"approve","findings":[]}` + "`" + `)}
		h.verifies = []verify.Pass{{N: 2, Clean: true, Green: true, Tree: tree}}
		if _, err := (review.Independent{}).Review(context.Background(), in, h); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if len(h.requests) != 2 {
			t.Fatalf("%s: %d requests, want 2", name, len(h.requests))
		}
		sent := h.requests[1].Input
		last, _ := sent[len(sent)-1].(map[string]any)
		content, _ := last["content"].(string)
		head, tail := content, ""
		if i := strings.Index(content, "diff --git"); i >= 0 {
			head = content[:i]
		}
		if i := strings.Index(content, "The new tree passed checks"); i >= 0 {
			tail = content[i:]
		}
		progress := []string{}
		for _, line := range h.progress {
			if strings.Contains(line, "changed after its contents were delivered") {
				progress = append(progress, line)
			}
		}
		result[name] = map[string]any{
			"progress": progress, "feedback_head": head,
			"diff_files": strings.Count(content, "diff --git a/"), "feedback_tail": tail,
		}
	}
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
  const root = process.cwd(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-delivery-'));
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
    fs.writeFileSync(path.join(dir, 'contract', 'zz_delivery_names_paths_test.go'), DRIVER);
    const output = path.join(dir, 'delivery.json');
    const run = spawnSync('go', ['test', '-v', './contract', '-run', TEST, '-count=1'], {cwd: dir, encoding: 'utf8', timeout: 110000, env: {...process.env, ZZ_DELIVERY_OUT: output}});
    assert.equal(run.status, 0, `delivery driver: ${COMMAND} failed with status ${run.status} ${run.error || ''}\n${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, new RegExp(`--- PASS: ${TEST} `), `delivery driver: ${COMMAND} exited 0 but ${TEST} did not report a pass\n${run.stdout}\n${run.stderr}`);
    assert.ok(fs.existsSync(output), `delivery driver: ${COMMAND} ran ${TEST} without writing its observations\n${run.stdout}\n${run.stderr}`);
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
  When(prefix + 'a review whose approved tree differs from the delivered tree by {int} changed paths is run', {timeout: 120000}, function (n) {
    const outcome = runDriver();
    this.deliveryOutcome = {3: outcome.three, 7: outcome.seven}[n];
    assert.ok(this.deliveryOutcome, `no scripted case with ${n} changed paths`);
  });
  Then(prefix + 'the progress lines about the change after delivery are:', function (doc) {
    assert.ok(this.deliveryOutcome, 'the scripted review must run first');
    observeProgress(this.deliveryOutcome, JSON.parse(doc), 'scenario');
  });
  Then(prefix + 'the reviewer feedback is:', function (doc) {
    assert.ok(this.deliveryOutcome, 'the scripted review must run first');
    observeFeedback(this.deliveryOutcome, JSON.parse(doc), 'scenario');
  });
}
