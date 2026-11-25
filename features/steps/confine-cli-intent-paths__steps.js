'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const prefix = 'confine-cli-intent-paths: ';
const authority = '.kogen/intents/tiny';
const intent = '# Tiny\n\nSlug: tiny\nModel: not applicable — simple\nAcceptance:\n- ' + authority + '/acceptance.feature\n';
const feature = 'Feature: Tiny\n';
const config = 'version: 1\ncommands:\n  setup:\n    - \'echo started > "$HOME/verification-started"; exit 9\'\n  fix: []\n  checks: []\n';

function scratch() {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'review-paths-'));
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', ...options });
}

function checked(command, args, options) {
  const r = run(command, args, options);
  assert.ifError(r.error);
  assert.equal(r.status, 0, `${command} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function build(dir) {
  const bin = path.join(dir, 'kogen-review');
  checked('go', ['build', '-o', bin, './cmd/kogen-review'], { timeout: 100000 });
  return bin;
}

function fixture(dir, kind) {
  const root = path.join(dir, 'checkout');
  const outside = path.join(dir, 'checkout-outside'); // Shares the checkout's textual prefix.
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GIT_|KOGEN_)/.test(key)));
  Object.assign(env, { HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' });
  const write = (name, text) => {
    fs.mkdirSync(path.dirname(name), { recursive: true });
    fs.writeFileSync(name, text);
  };
  const inDir = path.join(root, authority);
  write(path.join(inDir, 'intent.md'), intent);
  write(path.join(inDir, 'acceptance.feature'), feature);
  write(path.join(root, '.kogen/project.yaml'), config);
  let slug = 'tiny';
  let cliRoot = root;
  let target;
  const substitute = (name, link) => {
    fs.unlinkSync(path.join(inDir, name));
    fs.symlinkSync(link, path.join(inDir, name));
  };
  switch (kind) {
    case 'traversal':
    case 'parent link':
      target = path.join(outside, 'intent.md');
      write(target, intent);
      write(path.join(outside, 'acceptance.feature'), feature);
      if (kind === 'traversal') {
        slug = '../../../checkout-outside';
      } else {
        fs.rmSync(inDir, { recursive: true });
        fs.symlinkSync(outside, inDir);
      }
      break;
    case 'intent link':
    case 'feature link': {
      const name = kind === 'intent link' ? 'intent.md' : 'acceptance.feature';
      target = path.join(outside, name);
      write(target, kind === 'intent link' ? intent : feature);
      substitute(name, target);
      break;
    }
    case 'inside links':
      write(path.join(root, 'approved.md'), intent);
      write(path.join(root, 'approved.feature'), feature);
      substitute('intent.md', '../../../approved.md');
      substitute('acceptance.feature', path.join(root, 'approved.feature'));
      cliRoot = path.join(dir, 'checkout-alias');
      fs.symlinkSync(root, cliRoot);
      break;
    case 'missing': // Known-good refusal for the observer, independent of this change.
      slug = 'missing';
      break;
    case 'ordinary':
      break;
    default:
      assert.fail(`unknown fixture ${kind}`);
  }
  const git = (...args) => checked('git', args, { cwd: root, env });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'start');
  return { root: cliRoot, home, env, slug, target, start: git('rev-parse', 'HEAD') };
}

function invoke(bin, f) {
  const tmp = fs.mkdtempSync(path.join(f.home, 'tmp-'));
  const marker = path.join(f.home, 'verification-started');
  fs.rmSync(marker, { force: true });
  const r = run(bin, ['-root', f.root, '-start', f.start, '-slug', f.slug, '-model', 'test'], {
    cwd: f.root, env: { ...f.env, TMPDIR: tmp },
  });
  return { ...r, started: fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '', tmp, runs: fs.readdirSync(tmp) };
}

function refused(r, label) {
  if (r.error?.code === 'ETIMEDOUT') assert.fail(`${label}: the command blocked with an outside FIFO and no writer (read attempted before refusal)`);
  assert.ifError(r.error);
  assert.equal(r.status, 2, `${label}: expected exit 2; stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`);
  assert.equal(r.stdout, '', `${label}: refusal wrote stdout`);
  assert.match(r.stderr, /^kogen-review: [^\r\n]+\n$/, `${label}: expected one refusal on stderr`);
  assert.equal(r.started, '', `${label}: verification setup ran`);
  assert.deepEqual(r.runs, [], `${label}: the command created run artifacts`);
}

function verified(r) {
  assert.ifError(r.error);
  assert.equal(r.status, 1, `expected the setup failure, not a refusal; stderr=${r.stderr}`);
  assert.equal(r.started, 'started\n', 'the configured setup did not run');
  assert.match(r.stdout, /^[^\r\n]+\n$/, 'expected one result line');
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out).sort(), ['error', 'findings', 'invalid', 'repairs', 'run', 'submitted', 'tree', 'verdict']);
  assert.equal(out.verdict, 'error');
  assert.equal(out.error.class, 'verification');
  assert.equal(out.error.reason, 'failed');
  assert.equal(out.submitted, null);
  assert.ok(path.isAbsolute(out.run) && path.dirname(out.run) === r.tmp, 'expected a retained run directory');
  const record = JSON.parse(fs.readFileSync(path.join(out.run, 'initial-verification.json'), 'utf8'));
  assert.equal(record.state, 'failed');
  assert.deepEqual(record.pass.setup.map(({ name, status }) => [name, status]), [['setup-1', 9]]);
}

if (require.main !== module) {
  const { After, Given, When, Then } = require('@cucumber/cucumber');
  After(function () {
    if (this.reviewPathsDir) fs.rmSync(this.reviewPathsDir, { recursive: true, force: true });
  });
  Given(prefix + 'a checkout with a(n) {string} authority path', function (kind) {
    this.reviewPathsDir = scratch();
    this.bin = build(this.reviewPathsDir);
    this.fixture = fixture(this.reviewPathsDir, kind);
  });
  When(prefix + 'the review command runs against that checkout', function () {
    this.regular = invoke(this.bin, this.fixture);
    if (this.fixture.target) {
      fs.unlinkSync(this.fixture.target);
      checked('mkfifo', [this.fixture.target]);
      this.fifo = invoke(this.bin, this.fixture);
    }
  });
  Then(prefix + 'the command exits 2 with empty stdout before any outside authority read or verification', function () {
    refused(this.fifo, 'outside FIFO');
    refused(this.regular, 'outside regular file');
  });
  Then(prefix + 'the command runs the configured setup and reports its verification failure as before', function () {
    verified(this.regular);
  });
} else {
  const mode = process.argv[2];
  assert.ok(mode === 'good' || mode === 'bad');
  const dir = scratch();
  try {
    const bin = build(dir);
    const make = (kind) => fixture(fs.mkdtempSync(path.join(dir, 'fixture-')), kind);
    const refusal = invoke(bin, make('missing'));
    const result = invoke(bin, make('ordinary'));
    refused(refusal, 'missing (control)');
    verified(result);
    if (mode === 'good') {
      console.log('observer accepted refusal and verification evidence');
    } else {
      const fifo = path.join(dir, 'no-writer');
      checked('mkfifo', [fifo]);
      const blocked = run(process.execPath, ['-e', 'require("node:fs").readFileSync(process.argv[1])', fifo], { timeout: 1000 });
      assert.equal(blocked.error?.code, 'ETIMEDOUT', 'FIFO control must really block');
      assert.throws(() => refused(blocked, 'control'), /read attempted before refusal/);
      assert.throws(() => refused({ ...refusal, stdout: 'unexpected\n' }, 'control'), /refusal wrote stdout/);
      assert.throws(() => refused({ ...refusal, started: 'started\n' }, 'control'), /setup ran/);
      assert.throws(() => refused({ ...refusal, runs: ['unexpected'] }, 'control'), /created run artifacts/);
      assert.throws(() => verified({ ...result, started: '' }), /setup did not run/);
      const report = path.join(JSON.parse(result.stdout).run, 'initial-verification.json');
      const record = JSON.parse(fs.readFileSync(report, 'utf8'));
      record.pass.setup[0].status = 0;
      fs.writeFileSync(report, JSON.stringify(record));
      assert.throws(() => verified(result), { code: 'ERR_ASSERTION' });
      console.log('observer rejected blocked reads and invalid refusal or verification evidence');
      process.exitCode = 1;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
