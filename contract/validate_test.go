package contract

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
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
		{`{"verdict":"approve","findings":[{"path":"dir/../app.txt","line":1,"severity":"note","message":"m"}]}`, true, ""},
		{`{"verdict":"approve","findings":[{"path":"./app.txt","line":1,"severity":"note","message":"m"}]}`, true, ""},
		{`{"verdict":"changes","findings":[{"path":"../outside.txt","line":1,"severity":"blocking","message":"m"}]}`, false, "../outside.txt is not a file of the repository"},
		{`{"verdict":"changes","findings":[{"path":"dir/../../outside.txt","line":1,"severity":"blocking","message":"m"}]}`, false, "dir/../../outside.txt is not a file of the repository"},
		{`{"verdict":"changes","findings":[{"path":"$OUTSIDE","line":1,"severity":"blocking","message":"m"}]}`, false, "$OUTSIDE is not a file of the repository"},
		{`{"verdict":"changes","findings":[{"path":"link.txt","line":1,"severity":"blocking","message":"m"}]}`, false, "link.txt is not a file of the repository"},
	} {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			t.Parallel()
			in, h := newReview(t)
			// A regular file next to the checkout root, and an untracked link to it inside.
			outside := filepath.Join(filepath.Dir(in.Candidate.Root), "outside.txt")
			writeFile(t, outside, "OUTSIDE-CONTENT-5c1e\n")
			if err := os.Symlink("../outside.txt", filepath.Join(in.Candidate.Root, "link.txt")); err != nil {
				t.Fatal(err)
			}
			args, problem := strings.ReplaceAll(tc.args, "$OUTSIDE", outside), strings.ReplaceAll(tc.problem, "$OUTSIDE", outside)
			verdict, problems, err := review.Validate(in, h, decodeArgs(t, args), nil)
			if err != nil {
				t.Fatal(err)
			}
			eq(t, "validate-shape accepted "+args, verdict != nil, tc.accepted)
			eq(t, "validate-shape problem "+args, strings.Join(problems, "; "), problem)
			if strings.Contains(strings.Join(problems, ""), "PRIVATE_REVIEW_MARKER") || strings.Contains(strings.Join(problems, ""), "OUTSIDE-CONTENT") {
				t.Error("validate-shape: a submitted value was disclosed")
			}
			if verdict != nil && len(verdict.Findings) == 1 {
				// An accepted path is recorded clean.
				want := "app.txt"
				if strings.Contains(args, "deleted.txt") {
					want = "deleted.txt"
				}
				eq(t, "validate-shape recorded path "+args, fmt.Sprint(verdict.Findings[0]["path"]), want)
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
	const namesNothing = `requirement "R1" cites probe "sh probe.sh", which names no file or directory of the current tree: a probe is evidence only when it exercises the candidate; run a focused probe of the requirement with shell on the current tree and cite its exact command`
	const notRun = `requirement "R1" cites acceptance "a", which did not run on the current tree (not_run): naming a scenario is not evidence; cite a probe you ran with shell on the current tree that exercises the requirement, or, when nothing can verify it here, submit changes with a blocking finding that quotes the requirement and says its verification could not run`
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
		{approve(`[` + entry("probe", "sh probe.sh", "true") + `]`), []any{probeCall}, namesNothing, 0},
		{approve(`[` + entry("acceptance", "a", "true") + `]`), nil, notRun, 0},
		{approve(`[` + entry("test", "t", "true") + `]`), nil, "", 1},
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

// TestValidateJudgesRequirementEvidenceOnTheCurrentTree pins each outcome of the evidence check
// of an approval's acceptance and probe entries through review.Validate (item validate-evidence):
// an acceptance scenario establishes a requirement only when the pass under review is of the
// current tree and the scenarios the reference cites passed, and a probe only when it names a
// file or directory of the candidate and its latest run in the input succeeded; a later approval
// cannot drop a requirement an earlier submission listed; test and changes entries are as before.
func TestValidateJudgesRequirementEvidenceOnTheCurrentTree(t *testing.T) {
	t.Parallel()
	const suffix = "cite a probe you ran with shell on the current tree that exercises the requirement, or, when nothing can verify it here, submit changes with a blocking finding that quotes the requirement and says its verification could not run"
	scenario := func(name, status string) verify.ScenarioResult {
		return verify.ScenarioResult{Name: name, Status: status, Steps: []verify.StepRecord{{Keyword: "Given ", Text: "step of " + name}}}
	}
	acceptance := func(scenarios ...verify.ScenarioResult) *verify.Acceptance {
		return &verify.Acceptance{Scenarios: scenarios}
	}
	approve := func(evidence, ref string) string {
		return `{"verdict":"approve","findings":[],"requirements":[{"requirement":"R1","evidence":"` + evidence + `","ref":"` + ref + `","met":true}]}`
	}
	call := func(id, command string) []any {
		return []any{map[string]any{"type": "function_call", "name": "shell", "call_id": id, "arguments": `{"command":"` + command + `"}`}}
	}
	withOutput := func(id, command, output string) []any {
		return append(call(id, command), map[string]any{"type": "function_call_output", "call_id": id, "output": output})
	}
	for _, tc := range []struct {
		name       string
		acceptance *verify.Acceptance
		tree       string // "": the current tree, "other": another
		args       string
		input      []any
		problems   []string // nil accepts
	}{
		{"not run", nil, "", approve("acceptance", "S"), nil, []string{`requirement "R1" cites acceptance "S", which did not run on the current tree (not_run): naming a scenario is not evidence; ` + suffix}},
		{"another tree", acceptance(scenario("S", "passed")), "other", approve("acceptance", "S"), nil, []string{`requirement "R1" cites acceptance "S", whose result is of tree $PASS, not of the current tree $CURRENT: an earlier result is history and does not establish the requirement on the current tree; ` + suffix}},
		{"no scenario cited", acceptance(scenario("S", "passed")), "", approve("acceptance", "other"), nil, []string{`requirement "R1" cites acceptance "other", which names no scenario of the acceptance result: name the scenario that exercises the requirement, or ` + suffix}},
		{"cited by step text", acceptance(scenario("S", "passed")), "", approve("acceptance", "step of S"), nil, nil},
		{"failed", acceptance(scenario("S", "passed"), scenario("T", "failed")), "", approve("acceptance", "S and T"), nil, []string{`requirement "R1" cites acceptance scenario "T", which failed on the current tree: the observed result contradicts met; repair the candidate, or submit changes with a blocking finding that quotes the requirement`}},
		{"skipped", acceptance(scenario("S", "skipped")), "", approve("acceptance", "S"), nil, []string{`requirement "R1" cites acceptance scenario "S", whose result on the current tree is skipped, not passed: ` + suffix}},
		{"passed", acceptance(scenario("S", "passed")), "", approve("acceptance", "S"), nil, nil},
		{"probe naming nothing", nil, "", approve("probe", "echo ok"), withOutput("c1", "echo ok", "exit status: 0\nok"), []string{`requirement "R1" cites probe "echo ok", which names no file or directory of the current tree: a probe is evidence only when it exercises the candidate; run a focused probe of the requirement with shell on the current tree and cite its exact command`}},
		{"probe that failed", nil, "", approve("probe", "cat app.txt"), withOutput("c1", "cat app.txt", "exit status: 1\n"), []string{`requirement "R1" cites probe "cat app.txt", whose latest run in this review did not succeed (exit status 1): a probe that did not succeed does not show the requirement met; repair the candidate, or submit changes with a blocking finding that quotes the requirement`}},
		{"probe without output", nil, "", approve("probe", "cat app.txt"), call("c1", "cat app.txt"), []string{`requirement "R1" cites probe "cat app.txt", whose latest run in this review did not succeed (no exit status): a probe that did not succeed does not show the requirement met; repair the candidate, or submit changes with a blocking finding that quotes the requirement`}},
		{"probe that succeeded", nil, "", approve("probe", "cat app.txt"), withOutput("c1", "cat app.txt", "exit status: 0\ncandidate\n"), nil},
		{"probe naming a directory", nil, "", approve("probe", "ls ./.kogen/..."), withOutput("c1", "ls ./.kogen/...", "exit status: 0\n"), nil},
		{"the latest run counts", nil, "", approve("probe", "cat app.txt"), append(withOutput("c1", "cat app.txt", "exit status: 1\n"), withOutput("c2", "cat app.txt", "exit status: 0\n")...), nil},
		{"test entry", nil, "", approve("test", "TestX"), nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			in, h := newReview(t)
			in.Evidence.Pass.Acceptance = tc.acceptance
			if tc.tree != "" {
				in.Evidence.Pass.Tree = otherTree
			}
			verdict, problems, err := review.Validate(in, h, decodeArgs(t, tc.args), tc.input)
			if err != nil {
				t.Fatal(err)
			}
			eq(t, "validate-evidence accepted", verdict != nil, tc.problems == nil)
			for i, want := range tc.problems {
				tc.problems[i] = strings.NewReplacer("$PASS", otherTree, "$CURRENT", greenTree).Replace(want)
			}
			deepEq(t, "validate-evidence problems", problems, tc.problems)
		})
	}

	// An unmet entry of a changes verdict is not judged against the evidence.
	in, h := newReview(t)
	verdict, problems, err := review.Validate(in, h, decodeArgs(t, `{"verdict":"changes","findings":[{"path":"app.txt","line":1,"severity":"blocking","message":"R1 could not be verified"}],"requirements":[{"requirement":"R1","evidence":"acceptance","ref":"S","met":false}]}`), nil)
	if err != nil || verdict == nil || problems != nil {
		t.Errorf("validate-evidence: a changes verdict was judged against the evidence: %v %v", problems, err)
	}
}

// TestValidateIdentifiesRequirementsByNormalizedText pins the identity of a requirement through
// review.Validate (item validate-requirements): its text without leading and trailing whitespace,
// each run of whitespace as one space, letter case ignored. Entries of one identity are kept once
// with the first spelling when they agree and refused as listed twice when they differ in
// evidence, ref or met; requirements that differ in words stay separate; a changes verdict's
// blocking finding quotes a requirement under the same identity.
func TestValidateIdentifiesRequirementsByNormalizedText(t *testing.T) {
	t.Parallel()
	const twice = `requirement "R1" is listed twice: list each requirement once in requirements, with one evidence, ref and met`
	const unquoted = `requirement "R1" is not met: a changes verdict needs a blocking finding whose message quotes it`
	entry := func(text, evidence, ref, met string) string {
		return `{"requirement":"` + text + `","evidence":"` + evidence + `","ref":"` + ref + `","met":` + met + `}`
	}
	blocking := func(message string) string {
		return `{"path":"app.txt","line":1,"severity":"blocking","message":"` + message + `"}`
	}
	approve := func(reqs ...string) string {
		return `{"verdict":"approve","findings":[],"requirements":[` + strings.Join(reqs, ",") + `]}`
	}
	changes := func(message string, reqs ...string) string {
		return `{"verdict":"changes","findings":[` + blocking(message) + `],"requirements":[` + strings.Join(reqs, ",") + `]}`
	}
	for _, tc := range []struct {
		name    string
		args    string
		problem string // "" accepts
		texts   []string
	}{
		{"respelled entries agree", approve(entry("R1", "test", "t", "true"), entry(" r1 ", "test", "t", "true")), "", []string{"R1"}},
		{"whitespace runs agree", approve(entry("a  b", "test", "t", "true"), entry("A\\tB", "test", "t", "true")), "", []string{"a  b"}},
		{"differ in met, approve", approve(entry("R1", "test", "t", "true"), entry(" r1 ", "test", "t", "false")), twice, nil},
		{"differ in evidence, approve", approve(entry("R1", "test", "t", "true"), entry("r1", "acceptance", "t", "true")), twice, nil},
		{"differ in ref, approve", approve(entry("R1", "test", "t", "true"), entry("r1", "test", "u", "true")), twice, nil},
		{"ref compares exactly", approve(entry("R1", "test", "T", "true"), entry("r1", "test", "t", "true")), twice, nil},
		{"differ in met, changes", changes("R1 fails", entry("R1", "test", "t", "true"), entry("r1", "test", "t", "false")), twice, nil},
		{"differ in ref, changes", changes("R1 fails", entry("R1", "test", "t", "false"), entry("r1", "test", "u", "false")), twice, nil},
		{"differ in evidence, changes", changes("R1 fails", entry("R1", "test", "t", "false"), entry("r1", "none", "", "false")), twice, nil},
		{"differ in words", approve(entry("prints a total", "test", "t", "true"), entry("prints a total in bytes", "test", "t", "true")), "", []string{"prints a total", "prints a total in bytes"}},
		{"quote under identity", changes("so  r1 FAILS here", entry("R1", "test", "t", "false")), "", []string{"R1"}},
		{"quote differs in words", changes("it fails", entry("R1", "test", "t", "false")), unquoted, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			in, h := newReview(t)
			verdict, problems, err := review.Validate(in, h, decodeArgs(t, tc.args), nil)
			if err != nil {
				t.Fatal(err)
			}
			eq(t, "validate-requirements identity problem "+tc.name, strings.Join(problems, "; "), tc.problem)
			if tc.problem != "" {
				return
			}
			var texts []string
			for _, q := range verdict.Requirements {
				texts = append(texts, q.Requirement)
			}
			deepEq(t, "validate-requirements identity entries "+tc.name, texts, tc.texts)
		})
	}
}

