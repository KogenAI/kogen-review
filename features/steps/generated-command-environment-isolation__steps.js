const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const slug = 'generated-command-environment-isolation';
const scenarioTest = 'TestAcceptanceGeneratedCommandEnvironment';
const fixture = path.join(__dirname, `${slug}__driver`, 'probe_test.go.txt');
const generated = 'review/generated.go';

function observe(name, want, patches = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-env-test-'));
  const command = `go test -json -count=1 -mod=readonly -buildvcs=false -overlay <temporary overlay> -run ^${name}$ ./review`;
  try {
    const replace = { [path.resolve('review/zz_acceptance_generated_environment_test.go')]: fixture };
    const env = { ...process.env, GOFLAGS: '-trimpath' };
    for (const k of Object.keys(env)) {
      if (k.startsWith('GIT_')) delete env[k];
    }
    Object.assign(env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
    if (patches.length !== 0) {
      // Feasibility controls only; normal acceptance never rewrites production bytes.
      const local = path.join(tmp, generated);
      fs.mkdirSync(path.dirname(local));
      fs.copyFileSync(generated, local);
      for (const patch of patches) {
        const r = spawnSync('git', ['apply', '--no-index', '-'], { cwd: tmp, env, input: patch, encoding: 'utf8', timeout: 5000 });
        assert.equal(r.status, 0, `${command}: control for ${name} failed to apply: ${r.error || r.stderr}`);
      }
      replace[path.resolve(generated)] = local;
    }
    const overlay = path.join(tmp, 'overlay.json');
    fs.writeFileSync(overlay, JSON.stringify({ Replace: replace }));
    const args = ['test', '-json', '-count=1', '-mod=readonly', '-buildvcs=false', '-overlay', overlay, '-run', `^${name}$`, './review'];
    if (want) args.push('-args', `-generated-environment-want=${want.join(',')}`);
    const r = spawnSync('go', args, { env, encoding: 'utf8', timeout: 90000, maxBuffer: 2 * 1024 * 1024 });
    assert.ifError(r.error && new Error(`${command}: ${name} could not complete: ${r.error}`));
    let events;
    try {
      events = r.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    } catch (e) {
      throw new Error(`${command}: invalid JSON for ${name}, exit ${r.status}: ${e.message}\n${r.stdout}\n${r.stderr}`);
    }
    const actions = events.filter((e) => e.Test === name && ['run', 'pass', 'skip', 'fail'].includes(e.Action)).map((e) => e.Action);
    const output = events.map((e) => e.Output || '').join('');
    assert.ok(r.status === 0 && actions.join(',') === 'run,pass',
      `${command}: required ${name} to run and pass once; exit ${r.status}, events ${actions.join(',') || 'none'}\n${r.stderr}${output}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  // Qualify the same observer against real go test output and isolated wrong behaviors.
  const controls = JSON.parse(fs.readFileSync(path.join('.kogen', 'intents', slug, 'controls.json'), 'utf8'));
  const want = ['kept', 'summarised', 'summarised'];
  const correct = controls.correct.files[generated].patch;
  if (process.argv[2] === '--good') {
    observe('TestRegenerationRunsATrackedExecutableScriptDirectly');
    observe(scenarioTest, want, [correct]);
    console.log('existing executable-generator test and all environment probe cases passed');
  } else if (process.argv[2] === '--bad') {
    const diagnostics = [
      'isolated.csv: generated outcome "kept", want "summarised"',
      'via-path.csv: generated outcome "kept", want "summarised"',
      'failed.csv: generated outcome "summarised", want "kept"',
      'fixture review did not approve in parts without findings: verdict "changes"',
    ];
    assert.equal(controls.wrong.length, diagnostics.length, `go test ./review: ${scenarioTest}: control cases do not cover the expected failures`);
    for (const [i, wrong] of controls.wrong.entries()) {
      assert.throws(() => observe(scenarioTest, want, [correct, wrong.files[generated].patch]),
        { name: 'AssertionError', message: new RegExp(`exit 1, events run,fail[\\s\\S]*${diagnostics[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) },
        `go test ./review: ${scenarioTest} must run and reject ${wrong.name} for ${diagnostics[i]}`);
    }
    console.log('rejected inherited environment, missing PATH, ignored command failure, and skipped regeneration');
    process.exitCode = 1;
  } else {
    throw new Error('expected --good or --bad for the observer control');
  }
} else {
  const { Then } = require('@cucumber/cucumber');
  Then(slug + ': a generator checking for a parent-only sentinel is {string}, a generator using an executable only on the parent\'s PATH is {string}, and a generator that writes matching bytes but exits unsuccessfully is {string}',
    { timeout: 100000 }, function (isolated, viaPath, failed) {
      observe(scenarioTest, [failed, isolated, viaPath]);
    });
}
