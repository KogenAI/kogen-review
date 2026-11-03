package contract

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-review/review"
)

// TestReviewRecordFileName pins the name of a review's record in the run folder (item
// review-file; kogen-build build/hooks.go writes the stub review's record under it, and its
// state goldens hold review-1.json).
func TestReviewRecordFileName(t *testing.T) {
	t.Parallel()
	eq(t, "review-file 1", review.File(1), "review-1.json")
	eq(t, "review-file 12", review.File(12), "review-12.json")
}

// TestReviewerToolNames pins the native tools the reviewer is given besides submit_review (item
// tool-names; kogen-build build/review_delivery_test.go).
func TestReviewerToolNames(t *testing.T) {
	t.Parallel()
	deepEq(t, "tool-names", review.ToolNames, []string{"read_file", "view_image", "list_files", "search_text", "write_file", "shell"})
}

// TestInvalidErrorIsTheReviewInvalidStop pins the stop of a review that ended without a valid
// verdict (item invalid-stop; kogen-build build/k_reviewretry2_test.go and its retry handling).
func TestInvalidErrorIsTheReviewInvalidStop(t *testing.T) {
	t.Parallel()
	e := wantError(t, "invalid-stop", review.InvalidError(), "candidate", "review_invalid")
	eq(t, "invalid-stop detail", e.Detail, "the reviewer did not return a valid verdict; edits are left in place")
	eq(t, "invalid-stop exit", e.Exit, 1)
}

// sessionJSON is the exact encoding of fullSession, as a checkpoint keeps it in
// continuation.review (item session-json; kogen-build's state goldens review-approve and
// review-changes hold such a session).
const sessionJSON = `{"role":{"Provider":"chatgpt","Model":"fixture-review-model","Effort":"medium"},` +
	`"input":[{"content":"x < y & z","role":"user"}],"usage":{"input":10,"cached":0,"output":2,"reasoning":null},` +
	`"attempts":[{"pass":1,"tree":"1111111111111111111111111111111111111111","verdict":"changes","findings":[{"line":3,"message":"m","path":"app.txt","severity":"blocking"}]}],` +
	`"verdict":{"verdict":"changes","findings":[{"line":3,"message":"m","path":"app.txt","severity":"blocking"}]},` +
	`"tree":"1111111111111111111111111111111111111111","seen_tree":"2222222222222222222222222222222222222222",` +
	`"tools":[{"name":"read_file"}],"rejected_verdicts":1,"no_tool_reminders":1,"remind":true,"prev_unread":2,"reopened":true,"repaired":true}`

// The trees fullSession names: a session's bytes do not depend on the trees existing.
const (
	sessionTree = "1111111111111111111111111111111111111111"
	sessionSeen = "2222222222222222222222222222222222222222"
)

func fullSession() review.Session {
	finding := map[string]any{"path": "app.txt", "line": json.Number("3"), "severity": "blocking", "message": "m"}
	return review.Session{
		Role:     reviewRole,
		Input:    []any{map[string]any{"role": "user", "content": "x < y & z"}},
		Usage:    core.Tokens{Input: core.Count(10), Cached: core.Count(0), Output: core.Count(2)},
		Attempts: []review.Submitted{{Pass: 1, Tree: sessionTree, Verdict: "changes", Findings: []map[string]any{finding}}},
		Verdict:  &review.Verdict{Verdict: "changes", Findings: []map[string]any{finding}},
		Tree:     sessionTree, Seen: sessionSeen, Tools: []any{map[string]any{"name": "read_file"}},
		Rejected: 1, NoTool: 1, Remind: true, PrevUnread: 2, Reopened: true, Repaired: true,
	}
}

// TestSessionEncodesItsCheckpointBytes pins the reviewer session's JSON: keys, order, the
// omitted empty fields, nil lists as [] and no HTML escaping (item session-json; kogen-build
// build/legacy.go encodes the sessions it imports with it, build/state_golden_test.go compares
// them with its goldens).
func TestSessionEncodesItsCheckpointBytes(t *testing.T) {
	t.Parallel()
	raw, err := fullSession().Encode()
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "session-json full", string(raw), sessionJSON)

	// A session of the stage review: no verdict yet, and nil lists encoded as [].
	raw, err = review.Session{Role: project.Role{Model: "m"}, Usage: core.ZeroTokens(),
		Verdict: &review.Verdict{Verdict: "approve"}}.Encode()
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "session-json empty", string(raw),
		`{"role":{"Provider":"","Model":"m","Effort":""},"input":[],"usage":{"input":0,"cached":0,"output":0,"reasoning":0},"attempts":[],"verdict":{"verdict":"approve","findings":[]}}`)
}

