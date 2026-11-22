// Steps of Intent review-generated-marker-command-parsing. A Go test file is written into a copy
// of this checkout; it calls the real generatedMarkerOf on a file whose path comes from the
// environment and prints one result line. The test binary is built once per process.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Given, When, Then } = require('@cucumber/cucumber');

const prefix = 'review-generated-marker-command-parsing: ';
const checkout = process.cwd();
const resultTag = 'MARKER_RESULT ';

const driver = `package review

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

func TestZZMarkerProbe(t *testing.T) {
	b, err := os.ReadFile(os.Getenv("KOGEN_MARKER_FILE"))
	if err != nil {
		t.Fatal(err)
	}
	command, line, ok := generatedMarkerOf(string(b))
	out, _ := json.Marshal(map[string]any{"command": command, "line": line, "ok": ok})
	fmt.Println("${resultTag}" + string(out))
}
`;

function isolated(extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && !k.startsWith('KOGEN_ACCEPTANCE_')) env[k] = v;
  }
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...extra };
}

let built = null;
function probeBinary() {
  if (!built) {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-probe-src-'));
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
    fs.writeFileSync(path.join(copy, 'review', 'zz_markerprobe_test.go'), driver);
    const bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'marker-probe-bin-')), 'review.test');
    const r = spawnSync('go', ['test', '-c', '-mod=readonly', '-buildvcs=false', '-o', bin, './review'], { cwd: copy, encoding: 'utf8', env: isolated({}) });
    built = { bin, dir: path.join(copy, 'review'), status: r.status, output: `${r.stdout || ''}${r.stderr || ''}${r.error || ''}` };
    process.on('exit', () => fs.rmSync(copy, { recursive: true, force: true }));
  }
  assert.equal(built.status, 0, `go test -c ./review exited ${built.status}:\n${built.output}`);
  return built;
}

Given(prefix + 'a generated file over 6000 bytes whose marker is on line {int} and reads {string}', function (line, marker) {
  const lines = Array(line - 1).fill('x');
  lines.push(marker);
  this.content = lines.join('\n') + '\n' + 'row\n'.repeat(2000);
  assert.ok(Buffer.byteLength(this.content) > 6000, 'the generated file is not over 6000 bytes');
});

When(prefix + 'the generated marker of that file is parsed', function () {
  const b = probeBinary();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'marker-probe-in-')), 'generated.txt');
  fs.writeFileSync(file, this.content);
  const r = spawnSync(b.bin, ['-test.run', '^TestZZMarkerProbe$'], { cwd: b.dir, encoding: 'utf8', env: isolated({ KOGEN_MARKER_FILE: file }) });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const hit = out.split('\n').find((l) => l.startsWith(resultTag));
  assert.ok(hit, `the probe printed no result (exit ${r.status}):\n${out}`);
  this.result = JSON.parse(hit.slice(resultTag.length));
});

Then(prefix + 'the command is {string} on line {int}', function (command, line) {
  assert.deepEqual(this.result, { command, line, ok: true });
});

Then(prefix + 'the file is not recognised as generated', function () {
  assert.equal(this.result.ok, false, `generatedMarkerOf recognised the file: ${JSON.stringify(this.result)}`);
});
