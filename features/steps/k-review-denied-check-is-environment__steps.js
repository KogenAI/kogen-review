// Steps of Intent k-review-denied-check-is-environment: a reviewer check that the reviewer's
// execution restriction refused is an environment limitation, not a candidate defect. The steps
// make a saved helper candidate in a temporary Git checkout: helper.sh's "start" creates the
// helper's lock in $LOCKDIR, the approved requirement is "Starting the helper creates its lock",
// and check-lock.sh is the reviewer's check, whose output the fixture controls. In one fixture
// the check plays a bind the restriction refuses: it appends the refused operation to the
// restriction's own log (the restriction's report, outside the checkout) and fails with its
// error. In the other the candidate's own code prints the error and the restriction reports
// nothing. A scripted reviewer then reviews it through the review driver
// (k-review-denied-check-is-environment__driver.js), a Go program built in a copy of this
// checkout that calls review.Independent under the restriction, whose Refused report is that
// log. The review gives one observation, which the judgments below compare with the feature's
// expected values.
//
// "$KOGEN_NODE" <this file> --control good|bad checks the judgments against known-good and
// known-bad observations; Cucumber loads this file as step definitions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const prefix = 'k-review-denied-check-is-environment: ';

// ---- Judgments: each compares one part of an observation with its expected value. ----

// An observation: requests (the model requests the review made), last_inputs (per request, the
// last item it sent: {tool_result} or {role, content}), shell_results (the shell calls and their
// outputs in the last request's input), verdict (approve, changes, invalid or error), stop
// ("class/reason" or ""), problems (of a review that ended invalid), record (review-1.json's
// findings, requirements and, when present, environment; null without the file),
// result_environment (the review's Result.Environment), restriction_setup ("" or why the driver
// could not set Tools.Restriction), verifications (how often the review asked Kogen to verify an
// edit), tree_after and candidate_tree (the tree of the checkout's files after the review and the
// saved candidate's tree).
// shown is the observation for a failure message, with long texts cut to 300 characters.
function shown(o) {
  return JSON.stringify(o, (k, v) => (typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v), 1);
}

const judge = {
  requests(o, n) {
    assert.equal(o.requests, n, `the review made ${o.requests} model requests, want ${n}: ${shown(o)}`);
  },
  toolResult(o, n, text) {
    assert.ok(n >= 1 && n <= o.last_inputs.length, `request ${n}: the review made ${o.requests} model requests: ${shown(o)}`);
    assert.deepStrictEqual(o.last_inputs[n - 1], { tool_result: text }, `the last input of request ${n} is not that tool result: ${shown(o)}`);
  },
  shellResult(o, command, status, text) {
    const r = o.shell_results.find((s) => s.command === command);
    assert.ok(r && typeof r.output === 'string' && r.output.startsWith(`exit status: ${status}\n`) && r.output.includes(text),
      `the reviewer was not given the output of ${JSON.stringify(command)} with exit status ${status} and the text ${JSON.stringify(text)}: ${shown(o)}`);
  },
  ending(o, verdict, stop) {
    assert.deepStrictEqual({ verdict: o.verdict, stop: o.stop }, { verdict, stop }, `the review's ending differs: ${shown(o)}`);
  },
  record(o) {
    assert.ok(o.record, `the review wrote no review-1.json: ${shown(o)}`);
    return o.record;
  },
  requirements(o, list) {
    assert.deepStrictEqual(judge.record(o).requirements, list, `review-1.json keeps other requirements: ${shown(o)}`);
  },
  findings(o, list) {
    assert.deepStrictEqual(judge.record(o).findings, list, `review-1.json keeps other findings: ${shown(o)}`);
  },
  environment(o, expected) {
    const setup = o.restriction_setup ? `the driver could not set the restriction: ${o.restriction_setup}` : 'the driver set the restriction';
    assert.deepStrictEqual(judge.record(o).environment, expected, `review-1.json shows another environment (${setup}): ${shown(o)}`);
    assert.deepStrictEqual(o.result_environment, expected, `the review's Result.Environment differs (${setup}): ${shown(o)}`);
  },
  verifications(o, n) {
    assert.equal(o.verifications, n, `the review asked Kogen to verify ${o.verifications} edits, want ${n}: ${shown(o)}`);
  },
  unchanged(o) {
    assert.equal(o.tree_after, o.candidate_tree, `the checkout's files changed in the review: ${shown(o)}`);
  },
};

