const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {When, Then} = require('@cucumber/cucumber');

const root = path.resolve(__dirname, '../..');
// Module-aware commands use the checkout's own go.mod, never update it, and discover any go.work themselves.
const env = {...process.env, GOFLAGS: '-trimpath -mod=readonly'};
delete env.GOWORK;

function run(cmd, args) {
  const r = spawnSync(cmd, args, {cwd: root, env, encoding: 'utf8', timeout: 600000, maxBuffer: 256 * 1024 * 1024});
  return {status: r.status, stdout: r.stdout || '', text: (r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error) : ''), command: [cmd, ...args].join(' ')};
}

function tail(s) { return s.length > 8000 ? '...' + s.slice(-8000) : s; }

function sumLines() {
  return fs.readFileSync(path.join(root, 'go.sum'), 'utf8').split('\n');
}

When('r-consumes-c-models-only-in-models-yaml: I read the module file', {timeout: 120000}, function () {
  const r = run('go', ['mod', 'edit', '-json']);
  assert.equal(r.status, 0, `${r.command} exited ${r.status}\n${tail(r.text)}`);
  this.mod = JSON.parse(r.stdout);
  this.modText = r.stdout;
});

Then('r-consumes-c-models-only-in-models-yaml: the module requires exactly:', function (table) {
  const want = table.hashes().map((h) => `${h.path} ${h.version}`);
  const got = (this.mod.Require || []).map((q) => `${q.Path} ${q.Version}${q.Indirect ? ' // indirect' : ''}`);
  assert.deepEqual(got, want, `go mod edit -json requires\n${this.modText}`);
});

Then('r-consumes-c-models-only-in-models-yaml: the module requires {string} at {string}', function (module, version) {
  const got = (this.mod.Require || []).filter((q) => q.Path === module).map((q) => q.Version);
  assert.deepEqual(got, [version], `go mod edit -json: the require of ${module}\n${this.modText}`);
});

Then('r-consumes-c-models-only-in-models-yaml: the module has no replace directive', function () {
  assert.deepEqual(this.mod.Replace || [], [], `go mod edit -json replaces\n${this.modText}`);
});

Then('r-consumes-c-models-only-in-models-yaml: the checkout has no go.work file', function () {
  for (const name of ['go.work', 'go.work.sum']) {
    assert.equal(fs.existsSync(path.join(root, name)), false, `${name} must not exist in ${root}`);
  }
});

Then('r-consumes-c-models-only-in-models-yaml: go.sum contains the lines:', function (doc) {
  const lines = sumLines();
  for (const want of doc.split('\n').map((l) => l.trim()).filter(Boolean)) {
    assert.ok(lines.includes(want), `go.sum lacks the line ${want}\n${lines.join('\n')}`);
  }
});

Then('r-consumes-c-models-only-in-models-yaml: go.sum has no line for {string} at {string}', function (module, version) {
  const found = sumLines().filter((l) => {
    const [m, v] = l.split(' ');
    return m === module && (v === version || v === `${version}/go.mod`);
  });
  assert.deepEqual(found, [], `go.sum lines for ${module} ${version}`);
});

Then('r-consumes-c-models-only-in-models-yaml: the module is tidy', {timeout: 600000}, function () {
  const r = run('go', ['mod', 'tidy', '-diff']);
  assert.equal(r.status, 0, `${r.command} exited ${r.status}: go.mod or go.sum is not tidy\n${tail(r.text)}`);
  assert.equal(r.text, '', `${r.command} printed a difference\n${tail(r.text)}`);
});

When('r-consumes-c-models-only-in-models-yaml: I run the Go tests {string} in {string}', {timeout: 600000}, function (filter, pkg) {
  this.goTest = run('go', ['test', '-count=1', '-v', '-run', filter, pkg]);
});

Then('r-consumes-c-models-only-in-models-yaml: the run passed with each of these tests passing exactly once:', function (table) {
  const r = this.goTest;
  const lines = r.text.split('\n');
  for (const {test} of table.hashes()) {
    const outcome = (word) => lines.filter((l) => l.trim().startsWith(`--- ${word}: ${test} (`)).length;
    const passed = outcome('PASS');
    const failed = outcome('FAIL');
    const skipped = outcome('SKIP');
    const state = passed + failed + skipped === 0 ? 'absent (it did not run)' : `passed ${passed}, failed ${failed}, skipped ${skipped} times`;
    assert.equal(passed === 1 && failed === 0 && skipped === 0, true,
      `${test} must pass exactly once in \`${r.command}\` (exit ${r.status}); it was ${state}\n${tail(r.text)}`);
  }
  assert.equal(r.status, 0, `\`${r.command}\` exited ${r.status}, want 0, for ${table.hashes().map((h) => h.test).join(', ')}\n${tail(r.text)}`);
});

Then('r-consumes-c-models-only-in-models-yaml: the function {string} in {string} still has the lines:', function (name, rel, doc) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const start = text.indexOf(`\nfunc ${name}(`);
  assert.notEqual(start, -1, `${rel} has no func ${name}`);
  const end = text.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `${rel}: func ${name} has no closing brace at column 0`);
  const body = text.slice(start, end).split('\n').map((l) => l.trim());
  for (const want of doc.split('\n').map((l) => l.trim()).filter(Boolean)) {
    assert.ok(body.includes(want), `${rel}: func ${name} lacks the line ${want}\n${text.slice(start, end)}`);
  }
});

When('r-consumes-c-models-only-in-models-yaml: I read {string}', function (rel) {
  this.fileRel = rel;
  this.fileText = fs.readFileSync(path.join(root, rel), 'utf8');
});

Then('r-consumes-c-models-only-in-models-yaml: the file contains the text:', function (doc) {
  const want = doc.trim();
  assert.ok(this.fileText.includes(want), `${this.fileRel} lacks the text ${want}\n${this.fileText}`);
});
