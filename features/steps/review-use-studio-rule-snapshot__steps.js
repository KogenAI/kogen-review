'use strict';
// Acceptance of review-use-studio-rule-snapshot. The step writes a Go test of package contract
// (zz_studio_rules_driver_test.go, written by this step, not by the Build) into a disposable copy
// of the checkout and runs `go test -v ./contract -run TestZZStudioRulesDriver -count=1`. The test
// reuses the contract suite's scripted Env and temporary Git candidate, serves a loopback fake
// Studio rules endpoint that requires a synthetic bearer token, runs scripted native reviews and
// writes string observations per case as JSON. It imports nothing the Build adds, so it compiles
// and runs on the unchanged tree too (where the observations fail the scenarios). The expected
// content hash is computed here from the producer's documented hash rule: sha256 of the compact
// JSON array of the rules. No model or provider is called.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const prefix = 'review-use-studio-rule-snapshot: ';
const TEST = 'TestZZStudioRulesDriver';

const DRIVER = String.raw`package contract

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/KogenAI/kogen-review/review"
)

const zzToken = "synthetic-token-A"

type zzStudio struct {
	mu       sync.Mutex
	mode     string
	revision string
	hits     int
}

func (s *zzStudio) set(mode, revision string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.mode, s.revision = mode, revision
}

func (s *zzStudio) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.hits
}

func (s *zzStudio) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.hits++
	q := r.URL.Query()
	for k := range q {
		if k != "workspace_id" && k != "product_id" && k != "repo" {
			w.WriteHeader(400)
			return
		}
	}
	if r.URL.Path != "/api/rules" || r.Header.Get("Authorization") != "Bearer "+zzToken || s.mode == "revoked" {
		w.WriteHeader(401)
		return
	}
	if s.mode == "down" {
		w.WriteHeader(503)
		return
	}
	fmt.Fprintf(w, "{\"product\":\"kogen\",\"repo\":%q,\"rules\":[%s]}", q.Get("repo"), zzRule(s.revision))
}

func zzRule(revision string) string {
	return "{\"id\":\"r-1\",\"revision\":" + revision + ",\"scope\":\"repo\",\"topic\":\"tests\",\"text\":\"Every finding cites evidence.\",\"owner\":\"team\",\"overrides\":null}"
}

// zzHash is the producer's content hash of the one rule: sha256 of the compact JSON array.
func zzHash(revision string) string {
	sum := sha256.Sum256([]byte("[" + zzRule(revision) + "]"))
	return "sha256:" + hex.EncodeToString(sum[:])
}

// zzConfig writes the project's studio-rules file; the file is git-excluded so the candidate's
// tree stays the green pass's tree.
func zzConfig(t *testing.T, root, url, repo, policy string) {
	t.Helper()
	os.MkdirAll(filepath.Join(root, ".git", "info"), 0o755)
	os.WriteFile(filepath.Join(root, ".git", "info", "exclude"), []byte(".kogen/studio-rules.yaml\n"), 0o644)
	text := "version: 1\nurl: " + url + "\nworkspace_id: optimum\nproduct_id: kogen\nrepo: " + repo + "\ntoken_env: ZZ_STUDIO_TOKEN\non_unavailable: " + policy + "\n"
	path := filepath.Join(root, ".kogen", "studio-rules.yaml")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func zzSent(h *fakeEnv) string {
	raw, _ := json.Marshal(h.requests)
	return string(raw)
}

const zzApprove = "{\"verdict\":\"approve\",\"findings\":[]}"

func zzNote(rule string) string {
	return "{\"verdict\":\"approve\",\"findings\":[{\"path\":\"app.txt\",\"line\":1,\"severity\":\"note\",\"message\":\"n\",\"rule\":\"" + rule + "\"}]}"
}

func zzFindingRule(res review.Result) string {
	for _, f := range res.Record.Findings {
		if v, ok := f["rule"].(string); ok {
			return v
		}
	}
	return ""
}

// zzCarry copies the producer's cache folder of one checkout into another; it is best effort.
func zzCarry(from, to string) {
	src := filepath.Join(from, ".kogen", "local", "studio-rules")
	dst := filepath.Join(to, ".kogen", "local")
	os.MkdirAll(dst, 0o755)
	exec.Command("cp", "-R", src, dst).Run()
}

func zzB(b bool) string { return fmt.Sprint(b) }

func zzRun(in review.Input, h *fakeEnv) (review.Result, string) {
	res, err := (review.Independent{}).Review(context.Background(), in, h)
	if err != nil {
		return res, err.Error()
	}
	return res, ""
}

// TestZZStudioRulesDriver writes the observations of each case to ZZ_STUDIO_RULES_OUT.
func TestZZStudioRulesDriver(t *testing.T) {
	out := os.Getenv("ZZ_STUDIO_RULES_OUT")
	if out == "" {
		t.Fatal("ZZ_STUDIO_RULES_OUT is not set")
	}
	t.Setenv("ZZ_STUDIO_TOKEN", zzToken)
	studio := &zzStudio{mode: "ok", revision: "\"2\""}
	srv := httptest.NewServer(studio)
	defer srv.Close()
	result := map[string]map[string]string{}

	// unconfigured: no studio-rules file.
	in, h := newReview(t)
	h.answers = append(h.answers, submitReview(zzApprove))
	zzRun(in, h)
	result["unconfigured"] = map[string]string{"requests": fmt.Sprint(len(h.requests)), "studio_requests": fmt.Sprint(studio.count()),
		"mentions_rules": zzB(strings.Contains(zzSent(h), "Studio rules"))}

	// applied: revision 2, with the linking finding.
	in, h = newReview(t)
	zzConfig(t, in.Candidate.Root, srv.URL, "kogen-review", "hold")
	h.answers = append(h.answers, submitReview(zzNote("r-1@2")))
	res, _ := zzRun(in, h)
	sent := zzSent(h)
	result["applied"] = map[string]string{"has_rule": zzB(strings.Contains(sent, "r-1@2") && strings.Contains(sent, "Every finding cites evidence.")),
		"origin_live": zzB(strings.Contains(sent, "origin: live")), "hash_matches": zzB(strings.Contains(sent, "content_hash: "+zzHash("\"2\""))),
		"token_leaked": zzB(strings.Contains(sent, zzToken)), "finding_rule": zzFindingRule(res)}

	// resumed: the first saved review checkpoint carries the snapshot; Studio now refuses.
	retains := false
	findingRule := ""
	before := studio.count()
	var saved *review.Checkpoint
	for i := range h.saves {
		if h.saves[i].Stage == "review" {
			saved = &h.saves[i]
			break
		}
	}
	if saved != nil {
		var session map[string]json.RawMessage
		json.Unmarshal(saved.Session, &session)
		var snap map[string]any
		json.Unmarshal(session["studio_rules"], &snap)
		retains = snap["content_hash"] == zzHash("\"2\"")
		studio.set("revoked", "\"2\"")
		in2, h2 := newReview(t)
		in2.Checkpoint = saved
		h2.answers = append(h2.answers, submitReview(zzNote("r-1@2")))
		res2, _ := (review.Independent{}).Resume(context.Background(), in2, h2)
		findingRule = zzFindingRule(res2)
	}
	result["resumed"] = map[string]string{"session_retains": zzB(retains), "studio_requests": fmt.Sprint(studio.count() - before), "finding_rule": findingRule}

	// changed: revision 3 reaches the next review.
	studio.set("ok", "\"3\"")
	in, h = newReview(t)
	zzConfig(t, in.Candidate.Root, srv.URL, "kogen-review", "hold")
	h.answers = append(h.answers, submitReview(zzApprove))
	zzRun(in, h)
	sent = zzSent(h)
	result["changed"] = map[string]string{"has_new": zzB(strings.Contains(sent, "r-1@3")), "has_old": zzB(strings.Contains(sent, "r-1@2"))}
	root3 := in.Candidate.Root

	// outage: Studio is down, the same scope's cache (revision 3) is used and reported.
	studio.set("down", "\"3\"")
	in, h = newReview(t)
	zzConfig(t, in.Candidate.Root, srv.URL, "kogen-review", "hold")
	zzCarry(root3, in.Candidate.Root)
	h.answers = append(h.answers, submitReview(zzApprove))
	zzRun(in, h)
	sent = zzSent(h)
	result["outage"] = map[string]string{"origin_cached": zzB(strings.Contains(sent, "origin: cached")), "fallback": zzB(strings.Contains(sent, "fallback: http_503")),
		"has_rule": zzB(strings.Contains(sent, "r-1@3")), "hash_matches": zzB(strings.Contains(sent, "content_hash: "+zzHash("\"3\"")))}

	// revoked: 401 with a cache present, nothing is sent to the model.
	studio.set("revoked", "\"3\"")
	in, h = newReview(t)
	zzConfig(t, in.Candidate.Root, srv.URL, "kogen-review", "hold")
	zzCarry(root3, in.Candidate.Root)
	h.answers = append(h.answers, submitReview(zzApprove))
	_, e := zzRun(in, h)
	result["revoked"] = map[string]string{"error": e, "requests": fmt.Sprint(len(h.requests))}

	// foreign: another repo's scope with the carried cache of kogen-review, Studio down.
	studio.set("down", "\"3\"")
	in, h = newReview(t)
	zzConfig(t, in.Candidate.Root, srv.URL, "other-repo", "hold")
	zzCarry(root3, in.Candidate.Root)
	h.answers = append(h.answers, submitReview(zzApprove))
	_, e = zzRun(in, h)
	result["foreign"] = map[string]string{"error": e, "requests": fmt.Sprint(len(h.requests))}

	// uncached: no cache at all and on_unavailable unavailable.
	in, h = newReview(t)
	zzConfig(t, in.Candidate.Root, srv.URL, "kogen-review", "unavailable")
	h.answers = append(h.answers, submitReview(zzApprove))
	_, e = zzRun(in, h)
	result["uncached"] = map[string]string{"error": e, "requests": fmt.Sprint(len(h.requests))}

	// unlinked: a finding naming an unapplied rule is rejected, the second answer is valid.
	studio.set("ok", "\"3\"")
	in, h = newReview(t)
	zzConfig(t, in.Candidate.Root, srv.URL, "kogen-review", "hold")
	h.answers = append(h.answers, submitReview(zzNote("r-9@1")), submitReview(zzNote("r-1@3")))
	zzRun(in, h)
	sent = zzSent(h)
	result["unlinked"] = map[string]string{"feedback_names_problem": zzB(strings.Contains(sent, "is not an applied Studio rule")), "requests": fmt.Sprint(len(h.requests))}

	raw, _ := json.Marshal(result)
	if err := os.WriteFile(out, raw, 0o644); err != nil {
		t.Fatal(err)
	}
}
`;

