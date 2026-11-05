package review

import (
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
)

// testParter is a parter over source whose complete prompt is extra bytes of framing and the
// part's text (so a part's room is the ceiling less extra and its header).
func testParter(source string, blocks []MaterialSegment, ceiling, extra int) *reviewParter {
	return &reviewParter{
		source: source, sum: core.HashHex([]byte(source)), checks: "checks passed", catalog: `[{"path":"a.txt","status":"added"}]`,
		blocks: blocks, ceiling: ceiling, measure: func(dynamic string) int { return extra + len(dynamic) },
	}
}

// lines is n lines of exactly 50 bytes.
func lines(n int, fill string) string {
	return strings.Repeat(strings.Repeat(fill, 49)+"\n", n)
}

// exactly is a text of exactly n bytes made of 50-byte lines (the last one shorter), ending in a
// newline.
func exactly(n int, fill string) string {
	text := lines(n/50, fill)
	if rest := n % 50; rest > 0 {
		text += strings.Repeat(fill, rest-1) + "\n"
	}
	return text
}

func mustCut(t *testing.T, c *reviewParter) []reviewCut {
	t.Helper()
	cuts, err := c.cut()
	if err != nil {
		t.Fatal(err)
	}
	return cuts
}

// checkCover asserts the cuts are consecutive ranges whose concatenation is the whole source,
// and that every part's rendered complete prompt fits the ceiling.
func checkCover(t *testing.T, c *reviewParter, cuts []reviewCut) {
	t.Helper()
	at := 0
	var joined strings.Builder
	for i, cut := range cuts {
		if cut.From != at || cut.To <= cut.From {
			t.Fatalf("part %d is [%d, %d) after %d", i+1, cut.From, cut.To, at)
		}
		at = cut.To
		joined.WriteString(c.source[cut.From:cut.To])
	}
	if at != len(c.source) || joined.String() != c.source {
		t.Fatalf("the parts cover %d of %d bytes", at, len(c.source))
	}
	for i, text := range c.texts(cuts) {
		if got := c.measure(text); got > c.ceiling {
			t.Fatalf("part %d of %d has a %d-byte prompt over the %d-byte ceiling", i+1, len(cuts), got, c.ceiling)
		}
		if !strings.HasPrefix(text, "# Review part "+strconv.Itoa(i+1)+" of "+strconv.Itoa(len(cuts))+"\n") {
			t.Fatalf("part %d text starts %q", i+1, text[:40])
		}
	}
}

// A part is as long as possible: its complete prompt may equal the ceiling (equality fits) and
// one more byte would not.
func TestReviewPartsFitTheCeilingInclusively(t *testing.T) {
	source := strings.Repeat("a", 90000) // no newline: only the ceiling decides where a part ends
	c := testParter(source, nil, 20000, 1500)
	cuts := mustCut(t, c)
	checkCover(t, c, cuts)
	if len(cuts) < 5 {
		t.Fatalf("parts %v", cuts)
	}
	for i, cut := range cuts[:len(cuts)-1] {
		text := c.texts(cuts)[i]
		if got := c.measure(text); got != c.ceiling {
			t.Errorf("part %d prompt is %d bytes, want exactly the ceiling %d", i+1, got, c.ceiling)
		}
		if over := c.prompt(i+1, len(cuts), cut.From, cut.To+1); over <= c.ceiling {
			t.Errorf("part %d could take one more byte (%d)", i+1, over)
		}
	}
}

// Path material that fits one part is never split: at exactly the room of a part it stays
// whole, one byte larger it is split, after a newline.
func TestReviewPartsKeepPathMaterialWhole(t *testing.T) {
	const ceiling, extra, start = 10000, 0, 6000
	filler, tail := lines(start/50, "a"), lines(100, "t")
	build := func(block int) (*reviewParter, []MaterialSegment) {
		blocks := []MaterialSegment{{Path: "b.txt", Kind: "file", Start: start, End: start + block}}
		return testParter(filler+exactly(block, "b")+tail, blocks, ceiling, extra), blocks
	}
	probe, _ := build(9000)
	room := probe.maxTo(2, 9, start) - start

	for _, tc := range []struct {
		block int
		whole bool
	}{{room - 1, true}, {room, true}, {room + 1, false}} {
		c, _ := build(tc.block)
		cuts := mustCut(t, c)
		checkCover(t, c, cuts)
		if tc.whole {
			if cuts[0].To != start || cuts[1].From != start || cuts[1].To < start+tc.block {
				t.Errorf("block of %d (room %d) was split: %v", tc.block, room, cuts)
			}
			continue
		}
		if cuts[0].To <= start || cuts[0].To >= start+tc.block || c.source[cuts[0].To-1] != '\n' {
			t.Errorf("block of %d (room %d) was not split after a newline inside it: %v", tc.block, room, cuts)
		}
	}
}

