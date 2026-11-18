'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { Given, When, Then } = require('@cucumber/cucumber');

const TEST_FILE = 'review/reminder_test.go';
const SOURCE_FILE = 'review/reminder.go';

const REVERSE_HELPER = '\nfunc rev(s []string) []string {\n\tr := make([]string, len(s))\n\tfor i, v := range s {\n\t\tr[len(s)-1-i] = v\n\t}\n\treturn r\n}\n';

// Each mutation is a plausible wrong reminder.go, named by the sentence of the scenario.
const MUTATIONS = {
  'reminderTool never forces read_file': [['return "read_file"', 'return SubmitReviewTool']],
  'the problems are joined by a comma and a space': [['strings.Join(problems, "; ")', 'strings.Join(problems, ", ")']],
  'the count of unread parts is dropped': [['len(unread), strings.Join(', '0, strings.Join(']],
  'the named unread ids are reversed': [
    ['unread[:min(maxReminderParts, len(unread))]', 'rev(unread[:min(maxReminderParts, len(unread))])'],
    ['', REVERSE_HELPER],
  ],
  'the cap on named unread ids is removed': [['strings.Join(unread[:min(maxReminderParts, len(unread))], ", ")', 'strings.Join(unread, ", ")']],
  'the cap is applied to the unread count instead of the names': [['len(unread), strings.Join(', 'min(maxReminderParts, len(unread)), strings.Join(']],
};

function root() {
  return fs.realpathSync(process.cwd());
}

function mutatedSource(dir, description) {
  let text = fs.readFileSync(path.join(dir, SOURCE_FILE), 'utf8');
  for (const [from, to] of MUTATIONS[description]) {
    if (from === '') {
      text += to;
      continue;
    }
    assert.ok(text.includes(from), `climb-review-900: ${SOURCE_FILE} no longer contains ${JSON.stringify(from)}, so the mutation "${description}" cannot be applied`);
    text = text.replace(from, to);
  }
  return text;
}

// Runs only review/reminder_test.go (every other test file of package review is hidden by a
// Go overlay) against reminder.go, optionally mutated, and parses the go test -json events.
function runReminderTests(world, description) {
  const dir = root();
  assert.ok(fs.existsSync(path.join(dir, TEST_FILE)), `climb-review-900: ${TEST_FILE} does not exist`);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'climb-review-900-'));
  const replace = {};
  for (const name of fs.readdirSync(path.join(dir, 'review'))) {
    if (name.endsWith('_test.go') && name !== 'reminder_test.go') {
      replace[path.join(dir, 'review', name)] = '';
    }
  }
  if (description !== undefined) {
    const mutated = path.join(scratch, 'reminder.go');
    fs.writeFileSync(mutated, mutatedSource(dir, description));
    replace[path.join(dir, SOURCE_FILE)] = mutated;
  }
  const overlay = path.join(scratch, 'overlay.json');
  fs.writeFileSync(overlay, JSON.stringify({ Replace: replace }));
  const args = ['test', '-count=1', '-overlay', overlay, '-json', './review'];
  const run = spawnSync('go', args, { cwd: dir, env: { ...process.env, PWD: dir }, encoding: 'utf8', timeout: 100000, maxBuffer: 64 * 1024 * 1024 });
  fs.rmSync(scratch, { recursive: true, force: true });
  const events = [];
  for (const line of (run.stdout || '').split('\n')) {
    if (line.trim() === '') continue;
    try {
      events.push(JSON.parse(line));
    } catch (e) {
      // not a test event line
    }
  }
  world.run = {
    command: `go ${args.join(' ')}`,
    status: run.status,
    error: run.error ? String(run.error) : '',
    events,
    raw: `${run.stdout || ''}${run.stderr || ''}`,
    mutation: description === undefined ? 'none' : description,
  };
}

function testEvents(world, action) {
  return world.run.events.filter((e) => e.Test && e.Action === action);
}

function git(dir, args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
}

function outsideIntentAndSteps(p) {
  return !p.startsWith('.kogen/') && !p.startsWith('features/steps/');
}

Given('climb-review-900: the review package with reminder.go', function () {
  const dir = root();
  const text = fs.readFileSync(path.join(dir, SOURCE_FILE), 'utf8');
  assert.ok(text.includes('func reminderTool(') && text.includes('func reminderText('), `climb-review-900: ${SOURCE_FILE} lacks reminderTool or reminderText`);
});

