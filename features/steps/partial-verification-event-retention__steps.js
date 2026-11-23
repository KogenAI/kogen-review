'use strict';
// Acceptance of partial-verification-event-retention: runs the repository's own Go tests of
// cmd/kogen-review against the real main.go and against mutated copies of main.go (applied with
// go test -overlay, so the checkout is never edited) and requires the tests to fail for each
// mutant. No test name is assumed: any correct set of tests that pins the behavior passes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {When, Then} = require('@cucumber/cucumber');

const prefix = 'partial-verification-event-retention: ';
const ROOT = path.join(__dirname, '..', '..');
const MAIN = path.join(ROOT, 'cmd', 'kogen-review', 'main.go');

function goTest(overlay) {
  const args = ['test', '-count=1'];
  if (overlay) args.push('-overlay', overlay);
  args.push('./cmd/kogen-review');
  const r = spawnSync('go', args, {cwd: ROOT, encoding: 'utf8', timeout: 100000});
  return {command: 'go ' + args.join(' '), status: r.status, error: r.error, output: (r.stdout || '') + (r.stderr || '')};
}

function replaceOnce(src, from, to, last) {
  const i = last ? src.lastIndexOf(from) : src.indexOf(from);
  assert.ok(i >= 0, `main.go no longer contains ${JSON.stringify(from)}; the mutant cannot be built`);
  return src.slice(0, i) + to + src.slice(i + from.length);
}

const MUTANTS = {
  'drops the output of a completed command': s => replaceOnce(s, 'Output: output}', 'Output: output[:0]}'),
  'gives a completed result the wrong command': s => replaceOnce(s, 'Command: commands[name]', 'Command: commands["setup-1"]'),
  'drops the status of a completed command': s => replaceOnce(s, 'Status: status,', 'Status: status * 0,'),
  'omits acceptance from NotRun': s => replaceOnce(s, 'p.NotRun = append(p.NotRun, "acceptance")', '_ = p'),
  'omits model from NotRun': s => replaceOnce(s, 'p.NotRun = append(p.NotRun, "model")', '_ = p'),
  'always reports no model': s => replaceOnce(s, 'if intent.Model == nil || intent.Model.None {', 'if true {'),
  'never reports no model': s => replaceOnce(s, 'if intent.Model == nil || intent.Model.None {', 'if false {'),
  'omits a missing setup command from NotRun': s => replaceOnce(s, 'p.NotRun = append(p.NotRun, name)', '_ = p'),
  'omits a missing check from NotRun': s => replaceOnce(s, 'p.NotRun = append(p.NotRun, check.Name)', '_ = p', true),
};

function rejects(names) {
  const src = fs.readFileSync(MAIN, 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pver-'));
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
  assert.deepEqual(survivors, [], `kogen-review tests still pass when partial ${survivors.join('; and when partial ')}`);
}

When(prefix + 'I run the Go tests of the kogen-review command', {timeout: 120000}, function () {
  this.pvRun = goTest(null);
});

Then(prefix + 'the Go tests of the kogen-review command pass', function () {
  const {command, status, error, output} = this.pvRun;
  assert.equal(error, undefined, `\`${command}\` could not run: ${error}`);
  assert.equal(status, 0, `\`${command}\` exited ${status}\n${output}`);
  assert.ok(/^ok\s/m.test(output), `\`${command}\` did not report ok\n${output}`);
});

Then(prefix + 'the tests reject a partial that loses completed command evidence', {timeout: 120000}, function () {
  rejects(['drops the output of a completed command', 'gives a completed result the wrong command', 'drops the status of a completed command']);
});

Then(prefix + 'the tests reject a partial that omits missing work or misreports the model state', {timeout: 120000}, function () {
  rejects(['omits acceptance from NotRun', 'omits model from NotRun', 'always reports no model', 'never reports no model', 'omits a missing setup command from NotRun', 'omits a missing check from NotRun']);
});

Then(prefix + 'no file other than the kogen-review test file changed outside the Intent files', function () {
  const r = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', '.', ':!.kogen', ':!features'], {cwd: ROOT, encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
  const files = r.stdout.split('\n').filter(Boolean).map(l => l.slice(3));
  const others = files.filter(f => f !== 'cmd/kogen-review/main_test.go');
  assert.deepEqual(others, [], 'files changed besides cmd/kogen-review/main_test.go');
});
