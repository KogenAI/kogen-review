package review

import (
	"strings"
	"testing"

	"github.com/KogenAI/kogen-executor/executor"
)

// A repaired-paths section is cut at the longest prefix whose list with its " and N more" fills
// the section exactly: equality fits.
func TestRepairedSectionKeepsAPrefixThatFillsItExactly(t *testing.T) {
	room := repairedSectionBytes - len(repairedHead) - len("\n\n")
	// The list of the first two paths is ["a","<p>"] and takes 2+3+1+(len(p)+2) bytes.
	p := strings.Repeat("p", room-len(repairedMore(1))-(2+3+1+2))
	section, shown, more := repairedSection([]string{"a", p, strings.Repeat("z", 20)})
	if len(shown) != 2 || more != 1 || len(section) != repairedSectionBytes {
		t.Fatalf("shown %d, more %d, section %d bytes (want 2, 1, %d)", len(shown), more, len(section), repairedSectionBytes)
	}
}

func reviewBriefs(t *testing.T, whole int, part func(text string) int) ([]executor.Brief, error) {
	t.Helper()
	r := newEdgeRepo(t)
	r.write("a.txt", "start\n")
	start := r.commit("start", nil)
	r.write("a.txt", exactly(8000, "c"))
	r.commit("candidate", nil)
	x := &wideExec{size: func(b executor.Brief) int {
		if strings.HasPrefix(b.Dynamic, "# Review part ") {
			return part(b.Dynamic)
		}
		return whole
	}}
	_, _, _, _, err := wideReviewWith(t, r, start, x)
	return x.briefs, err
}

// A whole prompt of exactly the ceiling is one session, not parts.
func TestReviewWholePromptAtTheCeilingIsNotInParts(t *testing.T) {
	briefs, err := reviewBriefs(t, reviewCeiling, func(string) int { return reviewCeiling + 1 })
	if err != nil || len(briefs) != 1 || strings.HasPrefix(briefs[0].Dynamic, "# Review part ") {
		t.Fatalf("%d briefs, error %v", len(briefs), err)
	}
}

// A part whose prompt is exactly the ceiling is sent.
func TestReviewPartPromptAtTheCeilingIsSent(t *testing.T) {
	// The first run learns the length of the part's text; the second makes its prompt fill the ceiling.
	var length int
	if _, err := reviewBriefs(t, reviewCeiling+1, func(text string) int { length = len(text); return len(text) }); err != nil || length == 0 {
		t.Fatalf("learning the part: %d, %v", length, err)
	}
	briefs, err := reviewBriefs(t, reviewCeiling+1, func(text string) int { return reviewCeiling - length + len(text) })
	if err != nil || len(briefs) == 0 || !strings.HasPrefix(briefs[0].Dynamic, "# Review part ") {
		t.Fatalf("%d briefs, error %v", len(briefs), err)
	}
}
