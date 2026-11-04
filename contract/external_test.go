package contract

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-review/review"
)

// TestExternalReviewApprovesInItsOwnSession pins the review kogen-build runs for an external
// review role (review.NewExternal(ex, desc, max) through its delegate): one fresh executor
// session of the review role with the structured submit_review schema and the round cap, the
// material retained privately before anything is sent (review-<n>-material.json and its
// authority and source files, 0600 in a 0700 folder), its delivery in the completed round, the
// review executor state, and the approval of the pass (items external-approve, material-json;
// kogen-build build/review_lineup_test.go and executor_external.go).
func TestExternalReviewApprovesInItsOwnSession(t *testing.T) {
	t.Parallel()
	in, h := newReview(t)
	round := structured(`{"verdict":"approve","findings":[]}`)
	round.Usage = executor.Usage{Input: core.Count(1500), Cached: core.Count(500), Output: core.Count(150), State: executor.UsageComplete}
	x := &fakeExecutor{t: t, results: []executor.RoundResult{round}}
	// The Build's executor state already holds earlier usage: the account counts only this round.
	in.Executor = &core.ExecutorState{Name: "fixture-executor", SessionID: "earlier", Rounds: 3,
		Usage: core.ExecutorUsage{Input: core.Count(7000), Cached: core.Count(2000), Output: core.Count(700), Reasoning: core.Count(0), State: executor.UsageComplete}}
	r := review.NewExternal(x, externalDescriptor(), 4)
	ap, err := r.Review(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	if ap.Account == nil {
		t.Fatal("review-account: the external approval has no Account")
	}
	eq(t, "review-account requests", ap.Account.Review.Requests, 1)
	deepEq(t, "review-account tokens", []*int{ap.Account.Review.Input, ap.Account.Review.Cached, ap.Account.Review.Output}, []*int{core.Count(1500), core.Count(500), core.Count(150)})
	eq(t, "review-account repair rounds", ap.Account.RepairRounds, 0)
	eq(t, "review-account first tree green", ap.Account.Effect.FirstTreeGreen, true)
	eq(t, "external-approve verdict", ap.Record.Verdict, "approve")
	eq(t, "external-approve pass", ap.Pass.Tree, greenTree)
	eq(t, "external-approve sessions", x.starts, 1)
	task := x.tasks[0]
	eq(t, "external-approve role", task.Role, executor.RoleReview)
	eq(t, "external-approve model", task.Model, reviewRole.Model)
	eq(t, "external-approve effort", task.Effort, reviewRole.Effort)
	eq(t, "external-approve max rounds", task.MaxRounds, 4)
	eq(t, "external-approve run id", task.RunID, in.Run.ID)
	var schema map[string]any
	if err := json.Unmarshal(task.Schema, &schema); err != nil || schema["type"] != "object" {
		t.Errorf("external-approve schema: %s", task.Schema)
	}
	eq(t, "external-approve first round feedback", x.inputs[0].Feedback, "")
	if h.executor == nil {
		t.Fatal("external-approve: no review executor state")
	}
	eq(t, "external-approve executor name", h.executor.Name, "fixture-executor")
	eq(t, "external-approve executor session", h.executor.SessionID, "review-session-1")
	eq(t, "external-approve executor rounds", h.executor.Rounds, 1)

	dir := filepath.Join(in.Run.Dir, "executor-review")
	st, err := os.Stat(dir)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "material-json folder mode", st.Mode().Perm(), os.FileMode(0o700))
	data, err := os.ReadFile(filepath.Join(dir, "review-1-material.json"))
	if err != nil {
		t.Fatal(err)
	}
	var m review.Material
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	eq(t, "material-json review", m.Review, 1)
	eq(t, "material-json tree", m.Tree, greenTree)
	eq(t, "material-json delivered", m.Delivered, true)
	eq(t, "material-json delivered round", m.Round, 1)
	eq(t, "material-json session", m.Session, "review-session-1")
	material, err := review.MaterialOf(in)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "material-json source bytes", m.Source.Bytes, len(material.Source))
	eq(t, "material-json source sha256", m.Source.SHA256, core.HashHex([]byte(material.Source)))
	for _, name := range []string{"review-1-authority.txt", "review-1-source.txt", "review-1-material.json"} {
		st, err := os.Stat(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		eq(t, "material-json mode "+name, st.Mode().Perm(), os.FileMode(0o600))
	}
	rounds := eventsNamed(t, h, "executor_round")
	eq(t, "external-approve round events", len(rounds), 1)
	eq(t, "external-approve round role", rounds[0]["role"], any(executor.RoleReview))
}

