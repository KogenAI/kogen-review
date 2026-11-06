// Steps of Intent k-review-binding-requirements-accepted-only: only the requirement texts of an
// accepted submission of a review bind its later approvals; a refused submission lists nothing.
// The review driver (k-review-binding-requirements-accepted-only__driver.js), a Go program built
// in a copy of this checkout, makes a saved candidate whose tool prints a total and runs the native
// reviewer (review.Independent) on it once with a scripted model, given a green pass of the
// candidate whose acceptance scenario "Print the total of two numbers" passed. A reviewer's edit
// that breaks the total is verified red and sent back for another round. The review gives one
// observation, which the judgments below compare with the feature's expected values.
//
// "$KOGEN_NODE" <this file> --control good|bad checks the judgments against known-good and
// known-bad observations; Cucumber loads this file as step definitions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const prefix = 'k-review-binding-requirements-accepted-only: ';

// The opening of the feedback a red verification of the reviewer's edits sends back.
const repairFeedback = 'Final verification of your repairs failed.';

// ---- Judgments: each compares one part of an observation with its expected value. ----

// An observation: requests (the model requests the review made), last_inputs (per request, the
// last item it sent: {tool_result} or {role, content}), verdict (approve, changes, invalid or
// error), stop ("class/reason" or ""), problems (of a review that ended invalid), requirements
// (what review-1.json keeps under "requirements", null without the file), verifications (per
// verification of the reviewer's edits, whether it was green) and listed (the requirement texts of
// the last checkpoint the review saved). shown is the observation for a failure message, with long
// texts cut to 300 characters.
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
  repairRound(o, n) {
    assert.ok(n >= 1 && n <= o.last_inputs.length, `request ${n}: the review made ${o.requests} model requests: ${shown(o)}`);
    const last = o.last_inputs[n - 1];
    assert.ok(last.role === 'user' && typeof last.content === 'string' && last.content.startsWith(repairFeedback),
      `request ${n} does not follow a red verification of the reviewer's edit (its last input is not the repair feedback "${repairFeedback} ..."): ${shown(o)}`);
  },
  verifications(o, list) {
    assert.deepStrictEqual(o.verifications.map((green) => (green ? 'green' : 'red')), list, `the verifications of the reviewer's edits differ: ${shown(o)}`);
  },
  ending(o, verdict, stop) {
    assert.deepStrictEqual({ verdict: o.verdict, stop: o.stop }, { verdict, stop }, `the review's ending differs: ${shown(o)}`);
  },
  problems(o, list) {
    assert.deepStrictEqual(o.problems, list, `the problems of the review's end differ: ${shown(o)}`);
  },
  requirements(o, list) {
    assert.deepStrictEqual(o.requirements, list, `review-1.json keeps other requirements: ${shown(o)}`);
  },
  listed(o, list) {
    assert.deepStrictEqual(o.listed, list, `the review's last checkpoint lists other requirements: ${shown(o)}`);
  },
};

// ---- Controls: the judgments accept known-good observations and reject known-bad ones. ----

const suffix = 'cite a probe you ran with shell on the current tree that exercises the requirement, or, when nothing can verify it here, submit changes with a blocking finding that quotes the requirement and says its verification could not run';
const noScenario = `invalid verdict:\nrequirement "R1" cites acceptance "Print the receipt of a total", which names no scenario of the acceptance result: name the scenario that exercises the requirement, or ${suffix}`;
const missing = (r) => `requirement "${r}" was listed by an earlier submission of this review and is missing: keep every requirement in requirements, with evidence observed on the current tree`;

