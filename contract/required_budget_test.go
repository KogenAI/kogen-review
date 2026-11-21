package contract

import (
	"context"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-loop/sys"
	"github.com/KogenAI/kogen-review/review"
)

// A real native read made on the first post-target request must have an
// opportunity to reach the model before the unchanged unread count is a stall.
func TestWorkingTargetAllowsPendingReadDelivery(t *testing.T) {
	in, base := newReview(t)
	h := &readsEnv{fakeEnv: base}
	for range 12 {
		h.answers = append(h.answers, answer(call("ordinary", "list_files", `{"path":"."}`)))
	}
	h.answers = append(h.answers,
		answer(call("required", "read_file", `{"path":"app.txt"}`)),
		submitReview(approve))
	res, err := (review.Independent{}).Review(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "verdict", res.Record.Verdict, "approve")
	eq(t, "requests", len(h.requests), 14)
	eq(t, "boundary tool", h.requests[11].ForceTool, "")
	eq(t, "read tool", h.requests[12].ForceTool, "read_file")
	eq(t, "verdict tool", h.requests[13].ForceTool, "submit_review")
	for i, action := range []string{"call read_file on a", "Call submit_review"} {
		input := h.requests[12+i].Input
		last := input[len(input)-1].(map[string]any)
		if !strings.Contains(last["content"].(string), action) {
			t.Fatalf("post-target prompt: %v, want %s", last, action)
		}
	}
	// Both answers are real model turns, not a verdict accepted before delivery.
	eq(t, "unused answers", len(h.answers), 0)
}

// Tool activity without a newly delivered required part cannot extend the target
// indefinitely, even when the route obeys forced tool choice with irrelevant reads.
func TestWorkingTargetBoundsIrrelevantReads(t *testing.T) {
	in, h := newReview(t)
	h.unread = []string{"required-part"}
	for range 15 {
		h.answers = append(h.answers, &provider.Response{Items: []map[string]any{
			call("irrelevant", "read_file", `{"path":"app.txt"}`),
		}})
	}
	res, err := (review.Independent{}).Review(context.Background(), in, h)
	wantError(t, "stall", err, "candidate", "review_invalid")
	if res.Invalid == nil {
		t.Fatal("missing invalid-review record")
	}
	eq(t, "reason", res.Invalid.Reason, "rejected_verdict_exhausted")
	eq(t, "requests", len(h.requests), 15)
}

type budgetResetEnv struct {
	*readsEnv
	requestsSeen int
	forces       []string
	inputs       [][]any
}

func (h *budgetResetEnv) Request(ctx context.Context, r review.Request) (*provider.Response, []any, error) {
	h.requestsSeen++
	h.forces = append(h.forces, r.ForceTool)
	h.inputs = append(h.inputs, r.Input)
	if h.requestsSeen == 14 {
		return nil, nil, sys.Fail("candidate", "context_budget_exceeded", "not sent", 1)
	}
	return h.fakeEnv.Request(ctx, r)
}

func TestWorkingTargetResetRecomputesPendingReadGuidance(t *testing.T) {
	in, base := newReview(t)
	h := &budgetResetEnv{readsEnv: &readsEnv{fakeEnv: base}}
	for range 12 {
		h.answers = append(h.answers, answer(call("ordinary", "list_files", `{"path":"."}`)))
	}
	h.answers = append(h.answers, answer(call("read1", "read_file", `{"path":"app.txt"}`)), answer(call("read2", "read_file", `{"path":"app.txt"}`)), submitReview(approve))
	res, err := (review.Independent{}).Review(context.Background(), in, h)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "verdict", res.Record.Verdict, "approve")
	eq(t, "refused pending read guidance", h.forces[13], "submit_review")
	eq(t, "reset retry guidance", h.forces[14], "read_file")
	last := h.inputs[14][len(h.inputs[14])-1].(map[string]any)
	if !strings.Contains(last["content"].(string), "call read_file on a") {
		t.Fatalf("reset prompt: %v", last)
	}
}
