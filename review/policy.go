package review

import (
	"embed"
	"fmt"

	"kogen-loop/tools"
)

// The reviewer's model-facing policy, owned here: its instructions (prompts/reviewer.md and the
// limit-raise rule) and its submission tool. Every byte is the one the reviewers have always been
// given (testdata/prompts_golden.json, testdata/defs_golden.json).

//go:embed prompts/*.md
var promptFiles embed.FS

// SubmitReviewTool is the reviewer's submission tool.
const SubmitReviewTool = "submit_review"

// LimitRaises is the review rule on raised timeouts, retries and limits; the native reviewer's
// instructions and the external review task both carry it.
const LimitRaises = "Limit raises: a change that raises a timeout, deadline, retry or attempt count, size or count limit, or wait duration (in code, configuration, tests or scripts, including go test -timeout, Playwright or cucumber timeouts and ExUnit timeouts) is a blocking finding unless the Intent, or a profile cited in the change, shows that the extra work is needed and cannot be removed. The finding names the file:line, the old and new value, and asks for the profile or a speed-up. Lowering a limit, or adding a new bound where none existed, is not flagged by this rule."

func promptFile(name string) string {
	b, err := promptFiles.ReadFile("prompts/" + name + ".md")
	if err != nil {
		panic(fmt.Sprintf("review: unknown prompt %q", name))
	}
	return string(b)
}

// ReviewerInstructions are the native reviewer's instructions, byte for byte what the model
// receives: the reviewer prompt and the limit-raise rule.
func ReviewerInstructions() string {
	return promptFile("reviewer") + "\n" + LimitRaises + "\n"
}

// ReviewerToolDefinitions returns the model-facing definition of each named tool, in order: the
// generic file, search and command tools come from kogen-loop/tools, submit_review is the
// reviewer's own. A name that is neither panics: the names are fixed by the program.
func ReviewerToolDefinitions(names ...string) []map[string]any {
	out := make([]map[string]any, len(names))
	for i, name := range names {
		out[i] = definition(name)
	}
	return out
}

func definition(name string) map[string]any {
	if d, ok := tools.Definition(name); ok {
		return d
	}
	if name == SubmitReviewTool {
		return submitReviewDef()
	}
	panic(fmt.Sprintf("review: unknown tool %q", name))
}

func str() map[string]any     { return map[string]any{"type": "string"} }
func integer() map[string]any { return map[string]any{"type": "integer"} }

func submitReviewDef() map[string]any {
	return map[string]any{
		"type":        "function",
		"name":        SubmitReviewTool,
		"strict":      false,
		"description": "Submit the review: verdict approve or changes, with findings.",
		"parameters": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"verdict": map[string]any{"type": "string", "enum": []any{"approve", "changes"}},
				"findings": map[string]any{
					"type": "array",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"path":     str(),
							"line":     integer(),
							"severity": map[string]any{"type": "string", "enum": []any{"blocking", "note"}},
							"message":  str(),
						},
						"required": []any{"path", "line", "severity", "message"},
					},
				},
			},
			"required": []any{"verdict", "findings"},
		},
	}
}
