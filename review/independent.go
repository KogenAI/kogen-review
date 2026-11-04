// Package review is the independent review and repair of a green candidate (chapter 06): the
// native reviewer (Independent) and the reviewer served by an external executor (External), each
// a Reviewer of a saved candidate (contract.go), with the reviewer's own saved session and
// model-facing policy (policy.go). It imports no other package of this module.
package review

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"unicode"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-coordinator/route"
	"github.com/KogenAI/kogen-executor/agent"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-loop/sys"
	"github.com/KogenAI/kogen-loop/tools"
	"github.com/KogenAI/kogen-verification/verify"
)

// The independent review and repair (chapter 06). After a green pass one reviewer, in a
// fresh conversation that never sees the builder's, reads the approved Intent and the
// candidate's source (the Build's review material), repairs supported defects with the file
// and command tools and submits a verdict. Changed contents are verified externally; failures
// return to this same reviewer conversation. An unresolved blocker ends the Build instead of
// restarting the builder, and an explicit resume reopens it under the same reviewer.
//
// The reviewer's own state is kept in the Continuation (`Pass` is the pass under review and
// `Review` the session below), so a resume continues the very same conversation:
//
//	{"role":     {provider, model, effort},
//	 "input":    the reviewer's conversation (replay items, tool outputs, user messages),
//	 "usage":    {input, cached, output, reasoning} of this review so far,
//	 "attempts": [{pass, tree, verdict, findings}] earlier submitted verdicts of this review,
//	 "verdict":  {verdict, findings} the submitted verdict (stages review_verify and
//	              review_retry_verify only),
//	 "tree":     the candidate tree the verdict judged (same stages)}
//
// In the stage `review` the input is the conversation to send next; in `review_verify` the
// conversation after the verdict; in `review_retry_verify` the conversation the explicit
// resume continues after fresh verification.

// ToolNames are the native tools the reviewer is given (besides submit_review).
var ToolNames = []string{"read_file", "view_image", "list_files", "search_text", "write_file", "shell"}

// Verdict is a valid submission of submit_review.
type Verdict struct {
	Verdict  string           `json:"verdict"`
	Findings []map[string]any `json:"findings"`
	// Requirements is the reviewer's evidence for each requirement of the approved Intent (none
	// when the submission had no requirements).
	Requirements []Requirement `json:"requirements,omitempty"`
}

// Requirement is one entry of a verdict's requirements: a requirement of the approved Intent,
// the kind of evidence for it (test, acceptance, probe or none), its reference (the test or
// acceptance step, or the exact shell command of the probe) and whether the evidence shows the
// candidate meets it.
type Requirement struct {
	Requirement string `json:"requirement"`
	Evidence    string `json:"evidence"`
	Ref         string `json:"ref"`
	Met         bool   `json:"met"`
}

// ProbeRun is one shell call of a review: its command, the exit status the shell tool reported
// (nil when its result has none, as a refused call's) and the candidate's tree right after it.
type ProbeRun struct {
	Command string `json:"command"`
	Status  *int   `json:"status"`
	Tree    string `json:"tree"`
}

// Submitted is one submitted verdict of a review: the pass it followed and the tree it
// judged.
type Submitted struct {
	Pass     int              `json:"pass"`
	Tree     string           `json:"tree"`
	Verdict  string           `json:"verdict"`
	Findings []map[string]any `json:"findings"`
}

// Session is the reviewer's saved state (see above): what Continuation.Review holds.
type Session struct {
	Role     project.Role `json:"role"`
	Input    []any        `json:"input"`
	Usage    core.Tokens  `json:"usage"`
	Attempts []Submitted  `json:"attempts"`
	Verdict  *Verdict     `json:"verdict,omitempty"`
	Tree     string       `json:"tree,omitempty"`
	// Seen is the seen tree: the tree whose bytes the reviewer holds. An approval binds only
	// it. Empty (a session saved without one): the tree of the checkpoint's pass.
	Seen string `json:"seen_tree,omitempty"`
	// Tools are the tool definitions the reviewer conversation was given; a continued
	// conversation keeps them (empty: the current reviewer tools).
	Tools    []any `json:"tools,omitempty"`
	Requests int   `json:"requests,omitempty"`
	// Rejected and NoTool are the allowances this conversation has consumed: one rejected
	// submit_review (after the unread-progress exemption) and one prose-only turn (the
	// reminder) are each sent back once, independently of each other. Remind marks the
	// pending reminder: the next request requires submit_review where the route supports it.
	// PrevUnread is the unread-part count of the last unread rejection (the progress
	// exemption). Reopened marks the reopened conversation of a blocked review. All of them
	// travel with the checkpoint, so an interruption or a working-window reset keeps them.
	Rejected   int  `json:"rejected_verdicts,omitempty"`
	NoTool     int  `json:"no_tool_reminders,omitempty"`
	Remind     bool `json:"remind,omitempty"`
	PrevUnread int  `json:"prev_unread,omitempty"`
	Reopened   bool `json:"reopened,omitempty"`
	// Repaired: a verdict of this review was already judged and sent back, so the pass it now
	// works from may hold the reviewer's own verified edits rather than the builder's tree.
	Repaired bool `json:"repaired,omitempty"`
	// Probes are the commands of the shell calls this review ran, in order: the probes its
	// verdict's requirements may cite.
	Probes []string `json:"probes,omitempty"`
	// ProbeRuns are those shell calls with the exit status the tool reported and the candidate's
	// tree right after the call: what a probe a requirement cites is judged by.
	ProbeRuns []ProbeRun `json:"probe_runs,omitempty"`
	// Listed are the requirement texts of every well-formed requirements array a submission of
	// this review gave, accepted or refused, each once in the order first listed: a later
	// approval cannot drop one.
	Listed            []string `json:"listed_requirements,omitempty"`
	RepairRounds      int      `json:"repair_rounds,omitempty"`
	FailureIdentities []string `json:"failure_identities,omitempty"`
	FailureStreak     int      `json:"failure_streak,omitempty"`
	// SyntheticBlock marks a repair-limit stop, which is not a submitted verdict.
	SyntheticBlock bool `json:"synthetic_block,omitempty"`
	// Windows are the working-context windows this review archived when its Env refused a
	// request over the request ceiling, and ResetUnread the pinned parts still unread at the
	// latest of those resets (reset.go). Once the review reset, only parts also in ResetUnread
	// count as unread.
	Windows     []Window `json:"windows,omitempty"`
	ResetUnread []string `json:"reset_unread,omitempty"`
}

