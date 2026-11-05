package review

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-executor/agent"
	"github.com/KogenAI/kogen-executor/core"
)

// What the independent reviewer reads (REV-2), made by the review itself from its Input: the
// saved candidate (its checkout, Git repository, start commit and protection), the exact approved
// Intent and the verification evidence (the green pass and the configured commands).
//
// The authority (the Intent, its feature and model, the README, the testing rules, the
// protection and the configured commands) is always delivered verbatim. The candidate's source
// (the check results, the diff of existing and deleted paths against the start HEAD and the
// complete text of added files) goes inline in the opening message when the
// whole request fits the caller's working window (Env.Prepare); otherwise it moves to pinned
// parts there. An external review whose complete prompt does not fit one session reviews the
// parts source in ordered parts (parts.go).

// MaterialPartBytes is the most source bytes in one part of the reviewer's pinned source (and
// the room an external review's mandatory prompt must leave for source).
const MaterialPartBytes = 6000

// MaterialSet is what the reviewer reads about one green pass.
type MaterialSet struct {
	// Authority is the stable part: the approved contract and the commands.
	Authority string `json:"authority"`
	// Source is the dynamic part: the check results, diff and added file texts.
	Source string `json:"source"`
	// Files is the catalog of changed paths: path, status (changed, added or deleted), Git
	// mode, Git object, byte count and SHA-256 of the content (the commit id for a gitlink).
	Files []map[string]any `json:"files"`
	// Checks are the check results of the final pass.
	Checks string `json:"checks"`
	// Manifest (on_demand only) is, per Files entry, its diff_stat and hunks; Segments locate each
	// path's diff block and file text in Source.
	Manifest []map[string]any  `json:"manifest,omitempty"`
	Segments []MaterialSegment `json:"segments,omitempty"`
	// Hunks (on_demand only) are the lines each changed hunk occupies: the pinned parts that
	// cover one of them are required reads before a verdict.
	Hunks []MaterialHunkRange `json:"hunk_ranges,omitempty"`
	// Texts are the added text files as they appear in Source (the external
	// reviewer's parts keep a path's text whole). Not persisted.
	Texts []MaterialFileText `json:"-"`
	// PartsSource is the source of the parts route (an external review whose complete prompt does
	// not fit one session): the same source and added texts. Not persisted.
	PartsSource string             `json:"-"`
	PartsTexts  []MaterialFileText `json:"-"`
	// layout is how PartsSource is put together, to locate each path's material in it.
	layout partsLayout
}

// partsLayout is the parts source as the pieces it is joined from: the source is
// head + every block + mid + the entries joined by a newline + a final newline.
type partsLayout struct {
	// head is everything before the diff text: the check results and the diff heading.
	head string
	// blocks are the diff blocks, one per path that has one, in source order.
	blocks []diffBlock
	// mid is what follows the diff text, through the intro of the added-files section.
	mid string
	// entries is one entry per catalog entry (Files), in catalog order.
	entries []string
}

// diffBlock is the diff of one path: file is its index in the catalog.
type diffBlock struct {
	file int
	text string
}

// source joins the pieces.
func (l partsLayout) source() string {
	var b strings.Builder
	b.WriteString(l.head)
	for _, blk := range l.blocks {
		b.WriteString(blk.text)
	}
	b.WriteString(l.mid)
	b.WriteString(strings.Join(l.entries, "\n"))
	b.WriteString("\n")
	return b.String()
}

// MaterialHunkRange is the lines (1-based, inclusive) of one changed hunk: kind "diff" within
// its path's diff block, or kind "file" within an added file.
type MaterialHunkRange struct {
	Path  string `json:"path"`
	Kind  string `json:"kind"`
	First int    `json:"first_line"`
	Last  int    `json:"last_line"`
}

// MaterialSegment is the byte range [Start, End) of Source holding the diff block (kind
// "diff") or the text (kind "file") of one path.
type MaterialSegment struct {
	Path  string `json:"path"`
	Kind  string `json:"kind"`
	Start int    `json:"start"`
	End   int    `json:"end"`
}

// MaterialFileText is an added text file as it appears in the source.
type MaterialFileText struct{ Path, Heading, Content string }

