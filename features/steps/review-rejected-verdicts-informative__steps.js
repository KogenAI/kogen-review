// Steps of Intent review-rejected-verdicts-informative. Each step runs one focused observation
// in a copy of this checkout: a Go test file written into the copy (so it sees the review
// package's own texts and the contract suite's fake Env and fake executor) runs one review with
// scripted verdicts, or reads the reviewer's rule texts, and writes what it observed as JSON.
// The steps compare that observation with the expected values of the feature. The test files are
// the acceptance harness only; they are not the tests the implementation adds.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Given, When, Then } = require('@cucumber/cucumber');

const prefix = 'review-rejected-verdicts-informative: ';
const checkout = process.cwd();
const shownPrefix = 'kogen: review 1: verdict not accepted';

// The Go test of the review package: it writes the four rule texts. It is in package review so it
// reads the unexported external task constants.
const rulesTest = String.raw`package review

import (
	"encoding/json"
	"os"
	"testing"
)

func TestInformativeAcceptanceRuleTexts(t *testing.T) {
	data, err := json.Marshal(map[string]string{
		"rule": RequirementsRule, "native": ReviewerInstructions(), "single": reviewTask, "parts": reviewPartsTask,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("INFORMATIVE_OUT"), data, 0o600); err != nil {
		t.Fatal(err)
	}
}
`;

// The Go test of the contract package: it runs one review on the route in INFORMATIVE_ROUTE
// (external or native) with the scripted verdicts of INFORMATIVE_VERDICTS (a JSON list of verdict
// objects, one per model round) and writes the progress lines that start with the rejected
// verdict prefix, and the review's error text.
const progressTest = String.raw`package contract

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-review/review"
)

func TestInformativeAcceptanceProgress(t *testing.T) {
	var verdicts []json.RawMessage
	if err := json.Unmarshal([]byte(os.Getenv("INFORMATIVE_VERDICTS")), &verdicts); err != nil {
		t.Fatal(err)
	}
	in, h := newReview(t)
	var err error
	switch os.Getenv("INFORMATIVE_ROUTE") {
	case "external":
		x := &fakeExecutor{t: t}
		for _, v := range verdicts {
			x.results = append(x.results, executor.RoundResult{Ending: executor.EndFinish, Structured: v})
		}
		_, err = review.NewExternal(x, externalDescriptor(), 4).Review(context.Background(), in, h)
	case "native":
		var answers []*provider.Response
		for _, v := range verdicts {
			answers = append(answers, submitReview(string(v)))
		}
		h.answers = answers
		_, err = review.Independent{}.Review(context.Background(), in, h)
	default:
		t.Fatal("INFORMATIVE_ROUTE must be external or native")
	}
	shown := []string{}
	for _, line := range h.progress {
		if strings.HasPrefix(line, "kogen: review 1: verdict not accepted") {
			shown = append(shown, line)
		}
	}
	stop := ""
	if err != nil {
		stop = err.Error()
	}
	data, _ := json.Marshal(map[string]any{"shown": shown, "stop": stop})
	if werr := os.WriteFile(os.Getenv("INFORMATIVE_OUT"), data, 0o600); werr != nil {
		t.Fatal(werr)
	}
}
`;

function isolated(extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && !k.startsWith('KOGEN_ACCEPTANCE_')) env[k] = v;
  }
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...extra };
}

// copyCheckout copies the checkout (without .git, node_modules and local run state) to a new directory.
function copyCheckout() {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'informative-src-'));
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
  return copy;
}

// observe writes the test file into a copy, runs the named test of the package and returns the
// parsed observation.
function observe(pkg, file, source, name, env) {
  const copy = copyCheckout();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'informative-out-'));
  const out = path.join(work, 'observation.json');
  try {
    fs.writeFileSync(path.join(copy, pkg, file), source);
    const r = spawnSync('go', ['test', '-mod=readonly', '-count=1', '-run', `^${name}$`, `./${pkg}`], {
      cwd: copy, encoding: 'utf8', env: isolated({ ...env, INFORMATIVE_OUT: out }), timeout: 110000,
    });
    const output = `${r.stdout || ''}${r.stderr || ''}${r.error || ''}`;
    assert.equal(r.status, 0, `go test ./${pkg} -run ^${name}$ exited ${r.status}:\n${output}`);
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function count(text, part) {
  return part === '' ? 0 : text.split(part).length - 1;
}

Given(prefix + 'the reviewer texts are read', { timeout: 120000 }, function () {
  this.texts = observe('review', 'zz_informative_acceptance_test.go', rulesTest, 'TestInformativeAcceptanceRuleTexts', {});
});

Then(prefix + 'RequirementsRule contains {string}', function (clause) {
  assert.ok(this.texts.rule.includes(clause), `RequirementsRule does not contain ${JSON.stringify(clause)}:\n${this.texts.rule}`);
});

Then(prefix + 'RequirementsRule no longer contains {string}', function (clause) {
  assert.ok(!this.texts.rule.includes(clause), `RequirementsRule still contains ${JSON.stringify(clause)}:\n${this.texts.rule}`);
});

for (const [label, key] of [['the native reviewer instructions', 'native'], ['the external one-session review task', 'single'], ['the external part task', 'parts']]) {
  Then(prefix + `${label} contain(s) {string} exactly once`, function (clause) {
    const n = count(this.texts[key], clause);
    assert.equal(n, 1, `${label} carry ${JSON.stringify(clause)} ${n} times, want 1`);
  });
}

Given(prefix + 'the reviewer submits these verdicts, one per round:', function (doc) {
  this.verdicts = JSON.parse(doc);
  assert.ok(Array.isArray(this.verdicts) && this.verdicts.length > 0, 'the verdicts are a nonempty JSON list');
});

When(prefix + 'the {word} review runs on a saved candidate', { timeout: 120000 }, function (route) {
  assert.ok(this.verdicts, 'give the verdicts first');
  this.progress = observe('contract', 'zz_informative_acceptance_test.go', progressTest, 'TestInformativeAcceptanceProgress', {
    INFORMATIVE_ROUTE: route, INFORMATIVE_VERDICTS: JSON.stringify(this.verdicts),
  });
});

function rejectedLines(world) {
  assert.ok(world.progress, 'run the review first');
  for (const line of world.progress.shown) assert.ok(line.startsWith(shownPrefix), line);
  return world.progress.shown;
}

Then(prefix + 'the rejected-verdict progress line is exactly {string}', function (line) {
  assert.deepStrictEqual(rejectedLines(this), [line], `progress lines starting with "${shownPrefix}" differ (review stop: ${this.progress.stop})`);
});

Then(prefix + 'the rejected-verdict progress lines are exactly {string} twice', function (line) {
  assert.deepStrictEqual(rejectedLines(this), [line, line], `progress lines starting with "${shownPrefix}" differ (review stop: ${this.progress.stop})`);
});
