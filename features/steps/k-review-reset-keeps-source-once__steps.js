'use strict';
// Acceptance of k-review-reset-keeps-source-once: a scripted native review whose conversation
// outgrows the request ceiling, run by the reset driver program below (`go run ./zz-reset-driver`)
// in a disposable copy of the checkout, through review.Independent over a scripted Env and a real
// temporary Git candidate. The scripted Env has no working window: like the provider client, it
// refuses before sending every request that does not fit the ceiling
// (candidate/context_budget_exceeded). `node <this file> --control good|bad` runs the observer
// controls alone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const prefix = 'k-review-reset-keeps-source-once: ';
const TEST = 'reset driver';
const COMMAND = 'go run ./zz-reset-driver';

// resetsOf are the sent requests that follow a refused one: the requests after a reset.
function resetsOf(rows) {
  const out = [];
  let sent = 0;
  rows.forEach((r, i) => {
    if (!r.sent) return;
    sent++;
    if (i > 0 && !rows[i - 1].sent) out.push({n: sent, before: rows[i - 1], row: r});
  });
  return out;
}

function observe(actual, expected) {
  const T = `${TEST} (${COMMAND} ${actual.mode})`;
  const rows = actual.rows || [];
  const sent = rows.filter(r => r.sent);
  assert.equal(sent.length, expected.sent, `${T}: requests the Env accepted (under the ceiling)`);
  assert.equal(rows.length - sent.length, expected.refusals, `${T}: requests the Env refused before sending (over the ceiling)`);
  if (expected.class) {
    assert.equal(actual.class, expected.class, `${T}: stop class (${actual.error})`);
    assert.equal(actual.reason, expected.reason, `${T}: stop reason (${actual.error})`);
    const refusals = actual.refusals || [];
    assert.equal(actual.error, refusals[refusals.length - 1], `${T}: the review stops with the Env's own refusal, unchanged`);
  } else {
    assert.equal(actual.error, '', `${T}: the review ends without a stop`);
  }
  assert.equal(actual.verdict, expected.verdict, `${T}: final verdict`);
  rows.forEach((r, i) => {
    if (r.sent) return;
    assert.ok(r.bytes > r.limit, `${T}: call ${r.n} was refused although its ${r.bytes} bytes fit the ${r.limit}-byte ceiling`);
    if (i < rows.length - 1) assert.ok(rows[i + 1].sent, `${T}: call ${r.n + 1}: the request after a reset was refused again`);
  });
  const resets = resetsOf(rows);
  assert.deepEqual(resets.map(x => x.n), expected.resets, `${T}: the sent requests that follow a working-context reset`);
  const archives = actual.archives || [];
  assert.equal(archives.length, expected.resets.length, `${T}: one custody record per reset in the retained session windows`);
  assert.deepEqual([...(actual.window_files || [])].sort(), archives.map(a => a.file).sort(), `${T}: the archived windows in the run folder are exactly the custody records`);
  const events = actual.events || [];
  assert.equal(events.length, expected.resets.length, `${T}: one review_window_reset event per reset`);
  resets.forEach((x, i) => {
    const a = archives[i], e = events[i], row = x.row;
    const where = `${T}: sent request ${x.n} after reset ${i + 1}`;
    assert.equal(a.file, `review-1-window-${i + 1}.json`, `${where}: custody record file name`);
    assert.equal(a.exists, true, `${where}: archived window ${a.file} exists in the run folder`);
    assert.equal(a.sha256_ok, true, `${where}: archived window ${a.file} matches its recorded SHA-256`);
    assert.equal(a.sha256, x.before.input_sha256, `${where}: the custody record is exactly the conversation of the refused request`);
    assert.equal(a.opening, true, `${where}: archived window ${a.file} starts with the mandatory opening`);
    assert.equal(a.after, expected.after[i], `${where}: the newest item of archived window ${a.file} answers this tool`);
    assert.ok(row.bytes <= row.limit, `${where}: ${row.bytes} bytes must fit the inclusive ${row.limit}-byte ceiling`);
    assert.equal(row.prefix, true, `${where}: starts with the unchanged mandatory opening`);
    assert.deepEqual(row.after_opening, expected.carried[i], `${where}: items carried after the mandatory opening`);
    assert.deepEqual(row.parts, expected.parts, `${where}: occurrences of each source part`);
    assert.deepEqual(row.refs, expected.refs, `${where}: occurrences of each source reference`);
    assert.equal(row.feedback, expected.feedback[i], `${where}: occurrences of the rejected-verdict feedback`);
    assert.equal(row.windows, i + 1, `${where}: custody records retained with the request`);
    if (row.after_opening.includes('handoff')) {
      assert.ok(row.handoff_bytes > 0 && row.handoff_bytes <= expected.handoff_max, `${where}: handoff of ${row.handoff_bytes} bytes must be bounded by ${expected.handoff_max}`);
      assert.deepEqual(row.window_counts, Array.from({length: i + 1}, (_, j) => (j === i ? 1 : 0)), `${where}: the handoff names the newest custody record once and no earlier one`);
      const h = row.handoff || {};
      assert.equal(h.version, 1, `${where}: handoff version`);
      assert.equal(h.review, 1, `${where}: handoff review number`);
      assert.deepEqual(h.window, {file: a.file, sha256: a.sha256}, `${where}: handoff custody reference`);
      assert.equal(h.unread_parts, expected.unread_parts[i], `${where}: handoff unread part count`);
    } else {
      assert.equal(row.handoff_bytes, 0, `${where}: no handoff bytes without a handoff`);
      assert.ok(row.window_counts.every(c => c === 0), `${where}: no custody record named without a handoff`);
    }
    assert.equal(e.review, 1, `${where}: review_window_reset event review`);
    assert.equal(e.window, a.file, `${where}: review_window_reset event names its archived window`);
    assert.equal(e.trigger, expected.after[i], `${where}: review_window_reset event trigger`);
    assert.equal(e.bytes_before, x.before.bytes, `${where}: review_window_reset event bytes_before is the refused request`);
    assert.equal(e.bytes_after, row.bytes, `${where}: review_window_reset event bytes_after is the request sent`);
    assert.equal(e.mandatory_bytes, row.mandatory_bytes, `${where}: review_window_reset event mandatory_bytes`);
    assert.equal(e.handoff_bytes, row.handoff_bytes, `${where}: review_window_reset event handoff_bytes`);
    assert.equal(e.ceiling, row.limit, `${where}: review_window_reset event ceiling`);
  });
  let count = 0, sentN = 0;
  rows.forEach((r, i) => {
    if (!r.sent) return;
    sentN++;
    if (i > 0 && !rows[i - 1].sent) { count++; return; }
    assert.equal(r.windows, count, `${T}: sent request ${sentN}: custody records retained with the request`);
    assert.equal(r.extends, true, `${T}: sent request ${sentN} without a reset must extend the previous request unchanged`);
  });
  for (const [a, b] of expected.steady || []) {
    const first = sent[a - 1], second = sent[b - 1];
    assert.ok(first && second && second.handoff_bytes <= first.handoff_bytes,
      `${T}: the handoff of sent request ${b} (${second && second.handoff_bytes} bytes) must not grow over the handoff of sent request ${a} (${first && first.handoff_bytes} bytes)`);
  }
  if (expected.items) assert.deepEqual(sent.map(r => r.after_opening.length), expected.items, `${T}: conversation items after the opening of each sent request`);
  if (expected.bytes) assert.deepEqual(sent.map(r => r.bytes), expected.bytes, `${T}: bytes of each sent request`);
  if (expected.resets.length === 0) {
    for (const r of rows) {
      const keys = r.retained_keys || [];
      assert.ok(!keys.includes('windows') && !keys.includes('reset_unread'), `${T}: call ${r.n}: a session that never reset retains no reset fields (${keys.join(', ')})`);
    }
  }
  if (expected.rejections) assert.deepEqual(actual.rejections || [], expected.rejections, `${T}: rejected verdict outputs the reviewer received`);
  if (expected.rejected_verdicts !== undefined) assert.equal(actual.rejected_verdicts || 0, expected.rejected_verdicts, `${T}: rejected-verdict allowance in the retained session`);
}

