package contract

import (
	"context"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-coordinator/route"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
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
	eq(t, "independent-invalid prose turns", res.Invalid.ProseTurns, 2)
	eq(t, "independent-invalid forced requests", res.Invalid.ForcedRequests, 1)
	eq(t, "independent-invalid forced answered", res.Invalid.ForcedAnswered, 0)
	eq(t, "independent-invalid route", res.Invalid.Route, "chatgpt")
	eq(t, "independent-invalid model", res.Invalid.Model, "fixture-review-model")
	eq(t, "independent-invalid tool choice", res.Invalid.ToolChoice, "api_forced")
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
	writeFile(t, filepath.Join(in.Candidate.Root, "app.txt"), otherText) // the candidate changed after the green pass
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
		!strings.Contains(content, "diff --git a/app.txt b/app.txt") || !strings.Contains(content, "-candidate\n+"+otherText) {
		t.Errorf("independent-exact-tree feedback: %q", content)
	}
	if !slices.Contains(h.progress, "kogen: review 1: the candidate changed after its contents were delivered; returning the changes to the reviewer") {
		t.Errorf("independent-exact-tree progress: %q", h.progress)
	}
}

// TestIndependentRepairRoundCarriesTheReminderCount pins that a repair round keeps the
// reminders and counters of the review (item independent-prose-carry): a prose-only turn after
// the repair feedback is reminded while under the cap, and the cap counts the reminders of the
// earlier conversation, so the third prose-only turn after the repair ends the review.
func TestIndependentRepairRoundCarriesTheReminderCount(t *testing.T) {
	t.Parallel()
	in, h := newReview(t)
	writeFile(t, filepath.Join(in.Candidate.Root, "app.txt"), otherText)
	h.answers = []*provider.Response{
		prose("fine"), // reminder 1
		submitReview(`{"verdict":"approve","findings":[]}`), // an unverified tree: a repair round
		prose("fine"), // reminder 2
		readFile("app.txt"),
		prose("fine"), // reminder 3
		readFile("app.txt"),
		prose("fine"), // the cap
		submitReview(`{"verdict":"approve","findings":[]}`),
	}
	h.verifies = []verify.Pass{{N: 2, Clean: true, Green: true, Tree: otherTree}}
	res, err := review.Independent{}.Review(context.Background(), in, h)
	wantError(t, "independent-prose-carry", err, "candidate", "review_invalid")
	eq(t, "independent-prose-carry requests", len(h.requests), 7)
	eq(t, "independent-prose-carry reminder forces submit_review", h.requests[3].ForceTool, review.SubmitReviewTool)
	if res.Invalid == nil {
		t.Fatal("independent-prose-carry: the review's Invalid is missing")
	}
	eq(t, "independent-prose-carry reason", res.Invalid.Reason, "no_tool_reminder_cap")
	eq(t, "independent-prose-carry reminders", res.Invalid.NoToolReminder, 3)
	eq(t, "independent-prose-carry prose turns", res.Invalid.ProseTurns, 4)
	eq(t, "independent-prose-carry forced requests", res.Invalid.ForcedRequests, 3)
	eq(t, "independent-prose-carry forced answered", res.Invalid.ForcedAnswered, 3)
	eq(t, "independent-prose-carry repaired", res.Invalid.Repaired, true)
}

// shellCall is a model answer calling shell with command.
func shellCall(command string) *provider.Response {
	return &provider.Response{Items: []map[string]any{{
		"type": "function_call", "call_id": "call-shell", "name": "shell", "arguments": `{"command":"` + command + `"}`,
	}}, Usage: provider.Usage{Input: 10, Output: 2}}
}

// TestIndependentReviewRecordsItsProbesAndRequirements pins that the native review records the
// command of each shell call in Session.Probes, keeps it in the checkpoint and carries it through
// a repair round, that a probe it ran may be cited, and that review-1.json keeps the
// requirements, [] when the submission had none, together with the exit status and tree of each
// call in Session.ProbeRuns (items session-probes, session-probe-runs, review-requirements).
func TestIndependentReviewRecordsItsProbesAndRequirements(t *testing.T) {
	t.Parallel()
	in, h := newReview(t)
	h.answers = []*provider.Response{shellCall("cat app.txt"), submitReview(`{"verdict":"approve","findings":[]}`)}
	if _, err := (review.Independent{}).Review(context.Background(), in, h); err != nil {
		t.Fatal(err)
	}
	s, err := review.DecodeSession(h.saves[len(h.saves)-1].Session)
	if err != nil {
		t.Fatal(err)
	}
	deepEq(t, "session-probes checkpoint", s.Probes, []string{"cat app.txt"})
	zero := 0
	deepEq(t, "session-probe-runs checkpoint", s.ProbeRuns, []review.ProbeRun{{Command: "cat app.txt", Status: &zero, Tree: greenTree}})
	rec := readJSON(t, filepath.Join(in.Run.Dir, review.File(1)))
	deepEq(t, "review-requirements empty", rec["requirements"], any([]any{}))

	// A repair round carries the probes forward, and a probe cited after it has run is accepted.
	in, h = newReview(t)
	writeFile(t, filepath.Join(in.Candidate.Root, "app.txt"), otherText)
	const cited = `{"verdict":"approve","findings":[],"requirements":[{"requirement":"R1","evidence":"probe","ref":"cat app.txt","met":true}]}`
	h.answers = []*provider.Response{shellCall("cat app.txt"), submitReview(cited), submitReview(cited)}
	h.verifies = []verify.Pass{{N: 2, Clean: true, Green: true, Tree: otherTree}}
	ap, err := review.Independent{}.Review(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "session-probes repaired requests", len(h.requests), 3)
	eq(t, "session-probes repaired record", ap.Record.Verdict, "approve")
	var carried bool
	for _, c := range h.saves {
		if s, err := review.DecodeSession(c.Session); err == nil && s.Repaired && slices.Equal(s.Probes, []string{"cat app.txt"}) && len(s.ProbeRuns) == 1 && len(s.Listed) == 1 {
			if s.Requests < 2 {
				t.Errorf("repair feedback lost request count: %d", s.Requests)
			}
			carried = true
		}
	}
	if !carried {
		t.Error("session-probes: no checkpoint after the repair round kept the probes")
	}
	rec = readJSON(t, filepath.Join(in.Run.Dir, review.File(1)))
	reqs, _ := rec["requirements"].([]any)
	eq(t, "review-requirements entries", len(reqs), 1)
}

