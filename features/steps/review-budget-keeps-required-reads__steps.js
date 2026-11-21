'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const prefix = 'review-budget-keeps-required-reads: ';
const base = '.kogen/intents/review-budget-keeps-required-reads';
let cached;
function run(overlay) {
 if (cached && !overlay) return cached;
 const root = process.cwd(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'required-budget-'));
 try {
  const files = spawnSync('git', ['ls-files','-co','--exclude-standard','-z'], {encoding:'utf8'});
  assert.equal(files.status,0,files.stderr);
  for (const file of new Set(files.stdout.split('\0').filter(Boolean))) {
   const src=path.join(root,file); if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
   const dest=path.join(dir,file); fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.copyFileSync(src,dest);
  }
  if (overlay) {
   const controls=JSON.parse(fs.readFileSync(path.join(root,base,'controls.json'),'utf8'));
   const maps=[controls.correct.files];
   if (overlay==='bad') maps.push(controls.wrong.find(w=>w.name==='non-reading tool calls loop without limit').files);
   for (const files of maps) for (const item of Object.values(files)) {
    const applied=spawnSync('git',['apply','-'],{cwd:dir,input:item.patch,encoding:'utf8'});
    assert.equal(applied.status,0,`apply proof overlay: ${applied.stderr}`);
   }
  }
  fs.copyFileSync(path.join(__dirname,'review-budget-keeps-required-reads__driver/fixture.go.txt'),path.join(dir,'contract/zz_required_budget_test.go'));
  const binary=path.join(dir,'fixture.test'), output=path.join(dir,'result.json');
  const build=spawnSync('go',['test','-c','-o',binary,'./contract'],{cwd:dir,encoding:'utf8',timeout:65000});
  assert.equal(build.status,0,`compile TestRequiredReadBudgetFixture: go test -c ./contract: ${build.error || ''}\n${build.stdout}${build.stderr}`);
  const result=spawnSync(binary,['-test.run=^TestRequiredReadBudgetFixture$','-test.count=1'],{cwd:dir,encoding:'utf8',timeout:35000,env:{...process.env,REQUIRED_BUDGET_RESULT:output}});
  assert.equal(result.status,0,`TestRequiredReadBudgetFixture: compiled ./contract fixture: ${result.error || ''}\n${result.stdout}${result.stderr}`);
  assert.ok(fs.existsSync(output),'TestRequiredReadBudgetFixture: compiled ./contract fixture absent, skipped or ran zero times: no result.json');
  cached=JSON.parse(fs.readFileSync(output,'utf8')); return cached;
 } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}
function observe(actual, expected) {
 assert.ok(actual, 'scripted review produced observations');
 assert.equal(actual.verdict,expected.verdict,'final verdict');
 assert.equal(actual.delivered,expected.delivered,'successful required read outputs reached the model');
 assert.equal(actual.early_rejected,expected.early_rejected,'early verdict rejected for unread required material');
 assert.equal(actual.reset,expected.reset,'context ceiling reset exercised');
 assert.equal(actual.resumed,expected.resumed,'saved review resumed');
 const rows=actual.rows, after=rows.filter(r=>r.n>12);
 assert.ok(rows.some(r=>r.n===12 && r.force===''),'request 12 remains an ordinary working request');
 assert.ok(after.length>0,'crossed the working request target');
 for (const row of after) {
  const action=row.unread>0?'read':'submit';
  assert.equal(row.prompt,action,`request ${row.n}: newest prompt follows required unread evidence`);
  assert.equal(row.force,expected.forced?(action==='read'?'read_file':'submit_review'):'',`request ${row.n}: route tool choice`);
 }
 if (expected.verdict==='approve') {
  assert.equal(actual.error,'','review completed successfully');
  assert.equal(actual.reason,'','no invalid-review stop');
  assert.ok(after.filter(r=>r.unread>0).length>=3,'progressing reads continue past the target');
  assert.equal(after.at(-1).unread,0,'verdict requested only after required parts delivered');
 } else {
  assert.ok(actual.error.includes('review_invalid'),'explicit invalid-review failure');
  assert.ok(actual.reason.length>0,'bounded allowance exhaustion is recorded');
  assert.ok(after.length<=3,'existing bounded allowance stops repeated non-reading');
 }
 if (expected.reset) assert.ok(after.some(r=>r.windows>0),'retry actually carries the reset session');
}
if (require.main===module) {
 const mode=process.argv[2];
 if (mode==='--proof') {
  const cases=JSON.parse(fs.readFileSync(path.join(base,'observer-expectations.json'),'utf8'));
  const all=run(process.argv[3]);
  if (process.argv[3]==='good') {
   for (const [name,e] of Object.entries(cases)) observe(all[name],e);
   console.log('required-read fixture and observer accepted correct local implementation');
  } else {
   // Qualify the deep bounded-stall assertion with a real non-progressing implementation.
   let rejected=false;
   try { observe(all.stall,cases.stall); } catch { rejected=true; }
   assert.ok(rejected,'real unbounded non-reading implementation must be rejected');
   console.log('required-read fixture and observer rejected unbounded non-reading implementation'); process.exitCode=1;
  }
 }
 else if (mode==='--emit') { console.log(JSON.stringify(run())); }
 else if (mode==='--control') {
  const all=JSON.parse(fs.readFileSync(path.join(base,'observer-good.json'),'utf8'));
  const cases=JSON.parse(fs.readFileSync(path.join(base,'observer-expectations.json'),'utf8'));
  for (const [name,e] of Object.entries(cases)) observe(all[name],e);
  if (process.argv[3]==='good') console.log('required-read observer accepted real scripted traces');
  else if (process.argv[3]==='bad') {
   const mutations=[
    a=>a.forced.rows.find(r=>r.n>12).prompt='submit',
    a=>a.forced.rows.find(r=>r.n>12).force='submit_review',
    a=>a.fallback.rows.find(r=>r.n>12).prompt='submit',
    a=>a.forced.delivered=0,
    a=>a.early.early_rejected=false,
    a=>a.stall.reason='',
    a=>a.stall.rows.push(...Array.from({length:4},()=>({...a.stall.rows.at(-1)}))),
    a=>a.reset.rows.filter(r=>r.n>12).forEach(r=>r.windows=0),
    a=>a.resume.resumed=false,
    a=>a.forced.rows.at(-1).unread=1
   ];
   for (const mutate of mutations) {
    const bad=structuredClone(all); mutate(bad); let rejected=false;
    try { for (const [name,e] of Object.entries(cases)) observe(bad[name],e); } catch { rejected=true; }
    assert.ok(rejected,'observer must reject each independently corrupted deep property');
   }
   console.log('required-read observer rejected all independent corruptions'); process.exitCode=1;
  } else throw new Error('expected good or bad');
 } else throw new Error('expected --emit or --control');
} else {
 const {When,Then}=require('@cucumber/cucumber');
 When(prefix+'the scripted review case {string} crosses the request target',{timeout:110000},function(name){this.requiredBudget=run()[name];});
 Then(prefix+'the required-read outcome is:',function(doc){observe(this.requiredBudget,JSON.parse(doc));});
}
