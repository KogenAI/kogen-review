package consumes

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	gitpkg "github.com/KogenAI/kogen-coordinator/git"
)

func TestNewMakesARepoWithoutCheckingIt(t *testing.T) {
	dir := t.TempDir()
	r := gitpkg.New(dir, nil)
	if r == nil {
		t.Fatal("git.New: nil Repo")
	}
	eq(t, "git.New", r.Dir, dir)
	eq(t, "git.New", r.Env == nil, true)
	// New checks nothing: a folder that is not a repository only fails when asked something.
	if _, err := r.Resolve("HEAD"); err == nil {
		t.Error("git.Repo.Resolve: a folder that is not a repository resolved HEAD")
	}
	// An explicit environment is the one the commands run in.
	repo := newRepo(t, map[string]string{"a.txt": "one\n"})
	r = gitpkg.New(repo, os.Environ())
	head, err := r.Resolve("HEAD^{commit}")
	eq(t, "git.New", err, nil)
	eq(t, "git.New", head, gitOut(t, repo, "rev-parse", "HEAD"))
}

func TestRepoResolve(t *testing.T) {
	repo := newRepo(t, map[string]string{"a.txt": "one\n"})
	r := gitpkg.New(repo, nil)
	head := gitOut(t, repo, "rev-parse", "HEAD")
	// cmd/kogen-review resolves -start + "^{commit}" to the commit id.
	got, err := r.Resolve("HEAD^{commit}")
	eq(t, "git.Repo.Resolve", err, nil)
	eq(t, "git.Repo.Resolve", got, head)
	eq(t, "git.Repo.Resolve", len(got), 40)
	got, err = r.Resolve(head[:12] + "^{commit}")
	eq(t, "git.Repo.Resolve", err, nil)
	eq(t, "git.Repo.Resolve", got, head)
	got, err = r.Resolve("HEAD^{tree}")
	eq(t, "git.Repo.Resolve", err, nil)
	eq(t, "git.Repo.Resolve", got, gitOut(t, repo, "rev-parse", "HEAD^{tree}"))
	// What is not a commit, or is not a revision at all, is an error and no id.
	for _, rev := range []string{"nonexistent^{commit}", "", "-HEAD", "HEAD\x00"} {
		got, err = r.Resolve(rev)
		if err == nil || got != "" {
			t.Errorf("git.Repo.Resolve(%q): got %q, %v, want an error", rev, got, err)
		}
	}
}

func TestRepoTree(t *testing.T) {
	repo := newRepo(t, map[string]string{"a.txt": "one\n", "keep/b.txt": "b\n", ".gitignore": "ignored.txt\n"})
	r := gitpkg.New(repo, nil)
	start := gitOut(t, repo, "rev-parse", "HEAD")
	// A candidate equal to its start has the start's tree.
	tree, err := r.Tree(start, nil)
	eq(t, "git.Repo.Tree", err, nil)
	eq(t, "git.Repo.Tree", tree, gitOut(t, repo, "rev-parse", "HEAD^{tree}"))

	// A candidate is every tracked file and every untracked file not ignored, with content and
	// mode, and not what is ignored.
	write(t, repo, "a.txt", "two\n", 0o644)
	write(t, repo, "new/c.txt", "c\n", 0o644)
	write(t, repo, "run.sh", "#!/bin/sh\n", 0o755)
	write(t, repo, "ignored.txt", "x\n", 0o644)
	write(t, repo, "other/d.txt", "d\n", 0o644)
	gitOut(t, repo, "add", "other/d.txt")
	tree, err = r.Tree(start, nil)
	eq(t, "git.Repo.Tree", err, nil)
	entries := gitOut(t, repo, "ls-tree", "-r", tree)
	for _, want := range []string{"100644 blob", "a.txt", "new/c.txt", "100755 blob", "run.sh", "keep/b.txt", "other/d.txt"} {
		if !strings.Contains(entries, want) {
			t.Errorf("git.Repo.Tree: tree lacks %q:\n%s", want, entries)
		}
	}
	if strings.Contains(entries, "ignored.txt") {
		t.Errorf("git.Repo.Tree: tree holds an ignored file:\n%s", entries)
	}
	eq(t, "git.Repo.Tree", gitOut(t, repo, "show", tree+":a.txt"), "two")
	// The user's index is untouched: only what the user staged stays staged.
	eq(t, "git.Repo.Tree", gitOut(t, repo, "diff", "--cached", "--name-only"), "other/d.txt")

	// Excluded paths (other Intents' folders) are left out, taken literally.
	tree, err = r.Tree(start, []string{"new", "other"})
	eq(t, "git.Repo.Tree", err, nil)
	entries = gitOut(t, repo, "ls-tree", "-r", "--name-only", tree)
	eq(t, "git.Repo.Tree", entries, ".gitignore\na.txt\nkeep/b.txt\nrun.sh")

	// An unusable start is an error and no tree.
	for _, rev := range []string{"", "-x", "0000000000000000000000000000000000000001"} {
		got, err := r.Tree(rev, nil)
		if err == nil || got != "" {
			t.Errorf("git.Repo.Tree(%q): got %q, %v, want an error", rev, got, err)
		}
	}
}