// ---- Controls: the judgments accept known-good observations and reject known-bad ones. ----

const R = 'Starting the helper creates its lock';
const C = 'sh check-lock.sh';
const P = `d=$(mktemp -d) && LOCKDIR=$d sh helper.sh start && test -f "$d/helper.lock" && printf 'lock created'`;
const BIND = 'bind: operation not permitted';
const PERM = 'permission denied';
const unrun = `invalid verdict:\nrequirement "${R}" cites probe "${C}", which is unrun-by-environment: the reviewer's restricted execution (fixture sandbox) refused ${BIND} in its latest run, and the outer gates run without this restriction; a check the restriction refused is an environment limitation, neither evidence nor a candidate defect; cite a probe you ran with shell on the current tree that exercises the requirement, or, when nothing can verify it here, submit changes with a blocking finding that quotes the requirement and says its verification could not run`;
const failed = `invalid verdict:\nrequirement "${R}" cites probe "${C}", whose latest run in this review did not succeed (exit status 1): a probe that did not succeed does not show the requirement met; repair the candidate, or submit changes with a blocking finding that quotes the requirement`;

function control(mode) {
  const limited = { reviewer_restricted: true, outer_gates_restricted: false, restriction: 'fixture sandbox', limitations: [{ check: C, refused: [BIND] }] };
  const none = { ...limited, limitations: [] };
  const established = { requirement: R, evidence: 'probe', ref: P, met: true };
  const unmet = { requirement: R, evidence: 'probe', ref: C, met: false };
  const blocking = { path: 'helper.sh', line: 3, severity: 'blocking', message: `${R}: start refuses with ${PERM} although access to the lock folder is allowed` };
  const cases = [
    {
      // The refused check, then the focused probe that establishes the requirement.
      good: {
        requests: 2, last_inputs: [{ role: 'user', content: 'source' }, { tool_result: unrun }],
        shell_results: [{ command: C, output: `exit status: 1\n${BIND}\n` }], verdict: 'approve', stop: '', problems: [],
        record: { findings: [], requirements: [established], environment: limited }, result_environment: limited,
        restriction_setup: '', verifications: 0, tree_after: 'T1', candidate_tree: 'T1',
      },
      checks: [['requests', 2], ['shellResult', C, 1, BIND], ['toolResult', 2, unrun], ['ending', 'approve', ''], ['findings', []],
        ['requirements', [established]], ['environment', limited], ['verifications', 0], ['unchanged']],
      bad: [
        (o) => { o.last_inputs[1] = { tool_result: failed }; },
        (o) => { o.last_inputs[1] = { tool_result: unrun.replace('unrun-by-environment', 'not run') }; },
        (o) => { delete o.record.environment; },
        (o) => { o.result_environment = null; },
        (o) => { o.record.environment = none; o.result_environment = none; },
        (o) => { o.record.environment = { ...limited, outer_gates_restricted: true }; },
        (o) => { o.result_environment = { ...limited, limitations: [{ check: C, refused: [PERM] }] }; },
        (o) => { o.shell_results = []; },
        (o) => { o.shell_results[0].output = `exit status: 0\n${BIND}\n`; },
        (o) => { o.verdict = 'changes'; o.stop = 'candidate/review_blocked'; },
        (o) => { o.record.findings = [blocking]; },
        (o) => { o.record.requirements = [{ ...established, ref: C }]; },
        (o) => { o.verifications = 1; },
        (o) => { o.tree_after = 'T2'; },
        (o) => { o.requests = 3; },
      ],
    },
    {
      // The candidate's own permission denied: a probe that did not succeed, no limitation.
      good: {
        requests: 2, last_inputs: [{ role: 'user', content: 'source' }, { tool_result: failed }],
        shell_results: [{ command: C, output: `exit status: 1\n${PERM}\n` }], verdict: 'changes', stop: 'candidate/review_blocked', problems: [],
        record: { findings: [blocking], requirements: [unmet], environment: none }, result_environment: none,
        restriction_setup: '', verifications: 0, tree_after: 'T1', candidate_tree: 'T1',
      },
      checks: [['requests', 2], ['shellResult', C, 1, PERM], ['toolResult', 2, failed], ['ending', 'changes', 'candidate/review_blocked'],
        ['environment', none], ['unchanged']],
      bad: [
        (o) => { o.last_inputs[1] = { tool_result: unrun.replace(BIND, PERM) }; },
        (o) => { const l = { ...none, limitations: [{ check: C, refused: [PERM] }] }; o.record.environment = l; o.result_environment = l; },
        (o) => { o.verdict = 'approve'; o.stop = ''; },
        (o) => { delete o.record.environment; o.result_environment = null; },
        (o) => { o.shell_results = [{ command: C, output: 'exit status: 1\n' }]; },
      ],
    },
  ];
  for (const c of cases) {
    for (const [name, ...args] of c.checks) judge[name](structuredClone(c.good), ...args);
    for (const mutate of c.bad) {
      const o = structuredClone(c.good);
      mutate(o);
      assert.throws(() => { for (const [name, ...args] of c.checks) judge[name](o, ...args); }, assert.AssertionError, `a control accepted a mutation: ${mutate}`);
    }
  }
  if (mode === 'bad') {
    // Today's review of the refused check: the ordinary did-not-succeed problem, no environment.
    const today = {
      requests: 2, last_inputs: [{ role: 'user', content: 'source' }, { tool_result: failed }],
      shell_results: [{ command: C, output: `exit status: 1\n${BIND}\n` }], verdict: 'approve', stop: '', problems: [],
      record: { findings: [], requirements: [established] }, result_environment: 'review.Result has no field Environment',
      restriction_setup: 'review.Tools has no field Restriction', verifications: 0, tree_after: 'T1', candidate_tree: 'T1',
    };
    try {
      for (const [name, ...args] of cases[0].checks) judge[name](today, ...args);
    } catch (e) {
      if (!(e instanceof assert.AssertionError)) throw e;
      console.log("rejected today's review of a check the restriction refused");
      process.exitCode = 1;
      return;
    }
    throw new Error("today's review of a check the restriction refused was accepted");
  }
  console.log('observer controls passed');
}

