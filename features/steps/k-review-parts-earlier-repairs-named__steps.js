// Steps of Intent k-review-parts-earlier-repairs-named: when an external review's source is
// reviewed in ordered parts, the prompt of every part after the first names, as exact data, the
// paths that the reviewers of the earlier parts repaired (verified), and the review material
// evidence records the list each part was sent. The steps make a saved candidate in a temporary
// Git checkout whose review source needs three parts; a scripted external reviewer, which may
// write files in the checkout before it answers, reviews it through the review driver
// (k-review-parts-earlier-repairs-named__driver.js), a Go program built in a copy of this
// checkout. The driver records the exact brief every session was started with. The fixture's
// commits have fixed dates, so its review source and every prompt are the same bytes in every
// run; the prompts sent before this Intent are pinned by their SHA-256 in the feature.
//
// "$KOGEN_NODE" <this file> --control good|bad checks the judgments against a known-good
// observation and known-bad mutations of it; Cucumber loads this file as step definitions.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const prefix = 'k-review-parts-earlier-repairs-named: ';
const CEILING = 524288;
const HEADING = '# Paths repaired by earlier parts\n\n';

// ---- Judgments: each takes an observation and throws when it differs from the expectation. ----
//
// An observation is {verdict, stop, sessions, stable, dynamic, material, source}: the review's
// ending, the number of sessions started, the exact stable and dynamic text (Buffers) the i-th
// session was started with (index i-1), the review material evidence (review-1-material.json)
// and the exact review source the parts were cut from (review-1-source.txt, a Buffer).

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function partOf(o, k) {
  const ev = (o.material.review_parts || [])[k - 1];
  assert.ok(ev, `the material evidence has no part ${k}: ${JSON.stringify(o.material.review_parts)}`);
  assert.ok(k <= o.sessions, `part ${k} was never sent: ${o.sessions} sessions started`);
  return ev;
}

// header is the text of part k before its source slice, as sent.
function header(o, k) {
  const ev = partOf(o, k);
  const d = o.dynamic[k - 1];
  const n = ev.to - ev.from;
  assert.ok(Number.isInteger(n) && n >= 0 && n <= d.length, `part ${k}'s evidence range [${ev.from}, ${ev.to}) does not fit its ${d.length}-byte text`);
  assert.ok(d.subarray(d.length - n).equals(o.source.subarray(ev.from, ev.to)), `part ${k}'s text does not end with bytes [${ev.from}, ${ev.to}) of the review source`);
  return d.subarray(0, d.length - n).toString('utf8');
}

// framing is the check results and the catalog that part 1's header carries.
function framing(o) {
  const h = header(o, 1);
  const a = '# Check results of the final pass\n\n';
  const b = '\n\n# Every changed path\n\n';
  const i = h.indexOf(a);
  const j = h.indexOf(b, i);
  const c = h.indexOf('\n\n# Source part 1 of ', j + b.length);
  assert.ok(i >= 0 && j > i && c > j, `part 1's header is not the parts' header:\n${h}`);
  return { checks: h.slice(i + a.length, j), catalog: h.slice(j + b.length, c) };
}

// expected is the header of part k: the parts' header before this Intent, with section (the
// repaired-paths section, or '') just before the heading of the source part.
function expected(o, k, section) {
  const ev = partOf(o, k);
  const n = o.material.review_parts.length;
  const { checks, catalog } = framing(o);
  return `# Review part ${k} of ${n}\n\nThis part carries bytes [${ev.from}, ${ev.to}) of the ${o.source.length} bytes of the candidate's complete review source (SHA-256 ${sha(o.source)}); the other parts carry the rest, in order.\n\n` +
    `# Check results of the final pass\n\n${checks}\n\n# Every changed path\n\n${catalog}\n\n${section}# Source part ${k} of ${n}\n\n`;
}

