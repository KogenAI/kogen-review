'use strict';
// Acceptance of review-rejected-verdict-records-problems: scripted reviews (external and native)
// run through review.NewExternal(...).Review and review.Independent{}.Review over the contract
// suite's fake Env and executor, in a disposable copy of the checkout, by a Go test file the step
// writes there (contract/zz_problems_test.go, run with go test -v). `node <this file> --control
// good|bad` runs the observer controls alone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const prefix = 'review-rejected-verdict-records-problems: ';
const COMMAND = "go test -v ./contract -run '^TestZZRejectedVerdictRecordsProblems$' -count=1";
const FEATURE = path.join(__dirname, '..', '..', '.kogen', 'intents', 'review-rejected-verdict-records-problems', 'acceptance.feature');

function observe(actual, expected, label, log) {
  const T = `rejected-verdict test (${COMMAND}) case ${label}`;
  const ran = log ? `\nthe scripted test ran (TestZZRejectedVerdictRecordsProblems, scratch file contract/zz_problems_test.go) and printed:\n${log}` : '';
  assert.deepEqual(actual, expected, `${T}: review_allowance events, problems the reviewer was told, verdict-not-accepted progress lines and verdict${ran}`);
  if (actual.told) {
    assert.deepEqual(actual.allowances[0].problems, actual.told, `${T}: the recorded problems are the lines the reviewer was told${ran}`);
  }
}

function docs() {
  const text = fs.readFileSync(FEATURE, 'utf8');
  return [...text.matchAll(/"""\n([\s\S]*?)\n\s*"""/g)].map((m) => JSON.parse(m[1]));
}

function control(which) {
  const expected = docs()[0];
  observe(structuredClone(expected), expected, 'control');
  const bad = structuredClone(expected);
  delete bad.allowances[0].problems;
  try {
    observe(bad, expected, 'control');
  } catch {
    if (which === 'bad') {
      console.log('rejected-verdict observer rejected an allowance event without problems');
      process.exitCode = 1;
      return;
    }
    console.log('rejected-verdict observer accepted controls');
    return;
  }
  throw new Error('rejected-verdict observer accepted an allowance event without problems');
}

