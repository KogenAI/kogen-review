'use strict';
const { When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const observer = require('./executor_main_observer.cjs');

const root = path.resolve(__dirname, '..', '..');
const executor = 'github.com/KogenAI/kogen-executor';

// gitEnv drops the caller's GIT_* variables, so a private index or Git dir of the caller does not
// change which files the checkout has.
function gitEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
}

// goEnv lets the copy's go.mod and go.sum follow the required executor version (the copy only)
// and trusts the public KogenAI modules' downloaded bytes for its new go.sum lines.
function goEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'GOFLAGS' && k !== 'GOWORK'));
  return { ...env, GOFLAGS: '-mod=mod', GOWORK: 'off', GONOSUMDB: 'github.com/KogenAI' };
}

function run(cmd, args, cwd, env) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, output: (r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error) : '') };
}

// The checkout's files as they are now (tracked and untracked, not ignored) are copied to a new
// folder whose go.mod requires the given kogen-executor version; go vet ./... and the named test
// of ./contract run there. The checkout itself is not changed.
When('the checkout is copied with go.mod requiring kogen-executor {string} and checked with go vet and the contract test {string}', { timeout: 900000 }, function (version, test) {
  const listed = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root, gitEnv());
  assert.equal(listed.status, 0, `git ls-files in ${root} exited ${listed.status}:\n${listed.output}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-executor-main-'));
  this.executorMain = { version, test, dir };
  try {
    for (const file of listed.output.split('\0').filter(Boolean)) {
      const from = path.join(root, file);
      if (!fs.existsSync(from) || !fs.statSync(from).isFile()) continue;
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.copyFileSync(from, path.join(dir, file));
    }
    const edit = run('go', ['mod', 'edit', `-require=${executor}@${version}`], dir, goEnv());
    assert.equal(edit.status, 0, `go mod edit -require=${executor}@${version} (in ${dir}) exited ${edit.status}:\n${edit.output}`);
    const used = run('go', ['list', '-m', executor], dir, goEnv());
    this.executorMain.used = used;
    this.executorMain.vet = run('go', ['vet', './...'], dir, goEnv());
    const args = ['test', '-count=1', '-v', '-run', `^${test}$`, './contract'];
    this.executorMain.testCommand = `go ${args.join(' ')}`;
    this.executorMain.tests = run('go', args, dir, goEnv());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

Then('the copy builds against exactly that kogen-executor version', function () {
  const { version, used, dir } = this.executorMain;
  assert.equal(used.status, 0, `go list -m ${executor} (in ${dir}) exited ${used.status}:\n${used.output}`);
  assert.equal(used.output.trim(), `${executor} ${version}`, `go list -m ${executor} (in ${dir}) printed:\n${used.output}`);
});

Then('go vet passes on every package of the copy', function () {
  const { version, vet } = this.executorMain;
  assert.equal(vet.status, 0, `go vet ./... against ${executor}@${version} exited ${vet.status}:\n${vet.output}`);
});

Then('the contract test passes in the copy', function () {
  const { version, test, testCommand, tests } = this.executorMain;
  const problems = observer.testProblems(test, tests.status, tests.output);
  assert.deepEqual(problems, [], `${testCommand} against ${executor}@${version}: ${problems.join('; ')}:\n${tests.output}`);
});
