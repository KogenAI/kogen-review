// Steps of Intent k-review-wide-change-cost-linear: an external review whose complete prompt does
// not fit the inclusive 524288-byte ceiling is reviewed in ordered parts, and what the parts carry
// grows about linearly with the review source. The steps make a saved candidate in a temporary Git
// checkout and review it through the review driver (k-review-wide-change-cost-linear__driver.js),
// a Go program built in a copy of this checkout over review's public API, with a scripted external
// reviewer. The driver records the exact brief every session was started with; the review
// material evidence (review-1-material.json) and the retained review source are read from the run
// folder. The fixtures' commits have fixed dates, so their review sources and prompts are the same
// bytes in every run.
//
// "$KOGEN_NODE" <this file> --control good|bad checks the judgments against known-good
// observations and known-bad mutations of them; Cucumber loads this file as step definitions.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const prefix = 'k-review-wide-change-cost-linear: ';
const CEILING = 524288;
// FIXED is the bound of a part's text apart from its source slice and its catalog entries line;
// PER_PATH the bound per catalog entry the part carries.
const FIXED = 8192;
const PER_PATH = 600;
const PARTS_HEADING = '# Full text of every added file';
const ADDED_INTRO = `${PARTS_HEADING}\n\nAdded files appear here with their mode; changed files have hunks in the diff.\n\n`;
const REPAIRED_HEAD = '# Paths repaired by earlier parts\n\nReviewers of earlier parts repaired these paths, and Kogen verified the repairs, after the review source was cut: what the review source shows of them is stale or missing. Read each of them from the checkout.\n\n';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const blob = (content) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${Buffer.byteLength(content)}\0`), Buffer.from(content)])).digest('hex');

// entry is the catalog entry of a path that is not a rename or copy.
function entry(p, status, content) {
  return { bytes: Buffer.byteLength(content), git_object: blob(content), mode: '100644', origin: '', path: p, rename: false, sha256: sha(content), status };
}

// ---- Judgments: each takes an observation and throws when it differs from the expectation. ----
//
// An observation is {verdict, stop, detail, lines, findings, sessions, rounds, feedback_bytes,
// verified, run, material, source, stable, dynamic}: how the review ended, the sessions started,
// the rounds played and the bytes of feedback they were given, the verifications Kogen ran, the
// run folder, the review material evidence (null when the review wrote none), the exact review
// source the parts were cut from (a Buffer) and the exact stable and dynamic text (Buffers) the
// i-th session was started with (index i-1).

function parts(o) {
  assert.ok(o.material, `the review left no review material evidence: it stopped with ${o.stop}: ${o.detail}`);
  assert.ok(Array.isArray(o.material.review_parts) && o.material.review_parts.length > 0, `the review material records no parts (the review was not reviewed in parts): ${o.stop} ${o.detail}`);
  return o.material.review_parts;
}

function partOf(o, k) {
  const ev = parts(o)[k - 1];
  assert.ok(ev, `the material evidence has no part ${k}`);
  assert.ok(k <= o.sessions, `part ${k} was never sent: ${o.sessions} sessions started`);
  return ev;
}

// head is the text of part k before its source slice, as sent.
function head(o, k) {
  const ev = partOf(o, k);
  const d = o.dynamic[k - 1];
  const n = ev.to - ev.from;
  assert.ok(Number.isInteger(n) && n >= 0 && n <= d.length, `part ${k}'s evidence range [${ev.from}, ${ev.to}) does not fit its ${d.length}-byte text`);
  assert.ok(d.subarray(d.length - n).equals(o.source.subarray(ev.from, ev.to)), `part ${k}'s text does not end with bytes [${ev.from}, ${ev.to}) of the review source`);
  return d.subarray(0, d.length - n).toString('utf8');
}

// checks is the check results the review source starts with.
function checks(o) {
  const s = o.source.toString('utf8');
  const a = '# Check results of the final pass\n\n';
  const b = s.indexOf('\n\n# Diff of existing/deleted paths against start HEAD ');
  assert.ok(s.startsWith(a) && b > 0, 'the review source does not start with the check results');
  return s.slice(a.length, b);
}

// section is part k's changed-path section and its repaired-paths section ('' when none).
function section(o, k) {
  const ev = partOf(o, k);
  const n = parts(o).length;
  const h = head(o, k);
  const top = `# Review part ${k} of ${n}\n\nThis part carries bytes [${ev.from}, ${ev.to}) of the ${o.source.length} bytes of the candidate's complete review source (SHA-256 ${sha(o.source)}); the other parts carry the rest, in order.\n\n` +
    `# Check results of the final pass\n\n${checks(o)}\n\n# Every changed path\n\n`;
  const tail = `# Source part ${k} of ${n}\n\n`;
  assert.ok(h.startsWith(top), `part ${k}'s text does not begin with its position, the check results and the changed-path heading:\n${h.slice(0, 600)}`);
  assert.ok(h.endsWith(tail), `part ${k}'s text before its slice does not end with "${tail.trim()}"`);
  let mid = h.slice(top.length, h.length - tail.length);
  let repaired = '';
  const r = mid.indexOf(`\n\n${REPAIRED_HEAD}`);
  if (r >= 0) {
    repaired = mid.slice(r + 2);
    mid = mid.slice(0, r + 2);
  }
  assert.ok(mid.endsWith('\n\n'), `part ${k}'s changed-path section does not end with a blank line`);
  return { text: mid.slice(0, -2), repaired, head: h };
}