func TestRepoChanged(t *testing.T) {
	repo := newRepo(t, map[string]string{"a.txt": "one\n", "gone.txt": "bye\n", "same.txt": "same\n", "old name.txt": "some long content\nof the file\nfor rename\n"})
	r := gitpkg.New(repo, nil)
	start := gitOut(t, repo, "rev-parse", "HEAD")
	got, err := r.Changed(start, start)
	eq(t, "git.Repo.Changed", err, nil)
	eq(t, "git.Repo.Changed", len(got), 0)

	write(t, repo, "a.txt", "two\n", 0o644)
	write(t, repo, "dir/ünï.txt", "new\n", 0o644)
	if err := os.Remove(filepath.Join(repo, "gone.txt")); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(repo, "old name.txt"), filepath.Join(repo, "new name.txt")); err != nil {
		t.Fatal(err)
	}
	tree, err := r.Tree(start, nil)
	eq(t, "git.Repo.Changed", err, nil)
	// Trees as well as commits; paths as Git names them in -z mode (no quoting), a rename as
	// its two paths, in Git's order.
	want := []string{"a.txt", "dir/ünï.txt", "gone.txt", "new name.txt", "old name.txt"}
	got, err = r.Changed(start, tree)
	eq(t, "git.Repo.Changed", err, nil)
	deepEq(t, "git.Repo.Changed", got, want)
	got, err = r.Changed(tree, start)
	eq(t, "git.Repo.Changed", err, nil)
	deepEq(t, "git.Repo.Changed", got, want)

	for _, rev := range [][2]string{{"", tree}, {start, "-x"}, {start, "nonexistent"}} {
		if got, err := r.Changed(rev[0], rev[1]); err == nil {
			t.Errorf("git.Repo.Changed(%q, %q): got %q, want an error", rev[0], rev[1], got)
		}
	}
}

func TestRepoDiff(t *testing.T) {
	repo := newRepo(t, map[string]string{"a.txt": "one\n", "b.txt": "b\n", "star*.txt": "s\n"})
	r := gitpkg.New(repo, nil)
	start := gitOut(t, repo, "rev-parse", "HEAD")
	write(t, repo, "a.txt", "two\n", 0o644)
	write(t, repo, "b.txt", "bb\n", 0o644)
	write(t, repo, "star*.txt", "t\n", 0o644)
	tree, err := r.Tree(start, nil)
	eq(t, "git.Repo.Diff", err, nil)

	got, err := r.Diff(start, tree, []string{"a.txt"})
	eq(t, "git.Repo.Diff", err, nil)
	if !strings.HasPrefix(got, "diff --git a/a.txt b/a.txt\nindex ") || !strings.HasSuffix(got, "\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-one\n+two\n") || strings.Contains(got, "b.txt") {
		t.Errorf("git.Repo.Diff: got %q, want the plain unified diff of a.txt only", got)
	}
	// Both ways round, several paths, and no colour.
	got, err = r.Diff(tree, start, []string{"b.txt", "a.txt"})
	eq(t, "git.Repo.Diff", err, nil)
	if !strings.Contains(got, "-two\n+one\n") || !strings.Contains(got, "-bb\n+b\n") || strings.Contains(got, "\x1b[") {
		t.Errorf("git.Repo.Diff: got %q", got)
	}
	// Paths are taken literally, and no path is an empty diff.
	got, err = r.Diff(start, tree, []string{"star*.txt"})
	eq(t, "git.Repo.Diff", err, nil)
	if !strings.Contains(got, "diff --git a/star*.txt b/star*.txt\n") || !strings.HasSuffix(got, "-s\n+t\n") {
		t.Errorf("git.Repo.Diff: got %q, want the diff of the file named star*.txt", got)
	}
	got, err = r.Diff(start, tree, []string{"*.txt"})
	eq(t, "git.Repo.Diff", err, nil)
	eq(t, "git.Repo.Diff", got, "")
	got, err = r.Diff(start, tree, nil)
	eq(t, "git.Repo.Diff", err, nil)
	eq(t, "git.Repo.Diff", got, "")
	got, err = r.Diff(start, start, []string{"a.txt"})
	eq(t, "git.Repo.Diff", err, nil)
	eq(t, "git.Repo.Diff", got, "")
	if got, err := r.Diff("-x", tree, []string{"a.txt"}); err == nil {
		t.Errorf("git.Repo.Diff: an option as a revision gave %q, want an error", got)
	}
}

func TestRepoOK(t *testing.T) {
	repo := newRepo(t, map[string]string{"a.txt": "one\n\n"})
	r := gitpkg.New(repo, nil)
	tree := gitOut(t, repo, "rev-parse", "HEAD^{tree}")
	// review/material.go reads a file of a tree as `show <tree>:<path>`: its exact bytes.
	got, err := r.OK("show", tree+":a.txt")
	eq(t, "git.Repo.OK", err, nil)
	eq(t, "git.Repo.OK", got, "one\n\n")
	// A command that fails is an error, with no output.
	got, err = r.OK("show", tree+":missing.txt")
	if err == nil || got != "" {
		t.Errorf("git.Repo.OK: a missing path gave %q, %v, want an error", got, err)
	}
}

