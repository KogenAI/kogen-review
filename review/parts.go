package review

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-loop/tools"
)

// An external reviewer's first prompt is measured, source included, against the inclusive input
// ceiling the native reviewer already uses (tools.InputBudgetBytes). A prompt that fits is one
// review in one session. A larger one is cut into ordered parts of the exact review source, each
// reviewed in its own fresh session whose complete prompt fits; mandatory material that leaves
// no room for source stops before anything is sent.

// reviewTask is what the external reviewer is asked, besides the authority and the source.
const reviewTask = "# Review task\n\n" +
	"Review the candidate above against the approved Intent. The complete authority, the check results, the diff of changed and deleted files and the full text of added files are included in this message; they are Kogen's exact data for this candidate.\n" +
	reviewTaskTail

// reviewPartsTask replaces reviewTask's first paragraph when the source is reviewed in parts; it is
// the same for every part.
const reviewPartsTask = "# Review task\n\n" +
	"The candidate's source does not fit one review prompt, so it is reviewed in ordered parts, each by its own independent session. This message carries the complete authority and one part: the check results, every changed path and one consecutive piece of the exact review source, nothing clipped; the other pieces go to the other parts' sessions. The review source carries the diff of every changed or deleted path and the full text of every added file; a changed file's full text is not repeated there: read it in the checkout. Review against the approved Intent with this part as your focus and read any checkout file you need. Reviewers of earlier parts may have made verified repairs, so the checkout holds the current candidate.\n" +
	reviewTaskTail

const reviewTaskTail = "Repair concrete defects within the approved Intent with your tools; protected paths cannot be edited. Maintenance preferences are non-blocking notes.\n" +
	LimitRaises + "\n" +
	RequirementsRule + "\n" +
	unsupportedClaimsRule + "\n" +
	"Finish with the structured verdict: verdict approve or changes, findings {path, line, severity blocking|note, message} and requirements {requirement, evidence test|acceptance|probe|none, ref, met}. A changes verdict needs a blocking finding; an approve verdict has none. Kogen verifies any contents you changed and tells you the actual results."

// reviewCeiling is the inclusive ceiling of one external review prompt.
const reviewCeiling = tools.InputBudgetBytes

// reviewCut is the byte range [From, To) of the review source one part carries.
type reviewCut struct{ From, To int }

// reviewPartHeader is everything of part k of n's text before its slice: its position, the
// source range it carries, the check results of the pass the source was cut from, every changed
// path (the catalog as one JSON line), the section of the paths earlier parts repaired (empty
// when there are none) and the heading of the slice.
func reviewPartHeader(k, n, from, to, total int, sum, checks, catalog, repaired string) string {
	return fmt.Sprintf("# Review part %d of %d\n\n"+
		"This part carries bytes [%d, %d) of the %d bytes of the candidate's complete review source (SHA-256 %s); the other parts carry the rest, in order.\n\n"+
		"# Check results of the final pass\n\n%s\n\n"+
		"# Every changed path\n\n%s\n\n%s"+
		"# Source part %d of %d\n\n", k, n, from, to, total, sum, checks, catalog, repaired, k, n)
}

// repairedHead is the heading and the instruction of the section naming the paths that reviewers
// of earlier parts repaired, up to the list line.
const repairedHead = "# Paths repaired by earlier parts\n\n" +
	"Reviewers of earlier parts repaired these paths, and Kogen verified the repairs, after the review source was cut: what the review source shows of them is stale or missing. Read each of them from the checkout.\n\n"

// repairedSectionBytes is the most bytes of the whole section (MaterialPartBytes / 2).
const repairedSectionBytes = MaterialPartBytes / 2

// repairedMore is what follows the list line's JSON when n paths are left out.
func repairedMore(n int) string { return " and " + strconv.Itoa(n) + " more" }

// repairedSection is the section for the sorted, unique paths earlier parts repaired, the paths it
// shows and the number it leaves out. The whole section is at most repairedSectionBytes: all paths
// when they fit, otherwise the longest prefix whose section, with its " and N more", fits. No paths
// is no section.
func repairedSection(paths []string) (section string, shown []string, more int) {
	if len(paths) == 0 {
		return "", nil, 0
	}
	// room is what the JSON list and its " and N more" may take: the section less its head and
	// its final blank line.
	room := repairedSectionBytes - len(repairedHead) - len("\n\n")
	take := len(paths)
	if whole, _ := json.Marshal(paths); len(whole) > room {
		// A prefix leaves paths out, so it carries its " and N more"; such a section only grows
		// with the prefix. listed is the prefix's list bytes so far, brackets included.
		take = 0
		listed := 2
		for i, p := range paths[:len(paths)-1] {
			b, _ := json.Marshal(p)
			next := listed + len(b)
			if i > 0 {
				next++
			}
			if next+len(repairedMore(len(paths)-i-1)) > room {
				break
			}
			take, listed = i+1, next
		}
	}
	shown, more = append([]string{}, paths[:take]...), len(paths)-take
	list, _ := json.Marshal(shown)
	line := string(list)
	if more > 0 {
		line += repairedMore(more)
	}
	return repairedHead + line + "\n\n", shown, more
}

