'use strict';
// Observer controls of the k-consumes-review acceptance: the consumes observer
// (k-consumes-review__observer.js) and the go test judgement (k-consumes-review__report.js).
// It defines no step and does nothing when the acceptance runner loads it.
//
//   node features/steps/k-consumes-review__control.js good|bad
//
// Both modes copy go.mod, go.sum, review/ and cmd/ of this checkout into a scratch tree whose
// consumes/<producer>/ folders hold the known-good fixtures of k-consumes-review__fixtures.js
// (refs_test.go, a reference of every use of kogen-review's code and no test, and README.md, its
// inventory). good runs the observer on that tree, and go test -race -count=1 -shuffle=on on this
// checkout's isolated contract/ suite under the hostile environment. bad first adds known defects
// to the scratch tree, then runs the observer and the same go test on its consumes suites, which
// have no test. It prints the observer's output and the go test problems ("go test: ok" without
// any). Exit 0: no problem; 1: problems; 3: the control could not be prepared.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const suites = [
  ['kogen-coordinator', 'github.com/KogenAI/kogen-coordinator'],
  ['kogen-executor', 'github.com/KogenAI/kogen-executor'],
  ['kogen-loop', 'kogen-loop'],
  ['kogen-verification', 'github.com/KogenAI/kogen-verification'],
];

function edit(file, from, to) {
  const text = fs.readFileSync(file, 'utf8');
  if (text.split(from).length !== 2) throw new Error(`${file} does not hold ${JSON.stringify(from)} once`);
  fs.writeFileSync(file, text.replace(from, to));
}

function main(mode) {
  const report = require('./k-consumes-review__report.js');
  const fixtures = require('./k-consumes-review__fixtures.js');
  const root = path.resolve(__dirname, '..', '..');
  if (mode !== 'good' && mode !== 'bad') throw new Error('usage: k-consumes-review__control.js good|bad');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'k-consumes-review-control-'));
  try {
    const tree = path.join(scratch, 'tree');
    fs.mkdirSync(tree);
    for (const f of ['go.mod', 'go.sum']) fs.copyFileSync(path.join(root, f), path.join(tree, f));
    for (const d of ['review', 'cmd']) fs.cpSync(path.join(root, d), path.join(tree, d), { recursive: true });
    for (const [s] of suites) {
      const dir = path.join(tree, 'consumes', s);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'refs_test.go'), fixtures.refsTest(s));
      fs.writeFileSync(path.join(dir, 'README.md'), fixtures.readme(s));
    }
    let tested = [root, ['-race', '-count=1', '-shuffle=on', './contract/'], ['github.com/KogenAI/kogen-review/contract']];
    if (mode === 'bad') {
      const c = path.join(tree, 'consumes');
      fs.writeFileSync(path.join(c, 'kogen-coordinator', 'isolation_test.go'),
        'package consumes\n\nimport (\n\t"net/http"\n\n\t"github.com/KogenAI/kogen-review/review"\n)\n\nvar _ = http.MethodGet\nvar _ = review.ToolNames\n');
      edit(path.join(c, 'kogen-executor', 'README.md'), '| `core.HashHex` | refs_test.go |\n', '| `core.Tokens.Line` | refs_test.go |\n');
      edit(path.join(c, 'kogen-loop', 'refs_test.go'), 'var _ = (*tools.Output).Cut\n', '');
      edit(path.join(c, 'kogen-loop', 'README.md'), '| `sys.Fail` | refs_test.go |\n', '| `sys.Fail` | refs_test.go |\n| `sys.Fail` | refs_test.go |\n');
      fs.writeFileSync(path.join(c, 'kogen-verification', 'helper.go'), 'package consumes\n');
      tested = [tree, ['-race', '-count=1', '-shuffle=on', './consumes/...'], suites.map(([s]) => `github.com/KogenAI/kogen-review/consumes/${s}`)];
    }
    const observed = report.observe(tree, suites);
    process.stdout.write(observed.output);
    const problems = report.testProblems(report.goTest(tested[0], tested[1], true), tested[2]);
    process.stdout.write(problems.length ? problems.map((p) => `go test: ${p}\n`).join('') : 'go test: ok\n');
    return observed.status === 0 && problems.length === 0 ? 0 : 1;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv[2]);
  } catch (e) {
    console.log(String(e && e.message ? e.message : e));
    process.exitCode = 3;
  }
}
