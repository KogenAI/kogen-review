const {When,Then}=require('@cucumber/cucumber');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const observe=require('./repair_progress_observer.cjs');
When('the repair progress saved-candidate case {string} runs', {timeout:180000}, function(mode) {
 const root=process.cwd(), dir=fs.mkdtempSync(path.join(os.tmpdir(),'repair-progress-'));
 try {
  const cp=spawnSync('git',['ls-files','-co','--exclude-standard','-z'],{cwd:root,encoding:'utf8'});
  assert.equal(cp.status,0,cp.stderr);
  for(const file of new Set(cp.stdout.split('\0').filter(Boolean))) { if(!fs.statSync(path.join(root,file)).isFile())continue; const dest=path.join(dir,file); fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.copyFileSync(path.join(root,file),dest); }
  fs.copyFileSync(path.join(__dirname,'repair_progress_test.go.txt'),path.join(dir,'contract','repair_progress_acceptance_test.go'));
  const output=path.join(dir,'result.json');
  const run=spawnSync('go',['test','./contract','-count=1'],{cwd:dir,encoding:'utf8',timeout:160000,env:{...process.env,REPAIR_CASE:mode,REPAIR_RESULT:output}});
  assert.equal(run.status,0,`saved-candidate harness go test ./contract failed: ${run.error||''}\n${run.stdout}\n${run.stderr}`);
  assert.ok(fs.existsSync(output),'saved-candidate adapter must produce its result');
  this.repairProgress=JSON.parse(fs.readFileSync(output,'utf8'));
 } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
Then('the repair progress outcome is:',function(doc) { observe(this.repairProgress,JSON.parse(doc)); });
