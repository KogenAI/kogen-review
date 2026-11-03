package contract

import (
	"context"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-coordinator/route"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
	"kogen-loop/provider"
)

// stages are the stages a review recorded, consecutive repeats merged.
func stages(h *fakeEnv) []string {
	var out []string
	for _, s := range h.stages {
		if len(out) == 0 || out[len(out)-1] != s {
			out = append(out, s)
		}
	}
	return out
}

// TestIndependentReviewApprovesTheGreenPass pins the native review kogen-build runs by default
// (review.Independent{} through its delegate): the review of the number it is given, one
// request of the review model with the reviewer's instructions and tools, the checkpoints of the
// review stages, the review record review-1.json, the run log's review event, the progress lines
// and the approval of the very pass under review (items independent-approve, review-record;
// kogen-build build/review_test.go and the state golden review-approve).
func TestIndependentReviewApprovesTheGreenPass(t *testing.T) {
	t.Parallel()
	in, h := newReview(t)
	h.answers = []*provider.Response{submitReview(`{"verdict":"approve","findings":[{"path":"app.txt","line":1,"severity":"note","message":"fine"}]}`)}
	pass := greenPass()
	ap, err := review.Independent{}.Review(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	deepEq(t, "independent-approve pass", ap.Pass, pass)
	eq(t, "independent-approve record verdict", ap.Record.Verdict, "approve")
	eq(t, "independent-approve record n", ap.Record.N, 1)
	eq(t, "independent-approve record tree", ap.Record.Tree, greenTree)
	eq(t, "independent-approve repairs", ap.Repairs, 0)
	deepEq(t, "independent-approve last review", *h.last, ap.Record)

	eq(t, "independent-approve requests", len(h.requests), 1)
	sp := h.requests[0]
	deepEq(t, "independent-approve role", sp.Role, reviewRole)
	eq(t, "independent-approve instructions", sp.Instructions, review.ReviewerInstructions())
	var names []string
	for _, d := range sp.Tools {
		if m, ok := d.(map[string]any); ok {
			names = append(names, m["name"].(string))
		}
	}
	if !slices.Contains(names, review.SubmitReviewTool) {
		t.Errorf("independent-approve tools: %v has no %s", names, review.SubmitReviewTool)
	}
	deepEq(t, "independent-approve stages", stages(h), []string{route.StageReview, "tool", route.StageReviewVerify})
	deepEq(t, "independent-approve progress", h.progress, []string{"kogen: reviewing (review 1)", "kogen: review 1: approve, 0 blocking"})
	eq(t, "independent-approve material event", h.materials, 1)

	rec := readJSON(t, filepath.Join(in.Run.Dir, review.File(1)))
	for _, key := range []string{"model", "effort", "usage", "verdict", "findings", "tree", "attempts"} {
		if _, ok := rec[key]; !ok {
			t.Errorf("review-record: review-1.json has no %q: %v", key, rec)
		}
	}
	eq(t, "review-record model", rec["model"], any(reviewRole.Model))
	eq(t, "review-record effort", rec["effort"], any(reviewRole.Effort))
	eq(t, "review-record verdict", rec["verdict"], any("approve"))
	eq(t, "review-record tree", rec["tree"], any(greenTree))
	ev := eventsNamed(t, h, "review")
	eq(t, "independent-approve review events", len(ev), 1)
	eq(t, "independent-approve review event verdict", ev[0]["verdict"], any("approve"))
	eq(t, "independent-approve review event pass", ev[0]["pass"], any(1))
}

// TestIndependentReviewChangesIsTheReviewBlockedStop pins that a changes verdict ends the Build
// with candidate/review_blocked naming each blocking finding, and leaves the verdict in a
// review_verify checkpoint (item independent-blocked; kogen-build build/review_test.go and the
// state golden review-changes).
func TestIndependentReviewChangesIsTheReviewBlockedStop(t *testing.T) {
	t.Parallel()
	in, h := newReview(t)
	h.answers = []*provider.Response{submitReview(`{"verdict":"changes","findings":[{"path":"app.txt","line":2,"severity":"blocking","message":"wrong"}]}`)}
	res, err := review.Independent{}.Review(context.Background(), in, h)
	e := wantError(t, "independent-blocked", err, "candidate", "review_blocked")
	eq(t, "independent-blocked exit", e.Exit, 1)
	deepEq(t, "independent-blocked lines", e.Lines, []string{"review: app.txt:2: wrong"})
	eq(t, "independent-blocked last review", h.last.Verdict, "changes")
	eq(t, "independent-blocked result verdict", res.Record.Verdict, "changes")
	eq(t, "independent-blocked result findings", len(res.Record.Findings), 1)
	last := h.saves[len(h.saves)-1]
	eq(t, "independent-blocked stage", last.Stage, route.StageReviewVerify)
	s, err := review.DecodeSession(last.Session)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "independent-blocked session verdict", s.Verdict.Verdict, "changes")
	eq(t, "independent-blocked session tree", s.Tree, greenTree)
}

