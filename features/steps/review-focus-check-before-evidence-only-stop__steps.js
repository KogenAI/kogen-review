// Steps of Intent review-focus-check-before-evidence-only-stop: a native review that is about to
// stop only because a requirement has no evidence is asked once for a focused check. The steps
// make a saved grant candidate in a temporary Git checkout: grant.sh refuses a grant that omits
// its name or its key. A scripted reviewer then reviews it through the review driver
// (review-focus-check-before-evidence-only-stop__driver.js), a Go program built in a copy of this
// checkout that calls review.Independent (and Resume after an interruption) and writes one
// observation, which the judgments below compare with the feature's expected values.
//
// "$KOGEN_NODE" <this file> --control good|bad checks the judgments against known-good and
// known-bad observations; Cucumber loads this file as step definitions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const prefix = 'review-focus-check-before-evidence-only-stop: ';

// ---- Judgments: each compares one part of an observation with its expected value. ----

// An observation: requests (the model requests the review made), last_inputs (per request, the
// last item it sent: {tool_result} or {role, content}), verdict (approve, changes, invalid or
// error), stop ("class/reason" or ""), problems (of a review that ended invalid), lines (the
// stop's lines), requirements and unverified (what review-1.json keeps; [] without unverified).
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
  reported(o, requirement, check) {
    assert.deepStrictEqual(o.unverified, [{ requirement, check }], `the record's unverified list differs: ${shown(o)}`);
    const line = `review: unverified requirement "${requirement}": focused check ${check}`;
    assert.ok(o.lines.includes(line), `the stop's lines lack ${line}: ${shown(o)}`);
  },
  notReported(o) {
    assert.deepStrictEqual(o.unverified, [], `the record reports an unverified requirement: ${shown(o)}`);
    assert.ok(!o.lines.some((l) => l.includes('unverified')), `the stop's lines report an unverified requirement: ${shown(o)}`);
  },
};

// ---- Controls: the judgments accept a known-good observation and reject known-bad ones. ----

const R = 'A grant needs both a name and a key: omitting either is refused and writes nothing';
const focus = `requirement "${R}" has no evidence, and that is the only ground of this changes verdict: no focused check of the candidate has run in this review and no tool or environment limitation is recorded. A missing check is unverified, not a defect of the candidate. Run one focused check of this requirement with shell on the current tree and cite its exact command, or, when it cannot safely run here, submit the same changes verdict with a blocking finding that states the concrete reason it cannot run`;
const asked = `invalid verdict:\n${focus}`;

