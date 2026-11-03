'use strict';
// Applies the known-good edits of the Intent k-public-ready-review to a scratch copy of the
// checkout (observe.sh): README.md becomes good_README.md.txt and the internal notes and runner
// path of the earlier Intents are reworded. An edit whose old text is already gone is skipped,
// so the control also runs on a candidate. Mode bad also adds a README paragraph saying that
// issues and pull requests are disabled. The old texts are split so that this file holds none.
const fs = require('node:fs');
const path = require('node:path');

const [repo, mode] = process.argv.slice(2);
const edits = [
  ['.kogen/intents/k-review-cmd-entry/intent.md', ' (Build d' + '20bb309, never la' + 'nded on main)', ''],
  ['.kogen/intents/k-review-cmd-entry/intent.md', 'Scratch prototype on current ma' + 'in b40168c (outside', 'Scratch prototype (outside'],
  ['.kogen/intents/k-review-saved-candidate/intent.md', 'Build a' + 'a2d5da1\'s acceptance', 'an earlier attempt\'s acceptance'],
  ['.kogen/intents/k-review-saved-candidate/intent.md', '/Us' + 'ers/kogen-run' + 'ner/work.no' + 'index/gomodcache', '/synthetic/gomodcache'],
];
for (const [file, from, to] of edits) {
  const abs = path.join(repo, file);
  fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replaceAll(from, to));
}
let readme = fs.readFileSync(path.join(__dirname, 'good_README.md.txt'), 'utf8');
if (mode === 'bad') {
  const mark = '## License';
  if (!readme.includes(mark)) {
    console.log('good_README.md.txt has no License section');
    process.exit(3);
  }
  readme = readme.replace(mark, 'Issues and pull requests are disabled.\n\n' + mark);
}
fs.writeFileSync(path.join(repo, 'README.md'), readme);