// Encode is the JSON a checkpoint keeps of the session.
func (s Session) Encode() (json.RawMessage, error) {
	s.Attempts = core.NonNil(s.Attempts)
	for i := range s.Attempts {
		s.Attempts[i].Findings = core.NonNil(s.Attempts[i].Findings)
	}
	if s.Verdict != nil {
		v := *s.Verdict
		v.Findings = core.NonNil(v.Findings)
		s.Verdict = &v
	}
	s.Input = core.NonNil(s.Input)
	return core.EncodeJSON(s)
}

// DecodeSession reads a session a checkpoint kept.
func DecodeSession(raw json.RawMessage) (Session, error) {
	var s Session
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&s); err != nil {
		return s, err
	}
	return s, nil
}

// Independent is the native independent reviewer; its zero value is the reviewer.
type Independent struct{}

var _ Reviewer = Independent{}

// run is one independent review in progress: its input, what it asks of its caller, the pass
// under review and the session.
type run struct {
	in          Input
	env         Env
	pass        verify.Pass
	sess        Session
	tools       []any
	nativeTools *tools.Tools
	// external: the reviewer is an external executor; its source is delivered as complete
	// Kogen-owned prompt data (external.go), not as pinned parts it must read.
	external bool
	// base is the green pass the review session was started from (nil when a resumed native
	// session has none); it is recorded in every checkpoint of the session (Checkpoint.Base).
	base *verify.Pass
	// invalid is set when the review ended without a valid verdict.
	invalid *Invalid
}

func reviewTools(t *tools.Tools) []any {
	return slices.Concat(core.ShellDefinitions(t, ToolNames), agent.AsAny(ReviewerToolDefinitions(SubmitReviewTool)))
}

// Review starts the review of a green pass (REV-1): the material and the conversation.
func (Independent) Review(ctx context.Context, in Input, env Env) (Result, error) {
	env.Progress(fmt.Sprintf("kogen: reviewing (review %d)", in.Number))
	role := in.Intent.Role
	pass := in.Evidence.Pass
	// Only the frozen caller diagnostic follows the authority message here, never the
	// builder's replay, progress or reasoning.
	diagnostic := in.Evidence.Diagnostic
	if nav := in.Intent.Plan; nav != "" {
		// A staged Build's reviewer is told the plan's position and that stage evidence is
		// historical: as its own leading message, so its instructions stay frozen.
		diagnostic = append(slices.Clone(diagnostic), map[string]any{"role": "user",
			"content": "Staged plan context for this independent review." + nav})
	}
	nativeTools := in.Tools.Native(ToolNames)
	tools := reviewTools(nativeTools)
	m, err := MaterialOf(in)
	if err != nil {
		return Result{}, err
	}
	// A review is a fresh conversation: the unfinished observations of an earlier review that
	// ended without a verdict are not carried into it (Env.Prepare; its archives stay in
	// custody).
	input, err := env.Prepare(pass.Tree, m, role, ReviewerInstructions(), tools, diagnostic)
	if err != nil {
		return Result{}, err
	}
	base := pass
	r := &run{in: in, env: env, pass: pass, base: &base, tools: tools, nativeTools: nativeTools, sess: Session{Role: role, Input: input, Usage: core.ZeroTokens(), Seen: pass.Tree}}
	return r.loop(ctx, nil, "")
}

// Resume continues a saved review (LOOP-10): a request that was interrupted is sent again
// with the saved conversation; a verdict whose verification was interrupted is judged
// again; a blocked review (verdict changes) is reopened, not replayed.
func (Independent) Resume(ctx context.Context, in Input, env Env) (Result, error) {
	c := in.Checkpoint
	if c == nil {
		return Result{}, core.ResumeRefused("the saved review state cannot be read")
	}
	sess, err := DecodeSession(c.Session)
	if err != nil || c.Pass == nil {
		return Result{}, core.ResumeRefused("the saved review state cannot be read")
	}
	nativeTools := in.Tools.Native(ToolNames)
	tools := reviewTools(nativeTools)
	if len(sess.Tools) > 0 {
		tools = sess.Tools
	}
	r := &run{in: in, env: env, pass: *c.Pass, base: nativeResumeBase(*c, sess), sess: sess, tools: tools, nativeTools: nativeTools}
	verdicts := c.Stage != route.StageReview
	if verdicts && (sess.Verdict == nil || sess.Tree == "") {
		return Result{}, core.ResumeRefused("the saved review state has no verdict")
	}
	switch {
	case c.Stage == route.StageReviewRetry:
		return r.retry(ctx)
	case c.Stage == route.StageReviewVerify && sess.Verdict.Verdict == "changes":
		// An explicit resume reopens the blocker, not its terminal verdict.
		record := core.ReviewRecord{N: in.Number, Verdict: "pending", Findings: core.NonNil(sess.Verdict.Findings), Tree: sess.Tree}
		if in.Last != nil {
			record = *in.Last
			record.Verdict = "pending"
		}
		if err := env.Reviewed(record); err != nil {
			return Result{}, err
		}
		if err := r.save(route.StageReviewRetry); err != nil {
			return Result{}, err
		}
		return r.retry(ctx)
	case c.Stage == route.StageReviewVerify:
		return r.loop(ctx, sess.Verdict, sess.Tree)
	}
	return r.loop(ctx, nil, "")
}

// nativeResumeBase is the green base of a native session continued from a checkpoint: the one
// the checkpoint records, else (written before it was recorded) the checkpoint's pass while the
// session has not repaired, else none.
func nativeResumeBase(c Checkpoint, sess Session) *verify.Pass {
	switch {
	case c.Base != nil:
		base := *c.Base
		return &base
	case !sess.Repaired && c.Pass != nil:
		base := *c.Pass
		return &base
	}
	return nil
}

// save checkpoints the review at stage.
func (r *run) save(stage string) error {
	raw, err := r.sess.Encode()
	if err != nil {
		return err
	}
	pass := r.pass
	return r.env.Save(Checkpoint{Stage: stage, Pass: &pass, Session: raw, Base: r.base})
}

