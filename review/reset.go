package review

import (
	"fmt"
	"slices"
	"strings"

	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-loop/sys"
	"github.com/KogenAI/kogen-loop/tools"
)

// The reviewer's own working-context reset. The caller's working window stays the caller's: the
// reviewer hands its whole conversation to Env.Request first, and resets only when the Env
// refuses that request with candidate/context_budget_exceeded (nothing was sent).

// resetHeader starts the handoff message of a reset.
const resetHeader = "Kogen review working-context reset\n"

// resetNote is the handoff's note.
const resetNote = "Kogen reset this review's working context because the next request did not fit the request ceiling. " +
	"The earlier conversation is archived in custody (window) and is not repeated. " +
	"The opening messages above are complete and unchanged: the authority, and the candidate source or its pinned catalog. " +
	"Pinned parts whose reads already reached you stay counted for verdict validation; unread_parts is how many remain unread: read them with read_file. " +
	"Tool results and images of the archived conversation are not repeated: run again what you still need. " +
	"Any messages after this one are Kogen's newest messages of the archived conversation, which had not reached you yet."

// Window is one archived working-context window: the custody record in the run folder and its
// SHA-256.
type Window struct {
	File   string `json:"file"`
	SHA256 string `json:"sha256"`
}

func asItem(item any) map[string]any {
	m, _ := item.(map[string]any)
	return m
}

func isModelItem(item any) bool {
	m := asItem(item)
	return m["type"] == "function_call" || m["type"] == "reasoning" || m["role"] == "assistant"
}

func isHandoff(item any) bool {
	m := asItem(item)
	text, _ := m["content"].(string)
	return m["role"] == "user" && strings.HasPrefix(text, resetHeader)
}

// refusesCeiling reports whether err is the Env's refusal of a request over the request ceiling.
func refusesCeiling(err error) bool {
	e, ok := sys.AsError(err)
	return ok && e.Class == "candidate" && e.Reason == "context_budget_exceeded"
}

// unread are the pinned parts the conversation has not read: the Env's unread parts of input,
// and, once the review reset, only those also unread at the latest reset.
func (r *run) unread(input []any) ([]string, error) {
	unread, err := r.env.Unread(input)
	if err != nil || len(r.sess.Windows) == 0 {
		return unread, err
	}
	return keepIn(unread, r.sess.ResetUnread), nil
}

// keepIn are the parts of unread that are also in keep, in unread's order.
func keepIn(unread, keep []string) []string {
	var out []string
	for _, p := range unread {
		if slices.Contains(keep, p) {
			out = append(out, p)
		}
	}
	return out
}

// measure is the rendered size of input as the next request, against the request ceiling.
func (r *run) measure(input []any, force string) (tools.Measurement, error) {
	role := ProviderRole(r.sess.Role)
	body := (&provider.Client{}).Body(provider.Request{Role: role, Instructions: ReviewerInstructions(), Input: input, Tools: r.tools, ToolChoice: force})
	return tools.Measure(body, role)
}

