package review

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	gitpkg "github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-verification/verify"
)

func deref[T any](p *T) any {
	if p == nil {
		return nil
	}
	return *p
}

// TestAttemptOfSumsAndDividesTheFigures pins the attempt's totals (the caller's figures before the
// review plus the review's) and the review's share of each (item review-account): unknown counts
// stay nil, a zero attempt figure gives a nil share and a zero Input.Attempt leaves the token totals nil.
func TestAttemptOfSumsAndDividesTheFigures(t *testing.T) {
	t.Parallel()
	spent := Spend{Requests: 2, Input: core.Count(3000), Cached: core.Count(1000), Output: core.Count(300), WallMS: 1000}
	cases := []struct {
		name    string
		before  Spend
		spent   Spend
		attempt Spend
		share   [5]any
	}{
		{"builder and review", Spend{Requests: 6, Input: core.Count(9000), Cached: core.Count(3000), Output: core.Count(1700), WallMS: 4000}, spent,
			Spend{Requests: 8, Input: core.Count(12000), Cached: core.Count(4000), Output: core.Count(2000), WallMS: 5000},
			[5]any{0.25, 0.25, 0.25, 0.15, 0.2}},
		{"no attempt before", Spend{}, spent,
			Spend{Requests: 2, WallMS: 1000},
			[5]any{1.0, nil, nil, nil, 1.0}},
		{"unknown review output", Spend{Requests: 1, Input: core.Count(10), Cached: core.Count(0), Output: core.Count(5), WallMS: 1},
			Spend{Requests: 1, Input: core.Count(10), Cached: core.Count(0), WallMS: 3},
			Spend{Requests: 2, Input: core.Count(20), Cached: core.Count(0), WallMS: 4},
			[5]any{0.5, 0.5, nil, nil, 0.75}},
		{"zero attempt figures", Spend{Input: core.Count(0), Cached: core.Count(0), Output: core.Count(0)}, Spend{Input: core.Count(0), Cached: core.Count(0), Output: core.Count(0)},
			Spend{Input: core.Count(0), Cached: core.Count(0), Output: core.Count(0)},
			[5]any{nil, nil, nil, nil, nil}},
	}
	for _, c := range cases {
		got, share := attemptOf(c.before, c.spent)
		if got.Requests != c.attempt.Requests || got.WallMS != c.attempt.WallMS ||
			deref(got.Input) != deref(c.attempt.Input) || deref(got.Cached) != deref(c.attempt.Cached) || deref(got.Output) != deref(c.attempt.Output) {
			t.Errorf("%s: attempt %+v, want %+v", c.name, got, c.attempt)
		}
		have := [5]any{deref(share.Requests), deref(share.Input), deref(share.Cached), deref(share.Output), deref(share.WallMS)}
		if have != c.share {
			t.Errorf("%s: share %v, want %v", c.name, have, c.share)
		}
	}
}

// Binary content and executable-bit repairs change a file without changing line totals.
func TestEffectOfBinaryAndModeOnlyRepairs(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{"binary", "mode-only"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			repo := gitpkg.New(root, nil)
			run := func(args ...string) string {
				t.Helper()
				out, err := repo.OK(args...)
				if err != nil {
					t.Fatal(err)
				}
				return strings.TrimSpace(out)
			}
			run("init", "-q")
			run("config", "core.filemode", "true")
			path := filepath.Join(root, "file")
			content := "unchanged text\n"
			if kind == "binary" {
				content = "before\x00binary\n"
			}
			if err := os.WriteFile(path, []byte(content), 0644); err != nil {
				t.Fatal(err)
			}
			run("add", "file")
			first := run("write-tree")
			if kind == "binary" {
				if err := os.WriteFile(path, []byte("after\x00binary\n"), 0644); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.Chmod(path, 0755); err != nil {
					t.Fatal(err)
				}
			}
			run("add", "file")
			final := run("write-tree")
			if first == final {
				t.Fatal("repair did not change the tree")
			}
			effect := effectOf(Candidate{Root: root, Repo: repo}, first, Result{Pass: verify.Pass{Tree: final}}, nil, nil)
			got := [3]any{deref(effect.FilesChanged), deref(effect.LinesAdded), deref(effect.LinesDeleted)}
			if got != [3]any{1, 0, 0} {
				t.Fatalf("repair totals = %v, want [1 0 0]", got)
			}
		})
	}
}
