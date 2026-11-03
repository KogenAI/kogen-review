'use strict';
// Judges one run of the contract tests (the test binary of ./contract run with Go's test log,
// -test.testlogfile): what the binary printed and the files it opened. The test log has a
// "# test log" header and one line per operation; `open <path>` is every file the tests opened.
//
// As a command: node saved_candidate_observer.cjs <test log> <output file> <GOMODCACHE>
// prints each problem on its own line and exits 1, or prints nothing and exits 0.

const fs = require('node:fs');

// opened lists the paths of the test log's `open` lines, in order.
function opened(testlog) {
  return testlog.split('\n').filter((line) => line.startsWith('open ')).map((line) => line.slice('open '.length));
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// passProblems: the binary reported PASS and no failed test.
function passProblems(output) {
  const problems = [];
  if (!/^PASS$/m.test(output)) problems.push('the contract tests did not report PASS');
  if (/^(--- FAIL|FAIL)\b/m.test(output)) problems.push('the contract tests reported a failure');
  return problems;
}

// savedStateProblems: a test opened <checkout>/.kogen/local/runs/<id>/checkpoint.json and, after
// that, a review record review-<n>.json of the same run folder.
function savedStateProblems(testlog) {
  if (!testlog.startsWith('# test log\n')) return ['the file is not a Go test log: it lacks the "# test log" header'];
  const paths = opened(testlog);
  const runs = [];
  paths.forEach((p, i) => {
    const m = /^(.*\/\.kogen\/local\/runs\/[^/]+)\/checkpoint\.json$/.exec(p);
    if (m && !runs.some((r) => r.dir === m[1])) runs.push({ dir: m[1], first: i });
  });
  if (runs.length === 0) {
    return ['no saved state was read: the contract tests opened no <checkout>/.kogen/local/runs/<id>/checkpoint.json'];
  }
  const recorded = runs.some((r) => {
    const record = new RegExp('^' + escape(r.dir) + '/review-[0-9]+\\.json$');
    return paths.slice(r.first + 1).some((p) => record.test(p));
  });
  if (!recorded) {
    return ['a saved state was read (' + runs.map((r) => r.dir + '/checkpoint.json').join(', ') +
      ') but no review recorded its verdict (review-<n>.json) in that run folder afterwards'];
  }
  return [];
}

// foreignProblems: no test opened a file of the Go module cache or a state golden (a path with
// /testdata/state/).
function foreignProblems(testlog, modcache) {
  const prefix = modcache.replace(/\/+$/, '') + '/';
  const foreign = opened(testlog).filter((p) => (modcache !== '' && p.startsWith(prefix)) || p.includes('/testdata/state/'));
  if (foreign.length > 0) {
    return ['the contract tests opened files outside their own checkouts: ' + foreign.join(', ')];
  }
  return [];
}

module.exports = { opened, passProblems, savedStateProblems, foreignProblems };

if (require.main === module) {
  const [testlogPath, outputPath, modcache] = process.argv.slice(2);
  if (testlogPath === undefined || outputPath === undefined || modcache === undefined) {
    process.stdout.write('usage: saved_candidate_observer.cjs <test log> <output file> <GOMODCACHE>\n');
    process.exit(2);
  }
  const testlog = fs.readFileSync(testlogPath, 'utf8');
  const output = fs.readFileSync(outputPath, 'utf8');
  const problems = [...passProblems(output), ...savedStateProblems(testlog), ...foreignProblems(testlog, modcache)];
  for (const p of problems) process.stdout.write(p + '\n');
  process.exit(problems.length > 0 ? 1 : 0);
}
