const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {When, Then} = require('@cucumber/cucumber');

const root = path.resolve(__dirname, '../..');
// Module-aware commands use the checkout's own go.mod, never update it, and discover any go.work themselves.
const env = {...process.env, GOFLAGS: '-mod=readonly'};
delete env.GOWORK;

function run(cmd, args) {
  const r = spawnSync(cmd, args, {cwd: root, env, encoding: 'utf8', timeout: 600000, maxBuffer: 256 * 1024 * 1024});
  return {status: r.status, stdout: r.stdout || '', text: (r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error) : ''), command: [cmd, ...args].join(' ')};
}

function tail(s) { return s.length > 8000 ? '...' + s.slice(-8000) : s; }

function ok(r) {
  assert.equal(r.status, 0, `${r.command} exited ${r.status}\n${tail(r.text)}`);
}

When('k-review-loop-module-path: I read the module file', {timeout: 120000}, function () {
  const r = run('go', ['mod', 'edit', '-json']);
  ok(r);
  this.mod = JSON.parse(r.stdout);
  this.modText = r.stdout;
});

Then('k-review-loop-module-path: the module requires exactly:', function (table) {
  const want = table.hashes().map((h) => `${h.path} ${h.version}`);
  const got = (this.mod.Require || []).map((q) => `${q.Path} ${q.Version}${q.Indirect ? ' // indirect' : ''}`);
  assert.deepEqual(got, want, `go mod edit -json requires\n${this.modText}`);
});

Then('k-review-loop-module-path: the module has no replace directive', function () {
  assert.deepEqual(this.mod.Replace || [], [], `go mod edit -json replaces\n${this.modText}`);
});

Then('k-review-loop-module-path: the checkout has no go.work file', function () {
  for (const name of ['go.work', 'go.work.sum']) {
    assert.equal(fs.existsSync(path.join(root, name)), false, `${name} must not exist in ${root}`);
  }
});

Then('k-review-loop-module-path: go.sum contains the lines:', function (doc) {
  const lines = fs.readFileSync(path.join(root, 'go.sum'), 'utf8').split('\n');
  for (const want of doc.split('\n').map((l) => l.trim()).filter(Boolean)) {
    assert.ok(lines.includes(want), `go.sum lacks the line ${want}\n${lines.join('\n')}`);
  }
});

Then('k-review-loop-module-path: go.sum has no line for module {string}', function (module) {
  const lines = fs.readFileSync(path.join(root, 'go.sum'), 'utf8').split('\n');
  const found = lines.filter((l) => l.split(' ')[0] === module);
  assert.deepEqual(found, [], `go.sum lines for module ${module}`);
});

Then('k-review-loop-module-path: the module is tidy', {timeout: 600000}, function () {
  const r = run('go', ['mod', 'tidy', '-diff']);
  assert.equal(r.status, 0, `${r.command} exited ${r.status}: go.mod or go.sum is not tidy\n${tail(r.text)}`);
  assert.equal(r.text, '', `${r.command} printed a difference\n${tail(r.text)}`);
});

When('k-review-loop-module-path: I search the Go sources for bare kogen-loop imports', function () {
  this.search = run('grep', ['-rn', '"kogen-loop/', '--include=*.go', '.']);
});

Then('k-review-loop-module-path: the search finds nothing', function () {
  const r = this.search;
  assert.equal(r.text, '', `${r.command} found bare imports\n${tail(r.text)}`);
  assert.equal(r.status, 1, `${r.command} exited ${r.status} (1 means no match)\n${tail(r.text)}`);
});

When('k-review-loop-module-path: I list the packages and modules of the build', {timeout: 900000}, function () {
  const pkgs = run('go', ['list', '-deps', '-test', './...']);
  ok(pkgs);
  this.packages = pkgs.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const mods = run('go', ['list', '-m', 'all']);
  ok(mods);
  this.modules = mods.stdout.split('\n').map((l) => l.trim().split(' ')[0]).filter(Boolean);
});

Then('k-review-loop-module-path: the packages include:', function (table) {
  for (const {package: want} of table.hashes()) {
    assert.ok(this.packages.includes(want), `go list -deps -test ./... lacks ${want}\n${this.packages.join('\n')}`);
  }
});

Then('k-review-loop-module-path: no package path starts with {string}', function (prefix) {
  const found = this.packages.filter((p) => p.startsWith(prefix));
  assert.deepEqual(found, [], `go list -deps -test ./... packages starting with ${prefix}`);
});

Then('k-review-loop-module-path: no module in the build list is {string}', function (module) {
  assert.ok(!this.modules.includes(module), `go list -m all includes ${module}\n${this.modules.join('\n')}`);
});