function control(mode) {
  const opening = { role: 'user', content: 'OPENING' };
  const feedback = { role: 'user', content: `${repairFeedback} Fix these failures and regressions from your edits; do not restart a whole-change critique.\nsh total.sh 2 3 did not print 5` };
  const entry = (requirement, evidence = 'test', ref = 'total_test.sh') => ({ requirement, evidence, ref, met: true });
  const r1a = entry('R1a', 'acceptance', 'Print the total of two numbers');
  const r1b = entry('R1b');
  const cases = [
    {
      // A refused submission's requirement split in a later approval, as the feature expects it.
      good: { requests: 2, last_inputs: [opening, { tool_result: noScenario }], verdict: 'approve', stop: '', problems: [], requirements: [r1a, r1b], verifications: [], listed: ['R1a', 'R1b'] },
      checks: [['requests', 2], ['toolResult', 2, noScenario], ['ending', 'approve', ''], ['requirements', [r1a, r1b]], ['listed', ['R1a', 'R1b']]],
      bad: [
        (o) => { o.listed = ['R1', 'R1a', 'R1b']; },
        (o) => { o.listed = ['R1']; },
        (o) => { o.requirements = [r1b, r1a]; },
        (o) => { o.requirements = [r1a]; o.listed = ['R1a']; },
        (o) => { o.last_inputs[1] = { tool_result: `${noScenario}\n${missing('R1')}` }; },
        (o) => { o.last_inputs[1] = { tool_result: noScenario.replace('names no scenario', 'did not run') }; },
        (o) => { o.requests = 1; o.last_inputs.pop(); },
      ],
    },
    {
      // A requirement an accepted submission listed, dropped after a repair round, then restored.
      good: {
        requests: 3, last_inputs: [opening, feedback, { tool_result: `invalid verdict:\n${missing('R3')}` }], verdict: 'approve', stop: '', problems: [],
        requirements: [entry('R1'), entry('R2'), entry('R3')], verifications: [false, true], listed: ['R1', 'R2', 'R3'],
      },
      checks: [['requests', 3], ['repairRound', 2], ['toolResult', 3, `invalid verdict:\n${missing('R3')}`], ['ending', 'approve', ''], ['verifications', ['red', 'green']],
        ['requirements', [entry('R1'), entry('R2'), entry('R3')]], ['listed', ['R1', 'R2', 'R3']]],
      bad: [
        (o) => { o.requests = 2; o.last_inputs.pop(); },
        (o) => { o.last_inputs[1] = { tool_result: 'accepted' }; },
        (o) => { o.last_inputs[2] = { tool_result: `invalid verdict:\n${missing('R3')}\n${missing('R1')}` }; },
        (o) => { o.verifications = [true]; },
        (o) => { o.requirements = [entry('R1'), entry('R2')]; },
        (o) => { o.listed = ['R1', 'R2']; },
        (o) => { o.verdict = 'invalid'; o.stop = 'candidate/review_invalid'; o.problems = [missing('R3')]; },
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
    // Today's review of the split requirement: the repair is refused for the refused submission's
    // R1 alone and the review ends invalid (observed on the unchanged tree).
    const today = {
      requests: 2, last_inputs: [opening, { tool_result: noScenario }], verdict: 'invalid', stop: 'candidate/review_invalid',
      problems: [missing('R1')], requirements: null, verifications: [], listed: ['R1'],
    };
    try {
      for (const [name, ...args] of cases[0].checks) judge[name](today, ...args);
    } catch (e) {
      console.log('rejected the review that binds a refused submission');
      process.exitCode = 1;
      return;
    }
    throw new Error('the review that binds a refused submission was accepted');
  }
  console.log('observer controls passed');
}

if (require.main === module) {
  assert.ok(process.argv[2] === '--control' && ['good', 'bad'].includes(process.argv[3]), 'usage: <this file> --control good|bad');
  control(process.argv[3]);
} else {
  steps();
}

// ---- The review. ----

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

  // The doc string is a JSON list with one list of tool calls {name, args} per model request.
  Given(prefix + 'the scripted reviewer answers in order:', function (doc) {
    this.answers = JSON.parse(doc);
    assert.ok(Array.isArray(this.answers) && this.answers.every((a) => Array.isArray(a) && a.length > 0), 'the answers are not a list of tool-call lists');
  });

  let driver = null; // the one build of this process: {bin, status, output}

  // The driver is built in a copy of this checkout's files.
  function buildDriver() {
    if (!driver) {
      const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'binding-driver-src-'));
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
      fs.mkdirSync(path.join(copy, 'internal', 'bindingdriver'), { recursive: true });
      fs.writeFileSync(path.join(copy, 'internal', 'bindingdriver', 'main.go'), require('./k-review-binding-requirements-accepted-only__driver.js'));
      const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'binding-driver-bin-')), 'bindingdriver');
      const r = spawnSync('go', ['build', '-mod=readonly', '-buildvcs=false', '-o', bin, './internal/bindingdriver'], { cwd: copy, encoding: 'utf8', env: isolated({}) });
      driver = { bin, status: r.status, output: `${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
      fs.rmSync(copy, { recursive: true, force: true });
    }
    assert.equal(driver.status, 0, `go build ./internal/bindingdriver (the review driver in a copy of this checkout) exited ${driver.status}:\n${driver.output}`);
    return driver.bin;
  }

  When(prefix + 'the native reviewer reviews the saved total candidate', { timeout: 300000 }, function () {
    assert.ok(this.answers, 'give the scripted answers first');
    const bin = buildDriver();
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'binding-driver-'));
    const answers = path.join(work, 'answers.json');
    const out = path.join(work, 'observation.json');
    fs.writeFileSync(answers, JSON.stringify(this.answers));
    const r = spawnSync(bin, [], {
      cwd: work, encoding: 'utf8', timeout: 240000,
      env: isolated({ HOME: work, BINDING_ANSWERS: answers, BINDING_OUT: out }),
    });
    assert.equal(r.status, 0, `the review driver exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ''}:\n${r.stdout}${r.stderr}${r.error || ''}`);
    this.observed = JSON.parse(fs.readFileSync(out, 'utf8'));
  });

  function observed(world) {
    assert.ok(world.observed, 'no review ran: use "the native reviewer reviews the saved total candidate" first');
    return world.observed;
  }

  Then(prefix + 'the review made {int} model request(s)', function (n) {
    judge.requests(observed(this), n);
  });

  // The tool result is the doc string exactly.
  Then(prefix + 'the last input of request {int} is the tool result:', function (n, text) {
    judge.toolResult(observed(this), n, text);
  });

  // The request's last input is the feedback of a red verification of the reviewer's edits: the
  // approval it follows was accepted and sent back for another round.
  Then(prefix + 'request {int} follows a red verification of the reviewer\'s edit', function (n) {
    judge.repairRound(observed(this), n);
  });

  // list is the comma-separated outcomes (red or green) of the verifications, in order.
  Then(prefix + 'the reviewer\'s edits were verified {string}', function (list) {
    judge.verifications(observed(this), list.split(',').map((s) => s.trim()));
  });

  // stop is "class/reason", or "none" for a review that did not stop.
  Then(prefix + 'the review ends with the verdict {string} and the stop {string}', function (verdict, stop) {
    judge.ending(observed(this), verdict, stop === 'none' ? '' : stop);
  });

  // The doc string is the JSON list of the problems.
  Then(prefix + 'the review ends invalid with the problems:', function (doc) {
    const o = observed(this);
    judge.ending(o, 'invalid', 'candidate/review_invalid');
    judge.problems(o, JSON.parse(doc));
  });

  // The doc string is the JSON list review-1.json keeps under "requirements".
  Then(prefix + 'the review record keeps the requirements:', function (doc) {
    judge.requirements(observed(this), JSON.parse(doc));
  });

  // The doc string is the JSON list of the requirement texts (Session.Listed) of the last
  // checkpoint the review saved.
  Then(prefix + 'the review\'s last checkpoint lists the requirements:', function (doc) {
    judge.listed(observed(this), JSON.parse(doc));
  });
}
