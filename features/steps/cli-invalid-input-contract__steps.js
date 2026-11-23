'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { Given, When, Then } = require('@cucumber/cucumber');

const SOURCE_FILE = 'cmd/kogen-review/main.go';
const TEST_FILE = 'cmd/kogen-review/main_test.go';
// The tests that existed before this Intent; any other passing test is a new one.
const EXISTING_TESTS = ['TestInitialVerificationStops', 'TestReportVerificationErrorRetainsSubmittedEvidence'];

// Each mutation is a plausible wrong main.go, named by the sentence of the scenario.
const MUTATIONS = {
  'a missing -model is not checked': [['*start == "" || *slug == "" || *model == ""', '*start == "" || *slug == ""']],
  'a positional argument is accepted': [['flags.NArg() != 0 || ', '']],
  'the usage line is printed on stdout': [['\t\tfmt.Fprintln(stderr, usage)\n\t\treturn 2', '\t\tfmt.Fprintln(stdout, usage)\n\t\treturn 2']],
  'a refusal is printed on stdout': [['fmt.Fprintln(stderr, "kogen-review: "+err.Error())', 'fmt.Fprintln(stdout, "kogen-review: "+err.Error())']],
  'a refusal exits 1': [['fmt.Fprintln(stderr, "kogen-review: "+err.Error())\n\t\treturn 2', 'fmt.Fprintln(stderr, "kogen-review: "+err.Error())\n\t\treturn 1']],
  'an invalid project configuration is ignored': [['\t\tif err != nil {\n\t\t\treturn refuse(err)\n\t\t}\n\t\tcommands', '\t\tif err != nil {\n\t\t\tcfg = &project.Config{}\n\t\t}\n\t\tcommands']],
  'an unresolvable start commit is ignored': [['return refuse(fmt.Errorf("-start %s is not a commit of %s", *start, abs))', 'commit = ""']],
};

function root() {
  return fs.realpathSync(process.cwd());
}

function mutatedSource(dir, description) {
  let text = fs.readFileSync(path.join(dir, SOURCE_FILE), 'utf8');
  for (const [from, to] of MUTATIONS[description]) {
    assert.ok(text.includes(from), `cli-invalid-input-contract: ${SOURCE_FILE} no longer contains ${JSON.stringify(from)}, so the mutation "${description}" cannot be applied`);
    text = text.replace(from, to);
  }
  return text;
}

// Runs the tests of package ./cmd/kogen-review (its main_test.go and the other test files of the
// package) against main.go, optionally mutated through a Go overlay, and parses go test -json.
function runPackageTests(world, description) {
  const dir = root();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-invalid-input-contract-'));
  const replace = {};
  if (description !== undefined) {
    const mutated = path.join(scratch, 'main.go');
    fs.writeFileSync(mutated, mutatedSource(dir, description));
    replace[path.join(dir, SOURCE_FILE)] = mutated;
  }
  const overlay = path.join(scratch, 'overlay.json');
  fs.writeFileSync(overlay, JSON.stringify({ Replace: replace }));
  const args = ['test', '-count=1', '-overlay', overlay, '-json', './cmd/kogen-review'];
  const run = spawnSync('go', args, { cwd: dir, env: { ...process.env, PWD: dir }, encoding: 'utf8', timeout: 100000, maxBuffer: 64 * 1024 * 1024 });
  fs.rmSync(scratch, { recursive: true, force: true });
  const events = [];
  for (const line of (run.stdout || '').split('\n')) {
    if (line.trim() === '') continue;
    try {
      events.push(JSON.parse(line));
    } catch (e) {
      // not a test event line
    }
  }
  world.run = {
    command: `go ${args.join(' ')}`,
    status: run.status,
    error: run.error ? String(run.error) : '',
    events,
    raw: `${run.stdout || ''}${run.stderr || ''}`,
    mutation: description === undefined ? 'none' : description,
  };
}

function testEvents(world, action) {
  return world.run.events.filter((e) => e.Test && e.Action === action);
}

function detailOf(r) {
  return `${r.command} (mutation: ${r.mutation}, exit ${r.status}${r.error ? ', ' + r.error : ''})\n${r.raw.slice(0, 4000)}`;
}

Given('cli-invalid-input-contract: the kogen-review command with main.go and main_test.go', function () {
  const dir = root();
  const text = fs.readFileSync(path.join(dir, SOURCE_FILE), 'utf8');
  assert.ok(text.includes('func run(args []string, stdout, stderr io.Writer) int'), `cli-invalid-input-contract: ${SOURCE_FILE} lacks run`);
  assert.ok(fs.existsSync(path.join(dir, TEST_FILE)), `cli-invalid-input-contract: ${TEST_FILE} does not exist`);
});

When('cli-invalid-input-contract: the tests of cmd\\/kogen-review are run against the current main.go', { timeout: 120000 }, function () {
  runPackageTests(this);
});

When('cli-invalid-input-contract: the tests of cmd\\/kogen-review are run against a main.go where {string}', { timeout: 120000 }, function (description) {
  assert.ok(MUTATIONS[description], `cli-invalid-input-contract: unknown mutation ${JSON.stringify(description)}`);
  runPackageTests(this, description);
});

Then('cli-invalid-input-contract: every test passes and a test beyond the existing ones ran', function () {
  const r = this.run;
  const failed = testEvents(this, 'fail');
  const passed = testEvents(this, 'pass');
  assert.strictEqual(failed.length, 0, `cli-invalid-input-contract: tests failed: ${failed.map((e) => e.Test).join(', ')}\n${detailOf(r)}`);
  assert.strictEqual(r.status, 0, `cli-invalid-input-contract: go test exited ${r.status}\n${detailOf(r)}`);
  const added = passed.filter((e) => !EXISTING_TESTS.some((t) => e.Test === t || e.Test.startsWith(t + '/')));
  assert.ok(added.length >= 1, `cli-invalid-input-contract: no passing test besides ${EXISTING_TESTS.join(' and ')} (and their subtests) ran in ${TEST_FILE}\n${detailOf(r)}`);
});

Then('cli-invalid-input-contract: a test fails', function () {
  const r = this.run;
  const failed = testEvents(this, 'fail').filter((e) => !EXISTING_TESTS.includes(e.Test) && !EXISTING_TESTS.some((t) => e.Test.startsWith(t + '/')));
  assert.ok(failed.length > 0, `cli-invalid-input-contract: no test beyond the existing ones failed against the mutated main.go "${r.mutation}", so the tests would not notice that change\n${detailOf(r)}`);
  assert.notStrictEqual(r.status, 0, `cli-invalid-input-contract: go test exited 0 against the mutated main.go "${r.mutation}"\n${detailOf(r)}`);
});
