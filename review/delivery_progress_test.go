package review

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	gitpkg "github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-loop/tools"
	"github.com/KogenAI/kogen-verification/verify"
)

// deliveryEnv is a scripted Env: the reviewer approves twice and the one verification pass is
// green on the changed tree.
type deliveryEnv struct {
	Env
	dir      string
	answers  []*provider.Response
	requests []Request
	verifies []verify.Pass
	progress []string
}

func (h *deliveryEnv) Request(_ context.Context, r Request) (*provider.Response, []any, error) {
	h.requests = append(h.requests, r)
	a := h.answers[0]
	h.answers = h.answers[1:]
	return a, r.Input, nil
}
func (h *deliveryEnv) Prepare(_ string, m MaterialSet, _ project.Role, _ string, _, _ []any) ([]any, error) {
	return []any{map[string]any{"role": "user", "content": m.Authority + "\n" + m.Source}}, nil
}
func (h *deliveryEnv) Unread([]any) ([]string, error) { return nil, nil }
func (h *deliveryEnv) Delivered([]any) error          { return nil }
func (h *deliveryEnv) Custody() error                 { return nil }
func (h *deliveryEnv) Verify(context.Context) (verify.Pass, error) {
	p := h.verifies[0]
	h.verifies = h.verifies[1:]
	return p, nil
}
func (h *deliveryEnv) BaselineIntact() error            { return nil }
func (h *deliveryEnv) Comparison() []string             { return nil }
func (h *deliveryEnv) Save(Checkpoint) error            { return nil }
func (h *deliveryEnv) Boundary([]any, *Done) error      { return nil }
func (h *deliveryEnv) Reviewed(core.ReviewRecord) error { return nil }
func (h *deliveryEnv) Repaired() error                  { return nil }
func (h *deliveryEnv) Track() error                     { return nil }
func (h *deliveryEnv) Facts(string) error               { return nil }
func (h *deliveryEnv) Progress(line string)             { h.progress = append(h.progress, line) }
func (h *deliveryEnv) Event(map[string]any)             {}
func (h *deliveryEnv) Err() error                       { return nil }
func (h *deliveryEnv) Write(string, any) error          { return nil }

func deliveryGit(t *testing.T, root string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = root
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func deliveryWrite(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func approval() *provider.Response {
	return &provider.Response{Items: []map[string]any{{
		"type": "function_call", "call_id": "call-submit", "name": "submit_review", "arguments": `{"verdict":"approve","findings":[]}`,
	}}, Usage: provider.Usage{Input: 10, Output: 2}}
}

// TestTheChangedAfterDeliveryLineNamesTheChangedPaths pins the progress line of a candidate that
// changed after its contents were delivered: it names at most five changed paths in the order
// git returns them, then how many more, and the reviewer feedback still lists every path.
func TestTheChangedAfterDeliveryLineNamesTheChangedPaths(t *testing.T) {
	for _, tc := range []struct {
		name  string
		paths []string
		line  string
	}{
		{"three", []string{"zeta.txt", "app.txt", "alpha/one.txt"},
			"kogen: review 1: the candidate changed after its contents were delivered (alpha/one.txt, app.txt, zeta.txt); returning the changes to the reviewer"},
		{"seven", []string{"app.txt", "g1.txt", "g2.txt", "g3.txt", "g4.txt", "g5.txt", "g6.txt"},
			"kogen: review 1: the candidate changed after its contents were delivered (app.txt, g1.txt, g2.txt, g3.txt, g4.txt, and 2 more); returning the changes to the reviewer"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			deliveryGit(t, root, "init", "-q", "-b", "main")
			deliveryWrite(t, filepath.Join(root, ".gitignore"), ".kogen/local/\n")
			deliveryWrite(t, filepath.Join(root, "app.txt"), "start\n")
			deliveryWrite(t, filepath.Join(root, project.FeaturePath("fixture")), "Feature: Fixture\n")
			deliveryGit(t, root, "add", "-A")
			deliveryGit(t, root, "commit", "-q", "-m", "start")
			start := deliveryGit(t, root, "rev-parse", "HEAD")
			repo := gitpkg.New(root, nil)
			deliveryWrite(t, filepath.Join(root, "app.txt"), "candidate\n")
			seen, err := repo.Tree(start, nil)
			if err != nil {
				t.Fatal(err)
			}
			for _, p := range tc.paths {
				deliveryWrite(t, filepath.Join(root, p), "edited after delivery\n")
			}
			now, err := repo.Tree(start, nil)
			if err != nil {
				t.Fatal(err)
			}
			dir := filepath.Join(root, ".kogen/local/runs/fixture-run")
			if err := os.MkdirAll(dir, 0o700); err != nil {
				t.Fatal(err)
			}
			pass := verify.Pass{N: 1, Clean: true, Green: true, Tree: seen}
			env := &deliveryEnv{dir: dir, answers: []*provider.Response{approval(), approval()},
				verifies: []verify.Pass{{N: 2, Clean: true, Green: true, Tree: now}}}
			in := Input{
				Candidate: Candidate{Root: root, Repo: repo, Start: start, Tree: seen},
				Intent:    Intent{Slug: "fixture", Text: "# Fixture intent\n", Role: project.Role{Provider: "chatgpt", Model: "fixture-review-model", Effort: "medium"}},
				Evidence:  Evidence{Pass: pass},
				Tools: Tools{
					Native: func(enabled []string) *tools.Tools { return &tools.Tools{Root: root, Enabled: enabled} },
					Record: func(tools.Call, tools.Output) map[string]any { return nil },
					Round: func(ctx context.Context, sess executor.Session, in executor.Input) (executor.RoundResult, error) {
						return sess.Round(ctx, in)
					},
					Home: os.Getenv("HOME"),
				},
				Number: 1,
				Run:    Run{ID: "fixture-run", Dir: dir},
			}
			if _, err := (Independent{}).Review(context.Background(), in, env); err != nil {
				t.Fatal(err)
			}
			if got := slices.DeleteFunc(slices.Clone(env.progress), func(l string) bool {
				return !strings.Contains(l, "changed after its contents were delivered")
			}); !slices.Equal(got, []string{tc.line}) {
				t.Errorf("progress: %q, want %q", got, tc.line)
			}
			sent := env.requests[1].Input
			last, _ := sent[len(sent)-1].(map[string]any)
			content, _ := last["content"].(string)
			all := slices.Clone(tc.paths)
			if !slices.Contains(all, "app.txt") {
				all = append(all, "app.txt")
			}
			slices.Sort(all)
			want := fmt.Sprintf("Your verdict was not applied: the candidate changed after its contents were delivered to you, other than through your own Kogen tool calls: %s.\n", strings.Join(all, ", "))
			if !strings.HasPrefix(content, want) {
				t.Errorf("feedback: %q, want prefix %q", content, want)
			}
		})
	}
}
