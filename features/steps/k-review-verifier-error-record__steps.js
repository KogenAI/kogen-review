const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const source = String.raw`package main
import (
 "context"
 "encoding/json"
 "os"
 "os/exec"
 "path/filepath"
 "strings"
 "testing"
 gitpkg "github.com/KogenAI/kogen-coordinator/git"
 "github.com/KogenAI/kogen-coordinator/project"
 "github.com/KogenAI/kogen-review/review"
 "github.com/KogenAI/kogen-verification/verify"
 "kogen-loop/provider"
 "kogen-loop/sys"
 "kogen-loop/tools"
)
type recordFixture struct { *env; root, start, mode string; repo *gitpkg.Repo; turn, verifies, completed int; latest string }
func (e *recordFixture) Request(ctx context.Context, r review.Request) (*provider.Response, []any, error) {
 if e.mode == "before" { return nil, r.Input, sys.Fail("verification", "unavailable", "scripted verifier unavailable", 1) }
 e.turn++
 name := "submit_review"
 args := map[string]any{"verdict":"approve", "findings":[]any{map[string]any{"path":"value.txt","line":1,"severity":"note","message":"Corrected the count"}}}
 if e.turn%2 == 1 {
  name = "write_file"
  text := "right\n"
  if e.mode == "two" && e.turn < 5 { text = strings.Repeat("intermediate\n", (e.turn+1)/2) }
  args = map[string]any{"path":"value.txt","content":text}
 } else if e.mode == "blocked" { args = map[string]any{"verdict":"changes","findings":[]any{map[string]any{"path":"value.txt","line":1,"severity":"blocking","message":"Corrected the count"}}} }
 if e.turn > 8 { panic("script exhausted") }
 raw,_ := json.Marshal(args)
 return &provider.Response{Items:[]map[string]any{{"type":"function_call","call_id":"script","name":name,"arguments":string(raw)}},Usage:provider.Usage{Input:10,Output:2}},r.Input,nil
}
func (e *recordFixture) Verify(context.Context) (verify.Pass,error) {
 e.verifies++
 tree,err:=e.repo.Tree(e.start,nil); if err!=nil { return verify.Pass{},err }; e.latest=tree
 if e.mode=="success" { return verify.Pass{N:e.verifies+1,Tree:tree,Clean:true,Green:true},nil }
 if e.mode=="two" && e.verifies<=2 { return verify.Pass{N:e.verifies+1,Tree:tree,Failing:[]string{"value"},Checks:[]verify.CommandResult{{Name:"value",Status:1}}},nil }
 return verify.Pass{},sys.Fail("verification","unavailable","scripted verifier unavailable",1)
}
func (e *recordFixture) Repaired() error { e.completed++; return nil }
func TestRecordHarness(t *testing.T) {
 root:=t.TempDir()
 git:=func(args ...string) string { c:=exec.Command("git",args...);c.Dir=root;b,err:=c.CombinedOutput();if err!=nil { t.Fatalf("git %v: %v %s",args,err,b) };return strings.TrimSpace(string(b)) }
 git("init","-q");git("config","user.email","fixture@example.invalid");git("config","user.name","Fixture")
 write:=func(name,text string){p:=filepath.Join(root,name);if err:=os.MkdirAll(filepath.Dir(p),0755);err!=nil{t.Fatal(err)};if err:=os.WriteFile(p,[]byte(text),0644);err!=nil{t.Fatal(err)}}
 write("value.txt","wrong\n")
 write(".kogen/intents/tiny/acceptance.feature","Feature: Tiny\n")
 write(".kogen/intents/tiny/intent.md","# Tiny\n\nSet value.txt to right.\n")
 git("add","-A");git("commit","-qm","start");start:=git("rev-parse","HEAD")
 repo:=gitpkg.New(root,nil);tree,err:=repo.Tree(start,nil);if err!=nil {t.Fatal(err)}
 s:=sys.New()
 e:=&recordFixture{env:&env{s:s,dir:t.TempDir(),intact:func()error{return nil}},root:root,start:start,repo:repo,mode:os.Getenv("RECORD_MODE")}
 in:=review.Input{Candidate:review.Candidate{Root:root,Repo:repo,Start:start,Tree:tree},Intent:review.Intent{Slug:"tiny",Text:"Set value.txt to right.",Role:project.Role{Provider:"chatgpt",Model:"scripted"}},Evidence:review.Evidence{Pass:verify.Pass{N:1,Tree:tree,Clean:true,Green:true}},Tools:review.Tools{Native:func(enabled []string)*tools.Tools{return &tools.Tools{Root:root,Session:s,Enabled:enabled}},Record:func(tools.Call,tools.Output)map[string]any{return nil}},Number:1,Run:review.Run{ID:"fixture",Dir:e.dir}}
 res,err:= (review.Independent{}).Review(context.Background(),in,e)
 out,code:=report(res,err)
 current,treeErr:=repo.Tree(start,nil);if treeErr!=nil {t.Fatal(treeErr)}
 text,_:=os.ReadFile(filepath.Join(root,"value.txt"))
 var stop any
 if err!=nil { se,ok:=sys.AsError(err);if !ok {t.Fatal(err)};stop=map[string]any{"class":se.Class,"reason":se.Reason,"detail":se.Detail} }
 b,err:=json.Marshal(map[string]any{"result":res,"out":out,"code":code,"error":stop,"tree":current,"text":string(text),"completed":e.completed,"verifies":e.verifies})
 if err!=nil {t.Fatal(err)};if err=os.WriteFile(os.Getenv("RECORD_OUTPUT"),b,0600);err!=nil {t.Fatal(err)}
}
`;
function observe(o, mode, note) {
 const r=o.result, out=o.out, count=mode==='two'?2:0;
 assert.equal(r.Repairs,count,'completed repair count');
 assert.equal(out.repairs,count,'standalone repair count');
 assert.equal(o.completed,count,'actual completed cycles');
 if(mode==='before') {
  assert.ok(!r.Record.verdict,'no invented submission');
  assert.ok(!r.Record.findings || r.Record.findings.length===0,'no invented findings');
  assert.deepEqual(out.findings,[],'no standalone invented findings');
  assert.equal(out.submitted,null,'explicit absent submitted record');
 } else {
  const verdict=mode==='blocked'?'changes':'approve';
  const findings=[{path:'value.txt',line:1,severity:mode==='blocked'?'blocking':'note',message:note}];
  assert.equal(o.text,'right\n','edited contents');
  assert.equal(r.Record.verdict,verdict,'submitted verdict');
  assert.equal(r.Record.tree,o.tree,'latest exact tree');
  assert.deepEqual(r.Record.findings,findings,'exact findings once');
  assert.deepEqual(out.submitted,{verdict,tree:o.tree,findings},'separate standalone submission');
  assert.equal(out.tree,o.tree,'standalone candidate tree');
  assert.deepEqual(out.findings,findings,'standalone findings');
 }
 if(mode==='success') {
  assert.equal(o.code,0);assert.equal(out.verdict,'approve');assert.equal(o.error,null);assert.equal(out.error,null);
  assert.equal(r.Pass.tree,o.tree,'producer uses lowercase tree');assert.equal(r.Pass.green,true,'producer uses lowercase green');
 } else {
  assert.notEqual(o.code,0,'unsuccessful command');
  assert.equal(out.verdict,mode==='blocked'?'changes':'error','error never approval');
  if(mode!=='blocked') {
   assert.deepEqual(o.error,{class:'verification',reason:'unavailable',detail:'scripted verifier unavailable'});
   for(const k of ['class','reason','detail']) assert.equal(out.error[k],o.error[k],'original error');
   assert.ok(!r.Pass.green,'unverified pass cannot approve');
  } else { assert.equal(o.error.reason,'review_blocked'); }
 }
 assert.equal(o.verifies,mode==='two'?3:mode==='before'||mode==='blocked'?0:1,'bounded verification script');
 assert.ok(!JSON.stringify(out).includes('script-private-secret'),'no conversation output');
}
function sample(mode) {
 const before=mode==='before', blocked=mode==='blocked', success=mode==='success';
 const findings=before?[]:[{path:'value.txt',line:1,severity:blocked?'blocking':'note',message:'Corrected the count'}];
 const verdict=before?'':blocked?'changes':'approve';
 const submitted=before?null:{verdict,tree:'tree',findings};
 const error=success?null:{class:blocked?'candidate':'verification',reason:blocked?'review_blocked':'unavailable',detail:'scripted verifier unavailable'};
 return {result:{Record:{verdict,tree:before?'':'tree',findings},Pass:{tree:success?'tree':'',green:success},Repairs:mode==='two'?2:0},out:{submitted,verdict:success?'approve':blocked?'changes':'error',findings,tree:'tree',repairs:mode==='two'?2:0,error},error,code:success?0:1,tree:'tree',text:'right\n',completed:mode==='two'?2:0,verifies:mode==='two'?3:before||blocked?0:1};
}
if(require.main===module) {
 for(const mode of ['error','success','two','before','blocked']) {
  observe(sample(mode),mode,'Corrected the count');
  const mutations=[o=>o.result.Repairs++,o=>o.out.repairs++,o=>o.completed++,o=>o.out.submitted={},o=>o.verifies++];
  if(mode!=='before')mutations.push(o=>o.result.Record.tree='stale',o=>o.result.Record.findings=[],o=>o.out.findings=[],o=>o.out.tree='stale',o=>o.text='wrong\n',o=>o.result.Record={Verdict:'approve',Tree:'tree',Findings:[]});
  if(mode==='success')mutations.push(o=>o.result.Pass={Tree:'tree',Green:true});
  else mutations.push(o=>o.code=0,o=>o.out.verdict='approve');
  for(const mutate of mutations){const bad=structuredClone(sample(mode));mutate(bad);assert.throws(()=>observe(bad,mode,'Corrected the count'));}
 }
 if(process.argv[2]==='bad'){try{const bad=sample('success');bad.result.Pass={Tree:'tree',Green:true};observe(bad,'success','Corrected the count');}catch{console.log('rejected uppercase pass');process.exit(1);}throw Error('accepted bad');}
 console.log('observer controls passed');
} else {
 const {When,Then}=require('@cucumber/cucumber');
 When('k-review-verifier-error-record: scripted review runs in mode {string}',{timeout:300000},function(mode){
  assert.ok(['error','success','two','before','blocked'].includes(mode));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'review-record-'));
  try {
   const input=path.join(dir,'harness_test.go'), output=path.join(dir,'output.json'), overlay=path.join(dir,'overlay.json');
   fs.writeFileSync(input,source);
   fs.writeFileSync(overlay,JSON.stringify({Replace:{[path.resolve('cmd/kogen-review/record_shape_test.go')]:input}}));
   const p=spawnSync('go',['test','-overlay',overlay,'./cmd/kogen-review','-run','^TestRecordHarness$','-count=1'],{encoding:'utf8',timeout:240000,env:{...process.env,RECORD_MODE:mode,RECORD_OUTPUT:output}});
   assert.equal(p.status,0,`TestRecordHarness: go test -overlay ${overlay} ./cmd/kogen-review -run ^TestRecordHarness$ -count=1: ${p.stdout}${p.stderr}`);
   assert.ok(fs.existsSync(output),'TestRecordHarness: go test ./cmd/kogen-review emitted no payload (absent, skipped or zero executions)');
   this.recordObservation=JSON.parse(fs.readFileSync(output,'utf8'));this.recordMode=mode;
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
 });
 Then('k-review-verifier-error-record: the submitted note is {string} with truthful verification status',function(note){observe(this.recordObservation,this.recordMode,note);});
}
