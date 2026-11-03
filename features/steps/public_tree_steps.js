'use strict';
const { Given, When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

// git runs without the caller's GIT_* variables, so a private index or Git dir of the caller
// does not change what the checkout is.
function gitEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
}

function run(cmd, args, cwd, env = process.env) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, output: (r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error) : '') };
}

// treeFiles lists the files of the tree as a public clone would get them once committed: the
// tracked files and the untracked files Git does not ignore, that exist in the checkout, sorted.
function treeFiles() {
  const r = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root, gitEnv());
  assert.equal(r.status, 0, `git ls-files --cached --others --exclude-standard exited ${r.status}:\n${r.output}`);
  const names = [...new Set(r.output.split('\0').filter(Boolean))];
  return names.filter((f) => fs.existsSync(path.join(root, f)) && fs.statSync(path.join(root, f)).isFile()).sort();
}

// textFiles maps each text file of the tree (no NUL byte) to its content.
function textFiles() {
  const out = new Map();
  for (const f of treeFiles()) {
    const buf = fs.readFileSync(path.join(root, f));
    if (buf.includes(0)) continue;
    out.set(f, buf.toString('utf8'));
  }
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function readme() {
  return fs.readFileSync(path.join(root, 'README.md'), 'utf8');
}

// shBlocks returns the lines of each ```sh fenced block of a Markdown text.
function shBlocks(text) {
  const blocks = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (current === null && /^```(sh|bash|shell)\s*$/.test(line)) current = [];
    else if (current !== null && /^```\s*$/.test(line)) { blocks.push(current); current = null; }
    else if (current !== null) current.push(line);
  }
  return blocks;
}

Then('the README links to Kogen at {string} or {string}', function (a, b) {
  const text = readme();
  const linked = (url) => text.includes(`](${url})`) || text.includes(`](${url}/)`) || text.includes(`<${url}>`);
  assert.ok(linked(a) || linked(b), `README.md has no Markdown link to ${a} or ${b}`);
});

Then('the README states {string} exactly once', function (literal) {
  const n = readme().split(literal).length - 1;
  assert.equal(n, 1, `README.md states ${literal} ${n} time(s), not exactly once`);
});

Then('the README mentions none of these words, in any letter case:', function (table) {
  const text = readme().toLowerCase();
  const found = table.raw().map(([w]) => w).filter((w) => text.includes(w.toLowerCase()))
    .map((w) => `${w} (README.md:${lineOf(text, text.indexOf(w.toLowerCase()))})`);
  assert.deepEqual(found, [], `README.md mentions: ${found.join(', ')}`);
});

Given('the README has a sh code block with the lines:', function (doc) {
  const want = doc.split('\n');
  const ok = shBlocks(readme()).some((b) => b.some((_, i) => want.every((w, j) => b[i + j] === w)));
  assert.ok(ok, `README.md has no \`\`\`sh code block with the consecutive lines:\n${doc}`);
});