// loop runs the reviewer's conversation, and judges each verdict, until the review approves
// or stops. A pending verdict (a review resumed while its verdict was being verified) is
// judged first.
func (r *run) loop(ctx context.Context, pending *Verdict, tree string) (Result, error) {
	env := r.env
	for {
		if pending == nil {
			if err := r.save(route.StageReview); err != nil {
				return Result{}, err
			}
			if err := env.Facts("reviewing"); err != nil {
				return Result{}, err
			}
			verdict, err := r.converse(ctx)
			if err != nil {
				return Result{Invalid: r.invalid}, err
			}
			if tree, err = candidateTree(r.in.Candidate); err != nil {
				return Result{}, err
			}
			pending = &verdict
		}
		approved, again, err := r.evaluate(ctx, *pending, tree)
		pending = nil
		if err != nil || !again {
			return approved, err
		}
	}
}

// retry is the explicit resume of a blocked review (REV-5): fresh verification of the
// candidate, then the original finding and the actual results go back to the same reviewer.
func (r *run) retry(ctx context.Context) (Result, error) {
	env := r.env
	verdict := r.sess.Verdict
	pass, err := env.Verify(ctx)
	if err != nil {
		record := core.ReviewRecord{N: r.in.Number, Verdict: verdict.Verdict, Findings: core.NonNil(verdict.Findings), Tree: r.sess.Tree}
		if (r.sess.SyntheticBlock || r.legacySyntheticBlock()) && len(r.sess.Attempts) > 0 {
			last := r.sess.Attempts[len(r.sess.Attempts)-1]
			record = core.ReviewRecord{N: r.in.Number, Verdict: last.Verdict, Findings: core.NonNil(last.Findings), Tree: last.Tree}
		}
		return Result{Record: record, Repairs: r.sess.RepairRounds}, err
	}
	attempts := append(slices.Clone(r.sess.Attempts), Submitted{
		Pass: r.pass.N, Tree: r.sess.Tree, Verdict: verdict.Verdict, Findings: verdict.Findings,
	})
	findings, err := core.EncodeJSON(core.NonNil(verdict.Findings))
	if err != nil {
		return Result{}, err
	}
	evidence := pass.Results()
	if !pass.Green {
		evidence = env.Feedback(pass, SubmitReviewTool)
	}
	if r.in.Evidence.BaselineFailing {
		evidence += "\n" + strings.Join(env.Comparison(), "\n")
	}
	feedback := "The caller explicitly resumed this blocked Build. Continue as the same independent\n" +
		"reviewer for targeted clearance or scoped repair, not a new whole-change critique.\n" +
		"The original blocking finding remains unresolved until your new explicit decision:\n" +
		string(findings) + "\n" +
		"Earlier green evidence and approval do not clear this blocker. Fresh verification:\n" +
		evidence + "\n" +
		"Use the actual results, including failures and unrun items. Do not infer an operator\n" +
		"explanation. Submit changes if unresolved, or explicitly approve after resolving it;\n" +
		"edits still require ordinary external exact verification before commit.\n"
	delivery, err := deliverySection(r.in.Candidate, r.seenTree(), pass.Tree)
	if err != nil {
		return Result{}, err
	}
	feedback = delivery + feedback
	r.pass = pass
	r.sess = Session{
		Role: r.sess.Role, Usage: r.sess.Usage, Requests: r.sess.Requests, Attempts: attempts, Reopened: true, Repaired: r.sess.Repaired, Seen: pass.Tree, Probes: r.sess.Probes, ProbeRuns: r.sess.ProbeRuns, Listed: r.sess.Listed, RepairRounds: r.sess.RepairRounds, FailureIdentities: r.sess.FailureIdentities, FailureStreak: r.sess.FailureStreak,
		Windows: r.sess.Windows, ResetUnread: r.sess.ResetUnread,
		Input: slices.Concat(r.sess.Input, []any{map[string]any{"role": "user", "content": feedback}}),
	}
	return r.loop(ctx, nil, "")
}

// legacySyntheticBlock recognizes repair-limit checkpoints written before the marker existed.
func (r *run) legacySyntheticBlock() bool {
	s := r.sess
	if s.Verdict == nil || s.Verdict.Verdict != "changes" || len(s.Verdict.Findings) != 1 || len(s.Attempts) == 0 {
		return false
	}
	reason := "repeated identical final failures"
	if s.FailureStreak < 3 {
		if s.RepairRounds < 20 {
			return false
		}
		reason = "repair round hard cap"
	}
	message := fmt.Sprintf("%s after %d repair rounds; current failing stage/items: %s", reason, s.RepairRounds, strings.Join(failureIdentities(r.pass), ", "))
	f := s.Verdict.Findings[0]
	return f["path"] == "" && f["severity"] == "blocking" && f["message"] == message
}

// seenTree is the tree whose bytes the reviewer holds.
func (r *run) seenTree() string {
	if r.sess.Seen != "" {
		return r.sess.Seen
	}
	return r.pass.Tree
}

// deliverySection tells the reviewer that the candidate changed after its contents were
// delivered, with the exact diff against the seen tree. It is empty when the trees are equal.
func deliverySection(c Candidate, seen, now string) (string, error) {
	if seen == now {
		return "", nil
	}
	paths, err := c.Repo.Changed(seen, now)
	if err != nil {
		return "", err
	}
	diff, err := c.Repo.Diff(seen, now, paths)
	if err != nil {
		return "", err
	}
	return "Your verdict was not applied: the candidate changed after its contents were delivered to you, other than through your own Kogen tool calls: " +
		strings.Join(paths, ", ") + ".\nThe exact diff of these changes against the contents delivered to you:\n\n" +
		strings.ToValidUTF8(diff, "�") + "\n", nil
}

