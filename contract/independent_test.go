package contract

import (
	"context"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-executor/agent"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
	"kogen-loop/provider"
)

func stages(saves []core.Continuation) []string {
	var out []string
	for _, c := range saves {
		if len(out) == 0 || out[len(out)-1] != c.Stage {
			out = append(out, c.Stage)
		}
	}
	return out
}

// TestIndependentReviewApprovesTheGreenPass pins the native review kogen-build runs by default
// (review.Independent{} through its delegate): a new review number, one request of the review
// model with the reviewer prompt and tools, the checkpoints of the review stages, the review
// record review-1.json, the run log's review event, the progress lines and the approval of the
// very pass under review (items independent-approve, review-record; kogen-build
// build/review_test.go and the state golden review-approve).
func TestIndependentReviewApprovesTheGreenPass(t *testing.T) {
	t.Parallel()
	b, h := newAttempt(t)
	h.answers = []*provider.Response{submitReview(`{"verdict":"approve","findings":[{"path":"app.txt","line":1,"severity":"note","message":"fine"}]}`)}
	pass := greenPass()
	ap, err := review.Independent{}.Review(context.Background(), b, pass)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "independent-approve review number", b.Review, 1)
	deepEq(t, "independent-approve pass", ap.Pass, pass)
	eq(t, "independent-approve record verdict", ap.Review.Verdict, "approve")
	eq(t, "independent-approve record n", ap.Review.N, 1)
	eq(t, "independent-approve record tree", ap.Review.Tree, greenTree)
	deepEq(t, "independent-approve last review", *b.LastReview, ap.Review)

	eq(t, "independent-approve requests", len(h.requests), 1)
	sp := h.requests[0]
	eq(t, "independent-approve owner", sp.Owner, "review")
	deepEq(t, "independent-approve role", sp.Role, reviewRole)
	eq(t, "independent-approve instructions", sp.Instructions, agent.Prompt(agent.Reviewer))
	var names []string
	for _, d := range sp.Tools {
		if m, ok := d.(map[string]any); ok {
			names = append(names, m["name"].(string))
		}
	}
	if !slices.Contains(names, agent.SubmitReviewTool) {
		t.Errorf("independent-approve tools: %v has no %s", names, agent.SubmitReviewTool)
	}
	deepEq(t, "independent-approve stages", stages(h.saves), []string{core.StageReview, core.StageTool, core.StageReviewVerify})
	deepEq(t, "independent-approve progress", h.progress, []string{"kogen: reviewing (review 1)", "kogen: review 1: approve, 0 blocking"})
	eq(t, "independent-approve material event", h.materials, 1)

	rec := readJSON(t, filepath.Join(b.Run.Dir, review.File(1)))
	for _, key := range []string{"model", "effort", "usage", "verdict", "findings", "tree", "attempts"} {
		if _, ok := rec[key]; !ok {
			t.Errorf("review-record: review-1.json has no %q: %v", key, rec)
		}
	}
	eq(t, "review-record model", rec["model"], any(reviewRole.Model))
	eq(t, "review-record effort", rec["effort"], any(reviewRole.Effort))
	eq(t, "review-record verdict", rec["verdict"], any("approve"))
	eq(t, "review-record tree", rec["tree"], any(greenTree))
	ev := eventsNamed(t, b, "review")
	eq(t, "independent-approve review events", len(ev), 1)
	eq(t, "independent-approve review event verdict", ev[0]["verdict"], any("approve"))
	eq(t, "independent-approve review event pass", ev[0]["pass"], any(float64(1)))
}

// TestIndependentReviewChangesIsTheReviewBlockedStop pins that a changes verdict ends the Build
// with candidate/review_blocked naming each blocking finding, and leaves the verdict in a
// review_verify checkpoint (item independent-blocked; kogen-build build/review_test.go and the
// state golden review-changes).
func TestIndependentReviewChangesIsTheReviewBlockedStop(t *testing.T) {
	t.Parallel()
	b, h := newAttempt(t)
	h.answers = []*provider.Response{submitReview(`{"verdict":"changes","findings":[{"path":"app.txt","line":2,"severity":"blocking","message":"wrong"}]}`)}
	_, err := review.Independent{}.Review(context.Background(), b, greenPass())
	e := wantError(t, "independent-blocked", err, "candidate", "review_blocked")
	eq(t, "independent-blocked exit", e.Exit, 1)
	deepEq(t, "independent-blocked lines", e.Lines, []string{"review: app.txt:2: wrong"})
	eq(t, "independent-blocked last review", b.LastReview.Verdict, "changes")
	last := h.saves[len(h.saves)-1]
	eq(t, "independent-blocked stage", last.Stage, core.StageReviewVerify)
	s, err := review.DecodeSession(last.Review)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "independent-blocked session verdict", s.Verdict.Verdict, "changes")
	eq(t, "independent-blocked session tree", s.Tree, greenTree)
}