// TestDecodeSessionReadsWhatACheckpointKept pins the decoding kogen-build relies on: every field
// round-trips, numbers stay as written (json.Number) and malformed state is an error (item
// session-decode; kogen-build build/review_retry.go reads Verdict.Verdict of a review_verify
// checkpoint, build/legacy_test.go reads the imported sessions).
func TestDecodeSessionReadsWhatACheckpointKept(t *testing.T) {
	t.Parallel()
	s, err := review.DecodeSession(json.RawMessage(sessionJSON))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(s, fullSession()) {
		t.Errorf("session-decode: got %#v, want %#v", s, fullSession())
	}
	eq(t, "session-decode verdict", s.Verdict.Verdict, "changes")
	if _, ok := s.Verdict.Findings[0]["line"].(json.Number); !ok {
		t.Errorf("session-decode: a finding's line is %T, want json.Number", s.Verdict.Findings[0]["line"])
	}
	if _, err := review.DecodeSession(json.RawMessage(`{"attempts":"no"}`)); err == nil {
		t.Error("session-decode: malformed session state decoded without an error")
	}
	if _, err := review.DecodeSession(nil); err == nil {
		t.Error("session-decode: missing session state decoded without an error")
	}
}

// TestMaterialEvidenceJSON pins the keys of an external review's material evidence
// (review-<n>-material.json) that kogen-build's tests read through review.Material and
// review.Part (item material-json; build/review_lineup_test.go, build/review_parts_build_test.go).
func TestMaterialEvidenceJSON(t *testing.T) {
	t.Parallel()
	text := `{"review":2,"tree":"t","authority":{"file":"review-2-authority.txt","bytes":5,"sha256":"aa"},` +
		`"source":{"file":"review-2-source.txt","bytes":7,"sha256":"bb"},"parts":[{"path":"app.txt"}],` +
		`"session_id":"s","delivered":true,"delivered_round":3,"review_parts":[{"part":1,"file":"review-2-part-1.txt",` +
		`"bytes":4,"sha256":"cc","from":0,"to":4,"prompt_bytes":99,"session_id":"s1","delivered":true,"delivered_round":1}]}`
	var m review.Material
	if err := json.Unmarshal([]byte(text), &m); err != nil {
		t.Fatal(err)
	}
	eq(t, "material-json review", m.Review, 2)
	eq(t, "material-json tree", m.Tree, "t")
	eq(t, "material-json authority bytes", m.Authority.Bytes, 5)
	eq(t, "material-json authority sha256", m.Authority.SHA256, "aa")
	eq(t, "material-json source bytes", m.Source.Bytes, 7)
	eq(t, "material-json source sha256", m.Source.SHA256, "bb")
	deepEq(t, "material-json parts", m.Parts, []map[string]any{{"path": "app.txt"}})
	eq(t, "material-json session_id", m.Session, "s")
	eq(t, "material-json delivered", m.Delivered, true)
	eq(t, "material-json delivered_round", m.Round, 3)
	deepEq(t, "material-json review_parts", m.ReviewParts, []review.Part{{Part: 1, File: "review-2-part-1.txt", Bytes: 4, SHA256: "cc",
		From: 0, To: 4, PromptBytes: 99, SessionID: "s1", Delivered: true, DeliveredRound: 1}})
	back, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	var a, b any
	json.Unmarshal([]byte(text), &a)
	json.Unmarshal(back, &b)
	deepEq(t, "material-json round trip", b, a)
}

// TestReviewerPolicy pins the reviewer's model-facing names that kogen-executor's contract
// pinned while executor held them: the submission tool's name and definition, and the
// instructions carrying the limit-raise rule once (item reviewer-policy; kogen-build
// build/review_lineup_test.go, review_test.go, cache_id_test.go and kogen cli's review tests).
func TestReviewerPolicy(t *testing.T) {
	t.Parallel()
	eq(t, "reviewer-policy tool", review.SubmitReviewTool, "submit_review")
	defs := review.ReviewerToolDefinitions(review.SubmitReviewTool)
	eq(t, "reviewer-policy definitions", len(defs), 1)
	eq(t, "reviewer-policy definition name", defs[0]["name"], any("submit_review"))
	eq(t, "reviewer-policy limit rule", strings.Count(review.ReviewerInstructions(), "\n"+review.LimitRaises+"\n"), 1)
	eq(t, "reviewer-policy generic tools", len(review.ReviewerToolDefinitions(review.ToolNames...)), len(review.ToolNames))
}
