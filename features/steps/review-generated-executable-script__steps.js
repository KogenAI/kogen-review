// Steps of Intent review-generated-executable-script. A copy of this checkout gets a plausible wrong
// treatment of file permissions in the scratch copy that regenerate runs a marker command in, and the
// copy's own tests of the review package run. A suite that pins the behavior fails in that copy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Given, When, Then } = require('@cucumber/cucumber');

const prefix = 'review-generated-executable-script: ';
const checkout = process.cwd();

function isolated() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && !k.startsWith('KOGEN_ACCEPTANCE_')) env[k] = v;
  }
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
}

function copyCheckout() {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-exec-src-'));
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
  process.on('exit', () => fs.rmSync(copy, { recursive: true, force: true }));
  return copy;
}

// replaceOnce rewrites text so that exactly one occurrence of from becomes to.
function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, `review/generated.go does not contain exactly one ${JSON.stringify(from)}`);
  return text.replace(from, () => to);
}

// chmodScratch makes regenerate change the permission bits of every regular file of the extracted
// scratch copy (adding or removing the execute bits) just before it runs the marker command.
function chmodScratch(text, expression) {
  text = replaceOnce(text, '\t\t\tran := runRegenerate(ctx, dir, command)\n', '\t\t\tmutChmod(dir)\n\t\t\tran := runRegenerate(ctx, dir, command)\n');
  return text + `
func mutChmod(dir string) {
	filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err == nil && d.Type().IsRegular() {
			if info, err := d.Info(); err == nil {
				os.Chmod(p, ${expression})
			}
		}
		return nil
	})
}
`;
}

const mutations = {
  'unchanged': (text) => text,
  'the execute permission dropped': (text) => chmodScratch(text, 'info.Mode().Perm() &^ 0o111'),
  'execute permission granted to every file': (text) => chmodScratch(text, 'info.Mode().Perm() | 0o111'),
};

Given(prefix + 'a copy of the review package in which the scratch copy of a reviewed tree has {string}', function (wrong) {
  assert.ok(mutations[wrong], `no wrong behavior is named ${wrong}`);
  this.copy = copyCheckout();
  const file = path.join(this.copy, 'review', 'generated.go');
  fs.writeFileSync(file, mutations[wrong](fs.readFileSync(file, 'utf8')));
});

When(prefix + 'the tests of the review package run in that copy', function () {
  const r = spawnSync('go', ['test', '-count=1', '-mod=readonly', '-buildvcs=false', './review'], { cwd: this.copy, encoding: 'utf8', env: isolated(), timeout: 100000 });
  this.status = r.status;
  this.output = `${r.stdout || ''}${r.stderr || ''}${r.error || ''}`;
});

Then(prefix + 'a test of the review package fails', function () {
  assert.ok(!this.output.includes('[build failed]'), `the copy did not build:\n${this.output}`);
  assert.ok(this.output.includes('--- FAIL: Test'), `go test ./review reported no failing test (exit ${this.status}), so no test of the review package pins the behavior:\n${this.output}`);
  assert.notEqual(this.status, 0);
});

Then(prefix + 'every test of the review package passes', function () {
  assert.equal(this.status, 0, `go test ./review failed (exit ${this.status}):\n${this.output}`);
  assert.match(this.output, /^ok\s+\S+\/review\s/m, this.output);
});
