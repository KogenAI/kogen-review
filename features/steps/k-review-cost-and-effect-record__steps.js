// Steps of Intent k-review-cost-and-effect-record: every review's result records what the review
// cost (requests, input, cached and output tokens, wall time), its repair rounds and its effect,
// with the same cost totals for the whole attempt and the review's share of them. The steps make
// a saved candidate in a temporary Git checkout; a scripted reviewer, whose every model call
// reports the same usage, reviews it through the review driver
// (k-review-cost-and-effect-record__driver.js), a Go program built in a copy of this checkout
// that calls review.Independent (and, after a blocked stop, review.Independent.Resume from the
// latest checkpoint) or review.NewExternal over a scripted executor. The review gives one
// observation, which the judgments below compare with the feature's expected values.
//
// "$KOGEN_NODE" <this file> --control good|bad checks the judgments against known-good and
// known-bad observations; Cucumber loads this file as step definitions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const prefix = 'k-review-cost-and-effect-record: ';

// ---- Judgments: each compares one part of an observation with its expected value. ----

// An observation: verdict (approve, changes, invalid or error) and stop ("class/reason" or "")
// of the review's last call; account (review.Result.Account as JSON, or the text that the field
// does not exist); attempt_setup ("" or why the driver could not set review.Input.Attempt);
// calls_ms (the milliseconds the driver measured around each call of the review: Review, and
// Resume after a blocked stop); first (the first call's verdict, stop and stop lines); resumed
// (the latest checkpoint the resume continued: its stage and its session's wall_ms and blockers;
// null without a resume); parts (the parts of a review in parts, 0 without); candidate_tree (the
// saved candidate's tree) and tree_after (the tree of the checkout's files after the review).
function shown(o) {
  return JSON.stringify(o, (k, v) => (typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v), 1);
}

// pick is the observed value of each key of expected (null for an absent key).
function pick(observed, expected) {
  const out = {};
  for (const k of Object.keys(expected)) out[k] = observed && Object.prototype.hasOwnProperty.call(observed, k) ? observed[k] : null;
  return out;
}

function account(o) {
  assert.ok(o.account && typeof o.account === 'object', `the review's result has no account: ${shown(o)}`);
  return o.account;
}

const judge = {
  ending(o, verdict, stop) {
    assert.deepStrictEqual({ verdict: o.verdict, stop: o.stop }, { verdict, stop }, `the review's ending differs: ${shown(o)}`);
  },
  parts(o, n) {
    assert.equal(o.parts, n, `the review was reviewed in ${o.parts} parts, want ${n}: ${shown(o)}`);
  },
  cost(o, which, expected) {
    const a = account(o);
    assert.deepStrictEqual(pick(a[which], expected), expected, `the ${which} cost in the account differs: ${shown(o)}`);
  },
  wall(o, min) {
    const w = account(o).review && account(o).review.wall_ms;
    const inside = o.calls_ms.reduce((a, b) => a + b, 0);
    assert.ok(Number.isInteger(w), `the review's wall time is not an integer number of milliseconds: ${shown(o)}`);
    assert.ok(w >= min, `the review's wall time is ${w} ms, less than the ${min} ms its scripted calls and Kogen took: ${shown(o)}`);
    assert.ok(w <= inside, `the review's wall time is ${w} ms, more than the ${inside} ms the driver measured inside the review's calls: ${shown(o)}`);
  },
  repairs(o, n) {
    assert.equal(account(o).repair_rounds, n, `the account's repair rounds are ${account(o).repair_rounds}, want ${n}: ${shown(o)}`);
  },
  effect(o, expected) {
    const e = account(o).effect;
    assert.ok(e && typeof e === 'object', `the account has no effect: ${shown(o)}`);
    assert.deepStrictEqual(pick(e, expected), expected, `the account's effect differs: ${shown(o)}`);
    assert.equal(e.first_tree, o.candidate_tree, `the effect's first tree is not the saved candidate's tree: ${shown(o)}`);
    assert.equal(e.final_tree, o.tree_after, `the effect's final tree is not the tree of the checkout's files after the review: ${shown(o)}`);
  },
  attempt(o, expected, wall) {
    assert.equal(o.attempt_setup, '', `the driver could not give the review the attempt's cost: ${o.attempt_setup}`);
    const a = account(o);
    assert.deepStrictEqual(pick(a.attempt, expected), expected, `the attempt's cost in the account differs: ${shown(o)}`);
    assert.ok(a.review && Number.isInteger(a.review.wall_ms), `the account has no review wall time: ${shown(o)}`);
    assert.equal(a.attempt.wall_ms, wall + a.review.wall_ms, `the attempt's wall time is not ${wall} ms plus the review's ${a.review.wall_ms} ms: ${shown(o)}`);
  },
  share(o, expected) {
    const a = account(o);
    assert.deepStrictEqual(pick(a.share, expected), expected, `the review's share in the account differs: ${shown(o)}`);
    assert.ok(a.review && a.attempt && a.attempt.wall_ms > 0, `the account has no attempt wall time to divide by: ${shown(o)}`);
    assert.equal(a.share.wall_ms, a.review.wall_ms / a.attempt.wall_ms, `the wall time share is not ${a.review.wall_ms} / ${a.attempt.wall_ms}: ${shown(o)}`);
  },
  resumed(o, verdict, stop, stage, min, blockers) {
    assert.deepStrictEqual({ verdict: o.first.verdict, stop: o.first.stop }, { verdict, stop }, `the review's first call ended otherwise: ${shown(o)}`);
    assert.ok(o.resumed, `the review was not resumed: ${shown(o)}`);
    assert.equal(o.resumed.stage, stage, `the resume continued a checkpoint of another stage: ${shown(o)}`);
    assert.ok(Number.isInteger(o.resumed.wall_ms) && o.resumed.wall_ms >= min && o.resumed.wall_ms <= o.calls_ms[0],
      `the checkpoint the resume continued kept ${o.resumed.wall_ms} ms of wall time, want at least ${min} ms and at most the first call's ${o.calls_ms[0]} ms: ${shown(o)}`);
    assert.deepStrictEqual(o.resumed.blockers, blockers, `the checkpoint the resume continued kept other blockers: ${shown(o)}`);
  },
};

