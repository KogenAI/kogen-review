// Steps of Intent review-shared-test-support-edit-flagged: an external review of a saved Git
// candidate lists the changed shared test support paths in its review source, before the diff,
// and its review task (and the native reviewer's instructions) carry the shared test support
// rule once. The steps make the candidate in a temporary Git checkout with fixed commit dates and
// review it through a Go driver (review-shared-test-support-edit-flagged__driver.js) built in a
// copy of this checkout; the driver records the exact brief of every session and the native
// instructions.
//
// "$KOGEN_NODE" <this file> --control good|bad checks the judgments against a known-good
// observation and known-bad mutations of it; Cucumber loads this file as step definitions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const prefix = 'review-shared-test-support-edit-flagged: ';
const MARK = 'shared test support changed:';
const DIFF = '# Diff of existing/deleted paths';

// ---- Judgments: each takes an observation and throws when it differs from the expectation. ----
// An observation is {verdict, stop, sessions, stable, dynamic, instructions}: the review's
// ending, the sessions started, the exact stable and dynamic text of the i-th session's brief
// (index i-1) and the native reviewer's instructions.

const count = (text, needle) => text.split(needle).length - 1;

const judge = {
  approves(o) {
    assert.equal(o.stop, '', `the review stopped: ${o.stop}`);
    assert.equal(o.verdict, 'approve', `the review's verdict is ${o.verdict}, want approve`);
  },
  // lineBeforeDiff: the one-session source holds the line once, as a whole line, before the diff.
  lineBeforeDiff(o, line) {
    assert.equal(o.sessions, 1, `${o.sessions} sessions started, want one`);
    const text = o.dynamic[0];
    const found = text.split('\n').filter((l) => l.startsWith(MARK));
    assert.deepEqual(found, [line], `the review source's "${MARK}" lines are ${JSON.stringify(found)}, want exactly ${JSON.stringify([line])}`);
    const at = text.indexOf(line);
    const diff = text.indexOf(DIFF);
    assert.ok(diff >= 0, `the review source has no "${DIFF}" heading`);
    assert.ok(at < diff, `the line is at byte ${at}, after the diff heading at byte ${diff}`);
  },
  noLine(o) {
    assert.equal(o.sessions, 1, `${o.sessions} sessions started, want one`);
    const found = o.dynamic[0].split('\n').filter((l) => l.includes(MARK));
    assert.deepEqual(found, [], `the review source has "${MARK}" lines ${JSON.stringify(found)}, want none`);
  },
  // partsLine: the parts of the review carry the line once between them, before the diff.
  partsLine(o, line) {
    assert.ok(o.sessions >= 2, `${o.sessions} sessions started, want a review in parts`);
    const all = o.dynamic.join('');
    const found = all.split('\n').filter((l) => l.startsWith(MARK));
    assert.deepEqual(found, [line], `the parts' "${MARK}" lines are ${JSON.stringify(found)}, want exactly ${JSON.stringify([line])}`);
    const at = o.dynamic.findIndex((d) => d.includes(line));
    assert.equal(at, 0, `the line is in part ${at + 1}, want part 1`);
    assert.ok(o.dynamic[0].indexOf(line) < o.dynamic[0].indexOf(DIFF), 'the line is after the diff heading in part 1');
  },
  nativeRule(o, rule) {
    assert.equal(count(o.instructions, rule), 1, `the native reviewer instructions carry the rule ${count(o.instructions, rule)} times, want once`);
  },
  oneSessionRule(o, rule) {
    assert.equal(o.sessions, 1, `${o.sessions} sessions started, want one`);
    assert.equal(count(o.stable[0], rule), 1, `the one-session review task carries the rule ${count(o.stable[0], rule)} times, want once`);
  },
  partRule(o, rule) {
    assert.ok(o.sessions >= 2, `${o.sessions} sessions started, want a review in parts`);
    o.stable.forEach((s, i) => assert.equal(count(s, rule), 1, `the task of part ${i + 1} carries the rule ${count(s, rule)} times, want once`));
  },
};

// ---- Observer controls. ----

const RULE = "Shared test support: when the review source has a line starting `shared test support changed:` and the approved Intent does not name those paths, repair it: restore each listed shared file byte for byte and move the behaviour the candidate needs into a helper or override beside the candidate's own new test files; when that cannot be done within the Intent, submit changes with a blocking finding naming the path and the line. A path the Intent names is not an issue.";
const LINE = `${MARK} test/test_helpers/session_test_helper.rb`;