// ranges are, per changed path, the byte ranges [start, end) of its material in the review
// source: its block in the diff, from its "diff --git" line to the next one or the end of the
// diff, and its entry in the added-files section, from its "--- <path>" line to the next entry's
// or the end of the source.
function ranges(o) {
  const s = o.source;
  const out = new Map(o.material.parts.map((e) => [e.path, []]));
  const diffHead = s.indexOf('# Diff of existing/deleted paths against start HEAD ');
  assert.ok(diffHead >= 0, 'the review source has no diff section');
  const diffStart = s.indexOf('\n\n', diffHead) + 2;
  const diffEnd = s.indexOf(`\n${ADDED_INTRO}`, diffStart);
  assert.ok(diffEnd >= diffStart - 1, 'the review source has no added-files section after its diff');
  const starts = [];
  for (let at = diffStart; ;) {
    const i = s.indexOf('diff --git ', at);
    if (i < 0 || i >= diffEnd) break;
    if (i === diffStart || s[i - 1] === 0x0a) starts.push(i);
    at = i + 1;
  }
  starts.forEach((start, j) => {
    const end = j + 1 < starts.length ? starts[j + 1] : diffEnd;
    const line = s.toString('utf8', start, s.indexOf('\n', start));
    const m = /^diff --git a\/\S+ b\/(\S+)/.exec(line);
    assert.ok(m && out.has(m[1]), `the diff block "${line}" is not of a changed path`);
    out.get(m[1]).push([start, end]);
  });
  let cur = diffEnd + 1 + ADDED_INTRO.length;
  const order = o.material.parts.map((e) => e.path);
  const begin = order.map((p, i) => {
    let at = cur;
    for (;;) {
      const j = s.indexOf(`--- ${p}`, at);
      assert.ok(j >= 0, `the added-files section has no entry for ${p}`);
      const next = s[j + 4 + Buffer.byteLength(p)];
      if ((j === cur && i === 0) || (s[j - 1] === 0x0a && (next === 0x20 || next === 0x0a))) {
        cur = j + 1;
        return j;
      }
      at = j + 1;
    }
  });
  begin.forEach((start, i) => out.get(order[i]).push([start, i + 1 < begin.length ? begin[i + 1] : s.length]));
  return out;
}

// carried are the catalog entries, in catalog order, of the paths whose material overlaps
// [from, to).
function carried(o, from, to) {
  if (!o.ranges) o.ranges = ranges(o);
  return o.material.parts.filter((e) => o.ranges.get(e.path).some(([s, e2]) => s < to && from < e2));
}

// entries is part k's catalog entries line, checked against the paths its slice carries.
function entries(o, k) {
  const ev = partOf(o, k);
  const { text } = section(o, k);
  const want = carried(o, ev.from, ev.to);
  const file = path.join(o.run, 'executor-review', 'review-1-material.json');
  const intro = `This review changes ${o.material.parts.length} paths. The complete catalog of every changed path (path, status, origin, rename, mode, Git object, bytes and SHA-256) is retained in ${file} under "parts"; read an entry there when this part does not carry it. The catalog entries of the ${want.length} paths whose material this part's source carries:\n`;
  assert.ok(text.startsWith(intro), `part ${k}'s changed-path section is not the section of the ${want.length} paths its source carries, naming the retained catalog:\n${text.slice(0, 1200)}`);
  const line = text.slice(intro.length);
  assert.ok(!line.includes('\n'), `part ${k}'s catalog entries are not one line`);
  let got;
  try { got = JSON.parse(line); } catch (e) { assert.fail(`part ${k}'s catalog entries line is not JSON: ${line.slice(0, 200)}`); }
  assert.deepEqual(got, want, `part ${k} does not carry exactly the catalog entries of the paths whose material its source carries`);
  return { line, count: got.length };
}