function report(actual) {
  return resetsOf(actual.rows || []).map(x =>
    `${prefix}case ${actual.mode}: sent request ${x.n} after a reset: ${x.row.bytes} bytes = mandatory ${x.row.mandatory_bytes} + handoff ${x.row.handoff_bytes}; ceiling ${x.row.limit}; the refused request was ${x.before.bytes} bytes`);
}

// Control fixtures: the expectations of the feature's scenarios and conforming observations.
const CASES = {
  points: {sent: 7, refusals: 4, resets: [4, 5, 6, 7], after: ['read_file', 'shell', 'submit_review', 'read_file'], carried: [['handoff'], ['handoff'], ['handoff', 'feedback'], ['handoff']], unread_parts: [0, 0, 0, 0], parts: [1, 1, 1], refs: [1, 1, 1], feedback: [0, 0, 1, 0], handoff_max: 2048, steady: [[4, 5], [6, 7]], verdict: 'approve', rejected_verdicts: 1},
  pinned: {sent: 5, refusals: 1, resets: [3], after: ['read_file'], carried: [['handoff']], unread_parts: [1], parts: [0, 0, 0], refs: [1, 1, 1], feedback: [0], handoff_max: 2048, verdict: 'approve', rejected_verdicts: 1, rejections: ['invalid verdict:\nRead all pinned source evidence before approving: 1 unread part(s); use read_file on src/part-3.txt']},
  tight: {sent: 2, refusals: 1, resets: [2], after: ['read_file'], carried: [[]], unread_parts: [null], parts: [1, 1, 1], refs: [1, 1, 1], feedback: [0], handoff_max: 2048, verdict: 'approve', rejected_verdicts: 0},
  mandatory: {sent: 0, refusals: 1, resets: [], after: [], verdict: '', class: 'candidate', reason: 'context_budget_exceeded'},
  fits: {sent: 2, refusals: 0, resets: [], after: [], items: [0, 2], bytes: [45194, 50605], verdict: 'approve', rejected_verdicts: 0},
};

