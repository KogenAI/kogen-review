package contract

import (
	"context"
	"encoding/json"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
	"kogen-loop/sys"
)

// The exported API kogen-build calls, pinned at compile time: a change of a signature, a type
// or a field fails to compile here (contract item api-signatures).
var (
	// kogen-build build/host.go: nativeReviewer is delegate{review.Independent{}}.
	_ core.Reviewer = review.Independent{}
	// kogen-build build/executor_external.go: delegate{review.NewExternal(ex, desc, max)}.
	_ core.Reviewer                                                                                = review.External{}
	_ func(executor.Executor, executor.Descriptor, int) review.External                            = review.NewExternal
	_ func(review.Independent, context.Context, *core.Attempt, verify.Pass) (core.Approved, error) = review.Independent.Review
	_ func(review.Independent, context.Context, *core.Attempt) (core.Approved, error)              = review.Independent.Resume
	_ func(review.External, context.Context, *core.Attempt, verify.Pass) (core.Approved, error)    = review.External.Review
	_ func(review.External, context.Context, *core.Attempt) (core.Approved, error)                 = review.External.Resume
	// kogen-build build/hooks.go: b.Run.Write(review.File(record.N), ...).
	_ func(int) string = review.File
	// kogen-build build/review_retry.go and legacy_test.go: review.DecodeSession(c.Review).
	_ func(json.RawMessage) (review.Session, error) = review.DecodeSession
	// kogen-build build/legacy.go and state_golden_test.go: Session.Encode.
	_ func(review.Session) (json.RawMessage, error) = review.Session.Encode
	// kogen-build build/k_reviewretry2_test.go: review.InvalidError().
	_ func() *sys.Error = review.InvalidError
	// kogen-build build/review_test.go, review_prefill_test.go, k_revod_gate_test.go.
	_ func(*core.Attempt, map[string]any, []any) (*review.Verdict, []string, error) = review.Validate
	// kogen-build build/review_delivery_test.go: Enabled: review.ToolNames.
	_ []string = review.ToolNames
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
)
