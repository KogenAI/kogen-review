// The acceptance driver reads one fixture from stdin and prints MaterialSet.Source.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
)

type edit struct {
	Manifest string `json:"manifest"`
	Before   string `json:"before"`
	After    string `json:"after"`
}

func write(root, path, text string) {
	name := filepath.Join(root, path)
	if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
		panic(err)
	}
	if err := os.WriteFile(name, []byte(text), 0644); err != nil {
		panic(err)
	}
}

func material(edits []edit) (review.MaterialSet, error) {
	root, err := os.MkdirTemp("", "manifest-normalization-")
	if err != nil {
		return review.MaterialSet{}, err
	}
	defer os.RemoveAll(root)
	gitRun := func(args ...string) string {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.test",
			"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.test")
		out, err := cmd.CombinedOutput()
		if err != nil {
			panic(fmt.Errorf("git %v: %w: %s", args, err, out))
		}
		return strings.TrimSpace(string(out))
	}
	gitRun("init", "-q")
	write(root, ".kogen/intents/test/acceptance.feature", "Feature: test\n")
	for _, e := range edits {
		write(root, e.Manifest, e.Before)
	}
	gitRun("add", "-A")
	gitRun("-c", "commit.gpgsign=false", "commit", "-qm", "start")
	start := gitRun("rev-parse", "HEAD")
	for _, e := range edits {
		write(root, e.Manifest, e.After)
	}
	gitRun("add", "-A")
	tree := gitRun("write-tree")
	return review.MaterialOf(review.Input{
		Candidate: review.Candidate{Root: root, Repo: git.New(root, nil), Start: start, Tree: tree},
		Intent:    review.Intent{Slug: "test", Text: "# Intent\n"},
		Evidence:  review.Evidence{Pass: verify.Pass{Tree: tree, Green: true, Clean: true}},
	})
}

func main() {
	log.SetFlags(0)
	var edits []edit
	if err := json.NewDecoder(os.Stdin).Decode(&edits); err != nil {
		log.Fatal(err)
	}
	m, err := material(edits)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Print(m.Source)
}
