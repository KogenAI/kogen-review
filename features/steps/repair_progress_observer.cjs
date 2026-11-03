const assert = require('node:assert/strict');
function observe(s, e) {
 for (const [key,value] of Object.entries(e)) {
  if (key === 'errorIncludes') { for(const text of value) assert.ok(s.error.includes(text), `stop must include ${text}: ${s.error}`); }
  else if (key === 'resumeErrorIncludes') { for(const text of value) assert.ok(s.resumeError.includes(text), `resumed stop must include ${text}: ${s.resumeError}`); }
  else assert.deepEqual(s[key], value, key);
 }
}
module.exports = observe;
if(require.main===module) {
 const expected={verdict:'changes',rounds:3,repairs:3,verified:3,candidate:'check:lint|3',checkpoint:true,errorIncludes:['check:lint','3'],resumeRounds:1,resumeVerified:2,conversation:true,resumeErrorIncludes:['check:lint','4']};
 const good={...expected,error:'blocked check:lint after 3',resumeError:'blocked check:lint after 4'};
 delete good.errorIncludes; delete good.resumeErrorIncludes;
 if(process.argv[2]==='good') { observe(good,expected); console.log('observer accepted'); }
 else { let rejected=0; for(const key of Object.keys(expected)) { const bad={...good}; if(key==='errorIncludes') bad.error=''; else if(key==='resumeErrorIncludes') bad.resumeError=''; else bad[key]=null; try { observe(bad,expected); } catch { rejected++; } } if(rejected!==Object.keys(expected).length) process.exit(0); console.log('observer rejected every altered guarantee'); process.exit(1); }
}
