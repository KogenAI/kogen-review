package contract

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-coordinator/route"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
	"kogen-loop/provider"
)

func TestExternalRepairBounds(t *testing.T) {
	for _, tc := range []struct {
		name     string
		count    int
		changing bool
	}{{"same", 3, false}, {"cap", 20, true}} {
		t.Run(tc.name, func(t *testing.T) {
			in, h := newReview(t)
			x := &fakeExecutor{t: t}
			// The executor edits the actual candidate on every submission.
			in.Tools.Round = func(ctx context.Context, s executor.Session, input executor.Input) (executor.RoundResult, error) {
				writeFile(t, filepath.Join(in.Candidate.Root, "app.txt"), fmt.Sprintf("edit %d", len(x.inputs)))
				return s.Round(ctx, input)
			}
			for i := 0; i < tc.count; i++ {
				x.results = append(x.results, structured(`{"verdict":"approve","findings":[]}`))
				id := "lint"
				if tc.changing {
					id = fmt.Sprintf("item%d", i)
				}
				h.verifies = append(h.verifies, verify.Pass{N: i + 2, Tree: greenTree, Failing: []string{"check:" + id}})
			}
			res, err := review.NewExternal(x, externalDescriptor(), tc.count+1).Review(context.Background(), in, h)
			e := wantError(t, "external bound", err, "candidate", "review_blocked")
			eq(t, "rounds", len(x.inputs), tc.count)
			eq(t, "repairs", res.Repairs, tc.count)
			eq(t, "recorded repairs", h.repairs, tc.count)
			if !strings.Contains(e.Detail, fmt.Sprint(tc.count)) {
				t.Fatal(e.Detail)
			}
			eq(t, "record verdict", readJSON(t, filepath.Join(in.Run.Dir, review.File(1)))["verdict"], any("changes"))
		})
	}
}

func TestRetainedRepairCheckpointResumeApproval(t *testing.T) {
	in, h := newReview(t)
	pass := verify.Pass{N: 2, Tree: greenTree, Failing: []string{"check:lint"}}
	raw, err := (review.Session{Role: reviewRole, Usage: core.ZeroTokens(), Seen: greenTree, RepairRounds: 2, FailureStreak: 2, FailureIdentities: []string{"check:lint"}, Repaired: true}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	in.Checkpoint = &review.Checkpoint{Stage: route.StageReview, Pass: &pass, Session: raw}
	h.answers = []*provider.Response{submitReview(`{"verdict":"approve","findings":[]}`)}
	h.verifies = []verify.Pass{{N: 3, Tree: greenTree, Green: true}}
	res, err := review.Independent{}.Resume(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "approval", res.Record.Verdict, "approve")
	eq(t, "retained repairs", res.Repairs, 2)
	retained, err := h.requests[0].Retain(h.requests[0].Input)
	if err != nil {
		t.Fatal(err)
	}
	s, err := review.DecodeSession(retained)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "retained streak", s.FailureStreak, 2)
	eq(t, "retained rounds", s.RepairRounds, 2)
}

type interruptRepairSave struct {
	*fakeEnv
	stopped bool
}

func (h *interruptRepairSave) Save(c review.Checkpoint) error {
	if err := h.fakeEnv.Save(c); err != nil {
		return err
	}
	s, err := review.DecodeSession(c.Session)
	if err != nil {
		return err
	}
	if !h.stopped && c.Stage == route.StageReview && s.RepairRounds == 1 {
		h.stopped = true
		return fmt.Errorf("interrupted after checkpoint")
	}
	return nil
}

func TestRepairCheckpointInterruptionDoesNotRecount(t *testing.T) {
	in, base := newReview(t)
	h := &interruptRepairSave{fakeEnv: base}
	writeFile(t, filepath.Join(in.Candidate.Root, "app.txt"), otherText)
	h.answers = []*provider.Response{submitReview(`{"verdict":"approve","findings":[]}`), submitReview(`{"verdict":"approve","findings":[]}`), submitReview(`{"verdict":"approve","findings":[]}`)}
	for i := 0; i < 3; i++ {
		h.verifies = append(h.verifies, verify.Pass{N: i + 2, Tree: otherTree, Failing: []string{"check:lint"}})
	}
	_, err := review.Independent{}.Review(context.Background(), in, h)
	if err == nil || !h.stopped {
		t.Fatalf("expected interruption: %v", err)
	}
	cp := h.saves[len(h.saves)-1]
	in.Checkpoint = &cp
	res, err := review.Independent{}.Resume(context.Background(), in, h)
	wantError(t, "resumed bound", err, "candidate", "review_blocked")
	eq(t, "rounds after interruption", res.Repairs, 3)
	eq(t, "remaining verifications", len(h.verifies), 0)
	eq(t, "requests", len(h.requests), 3)
	s, err := review.DecodeSession(h.saves[len(h.saves)-1].Session)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "streak", s.FailureStreak, 3)
	eq(t, "saved attempts", len(s.Attempts), 3)
}

