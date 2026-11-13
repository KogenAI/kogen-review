package contract

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-coordinator/route"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-loop/sys"
	"github.com/KogenAI/kogen-loop/tools"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
)

// ceilingEnv is a fake Env without a working window: like the provider client it refuses, before
// sending, every request that does not fit the request ceiling (candidate/context_budget_exceeded).
// opening is the size of the filler of the mandatory opening; refuseNext refuses that many
// requests whatever their size.
type ceilingEnv struct {
	*fakeEnv
	opening    int
	refuseNext int
	readAll    bool
	inputs     [][]any
	sessions   []review.Session
	refusals   []error
	sent       int
}

func (h *ceilingEnv) Prepare(tree string, m review.MaterialSet, role project.Role, instructions string, defs, diagnostic []any) ([]any, error) {
	return []any{map[string]any{"role": "user", "content": "OPENING " + strings.Repeat("o", h.opening)}}, nil
}

// Unread: the part "a" is read once a read output of app.txt (it contains "candidate") has been
// answered by a later model item; the part "b" is never read.
func (h *ceilingEnv) Unread(input []any) ([]string, error) {
	if h.readAll {
		return nil, nil
	}
	seen := false
	for _, item := range input {
		m, _ := item.(map[string]any)
		if seen && (m["type"] == "function_call" || m["role"] == "assistant") {
			return []string{"b"}, nil
		}
		if out, _ := m["output"].(string); m["type"] == "function_call_output" && strings.Contains(out, "candidate") {
			seen = true
		}
	}
	return []string{"a", "b"}, nil
}

func (h *ceilingEnv) Request(ctx context.Context, r review.Request) (*provider.Response, []any, error) {
	body := (&provider.Client{}).Body(provider.Request{Role: review.ProviderRole(r.Role), Instructions: r.Instructions, Input: r.Input, Tools: r.Tools, ToolChoice: r.ForceTool})
	m, err := tools.Measure(body, review.ProviderRole(r.Role))
	if err != nil {
		return nil, nil, err
	}
	raw, err := r.Retain(r.Input)
	if err != nil {
		return nil, nil, err
	}
	s, err := review.DecodeSession(raw)
	if err != nil {
		return nil, nil, err
	}
	h.inputs = append(h.inputs, r.Input)
	h.sessions = append(h.sessions, s)
	if h.refuseNext > 0 || !m.Fits {
		if h.refuseNext > 0 {
			h.refuseNext--
		}
		e := sys.Fail("candidate", "context_budget_exceeded", fmt.Sprintf("fixture: request %d bytes; ceiling %d; nothing was sent", m.RenderedBytes, m.InputBudgetBytes), 1)
		h.refusals = append(h.refusals, e)
		return nil, nil, e
	}
	h.sent++
	return h.fakeEnv.Request(ctx, r)
}

func newCeilingReview(t *testing.T, opening int) (review.Input, *ceilingEnv) {
	in, base := newReview(t)
	return in, &ceilingEnv{fakeEnv: base, opening: opening}
}