function synthetic(sessions) {
  const source = `# Check results of the final pass\n\nok\n\n${LINE}\n\n${DIFF} against start HEAD abc\n\ndiff --git a/x b/x\n`;
  const o = { verdict: 'approve', stop: '', sessions, stable: [], dynamic: [], instructions: `a\n${RULE}\nb\n` };
  for (let i = 0; i < sessions; i++) {
    o.stable.push(`authority\n# Review task\n${RULE}\n`);
    o.dynamic.push(i === 0 ? source : `# Source part ${i + 1}\n\nmore\n`);
  }
  return o;
}

function control(mode) {
  const accepts = (one, parts) => {
    judge.approves(one);
    judge.lineBeforeDiff(one, LINE);
    judge.nativeRule(one, RULE);
    judge.oneSessionRule(one, RULE);
    judge.partsLine(parts, LINE);
    judge.partRule(parts, RULE);
    const none = synthetic(1);
    none.dynamic[0] = none.dynamic[0].replace(`${LINE}\n\n`, '');
    judge.noLine(none);
  };
  if (mode === 'good') {
    accepts(synthetic(1), synthetic(3));
    console.log('shared-test-support observer accepted controls');
    return;
  }
  const bads = {
    'a line after the diff': () => { const o = synthetic(1); o.dynamic[0] = o.dynamic[0].replace(`${LINE}\n\n`, '') + `${LINE}\n`; return [o, synthetic(3)]; },
    'a line listing another path': () => { const o = synthetic(1); o.dynamic[0] = o.dynamic[0].replace(LINE, `${LINE}, test/test_helpers/new.rb`); return [o, synthetic(3)]; },
    'a line twice': () => { const o = synthetic(1); o.dynamic[0] = o.dynamic[0].replace(`${LINE}\n`, `${LINE}\n${LINE}\n`); return [o, synthetic(3)]; },
    'no rule in the one-session task': () => { const o = synthetic(1); o.stable[0] = 'authority\n'; return [o, synthetic(3)]; },
    'the rule twice in a part task': () => { const p = synthetic(3); p.stable[1] += RULE; return [synthetic(1), p]; },
    'no rule in the native instructions': () => { const o = synthetic(1); o.instructions = 'a\n'; return [o, synthetic(3)]; },
    'the line in no part': () => { const p = synthetic(3); p.dynamic[0] = p.dynamic[0].replace(`${LINE}\n\n`, ''); return [synthetic(1), p]; },
  };
  let rejected = 0;
  for (const [name, make] of Object.entries(bads)) {
    try {
      accepts(...make());
    } catch (e) {
      if (!(e instanceof assert.AssertionError)) throw e;
      rejected++;
      continue;
    }
    console.log(`shared-test-support observer accepted a known-bad observation: ${name}`);
    process.exitCode = 2;
    return;
  }
  console.log(`shared-test-support observer rejected ${rejected} known-bad observations`);
  process.exitCode = 1;
}

if (require.main === module) {
  assert.ok(process.argv[2] === '--control' && ['good', 'bad'].includes(process.argv[3]), 'usage: <this file> --control good|bad');
  control(process.argv[3]);
} else {
  steps();
}

// ---- The saved candidate and its review. ----

