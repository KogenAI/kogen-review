package consumes

import (
	"context"
	"encoding/json"

	"github.com/KogenAI/kogen-executor/agent"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-loop/sys"
	"github.com/KogenAI/kogen-loop/tools"
)

// The exported API kogen-review calls, pinned at compile time: a change of a signature, a type
// or a field fails to compile here (item api-signatures). kogen-review's call sites are
// review/external.go, review/independent.go, review/invalid.go, review/material.go,
// review/parts.go and cmd/kogen-review/main.go.
var (
	// agent: review/independent.go (AsAny), review/material.go (Prompt, TestingRules).
	_ func(...[]map[string]any) []any = agent.AsAny
	_ func(string) string             = agent.Prompt
	_ string                          = agent.TestingRules

	// core: values and helpers.
	_ func(int) *int                             = core.Count
	_ func(any) string                           = core.DiagnosticText
	_ func(any) string                           = core.Display
	_ func(any) ([]byte, error)                  = core.EncodeJSON
	_ func([]byte) string                        = core.HashHex
	_ func(string) string                        = core.InspectString
	_ func([]int) []int                          = core.NonNil[int]
	_ func([]string) []string                    = core.NonNil[string]
	_ func([]map[string]any) []map[string]any    = core.NonNil[map[string]any]
	_ func([]any) []any                          = core.NonNil[any]
	_ func() core.Tokens                         = core.ZeroTokens
	_ func(core.Tokens, core.Tokens) core.Tokens = core.Tokens.Plus

	// core: roles, responses and tools, whose signatures carry values of the other dependencies.
	_ func(*tools.Tools, []string) []any                                = core.ShellDefinitions
	_ func(string) *sys.Error                                           = core.ResumeRefused
	_ func(core.ExecutorUsage, executor.Usage, bool) core.ExecutorUsage = core.ExecutorUsage.Plus

	// executor.
	_ func(string, string) *sys.Error                                     = executor.Fail
	_ func(int) *sys.Error                                                = executor.RoundLimit
	_ func(executor.Descriptor, string) (executor.RoleCapabilities, bool) = executor.Descriptor.For
	_ string                                                              = executor.RoleReview
	_ string                                                              = executor.ReasonProtocol
	_ string                                                              = executor.UsageComplete
	_ executor.Ending                                                     = executor.EndFinish
	_ executor.Ending                                                     = executor.EndNoCall

	// The interfaces: each method is named through its interface (method expressions).
	_ func(executor.Executor, context.Context, executor.Task, executor.Sink) (executor.Session, error) = executor.Executor.Start
	_ func(executor.PromptSizer, string, executor.Brief) int                                           = executor.PromptSizer.FirstPromptBytes
	_ func(executor.Session, context.Context, executor.Input) (executor.RoundResult, error)            = executor.Session.Round
	_ func(executor.Session) executor.Handle                                                           = executor.Session.Handle
	_ func(executor.Session) error                                                                     = executor.Session.Close
	_ func(executor.Sink, map[string]any)                                                              = func(s executor.Sink, e map[string]any) { s(e) }
)

// The fields kogen-review sets and reads, with their types (item api-fields).
var _ = func(
	b executor.Brief, d executor.Descriptor, h executor.Handle, in executor.Input,
	rc executor.RoleCapabilities, rr executor.RoundResult, t executor.Task,
	st core.ExecutorState, u core.ExecutorUsage, rec core.ReviewRecord,
) {
	var (
		_ string = b.Stable
		_ string = b.Dynamic

		_ string = d.Name

		_ string = h.SessionID
		_ string = h.Version

		_ string = in.Feedback

		_ string = rc.Usage

		_ executor.Ending = rr.Ending
		_ json.RawMessage = rr.Structured
		_ executor.Usage  = rr.Usage
		_ executor.Handle = rr.Handle

		_ string          = t.Role
		_ string          = t.Root
		_ executor.Brief  = t.Brief
		_ []string        = t.Protected
		_ []string        = t.Excluded
		_ string          = t.Model
		_ string          = t.Effort
		_ string          = t.Approval
		_ string          = t.StartTree
		_ string          = t.RunID
		_ int             = t.MaxRounds
		_ json.RawMessage = t.Schema
		_ string          = t.Home
		_ string          = t.Dir

		_ string             = st.Name
		_ string             = st.Version
		_ string             = st.SessionID
		_ int                = st.Rounds
		_ core.ExecutorUsage = st.Usage

		_ *int     = u.Input
		_ *int     = u.Cached
		_ *int     = u.Output
		_ *int     = u.Reasoning
		_ string   = u.State
		_ string   = u.Source
		_ *float64 = u.CostUSD

		_ int              = rec.N
		_ string           = rec.Verdict
		_ []map[string]any = rec.Findings
		_ string           = rec.Tree
	)
}
