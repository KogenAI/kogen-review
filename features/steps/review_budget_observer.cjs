const assert = require('node:assert/strict');
module.exports = function observe(actual, expected) {
 assert.equal(actual.rows.length, expected.requests, 'exact number of model requests');
 assert.equal(actual.verdict, expected.verdict, 'final verdict');
 assert.equal(actual.reason, expected.reason, 'allowance outcome');
 assert.equal(actual.interrupted, expected.interrupted, 'interruption really occurred');
 if (!expected.reason) assert.equal(actual.error, '', 'successful review');
 for (const row of actual.rows) {
  assert.equal(row.count, row.n, `request ${row.n}: persisted cumulative request count`);
  assert.equal(row.policy, true, `request ${row.n}: unchanged reviewer instructions`);
  const budget = row.n > expected.bound;
  assert.equal(row.budget, budget, `request ${row.n}: budget notice boundary`);
  const reminder = expected.reminders.includes(row.n);
  assert.equal(row.force, (budget || reminder) && expected.forced ? 'submit_review' : '', `request ${row.n}: tool choice`);
  assert.equal(row.rejected, expected.rejected_at && row.n >= expected.rejected_at ? 1 : 0, `request ${row.n}: rejected allowance`);
  assert.equal(row.no_tool, expected.no_tool_at && row.n >= expected.no_tool_at ? 1 : 0, `request ${row.n}: prose allowance`);
  assert.equal(row.unread, expected.unread_through && row.n <= expected.unread_through ? 1 : 0, `request ${row.n}: unread validation`);
  if (expected.requests === 3) assert.equal(row.users, 1, `request ${row.n}: no extra user message in ordinary review`);
 }
};