// evaluate judges a valid verdict on the candidate tree. A blocked review ends the Build.
// An approval binds the tree: when it is not the tree of a green pass, the changed contents
// are verified, and a pass that is not green on that very tree returns to the reviewer
// (again true) with targeted feedback.
func (r *run) evaluate(ctx context.Context, verdict Verdict, tree string) (res Result, again bool, err error) {
	env := r.env
	n := r.in.Number
	r.sess.Verdict, r.sess.Tree = &verdict, tree
	if err := r.save(route.StageReviewVerify); err != nil {
		return Result{}, false, err
	}
	if err := env.BaselineIntact(); err != nil {
		return Result{}, false, err
	}
	findings := core.NonNil(verdict.Findings)
	review := core.ReviewRecord{N: n, Verdict: verdict.Verdict, Findings: findings, Tree: tree}
	if err := env.Reviewed(review); err != nil {
		return Result{}, false, err
	}
	attempts := append(slices.Clone(r.sess.Attempts), Submitted{Pass: r.pass.N, Tree: tree, Verdict: verdict.Verdict, Findings: findings})
	blocking := 0
	for _, f := range findings {
		if f["severity"] == "blocking" {
			blocking++
		}
	}
	env.Progress(fmt.Sprintf("kogen: review %d: %s, %d blocking", n, verdict.Verdict, blocking))
	if err := env.Write(File(n), map[string]any{
		"model": r.sess.Role.Model, "effort": r.sess.Role.Effort, "usage": r.sess.Usage,
		"verdict": verdict.Verdict, "findings": findings, "tree": tree, "attempts": attempts,
		"requirements": core.NonNil(verdict.Requirements),
	}); err != nil {
		return Result{}, false, err
	}
	env.Event(map[string]any{
		"event": "review", "review": n, "attempt": len(attempts), "pass": r.pass.N, "tree": tree,
		"verdict": verdict.Verdict, "findings": findings,
	})

	if verdict.Verdict == "changes" {
		e := sys.Fail("candidate", "review_blocked",
			"the reviewer could not resolve a substantive blocker within the approved Intent; edits are left in place", 1)
		for _, f := range findings {
			if f["severity"] == "blocking" {
				e.Lines = append(e.Lines, fmt.Sprintf("review: %s:%s: %s", core.Display(f["path"]), core.Display(f["line"]), core.Display(f["message"])))
			}
		}
		return Result{Record: review, Pass: r.pass, Repairs: r.sess.RepairRounds}, false, e
	}

	// An approval binds the seen tree: only an approval of the contents whose bytes reached the
	// reviewer can commit.
	seen := r.seenTree()
	final := r.pass
	if !(r.pass.Green && tree == r.pass.Tree) {
		pending := review
		pending.Verdict = "pending"
		if err := env.Reviewed(pending); err != nil {
			return Result{}, false, err
		}
		if final, err = env.Verify(ctx); err != nil {
			return Result{Record: review, Repairs: r.sess.RepairRounds}, false, err
		}
	}
	if tree == seen && final.Green && final.Tree == tree {
		approved := review
		if err := env.Reviewed(approved); err != nil {
			return Result{}, false, err
		}
		return Result{Record: approved, Pass: final, Repairs: r.sess.RepairRounds}, false, nil
	}

	feedback, err := deliverySection(r.in.Candidate, seen, final.Tree)
	if err != nil {
		return Result{}, false, err
	}
	if feedback != "" {
		env.Progress(fmt.Sprintf("kogen: review %d: the candidate changed after its contents were delivered; returning the changes to the reviewer", n))
	}
	if final.Green {
		feedback += "The new tree passed checks but has not been reviewed. Inspect these changes and submit_review for the current contents; do not restart the whole critique."
	} else {
		env.Progress(fmt.Sprintf("kogen: review %d: final verification failed; continuing targeted repairs", n))
		feedback += "Final verification of your repairs failed. Fix these failures and regressions from your edits; do not restart a whole-change critique. If observed evidence demonstrates a protected fixture defect, use submit_review changes with a blocking finding at that protected path instead of a production workaround, including a test-facing hidden comment.\n" +
			env.Feedback(final, SubmitReviewTool)
	}
	r.sess.RepairRounds++
	ids := failureIdentities(final)
	if final.Green {
		r.sess.FailureIdentities, r.sess.FailureStreak = nil, 0
	} else {
		if r.sess.FailureStreak > 0 && slices.Equal(ids, r.sess.FailureIdentities) {
			r.sess.FailureStreak++
		} else {
			r.sess.FailureIdentities, r.sess.FailureStreak = ids, 1
		}
	}
	if r.sess.FailureStreak >= 3 || r.sess.RepairRounds >= 20 {
		reason := "repeated identical final failures"
		if r.sess.FailureStreak < 3 {
			reason = "repair round hard cap"
		}
		message := fmt.Sprintf("%s after %d repair rounds; current failing stage/items: %s", reason, r.sess.RepairRounds, strings.Join(ids, ", "))
		finding := map[string]any{"path": "", "line": 0, "severity": "blocking", "message": message}
		blocked := Verdict{Verdict: "changes", Findings: []map[string]any{finding}}
		r.pass = final
		r.sess.Verdict, r.sess.Tree, r.sess.Attempts = &blocked, final.Tree, attempts
		r.sess.Repaired = true
		r.sess.SyntheticBlock = true
		if err := r.save(route.StageReviewVerify); err != nil {
			return Result{}, false, err
		}
		if err := env.Repaired(); err != nil {
			return Result{}, false, err
		}
		record := core.ReviewRecord{N: n, Verdict: "changes", Findings: blocked.Findings, Tree: final.Tree}
		if err := env.Reviewed(record); err != nil {
			return Result{}, false, err
		}
		if err := env.Write(File(n), map[string]any{"model": r.sess.Role.Model, "effort": r.sess.Role.Effort, "usage": r.sess.Usage, "verdict": "changes", "findings": blocked.Findings, "tree": final.Tree, "attempts": attempts, "requirements": core.NonNil(verdict.Requirements)}); err != nil {
			return Result{}, false, err
		}
		e := sys.Fail("candidate", "review_blocked", message, 1)
		e.Lines = append(e.Lines, "review: "+message, feedback)
		return Result{Record: record, Pass: final, Repairs: r.sess.RepairRounds}, false, e
	}
	r.pass = final
	r.sess = Session{
		Role: r.sess.Role, Usage: r.sess.Usage, Requests: r.sess.Requests, Attempts: attempts, Reopened: r.sess.Reopened, Repaired: true, Seen: final.Tree, Probes: r.sess.Probes, ProbeRuns: r.sess.ProbeRuns, Listed: r.sess.Listed, RepairRounds: r.sess.RepairRounds, FailureIdentities: r.sess.FailureIdentities, FailureStreak: r.sess.FailureStreak,
		Windows: r.sess.Windows, ResetUnread: r.sess.ResetUnread,
		Input: slices.Concat(r.sess.Input, []any{map[string]any{"role": "user", "content": feedback}}),
	}
	if err := r.save(route.StageReview); err != nil {
		return Result{}, false, err
	}
	if err := env.Repaired(); err != nil {
		return Result{}, false, err
	}
	return Result{}, true, nil
}

