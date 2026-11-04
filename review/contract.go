package review

import (
	"context"
	"encoding/json"

	"github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-loop/tools"
	"github.com/KogenAI/kogen-verification/verify"
)

// Review's contract. A review is given a saved candidate, the exact approved Intent, the
// verification evidence of that candidate, the tools it is permitted and, to resume, its own
// checkpoint (Input). It returns its verdict, its findings and its repairs (Result). Nothing of
// its caller's state is handed to it. A review makes its own material from its Input
// (MaterialOf) and reads the candidate's trees, diffs and start files from the candidate's
// checkout. What else it needs while it runs — the model conversation with its caller's
// bookkeeping and working window, the verification of its own repairs and the record of its
// progress — it asks of Env, which a Build provides over its own state and a saved-candidate
// harness provides without any Build.

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

// Candidate is the saved candidate a review judges: the checkout holding it and that checkout's
// Git repository, the commit it was built on and its tree (the tree of Evidence.Pass for a fresh
// review). The review reads the candidate's trees, diffs and start files through Repo.
type Candidate struct {
	Root  string
	Repo  *git.Repo
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

// Intent is the exact approved Intent the candidate is judged against: its slug (its
// acceptance feature and model are the approved files of the checkout) and text, the approval's
// bytes (nil when they cannot be read), the source provenance it rests on, the review role, and
// the staged plan's position for the review ("" without a plan). The Intent reaches the reviewer
// as the authority of its material (MaterialOf).
type Intent struct {
	Slug     string
	Text     string
	Approval []byte
	Source   *project.SourceRef
	Role     project.Role
	Plan     string
}

// Evidence is the verification evidence of the candidate: its green pass, the configured
// commands that verify it, the caller's frozen diagnostic messages followed by the check
// baseline of that pass, and whether a check failed before the Build (Env.Comparison accounts
// for it).
type Evidence struct {
	Pass            verify.Pass
	Commands        Commands
	Diagnostic      []any
	BaselineFailing bool
}

// Commands are the project's configured commands, as the review material states them: the
// fixers, the checks and the acceptance command ("" when none is configured).
type Commands struct {
	Fix        []string
	Checks     []project.Check
	Acceptance string
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
// (candidate/review_invalid) with Invalid. A verification error after submission retains the
// latest submitted Record and completed repair count; that Record is not an approval of an
// unverified tree. The error remains authoritative.
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
	// (working context, checkpoint, usage, provider attempts, image delivery). The reviewer
	// hands it its whole conversation; the caller's working window stays the caller's. When it
	// refuses the request over the request ceiling, before sending, with a *sys.Error
	// candidate/context_budget_exceeded, the native reviewer resets its own conversation (the
	// unchanged opening, one handoff and Kogen's newest undelivered messages) and calls
	// Request once more; any other error, or a second refusal, ends the review.
	Request(ctx context.Context, r Request) (*provider.Response, []any, error)
	// Prepare makes the opening conversation of a fresh review of m, the material the review made,
	// in the working window: the observations of an earlier review are not carried into it.
	Prepare(tree string, m MaterialSet, role project.Role, instructions string, defs, diagnostic []any) ([]any, error)
	// Unread are the pinned parts a conversation has not read; Delivered records the delivery;
	// Prefill appends the pinned source to a reopened conversation; Custody checks every archived
	// working-context window.
	Unread(input []any) ([]string, error)
	Delivered(input []any) error
	Prefill(role project.Role, instructions string, defs, input []any) ([]any, error)
	Custody() error

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
