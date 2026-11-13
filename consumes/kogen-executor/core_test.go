package consumes

import (
	"encoding/json"
	"testing"

	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
)

func TestCountAndZeroTokens(t *testing.T) {
	n := core.Count(7)
	if n == nil || *n != 7 {
		t.Fatalf("core.Count: got %v, want a pointer to 7", n)
	}
	if core.Count(0) == core.Count(0) {
		t.Errorf("core.Count: two counts share one pointer")
	}
	z := core.ZeroTokens()
	for name, c := range map[string]*int{"Input": z.Input, "Cached": z.Cached, "Output": z.Output, "Reasoning": z.Reasoning} {
		if c == nil || *c != 0 {
			t.Errorf("core.ZeroTokens: %s is %v, want a known 0", name, c)
		}
	}
	b, err := core.EncodeJSON(z)
	eq(t, "core.ZeroTokens bytes", err, nil)
	eq(t, "core.ZeroTokens bytes", string(b), `{"input":0,"cached":0,"output":0,"reasoning":0}`)
}

func TestTokensPlus(t *testing.T) {
	a := core.Tokens{Input: core.Count(1), Cached: core.Count(2), Output: core.Count(3), Reasoning: core.Count(4)}
	b := core.Tokens{Input: core.Count(10), Cached: core.Count(20), Output: core.Count(30), Reasoning: core.Count(40)}
	eq(t, "core.Tokens.Plus", a.Plus(b), core.Tokens{Input: core.Count(11), Cached: core.Count(22), Output: core.Count(33), Reasoning: core.Count(44)})
	eq(t, "core.Tokens.Plus zero", core.ZeroTokens().Plus(a), a)
	// Unknown stays unknown in every sum.
	unknown := core.Tokens{Input: core.Count(1), Cached: core.Count(1), Output: core.Count(1)}
	got := a.Plus(unknown)
	eq(t, "core.Tokens.Plus unknown", got.Reasoning, (*int)(nil))
	eq(t, "core.Tokens.Plus unknown", *got.Input, 2)
	if b, _ := core.EncodeJSON(got); string(b) != `{"input":2,"cached":3,"output":4,"reasoning":null}` {
		t.Errorf("core.Tokens.Plus unknown: bytes %s", b)
	}
}

func TestExecutorUsagePlus(t *testing.T) {
	start := func() core.ExecutorUsage {
		return core.ExecutorUsage{Input: core.Count(0), Cached: core.Count(0), Output: core.Count(0), Reasoning: core.Count(0),
			State: executor.UsageComplete, Source: "harness", CostUSD: new(float64)}
	}
	round := executor.Usage{Input: core.Count(5), Cached: core.Count(1), Output: core.Count(2), Reasoning: core.Count(3),
		State: executor.UsageComplete, Source: "provider", CostUSD: ptr(0.25)}

	u := start().Plus(round, true)
	eq(t, "core.ExecutorUsage.Plus", u.Input, core.Count(5))
	eq(t, "core.ExecutorUsage.Plus", u.Cached, core.Count(1))
	eq(t, "core.ExecutorUsage.Plus", u.Output, core.Count(2))
	eq(t, "core.ExecutorUsage.Plus", u.Reasoning, core.Count(3))
	eq(t, "core.ExecutorUsage.Plus", u.State, "complete")
	eq(t, "core.ExecutorUsage.Plus", u.Source, "provider")
	eq(t, "core.ExecutorUsage.Plus", u.CostUSD, ptr(0.25))

	// A second round with the same state adds up; a round without a source keeps it.
	second := round
	second.Source = ""
	u = u.Plus(second, false)
	eq(t, "core.ExecutorUsage.Plus", *u.Input, 10)
	eq(t, "core.ExecutorUsage.Plus", u.Source, "provider")
	eq(t, "core.ExecutorUsage.Plus", u.State, "complete")
	eq(t, "core.ExecutorUsage.Plus", *u.CostUSD, 0.5)

	// A round that reports another state makes the total partial; one that reports none is unknown.
	partial := round
	partial.State = executor.UsagePartial
	eq(t, "core.ExecutorUsage.Plus", u.Plus(partial, false).State, "partial")
	none := round
	none.State = ""
	eq(t, "core.ExecutorUsage.Plus", start().Plus(none, true).State, "unknown")
	eq(t, "core.ExecutorUsage.Plus", start().Plus(none, false).State, "partial")

	// A count (or the cost) a round did not report is unknown from then on.
	missing := round
	missing.Reasoning, missing.CostUSD = nil, nil
	u = u.Plus(missing, false)
	eq(t, "core.ExecutorUsage.Plus", u.Reasoning, (*int)(nil))
	eq(t, "core.ExecutorUsage.Plus", u.CostUSD, (*float64)(nil))
	eq(t, "core.ExecutorUsage.Plus", *u.Input, 15)
}

