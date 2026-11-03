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
			in, h := newReview(t)
			verdict, problems, err := review.Validate(in, h, decodeArgs(t, tc.args), nil)
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
	in, h := newReview(t)
	h.unread = []string{"part-1", "part-2"}
	verdict, problems, err := review.Validate(in, h, decodeArgs(t, `{"verdict":"approve","findings":[]}`), nil)
	if err != nil {
		t.Fatal(err)
	}
	if verdict != nil {
		t.Error("validate-unread: an approval with unread parts was accepted")
	}
	deepEq(t, "validate-unread approve", problems, []string{"Read all pinned source evidence before approving: 2 unread part(s); use read_file on part-1, part-2"})
	_, problems, _ = review.Validate(in, h, decodeArgs(t, `{"verdict":"changes","findings":[{"path":"app.txt","line":1,"severity":"blocking","message":"m"}]}`), nil)
	deepEq(t, "validate-unread changes", problems, []string{"2 pinned part(s) unread; read them before a verdict; incomplete delivery is not a candidate defect; use read_file on part-1, part-2"})
	h.unread = nil
	verdict, problems, _ = review.Validate(in, h, decodeArgs(t, `{"verdict":"approve","findings":[]}`), nil)
	if verdict == nil || problems != nil {
		t.Errorf("validate-unread: an approval with every part read was refused: %v", problems)
	}
	deepEq(t, "validate-unread verdict", *verdict, review.Verdict{Verdict: "approve", Findings: nil})
}

// TestValidateChecksTheRequirementsOfAVerdict pins the validation of submit_review's requirements
// through review.Validate (item validate-requirements): absent or null is as before, a malformed
// array gives the one shape problem without disclosing a submitted value, an approval needs
// evidence, a met entry and a probe that ran, a changes verdict quotes each unmet requirement in
// a blocking finding, and the accepted verdict carries the entries.
func TestValidateChecksTheRequirementsOfAVerdict(t *testing.T) {
	t.Parallel()
	const shape = "requirements must be a JSON array of objects with requirement (a non-empty string), evidence (test, acceptance, probe or none), ref (a string, non-empty unless evidence is none) and met (a boolean)"
	const noEvidence = `requirement "R1" has no evidence: probe it with shell against the candidate before the verdict`
	const notMet = `requirement "R1" is not met: repair it, or submit changes with a blocking finding that quotes it`
	const noProbe = `requirement "R1" cites a probe that did not run in this review: run its command with shell before citing it`
	const unquoted = `requirement "R1" is not met: a changes verdict needs a blocking finding whose message quotes it`
	entry := func(evidence, ref, met string) string {
		return `{"requirement":"R1","evidence":"` + evidence + `","ref":"` + ref + `","met":` + met + `}`
	}
	blocking := func(message string) string {
		return `{"path":"app.txt","line":1,"severity":"blocking","message":"` + message + `"}`
	}
	note := `{"path":"app.txt","line":1,"severity":"note","message":"about R1"}`
	const needBlocking = "a changes verdict needs at least one blocking finding; "
	approve := func(req string) string { return `{"verdict":"approve","findings":[],"requirements":` + req + `}` }
	changes := func(finding, req string) string {
		return `{"verdict":"changes","findings":[` + finding + `],"requirements":` + req + `}`
	}
	probeCall := map[string]any{"type": "function_call", "name": "shell", "call_id": "c1", "arguments": `{"command":"sh probe.sh"}`}
	for i, tc := range []struct {
		args    string
		input   []any
		problem string // "" accepts
		entries int
	}{
		{`{"verdict":"approve","findings":[],"requirements":null}`, nil, "", 0},
		{approve(`[]`), nil, "", 0},
		{approve(`"R1"`), nil, shape, 0},
		{approve(`{"requirement":"PRIVATE_REVIEW_MARKER"}`), nil, shape, 0},
		{approve(`["PRIVATE_REVIEW_MARKER"]`), nil, shape, 0},
		{approve(`[{"evidence":"test","ref":"t","met":true}]`), nil, shape, 0},
		{approve(`[{"requirement":"","evidence":"test","ref":"t","met":true}]`), nil, shape, 0},
		{approve(`[{"requirement":"PRIVATE_REVIEW_MARKER","evidence":"maybe","ref":"t","met":true}]`), nil, shape, 0},
		{approve(`[{"requirement":"PRIVATE_REVIEW_MARKER","evidence":"test","ref":"","met":true}]`), nil, shape, 0},
		{approve(`[{"requirement":"PRIVATE_REVIEW_MARKER","evidence":"test","ref":"t","met":"true"}]`), nil, shape, 0},
		{approve(`[` + entry("test", "t", "true") + `,{"requirement":"PRIVATE_REVIEW_MARKER"}]`), nil, shape, 0},
		{approve(`[` + entry("none", "", "false") + `]`), nil, noEvidence, 0},
		{approve(`[` + entry("test", "t", "false") + `]`), nil, notMet, 0},
		{approve(`[` + entry("probe", "sh probe.sh", "true") + `]`), nil, noProbe, 0},
		{approve(`[` + entry("probe", "sh probe.sh", "true") + `]`), []any{probeCall}, "", 1},
		{approve(`[` + entry("test", "t", "true") + `,` + entry("acceptance", "a", "true") + `]`), nil, "", 2},
		{changes(blocking("R1 is missing"), `[`+entry("none", "", "false")+`]`), nil, "", 1},
		{changes(blocking("R1 is missing"), `[`+entry("probe", "sh probe.sh", "false")+`]`), nil, "", 1},
		{changes(blocking("it is missing"), `[`+entry("probe", "sh probe.sh", "false")+`]`), nil, unquoted, 0},
		{changes(note, `[`+entry("probe", "sh probe.sh", "false")+`]`), nil, needBlocking + unquoted, 0},
		{changes(blocking("it is missing"), `[`+entry("none", "", "true")+`]`), nil, "", 1},
	} {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			t.Parallel()
			in, h := newReview(t)
			verdict, problems, err := review.Validate(in, h, decodeArgs(t, tc.args), tc.input)
			if err != nil {
				t.Fatal(err)
			}
			eq(t, "validate-requirements accepted "+tc.args, verdict != nil, tc.problem == "")
			eq(t, "validate-requirements problem "+tc.args, strings.Join(problems, "; "), tc.problem)
			if strings.Contains(strings.Join(problems, ""), "PRIVATE_REVIEW_MARKER") {
				t.Error("validate-requirements: a submitted value was disclosed")
			}
			if verdict != nil {
				eq(t, "validate-requirements entries "+tc.args, len(verdict.Requirements), tc.entries)
			}
		})
	}
	in, h := newReview(t)
	verdict, _, err := review.Validate(in, h, decodeArgs(t, approve(`[`+entry("test", "t", "true")+`]`)), nil)
	if err != nil {
		t.Fatal(err)
	}
	deepEq(t, "validate-requirements verdict", *verdict, review.Verdict{Verdict: "approve", Requirements: []review.Requirement{{Requirement: "R1", Evidence: "test", Ref: "t", Met: true}}})
}
