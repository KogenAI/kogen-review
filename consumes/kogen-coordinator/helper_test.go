package consumes

import (
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// eq fails the test when got differs from want; item names the inventory item.
func eq[T comparable](t testing.TB, item string, got, want T) {
	t.Helper()
	if got != want {
		t.Errorf("%s: got %#v, want %#v", item, got, want)
	}
}

// deepEq is eq for values that are not comparable.
func deepEq(t testing.TB, item string, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s: got %#v, want %#v", item, got, want)
	}
}

// gitOut runs Git in dir with the isolated process environment and returns its trimmed output.
func gitOut(t testing.TB, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{
		"-c", "user.name=Consumer", "-c", "user.email=consumer@example.invalid",
		"-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false",
	}, args...)...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

// write makes a file of the checkout dir, with its folders.
func write(t testing.TB, dir, rel, content string, mode os.FileMode) {
	t.Helper()
	path := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), mode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, mode); err != nil {
		t.Fatal(err)
	}
}

// newRepo is a Git checkout in t.TempDir() with one commit holding the files.
func newRepo(t testing.TB, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	gitOut(t, dir, "init", "-q")
	for rel, content := range files {
		write(t, dir, rel, content, 0o644)
	}
	gitOut(t, dir, "add", "-A")
	gitOut(t, dir, "commit", "-q", "-m", "start")
	return dir
}
