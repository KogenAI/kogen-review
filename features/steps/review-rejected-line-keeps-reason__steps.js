// Steps of Intent review-rejected-line-keeps-reason. The driver
// (review-rejected-line-keeps-reason__driver.js) is a Go test file written into a copy of this
// checkout; it calls the reviewer's real rejected-verdict allowance with one problem and prints
// the progress lines and recorded events. The test binary is built once per process.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Given, When, Then } = require('@cucumber/cucumber');

const prefix = 'review-rejected-line-keeps-reason: ';
const checkout = process.cwd();
const linePrefix = 'kogen: review 1: verdict not accepted: ';
const open = 'requirement "';

function isolated(extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && !k.startsWith('KOGEN_ACCEPTANCE_')) env[k] = v;
  }
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...extra };
}

let built = null;
function probeBinary() {
  if (!built) {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-probe-src-'));
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
    fs.writeFileSync(path.join(copy, 'review', 'zz_keepprobe_test.go'), require('./review-rejected-line-keeps-reason__driver.js'));
    const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'keep-probe-bin-')), 'review.test');
    const r = spawnSync('go', ['test', '-c', '-mod=readonly', '-buildvcs=false', '-o', bin, './review'], { cwd: copy, encoding: 'utf8', env: isolated({}) });
    built = { bin, dir: path.join(copy, 'review'), status: r.status, output: `${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
    process.on('exit', () => fs.rmSync(copy, { recursive: true, force: true }));
  }
  assert.equal(built.status, 0, `go test -c ./review exited ${built.status}:\n${built.output}`);
  return built;
}

function words(word, n) {
  const runes = [];
  while (runes.length < n) runes.push(...Array.from(word + ' '));
  const text = runes.slice(0, n).join('');
  assert.equal(Array.from(text).length, n);
  return text;
}

Given(prefix + 'a rejected verdict whose first problem quotes a requirement of {int} runes made of the word {string} repeated and separated by single spaces, followed by the reason {string}', function (n, word, reason) {
  this.statement = words(word, n);
  this.reason = reason;
  this.problem = open + this.statement + '" ' + reason;
});

Given(prefix + 'a rejected verdict whose first problem has {int} runes made of the word {string} repeated and separated by single spaces and quotes no requirement', function (n, word) {
  this.problem = words(word, n);
});

When(prefix + 'the reviewer records the rejected verdict', function () {
  const b = probeBinary();
  const r = spawnSync(b.bin, ['-test.run', '^TestKeepProbeRejectedVerdictLine$', '-test.v', '-test.count=1'], { cwd: b.dir, encoding: 'utf8', env: isolated({ KEEP_PROBLEM: this.problem }) });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  assert.equal(r.status, 0, `the probe test exited ${r.status}:\n${out}`);
  const line = out.split('\n').find((l) => l.startsWith('KEEPPROBE '));
  assert.ok(line, `the probe printed no KEEPPROBE line:\n${out}`);
  this.observed = JSON.parse(line.slice('KEEPPROBE '.length));
});

function shown(world) {
  const lines = world.observed.progress.filter((l) => l.startsWith('kogen: review 1: verdict not accepted'));
  assert.equal(lines.length, 1, `expected one rejected-verdict progress line, got ${JSON.stringify(world.observed.progress)}`);
  assert.ok(lines[0].startsWith(linePrefix), `unexpected line prefix: ${lines[0]}`);
  return lines[0].slice(linePrefix.length);
}

Then(prefix + 'the progress problem is the first {int} words of the requirement followed by " ...", then the whole reason', function (count) {
  const head = this.statement.split(' ').slice(0, count).join(' ') + ' ...';
  assert.equal(shown(this), open + head + '" ' + this.reason);
});

Then(prefix + 'the progress problem is only the cut marker " ..." for the requirement, then the whole reason', function () {
  assert.equal(shown(this), open + ' ...' + '" ' + this.reason);
});

Then(prefix + 'the progress problem is the whole problem', function () {
  assert.equal(shown(this), this.problem);
});

Then(prefix + 'the progress problem is the first {int} words of the problem followed by " ..."', function (count) {
  assert.equal(shown(this), this.problem.split(' ').slice(0, count).join(' ') + ' ...');
});

Then(prefix + 'the progress problem is within 160 runes', function () {
  const n = Array.from(shown(this)).length;
  assert.ok(n <= 160, `the progress problem has ${n} runes`);
});

Then(prefix + 'the progress problem is longer than 160 runes', function () {
  const n = Array.from(shown(this)).length;
  assert.ok(n > 160, `the progress problem has ${n} runes`);
});

Then(prefix + 'the recorded problem is the first 300 runes of the problem', function () {
  const events = this.observed.events.filter((e) => e.event === 'review_allowance');
  assert.equal(events.length, 1, `expected one review_allowance event, got ${JSON.stringify(this.observed.events)}`);
  assert.deepEqual(events[0].problems, [Array.from(this.problem).slice(0, 300).join('')]);
});