// TestIndependentReviewWithoutAVerdictIsHandedToTheBuild pins the end of a review without a
// valid verdict: a prose-only turn is reminded once, the second ends the review, the Build gets
// the InvalidEnd (core.Host.Invalid) and the stop is review.InvalidError (item
// independent-invalid; kogen-build build/k_reviewretry_test.go and review_retry.go).
func TestIndependentReviewWithoutAVerdictIsHandedToTheBuild(t *testing.T) {
	t.Parallel()
	b, h := newAttempt(t)
	h.answers = []*provider.Response{prose("looks fine"), prose("still fine")}
	_, err := review.Independent{}.Review(context.Background(), b, greenPass())
	wantError(t, "independent-invalid", err, "candidate", "review_invalid")
	eq(t, "independent-invalid requests", len(h.requests), 2)
	eq(t, "independent-invalid reminder forces submit_review", h.requests[1].ForceTool, agent.SubmitReviewTool)
	if h.invalid == nil {
		t.Fatal("independent-invalid: the Build was not handed the review")
	}
	eq(t, "independent-invalid review", h.invalid.Review, 1)
	eq(t, "independent-invalid reason", h.invalid.Reason, "no_tool_reminder_exhausted")
	eq(t, "independent-invalid no-tool reminders", h.invalid.NoToolReminder, 1)
	eq(t, "independent-invalid pass", h.invalid.Pass.Tree, greenTree)
	eq(t, "independent-invalid last review", b.LastReview.Verdict, "invalid")
}

// TestIndependentResumeJudgesTheSavedVerdict pins Resume of a review_verify checkpoint: the
// saved approval is judged again on the current tree without a new request, and a checkpoint
// whose review state cannot be read is refused (item independent-resume; kogen-build
// build/resume_test.go and the state golden resumed).
func TestIndependentResumeJudgesTheSavedVerdict(t *testing.T) {
	t.Parallel()
	b, h := newAttempt(t)
	pass := greenPass()
	raw, err := review.Session{Role: reviewRole, Usage: core.ZeroTokens(), Seen: greenTree, Tree: greenTree,
		Verdict: &review.Verdict{Verdict: "approve"}}.Encode()
	if err != nil {
		t.Fatal(err)
	}
	b.Review = 1
	b.Continuation = core.Continuation{Stage: core.StageReviewVerify, Pass: &pass, Base: &pass, Review: raw}
	ap, err := review.Independent{}.Resume(context.Background(), b)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "independent-resume requests", len(h.requests), 0)
	eq(t, "independent-resume verdict", ap.Review.Verdict, "approve")
	eq(t, "independent-resume review number", ap.Review.N, 1)
	deepEq(t, "independent-resume pass", ap.Pass, pass)

	b2, _ := newAttempt(t)
	b2.Continuation = core.Continuation{Stage: core.StageReview, Pass: &pass, Review: []byte(`{"attempts":"no"}`)}
	_, err = review.Independent{}.Resume(context.Background(), b2)
	wantError(t, "independent-resume refused", err, "candidate", "resume_refused")
}

// TestIndependentApprovalOfAnUnverifiedTreeIsVerifiedFirst pins the exact-tree rule: an approval
// of a tree that is not the green pass's is verified by the Build (core.Host.Verify); the changed
// contents, which the reviewer was not given, go back to the same reviewer with their diff, and
// only its approval of the verified tree binds (item independent-exact-tree; kogen-build
// build/review_test.go).
func TestIndependentApprovalOfAnUnverifiedTreeIsVerifiedFirst(t *testing.T) {
	t.Parallel()
	b, h := newAttempt(t)
	h.tree = otherTree // the candidate changed after the green pass
	h.answers = []*provider.Response{submitReview(`{"verdict":"approve","findings":[]}`), submitReview(`{"verdict":"approve","findings":[]}`)}
	h.verifies = []verify.Pass{{N: 2, Clean: true, Green: true, Tree: otherTree}}
	ap, err := review.Independent{}.Review(context.Background(), b, greenPass())
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "independent-exact-tree verified", len(h.verifies), 0)
	eq(t, "independent-exact-tree requests", len(h.requests), 2)
	eq(t, "independent-exact-tree repairs", b.Repairs, 1)
	eq(t, "independent-exact-tree pass", ap.Pass.N, 2)
	eq(t, "independent-exact-tree tree", ap.Review.Tree, otherTree)
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
