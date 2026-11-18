package review

import (
	"fmt"
	"strings"
	"testing"
)

func TestReminderToolForcesReadFileWhilePartUnread(t *testing.T) {
	if got := reminderTool([]string{"p1"}); got != "read_file" {
		t.Fatalf("reminderTool with one unread part = %q, want read_file", got)
	}
}

func TestReminderToolForcesSubmitReviewWhenNothingUnread(t *testing.T) {
	if got := reminderTool(nil); got != SubmitReviewTool {
		t.Fatalf("reminderTool with no unread part = %q, want %q", got, SubmitReviewTool)
	}
}

func TestReminderTextJoinsProblemsAndCallsSubmitReview(t *testing.T) {
	got := reminderText([]string{"first problem", "second problem"}, nil)
	want := "Not a valid verdict: first problem; second problem. Call submit_review."
	if got != want {
		t.Fatalf("reminderText = %q, want %q", got, want)
	}
}

func TestReminderTextStatesCountAndNamesUnreadIDsInOrder(t *testing.T) {
	got := reminderText([]string{"unread parts"}, []string{"p1", "p2"})
	want := "Not a valid verdict: unread parts. 2 pinned part(s) unread; call read_file on p1, p2 before a verdict."
	if got != want {
		t.Fatalf("reminderText = %q, want %q", got, want)
	}
}

func TestReminderTextNamesAtMostEightUnreadIDsButStatesFullCount(t *testing.T) {
	unread := make([]string, 0, 10)
	for i := 1; i <= 10; i++ {
		unread = append(unread, fmt.Sprintf("p%d", i))
	}
	got := reminderText([]string{"unread parts"}, unread)
	want := "Not a valid verdict: unread parts. 10 pinned part(s) unread; call read_file on p1, p2, p3, p4, p5, p6, p7, p8 before a verdict."
	if got != want {
		t.Fatalf("reminderText = %q, want %q", got, want)
	}
	for _, id := range []string{"p9", "p10"} {
		if strings.Contains(got, id) {
			t.Fatalf("reminderText names %s beyond the cap of 8: %q", id, got)
		}
	}
}
