'use strict';
// Acceptance of fix-k-review-unrun-evidence-not-met: runs one existing Go test by name in the
// checkout and requires that it ran and passed.
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {When, Then} = require('@cucumber/cucumber');

const prefix = 'fix-k-review-unrun-evidence-not-met: ';
const ROOT = path.join(__dirname, '..', '..');

When(prefix + 'I run the existing Go test {string} in package {string}', {timeout: 290000}, function (name, pkg) {
  const args = ['test', '-count=1', '-run', '^' + name + '$', '-v', pkg];
  const r = spawnSync('go', args, {cwd: ROOT, encoding: 'utf8', timeout: 280000});
  this.fixRun = {name, command: 'go ' + args.join(' '), status: r.status, error: r.error, output: (r.stdout || '') + (r.stderr || '')};
});

Then(prefix + 'that test ran and passed', function () {
  const {name, command, status, error, output} = this.fixRun;
  const tail = `\n--- ${command} output ---\n${output}`;
  assert.equal(error, undefined, `${name}: \`${command}\` could not run: ${error}${tail}`);
  assert.ok(!/no tests to run/.test(output), `${name}: \`${command}\` ran zero tests (the test is absent)${tail}`);
  assert.ok(!output.includes(`--- SKIP: ${name} `), `${name}: \`${command}\` skipped the test${tail}`);
  assert.ok(!output.includes(`--- FAIL: ${name} `), `${name}: \`${command}\` failed the test${tail}`);
  assert.ok(output.includes(`--- PASS: ${name} (`), `${name}: \`${command}\` did not report the test as passed${tail}`);
  assert.equal(status, 0, `${name}: \`${command}\` exited with status ${status}${tail}`);
});