function sample(mode) {
  const e = CASES[mode], rows = [], archives = [], events = [];
  let call = 0, k = 0;
  const push = r => rows.push(Object.assign({n: ++call, limit: 524288, prefix: true, parts: [1, 1, 1], refs: [1, 1, 1], feedback: 0, handoff: null, window_counts: Array(k).fill(0), windows: k, retained_keys: k ? ['input', 'windows'] : ['input'], extends: true, input_sha256: 'x'}, r));
  for (let n = 1; n <= e.sent; n++) {
    if (!e.resets.includes(n)) {
      const bytes = e.bytes ? e.bytes[n - 1] : 45000;
      push({sent: true, bytes, mandatory_bytes: bytes, handoff_bytes: 0, after_opening: Array(e.items ? e.items[n - 1] : (n === 1 ? 0 : 2)).fill('function_call')});
      continue;
    }
    const sha = 'a'.repeat(63) + k;
    push({sent: false, bytes: 530000, mandatory_bytes: 530000, handoff_bytes: 0, after_opening: ['function_call', 'function_call_output'], input_sha256: sha});
    k++;
    const file = `review-1-window-${k}.json`, carried = e.carried[k - 1], has = carried.includes('handoff');
    const ho = has ? 900 : 0, mand = 45000 + 60 * e.feedback[k - 1];
    archives.push({file, sha256: sha, exists: true, sha256_ok: true, opening: true, after: e.after[k - 1]});
    events.push({event: 'review_window_reset', review: 1, window: file, trigger: e.after[k - 1], bytes_before: 530000, bytes_after: mand + ho, mandatory_bytes: mand, handoff_bytes: ho, ceiling: 524288});
    push({sent: true, bytes: mand + ho, mandatory_bytes: mand, handoff_bytes: ho, after_opening: carried, parts: e.parts, refs: e.refs, feedback: e.feedback[k - 1], extends: false,
      window_counts: Array.from({length: k}, (_, j) => (has && j === k - 1 ? 1 : 0)),
      handoff: has ? {version: 1, review: 1, window: {file, sha256: sha}, unread_parts: e.unread_parts[k - 1], note: 'n'} : null});
  }
  const refusals = [];
  if (e.class) {
    push({sent: false, bytes: 645196, mandatory_bytes: 645196, handoff_bytes: 0, after_opening: []});
    refusals.push('candidate/context_budget_exceeded: fixture provider: refused');
  }
  return {mode, rows, verdict: e.verdict, error: refusals.length ? refusals[0] : '', class: e.class || '', reason: e.reason || '', refusals,
    rejections: e.rejections || [], rejected_verdicts: e.rejected_verdicts, archives, window_files: archives.map(a => a.file), events};
}

