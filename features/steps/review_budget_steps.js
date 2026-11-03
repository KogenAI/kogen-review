const {When, Then} = require('@cucumber/cucumber');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const observe = require('./review_budget_observer.cjs');
When('the bounded review case {string} runs', {timeout:180000}, function(mode) {
 const root = process.cwd(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-budget-'));
 try {
  const files = spawnSync('git', ['ls-files','-co','--exclude-standard','-z'], {cwd:root,encoding:'utf8'});
  assert.equal(files.status,0,files.stderr);
  for (const file of new Set(files.stdout.split('\0').filter(Boolean))) {
   if (!fs.statSync(path.join(root,file)).isFile()) continue;
   const dest = path.join(dir,file); fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.copyFileSync(path.join(root,file),dest);
  }
  fs.copyFileSync(path.join(__dirname,'review_budget_driver.go.txt'),path.join(dir,'contract','budget_acceptance_test.go'));
  const output = path.join(dir,'budget.json');
  const run = spawnSync('go',['test','./contract','-run','TestBudgetAcceptanceDriver','-count=1'],{cwd:dir,encoding:'utf8',timeout:160000,env:{...process.env,BUDGET_CASE:mode,BUDGET_RESULT:output}});
  assert.equal(run.status,0,`TestBudgetAcceptanceDriver: go test ./contract -run TestBudgetAcceptanceDriver -count=1 failed: ${run.error || ''}\n${run.stdout}\n${run.stderr}`);
  assert.ok(fs.existsSync(output),'TestBudgetAcceptanceDriver: go test ./contract must run and emit budget.json, not be absent, skipped or run zero times');
  this.reviewBudget = JSON.parse(fs.readFileSync(output,'utf8'));
 } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
Then('the bounded review outcome is:', function(doc) { observe(this.reviewBudget, JSON.parse(doc)); });
