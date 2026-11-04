const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const env = {...process.env, GOWORK:'off', GOFLAGS:'-mod=mod'};
function run(args, cwd) {
  const r = spawnSync('go', args, {cwd, env, encoding:'utf8', timeout:240000, maxBuffer:128*1024*1024});
  return {status:r.status, stdout:r.stdout || '', text:(r.stdout || '')+(r.stderr || '')+(r.error ? String(r.error) : ''), command:'go '+args.join(' ')};
}
function judge(r) {
  const why = `TestDisplay required exactly once and passing: ${r.command}; exit ${r.status}; absent, skipped or zero executions are failures\n${r.text}`;
  const events = r.stdout.split('\n').filter(Boolean).map(x=>JSON.parse(x));
  assert.ok(r.status === 0 && events.filter(e=>e.Test==='TestDisplay' && e.Action==='run').length===1 && events.filter(e=>e.Test==='TestDisplay' && e.Action==='pass').length===1 && !events.some(e=>e.Test==='TestDisplay' && ['skip','fail'].includes(e.Action)), why);
}
function exercise(version, full) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'review-display-'));
  try {
    for (const name of ['go.mod','go.sum','consumes','review','contract','cmd','.kogen']) {
      fs.cpSync(path.join(root,name),path.join(dir,name),{recursive:true});
    }
    const edit = run(['mod','edit','-require=github.com/KogenAI/kogen-executor@'+version],dir);
    assert.equal(edit.status,0,edit.text);
    return run(full ? ['test','-json','-count=1','./...'] : ['test','-json','-count=1','./consumes/kogen-executor','-run','^TestDisplay$'],dir);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}
function compact(s) { return s.replace(/\s+/g,''); }
function table(source, expected) {
  const body = source.match(/func TestDisplay\(t \*testing\.T\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(body,'TestDisplay must retain its table-driven assertions');
  const entries = body.match(/\}\s*\{([\s\S]*?)\}\s*\{/ )?.[1];
  assert.equal(compact(entries || ''),compact(expected),'TestDisplay must retain useful expectations and exclude integral/exponent floats');
  assert.ok(/eq\(t,\s*"core.Display",\s*core.Display\(c.in\),\s*c.want\)/.test(body),'TestDisplay must assert each retained expectation');
}
if (require.main === module) {
  try {
    judge(run(['test','-json','-count=1','./consumes/kogen-executor','-run','^TestDisplay$'],root));
    const original=fs.readFileSync(path.join(root,'consumes/kogen-executor/core_test.go'),'utf8');
    const expected='{nil, ""}, {"x/y.go", "x/y.go"}, {json.Number("12"), "12"}, {json.Number("1.50"), "1.50"}, {float64(2.5), "2.5"}, {7, "7"}, {true, "true"},';
    const good=original.replace('{float64(3), "3"}, ','');
    table(good,expected);
    if (process.argv[2]==='bad') table(good.replace('{nil, ""}, ',''),expected);
    console.log('observer accepted');
  } catch (_) { console.log('observer rejected'); process.exitCode=1; }
} else {
  const {When,Then} = require('@cucumber/cucumber');
  When('k-review-display-float-unpinned: I run TestDisplay against executor {string}', {timeout:300000}, function(version) { this.displayResult=exercise(version,false); });
  When('k-review-display-float-unpinned: I run all Go tests against executor {string}', {timeout:300000}, function(version) { this.displayResult=exercise(version,true); });
  Then('k-review-display-float-unpinned: TestDisplay passes exactly once', function() { judge(this.displayResult); });
  Then('k-review-display-float-unpinned: the Display expectations are', function(expected) {
    table(fs.readFileSync(path.join(root,'consumes/kogen-executor/core_test.go'),'utf8'),expected);
  });
  Then('k-review-display-float-unpinned: the Display signature remains {string}', function(expected) {
    assert.ok(compact(fs.readFileSync(path.join(root,'consumes/kogen-executor/api_test.go'),'utf8')).includes(compact(expected)),'Display compile-time signature must remain '+expected);
  });
  Then('k-review-display-float-unpinned: the README says {string}', function(text) {
    assert.ok(fs.readFileSync(path.join(root,'consumes/kogen-executor/README.md'),'utf8').includes(text),`README must say: ${text}`);
  });
}
