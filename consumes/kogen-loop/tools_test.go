package consumes

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-loop/sys"
	"github.com/KogenAI/kogen-loop/tools"
)

// response items as a model's answer carries them.
func callItem(id, name, arguments string) map[string]any {
	return map[string]any{"type": "function_call", "id": "fc_" + id, "call_id": id, "name": name, "arguments": arguments, "status": "completed"}
}

func TestCallsListsTheFunctionCallsInOrder(t *testing.T) {
	items := []map[string]any{
		{"type": "reasoning", "id": "rs_1", "summary": []any{}},
		callItem("c1", "read_file", `{"path":"a.txt"}`),
		{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "hi"}}},
		callItem("c2", "submit_review", `{"verdict":"approve"}`),
		{"type": "function_call", "call_id": "c3"},
	}
	calls := tools.Calls(items)
	eq(t, "tools.Calls: only the function calls", len(calls), 3)
	eq(t, "tools.Call.Name", calls[0].Name, "read_file")
	eq(t, "tools.Call.Arguments", calls[0].Arguments, `{"path":"a.txt"}`)
	eq(t, "tools.Call.Name", calls[1].Name, "submit_review")
	eq(t, "tools.Call.Arguments", calls[1].Arguments, `{"verdict":"approve"}`)
	deepEq(t, "tools.Call.Item: the item as received", calls[0].Item, items[1])
	eq(t, "tools.Calls: a call without name or arguments has them empty", calls[2].Name+"|"+calls[2].Arguments, "|")
	eq(t, "tools.Calls: no call gives none", len(tools.Calls([]map[string]any{{"type": "message"}})), 0)
	eq(t, "tools.Calls: nil gives none", len(tools.Calls(nil)), 0)
}

func TestCallArgsDecodesAnObject(t *testing.T) {
	c := tools.Calls([]map[string]any{callItem("c1", "shell", `{"command":"go test ./...","n":7}`)})[0]
	args := c.Args()
	eq(t, "tools.Call.Args: a string argument", args["command"], any("go test ./..."))
	eq(t, "tools.Call.Args: a number is an integer", fmt.Sprintf("%T %v", args["n"], args["n"]), "int64 7")
	for _, bad := range []string{``, `{`, `[1]`, `"x"`, `7`, `null`} {
		bad := tools.Call{Name: "shell", Arguments: bad}
		deepEq(t, "tools.Call.Args: "+strconv.Quote(bad.Arguments)+" is the invalid object", bad.Args(), map[string]any{"__invalid__": true})
	}
}

func TestDecodeArguments(t *testing.T) {
	deepEq(t, "tools.DecodeArguments: an object", tools.DecodeArguments(`{"command":"x","flag":true,"list":["a"]}`),
		map[string]any{"command": "x", "flag": true, "list": []any{"a"}})
	deepEq(t, "tools.DecodeArguments: the empty object", tools.DecodeArguments(`{}`), map[string]any{})
	for _, bad := range []string{``, `not json`, `{"a":`, `[]`, `"s"`, `true`} {
		deepEq(t, "tools.DecodeArguments: "+strconv.Quote(bad)+" is the invalid object", tools.DecodeArguments(bad), map[string]any{"__invalid__": true})
	}
	// review/independent.go reads the command of a shell call this way.
	cmd, _ := tools.DecodeArguments(`{"command":"go vet ./..."}`)["command"].(string)
	eq(t, "tools.DecodeArguments: the command of a shell call", cmd, "go vet ./...")
	cmd, _ = tools.DecodeArguments(`{"__invalid__":true}`)["command"].(string)
	eq(t, "tools.DecodeArguments: no command in an invalid call", cmd, "")
}

func TestCallOutputAnswersTheCall(t *testing.T) {
	c := tools.Calls([]map[string]any{callItem("call_9", "read_file", `{"path":"a"}`)})[0]
	deepEq(t, "tools.Call.Output: text", c.Output("accepted"),
		map[string]any{"type": "function_call_output", "call_id": "call_9", "output": "accepted"})
	deepEq(t, "tools.Call.Output: an Output is its value", c.Output(tools.Output{Text: "result"}),
		map[string]any{"type": "function_call_output", "call_id": "call_9", "output": "result"})
	parts := []any{map[string]any{"type": "input_text", "text": "m"}}
	deepEq(t, "tools.Call.Output: typed parts are the output list", c.Output(tools.Output{Parts: parts}),
		map[string]any{"type": "function_call_output", "call_id": "call_9", "output": parts})
}

