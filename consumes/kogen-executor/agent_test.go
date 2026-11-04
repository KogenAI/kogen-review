package consumes

import (
	"strings"
	"testing"

	"github.com/KogenAI/kogen-executor/agent"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-loop/tools"
)

func TestAsAny(t *testing.T) {
	a := map[string]any{"name": "a"}
	b := map[string]any{"name": "b"}
	c := map[string]any{"name": "c"}
	// The lists are concatenated in order, as the Tools list of a provider request.
	eq(t, "agent.AsAny", agent.AsAny([]map[string]any{a, b}, []map[string]any{c}), []any{a, b, c})
	if got := agent.AsAny(); len(got) != 0 {
		t.Errorf("agent.AsAny: no lists gave %#v", got)
	}
}

func TestTestingRulesPrompt(t *testing.T) {
	eq(t, "agent.TestingRules", agent.TestingRules, "testing-rules")
	text := agent.Prompt(agent.TestingRules)
	// The text of docs/testing-rules.md, with its final newline: kogen-review's material wraps it
	// between its own headings.
	if !strings.HasPrefix(text, "# Testing rules\n\nThese rules decide which tests a change needs") {
		t.Errorf("agent.Prompt: does not open with the testing rules: %.80q", text)
	}
	if !strings.HasSuffix(text, "\n") || strings.HasSuffix(text, "\n\n") {
		t.Errorf("agent.Prompt: must end in exactly one newline")
	}
	for _, h := range []string{"## 1. Identify what changed", "## 2. Choose the test", "## 4. Restrictions", "## 6. Specify the change so it can be built and tested", "## The reviewer"} {
		if !strings.Contains(text, "\n"+h+"\n") {
			t.Errorf("agent.Prompt: no section %q", h)
		}
	}
	eq(t, "agent.Prompt", agent.Prompt(agent.TestingRules), text)
}

func TestShellDefinitions(t *testing.T) {
	names := []string{"read_file", "view_image", "list_files", "search_text", "write_file", "shell"}
	tl := &tools.Tools{Root: t.TempDir(), Enabled: names}
	defs := core.ShellDefinitions(tl, names)
	if len(defs) != len(names) {
		t.Fatalf("core.ShellDefinitions: got %d definitions for %d names", len(defs), len(names))
	}
	for i, n := range names {
		m, ok := defs[i].(map[string]any)
		if !ok {
			t.Fatalf("core.ShellDefinitions: definition %d is %T", i, defs[i])
		}
		eq(t, "core.ShellDefinitions "+n, m["name"], n)
		eq(t, "core.ShellDefinitions "+n, m["type"], "function")
	}
	// The shell's definition is the executing tool's own.
	own, ok := tl.Definition("shell")
	eq(t, "core.ShellDefinitions shell", ok, true)
	eq(t, "core.ShellDefinitions shell", defs[5], any(own))
	// Names it is not given are not defined.
	eq(t, "core.ShellDefinitions", len(core.ShellDefinitions(tl, []string{"read_file"})), 1)
}