// MaterialOf is the review material of in's green pass (in.Evidence.Pass): the changes between
// the candidate's start commit and the pass's tree, read from the candidate's checkout and Git
// repository, under the authority of the approved Intent, the project instructions, the testing
// rules, the protection and the configured commands.
func MaterialOf(in Input) (MaterialSet, error) {
	c, pass := in.Candidate, in.Evidence.Pass
	repo := c.Repo
	changed, err := repo.Changed(c.Start, pass.Tree)
	if err != nil {
		return MaterialSet{}, err
	}
	startEntries, err := repo.TreeEntries(c.Start)
	if err != nil {
		return MaterialSet{}, err
	}
	treeEntries, err := repo.TreeEntries(pass.Tree)
	if err != nil {
		return MaterialSet{}, err
	}
	original := map[string]git.TreeEntry{}
	for _, e := range startEntries {
		original[e.Path] = e
	}
	current := map[string]git.TreeEntry{}
	for _, e := range treeEntries {
		current[e.Path] = e
	}

	origins := map[string]string{}
	renames := map[string]bool{}
	renameDest := map[string]bool{}
	nameStatus, err := repo.OK("diff", "--name-status", "-z", "-M", "-C", "--find-copies-harder", c.Start, pass.Tree, "--")
	if err != nil {
		return MaterialSet{}, err
	}
	fields := strings.Split(strings.TrimSuffix(nameStatus, "\x00"), "\x00")
	for i := 0; i < len(fields) && fields[i] != ""; {
		status := fields[i]
		i++
		if strings.HasPrefix(status, "R") || strings.HasPrefix(status, "C") {
			old, dest := fields[i], fields[i+1]
			i += 2
			origins[dest] = old
			if status[0] == 'R' {
				renames[old] = true
				renameDest[dest] = true
			}
		} else {
			i++
		}
	}
	var blocks []diffBlock
	var texts []MaterialFileText
	var catalog []map[string]any
	var parts []string
	for _, p := range changed {
		if renames[p] {
			continue
		}
		old, wasThere := original[p]
		origin := origins[p]
		isRename := renameDest[p]
		if isRename {
			old, wasThere = original[origin], true
		}
		if wasThere {
			var d string
			if isRename {
				d, err = renameDiff(repo, c.Start, pass.Tree, origin, p)
			} else {
				d, err = repo.Diff(c.Start, pass.Tree, []string{p})
			}
			if err != nil {
				return MaterialSet{}, err
			}
			blocks = append(blocks, diffBlock{file: len(catalog), text: strings.ToValidUTF8(d, "�")})
		}
		entry, isThere := current[p]
		tree, at := c.Start, old
		if isThere {
			tree, at = pass.Tree, entry
		}
		// A gitlink has no content: its referenced commit id stands for it.
		content := at.Object
		if at.Mode != "160000" {
			if content, err = repo.OK("show", tree+":"+p); err != nil {
				return MaterialSet{}, err
			}
		}
		status := "deleted"
		switch {
		case isThere && wasThere:
			status = "changed"
		case isThere:
			status = "added"
		}
		catalog = append(catalog, map[string]any{
			"path": p, "status": status, "origin": origin, "rename": isRename, "mode": at.Mode, "git_object": at.Object,
			"bytes": len(content), "sha256": core.HashHex([]byte(content)),
		})
		if !isThere {
			parts = append(parts, "--- "+p+" (deleted)")
			continue
		}
		heading := "--- " + p
		if !wasThere {
			heading += " (added; mode " + entry.Mode + ")"
		}
		if origin != "" {
			heading += " (from " + origin + ")"
		}
		switch {
		case entry.Mode == "160000":
			if wasThere {
				parts = append(parts, heading+" (gitlink; change in diff)")
			} else {
				parts = append(parts, heading+"\nSubproject commit "+entry.Object)
			}
		case utf8.ValidString(content) && !strings.Contains(content, "\x00"):
			if wasThere {
				parts = append(parts, heading+" (changed; hunks in diff)")
			} else {
				rendered := heading + "\n" + content
				if content != "" && !strings.HasSuffix(content, "\n") {
					rendered += "\n\\ No newline at end of file"
				}
				parts = append(parts, rendered)
				texts = append(texts, MaterialFileText{Path: p, Heading: heading + "\n", Content: content})
			}
		default:
			parts = append(parts, heading+" (binary)")
		}
	}

	modelText := ""
	if t, err := readFile(c.Root, project.ModelPath(in.Intent.Slug)); err == nil {
		modelText = "\n# model.qnt\n\n" + string(t) + "\n"
	}
	feature, err := readFile(c.Root, project.FeaturePath(in.Intent.Slug))
	if err != nil {
		return MaterialSet{}, err
	}
	readme := "(no README.md)"
	// The project instructions are the README of the Build's start: a builder's edit of it is
	// candidate data. A README of the approved baseline is the one exception: its checkout
	// bytes are the approved ones.
	if slices.Contains(c.Protected, "README.md") {
		if t, err := readFile(c.Root, "README.md"); err == nil {
			readme = string(t)
		}
	} else if t, ok := repo.Show(c.Start, "README.md"); ok {
		readme = t
	}
	var checks []string
	for _, check := range in.Evidence.Commands.Checks {
		checks = append(checks, check.Name+": "+check.Run)
	}
	acceptanceRun := in.Evidence.Commands.Acceptance
	authority := "# Intent\n\n" + in.Intent.Text + "\n" +
		"# acceptance.feature\n\n" + string(feature) + "\n" +
		modelText + "\n" +
		"# Project instructions (README.md)\n\n" + readme + "\n\n" +
		project.SourceMessage(in.Intent.Source) + "\n\n" +
		"# Testing rules (docs/testing-rules.md)\n\n" + agent.Prompt(agent.TestingRules) + "\n\n" +
		"# Protected paths and configured commands\n\n" +
		"The approved baseline cannot change: " + strings.Join(c.Protected, ", ") + ".\n" +
		"Fixers: " + strings.Join(in.Evidence.Commands.Fix, "; ") + ".\n" +
		"Project checks: " + strings.Join(checks, "; ") + ".\n" +
		"Acceptance: " + acceptanceRun + ".\n\n"

	results := pass.Results()
	layout := partsLayout{
		head: strings.ToValidUTF8("# Check results of the final pass\n\n"+results+"\n\n"+
			"# Diff of existing/deleted paths against start HEAD "+short(c.Start)+"\n\n", "�"),
		blocks: blocks,
		mid: "\n" + partsHeading + "\n\n" +
			"Added files appear here with their mode; changed files have hunks in the diff.\n\n",
	}
	for _, e := range parts {
		layout.entries = append(layout.entries, strings.ToValidUTF8(e, "�"))
	}
	source := layout.source()
	set := MaterialSet{Authority: authority, Source: source, Files: catalog, Checks: results, Texts: texts, PartsSource: source, PartsTexts: texts, layout: layout}
	return set, nil
}