When('climb-review-900: only review\\/reminder_test.go is run against the current reminder.go', function () {
  runReminderTests(this);
});

When('climb-review-900: only review\\/reminder_test.go is run against a reminder.go where {string}', function (description) {
  assert.ok(MUTATIONS[description], `climb-review-900: unknown mutation ${JSON.stringify(description)}`);
  runReminderTests(this, description);
});

Then('climb-review-900: at least one test passes and none fails or is skipped', function () {
  const r = this.run;
  const passed = testEvents(this, 'pass');
  const failed = testEvents(this, 'fail');
  const skipped = testEvents(this, 'skip');
  const detail = `${r.command} (mutation: ${r.mutation}, exit ${r.status}${r.error ? ', ' + r.error : ''})\n${r.raw.slice(0, 4000)}`;
  assert.strictEqual(failed.length, 0, `climb-review-900: tests failed: ${failed.map((e) => e.Test).join(', ')}\n${detail}`);
  assert.strictEqual(skipped.length, 0, `climb-review-900: tests skipped: ${skipped.map((e) => e.Test).join(', ')}\n${detail}`);
  assert.ok(passed.length >= 1, `climb-review-900: no test passed\n${detail}`);
  assert.strictEqual(r.status, 0, `climb-review-900: go test exited ${r.status}\n${detail}`);
});

Then('climb-review-900: a test of review\\/reminder_test.go fails', function () {
  const r = this.run;
  const failed = testEvents(this, 'fail');
  const detail = `${r.command} (mutation: ${r.mutation}, exit ${r.status}${r.error ? ', ' + r.error : ''})\n${r.raw.slice(0, 4000)}`;
  assert.ok(failed.length > 0, `climb-review-900: no test failed against the mutated reminder.go "${r.mutation}", so the tests would not notice that change\n${detail}`);
  assert.notStrictEqual(r.status, 0, `climb-review-900: go test exited 0 against the mutated reminder.go "${r.mutation}"\n${detail}`);
});

// The checkout may hold the new file as untracked, staged or already committed (a verification
// copy may commit the candidate), so the check accepts each of those forms: whatever git status
// still reports outside .kogen/ and features/steps/ must be only the test file, and the test file
// must exist; when the candidate is already committed on top of a parent commit, that commit
// must add outside .kogen/ and features/steps/ only the test file.
Then('climb-review-900: review\\/reminder_test.go is the only file added outside the Intent and its steps', function () {
  const dir = root();
  assert.ok(fs.existsSync(path.join(dir, TEST_FILE)), `climb-review-900: ${TEST_FILE} does not exist`);
  const status = git(dir, ['status', '--porcelain', '--untracked-files=all']);
  assert.strictEqual(status.status, 0, `climb-review-900: git status failed: ${status.stderr}`);
  const lines = status.stdout.split('\n').filter((l) => l !== '').filter((l) => outsideIntentAndSteps(l.slice(3)));
  const others = lines.filter((l) => l.slice(3) !== TEST_FILE);
  assert.deepStrictEqual(others, [], `climb-review-900: changed paths outside .kogen/ and features/steps/ other than ${TEST_FILE}: ${JSON.stringify(lines)}`);
  if (lines.length > 0) {
    return;
  }
  // Nothing is pending: the test file must then be committed.
  const tracked = git(dir, ['ls-tree', '--name-only', 'HEAD', '--', TEST_FILE]);
  assert.strictEqual(tracked.stdout.trim(), TEST_FILE, `climb-review-900: ${TEST_FILE} is neither pending nor committed in git`);
  const parent = git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD~1']);
  if (parent.status !== 0) {
    return;
  }
  const diff = git(dir, ['diff', '--name-only', '--no-renames', 'HEAD~1', 'HEAD']);
  assert.strictEqual(diff.status, 0, `climb-review-900: git diff failed: ${diff.stderr}`);
  const added = diff.stdout.split('\n').filter((p) => p !== '').filter(outsideIntentAndSteps);
  if (added.includes(TEST_FILE)) {
    assert.deepStrictEqual(added, [TEST_FILE], `climb-review-900: the commit changes paths outside .kogen/ and features/steps/: ${JSON.stringify(added)}`);
  }
});
