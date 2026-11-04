// Steps of Intent k-review-ignored-call-after-rejected-verdict: the calls that follow a
// submit_review call in the same model response are handled by what happened to that
// submission. A scripted reviewer reviews a saved candidate through the review driver
// (k-review-ignored-call-after-rejected-verdict__driver.js), a Go program built in a copy of this
// checkout that calls review.Independent with a scripted model. The review gives one
// observation, which the judgments below compare with the feature's expected values.
//
// "$KOGEN_NODE" <this file> --control good|bad checks the judgments against known-good and
// known-bad observations; Cucumber loads this file as step definitions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const prefix = 'k-review-ignored-call-after-rejected-verdict: ';

// ---- Judgments: each compares one part of an observation with its expected value. ----

// An observation: requests (the number of model requests the review made), responses (per
// scripted response, in order, each of its calls as {name, output}: the function_call_output
// answering it in the final conversation, null without one), verdict (approve, changes, invalid
// or error), stop ("class/reason" or ""), invalid (Reason, Problems, RejectedVerdict and
// NoToolReminder of the review's Invalid, null without one), allowances (the run log's
// review_allowance events as {why, rejected_verdicts, no_tool_reminders}), ran (the names of the
// run log's review_tool_call events, in order), probes and probe_runs (the latest checkpoint's
// session probes and the commands of its probe_runs) and app (the final content of app.txt).
function shown(o) {
  return JSON.stringify(o, null, 1);
}

const judge = {
  requests(o, n) {
    assert.equal(o.requests, n, `the review made ${o.requests} model requests, want ${n}: ${shown(o)}`);
  },
  answered(o, n, list) {
    assert.ok(o.responses.length >= n, `there is no scripted response ${n}: ${shown(o)}`);
    assert.deepStrictEqual(o.responses[n - 1], list, `the calls of response ${n} were answered otherwise: ${shown(o)}`);
  },
  lacks(o, call, n, text) {
    const c = (o.responses[n - 1] || [])[call - 1];
    assert.ok(c, `response ${n} has no call ${call}: ${shown(o)}`);
    assert.equal(typeof c.output, 'string', `call ${call} of response ${n} has no output: ${shown(o)}`);
    assert.ok(!c.output.includes(text), `the output of call ${call} (${c.name}) of response ${n} contains ${JSON.stringify(text)}: ${shown(o)}`);
  },
  ending(o, verdict, stop) {
    assert.deepStrictEqual({ verdict: o.verdict, stop: o.stop }, { verdict, stop }, `the review's ending differs: ${shown(o)}`);
  },
  allowances(o, list) {
    assert.deepStrictEqual(o.allowances, list, `the run log's allowance spendings differ: ${shown(o)}`);
  },
  ran(o, list) {
    assert.deepStrictEqual(o.ran, list, `the tools that ran differ: ${shown(o)}`);
  },
  probes(o, list) {
    assert.deepStrictEqual({ probes: o.probes, probe_runs: o.probe_runs }, { probes: list, probe_runs: list }, `the review's recorded probes differ: ${shown(o)}`);
  },
  handoff(o, expected) {
    assert.ok(o.invalid, `the review handed off no Invalid: ${shown(o)}`);
    assert.deepStrictEqual(o.invalid, expected, `the review's Invalid differs: ${shown(o)}`);
  },
  app(o, text) {
    assert.equal(o.app, text, `app.txt holds ${JSON.stringify(o.app)}, want ${JSON.stringify(text)}: ${shown(o)}`);
  },
};

// ---- Controls: the judgments accept known-good observations and reject known-bad ones. ----

const S = 'submit_review';
const UNREAD = 'invalid verdict:\nRead all pinned source evidence before approving: 1 unread part(s); use read_file on app.txt';
const MAYBE_PROBLEM = 'submit_review needs verdict (approve or changes) and a findings list; verdict must be approve or changes but was a string with an unsupported value';
const MAYBE = `invalid verdict:\n${MAYBE_PROBLEM}`;
const READ = '1\tcandidate';
const LIST = '.gitignore\n.kogen/intents/fixture/acceptance.feature\napp.txt';
const IGNORED = 'ignored: the review already has a verdict';
const REFUSED = 'not run: the submission was refused; make this call again in the next response';
const VERDICT = 'already has a verdict';
const SPENT = [{ why: 'rejected_verdict', rejected_verdicts: 1, no_tool_reminders: 0 }];

