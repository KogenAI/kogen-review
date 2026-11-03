package contract

import (
	"context"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-review/review"
)

var claimInstructions = []string{
	"Unsupported candidate-authored prose or figures in documentation, comments or changelogs are scoped repairs when the approved Intent does not require the claimed outcome: remove the claim or restate only what you actually measured, verify the repair, and approve if no substantive blockers remain.",
	"If the Intent asks for a feature and says nothing about performance, and the candidate implements it but adds a README line saying this is 3x faster while your probe measures about 1.1x, remove the line or correct it to the measured figure, verify green, and approve.",
	"If instead the Intent requires the operation to be at least 2x faster and your probe measures 1.1x, submit changes with a blocking finding naming that requirement and the measured 1.1x; deleting or correcting the prose does not meet the requirement.",
	"Correct or remove a false candidate-authored code comment about behaviour the Intent does not mention, verify the repair, and approve when no blockers remain.",
	"Do not edit a false statement in a protected file: submit changes with a blocking finding naming the protected path.",
	"With no unsupported statement and no other defect, approve unchanged without an extra round or edit.",
}

func assertClaimInstructions(t *testing.T, text string) {
	t.Helper()
	for _, instruction := range claimInstructions {
		if !strings.Contains(text, instruction) {
			t.Errorf("missing policy instruction: %s", instruction)
		}
	}
}

func TestUnsupportedClaimPolicy(t *testing.T) {
	assertClaimInstructions(t, review.ReviewerInstructions())
	assertClaimInstructions(t, review.Prompt(true))
}

// Force the external route to deliver the fixture as a source part while measuring
// the actual part normally, so the outgoing executor task exercises that route.
type partsExecutor struct{ *fakeExecutor }

func (x partsExecutor) FirstPromptBytes(role string, brief executor.Brief) int {
	if !strings.HasPrefix(brief.Dynamic, "# Review part ") {
		return 100000000
	}
	return len(brief.Stable) + len(brief.Dynamic)
}

func TestExternalUnsupportedClaimPolicyDelivery(t *testing.T) {
	for _, parts := range []bool{false, true} {
		t.Run(map[bool]string{false: "whole", true: "parts"}[parts], func(t *testing.T) {
			in, h := newReview(t)
			fake := &fakeExecutor{t: t, results: []executor.RoundResult{structured(`{"verdict":"approve","findings":[]}`)}}
			var ex executor.Executor = fake
			if parts {
				ex = partsExecutor{fake}
			}
			if _, err := review.NewExternal(ex, externalDescriptor(), 4).Review(context.Background(), in, h); err != nil {
				t.Fatal(err)
			}
			if len(fake.tasks) != 1 {
				t.Fatalf("got %d tasks", len(fake.tasks))
			}
			task := fake.tasks[0]
			if got := strings.HasPrefix(task.Brief.Dynamic, "# Review part "); got != parts {
				t.Fatalf("parts delivery = %v", got)
			}
			assertClaimInstructions(t, task.Brief.Stable+task.Brief.Dynamic)
		})
	}
}
