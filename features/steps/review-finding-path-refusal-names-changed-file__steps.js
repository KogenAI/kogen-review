// Steps of Intent review-finding-path-refusal-names-changed-file. A Go test file added with
// "go test -overlay" (so nothing is added to the checkout) builds the contract suite's review
// fixture, adds the listed changed files, and submits one blocking finding on the cited path to
// review.Validate (native route) and to review.NewExternal's review (external route, where the
// fake executor submits the same invalid verdict twice and the second round's feedback is read).
// It writes {native, feedback} as JSON; the Then steps compare it with the feature's values.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Given, When, Then } = require('@cucumber/cucumber');

const prefix = 'review-finding-path-refusal-names-changed-file: ';
const DRIVER = String.raw`package contract

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-review/review"
)

func TestKFPathRefusalDriver(t *testing.T) {
	var c struct {
		Changed []string
		Path    string
	}
	if err := json.Unmarshal([]byte(os.Getenv("KFP_CASE")), &c); err != nil {
		t.Fatal(err)
	}
	in, h := newReview(t)
	for _, f := range c.Changed {
		full := filepath.Join(in.Candidate.Root, filepath.FromSlash(f))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		writeFile(t, full, "changed\n")
	}
	tree, err := in.Candidate.Repo.Tree(in.Candidate.Start, nil)
	if err != nil {
		t.Fatal(err)
	}
	in.Candidate.Tree = tree
	in.Evidence.Pass.Tree = tree
	verdict := map[string]any{"verdict": "changes", "findings": []any{map[string]any{"path": c.Path, "line": 1, "severity": "blocking", "message": "m"}}}
	raw, err := json.Marshal(verdict)
	if err != nil {
		t.Fatal(err)
	}
	args := map[string]any{"verdict": "changes", "findings": []any{map[string]any{"path": c.Path, "line": json.Number("1"), "severity": "blocking", "message": "m"}}}
	_, problems, err := review.Validate(in, h, args, nil)
	if err != nil {
		t.Fatal(err)
	}
	x := &fakeExecutor{t: t, results: []executor.RoundResult{structured(string(raw)), structured(string(raw))}}
	_, _ = review.NewExternal(x, externalDescriptor(), 4).Review(context.Background(), in, h)
	feedback := ""
	if len(x.inputs) > 1 {
		feedback = x.inputs[1].Feedback
	}
	out, err := json.Marshal(map[string]any{"native": problems, "feedback": feedback})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("KFP_OUT"), out, 0o600); err != nil {
		t.Fatal(err)
	}
}
`;

const checkout = process.cwd();

Given(prefix + 'a candidate that changed the files:', function (table) {
  this.changed = table.raw().map((r) => r[0]);
});

When(prefix + 'the reviewer submits a blocking finding on the path {string}', { timeout: 300000 }, function (cited) {
  assert.ok(this.changed, 'name the changed files first');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kfpathrefusal-'));
  const source = path.join(tmp, 'driver_test.go');
  const overlay = path.join(tmp, 'overlay.json');
  const out = path.join(tmp, 'out.json');
  fs.writeFileSync(source, DRIVER);
  fs.writeFileSync(overlay, JSON.stringify({ Replace: { [path.join(checkout, 'contract', 'kfpathrefusal_driver_test.go')]: source } }));
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && !k.startsWith('KOGEN_ACCEPTANCE_')) env[k] = v;
  }
  const args = ['test', '-mod=readonly', '-buildvcs=false', '-overlay', overlay, '-count=1', '-run', '^TestKFPathRefusalDriver$', './contract'];
  const r = spawnSync('go', args, {
    cwd: checkout, encoding: 'utf8', timeout: 280000,
    env: { ...env, GOWORK: 'off', KFP_OUT: out, KFP_CASE: JSON.stringify({ changed: this.changed, path: cited }) },
  });
  assert.equal(r.status, 0, `go ${args.join(' ')} exited ${r.status}:\n${r.stdout || ''}${r.stderr || ''}${r.error || ''}`);
  assert.ok(fs.existsSync(out), `the driver test TestKFPathRefusalDriver did not run (no ${out}):\n${r.stdout}${r.stderr}`);
  this.observed = JSON.parse(fs.readFileSync(out, 'utf8'));
});

Then(prefix + 'the verdict is refused with the one problem {string}', function (problem) {
  assert.deepStrictEqual(this.observed.native, [problem], `native verdict problems: ${JSON.stringify(this.observed)}`);
});

Then(prefix + 'the external review feedback has the one problem {string}', function (problem) {
  assert.equal(this.observed.feedback, `Not a valid verdict: ${problem}. Submit a corrected structured verdict.`,
    `external feedback: ${JSON.stringify(this.observed)}`);
});