// reviewParter cuts the review source into parts that each fit the ceiling.
type reviewParter struct {
	source  string
	sum     string
	checks  string
	catalog string
	// repaired is the section naming the paths earlier parts repaired that the parts cut and
	// rendered next carry (empty: none).
	repaired string
	// blocks are the byte ranges of the source holding one path's material: its block in the diff
	// and its heading and full text, in source order.
	blocks []MaterialSegment
	// measure is the executor's exact first-prompt length for the review brief with this dynamic
	// text and the parts' stable text.
	measure func(dynamic string) int
	ceiling int
}

func (c *reviewParter) header(k, n, from, to int) string {
	return reviewPartHeader(k, n, from, to, len(c.source), c.sum, c.checks, c.catalog, c.repaired)
}

// prompt is the complete first prompt of part k of n carrying source[from:to].
func (c *reviewParter) prompt(k, n, from, to int) int {
	return c.measure(c.header(k, n, from, to)) + (to - from)
}

// mandatory is the prompt bytes that are not source: the complete first prompt of a first part
// with an empty slice.
func (c *reviewParter) mandatory() int { return c.prompt(1, 1, 0, 0) }

// hasRoom reports whether the mandatory prompt leaves at least one pinned source part
// (MaterialPartBytes) under the ceiling for source.
func (c *reviewParter) hasRoom() bool { return c.ceiling-c.mandatory() >= MaterialPartBytes }

// maxTo is the largest end of a part that starts at from such that its complete prompt fits the
// ceiling (equality fits), or -1 when even an empty slice does not.
func (c *reviewParter) maxTo(k, n, from int) int {
	if c.prompt(k, n, from, from) > c.ceiling {
		return -1
	}
	lo, hi := from, len(c.source)
	for lo < hi {
		mid := lo + (hi-lo+1)/2
		if c.prompt(k, n, from, mid) <= c.ceiling {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	return lo
}

// cut is the parts, in order, each as long as possible such that (a) its complete prompt fits the
// ceiling; (b) it does not end inside one path's material when that material alone would fit one
// part; (c) otherwise it ends just after a newline when one is available within the room, else at
// a UTF-8 character boundary.
func (c *reviewParter) cut() ([]reviewCut, error) { return c.cutFrom(1, 0) }

// cutFrom cuts the source from byte from on into the parts numbered on from first, by the same
// rules; the parts before first are not its concern. The headers name the number of parts of the
// whole review, first-1 parts and the ones cut.
func (c *reviewParter) cutFrom(first, from int) ([]reviewCut, error) {
	// A part's header names the number of parts, which the cut itself decides: take the least
	// number of digits that the resulting count fits.
	for digits, n := 1, 9; ; digits, n = digits+1, n*10+9 {
		cuts, err := c.cutAssuming(first, from, n)
		if err != nil {
			return nil, err
		}
		if len(strconv.Itoa(first-1+len(cuts))) <= digits {
			return cuts, nil
		}
	}
}

func (c *reviewParter) cutAssuming(first, from, n int) ([]reviewCut, error) {
	var cuts []reviewCut
	for from < len(c.source) {
		k := first + len(cuts)
		limit := c.maxTo(k, n, from)
		if limit <= from {
			return nil, fmt.Errorf("part %d has no room for source: its complete prompt without source is %d bytes", k, c.prompt(k, n, from, from))
		}
		to := limit
		if limit < len(c.source) {
			to = c.endBefore(k, n, from, limit)
		}
		cuts = append(cuts, reviewCut{from, to})
		from = to
	}
	return cuts, nil
}

// endBefore is where the part of k of n starting at from ends when its complete prompt allows
// source up to limit, which is short of the end of the source.
func (c *reviewParter) endBefore(k, n, from, limit int) int {
	// (b) A path's material that straddles the limit and would fit the next part whole starts it.
	for _, blk := range c.blocks {
		if blk.Start < limit && limit < blk.End && blk.Start > from && blk.End <= c.maxTo(k+1, n, blk.Start) {
			return blk.Start
		}
		// A path's material that ends exactly at the limit (a text without a final newline) is
		// kept whole: an earlier newline would end the part inside it.
		if blk.End == limit && blk.Start >= from {
			return limit
		}
	}
	// (c) After the last newline of the room, else at a character boundary.
	if i := strings.LastIndexByte(c.source[from:limit], '\n'); i >= 0 {
		return from + i + 1
	}
	to := limit
	for to > from+1 && !utf8.RuneStart(c.source[to]) {
		to--
	}
	return to
}

// texts renders the parts' dynamic texts: each part's header, then its exact slice.
func (c *reviewParter) texts(cuts []reviewCut) []string { return c.textsFrom(1, cuts) }

// textsFrom renders the texts of the parts cuts, numbered on from first, of a review of
// first-1+len(cuts) parts.
func (c *reviewParter) textsFrom(first int, cuts []reviewCut) []string {
	out := make([]string, len(cuts))
	n := first - 1 + len(cuts)
	for i, cut := range cuts {
		out[i] = c.header(first+i, n, cut.From, cut.To) + c.source[cut.From:cut.To]
	}
	return out
}

// reviewMeasure is the exact length of the first prompt an executor sends for the review role
// and a brief: its own report when it gives one, otherwise the length of its two texts.
func reviewMeasure(exec executor.Executor, brief executor.Brief) int {
	if p, ok := exec.(executor.PromptSizer); ok {
		return p.FirstPromptBytes(executor.RoleReview, brief)
	}
	return len(brief.Stable) + len(brief.Dynamic)
}