// failureIdentities uses the structured stages when available; Failing also carries
// stage-qualified identities in saved and caller-supplied verification evidence.
func failureIdentities(p verify.Pass) []string {
	var ids []string
	covered := map[string]bool{}
	add := func(name, identity string) { covered[name] = true; ids = append(ids, identity) }
	if p.Acceptance != nil && len(p.Acceptance.Problems) > 0 {
		add("acceptance", "acceptance")
	}
	if p.Model.Failed() {
		add("model", "model")
	}
	for _, m := range p.MaintainedModels {
		if m.Result.Failed() {
			add(m.Path, "model:"+m.Path)
		}
	}
	for _, c := range p.Setup {
		if c.Status != 0 {
			add(c.Name, "setup:"+c.Name)
		}
	}
	for _, c := range p.Checks {
		if c.Status != 0 {
			add(c.Name, "check:"+c.Name)
		}
	}
	for _, name := range p.Failing {
		if !covered[name] {
			ids = append(ids, name)
		}
	}
	slices.Sort(ids)
	return slices.Compact(ids)
}

// converse is the reviewer's requests and tool calls until it submits a valid verdict. Two
// allowances, spent independently and each once: a rejected submit_review is sent back with its
// problems, and a prose-only turn is sent back with a reminder (the next request requires
// submit_review where the route supports it). Spending an allowance a second time ends this
// review without a verdict (run.invalidStop).
const reviewBudgetNotice = "Your review working budget is spent. Call submit_review now with what you know; verdict validation and unread-part requirements still apply."

func budgetNotice(input []any) []any {
	for _, item := range input {
		if m, ok := item.(map[string]any); ok && m["role"] == "user" && m["content"] == reviewBudgetNotice {
			return input
		}
	}
	return append(input, map[string]any{"role": "user", "content": reviewBudgetNotice})
}

func (r *run) converse(ctx context.Context) (Verdict, error) {
	env := r.env
	prevUnread := -1
	if r.sess.PrevUnread > 0 {
		prevUnread = r.sess.PrevUnread
	}
	for {
		overBudget := r.sess.Requests >= 12
		if overBudget {
			r.sess.Input = budgetNotice(r.sess.Input)
		}
		r.sess.Requests++
		if err := r.save(route.StageReview); err != nil {
			return Verdict{}, err
		}
		force := ""
		if r.sess.Remind || overBudget {
			mode := "text_fallback"
			if provider.SupportsToolChoice(core.ProviderRole(r.sess.Role)) {
				mode = "api_forced"
				force = SubmitReviewTool
			}
			env.Event(map[string]any{
				"event": "review_tool_choice", "review": r.in.Number, "tool": SubmitReviewTool, "mode": mode,
				"rejected_verdicts": r.sess.Rejected, "no_tool_reminders": r.sess.NoTool,
			})
		}
		send := func() (*provider.Response, []any, error) {
			requestSession := r.sess
			retain := func(input []any) (json.RawMessage, error) {
				sent := requestSession
				sent.Input = input
				return sent.Encode()
			}
			return env.Request(ctx, Request{
				Role: r.sess.Role, Instructions: ReviewerInstructions(),
				Input: r.sess.Input, Tools: r.tools, Retain: retain, ForceTool: force,
				Prefill: func(input []any) ([]any, error) {
					prepared, err := env.Prefill(r.sess.Role, ReviewerInstructions(), r.tools, input)
					if err != nil {
						return nil, err
					}
					if overBudget {
						prepared = budgetNotice(prepared)
					}
					return prepared, nil
				},
			})
		}
		resp, active, err := send()
		if err != nil && refusesCeiling(err) {
			// The Env refused the whole conversation before sending: the reviewer resets its own
			// working context once and sends the request again (reset.go).
			event, progress, rerr := r.reset(err, force, overBudget)
			if rerr != nil {
				return Verdict{}, rerr
			}
			if err := r.save(route.StageReview); err != nil {
				return Verdict{}, err
			}
			env.Event(event)
			env.Progress(progress)
			resp, active, err = send()
		}
		if err != nil {
			return Verdict{}, err
		}
		// The reminder request is over: ordinary tool choice again.
		r.sess.Remind = false
		r.sess.Usage = r.sess.Usage.Plus(core.ResponseTokens(r.sess.Role, resp))
		if err := env.Track(); err != nil {
			return Verdict{}, err
		}
		input := slices.Concat(active, tools.Replay(resp.Items))
		calls := tools.Calls(resp.Items)
		tl := r.nativeTools
		if tl == nil {
			tl = r.in.Tools.Native(ToolNames)
		}

		var outs []any
		var verdict *Verdict
		var problems []string
		for i := range calls {
			call := calls[i]
			if err := env.Err(); err != nil {
				return Verdict{}, err
			}
			if err := env.Custody(); err != nil {
				return Verdict{}, err
			}
			if err := project.ValidateSource(r.in.Intent.Source); err != nil {
				return Verdict{}, err
			}
			if err := env.Boundary(slices.Concat(input, outs), nil); err != nil {
				return Verdict{}, err
			}
			switch {
			case verdict != nil || problems != nil:
				outs = append(outs, call.Output("ignored: the review already has a verdict"))
			case call.Name == SubmitReviewTool:
				v, probs, err := r.validate(call.Args(), input)
				if err != nil {
					return Verdict{}, err
				}
				if probs != nil {
					problems = probs
					outs = append(outs, call.Output(tools.Cut("invalid verdict:\n"+strings.Join(probs, "\n"))))
				} else {
					verdict = v
					outs = append(outs, call.Output("accepted"))
				}
			default:
				// The reviewer's own edits advance the seen tree: only write_file and shell, and
				// only when the tree before the call was the seen tree.
				edits := call.Name == "write_file" || call.Name == "shell"
				before := ""
				if edits {
					if before, err = candidateTree(r.in.Candidate); err != nil {
						return Verdict{}, err
					}
				}
				out, err := tl.Call(call)
				if err != nil {
					return Verdict{}, err
				}
				command, _ := call.Args()["command"].(string)
				probe := call.Name == "shell" && command != ""
				if probe {
					r.sess.Probes = append(r.sess.Probes, command)
				}
				if edits {
					after, err := candidateTree(r.in.Candidate)
					if err != nil {
						return Verdict{}, err
					}
					if probe {
						r.sess.ProbeRuns = append(r.sess.ProbeRuns, ProbeRun{Command: command, Status: exitStatus(out.Text), Tree: after})
					}
					if before == r.seenTree() {
						r.sess.Seen = after
					}
				}
				result := out.Cut()
				if event := tools.ReadEvent(call, result, "review"); event != nil {
					env.Event(event)
				}
				event := map[string]any{
					"event": "review_tool_call", "name": call.Name,
					"arguments": provider.Fingerprint(call.Arguments), "result": provider.Fingerprint(result.Value()),
				}
				for k, v := range r.in.Tools.Record(call, result) {
					event[k] = v
				}
				env.Event(event)
				done := &Done{Call: call.Item, Result: result.Value()}
				if err := env.Boundary(slices.Concat(input, outs), done); err != nil {
					return Verdict{}, err
				}
				if call.Name == "shell" {
					if err := env.BaselineIntact(); err != nil {
						return Verdict{}, err
					}
				}
				outs = append(outs, call.Output(result))
			}
		}
		input = slices.Concat(input, outs)
		if len(calls) == 0 {
			problems = []string{"the review ended without calling submit_review"}
			if force != "" {
				// The route was told to call submit_review and answered with text only: a fault of
				// the provider, not unread-part progress. It is only a no-tool turn for the allowance.
				env.Event(map[string]any{
					"event": "provider_fault", "fault": "forced_tool_not_called", "review": r.in.Number, "tool": force,
					"mode": "api_forced", "route": provider.Name(core.ProviderRole(r.sess.Role)), "model": r.sess.Role.Model,
				})
			}
		}

		exempt := false
		if n := unreadProblemCount(problems); n > 0 {
			exempt = prevUnread < 0 || n < prevUnread
			prevUnread, r.sess.PrevUnread = n, n
		}
		switch {
		case problems != nil && exempt:
			// Progress on unread parts spends neither allowance.
			r.allowance("unread_progress_exempt")
		case problems != nil && len(calls) == 0:
			if r.sess.NoTool >= 1 {
				return Verdict{}, r.invalidStop(problems, "no_tool_reminder_exhausted", force != "")
			}
			input = append(input, map[string]any{"role": "user",
				"content": "Not a valid verdict: " + strings.Join(problems, "; ") + ". Call submit_review."})
			r.sess.NoTool++
			r.sess.Remind = true
			r.allowance("no_tool_turn")
		case problems != nil:
			if r.sess.Rejected >= 1 {
				return Verdict{}, r.invalidStop(problems, "rejected_verdict_exhausted", false)
			}
			r.sess.Rejected++
			r.allowance("rejected_verdict")
		case verdict != nil:
			r.sess.Input = input
			if !r.external {
				if err := env.Delivered(input); err != nil {
					return Verdict{}, err
				}
			}
			return *verdict, nil
		}
		r.sess.Input = input
	}
}