func TestReplayKeepsOnlyWhatTheProviderAcceptsBack(t *testing.T) {
	items := []map[string]any{
		callItem("c1", "read_file", `{"path":"a"}`),
		{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "hi"}}, "id": "msg_1", "status": "completed"},
		{"type": "web_search_call", "id": "ws_1"},
	}
	got := tools.Replay(items)
	if len(got) < 1 {
		t.Fatalf("tools.Replay: got %d items, want the call replayed", len(got))
	}
	first, _ := got[0].(map[string]any)
	deepEq(t, "tools.Replay: a function call is replayed with its received fields", first, items[0])
	eq(t, "tools.Replay: an item that is not replayed is dropped", len(got) < len(items), true)
	for _, it := range got {
		m, _ := it.(map[string]any)
		eq(t, "tools.Replay: no dropped item type", m["type"] != "web_search_call", true)
	}
	eq(t, "tools.Replay: nothing gives nothing", len(tools.Replay(nil)), 0)
}

func TestCutBoundsTheTextTheModelReads(t *testing.T) {
	short := strings.Repeat("a", 16384)
	eq(t, "tools.Cut: text that fits is unchanged", tools.Cut(short), short)
	eq(t, "tools.Cut: the empty text", tools.Cut(""), "")

	long := strings.Repeat("0123456789", 3000)
	cut := tools.Cut(long)
	eq(t, "tools.Cut: bounded to 16384 bytes", len(cut) <= 16384, true)
	eq(t, "tools.Cut: keeps the first 4096 bytes", strings.HasPrefix(cut, long[:4096]), true)
	m := regexp.MustCompile(`\n\[\.\.\. (\d+) bytes omitted \.\.\.\]\n`).FindStringSubmatchIndex(cut)
	if m == nil {
		t.Fatalf("tools.Cut: no omission marker in %.80q", cut[4000:])
	}
	omitted, _ := strconv.Atoi(cut[m[2]:m[3]])
	head, tail := cut[:m[0]], cut[m[1]:]
	eq(t, "tools.Cut: the head is the first 4096 bytes", head, long[:4096])
	eq(t, "tools.Cut: the tail is the end of the text", strings.HasSuffix(long, tail), true)
	eq(t, "tools.Cut: the marker counts the bytes absent", omitted, len(long)-len(head)-len(tail))
	eq(t, "tools.Cut: the marker's bytes and the kept bytes total the bound at most", len(cut) <= 16384 && len(tail) > 0, true)
	eq(t, "tools.Cut: cutting a cut text changes nothing", tools.Cut(cut), cut)

	// Multi-byte text is cut on a character boundary; invalid bytes are replaced first.
	utf := tools.Cut(strings.Repeat("é", 10000))
	eq(t, "tools.Cut: multi-byte text stays valid UTF-8", strings.ToValidUTF8(utf, "\x00") == utf, true)
	bad := tools.Cut("a\xffb")
	eq(t, "tools.Cut: an invalid byte is replaced", bad, "a�b")
}

func TestInputBudgetBytesIsTheRequestCeiling(t *testing.T) {
	eq(t, "tools.InputBudgetBytes", tools.InputBudgetBytes, 524288)
}

func TestOutputValueIsTheTextOrTheParts(t *testing.T) {
	eq(t, "tools.Output.Value: text", tools.Output{Text: "x"}.Value(), any("x"))
	parts := []any{map[string]any{"type": "input_text", "text": "m"}}
	deepEq(t, "tools.Output.Value: typed parts", tools.Output{Parts: parts}.Value(), any(parts))
	eq(t, "tools.Output.Value: an empty text is the empty string", tools.Output{}.Value(), any(""))
}

