// The driver of Intent review-rejected-line-keeps-reason: the Go source of a scratch test file
// the steps write into a copy of this checkout's review package. It runs the real
// (*run).allowance for a rejected verdict whose only problem is KEEP_PROBLEM and prints one
// line, "KEEPPROBE " and a JSON object with the progress lines and the recorded events.
module.exports = String.raw`package review

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

type keepProbeEnv struct {
	Env
	progress []string
	events   []map[string]any
}

func (e *keepProbeEnv) Progress(line string)   { e.progress = append(e.progress, line) }
func (e *keepProbeEnv) Event(m map[string]any) { e.events = append(e.events, m) }

func TestKeepProbeRejectedVerdictLine(t *testing.T) {
	e := &keepProbeEnv{}
	r := &run{in: Input{Number: 1}, env: e}
	r.allowance("rejected_verdict", []string{os.Getenv("KEEP_PROBLEM")})
	out, err := json.Marshal(map[string]any{"progress": e.progress, "events": e.events})
	if err != nil {
		t.Fatal(err)
	}
	fmt.Println("KEEPPROBE " + string(out))
}
`;