// TestIndependentReviewWithoutAVerdictIsHandedToTheBuild pins the end of a review without a
// valid verdict: a prose-only turn is reminded once, the second ends the review, the Result
// carries its Invalid and the stop is review.InvalidError (item independent-invalid; kogen-build
// build/k_reviewretry_test.go and review_retry.go, which record review.InvalidRecord).
func TestIndependentReviewWithoutAVerdictIsHandedToTheBuild(t *testing.T) {
	t.Parallel()
	in, h := newReview(t)
	h.answers = []*provider.Response{prose("looks fine"), prose("still fine")}
	res, err := review.Independent{}.Review(context.Background(), in, h)
	wantError(t, "independent-invalid", err, "candidate", "review_invalid")
	eq(t, "independent-invalid requests", len(h.requests), 2)
	eq(t, "independent-invalid reminder forces submit_review", h.requests[1].ForceTool, review.SubmitReviewTool)
	if res.Invalid == nil {
		t.Fatal("independent-invalid: the review's Invalid is missing")
	}
	eq(t, "independent-invalid review", res.Invalid.Review, 1)
	eq(t, "independent-invalid reason", res.Invalid.Reason, "no_tool_reminder_exhausted")
	eq(t, "independent-invalid no-tool reminders", res.Invalid.NoToolReminder, 1)
	eq(t, "independent-invalid pass", res.Invalid.Pass.Tree, greenTree)
	deepEq(t, "independent-invalid record", review.InvalidRecord(1), core.ReviewRecord{N: 1, Verdict: "invalid", Findings: []map[string]any{}})
}

// TestIndependentResumeJudgesTheSavedVerdict pins Resume of a review_verify checkpoint: the
// saved approval is judged again on the current tree without a new request, and a checkpoint
// whose review state cannot be read is refused (item independent-resume; kogen-build
// build/resume_test.go and the state golden resumed).
func TestIndependentResumeJudgesTheSavedVerdict(t *testing.T) {
	t.Parallel()
	in, h := newReview(t)
	pass := greenPass()
	raw, err := review.Session{Role: reviewRole, Usage: core.ZeroTokens(), Seen: greenTree, Tree: greenTree,
		Verdict: &review.Verdict{Verdict: "approve"}}.Encode()
	if err != nil {
		t.Fatal(err)
	}
	in.Checkpoint = &review.Checkpoint{Stage: route.StageReviewVerify, Pass: &pass, Base: &pass, Session: raw}
	ap, err := review.Independent{}.Resume(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "independent-resume requests", len(h.requests), 0)
	eq(t, "independent-resume verdict", ap.Record.Verdict, "approve")
	eq(t, "independent-resume review number", ap.Record.N, 1)
	deepEq(t, "independent-resume pass", ap.Pass, pass)

	in2, h2 := newReview(t)
	in2.Checkpoint = &review.Checkpoint{Stage: route.StageReview, Pass: &pass, Session: []byte(`{"attempts":"no"}`)}
	_, err = review.Independent{}.Resume(context.Background(), in2, h2)
	wantError(t, "independent-resume refused", err, "candidate", "resume_refused")
}

// TestIndependentApprovalOfAnUnverifiedTreeIsVerifiedFirst pins the exact-tree rule: an approval
// of a tree that is not the green pass's is verified by the caller (Env.Verify); the changed
// contents, which the reviewer was not given, go back to the same reviewer with their diff, and
// only its approval of the verified tree binds (item independent-exact-tree; kogen-build
// build/review_test.go).
func TestIndependentApprovalOfAnUnverifiedTreeIsVerifiedFirst(t *testing.T) {
	t.Parallel()
	in, h := newReview(t)
	h.tree = otherTree // the candidate changed after the green pass
	h.answers = []*provider.Response{submitReview(`{"verdict":"approve","findings":[]}`), submitReview(`{"verdict":"approve","findings":[]}`)}
	h.verifies = []verify.Pass{{N: 2, Clean: true, Green: true, Tree: otherTree}}
	ap, err := review.Independent{}.Review(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "independent-exact-tree verified", len(h.verifies), 0)
	eq(t, "independent-exact-tree requests", len(h.requests), 2)
	eq(t, "independent-exact-tree repairs", h.repairs, 1)
	eq(t, "independent-exact-tree result repairs", ap.Repairs, 1)
	eq(t, "independent-exact-tree pass", ap.Pass.N, 2)
	eq(t, "independent-exact-tree tree", ap.Record.Tree, otherTree)
	sent := h.requests[1].Input
	last, _ := sent[len(sent)-1].(map[string]any)
	content, _ := last["content"].(string)
	if !strings.HasPrefix(content, "Your verdict was not applied: the candidate changed after its contents were delivered to you, other than through your own Kogen tool calls: app.txt.\n") ||
		!strings.Contains(content, "fixture diff") {
		t.Errorf("independent-exact-tree feedback: %q", content)
	}
	if !slices.Contains(h.progress, "kogen: review 1: the candidate changed after its contents were delivered; returning the changes to the reviewer") {
		t.Errorf("independent-exact-tree progress: %q", h.progress)
	}
}