const judge = {
  // approves: the review approved, every part was sent in its own session, delivered, and at
  // least min parts were recorded.
  approves(o, min) {
    assert.equal(o.stop, '', `the review stopped: ${o.stop}: ${o.detail} ${JSON.stringify(o.lines || [])}`);
    assert.equal(o.verdict, 'approve', `the review's verdict is ${o.verdict}, want approve`);
    const ps = parts(o);
    assert.ok(ps.length >= min, `the review was reviewed in ${ps.length} parts, want at least ${min}`);
    assert.equal(o.sessions, ps.length, `the review started ${o.sessions} sessions for ${ps.length} parts`);
    const ids = new Set();
    ps.forEach((ev, i) => {
      assert.ok(ev.delivered === true && ev.session_id, `part ${i + 1} was not delivered in a completed round of its session: ${JSON.stringify(ev)}`);
      ids.add(ev.session_id);
    });
    assert.equal(ids.size, ps.length, 'two parts share a session');
  },
  // linear: everything the review sent (every session's first prompt and every later round's
  // feedback) is at most twice the review source.
  linear(o) {
    let total = o.feedback_bytes;
    for (let i = 0; i < o.sessions; i++) total += o.stable[i].length + o.dynamic[i].length;
    assert.ok(total <= 2 * o.source.length, `the review sent ${total} bytes for a ${o.source.length}-byte review source, over twice it`);
  },
  // digest: every part was sent the stable text of part 1, and its text apart from its slice and
  // its catalog entries line is at most FIXED bytes.
  digest(o) {
    for (let k = 1; k <= o.sessions; k++) {
      assert.ok(o.stable[k - 1].equals(o.stable[0]), `part ${k} was sent another stable text than part 1`);
      const h = section(o, k).head;
      const { line } = entries(o, k);
      const rest = Buffer.byteLength(h) - Buffer.byteLength(line);
      assert.ok(rest <= FIXED, `part ${k}'s text apart from its source slice and its catalog entries is ${rest} bytes, over ${FIXED}`);
    }
  },
  // sections: every sent part carries exactly the entries of the paths its slice carries, and
  // names the retained catalog of total paths.
  sections(o, total) {
    assert.equal(o.material.parts.length, total, `the retained catalog has ${o.material.parts.length} paths, want ${total}`);
    for (let k = 1; k <= o.sessions; k++) entries(o, k);
  },
  // bound: every sent part's text apart from its slice is at most FIXED plus PER_PATH per entry.
  bound(o) {
    for (let k = 1; k <= o.sessions; k++) {
      const h = section(o, k).head;
      const { count } = entries(o, k);
      const limit = FIXED + PER_PATH * count;
      assert.ok(Buffer.byteLength(h) <= limit, `part ${k}'s text apart from its source slice is ${Buffer.byteLength(h)} bytes for ${count} catalog entries, over ${limit}`);
    }
  },
  // ceiling: every sent part's measured prompt fits the inclusive ceiling and is what its
  // evidence records.
  ceiling(o) {
    assert.equal(parts(o).length, o.sessions, `the evidence records ${parts(o).length} parts, ${o.sessions} were sent`);
    parts(o).forEach((ev, i) => {
      const prompt = o.stable[i].length + o.dynamic[i].length;
      assert.ok(prompt <= CEILING, `part ${i + 1}'s measured prompt is ${prompt} bytes, over the ${CEILING}-byte ceiling`);
      assert.equal(ev.part, i + 1, `evidence entry ${i + 1} is part ${ev.part}`);
      assert.equal(ev.prompt_bytes, prompt, `part ${i + 1}'s evidence records a ${ev.prompt_bytes}-byte prompt, ${prompt} bytes were sent`);
      assert.equal(ev.bytes, o.dynamic[i].length, `part ${i + 1}'s evidence records ${ev.bytes} bytes, ${o.dynamic[i].length} were sent`);
      assert.equal(ev.sha256, sha(o.dynamic[i]), `part ${i + 1}'s evidence records another text than was sent`);
    });
  },
  // covers: the parts' slices are consecutive and are the whole review source once.
  covers(o) {
    let at = 0;
    parts(o).forEach((ev, i) => {
      assert.equal(ev.from, at, `part ${i + 1} starts at ${ev.from}, want ${at}`);
      assert.ok(ev.to > ev.from, `part ${i + 1} carries no source`);
      if (i < o.sessions) head(o, i + 1);
      at = ev.to;
    });
    assert.equal(at, o.source.length, `the parts carry ${at} of the ${o.source.length} bytes of the review source`);
  },
  // retained: the retained catalog is exactly the expected entries (one per changed path).
  retained(o, expected) {
    assert.ok(o.material, 'the review left no review material evidence');
    const got = new Map(o.material.parts.map((e) => [e.path, e]));
    assert.equal(got.size, o.material.parts.length, 'the retained catalog lists a path twice');
    assert.equal(o.material.parts.length, expected.length, `the retained catalog lists ${o.material.parts.length} paths, the change has ${expected.length}`);
    for (const e of expected) assert.deepEqual(got.get(e.path), e, `the retained catalog entry of ${e.path} is not its full details`);
  },
  // repaired: every sent part after the first lists exactly line as the repaired paths, part 1 none.
  repaired(o, line) {
    assert.equal(section(o, 1).repaired, '', 'part 1 has a repaired-paths section');
    assert.ok(o.sessions >= 2, 'the review sent fewer than two parts');
    for (let k = 2; k <= o.sessions; k++) {
      assert.equal(section(o, k).repaired, `${REPAIRED_HEAD}${line}\n\n`, `part ${k} does not list exactly the repaired paths ${line}`);
    }
  },
  // notCarried: part k does not carry the catalog entry of p.
  notCarried(o, k, p) {
    entries(o, k);
    assert.ok(!carried(o, partOf(o, k).from, partOf(o, k).to).some((e) => e.path === p), `part ${k}'s source carries the material of ${p}`);
  },
  // stops: the review stopped with stop after sessions sessions.
  stops(o, stop, sessions) {
    assert.equal(o.stop, stop, `the review ended ${o.stop || o.verdict}: ${o.detail}`);
    assert.equal(o.sessions, sessions, `the review started ${o.sessions} sessions, want ${sessions}`);
  },
  detail(o, want) {
    assert.equal(o.detail, want, 'the stop\'s detail differs');
  },
  findings(o, want) {
    assert.deepEqual(o.findings, want, 'the review\'s blocking findings differ');
  },
  // summarised: one sent part carries line, and neither the parts nor the retained source carry
  // the generated file's text (rows).
  summarised(o, line, row) {
    const sent = o.dynamic.filter((d) => d.includes(`${line}\n`)).length;
    assert.equal(sent, 1, `${sent} parts carry the line ${line}, want 1`);
    assert.equal(o.source.toString('utf8').split(`${line}\n`).length - 1, 1, 'the retained review source does not carry the line once');
    o.dynamic.forEach((d, i) => assert.ok(!d.includes(row), `part ${i + 1} carries "${row}" of the generated file`));
    assert.ok(!o.source.includes(row), `the retained review source carries "${row}" of the generated file`);
  },
  generated(o, want) {
    assert.ok(o.material, 'the review left no review material evidence');
    assert.deepEqual(o.material.generated, want, 'the review material does not record the generated files');
  },
  // sentBefore: every session was started with exactly the brief sent before this Intent: rows[i]
  // is {session, prompt, stable, dynamic}.
  sentBefore(o, rows) {
    assert.equal(o.stop, '', `the review stopped: ${o.stop}: ${o.detail}`);
    assert.equal(o.sessions, rows.length, `${o.sessions} sessions started, ${rows.length} before this Intent`);
    rows.forEach((row, i) => {
      const got = { session: i + 1, prompt: o.stable[i].length + o.dynamic[i].length, stable: sha(o.stable[i]), dynamic: sha(o.dynamic[i]) };
      assert.deepEqual(got, row, `session ${i + 1}'s prompt is not the one sent before this Intent`);
    });
  },
};