if (require.main === module) {
  assert.ok(process.argv[2] === '--control' && ['good', 'bad'].includes(process.argv[3]), 'usage: <this file> --control good|bad');
  control(process.argv[3]);
} else {
  steps();
}

// ---- The fixture and the review driver. ----

function steps() {
  const { Given, When, Then } = require('@cucumber/cucumber');
  const checkout = process.cwd();

  // The caller's environment without GIT_* and the outer acceptance run's KOGEN_ACCEPTANCE_*
  // variables, with no global or system Git configuration, plus extra.
  function isolated(extra) {
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (!k.startsWith('GIT_') && !k.startsWith('KOGEN_ACCEPTANCE_')) env[k] = v;
    }
    return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...extra };
  }

  function git(dir, extra, ...args) {
    const r = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
      cwd: dir, encoding: 'utf8', env: isolated(extra),
    });
    assert.equal(r.status, 0, `git ${args.join(' ')} in ${dir} exited ${r.status}:\n${r.stdout}${r.stderr}${r.error || ''}`);
    return r.stdout.trim();
  }

  // The tree of the checkout's current files, as the review computes the candidate's tree.
  function treeNow(root, start) {
    const extra = { GIT_INDEX_FILE: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'denied-index-')), 'index') };
    git(root, extra, 'read-tree', start);
    git(root, extra, 'add', '-A', '--', '.');
    return git(root, extra, 'write-tree');
  }

  const startFiles = {
    '.kogen/project.yaml': 'version: 1\ncommands:\n  setup: []\n  fix: []\n  checks: []\n',
    '.kogen/intents/helper/intent.md': '# Create the helper lock on start\n\nSlug: helper\nModel: not applicable — a lock is one file\nAcceptance:\n- .kogen/intents/helper/acceptance.feature\n\nStarting the helper creates its lock.\n',
    '.kogen/intents/helper/acceptance.feature': 'Feature: Helper\n\n  Scenario: Start the helper and find its lock\n    Given a lock folder\n    When the helper starts\n    Then the helper lock exists\n',
    'helper.sh': '# helper.sh: the helper, run with its lock folder in $LOCKDIR.\ncase "$1" in\nstatus) test -f "$LOCKDIR/helper.lock" ;;\nesac\n',
  };

  // The candidate files of each fixture, for the check's error text.
  const candidates = {
    // The candidate is correct; the check plays the bind of the helper's local lock socket,
    // which the reviewer's restriction refuses and reports in its own log.
    restriction: (text) => ({
      'helper.sh': '# helper.sh: the helper, run with its lock folder in $LOCKDIR.\ncase "$1" in\nstart) : > "$LOCKDIR/helper.lock" ;;\nstatus) test -f "$LOCKDIR/helper.lock" ;;\nesac\n',
      'check-lock.sh': `# check-lock.sh: the reviewer's check of the helper's lock. In this fixture the reviewer's\n# execution restriction refuses the bind of the helper's local lock socket: the restriction\n# reports the refusal in its own log and the check fails with its error.\nprintf '%s\\n' '${text}' >> "$DENIED_RESTRICTION_LOG"\nprintf '%s\\n' '${text}' >&2\nexit 1\n`,
    }),
    // The candidate's own access check tests the lock it is about to create, so it refuses
    // although the lock folder is writable; the restriction reports nothing.
    candidate: (text) => ({
      'helper.sh': `# helper.sh: the helper, run with its lock folder in $LOCKDIR.\ncase "$1" in\nstart) if [ ! -w "$LOCKDIR/helper.lock" ]; then printf '%s\\n' '${text}' >&2; exit 1; fi; : > "$LOCKDIR/helper.lock" ;;\nstatus) test -f "$LOCKDIR/helper.lock" ;;\nesac\n`,
      'check-lock.sh': `# check-lock.sh: the reviewer's check of the helper's lock: access to the lock folder is\n# allowed, so starting the helper creates its lock.\nd=$(mktemp -d) && LOCKDIR=$d sh helper.sh start && test -f "$d/helper.lock" && printf '%s\\n' 'lock created'\n`,
    }),
  };

  // The start commit holds the approved Intent "helper" and helper.sh without "start"; the saved
  // candidate commit, the checkout's HEAD, adds "start" and the check.
  function fixture(world, command, text, kind) {
    assert.equal(command, C, `the fixture's check is ${JSON.stringify(C)}`);
    assert.ok(!text.includes("'") && !text.includes('\n'), 'the error text has no quote or newline');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'denied-helper-'));
    git(root, {}, 'init', '-q', '-b', 'main');
    const write = (files) => {
      for (const [file, body] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), body);
      }
    };
    write(startFiles);
    git(root, {}, 'add', '-A');
    git(root, {}, 'commit', '-q', '-m', 'start');
    const start = git(root, {}, 'rev-parse', 'HEAD');
    write(candidates[kind](text));
    git(root, {}, 'add', '-A');
    git(root, {}, 'commit', '-q', '-m', 'saved candidate');
    world.fixture = { root, start, tree: git(root, {}, 'rev-parse', 'HEAD^{tree}') };
  }

  Given(prefix + 'a saved helper candidate whose check {string} fails with {string} raised by the restriction', function (command, text) {
    fixture(this, command, text, 'restriction');
  });

  Given(prefix + 'a saved helper candidate whose check {string} fails with {string} printed by the candidate\'s own code', function (command, text) {
    fixture(this, command, text, 'candidate');
  });

  // The doc string is a JSON list with one list of tool calls {name, args} per model request.
  Given(prefix + 'the scripted reviewer answers in order:', function (doc) {
    this.answers = JSON.parse(doc);
    assert.ok(Array.isArray(this.answers) && this.answers.every((a) => Array.isArray(a) && a.length > 0), 'the answers are not a list of tool-call lists');
  });

  let driver = null; // the one build of this process: {bin, status, output}

  // The driver is built in a copy of this checkout's files.
  function buildDriver() {
    if (!driver) {
      const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'denied-driver-src-'));
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
      fs.mkdirSync(path.join(copy, 'internal', 'denieddriver'), { recursive: true });
      fs.writeFileSync(path.join(copy, 'internal', 'denieddriver', 'main.go'), require('./k-review-denied-check-is-environment__driver.js'));
      const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'denied-driver-bin-')), 'denieddriver');
      const r = spawnSync('go', ['build', '-mod=readonly', '-buildvcs=false', '-o', bin, './internal/denieddriver'], { cwd: copy, encoding: 'utf8', env: isolated({}) });
      driver = { bin, status: r.status, output: `${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
      fs.rmSync(copy, { recursive: true, force: true });
    }
    assert.equal(driver.status, 0, `go build ./internal/denieddriver (the review driver in a copy of this checkout) exited ${driver.status}:\n${driver.output}`);
    return driver.bin;
  }

  When(prefix + 'the review driver reviews the candidate under the restriction {string}', { timeout: 300000 }, function (name) {
    assert.ok(this.fixture && this.answers, 'make the saved helper candidate and the scripted answers first');
    const bin = buildDriver();
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'denied-driver-'));
    const answers = path.join(work, 'answers.json');
    const out = path.join(work, 'observation.json');
    const log = path.join(work, 'restriction.log');
    fs.writeFileSync(answers, JSON.stringify(this.answers));
    fs.writeFileSync(log, '');
    const r = spawnSync(bin, [], {
      cwd: work, encoding: 'utf8', timeout: 240000,
      env: isolated({
        HOME: work, DENIED_ROOT: this.fixture.root, DENIED_START: this.fixture.start, DENIED_SLUG: 'helper',
        DENIED_RESTRICTION: name, DENIED_RESTRICTION_LOG: log, DENIED_ANSWERS: answers, DENIED_OUT: out,
      }),
    });
    assert.equal(r.status, 0, `the review driver exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ''}:\n${r.stdout}${r.stderr}${r.error || ''}`);
    this.observed = JSON.parse(fs.readFileSync(out, 'utf8'));
    this.observed.tree_after = treeNow(this.fixture.root, this.fixture.start);
    this.observed.candidate_tree = this.fixture.tree;
  });

  function observed(world) {
    assert.ok(world.observed, 'no review ran: use "the review driver reviews the candidate under the restriction ..." first');
    return world.observed;
  }

  Then(prefix + 'the review made {int} model requests', function (n) {
    judge.requests(observed(this), n);
  });

  Then(prefix + 'the reviewer was given the output of {string} with exit status {int} and the text {string}', function (command, status, text) {
    judge.shellResult(observed(this), command, status, text);
  });

  // The tool result is the doc string exactly.
  Then(prefix + 'the last input of request {int} is the tool result:', function (n, text) {
    judge.toolResult(observed(this), n, text);
  });

  // stop is "class/reason", or "none" for a review that did not stop.
  Then(prefix + 'the review ends with the verdict {string} and the stop {string}', function (verdict, stop) {
    judge.ending(observed(this), verdict, stop === 'none' ? '' : stop);
  });

  Then(prefix + 'the review record keeps no finding against the candidate', function () {
    judge.findings(observed(this), []);
  });

  // The doc string is the JSON list review-1.json keeps under "requirements".
  Then(prefix + 'the review record keeps the requirements:', function (doc) {
    judge.requirements(observed(this), JSON.parse(doc));
  });

  // The doc string is the JSON object review-1.json keeps under "environment" and the review's
  // Result.Environment is.
  Then(prefix + 'the review record and its result show the environment:', function (doc) {
    judge.environment(observed(this), JSON.parse(doc));
  });

  Then(prefix + 'Kogen verified no edit of the reviewer', function () {
    judge.verifications(observed(this), 0);
  });

  Then(prefix + 'the checkout\'s files are still the saved candidate\'s', function () {
    judge.unchanged(observed(this));
  });
}
