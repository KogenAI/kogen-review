// Steps for the kogen-review command (cmd/kogen-review, Intent k-review-cmd-entry): they build the
// command from this checkout with go build, make a saved candidate in a temporary Git checkout (a
// start commit holding the approved Intent's files, and the candidate commit on it), serve
// scripted model answers from a loopback OpenAI-compatible fake and judge the command's exit
// code, stdout, stderr, the requests the fake received and the command's effects.
const { Given, When, Then, After } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const checkout = process.cwd();
const buildCommand = ['go', 'build', '-mod=readonly', '-buildvcs=false', '-o', '<bin>', './cmd/kogen-review'];
let built = null; // the one build of this process: {bin, status, output}

// A Git run in a fixture checkout, isolated from the caller's Git configuration.
function git(dir, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd: dir, encoding: 'utf8', env: isolated({}),
  });
  assert.equal(r.status, 0, `git ${args.join(' ')} in ${dir} exited ${r.status}:\n${r.stdout}${r.stderr}${r.error || ''}`);
  return r.stdout.trim();
}

// isolated is the caller's environment without GIT_* and KOGEN_* variables, with no global or
// system Git configuration, plus extra.
function isolated(extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && !k.startsWith('KOGEN_')) env[k] = v;
  }
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...extra };
}

// unescape reads a step's text as the body of a JSON string: \n, \t and \" are escapes.
function unescape(text) {
  return JSON.parse(`"${text}"`);
}

function ran(world) {
  assert.ok(world.result, 'kogen-review did not run: use "kogen-review runs with the arguments ..." first');
}

function described(world) {
  const r = world.result;
  return `kogen-review ${r.args.join(' ')} exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ''}${r.timedOut ? ' after the 100 s guard' : ''}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
}

function request(world, n) {
  assert.ok(world.requests, 'no fake model: use "a fake OpenAI-compatible model that answers in order:" first');
  assert.ok(n >= 1 && n <= world.requests.length, `request ${n}: the fake model received ${world.requests.length} requests`);
  return world.requests[n - 1];
}

function snapshot(dir) {
  return { head: git(dir, 'rev-parse', 'HEAD'), status: git(dir, 'status', '--porcelain=v1', '--untracked-files=all') };
}

After(async function () {
  if (this.server) await new Promise((resolve) => this.server.close(resolve));
});

Given('the kogen-review command is built from this repository with go build', { timeout: 300000 }, function () {
  if (!built) {
    const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-review-bin-')), 'kogen-review');
    const args = buildCommand.slice(1).map((a) => (a === '<bin>' ? bin : a));
    const r = spawnSync('go', args, { cwd: checkout, encoding: 'utf8' });
    built = { bin, status: r.status, output: `${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
  }
  assert.equal(built.status, 0, `${buildCommand.join(' ')} in ${checkout} exited ${built.status}:\n${built.output}`);
  this.bin = built.bin;
});

Given('a new Git checkout', function () {
  this.checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-review-checkout-'));
  git(this.checkout, 'init', '-q', '-b', 'main');
});

// The file gets the text of the step's doc string and a final newline.
Given('the checkout\'s file {string}:', function (file, text) {
  assert.ok(this.checkout, 'no checkout: use "a new Git checkout" first');
  fs.mkdirSync(path.dirname(path.join(this.checkout, file)), { recursive: true });
  fs.writeFileSync(path.join(this.checkout, file), `${text}\n`);
});

Given('the checkout\'s files are committed as the start commit', function () {
  git(this.checkout, 'add', '-A');
  git(this.checkout, 'commit', '-q', '-m', 'start');
  this.start = git(this.checkout, 'rev-parse', 'HEAD');
});

// The candidate commit is the checkout's HEAD; $CANDIDATE_TREE is its tree.
Given('the saved candidate commit changes {string} to {string}', function (file, text) {
  assert.ok(this.start, 'no start commit: use "the checkout\'s files are committed as the start commit" first');
  fs.writeFileSync(path.join(this.checkout, file), unescape(text));
  git(this.checkout, 'commit', '-q', '-am', 'saved candidate');
  this.candidateTree = git(this.checkout, 'rev-parse', 'HEAD^{tree}');
  this.before = snapshot(this.checkout);
});

