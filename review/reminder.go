package review

import (
	"fmt"
	"strings"
)

// maxReminderParts is the most unread parts a reminder names.
const maxReminderParts = 8

// reminderTool is the tool a reminder request forces: read_file while pinned parts are unread
// (a verdict is then guaranteed invalid), submit_review otherwise.
func reminderTool(unread []string) string {
	if len(unread) > 0 {
		return "read_file"
	}
	return SubmitReviewTool
}

// reminderText is the reminder sent after a turn without a valid verdict: the problems, then
// the next unread parts to read or the call to submit_review.
func reminderText(problems, unread []string) string {
	text := "Not a valid verdict: " + strings.Join(problems, "; ") + ". "
	if len(unread) == 0 {
		return text + "Call submit_review."
	}
	return text + fmt.Sprintf("%d pinned part(s) unread; call read_file on %s before a verdict.",
		len(unread), strings.Join(unread[:min(maxReminderParts, len(unread))], ", "))
}