// ---- Observer controls. ----

// synthetic is a known-good observation of a review in three parts of a small source with four
// changed paths, in the per-part catalog form. opts mutate it before the texts are rendered.
function synthetic(opts = {}) {
  const big = Array.from({ length: 800 }, (_, i) => `big line ${String(i + 1).padStart(4, '0')} of a synthetic file\n`).join('');
  const contents = { 'a.txt': 'alpha\nALPHA\n', 'big.txt': big, 't1.txt': 'tiny 1\n', 't2.txt': 'tiny 2\n' };
  const catalog = [entry('a.txt', 'changed', contents['a.txt']), entry('big.txt', 'added', big), entry('t1.txt', 'added', contents['t1.txt']), entry('t2.txt', 'added', contents['t2.txt'])];
  const diff = 'diff --git a/a.txt b/a.txt\nindex 4a58007..a5c1b3d 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n alpha\n+ALPHA\n';
  const items = ['--- a.txt (changed; hunks in diff)', `--- big.txt (added; mode 100644)\n${big}`, '--- t1.txt (added; mode 100644)\ntiny 1\n', '--- t2.txt (added; mode 100644)\ntiny 2\n'];
  const checksText = 'acceptance: passed (0 scenarios)\nmodel: not applicable';
  const source = Buffer.from(`# Check results of the final pass\n\n${checksText}\n\n# Diff of existing/deleted paths against start HEAD 0123abcd\n\n${diff}\n${ADDED_INTRO}${items.join('\n')}\n`);
  const s = source.toString('utf8');
  const bigAt = s.indexOf('--- big.txt'), t1At = s.indexOf('--- t1.txt');
  const cuts = opts.cuts || [[0, bigAt], [bigAt, t1At], [t1At, source.length]];
  const carriedBy = opts.carriedBy || [[0], [1], [2, 3]];
  const run = '/tmp/synthetic-run';
  const file = path.join(run, 'executor-review', 'review-1-material.json');
  const stable = Buffer.from('authority\n# Review task\n');
  const o = { verdict: 'approve', stop: '', detail: '', lines: [], findings: [], sessions: 3, rounds: 3, feedback_bytes: 0, verified: 0, run, stable: [], dynamic: [], source,
    material: { review: 1, parts: catalog.map((e) => ({ ...e })), review_parts: [] } };
  cuts.forEach(([from, to], i) => {
    const list = carriedBy[i].map((j) => catalog[j]);
    const sectionText = `This review changes ${opts.total || 4} paths. The complete catalog of every changed path (path, status, origin, rename, mode, Git object, bytes and SHA-256) is retained in ${opts.file || file} under "parts"; read an entry there when this part does not carry it. The catalog entries of the ${list.length} paths whose material this part's source carries:\n${JSON.stringify(list)}`;
    const repaired = (opts.repaired && opts.repaired[i]) ? `${REPAIRED_HEAD}${opts.repaired[i]}\n\n` : '';
    const text = Buffer.concat([Buffer.from(`# Review part ${i + 1} of 3\n\nThis part carries bytes [${from}, ${to}) of the ${source.length} bytes of the candidate's complete review source (SHA-256 ${sha(source)}); the other parts carry the rest, in order.\n\n` +
      `# Check results of the final pass\n\n${checksText}\n\n# Every changed path\n\n${sectionText}\n\n${repaired}# Source part ${i + 1} of 3\n\n`), source.subarray(from, to)]);
    const st = (opts.stable && opts.stable[i]) || stable;
    o.stable.push(st);
    o.dynamic.push(text);
    o.material.review_parts.push({ part: i + 1, file: `review-1-part-${i + 1}.txt`, bytes: text.length, sha256: sha(text), from, to, prompt_bytes: st.length + text.length, session_id: `s${i + 1}`, delivered: true, delivered_round: 1 });
  });
  o.expected = catalog.map((e) => ({ ...e }));
  return o;
}

