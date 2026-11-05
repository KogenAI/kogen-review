package review

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	gitpkg "github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-verification/verify"
)

// edgeRepo is a temporary Git repository with a start commit and, after candidate, a candidate
// commit.
type edgeRepo struct {
	t    *testing.T
	root string
}

func newEdgeRepo(t *testing.T) *edgeRepo {
	r := &edgeRepo{t: t, root: t.TempDir()}
	r.git("init", "-q")
	r.write(".kogen/intents/test/acceptance.feature", "Feature: test\n")
	return r
}

func (r *edgeRepo) git(args ...string) string {
	r.t.Helper()
	c := exec.Command("git", args...)
	c.Dir = r.root
	c.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.test", "GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.test")
	b, e := c.CombinedOutput()
	if e != nil {
		r.t.Fatalf("git %v: %s: %v", args, b, e)
	}
	return strings.TrimSpace(string(b))
}

func (r *edgeRepo) write(p, s string) {
	r.t.Helper()
	p = filepath.Join(r.root, p)
	if e := os.MkdirAll(filepath.Dir(p), 0755); e != nil {
		r.t.Fatal(e)
	}
	if e := os.WriteFile(p, []byte(s), 0644); e != nil {
		r.t.Fatal(e)
	}
}

func (r *edgeRepo) remove(p string) {
	r.t.Helper()
	if e := os.Remove(filepath.Join(r.root, p)); e != nil {
		r.t.Fatal(e)
	}
}

// commit stages everything, lets stage adjust the index, and commits; it returns the new commit.
func (r *edgeRepo) commit(msg string, stage func()) string {
	r.t.Helper()
	r.git("add", "-A")
	if stage != nil {
		stage()
	}
	r.git("commit", "-qm", msg)
	return r.git("rev-parse", "HEAD")
}

// material is the review material of the candidate commit made on start.
func (r *edgeRepo) material(start string) (Candidate, string, MaterialSet) {
	r.t.Helper()
	tree := r.git("rev-parse", "HEAD^{tree}")
	c := Candidate{Root: r.root, Repo: gitpkg.New(r.root, nil), Start: start, Tree: tree}
	m, e := MaterialOf(Input{Candidate: c, Intent: Intent{Slug: "test"}, Evidence: Evidence{Pass: verify.Pass{Tree: tree, Green: true, Clean: true}}})
	if e != nil {
		r.t.Fatal(e)
	}
	return c, tree, m
}

// entryOf is the catalog index of path (and, when origin is not empty, the entry's origin).
func entryOf(t *testing.T, files []map[string]any, path string) (int, map[string]any) {
	t.Helper()
	found := -1
	for i, f := range files {
		if f["path"] == path {
			if found >= 0 {
				t.Fatalf("catalog has more than one entry for %s: %v", path, files)
			}
			found = i
		}
	}
	if found < 0 {
		t.Fatalf("catalog has no entry for %s: %v", path, files)
	}
	return found, files[found]
}

func rangesOf(ranges []MaterialHunkRange, path string) []MaterialHunkRange {
	var out []MaterialHunkRange
	for _, r := range ranges {
		if r.Path == path {
			out = append(out, r)
		}
	}
	return out
}

func segmentsOf(segments []MaterialSegment, path, kind string) []MaterialSegment {
	var out []MaterialSegment
	for _, s := range segments {
		if s.Path == path && s.Kind == kind {
			out = append(out, s)
		}
	}
	return out
}

func wantContains(t *testing.T, source string, wants ...string) {
	t.Helper()
	for _, want := range wants {
		if !strings.Contains(source, want) {
			t.Errorf("source lacks %q", want)
		}
	}
}

func wantOnce(t *testing.T, source string, wants ...string) {
	t.Helper()
	for _, want := range wants {
		if n := strings.Count(source, want); n != 1 {
			t.Errorf("%q occurs %d times, want once", want, n)
		}
	}
}

func wantAbsent(t *testing.T, source string, unwanted ...string) {
	t.Helper()
	for _, s := range unwanted {
		if strings.Contains(source, s) {
			t.Errorf("source contains %q", s)
		}
	}
}

