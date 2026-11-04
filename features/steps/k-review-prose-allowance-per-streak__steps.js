// Steps of Intent k-review-prose-allowance-per-streak: a prose-only reviewer turn after a working
// tool call gets its own reminder, up to a fixed cap per review. A scripted reviewer reviews a
// saved candidate through the review driver (k-review-prose-allowance-per-streak__driver.js), a
// Go program built in a copy of this checkout that calls review.Independent (and, after a
// scripted interruption, review.Independent.Resume from the latest checkpoint) with a scripted
// model. The review gives one observation, which the judgments below compare with the feature's
// expected values.
//
// "$KOGEN_NODE" <this file> --control good|bad checks the judgments against known-good and
// known-bad observations; Cucumber loads this file as step definitions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const prefix = 'k-review-prose-allowance-per-streak: ';

// ---- Judgments: each compares one part of an observation with its expected value. ----

// An observation: requests (every model request the review made, in order: force, the tool the
// request required (Request.ForceTool); mode, the mode of the review_tool_choice event recorded
// for it, "" without one; last, its last input item, {"user": content} ("<opening>" for the
// opening message) or {"tool_result": output}; answer, the scripted answer: "prose",
// "interrupted" or the names of the tool calls), verdict (approve, changes, invalid or error),
// stop ("class/reason" or ""), invalid (the review's Invalid as JSON without Pass and Base, null
// without one), invalid_events (the run log's review events with verdict invalid), faults (the
// run log's provider_fault events) and resumed (per resume, the checkpoint's stage and its
// session without input and tools).
function shown(o) {
  return JSON.stringify(o, (k, v) => (typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v), 1);
}

// pick is the observed value of each key of expected (null for an absent key).
function pick(observed, expected) {
  const out = {};
  for (const k of Object.keys(expected)) out[k] = Object.prototype.hasOwnProperty.call(observed, k) ? observed[k] : null;
  return out;
}

const judge = {
  requests(o, list) {
    assert.deepStrictEqual(o.requests, list, `the review's model requests differ: ${shown(o)}`);
  },
  ending(o, verdict, stop) {
    assert.deepStrictEqual({ verdict: o.verdict, stop: o.stop }, { verdict, stop }, `the review's ending differs: ${shown(o)}`);
  },
  handoff(o, expected) {
    assert.ok(o.invalid, `the review handed off no Invalid: ${shown(o)}`);
    assert.deepStrictEqual(pick(o.invalid, expected), expected, `the review's Invalid differs: ${shown(o)}`);
  },
  event(o, expected) {
    assert.equal(o.invalid_events.length, 1, `the run log has ${o.invalid_events.length} invalid review events, want 1: ${shown(o)}`);
    assert.deepStrictEqual(pick(o.invalid_events[0], expected), expected, `the run log's invalid review event differs: ${shown(o)}`);
  },
  faults(o, list) {
    assert.deepStrictEqual(o.faults, list, `the run log's provider faults differ: ${shown(o)}`);
  },
  resumed(o, stage, expected) {
    assert.equal(o.resumed.length, 1, `the review resumed ${o.resumed.length} times, want 1: ${shown(o)}`);
    assert.equal(o.resumed[0].stage, stage, `the resume continued a checkpoint of another stage: ${shown(o)}`);
    assert.deepStrictEqual(pick(o.resumed[0].session, expected), expected, `the checkpoint the resume continued differs: ${shown(o)}`);
  },
};

// ---- Controls: the judgments accept a known-good observation and reject known-bad ones. ----

const S = 'submit_review';
const REMINDER = { user: 'Not a valid verdict: the review ended without calling submit_review. Call submit_review.' };
const OPENING = { user: '<opening>' };
const UNREAD = { tool_result: 'invalid verdict:\nRead all pinned source evidence before approving: 1 unread part(s); use read_file on app.txt' };
const READ = { tool_result: '1\tcandidate' };
const LIST = { tool_result: '.gitignore\n.kogen/intents/fixture/acceptance.feature\napp.txt' };
const NONE = 'the review ended without calling submit_review';
const rq = (force, mode, last, answer) => ({ force, mode, last, answer });