const TEST = String.raw`package contract

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-review/review"
)

func zzAllowances(events []map[string]any) []map[string]any {
	out := []map[string]any{}
	for _, e := range events {
		if e["event"] != "review_allowance" {
			continue
		}
		row := map[string]any{"why": e["why"], "rejected_verdicts": e["rejected_verdicts"], "no_tool_reminders": e["no_tool_reminders"]}
		if p, ok := e["problems"]; ok {
			row["problems"] = p
		}
		out = append(out, row)
	}
	return out
}

func zzNotAccepted(progress []string) []string {
	out := []string{}
	for _, line := range progress {
		if strings.Contains(line, "verdict not accepted") {
			out = append(out, line)
		}
	}
	return out
}

func zzTold(t *testing.T, req review.Request) []string {
	t.Helper()
	for _, item := range req.Input {
		b, _ := json.Marshal(item)
		var m map[string]any
		_ = json.Unmarshal(b, &m)
		if text, _ := m["output"].(string); m["type"] == "function_call_output" && strings.HasPrefix(text, "invalid verdict:\n") {
			return strings.Split(strings.TrimPrefix(text, "invalid verdict:\n"), "\n")
		}
	}
	t.Fatal("the reviewer was not told its verdict was invalid")
	return nil
}

func TestZZRejectedVerdictRecordsProblems(t *testing.T) {
	out := map[string]any{}

	in, h := newReview(t)
	x := &fakeExecutor{t: t, results: []executor.RoundResult{structured("{\"findings\":[]}"), structured("{\"verdict\":\"approve\",\"findings\":[]}")}}
	ap, err := review.NewExternal(x, externalDescriptor(), 4).Review(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	feedback := x.inputs[1].Feedback
	told := strings.TrimSuffix(strings.TrimPrefix(feedback, "Not a valid verdict: "), ". Submit a corrected structured verdict.")
	out["external"] = map[string]any{"allowances": zzAllowances(h.events), "told": []string{told}, "progress": zzNotAccepted(h.progress), "verdict": ap.Record.Verdict}

	in, h = newReview(t)
	h.answers = []*provider.Response{submitReview("{\"findings\":[]}"), submitReview("{\"verdict\":\"approve\",\"findings\":[]}")}
	ap, err = review.Independent{}.Review(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	out["independent"] = map[string]any{"allowances": zzAllowances(h.events), "told": zzTold(t, h.requests[1]), "progress": zzNotAccepted(h.progress), "verdict": ap.Record.Verdict}

	in, h = newReview(t)
	var findings []map[string]any
	for i := 1; i <= 12; i++ {
		findings = append(findings, map[string]any{"path": fmt.Sprintf("p%02d-", i) + strings.Repeat("é", 400), "line": 1, "severity": "note", "message": "m"})
	}
	args, _ := json.Marshal(map[string]any{"verdict": "approve", "findings": findings})
	h.answers = []*provider.Response{submitReview(string(args)), submitReview("{\"verdict\":\"approve\",\"findings\":[]}")}
	ap, err = review.Independent{}.Review(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	long := map[string]any{"verdict": ap.Record.Verdict}
	for _, row := range zzAllowances(h.events) {
		lines, _ := row["problems"].([]string)
		runes := []int{}
		for _, l := range lines {
			runes = append(runes, len([]rune(l)))
		}
		long["why"], long["problem_count"], long["problem_runes"] = row["why"], len(lines), runes
		if len(lines) > 0 {
			long["first_head"] = string([]rune(lines[0])[:4])
		}
	}
	long["progress_count"] = len(zzNotAccepted(h.progress))
	for _, line := range zzNotAccepted(h.progress) {
		rest := strings.TrimPrefix(line, "kogen: review 1: verdict not accepted: ")
		long["progress_prefix_ok"] = rest != line
		long["progress_runes"], long["progress_head"] = len([]rune(rest)), string([]rune(rest)[:4])
	}
	out["long"] = long

	in, h = newReview(t)
	h.answers = []*provider.Response{prose("done"), submitReview("{\"findings\":[]}"), submitReview("{\"verdict\":\"approve\",\"findings\":[]}")}
	ap, err = review.Independent{}.Review(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	out["mixed"] = map[string]any{"allowances": zzAllowances(h.events), "progress": zzNotAccepted(h.progress), "verdict": ap.Record.Verdict}

	b, _ := json.Marshal(out)
	if err := os.WriteFile(os.Getenv("ZZ_PROBLEMS_OUT"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}
`;

function runTest() {
  const root = process.cwd(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-rejected-'));
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
    fs.writeFileSync(path.join(dir, 'contract', 'zz_problems_test.go'), TEST);
    const output = path.join(dir, 'problems.json');
    const run = spawnSync('go', ['test', '-v', './contract', '-run', '^TestZZRejectedVerdictRecordsProblems$', '-count=1'], {
      cwd: dir, encoding: 'utf8', timeout: 220000, env: {...process.env, ZZ_PROBLEMS_OUT: output},
    });
    assert.equal(run.status, 0, `rejected-verdict test: ${COMMAND} failed with status ${run.status} ${run.error || ''}\n${run.stdout}\n${run.stderr}`);
    assert.ok(fs.existsSync(output), `rejected-verdict test: ${COMMAND} wrote no observations\n${run.stdout}\n${run.stderr}`);
    return {out: JSON.parse(fs.readFileSync(output, 'utf8')), log: `${run.stdout}${run.stderr}`};
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

if (require.main === module) {
  if (process.argv[2] !== '--control') throw new Error('usage: node ' + path.basename(__filename) + ' --control good|bad');
  control(process.argv[3]);
} else {
  const {When, Then} = require('@cucumber/cucumber');
  const when = (text, key) => When(prefix + text, {timeout: 240000}, function () {
    this.run = this.run || runTest();
    this.outcomeKey = key;
  });
  when('a scripted external reviewer first submits a verdict with no verdict value, then submits approve', 'external');
  when('a scripted native reviewer first submits a verdict with no verdict value, then submits approve', 'independent');
  when('a scripted native reviewer first submits a verdict with 12 findings whose paths are not files and are 400 characters long, then submits approve', 'long');
  when('a scripted native reviewer first answers without a tool call, then submits a verdict with no verdict value, then submits approve', 'mixed');
  Then(prefix + 'the outcome is:', function (doc) {
    assert.ok(this.run, 'the scripted review must run first');
    observe(this.run.out[this.outcomeKey], JSON.parse(doc), this.outcomeKey, this.run.log);
  });
}
