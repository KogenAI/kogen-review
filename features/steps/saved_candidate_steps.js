'use strict';
const { When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const observer = require('./saved_candidate_observer.cjs');

const root = path.resolve(__dirname, '..', '..');

// git runs without the caller's GIT_* variables, so a private index or Git dir of the caller
// does not change what HEAD and the checkout are.
function gitEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
}

function run(cmd, args, cwd, env = process.env) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, output: (r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error) : '') };
}

When("the contract tests run with Go's test log", function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-saved-candidate-'));
  try {
    const bin = path.join(dir, 'contract.test');
    const build = run('go', ['test', '-c', '-o', bin, './contract'], root);
    assert.equal(build.status, 0, `go test -c -o ${bin} ./contract (in ${root}) exited ${build.status}:\n${build.output}`);
    const testlog = path.join(dir, 'test.log');
    const args = ['-test.count=1', '-test.timeout=10m', '-test.testlogfile=' + testlog];
    this.command = `${bin} ${args.join(' ')} (in ${path.join(root, 'contract')})`;
    this.tests = run(bin, args, path.join(root, 'contract'));
    this.testlog = fs.existsSync(testlog) ? fs.readFileSync(testlog, 'utf8') : '';
    const env = run('go', ['env', 'GOMODCACHE'], root);
    assert.equal(env.status, 0, `go env GOMODCACHE exited ${env.status}:\n${env.output}`);
    this.modcache = env.output.trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

Then('the contract tests pass', function () {
  const problems = observer.passProblems(this.tests.output);
  assert.ok(this.tests.status === 0 && problems.length === 0,
    `${this.command} exited ${this.tests.status} (${problems.join('; ') || 'no problem in its output'}):\n${this.tests.output}`);
});

Then('a review read a saved checkpoint.json from its run folder and recorded its verdict there', function () {
  const problems = observer.savedStateProblems(this.testlog);
  assert.deepEqual(problems, [], `${this.command}: ${problems.join('; ')}`);
});

Then("the contract tests read no fixture from the Go module cache or from kogen-build's state goldens", function () {
  const problems = observer.foreignProblems(this.testlog, this.modcache);
  assert.deepEqual(problems, [], `${this.command} (GOMODCACHE ${this.modcache}): ${problems.join('; ')}`);
});

// files lists the regular files under each path of the checkout (a file itself, or a folder's
// files recursively), relative to the checkout, sorted.
function files(paths) {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) {
      for (const name of fs.readdirSync(abs)) walk(path.posix.join(rel, name));
    } else {
      out.push(rel);
    }
  };
  paths.forEach(walk);
  return out.sort();
}

Then('the review package, its golden files, go.mod and go.sum are as committed at HEAD', function () {
  const paths = ['review', 'go.mod', 'go.sum'];
  const listed = run('git', ['ls-tree', '-r', 'HEAD', '--', ...paths], root, gitEnv());
  assert.equal(listed.status, 0, `git ls-tree -r HEAD -- ${paths.join(' ')} exited ${listed.status}:\n${listed.output}`);
  const committed = new Map(listed.output.split('\n').filter(Boolean).map((line) => {
    const [meta, file] = line.split('\t');
    return [file, meta.split(' ')[2]];
  }));
  const changes = [];
  for (const file of files(paths)) {
    if (!committed.has(file)) {
      changes.push(`${file} (added)`);
      continue;
    }
    const hashed = run('git', ['hash-object', '--no-filters', '--', file], root, gitEnv());
    assert.equal(hashed.status, 0, `git hash-object ${file} exited ${hashed.status}:\n${hashed.output}`);
    if (hashed.output.trim() !== committed.get(file)) changes.push(`${file} (modified)`);
    committed.delete(file);
  }
  for (const file of committed.keys()) changes.push(`${file} (deleted)`);
  assert.deepEqual(changes, [], `changed since HEAD: ${changes.join(', ')}`);
});