func TestOutputCutBoundsTextAndLeavesTypedPartsAlone(t *testing.T) {
	long := strings.Repeat("x", 40000)
	cut := tools.Output{Text: long}.Cut()
	eq(t, "tools.Output.Cut: the text is cut as tools.Cut cuts it", cut.Text, tools.Cut(long))
	eq(t, "tools.Output.Cut: a cut output is not typed", cut.Parts == nil, true)
	eq(t, "tools.Output.Cut: short text is unchanged", tools.Output{Text: "ok"}.Cut().Text, "ok")
	parts := []any{map[string]any{"type": "input_text", "text": long}}
	got := tools.Output{Parts: parts}.Cut()
	deepEq(t, "tools.Output.Cut: typed parts pass unchanged", got.Parts, parts)
}

// pngOf writes a static RGB8 PNG of the given size into dir.
func pngOf(t *testing.T, dir, name string, w, h int) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.Set(x, y, color.RGBA{R: 1, G: 2, B: 3, A: 255})
		}
	}
	f, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
}

func run(t *testing.T, tl *tools.Tools, name, arguments string) tools.Output {
	t.Helper()
	c := tools.Calls([]map[string]any{callItem("c1", name, arguments)})[0]
	out, err := tl.Call(c)
	if err != nil {
		t.Fatalf("tools.Tools.Call %s %s: %v", name, arguments, err)
	}
	return out
}

func TestToolsCallRunsTheEnabledToolsInTheRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("one\ntwo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := sys.NewWith([]string{"HOME=" + t.TempDir()}, root)
	tl := &tools.Tools{Root: root, Session: s, Enabled: []string{"read_file"}}

	out := run(t, tl, "read_file", `{"path":"a.txt"}`)
	eq(t, "tools.Tools.Call: a read is numbered text", out.Text, "1\tone\n2\ttwo")
	eq(t, "tools.Tools.Root: relative paths resolve against the root", out.Typed(), false)
	eq(t, "tools.Tools.Call: lines can be selected", run(t, tl, "read_file", `{"path":"a.txt","start_line":2,"end_line":2}`).Text, "2\ttwo")
	eq(t, "tools.Tools.Root: a path outside the root is refused as a result, not an error",
		run(t, tl, "read_file", `{"path":"../a.txt"}`).Text, "error: ../a.txt: path is outside the repository root; reads are confined to the repository root")
	eq(t, "tools.Tools.Call: a missing file is a result", run(t, tl, "read_file", `{"path":"nope"}`).Text, "error: nope does not exist")
	eq(t, "tools.Tools.Call: a call without its argument is a result", strings.HasPrefix(run(t, tl, "read_file", `{`).Text, "error: "), true)
}

func TestToolsEnabledGatesTheTools(t *testing.T) {
	root := t.TempDir()
	tl := &tools.Tools{Root: root, Enabled: []string{"read_file", "list_files"}}
	out := run(t, tl, "write_file", `{"path":"x.txt","content":"x"}`)
	eq(t, "tools.Tools.Enabled: a tool that is not enabled is unknown", out.Text, "error: unknown tool write_file")
	_, err := os.Stat(filepath.Join(root, "x.txt"))
	eq(t, "tools.Tools.Enabled: and does nothing", os.IsNotExist(err), true)

	tl.Enabled = []string{"write_file"}
	eq(t, "tools.Tools.Enabled: an enabled tool runs", strings.HasPrefix(run(t, tl, "write_file", `{"path":"x.txt","content":"x"}`).Text, "error:"), false)
	b, err := os.ReadFile(filepath.Join(root, "x.txt"))
	eq(t, "tools.Tools.Enabled: the write landed in the root", string(b)+fmt.Sprint(err), "x<nil>")
	eq(t, "tools.Tools.Enabled: nothing enabled, nothing runs", run(t, &tools.Tools{Root: root}, "read_file", `{"path":"x.txt"}`).Text, "error: unknown tool read_file")
}

