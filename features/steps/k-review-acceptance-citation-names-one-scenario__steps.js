// Steps of Intent k-review-acceptance-citation-names-one-scenario. The review driver
// (k-review-acceptance-citation-names-one-scenario__driver.js) is a Go program built in a copy of
// this checkout; it runs the native reviewer (review.Independent) once with a scripted model that
// submits an approval citing acceptance, given a pass with the scenarios of the feature. The
// observation: requests, refusal (the tool result of the first submission, "" when none), verdict.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Given, When, Then } = require('@cucumber/cucumber');

const prefix = 'k-review-acceptance-citation-names-one-scenario: ';
const checkout = process.cwd();

function isolated(extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && !k.startsWith('KOGEN_ACCEPTANCE_')) env[k] = v;
  }
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...extra };
}

let driver = null;
function buildDriver() {
  if (!driver) {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'cite-driver-src-'));
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
    fs.mkdirSync(path.join(copy, 'internal', 'citedriver'), { recursive: true });
    fs.writeFileSync(path.join(copy, 'internal', 'citedriver', 'main.go'), require('./k-review-acceptance-citation-names-one-scenario__driver.js'));
    const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cite-driver-bin-')), 'citedriver');
    const r = spawnSync('go', ['build', '-mod=readonly', '-buildvcs=false', '-o', bin, './internal/citedriver'], { cwd: copy, encoding: 'utf8', env: isolated({}) });
    driver = { bin, status: r.status, output: `${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
    fs.rmSync(copy, { recursive: true, force: true });
  }
  assert.equal(driver.status, 0, `go build ./internal/citedriver exited ${driver.status}:\n${driver.output}`);
  return driver.bin;
}

// The doc string is the JSON list of scenarios {name, status, steps: [step text]}.
Given(prefix + 'the acceptance result has the scenarios:', function (doc) {
  this.spec = { mode: '', scenarios: JSON.parse(doc) };
});

Given(prefix + 'the acceptance result did not run', function () {
  this.spec = { mode: 'not_run', scenarios: [] };
});

Given(prefix + 'the acceptance result is of an earlier tree', function () {
  this.spec = { ...this.spec, mode: 'stale' };
});

// The reviewer first approves with one requirement citing the ref as acceptance evidence, and, if
// that is refused, approves again with no requirements.
Given(prefix + 'the reviewer approves citing acceptance {string}', function (ref) {
  this.answers = [
    [{ name: 'submit_review', args: { verdict: 'approve', findings: [], requirements: [{ requirement: 'R1', evidence: 'acceptance', ref, met: true }] } }],
    [{ name: 'submit_review', args: { verdict: 'approve', findings: [] } }],
  ];
});

When(prefix + 'the native reviewer reviews the saved candidate', { timeout: 300000 }, function () {
  assert.ok(this.spec && this.answers, 'give the acceptance result and the reviewer first');
  const bin = buildDriver();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cite-driver-'));
  const files = { answers: path.join(work, 'answers.json'), acceptance: path.join(work, 'acceptance.json'), out: path.join(work, 'observation.json') };
  fs.writeFileSync(files.answers, JSON.stringify(this.answers));
  fs.writeFileSync(files.acceptance, JSON.stringify(this.spec));
  const r = spawnSync(bin, [], {
    cwd: work, encoding: 'utf8', timeout: 240000,
    env: isolated({ HOME: work, CITE_ANSWERS: files.answers, CITE_ACCEPTANCE: files.acceptance, CITE_OUT: files.out }),
  });
  assert.equal(r.status, 0, `the review driver exited ${r.status}:\n${r.stdout}${r.stderr}${r.error || ''}`);
  this.observed = JSON.parse(fs.readFileSync(files.out, 'utf8'));
});

function observed(world) {
  assert.ok(world.observed, 'no review ran');
  return world.observed;
}

Then(prefix + 'the first approval was accepted', function () {
  const o = observed(this);
  assert.deepStrictEqual({ requests: o.requests, refusal: o.refusal, verdict: o.verdict }, { requests: 1, refusal: '', verdict: 'approve' }, `the first approval was not accepted: ${JSON.stringify(o)}`);
});

Then(prefix + 'the first approval was refused with the problem:', function (text) {
  const o = observed(this);
  assert.equal(o.refusal, text, `the first approval's refusal differs: ${JSON.stringify(o)}`);
});

Then(prefix + 'the first approval was refused with a problem containing {string}', function (part) {
  const o = observed(this);
  assert.ok(o.refusal.startsWith('invalid verdict:\n') && o.refusal.includes(part), `the first approval's refusal does not contain "${part}": ${JSON.stringify(o)}`);
});