const post = (o, i) => resetsOf(o.rows)[i].row;
const MUTATIONS = [
  ['points', 'a duplicated source part after a reset', o => { post(o, 0).parts = [2, 1, 1]; }],
  ['points', 'a reference repeated after a reset', o => { post(o, 1).refs = [1, 2, 1]; }],
  ['points', 'the newest exchange carried after a reset', o => { post(o, 2).after_opening = ['handoff', 'feedback', 'function_call', 'function_call_output']; }],
  ['points', 'a request over the ceiling after a reset', o => { post(o, 3).bytes = 600000; o.events[3].bytes_after = 600000; }],
  ['points', 'a handoff that grows on the next reset', o => { const r = post(o, 1); r.handoff_bytes += 80; r.bytes += 80; o.events[1].handoff_bytes += 80; o.events[1].bytes_after += 80; }],
  ['points', 'lost rejected-verdict feedback', o => { post(o, 2).feedback = 0; }],
  ['points', 'rejected-verdict feedback carried twice', o => { post(o, 2).feedback = 2; }],
  ['points', 'an unbounded handoff', o => { const r = post(o, 0); r.handoff_bytes = 9000; r.bytes = 54000; o.events[0].handoff_bytes = 9000; o.events[0].bytes_after = 54000; }],
  ['points', 'a missing custody record', o => { o.archives.pop(); o.window_files.pop(); }],
  ['points', 'a custody record that is not the refused conversation', o => { o.archives[1].sha256 = 'b'.repeat(64); }],
  ['points', 'an archive whose hash does not match', o => { o.archives[1].sha256_ok = false; }],
  ['points', 'a reset event with another trigger', o => { o.events[2].trigger = 'shell'; }],
  ['points', 'a reset event whose bytes_before is not the refused request', o => { o.events[0].bytes_before = 1; }],
  ['points', 'an earlier custody record referenced again', o => { post(o, 2).window_counts = [0, 1, 1]; }],
  ['points', 'a stop at the first refusal instead of a reset', o => { o.rows = o.rows.slice(0, 4); o.error = o.rows.length && 'candidate/context_budget_exceeded: x'; o.refusals = [o.error]; o.class = 'candidate'; o.reason = 'context_budget_exceeded'; o.verdict = ''; o.archives = []; o.window_files = []; o.events = []; }],
  ['points', 'a request after a reset refused again', o => { post(o, 0).sent = false; }],
  ['points', 'a conversation rebuilt between resets', o => { o.rows[1].extends = false; }],
  ['pinned', 'approval of an unread part', o => { o.rejections = []; o.rejected_verdicts = 0; }],
  ['pinned', 'a read part forgotten after the reset', o => { o.rejections = ['invalid verdict:\nRead all pinned source evidence before approving: 3 unread part(s); use read_file on src/part-1.txt, src/part-2.txt, src/part-3.txt']; }],
  ['pinned', 'an undelivered read counted as read after the reset', o => { post(o, 0).handoff.unread_parts = 0; }],
  ['pinned', 'pinned source text repeated after a reset', o => { post(o, 0).parts = [0, 0, 1]; }],
  ['tight', 'a handoff sent although only the mandatory material fits', o => { const r = post(o, 0); r.after_opening = ['handoff']; }],
  ['tight', 'no reset when only the mandatory material fits', o => { o.rows = o.rows.slice(0, 2); o.error = 'candidate/context_budget_exceeded: x'; o.refusals = [o.error]; o.class = 'candidate'; o.reason = 'context_budget_exceeded'; o.verdict = ''; o.archives = []; o.window_files = []; o.events = []; }],
  ['mandatory', 'an oversized mandatory request that was sent', o => { o.rows[0].sent = true; }],
  ['mandatory', 'a refusal of another reason', o => { o.reason = 'review_invalid'; }],
  ['mandatory', "a stop that is not the Env's own refusal", o => { o.error = 'candidate/context_budget_exceeded: review: another text'; }],
  ['mandatory', 'a custody record written for a refused mandatory request', o => { o.window_files = ['review-1-window-1.json']; }],
  ['fits', 'a request whose bytes changed without outgrowing the ceiling', o => { o.rows[1].bytes += 1; }],
  ['fits', 'a conversation rebuilt without a reset', o => { o.rows[1].extends = false; }],
  ['fits', 'an archive written without a reset', o => { o.window_files = ['review-1-window-1.json']; }],
  ['fits', 'reset fields in a session that never reset', o => { o.rows[1].retained_keys = ['input', 'windows']; }],
];

