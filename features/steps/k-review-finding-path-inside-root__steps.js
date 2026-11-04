// Steps of Intent k-review-finding-path-inside-root: a finding's path is accepted only when it
// names a file inside the checkout root or a file of the start commit. The steps make a temporary
// Git checkout ("checkout") whose start commit holds the listed files, with the regular file
// outside.txt next to its root (in the same temporary folder, not inside the checkout), and call
// review.Validate, the submit_review validation kogen-build calls and the native and external
// reviewers run, through the driver below: a Go program built from this checkout with
// "go build -overlay", so no file is added to the checkout. The driver prints one JSON object
// {accepted, findings, problems}, which the judgments compare with the feature's values.
//
// "$KOGEN_NODE" <this file> --control good|bad checks the judgments against known-good
// observations and known-bad ones (today's acceptance of a path that climbs out of the root);
// Cucumber loads this file as step definitions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const prefix = 'k-review-finding-path-inside-root: ';
const MESSAGE = 'Check this line.';

// The driver: FPATH_ROOT is the checkout, FPATH_START its start commit and FPATH_ARGS the
// submit_review arguments (JSON, numbers kept as json.Number as the review decodes them). Every
// pinned part counts as read; review.Validate asks nothing else of the Env.
const DRIVER_DIR = 'internal/kfindingpathdriver';
const DRIVER = String.raw`// Command kfindingpathdriver calls review.Validate once on a submit_review call and prints what
// it returned (Intent k-review-finding-path-inside-root).
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-review/review"
)

// env is the review's Env: every pinned part is read.
type env struct{ review.Env }

func (env) Unread([]any) ([]string, error) { return nil, nil }

func main() {
	root, start := os.Getenv("FPATH_ROOT"), os.Getenv("FPATH_START")
	dec := json.NewDecoder(strings.NewReader(os.Getenv("FPATH_ARGS")))
	dec.UseNumber()
	var args map[string]any
	if err := dec.Decode(&args); err != nil {
		fmt.Fprintln(os.Stderr, "kfindingpathdriver: "+err.Error())
		os.Exit(1)
	}
	in := review.Input{Candidate: review.Candidate{Root: root, Repo: git.New(root, nil), Start: start}}
	verdict, problems, err := review.Validate(in, env{}, args, nil)
	if err != nil {
		fmt.Fprintln(os.Stderr, "kfindingpathdriver: "+err.Error())
		os.Exit(1)
	}
	out := map[string]any{"accepted": verdict != nil, "findings": nil, "problems": []string{}}
	if problems != nil {
		out["problems"] = problems
	}
	if verdict != nil {
		out["findings"] = verdict.Findings
	}
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		os.Exit(1)
	}
}
`;

// ---- Judgments: each compares the driver's observation with the feature's expected value. ----

const judge = {
  // accepted: the verdict is accepted and records exactly the one finding, with the clean path.
  accepted(o, severity, recorded) {
    assert.deepStrictEqual(o, { accepted: true, findings: [{ path: recorded, line: 1, severity, message: MESSAGE }], problems: [] },
      `the verdict is not accepted with the one finding on ${recorded}: ${JSON.stringify(o)}`);
  },
  // refused: the verdict is not accepted and the one problem is the expected text.
  refused(o, problem) {
    assert.deepStrictEqual(o, { accepted: false, findings: null, problems: [problem] },
      `the verdict is not refused with the one problem ${JSON.stringify(problem)}: ${JSON.stringify(o)}`);
  },
  // undisclosed: the driver's whole output holds no line of the outside file's content.
  undisclosed(output, content) {
    for (const line of content.split('\n').filter(Boolean)) {
      assert.ok(!output.includes(line), `the output discloses ${JSON.stringify(line)} of outside.txt: ${output}`);
    }
  },
};

// ---- Controls: the judgments accept known-good observations and reject known-bad ones. ----

function control(mode) {
  const finding = (p, severity) => ({ path: p, line: 1, severity, message: MESSAGE });
  const problem = '../outside.txt is not a file of the repository';
  const content = 'OUTSIDE-CONTENT-5c1e\n';
  const cases = [
    {
      check: (o) => judge.accepted(o, 'note', 'a.txt'),
      good: { accepted: true, findings: [finding('a.txt', 'note')], problems: [] },
      bad: [
        { accepted: true, findings: [finding('dir/../a.txt', 'note')], problems: [] },
        { accepted: false, findings: null, problems: ['dir/../a.txt is not a file of the repository'] },
        { accepted: true, findings: [finding('a.txt', 'blocking')], problems: [] },
        { accepted: true, findings: [], problems: [] },
      ],
    },
    {
      check: (o) => judge.refused(o, problem),
      good: { accepted: false, findings: null, problems: [problem] },
      bad: [
        { accepted: true, findings: [finding('../outside.txt', 'blocking')], problems: [] },
        { accepted: false, findings: null, problems: ['../outside.txt is outside the checkout'] },
        { accepted: false, findings: null, problems: [problem, 'a changes verdict needs at least one blocking finding'] },
        { accepted: false, findings: null, problems: [] },
      ],
    },
    {
      check: (o) => judge.undisclosed(o, content),
      good: JSON.stringify({ accepted: false, findings: null, problems: [problem] }) + '\n',
      bad: [JSON.stringify({ accepted: false, findings: null, problems: [problem + ': OUTSIDE-CONTENT-5c1e'] }) + '\n'],
    },
  ];
  for (const c of cases) {
    c.check(structuredClone(c.good));
    for (const bad of c.bad) {
      assert.throws(() => c.check(structuredClone(bad)), assert.AssertionError, `a control accepted ${JSON.stringify(bad)}`);
    }
  }
  if (mode === 'bad') {
    // Today's observation of a changes verdict with a blocking finding on ../outside.txt.
    const today = { accepted: true, findings: [finding('../outside.txt', 'blocking')], problems: [] };
    try {
      judge.refused(today, problem);
    } catch (e) {
      console.log('rejected the accepted finding on ../outside.txt');
      process.exitCode = 1;
      return;
    }
    throw new Error('the accepted finding on ../outside.txt was not rejected');
  }
  console.log('observer controls passed');
}