// TestExternalReviewCorrectsAnInvalidVerdictOnce pins the external verdict rules: an invalid
// structured verdict is sent back once as text, a second invalid one ends the review without a
// verdict (rejected_verdict_exhausted, review.InvalidError) and the Result carries its Invalid
// (item external-invalid; kogen-build build/k_reviewretry_test.go).
func TestExternalReviewCorrectsAnInvalidVerdictOnce(t *testing.T) {
	t.Parallel()
	in, h := newReview(t)
	x := &fakeExecutor{t: t, results: []executor.RoundResult{structured(`{"verdict":"maybe","findings":[]}`), structured(`{"verdict":"maybe","findings":[]}`)}}
	res, err := review.NewExternal(x, externalDescriptor(), 4).Review(context.Background(), in, h)
	wantError(t, "external-invalid", err, "candidate", "review_invalid")
	eq(t, "external-invalid rounds", len(x.inputs), 2)
	eq(t, "external-invalid feedback", x.inputs[1].Feedback,
		"Not a valid verdict: submit_review needs verdict (approve or changes) and a findings list; verdict must be approve or changes but was a string with an unsupported value. Submit a corrected structured verdict.")
	if res.Invalid == nil {
		t.Fatal("external-invalid: the review's Invalid is missing")
	}
	eq(t, "external-invalid reason", res.Invalid.Reason, "rejected_verdict_exhausted")
}

// TestExternalReviewHasNoResume pins that an external reviewer is never resumed: kogen-build
// starts a fresh review instead, and the seam refuses a resume (item external-resume;
// kogen-build build/review_lineup_test.go).
func TestExternalReviewHasNoResume(t *testing.T) {
	t.Parallel()
	_, err := (review.External{}).Resume(context.Background(), review.Input{}, nil)
	e := wantError(t, "external-resume", err, "candidate", "resume_refused")
	eq(t, "external-resume detail", e.Detail, "an independent review by an external executor cannot be resumed (resume capability: none)")
}

// TestExternalReviewRequirementsSkipTheProbeCheck pins that an external reviewer's approval citing
// a probe is accepted, as Kogen cannot see its tool calls, while an approval whose requirement has
// no evidence, or that cites acceptance in a pass that records it not run, is sent back with its
// problem (items external-requirements, validate-evidence).
func TestExternalReviewRequirementsSkipTheProbeCheck(t *testing.T) {
	t.Parallel()
	in, h := newReview(t)
	x := &fakeExecutor{t: t, results: []executor.RoundResult{structured(`{"verdict":"approve","findings":[],"requirements":[{"requirement":"R1","evidence":"probe","ref":"sh probe.sh","met":true}]}`)}}
	ap, err := review.NewExternal(x, externalDescriptor(), 4).Review(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "external-requirements verdict", ap.Record.Verdict, "approve")

	in, h = newReview(t)
	x = &fakeExecutor{t: t, results: []executor.RoundResult{
		structured(`{"verdict":"approve","findings":[],"requirements":[{"requirement":"R1","evidence":"none","ref":"","met":false}]}`),
		structured(`{"verdict":"approve","findings":[],"requirements":[{"requirement":"R1","evidence":"probe","ref":"sh probe.sh","met":true}]}`)}}
	if _, err := review.NewExternal(x, externalDescriptor(), 4).Review(context.Background(), in, h); err != nil {
		t.Fatal(err)
	}
	eq(t, "external-requirements feedback", x.inputs[1].Feedback,
		`Not a valid verdict: requirement "R1" has no evidence: probe it with shell against the candidate before the verdict. Submit a corrected structured verdict.`)

	in, h = newReview(t)
	x = &fakeExecutor{t: t, results: []executor.RoundResult{
		structured(`{"verdict":"approve","findings":[],"requirements":[{"requirement":"R1","evidence":"acceptance","ref":"S","met":true}]}`),
		structured(`{"verdict":"approve","findings":[],"requirements":[{"requirement":"R1","evidence":"probe","ref":"sh probe.sh","met":true}]}`)}}
	if _, err := review.NewExternal(x, externalDescriptor(), 4).Review(context.Background(), in, h); err != nil {
		t.Fatal(err)
	}
	eq(t, "external-acceptance feedback", x.inputs[1].Feedback,
		`Not a valid verdict: requirement "R1" cites acceptance "S", which did not run on the current tree (not_run): naming a scenario is not evidence; cite a probe you ran with shell on the current tree that exercises the requirement, or, when nothing can verify it here, submit changes with a blocking finding that quotes the requirement and says its verification could not run. Submit a corrected structured verdict.`)
}