// filler is a model answer that alone outgrows the request ceiling, followed by calls.
func filler(calls ...map[string]any) *provider.Response {
	items := []map[string]any{{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": strings.Repeat("w", 525000)}}}}
	return &provider.Response{Items: append(items, calls...), Usage: provider.Usage{Input: 10, Output: 2}}
}

func call(id, name, args string) map[string]any {
	return map[string]any{"type": "function_call", "call_id": id, "name": name, "arguments": args}
}

func answer(calls ...map[string]any) *provider.Response {
	return &provider.Response{Items: calls, Usage: provider.Usage{Input: 10, Output: 2}}
}

const (
	approve        = `{"verdict":"approve","findings":[]}`
	resetHeader    = "Kogen review working-context reset\n"
	oneUnreadB     = "invalid verdict:\nRead all pinned source evidence before approving: 1 unread part(s); use read_file on b"
	twoUnreadAandB = "invalid verdict:\nRead all pinned source evidence before approving: 2 unread part(s); use read_file on a, b"
	resetNote      = "Kogen reset this review's working context because the next request did not fit the request ceiling. " +
		"The earlier conversation is archived in custody (window) and is not repeated. " +
		"The opening messages above are complete and unchanged: the authority, and the candidate source or its pinned catalog. " +
		"Pinned parts whose reads already reached you stay counted for verdict validation; unread_parts is how many remain unread: read them with read_file. " +
		"Tool results and images of the archived conversation are not repeated: run again what you still need. " +
		"Any messages after this one are Kogen's newest messages of the archived conversation, which had not reached you yet."
)

func handoffOf(t *testing.T, input []any) map[string]any {
	t.Helper()
	for _, item := range input {
		m, _ := item.(map[string]any)
		if text, _ := m["content"].(string); strings.HasPrefix(text, resetHeader) {
			var doc map[string]any
			if err := json.Unmarshal([]byte(strings.TrimPrefix(text, resetHeader)), &doc); err != nil {
				t.Fatal(err)
			}
			return doc
		}
	}
	return nil
}

func outputs(input []any, prefix string) int {
	n := 0
	for _, item := range input {
		m, _ := item.(map[string]any)
		if out, _ := m["output"].(string); strings.HasPrefix(out, prefix) {
			n++
		}
	}
	return n
}

// TestReviewResetsItsWorkingContextAfterACeilingRefusal pins the reviewer's own reset: the Env
// refuses the whole conversation, and the request sent again is the unchanged opening and one
// handoff, with the replaced conversation archived in custody, recorded and counted; a read that
// reached the model stays read and an unread part still blocks approval (items reset-after-refusal,
// reset-read-state).
func TestReviewResetsItsWorkingContextAfterACeilingRefusal(t *testing.T) {
	t.Parallel()
	in, h := newCeilingReview(t, 1000)
	h.answers = []*provider.Response{
		answer(call("call-read", "read_file", `{"path":"app.txt"}`)),
		filler(call("call-list", "list_files", `{"path":"."}`)),
		answer(call("call-submit-1", "submit_review", approve)),
		answer(call("call-submit-2", "submit_review", approve)),
	}
	res, err := review.Independent{}.Review(context.Background(), in, h)
	wantError(t, "reset-after-refusal stop", err, "candidate", "review_invalid")
	if res.Invalid == nil {
		t.Fatal("reset-after-refusal: no Invalid")
	}

	eq(t, "reset-after-refusal refusals", len(h.refusals), 1)
	eq(t, "reset-after-refusal sent", h.sent, 4)
	eq(t, "reset-after-refusal requests", len(h.inputs), 5+0)
	refused, sent := h.inputs[2], h.inputs[3]
	eq(t, "reset-after-refusal refused items", len(refused), 6)
	eq(t, "reset-after-refusal sent items", len(sent), 2)
	deepEq(t, "reset-after-refusal opening", sent[0], refused[0])
	doc := handoffOf(t, sent)
	if doc == nil {
		t.Fatal("reset-after-refusal: no handoff")
	}
	eq(t, "reset-after-refusal handoff version", doc["version"], any(float64(1)))
	eq(t, "reset-after-refusal handoff review", doc["review"], any(float64(1)))
	eq(t, "reset-after-refusal handoff unread parts", doc["unread_parts"], any(float64(1)))
	eq(t, "reset-after-refusal handoff note", doc["note"], any(resetNote))
	if text := fmt.Sprint(sent); strings.Contains(text, "www") || strings.Contains(text, "call-read") || strings.Contains(text, "call-list") {
		t.Error("reset-after-refusal: the replaced conversation was carried")
	}

	// The custody record is the refused conversation, and its hash is recorded.
	file := "review-1-window-1.json"
	data, err := os.ReadFile(filepath.Join(h.dir, file))
	if err != nil {
		t.Fatal(err)
	}
	var archived struct{ Input []any }
	if err := json.Unmarshal(data, &archived); err != nil {
		t.Fatal(err)
	}
	deepEq(t, "reset-after-refusal custody record", archived.Input, refused)
	canon, err := core.EncodeJSON(map[string]any{"input": refused})
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(canon)
	want := hex.EncodeToString(sum[:])
	deepEq(t, "reset-after-refusal handoff window", doc["window"], any(map[string]any{"file": file, "sha256": want}))
	deepEq(t, "reset-after-refusal session windows", h.sessions[3].Windows, []review.Window{{File: file, SHA256: want}})
	deepEq(t, "reset-after-refusal session reset_unread", h.sessions[3].ResetUnread, []string{"b"})
	eq(t, "reset-after-refusal requests counted once", h.sessions[3].Requests, h.sessions[2].Requests)

	events := eventsNamed(t, h.fakeEnv, "review_window_reset")
	eq(t, "reset-after-refusal events", len(events), 1)
	e := events[0]
	eq(t, "reset-after-refusal event review", e["review"], any(1))
	eq(t, "reset-after-refusal event window", e["window"], any(file))
	eq(t, "reset-after-refusal event trigger", e["trigger"], any("list_files"))
	before, after, mandatory, handoff, ceiling := e["bytes_before"].(int), e["bytes_after"].(int), e["mandatory_bytes"].(int), e["handoff_bytes"].(int), e["ceiling"].(int)
	eq(t, "reset-after-refusal event handoff bytes", handoff, after-mandatory)
	if before <= ceiling || after > ceiling || handoff <= 0 || handoff > 2048 {
		t.Errorf("reset-after-refusal event: %v", e)
	}
	wantProgress := fmt.Sprintf("kogen: review 1: working-context reset %d -> %d bytes (mandatory %d, handoff %d; ceiling %d); archived %s",
		before, after, mandatory, handoff, ceiling, file)
	if !slices.Contains(h.progress, wantProgress) {
		t.Errorf("reset-after-refusal progress: %q not in %q", wantProgress, h.progress)
	}

	// The read of app.txt reached the model before the reset: only part b is unread.
	eq(t, "reset-read-state rejections", outputs(h.inputs[4], "invalid verdict"), 1)
	eq(t, "reset-read-state rejection text", outputs(h.inputs[4], oneUnreadB), 1)
}

// An undelivered read stays unread after a reset: its output did not reach the model.
func TestAnUndeliveredReadStaysUnreadAfterAReset(t *testing.T) {
	t.Parallel()
	in, h := newCeilingReview(t, 1000)
	h.answers = []*provider.Response{
		filler(call("call-read", "read_file", `{"path":"app.txt"}`)),
		answer(call("call-submit-1", "submit_review", approve)),
		answer(call("call-submit-2", "submit_review", approve)),
	}
	_, err := review.Independent{}.Review(context.Background(), in, h)
	wantError(t, "reset-read-state stop", err, "candidate", "review_invalid")
	eq(t, "reset-read-state refusals", len(h.refusals), 1)
	doc := handoffOf(t, h.inputs[2])
	if doc == nil {
		t.Fatal("reset-read-state: no handoff")
	}
	eq(t, "reset-read-state handoff unread parts", doc["unread_parts"], any(float64(2)))
	deepEq(t, "reset-read-state session reset_unread", h.sessions[2].ResetUnread, []string{"a", "b"})
	eq(t, "reset-read-state rejection text", outputs(h.inputs[3], twoUnreadAandB), 1)
}

// Feedback that had not reached the model is carried once; the budget of requests is not spent.
func TestRejectedVerdictFeedbackIsCarriedOnceAcrossResets(t *testing.T) {
	t.Parallel()
	in, h := newCeilingReview(t, 1000)
	h.readAll = true
	h.answers = []*provider.Response{
		answer(call("call-read", "read_file", `{"path":"app.txt"}`)),
		filler(call("call-submit-1", "submit_review", `{"verdict":"approve","findings":[{"path":"missing.txt","line":1,"severity":"note","message":"m"}]}`)),
		answer(call("call-list", "list_files", `{"path":"."}`)),
		answer(call("call-submit-2", "submit_review", `{"verdict":"changes","findings":[{"path":"app.txt","line":1,"severity":"blocking","message":"m"}]}`)),
	}
	_, err := review.Independent{}.Review(context.Background(), in, h)
	wantError(t, "reset-feedback stop", err, "candidate", "review_blocked")
	eq(t, "reset-feedback refusals", len(h.refusals), 1)
	sent := h.inputs[3]
	eq(t, "reset-feedback sent items", len(sent), 3)
	eq(t, "reset-feedback carried once", strings.Count(fmt.Sprint(sent), "missing.txt is not a file of the repository"), 1)
	m, _ := sent[2].(map[string]any)
	eq(t, "reset-feedback role", m["role"], any("user"))
	// The conversation goes on from the reset request without repeating it.
	eq(t, "reset-feedback not repeated", strings.Count(fmt.Sprint(h.inputs[4]), "missing.txt is not a file of the repository"), 1)
}

// A request the Env refuses again after the reset ends the review with that refusal: no second
// reset. Mandatory material that does not fit ends it with the Env's own refusal, unchanged,
// writing no record (items reset-refused-again, reset-mandatory).
func TestAReviewStopsOnTheEnvsRefusalWhenItCannotBeResolvedByAReset(t *testing.T) {
	t.Parallel()
	in, h := newCeilingReview(t, 1000)
	h.refuseNext = 2
	_, err := review.Independent{}.Review(context.Background(), in, h)
	if err == nil || len(h.refusals) != 2 || err != h.refusals[1] {
		t.Fatalf("reset-refused-again: error %v, refusals %v", err, h.refusals)
	}
	wantError(t, "reset-refused-again stop", err, "candidate", "context_budget_exceeded")
	eq(t, "reset-refused-again requests", len(h.inputs), 2)
	eq(t, "reset-refused-again events", len(eventsNamed(t, h.fakeEnv, "review_window_reset")), 1)
	if _, err := os.Stat(filepath.Join(h.dir, "review-1-window-2.json")); err == nil {
		t.Error("reset-refused-again: a second custody record was written")
	}

	in, h = newCeilingReview(t, 600000)
	_, err = review.Independent{}.Review(context.Background(), in, h)
	if err == nil || len(h.refusals) != 1 || err != h.refusals[0] {
		t.Fatalf("reset-mandatory: error %v, refusals %v", err, h.refusals)
	}
	eq(t, "reset-mandatory events", len(eventsNamed(t, h.fakeEnv, "review_window_reset")), 0)
	entries, _ := os.ReadDir(h.dir)
	for _, e := range entries {
		if strings.Contains(e.Name(), "window") {
			t.Errorf("reset-mandatory: %s written", e.Name())
		}
	}
	saved, err := review.DecodeSession(h.saves[len(h.saves)-1].Session)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "reset-mandatory windows", len(saved.Windows), 0)
}

// Other errors are returned as they are, and a request the Env accepts is sent unchanged.
func TestOnlyACeilingRefusalTriggersAReset(t *testing.T) {
	t.Parallel()
	in, base := newReview(t)
	h := &failingEnv{fakeEnv: base, err: sys.Fail("provider", "context_too_long", "rejected after sending", 4)}
	_, err := review.Independent{}.Review(context.Background(), in, h)
	wantError(t, "reset-trigger stop", err, "provider", "context_too_long")
	eq(t, "reset-trigger events", len(eventsNamed(t, base, "review_window_reset")), 0)
	eq(t, "reset-trigger requests", len(base.requests), 1)
}

type failingEnv struct {
	*fakeEnv
	err error
}

func (h *failingEnv) Request(_ context.Context, r review.Request) (*provider.Response, []any, error) {
	h.requests = append(h.requests, r)
	return nil, nil, h.err
}

// TestResetFieldsSurviveTheRetryReconstruction pins that Windows and ResetUnread travel through
// the session a retry reopens, and that a session that never reset keeps its bytes (item
// reset-persistence).
func TestResetFieldsSurviveTheRetryReconstruction(t *testing.T) {
	t.Parallel()
	in, h := newReview(t)
	pass := verify.Pass{N: 4, Tree: greenTree, Failing: []string{"check:lint"}}
	blocked := review.Verdict{Verdict: "changes", Findings: []map[string]any{{"path": "app.txt", "line": 1, "severity": "blocking", "message": "m"}}}
	windows := []review.Window{{File: "review-1-window-1.json", SHA256: strings.Repeat("a", 64)}}
	raw, err := (review.Session{Role: reviewRole, Usage: core.ZeroTokens(), Input: []any{map[string]any{"role": "user", "content": "prior"}},
		Seen: greenTree, Tree: greenTree, Verdict: &blocked, Windows: windows, ResetUnread: []string{"b"}}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	in.Checkpoint = &review.Checkpoint{Stage: route.StageReviewVerify, Pass: &pass, Session: raw}
	h.verifies = []verify.Pass{{N: 5, Tree: greenTree, Green: true}}
	h.answers = []*provider.Response{submitReview(approve)}
	_, err = review.Independent{}.Resume(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	for i, save := range h.saves {
		s, err := review.DecodeSession(save.Session)
		if err != nil {
			t.Fatal(err)
		}
		if save.Stage == route.StageReview {
			deepEq(t, fmt.Sprintf("reset-persistence save %d windows", i), s.Windows, windows)
			deepEq(t, fmt.Sprintf("reset-persistence save %d reset_unread", i), s.ResetUnread, []string{"b"})
		}
	}
}

// TestResetFieldsSurviveTheRepairReconstruction pins that Windows and ResetUnread travel through
// the session a repair round rebuilds, and that a reset after Kogen's own feedback message is
// recorded with the trigger feedback, archived as the next window and carries that feedback once
// (items reset-persistence, reset-after-refusal).
func TestResetFieldsSurviveTheRepairReconstruction(t *testing.T) {
	t.Parallel()
	in, h := newCeilingReview(t, 1000)
	h.readAll = true
	red := verify.Pass{N: 2, Tree: greenTree, Failing: []string{"check:lint"}}
	windows := []review.Window{{File: "review-1-window-1.json", SHA256: strings.Repeat("a", 64)}}
	raw, err := (review.Session{Role: reviewRole, Usage: core.ZeroTokens(), Input: []any{map[string]any{"role": "user", "content": "prior"}},
		Seen: greenTree, Windows: windows, ResetUnread: []string{"b"}}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	in.Checkpoint = &review.Checkpoint{Stage: route.StageReview, Pass: &red, Session: raw}
	h.verifies = []verify.Pass{{N: 3, Tree: greenTree, Failing: []string{"check:lint"}}, {N: 4, Tree: greenTree, Green: true}}
	h.answers = []*provider.Response{filler(call("call-submit-1", "submit_review", approve)), submitReview(approve)}
	res, err := review.Independent{}.Resume(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "reset-repair verdict", res.Record.Verdict, "approve")
	eq(t, "reset-repair refusals", len(h.refusals), 1)

	// The repair round's session, checkpointed before the refused request, kept the reset fields.
	deepEq(t, "reset-repair refused windows", h.sessions[1].Windows, windows)
	deepEq(t, "reset-repair refused reset_unread", h.sessions[1].ResetUnread, []string{"b"})
	eq(t, "reset-repair refused repair rounds", h.sessions[1].RepairRounds, 1)

	file := "review-1-window-2.json"
	events := eventsNamed(t, h.fakeEnv, "review_window_reset")
	eq(t, "reset-repair events", len(events), 1)
	eq(t, "reset-repair trigger", events[0]["trigger"], any("feedback"))
	eq(t, "reset-repair window", events[0]["window"], any(file))
	eq(t, "reset-repair windows", len(h.sessions[2].Windows), 2)
	eq(t, "reset-repair newest window", h.sessions[2].Windows[1].File, file)
	eq(t, "reset-repair reset_unread", len(h.sessions[2].ResetUnread), 0)
	eq(t, "reset-repair feedback carried once", strings.Count(fmt.Sprint(h.inputs[2]), "Final verification of your repairs failed"), 1)
	if strings.Contains(fmt.Sprint(h.inputs[2]), "www") {
		t.Error("reset-repair: the replaced conversation was carried")
	}
}

// TestAResumedPostResetRefusalKeepsItsFeedback pins that a window with no model item (a resumed
// post-reset conversation the Env refuses again) treats the items after its handoff as pending:
// the request sent after the reset carries the rejected-verdict feedback once, after the new
// handoff (item reset-read-state).
func TestAResumedPostResetRefusalKeepsItsFeedback(t *testing.T) {
	t.Parallel()
	in, h := newCeilingReview(t, 1000)
	h.readAll = true
	h.refuseNext = 1
	const rejection = "invalid verdict:\nmissing.txt is not a file of the repository"
	opening := map[string]any{"role": "user", "content": "OPENING " + strings.Repeat("o", 1000)}
	file := "review-1-window-1.json"
	windows := []review.Window{{File: file, SHA256: strings.Repeat("a", 64)}}
	note, err := core.EncodeJSON(map[string]any{"version": 1, "review": 1, "window": map[string]any{"file": file, "sha256": windows[0].SHA256}, "unread_parts": 0, "note": resetNote})
	if err != nil {
		t.Fatal(err)
	}
	handoff := map[string]any{"role": "user", "content": resetHeader + string(note)}
	feedback := map[string]any{"role": "user", "content": rejection}
	pass := greenPass()
	raw, err := (review.Session{Role: reviewRole, Usage: core.ZeroTokens(), Input: []any{opening, handoff, feedback},
		Seen: greenTree, Windows: windows}).Encode()
	if err != nil {
		t.Fatal(err)
	}
	in.Checkpoint = &review.Checkpoint{Stage: route.StageReview, Pass: &pass, Session: raw}
	h.answers = []*provider.Response{answer(call("call-submit", "submit_review", approve))}
	_, err = review.Independent{}.Resume(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}

	eq(t, "reset-resumed refusals", len(h.refusals), 1)
	sent := h.inputs[1]
	eq(t, "reset-resumed sent items", len(sent), 3)
	deepEq(t, "reset-resumed opening", sent[0], any(opening))
	doc := handoffOf(t, sent)
	if doc == nil {
		t.Fatal("reset-resumed: no handoff")
	}
	deepEq(t, "reset-resumed handoff window", doc["window"].(map[string]any)["file"], any("review-1-window-2.json"))
	deepEq(t, "reset-resumed rejection", sent[2], any(feedback))
	eq(t, "reset-resumed carried once", strings.Count(fmt.Sprint(sent), rejection), 1)
	events := eventsNamed(t, h.fakeEnv, "review_window_reset")
	eq(t, "reset-resumed events", len(events), 1)
	eq(t, "reset-resumed trigger", events[0]["trigger"], any("feedback"))
}