const judge = {
  approves(o, n) {
    assert.equal(o.stop, '', `the review stopped: ${o.stop} ${JSON.stringify(o.lines || [])}`);
    assert.equal(o.verdict, 'approve', `the review's verdict is ${o.verdict}, want approve`);
    assert.equal(o.sessions, n, `the review started ${o.sessions} sessions, want ${n} parts`);
    assert.equal((o.material.review_parts || []).length, n, `the material evidence records ${(o.material.review_parts || []).length} parts, want ${n}`);
  },
  // noSection: part k's header is exactly the parts' header before this Intent.
  noSection(o, k) {
    const h = header(o, k);
    assert.ok(!h.includes(HEADING), `part ${k}'s prompt has a repaired-paths section:\n${h}`);
    assert.equal(h, expected(o, k, ''), `part ${k}'s header is not the parts' header`);
  },
  // lists: part k's header carries the section intro, then the list line, just before its source.
  lists(o, k, intro, line) {
    const section = `${intro}\n\n${line}\n\n`;
    assert.equal(header(o, k), expected(o, k, section), `part ${k}'s prompt does not list exactly ${line}`);
  },
  // ceiling: every sent part's measured prompt (stable and dynamic text) fits the inclusive
  // ceiling and is what its evidence records.
  ceiling(o) {
    assert.equal(o.material.review_parts.length, o.sessions, `the evidence records ${o.material.review_parts.length} parts, ${o.sessions} were sent`);
    o.material.review_parts.forEach((ev, i) => {
      const prompt = o.stable[i].length + o.dynamic[i].length;
      assert.ok(prompt <= CEILING, `part ${i + 1}'s measured prompt is ${prompt} bytes, over the ${CEILING}-byte ceiling`);
      assert.equal(ev.part, i + 1, `evidence entry ${i + 1} is part ${ev.part}`);
      assert.equal(ev.prompt_bytes, prompt, `part ${i + 1}'s evidence records a ${ev.prompt_bytes}-byte prompt, ${prompt} bytes were sent`);
      assert.equal(ev.bytes, o.dynamic[i].length, `part ${i + 1}'s evidence records ${ev.bytes} bytes, ${o.dynamic[i].length} were sent`);
      assert.equal(ev.sha256, sha(o.dynamic[i]), `part ${i + 1}'s evidence records another text than was sent`);
    });
  },
  // covers: the sent parts' slices are consecutive and are the whole review source once.
  covers(o) {
    let at = 0;
    o.material.review_parts.forEach((ev, i) => {
      assert.equal(ev.from, at, `part ${i + 1} starts at ${ev.from}, want ${at}`);
      assert.ok(ev.to > ev.from, `part ${i + 1} carries no source`);
      header(o, i + 1);
      at = ev.to;
    });
    assert.equal(at, o.source.length, `the parts carry ${at} of the ${o.source.length} bytes of the review source`);
  },
  // evidence: part k's evidence records the paths it was sent and the count left out
  // (no repaired_paths key without paths, no repaired_more key without a count).
  evidence(o, k, paths, more) {
    const ev = partOf(o, k);
    if (paths.length === 0) assert.ok(!('repaired_paths' in ev), `part ${k}'s evidence records repaired paths ${JSON.stringify(ev.repaired_paths)}, want none`);
    else assert.deepEqual(ev.repaired_paths, paths, `part ${k}'s evidence records the repaired paths ${JSON.stringify(ev.repaired_paths)}, want ${JSON.stringify(paths)}`);
    if (more === 0) assert.ok(!('repaired_more' in ev), `part ${k}'s evidence records repaired_more ${ev.repaired_more}, want none`);
    else assert.equal(ev.repaired_more, more, `part ${k}'s evidence records repaired_more ${ev.repaired_more}, want ${more}`);
  },
  // sentBefore: the sessions were started with exactly the briefs sent before this Intent:
  // rows[i] is {part, from, to, prompt, stable, dynamic} (the source range, the measured prompt
  // and the SHA-256 of the stable and the dynamic text of part i+1).
  sentBefore(o, rows) {
    assert.equal(o.sessions, rows.length, `${o.sessions} sessions started, ${rows.length} before this Intent`);
    rows.forEach((row, i) => {
      const ev = partOf(o, i + 1);
      const got = { part: ev.part, from: ev.from, to: ev.to, prompt: o.stable[i].length + o.dynamic[i].length, stable: sha(o.stable[i]), dynamic: sha(o.dynamic[i]) };
      assert.deepEqual(got, row, `part ${i + 1}'s prompt is not the one sent before this Intent`);
    });
  },
};