// The fake answers each POST with the next answer of the list (the last one again once the list
// is spent): {"tool": name, "args": {...}} is one function call, {"text": "..."} a plain message.
Given('a fake OpenAI-compatible model that answers in order:', async function (doc) {
  const answers = JSON.parse(doc);
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { parsed = { unparsed: body }; }
      requests.push({ method: req.method, url: req.url, body: parsed });
      const n = requests.length;
      const a = answers[Math.min(n, answers.length) - 1];
      const message = a.tool
        ? { role: 'assistant', content: null, tool_calls: [{ id: `call-${n}`, type: 'function', function: { name: a.tool, arguments: JSON.stringify(a.args) } }] }
        : { role: 'assistant', content: a.text };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: `fake-${n}`, model: parsed && parsed.model, choices: [{ index: 0, message, finish_reason: a.tool ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  this.server = server;
  this.requests = requests;
  this.baseURL = `http://127.0.0.1:${server.address().port}/v1`;
});

// $CHECKOUT and $BASE_URL stand for the fixture's checkout and fake model.
When('kogen-review runs with the arguments {string}', { timeout: 120000 }, async function (line) {
  assert.ok(this.bin, 'the command is not built');
  const values = { $CHECKOUT: this.checkout, $BASE_URL: this.baseURL };
  const args = line.split(/\s+/).filter(Boolean).map((a) => {
    if (!(a in values)) return a;
    assert.ok(values[a], `${a} has no value: set up the fixture it names first`);
    return values[a];
  });
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-review-cwd-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-review-home-'));
  this.result = await new Promise((resolve) => {
    const child = spawn(this.bin, args, { cwd, env: isolated({ HOME: home }) });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const guard = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 100000);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status, signal) => {
      clearTimeout(guard);
      resolve({ args, status, signal, stdout, stderr, timedOut });
    });
  });
});

Then('the exit code is {int}', function (code) {
  ran(this);
  assert.equal(this.result.status, code, `exit code ${this.result.status}, want ${code}: ${described(this)}`);
});

// $CANDIDATE_TREE stands for the tree of the saved candidate; a "run" of "$RUN" accepts an
// existing absolute folder outside the checkout, which later steps read.
Then('stdout is one JSON line equal to:', function (doc) {
  ran(this);
  const out = this.result.stdout;
  assert.ok(out.endsWith('\n') && !out.slice(0, -1).includes('\n'), `stdout is not one line: ${described(this)}`);
  let actual;
  try { actual = JSON.parse(out); } catch (e) { assert.fail(`stdout is not JSON (${e.message}): ${described(this)}`); }
  const expected = JSON.parse(doc.split('$CANDIDATE_TREE').join(this.candidateTree));
  if (expected.run === '$RUN') {
    const run = actual && actual.run;
    assert.ok(typeof run === 'string' && path.isAbsolute(run) && fs.statSync(run, { throwIfNoEntry: false })?.isDirectory(),
      `"run" is not an existing absolute folder: ${described(this)}`);
    const rel = path.relative(this.checkout, run);
    assert.ok(rel.startsWith('..') || path.isAbsolute(rel), `"run" ${run} is inside the checkout ${this.checkout}`);
    expected.run = run;
    this.run = run;
  }
  assert.deepStrictEqual(actual, expected, `stdout differs from the expected result: ${described(this)}`);
});

Then('stdout is empty', function () {
  ran(this);
  assert.equal(this.result.stdout, '', `stdout is not empty: ${described(this)}`);
});

// $CHECKOUT in the line stands for the fixture's checkout.
Then('stderr has the line {string}', function (text) {
  ran(this);
  const line = text.split('$CHECKOUT').join(this.checkout);
  assert.ok(this.result.stderr.split('\n').includes(line), `stderr has no line ${JSON.stringify(line)}: ${described(this)}`);
});