When('the README command {string} runs in this checkout without private Go or Git settings', { timeout: 900000 }, function (command) {
  assert.ok(shBlocks(readme()).some((b) => b.includes(command)), `README.md has no \`\`\`sh code block with the line: ${command}`);
  const where = run('go', ['env', '-json', 'GOMODCACHE', 'GOCACHE', 'GOPATH', 'GOTOOLCHAIN'], root);
  assert.equal(where.status, 0, `go env -json exited ${where.status}:\n${where.output}`);
  const keep = JSON.parse(where.output);
  const env = gitEnv();
  // A public reader has no private-module, proxy, checksum or flag settings and no Git URL rewrites.
  for (const k of ['PRIVATE', 'NOPROXY', 'NOSUMDB', 'INSECURE', 'FLAGS', 'PROXY', 'SUMDB']) delete env['GO' + k];
  Object.assign(env, keep, { GOENV: 'off', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
  this.command = `${command} (in ${root}, GOENV=off, no private Go settings, no Git config)`;
  this.result = run('sh', ['-c', command], root, env);
});

Then('the command succeeds and the packages {string} and {string} pass their tests', function (a, b) {
  const r = this.result;
  assert.equal(r.status, 0, `${this.command} exited ${r.status}:\n${r.output}`);
  for (const pkg of [a, b]) {
    const re = new RegExp(`^ok\\s+${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`, 'm');
    assert.ok(re.test(r.output), `${this.command}: no "ok  ${pkg}" line, the package's tests did not pass:\n${r.output}`);
  }
});

Then('the tree has no file named {string}, {string} or {string} and no issue or pull request template', function (a, b, c) {
  const names = [a, b, c].map((n) => n.toLowerCase());
  const found = treeFiles().filter((f) => names.includes(path.posix.basename(f).toLowerCase())
    || /issue_template|pull_request_template/i.test(f));
  assert.deepEqual(found, [], `the tree has: ${found.join(', ')}`);
});

const urlPattern = /https?:\/\/[^\s<>"'`)\]\\]+/g;

Then('every URL in the tree starts with one of these public prefixes:', function (table) {
  const prefixes = table.raw().map(([p]) => p);
  const allowed = (url) => prefixes.some((p) => url === p || url === p + '.git'
    || (url.startsWith(p) && ['/', ':'].includes(url[p.length])));
  const bad = [];
  for (const [f, text] of textFiles()) {
    for (const m of text.matchAll(urlPattern)) {
      const url = m[0].replace(/[.,;:!?(]+$/, '');
      if (!allowed(url)) bad.push(`${f}:${lineOf(text, m.index)}: ${url}`);
    }
  }
  assert.deepEqual(bad, [], `URLs that are not public Kogen, Go or license links:\n${bad.join('\n')}`);
});

Then('every relative link of a Markdown file in the tree names a file or folder of the tree', function () {
  const bad = [];
  for (const [f, text] of textFiles()) {
    if (!f.endsWith('.md')) continue;
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
      const rel = target.split('#')[0];
      if (!fs.existsSync(path.join(root, path.dirname(f), rel))) bad.push(`${f}:${lineOf(text, m.index)}: ${target}`);
    }
  }
  assert.deepEqual(bad, [], `relative links that resolve to nothing in the tree:\n${bad.join('\n')}`);
});

Then('every email address in the tree is {string} or an address at {string}', function (contact, domain) {
  const bad = [];
  for (const [f, text] of textFiles()) {
    for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) {
      if (m[0] !== contact && !m[0].endsWith('@' + domain)) bad.push(`${f}:${lineOf(text, m.index)}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, [], `email addresses other than ${contact} and synthetic ones:\n${bad.join('\n')}`);
});

Then('no Markdown file of the tree outside {string} mentions, in any letter case:', function (skip, table) {
  const words = table.raw().map(([w]) => w.toLowerCase());
  const bad = [];
  for (const [f, text] of textFiles()) {
    if (!f.endsWith('.md') || f.startsWith(skip)) continue;
    const lower = text.toLowerCase();
    for (const w of words) if (lower.includes(w)) bad.push(`${f}:${lineOf(lower, lower.indexOf(w))}: ${w}`);
  }
  assert.deepEqual(bad, [], `Markdown that mentions contributions, pull requests or maintenance:\n${bad.join('\n')}`);
});

Then('no file of the tree except {string} matches any of these patterns:', function (except, table) {
  const patterns = table.hashes().map((r) => ({ kind: r.kind, re: new RegExp(r.pattern, 'g' + (r.flags || '')) }));
  const bad = [];
  for (const [f, text] of textFiles()) {
    if (f === except) continue;
    for (const { kind, re } of patterns) {
      for (const m of text.matchAll(re)) bad.push(`${f}:${lineOf(text, m.index)}: ${kind}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, [], `the tree still has:\n${bad.join('\n')}`);
});

// A listed path names a file or folder of the checkout; a listed "*<suffix>" names every file
// whose path ends with that suffix.
function listedMatcher(lines) {
  return (f) => lines.some((l) => (l.startsWith('*') ? f.endsWith(l.slice(1)) : f === l || f.startsWith(l + '/')));
}

Then('these paths are as committed at HEAD:', function (doc) {
  const lines = doc.split('\n').filter(Boolean);
  const listed = listedMatcher(lines);
  const tree = run('git', ['ls-tree', '-r', '-z', 'HEAD'], root, gitEnv());
  assert.equal(tree.status, 0, `git ls-tree -r HEAD exited ${tree.status}:\n${tree.output}`);
  const committed = new Map(tree.output.split('\0').filter(Boolean).map((entry) => {
    const [meta, file] = entry.split('\t');
    return [file, meta.split(' ')[2]];
  }).filter(([file]) => listed(file)));
  assert.ok(committed.size > 0, `HEAD holds none of the paths ${lines.join(', ')}`);
  const changes = [];
  for (const file of treeFiles().filter(listed)) {
    if (!committed.has(file)) {
      changes.push(`${file} (added)`);
      continue;
    }
    const hashed = run('git', ['hash-object', '--no-filters', '--', file], root, gitEnv());
    assert.equal(hashed.status, 0, `git hash-object ${file} exited ${hashed.status}:\n${hashed.output}`);
    if (hashed.output.trim() !== committed.get(file)) changes.push(`${file} (modified)`);
    committed.delete(file);
  }
  for (const file of committed.keys()) changes.push(`${file} (deleted)`);
  assert.deepEqual(changes, [], `changed since HEAD (${lines.join(', ')}): ${changes.join(', ')}`);
});
