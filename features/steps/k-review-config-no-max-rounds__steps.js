const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {When, Then} = require('@cucumber/cucumber');

const root = path.resolve(__dirname, '../..');
const reviewModule = 'github.com/KogenAI/kogen-review';
const coordinator = 'github.com/KogenAI/kogen-coordinator';
// The removed configuration key, spelled in two parts so this file is not a match of its own search.
const removedKey = 'max_' + 'rounds';
const env = {...process.env, GOWORK: 'off', GOFLAGS: '-mod=mod'};

function go(args, cwd) {
  const r = spawnSync('go', args, {cwd, env, encoding: 'utf8', timeout: 840000, maxBuffer: 256 * 1024 * 1024});
  return {status: r.status, stdout: r.stdout || '', text: (r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error) : ''), command: 'go ' + args.join(' ')};
}

function events(r) {
  return r.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch (_) { return {}; } });
}

function tail(s) { return s.length > 8000 ? '...' + s.slice(-8000) : s; }

function goFiles(dir, out) {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) goFiles(p, out);
    else if (e.isFile() && e.name.endsWith('.go')) out.push(p);
  }
  return out;
}

When('k-review-config-no-max-rounds: I run the whole Go suite against kogen-coordinator {string}', {timeout: 900000}, function (version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-no-round-cap-'));
  try {
    fs.cpSync(root, dir, {recursive: true, filter: (src) => path.relative(root, src) !== '.git'});
    const edit = go(['mod', 'edit', '-require=' + coordinator + '@' + version], dir);
    assert.equal(edit.status, 0, `${edit.command}: exit ${edit.status}\n${edit.text}`);
    const used = go(['list', '-m', coordinator], dir);
    const test = go(['test', '-json', '-count=1', './...'], dir);
    this.suite = {version, used, test};
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

Then('k-review-config-no-max-rounds: the suite used kogen-coordinator {string} and passed', function (version) {
  const {used, test} = this.suite;
  assert.equal(used.stdout.trim(), coordinator + ' ' + version, `${used.command}: exit ${used.status}; the suite must run against ${coordinator} ${version}\n${used.text}`);
  const failed = events(test).filter((e) => e.Action === 'fail').map((e) => `${e.Package} ${e.Test || '(package)'}`);
  assert.ok(test.status === 0, `${test.command} against ${coordinator} ${version}: exit ${test.status}; failed: ${failed.join(', ') || 'none reported'}\n${tail(test.text)}`);
});

Then('k-review-config-no-max-rounds: these tests passed exactly once:', function (table) {
  const {version, test} = this.suite;
  const all = events(test);
  for (const row of table.hashes()) {
    const pkg = reviewModule + '/' + row.package;
    const mine = all.filter((e) => e.Package === pkg && e.Test === row.test);
    const count = (a) => mine.filter((e) => e.Action === a).length;
    const output = mine.filter((e) => e.Action === 'output').map((e) => e.Output).join('');
    assert.ok(count('run') === 1 && count('pass') === 1 && count('fail') === 0 && count('skip') === 0,
      `${row.test} in ${row.package} required to run once and pass: ${test.command} against ${coordinator} ${version}; exit ${test.status}; run ${count('run')}, pass ${count('pass')}, fail ${count('fail')}, skip ${count('skip')} (absent, skipped or zero executions are failures)\n${tail(output)}`);
  }
});

Then('k-review-config-no-max-rounds: no non-doc file outside .git and .kogen names the removed models key', function () {
  const args = ['-rn', '--exclude-dir=.git', '--exclude-dir=.kogen', '--exclude=*.md', removedKey, '.'];
  const r = spawnSync('grep', args, {cwd: root, encoding: 'utf8'});
  assert.ok(r.status === 1 && (r.stdout || '') === '', `grep ${args.join(' ')}: exit ${r.status}; it must find nothing\n${r.stdout || ''}${r.stderr || ''}`);
});

Then('k-review-config-no-max-rounds: no Go file sets MaxRounds in a project.Role literal', function () {
  const hits = [];
  for (const file of goFiles(root, [])) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/project\.Role\{[^}]*\bMaxRounds\b[^}]*\}/g)) hits.push(`${path.relative(root, file)}: ${m[0]}`);
  }
  assert.deepEqual(hits, [], `no project.Role literal may set MaxRounds:\n${hits.join('\n')}`);
});

Then('k-review-config-no-max-rounds: the coordinator fixture configuration ends with:', function (expected) {
  const file = 'consumes/kogen-coordinator/project_test.go';
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const body = src.match(/const configYAML = `([^`]*)`/)?.[1];
  assert.ok(body !== undefined, `${file} must keep its configYAML fixture`);
  assert.ok(body.endsWith('\n' + expected + '\n'), `${file} configYAML must end with:\n${expected}\n--- actual ---\n${body}`);
});

Then('k-review-config-no-max-rounds: go.mod still requires {string}', function (requirement) {
  const mod = fs.readFileSync(path.join(root, 'go.mod'), 'utf8');
  assert.ok(mod.split('\n').some((l) => l.trim() === requirement), `go.mod must still require ${requirement}\n${mod}`);
});
