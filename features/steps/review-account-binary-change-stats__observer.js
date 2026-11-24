'use strict';
const fs = require('node:fs');
const path = require('node:path');

function events(text) {
  return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
function verify(baseline, mutant, names) {
  const before = events(baseline);
  const after = events(mutant);
  for (const [pkg, tests] of Object.entries(names)) {
    const inPackage = e => e.Package === 'github.com/KogenAI/kogen-review/' + pkg;
    for (const test of tests) {
      for (const action of ['run', 'pass']) {
        if (before.filter(e => inPackage(e) && e.Test === test && e.Action === action).length !== 1) {
          throw new Error(`go test -json ./${pkg}: required ${test} did not ${action} exactly once; absent, skipped or unsuccessful test\n${baseline}`);
        }
      }
    }
    if (!before.some(e => inPackage(e) && !e.Test && e.Action === 'pass')) {
      throw new Error(`go test -json ./${pkg}: baseline package failed for required tests ${tests.join(', ')}\n${baseline}`);
    }
    if (!after.some(e => inPackage(e) && tests.includes(e.Test) && e.Action === 'fail') ||
        !after.some(e => inPackage(e) && !e.Test && e.Action === 'fail')) {
      throw new Error(`go test -json ./${pkg}: mutant survived required tests ${tests.join(', ')}; no scoped test failure\n${mutant}`);
    }
  }
}
module.exports = {verify};

if (require.main === module) {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../../.kogen/intents/review-account-binary-change-stats/observer-output.json'), 'utf8'));
  try {
    verify(fixture.baseline, process.argv[2] === 'good' ? fixture.mutant : fixture.baseline, fixture.names);
    console.log('observer accepted');
  } catch (error) {
    console.log('observer rejected');
    process.exitCode = 1;
  }
}
