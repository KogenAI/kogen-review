package contract

import (
	"context"
	"encoding/json"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-loop/tools"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
)

const refusedCommand = "cat app.txt # refused"

// restricted gives the review a restriction that reports a refusal for the calls whose command
// ends with "# refused", and counts how often it was asked.
func restricted(in *review.Input, asked *int) {
	in.Tools.Restriction = &review.Restriction{Name: "fixture sandbox", Refused: func(call tools.Call) []string {
		*asked++
		if command, _ := call.Args()["command"].(string); strings.HasSuffix(command, "# refused") {
			return []string{"bind: operation not permitted"}
		}
		return nil
	}}
}

func citing(ref string) string {
	return `{"verdict":"approve","findings":[],"requirements":[{"requirement":"R1","evidence":"probe","ref":` + `"` + ref + `"` + `,"met":true}]}`
}

// TestRestrictionRefusedChecksAreEnvironmentLimitations pins that the native review asks the
// restriction once per recorded shell call, keeps its report in ProbeRun.Refused, refuses an
// approval citing a refused latest run as unrun-by-environment (a later run that was not refused
// is judged as before), records the environment in review-1.json and the Result, and encodes
// nothing of it without a restriction (items restriction, session-refused, validate-refused,
// environment-record).
func TestRestrictionRefusedChecksAreEnvironmentLimitations(t *testing.T) {
	t.Parallel()
	in, h := newReview(t)
	var asked int
	restricted(&in, &asked)
	h.answers = []*provider.Response{shellCall(refusedCommand), submitReview(citing(refusedCommand)), shellCall("cat app.txt"), submitReview(citing("cat app.txt"))}
	res, err := review.Independent{}.Review(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "validate-refused asked", asked, 2)
	eq(t, "validate-refused problem", lastOutput(h.requests[2]), `invalid verdict:
requirement "R1" cites probe "`+refusedCommand+`", which is unrun-by-environment: the reviewer's restricted execution (fixture sandbox) refused bind: operation not permitted in its latest run, and the outer gates run without this restriction; a check the restriction refused is an environment limitation, neither evidence nor a candidate defect; cite a probe you ran with shell on the current tree that exercises the requirement, or, when nothing can verify it here, submit changes with a blocking finding that quotes the requirement and says its verification could not run`)
	eq(t, "validate-refused verdict", res.Record.Verdict, "approve")
	s, err := review.DecodeSession(h.saves[len(h.saves)-1].Session)
	if err != nil {
		t.Fatal(err)
	}
	deepEq(t, "session-refused runs", []any{s.ProbeRuns[0].Refused, s.ProbeRuns[1].Refused}, []any{[]string{"bind: operation not permitted"}, []string(nil)})
	want := &review.Environment{ReviewerRestricted: true, Restriction: "fixture sandbox",
		Limitations: []review.Limitation{{Check: refusedCommand, Refused: []string{"bind: operation not permitted"}}}}
	deepEq(t, "environment result", res.Environment, want)
	rec := readJSON(t, filepath.Join(in.Run.Dir, review.File(1)))
	raw, _ := json.Marshal(rec["environment"])
	eq(t, "environment-record", string(raw), `{"limitations":[{"check":"`+refusedCommand+`","refused":["bind: operation not permitted"]}],"outer_gates_restricted":false,"restriction":"fixture sandbox","reviewer_restricted":true}`)

	// A repair round keeps the refused run, and with it the limitation.
	in, h = newReview(t)
	writeFile(t, filepath.Join(in.Candidate.Root, "app.txt"), otherText)
	asked = 0
	restricted(&in, &asked)
	h.answers = []*provider.Response{shellCall(refusedCommand), submitReview(`{"verdict":"approve","findings":[]}`), submitReview(`{"verdict":"approve","findings":[]}`)}
	h.verifies = []verify.Pass{{N: 2, Clean: true, Green: true, Tree: otherTree}}
	res, err = review.Independent{}.Review(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "session-refused repaired requests", len(h.requests), 3)
	eq(t, "session-refused repaired asked", asked, 1)
	var carried bool
	for _, c := range h.saves {
		if s, err := review.DecodeSession(c.Session); err == nil && s.Repaired && len(s.ProbeRuns) == 1 && slices.Equal(s.ProbeRuns[0].Refused, []string{"bind: operation not permitted"}) {
			carried = true
		}
	}
	if !carried {
		t.Error("session-refused: no checkpoint after the repair round kept the refused run")
	}
	deepEq(t, "environment repaired result", res.Environment, want)
	raw, _ = json.Marshal(readJSON(t, filepath.Join(in.Run.Dir, review.File(1)))["environment"])
	eq(t, "environment repaired record", string(raw), `{"limitations":[{"check":"`+refusedCommand+`","refused":["bind: operation not permitted"]}],"outer_gates_restricted":false,"restriction":"fixture sandbox","reviewer_restricted":true}`)

	// The same environment on a blocked review, with limitations [] when nothing was refused.
	in, h = newReview(t)
	restricted(&in, &asked)
	h.answers = []*provider.Response{submitReview(`{"verdict":"changes","findings":[{"path":"app.txt","line":2,"severity":"blocking","message":"wrong"}]}`)}
	res, err = review.Independent{}.Review(context.Background(), in, h)
	wantError(t, "environment blocked", err, "candidate", "review_blocked")
	deepEq(t, "environment blocked result", res.Environment, &review.Environment{ReviewerRestricted: true, Restriction: "fixture sandbox", Limitations: []review.Limitation{}})
	raw, _ = json.Marshal(readJSON(t, filepath.Join(in.Run.Dir, review.File(1)))["environment"])
	eq(t, "environment blocked record", string(raw), `{"limitations":[],"outer_gates_restricted":false,"restriction":"fixture sandbox","reviewer_restricted":true}`)

	// Without a restriction nothing of it is recorded.
	in, h = newReview(t)
	h.answers = []*provider.Response{shellCall(refusedCommand), submitReview(`{"verdict":"approve","findings":[]}`)}
	res, err = review.Independent{}.Review(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	if res.Environment != nil {
		t.Errorf("environment without restriction: %+v", res.Environment)
	}
	if _, ok := readJSON(t, filepath.Join(in.Run.Dir, review.File(1)))["environment"]; ok {
		t.Error("environment without restriction: review-1.json has the key")
	}
	if b, _ := json.Marshal(review.ProbeRun{Command: "c"}); strings.Contains(string(b), "refused") {
		t.Errorf("ProbeRun without a refusal encodes refused: %s", b)
	}
}

// TestExternalReviewShowsTheEnvironmentWithoutLimitations pins that an external reviewer's record
// and Result show the restriction with limitations [] (item environment-record).
func TestExternalReviewShowsTheEnvironmentWithoutLimitations(t *testing.T) {
	t.Parallel()
	in, h := newReview(t)
	var asked int
	restricted(&in, &asked)
	x := &fakeExecutor{t: t, results: []executor.RoundResult{structured(`{"verdict":"approve","findings":[]}`)}}
	res, err := review.NewExternal(x, externalDescriptor(), 4).Review(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	deepEq(t, "external environment result", res.Environment, &review.Environment{ReviewerRestricted: true, Restriction: "fixture sandbox", Limitations: []review.Limitation{}})
	raw, _ := json.Marshal(readJSON(t, filepath.Join(in.Run.Dir, review.File(1)))["environment"])
	eq(t, "external environment record", string(raw), `{"limitations":[],"outer_gates_restricted":false,"restriction":"fixture sandbox","reviewer_restricted":true}`)
	eq(t, "external environment asked", asked, 0)
}
