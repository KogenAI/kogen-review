package contract

import (
	"context"
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
