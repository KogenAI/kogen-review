package contract

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-review/review"
)

func decodeArgs(t *testing.T, text string) map[string]any {
	t.Helper()
	var args map[string]any
	dec := json.NewDecoder(strings.NewReader(text))
	dec.UseNumber()
	if err := dec.Decode(&args); err != nil {
		t.Fatal(err)
	}
	return args
}

// TestValidateAcceptsTheVerdictShapes pins submit_review validation as kogen-build calls it
// through review.Validate: the accepted set, and the problem text of every shape and
// inner-validation failure, which never discloses submitted contents (item validate-shape;
// copied from kogen-build build/review_test.go reviewShapeCases and
// TestReviewValidateAcceptanceSet).
func TestValidateAcceptsTheVerdictShapes(t *testing.T) {
	t.Parallel()
	const need = "submit_review needs verdict (approve or changes) and a findings list; "
	for i, tc := range []struct {
		args     string
		accepted bool
		problem  string
	}{
		{`{"verdict":"approve","findings":[]}`, true, ""},
		{`{"verdict":"approve","findings":[{"path":"app.txt","line":1,"severity":"note","message":"PRIVATE_REVIEW_MARKER"}]}`, true, ""},
		{`{"verdict":"changes","findings":[{"path":"app.txt","line":1,"severity":"blocking","message":"PRIVATE_REVIEW_MARKER"}]}`, true, ""},
		{`{"verdict":"approve","findings":"[]"}`, false, need + "findings must be a JSON array of objects but was a string"},
		{`{"verdict":"approve"}`, false, need + "findings must be a JSON array of objects but was missing"},
		{`{"verdict":"approve","findings":null}`, false, need + "findings must be a JSON array of objects but was null"},
		{`{"verdict":"approve","findings":{"private":"PRIVATE_REVIEW_MARKER"}}`, false, need + "findings must be a JSON array of objects but was an object"},
		{`{"verdict":"approve","findings":true}`, false, need + "findings must be a JSON array of objects but was a boolean"},
		{`{"verdict":"approve","findings":12345}`, false, need + "findings must be a JSON array of objects but was a number"},
		{`{"findings":[]}`, false, need + "verdict must be approve or changes but was missing"},
		{`{"verdict":null,"findings":[]}`, false, need + "verdict must be approve or changes but was null"},
		{`{"verdict":12345,"findings":[]}`, false, need + "verdict must be approve or changes but was a number"},
		{`{"verdict":["PRIVATE_REVIEW_MARKER"],"findings":[]}`, false, need + "verdict must be approve or changes but was an array"},
		{`{"verdict":"PRIVATE_REVIEW_MARKER","findings":[]}`, false, need + "verdict must be approve or changes but was a string with an unsupported value"},
		{`{}`, false, need + "verdict must be approve or changes but was missing; findings must be a JSON array of objects but was missing"},
		{`{"verdict":"changes","findings":[]}`, false, "a changes verdict needs at least one blocking finding"},
		{`{"verdict":"approve","findings":[{"path":"app.txt","line":1,"severity":"blocking","message":"PRIVATE_REVIEW_MARKER"}]}`, false, "an approve verdict cannot have blocking findings"},
		{`{"verdict":"approve","findings":[{"path":"app.txt","line":1.5,"severity":"note","message":"PRIVATE_REVIEW_MARKER"}]}`, false, "each finding needs path (string), line (integer), severity (blocking or note) and message"},
		{`{"verdict":"approve","findings":[{"path":"missing.txt","line":1,"severity":"note","message":"m"}]}`, false, "missing.txt is not a file of the repository"},
		{`{"verdict":"approve","findings":[{"path":"deleted.txt","line":1,"severity":"note","message":"m"}]}`, true, ""},
	} {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			t.Parallel()
			b, _ := newAttempt(t)
			verdict, problems, err := review.Validate(b, decodeArgs(t, tc.args), nil)
			if err != nil {
				t.Fatal(err)
			}
			eq(t, "validate-shape accepted "+tc.args, verdict != nil, tc.accepted)
			eq(t, "validate-shape problem "+tc.args, strings.Join(problems, "; "), tc.problem)
			if strings.Contains(strings.Join(problems, ""), "PRIVATE_REVIEW_MARKER") {
				t.Error("validate-shape: a submitted value was disclosed")
			}
		})
	}
}

// TestValidateRefusesAVerdictWithUnreadParts pins that the native reviewer's verdict needs every
// pinned part read (item validate-unread; kogen-build build/review_prefill_test.go and
// k_revod_gate_test.go).
func TestValidateRefusesAVerdictWithUnreadParts(t *testing.T) {
	t.Parallel()
	b, h := newAttempt(t)
	h.unread = []string{"part-1", "part-2"}
	verdict, problems, err := review.Validate(b, decodeArgs(t, `{"verdict":"approve","findings":[]}`), nil)
	if err != nil {
		t.Fatal(err)
	}
	if verdict != nil {
		t.Error("validate-unread: an approval with unread parts was accepted")
	}
	deepEq(t, "validate-unread approve", problems, []string{"Read all pinned source evidence before approving: 2 unread part(s); use read_file on part-1, part-2"})
	_, problems, _ = review.Validate(b, decodeArgs(t, `{"verdict":"changes","findings":[{"path":"app.txt","line":1,"severity":"blocking","message":"m"}]}`), nil)
	deepEq(t, "validate-unread changes", problems, []string{"2 pinned part(s) unread; read them before a verdict; incomplete delivery is not a candidate defect; use read_file on part-1, part-2"})
	h.unread = nil
	verdict, problems, _ = review.Validate(b, decodeArgs(t, `{"verdict":"approve","findings":[]}`), nil)
	if verdict == nil || problems != nil {
		t.Errorf("validate-unread: an approval with every part read was refused: %v", problems)
	}
	deepEq(t, "validate-unread verdict", *verdict, review.Verdict{Verdict: "approve", Findings: nil})
}