if (require.main === module) {
  assert.ok(process.argv[2] === '--control' && ['good', 'bad'].includes(process.argv[3]), 'usage: <this file> --control good|bad');
  control(process.argv[3]);
} else {
  steps();
}

// ---- The fixture and the driver. ----

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

  function git(dir, ...args) {
    const r = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
      cwd: dir, encoding: 'utf8', env: isolated({}),
    });
    assert.equal(r.status, 0, `git ${args.join(' ')} in ${dir} exited ${r.status}:\n${r.stdout}${r.stderr}${r.error || ''}`);
    return r.stdout.trim();
  }

  // The fixture folder holds the checkout ("checkout") and, next to it, outside.txt.
  Given(prefix + 'a Git checkout whose start commit has the files:', function (table) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kfindingpath-'));
    const root = path.join(base, 'checkout');
    fs.mkdirSync(root);
    git(root, 'init', '-q', '-b', 'main');
    for (const [file] of table.raw()) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), `${file} line 1\n`);
    }
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'start');
    this.fixture = { base, root, start: git(root, 'rev-parse', 'HEAD') };
  });

  Given(prefix + 'the file {string} is deleted from the checkout', function (file) {
    assert.ok(this.fixture, 'make the checkout first');
    fs.rmSync(path.join(this.fixture.root, file));
  });

  Given(prefix + 'the regular file {string} next to the checkout root holds {string}', function (file, text) {
    assert.ok(this.fixture, 'make the checkout first');
    const outside = path.join(this.fixture.base, file);
    fs.writeFileSync(outside, `${text}\n`);
    assert.ok(fs.lstatSync(outside).isFile(), `${outside} is not a regular file`);
    this.fixture.outside = { path: outside, content: `${text}\n` };
  });

  Given(prefix + 'the checkout has the untracked link {string} to {string}', function (link, target) {
    assert.ok(this.fixture && this.fixture.outside, 'make the checkout and the outside file first');
    fs.symlinkSync(target, path.join(this.fixture.root, link));
    assert.equal(fs.realpathSync(path.join(this.fixture.root, link)), fs.realpathSync(this.fixture.outside.path), `${link} does not resolve to the outside file`);
    assert.equal(git(this.fixture.root, 'status', '--porcelain', '--', link), `?? ${link}`, `${link} is not untracked`);
  });

  // $OUTSIDE is the absolute path of the outside file.
  function expand(text) {
    return this.fixture.outside ? text.split('$OUTSIDE').join(this.fixture.outside.path) : text;
  }

  let driver = null; // the one build of this process: {bin, status, output}

  function buildDriver() {
    if (!driver) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kfindingpath-driver-'));
      const source = path.join(tmp, 'main.go');
      const overlay = path.join(tmp, 'overlay.json');
      fs.writeFileSync(source, DRIVER);
      fs.writeFileSync(overlay, JSON.stringify({ Replace: { [path.join(checkout, DRIVER_DIR, 'main.go')]: source } }));
      const bin = path.join(tmp, 'kfindingpathdriver');
      const args = ['build', '-mod=readonly', '-buildvcs=false', '-overlay', overlay, '-o', bin, './' + DRIVER_DIR];
      const r = spawnSync('go', args, { cwd: checkout, encoding: 'utf8', timeout: 280000, env: isolated({ GOWORK: 'off', PWD: checkout }) });
      driver = { bin, status: r.status, output: `go ${args.join(' ')} exited ${r.status}:\n${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
    }
    assert.equal(driver.status, 0, driver.output);
    return driver.bin;
  }

  When(prefix + 'the reviewer submits the verdict {string} with a {string} finding on {string}', { timeout: 300000 }, function (verdict, severity, file) {
    assert.ok(this.fixture, 'make the checkout first');
    const bin = buildDriver();
    const args = { verdict, findings: [{ path: expand.call(this, file), line: 1, severity, message: MESSAGE }] };
    const r = spawnSync(bin, [], {
      cwd: this.fixture.base, encoding: 'utf8', timeout: 60000,
      env: isolated({ FPATH_ROOT: this.fixture.root, FPATH_START: this.fixture.start, FPATH_ARGS: JSON.stringify(args) }),
    });
    const output = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 0, `the driver exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ''} on ${JSON.stringify(args)}:\n${output}${r.error || ''}`);
    this.severity = severity;
    this.output = output;
    this.observed = JSON.parse(r.stdout);
  });

  Then(prefix + 'the verdict is accepted and records the finding path {string}', function (recorded) {
    judge.accepted(this.observed, this.severity, recorded);
  });

  Then(prefix + 'the verdict is refused with the one problem {string}', function (problem) {
    judge.refused(this.observed, expand.call(this, problem));
  });

  Then(prefix + 'the output does not contain the content of the outside file', function () {
    assert.ok(this.fixture.outside, 'make the outside file first');
    judge.undisclosed(this.output, this.fixture.outside.content);
  });
}