function control(mode) {
  const probe = { requirement: R, evidence: 'probe', ref: 'sh grant.sh add n1 k1', met: true };
  const unmet = { requirement: R, evidence: 'none', ref: '', met: false };
  const line = `review: unverified requirement "${R}": focused check unavailable`;
  const cases = [
    {
      // The replay of the 9c5e6662 pattern: inspection, the request, then a cited focused check.
      good: { requests: 3, last_inputs: [{ role: 'user', content: 'source' }, { tool_result: 'exit status: 0' }, { tool_result: asked }], verdict: 'approve', stop: '', problems: [], lines: [], requirements: [probe], unverified: [] },
      checks: [['requests', 3], ['toolResult', 3, asked], ['ending', 'approve', ''], ['requirements', [probe]], ['notReported']],
      bad: [
        (o) => { o.requests = 2; o.last_inputs.pop(); o.verdict = 'changes'; o.stop = 'candidate/review_blocked'; o.requirements = [unmet]; },
        (o) => { o.last_inputs[2] = { tool_result: 'accepted' }; },
        (o) => { o.last_inputs[2] = { tool_result: asked.replace('no evidence', 'evidence') }; },
        (o) => { o.verdict = 'changes'; o.stop = 'candidate/review_blocked'; },
        (o) => { o.requirements = [unmet]; },
        (o) => { o.unverified = [{ requirement: R, check: 'unavailable' }]; },
        (o) => { o.requests = 4; },
      ],
    },
    {
      // The repeated submission, accepted and reported unverified.
      good: { requests: 3, last_inputs: [{ role: 'user', content: 'source' }, { tool_result: 'exit status: 0' }, { tool_result: asked }], verdict: 'changes', stop: 'candidate/review_blocked', problems: [], lines: [`review: grant.sh:3: ${R}`, line], requirements: [unmet], unverified: [{ requirement: R, check: 'unavailable' }] },
      checks: [['requests', 3], ['toolResult', 3, asked], ['ending', 'changes', 'candidate/review_blocked'], ['reported', R, 'unavailable']],
      bad: [
        (o) => { o.unverified = [{ requirement: R, check: 'refused' }]; },
        (o) => { o.unverified = []; },
        (o) => { o.lines = o.lines.slice(0, 1); },
        (o) => { o.lines[1] = line.replace('unavailable', 'attempted'); },
        (o) => { o.requests = 4; },
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
    // Today's review of the 9c5e6662 pattern: the evidence-only stop blocks at request 2.
    const today = { requests: 2, last_inputs: [{ role: 'user', content: 'source' }, { tool_result: 'exit status: 0' }], verdict: 'changes', stop: 'candidate/review_blocked', problems: [], lines: [`review: grant.sh:3: ${R}`], requirements: [unmet], unverified: [] };
    try {
      for (const [name, ...args] of cases[0].checks) judge[name](today, ...args);
    } catch (e) {
      console.log('rejected the evidence-only stop that was not sent back once');
      process.exitCode = 1;
      return;
    }
    throw new Error('the evidence-only stop without a request was accepted');
  }
  console.log('observer controls passed');
}
if (require.main === module) {
  assert.ok(process.argv[2] === '--control' && ['good', 'bad'].includes(process.argv[3]), 'usage: <this file> --control good|bad');
  control(process.argv[3]);
} else {
  steps();
}

// ---- The fixture and the driver run. ----
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
    const extra = { GIT_INDEX_FILE: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'focus-index-')), 'index') };
    git(root, extra, 'read-tree', start);
    git(root, extra, 'add', '-A', '--', '.');
    return git(root, extra, 'write-tree');
  }
  const acceptanceRun = `NODE_PATH="$KOGEN_CUCUMBER" "$KOGEN_NODE" "$KOGEN_CUCUMBER/@cucumber/cucumber/bin/cucumber.js" --strict --require 'features/steps/*.js' --format "message:$KOGEN_ACCEPTANCE_REPORT" "$KOGEN_ACCEPTANCE_FEATURES"`;
  const startFiles = {
    '.kogen/project.yaml': `version: 1\ncommands:\n  setup: []\n  fix: []\n  checks: []\n  acceptance:\n    run: '${acceptanceRun.split("'").join("''")}'\n    steps_dir: 'features/steps'\n`,
    '.kogen/intents/grant/intent.md': `# Refuse grants without a name or a key\n\nSlug: grant\nModel: not applicable — a grant is one ledger line\nAcceptance:\n- .kogen/intents/grant/acceptance.feature\n- features/steps/grant.js\n\n${R}.\n`,
    '.kogen/intents/grant/acceptance.feature': 'Feature: Grants\n\n  Scenario: Omit the key\n    When a grant is added with the name "n1" and no key\n    Then the grant is refused\n',
    'features/steps/grant.js': String.raw`const { When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
When('a grant is added with the name {string} and no key', function (name) {
  this.status = spawnSync('sh', ['grant.sh', 'add', name, ''], { env: { ...process.env, GRANTS: '/nonexistent' } }).status;
});
Then('the grant is refused', function () {
  assert.equal(this.status, 2);
});
`,
  };
  const candidateGrant = String.raw`# grant.sh: add NAME KEY appends one ledger line to $GRANTS/ledger; a missing name or key is refused with status 2 and writes nothing.
case "$1" in
add) if [ -z "$2" ] || [ -z "$3" ]; then echo 'add needs a name and a key' >&2; exit 2; fi; printf '%s %s\n' "$2" "$3" >> "$GRANTS/ledger" ;;
esac
`;
  // The start commit holds the approved Intent "grant" and its acceptance; the saved candidate
  // commit, the checkout's HEAD, adds grant.sh.
  Given(prefix + 'a saved grant candidate', function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-grant-'));
    git(root, {}, 'init', '-q', '-b', 'main');
    for (const [file, text] of Object.entries(startFiles)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    }
    git(root, {}, 'add', '-A');
    git(root, {}, 'commit', '-q', '-m', 'start');
    const start = git(root, {}, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(root, 'grant.sh'), candidateGrant);
    git(root, {}, 'add', '-A');
    git(root, {}, 'commit', '-q', '-m', 'saved candidate');
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
      const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-driver-src-'));
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
      fs.mkdirSync(path.join(copy, 'internal', 'focusdriver'), { recursive: true });
      fs.writeFileSync(path.join(copy, 'internal', 'focusdriver', 'main.go'), require('./review-focus-check-before-evidence-only-stop__driver.js'));
      const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'focus-driver-bin-')), 'focusdriver');
      const r = spawnSync('go', ['build', '-mod=readonly', '-buildvcs=false', '-o', bin, './internal/focusdriver'], { cwd: copy, encoding: 'utf8', env: isolated({}) });
      driver = { bin, status: r.status, output: `${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
      fs.rmSync(copy, { recursive: true, force: true });
    }
    assert.equal(driver.status, 0, `go build ./internal/focusdriver (the review driver in a copy of this checkout) exited ${driver.status}:\n${driver.output}`);
    return driver.bin;
  }
  function review(world, options) {
    assert.ok(world.fixture && world.answers, 'make the saved grant candidate and the scripted answers first');
    const bin = buildDriver();
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-driver-'));
    const answers = path.join(work, 'answers.json');
    const out = path.join(work, 'observation.json');
    fs.writeFileSync(answers, JSON.stringify(world.answers));
    const extra = { HOME: work, FOCUS_ROOT: world.fixture.root, FOCUS_START: world.fixture.start, FOCUS_SLUG: 'grant', FOCUS_ANSWERS: answers, FOCUS_OUT: out };
    if (options.restriction) extra.FOCUS_RESTRICTION = options.restriction;
    if (options.interrupt) extra.FOCUS_INTERRUPT = String(options.interrupt);
    const r = spawnSync(bin, [], { cwd: work, encoding: 'utf8', timeout: 240000, env: isolated(extra) });
    assert.equal(r.status, 0, `the review driver exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ''}:\n${r.stdout}${r.stderr}${r.error || ''}`);
    world.observed = JSON.parse(fs.readFileSync(out, 'utf8'));
    world.trees = { $CANDIDATE_TREE: world.fixture.tree, $CURRENT_TREE: treeNow(world.fixture.root, world.fixture.start) };
  }
  When(prefix + 'the review driver reviews the candidate', { timeout: 300000 }, function () {
    review(this, {});
  });
  When(prefix + 'the review driver reviews the candidate under the restriction {string}', { timeout: 300000 }, function (name) {
    review(this, { restriction: name });
  });
  When(prefix + 'the review driver reviews the candidate, is interrupted before request {int} and resumes from its checkpoint', { timeout: 300000 }, function (n) {
    review(this, { interrupt: n });
  });
  function observed(world) {
    assert.ok(world.observed, 'no review ran: use "the review driver reviews the candidate" first');
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
    judge.problems(o, JSON.parse(trees(this, doc)));
  });
  // The doc string is the JSON list review-1.json keeps under "requirements".
  Then(prefix + 'the review record keeps the requirements:', function (doc) {
    judge.requirements(observed(this), JSON.parse(doc));
  });
  Then(prefix + 'the review reports the requirement {string} unverified with the focused check {string}', function (requirement, check) {
    judge.reported(observed(this), requirement, check);
  });
  Then(prefix + 'the review reports no unverified requirement', function () {
    judge.notReported(observed(this));
  });
  Then(prefix + 'the checkout\'s files are still the saved candidate\'s', function () {
    observed(this);
    assert.equal(this.trees.$CURRENT_TREE, this.fixture.tree, 'the review changed the checkout\'s files');
  });
}
