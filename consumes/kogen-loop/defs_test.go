package consumes

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/KogenAI/kogen-loop/tools"
)

type parameterContract struct {
	name     string
	typ      string
	required bool
}

// checkDefinition checks only the model-facing arguments the reviewer consumes.
func checkDefinition(def map[string]any, name string, want []parameterContract) error {
	b, err := json.Marshal(def)
	if err != nil {
		return err
	}
	var got struct {
		Name       string `json:"name"`
		Parameters struct {
			Properties map[string]json.RawMessage `json:"properties"`
			Required   []string                   `json:"required"`
		} `json:"parameters"`
	}
	if err := json.Unmarshal(b, &got); err != nil {
		return err
	}
	if got.Name != name {
		return fmt.Errorf("name: got %q, want %q", got.Name, name)
	}
	for _, p := range want {
		raw, ok := got.Parameters.Properties[p.name]
		if !ok {
			return fmt.Errorf("%s: missing property %s", name, p.name)
		}
		var prop struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(raw, &prop); err != nil {
			return fmt.Errorf("%s.%s: %w", name, p.name, err)
		}
		if prop.Type != p.typ {
			return fmt.Errorf("%s.%s: type %q, want %q", name, p.name, prop.Type, p.typ)
		}
		required := false
		for _, r := range got.Parameters.Required {
			if r == p.name {
				required = true
			}
		}
		if required != p.required {
			return fmt.Errorf("%s.%s: required = %t, want %t", name, p.name, required, p.required)
		}
	}
	return nil
}

// review/policy.go relays these generic definitions to the reviewer.
func TestDefinitionIsTheGenericToolDefinition(t *testing.T) {
	contracts := map[string][]parameterContract{
		"read_file":   {{"path", "string", true}, {"start_line", "integer", false}, {"end_line", "integer", false}},
		"view_image":  {{"path", "string", true}},
		"list_files":  {{"path", "string", false}},
		"search_text": {{"pattern", "string", true}, {"path", "string", false}},
		"write_file":  {{"path", "string", true}, {"content", "string", true}},
		"shell":       {{"command", "string", false}, {"handle", "string", false}},
	}
	for name, want := range contracts {
		t.Run(name, func(t *testing.T) {
			def, ok := tools.Definition(name)
			if !ok {
				t.Fatalf("tools.Definition(%q) not found", name)
			}
			if err := checkDefinition(def, name, want); err != nil {
				t.Error(err)
			}
		})
	}
}

func TestDefinitionContractRejectsConsumedArgumentDrift(t *testing.T) {
	want := []parameterContract{{"pattern", "string", true}, {"path", "string", false}}
	for _, tc := range []struct {
		name   string
		mutate func(map[string]any)
	}{
		{"missing", func(p map[string]any) { delete(p["properties"].(map[string]any), "pattern") }},
		{"type", func(p map[string]any) {
			p["properties"].(map[string]any)["pattern"] = map[string]any{"type": "integer"}
		}},
		{"required removed", func(p map[string]any) { p["required"] = []any{} }},
		{"optional made required", func(p map[string]any) { p["required"] = []any{"pattern", "path"} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			def, ok := tools.Definition("search_text")
			if !ok {
				t.Fatal("search_text not found")
			}
			tc.mutate(def["parameters"].(map[string]any))
			if err := checkDefinition(def, "search_text", want); err == nil {
				t.Fatal("accepted changed consumed argument")
			}
		})
	}
}