function control(mode) {
  const refusedFirst = [{ name: S, output: UNREAD }, { name: 'read_file', output: READ }, { name: 'shell', output: REFUSED }];
  const validFirst = [{ name: S, output: 'accepted' }, { name: 'read_file', output: IGNORED }, { name: 'shell', output: IGNORED }];
  const counted = [{ name: S, output: MAYBE }, { name: 'list_files', output: LIST }, { name: 'write_file', output: REFUSED }];
  const exhausted = { Reason: 'rejected_verdict_exhausted', Problems: [MAYBE_PROBLEM], RejectedVerdict: 1, NoToolReminder: 0 };
  const cases = [
    {
      // A read and a shell call after a refused approve; the next approve is accepted.
      good: {
        requests: 2, responses: [refusedFirst, [{ name: S, output: 'accepted' }]], verdict: 'approve', stop: '', invalid: null,
        allowances: SPENT, ran: ['read_file'], probes: [], probe_runs: [], app: 'candidate\n',
      },
      checks: [['answered', 1, refusedFirst], ['lacks', 3, 1, VERDICT], ['ran', ['read_file']], ['probes', []], ['allowances', SPENT],
        ['answered', 2, [{ name: S, output: 'accepted' }]], ['requests', 2], ['ending', 'approve', '']],
      bad: [
        (o) => { o.responses[0][1].output = IGNORED; },
        (o) => { o.responses[0][2].output = IGNORED; },
        (o) => { o.responses[0][2].output = `${REFUSED}; the review already has a verdict`; },
        (o) => { o.responses[0][2].output = 'exit status: 0\nx\n'; o.ran.push('shell'); o.probes = ['echo x']; o.probe_runs = ['echo x']; },
        (o) => { o.ran.push('shell'); },
        (o) => { o.probes = ['echo x']; },
        (o) => { o.probe_runs = ['echo x']; },
        (o) => { o.allowances = []; },
        (o) => { o.allowances.push(o.allowances[0]); },
        (o) => { o.allowances[0].why = 'unread_progress_exempt'; },
        (o) => { o.requests = 3; },
        (o) => { o.responses[1][0].output = UNREAD; },
        (o) => { o.verdict = 'invalid'; o.stop = 'candidate/review_invalid'; },
      ],
    },
    {
      // A valid approve first: the later calls are ignored.
      good: {
        requests: 2, responses: [[{ name: 'read_file', output: READ }], validFirst], verdict: 'approve', stop: '', invalid: null,
        allowances: [], ran: ['read_file'], probes: [], probe_runs: [], app: 'candidate\n',
      },
      checks: [['answered', 1, [{ name: 'read_file', output: READ }]], ['answered', 2, validFirst], ['ran', ['read_file']], ['probes', []],
        ['allowances', []], ['requests', 2], ['ending', 'approve', '']],
      bad: [
        (o) => { o.responses[1][1].output = READ; o.ran.push('read_file'); },
        (o) => { o.responses[1][2].output = REFUSED; },
        (o) => { o.ran.push('shell'); o.probes = ['echo x']; o.probe_runs = ['echo x']; },
        (o) => { o.requests = 3; },
      ],
    },
    {
      // A list and a write after a refused submission; the refusal spends the allowance once.
      good: {
        requests: 2, responses: [counted, [{ name: S, output: null }]], verdict: 'invalid', stop: 'candidate/review_invalid', invalid: exhausted,
        allowances: SPENT, ran: ['list_files'], probes: [], probe_runs: [], app: 'candidate\n',
      },
      checks: [['answered', 1, counted], ['lacks', 3, 1, VERDICT], ['app', 'candidate\n'], ['ran', ['list_files']], ['allowances', SPENT],
        ['requests', 2], ['ending', 'invalid', 'candidate/review_invalid'], ['handoff', exhausted]],
      bad: [
        (o) => { o.responses[0][1].output = IGNORED; },
        (o) => { o.responses[0][2].output = IGNORED; },
        (o) => { o.responses[0][2].output = 'wrote app.txt'; o.app = 'x\n'; o.ran.push('write_file'); },
        (o) => { o.app = 'x\n'; },
        (o) => { o.ran.push('write_file'); },
        (o) => { o.allowances = []; o.requests = 3; },
        (o) => { o.allowances.push({ why: 'rejected_verdict', rejected_verdicts: 2, no_tool_reminders: 0 }); },
        (o) => { o.invalid.RejectedVerdict = 2; },
        (o) => { o.verdict = 'error'; o.stop = 'candidate/script_exhausted'; o.invalid = null; o.requests = 3; },
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
    // Today's review of the first scenario, copied from the driver's output on the unchanged
    // tree: the read and the shell call are ignored as if a verdict existed, and the next approve
    // is refused again, which ends the review.
    const today = {
      allowances: SPENT, app: 'candidate\n',
      invalid: { NoToolReminder: 0, Problems: ['Read all pinned source evidence before approving: 1 unread part(s); use read_file on app.txt'], Reason: 'rejected_verdict_exhausted', RejectedVerdict: 1 },
      probe_runs: [], probes: [], ran: [], requests: 2,
      responses: [[{ name: S, output: UNREAD }, { name: 'read_file', output: IGNORED }, { name: 'shell', output: IGNORED }], [{ name: S, output: null }]],
      stop: 'candidate/review_invalid', verdict: 'invalid',
    };
    try {
      for (const [name, ...args] of cases[0].checks) judge[name](today, ...args);
    } catch (e) {
      console.log('rejected the review that ignored the calls after a refused submission');
      process.exitCode = 1;
      return;
    }
    throw new Error('the judgments accepted today\'s review of the first scenario');
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

  // The doc string is a JSON list with one scripted answer per model request, each
  // {"calls": [{name, args}]}.
  Given(prefix + 'the scripted reviewer answers in order:', function (doc) {
    this.answers = JSON.parse(doc);
    assert.ok(Array.isArray(this.answers) && this.answers.every((a) => a && Array.isArray(a.calls)), 'the answers are not a list of {"calls": [...]} objects');
  });

  let driver = null; // the one build of this process: {bin, status, output}

  // The driver is built in a copy of this checkout's files.
  function buildDriver() {
    if (!driver) {
      const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'rejected-driver-src-'));
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
      fs.mkdirSync(path.join(copy, 'internal', 'rejecteddriver'), { recursive: true });
      fs.writeFileSync(path.join(copy, 'internal', 'rejecteddriver', 'main.go'), require('./k-review-ignored-call-after-rejected-verdict__driver.js'));
      const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rejected-driver-bin-')), 'rejecteddriver');
      const r = spawnSync('go', ['build', '-mod=readonly', '-buildvcs=false', '-o', bin, './internal/rejecteddriver'], { cwd: copy, encoding: 'utf8', env: isolated({}) });
      driver = { bin, status: r.status, output: `${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
      fs.rmSync(copy, { recursive: true, force: true });
    }
    assert.equal(driver.status, 0, `go build ./internal/rejecteddriver (the review driver in a copy of this checkout) exited ${driver.status}:\n${driver.output}`);
    return driver.bin;
  }

  When(prefix + 'the native reviewer reviews the saved candidate', { timeout: 300000 }, function () {
    assert.ok(this.answers, 'script the reviewer first');
    const bin = buildDriver();
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rejected-driver-'));
    const answers = path.join(work, 'answers.json');
    const out = path.join(work, 'observation.json');
    fs.writeFileSync(answers, JSON.stringify(this.answers));
    const r = spawnSync(bin, [], {
      cwd: work, encoding: 'utf8', timeout: 240000,
      env: isolated({ HOME: work, REJECTED_ANSWERS: answers, REJECTED_OUT: out }),
    });
    assert.equal(r.status, 0, `the review driver exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ''}:\n${r.stdout}${r.stderr}${r.error || ''}`);
    this.observed = JSON.parse(fs.readFileSync(out, 'utf8'));
  });

  function observed(world) {
    assert.ok(world.observed, 'no review ran: use "the native reviewer reviews the saved candidate" first');
    return world.observed;
  }

  Then(prefix + 'the review made {int} model requests', function (n) {
    judge.requests(observed(this), n);
  });

  // The doc string is the JSON list of the response's calls in order, each {name, output}; null:
  // the call has no output in the final conversation.
  Then(prefix + 'the calls of response {int} were answered:', function (n, doc) {
    judge.answered(observed(this), n, JSON.parse(doc));
  });

  Then(prefix + 'the output of call {int} of response {int} does not contain {string}', function (call, n, text) {
    judge.lacks(observed(this), call, n, text);
  });

  // stop is "class/reason", or "none" for a review that did not stop.
  Then(prefix + 'the review ends with the verdict {string} and the stop {string}', function (verdict, stop) {
    judge.ending(observed(this), verdict, stop === 'none' ? '' : stop);
  });

  // The doc string is the JSON list of the run log's review_allowance events, each {why,
  // rejected_verdicts, no_tool_reminders}.
  Then(prefix + 'the run log records these allowance spendings:', function (doc) {
    judge.allowances(observed(this), JSON.parse(doc));
  });

  // The doc string is the JSON list of the names of the run log's review_tool_call events.
  Then(prefix + 'the tools that ran are:', function (doc) {
    judge.ran(observed(this), JSON.parse(doc));
  });

  // The doc string is the JSON list of the commands the latest checkpoint records as probes and
  // as probe runs.
  Then(prefix + 'the review records the probes:', function (doc) {
    judge.probes(observed(this), JSON.parse(doc));
  });

  // The doc string is a JSON object of the review's Invalid: Reason, Problems, RejectedVerdict
  // and NoToolReminder.
  Then(prefix + 'the review hands off the Invalid fields:', function (doc) {
    judge.handoff(observed(this), JSON.parse(doc));
  });

  Then(prefix + 'app.txt holds {string} and a newline', function (text) {
    judge.app(observed(this), `${text}\n`);
  });
}