let cached;
function observe() {
  if (cached) return cached;
  const root = process.cwd(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-studio-rules-'));
  try {
    const files = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {cwd: root, encoding: 'utf8'});
    assert.equal(files.status, 0, files.stderr);
    for (const file of new Set(files.stdout.split('\0').filter(Boolean))) {
      const src = path.join(root, file);
      if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
      const dest = path.join(dir, file);
      fs.mkdirSync(path.dirname(dest), {recursive: true});
      fs.copyFileSync(src, dest);
    }
    fs.writeFileSync(path.join(dir, 'contract', 'zz_studio_rules_driver_test.go'), DRIVER);
    const output = path.join(dir, 'studio-rules.json');
    const run = spawnSync('go', ['test', '-v', './contract', '-run', TEST, '-count=1'], {cwd: dir, encoding: 'utf8', timeout: 110000, env: {...process.env, ZZ_STUDIO_RULES_OUT: output}});
    const ran = `go test -v ./contract -run ${TEST} -count=1: status ${run.status} ${run.error || ''}\n${run.stdout}\n${run.stderr}`;
    assert.equal(run.status, 0, `studio rules driver failed\n${ran}`);
    assert.match(run.stdout, new RegExp(`--- PASS: ${TEST} `), `studio rules driver did not report a pass\n${ran}`);
    assert.ok(fs.existsSync(output), `studio rules driver wrote no observations\n${ran}`);
    cached = {cases: JSON.parse(fs.readFileSync(output, 'utf8')), ran};
    return cached;
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

const {When, Then} = require('@cucumber/cucumber');
When(prefix + 'the scripted reviews are run', {timeout: 120000}, function () {
  observe();
});
Then(prefix + 'case {word} reports {word} equal to {string}', function (name, field, expected) {
  const o = observe();
  const c = o.cases[name];
  assert.ok(c, `case ${name} was not observed\n${o.ran}`);
  assert.equal(c[field], expected, `case ${name} field ${field}\n${o.ran}`);
});
Then(prefix + 'case {word} reports {word} equal to {word}', function (name, field, expected) {
  const o = observe();
  const c = o.cases[name];
  assert.ok(c, `case ${name} was not observed\n${o.ran}`);
  assert.equal(c[field], expected, `case ${name} field ${field}\n${o.ran}`);
});
