package review

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
)

// The reviewer's policy moved here from kogen-executor's agent package (K-PROMPT-MOVE) with its
// recorded bytes: testdata/prompts_golden.json and testdata/defs_golden.json are executor's
// entries for the reviewer, copied verbatim. They record the bytes reviewers have always
// received, so they change only deliberately; "go test ./... -update" rewrites them from the
// current output.

// writeGolden writes v as two-space-indented JSON with sorted object keys, unescaped HTML
// characters and one final newline (the goldens' format).
func writeGolden(t *testing.T, path string, v any) {
	t.Helper()
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

// TestPromptsAreByteEqualToTheElixirFunctions compares the length and SHA-256 of the reviewer's
// instructions with what the Elixir function returned: the reviewer without the LimitRaises line
// and with the historical sentence, to keep the historical Elixir fixture unchanged.
func TestPromptsAreByteEqualToTheElixirFunctions(t *testing.T) {
	type entry struct {
		Bytes  int    `json:"bytes"`
		Sha256 string `json:"sha256"`
	}
	comparedText := func() string {
		text := strings.Replace(ReviewerInstructions(), "\n"+LimitRaises+"\n", "", 1)
		return strings.Replace(text, reviewerBatchParagraph, reviewerOldSentence, 1)
	}
	if *update {
		sum := sha256.Sum256([]byte(comparedText()))
		writeGolden(t, "testdata/prompts_golden.json", map[string]entry{"reviewer": {Bytes: len(comparedText()), Sha256: hex.EncodeToString(sum[:])}})
	}
	data, err := os.ReadFile("testdata/prompts_golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var want map[string]entry
	if err := json.Unmarshal(data, &want); err != nil {
		t.Fatal(err)
	}
	if len(want) != 1 {
		t.Fatalf("golden has %d prompts, the reviewer has 1", len(want))
	}
	t.Run("reviewer", func(t *testing.T) {
		w, ok := want["reviewer"]
		if !ok {
			t.Fatal("no golden entry for reviewer")
		}
		text := comparedText()
		sum := sha256.Sum256([]byte(text))
		if len(text) != w.Bytes || hex.EncodeToString(sum[:]) != w.Sha256 {
			t.Errorf("reviewer: %d bytes sha256 %x, want %d bytes sha256 %s", len(text), sum, w.Bytes, w.Sha256)
		}
		if strings.Contains(text, "{{") {
			t.Error("reviewer has an unreplaced placeholder")
		}
	})
}

// TestDefinitionsMatchTheElixirDefinitions compares submit_review with testdata/defs_golden.json,
// as parsed values.
func TestDefinitionsMatchTheElixirDefinitions(t *testing.T) {
	if *update {
		var def any
		if err := json.Unmarshal(mustJSON(t, ReviewerToolDefinitions(SubmitReviewTool)[0]), &def); err != nil {
			t.Fatal(err)
		}
		writeGolden(t, "testdata/defs_golden.json", map[string]any{SubmitReviewTool: def})
	}
	data, err := os.ReadFile("testdata/defs_golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var want map[string]any
	if err := json.Unmarshal(data, &want); err != nil {
		t.Fatal(err)
	}
	if len(want) != 1 {
		t.Fatalf("1 reviewer-owned name, golden has %d", len(want))
	}
	t.Run(SubmitReviewTool, func(t *testing.T) {
		var got any
		if err := json.Unmarshal(mustJSON(t, ReviewerToolDefinitions(SubmitReviewTool)[0]), &got); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, want[SubmitReviewTool]) {
			t.Errorf("definition differs\n got: %s\nwant: %s", mustJSON(t, got), mustJSON(t, want[SubmitReviewTool]))
		}
	})
}

func TestEveryDefinitionIsPlainJSON(t *testing.T) {
	// Provider requests encode []any and map[string]any only through their own encoder; a typed
	// slice or a struct in a definition would be encoded differently.
	var walk func(path string, v any)
	walk = func(path string, v any) {
		switch x := v.(type) {
		case map[string]any:
			for k, e := range x {
				walk(path+"."+k, e)
			}
		case []any:
			for _, e := range x {
				walk(path+"[]", e)
			}
		case string, bool, int, int64, float64, nil:
		default:
			t.Errorf("%s is %T", path, v)
		}
	}
	walk(SubmitReviewTool, ReviewerToolDefinitions(SubmitReviewTool)[0])
}

func TestUnknownReviewerToolNamesPanic(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("unknown tool did not panic")
		}
	}()
	ReviewerToolDefinitions("nope")
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

const reviewerOldSentence = "Read other files only to fill a context gap, and batch independent lookups."
const reviewerBatchParagraph = "Read other files only to fill a context gap. Every request re-sends the whole conversation, so work in a few wide rounds, not one call per turn: issue all pinned-part reads and needed context lookups together in your first tool round; never re-read text already supplied inline or read earlier; then make related repairs together and run your focused probes (stated limits, empty or zero values, error paths) in one combined shell command where possible. Code that proves correct usually needs only three rounds: reads, one probe round, then submit_review. Add a round only when a result raises a new concern or a repair needs checking; after a repair, run the configured fixer and the focused tests together in one command. Never spend a round on a lone lookup or on re-confirming a result you already have."

// TestReviewerBatchPromptBytesAndUnchangedSchema pins the batching paragraph and the reviewer's
// bytes. In kogen-executor it also hashed the source of agent/defs.go to keep the review schema
// unchanged; that file no longer holds the reviewer's schema, so the schema is pinned by its
// recorded definition instead (testdata/defs_golden.json, compared as exact bytes here).
func TestReviewerBatchPromptBytesAndUnchangedSchema(t *testing.T) {
	text := ReviewerInstructions()
	if strings.Count(text, LimitRaises) != 1 {
		t.Fatal("reviewer must carry the limit rule once")
	}
	text = strings.Replace(text, "\n"+LimitRaises+"\n", "", 1)
	if strings.Contains(text, reviewerOldSentence) || strings.Count(text, reviewerBatchParagraph) != 1 {
		t.Fatal("reviewer must replace exactly the old batching sentence")
	}
	if got := fmt.Sprintf("%x", sha256.Sum256([]byte(text))); got != "1ab7ff81c6b94254ac71958230859fd9c76ffc15baa25ad2552017cbd11cceb9" {
		t.Fatalf("reviewer hash = %s", got)
	}
	data, err := os.ReadFile("testdata/defs_golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var recorded map[string]any
	if err := json.Unmarshal(data, &recorded); err != nil {
		t.Fatal(err)
	}
	var got any
	if err := json.Unmarshal(mustJSON(t, ReviewerToolDefinitions(SubmitReviewTool)[0]), &got); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(mustJSON(t, got), mustJSON(t, recorded[SubmitReviewTool])) {
		t.Fatalf("review schema = %s", mustJSON(t, got))
	}
}
