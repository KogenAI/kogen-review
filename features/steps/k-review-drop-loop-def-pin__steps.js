const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const testName = 'TestDefinitionIsTheGenericToolDefinition';
const main = 'v0.0.0-20261103223720-4a8ad8d6d1fa';
const pinned = 'v0.0.0-20261102055344-c6e2360290d4';
function command(args, cwd) {
  const r = spawnSync('go', args, {cwd, encoding:'utf8', env:{...process.env, GOWORK:'off'}, maxBuffer:32*1024*1024});
  if (r.error) throw r.error;
  return {status:r.status, text:r.stdout+r.stderr, stdout:r.stdout};
}
function normalizeImports(dir) {
  for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const file = path.join(dir,entry.name);
    if (entry.isDirectory()) normalizeImports(file);
    else if (entry.name.endsWith('.go') || entry.name==='go.mod') {
      const old = fs.readFileSync(file,'utf8');
      const text = old.replaceAll('github.com/KogenAI/kogen-loop','kogen-loop');
      if (old!==text) { fs.chmodSync(file,0o644); fs.writeFileSync(file,text); }
    }
  }
}
function exercise(version, mutation, full) {
  const root = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-defs-'));
  try {
    const download = command(['mod','download','-json','github.com/KogenAI/kogen-loop@'+version],root);
    assert.equal(download.status,0,download.text);
    const info = JSON.parse(download.stdout);
    assert.ok(info.Dir,download.text);
    const repo = path.join(tmp,'review');
    fs.cpSync(root,repo,{recursive:true,filter:p=>!['.git','node_modules'].includes(path.basename(p))});
    const dep = path.join(tmp,'loop');
    fs.cpSync(info.Dir,dep,{recursive:true});
    normalizeImports(dep);
    const file = path.join(dep,'tools','defs.go');
    fs.chmodSync(file,0o644);
    let src = fs.readFileSync(file,'utf8');
    const signature = 'func Definition(name string) (map[string]any, bool) {';
    assert.equal(src.split(signature).length,2,'producer Definition seam must exist exactly once');
    src = src.replace(signature,'func originalDefinition(name string) (map[string]any, bool) {');
    let change = '';
    if (mutation === 'description') change = 'd["description"] = "Changed search_text description for consumer regression"';
    if (mutation === 'missing') change = 'delete(d["parameters"].(map[string]any)["properties"].(map[string]any), "pattern")';
    src += '\nfunc Definition(name string) (map[string]any, bool) {\n d, ok := originalDefinition(name)\n if ok && name == "search_text" { '+change+' }\n return d, ok\n}\n';
    fs.writeFileSync(file,src);
    const edit = command(['mod','edit','-replace=kogen-loop='+dep],repo);
    assert.equal(edit.status,0,edit.text);
    const args = full ? ['test','-json','-count=1','./...'] : ['test','-json','-count=1','./consumes/kogen-loop','-run','^'+testName+'$'];
    const result = command(args,repo);
    const events = result.stdout.split('\n').filter(Boolean).map(line=>JSON.parse(line));
    const starts = events.filter(e=>e.Test===testName && e.Action==='run');
    assert.equal(starts.length,1,`go ${args.join(' ')} must run ${testName} exactly once; status ${result.status}\n${result.text}`);
    return {status:result.status, action:events.find(e=>e.Test===testName && ['pass','fail','skip'].includes(e.Action))?.Action, text:result.text};
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
}
function judge(result, expected) {
  assert.equal(result.action,expected,`${testName} must ${expected}\n${result.text}`);
  assert.equal(result.status,expected==='pass'?0:1,`${testName}: go test exit\n${result.text}`);
}
if (require.main === module) {
  try {
    if (process.argv[2] === 'good') {
      judge(exercise(pinned,'none',false),'pass');
      judge(exercise(pinned,'missing',false),'fail');
      console.log('control accepted');
    } else {
      judge(exercise(pinned,'description',false),'pass');
      console.log('control accepted');
    }
  } catch (_) { console.log('control rejected'); process.exitCode=1; }
} else {
  const {When,Then} = require('@cucumber/cucumber');
  When('k-review-drop-loop-def-pin: I run the suite against observed main with {string}', function(mutation) {
    assert.ok(['none','description','missing'].includes(mutation));
    this.definitionResult = exercise(main,mutation,mutation!=='missing');
  });
  Then('k-review-drop-loop-def-pin: the definition consumer test must {string}', function(expected) {
    judge(this.definitionResult,expected);
  });
}
