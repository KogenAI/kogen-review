'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {Given, Then} = require('@cucumber/cucumber');
const {verify} = require('./review-account-binary-change-stats__observer');
const root = path.resolve(__dirname, '../..');
const prefix = 'review-account-binary-change-stats: ';
const sources = {'review': 'review/account_test.go', 'contract': 'contract/independent_test.go'};

function runTests(dir, names, deadline) {
  const selected = [...new Set(Object.values(names).flat())];
  const pattern = '^(' + selected.join('|') + ')$';
  const args = ['test', '-json', './review', './contract', '-run', pattern, '-count=1'];
  const r = spawnSync('go', args, {cwd: dir, encoding: 'utf8', timeout: Math.max(1, deadline - Date.now())});
  assert.ifError(r.error);
  return {status: r.status, output: r.stdout + r.stderr, command: 'go ' + args.join(' ')};
}

function replaceOnce(text, old, replacement) {
  assert.equal(text.split(old).length, 2, 'mutation anchor must occur once: ' + old);
  return text.replace(old, replacement);
}

function mutate(text, kind) {
  if (kind === 'binary numeric') return replaceOnce(text, 'if col == "-" {\n\t\treturn 0, true', 'if col == "-" {\n\t\treturn 1, true');
  const anchor = '\t\t\tfiles, added, deleted = files+1, added+a, deleted+d';
  const changes = {
    'binary omitted': '\t\t\tif cols[0] == "-" || cols[1] == "-" { continue }\n',
    'mode-only omitted': '\t\t\tif a == 0 && d == 0 && cols[0] != "-" && cols[1] != "-" { continue }\n',
    'mode-only numeric': '\t\t\tif a == 0 && d == 0 && cols[0] != "-" && cols[1] != "-" { a = 1 }\n'
  };
  assert.ok(Object.hasOwn(changes, kind), 'unknown mutation ' + kind);
  return replaceOnce(text, anchor, changes[kind] + anchor);
}

Given(prefix + 'the scoped regression sources are available', function () {
  for (const file of Object.values(sources)) assert.ok(fs.statSync(path.join(root, file)).isFile(), file);
});

Then(prefix + 'both scoped test files reject {string} while accepting totals {int}, {int}, {int}', {timeout: 120000}, function (kind, files, added, deleted) {
  assert.deepEqual([files, added, deleted], [1, 0, 0]);
  // The native acceptance protocol caps a step at 120 seconds; this is not a product performance assertion.
  const deadline = Date.now() + 120000;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-account-stats-'));
  try {
    for (const entry of fs.readdirSync(root)) {
      if (['.git', '.kogen', 'node_modules', 'features'].includes(entry)) continue;
      fs.cpSync(path.join(root, entry), path.join(dir, entry), {recursive: true});
    }
    const names = {};
    for (const [pkg, source] of Object.entries(sources)) {
      const text = fs.readFileSync(path.join(dir, source), 'utf8');
      names[pkg] = [...text.matchAll(/^func (Test\w+)\(t \*testing\.T\)/gm)].map(m => m[1]);
      assert.ok(names[pkg].length, 'no existing test functions found in ' + source);
    }
    const baseline = runTests(dir, names, deadline);
    assert.equal(baseline.status, 0, baseline.command + ': baseline tests failed\n' + baseline.output);
    const account = path.join(dir, 'review/account.go');
    fs.writeFileSync(account, mutate(fs.readFileSync(account, 'utf8'), kind));
    const mutant = runTests(dir, names, deadline);
    assert.equal(mutant.status, 1, mutant.command + ': expected test assertion failure for ' + kind + '\n' + mutant.output);
    verify(baseline.output, mutant.output, names);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
