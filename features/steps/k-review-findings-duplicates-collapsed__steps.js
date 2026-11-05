// Steps of Intent k-review-findings-duplicates-collapsed: findings of a submitted verdict that
// have the same path, line, severity and message (the message compared after trimming
// whitespace) are kept once, in first-submitted order, and at most 50 blocking and 50 note
// findings are kept, with the dropped counts recorded on the verdict. The steps make a temporary
// Git checkout whose start commit holds the fixture file and call review.Validate, the
// submit_review validation kogen-build calls and the native and external reviewers run, through
// the driver below: a Go program built from this checkout with "go build -overlay", so no file is
// added to the checkout. The driver prints one JSON object {verdict, problems}: verdict is the
// returned *review.Verdict as JSON (null when refused), which the judgments compare with the
// feature's values.
//
// In a findings table a message cell that starts with a double quote is a JSON string, so that
// surrounding whitespace survives Gherkin's cell trimming: "  Missing check.\t" is the message
// with two leading spaces and a trailing tab.
//
// "$KOGEN_NODE" <this file> --control good|bad checks the judgments against known-good
// observations and known-bad ones (today's three kept copies of one blocking finding); Cucumber
// loads this file as step definitions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const prefix = 'k-review-findings-duplicates-collapsed: ';

// The driver: FDUP_ROOT is the checkout, FDUP_START its start commit and FDUP_ARGS the
// submit_review arguments (JSON, numbers kept as json.Number as the review decodes them). Every
// pinned part counts as read; review.Validate asks nothing else of the Env.
const DRIVER_DIR = 'internal/kfindingsdupdriver';
const DRIVER = String.raw`// Command kfindingsdupdriver calls review.Validate once on a submit_review call and prints the
// verdict it returned (Intent k-review-findings-duplicates-collapsed).
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
	root, start := os.Getenv("FDUP_ROOT"), os.Getenv("FDUP_START")
	dec := json.NewDecoder(strings.NewReader(os.Getenv("FDUP_ARGS")))
	dec.UseNumber()
	var args map[string]any
	if err := dec.Decode(&args); err != nil {
		fmt.Fprintln(os.Stderr, "kfindingsdupdriver: "+err.Error())
		os.Exit(1)
	}
	in := review.Input{Candidate: review.Candidate{Root: root, Repo: git.New(root, nil), Start: start}}
	verdict, problems, err := review.Validate(in, env{}, args, nil)
	if err != nil {
		fmt.Fprintln(os.Stderr, "kfindingsdupdriver: "+err.Error())
		os.Exit(1)
	}
	out := map[string]any{"verdict": verdict, "problems": []string{}}
	if problems != nil {
		out["problems"] = problems
	}
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		os.Exit(1)
	}
}
`;

// numbered are the findings 1 to n of a severity on a file of 3 lines: finding i is on line
// (i-1) mod 3 + 1 with the message "Finding <i>", so no two are equal.
function numbered(n, severity, file) {
  return Array.from({ length: n }, (_, i) => ({ path: file, line: (i % 3) + 1, severity, message: `Finding ${i + 1}` }));
}

// ---- Judgments: each compares the driver's observation with the feature's expected value. ----

const judge = {
  // accepted: the verdict is accepted and holds exactly the expected findings, in order.
  accepted(o, verdict, findings) {
    assert.deepStrictEqual(o.problems, [], `the verdict is refused: ${JSON.stringify(o.problems)}`);
    assert.ok(o.verdict, `no verdict was returned: ${JSON.stringify(o)}`);
    assert.equal(o.verdict.verdict, verdict, `the verdict is not ${verdict}: ${JSON.stringify(o.verdict.verdict)}`);
    assert.deepStrictEqual(o.verdict.findings, findings,
      `the accepted verdict has ${(o.verdict.findings || []).length} findings, not the expected ${findings.length}: ${JSON.stringify(o.verdict.findings)}`);
  },
  // undropped: the accepted verdict records no dropped findings (no "dropped" key).
  undropped(o) {
    assert.ok(o.verdict, `no verdict was returned: ${JSON.stringify(o)}`);
    assert.ok(!Object.hasOwn(o.verdict, 'dropped'), `the verdict records dropped findings: ${JSON.stringify(o.verdict.dropped)}`);
  },
  // dropped: the accepted verdict records the dropped counts of each severity.
  dropped(o, blocking, note) {
    assert.ok(o.verdict, `no verdict was returned: ${JSON.stringify(o)}`);
    assert.deepStrictEqual(o.verdict.dropped, { blocking, note },
      `the verdict does not record ${blocking} blocking and ${note} note findings dropped: ${JSON.stringify(o.verdict.dropped)}`);
  },
};

// ---- Controls: the judgments accept known-good observations and reject known-bad ones. ----