function control(mode) {
  const capRequests = [
    rq('', '', OPENING, 'prose'), rq(S, 'api_forced', REMINDER, [S]), rq('', '', UNREAD, ['read_file']), rq('', '', READ, 'prose'),
    rq(S, 'api_forced', REMINDER, ['list_files']), rq('', '', LIST, 'prose'), rq(S, 'api_forced', REMINDER, ['read_file']), rq('', '', READ, 'prose'),
  ];
  const capHandoff = { Reason: 'no_tool_reminder_cap', Problems: [NONE], RejectedVerdict: 1, NoToolReminder: 3, ProseTurns: 4, ForcedRequests: 3, ForcedAnswered: 3, Route: 'openai-compatible', Model: 'scripted', ToolChoice: 'api_forced', ForcedRoute: '', ForcedModel: '' };
  const capEvent = { reason: 'no_tool_reminder_cap', problems: [NONE], rejected_verdicts: 1, no_tool_reminders: 3, prose_turns: 4, forced_requests: 3, forced_answered_with_tool: 3, route: 'openai-compatible', model: 'scripted', tool_choice: 'api_forced' };
  const resumeRequests = [
    rq('', '', OPENING, 'prose'), rq(S, 'api_forced', REMINDER, [S]), rq('', '', UNREAD, 'interrupted'), rq('', '', UNREAD, ['read_file']),
    rq('', '', READ, 'prose'), rq(S, 'api_forced', REMINDER, [S]),
  ];
  const resumeSession = { no_tool_reminders: 1, no_tool_restored: true, remind: null, rejected_verdicts: 1, prose_turns: 1, forced_requests: 1, forced_answered_with_tool: 1 };
  const cases = [
    {
      // The review that reaches the cap after working.
      good: {
        requests: capRequests, verdict: 'invalid', stop: 'candidate/review_invalid',
        invalid: { ...capHandoff, Review: 1, Reopened: false, Repaired: false },
        invalid_events: [{ event: 'review', review: 1, verdict: 'invalid', ...capEvent }], faults: [], resumed: [],
      },
      checks: [['requests', capRequests], ['ending', 'invalid', 'candidate/review_invalid'], ['handoff', capHandoff], ['event', capEvent], ['faults', []]],
      bad: [
        (o) => { o.requests = o.requests.slice(0, 4); o.invalid.Reason = 'no_tool_reminder_exhausted'; o.invalid_events[0].reason = 'no_tool_reminder_exhausted'; },
        (o) => { o.requests.push(rq(S, 'api_forced', REMINDER, [S])); },
        (o) => { o.requests[6].force = ''; },
        (o) => { o.invalid.ForcedAnswered = 2; },
        (o) => { o.invalid.ProseTurns = 3; },
        (o) => { delete o.invalid.Route; },
        (o) => { o.invalid.ToolChoice = 'text_fallback'; },
        (o) => { delete o.invalid_events[0].tool_choice; },
        (o) => { o.invalid_events.push(o.invalid_events[0]); },
        (o) => { o.faults.push({ event: 'provider_fault', fault: 'forced_tool_not_called' }); },
        (o) => { o.invalid = null; o.verdict = 'approve'; o.stop = ''; },
      ],
    },
    {
      // The review resumed after the forced request was answered with a tool call.
      good: {
        requests: resumeRequests, verdict: 'approve', stop: '', invalid: null, invalid_events: [], faults: [],
        resumed: [{ stage: 'review', session: { no_tool_reminders: 1, no_tool_restored: true, rejected_verdicts: 1, prose_turns: 1, forced_requests: 1, forced_answered_with_tool: 1, requests: 3 } }],
      },
      checks: [['requests', resumeRequests], ['ending', 'approve', ''], ['resumed', 'review', resumeSession]],
      bad: [
        (o) => { delete o.resumed[0].session.no_tool_restored; },
        (o) => { o.resumed[0].session.remind = true; },
        (o) => { o.resumed[0].session.prose_turns = 2; },
        (o) => { o.resumed[0].stage = 'review_verify'; },
        (o) => { o.resumed.push(o.resumed[0]); },
        (o) => { o.requests[5].force = ''; },
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
    // Today's review of the first scenario: the second prose-only turn, after the reviewer
    // worked, ends the review without a reminder.
    const wanted = [rq('', '', OPENING, 'prose'), rq(S, 'api_forced', REMINDER, [S]), rq('', '', UNREAD, ['read_file']), rq('', '', READ, 'prose'), rq(S, 'api_forced', REMINDER, [S])];
    const today = {
      requests: wanted.slice(0, 4), verdict: 'invalid', stop: 'candidate/review_invalid',
      invalid: { ForcedModel: '', ForcedRoute: '', NoToolReminder: 1, Problems: [NONE], Reason: 'no_tool_reminder_exhausted', RejectedVerdict: 1, Reopened: false, Repaired: false, Review: 1 },
      invalid_events: [{ event: 'review', no_tool_reminders: 1, problems: [NONE], reason: 'no_tool_reminder_exhausted', rejected_verdicts: 1, review: 1, verdict: 'invalid' }],
      faults: [], resumed: [],
    };
    try {
      judge.requests(today, wanted);
      judge.ending(today, 'approve', '');
    } catch (e) {
      console.log('rejected the review that ended at its second prose-only turn after working');
      process.exitCode = 1;
      return;
    }
    throw new Error('the review that ended at its second prose-only turn after working was accepted');
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

  // route: forced (openai-compatible/scripted) or text (anthropic/scripted-text). The doc string
  // is a JSON list with one scripted answer per model request.
  Given(prefix + 'the scripted reviewer on the {string} route answers in order:', function (route, doc) {
    assert.ok(['forced', 'text'].includes(route), `the route ${route} is neither forced nor text`);
    this.route = route;
    this.answers = JSON.parse(doc);
    assert.ok(Array.isArray(this.answers) && this.answers.every((a) => a && typeof a === 'object'), 'the answers are not a list of objects');
  });

  let driver = null; // the one build of this process: {bin, status, output}

  // The driver is built in a copy of this checkout's files.
  function buildDriver() {
    if (!driver) {
      const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'prose-driver-src-'));
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
      fs.mkdirSync(path.join(copy, 'internal', 'prosedriver'), { recursive: true });
      fs.writeFileSync(path.join(copy, 'internal', 'prosedriver', 'main.go'), require('./k-review-prose-allowance-per-streak__driver.js'));
      const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prose-driver-bin-')), 'prosedriver');
      const r = spawnSync('go', ['build', '-mod=readonly', '-buildvcs=false', '-o', bin, './internal/prosedriver'], { cwd: copy, encoding: 'utf8', env: isolated({}) });
      driver = { bin, status: r.status, output: `${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
      fs.rmSync(copy, { recursive: true, force: true });
    }
    assert.equal(driver.status, 0, `go build ./internal/prosedriver (the review driver in a copy of this checkout) exited ${driver.status}:\n${driver.output}`);
    return driver.bin;
  }

  When(prefix + 'the native reviewer reviews the saved candidate', { timeout: 300000 }, function () {
    assert.ok(this.route && this.answers, 'script the reviewer first');
    const bin = buildDriver();
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'prose-driver-'));
    const answers = path.join(work, 'answers.json');
    const out = path.join(work, 'observation.json');
    fs.writeFileSync(answers, JSON.stringify(this.answers));
    const r = spawnSync(bin, [], {
      cwd: work, encoding: 'utf8', timeout: 240000,
      env: isolated({ HOME: work, PROSE_ROUTE: this.route, PROSE_ANSWERS: answers, PROSE_OUT: out }),
    });
    assert.equal(r.status, 0, `the review driver exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ''}:\n${r.stdout}${r.stderr}${r.error || ''}`);
    this.observed = JSON.parse(fs.readFileSync(out, 'utf8'));
  });

  function observed(world) {
    assert.ok(world.observed, 'no review ran: use "the native reviewer reviews the saved candidate" first');
    return world.observed;
  }

  // The doc string is the JSON list of the requests, each {force, mode, last, answer}.
  Then(prefix + 'the review made these requests:', function (doc) {
    judge.requests(observed(this), JSON.parse(doc));
  });

  // stop is "class/reason", or "none" for a review that did not stop.
  Then(prefix + 'the review ends with the verdict {string} and the stop {string}', function (verdict, stop) {
    judge.ending(observed(this), verdict, stop === 'none' ? '' : stop);
  });

  // The doc string is a JSON object of review.Invalid fields by their Go names.
  Then(prefix + 'the review hands off the Invalid fields:', function (doc) {
    judge.handoff(observed(this), JSON.parse(doc));
  });

  // The doc string is a JSON object of keys of the run log's review event with verdict invalid.
  Then(prefix + 'the run log records the invalid review event with:', function (doc) {
    judge.event(observed(this), JSON.parse(doc));
  });

  // The doc string is the JSON list of the run log's provider_fault events.
  Then(prefix + 'the run log records the provider faults:', function (doc) {
    judge.faults(observed(this), JSON.parse(doc));
  });

  // The doc string is a JSON object of session keys of the checkpoint; null: the key is absent.
  Then(prefix + 'the review resumed once, from a checkpoint of the stage {string} whose session has:', function (stage, doc) {
    judge.resumed(observed(this), stage, JSON.parse(doc));
  });
}
