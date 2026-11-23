'use strict';
// Acceptance of review-cli-role-flag-forwarding: runs the repository's own Go tests of
// cmd/kogen-review against the real main.go and against mutated copies of main.go (applied with
// go test -overlay, so the checkout is never edited) and requires the tests to fail for each
// mutant. No test name is assumed: any correct test that pins the behavior passes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {When, Then} = require('@cucumber/cucumber');

const prefix = 'review-cli-role-flag-forwarding: ';
const ROOT = path.join(__dirname, '..', '..');
const MAIN = path.join(ROOT, 'cmd', 'kogen-review', 'main.go');

function goTest(overlay) {
  const args = ['test', '-count=1'];
  if (overlay) args.push('-overlay', overlay);
  args.push('./cmd/kogen-review');
  const r = spawnSync('go', args, {cwd: ROOT, encoding: 'utf8', timeout: 100000});
  return {command: 'go ' + args.join(' '), status: r.status, error: r.error, output: (r.stdout || '') + (r.stderr || '')};
}

function replaceOnce(src, from, to) {
  const i = src.indexOf(from);
  assert.ok(i >= 0, `main.go no longer contains ${JSON.stringify(from)}; the mutant cannot be built`);
  return src.slice(0, i) + to + src.slice(i + from.length);
}

const MUTANTS = {
  'ignores the supplied effort': s => replaceOnce(s, 'Effort: *effort,', 'Effort: "medium" + (*effort)[:0],'),
  'ignores the supplied base URL': s => replaceOnce(s, 'BaseURL: *baseURL}', 'BaseURL: (*baseURL)[:0]}'),
  'ignores the supplied provider': s => replaceOnce(s, 'Provider: *prov,', 'Provider: "chatgpt" + (*prov)[:0],'),
  'swaps the supplied model and effort': s => replaceOnce(s, 'Model: *model, Effort: *effort', 'Model: *effort, Effort: *model'),
  'defaults to another provider': s => replaceOnce(s, 'flags.String("provider", "chatgpt"', 'flags.String("provider", "supergrok"'),
  'defaults to another effort': s => replaceOnce(s, 'flags.String("effort", "medium"', 'flags.String("effort", "high"'),
  'defaults to an empty effort': s => replaceOnce(s, 'flags.String("effort", "medium"', 'flags.String("effort", ""'),
};

function rejects(names) {
  const src = fs.readFileSync(MAIN, 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcrf-'));
  const survivors = [];
  try {
    for (const name of names) {
      const file = path.join(dir, 'main.go');
      fs.writeFileSync(file, MUTANTS[name](src));
      const ov = path.join(dir, 'overlay.json');
      fs.writeFileSync(ov, JSON.stringify({Replace: {[MAIN]: file}}));
      const r = goTest(ov);
      assert.equal(r.error, undefined, `${name}: \`${r.command}\` could not run: ${r.error}`);
      assert.ok(!/\[build failed\]|\[setup failed\]/.test(r.output), `the mutant "${name}" did not compile (broken fixture)\n${r.output}`);
      const killed = r.status !== 0 && r.output.includes('--- FAIL:');
      if (!killed) survivors.push(name);
    }
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
  assert.deepEqual(survivors, [], `kogen-review tests still pass when the review ${survivors.join('; and when the review ')}`);
}

When(prefix + 'I run the Go tests of the kogen-review command', {timeout: 120000}, function () {
  this.rcrfRun = goTest(null);
});

Then(prefix + 'the Go tests of the kogen-review command pass', function () {
  const {command, status, error, output} = this.rcrfRun;
  assert.equal(error, undefined, `\`${command}\` could not run: ${error}`);
  assert.equal(status, 0, `\`${command}\` exited ${status}\n${output}`);
  assert.ok(/^ok\s/m.test(output), `\`${command}\` did not report ok\n${output}`);
});

Then(prefix + 'the tests reject a review that ignores or swaps a supplied role option', {timeout: 120000}, function () {
  rejects(['ignores the supplied effort', 'ignores the supplied base URL', 'ignores the supplied provider', 'swaps the supplied model and effort']);
});

Then(prefix + 'the tests reject a review that changes a documented default', {timeout: 120000}, function () {
  rejects(['defaults to another provider', 'defaults to another effort', 'defaults to an empty effort']);
});

Then(prefix + 'no file other than the kogen-review test file changed outside the Intent files', function () {
  const r = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', '.', ':!.kogen', ':!features'], {cwd: ROOT, encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
  const files = r.stdout.split('\n').filter(Boolean).map(l => l.slice(3));
  const others = files.filter(f => f !== 'cmd/kogen-review/main_test.go');
  assert.deepEqual(others, [], 'files changed besides cmd/kogen-review/main_test.go');
});