Then('the fake model received {int} requests at {string} for the model {string} with the reasoning effort {string}', function (n, url, model, effort) {
  ran(this);
  const seen = this.requests.map((r) => ({ method: r.method, url: r.url, model: r.body.model, reasoning_effort: r.body.reasoning_effort }));
  assert.deepStrictEqual(seen, Array.from({ length: n }, () => ({ method: 'POST', url, model, reasoning_effort: effort })),
    `the fake model's requests differ: ${described(this)}`);
});

Then('request {int} offered the tools {string}', function (n, list) {
  const names = (request(this, n).body.tools || []).map((t) => t.function && t.function.name);
  assert.deepStrictEqual(names, list.split(',').map((s) => s.trim()), `request ${n} offered other tools`);
});

Then('the system message of request {int} begins with the text of {string}', function (n, file) {
  const first = (request(this, n).body.messages || [])[0] || {};
  const text = fs.readFileSync(path.join(checkout, file), 'utf8');
  assert.equal(first.role, 'system', `request ${n} does not begin with a system message`);
  assert.ok(typeof first.content === 'string' && first.content.startsWith(text), `the system message of request ${n} does not begin with ${file}`);
});

// The text is read as the body of a JSON string (\n is a newline).
Then('a message of request {int} contains {string}', function (n, text) {
  const messages = request(this, n).body.messages || [];
  const want = unescape(text);
  assert.ok(messages.some((m) => typeof m.content === 'string' && m.content.includes(want)),
    `no message of request ${n} contains ${JSON.stringify(want)}: ${JSON.stringify(messages.slice(1))}`);
});

Then('the last message of request {int} is the tool result {string}', function (n, text) {
  const messages = request(this, n).body.messages || [];
  const last = messages[messages.length - 1] || {};
  assert.deepStrictEqual({ role: last.role, content: last.content }, { role: 'tool', content: unescape(text) },
    `the last message of request ${n} is ${JSON.stringify(last)}`);
});

Then('request {int} required the tool {string}', function (n, name) {
  assert.deepStrictEqual(request(this, n).body.tool_choice, { type: 'function', function: { name } }, `request ${n} did not require ${name}`);
});

Then('the run folder holds {string} with the verdict {string}', function (file, verdict) {
  assert.ok(this.run, 'no run folder: check stdout with "stdout is one JSON line equal to:" first');
  const record = JSON.parse(fs.readFileSync(path.join(this.run, file), 'utf8'));
  assert.equal(record.verdict, verdict, `${file} in ${this.run}: ${JSON.stringify(record)}`);
});

Then('the checkout\'s HEAD, index and files are unchanged', function () {
  assert.deepStrictEqual(snapshot(this.checkout), this.before, 'the checkout changed');
});

Then('the checkout\'s HEAD is unchanged and its file {string} reads {string}', function (file, text) {
  assert.equal(git(this.checkout, 'rev-parse', 'HEAD'), this.before.head, 'the checkout\'s HEAD changed');
  assert.equal(fs.readFileSync(path.join(this.checkout, file), 'utf8'), unescape(text), `${file} in the checkout`);
});

Then('the packages of {string} include {string} and none of the modules {string} and {string}', { timeout: 120000 }, function (pkg, wanted, a, b) {
  const r = spawnSync('go', ['list', '-mod=readonly', '-deps', pkg], { cwd: checkout, encoding: 'utf8' });
  assert.equal(r.status, 0, `go list -mod=readonly -deps ${pkg} exited ${r.status}:\n${r.stdout}${r.stderr}${r.error || ''}`);
  const deps = r.stdout.split('\n').filter(Boolean);
  assert.ok(deps.includes(wanted), `go list -mod=readonly -deps ${pkg} lacks ${wanted}:\n${r.stdout}`);
  const foreign = deps.filter((d) => [a, b].some((m) => d === m || d.startsWith(`${m}/`)));
  assert.deepStrictEqual(foreign, [], `go list -mod=readonly -deps ${pkg} includes packages of ${a} or ${b}`);
});
