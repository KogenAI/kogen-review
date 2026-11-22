// Steps of Intent review-generated-timeout-retention. A copy of this checkout gets a plausible wrong
// behavior of a timed-out regeneration written into review/generated.go, and the copy's own tests
// of the review package run. A suite that pins the behavior fails in that copy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Given, When, Then } = require('@cucumber/cucumber');

const prefix = 'review-generated-timeout-retention: ';
const checkout = process.cwd();

function isolated() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && !k.startsWith('KOGEN_ACCEPTANCE_')) env[k] = v;
  }
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
}

function copyCheckout() {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-timeout-src-'));
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(checkout, rel), { withFileTypes: true })) {
      const file = path.join(rel, entry.name);
      if (['.git', 'node_modules', path.join('.kogen', 'local')].includes(file)) continue;
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        fs.mkdirSync(path.join(copy, rel), { recursive: true });
        fs.copyFileSync(path.join(checkout, file), path.join(copy, file));
      }
    }
  };
  walk('');
  process.on('exit', () => fs.rmSync(copy, { recursive: true, force: true }));
  return copy;
}

// replaceOnce rewrites text so that exactly one occurrence of from becomes to.
function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, `review/generated.go does not contain exactly one ${JSON.stringify(from)}`);
  return text.replace(from, () => to);
}

// markTimeout makes runRegenerate record whether its limit expired.
function markTimeout(text) {
  text = replaceOnce(text, '\treturn cmd.Run() == nil\n', '\terr := cmd.Run()\n\tmutTimedOut = ctx.Err() != nil\n\treturn err == nil\n');
  return text + '\nvar mutTimedOut bool\n';
}

const mutations = {
  'reported as a mismatch': (text) =>
    replaceOnce(markTimeout(text), '\t\t\t\tcase !ran:\n\t\t\t\t\tf.Outcome = generatedKept\n', '\t\t\t\tcase !ran:\n\t\t\t\t\tf.Outcome = generatedKept\n\t\t\t\t\tf.mismatch = mutTimedOut\n'),
  'left out of the review source': (text) => {
    text = markTimeout(text);
    text = replaceOnce(text, '\tmismatch    bool\n', '\tmismatch    bool\n\ttimedOut    bool\n');
    text = replaceOnce(text, '\t\t\t\tcase !ran:\n\t\t\t\t\tf.Outcome = generatedKept\n', '\t\t\t\tcase !ran:\n\t\t\t\t\tf.Outcome = generatedKept\n\t\t\t\t\tf.timedOut = mutTimedOut\n');
    return replaceOnce(text, '\t\tif f.Outcome != generatedSummarised {\n', '\t\tif f.Outcome != generatedSummarised && !f.timedOut {\n');
  },
};

Given(prefix + 'a copy of the review package in which a timed-out regeneration is {string}', function (wrong) {
  assert.ok(mutations[wrong], `no wrong behavior is named ${wrong}`);
  this.copy = copyCheckout();
  const file = path.join(this.copy, 'review', 'generated.go');
  fs.writeFileSync(file, mutations[wrong](fs.readFileSync(file, 'utf8')));
});

When(prefix + 'the tests of the review package run in that copy', function () {
  const r = spawnSync('go', ['test', '-count=1', '-mod=readonly', '-buildvcs=false', './review'], { cwd: this.copy, encoding: 'utf8', env: isolated(), timeout: 100000 });
  this.status = r.status;
  this.output = `${r.stdout || ''}${r.stderr || ''}${r.error || ''}`;
});

Then(prefix + 'a test of the review package fails', function () {
  assert.ok(!this.output.includes('[build failed]'), `the copy did not build:\n${this.output}`);
  assert.ok(this.output.includes('--- FAIL: Test'), `go test ./review reported no failing test (exit ${this.status}), so no test of the review package pins the behavior:\n${this.output}`);
  assert.notEqual(this.status, 0);
});