// validate checks a submit_review call (REV-4): a verdict approve or changes with findings
// {path, line, severity, message}; every path names a file of the checkout or of the start
// HEAD; changes has a blocking finding, approve none; and an approval has read all pinned source
// parts. It returns the verdict, or the problems to send back.
func (r *run) validate(args map[string]any, input []any) (*Verdict, []string, error) {
	verdict, _ := args["verdict"].(string)
	list, isList := args["findings"].([]any)
	if (verdict != "approve" && verdict != "changes") || !isList {
		// Report only JSON types, never submitted contents.
		kind := func(field string) string {
			value, present := args[field]
			if !present {
				return "missing"
			}
			switch value.(type) {
			case nil:
				return "null"
			case string:
				return "a string"
			case bool:
				return "a boolean"
			case []any:
				return "an array"
			case map[string]any:
				return "an object"
			default:
				return "a number"
			}
		}
		var details []string
		if verdict != "approve" && verdict != "changes" {
			typ := kind("verdict")
			if typ == "a string" {
				typ += " with an unsupported value"
			}
			details = append(details, "verdict must be approve or changes but was "+typ)
		}
		if !isList {
			details = append(details, "findings must be a JSON array of objects but was "+kind("findings"))
		}
		return nil, []string{"submit_review needs verdict (approve or changes) and a findings list; " + strings.Join(details, "; ")}, nil
	}
	var problems []string
	var findings []map[string]any
	blocking := 0
	for _, item := range list {
		f, _ := item.(map[string]any)
		path, pathOK := f["path"].(string)
		_, lineOK := reviewInteger(f["line"])
		severity, _ := f["severity"].(string)
		_, messageOK := f["message"].(string)
		if f != nil && f["severity"] == "blocking" {
			blocking++
		}
		if f == nil || !pathOK || !lineOK || (severity != "blocking" && severity != "note") || !messageOK {
			problems = append(problems, "each finding needs path (string), line (integer), severity (blocking or note) and message")
			continue
		}
		findings = append(findings, f)
		if st, err := os.Stat(filepath.Join(r.in.Candidate.Root, path)); err == nil && st.Mode().IsRegular() {
			continue
		}
		if !inStart(r.in.Candidate, path) {
			problems = append(problems, path+" is not a file of the repository")
		}
	}
	switch {
	case verdict == "changes" && blocking == 0:
		problems = append(problems, "a changes verdict needs at least one blocking finding")
	case verdict == "approve" && blocking > 0:
		problems = append(problems, "an approve verdict cannot have blocking findings")
	}
	requirements, reqProblems, err := r.requirements(args, verdict, findings, input)
	if err != nil {
		return nil, nil, err
	}
	problems = append(problems, reqProblems...)
	if verdict == "changes" && !r.external {
		unread, err := r.unread(input)
		if err != nil {
			return nil, nil, err
		}
		if len(unread) > 0 {
			problems = append(problems, fmt.Sprintf("%d pinned part(s) unread; read them before a verdict; incomplete delivery is not a candidate defect; use read_file on %s",
				len(unread), strings.Join(unread[:min(8, len(unread))], ", ")))
		}
	}
	if verdict == "approve" && !r.external {
		unread, err := r.unread(input)
		if err != nil {
			return nil, nil, err
		}
		if len(unread) > 0 {
			problems = append(problems, fmt.Sprintf("Read all pinned source evidence before approving: %d unread part(s); use read_file on %s",
				len(unread), strings.Join(unread[:min(8, len(unread))], ", ")))
		}
	}
	if problems != nil {
		return nil, problems, nil
	}
	return &Verdict{Verdict: verdict, Findings: findings, Requirements: requirements}, nil, nil
}