func TestRepoShow(t *testing.T) {
	repo := newRepo(t, map[string]string{"README.md": "# readme\n\ntext", "dir/f.txt": "f\n"})
	r := gitpkg.New(repo, nil)
	start := gitOut(t, repo, "rev-parse", "HEAD")
	// The file of a revision, exact bytes; the working copy does not matter.
	write(t, repo, "README.md", "changed\n", 0o644)
	got, ok := r.Show(start, "README.md")
	eq(t, "git.Repo.Show", ok, true)
	eq(t, "git.Repo.Show", got, "# readme\n\ntext")
	got, ok = r.Show(start, "dir/f.txt")
	eq(t, "git.Repo.Show", ok, true)
	eq(t, "git.Repo.Show", got, "f\n")
	got, ok = r.Show(gitOut(t, repo, "rev-parse", "HEAD^{tree}"), "dir/f.txt")
	eq(t, "git.Repo.Show", ok, true)
	eq(t, "git.Repo.Show", got, "f\n")
	// What is not there is not found, not an error: a path, a revision, an option.
	for _, c := range [][2]string{{start, "missing.md"}, {"nonexistent", "README.md"}, {"", "README.md"}, {"-x", "README.md"}} {
		if got, ok := r.Show(c[0], c[1]); ok || got != "" {
			t.Errorf("git.Repo.Show(%q, %q): got %q, %v, want not found", c[0], c[1], got, ok)
		}
	}
}

func TestRepoTreeEntries(t *testing.T) {
	repo := newRepo(t, map[string]string{"a.txt": "one\n", "dir/sub/b.txt": "b\n", "with space/ü.txt": "u\n"})
	write(t, repo, "run.sh", "#!/bin/sh\n", 0o755)
	gitOut(t, repo, "add", "run.sh")
	gitOut(t, repo, "commit", "-q", "-m", "script")
	r := gitpkg.New(repo, nil)
	head := gitOut(t, repo, "rev-parse", "HEAD")
	got, err := r.TreeEntries(head)
	eq(t, "git.Repo.TreeEntries", err, nil)
	var paths, modes, objects []string
	for _, e := range got {
		paths = append(paths, e.Path)
		modes = append(modes, e.Mode)
		objects = append(objects, e.Object)
	}
	// Every file of the tree, recursively, with its full path, in Git's order.
	deepEq(t, "git.Repo.TreeEntries", paths, []string{"a.txt", "dir/sub/b.txt", "run.sh", "with space/ü.txt"})
	deepEq(t, "git.Repo.TreeEntries", modes, []string{"100644", "100644", "100755", "100644"})
	for i, p := range paths {
		eq(t, "git.Repo.TreeEntries", objects[i], gitOut(t, repo, "rev-parse", "HEAD:"+p))
	}
	// A tree id lists the same entries as its commit.
	byTree, err := r.TreeEntries(gitOut(t, repo, "rev-parse", "HEAD^{tree}"))
	eq(t, "git.Repo.TreeEntries", err, nil)
	deepEq(t, "git.Repo.TreeEntries", byTree, got)

	// A gitlink is an entry of mode 160000 whose object is the commit it references.
	gitOut(t, repo, "update-index", "--add", "--cacheinfo", "160000,"+head+",sub")
	got, err = r.TreeEntries(gitOut(t, repo, "write-tree"))
	eq(t, "git.Repo.TreeEntries", err, nil)
	var link *gitpkg.TreeEntry
	for i := range got {
		if got[i].Path == "sub" {
			link = &got[i]
		}
	}
	if link == nil {
		t.Fatalf("git.Repo.TreeEntries: no entry for the gitlink in %v", got)
	}
	eq(t, "git.TreeEntry.Mode", link.Mode, "160000")
	eq(t, "git.TreeEntry.Object", link.Object, head)
	eq(t, "git.TreeEntry.Path", link.Path, "sub")

	for _, rev := range []string{"", "-x", "nonexistent"} {
		if got, err := r.TreeEntries(rev); err == nil || got != nil {
			t.Errorf("git.Repo.TreeEntries(%q): got %v, %v, want an error", rev, got, err)
		}
	}
}

func TestTreeEntryFields(t *testing.T) {
	repo := newRepo(t, map[string]string{"a.txt": "one\n"})
	got, err := gitpkg.New(repo, nil).TreeEntries("HEAD")
	eq(t, "git.TreeEntry", err, nil)
	eq(t, "git.TreeEntry", len(got), 1)
	// kogen-review keys the entries by path and reads the mode and the object of each.
	byPath := map[string]gitpkg.TreeEntry{}
	for _, e := range got {
		byPath[e.Path] = e
	}
	e, ok := byPath["a.txt"]
	eq(t, "git.TreeEntry.Path", ok, true)
	eq(t, "git.TreeEntry.Mode", e.Mode, "100644")
	eq(t, "git.TreeEntry.Object", e.Object, gitOut(t, repo, "rev-parse", "HEAD:a.txt"))
}
