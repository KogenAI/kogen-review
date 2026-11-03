'use strict';
// Judges one run of `go test -count=1 -v -run ^<test>$ ./contract`: its exit status and its
// combined output. The named test must have run and passed; an exit status of 0 alone is not a
// pass (a filter that matches no test also exits 0, with "no tests to run").
//
// As a command: node executor_main_observer.cjs <test> <exit status> <output file>
// prints each problem on its own line and exits 1, or prints nothing and exits 0.

const fs = require('node:fs');

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// testProblems lists why the run is not a pass of the named test, each naming the test.
function testProblems(test, status, output) {
  const problems = [];
  if (status !== 0) problems.push(`${test}: go test exited ${status}`);
  if (!new RegExp(`^=== RUN +${escape(test)}$`, 'm').test(output)) problems.push(`${test}: it did not run`);
  else if (!new RegExp(`^--- PASS: ${escape(test)} \\(`, 'm').test(output)) problems.push(`${test}: it ran and did not pass`);
  return problems;
}

module.exports = { testProblems };

if (require.main === module) {
  const [test, status, file] = process.argv.slice(2);
  const problems = testProblems(test, Number(status), fs.readFileSync(file, 'utf8'));
  for (const p of problems) console.log(p);
  process.exit(problems.length === 0 ? 0 : 1);
}