// requirementSuffix ends the problems of evidence that cannot be established here.
const requirementSuffix = "cite a probe you ran with shell on the current tree that exercises the requirement, or, when nothing can verify it here, submit changes with a blocking finding that quotes the requirement and says its verification could not run"

// requirements checks a submission's requirements: absent or null is none; otherwise an array of
// {requirement, evidence, ref, met}. An approval needs evidence for every entry that shows it met:
// a probe the native reviewer cites must have run in this review, on the current tree, succeeded
// and named a file or directory of the candidate, and an acceptance scenario must have passed in
// the pass under review of the current tree; an approval keeps every requirement an earlier
// submission of this review listed. A changes verdict quotes each unmet requirement in a blocking
// finding.
func (r *run) requirements(args map[string]any, verdict string, findings []map[string]any, input []any) ([]Requirement, []string, error) {
	raw, present := args["requirements"]
	if !present || raw == nil {
		return nil, missing(verdict, r.sess.Listed, nil), nil
	}
	shape := []string{"requirements must be a JSON array of objects with requirement (a non-empty string), evidence (test, acceptance, probe or none), ref (a string, non-empty unless evidence is none) and met (a boolean)"}
	list, ok := raw.([]any)
	if !ok {
		return nil, shape, nil
	}
	var out []Requirement
	for _, item := range list {
		m, _ := item.(map[string]any)
		text, textOK := m["requirement"].(string)
		evidence, _ := m["evidence"].(string)
		ref, refOK := m["ref"].(string)
		met, metOK := m["met"].(bool)
		known := evidence == "test" || evidence == "acceptance" || evidence == "probe" || evidence == "none"
		if m == nil || !textOK || text == "" || !known || !refOK || (ref == "" && evidence != "none") || !metOK {
			return nil, shape, nil
		}
		out = append(out, Requirement{Requirement: text, Evidence: evidence, Ref: ref, Met: met})
	}
	listed := slices.Clone(r.sess.Listed)
	for _, q := range out {
		if !slices.Contains(r.sess.Listed, q.Requirement) {
			r.sess.Listed = append(r.sess.Listed, q.Requirement)
		}
	}
	e := &evidenceCheck{r: r}
	var problems []string
	for _, q := range out {
		quoted := "requirement \"" + q.Requirement + "\""
		switch {
		case verdict == "approve" && q.Evidence == "none":
			problems = append(problems, quoted+" has no evidence: probe it with shell against the candidate before the verdict")
		case verdict == "approve" && !q.Met:
			problems = append(problems, quoted+" is not met: repair it, or submit changes with a blocking finding that quotes it")
		case verdict == "approve" && q.Evidence == "probe" && !r.external && !r.ran(q.Ref, input):
			problems = append(problems, quoted+" cites a probe that did not run in this review: run its command with shell before citing it")
		case verdict == "changes" && !q.Met && !quotes(findings, q.Requirement):
			problems = append(problems, quoted+" is not met: a changes verdict needs a blocking finding whose message quotes it")
		case verdict == "approve" && q.Evidence == "probe" && !r.external:
			problem, err := e.probe(quoted, q.Ref, input)
			if err != nil {
				return nil, nil, err
			}
			if problem != "" {
				problems = append(problems, problem)
			}
		case verdict == "approve" && q.Evidence == "acceptance":
			problem, err := e.acceptance(quoted, q.Ref)
			if err != nil {
				return nil, nil, err
			}
			if problem != "" {
				problems = append(problems, problem)
			}
		}
	}
	kept := make([]string, 0, len(out))
	for _, q := range out {
		kept = append(kept, q.Requirement)
	}
	return out, append(problems, missing(verdict, listed, kept)...), nil
}

// missing lists, for an approval, the requirements an earlier submission listed that kept does
// not have.
func missing(verdict string, listed, kept []string) []string {
	if verdict != "approve" {
		return nil
	}
	var problems []string
	for _, text := range listed {
		if !slices.Contains(kept, text) {
			problems = append(problems, "requirement \""+text+"\" was listed by an earlier submission of this review and is missing: keep every requirement in requirements, with evidence observed on the current tree")
		}
	}
	return problems
}

// evidenceCheck judges requirement evidence against the current tree, computed once and only
// when a check needs it.
type evidenceCheck struct {
	r     *run
	tree  string
	files []string
	read  bool
}

func (e *evidenceCheck) current() (string, error) {
	if !e.read {
		tree, err := candidateTree(e.r.in.Candidate)
		if err != nil {
			return "", err
		}
		e.tree, e.read = tree, true
	}
	return e.tree, nil
}

// names reports whether command names a file of the current tree, or a directory holding one.
func (e *evidenceCheck) names(command string) (bool, error) {
	tree, err := e.current()
	if err != nil {
		return false, err
	}
	if e.files == nil {
		out, err := e.r.in.Candidate.Repo.OK("ls-tree", "-r", "--name-only", "-z", tree)
		if err != nil {
			return false, err
		}
		e.files = append([]string{}, strings.Split(out, "\x00")...)
	}
	root := e.r.in.Candidate.Root + "/"
	pieces := strings.FieldsFunc(command, func(c rune) bool {
		return unicode.IsSpace(c) || strings.ContainsRune("'\"`$()<>|&;={}", c)
	})
	for _, piece := range pieces {
		piece = strings.TrimPrefix(piece, root)
		for strings.HasPrefix(piece, "./") {
			piece = piece[2:]
		}
		piece = strings.TrimSuffix(piece, "/...")
		piece = strings.TrimSuffix(piece, "/")
		if piece == "" {
			continue
		}
		for _, f := range e.files {
			if f == piece || strings.HasPrefix(f, piece+"/") {
				return true, nil
			}
		}
	}
	return false, nil
}

