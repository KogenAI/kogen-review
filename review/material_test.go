package review

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	gitpkg "github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-verification/verify"
)

func TestMaterialRenameCopyAndHunkLocations(t *testing.T) {
	root := t.TempDir()
	run := func(args ...string) string {
		t.Helper()
		c := exec.Command("git", args...)
		c.Dir = root
		c.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.test", "GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.test")
		b, e := c.CombinedOutput()
		if e != nil {
			t.Fatalf("git %v: %s: %v", args, b, e)
		}
		return strings.TrimSpace(string(b))
	}
	write := func(p, s string) {
		t.Helper()
		p = filepath.Join(root, p)
		if e := os.MkdirAll(filepath.Dir(p), 0755); e != nil {
			t.Fatal(e)
		}
		if e := os.WriteFile(p, []byte(s), 0644); e != nil {
			t.Fatal(e)
		}
	}
	run("init", "-q")
	write(".kogen/intents/test/acceptance.feature", "Feature: test\n")
	stable := strings.Repeat("unchanged line\n", 40)
	write("old", stable+"old marker\n")
	write("copy-origin", "copy marker\n")
	write("edited", "before\n")
	run("add", "-A")
	run("commit", "-qm", "start")
	start := run("rev-parse", "HEAD")
	if e := os.Remove(filepath.Join(root, "old")); e != nil {
		t.Fatal(e)
	}
	write("new", stable+"new marker\n")
	write("copy-dest", "copy marker\n")
	write("edited", "after\n")
	write("added", "added marker")
	run("add", "-A")
	run("commit", "-qm", "candidate")
	tree := run("rev-parse", "HEAD^{tree}")
	c := Candidate{Root: root, Repo: gitpkg.New(root, nil), Start: start, Tree: tree}
	m, e := MaterialOf(Input{Candidate: c, Intent: Intent{Slug: "test"}, Evidence: Evidence{Pass: verify.Pass{Tree: tree, Green: true, Clean: true}}})
	if e != nil {
		t.Fatal(e)
	}
	for _, marker := range []string{"old marker", "new marker", "copy marker", "before", "after", "added marker"} {
		if n := strings.Count(m.Source, marker); n != 1 {
			t.Errorf("%s occurs %d times", marker, n)
		}
	}
	for _, want := range []string{"rename from old", "rename to new", "copy-dest (added; mode 100644) (from copy-origin)"} {
		if !strings.Contains(m.Source, want) {
			t.Errorf("missing %q", want)
		}
	}
	if m.Source != m.PartsSource {
		t.Error("routes differ")
	}
	_, segments, ranges, e := materialManifestAt(c.Repo, start, tree, m.Files, m.Texts, m.Source, partsHeading)
	if e != nil {
		t.Fatal(e)
	}
	for _, path := range []string{"new", "edited", "added"} {
		found := false
		for _, s := range segments {
			if s.Path == path {
				found = true
			}
		}
		if !found {
			t.Errorf("no segment for %s", path)
		}
		found = false
		for _, r := range ranges {
			if r.Path == path {
				found = true
				if path != "added" && r.Kind != "diff" {
					t.Errorf("changed file has non-diff range: %+v", r)
				}
			}
		}
		if !found {
			t.Errorf("no hunk range for %s", path)
		}
	}
}
