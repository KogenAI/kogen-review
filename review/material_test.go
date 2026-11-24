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

// sharedSupportMaterial is the material of a candidate that rewrites the files of start (path to
// text) with candidate (a nil text deletes the path).
func sharedSupportMaterial(t *testing.T, start, candidate map[string]string) MaterialSet {
	t.Helper()
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
	write := func(files map[string]string) {
		t.Helper()
		for p, s := range files {
			p = filepath.Join(root, p)
			if e := os.MkdirAll(filepath.Dir(p), 0755); e != nil {
				t.Fatal(e)
			}
			if e := os.WriteFile(p, []byte(s), 0644); e != nil {
				t.Fatal(e)
			}
		}
	}
	run("init", "-q")
	write(map[string]string{".kogen/intents/test/acceptance.feature": "Feature: test\n"})
	write(start)
	run("add", "-A")
	run("commit", "-qm", "start")
	startRev := run("rev-parse", "HEAD")
	write(candidate)
	run("add", "-A")
	run("commit", "-qm", "candidate")
	tree := run("rev-parse", "HEAD^{tree}")
	c := Candidate{Root: root, Repo: gitpkg.New(root, nil), Start: startRev, Tree: tree}
	m, e := MaterialOf(Input{Candidate: c, Intent: Intent{Slug: "test", Text: "# Intent\n"}, Evidence: Evidence{Pass: verify.Pass{Tree: tree, Green: true, Clean: true}}})
	if e != nil {
		t.Fatal(e)
	}
	if m.Source != m.PartsSource {
		t.Error("routes differ")
	}
	return m
}

// sharedLineOf is the shared test support line of the source, or "" when it has none; the line
// must come once, after the check results and before the diff heading, with a blank line after.
func sharedLineOf(t *testing.T, m MaterialSet) string {
	t.Helper()
	const prefix = "shared test support changed:"
	if n := strings.Count(m.Source, prefix); n > 1 {
		t.Fatalf("the line occurs %d times", n)
	}
	at := strings.Index(m.Source, prefix)
	if at < 0 {
		return ""
	}
	end := at + strings.Index(m.Source[at:], "\n")
	diff := strings.Index(m.Source, "# Diff of existing/deleted paths")
	if at > diff || !strings.HasPrefix(m.Source[end:], "\n\n# Diff of existing/deleted paths") || m.Source[at-2:at] != "\n\n" {
		t.Fatalf("the line is misplaced in %q", m.Source)
	}
	return m.Source[at:end]
}

func TestSharedTestSupportLineBeforeTheDiff(t *testing.T) {
	m := sharedSupportMaterial(t,
		map[string]string{"test/test_helpers/session_test_helper.rb": "module S\nend\n", "app/models/thing.rb": "class Thing\nend\n"},
		map[string]string{"test/test_helpers/session_test_helper.rb": "module S\n  def x; end\nend\n"})
	if got := sharedLineOf(t, m); got != "shared test support changed: test/test_helpers/session_test_helper.rb" {
		t.Fatalf("line = %q", got)
	}
	m = sharedSupportMaterial(t,
		map[string]string{"test/test_helper.rb": "# h\n", "spec/support/a.rb": "# a\n", "features/support/env.rb": "# e\n", "config/environments/test.rb": "# c\n", "conftest.py": "# c\n", "lib/support/x.rb": "# x\n", "test/models/a_test.rb": "# t\n"},
		map[string]string{"test/test_helper.rb": "# h2\n", "spec/support/a.rb": "# a2\n", "features/support/env.rb": "# e2\n", "config/environments/test.rb": "# c2\n", "conftest.py": "# c2\n", "lib/support/x.rb": "# x2\n", "test/models/a_test.rb": "# t2\n", "test/test_helpers/new.rb": "# new\n"})
	want := "shared test support changed: config/environments/test.rb, conftest.py, features/support/env.rb, spec/support/a.rb, test/test_helper.rb"
	if got := sharedLineOf(t, m); got != want {
		t.Fatalf("line = %q", got)
	}
}

func TestNoSharedTestSupportLineForANewTestFile(t *testing.T) {
	m := sharedSupportMaterial(t,
		map[string]string{"app/models/thing.rb": "class Thing\nend\n", "test/models/old_test.rb": "# old\n"},
		map[string]string{"test/models/new_thing_test.rb": "# new\n", "app/models/thing.rb": "class Thing\n  def x; end\nend\n"})
	if got := sharedLineOf(t, m); got != "" {
		t.Fatalf("line = %q", got)
	}
	if !strings.Contains(m.Source, "\n\n# Diff of existing/deleted paths") || strings.Contains(m.Source, "\n\n\n# Diff") {
		t.Fatal("source is not the plain one")
	}
}

