// Steps of Intent k-review-unrun-evidence-not-met: a requirement's evidence counts only when it
// was observed on the current tree. The steps make a saved parcel candidate in a temporary Git
// checkout: parcel.sh keeps parcels as files, and the candidate adds "replace", which must keep
// the parcel's receipt; its approved acceptance scenario "Replace a parcel and read its receipt"
// is a real Cucumber scenario that Kogen's verification runs. A scripted reviewer then reviews
// it in one of two ways: through the kogen-review command built from this checkout, with a
// loopback OpenAI-compatible fake model, or through the review driver
// (k-review-unrun-evidence-not-met__driver.js), a Go program built in a copy of this checkout
// that calls review.Independent with a pass that records acceptance not_run, or with Kogen's
// verification of the candidate and of the reviewer's edits. Either way the review gives one
// observation, which the judgments below compare with the feature's expected values.
//
// "$KOGEN_NODE" <this file> --control good|bad checks the judgments against known-good and
// known-bad observations; Cucumber loads this file as step definitions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');

const prefix = 'k-review-unrun-evidence-not-met: ';

// ---- Judgments: each compares one part of an observation with its expected value. ----

// An observation: requests (the model requests the review made), last_inputs (per request, the
// last item it sent: {tool_result} or {role, content}), verdict (approve, changes, invalid or
// error), stop ("class/reason" or ""), problems (of a review that ended invalid), requirements
// (what review-1.json keeps, null without it), initial (the pass the review was given) and
// verifications (Kogen's verifications of the reviewer's edits), a pass as {green, current,
// acceptance}: current is whether its tree is the candidate's tree, acceptance "not_run" or the
// scenarios' {name, status}.
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
  initial(o, pass) {
    assert.deepStrictEqual(o.initial, pass, `the review was given another pass: ${shown(o)}`);
  },
  verifications(o, list) {
    assert.deepStrictEqual(o.verifications, list, `Kogen's verifications of the reviewer's edits differ: ${shown(o)}`);
  },
};

// ---- Controls: the judgments accept a known-good observation and reject known-bad ones. ----

const R = 'Replacing a parcel preserves its receipt';
const S = 'Replace a parcel and read its receipt';
const cite = { requirement: R, evidence: 'acceptance', ref: S, met: true };
const unrun = `invalid verdict:\nrequirement "${R}" cites acceptance "${S}", which did not run on the current tree (not_run): naming a scenario is not evidence; cite a probe you ran with shell on the current tree that exercises the requirement, or, when nothing can verify it here, submit changes with a blocking finding that quotes the requirement and says its verification could not run`;
const failed = `invalid verdict:\nrequirement "${R}" cites acceptance scenario "${S}", which failed on the current tree: the observed result contradicts met; repair the candidate, or submit changes with a blocking finding that quotes the requirement`;