func TestBlockedRepairResumeCanApprove(t *testing.T) {
	in, h := newReview(t)
	pass := verify.Pass{N: 4, Tree: greenTree, Failing: []string{"check:lint"}}
	blocked := review.Verdict{Verdict: "changes", Findings: []map[string]any{{"path": "app.txt", "line": 1, "severity": "blocking", "message": "check:lint"}}}
	raw, err := (review.Session{Role: reviewRole, Usage: core.ZeroTokens(), Input: []any{map[string]any{"role": "user", "content": "prior conversation"}}, Seen: greenTree, Tree: greenTree, Verdict: &blocked, RepairRounds: 3, FailureStreak: 3, FailureIdentities: []string{"check:lint"}, Repaired: true}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	in.Checkpoint = &review.Checkpoint{Stage: route.StageReviewVerify, Pass: &pass, Session: raw}
	h.verifies = []verify.Pass{{N: 5, Tree: greenTree, Green: true}}
	h.answers = []*provider.Response{submitReview(`{"verdict":"approve","findings":[]}`)}
	res, err := review.Independent{}.Resume(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "verdict", res.Record.Verdict, "approve")
	eq(t, "repairs", res.Repairs, 3)
	eq(t, "fresh verification", len(h.verifies), 0)
	if len(h.requests) != 1 || len(h.requests[0].Input) < 2 {
		t.Fatal("blocked conversation was not reopened")
	}
}

type unavailableEnv struct {
	*fakeEnv
	err error
}

func (h *unavailableEnv) Verify(context.Context) (verify.Pass, error) { return verify.Pass{}, h.err }

func TestVerificationErrorRetainsSubmission(t *testing.T) {
	for _, mode := range []string{"resume-approval", "resume-blocked", "external"} {
		t.Run(mode, func(t *testing.T) {
			in, base := newReview(t)
			unavailable := fmt.Errorf("verification unavailable")
			h := &unavailableEnv{fakeEnv: base, err: unavailable}
			findings := []map[string]any{{"path": "app.txt", "line": json.Number("1"), "severity": "note", "message": "Corrected the count"}}
			verdict := review.Verdict{Verdict: "approve", Findings: findings}
			var res review.Result
			var err error
			if mode == "external" {
				x := &fakeExecutor{t: t, results: []executor.RoundResult{structured(`{"verdict":"approve","findings":[{"path":"app.txt","line":1,"severity":"note","message":"Corrected the count"}]}`)}}
				in.Tools.Round = func(ctx context.Context, s executor.Session, input executor.Input) (executor.RoundResult, error) {
					writeFile(t, filepath.Join(in.Candidate.Root, "app.txt"), otherText)
					return s.Round(ctx, input)
				}
				res, err = review.NewExternal(x, externalDescriptor(), 3).Review(context.Background(), in, h)
			} else {
				if mode == "resume-blocked" {
					verdict.Verdict = "changes"
					findings[0]["severity"] = "blocking"
				}
				pass := greenPass()
				raw, e := (review.Session{Role: reviewRole, Usage: core.ZeroTokens(), Seen: greenTree, Tree: otherTree, Verdict: &verdict, RepairRounds: 2}).Encode()
				if e != nil {
					t.Fatal(e)
				}
				in.Checkpoint = &review.Checkpoint{Stage: route.StageReviewVerify, Pass: &pass, Session: raw}
				res, err = review.Independent{}.Resume(context.Background(), in, h)
			}
			if err != unavailable {
				t.Fatalf("error: %v", err)
			}
			eq(t, "submitted verdict", res.Record.Verdict, verdict.Verdict)
			eq(t, "submitted tree", res.Record.Tree, otherTree)
			deepEq(t, "findings", res.Record.Findings, findings)
			if mode != "external" {
				eq(t, "completed rounds", res.Repairs, 2)
			} else {
				eq(t, "completed rounds", res.Repairs, 0)
			}
		})
	}
}

func TestRepairLimitResumeVerificationErrorRetainsActualSubmission(t *testing.T) {
	in, base := newReview(t)
	writeFile(t, filepath.Join(in.Candidate.Root, "app.txt"), otherText)
	base.answers = []*provider.Response{submitReview(`{"verdict":"approve","findings":[]}`), submitReview(`{"verdict":"approve","findings":[]}`), submitReview(`{"verdict":"approve","findings":[]}`)}
	for i := 0; i < 3; i++ {
		base.verifies = append(base.verifies, verify.Pass{N: i + 2, Tree: greenTree, Failing: []string{"check:lint"}})
	}
	_, err := review.Independent{}.Review(context.Background(), in, base)
	wantError(t, "limit", err, "candidate", "review_blocked")
	cp := base.saves[len(base.saves)-1]
	in.Checkpoint = &cp
	unavailable := fmt.Errorf("verification unavailable")
	res, err := review.Independent{}.Resume(context.Background(), in, &unavailableEnv{fakeEnv: base, err: unavailable})
	if err != unavailable {
		t.Fatalf("error: %v", err)
	}
	eq(t, "actual verdict", res.Record.Verdict, "approve")
	eq(t, "actual tree", res.Record.Tree, otherTree)
	eq(t, "completed rounds", res.Repairs, 3)
	// Checkpoints created before the synthetic marker must retain the same evidence.
	saved, e := review.DecodeSession(cp.Session)
	if e != nil {
		t.Fatal(e)
	}
	saved.SyntheticBlock = false
	cp.Session, e = saved.Encode()
	if e != nil {
		t.Fatal(e)
	}
	in.Checkpoint = &cp
	res, err = review.Independent{}.Resume(context.Background(), in, &unavailableEnv{fakeEnv: base, err: unavailable})
	if err != unavailable {
		t.Fatalf("legacy error: %v", err)
	}
	eq(t, "legacy actual verdict", res.Record.Verdict, "approve")
	eq(t, "legacy actual tree", res.Record.Tree, otherTree)
}