function control(which) {
  for (const mode of Object.keys(CASES)) observe(sample(mode), CASES[mode]);
  for (const [mode, what, mutate] of MUTATIONS) {
    const bad = structuredClone(sample(mode));
    mutate(bad);
    assert.throws(() => observe(bad, CASES[mode]), undefined, `the observer must reject ${what}`);
  }
  if (which === 'bad') {
    const [mode, what, mutate] = MUTATIONS[0];
    const bad = structuredClone(sample(mode));
    mutate(bad);
    try { observe(bad, CASES[mode]); } catch { console.log('reset observer rejected ' + what); process.exitCode = 1; return; }
    throw new Error('reset observer accepted ' + what);
  }
  console.log('reset observer accepted controls');
}

// The Go driver program, written to zz-reset-driver/main.go of the disposable copy. It uses only
// the public API of package review and its dependencies.
const DRIVER = String.raw`// Command zz-reset-driver runs one scripted native review whose conversation outgrows the
// request ceiling and writes its observations as JSON: zz-reset-driver <case> <output>.
// Its Env refuses, before sending, every request that does not fit the ceiling, as the
// provider client does (candidate/context_budget_exceeded), and has no working window.
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
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
	"kogen-loop/provider"
	"kogen-loop/sys"
	"kogen-loop/tools"
)

const handoffHeader = "Kogen review working-context reset\n"

var parts = []string{"src/part-1.txt", "src/part-2.txt", "src/part-3.txt"}

var role = project.Role{Provider: "chatgpt", Model: "fixture-review-model", Effort: "medium"}

type env struct {
	dir      string
	mode     string
	refs     []string
	opening  []any
	rows     []map[string]any
	steps    []string
	sent     int
	last     []any
	retained map[string]any
	// rejections are the rejected-verdict outputs the reviewer received; refusals the
	// refusals this Env returned, in order.
	rejections []string
	refusals   []string
	events     []map[string]any
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

func (h *env) Prepare(tree string, m review.MaterialSet, role project.Role, instructions string, defs, diagnostic []any) ([]any, error) {
	text := "AUTHORITY\n" + m.Authority + "\n"
	if h.mode != "pinned" {
		text += m.Source + "\n"
	}
	text += "# Pinned candidate source catalog\n" + strings.Join(h.refs, "\n") + "\n"
	switch h.mode {
	case "mandatory":
		text += strings.Repeat("M", 600000) + "\n"
	case "tight":
		// The opening request leaves exactly 200 bytes under the ceiling: it fits, with no room
		// for a handoff.
		r := review.Request{Role: role, Instructions: instructions, Tools: defs}
		base, limit := measure(r, []any{map[string]any{"role": "user", "content": text}})
		text += strings.Repeat("M", limit-200-base)
		if got, _ := measure(r, []any{map[string]any{"role": "user", "content": text}}); got != limit-200 {
			return nil, fmt.Errorf("fixture: tight opening request is %d bytes, want %d", got, limit-200)
		}
	}
	h.opening = []any{map[string]any{"role": "user", "content": text}}
	return h.opening, nil
}

// delivered reports whether a read output carrying marker reached the model: a later model item
// follows it in input.
func delivered(input []any, marker string) bool {
	seen := false
	for _, item := range input {
		m, _ := item.(map[string]any)
		if seen && (m["type"] == "function_call" || (m["type"] == "message" && m["role"] == "assistant")) {
			return true
		}
		if out, _ := m["output"].(string); m["type"] == "function_call_output" && strings.Contains(out, marker) {
			seen = true
		}
	}
	return false
}

func (h *env) Unread(input []any) ([]string, error) {
	if h.mode != "pinned" {
		return nil, nil
	}
	var unread []string
	for i, p := range parts {
		if !delivered(input, fmt.Sprintf("SOURCE-PART-%d ", i+1)) {
			unread = append(unread, p)
		}
	}
	return unread, nil
}

func (h *env) Delivered([]any) error { return nil }
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
func (h *env) Event(e map[string]any)              { h.events = append(h.events, e) }
func (h *env) Err() error                          { return nil }

// Write writes a file of the run folder as JSON.
func (h *env) Write(name string, data any) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(h.dir, name), b, 0o600)
}

func call(n, k int, name, args string) map[string]any {
	return map[string]any{"type": "function_call", "call_id": fmt.Sprintf("reset-call-%d-%d", n, k), "name": name, "arguments": args}
}

// kind names an item after the opening: the handoff, the rejected-verdict feedback, or the
// item's type (role for a message without one).
func kind(item any) string {
	m, _ := item.(map[string]any)
	text, _ := m["content"].(string)
	switch {
	case m["role"] == "user" && strings.HasPrefix(text, handoffHeader):
		return "handoff"
	case m["role"] == "user" && strings.Contains(text, "missing.txt is not a file of the repository"):
		return "feedback"
	case m["type"] != nil:
		return fmt.Sprint(m["type"])
	}
	return fmt.Sprint(m["role"])
}

func (h *env) Request(ctx context.Context, r review.Request) (*provider.Response, []any, error) {
	n := len(h.rows) + 1
	bytes, limit := measure(r, r.Input)
	encoded := encode(r.Input)
	raw, err := r.Retain(r.Input)
	if err != nil {
		return nil, nil, err
	}
	h.retained = map[string]any{}
	if err := json.Unmarshal(raw, &h.retained); err != nil {
		return nil, nil, err
	}
	windows, _ := h.retained["windows"].([]any)
	prefix := len(r.Input) >= len(h.opening) && encode(r.Input[:len(h.opening)]) == encode(h.opening)
	kinds := []string{}
	var handoff any
	withoutHandoff := []any{}
	for i, item := range r.Input {
		if i >= len(h.opening) || !prefix {
			k := kind(item)
			kinds = append(kinds, k)
			if k == "handoff" {
				m, _ := item.(map[string]any)
				text, _ := m["content"].(string)
				var doc any
				if json.Unmarshal([]byte(strings.TrimPrefix(text, handoffHeader)), &doc) != nil {
					doc = "unparsable"
				}
				handoff = doc
				continue
			}
		}
		withoutHandoff = append(withoutHandoff, item)
	}
	mandatory, _ := measure(r, withoutHandoff)
	partCounts, refCounts, wins := []int{}, []int{}, []int{}
	for i := range parts {
		partCounts = append(partCounts, strings.Count(encoded, fmt.Sprintf("SOURCE-PART-%d ", i+1)))
		refCounts = append(refCounts, strings.Count(encoded, fmt.Sprintf("REFERENCE-%d ", i+1)))
	}
	for _, w := range windows {
		file, _ := w.(map[string]any)["file"].(string)
		wins = append(wins, strings.Count(encoded, file))
	}
	for _, item := range r.Input {
		m, _ := item.(map[string]any)
		if out, _ := m["output"].(string); m["type"] == "function_call_output" && strings.HasPrefix(out, "invalid verdict") {
			if len(h.rejections) == 0 || h.rejections[len(h.rejections)-1] != out {
				h.rejections = append(h.rejections, out)
			}
		}
	}
	archive, err := core.EncodeJSON(map[string]any{"input": r.Input})
	if err != nil {
		return nil, nil, err
	}
	// extends: the previous sent request is an unchanged prefix of this one.
	extends := h.sent == 0 || (len(r.Input) >= len(h.last) && encode(r.Input[:len(h.last)]) == encode(h.last))
	keys := []string{}
	for k := range h.retained {
		keys = append(keys, k)
	}
	row := map[string]any{
		"n": n, "sent": bytes <= limit, "bytes": bytes, "limit": limit, "mandatory_bytes": mandatory, "handoff_bytes": bytes - mandatory,
		"prefix": prefix, "after_opening": kinds, "handoff": handoff, "parts": partCounts, "refs": refCounts,
		"windows": len(windows), "window_counts": wins, "input_sha256": core.HashHex(archive),
		"feedback": strings.Count(encoded, "missing.txt is not a file of the repository"), "retained_keys": keys, "extends": extends,
	}
	h.rows = append(h.rows, row)
	if bytes > limit {
		e := sys.Fail("candidate", "context_budget_exceeded", fmt.Sprintf("fixture provider: complete next request %d bytes exceeds %d; nothing was sent", bytes, limit), 1)
		h.refusals = append(h.refusals, e.Error())
		return nil, nil, e
	}
	h.sent++
	h.last = r.Input
	if h.sent > len(h.steps) {
		return nil, nil, fmt.Errorf("fixture: no scripted answer for sent request %d", h.sent)
	}
	var items []map[string]any
	step := h.steps[h.sent-1]
	if strings.HasPrefix(step, "fill+") {
		step = strings.TrimPrefix(step, "fill+")
		text := fmt.Sprintf("FILLER-%d ", h.sent) + strings.Repeat("w", limit-bytes+1000)
		items = append(items, map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": text}}})
	}
	for k, s := range strings.Split(step, ",") {
		switch {
		case strings.HasPrefix(s, "read:"):
			items = append(items, call(h.sent, k, "read_file", encode(map[string]any{"path": parts[s[5]-'1']})))
		case s == "shell":
			items = append(items, call(h.sent, k, "shell", encode(map[string]any{"command": "printf shell-result-ok"})))
		case s == "bad":
			items = append(items, call(h.sent, k, "submit_review", encode(map[string]any{"verdict": "approve", "findings": []any{map[string]any{"path": "missing.txt", "line": 1, "severity": "note", "message": "fixture"}}})))
		case s == "approve":
			items = append(items, call(h.sent, k, "submit_review", encode(map[string]any{"verdict": "approve", "findings": []any{}})))
		}
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

// candidate is a saved candidate that adds the three source parts and changes app.txt.
func candidate(root string) (review.Input, string, []string) {
	git(root, "init", "-q", "-b", "main")
	write(filepath.Join(root, ".gitignore"), ".kogen/local/\n")
	write(filepath.Join(root, "app.txt"), "start\n")
	write(filepath.Join(root, project.FeaturePath("fixture")), "Feature: Fixture\n")
	git(root, "add", "-A")
	git(root, "commit", "-q", "-m", "start")
	start := git(root, "rev-parse", "HEAD")
	write(filepath.Join(root, "app.txt"), "candidate\n")
	var refs []string
	for i, p := range parts {
		text := fmt.Sprintf("SOURCE-PART-%d of the candidate\n", i+1) + strings.Repeat(strings.Repeat("p", 59)+"\n", 80)
		write(filepath.Join(root, p), text)
		refs = append(refs, fmt.Sprintf("REFERENCE-%d %s sha256=%s", i+1, p, core.HashHex([]byte(text))))
	}
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
	return in, dir, refs
}

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: zz-reset-driver <case> <output>")
		os.Exit(2)
	}
	mode, output := os.Args[1], os.Args[2]
	scripts := map[string][]string{
		"points":    {"read:1", "shell", "fill+read:2", "fill+shell", "fill+bad", "fill+read:3", "approve"},
		"pinned":    {"read:1,read:2", "fill+read:3", "approve", "read:3", "approve"},
		"tight":     {"read:1", "approve"},
		"mandatory": {"approve"},
		"fits":      {"read:1", "approve"},
	}
	steps, ok := scripts[mode]
	if !ok {
		fmt.Fprintf(os.Stderr, "zz-reset-driver: case %q is not one of points, pinned, tight, mandatory, fits\n", mode)
		os.Exit(2)
	}
	root, err := os.MkdirTemp("", "reset-candidate-")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(root)
	in, dir, refs := candidate(root)
	h := &env{dir: dir, mode: mode, refs: refs, steps: steps}
	result, err := (review.Independent{}).Review(context.Background(), in, h)
	data := map[string]any{"mode": mode, "rows": h.rows, "verdict": result.Record.Verdict, "error": "", "class": "", "reason": "", "rejections": h.rejections, "refusals": h.refusals}
	if err != nil {
		data["error"] = err.Error()
		if e, ok := sys.AsError(err); ok {
			data["class"], data["reason"] = e.Class, e.Reason
		}
	}
	if h.retained != nil {
		data["rejected_verdicts"] = h.retained["rejected_verdicts"]
	}
	var archives []map[string]any
	windows, _ := h.retained["windows"].([]any)
	for _, w := range windows {
		ref, _ := w.(map[string]any)
		file, _ := ref["file"].(string)
		sum, _ := ref["sha256"].(string)
		a := map[string]any{"file": file, "sha256": sum, "exists": false, "sha256_ok": false, "after": "", "opening": false}
		if b, err := os.ReadFile(filepath.Join(dir, file)); err == nil && filepath.Base(file) == file {
			a["exists"] = true
			var doc map[string]any
			dec := json.NewDecoder(strings.NewReader(string(b)))
			dec.UseNumber()
			if dec.Decode(&doc) == nil {
				if canon, err := core.EncodeJSON(doc); err == nil {
					a["sha256_ok"] = core.HashHex(canon) == sum
				}
				input, _ := doc["input"].([]any)
				a["opening"] = len(input) > 0 && encode(input[0]) == encode(h.opening[0])
				if len(input) > 0 {
					last, _ := input[len(input)-1].(map[string]any)
					for _, item := range input {
						m, _ := item.(map[string]any)
						if m["type"] == "function_call" && m["call_id"] == last["call_id"] {
							a["after"] = m["name"]
						}
					}
				}
			}
		}
		archives = append(archives, a)
	}
	data["archives"] = archives
	files := []string{}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.Contains(e.Name(), "window") {
			files = append(files, e.Name())
		}
	}
	data["window_files"] = files
	events := []map[string]any{}
	for _, e := range h.events {
		if e["event"] == "review_window_reset" {
			events = append(events, e)
		}
	}
	data["events"] = events
	out, err := json.Marshal(data)
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(output, out, 0o600); err != nil {
		panic(err)
	}
}
`;

function runCase(mode) {
  const root = process.cwd(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-reset-'));
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
    fs.mkdirSync(path.join(dir, 'zz-reset-driver'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'zz-reset-driver', 'main.go'), DRIVER);
    const output = path.join(dir, 'reset.json');
    const run = spawnSync('go', ['run', './zz-reset-driver', mode, output], {cwd: dir, encoding: 'utf8', timeout: 220000});
    assert.equal(run.status, 0, `${TEST}: ${COMMAND} ${mode} failed with status ${run.status} ${run.error || ''}\n${run.stdout}\n${run.stderr}`);
    assert.ok(fs.existsSync(output), `${TEST}: ${COMMAND} ${mode} exited 0 without writing its observations\n${run.stdout}\n${run.stderr}`);
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
  When(prefix + 'the scripted review case {string} runs', {timeout: 240000}, function (mode) {
    assert.ok(Object.keys(CASES).includes(mode), `unknown case ${mode}`);
    this.resetOutcome = runCase(mode);
  });
  Then(prefix + 'the reset outcome is:', function (doc) {
    assert.ok(this.resetOutcome, 'the scripted review case must run first');
    for (const line of report(this.resetOutcome)) console.log(line);
    observe(this.resetOutcome, JSON.parse(doc));
  });
}
