const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn, spawnSync} = require('node:child_process');
const prefix = 'k-review-saved-candidate-check-evidence: ';
const command = `python3 -c 'from pathlib import Path; assert Path("value.txt").read_text().strip() == "right"'`;
const acceptance = 'NODE_PATH="$KOGEN_CUCUMBER" "$KOGEN_NODE" "$KOGEN_CUCUMBER/@cucumber/cucumber/bin/cucumber.js" --require missing-bindings.js --format "message:$KOGEN_ACCEPTANCE_REPORT" "$KOGEN_ACCEPTANCE_FEATURES"';
function observe(o, e) {
  assert.equal(o.record.state, e.state, 'initial verification state');
  const p = o.record.pass;
  assert.equal(p.tree, o.tree, 'evidence must name current tree');
  assert.equal(p.green, e.state === 'passed', 'truthful green');
  assert.deepEqual(p.checks.map(c => [c.name, c.command]), e.state === 'no_checks' ? [] : [['value', command], ...(e.state === 'passed' ? [['later', 'true']] : [])], 'actual commands in order');
  assert.deepEqual(p.not_run, e.state === 'failed' || e.state === 'unavailable' ? ['later'] : [], 'unrun tail');
  if (e.state === 'passed') {
    assert.ok(p.checks.every(c => c.status === 0), 'successful checks');
    assert.equal(o.status, 0, 'green review exit');
    assert.equal(o.out.verdict, 'approve', 'scripted approval');
    assert.ok(o.requests.length > 0, 'review received green material');
    assert.ok(JSON.stringify(o.requests[0]).includes('check value: passed'), 'reviewer sees actual check result');
  } else {
    assert.notEqual(o.status, 0, 'non-green stops');
    assert.equal(o.out.verdict, 'error', 'verification stop');
    assert.ok(o.out.error && /verif|check/i.test(JSON.stringify(o.out.error)), 'explicit verification limitation');
    assert.equal(o.requests.length, 0, 'no green review on non-green input');
    if (e.state !== 'no_checks') {
      assert.notEqual(p.checks[0].status, 0, 'observed nonzero');
      assert.ok(p.checks[0].output.length > 0, 'failure diagnostic retained');
    }
  }
  assert.equal(o.audit, e.executions, 'Python assertion process actually invoked');
  assert.equal(o.unchanged, true, 'review preserves candidate and baseline');
}
function control() {
  function sample(state) {
    const passed = state === 'passed';
    return {record:{state, pass:{tree:'current',green:passed,checks:state === 'no_checks' ? [] : [{name:'value',command,status:passed?0:1,output:passed?'':'diagnostic'}, ...(passed?[{name:'later',command:'true',status:0,output:''}]:[])],not_run:passed||state==='no_checks'?[]:['later']}},tree:'current',status:passed?0:1,out:passed?{verdict:'approve'}:{verdict:'error',error:{reason:'verification_failed'}},requests:passed?[{messages:['check value: passed']}]:[],audit:state==='passed'||state==='failed'?1:0,unchanged:true};
  }
  for (const state of ['passed','failed','unavailable','no_checks']) {
    const good = sample(state), expected = {state,executions:good.audit};
    observe(good, expected);
    const mutations = [o=>o.record.pass.tree='stale',o=>o.record.pass.green=!o.record.pass.green,o=>o.audit++,o=>o.unchanged=false,o=>o.record.state='invented',o=>o.record.pass.checks.push({name:'fiction',command:'true',status:0}),o=>o.record.pass.not_run.push('invented')];
    if (state === 'passed') mutations.push(o=>o.requests=[],o=>o.requests=[{}],o=>o.record.pass.checks[0].status=1);
    else mutations.push(o=>o.requests=[{}],o=>o.out.error=null);
    for (const mutate of mutations) {
      const bad = structuredClone(good); mutate(bad);
      assert.throws(()=>observe(bad,expected), undefined, `control must reject ${state} mutation`);
    }
  }
  if (process.argv[3] === 'bad') {
    const bad = sample('passed'); bad.record.pass.tree='stale';
    try { observe(bad,{state:'passed',executions:1}); } catch { console.log('rejected stale evidence'); process.exitCode=1; return; }
    throw Error('stale evidence accepted');
  }
  console.log('observer controls passed');
}
if (require.main === module && process.argv[2] === '--control') control();
else {
  const {Given,When,Then,After} = require('@cucumber/cucumber');
  let bin;
  function run(exe,args,cwd,env=process.env) {
    const r=spawnSync(exe,args,{cwd,env,encoding:'utf8',timeout:240000});
    assert.equal(r.status,0,`${exe} ${args.join(' ')}: ${r.stdout}${r.stderr}${r.error||''}`);
    return r.stdout.trim();
  }
  function git(w,...args) { return run('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false',...args],w.root,w.env); }
  function write(w,p,text) { const dest=path.join(w.root,p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,text); }
  function snapshot(w) { return git(w,'rev-parse','HEAD')+'\n'+git(w,'status','--porcelain=v1','--untracked-files=all')+'\n'+fs.readFileSync(path.join(w.root,'value.txt'),'utf8')+'\n'+fs.readFileSync(path.join(w.root,'.kogen/project.yaml'),'utf8')+'\n'+fs.readFileSync(path.join(w.root,'.kogen/intents/tiny/intent.md'),'utf8')+'\n'+fs.readFileSync(path.join(w.root,'.kogen/intents/tiny/acceptance.feature'),'utf8'); }
  Given(prefix+'a saved repository with check mode {string}',{timeout:300000},function(mode){
    if(!bin){bin=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'evidence-bin-')),'review');run('go',['build','-o',bin,'./cmd/kogen-review'],process.cwd());}
    this.root=fs.mkdtempSync(path.join(os.tmpdir(),'evidence-repo-'));
    this.aux=fs.mkdtempSync(path.join(os.tmpdir(),'evidence-tools-'));
    this.env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',HOME:this.aux};
    for(const k of Object.keys(this.env)) if(k.startsWith('GIT_')&&!['GIT_CONFIG_GLOBAL','GIT_CONFIG_NOSYSTEM'].includes(k)) delete this.env[k];
    this.mode=mode;assert.ok(['configured','missing','none'].includes(mode));
    const python=run('python3',['-c','import sys; print(sys.executable)'],process.cwd());
    this.auditFile=path.join(this.aux,'audit');
    const tools=path.join(this.aux,'bin');fs.mkdirSync(tools);
    fs.symlinkSync(run('which',['git'],process.cwd()),path.join(tools,'git'));
    if(mode!=='missing')fs.writeFileSync(path.join(tools,'python3'),`#!/bin/sh\nprintf 'ran\\n' >> '${this.auditFile}'\nexec '${python}' "$@"\n`,{mode:0o755});
    this.env.PATH=tools;
    git(this,'init','-q','-b','main');
    write(this,'value.txt','wrong\n');
    write(this,'.kogen/intents/tiny/intent.md','# Correct the value\n\nSlug: tiny\nModel: not applicable — plain value\nAcceptance:\n- .kogen/intents/tiny/acceptance.feature\n\nSet value.txt to right.\n');
    write(this,'.kogen/intents/tiny/acceptance.feature','Feature: Tiny saved candidate\n');
    const quote = s => "'" + s.replaceAll("'", "''") + "'";
    const yaml = 'version: 1\ncommands:\n  setup: []\n  fix: []\n' + (mode === 'none' ? '  checks: []\n' : '  checks:\n    - name: value\n      run: '+quote(command)+'\n    - name: later\n      run: \'true\'\n  acceptance:\n    run: '+quote(acceptance)+'\n');
    write(this,'.kogen/project.yaml',yaml);
    git(this,'add','-A');git(this,'commit','-qm','start');this.start=git(this,'rev-parse','HEAD');
  });
  When(prefix+'the current value is {string} and standalone review runs',{timeout:300000},async function(value){
    write(this,'value.txt',value+'\n');git(this,'add','-A');
    this.tree=git(this,'write-tree'); const before=snapshot(this);
    fs.writeFileSync(this.auditFile,'');this.requests=[];
    this.server=http.createServer((req,res)=>{let body='';req.on('data',d=>body+=d);req.on('end',()=>{this.requests.push(JSON.parse(body));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'script',choices:[{index:0,message:{role:'assistant',content:null,tool_calls:[{id:'submit',type:'function',function:{name:'submit_review',arguments:JSON.stringify({verdict:'approve',findings:[]})}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:2}}));});});
    await new Promise(resolve=>this.server.listen(0,'127.0.0.1',resolve));
    const url=`http://127.0.0.1:${this.server.address().port}/v1`;
    const result=await new Promise(resolve=>{const c=spawn(bin,['-root',this.root,'-start',this.start,'-slug','tiny','-provider','openai-compatible','-model','scripted','-base-url',url],{env:this.env});let stdout='',stderr='';const timer=setTimeout(()=>c.kill('SIGKILL'),180000);c.stdout.on('data',d=>stdout+=d);c.stderr.on('data',d=>stderr+=d);c.on('close',status=>{clearTimeout(timer);resolve({status,stdout,stderr});});});
    await new Promise(resolve=>this.server.close(resolve));this.server=null;
    assert.ok(result.stdout.endsWith('\n')&&!result.stdout.trim().includes('\n'),`one JSON line: ${JSON.stringify(result)}`);
    const out=JSON.parse(result.stdout);
    const file=path.join(out.run,'initial-verification.json');
    assert.ok(fs.existsSync(file),`missing candidate-bound initial verification record: ${JSON.stringify(result)}`);
    this.observed={record:JSON.parse(fs.readFileSync(file,'utf8')),out,status:result.status,requests:this.requests,tree:this.tree,audit:fs.readFileSync(this.auditFile,'utf8').split('\n').filter(Boolean).length,unchanged:snapshot(this)===before};
  });
  Then(prefix+'verification is {string} with {int} assertion executions',function(state,executions){observe(this.observed,{state,executions});});
  After(async function(){if(this.server)await new Promise(resolve=>this.server.close(resolve));});
}