function control(mode) {
  const f = (line, severity, message) => ({ path: 'a.txt', line, severity, message });
  const one = f(2, 'blocking', 'Missing check.');
  const ok = (verdict, findings, extra) => ({ problems: [], verdict: { verdict, findings, ...extra } });
  const fifty = numbered(50, 'blocking', 'a.txt');
  const sixty = numbered(60, 'blocking', 'a.txt');
  const cases = [
    {
      check: (o) => judge.accepted(o, 'changes', [one]),
      good: ok('changes', [one]),
      bad: [
        ok('changes', [one, one, one]),
        ok('changes', [one, one]),
        ok('changes', []),
        ok('approve', [one]),
        ok('changes', [f(2, 'blocking', '  Missing check.\t')]),
        ok('changes', [f(3, 'blocking', 'Missing check.')]),
        { problems: ['a changes verdict needs at least one blocking finding'], verdict: null },
      ],
    },
    {
      check: (o) => judge.accepted(o, 'changes', [f(1, 'blocking', 'M'), f(1, 'note', 'M')]),
      good: ok('changes', [f(1, 'blocking', 'M'), f(1, 'note', 'M')]),
      bad: [
        ok('changes', [f(1, 'blocking', 'M')]),
        ok('changes', [f(1, 'note', 'M'), f(1, 'blocking', 'M')]),
      ],
    },
    {
      check: (o) => judge.accepted(o, 'changes', fifty),
      good: ok('changes', fifty, { dropped: { blocking: 10, note: 0 } }),
      bad: [ok('changes', sixty), ok('changes', sixty.slice(10)), ok('changes', fifty.slice(0, 49))],
    },
    {
      check: (o) => judge.undropped(o),
      good: ok('changes', fifty),
      bad: [ok('changes', fifty, { dropped: { blocking: 0, note: 0 } }), ok('changes', fifty, { dropped: { blocking: 10, note: 0 } })],
    },
    {
      check: (o) => judge.dropped(o, 10, 0),
      good: ok('changes', fifty, { dropped: { blocking: 10, note: 0 } }),
      bad: [
        ok('changes', fifty),
        ok('changes', fifty, { dropped: { blocking: 0, note: 10 } }),
        ok('changes', fifty, { dropped: { blocking: 10 } }),
        ok('changes', fifty, { dropped: 10 }),
      ],
    },
  ];
  for (const c of cases) {
    c.check(structuredClone(c.good));
    for (const bad of c.bad) {
      assert.throws(() => c.check(structuredClone(bad)), assert.AssertionError, `a control accepted ${JSON.stringify(bad)}`);
    }
  }
  if (mode === 'bad') {
    // Today's observation of a changes verdict with three copies of one blocking finding.
    const today = ok('changes', [one, one, one]);
    try {
      judge.accepted(today, 'changes', [one]);
    } catch (e) {
      console.log('rejected the three kept copies of one blocking finding');
      process.exitCode = 1;
      return;
    }
    throw new Error('the three kept copies of one blocking finding were not rejected');
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

  // The findings of a table with the columns path, line, severity and message.
  function findingsOf(table) {
    return table.hashes().map((row) => {
      assert.match(row.line, /^[0-9]+$/, `line ${JSON.stringify(row.line)} is not an integer`);
      return {
        path: row.path,
        line: Number(row.line),
        severity: row.severity,
        message: row.message.startsWith('"') ? JSON.parse(row.message) : row.message,
      };
    });
  }

  Given(prefix + 'a Git checkout whose start commit has the file {string} of {int} lines', function (file, lines) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kfindingsdup-'));
    git(root, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(root, file), Array.from({ length: lines }, (_, i) => `line ${i + 1}\n`).join(''));
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'start');
    this.fixture = { root, start: git(root, 'rev-parse', 'HEAD') };
  });

  let driver = null; // the one build of this process: {bin, status, output}

  function buildDriver() {
    if (!driver) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kfindingsdup-driver-'));
      const source = path.join(tmp, 'main.go');
      const overlay = path.join(tmp, 'overlay.json');
      fs.writeFileSync(source, DRIVER);
      fs.writeFileSync(overlay, JSON.stringify({ Replace: { [path.join(checkout, DRIVER_DIR, 'main.go')]: source } }));
      const bin = path.join(tmp, 'kfindingsdupdriver');
      const args = ['build', '-mod=readonly', '-buildvcs=false', '-overlay', overlay, '-o', bin, './' + DRIVER_DIR];
      const r = spawnSync('go', args, { cwd: checkout, encoding: 'utf8', timeout: 280000, env: isolated({ GOWORK: 'off', PWD: checkout }) });
      driver = { bin, status: r.status, output: `go ${args.join(' ')} exited ${r.status}:\n${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
    }
    assert.equal(driver.status, 0, driver.output);
    return driver.bin;
  }

  function submit(world, verdict, findings) {
    assert.ok(world.fixture, 'make the checkout first');
    const bin = buildDriver();
    const args = { verdict, findings };
    const r = spawnSync(bin, [], {
      cwd: world.fixture.root, encoding: 'utf8', timeout: 60000,
      env: isolated({ FDUP_ROOT: world.fixture.root, FDUP_START: world.fixture.start, FDUP_ARGS: JSON.stringify(args) }),
    });
    assert.equal(r.status, 0, `the driver exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ''} on ${JSON.stringify(args)}:\n${r.stdout}${r.stderr}${r.error || ''}`);
    world.observed = JSON.parse(r.stdout);
  }

  When(prefix + 'the reviewer submits the verdict {string} with the findings:', { timeout: 300000 }, function (verdict, table) {
    submit(this, verdict, findingsOf(table));
  });

  When(prefix + 'the reviewer submits the verdict {string} with {int} distinct {string} findings on {string}', { timeout: 300000 }, function (verdict, n, severity, file) {
    submit(this, verdict, numbered(n, severity, file));
  });

  Then(prefix + 'the verdict {string} is accepted with the findings:', function (verdict, table) {
    judge.accepted(this.observed, verdict, findingsOf(table));
  });

  Then(prefix + 'the verdict {string} is accepted with the {string} findings 1 to {int} on {string}', function (verdict, severity, n, file) {
    judge.accepted(this.observed, verdict, numbered(n, severity, file));
  });

  Then(prefix + 'the verdict records no dropped findings', function () {
    judge.undropped(this.observed);
  });

  Then(prefix + 'the verdict records {int} blocking and {int} note findings dropped', function (blocking, note) {
    judge.dropped(this.observed, blocking, note);
  });
}
