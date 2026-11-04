package review

import (
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-loop/sys"
)

// A review that ends without a valid verdict returns its Invalid with the
// candidate/review_invalid stop: the caller decides what follows (a Build's retry and
// review-only handling), the reviewer only records the facts.

// allowance records a consumption of the review's allowances in the run log.
func (r *run) allowance(why string) {
	r.env.Event(map[string]any{
		"event": "review_allowance", "review": r.in.Number, "why": why,
		"rejected_verdicts": r.sess.Rejected, "no_tool_reminders": r.sess.NoTool,
	})
}

// invalidStop ends the review without a verdict (the second spending of an allowance). It
// records the reason with both counters, keeps the review's Invalid for its Result and returns
// candidate/review_invalid. forced: the route was told to call submit_review and did not, which
// the hand-off names.
func (r *run) invalidStop(problems []string, reason string, forced bool) error {
	r.env.Event(map[string]any{
		"event": "review", "review": r.in.Number, "verdict": "invalid", "problems": problems, "reason": reason,
		"rejected_verdicts": r.sess.Rejected, "no_tool_reminders": r.sess.NoTool,
	})
	end := &Invalid{
		Review: r.in.Number, Reason: reason, Problems: problems, RejectedVerdict: r.sess.Rejected, NoToolReminder: r.sess.NoTool,
		Pass: r.pass, Base: r.base, Reopened: r.sess.Reopened, Repaired: r.sess.Repaired,
	}
	if forced {
		end.ForcedRoute = provider.Name(core.ProviderRole(r.sess.Role))
		end.ForcedModel = r.sess.Role.Model
	}
	r.invalid = end
	return InvalidError()
}

// InvalidRecord is the review record of a review that ended without a valid verdict.
func InvalidRecord(n int) core.ReviewRecord {
	return core.ReviewRecord{N: n, Verdict: "invalid", Findings: []map[string]any{}}
}

// InvalidError is the stop of a review that ended without a valid verdict.
func InvalidError() *sys.Error {
	return sys.Fail("candidate", "review_invalid", "the reviewer did not return a valid verdict; edits are left in place", 1)
}