// ---- Controls: the judgments accept known-good observations and reject known-bad ones. ----

const T0 = 'dd01b910c67511955b99f1b39c459015d49dcb63';
const T1 = '6c2c85a9c5a12d03ed38f72e03484ebc6267f1e2';
const TB = '991ece0d9f01ba55e6818a0cbecc6f7bb9dbc104';
const DEFECT = 'app.txt:2: app.txt counts 2 in digits where the Intent requires two';
const tokens = (requests, input, cached, output) => ({ requests, input, cached, output });
const effect = (changed, files, added, deleted, blockers, defects, green) => ({
  tree_changed: changed, files_changed: files, lines_added: added, lines_deleted: deleted, blockers, defects, first_tree_green: green,
});

function control(mode) {
  const cases = [
    {
      // The review in two parts (synthetic acceptance 4).
      good: {
        verdict: 'approve', stop: '', attempt_setup: '', calls_ms: [1432], first: { verdict: 'approve', stop: '', lines: [] }, resumed: null, parts: 2,
        candidate_tree: TB, tree_after: TB,
        account: {
          review: { requests: 2, input: 3000, cached: 1000, output: 300, wall_ms: 1431 }, attempt: { requests: 2, input: null, cached: null, output: null, wall_ms: 1431 },
          share: { requests: null, input: null, cached: null, output: null, wall_ms: 1 }, repair_rounds: 0,
          effect: { first_tree: TB, final_tree: TB, ...effect(false, 0, 0, 0, 0, [], true) },
        },
      },
      checks: [['ending', 'approve', ''], ['parts', 2], ['cost', 'review', tokens(2, 3000, 1000, 300)], ['wall', 1200], ['repairs', 0], ['effect', effect(false, 0, 0, 0, 0, [], true)]],
      bad: [
        (o) => { o.account.review.input = 10000; },
        (o) => { o.account.review.requests = 3; },
        (o) => { o.account.review.wall_ms = 600; },
        (o) => { o.account.review.wall_ms = 1500; },
        (o) => { o.account.review.wall_ms = 1431.5; },
        (o) => { o.parts = 1; },
        (o) => { o.account.effect.first_tree_green = false; },
        (o) => { o.account.effect.final_tree = T0; },
        (o) => { o.account = 'review.Result has no field Account'; },
      ],
    },
    {
      // The blocked review resumed after a pause (synthetic acceptance 3).
      good: {
        verdict: 'approve', stop: '', attempt_setup: '', calls_ms: [695, 459], parts: 0, candidate_tree: T0, tree_after: T1,
        first: { verdict: 'changes', stop: 'candidate/review_blocked', lines: [`review: ${DEFECT}`] },
        resumed: { stage: 'review_verify', wall_ms: 690, blockers: [DEFECT] },
        account: {
          review: { requests: 3, input: 4500, cached: 1500, output: 450, wall_ms: 1140 }, attempt: { requests: 3, input: null, cached: null, output: null, wall_ms: 1140 },
          share: { requests: null, input: null, cached: null, output: null, wall_ms: 1 }, repair_rounds: 0,
          effect: { first_tree: T0, final_tree: T1, ...effect(true, 1, 1, 1, 1, [DEFECT], false) },
        },
      },
      checks: [['ending', 'approve', ''], ['resumed', 'changes', 'candidate/review_blocked', 'review_verify', 600, [DEFECT]], ['cost', 'review', tokens(3, 4500, 1500, 450)],
        ['wall', 900], ['repairs', 0], ['effect', effect(true, 1, 1, 1, 1, [DEFECT], false)]],
      bad: [
        (o) => { o.account.review.wall_ms = 2154; },
        (o) => { o.account.review.wall_ms = 459; },
        (o) => { o.account.review = { ...o.account.review, requests: 1, input: 1500, cached: 500, output: 150 }; },
        (o) => { o.account.effect.blockers = 0; o.account.effect.defects = []; },
        (o) => { o.account.effect.defects = ['app.txt counts 2 in digits where the Intent requires two']; },
        (o) => { o.account.effect.first_tree_green = true; },
        (o) => { o.account.effect.lines_added = 2; },
        (o) => { o.resumed.wall_ms = null; },
        (o) => { o.resumed.blockers = null; },
        (o) => { o.first.verdict = 'approve'; o.first.stop = ''; },
      ],
    },
    {
      // The attempt's totals and the review's share (synthetic acceptance 6).
      good: {
        verdict: 'approve', stop: '', attempt_setup: '', calls_ms: [309], first: { verdict: 'approve', stop: '', lines: [] }, resumed: null, parts: 0,
        candidate_tree: T0, tree_after: T0,
        account: {
          review: { requests: 2, input: 3000, cached: 1000, output: 300, wall_ms: 300 }, attempt: { requests: 8, input: 12000, cached: 4000, output: 2000, wall_ms: 4300 },
          share: { requests: 0.25, input: 0.25, cached: 0.25, output: 0.15, wall_ms: 300 / 4300 }, repair_rounds: 0,
          effect: { first_tree: T0, final_tree: T0, ...effect(false, 0, 0, 0, 0, [], true) },
        },
      },
      checks: [['cost', 'review', tokens(2, 3000, 1000, 300)], ['attempt', tokens(8, 12000, 4000, 2000), 4000], ['share', { requests: 0.25, input: 0.25, cached: 0.25, output: 0.15 }]],
      bad: [
        (o) => { o.account.attempt.input = 9000; },
        (o) => { o.account.attempt.wall_ms = 4000; },
        (o) => { o.account.share.output = 0.1; },
        (o) => { o.account.share.wall_ms = 0.07; },
        (o) => { o.account.share.wall_ms = null; },
        (o) => { o.attempt_setup = 'review.Input has no field Attempt'; },
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
    // Today's review of the first scenario, as the driver observed it on the tree before the
    // Intent: the approval's result has no account.
    const today = {
      account: 'review.Result has no field Account', attempt_setup: '', calls_ms: [309], candidate_tree: T0, first: { lines: [], stop: '', verdict: 'approve' },
      lines: [], parts: 0, repairs: 0, requests: 2, resumed: null, rounds: 0, sessions: 0, stop: '', tree_after: T0, verdict: 'approve', verifications: 0,
    };
    try {
      judge.ending(today, 'approve', '');
      judge.cost(today, 'review', tokens(2, 3000, 1000, 300));
    } catch (e) {
      console.log('rejected the review result without its account');
      process.exitCode = 1;
      return;
    }
    throw new Error('the review result without its account was accepted');
  }
  console.log('observer controls passed');
}

if (require.main === module) {
  assert.ok(process.argv[2] === '--control' && ['good', 'bad'].includes(process.argv[3]), 'usage: <this file> --control good|bad');
  control(process.argv[3]);
} else {
  steps();
}

// ---- The scripted review. ----

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

  function git(dir, ...args) {
    const r = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
      cwd: dir, encoding: 'utf8', env: isolated({}),
    });
    assert.equal(r.status, 0, `git ${args.join(' ')} in ${dir} exited ${r.status}:\n${r.stdout}${r.stderr}${r.error || ''}`);
    return r.stdout.trim();
  }

  // The approved Intent "fixture" of every saved candidate.
  const intentFiles = {
    '.kogen/project.yaml': 'version: 1\ncommands:\n  setup: []\n  fix: []\n  checks: []\n',
    '.kogen/intents/fixture/intent.md': '# Count to three in words\n\nSlug: fixture\nModel: not applicable — one text file\nAcceptance:\n- .kogen/intents/fixture/acceptance.feature\n\napp.txt counts one, two, three in words.\n',
    '.kogen/intents/fixture/acceptance.feature': 'Feature: Count\n\n  Scenario: Count in words\n    Then app.txt counts in words\n',
  };

  // The start commit holds the approved Intent and the start files; the saved candidate commit,
  // the checkout's HEAD, writes the candidate files over them.
  function fixture(world, start, candidate) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-candidate-'));
    git(root, 'init', '-q', '-b', 'main');
    const write = (files) => {
      for (const [file, body] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), body);
      }
    };
    write({ ...intentFiles, ...start });
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'start');
    const commit = git(root, 'rev-parse', 'HEAD');
    write(candidate);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'saved candidate');
    world.fixture = { root, start: commit };
    world.plan = { reviewer: 'native', usage: { input: 0, cached: 0, output: 0 }, delay: 0, answers: [], rounds: [], verify: [], gap: 0, resume: false, pause: 0, attempt: null, prior: null };
  }

  function plan(world) {
    assert.ok(world.plan, 'make the saved candidate first');
    return world.plan;
  }

  // The doc string is a JSON object {start, candidate}, each a map of file path to text.
  Given(prefix + 'a saved candidate whose files are, at its start commit and in the candidate:', function (doc) {
    const files = JSON.parse(doc);
    fixture(this, files.start, files.candidate);
  });

  Given(prefix + 'a saved candidate that adds two files of {int} lines each, too large for one review prompt', function (lines) {
    const big = (k) => Array.from({ length: lines }, (_, i) => `line ${String(i + 1).padStart(6, '0')} of the large file ${k}\n`).join('');
    fixture(this, { 'app.txt': 'one\ntwo\nthree\n', 'lib.txt': 'alpha\nbeta\n' }, { 'big-1.txt': big(1), 'big-2.txt': big(2) });
  });

  Given(prefix + 'every call of the scripted reviewer reports {int} input, {int} cached and {int} output tokens and takes {int} ms', function (input, cached, output, ms) {
    Object.assign(plan(this), { usage: { input, cached, output }, delay: ms });
  });

  // The doc string is a JSON list with one answer per model request: a list of tool calls
  // {name, args}, or {"error": text}: the request fails with that error.
  Given(prefix + 'the native reviewer answers in order:', function (doc) {
    const answers = JSON.parse(doc);
    assert.ok(Array.isArray(answers) && answers.every((a) => Array.isArray(a) || (a && typeof a.error === 'string')), 'the answers are not a list of tool-call lists or errors');
    Object.assign(plan(this), { reviewer: 'native', answers });
  });

  // The doc string is a JSON list with one structured verdict per executor round.
  Given(prefix + 'the external reviewer\'s rounds return in order:', function (doc) {
    const rounds = JSON.parse(doc);
    assert.ok(Array.isArray(rounds) && rounds.every((r) => r && typeof r === 'object'), 'the rounds are not a list of verdict objects');
    Object.assign(plan(this), { reviewer: 'external', rounds: rounds.map((r) => JSON.stringify(r)) });
  });

  // results is a comma-separated list of green and red.
  Given(prefix + 'Kogen\'s verifications of the candidate are in order {string}', function (results) {
    const list = results.split(',').map((s) => s.trim());
    assert.ok(list.every((s) => ['green', 'red'].includes(s)), `${results} is not a list of green and red`);
    plan(this).verify = list;
  });

  Given(prefix + 'Kogen takes {int} ms to record the pending review between the parts', function (ms) {
    plan(this).gap = ms;
  });

  Given(prefix + 'the reviewer\'s executor state in the Build already holds {int} input, {int} cached and {int} output tokens', function (input, cached, output) {
    plan(this).prior = { input, cached, output };
  });

  Given(prefix + 'the attempt before the review used {int} requests, {int} input, {int} cached and {int} output tokens and {int} ms', function (requests, input, cached, output, ms) {
    plan(this).attempt = { requests, input, cached, output, wall_ms: ms };
  });

  let driver = null; // the one build of this process: {bin, status, output}

  // The driver is built in a copy of this checkout's files.
  function buildDriver() {
    if (!driver) {
      const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-driver-src-'));
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
      fs.mkdirSync(path.join(copy, 'internal', 'costdriver'), { recursive: true });
      fs.writeFileSync(path.join(copy, 'internal', 'costdriver', 'main.go'), require('./k-review-cost-and-effect-record__driver.js'));
      const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cost-driver-bin-')), 'costdriver');
      const r = spawnSync('go', ['build', '-mod=readonly', '-buildvcs=false', '-o', bin, './internal/costdriver'], { cwd: copy, encoding: 'utf8', env: isolated({}) });
      driver = { bin, status: r.status, output: `${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
      fs.rmSync(copy, { recursive: true, force: true });
    }
    assert.equal(driver.status, 0, `go build ./internal/costdriver (the review driver in a copy of this checkout) exited ${driver.status}:\n${driver.output}`);
    return driver.bin;
  }

  function review(world) {
    const p = plan(world);
    const bin = buildDriver();
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-driver-'));
    const file = path.join(work, 'plan.json');
    const out = path.join(work, 'observation.json');
    fs.writeFileSync(file, JSON.stringify(p));
    const r = spawnSync(bin, [], {
      cwd: work, encoding: 'utf8', timeout: 240000,
      env: isolated({ HOME: work, COST_ROOT: world.fixture.root, COST_START: world.fixture.start, COST_SLUG: 'fixture', COST_PLAN: file, COST_OUT: out }),
    });
    assert.equal(r.status, 0, `the review driver exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ''}:\n${r.stdout}${r.stderr}${r.error || ''}`);
    world.observed = JSON.parse(fs.readFileSync(out, 'utf8'));
  }

  When(prefix + 'the review runs', { timeout: 300000 }, function () {
    review(this);
  });

  When(prefix + 'the review runs, stops blocked and, after a pause of {int} ms, is resumed from its latest checkpoint', { timeout: 300000 }, function (ms) {
    Object.assign(plan(this), { resume: true, pause: ms });
    review(this);
  });

  function observed(world) {
    assert.ok(world.observed, 'no review ran: use "the review runs" first');
    return world.observed;
  }

  // stop is "class/reason", or "none" for a review that did not stop.
  Then(prefix + 'the review ends with the verdict {string} and the stop {string}', function (verdict, stop) {
    judge.ending(observed(this), verdict, stop === 'none' ? '' : stop);
  });

  Then(prefix + 'the review was reviewed in {int} parts', function (n) {
    judge.parts(observed(this), n);
  });

  Then(prefix + 'the review\'s account records {int} requests, {int} input, {int} cached and {int} output tokens', function (requests, input, cached, output) {
    judge.cost(observed(this), 'review', tokens(requests, input, cached, output));
  });

  Then(prefix + 'the review\'s account records at least {int} ms of wall time and no more than the driver measured inside the review\'s calls', function (ms) {
    judge.wall(observed(this), ms);
  });

  Then(prefix + 'the review\'s account records {int} repair rounds', function (n) {
    judge.repairs(observed(this), n);
  });

  // The doc string is a JSON object of the effect's keys; the effect's first_tree and final_tree
  // are checked against the saved candidate's tree and the checkout's tree after the review.
  Then(prefix + 'the review\'s account records the effect:', function (doc) {
    judge.effect(observed(this), JSON.parse(doc));
  });

  Then(prefix + 'the attempt\'s account records {int} requests, {int} input, {int} cached and {int} output tokens and {int} ms plus the review\'s wall time', function (requests, input, cached, output, ms) {
    judge.attempt(observed(this), tokens(requests, input, cached, output), ms);
  });

  Then(prefix + 'the review\'s share of the attempt is {float} of the requests, {float} of the input, {float} of the cached and {float} of the output tokens, and its wall time divided by the attempt\'s', function (requests, input, cached, output) {
    judge.share(observed(this), { requests, input, cached, output });
  });

  // The doc string is the JSON list of the blockers the checkpoint's session kept.
  Then(prefix + 'its first call ended with the verdict {string} and the stop {string}, and the resumed checkpoint of the stage {string} kept at least {int} ms of wall time and the blockers:', function (verdict, stop, stage, ms, doc) {
    judge.resumed(observed(this), verdict, stop, stage, ms, JSON.parse(doc));
  });
}