// TestValidateCollapsesDuplicateFindings pins that identical findings (same clean path, line,
// severity and message after trimming) are kept once in first-submitted order with the first
// copy's fields, that at most 50 findings of each severity are kept in submitted order with the
// dropped counts recorded as Verdict.Dropped (absent when nothing was dropped), and that a
// collapse never leaves a changes verdict without its blocking finding (item validate-findings).
func TestValidateCollapsesDuplicateFindings(t *testing.T) {
	t.Parallel()
	finding := func(path string, line int, severity, message string) string {
		b, _ := json.Marshal(map[string]any{"path": path, "line": line, "severity": severity, "message": message})
		return string(b)
	}
	many := func(severity string, n int) string {
		var items []string
		for i := 1; i <= n; i++ {
			items = append(items, finding("app.txt", i, severity, fmt.Sprintf("finding %d", i)))
		}
		return strings.Join(items, ",")
	}
	for _, tc := range []struct {
		name     string
		verdict  string
		findings string
		lines    []int
		messages []string
		dropped  *review.Dropped
	}{
		{"copies", "changes", strings.Join([]string{
			finding("app.txt", 1, "blocking", "m"), finding("./app.txt", 1, "blocking", "m"),
			finding("dir/../app.txt", 1, "blocking", " \tm \n"), finding("app.txt", 1, "blocking", "m")}, ","),
			[]int{1}, []string{"m"}, nil},
		{"order", "changes", strings.Join([]string{
			finding("app.txt", 2, "blocking", "b"), finding("app.txt", 1, "blocking", "a"),
			finding("app.txt", 2, "blocking", "b"), finding("app.txt", 3, "note", "n"), finding("app.txt", 1, "blocking", " a")}, ","),
			[]int{2, 1, 3}, []string{"b", "a", "n"}, nil},
		{"line and severity differ", "changes", strings.Join([]string{
			finding("app.txt", 1, "blocking", "m"), finding("app.txt", 2, "blocking", "m"), finding("app.txt", 1, "note", "m")}, ","),
			[]int{1, 2, 1}, []string{"m", "m", "m"}, nil},
		{"approve notes", "approve", finding("app.txt", 1, "note", "n") + "," + finding("app.txt", 1, "note", "n"), []int{1}, []string{"n"}, nil},
		{"50 blocking", "changes", many("blocking", 50), nil, nil, nil},
		{"51 notes", "approve", many("note", 51), nil, nil, &review.Dropped{Note: 1}},
		{"60 blocking", "changes", many("blocking", 60), nil, nil, &review.Dropped{Blocking: 10}},
		{"duplicates are not dropped", "changes", many("blocking", 50) + "," + many("blocking", 50), nil, nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			in, h := newReview(t)
			args := decodeArgs(t, `{"verdict":"`+tc.verdict+`","findings":[`+tc.findings+`]}`)
			verdict, problems, err := review.Validate(in, h, args, nil)
			if err != nil || verdict == nil {
				t.Fatalf("validate-findings %s: not accepted: %v %v", tc.name, problems, err)
			}
			deepEq(t, "validate-findings dropped "+tc.name, verdict.Dropped, tc.dropped)
			b, err := json.Marshal(verdict)
			if err != nil {
				t.Fatal(err)
			}
			eq(t, "validate-findings dropped key "+tc.name, strings.Contains(string(b), `"dropped"`), tc.dropped != nil)
			if tc.dropped != nil {
				want := fmt.Sprintf(`"dropped":{"blocking":%d,"note":%d}`, tc.dropped.Blocking, tc.dropped.Note)
				eq(t, "validate-findings dropped json "+tc.name, strings.Contains(string(b), want), true)
			}
			if tc.lines == nil {
				// 50 kept, the first fifty submitted, in order.
				eq(t, "validate-findings count "+tc.name, len(verdict.Findings), 50)
				for i, f := range verdict.Findings {
					eq(t, "validate-findings message "+tc.name, fmt.Sprint(f["message"]), fmt.Sprintf("finding %d", i+1))
				}
				return
			}
			eq(t, "validate-findings count "+tc.name, len(verdict.Findings), len(tc.lines))
			for i, f := range verdict.Findings {
				eq(t, "validate-findings line "+tc.name, fmt.Sprint(f["line"]), fmt.Sprint(tc.lines[i]))
				eq(t, "validate-findings message "+tc.name, strings.TrimSpace(fmt.Sprint(f["message"])), tc.messages[i])
				eq(t, "validate-findings path "+tc.name, fmt.Sprint(f["path"]), "app.txt")
			}
		})
	}
	// The first copy is kept as submitted: its message is not trimmed.
	in, h := newReview(t)
	verdict, _, err := review.Validate(in, h, decodeArgs(t, `{"verdict":"changes","findings":[`+finding("app.txt", 1, "blocking", " m ")+`,`+finding("app.txt", 1, "blocking", "m")+`]}`), nil)
	if err != nil || verdict == nil {
		t.Fatal("validate-findings first copy: not accepted")
	}
	eq(t, "validate-findings first copy message", fmt.Sprint(verdict.Findings[0]["message"]), " m ")
}
