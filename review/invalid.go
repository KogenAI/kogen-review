package review

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-loop/sys"
)

// A review that ends without a valid verdict returns its Invalid with the
// candidate/review_invalid stop: the caller decides what follows (a Build's retry and
// review-only handling), the reviewer only records the facts.

// Caps on a rejected verdict's recorded problems: lines, runes per line, and runes of the
// problem shown in the progress line.
const (
	recordedProblemLines = 10
	recordedProblemRunes = 300
	progressProblemRunes = 160
)

// cutRunes returns s cut at n runes, with no marker.
func cutRunes(s string, n int) string {
	if len(s) <= n {
		return s
	}
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

// progressMarker ends a progress problem that was cut.
const progressMarker = " ..."

// cutAtWord returns s whole when it has at most n runes. Otherwise it returns the longest
// whole-word prefix that, followed by progressMarker, has at most n runes in total; a word
// boundary is whitespace and whitespace before the marker is trimmed. With no whitespace in
// the room available it cuts on a rune boundary and appends the marker.
func cutAtWord(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	room := n - len([]rune(progressMarker))
	if room < 0 {
		room = 0
	}
	end := room
	if !unicode.IsSpace(r[room]) {
		end = -1
		for i := room - 1; i >= 0; i-- {
			if unicode.IsSpace(r[i]) {
				end = i
				break
			}
		}
	}
	if end >= 0 {
		if head := strings.TrimRightFunc(string(r[:end]), unicode.IsSpace); head != "" {
			return head + progressMarker
		}
	}
	return strings.TrimRightFunc(string(r[:room]), unicode.IsSpace) + progressMarker
}

// quotedRequirementPrefix opens a problem that names a requirement by its quoted statement.
const quotedRequirementPrefix = `requirement "`

// cutProblem returns a problem of at most n runes whole. A longer problem that starts with a
// quoted requirement keeps the text after the closing quote (the reason) whole and shortens the
// quoted statement, inside its quotes, to the room left in n runes; with no room the statement
// is the cut marker alone and the result may pass n runes. Any other long problem is cut at n
// runes by cutAtWord.
func cutProblem(s string, n int) string {
	if len([]rune(s)) <= n {
		return s
	}
	if rest, ok := strings.CutPrefix(s, quotedRequirementPrefix); ok {
		if i := strings.Index(rest, `" `); i >= 0 {
			statement, reason := rest[:i], rest[i:]
			room := n - len([]rune(quotedRequirementPrefix)) - len([]rune(reason))
			if room < 0 {
				room = 0
			}
			return quotedRequirementPrefix + cutAtWord(statement, room) + reason
		}
	}
	return cutAtWord(s, n)
}

// rejectedLine shows a rejected verdict's first problem in the progress. With more than one
// problem the line names their total (the full list, not the recorded one).
func (r *run) rejectedLine(problems []string) {
	if len(problems) == 0 {
		return
	}
	first := cutProblem(problems[0], progressProblemRunes)
	if len(problems) == 1 {
		r.env.Progress(fmt.Sprintf("kogen: review %d: verdict not accepted: %s", r.in.Number, first))
		return
	}
	r.env.Progress(fmt.Sprintf("kogen: review %d: verdict not accepted (first of %d problems): %s", r.in.Number, len(problems), first))
}

// allowance records a consumption of the review's allowances in the run log. A rejected
// verdict also records its problems (the lines the reviewer is told, cut) and shows the first
// one in the progress before the reviewer is asked again.
func (r *run) allowance(why string, problems []string) {
	event := map[string]any{
		"event": "review_allowance", "review": r.in.Number, "why": why,
		"rejected_verdicts": r.sess.Rejected, "no_tool_reminders": r.sess.NoTool,
	}
	if why == "rejected_verdict" {
		kept := make([]string, 0, recordedProblemLines)
		for i, p := range problems {
			if i == recordedProblemLines {
				break
			}
			kept = append(kept, cutRunes(p, recordedProblemRunes))
		}
		event["problems"] = kept
		r.env.Event(event)
		r.rejectedLine(problems)
		return
	}
	r.env.Event(event)
}

// invalidStop ends the review without a verdict (the second spending of an allowance). It
// records the reason with both counters, keeps the review's Invalid for its Result and returns
// candidate/review_invalid. forced: the route was told to call submit_review and did not, which
// the hand-off names.
func (r *run) invalidStop(problems []string, reason string, forced bool) error {
	event := map[string]any{
		"event": "review", "review": r.in.Number, "verdict": "invalid", "problems": problems, "reason": reason,
		"rejected_verdicts": r.sess.Rejected, "no_tool_reminders": r.sess.NoTool,
	}
	end := &Invalid{
		Review: r.in.Number, Reason: reason, Problems: problems, RejectedVerdict: r.sess.Rejected, NoToolReminder: r.sess.NoTool,
		Pass: r.pass, Base: r.base, Reopened: r.sess.Reopened, Repaired: r.sess.Repaired,
	}
	if reason == "no_tool_reminder_exhausted" || reason == "no_tool_reminder_cap" {
		role := ProviderRole(r.sess.Role)
		end.ProseTurns, end.ForcedRequests, end.ForcedAnswered = r.sess.ProseTurns, r.sess.ForcedRequests, r.sess.ForcedAnswered
		end.Route, end.Model, end.ToolChoice = role.Provider, r.sess.Role.Model, "text_fallback"
		if provider.SupportsToolChoice(role) {
			end.ToolChoice = "api_forced"
		}
		event["prose_turns"], event["forced_requests"], event["forced_answered_with_tool"] = end.ProseTurns, end.ForcedRequests, end.ForcedAnswered
		event["route"], event["model"], event["tool_choice"] = end.Route, end.Model, end.ToolChoice
	}
	r.env.Event(event)
	if forced {
		end.ForcedRoute = r.sess.Role.Provider
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
