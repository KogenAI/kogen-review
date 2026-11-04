'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const markers = ['ADD_ONE','ADD_TWO','EDIT_NEW','EDIT_OLD','RENAME_NEW','RENAME_OLD','COPY_ONE','DELETE_ONE'];
function observe(row) {
  for (const key of ['source','partsSource','split']) {
    const texts = key === 'split' ? row[key] : [row[key]];
    assert.ok(Array.isArray(texts) && texts.length > 0, key);
    if (key === 'split') assert.equal(texts.length, 2, 'two parts');
    const all = texts.join('\n');
    for (const marker of markers) assert.equal(all.split(marker).length - 1, 1, `${key}: ${marker} must occur exactly once`);
    assert.match(all, /added\.txt[^\n]*mode 100644/, `${key}: added mode`);
    assert.ok(all.includes('renamed.txt') && all.includes('rename.txt'), `${key}: rename names`);
    assert.ok(all.includes('copied.txt') && all.includes('copy.txt'), `${key}: copy names`);
    assert.equal(all.split('EDIT_CONTEXT').length - 1, 1, `${key}: context not repeated as full text`);
    assert.ok(all.includes('+EDIT_NEW'), `${key}: edited line belongs to diff`);
  }
}
const go = `package review
import (
 "encoding/json"
 "os"
 "os/exec"
 "path/filepath"
 "strings"
 "testing"
 gitpkg "github.com/KogenAI/kogen-coordinator/git"
 "github.com/KogenAI/kogen-verification/verify"
)
func TestNoRepeatedContentCapture(t *testing.T) {
 root:=t.TempDir()
 run:=func(args ...string) string { c:=exec.Command("git",args...); c.Dir=root; c.Env=append(os.Environ(),"GIT_AUTHOR_NAME=Fixture","GIT_AUTHOR_EMAIL=fixture@example.test","GIT_COMMITTER_NAME=Fixture","GIT_COMMITTER_EMAIL=fixture@example.test"); b,e:=c.CombinedOutput(); if e!=nil {t.Fatalf("git %v: %s %v",args,b,e)}; return strings.TrimSpace(string(b)) }
 write:=func(p,s string) { p=filepath.Join(root,p); if e:=os.MkdirAll(filepath.Dir(p),0755);e!=nil{t.Fatal(e)};if e:=os.WriteFile(p,[]byte(s),0644);e!=nil{t.Fatal(e)} }
 run("init","-q")
 write(".kogen/intents/fixture/acceptance.feature","Feature: fixture\\n")
 write("edit.txt","EDIT_CONTEXT\\nEDIT_OLD\\n")
 stable:=""; for i:=0;i<40;i++ { stable += "rename stable context\\n" }
 write("rename.txt",stable+"RENAME_OLD\\n")
 write("copy.txt","COPY_ONE\\n")
 write("delete.txt","DELETE_ONE\\n")
 run("add","-A");run("commit","-qm","start");start:=run("rev-parse","HEAD")
 write("added.txt","ADD_ONE\\nADD_TWO\\n")
 write("edit.txt","EDIT_CONTEXT\\nEDIT_NEW\\n")
 if e:=os.Rename(filepath.Join(root,"rename.txt"),filepath.Join(root,"renamed.txt"));e!=nil{t.Fatal(e)}
 write("renamed.txt",stable+"RENAME_NEW\\n")
 write("copied.txt","COPY_ONE\\n")
 if e:=os.Remove(filepath.Join(root,"delete.txt"));e!=nil{t.Fatal(e)}
 run("add","-A");run("commit","-qm","candidate");tree:=run("rev-parse","HEAD^{tree}")
 c:=Candidate{Root:root,Repo:gitpkg.New(root,nil),Start:start,Tree:tree}
 m,e:=MaterialOf(Input{Candidate:c,Intent:Intent{Slug:"fixture",Text:"fixture"},Evidence:Evidence{Pass:verify.Pass{Tree:tree,Green:true,Clean:true}}});if e!=nil{t.Fatal(e)}
 blocks,e:=materialBlocks(c,tree,m);if e!=nil{t.Fatal(e)}
 p:=&reviewParter{source:m.PartsSource,sum:"fixture",catalog:"[]",checks:"passed",blocks:blocks,measure:func(s string)int{return len(s)}}
 var texts []string
 for ceiling:=700;ceiling<=len(m.PartsSource)+2000;ceiling++ { p.ceiling=ceiling; cuts,e:=p.cut();if e==nil && len(cuts)==2 {texts=p.texts(cuts);break} }
 b,e:=json.Marshal(map[string]any{"source":m.Source,"partsSource":m.PartsSource,"split":texts});if e!=nil{t.Fatal(e)}
 if e:=os.WriteFile(os.Getenv("NO_REPEAT_OUTPUT"),b,0600);e!=nil{t.Fatal(e)}
}
`;
function capture() {
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'no-repeat-'));
 try {
  fs.cpSync(process.cwd(),temp,{recursive:true,filter:p=>!['.git','node_modules'].includes(path.basename(p))});
  fs.writeFileSync(path.join(temp,'review','zz_no_repeat_capture_test.go'),go);
  const output=path.join(temp,'capture.json');
  const r=spawnSync('go',['test','./review','-run','^TestNoRepeatedContentCapture$','-count=1'],{cwd:temp,env:{...process.env,NO_REPEAT_OUTPUT:output},encoding:'utf8',timeout:240000});
  assert.equal(r.status,0,`capture via go test ./review: ${r.stdout}${r.stderr}`);
  return JSON.parse(fs.readFileSync(output,'utf8'));
 } finally { fs.rmSync(temp,{recursive:true,force:true}); }
}
function control(mode) {
 const text='--- added.txt (added; mode 100644)\nADD_ONE\nADD_TWO\n+EDIT_NEW\n-EDIT_OLD\n EDIT_CONTEXT\nrename.txt -> renamed.txt\n+RENAME_NEW\n-RENAME_OLD\ncopy.txt -> copied.txt\nCOPY_ONE\n-DELETE_ONE\n';
 const row={source:text,partsSource:text,split:[text,'reference to part 1']};
 if(mode==='good'){observe(row);console.log('observer good');return;}
 for(const marker of [...markers,'EDIT_CONTEXT']) for(const mutation of ['missing','duplicate']) {
  const bad=structuredClone(row);
  bad.source=mutation==='missing'?text.replace(marker,'REMOVED'):text+marker;
  assert.throws(()=>observe(bad),undefined,`${marker} ${mutation} must fail`);
 }
 console.log('observer rejected missing and duplicate material');process.exitCode=1;
}
if(require.main===module){control(process.argv[2]);} else {
 const {When,Then}=require('@cucumber/cucumber');
 When('k-review-input-no-repeated-content: I assemble the mixed Git candidate',function(){this.noRepeat=capture();});
 Then('k-review-input-no-repeated-content: all source is delivered exactly once including two ordered parts',function(){observe(this.noRepeat);});
}