function acceptsParts(o) {
  judge.approves(o, 3);
  judge.linear(o);
  judge.digest(o);
  judge.sections(o, 4);
  judge.bound(o);
  judge.ceiling(o);
  judge.covers(o);
  judge.retained(o, o.expected);
}

function acceptsRepaired(o) {
  acceptsParts(o);
  judge.repaired(o, '["t2.txt"]');
  judge.notCarried(o, 1, 't2.txt');
}

const LINE = '--- data/table.csv (added; mode 100644; generated: 57836 bytes, SHA-256 ca6a61c86cfb1d2221f344d13502b3daf83f5ec8cd1b0eff46584266a60bf955; regenerated by `sh gen/table.sh` with identical output; full text in the checkout)';
const GENERATED = [{ path: 'data/table.csv', command: 'sh gen/table.sh', sha256: 'ca6a61c86cfb1d2221f344d13502b3daf83f5ec8cd1b0eff46584266a60bf955', outcome: 'summarised' }];

function syntheticGenerated(rows) {
  const source = Buffer.from(`head\n${LINE}\n${rows ? 'row 1234,value 1234\n' : ''}tail\n`);
  return { stop: '', sessions: 1, source, dynamic: [Buffer.concat([Buffer.from('# Review part 1 of 1\n\n'), source])], material: { generated: GENERATED.map((g) => ({ ...g })) } };
}

function acceptsGenerated(o) {
  judge.summarised(o, LINE, 'row 1234,value 1234');
  judge.generated(o, GENERATED);
}

const UNREAD = 'the review material of part 2 of 3 was not completely delivered in a completed round of the reviewer session; nothing was committed and custody is preserved';
const FINDINGS = [{ path: 'data/table.csv', line: 1, severity: 'blocking', message: 'generated file data/table.csv does not match the output of its regenerating command `sh gen/table.sh`: reviewed SHA-256 51240c73edfc6daa86da13e256c3fa06a9d48c32c87b3e944589acd528f4d5c0, regenerated SHA-256 ca6a61c86cfb1d2221f344d13502b3daf83f5ec8cd1b0eff46584266a60bf955' }];

function acceptsStops(o) {
  judge.stops(o.unread, 'candidate/context_custody_invalid', 2);
  judge.detail(o.unread, UNREAD);
  judge.stops(o.mismatch, 'candidate/review_blocked', 0);
  judge.findings(o.mismatch, FINDINGS);
}

function stopsGood() {
  return {
    unread: { stop: 'candidate/context_custody_invalid', sessions: 2, detail: UNREAD },
    mismatch: { stop: 'candidate/review_blocked', sessions: 0, findings: FINDINGS.map((f) => ({ ...f })) },
  };
}

