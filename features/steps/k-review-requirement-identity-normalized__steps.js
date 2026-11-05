// Steps of Intent k-review-requirement-identity-normalized: a review's requirements are identified
// by their text with surrounding whitespace dropped, inner whitespace runs as one space and letter
// case ignored. The review driver (k-review-requirement-identity-normalized__driver.js), a Go
// program built in a copy of this checkout, makes a saved candidate whose tool prints a total and
// runs the native reviewer (review.Independent) on it once with a scripted model, given a green
// pass of the candidate. The review gives one observation, which the judgments below compare
// with the feature's expected values.
//
// "$KOGEN_NODE" <this file> --control good|bad checks the judgments against known-good and
// known-bad observations; Cucumber loads this file as step definitions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const prefix = 'k-review-requirement-identity-normalized: ';

// ---- Judgments: each compares one part of an observation with its expected value. ----

// An observation: requests (the model requests the review made), last_inputs (per request, the
// last item it sent: {tool_result} or {role, content}), verdict (approve, changes, invalid or
// error), stop ("class/reason" or ""), problems (of a review that ended invalid) and
// requirements (what review-1.json keeps under "requirements", null without the file).
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
  ending(o, verdict, stop) {
    assert.deepStrictEqual({ verdict: o.verdict, stop: o.stop }, { verdict, stop }, `the review's ending differs: ${shown(o)}`);
  },
  problems(o, list) {
    assert.deepStrictEqual(o.problems, list, `the problems of the review's end differ: ${shown(o)}`);
  },
  requirements(o, list) {
    assert.deepStrictEqual(o.requirements, list, `review-1.json keeps other requirements: ${shown(o)}`);
  },
};

// ---- Controls: the judgments accept known-good observations and reject known-bad ones. ----

const R = 'The tool prints a total';
const noEvidence = `invalid verdict:\nrequirement "${R}" has no evidence: probe it with shell against the candidate before the verdict`;
const missing = `requirement "${R}" was listed by an earlier submission of this review and is missing: keep every requirement in requirements, with evidence observed on the current tree`;
const twice = `invalid verdict:\nrequirement "${R}" is listed twice: list each requirement once in requirements, with one evidence, ref and met`;

function control(mode) {
  const opening = { role: 'user', content: 'OPENING' };
  const met = { requirement: R, evidence: 'test', ref: 'total_test.sh', met: true };
  const unmet = { ...met, met: false };
  const cases = [
    {
      // A respelled requirement in a later approval, as the feature expects it.
      good: { requests: 2, last_inputs: [opening, { tool_result: noEvidence }], verdict: 'approve', stop: '', problems: [], requirements: [met] },
      checks: [['requests', 2], ['toolResult', 2, noEvidence], ['ending', 'approve', ''], ['requirements', [met]]],
      bad: [
        (o) => { o.requirements = [{ ...met, requirement: '  the TOOL prints   a total ' }]; },
        (o) => { o.requirements = [met, met]; },
        (o) => { o.verdict = 'invalid'; o.stop = 'candidate/review_invalid'; o.problems = [missing]; o.requirements = null; },
        (o) => { o.last_inputs[1] = { tool_result: `${noEvidence}\n${noEvidence.replace('invalid verdict:\n', '')}` }; },
        (o) => { o.requests = 1; o.last_inputs.pop(); },
      ],
    },
    {
      // Conflicting entries of one identity, then one entry.
      good: { requests: 2, last_inputs: [opening, { tool_result: twice }], verdict: 'changes', stop: 'candidate/review_blocked', problems: [], requirements: [unmet] },
      checks: [['requests', 2], ['toolResult', 2, twice], ['ending', 'changes', 'candidate/review_blocked'], ['requirements', [unmet]]],
      bad: [
        (o) => { o.requests = 1; o.last_inputs.pop(); o.requirements = [met, unmet]; },
        (o) => { o.last_inputs[1] = { tool_result: twice.replace('is listed twice', 'is listed again') }; },
        (o) => { o.requirements = [met]; },
        (o) => { o.verdict = 'invalid'; o.stop = 'candidate/review_invalid'; },
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
    // Today's review of the respelled requirement: the second approval is refused as missing the
    // first spelling, and the review ends invalid (observed on the unchanged tree).
    const today = { requests: 2, last_inputs: [opening, { tool_result: noEvidence }], verdict: 'invalid', stop: 'candidate/review_invalid', problems: [missing], requirements: null };
    try {
      for (const [name, ...args] of cases[0].checks) judge[name](today, ...args);
    } catch (e) {
      console.log('rejected the review that refuses a respelled requirement');
      process.exitCode = 1;
      return;
    }
    throw new Error('the review that refuses a respelled requirement was accepted');
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
      const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-driver-src-'));
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
      fs.mkdirSync(path.join(copy, 'internal', 'identitydriver'), { recursive: true });
      fs.writeFileSync(path.join(copy, 'internal', 'identitydriver', 'main.go'), require('./k-review-requirement-identity-normalized__driver.js'));
      const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'identity-driver-bin-')), 'identitydriver');
      const r = spawnSync('go', ['build', '-mod=readonly', '-buildvcs=false', '-o', bin, './internal/identitydriver'], { cwd: copy, encoding: 'utf8', env: isolated({}) });
      driver = { bin, status: r.status, output: `${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
      fs.rmSync(copy, { recursive: true, force: true });
    }
    assert.equal(driver.status, 0, `go build ./internal/identitydriver (the review driver in a copy of this checkout) exited ${driver.status}:\n${driver.output}`);
    return driver.bin;
  }

  When(prefix + 'the native reviewer reviews the saved total candidate', { timeout: 300000 }, function () {
    assert.ok(this.answers, 'give the scripted answers first');
    const bin = buildDriver();
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-driver-'));
    const answers = path.join(work, 'answers.json');
    const out = path.join(work, 'observation.json');
    fs.writeFileSync(answers, JSON.stringify(this.answers));
    const r = spawnSync(bin, [], {
      cwd: work, encoding: 'utf8', timeout: 240000,
      env: isolated({ HOME: work, IDENTITY_ANSWERS: answers, IDENTITY_OUT: out }),
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
}
