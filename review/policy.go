package review

import (
	"embed"
	"fmt"

	"github.com/KogenAI/kogen-loop/tools"
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

// RequirementsRule is the review rule on evidence for each requirement of the approved Intent;
// the native reviewer's instructions and the external review task both carry it.
const RequirementsRule = "Requirements: before any verdict, work through the approved Intent's concrete, observable requirements one by one and name, for each, the evidence that the candidate meets it: an existing test or acceptance step that exercises it, or a probe you ran with shell against the candidate in this review. A test or step is evidence only for the inputs it exercises: when a requirement states or implies an empty, zero or limit input that none exercises, that input needs a probe. Probe each requirement without evidence before the verdict, in your probe round, with a small focused run of the inputs it states or implies, including that empty, zero or limit input. A probe that shows the behavior missing or wrong is a substantive defect: repair it with regression coverage or, when that is not possible within the approved scope, submit changes with a blocking finding whose message quotes the requirement. Sentences that are not observable, such as a statement of purpose, and wording that only restates the acceptance scenarios need no probe of their own. Record the mapping in submit_review's requirements, one entry per requirement: requirement (quoted from the Intent), evidence (test, acceptance, probe, or none while nothing exercises it), ref (the test or acceptance step, or the exact shell command of the probe; empty for none) and met (whether that evidence shows the candidate meets the requirement). Kogen rejects an approval with an entry whose evidence is none or whose met is false and, when it sees your tool calls, one whose probe command did not run in this review; a changes verdict quotes each unmet requirement in a blocking finding."

// unsupportedClaimsRule distinguishes incidental candidate claims from required outcomes.
const unsupportedClaimsRule = `Consult the approved Intent and actual review evidence to distinguish required outcomes from incidental candidate-authored claims. Do not invent measurements.
Unsupported candidate-authored prose or figures in documentation, comments or changelogs are scoped repairs when the approved Intent does not require the claimed outcome: remove the claim or restate only what you actually measured, verify the repair, and approve if no substantive blockers remain.
If the Intent asks for a feature and says nothing about performance, and the candidate implements it but adds a README line saying this is 3x faster while your probe measures about 1.1x, remove the line or correct it to the measured figure, verify green, and approve.
If instead the Intent requires the operation to be at least 2x faster and your probe measures 1.1x, submit changes with a blocking finding naming that requirement and the measured 1.1x; deleting or correcting the prose does not meet the requirement.
Correct or remove a false candidate-authored code comment about behaviour the Intent does not mention, verify the repair, and approve when no blockers remain.
Do not edit a false statement in a protected file: submit changes with a blocking finding naming the protected path.
With no unsupported statement and no other defect, approve unchanged without an extra round or edit.`

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
	return promptFile("reviewer") + "\n" + LimitRaises + "\n" + RequirementsRule + "\n" + unsupportedClaimsRule + "\n"
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
		"description": "Submit the review: verdict approve or changes, with findings and the evidence for each requirement.",
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
				"requirements": map[string]any{
					"type": "array",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"requirement": str(),
							"evidence":    map[string]any{"type": "string", "enum": []any{"test", "acceptance", "probe", "none"}},
							"ref":         str(),
							"met":         map[string]any{"type": "boolean"},
						},
						"required": []any{"requirement", "evidence", "ref", "met"},
					},
				},
			},
			"required": []any{"verdict", "findings"},
		},
	}
}