function control(mode) {
  const goods = [
    () => acceptsParts(synthetic()),
    () => acceptsRepaired(synthetic({ repaired: ['', '["t2.txt"]', '["t2.txt"]'] })),
    () => acceptsGenerated(syntheticGenerated(false)),
    () => acceptsStops(stopsGood()),
  ];
  if (mode === 'good') {
    goods.forEach((g) => g());
    console.log('known-good observations accepted');
    return;
  }
  const bad = {
    'every part carries the full catalog': () => acceptsParts(synthetic({ carriedBy: [[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]] })),
    'a part without the entry of a path its source carries': () => acceptsParts(synthetic({ carriedBy: [[0], [], [2, 3]] })),
    'a part with the entry of a path outside its source': () => acceptsParts(synthetic({ carriedBy: [[0, 2], [1], [2, 3]] })),
    'entries out of catalog order': () => acceptsParts(synthetic({ carriedBy: [[0], [1], [3, 2]] })),
    'another retained catalog named': () => acceptsParts(synthetic({ file: '/tmp/elsewhere/review-1-material.json' })),
    'a wrong number of changed paths': () => acceptsParts(synthetic({ total: 5 })),
    'a part over its bound': () => judge.bound(synthetic({ repaired: ['', '', `["${'p'.repeat(FIXED)}"]`] })),
    'a part over its fixed bound': () => judge.digest(synthetic({ repaired: ['', '', `["${'p'.repeat(FIXED)}"]`] })),
    'another stable text for a part': () => judge.digest(synthetic({ stable: [null, Buffer.from('authority\n# Review task!\n'), null] })),
    'total input over twice the source': () => judge.linear(synthetic({ stable: [Buffer.alloc(30000, 'a'), Buffer.alloc(30000, 'a'), Buffer.alloc(30000, 'a')] })),
    'a source byte left out': () => { const o = synthetic(); const s = o.source.toString('utf8'); const t1 = s.indexOf('--- t1.txt'); return acceptsParts(synthetic({ cuts: [[0, s.indexOf('--- big.txt')], [s.indexOf('--- big.txt'), t1 - 1], [t1, o.source.length]] })); },
    'a part not delivered': () => { const o = synthetic(); o.material.review_parts[1].delivered = false; return judge.approves(o, 3); },
    'a prompt over the ceiling': () => { const o = synthetic(); o.stable[2] = Buffer.alloc(CEILING); o.material.review_parts[2].prompt_bytes = CEILING + o.dynamic[2].length; return judge.ceiling(o); },
    'a retained catalog without a path': () => { const o = synthetic(); o.expected.push(entry('t3.txt', 'added', 'tiny 3\n')); return acceptsParts(o); },
    'a retained entry with another digest': () => { const o = synthetic(); o.expected[3].sha256 = sha('other'); return acceptsParts(o); },
    'a later part without the repaired paths': () => acceptsRepaired(synthetic({ repaired: ['', '["t2.txt"]', ''] })),
    'the generated rows sent': () => acceptsGenerated(syntheticGenerated(true)),
    'the generated file not recorded': () => { const o = syntheticGenerated(false); o.material.generated = []; return acceptsGenerated(o); },
    'an unread part not named': () => { const o = stopsGood(); o.unread.detail = 'the review material was not completely delivered in a completed round of the reviewer session; nothing was committed and custody is preserved'; return acceptsStops(o); },
    'a mismatch after a session': () => { const o = stopsGood(); o.mismatch.sessions = 1; return acceptsStops(o); },
    'a mismatch finding with another digest': () => { const o = stopsGood(); o.mismatch.findings[0].message = o.mismatch.findings[0].message.replace('51240c73', '51240c74'); return acceptsStops(o); },
  };
  let rejected = 0;
  for (const [name, run] of Object.entries(bad)) {
    try {
      run();
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
      cwd: dir, encoding: 'utf8', env: isolated({ GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' }), maxBuffer: 1 << 28,
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

  const GEN = "mkdir -p data\n{\n  echo '# Code generated by sh gen/table.sh; DO NOT EDIT.'\n  i=1\n  while [ $i -le 3000 ]; do\n    echo \"row $i,value $i\"\n    i=$((i + 1))\n  done\n} > data/table.csv\n";
  function table(changedRow) {
    let s = '# Code generated by sh gen/table.sh; DO NOT EDIT.\n';
    for (let i = 1; i <= 3000; i++) s += i === changedRow ? `row ${i},value 9999\n` : `row ${i},value ${i}\n`;
    return s;
  }
  const lines = (n, tag) => Array.from({ length: n }, (_, i) => `${tag} ${String(i + 1).padStart(6, '0')} of the large file\n`).join('');

  // fixture makes the start commit (the approved Intent, a.txt, b.txt, c.txt and start's extra
  // files), then the saved candidate, the checkout's HEAD: a.txt changed, removed deleted and
  // added written. expected is the full catalog entry of every changed path.
  function fixture(start, added, removed = []) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wide-candidate-'));
    git(root, 'init', '-q', '-b', 'main');
    const startFiles = { ...intentFiles, 'a.txt': 'alpha\n', 'b.txt': 'beta\n', 'c.txt': 'gamma\n', ...start };
    write(root, startFiles);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'start');
    const commit = git(root, 'rev-parse', 'HEAD');
    const cand = { 'a.txt': 'alpha\nALPHA\n', ...added };
    for (const p of removed) fs.rmSync(path.join(root, p));
    write(root, cand);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'saved candidate');
    const expected = [entry('a.txt', 'changed', cand['a.txt'])];
    for (const [p, c] of Object.entries(added)) expected.push(entry(p, 'added', c));
    for (const p of removed) expected.push(entry(p, 'deleted', startFiles[p]));
    return { root, start: commit, expected };
  }

  const kinds = {
    small: () => fixture({}, {}),
    few: () => fixture({}, { 'big.txt': lines(44000, 'line') }),
    wide: (tiny) => {
      const added = {};
      for (let i = 1; i <= 6; i++) added[`big-${i}.txt`] = lines(9000, `big ${i} line`);
      for (let i = 1; i <= tiny; i++) added[`tiny/t-${String(i).padStart(4, '0')}.txt`] = `tiny ${String(i).padStart(4, '0')}\n`;
      return fixture({ 'd.txt': 'delta\n' }, added, ['d.txt']);
    },
    generated: (changedRow) => fixture({ 'gen/table.sh': GEN }, { 'data/table.csv': table(changedRow), 'big.txt': lines(44000, 'big line') }),
    readme: () => fixture({ 'README.md': 'a README line that every review prompt carries\n'.repeat(12000) }, {}),
  };

  function given(world, key, make) {
    world.kind = { key, make };
    world.plan = { parts: [] };
  }

  Given(prefix + 'a saved candidate that changes a.txt only', function () {
    given(this, 'small', () => kinds.small());
  });

  Given(prefix + 'a saved candidate that changes a.txt and adds a file of 44000 lines', function () {
    given(this, 'few', () => kinds.few());
  });

  Given(prefix + 'a saved candidate that changes a.txt, deletes d.txt and adds 6 files of 9000 lines and {int} tiny files', function (tiny) {
    given(this, `wide-${tiny}`, () => kinds.wide(tiny));
  });

  Given(prefix + 'a saved candidate that adds a file of 44000 lines and data\\/table.csv exactly as its generator gen\\/table.sh writes it', function () {
    given(this, 'generated', () => kinds.generated(0));
  });

  Given(prefix + 'a saved candidate that adds a file of 44000 lines and data\\/table.csv as gen\\/table.sh writes it but with row {int} changed', function (row) {
    given(this, `generated-${row}`, () => kinds.generated(row));
  });

  Given(prefix + 'a saved candidate whose start README.md has 12000 lines and that changes a.txt', function () {
    given(this, 'readme', () => kinds.readme());
  });

  function plan(world) {
    assert.ok(world.plan, 'make the saved candidate first');
    return world.plan;
  }

  const approve = () => JSON.parse('{"verdict":"approve","findings":[]}');

  function at(world, k, rounds) {
    const p = plan(world);
    while (p.parts.length < k) p.parts.push([]);
    p.parts[k - 1] = rounds;
  }

  Given(prefix + 'the reviewer of every part approves without repairs', function () {
    plan(this).parts = [];
  });

  Given(prefix + 'the reviewer of part {int} answers under another session\'s handle and approves', function (k) {
    at(this, k, [{ foreign: true, verdict: approve() }]);
  });

  Given(prefix + 'the reviewer of part {int} appends to the retained text of its part and approves', function (k) {
    at(this, k, [{ tamper: true, verdict: approve() }]);
  });

  Given(prefix + 'the reviewer of part {int} submits changes with the findings:', function (k, doc) {
    at(this, k, [{ verdict: { verdict: 'changes', findings: JSON.parse(doc) } }]);
  });

  // The doc string is a JSON object of path: content; the reviewer writes them and approves, is
  // told the repaired tree passed and approves it.
  Given(prefix + 'the reviewer of part {int} repairs the files:', function (k, doc) {
    at(this, k, [{ write: JSON.parse(doc), verdict: approve() }, { verdict: approve() }]);
  });

  let driver = null; // the one build of this process: {bin, status, output}

  // The driver is built in a copy of this checkout's files.
  function buildDriver() {
    if (!driver) {
      const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'wide-driver-src-'));
      const walk = (rel) => {
        for (const ent of fs.readdirSync(path.join(checkout, rel), { withFileTypes: true })) {
          const file = path.join(rel, ent.name);
          if (['.git', 'node_modules', path.join('.kogen', 'local')].includes(file)) continue;
          if (ent.isDirectory()) walk(file);
          else if (ent.isFile()) {
            fs.mkdirSync(path.join(copy, rel), { recursive: true });
            fs.copyFileSync(path.join(checkout, file), path.join(copy, file));
          }
        }
      };
      walk('');
      fs.mkdirSync(path.join(copy, 'internal', 'widedriver'), { recursive: true });
      fs.writeFileSync(path.join(copy, 'internal', 'widedriver', 'main.go'), require('./k-review-wide-change-cost-linear__driver.js'));
      const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wide-driver-bin-')), 'widedriver');
      const r = spawnSync('go', ['build', '-mod=readonly', '-buildvcs=false', '-o', bin, './internal/widedriver'], { cwd: copy, encoding: 'utf8', env: isolated({}) });
      driver = { bin, status: r.status, output: `${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
      fs.rmSync(copy, { recursive: true, force: true });
    }
    assert.equal(driver.status, 0, `go build ./internal/widedriver (the review driver in a copy of this checkout) exited ${driver.status}:\n${driver.output}`);
    return driver.bin;
  }

  // Reviews of a fixture without repairs are the same in every run: they are made once.
  const cache = new Map();

  function review(world) {
    assert.ok(world.kind, 'make the saved candidate first');
    const key = `${world.kind.key} ${JSON.stringify(plan(world))}`;
    const writes = plan(world).parts.some((rounds) => rounds.some((r) => r.write));
    if (!writes && cache.has(key)) return cache.get(key);
    const fx = world.kind.make();
    const bin = buildDriver();
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wide-driver-out-'));
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wide-driver-plan-')), 'plan.json');
    fs.writeFileSync(file, JSON.stringify(plan(world)));
    const r = spawnSync(bin, [], {
      cwd: out, encoding: 'utf8', timeout: 540000, maxBuffer: 1 << 26,
      env: isolated({ HOME: out, WIDE_ROOT: fx.root, WIDE_START: fx.start, WIDE_PLAN: file, WIDE_OUT: out }),
    });
    assert.equal(r.status, 0, `the review driver exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ''}:\n${r.stdout}${(r.stderr || '').slice(-4000)}${r.error || ''}`);
    const o = JSON.parse(fs.readFileSync(path.join(out, 'observation.json'), 'utf8'));
    const material = path.join(o.run, 'executor-review', 'review-1-material.json');
    o.material = fs.existsSync(material) ? JSON.parse(fs.readFileSync(material, 'utf8')) : null;
    o.source = o.material ? fs.readFileSync(path.join(o.run, 'executor-review', o.material.source.file)) : Buffer.alloc(0);
    o.stable = [];
    o.dynamic = [];
    for (let i = 1; i <= o.sessions; i++) {
      o.stable.push(fs.readFileSync(path.join(out, `stable-${i}.txt`)));
      o.dynamic.push(fs.readFileSync(path.join(out, `dynamic-${i}.txt`)));
    }
    o.expected = fx.expected;
    if (!writes) cache.set(key, o);
    return o;
  }

  When(prefix + 'the review runs', { timeout: 600000 }, function () {
    this.observed = review(this);
  });

  function observed(world) {
    assert.ok(world.observed, 'no review ran: use "the review runs" first');
    return world.observed;
  }

  Then(prefix + 'the review approves in at least {int} parts, each delivered in its own session', function (min) {
    judge.approves(observed(this), min);
  });

  Then(prefix + 'the review\'s total input is at most twice its review source', function () {
    judge.linear(observed(this));
  });

  Then(prefix + 'every part is sent the same stable text, and its text apart from its source slice and its catalog entries is at most 8192 bytes', function () {
    judge.digest(observed(this));
  });

  Then(prefix + 'the parts carry the whole review source once, in order', function () {
    judge.covers(observed(this));
  });

  Then(prefix + 'every part\'s measured prompt is at most 524288 bytes and is what its material evidence records', function () {
    judge.ceiling(observed(this));
  });

  Then(prefix + 'every sent part carries exactly the catalog entries of the paths whose material its source carries and names the retained catalog of {int} paths', function (total) {
    judge.sections(observed(this), total);
  });

  Then(prefix + 'every part\'s text apart from its source slice is at most 8192 bytes plus 600 bytes per catalog entry it carries', function () {
    judge.bound(observed(this));
  });

  Then(prefix + 'the retained review material lists every changed path with its full details', function () {
    const o = observed(this);
    judge.retained(o, o.expected);
  });

  Then(prefix + 'the review stops with {string} after {int} sessions', function (stop, n) {
    judge.stops(observed(this), stop, n);
  });

  Then(prefix + 'the stop\'s detail is:', function (doc) {
    judge.detail(observed(this), doc);
  });

  // In the doc string, <N> stands for the number of parts the review material records.
  Then(prefix + 'the stop\'s detail, with N the number of parts the review material records, is:', function (doc) {
    const o = observed(this);
    judge.detail(o, doc.replace('<N>', String(parts(o).length)));
  });

  Then(prefix + 'the review material records at least {int} parts', function (n) {
    const o = observed(this);
    assert.ok(parts(o).length >= n, `the review material records ${parts(o).length} parts, want at least ${n}`);
  });

  Then(prefix + 'the review\'s findings are:', function (doc) {
    judge.findings(observed(this), JSON.parse(doc));
  });

  Then(prefix + 'Kogen verified the candidate {int} time(s)', function (n) {
    assert.equal(observed(this).verified, n, `Kogen verified the candidate ${observed(this).verified} times, want ${n}`);
  });

  Then(prefix + 'part {int} does not carry the catalog entry of {string}', function (k, p) {
    judge.notCarried(observed(this), k, p);
  });

  Then(prefix + 'every part after the first lists the repaired paths {string}', function (line) {
    judge.repaired(observed(this), line);
  });

  Then(prefix + 'exactly one part carries, and no part carries {string} of the data file, the line:', function (row, doc) {
    judge.summarised(observed(this), doc, row);
  });

  Then(prefix + 'the review material records the generated files:', function (doc) {
    judge.generated(observed(this), JSON.parse(doc));
  });

  // The table has the columns session, prompt bytes, stable sha256 and dynamic sha256: what the
  // review sent each session before this Intent.
  Then(prefix + 'every session is sent exactly the prompt it was sent before this Intent:', function (table) {
    judge.sentBefore(observed(this), table.hashes().map((r) => ({ session: Number(r.session), prompt: Number(r['prompt bytes']), stable: r['stable sha256'], dynamic: r['dynamic sha256'] })));
  });

  Then(prefix + 'the checkout\'s cmd folder holds only {string}', function (name) {
    const got = fs.readdirSync(path.join(checkout, 'cmd')).sort();
    assert.deepEqual(got, [name], `the cmd folder holds ${JSON.stringify(got)}`);
  });

  // The flags are the first string argument of every flags.<Method>( call in the command's
  // non-test Go files.
  Then(prefix + 'kogen-review defines exactly the flags {string}', function (list) {
    const dir = path.join(checkout, 'cmd', 'kogen-review');
    const got = [];
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.go') && !f.endsWith('_test.go')).sort()) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of text.matchAll(/\bflags\.\w+\((?:[^"()]*,\s*)?"([^"]+)"/g)) got.push(m[1]);
    }
    assert.deepEqual(got.sort(), list.split(', ').sort(), `kogen-review defines the flags ${JSON.stringify(got)}`);
  });
}
