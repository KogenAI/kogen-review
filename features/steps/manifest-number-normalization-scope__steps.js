'use strict';

const {execFileSync} = require('node:child_process');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const prefix = 'manifest-number-normalization-scope: ';
const marker = 'shared test support changed:';

function checkLine(source, expected) {
  const actual = source.split('\n').filter(line => line.startsWith(marker));
  if (actual.length !== expected.length || actual.some((line, i) => line !== expected[i])) {
    throw new Error(`support lines: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

if (require.main === module) {
  // Feasibility controls exercise the same assertion as both Then bindings.
  try {
    checkLine(readFileSync(0, 'utf8'), process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
} else {
  const {Given, When, Then} = require('@cucumber/cucumber');
  const root = path.join(__dirname, '..', '..');
  const options = {timeout: 110000};

  function materialSource(edits) {
    return execFileSync('go', ['run', './features/steps/manifest-number-normalization-scope__driver'], {
      cwd: root,
      input: JSON.stringify(edits.map(({manifest, before, after}) => ({manifest, before: before + '\n', after: after + '\n'}))),
      encoding: 'utf8',
      timeout: 100000,
    });
  }

  Given(prefix + 'the start commit contains this manifest at {string}:', function (manifest, before) {
    this.edit = {manifest, before};
  });

  When(prefix + 'review material is prepared after replacing only that manifest with:', options, function (after) {
    this.source = materialSource([{...this.edit, after}]);
  });

  When(prefix + 'review material is prepared for these non-version edits:', options, function (table) {
    this.source = materialSource(table.hashes());
  });

  Then(prefix + 'the source has exactly this shared test support line: {string}', function (line) {
    checkLine(this.source, [line]);
  });

  Then(prefix + 'the source has no shared test support line', function () {
    checkLine(this.source, []);
  });
}
