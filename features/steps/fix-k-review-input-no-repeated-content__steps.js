'use strict';
// Mutation evidence for the review material's edge-case tests: each named break of
// review/material.go or review/parts.go, applied alone to a copy of the checkout, must make
// `go test -count=1 ./review` fail with a failing test, while the unchanged copy passes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');

const COMMAND = 'go test -count=1 ./review';
// At most this many copies run go test at once.
const PARALLEL = 4;

// Each break replaces one exact, unique line fragment of the unchanged production code.
const BREAKS = {
  'added file without final newline: hunk range': {
    file: 'review/material.go',
    from: String.raw`n := strings.Count(content, "\n")`,
    to: String.raw`n := strings.Count(content, "\n"); if n > 0 && !strings.HasSuffix(content, "\n") { n-- }`,
  },
  'added file without final newline: marker': {
    file: 'review/material.go',
    from: String.raw`rendered += "\n\\ No newline at end of file"`,
    to: String.raw`rendered += ""`,
  },
  'mode-only change': {
    file: 'review/material.go',
    from: 'diffs = append(diffs, d)',
    to: String.raw`if !strings.Contains(d, "\nold mode ") { diffs = append(diffs, d) }`,
  },
  'gitlink change': {
    file: 'review/material.go',
    from: 'parts = append(parts, heading+" (gitlink; change in diff)")',
    to: 'parts = append(parts, heading+"\\nSubproject commit "+entry.Object)',
  },
  'binary rename heading': {
    file: 'review/material.go',
    from: 'parts = append(parts, heading+" (binary)")',
    to: 'parts = append(parts, "--- "+p+" (binary)")',
  },
  'binary rename content class': {
    file: 'review/material.go',
    from: String.raw`case utf8.ValidString(content) && !strings.Contains(content, "\x00"):`,
    to: 'case utf8.ValidString(content):',
  },
  'later part byte reference': {
    file: 'review/parts.go',
    from: 'return reviewPartHeader(k, n, from, to, len(c.source)',
    to: 'return reviewPartHeader(k, n, 0, to, len(c.source)',
  },
  'deleted file accounting': {
    file: 'review/material.go',
    from: 'case open < 0:',
    to: 'case open < 0 || f["status"] == "deleted":',
  },
  'deleted file hunk': {
    file: 'review/material.go',
    from: 'diffs = append(diffs, d)',
    to: 'if _, there := current[p]; there { diffs = append(diffs, d) }',
  },
};

// Observer controls only: a break the existing rename test already catches, a break no test can
// catch (a comment) and a break that does not compile.
const CONTROLS = {
  caught: {file: 'review/material.go', from: 'if renames[p] {', to: 'if false && renames[p] {'},
  survives: {
    file: 'review/material.go',
    from: '// A gitlink has no content: its referenced commit id stands for it.',
    to: '// A gitlink has no content.',
  },
  uncompilable: {file: 'review/material.go', from: 'case open < 0:', to: 'case open < 0 ++:'},
};

function count(text, part) { return text.split(part).length - 1; }

// goTest runs COMMAND in a fresh copy of root with brk (or nothing) applied. A break whose
// fragment is not found exactly once resolves to {missing}.
function goTest(root, brk) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-no-repeat-'));
  const done = result => { fs.rmSync(temp, {recursive: true, force: true}); return result; };
  try {
    fs.cpSync(root, temp, {recursive: true, filter: p => !['.git', 'node_modules'].includes(path.basename(p))});
    if (brk) {
      const file = path.join(temp, brk.file);
      const text = fs.readFileSync(file, 'utf8');
      const n = count(text, brk.from);
      if (n !== 1) return Promise.resolve(done({missing: n}));
      fs.writeFileSync(file, text.replace(brk.from, brk.to));
    }
  } catch (e) {
    return Promise.resolve(done({error: e}));
  }
  return new Promise(resolve => {
    const child = spawn('go', ['test', '-count=1', './review'], {cwd: temp, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 100000);
    child.on('error', error => { clearTimeout(timer); resolve(done({error, output})); });
    child.on('close', (status, signal) => { clearTimeout(timer); resolve(done({status, signal, output})); });
  });
}