// probe is the problem of a cited probe that does not establish its requirement, or "".
func (e *evidenceCheck) probe(quoted, command string, input []any) (string, error) {
	named, err := e.names(command)
	if err != nil {
		return "", err
	}
	if !named {
		return quoted + " cites probe \"" + command + "\", which names no file or directory of the current tree: a probe is evidence only when it exercises the candidate; run a focused probe of the requirement with shell on the current tree and cite its exact command", nil
	}
	run := e.r.latestRun(command, input)
	if run.Status == nil || *run.Status != 0 {
		observed := "no exit status"
		if run.Status != nil {
			observed = "exit status " + strconv.Itoa(*run.Status)
		}
		return quoted + " cites probe \"" + command + "\", whose latest run in this review did not succeed (" + observed + "): a probe that did not succeed does not show the requirement met; repair the candidate, or submit changes with a blocking finding that quotes the requirement", nil
	}
	if run.Tree != "" {
		current, err := e.current()
		if err != nil {
			return "", err
		}
		if run.Tree != current {
			return quoted + " cites probe \"" + command + "\", whose latest run in this review was on tree " + run.Tree + ", not on the current tree " + current + ": run it again on the current tree before citing it", nil
		}
	}
	return "", nil
}

// acceptance is the problem of a cited acceptance scenario that the pass under review does not
// show passed on the current tree, or "".
func (e *evidenceCheck) acceptance(quoted, ref string) (string, error) {
	pass := e.r.pass
	cites := quoted + " cites acceptance \"" + ref + "\""
	if pass.Acceptance == nil {
		return cites + ", which did not run on the current tree (not_run): naming a scenario is not evidence; " + requirementSuffix, nil
	}
	current, err := e.current()
	if err != nil {
		return "", err
	}
	if pass.Tree != current {
		return cites + ", whose result is of tree " + pass.Tree + ", not of the current tree " + current + ": an earlier result is history and does not establish the requirement on the current tree; " + requirementSuffix, nil
	}
	cited := false
	for _, sc := range pass.Acceptance.Scenarios {
		if !citesScenario(ref, sc) {
			continue
		}
		cited = true
		switch sc.Status {
		case "passed":
		case "failed":
			return quoted + " cites acceptance scenario \"" + sc.Name + "\", which failed on the current tree: the observed result contradicts met; repair the candidate, or submit changes with a blocking finding that quotes the requirement", nil
		default:
			return quoted + " cites acceptance scenario \"" + sc.Name + "\", whose result on the current tree is " + sc.Status + ", not passed: " + requirementSuffix, nil
		}
	}
	if !cited {
		return cites + ", which names no scenario of the acceptance result: name the scenario that exercises the requirement, or " + requirementSuffix, nil
	}
	return "", nil
}

// citesScenario reports whether ref contains the scenario's name or the text of one of its steps.
func citesScenario(ref string, sc verify.ScenarioResult) bool {
	if sc.Name != "" && strings.Contains(ref, sc.Name) {
		return true
	}
	for _, step := range sc.Steps {
		if step.Text != "" && strings.Contains(ref, step.Text) {
			return true
		}
	}
	return false
}

// exitStatus is N when a shell result text begins with "exit status: N" and a newline or its
// end, and nil otherwise.
func exitStatus(text string) *int {
	rest, ok := strings.CutPrefix(text, "exit status: ")
	if !ok {
		return nil
	}
	digits, _, _ := strings.Cut(rest, "\n")
	n, err := strconv.Atoi(digits)
	if err != nil || strings.HasPrefix(digits, "+") {
		return nil
	}
	return &n
}

// latestRun is the last run of the shell command: the session's last ProbeRun of it, else the
// last shell call of it in input with the status of its output and no tree, else (a command known
// only from the session's probes) a run with neither.
func (r *run) latestRun(command string, input []any) ProbeRun {
	for i := len(r.sess.ProbeRuns) - 1; i >= 0; i-- {
		if r.sess.ProbeRuns[i].Command == command {
			return r.sess.ProbeRuns[i]
		}
	}
	for i := len(input) - 1; i >= 0; i-- {
		m, _ := input[i].(map[string]any)
		if m["type"] != "function_call" || m["name"] != "shell" {
			continue
		}
		args, _ := m["arguments"].(string)
		if c, _ := tools.DecodeArguments(args)["command"].(string); c != command {
			continue
		}
		run := ProbeRun{Command: command}
		for _, item := range input {
			o, _ := item.(map[string]any)
			if text, _ := o["output"].(string); o["type"] == "function_call_output" && o["call_id"] == m["call_id"] {
				run.Status = exitStatus(text)
			}
		}
		return run
	}
	return ProbeRun{Command: command}
}

// ran reports whether command is the command of a shell call of this review: one the session
// recorded, or one in input.
func (r *run) ran(command string, input []any) bool {
	if slices.Contains(r.sess.Probes, command) {
		return true
	}
	for _, item := range input {
		m, _ := item.(map[string]any)
		if m["type"] != "function_call" || m["name"] != "shell" {
			continue
		}
		args, _ := m["arguments"].(string)
		if c, _ := tools.DecodeArguments(args)["command"].(string); c == command {
			return true
		}
	}
	return false
}

// quotes reports whether a blocking finding's message contains text.
func quotes(findings []map[string]any, text string) bool {
	for _, f := range findings {
		if message, _ := f["message"].(string); f["severity"] == "blocking" && strings.Contains(message, text) {
			return true
		}
	}
	return false
}

// reviewInteger is v when it is a JSON integer (not a float).
func reviewInteger(v any) (int64, bool) {
	switch n := v.(type) {
	case int64:
		return n, true
	case int:
		return int64(n), true
	case json.Number:
		return 0, !strings.ContainsAny(n.String(), ".eE")
	}
	return 0, false
}

// unreadProblemCount is the unread count named by the unread-parts problem of a changes
// verdict, or 0 when problems carry none.
func unreadProblemCount(problems []string) int {
	for _, p := range problems {
		var n int
		if _, err := fmt.Sscanf(p, "%d pinned part(s) unread; read them before a verdict;", &n); err == nil && n > 0 {
			return n
		}
	}
	return 0
}

// Validate checks a submit_review call of the native reviewer's conversation input as the
// reviewer of in does (REV-4): it returns the verdict, or the problems to send back.
func Validate(in Input, env Env, args map[string]any, input []any) (*Verdict, []string, error) {
	return (&run{in: in, env: env, pass: in.Evidence.Pass}).validate(args, input)
}