function steps() {
  const { Given, When, Then } = require('@cucumber/cucumber');
  const checkout = process.cwd();

  function isolated(extra) {
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (!k.startsWith('GIT_') && !k.startsWith('KOGEN_ACCEPTANCE_')) env[k] = v;
    }
    return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...extra };
  }

  function git(dir, ...args) {
    const r = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
      cwd: dir, encoding: 'utf8', env: isolated({ GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' }), maxBuffer: 1 << 26,
    });
    assert.equal(r.status, 0, `git ${args.join(' ')} in ${dir} exited ${r.status}:\n${r.stdout}${r.stderr}${r.error || ''}`);
    return r.stdout.trim();
  }

  function write(root, files) {
    for (const [file, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), body);
    }
  }

  const defaultIntent = '# Add the thing\n\nSlug: fixture\nModel: not applicable — text files\nAcceptance:\n- .kogen/intents/fixture/acceptance.feature\n\nThe candidate implements the thing.\n';

  function world(w) {
    w.f = w.f || { start: {}, candidate: {}, intent: defaultIntent, big: 0 };
    return w.f;
  }

  Given(prefix + 'a start commit with the files:', function (doc) {
    world(this).start = JSON.parse(doc);
  });

  Given(prefix + 'the approved Intent text is:', function (doc) {
    world(this).intent = doc;
  });

  Given(prefix + 'the candidate writes the files:', function (doc) {
    world(this).candidate = JSON.parse(doc);
  });

  Given(prefix + 'the candidate also adds a file big.txt of {int} lines', function (lines) {
    world(this).big = lines;
  });

  let driver = null;

  function buildDriver() {
    if (!driver) {
      const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'shs-driver-src-'));
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
      fs.mkdirSync(path.join(copy, 'internal', 'shsdriver'), { recursive: true });
      fs.writeFileSync(path.join(copy, 'internal', 'shsdriver', 'main.go'), require('./review-shared-test-support-edit-flagged__driver.js'));
      const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shs-driver-bin-')), 'shsdriver');
      const r = spawnSync('go', ['build', '-mod=readonly', '-buildvcs=false', '-o', bin, './internal/shsdriver'], { cwd: copy, encoding: 'utf8', env: isolated({}) });
      driver = { bin, status: r.status, output: `${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
      fs.rmSync(copy, { recursive: true, force: true });
    }
    assert.equal(driver.status, 0, `go build ./internal/shsdriver (the review driver in a copy of this checkout) exited ${driver.status}:\n${driver.output}`);
    return driver.bin;
  }

  When(prefix + 'the review runs', { timeout: 600000 }, function () {
    const f = world(this);
    const bin = buildDriver();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shs-candidate-'));
    git(root, 'init', '-q', '-b', 'main');
    write(root, {
      '.kogen/project.yaml': 'version: 1\ncommands:\n  setup: []\n  fix: []\n  checks: []\n',
      '.kogen/intents/fixture/intent.md': f.intent,
      '.kogen/intents/fixture/acceptance.feature': 'Feature: Thing\n\n  Scenario: Thing\n    Then the thing exists\n',
      ...f.start,
    });
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'start');
    const start = git(root, 'rev-parse', 'HEAD');
    const files = { ...f.candidate };
    if (f.big > 0) files['big.txt'] = Array.from({ length: f.big }, (_, i) => `line ${String(i + 1).padStart(6, '0')} of the large file\n`).join('');
    write(root, files);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'saved candidate');
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'shs-driver-out-'));
    const r = spawnSync(bin, [], {
      cwd: out, encoding: 'utf8', timeout: 240000, maxBuffer: 1 << 26,
      env: isolated({ HOME: out, SHS_ROOT: root, SHS_START: start, SHS_OUT: out }),
    });
    assert.equal(r.status, 0, `the review driver exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ''}:\n${r.stdout}${(r.stderr || '').slice(-4000)}${r.error || ''}`);
    const o = JSON.parse(fs.readFileSync(path.join(out, 'observation.json'), 'utf8'));
    o.stable = [];
    o.dynamic = [];
    for (let i = 1; i <= o.sessions; i++) {
      o.stable.push(fs.readFileSync(path.join(out, `stable-${i}.txt`), 'utf8'));
      o.dynamic.push(fs.readFileSync(path.join(out, `dynamic-${i}.txt`), 'utf8'));
    }
    o.instructions = fs.readFileSync(path.join(out, 'instructions.txt'), 'utf8');
    this.observed = o;
  });

  function observed(w) {
    assert.ok(w.observed, 'no review ran: use "the review runs" first');
    return w.observed;
  }

  Then(prefix + 'the review approves', function () {
    judge.approves(observed(this));
  });

  Then(prefix + 'the review source has exactly the line {string} before the diff', function (line) {
    judge.lineBeforeDiff(observed(this), line);
  });

  Then(prefix + 'the review source has no shared test support line', function () {
    judge.noLine(observed(this));
  });

  Then(prefix + 'the parts of the review carry exactly the line {string} in part 1, before the diff', function (line) {
    judge.partsLine(observed(this), line);
  });

  Then(prefix + 'the native reviewer instructions carry this rule text once:', function (rule) {
    judge.nativeRule(observed(this), rule);
  });

  Then(prefix + 'the one-session review task carries this rule text once:', function (rule) {
    judge.oneSessionRule(observed(this), rule);
  });

  Then(prefix + 'the task of every part carries this rule text once:', function (rule) {
    judge.partRule(observed(this), rule);
  });

  Then(prefix + 'the one-session review task names the path {string}', function (p) {
    const o = observed(this);
    assert.ok(o.stable[0].includes(p), `the review task does not carry the Intent that names ${p}`);
  });
}