// Path material without a final newline that ends exactly where a part's room ends stays whole
// in that part, rather than being split at its last newline.
func TestReviewPartsKeepMaterialEndingAtTheLimit(t *testing.T) {
	const total, ceiling, start = 30000, 10000, 3000
	limit := testParter(strings.Repeat("x", total), nil, ceiling, 0).maxTo(1, 9, 0)
	text := exactly(limit-start, "b")
	text = text[:len(text)-1] + "b"
	source := lines(start/50, "a") + text + "\n" + strings.Repeat("t", total-limit-1)
	c := testParter(source, []MaterialSegment{{Path: "b.txt", Kind: "file", Start: start, End: limit}}, ceiling, 0)
	cuts := mustCut(t, c)
	checkCover(t, c, cuts)
	if cuts[0].To != limit {
		t.Fatalf("the material [%d, %d) was split: %v", start, limit, cuts)
	}
}

// A line longer than the room of a part is split at a UTF-8 character boundary.
func TestReviewPartsSplitLongLinesAtCharacters(t *testing.T) {
	source := strings.Repeat("✓é€", 20000) // 3-, 2- and 3-byte characters, no newline
	c := testParter(source, nil, 15001, 700)
	cuts := mustCut(t, c)
	checkCover(t, c, cuts)
	if len(cuts) < 4 {
		t.Fatalf("parts %v", cuts)
	}
	for i, cut := range cuts {
		if !utf8.ValidString(source[cut.From:cut.To]) {
			t.Errorf("part %d [%d, %d) ends inside a character", i+1, cut.From, cut.To)
		}
	}
}

// Parts end just after a newline when one is within the room.
func TestReviewPartsEndAfterNewlines(t *testing.T) {
	c := testParter(lines(2000, "x"), nil, 20000, 900)
	cuts := mustCut(t, c)
	checkCover(t, c, cuts)
	for i, cut := range cuts[:len(cuts)-1] {
		if c.source[cut.To-1] != '\n' {
			t.Errorf("part %d ends mid-line", i+1)
		}
	}
}

// Room for one pinned source part (6000 bytes) proceeds in parts; one byte less stops.
func TestReviewPartsMinimumRoom(t *testing.T) {
	const ceiling = 100000
	c := testParter(lines(5000, "x"), nil, ceiling, 0)
	header := len(c.header(1, 1, 0, 0))
	for _, tc := range []struct {
		room int
		want bool
	}{{MaterialPartBytes, true}, {MaterialPartBytes - 1, false}, {MaterialPartBytes + 1, true}} {
		c := testParter(lines(5000, "x"), nil, ceiling, ceiling-tc.room-header)
		if got := c.hasRoom(); got != tc.want {
			t.Errorf("%d bytes of room: proceeds %v, want %v", tc.room, got, tc.want)
		}
		if got := c.ceiling - c.mandatory(); got != tc.room {
			t.Errorf("room %d, want %d", got, tc.room)
		}
	}
	// A part with no room at all is an error, never an endless cut.
	if _, err := testParter(lines(50, "x"), nil, 300, 0).cut(); err == nil {
		t.Fatal("a ceiling below the header cut parts")
	}
}

// reviewMeasure uses the executor's own report, and len(Stable)+len(Dynamic) without one.
func TestReviewMeasure(t *testing.T) {
	brief := executor.Brief{Stable: "abc", Dynamic: "defgh"}
	if got := reviewMeasure(plainExec{}, brief); got != 8 {
		t.Fatalf("measure without the method: %d", got)
	}
	if got := reviewMeasure(sizedExec{plainExec{}}, brief); got != 1000+8 {
		t.Fatalf("measure with the method: %d", got)
	}
}

// plainExec is an executor that reports no prompt size.
type plainExec struct{ executor.Executor }

type sizedExec struct{ executor.Executor }

func (s sizedExec) FirstPromptBytes(role string, brief executor.Brief) int {
	if role != executor.RoleReview {
		return -1
	}
	return 1000 + len(brief.Stable) + len(brief.Dynamic)
}

// pathsOf is n paths of exactly size bytes, in byte order.
func pathsOf(n, size int) []string {
	out := make([]string, n)
	for i := range out {
		p := strconv.Itoa(1000000 + i)
		out[i] = p + strings.Repeat("p", size-len(p))
	}
	return out
}

// The section is the heading, the instruction and the list as JSON, each followed by a blank
// line; no paths is no section.
func TestRepairedSectionRendering(t *testing.T) {
	section, shown, more := repairedSection([]string{"a.txt", "d/new.txt"})
	want := "# Paths repaired by earlier parts\n\n" +
		"Reviewers of earlier parts repaired these paths, and Kogen verified the repairs, after the review source was cut: what the review source shows of them is stale or missing. Read each of them from the checkout.\n\n" +
		"[\"a.txt\",\"d/new.txt\"]\n\n"
	if section != want || len(shown) != 2 || more != 0 {
		t.Fatalf("section %q shown %v more %d", section, shown, more)
	}
	if section, shown, more := repairedSection(nil); section != "" || shown != nil || more != 0 {
		t.Fatalf("no paths: %q %v %d", section, shown, more)
	}
}

