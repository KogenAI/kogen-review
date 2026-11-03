const { When, Then } = require('@cucumber/cucumber');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');

When('I obtain the public reviewer instructions', function () {
  this.claimPolicy = execFileSync('go', ['run', './features/steps/claim_policy'], { encoding: 'utf8' });
});

Then('the unsupported-claim policy includes {string}', function (expected) {
  assert.ok(this.claimPolicy.includes(expected), `ReviewerInstructions is missing required policy: ${expected}`);
});
