package consumes

import (
	"github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-coordinator/route"
)

// What kogen-review calls of kogen-coordinator, pinned at compile time: a change of a
// signature, a type, a field or a constant fails to compile here.
var (
	// review/contract.go: Candidate.Repo; cmd/kogen-review/main.go: git.New(abs, nil).
	_ func(string, []string) *git.Repo = git.New
	_ *git.Repo
	// review/material.go, review/independent.go, cmd/kogen-review/main.go.
	_ func(*git.Repo, string) (string, error)                   = (*git.Repo).Resolve
	_ func(*git.Repo, string, []string) (string, error)         = (*git.Repo).Tree
	_ func(*git.Repo, string, string) ([]string, error)         = (*git.Repo).Changed
	_ func(*git.Repo, string, string, []string) (string, error) = (*git.Repo).Diff
	_ func(*git.Repo, ...string) (string, error)                = (*git.Repo).OK
	_ func(*git.Repo, string, string) (string, bool)            = (*git.Repo).Show
	_ func(*git.Repo, string) ([]git.TreeEntry, error)          = (*git.Repo).TreeEntries
	// review/material.go: the tree entries it maps by path and reads the mode and object of.
	_ git.TreeEntry
	_ string = git.TreeEntry{}.Mode
	_ string = git.TreeEntry{}.Object
	_ string = git.TreeEntry{}.Path

	// cmd/kogen-review/main.go and review/material.go.
	_ func(string) string                   = project.IntentDir
	_ func(string) string                   = project.FeaturePath
	_ func(string) string                   = project.ModelPath
	_ string                                = project.ConfigPath
	_ func(string) (*project.Config, error) = project.LoadConfig
	// review/material.go, review/independent.go.
	_ func(*project.SourceRef) string = project.SourceMessage
	_ func(*project.SourceRef) error  = project.ValidateSource
	_ *project.SourceRef

	// The configuration fields cmd/kogen-review/main.go reads.
	_ = project.Config{Fix: []string{}, Checks: []project.Check{}, Acceptance: &project.Acceptance{Run: ""}}
	_ = project.Check{Name: "", Run: ""}
	_ = project.Role{Provider: "", Model: "", Effort: "", BaseURL: ""}

	// review/external.go, review/independent.go: the checkpoint stages.
	_ string = route.StageReview
	_ string = route.StageReviewVerify
	_ string = route.StageReviewRetry
)
