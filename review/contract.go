package review

import (
	"context"
	"encoding/json"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-verification/verify"
	"kogen-loop/provider"
	"kogen-loop/tools"
)

// Review's contract. A review is given a saved candidate, the exact approved Intent, the
// verification evidence of that candidate, the tools it is permitted and, to resume, its own
// checkpoint (Input). It returns its verdict, its findings and its repairs (Result). Nothing of
// its caller's state is handed to it: what a review needs while it runs — the model conversation
// with its caller's bookkeeping, the verification of its own repairs, the candidate's trees and
// the record of its progress — it asks of Env, which a Build provides over its own state and a
// saved-candidate harness provides without any Build.

// Reviewer is an independent review and repair of a green candidate (chapter 06): the native
// reviewer (Independent) or one served by an external executor (External).
type Reviewer interface {
	// Review reviews in.Evidence.Pass, a green pass of the candidate.
	Review(ctx context.Context, in Input, env Env) (Result, error)
	// Resume continues the review in.Checkpoint saved (stage review, review_verify or
	// review_retry_verify).
	Resume(ctx context.Context, in Input, env Env) (Result, error)
}

// Input is everything one review is given.
type Input struct {
	Candidate Candidate
	Intent    Intent
	Evidence  Evidence
	Tools     Tools
	// Checkpoint is the Review checkpoint a resume continues (nil for a fresh review).
	Checkpoint *Checkpoint
	// Number is the review's number; Last the latest review record of the candidate's Build
	// before it (nil: none), which a reopened blocked review keeps.
	Number int
	Last   *core.ReviewRecord
	// Executor is the external reviewer's session state so far in the Build (nil: none).
	Executor *core.ExecutorState
	// Run is where the review's private evidence goes: the run folder and its id.
	Run Run
}

// Candidate is the saved candidate a review judges: the checkout holding it, the commit it was
// built on and its tree (the tree of Evidence.Pass for a fresh review).
type Candidate struct {
	Root  string
	Start string
	Tree  string
	// Protected are the approved files the candidate may not change and Excluded the paths
	// outside it, as an external reviewer's task carries them.
	Protected []string
	Excluded  []string
	// Builder is the implementer's executor session ("" for the native builder): a reviewer
	// session is never it.
	Builder string
}

// Intent is the exact approved Intent the candidate is judged against: the approval's bytes
// (nil when they cannot be read), the source provenance it rests on, the review role, and the
// staged plan's position for the review ("" without a plan). The Intent's text reaches the
// reviewer as the authority of its material (Env.Material).
type Intent struct {
	Approval []byte
	Source   *project.SourceRef
	Role     project.Role
	Plan     string
}

// Evidence is the verification evidence of the candidate: its green pass, the caller's frozen
// diagnostic messages followed by the check baseline of that pass, and whether a check failed
// before the Build (Env.Comparison accounts for it).
type Evidence struct {
	Pass            verify.Pass
	Diagnostic      []any
	BaselineFailing bool
}

// Tools are the tools a review is permitted.
type Tools struct {
	// Native are the native file and command tools of the checkout, limited to enabled.
	Native func(enabled []string) *tools.Tools
	// Record are the extra fields of a review_tool_call event of a native tool call.
	Record func(call tools.Call, result tools.Output) map[string]any
	// Round runs one round of an external reviewer's executor session under the caller's guards.
	Round func(ctx context.Context, sess executor.Session, in executor.Input) (executor.RoundResult, error)
	// Home is the home folder an external reviewer's session runs with.
	Home string
}

// Checkpoint is a Review checkpoint: the stage (route.StageReview, StageReviewVerify or
// StageReviewRetry), the pass under review, the green pass the session started from (nil: none
// recorded) and the reviewer's saved Session.
type Checkpoint struct {
	Stage   string
	Pass    *verify.Pass
	Base    *verify.Pass
	Session json.RawMessage
}

// Run is the run a review records into.
type Run struct {
	ID  string
	Dir string
}

// Result is what a review returns: the record of its verdict and findings, the evidence the
// verdict rests on (for an approval, the verified green pass of the exact approved tree, which
// holds the reviewer's repairs: Pass.Tree differs from the candidate's tree when it repaired), and
// the number of repair rounds it took. A review that stops returns an error: a valid blocking
// verdict (candidate/review_blocked) with its Record; one without a valid verdict
// (candidate/review_invalid) with Invalid.
type Result struct {
	Record  core.ReviewRecord
	Pass    verify.Pass
	Repairs int
	Invalid *Invalid
}