// A section of exactly 3000 bytes shows every path; one more byte cuts with the count, and a
// list that fits no path is the empty prefix.
func TestRepairedSectionCut(t *testing.T) {
	overhead := len(repairedHead) + len("[]\n\n")
	// k paths of size bytes: the list is k*(size+2)+(k-1) bytes plus its brackets.
	const k = 5
	size := (repairedSectionBytes-overhead-(k-1))/k - 2
	paths := pathsOf(k, size)
	section, shown, more := repairedSection(paths)
	if len(section) > repairedSectionBytes || more != 0 || len(shown) != k {
		t.Fatalf("%d bytes, shown %d, more %d", len(section), len(shown), more)
	}
	// Grow the last path to make the section exactly 3000 bytes, then one byte more.
	paths[k-1] += strings.Repeat("p", repairedSectionBytes-len(section))
	section, shown, more = repairedSection(paths)
	if len(section) != repairedSectionBytes || more != 0 || len(shown) != k {
		t.Fatalf("exact: %d bytes, shown %d, more %d", len(section), len(shown), more)
	}
	paths[k-1] += "p"
	section, shown, more = repairedSection(paths)
	if len(section) > repairedSectionBytes || more != 1 || len(shown) != k-1 || !strings.HasSuffix(section, " and 1 more\n\n") {
		t.Fatalf("one byte over: %d bytes, shown %d, more %d", len(section), len(shown), more)
	}
	section, shown, more = repairedSection([]string{strings.Repeat("x", repairedSectionBytes), "y"})
	if len(shown) != 0 || more != 2 || !strings.HasSuffix(section, "[] and 2 more\n\n") {
		t.Fatalf("empty prefix: %q %v %d", section, shown, more)
	}
	// A whole list of exactly 3000 bytes is shown whole even when its last path is shorter than
	// the " and 1 more" a prefix would need; one byte more shows the empty prefix.
	long := strings.Repeat("x", repairedSectionBytes-len(repairedHead)-len(`["",""]`)-len("y")-len("\n\n"))
	section, shown, more = repairedSection([]string{long, "y"})
	if len(section) != repairedSectionBytes || len(shown) != 2 || more != 0 {
		t.Fatalf("whole list of exactly the cap: %d bytes, shown %d, more %d", len(section), len(shown), more)
	}
	section, shown, more = repairedSection([]string{long + "x", "y"})
	if len(section) > repairedSectionBytes || len(shown) != 0 || more != 2 {
		t.Fatalf("whole list one byte over the cap: %d bytes, shown %d, more %d", len(section), len(shown), more)
	}
	// 2200 paths of 240 bytes show the first 11 and 2189 more in a 2935-byte section.
	section, shown, more = repairedSection(pathsOf(2200, 240))
	if len(shown) != 11 || more != 2189 || len(section) != 2935 || !strings.Contains(section, " and 2189 more\n\n") {
		t.Fatalf("shown %d more %d bytes %d", len(shown), more, len(section))
	}
}

// Cutting again from a part numbers the parts on from it, keeps the slices consecutive over the
// rest of the source and every complete prompt within the ceiling, with the section in each.
func TestReviewPartsRecutFromAPart(t *testing.T) {
	c := testParter(lines(2000, "x"), nil, 20000, 900)
	cuts := mustCut(t, c)
	if len(cuts) < 3 {
		t.Fatalf("parts %v", cuts)
	}
	section, _, _ := repairedSection([]string{"a.txt"})
	c.repaired = section
	tail, err := c.cutFrom(2, cuts[1].From)
	if err != nil {
		t.Fatal(err)
	}
	all := append(append([]reviewCut{}, cuts[:1]...), tail...)
	if all[1].From != cuts[0].To || all[len(all)-1].To != len(c.source) || len(tail) < len(cuts)-1 {
		t.Fatalf("cuts %v recut %v", cuts, tail)
	}
	for i, text := range c.textsFrom(2, tail) {
		n := 1 + len(tail)
		if !strings.HasPrefix(text, "# Review part "+strconv.Itoa(i+2)+" of "+strconv.Itoa(n)+"\n") {
			t.Fatalf("part %d text starts %q", i+2, text[:30])
		}
		if !strings.Contains(text, "# Every changed path\n\n"+c.catalog+"\n\n"+section+"# Source part "+strconv.Itoa(i+2)+" of "+strconv.Itoa(n)+"\n\n") {
			t.Fatalf("part %d has no section before its source heading", i+2)
		}
		if got := c.measure(text); got > c.ceiling {
			t.Fatalf("part %d prompt %d over the ceiling", i+2, got)
		}
		if i > 0 && tail[i].From != tail[i-1].To {
			t.Fatalf("not consecutive: %v", tail)
		}
	}
}