func TestMaterialAddedFileWithoutFinalNewline(t *testing.T) {
	r := newEdgeRepo(t)
	r.write("keep.txt", "keep\n")
	start := r.commit("start", nil)
	r.write("tail.txt", "TAIL_ONE\nTAIL_TWO")
	r.commit("candidate", nil)
	c, tree, m := r.material(start)
	wantContains(t, m.Source, "--- tail.txt (added; mode 100644)\nTAIL_ONE\nTAIL_TWO\n\\ No newline at end of file\n")
	manifest, segments, ranges, e := materialManifestAt(c.Repo, start, tree, m.Files, m.Texts, m.Source, partsHeading)
	if e != nil {
		t.Fatal(e)
	}
	i, _ := entryOf(t, m.Files, "tail.txt")
	if got, want := fmt.Sprint(manifest[i]["diff_stat"]), "map[added:2 deleted:0]"; got != want {
		t.Errorf("diff_stat %s, want %s", got, want)
	}
	hunks, _ := manifest[i]["hunks"].([]map[string]any)
	if len(hunks) != 1 || hunks[0]["header"] != "@@ -0,0 +1,2 @@" || hunks[0]["new_count"] != 2 || hunks[0]["new_start"] != 1 {
		t.Errorf("hunks %v", hunks)
	}
	if got, want := rangesOf(ranges, "tail.txt"), []MaterialHunkRange{{Path: "tail.txt", Kind: "file", First: 1, Last: 2}}; !slices.Equal(got, want) {
		t.Errorf("ranges %v, want %v", got, want)
	}
	files := segmentsOf(segments, "tail.txt", "file")
	if len(files) != 1 || m.Source[files[0].Start:files[0].End] != "TAIL_ONE\nTAIL_TWO" {
		t.Errorf("file segments %v", files)
	}
}

func TestMaterialModeOnlyChange(t *testing.T) {
	r := newEdgeRepo(t)
	r.write("script.sh", "echo MODE_BODY\n")
	start := r.commit("start", nil)
	r.commit("candidate", func() { r.git("update-index", "--chmod=+x", "script.sh") })
	c, tree, m := r.material(start)
	wantOnce(t, m.Source, "diff --git a/script.sh b/script.sh\nold mode 100644\nnew mode 100755\n")
	wantContains(t, m.Source, "--- script.sh (changed; hunks in diff)")
	wantAbsent(t, m.Source, "MODE_BODY")
	i, f := entryOf(t, m.Files, "script.sh")
	if f["status"] != "changed" || f["mode"] != "100755" {
		t.Errorf("catalog entry %v", f)
	}
	manifest, _, _, e := materialManifestAt(c.Repo, start, tree, m.Files, m.Texts, m.Source, partsHeading)
	if e != nil {
		t.Fatal(e)
	}
	if hunks, _ := manifest[i]["hunks"].([]map[string]any); len(hunks) != 0 {
		t.Errorf("hunks %v", hunks)
	}
	if got, want := fmt.Sprint(manifest[i]["diff_stat"]), "map[added:0 deleted:0]"; got != want {
		t.Errorf("diff_stat %s, want %s", got, want)
	}
}

func TestMaterialGitlinkChange(t *testing.T) {
	const before, after = "1111111111111111111111111111111111111111", "2222222222222222222222222222222222222222"
	r := newEdgeRepo(t)
	r.write("keep.txt", "keep\n")
	start := r.commit("start", func() { r.git("update-index", "--add", "--cacheinfo", "160000,"+before+",sub") })
	r.commit("candidate", func() { r.git("update-index", "--add", "--cacheinfo", "160000,"+after+",sub") })
	_, _, m := r.material(start)
	wantContains(t, m.Source, "-Subproject commit "+before, "+Subproject commit "+after, "--- sub (gitlink; change in diff)")
	wantOnce(t, m.Source, "Subproject commit "+after)
	_, f := entryOf(t, m.Files, "sub")
	if f["mode"] != "160000" || f["git_object"] != after {
		t.Errorf("catalog entry %v", f)
	}
}

func TestMaterialBinaryRename(t *testing.T) {
	r := newEdgeRepo(t)
	// Valid UTF-8 that contains NUL: it is binary all the same.
	payload := "BIN\x00" + strings.Repeat("binary payload\x00\x01\x02", 30)
	r.write("old.bin", payload)
	start := r.commit("start", nil)
	r.remove("old.bin")
	r.write("new.bin", payload)
	r.commit("candidate", nil)
	_, _, m := r.material(start)
	wantContains(t, m.Source, "rename from old.bin\nrename to new.bin\n", "\n--- new.bin (from old.bin) (binary)")
	wantAbsent(t, m.Source, "--- old.bin", "binary payload")
	_, f := entryOf(t, m.Files, "new.bin")
	if f["status"] != "changed" || f["origin"] != "old.bin" || f["rename"] != true {
		t.Errorf("catalog entry %v", f)
	}
	for _, f := range m.Files {
		if f["path"] == "old.bin" {
			t.Errorf("catalog entry for the renamed origin: %v", f)
		}
	}
}

