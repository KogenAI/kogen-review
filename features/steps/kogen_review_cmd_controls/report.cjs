// Summarizes a Cucumber message report for observe.sh: the scenario counts, then each distinct
// failing step text once, in sorted order.
const fs = require('node:fs');

const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const stepText = new Map();
const caseSteps = new Map();
const started = new Map();
const failedCases = new Set();
const failedSteps = new Set();
let cases = 0;
for (const m of lines) {
  if (m.pickle) for (const s of m.pickle.steps) stepText.set(s.id, s.text);
  if (m.testCase) for (const s of m.testCase.testSteps) caseSteps.set(s.id, s.pickleStepId);
  if (m.testCaseStarted) { started.set(m.testCaseStarted.id, m.testCaseStarted.testCaseId); cases++; }
  if (m.testStepFinished && m.testStepFinished.testStepResult.status !== 'PASSED' && m.testStepFinished.testStepResult.status !== 'SKIPPED') {
    failedCases.add(m.testStepFinished.testCaseStartedId);
    const pickleStep = caseSteps.get(m.testStepFinished.testStepId);
    failedSteps.add(`${m.testStepFinished.testStepResult.status}: ${pickleStep ? stepText.get(pickleStep) : 'a hook'}`);
  }
}
console.log(`scenarios: ${cases - failedCases.size} passed, ${failedCases.size} failed`);
for (const s of [...failedSteps].sort()) console.log(`failed step: ${s}`);
