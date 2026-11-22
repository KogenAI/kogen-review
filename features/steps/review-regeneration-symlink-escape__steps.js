// Steps of Intent review-regeneration-symlink-escape. A copy of this checkout gets a probe test of
// extractTree (features/steps/review-regeneration-symlink-escape__driver/probe_test.go.txt) and the
// tests of the copy's review package run verbosely, probe included, against the copy's own
// review/generated.go. Another copy gets a plausible wrong extraction written over extractTree, and
// the copy's own tests of the review package run: a suite that pins the behavior fails there.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Given, When, Then } = require('@cucumber/cucumber');

const prefix = 'review-regeneration-symlink-escape: ';
const checkout = process.cwd();

function isolated() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && !k.startsWith('KOGEN_ACCEPTANCE_')) env[k] = v;
  }
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
}

function copyCheckout() {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'symlink-escape-src-'));
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

function goTest(copy, args) {
  const r = spawnSync('go', ['test', '-count=1', '-mod=readonly', '-buildvcs=false', ...args, './review'], { cwd: copy, encoding: 'utf8', env: isolated(), timeout: 100000, maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, output: `${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
}

const imports = `package review

import (
	"archive/tar"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

`;

// The extraction of the unchanged tree: the archive paths are checked lexically only.
const lexicalOnly = `// extractTree is a wrong extraction: a lexical path check only.
func extractTree(dir, archive string) error {
	tr := tar.NewReader(strings.NewReader(archive))
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		name := filepath.Join(dir, filepath.FromSlash(h.Name))
		if rel, err := filepath.Rel(dir, name); err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return fmt.Errorf("the archive of the reviewed tree names %q outside its folder", h.Name)
		}
		switch h.Typeflag {
		case tar.TypeDir:
			err = os.MkdirAll(name, 0o755)
		case tar.TypeReg:
			if err = os.MkdirAll(filepath.Dir(name), 0o755); err == nil {
				var data []byte
				if data, err = io.ReadAll(tr); err == nil {
					err = os.WriteFile(name, data, h.FileInfo().Mode().Perm())
				}
			}
		case tar.TypeSymlink:
			if err = os.MkdirAll(filepath.Dir(name), 0o755); err == nil {
				err = os.Symlink(h.Linkname, name)
			}
		}
		if err != nil {
			return err
		}
	}
}
`;

const wrongs = {
  'checking only lexical path traversal': lexicalOnly,
  'rejecting every symlink': lexicalOnly.replace(
    '\t\tswitch h.Typeflag {\n',
    '\t\tif h.Typeflag == tar.TypeSymlink {\n\t\t\treturn fmt.Errorf("the archive of the reviewed tree holds the symlink %q", h.Name)\n\t\t}\n\t\tswitch h.Typeflag {\n',
  ),
};

Given(prefix + 'a copy of the review package with the extraction probe test added', function () {
  this.copy = copyCheckout();
  fs.copyFileSync(
    path.join(checkout, 'features', 'steps', 'review-regeneration-symlink-escape__driver', 'probe_test.go.txt'),
    path.join(this.copy, 'review', 'zz_acceptance_probe_test.go'),
  );
});

When(prefix + 'the extraction probe test runs in that copy', function () {
  Object.assign(this, goTest(this.copy, ['-v']));
});

Then(prefix + 'the probe case {string} passes', function (name) {
  assert.ok(!this.output.includes('[build failed]'), `the copy did not build:\n${this.output}`);
  const test = name === 'ordinary entries' ? 'TestAcceptanceProbeOrdinaryEntries' : `TestAcceptanceProbeSymlinkEscape/${name.replaceAll(' ', '_')}`;
  const lines = this.output.split('\n').filter((l) => l.includes(test) || l.includes('FAIL'));
  assert.ok(this.output.includes(`--- PASS: ${test} `), `go test -v ./review (exit ${this.status}) did not pass ${test}; related lines:\n${lines.join('\n')}`);
});

Given(prefix + 'a copy of the review package whose extraction is {string}', function (wrong) {
  assert.ok(wrongs[wrong], `no wrong extraction is named ${wrong}`);
  this.copy = copyCheckout();
  const file = path.join(this.copy, 'review', 'generated.go');
  const text = fs.readFileSync(file, 'utf8');
  const from = 'func extractTree(dir, archive string) error {';
  assert.equal(text.split(from).length, 2, `review/generated.go does not contain exactly one ${JSON.stringify(from)}`);
  fs.writeFileSync(file, text.replace(from, () => 'func extractTreeReplaced(dir, archive string) error {'));
  fs.writeFileSync(path.join(this.copy, 'review', 'zz_wrong_extract.go'), imports + wrongs[wrong]);
});

When(prefix + 'the tests of the review package run in that copy', function () {
  Object.assign(this, goTest(this.copy, []));
});

Then(prefix + 'a test of the review package fails', function () {
  assert.ok(!this.output.includes('[build failed]'), `the copy did not build:\n${this.output}`);
  assert.ok(this.output.includes('--- FAIL: Test'), `go test ./review reported no failing test (exit ${this.status}), so no test of the review package pins the behavior:\n${this.output}`);
  assert.notEqual(this.status, 0);
});