func TestMaterialDeletedFile(t *testing.T) {
	r := newEdgeRepo(t)
	r.write("gone.txt", "GONE_ONE\nGONE_TWO\n")
	r.write("keep.txt", "keep\n")
	start := r.commit("start", nil)
	r.remove("gone.txt")
	r.commit("candidate", nil)
	c, tree, m := r.material(start)
	wantContains(t, m.Source, "diff --git a/gone.txt b/gone.txt\ndeleted file mode 100644\n", "@@ -1,2 +0,0 @@\n-GONE_ONE\n-GONE_TWO\n", "--- gone.txt (deleted)")
	wantOnce(t, m.Source, "GONE_ONE")
	i, f := entryOf(t, m.Files, "gone.txt")
	if f["status"] != "deleted" || f["mode"] != "100644" {
		t.Errorf("catalog entry %v", f)
	}
	manifest, segments, ranges, e := materialManifestAt(c.Repo, start, tree, m.Files, m.Texts, m.Source, partsHeading)
	if e != nil {
		t.Fatal(e)
	}
	if got, want := fmt.Sprint(manifest[i]["diff_stat"]), "map[added:0 deleted:2]"; got != want {
		t.Errorf("diff_stat %s, want %s", got, want)
	}
	hunks, _ := manifest[i]["hunks"].([]map[string]any)
	if len(hunks) != 1 || hunks[0]["old_start"] != 1 || hunks[0]["old_count"] != 2 || hunks[0]["new_start"] != 0 || hunks[0]["new_count"] != 0 || hunks[0]["header"] != "@@ -1,2 +0,0 @@" {
		t.Errorf("hunks %v", hunks)
	}
	if got := segmentsOf(segments, "gone.txt", "diff"); len(got) != 1 {
		t.Errorf("diff segments %v", got)
	}
	if got, want := rangesOf(ranges, "gone.txt"), []MaterialHunkRange{{Path: "gone.txt", Kind: "diff", First: 6, Last: 8}}; !slices.Equal(got, want) {
		t.Errorf("ranges %v, want %v", got, want)
	}
}

// Every part after the first names the bytes it carries as the range that continues the previous
// part, and carries only its own slice of the source.
func TestMaterialPartsNameTheirContinuingByteRange(t *testing.T) {
	r := newEdgeRepo(t)
	r.write("keep.txt", "keep\n")
	r.write("edited.txt", strings.Repeat("before\n", 20))
	start := r.commit("start", nil)
	r.write("edited.txt", strings.Repeat("after\n", 20))
	for i := range 4 {
		r.write(fmt.Sprintf("added%d.txt", i), strings.Repeat(fmt.Sprintf("added %d line\n", i), 20))
	}
	r.commit("candidate", nil)
	c, tree, m := r.material(start)
	blocks, e := materialBlocks(c, tree, m)
	if e != nil {
		t.Fatal(e)
	}
	catalog, e := json.Marshal(m.Files)
	if e != nil {
		t.Fatal(e)
	}
	p := &reviewParter{
		source: m.PartsSource, sum: core.HashHex([]byte(m.PartsSource)), checks: m.Checks, catalog: string(catalog),
		blocks: blocks, measure: func(dynamic string) int { return len(dynamic) },
	}
	// A ceiling that leaves a third of the source after the mandatory prompt cuts at least two parts.
	p.ceiling = p.mandatory() + len(m.PartsSource)/3
	cuts, e := p.cut()
	if e != nil {
		t.Fatal(e)
	}
	if len(cuts) < 2 {
		t.Fatalf("%d parts for a %d-byte source", len(cuts), len(m.PartsSource))
	}
	texts := p.texts(cuts)
	if len(texts) != len(cuts) {
		t.Fatalf("%d texts for %d parts", len(texts), len(cuts))
	}
	n, at := len(cuts), 0
	var joined strings.Builder
	for i, cut := range cuts {
		k := i + 1
		if cut.From != at {
			t.Errorf("part %d starts at byte %d, the previous part ended at %d", k, cut.From, at)
		}
		at = cut.To
		slice := m.PartsSource[cut.From:cut.To]
		joined.WriteString(slice)
		want := fmt.Sprintf("This part carries bytes [%d, %d) of the %d bytes of the candidate's complete review source (SHA-256 %s); the other parts carry the rest, in order.", cut.From, cut.To, len(m.PartsSource), core.HashHex([]byte(m.PartsSource)))
		if !strings.Contains(texts[i], want) {
			t.Errorf("part %d lacks %q", k, want)
		}
		if got := p.header(k, n, cut.From, cut.To) + slice; texts[i] != got {
			t.Errorf("part %d is not its header followed by exactly its slice [%d, %d)", k, cut.From, cut.To)
		}
		if !strings.HasSuffix(texts[i], "# Source part "+fmt.Sprint(k)+" of "+fmt.Sprint(n)+"\n\n"+slice) {
			t.Errorf("part %d does not end with its own slice", k)
		}
	}
	if cuts[0].From != 0 {
		t.Errorf("the first part starts at byte %d", cuts[0].From)
	}
	if joined.String() != m.PartsSource {
		t.Error("the slices joined in order differ from the source")
	}
}