func renameDiff(repo *git.Repo, start, tree, origin, dest string) (string, error) {
	return repo.OK("diff", "--no-color", "--no-ext-diff", "--no-textconv", "-M", start, tree, "--", ":(literal)"+origin, ":(literal)"+dest)
}

var hunkRe = regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@`)

// materialManifestAt is, for each catalog entry, its diff stat and hunks (from the diff against
// the start HEAD; an added file is one synthesized hunk), where each path's diff block and text
// lie in source (its file texts follow the heading textsHeading), and the lines every changed
// hunk occupies in them (a deleted path's hunks only in its diff block; binary and gitlink
// entries have none).
func materialManifestAt(repo *git.Repo, start, tree string, catalog []map[string]any, texts []MaterialFileText, source, textsHeading string) ([]map[string]any, []MaterialSegment, []MaterialHunkRange, error) {
	manifest := make([]map[string]any, len(catalog))
	var segments []MaterialSegment
	ranges := []MaterialHunkRange{}
	cursor := strings.Index(source, "# Diff of existing/deleted paths")
	for i, f := range catalog {
		path, _ := f["path"].(string)
		stat := map[string]any{"added": 0, "deleted": 0}
		hunks := []map[string]any{}
		manifest[i] = map[string]any{"diff_stat": stat, "hunks": hunks}
		if f["mode"] == "160000" {
			continue
		}
		switch f["status"] {
		case "added":
			content := ""
			for _, t := range texts {
				if t.Path == path {
					content = t.Content
				}
			}
			n := strings.Count(content, "\n")
			if content != "" && !strings.HasSuffix(content, "\n") {
				n++
			}
			if n > 0 {
				stat["added"] = n
				hunks = append(hunks, map[string]any{"old_start": 0, "old_count": 0, "new_start": 1, "new_count": n, "header": fmt.Sprintf("@@ -0,0 +1,%d @@", n)})
				ranges = append(ranges, MaterialHunkRange{Path: path, Kind: "file", First: 1, Last: n})
			}
		case "changed", "deleted":
			var diff string
			var err error
			if f["rename"] == true {
				diff, err = renameDiff(repo, start, tree, f["origin"].(string), path)
			} else {
				diff, err = repo.Diff(start, tree, []string{path})
			}
			if err != nil {
				return nil, nil, nil, err
			}
			diff = strings.ToValidUTF8(diff, "�")
			if at := strings.Index(source[cursor:], diff); diff != "" && at >= 0 {
				segments = append(segments, MaterialSegment{Path: path, Kind: "diff", Start: cursor + at, End: cursor + at + len(diff)})
				cursor += at + len(diff)
			}
			lines := strings.Split(diff, "\n")
			total := len(lines)
			if strings.HasSuffix(diff, "\n") {
				total--
			}
			open := -1
			for n, line := range lines[:total] {
				if m := hunkRe.FindStringSubmatch(line); m != nil {
					num := func(s string, def int) int {
						if s == "" {
							return def
						}
						n, _ := strconv.Atoi(s)
						return n
					}
					newStart, newCount := num(m[3], 0), num(m[4], 1)
					if open >= 0 {
						ranges[open].Last = n
					}
					ranges = append(ranges, MaterialHunkRange{Path: path, Kind: "diff", First: n + 1, Last: total})
					open = len(ranges) - 1

					hunks = append(hunks, map[string]any{
						"old_start": num(m[1], 0), "old_count": num(m[2], 1), "new_start": newStart, "new_count": newCount,
						"header": m[0],
					})
					continue
				}
				switch {
				case open < 0:
				case strings.HasPrefix(line, "+"):
					stat["added"] = stat["added"].(int) + 1
				case strings.HasPrefix(line, "-"):
					stat["deleted"] = stat["deleted"].(int) + 1
				}
			}
		}
		manifest[i]["hunks"] = hunks
	}
	cursor = strings.Index(source, textsHeading)
	for _, t := range texts {
		at := strings.Index(source[cursor:], t.Heading+t.Content)
		if at < 0 || t.Content == "" {
			continue
		}
		start := cursor + at + len(t.Heading)
		segments = append(segments, MaterialSegment{Path: t.Path, Kind: "file", Start: start, End: start + len(t.Content)})
		cursor = start + len(t.Content)
	}
	return manifest, segments, ranges, nil
}

// partsHeading is the heading of the third section of the parts source.
const partsHeading = "# Full text of every added file"

// materialBlocks locates each changed path's material in the parts source: its block in the diff
// (from its `diff --git` line to the next block or the end of the diff) and its `--- <path>`
// heading with its full text (to the next heading or the end), in source order.
func materialBlocks(c Candidate, tree string, m MaterialSet) ([]MaterialSegment, error) {
	_, segments, _, err := materialManifestAt(c.Repo, c.Start, tree, m.Files, m.PartsTexts, m.PartsSource, partsHeading)
	if err != nil {
		return nil, err
	}
	heading := map[string]int{}
	for _, t := range m.PartsTexts {
		heading[t.Path] = len(t.Heading)
	}
	for i, seg := range segments {
		if seg.Kind == "file" {
			segments[i].Start -= heading[seg.Path]
		}
	}
	slices.SortFunc(segments, func(a, b MaterialSegment) int { return a.Start - b.Start })
	return segments, nil
}

// The candidate as a review observes it in its checkout.

// candidateTree is the candidate tree of the checkout now.
func candidateTree(c Candidate) (string, error) { return c.Repo.Tree(c.Start, c.Excluded) }

// inStart reports whether path is a file of the candidate's start commit.
func inStart(c Candidate, path string) bool {
	_, ok := c.Repo.Show(c.Start, path)
	return ok
}

// treeDrift states, from observation, how the candidate tree differs from the green tree of
// its pass: both identities and the changed paths, or the concrete reason the paths cannot be
// listed.
func treeDrift(c Candidate, observed, green string) string {
	fact := fmt.Sprintf("observed tree %s, green tree %s", short(observed), short(green))
	paths, err := c.Repo.Changed(green, observed)
	if err != nil {
		return fact + "; the changed paths cannot be inspected: " + err.Error()
	}
	if len(paths) == 0 {
		return fact + "; no path differs in the compared trees"
	}
	return fact + "; changed paths: " + strings.Join(paths, ", ")
}

func readFile(root, rel string) ([]byte, error) { return os.ReadFile(filepath.Join(root, rel)) }

func short(s string) string { return s[:min(8, len(s))] }
