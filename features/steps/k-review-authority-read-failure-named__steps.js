// Steps of Intent k-review-authority-read-failure-named: the review's authority text names a model or README that exists
// but cannot be read. The step copies this checkout, adds a temporary Go test to the review
// package that builds the review material of a small Git fixture and writes its authority, and
// runs it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Given, When, Then } = require('@cucumber/cucumber');

const GOTEST = "package review\n\nimport (\n\t\"os\"\n\t\"path/filepath\"\n\t\"testing\"\n\n\tgitpkg \"github.com/KogenAI/kogen-coordinator/git\"\n\t\"github.com/KogenAI/kogen-executor/core\"\n\t\"github.com/KogenAI/kogen-verification/verify\"\n)\n\nfunc TestZZAuthorityProbe(t *testing.T) {\n\tmodel, readme := os.Getenv(\"AUTH_MODEL\"), os.Getenv(\"AUTH_README\")\n\tr := newEdgeRepo(t)\n\tr.write(\"README.md\", \"README body\\n\")\n\tr.write(\".kogen/intents/test/model.qnt\", \"MODEL\\n\")\n\tstart := r.commit(\"start\", nil)\n\tr.write(\"app.txt\", \"x\\n\")\n\tr.commit(\"candidate\", nil)\n\tswap := func(rel, how string) {\n\t\tp := filepath.Join(r.root, rel)\n\t\tswitch how {\n\t\tcase \"absent\":\n\t\t\tif err := os.Remove(p); err != nil {\n\t\t\t\tt.Fatal(err)\n\t\t\t}\n\t\tcase \"unreadable\":\n\t\t\tif err := os.Remove(p); err != nil {\n\t\t\t\tt.Fatal(err)\n\t\t\t}\n\t\t\tif err := os.Mkdir(p, 0755); err != nil {\n\t\t\t\tt.Fatal(err)\n\t\t\t}\n\t\t}\n\t}\n\tswap(\".kogen/intents/test/model.qnt\", model)\n\tswap(\"README.md\", readme)\n\ttree := r.git(\"rev-parse\", \"HEAD^{tree}\")\n\tc := Candidate{Root: r.root, Repo: gitpkg.New(r.root, nil), Start: start, Tree: tree, Protected: []string{\"README.md\"}}\n\tm, err := MaterialOf(Input{Candidate: c, Intent: Intent{Slug: \"test\"}, Evidence: Evidence{Pass: verify.Pass{Tree: tree, Green: true, Clean: true}}})\n\tif err != nil {\n\t\tt.Fatalf(\"the review material failed: %v\", err)\n\t}\n\t_ = core.HashHex\n\tif err := os.WriteFile(os.Getenv(\"AUTH_OUT\"), []byte(m.Authority), 0644); err != nil {\n\t\tt.Fatal(err)\n\t}\n}\n";
const unesc = (s) => s.replace(/\\n/g, '\n');
let authority;

Given('k-review-authority-read-failure-named: a fixture Intent with a feature, a model file and a protected README', function () {
  authority = undefined;
});

When('k-review-authority-read-failure-named: the review authority is built with the model file {word} and the README {word}', { timeout: 280000 }, function (model, readme) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-'));
  const root = path.join(dir, 'src');
  let r = spawnSync('cp', ['-a', process.cwd(), root], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'copying the checkout failed: ' + r.stderr);
  fs.writeFileSync(path.join(root, 'review', 'zz_authority_probe_test.go'), GOTEST);
  const out = path.join(dir, 'authority.txt');
  r = spawnSync('go', ['test', './review', '-run', '^TestZZAuthorityProbe$', '-count=1'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, AUTH_MODEL: model, AUTH_README: readme, AUTH_OUT: out },
  });
  assert.equal(r.status, 0, 'building the review material (model ' + model + ', README ' + readme + ') failed: ' + r.stdout + r.stderr);
  authority = fs.readFileSync(out, 'utf8');
});

Then('k-review-authority-read-failure-named: the authority contains {string}', function (s) {
  assert.ok(authority.includes(unesc(s)), 'the authority lacks ' + JSON.stringify(unesc(s)) + ': ' + JSON.stringify(authority.slice(0, 1500)));
});

Then('k-review-authority-read-failure-named: the authority does not contain {string}', function (s) {
  assert.ok(!authority.includes(unesc(s)), 'the authority has ' + JSON.stringify(unesc(s)) + ': ' + JSON.stringify(authority.slice(0, 1500)));
});
