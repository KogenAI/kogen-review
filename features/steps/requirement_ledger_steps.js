// Steps for the reviewer's evidence for each requirement (Intent k-review-intent-requirement-ledger).
// They extend the kogen-review command steps (kogen_review_cmd.js), which build the command, make
// the fixture checkout, serve the scripted model answers and run the command: a saved candidate
// of several files, the exact tool result a request carried back, the reviewer's instructions,
// the submit_review definition offered and the requirements the review record keeps.
const { Given, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// A Git run in a fixture checkout, isolated from the caller's Git configuration (as in
// kogen_review_cmd.js).
function git(dir, ...args) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && !k.startsWith('KOGEN_')) env[k] = v;
  }
  const r = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd: dir, encoding: 'utf8', env: { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
  });
  assert.equal(r.status, 0, `git ${args.join(' ')} in ${dir} exited ${r.status}:\n${r.stdout}${r.stderr}${r.error || ''}`);
  return r.stdout.trim();
}

function request(world, n) {
  assert.ok(world.result, 'kogen-review did not run: use "kogen-review runs with the arguments ..." first');
  assert.ok(world.requests, 'no fake model: use "a fake OpenAI-compatible model that answers in order:" first');
  assert.ok(n >= 1 && n <= world.requests.length,
    `request ${n}: the fake model received ${world.requests.length} requests; kogen-review exited ${world.result.status}\nstdout:\n${world.result.stdout}`);
  return world.requests[n - 1];
}

// The files the checkout's file steps wrote since the start commit become the saved candidate
// commit, the checkout's HEAD; $CANDIDATE_TREE is its tree.
Given('the checkout\'s files are committed as the saved candidate', function () {
  assert.ok(this.start, 'no start commit: use "the checkout\'s files are committed as the start commit" first');
  git(this.checkout, 'add', '-A');
  git(this.checkout, 'commit', '-q', '-m', 'saved candidate');
  this.candidateTree = git(this.checkout, 'rev-parse', 'HEAD^{tree}');
  this.before = {
    head: git(this.checkout, 'rev-parse', 'HEAD'),
    status: git(this.checkout, 'status', '--porcelain=v1', '--untracked-files=all'),
  };
});

// The tool result is the doc string exactly.
Then('the last message of request {int} is the tool result:', function (n, text) {
  const messages = request(this, n).body.messages || [];
  const last = messages[messages.length - 1] || {};
  assert.deepStrictEqual({ role: last.role, content: last.content }, { role: 'tool', content: text },
    `the last message of request ${n} is ${JSON.stringify(last)}`);
});

// The doc string is one paragraph of the instructions: its text, from its first to its last
// character.
Then('the system message of request {int} contains:', function (n, text) {
  const first = (request(this, n).body.messages || [])[0] || {};
  assert.equal(first.role, 'system', `request ${n} does not begin with a system message`);
  assert.ok(typeof first.content === 'string' && first.content.includes(text),
    `the system message of request ${n} does not contain ${JSON.stringify(text)}:\n${first.content}`);
});

// The doc string is the JSON Schema of submit_review's requirements parameter, compared as a
// parsed value.
Then('request {int} offered submit_review with the requirements parameter:', function (n, doc) {
  const tools = request(this, n).body.tools || [];
  const submit = tools.find((t) => t.function && t.function.name === 'submit_review');
  assert.ok(submit, `request ${n} offered no submit_review: ${JSON.stringify(tools.map((t) => t.function && t.function.name))}`);
  const params = submit.function.parameters || {};
  assert.deepStrictEqual((params.properties || {}).requirements, JSON.parse(doc),
    `submit_review's requirements parameter in request ${n}: ${JSON.stringify(params)}`);
  assert.deepStrictEqual(params.required, ['verdict', 'findings'], `submit_review's required parameters in request ${n}`);
});

// The doc string is the JSON array the record's "requirements" holds, compared as a parsed value.
Then('the run folder\'s {string} records the requirements:', function (file, doc) {
  assert.ok(this.run, 'no run folder: check stdout with "stdout is one JSON line equal to:" first');
  const record = JSON.parse(fs.readFileSync(path.join(this.run, file), 'utf8'));
  assert.deepStrictEqual(record.requirements, JSON.parse(doc), `${file} in ${this.run}: ${JSON.stringify(record)}`);
});