// fingerprint is the rows of judge.sentBefore that o's prompts have.
function fingerprint(o) {
  return o.material.review_parts.map((ev, i) => ({ part: ev.part, from: ev.from, to: ev.to, prompt: o.stable[i].length + o.dynamic[i].length, stable: sha(o.stable[i]), dynamic: sha(o.dynamic[i]) }));
}

// ---- Observer controls. ----

const INTRO = '# Paths repaired by earlier parts\n\nReviewers of earlier parts repaired these paths, and Kogen verified the repairs, after the review source was cut: what the review source shows of them is stale or missing. Read each of them from the checkout.';

// synthetic is a known-good observation of three parts of a small source, built with the
// parts' header; lists[k-1] is part k's list line ('' for none), evidence[k-1] the repaired-paths
// keys of part k's evidence and gap the source bytes left out before part 3.
function synthetic(lists, evidence, gap = 0) {
  const source = Buffer.from('diff --git a/a.txt b/a.txt\n+ALPHA\n' + 'line\n'.repeat(30));
  const cuts = [[0, 40], [40, 100], [100 + gap, source.length]];
  const checks = 'acceptance: passed (0 scenarios)';
  const catalog = '[{"path":"a.txt"}]';
  const stable = Buffer.from('authority\n# Review task\n');
  const o = { verdict: 'approve', stop: '', lines: [], sessions: 3, stable: [], dynamic: [], source, material: { review: 1, review_parts: [] } };
  cuts.forEach(([from, to], i) => {
    const section = lists[i] ? `${INTRO}\n\n${lists[i]}\n\n` : '';
    const text = Buffer.concat([Buffer.from(`# Review part ${i + 1} of 3\n\nThis part carries bytes [${from}, ${to}) of the ${source.length} bytes of the candidate's complete review source (SHA-256 ${sha(source)}); the other parts carry the rest, in order.\n\n` +
      `# Check results of the final pass\n\n${checks}\n\n# Every changed path\n\n${catalog}\n\n${section}# Source part ${i + 1} of 3\n\n`), source.subarray(from, to)]);
    o.stable.push(stable);
    o.dynamic.push(text);
    const ev = { part: i + 1, file: `review-1-part-${i + 1}.txt`, bytes: text.length, sha256: sha(text), from, to, prompt_bytes: stable.length + text.length, session_id: `s${i + 1}`, delivered: true, delivered_round: 1 };
    Object.assign(ev, evidence[i]);
    o.material.review_parts.push(ev);
  });
  return o;
}

// evidence is the known-good repaired-paths keys of the three parts' evidence.
const evidence = () => [{}, { repaired_paths: ['c.txt'] }, { repaired_paths: ['a.txt', 'c.txt'], repaired_more: 2 }];

function good() {
  return synthetic(['', '["c.txt"]', '["a.txt","c.txt"] and 2 more'], evidence());
}

// accepts judges o as the scenarios do for the known-good shape.
function accepts(o, base) {
  judge.approves(o, 3);
  judge.noSection(o, 1);
  judge.lists(o, 2, INTRO, '["c.txt"]');
  judge.lists(o, 3, INTRO, '["a.txt","c.txt"] and 2 more');
  judge.ceiling(o);
  judge.covers(o);
  judge.evidence(o, 1, [], 0);
  judge.evidence(o, 2, ['c.txt'], 0);
  judge.evidence(o, 3, ['a.txt', 'c.txt'], 2);
  judge.sentBefore(o, fingerprint(base));
}

