// The driver of Intent review-rejected-verdict-line-cuts-at-word: the Go source of a scratch test
// file the steps write into a copy of this checkout's review package. It runs the real
// (*run).allowance for a rejected verdict whose only problem is CUT_PROBLEM and prints one line,
// "CUTPROBE " and a JSON object with the progress lines and the recorded events.
module.exports = String.raw`package review

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

type cutProbeEnv struct {
	Env
	progress []string
	events   []map[string]any
}

func (e *cutProbeEnv) Progress(line string)    { e.progress = append(e.progress, line) }
func (e *cutProbeEnv) Event(m map[string]any) { e.events = append(e.events, m) }

func TestCutProbeRejectedVerdictLine(t *testing.T) {
	e := &cutProbeEnv{}
	r := &run{in: Input{Number: 1}, env: e}
	r.allowance("rejected_verdict", []string{os.Getenv("CUT_PROBLEM")})
	out, err := json.Marshal(map[string]any{"progress": e.progress, "events": e.events})
	if err != nil {
		t.Fatal(err)
	}
	fmt.Println("CUTPROBE " + string(out))
}
`;