func TestToolsSessionIsTheEnvironmentOfShellCommands(t *testing.T) {
	root := t.TempDir()
	s := sys.NewWith([]string{"HOME=" + t.TempDir(), "KOGEN_REVIEW_CONSUMES_MARK=hello"}, root)
	tl := &tools.Tools{Root: root, Session: s, Enabled: []string{"shell"}}
	out := run(t, tl, "shell", `{"command":"printenv KOGEN_REVIEW_CONSUMES_MARK"}`)
	eq(t, "tools.Tools.Session: the shell sees the session's environment", out.Text, "exit status: 0\nhello\n")
	eq(t, "tools.Tools.Call: a failing command's status", run(t, tl, "shell", `{"command":"exit 3"}`).Text, "exit status: 3\n")
	eq(t, "tools.Tools.Root: the shell runs in the root", strings.HasSuffix(strings.TrimSpace(run(t, tl, "shell", `{"command":"pwd"}`).Text), filepath.Base(root)), true)
	eq(t, "tools.Tools.Call: a shell call has no rule when it ran", out.Rule, "")
}

func TestToolsSessionGivesGitsEnvironmentToTheFileTools(t *testing.T) {
	root := t.TempDir()
	s := sys.NewWith(os.Environ(), root)
	tl := &tools.Tools{Root: root, Session: s, Enabled: []string{"list_files", "search_text", "shell"}}
	if out := run(t, tl, "shell", `{"command":"git init -q . && printf 'needle\n' > f.txt"}`); out.Text != "exit status: 0\n" {
		t.Fatalf("tools.Tools.Session: git init: %q", out.Text)
	}
	eq(t, "tools.Tools.Root: list_files lists the root's files", run(t, tl, "list_files", `{}`).Text, "f.txt")
	eq(t, "tools.Tools.Root: search_text finds a line", run(t, tl, "search_text", `{"pattern":"need"}`).Text, "f.txt:1:needle")
}

// review/independent.go: a view_image call's result is typed parts, cut unchanged and
// recorded as an image_read event.
func TestReadEventDescribesAnImageRead(t *testing.T) {
	root := t.TempDir()
	pngOf(t, root, "p.png", 2, 3)
	tl := &tools.Tools{Root: root, Session: sys.NewWith([]string{"HOME=" + t.TempDir()}, root), Enabled: []string{"view_image", "read_file"}}
	c := tools.Calls([]map[string]any{callItem("call_7", "view_image", `{"path":"p.png"}`)})[0]
	out, err := tl.Call(c)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "tools.Tools.Call: view_image answers typed parts", out.Typed() && len(out.Parts) == 2, true)
	out = out.Cut()
	ev := tools.ReadEvent(c, out, "review")
	if ev == nil {
		t.Fatal("tools.ReadEvent: no event for an image read")
	}
	eq(t, "tools.ReadEvent: event", ev["event"], any("image_read"))
	eq(t, "tools.ReadEvent: owner", ev["owner"], any("review"))
	eq(t, "tools.ReadEvent: call_id", ev["call_id"], any("call_7"))
	eq(t, "tools.ReadEvent: status", ev["status"], any("read"))
	eq(t, "tools.ReadEvent: path", ev["path"], any("p.png"))
	eq(t, "tools.ReadEvent: format", ev["format"], any("png"))
	eq(t, "tools.ReadEvent: width", fmt.Sprint(ev["width"]), "2")
	eq(t, "tools.ReadEvent: height", fmt.Sprint(ev["height"]), "3")
	eq(t, "tools.ReadEvent: bytes", fmt.Sprint(ev["bytes"]) != "0", true)
	eq(t, "tools.ReadEvent: sha256 is 64 hex digits", regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(fmt.Sprint(ev["sha256"])), true)
	eq(t, "tools.ReadEvent: owner differs", tools.ReadEvent(c, out, "other")["owner"], any("other"))

	// Any other result has no event.
	eq(t, "tools.ReadEvent: a text result has no event", tools.ReadEvent(c, tools.Output{Text: "x"}, "review") == nil, true)
	eq(t, "tools.ReadEvent: a refused image is text, no event",
		tools.ReadEvent(c, run(t, tl, "view_image", `{"path":"missing.png"}`), "review") == nil, true)
}