// lastOutput is the text of the last item of a request's input: the tool result it ends with.
func lastOutput(r review.Request) string {
	m, _ := r.Input[len(r.Input)-1].(map[string]any)
	out, _ := m["output"].(string)
	return out
}

// TestIndependentReviewJudgesACitedProbeByItsLatestRun pins that a probe cited after the tree
// changed since its latest run is refused with both trees, that running it again on the current
// tree establishes the requirement, and that the refused listing keeps the requirement from a
// later approval that drops it, whether requirements are absent or the entry is missing (items
// validate-evidence, session-listed).
func TestIndependentReviewJudgesACitedProbeByItsLatestRun(t *testing.T) {
	t.Parallel()
	const cited = `{"verdict":"approve","findings":[],"requirements":[{"requirement":"R1","evidence":"probe","ref":"cat app.txt","met":true}]}`
	in, h := newReview(t)
	edit := shellCall("printf '%s\\n' 'candidate, edited after the green pass' > app.txt")
	h.answers = []*provider.Response{shellCall("cat app.txt"), edit, submitReview(cited), shellCall("cat app.txt"), submitReview(cited)}
	h.verifies = []verify.Pass{{N: 2, Clean: true, Green: true, Tree: otherTree}}
	res, err := review.Independent{}.Review(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "validate-evidence older tree requests", len(h.requests), 5)
	eq(t, "validate-evidence older tree refusal", lastOutput(h.requests[3]), `invalid verdict:
requirement "R1" cites probe "cat app.txt", whose latest run in this review was on tree `+greenTree+`, not on the current tree `+otherTree+`: run it again on the current tree before citing it`)
	eq(t, "validate-evidence older tree verdict", res.Record.Verdict, "approve")

	for name, second := range map[string]string{
		"absent":  `{"verdict":"approve","findings":[]}`,
		"missing": `{"verdict":"approve","findings":[],"requirements":[{"requirement":"R2","evidence":"test","ref":"t","met":true}]}`,
	} {
		in, h := newReview(t)
		h.answers = []*provider.Response{submitReview(cited), submitReview(second)}
		res, err := review.Independent{}.Review(context.Background(), in, h)
		wantError(t, "session-listed "+name, err, "candidate", "review_invalid")
		const dropped = `requirement "R1" was listed by an earlier submission of this review and is missing: keep every requirement in requirements, with evidence observed on the current tree`
		eq(t, "session-listed "+name+" refusal", lastOutput(h.requests[1]), "invalid verdict:\nrequirement \"R1\" cites a probe that did not run in this review: run its command with shell before citing it")
		if res.Invalid == nil || !slices.Contains(res.Invalid.Problems, dropped) {
			t.Errorf("session-listed %s: the missing requirement was not a problem: %+v", name, res.Invalid)
		}
		s, err := review.DecodeSession(h.saves[len(h.saves)-1].Session)
		if err != nil {
			t.Fatal(err)
		}
		deepEq(t, "session-listed "+name+" checkpoint", s.Listed, []string{"R1"})
	}
}

func TestThirdRequestSequence(t *testing.T) {
	in, h := newReview(t)
	h.answers = []*provider.Response{shellCall("echo one"), shellCall("echo two"), submitReview(`{"verdict":"approve","findings":[]}`)}
	if _, err := (review.Independent{}).Review(context.Background(), in, h); err != nil {
		t.Fatal(err)
	}
	if len(h.requests) != 3 {
		t.Fatalf("requests: %d", len(h.requests))
	}
	initial := h.requests[0].Input
	if len(initial) != 1 {
		t.Fatalf("initial input: %d items", len(initial))
	}
	expected := slices.Clone(initial)
	for i, r := range h.requests {
		deepEq(t, "role", r.Role, reviewRole)
		eq(t, "instructions", r.Instructions, review.ReviewerInstructions())
		deepEq(t, "tools", r.Tools, h.requests[0].Tools)
		eq(t, "force", r.ForceTool, "")
		deepEq(t, "input", r.Input, expected)
		if i < 2 {
			word := []string{"one", "two"}[i]
			expected = slices.Concat(expected, []any{
				map[string]any{"type": "function_call", "call_id": "call-shell", "name": "shell", "arguments": `{"command":"echo ` + word + `"}`},
				map[string]any{"type": "function_call_output", "call_id": "call-shell", "output": "exit status: 0\n" + word + "\n"},
			})
		}
	}
}