func TestManifestChangeIsSupportOnlyWhenNotAPlainBump(t *testing.T) {
	cases := []struct {
		name, path, from, to string
		listed               bool
	}{
		{"lockfile bump", "Gemfile.lock", "GEM\n  specs:\n    rails (7.1.0)\n", "GEM\n  specs:\n    rails (7.1.1)\n", false},

		{"nested package bump", "web/package.json", "{\n  \"version\": \"1.2.3\"\n}\n", "{\n  \"version\": \"1.2.4\"\n}\n", false},
		{"dependency bump", "web/package.json", "{\n  \"dependencies\": { \"a\": \"^2.0.0-beta.1\" }\n}\n", "{\n  \"dependencies\": { \"a\": \"^2.1.0\" }\n}\n", false},
		{"dependency operator", "package.json", `{"dependencies":{"a":"^1.0.0"}}`, `{"dependencies":{"a":"~2.0.0"}}`, true},
		{"invalid version syntax", "package.json", `{"version":"1foo"}`, `{"version":"2foo"}`, true},
		{"go module name", "go.mod", "module v1.0.0\n", "module v2.0.0\n", true},
		{"mix lock bump", "mix.lock", "%{\n  \"plug\": {:hex, :plug, \"1.0.0\"},\n}\n", "%{\n  \"plug\": {:hex, :plug, \"1.1.0\"},\n}\n", false},
		{"project version bump", "pyproject.toml", "[project]\nversion = \"1.0.0\"\n", "[project]\nversion = \"1.1.0\"\n", false},
		{"other toml version", "pyproject.toml", "[tool.other]\nversion = \"1.0.0\"\n", "[tool.other]\nversion = \"1.1.0\"\n", true},
		{"go require bump", "go.mod", "require example.com/a v1.0.0\n", "require example.com/a v1.1.0\n", false},
		{"go sum bump", "go.sum", "example.com/a v1.0.0 h1:abc\n", "example.com/a v1.1.0 h1:abc\n", false},
		{"invalid lock version", "Gemfile.lock", "GEM\n  specs:\n    rails (1foo)\n", "GEM\n  specs:\n    rails (2foo)\n", true},
		{"lockfile non-specs", "Gemfile.lock", "OTHER\n  worker (1.0)\n", "OTHER\n  worker (2.0)\n", true},
		{"script argument", "web/package.json", "{\"scripts\":{\"test\":\"test --workers=1\"}}\n", "{\"scripts\":{\"test\":\"test --workers=2\"}}\n", true},
		{"numeric setting", "package.json", "{\"workers\":1}\n", "{\"workers\":2}\n", true},
		{"nested version", "package.json", "{\"config\":{\"version\":\"1.0.0\"}}\n", "{\"config\":{\"version\":\"2.0.0\"}}\n", true},
		{"dependency name", "package.json", "{\"dependencies\":{\"lib1\":\"1.0.0\"}}\n", "{\"dependencies\":{\"lib2\":\"1.0.0\"}}\n", true},
		{"shared path wins", "test/support/package.json", "{\"version\":\"1.0.0\"}\n", "{\"version\":\"2.0.0\"}\n", true},
		{"added option", "Gemfile", "gem 'rails'\n", "gem 'rails', require: false\n", true},
		{"added line", "go.mod", "module x\n", "module x\n\nrequire y v1.0.0\n", true},
		{"removed line", "requirements.txt", "a==1.0\nb==2.0\n", "a==1.0\n", true},
		{"renamed dependency", "Gemfile.lock", "    rails (7.1.0)\n", "    rack (7.1.0)\n", true},
	}
	for _, tc := range cases {
		m := sharedSupportMaterial(t, map[string]string{tc.path: tc.from}, map[string]string{tc.path: tc.to})
		want := ""
		if tc.listed {
			want = "shared test support changed: " + tc.path
		}
		if got := sharedLineOf(t, m); got != want {
			t.Errorf("%s: line = %q, want %q", tc.name, got, want)
		}
	}
}

func TestSharedTestSupportLineWithNamedPath(t *testing.T) {
	m := sharedSupportMaterial(t,
		map[string]string{"test/test_helpers/session_test_helper.rb": "module S\nend\n"},
		map[string]string{"test/test_helpers/session_test_helper.rb": "module S\n  def sign_in; end\nend\n"})
	// The line is a fact about the candidate: the Intent text (which names the path) is not read.
	if got := sharedLineOf(t, m); got != "shared test support changed: test/test_helpers/session_test_helper.rb" {
		t.Fatalf("line = %q", got)
	}
	if !strings.Contains(SharedTestSupportRule, "A path the Intent names is not an issue.") {
		t.Fatal("the rule does not say a named path is not an issue")
	}
}
