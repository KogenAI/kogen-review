'use strict';
// Acceptance of review-session-rejects-trailing-json: the driver program in
// review-session-rejects-trailing-json__driver decodes sample sessions with review.DecodeSession
// and prints one JSON object of the outcomes; the steps read it.
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {When, Then} = require('@cucumber/cucumber');

const prefix = 'review-session-rejects-trailing-json: ';
const ROOT = path.join(__dirname, '..', '..');
const COMMAND = ['go', 'run', './features/steps/review-session-rejects-trailing-json__driver'];

let outcomes = null;

function sample(name) {
  assert.ok(outcomes, `${prefix}the driver has not run (${COMMAND.join(' ')})`);
  assert.ok(Object.hasOwn(outcomes, name), `${prefix}no sample named ${name}; samples: ${Object.keys(outcomes).join(', ')}`);
  return outcomes[name];
}

When(prefix + 'the driver decodes every sample session with review.DecodeSession', {timeout: 110000}, function () {
  const r = spawnSync(COMMAND[0], COMMAND.slice(1), {cwd: ROOT, encoding: 'utf8', timeout: 100000});
  assert.equal(r.status, 0, `${prefix}${COMMAND.join(' ')} exited ${r.status}: ${r.stderr}${r.stdout}`);
  outcomes = JSON.parse(r.stdout);
});

Then(prefix + 'the sample {string} decodes without an error as model {string} with {int} requests', function (name, model, requests) {
  const o = sample(name);
  assert.equal(o.error, false, `${prefix}sample ${name} returned an error from DecodeSession`);
  assert.equal(o.model, model, `${prefix}sample ${name}: decoded model`);
  assert.equal(o.requests, requests, `${prefix}sample ${name}: decoded requests`);
});

Then(prefix + 'the sample {string} is rejected with an error', function (name) {
  assert.equal(sample(name).error, true, `${prefix}sample ${name} decoded without an error`);
});