function control(mode) {
  if (mode === 'good') {
    accepts(good(), good());
    console.log('known-good observation accepted');
    return;
  }
  const bad = {
    'part 2 without its list': () => synthetic(['', '', '["a.txt","c.txt"] and 2 more'], evidence().map((e, i) => (i === 1 ? {} : e))),
    'part 1 with a list': () => synthetic(['["c.txt"]', '["c.txt"]', '["a.txt","c.txt"] and 2 more'], evidence()),
    'an unsorted list': () => synthetic(['', '["c.txt"]', '["c.txt","a.txt"] and 2 more'], evidence()),
    'a path listed twice': () => synthetic(['', '["c.txt","c.txt"]', '["a.txt","c.txt"] and 2 more'], evidence()),
    'a list without its count': () => synthetic(['', '["c.txt"]', '["a.txt","c.txt"]'], evidence()),
    'evidence of another list': () => { const o = good(); o.material.review_parts[1].repaired_paths = ['a.txt']; return o; },
    'evidence without the count': () => { const o = good(); delete o.material.review_parts[2].repaired_more; return o; },
    'a prompt over the ceiling': () => { const o = good(); o.stable[2] = Buffer.alloc(CEILING); o.material.review_parts[2].prompt_bytes = CEILING + o.dynamic[2].length; return o; },
    'a source byte left out': () => synthetic(['', '["c.txt"]', '["a.txt","c.txt"] and 2 more'], evidence(), 1),
    'the list after the source heading': () => { const o = good(); o.dynamic[1] = Buffer.from(o.dynamic[1].toString().replace(`${INTRO}\n\n["c.txt"]\n\n# Source part 2 of 3\n\n`, `# Source part 2 of 3\n\n${INTRO}\n\n["c.txt"]\n\n`)); return o; },
  };
  // The prompt sent before this Intent differs by its last byte: only judge.sentBefore sees it.
  const before = good();
  before.dynamic[0] = Buffer.concat([before.dynamic[0].subarray(0, before.dynamic[0].length - 1), Buffer.from('X')]);
  let rejected = 0;
  bad['a prompt that differs from before by one byte'] = () => good();
  for (const [name, make] of Object.entries(bad)) {
    try {
      accepts(make(), name === 'a prompt that differs from before by one byte' ? before : good());
    } catch (e) {
      if (!(e instanceof assert.AssertionError)) throw e;
      rejected++;
      continue;
    }
    console.log(`accepted the known-bad observation: ${name}`);
    process.exitCode = 2;
    return;
  }
  console.log(`rejected ${rejected} known-bad observations`);
  process.exitCode = 1;
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

  // Fixed dates make the fixture's commits, and so its review source, the same in every run.
  function git(dir, ...args) {
    const r = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
      cwd: dir, encoding: 'utf8', env: isolated({ GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' }), maxBuffer: 1 << 26,
    });
    assert.equal(r.status, 0, `git ${args.join(' ')} in ${dir} exited ${r.status}:\n${r.stdout}${r.stderr}${r.error || ''}`);
    return r.stdout.trim();
  }

  const intentFiles = {
    '.kogen/project.yaml': 'version: 1\ncommands:\n  setup: []\n  fix: []\n  checks: []\n',
    '.kogen/intents/fixture/intent.md': '# Count in words\n\nSlug: fixture\nModel: not applicable — text files\nAcceptance:\n- .kogen/intents/fixture/acceptance.feature\n\na.txt says alpha in words.\n',
    '.kogen/intents/fixture/acceptance.feature': 'Feature: Words\n\n  Scenario: Words\n    Then a.txt says alpha in words\n',
  };

  function write(root, files) {
    for (const [file, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), body);
    }
  }

  // The start commit holds the approved Intent and a.txt, b.txt and c.txt; the saved candidate,
  // the checkout's HEAD, changes a.txt and adds big.txt.
  Given(prefix + 'a saved candidate that changes a.txt and adds a file of {int} lines, whose review source needs three parts', function (lines) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parts-candidate-'));
    git(root, 'init', '-q', '-b', 'main');
    write(root, { ...intentFiles, 'a.txt': 'alpha\n', 'b.txt': 'beta\n', 'c.txt': 'gamma\n' });
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'start');
    const start = git(root, 'rev-parse', 'HEAD');
    const big = Array.from({ length: lines }, (_, i) => `line ${String(i + 1).padStart(6, '0')} of the large file\n`).join('');
    write(root, { 'a.txt': 'alpha\nALPHA\n', 'big.txt': big });
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'saved candidate');
    this.fixture = { root, start };
    this.plan = { parts: [] };
  });

  // The section's intro: its heading and its instruction, before the list line.
  Given(prefix + 'the repaired-paths section of a part\'s prompt begins with:', function (doc) {
    this.intro = doc;
  });

  function plan(world) {
    assert.ok(world.plan, 'make the saved candidate first');
    return world.plan;
  }

  // The reviewer of part k writes files, approves, is told the repaired tree passed and approves
  // it; the parts before it without a plan approve without writing.
  function repairs(world, k, files) {
    const p = plan(world);
    const approve = { verdict: 'approve', findings: [] };
    while (p.parts.length < k) p.parts.push([{ write: {}, verdict: approve }]);
    p.parts[k - 1] = [{ write: files, verdict: approve }, { write: {}, verdict: approve }];
  }

  Given(prefix + 'the reviewer of every part approves without repairs', function () {
    plan(this).parts = [];
  });

  // The doc string is a JSON object of path: content.
  Given(prefix + 'the reviewer of part {int} repairs the files:', function (k, doc) {
    repairs(this, k, JSON.parse(doc));
  });

  // The added paths: many/r-<4-digit index>-xxx…x.txt, each exactly bytes long.
  function added(count, bytes) {
    return Array.from({ length: count }, (_, i) => `many/r-${String(i + 1).padStart(4, '0')}-${'x'.repeat(bytes - 16)}.txt`);
  }

  Given(prefix + 'the reviewer of part {int} adds {int} files whose paths are {int} bytes long', function (k, count, bytes) {
    const paths = added(count, bytes);
    assert.ok(paths.every((p) => p.length === bytes), `the added paths are not ${bytes} bytes long`);
    assert.ok(JSON.stringify(paths).length > CEILING, `the JSON list of the ${count} added paths is not longer than the ${CEILING}-byte ceiling`);
    this.added = paths;
    repairs(this, k, Object.fromEntries(paths.map((p) => [p, 'repaired\n'])));
  });

  let driver = null; // the one build of this process: {bin, status, output}

  // The driver is built in a copy of this checkout's files.
  function buildDriver() {
    if (!driver) {
      const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'parts-driver-src-'));
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
      fs.mkdirSync(path.join(copy, 'internal', 'partsdriver'), { recursive: true });
      fs.writeFileSync(path.join(copy, 'internal', 'partsdriver', 'main.go'), require('./k-review-parts-earlier-repairs-named__driver.js'));
      const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'parts-driver-bin-')), 'partsdriver');
      const r = spawnSync('go', ['build', '-mod=readonly', '-buildvcs=false', '-o', bin, './internal/partsdriver'], { cwd: copy, encoding: 'utf8', env: isolated({}) });
      driver = { bin, status: r.status, output: `${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
      fs.rmSync(copy, { recursive: true, force: true });
    }
    assert.equal(driver.status, 0, `go build ./internal/partsdriver (the review driver in a copy of this checkout) exited ${driver.status}:\n${driver.output}`);
    return driver.bin;
  }

  function review(world) {
    const bin = buildDriver();
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'parts-driver-out-'));
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'parts-driver-plan-')), 'plan.json');
    fs.writeFileSync(file, JSON.stringify(plan(world)));
    const r = spawnSync(bin, [], {
      cwd: out, encoding: 'utf8', timeout: 240000, maxBuffer: 1 << 26,
      env: isolated({ HOME: out, PARTS_ROOT: world.fixture.root, PARTS_START: world.fixture.start, PARTS_PLAN: file, PARTS_OUT: out }),
    });
    assert.equal(r.status, 0, `the review driver exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ''}:\n${r.stdout}${(r.stderr || '').slice(-4000)}${r.error || ''}`);
    const o = JSON.parse(fs.readFileSync(path.join(out, 'observation.json'), 'utf8'));
    const material = path.join(o.run, 'executor-review', 'review-1-material.json');
    assert.ok(fs.existsSync(material), `the review left no material evidence ${material} (it was not reviewed in parts): ${JSON.stringify(o)}`);
    o.material = JSON.parse(fs.readFileSync(material, 'utf8'));
    o.source = fs.readFileSync(path.join(o.run, 'executor-review', o.material.source.file));
    o.stable = [];
    o.dynamic = [];
    for (let i = 1; i <= o.sessions; i++) {
      o.stable.push(fs.readFileSync(path.join(out, `stable-${i}.txt`)));
      o.dynamic.push(fs.readFileSync(path.join(out, `dynamic-${i}.txt`)));
    }
    return o;
  }

  When(prefix + 'the review runs', { timeout: 600000 }, function () {
    this.observed = review(this);
  });

  function observed(world) {
    assert.ok(world.observed, 'no review ran: use "the review runs" first');
    return world.observed;
  }

  function intro(world) {
    assert.ok(world.intro, 'state the repaired-paths section\'s beginning first');
    return world.intro;
  }

  Then(prefix + 'the review approves in {int} parts', function (n) {
    judge.approves(observed(this), n);
  });

  // The table has the columns part, from, to, prompt bytes, stable sha256 and dynamic sha256:
  // what the review sent each part before this Intent.
  Then(prefix + 'every part\'s prompt is byte-identical to the prompt sent before this Intent:', function (table) {
    const rows = table.hashes().map((r) => ({
      part: Number(r.part), from: Number(r.from), to: Number(r.to), prompt: Number(r['prompt bytes']), stable: r['stable sha256'], dynamic: r['dynamic sha256'],
    }));
    judge.sentBefore(observed(this), rows);
  });

  Then(prefix + 'part {int}\'s prompt has no repaired-paths section', function (k) {
    judge.noSection(observed(this), k);
  });

  Then(prefix + 'no part\'s prompt has a repaired-paths section', function () {
    const o = observed(this);
    for (let k = 1; k <= o.sessions; k++) judge.noSection(o, k);
  });

  Then(prefix + 'part {int}\'s prompt lists the repaired paths {string}', function (k, line) {
    judge.lists(observed(this), k, intro(this), line);
  });

  Then(prefix + 'part {int}\'s prompt lists the first {int} added paths followed by {string}', function (k, m, suffix) {
    assert.ok(this.added, 'no files were added by a reviewer');
    judge.lists(observed(this), k, intro(this), JSON.stringify(this.added.slice(0, m)) + suffix);
  });

  Then(prefix + 'every part\'s measured prompt is at most 524288 bytes and is what its material evidence records', function () {
    judge.ceiling(observed(this));
  });

  Then(prefix + 'the parts carry the whole review source once, in order', function () {
    judge.covers(observed(this));
  });

  Then(prefix + 'the material evidence of part {int} records no repaired paths', function (k) {
    judge.evidence(observed(this), k, [], 0);
  });

  Then(prefix + 'the material evidence of part {int} records the repaired paths {string} and no count of more', function (k, list) {
    judge.evidence(observed(this), k, JSON.parse(list), 0);
  });

  Then(prefix + 'the material evidence of part {int} records the first {int} added paths and {int} more', function (k, m, more) {
    assert.ok(this.added, 'no files were added by a reviewer');
    judge.evidence(observed(this), k, this.added.slice(0, m), more);
  });

  Then(prefix + 'no part\'s material evidence records repaired paths', function () {
    const o = observed(this);
    for (let k = 1; k <= o.sessions; k++) judge.evidence(o, k, [], 0);
  });
}
