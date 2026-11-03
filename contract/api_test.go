package contract

import (
	"context"
	"encoding/json"

	gitpkg "github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
	"kogen-loop/sys"
	"kogen-loop/tools"
)

// The exported API kogen-build calls, pinned at compile time: a change of a signature, a type
// or a field fails to compile here (contract item api-signatures).
var (
	// kogen-build build/host.go: nativeReviewer is delegate{review.Independent{}}.
	_ review.Reviewer = review.Independent{}
	// kogen-build build/executor_external.go: delegate{review.NewExternal(ex, desc, max)}.
	_ review.Reviewer                                                                            = review.External{}
	_ func(executor.Executor, executor.Descriptor, int) review.External                          = review.NewExternal
	_ func(review.Independent, context.Context, review.Input, review.Env) (review.Result, error) = review.Independent.Review
	_ func(review.Independent, context.Context, review.Input, review.Env) (review.Result, error) = review.Independent.Resume
	_ func(review.External, context.Context, review.Input, review.Env) (review.Result, error)    = review.External.Review
	_ func(review.External, context.Context, review.Input, review.Env) (review.Result, error)    = review.External.Resume
	// kogen-build build/hooks.go: b.Run.Write(review.File(record.N), ...).
	_ func(int) string = review.File
	// kogen-build build/review_retry.go and legacy_test.go: review.DecodeSession(c.Review).
	_ func(json.RawMessage) (review.Session, error) = review.DecodeSession
	// kogen-build build/legacy.go and state_golden_test.go: Session.Encode.
	_ func(review.Session) (json.RawMessage, error) = review.Session.Encode
	// kogen-build build/k_reviewretry2_test.go: review.InvalidError(); build/host.go records
	// review.InvalidRecord for a review that ended without a valid verdict.
	_ func() *sys.Error           = review.InvalidError
	_ func(int) core.ReviewRecord = review.InvalidRecord
	// kogen-build build/review_test.go, review_prefill_test.go, k_revod_gate_test.go.
	_ func(review.Input, review.Env, map[string]any, []any) (*review.Verdict, []string, error) = review.Validate
	// kogen-build build/review_delivery_test.go: Enabled: review.ToolNames.
	_ []string = review.ToolNames
	// kogen-build build/material.go and tests: the reviewer's model-facing policy.
	_ func() string                    = review.ReviewerInstructions
	_ func(...string) []map[string]any = review.ReviewerToolDefinitions
	_ string                           = review.SubmitReviewTool
	_ string                           = review.LimitRaises
	// kogen-build build/core_names.go and material.go: the review material, which the review makes
	// from its Input and the Build keeps in its review working window.
	_ func(review.Input) (review.MaterialSet, error) = review.MaterialOf
	_ int                                            = review.MaterialPartBytes
)

// The fields kogen-build sets and reads, with their types (contract item api-fields).
var (
	_ = review.Session{
		Role: project.Role{}, Input: []any{}, Usage: core.Tokens{}, Attempts: []review.Submitted{},
		Verdict: &review.Verdict{}, Tree: "", Tools: []any{},
	}
	_ = review.Submitted{Pass: 0, Tree: "", Verdict: "", Findings: []map[string]any{}}
	_ = review.Verdict{Verdict: "", Findings: []map[string]any{}}
	_ = review.Part{Part: 0, File: "", Bytes: 0, SHA256: "", From: 0, To: 0, PromptBytes: 0, SessionID: "", Delivered: false, DeliveredRound: 0}
	_ = func(m review.Material) (int, string, bool, int, string, []map[string]any, []review.Part, int, string) {
		return m.Authority.Bytes, m.Authority.SHA256, m.Delivered, m.Round, m.Session, m.Parts, m.ReviewParts, m.Source.Bytes, m.Source.SHA256
	}
	// The narrow contract kogen-build adapts its state to (build/host.go).
	_ = review.Input{
		Candidate: review.Candidate{Root: "", Repo: &gitpkg.Repo{}, Start: "", Tree: "", Protected: []string{}, Excluded: []string{}, Builder: ""},
		Intent:    review.Intent{Slug: "", Text: "", Approval: []byte{}, Source: &project.SourceRef{}, Role: project.Role{}, Plan: ""},
		Evidence: review.Evidence{Pass: verify.Pass{},
			Commands: review.Commands{Fix: []string{}, Checks: []project.Check{}, Acceptance: ""}, Diagnostic: []any{}, BaselineFailing: false},
		Tools: review.Tools{
			Native: func([]string) *tools.Tools { return nil },
			Record: func(tools.Call, tools.Output) map[string]any { return nil },
			Round: func(context.Context, executor.Session, executor.Input) (executor.RoundResult, error) {
				return executor.RoundResult{}, nil
			},
			Home: "",
		},
		Checkpoint: &review.Checkpoint{Stage: "", Pass: &verify.Pass{}, Base: &verify.Pass{}, Session: json.RawMessage{}},
		Number:     0, Last: &core.ReviewRecord{}, Executor: &core.ExecutorState{}, Run: review.Run{ID: "", Dir: ""},
	}
	_ = review.Result{Record: core.ReviewRecord{}, Pass: verify.Pass{}, Repairs: 0, Invalid: &review.Invalid{}}
	_ = review.Invalid{Review: 0, ForcedRoute: "", ForcedModel: "", Reason: "", Problems: []string{}, RejectedVerdict: 0,
		NoToolReminder: 0, Pass: verify.Pass{}, Base: &verify.Pass{}, Reopened: false, Repaired: false}
	_ = review.Request{Role: project.Role{}, Instructions: "", Input: []any{}, Tools: []any{},
		Retain:  func([]any) (json.RawMessage, error) { return nil, nil },
		Prefill: func([]any) ([]any, error) { return nil, nil }, ForceTool: ""}
	_ = review.MaterialSet{Authority: "", Source: "", Files: []map[string]any{}, Checks: "", Manifest: []map[string]any{},
		Segments: []review.MaterialSegment{{Path: "", Kind: "", Start: 0, End: 0}}, Hunks: []review.MaterialHunkRange{{Path: "", Kind: "", First: 0, Last: 0}},
		Texts: []review.MaterialFileText{{Path: "", Heading: "", Content: ""}}, PartsSource: "", PartsTexts: []review.MaterialFileText{}}
	_            = review.Done{Call: map[string]any{}, Result: nil}
	_ review.Env = (*fakeEnv)(nil)
)