// Invalid is what a review that ended without a valid verdict leaves for its caller: the
// reason, the consumed allowances and what the review did to the checkout.
type Invalid struct {
	Review          int
	ForcedRoute     string
	ForcedModel     string
	Reason          string
	Problems        []string
	RejectedVerdict int
	NoToolReminder  int
	Pass            verify.Pass
	// Base is the green pass the review session was started from (nil: the caller decides from
	// Repaired whether the pass under review is it).
	Base *verify.Pass
	// Reopened: it was the reopened conversation of a blocked review, whose blocker only a new
	// explicit decision of that reviewer can clear. Repaired: it had already judged and sent back
	// a verdict, so its pass may hold its own verified edits.
	Reopened, Repaired bool
}

// Request is one model request of the reviewer's conversation.
type Request struct {
	Role         project.Role
	Instructions string
	Input        []any
	Tools        []any
	// Retain is the session to checkpoint with the input actually sent (after working-context
	// resets).
	Retain func(input []any) (json.RawMessage, error)
	// Prefill may append native data to the input after the working window is prepared and
	// before the request is checkpointed.
	Prefill func(input []any) ([]any, error)
	// ForceTool names a tool this request alone must call, where the route supports it.
	ForceTool string
}

// Env is what a review asks of whoever runs it while it runs.
type Env interface {
	// Request sends one request of the reviewer's conversation with the caller's bookkeeping
	// (working context, checkpoint, usage, provider attempts, image delivery).
	Request(ctx context.Context, r Request) (*provider.Response, []any, error)
	// Material gathers the review material of a green pass; Blocks locates each changed path's
	// material in the source of the parts route.
	Material(pass verify.Pass) (core.MaterialSet, error)
	Blocks(tree string, m core.MaterialSet) ([]core.MaterialSegment, error)
	// Prepare makes the opening conversation of a fresh review of m in the working window: the
	// observations of an earlier review are not carried into it.
	Prepare(tree string, m core.MaterialSet, role project.Role, instructions string, defs, diagnostic []any) ([]any, error)
	// Unread are the pinned parts a conversation has not read; Delivered records the delivery;
	// Prefill appends the pinned source to a reopened conversation; Custody checks every archived
	// working-context window.
	Unread(input []any) ([]string, error)
	Delivered(input []any) error
	Prefill(role project.Role, instructions string, defs, input []any) ([]any, error)
	Custody() error

	// Tree is the candidate tree of the checkout now; Changed and Diff compare two trees; InStart
	// reports whether path is a file of the candidate's start commit; Drift states how a tree
	// differs from the green tree of its pass.
	Tree() (string, error)
	Changed(from, to string) ([]string, error)
	Diff(from, to string, paths []string) (string, error)
	InStart(path string) bool
	Drift(observed, green string) string
	// Verify runs one verification pass over the checkout's candidate (the reviewer's repairs);
	// Feedback is what goes back after a red pass (completion names the tool to call when
	// done); BaselineIntact guards the approved baseline.
	Verify(ctx context.Context) (verify.Pass, error)
	Feedback(pass verify.Pass, completion string) string
	BaselineIntact() error
	// Comparison is the account of every check before the Build and in the last pass.
	Comparison() []string

	// Save records a Review checkpoint; Boundary the tool boundary of a native reviewer's tool
	// call (done: the call that ran and its result).
	Save(c Checkpoint) error
	Boundary(input []any, done *Done) error
	// Reviewed records the latest review record, Repaired one more repair round and Executor
	// the external reviewer's session state; each publishes the caller's facts, as Track does
	// alone and Facts with the phase the review is in (Executor publishes nothing).
	Reviewed(record core.ReviewRecord) error
	Repaired() error
	Executor(x *core.ExecutorState)
	Track() error
	Facts(phase string) error
	// Progress writes a progress line; Event appends to the run log; Write writes a file of the
	// run folder; Err is the caller's interrupt, if any.
	Progress(line string)
	Event(event map[string]any)
	Write(name string, data any) error
	Err() error
}

// Done is a tool call that ran and the result it gave.
type Done struct {
	Call   map[string]any
	Result any
}