func TestHashHexAndEncodeJSONBytes(t *testing.T) {
	eq(t, "core.HashHex", core.HashHex(nil), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
	eq(t, "core.HashHex", core.HashHex([]byte("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")

	// No HTML escaping, no final newline, struct field order and omitted fields as declared.
	b, err := core.EncodeJSON(map[string]any{"a": "<b>&</b>"})
	eq(t, "core.EncodeJSON", err, nil)
	eq(t, "core.EncodeJSON", string(b), `{"a":"<b>&</b>"}`)
	b, err = core.EncodeJSON([]string{})
	eq(t, "core.EncodeJSON", err, nil)
	eq(t, "core.EncodeJSON", string(b), `[]`)
	_, err = core.EncodeJSON(make(chan int))
	if err == nil {
		t.Errorf("core.EncodeJSON: a value JSON cannot encode gave no error")
	}
}

func TestNonNil(t *testing.T) {
	var nilList []map[string]any
	got := core.NonNil(nilList)
	if got == nil || len(got) != 0 {
		t.Fatalf("core.NonNil: got %#v, want an empty non-nil list", got)
	}
	b, _ := core.EncodeJSON(got)
	eq(t, "core.NonNil", string(b), `[]`)
	b, _ = core.EncodeJSON(nilList)
	eq(t, "core.NonNil", string(b), `null`)
	kept := []string{"a"}
	eq(t, "core.NonNil", core.NonNil(kept), kept)
}

func TestDisplay(t *testing.T) {
	for _, c := range []struct {
		in   any
		want string
	}{
		{nil, ""}, {"x/y.go", "x/y.go"}, {json.Number("12"), "12"}, {json.Number("1.50"), "1.50"},
		{float64(2.5), "2.5"}, {7, "7"}, {true, "true"},
	} {
		eq(t, "core.Display", core.Display(c.in), c.want)
	}
}

func TestInspectString(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"plain", `"plain"`}, {`say "hi"`, `"say \"hi\""`}, {`a\b`, `"a\\b"`},
		{"line\nnext\ttab\r", `"line\nnext\ttab\r"`}, {"\x1b[0m", `"\e[0m"`}, {"\x00", `"\0"`},
		{"#{x}", `"\#{x}"`}, {"#x", `"#x"`}, {"\x01", `"\x01"`}, {"é", `"é"`},
	} {
		eq(t, "core.InspectString", core.InspectString(c.in), c.want)
	}
}

func TestDiagnosticText(t *testing.T) {
	eq(t, "core.DiagnosticText", core.DiagnosticText(map[string]any{"role": "user", "content": "plain text"}), "plain text")
	eq(t, "core.DiagnosticText", core.DiagnosticText(map[string]any{"content": []any{
		map[string]any{"type": "text", "text": "one"},
		map[string]any{"type": "image"},
		map[string]any{"type": "text", "text": "two"},
	}}), "one\ntwo")
	eq(t, "core.DiagnosticText", core.DiagnosticText(map[string]any{"content": 5}), "")
	eq(t, "core.DiagnosticText", core.DiagnosticText("not a message"), "")
	eq(t, "core.DiagnosticText", core.DiagnosticText(nil), "")
}

// kogen-review writes these records itself; their bytes are the persisted formats.
func TestReviewRecordAndExecutorStateJSON(t *testing.T) {
	rec := core.ReviewRecord{N: 2, Verdict: "changes", Findings: []map[string]any{{"path": "a.go", "line": json.Number("3"), "severity": "blocking", "message": "bad"}}, Tree: "abc"}
	b, err := core.EncodeJSON(rec)
	eq(t, "core.ReviewRecord", err, nil)
	eq(t, "core.ReviewRecord", string(b), `{"n":2,"verdict":"changes","findings":[{"line":3,"message":"bad","path":"a.go","severity":"blocking"}],"tree":"abc"}`)
	b, _ = core.EncodeJSON(core.ReviewRecord{N: 1, Verdict: "invalid", Findings: core.NonNil[map[string]any](nil)})
	eq(t, "core.ReviewRecord", string(b), `{"n":1,"verdict":"invalid","findings":[]}`)
	var back core.ReviewRecord
	eq(t, "core.ReviewRecord", json.Unmarshal([]byte(`{"n":4,"verdict":"pending","findings":[],"tree":"t"}`), &back), nil)
	eq(t, "core.ReviewRecord", back, core.ReviewRecord{N: 4, Verdict: "pending", Findings: []map[string]any{}, Tree: "t"})

	state := core.ExecutorState{Name: "fake", Version: "1.2", SessionID: "s-1", Rounds: 2, Usage: core.ExecutorUsage{
		Input: core.Count(3), Cached: core.Count(0), Output: core.Count(4), State: executor.UsagePartial, Source: "harness", CostUSD: ptr(0.5)}}
	b, err = core.EncodeJSON(state)
	eq(t, "core.ExecutorState", err, nil)
	eq(t, "core.ExecutorState", string(b), `{"name":"fake","version":"1.2","session_id":"s-1","rounds":2,"usage":{"input":3,"cached":0,"output":4,"reasoning":null,"state":"partial","source":"harness","cost_usd":0.5}}`)
	state.Usage.CostUSD = nil
	b, _ = core.EncodeJSON(state)
	eq(t, "core.ExecutorUsage", string(b), `{"name":"fake","version":"1.2","session_id":"s-1","rounds":2,"usage":{"input":3,"cached":0,"output":4,"reasoning":null,"state":"partial","source":"harness"}}`)
}