// reset replaces the working context of the conversation the Env refused (refused, with the
// Env's refusal) by the unchanged mandatory opening, one bounded handoff and Kogen's newest
// undelivered messages, archives the replaced conversation and returns the event to record. It
// returns refused unchanged, without a record, when the mandatory material does not fit.
func (r *run) reset(refused error, force string, overBudget bool) (map[string]any, string, error) {
	env := r.env
	w := r.sess.Input

	var opening []any
	for _, item := range w {
		if m := asItem(item); m["role"] != "user" || isHandoff(item) {
			break
		}
		opening = append(opening, item)
	}
	last := -1
	for i, item := range w {
		if isModelItem(item) {
			last = i
		}
	}
	delivered, pending := opening, []any(nil)
	switch {
	case last >= 0:
		delivered, pending = w[:last+1], w[last+1:]
	case len(opening) < len(w) && isHandoff(w[len(opening)]):
		// A refused post-reset conversation: what follows its handoff had not reached the model.
		pending = w[len(opening)+1:]
	}

	submits := map[any]bool{}
	for _, item := range w {
		if m := asItem(item); m["type"] == "function_call" && m["name"] == SubmitReviewTool {
			submits[m["call_id"]] = true
		}
	}
	var feedback []any
	for _, item := range pending {
		m := asItem(item)
		switch text, isText := m["output"].(string); {
		case m["type"] == "function_call_output" && isText && submits[m["call_id"]]:
			feedback = append(feedback, map[string]any{"role": "user", "content": text})
		case m["role"] == "user":
			content, isText := m["content"].(string)
			if isText && content != reviewBudgetNotice && !isHandoff(item) {
				feedback = append(feedback, map[string]any{"role": "user", "content": content})
			}
		}
	}

	mandatory := slices.Concat(opening, feedback)
	if overBudget {
		mandatory = budgetNotice(mandatory)
	}
	mandatoryM, err := r.measure(mandatory, force)
	if err != nil {
		return nil, "", err
	}
	if !mandatoryM.Fits {
		return nil, "", refused
	}
	before, err := r.measure(w, force)
	if err != nil {
		return nil, "", err
	}

	n := r.in.Number
	file := fmt.Sprintf("review-%d-window-%d.json", n, len(r.sess.Windows)+1)
	archive := map[string]any{"input": w}
	encoded, err := core.EncodeJSON(archive)
	if err != nil {
		return nil, "", err
	}
	if err := env.Write(file, archive); err != nil {
		return nil, "", err
	}
	window := Window{File: file, SHA256: core.HashHex(encoded)}

	unread, err := env.Unread(delivered)
	if err != nil {
		return nil, "", err
	}
	if len(r.sess.Windows) > 0 {
		unread = keepIn(unread, r.sess.ResetUnread)
	}

	note, err := core.EncodeJSON(map[string]any{
		"version": 1, "review": n, "window": map[string]any{"file": window.File, "sha256": window.SHA256},
		"unread_parts": len(unread), "note": resetNote,
	})
	if err != nil {
		return nil, "", err
	}
	handoff := map[string]any{"role": "user", "content": resetHeader + string(note)}
	input := slices.Concat(opening, []any{handoff}, feedback)
	if overBudget {
		input = budgetNotice(input)
	}
	m, err := r.measure(input, force)
	if err != nil {
		return nil, "", err
	}
	if !m.Fits {
		input, m = mandatory, mandatoryM
	}

	trigger := "feedback"
	if len(w) > 0 {
		item := asItem(w[len(w)-1])
		switch {
		case item["type"] == "function_call_output":
			trigger = fmt.Sprint(item["type"])
			for _, c := range w {
				if cm := asItem(c); cm["type"] == "function_call" && cm["call_id"] == item["call_id"] {
					trigger = fmt.Sprint(cm["name"])
				}
			}
		case item["role"] == "user":
		case item["type"] != nil:
			trigger = fmt.Sprint(item["type"])
		default:
			trigger = fmt.Sprint(item["role"])
		}
	}

	r.sess.Windows = append(slices.Clone(r.sess.Windows), window)
	r.sess.ResetUnread = unread
	r.sess.Input = input
	event := map[string]any{
		"event": "review_window_reset", "review": n, "window": file, "trigger": trigger,
		"bytes_before": before.RenderedBytes, "bytes_after": m.RenderedBytes, "mandatory_bytes": mandatoryM.RenderedBytes,
		"handoff_bytes": m.RenderedBytes - mandatoryM.RenderedBytes, "ceiling": m.InputBudgetBytes,
	}
	progress := fmt.Sprintf("kogen: review %d: working-context reset %d -> %d bytes (mandatory %d, handoff %d; ceiling %d); archived %s",
		n, before.RenderedBytes, m.RenderedBytes, mandatoryM.RenderedBytes, m.RenderedBytes-mandatoryM.RenderedBytes, m.InputBudgetBytes, file)
	return event, progress, nil
}