// runAll runs the named runs, PARALLEL at a time, and resolves to their results by name.
async function runAll(root, runs) {
  const names = Object.keys(runs);
  const results = {};
  let next = 0;
  const worker = async () => {
    while (next < names.length) {
      const name = names[next++];
      results[name] = await goTest(root, runs[name]);
    }
  };
  await Promise.all(Array.from({length: Math.min(PARALLEL, names.length)}, worker));
  return results;
}

function tail(output) { return (output || '').split('\n').slice(-40).join('\n'); }

// observeBaseline accepts only a passing run of the review package.
function observeBaseline(r) {
  assert.ok(!r.error && !r.signal, `${COMMAND} on the unchanged checkout did not finish: ${r.error || r.signal}`);
  assert.equal(r.status, 0, `${COMMAND} on the unchanged checkout failed (exit ${r.status}):\n${tail(r.output)}`);
  assert.match(r.output, /^ok\s+github\.com\/KogenAI\/kogen-review\/review\s/m, `${COMMAND} on the unchanged checkout reported no passing review package:\n${tail(r.output)}`);
}

// observeBroken accepts only a run that compiled and failed a test.
function observeBroken(name, brk, r) {
  const what = `with "${name}" broken (${brk.file}: ${JSON.stringify(brk.from)} -> ${JSON.stringify(brk.to)}), ${COMMAND}`;
  assert.ok(r.missing === undefined, `the unchanged production code must contain ${JSON.stringify(brk.from)} exactly once in ${brk.file}, found ${r.missing}: the fix adds tests and leaves production code unchanged`);
  assert.ok(!r.error && !r.signal, `${what} did not finish: ${r.error || r.signal}`);
  assert.notEqual(r.status, 0, `missing coverage: ${what} still passed (exit 0); add a test that fails on this break:\n${tail(r.output)}`);
  assert.ok(!/\[build failed\]|\[setup failed\]/.test(r.output), `broken fixture: ${what} did not compile (exit ${r.status}):\n${tail(r.output)}`);
  assert.match(r.output, /^\s*--- FAIL: /m, `${what} exited ${r.status} without a failing test:\n${tail(r.output)}`);
}

async function control(mode) {
  const root = process.cwd();
  if (mode === 'good') {
    const r = await runAll(root, {baseline: null, caught: CONTROLS.caught});
    observeBaseline(r.baseline);
    observeBroken('caught', CONTROLS.caught, r.caught);
    console.log('observer good');
    return;
  }
  const r = await runAll(root, {survives: CONTROLS.survives, uncompilable: CONTROLS.uncompilable});
  for (const name of ['survives', 'uncompilable']) {
    assert.throws(() => observeBroken(name, CONTROLS[name], r[name]), undefined, `the observer accepted the ${name} control`);
  }
  console.log('observer rejected surviving and uncompilable breaks');
  process.exitCode = 1;
}

if (require.main === module) {
  control(process.argv[2]).catch(e => { console.log(e.message); process.exitCode = 2; });
} else {
  const {Given, When, Then} = require('@cucumber/cucumber');
  // Every run of the feature is started once, together, and shared by its scenarios.
  let all;
  const results = () => (all = all || runAll(process.cwd(), {baseline: null, ...BREAKS}));
  Given('fix-k-review-input-no-repeated-content: go test passes for review on the unchanged checkout', {timeout: 110000}, async function () {
    observeBaseline((await results()).baseline);
  });
  When('fix-k-review-input-no-repeated-content: I break {string} in a copy of the checkout and run go test for review', {timeout: 110000}, async function (name) {
    assert.ok(Object.hasOwn(BREAKS, name), `unknown break ${JSON.stringify(name)}`);
    this.breakName = name;
    this.breakRun = (await results())[name];
  });
  Then('fix-k-review-input-no-repeated-content: a test fails on the break', function () {
    observeBroken(this.breakName, BREAKS[this.breakName], this.breakRun);
  });
}
