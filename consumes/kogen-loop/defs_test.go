package consumes

import (
	"encoding/json"
	"testing"

	"kogen-loop/tools"
)

// definitions are the model-facing definitions of the generic tools kogen-review's reviewer is
// given (review.ToolNames, in this order), exactly as kogen-review's policy relays them.
var definitions = map[string]string{
	"read_file":   `{"description":"Read a file of the repository, with line numbers. Paths are relative to the repository root; absolute paths and symlinks must stay inside the root, and ~ is refused.","name":"read_file","parameters":{"additionalProperties":false,"properties":{"end_line":{"type":"integer"},"path":{"type":"string"},"start_line":{"type":"integer"}},"required":["path"],"type":"object"},"strict":false,"type":"function"}`,
	"view_image":  `{"description":"View one selected local static non-interlaced RGB8 PNG (1..131072 bytes, dimensions 1..2048) inside the repository root; paths outside it, symlinks leaving it and ~ are refused. Read-only; no capture or provenance inference. Provider preprocessing may change resolution.","name":"view_image","parameters":{"additionalProperties":false,"properties":{"path":{"type":"string"}},"required":["path"],"type":"object"},"strict":false,"type":"function"}`,
	"list_files":  `{"description":"List the repository's files (tracked and untracked, not ignored), optionally under a folder inside the repository root; paths outside it, symlinks leaving it and ~ are refused.","name":"list_files","parameters":{"additionalProperties":false,"properties":{"path":{"type":"string"}},"required":[],"type":"object"},"strict":false,"type":"function"}`,
	"search_text": `{"description":"Search the repository's files for a regular expression (git grep syntax), optionally under a path inside the repository root; paths outside it, symlinks leaving it and ~ are refused. Returns path:line:text matches.","name":"search_text","parameters":{"additionalProperties":false,"properties":{"path":{"type":"string"},"pattern":{"type":"string"}},"required":["pattern"],"type":"object"},"strict":false,"type":"function"}`,
	"write_file":  `{"description":"Write the whole content of a file of the repository (created with its folders if needed).","name":"write_file","parameters":{"additionalProperties":false,"properties":{"content":{"type":"string"},"path":{"type":"string"}},"required":["path","content"],"type":"object"},"strict":false,"type":"function"}`,
	"shell":       `{"description":"Run a command with /bin/sh -c in the repository root, or retrieve it using its handle. Supply exactly one of command or handle. A new command waits up to 45 seconds; retrieval waits up to 30 seconds. Both return immediately on completion; running commands continue and return JSON with status, handle and cumulative output. Retrieval returns running or completed JSON with exit_status and cumulative output. Commands are stopped at round end. stdin is closed; stdout and stderr are combined.","name":"shell","parameters":{"additionalProperties":false,"properties":{"command":{"type":"string"},"handle":{"type":"string"}},"required":[],"type":"object"},"strict":false,"type":"function"}`,
}

// asJSON is a value as a JSON document would carry it, to compare maps built with different
// Go types for the same JSON.
func asJSON(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// review/policy.go: ReviewerToolDefinitions takes the generic tools' definitions from
// tools.Definition and panics on a name that is neither a generic tool nor submit_review.
func TestDefinitionIsTheGenericToolDefinition(t *testing.T) {
	names := []string{"read_file", "view_image", "list_files", "search_text", "write_file", "shell"}
	for _, name := range names {
		def, ok := tools.Definition(name)
		eq(t, "tools.Definition: "+name+" is a generic tool", ok, true)
		var want any
		if err := json.Unmarshal([]byte(definitions[name]), &want); err != nil {
			t.Fatal(err)
		}
		deepEq(t, "tools.Definition: the exact definition of "+name, asJSON(t, def), want)
		eq(t, "tools.Definition: "+name+" is a function", def["type"], any("function"))
		eq(t, "tools.Definition: "+name+" is named", def["name"], any(name))
		eq(t, "tools.Definition: "+name+" is not strict", def["strict"], any(false))
	}
	eq(t, "tools.Definition: every tool kogen-review enables has its definition", len(definitions), len(names))
	for _, name := range []string{"submit_review", "finish", "nosuch", ""} {
		def, ok := tools.Definition(name)
		eq(t, "tools.Definition: "+name+" is not a generic tool", ok, false)
		eq(t, "tools.Definition: no definition for "+name, len(def), 0)
	}
}