function control(mode) {
  const notRun = { green: true, current: true, acceptance: 'not_run' };
  const red = { green: false, current: true, acceptance: [{ name: S, status: 'failed' }] };
  const blocked = { requirement: R, evidence: 'none', ref: '', met: false };
  // The not_run review and the failed review as the feature expects them.
  const cases = [
    {
      good: { requests: 2, last_inputs: [{ role: 'user', content: 'source' }, { tool_result: unrun }], verdict: 'changes', stop: 'candidate/review_blocked', problems: [], requirements: [blocked], initial: notRun, verifications: [] },
      checks: [['requests', 2], ['toolResult', 2, unrun], ['ending', 'changes', 'candidate/review_blocked'], ['requirements', [blocked]], ['initial', notRun], ['verifications', []]],
      bad: [
        (o) => { o.requests = 1; o.last_inputs.pop(); o.verdict = 'approve'; o.stop = ''; o.requirements = [cite]; },
        (o) => { o.last_inputs[1] = { tool_result: 'accepted' }; },
        (o) => { o.last_inputs[1] = { tool_result: unrun.replace('(not_run)', '(passed)') }; },
        (o) => { o.verdict = 'invalid'; o.stop = 'candidate/review_invalid'; },
        (o) => { o.requirements = [cite]; },
        (o) => { o.initial = { ...notRun, acceptance: [{ name: S, status: 'passed' }] }; },
      ],
    },
    {
      good: { requests: 3, last_inputs: [{ role: 'user', content: 'source' }, { role: 'user', content: 'red' }, { tool_result: failed }], verdict: 'changes', stop: 'candidate/review_blocked', problems: [], requirements: [{ ...cite, met: false }], initial: { green: true, current: true, acceptance: [{ name: S, status: 'passed' }] }, verifications: [red] },
      checks: [['requests', 3], ['toolResult', 3, failed], ['verifications', [red]], ['ending', 'changes', 'candidate/review_blocked']],
      bad: [
        (o) => { o.last_inputs[2] = { role: 'user', content: 'red' }; o.verifications.push(red); },
        (o) => { o.last_inputs[2] = { tool_result: unrun }; },
        (o) => { o.verifications = [{ ...red, current: false }]; },
        (o) => { o.verifications = [{ ...red, acceptance: [{ name: S, status: 'passed' }] }]; },
        (o) => { o.verdict = 'approve'; o.stop = ''; },
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
    // Today's review of the not_run case: the unrun citation is accepted at the first request.
    const today = { requests: 1, last_inputs: [{ role: 'user', content: 'source' }], verdict: 'approve', stop: '', problems: [], requirements: [cite], initial: notRun, verifications: [] };
    try {
      for (const [name, ...args] of cases[0].checks) judge[name](today, ...args);
    } catch (e) {
      console.log('rejected the approval that cites an unrun acceptance scenario');
      process.exitCode = 1;
      return;
    }
    throw new Error('the approval that cites an unrun acceptance scenario was accepted');
  }
  console.log('observer controls passed');
}

if (require.main === module) {
  assert.ok(process.argv[2] === '--control' && ['good', 'bad'].includes(process.argv[3]), 'usage: <this file> --control good|bad');
  control(process.argv[3]);
} else {
  steps();
}

// ---- The fixture and the two ways a review runs. ----

function steps() {
  const { Given, When, Then, After } = require('@cucumber/cucumber');
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
    const extra = { GIT_INDEX_FILE: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'unrun-index-')), 'index') };
    git(root, extra, 'read-tree', start);
    git(root, extra, 'add', '-A', '--', '.');
    return git(root, extra, 'write-tree');
  }

  const acceptanceRun = `NODE_PATH="$KOGEN_CUCUMBER" "$KOGEN_NODE" "$KOGEN_CUCUMBER/@cucumber/cucumber/bin/cucumber.js" --strict --require 'features/steps/*.js' --format "message:$KOGEN_ACCEPTANCE_REPORT" "$KOGEN_ACCEPTANCE_FEATURES"`;
  const startFiles = {
    '.kogen/project.yaml': `version: 1\ncommands:\n  setup: []\n  fix: []\n  checks: []\n  acceptance:\n    run: '${acceptanceRun.split("'").join("''")}'\n    steps_dir: 'features/steps'\n`,
    '.kogen/intents/parcel/intent.md': '# Preserve receipts on replacement\n\nSlug: parcel\nModel: not applicable — a parcel is one file\nAcceptance:\n- .kogen/intents/parcel/acceptance.feature\n- features/steps/parcel.js\n\nReplacing a parcel preserves its receipt.\n',
    '.kogen/intents/parcel/acceptance.feature': 'Feature: Parcels\n\n  Scenario: Replace a parcel and read its receipt\n    Given a parcel "P-1" with the receipt "R-1"\n    When the parcel "P-1" is replaced\n    Then the receipt of "P-1" reads "R-1"\n',
    'features/steps/parcel.js': String.raw`const { Given, When, Then, Before } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

Before(function () {
  this.parcels = fs.mkdtempSync(path.join(os.tmpdir(), 'parcels-'));
});

function parcel(world, ...args) {
  return execFileSync('sh', ['parcel.sh', ...args], { env: { ...process.env, PARCELS: world.parcels }, encoding: 'utf8' });
}

Given('a parcel {string} with the receipt {string}', function (id, receipt) {
  parcel(this, 'add', id, receipt);
});

When('the parcel {string} is replaced', function (id) {
  parcel(this, 'replace', id);
});

Then('the receipt of {string} reads {string}', function (id, receipt) {
  assert.equal(parcel(this, 'receipt', id), receipt + '\n', 'the receipt after the replacement');
});
`,
    'parcel.sh': String.raw`# parcel.sh: parcels kept as files of the folder $PARCELS, each holding its receipt.
case "$1" in
add) printf '%s\n' "$3" > "$PARCELS/$2" ;;
receipt) cat "$PARCELS/$2" ;;
esac
`,
  };
  const candidateParcel = String.raw`# parcel.sh: parcels kept as files of the folder $PARCELS, each holding its receipt.
case "$1" in
add) printf '%s\n' "$3" > "$PARCELS/$2" ;;
replace) receipt=$(cat "$PARCELS/$2") && rm "$PARCELS/$2" && printf '%s\n' "$receipt" > "$PARCELS/$2" ;;
receipt) cat "$PARCELS/$2" ;;
esac
`;

  // The start commit holds the approved Intent "parcel", its acceptance and parcel.sh without
  // "replace"; the saved candidate commit, the checkout's HEAD, adds "replace".
  Given(prefix + 'a saved parcel candidate', function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unrun-parcel-'));
    git(root, {}, 'init', '-q', '-b', 'main');
    for (const [file, text] of Object.entries(startFiles)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    }
    git(root, {}, 'add', '-A');
    git(root, {}, 'commit', '-q', '-m', 'start');
    const start = git(root, {}, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(root, 'parcel.sh'), candidateParcel);
    git(root, {}, 'commit', '-q', '-am', 'saved candidate');
    this.fixture = { root, start, tree: git(root, {}, 'rev-parse', 'HEAD^{tree}') };
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
      const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'unrun-driver-src-'));
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
      fs.mkdirSync(path.join(copy, 'internal', 'unrundriver'), { recursive: true });
      fs.writeFileSync(path.join(copy, 'internal', 'unrundriver', 'main.go'), require('./k-review-unrun-evidence-not-met__driver.js'));
      const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'unrun-driver-bin-')), 'unrundriver');
      const r = spawnSync('go', ['build', '-mod=readonly', '-buildvcs=false', '-o', bin, './internal/unrundriver'], { cwd: copy, encoding: 'utf8', env: isolated({}) });
      driver = { bin, status: r.status, output: `${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
      fs.rmSync(copy, { recursive: true, force: true });
    }
    assert.equal(driver.status, 0, `go build ./internal/unrundriver (the review driver in a copy of this checkout) exited ${driver.status}:\n${driver.output}`);
    return driver.bin;
  }

  // given: not_run (a green pass that records acceptance not_run) or verified (Kogen's
  // verification of the candidate).
  When(prefix + 'the review driver reviews the candidate given the pass {string}', { timeout: 300000 }, function (given) {
    assert.ok(this.fixture && this.answers, 'make the saved parcel candidate and the scripted answers first');
    const bin = buildDriver();
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'unrun-driver-'));
    const answers = path.join(work, 'answers.json');
    const out = path.join(work, 'observation.json');
    fs.writeFileSync(answers, JSON.stringify(this.answers));
    const r = spawnSync(bin, [], {
      cwd: work, encoding: 'utf8', timeout: 240000,
      env: isolated({ HOME: work, UNRUN_ROOT: this.fixture.root, UNRUN_START: this.fixture.start, UNRUN_SLUG: 'parcel', UNRUN_PASS: given, UNRUN_ANSWERS: answers, UNRUN_OUT: out }),
    });
    assert.equal(r.status, 0, `the review driver exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ''}:\n${r.stdout}${r.stderr}${r.error || ''}`);
    this.observed = JSON.parse(fs.readFileSync(out, 'utf8'));
    this.trees = { $CANDIDATE_TREE: this.fixture.tree, $CURRENT_TREE: treeNow(this.fixture.root, this.fixture.start) };
  });

  let command = null; // the one build of kogen-review of this process: {bin, status, output}

  When(prefix + 'kogen-review reviews the candidate', { timeout: 300000 }, async function () {
    assert.ok(this.fixture && this.answers, 'make the saved parcel candidate and the scripted answers first');
    if (!command) {
      const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'unrun-kogen-review-')), 'kogen-review');
      const r = spawnSync('go', ['build', '-mod=readonly', '-buildvcs=false', '-o', bin, './cmd/kogen-review'], { cwd: checkout, encoding: 'utf8', env: isolated({}) });
      command = { bin, status: r.status, output: `${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
    }
    assert.equal(command.status, 0, `go build ./cmd/kogen-review exited ${command.status}:\n${command.output}`);
    const answers = this.answers;
    const requests = [];
    this.server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { parsed = { unparsed: body }; }
        requests.push(parsed);
        const n = requests.length;
        const calls = answers[n - 1];
        const message = calls
          ? { role: 'assistant', content: null, tool_calls: calls.map((c, i) => ({ id: `call-${n}-${i + 1}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
          : { role: 'assistant', content: `the scripted reviewer has no answer for request ${n}` };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: `scripted-${n}`, model: parsed && parsed.model, choices: [{ index: 0, message, finish_reason: calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }));
      });
    });
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${this.server.address().port}/v1`;
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'unrun-kogen-review-run-'));
    const args = ['-root', this.fixture.root, '-start', this.fixture.start, '-slug', 'parcel', '-provider', 'openai-compatible', '-model', 'scripted', '-base-url', url];
    const r = await new Promise((resolve) => {
      const child = spawn(command.bin, args, { cwd: work, env: isolated({ HOME: work }) });
      let stdout = '';
      let stderr = '';
      const guard = setTimeout(() => child.kill('SIGKILL'), 240000);
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (status, signal) => { clearTimeout(guard); resolve({ status, signal, stdout, stderr }); });
    });
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
    const described = `kogen-review ${args.join(' ')} exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ''}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
    assert.ok(r.stdout.endsWith('\n') && !r.stdout.slice(0, -1).includes('\n'), `stdout is not one line: ${described}`);
    const out = JSON.parse(r.stdout);
    const record = JSON.parse(fs.readFileSync(path.join(out.run, 'initial-verification.json'), 'utf8'));
    assert.equal(record.state, 'passed', `the fixture's initial verification is not passed (a broken fixture, not a review result): ${JSON.stringify(record)}\n${described}`);
    const p = record.pass;
    const review = path.join(out.run, 'review-1.json');
    this.observed = {
      requests: requests.length,
      last_inputs: requests.map((q) => {
        const m = ((q && q.messages) || []).at(-1) || {};
        return m.role === 'tool' ? { tool_result: m.content } : { role: m.role, content: m.content };
      }),
      verdict: out.verdict,
      stop: out.error ? `${out.error.class}/${out.error.reason}` : '',
      problems: out.invalid ? out.invalid.problems : [],
      requirements: fs.existsSync(review) ? JSON.parse(fs.readFileSync(review, 'utf8')).requirements : null,
      initial: { green: p.green, current: p.tree === this.fixture.tree, acceptance: p.acceptance === 'not_run' ? 'not_run' : p.acceptance.scenarios.map((s) => ({ name: s.name, status: s.status })) },
      verifications: [],
    };
    this.trees = { $CANDIDATE_TREE: this.fixture.tree, $CURRENT_TREE: treeNow(this.fixture.root, this.fixture.start) };
  });

  After(async function () {
    if (this.server) await new Promise((resolve) => this.server.close(resolve));
  });

  function observed(world) {
    assert.ok(world.observed, 'no review ran: use "the review driver reviews the candidate ..." or "kogen-review reviews the candidate" first');
    return world.observed;
  }

  // $CANDIDATE_TREE is the saved candidate's tree, $CURRENT_TREE the tree of the checkout's
  // files after the review.
  function trees(world, text) {
    let out = text;
    for (const [name, tree] of Object.entries(world.trees)) out = out.split(name).join(tree);
    return out;
  }

  Then(prefix + 'the review made {int} model requests', function (n) {
    judge.requests(observed(this), n);
  });

  // The tool result is the doc string exactly.
  Then(prefix + 'the last input of request {int} is the tool result:', function (n, text) {
    judge.toolResult(observed(this), n, trees(this, text));
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

  Then(prefix + 'the review was given a green pass of the candidate that records acceptance not_run', function () {
    judge.initial(observed(this), { green: true, current: true, acceptance: 'not_run' });
  });

  // This pass is history once the candidate changes: the observation keeps it as given.
  Then(prefix + 'the review was given a green pass of the candidate in which the scenario {string} passed', function (name) {
    judge.initial(observed(this), { green: true, current: true, acceptance: [{ name, status: 'passed' }] });
  });

  Then(prefix + 'Kogen verified the reviewer\'s edit once, and the scenario {string} {string} on the current tree', function (name, status) {
    judge.verifications(observed(this), [{ green: status === 'passed', current: true, acceptance: [{ name, status }] }]);
  });

  Then(prefix + 'Kogen verified no edit of the reviewer', function () {
    judge.verifications(observed(this), []);
  });
}
