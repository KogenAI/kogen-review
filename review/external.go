package review

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-coordinator/route"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-verification/verify"
	"kogen-loop/sys"
)

// External is the independent review by an external executor (Claude Code): the review
// role's own fresh session, never the builder's conversation, claims or transcript. Kogen
// delivers the complete exact authority and source as outgoing prompt data (no Read-tool
// receipt is claimed), validates the verdict with the same rules as the native reviewer and
// evaluates it with the same exact-tree logic (run.evaluate). Red verification and
// concrete failures return to this same reviewer session. It has no exact resume: a resume
// starts a fresh review of the green base its checkpoints record (the Build's resume of an
// external review stage).
//
// The complete first prompt of every session is measured before it is sent (parts.go):
// a source that does not fit one prompt is reviewed in ordered parts, each in its own session.
type External struct {
	exec      executor.Executor
	desc      executor.Descriptor
	maxRounds int
}

var _ Reviewer = External{}

// NewExternal is the reviewer served by exec, which described itself as desc, with at most
// maxRounds rounds in a session.
func NewExternal(exec executor.Executor, desc executor.Descriptor, maxRounds int) External {
	return External{exec: exec, desc: desc, maxRounds: maxRounds}
}

// Material is the private evidence of what one review was given: exact bytes and hashes
// of the authority and the source, and the identity of every changed path (the parts). Delivery
// counts only after a completed round of the matching session.
type Material struct {
	Review    int              `json:"review"`
	Tree      string           `json:"tree"`
	Authority fileEvidence     `json:"authority"`
	Source    fileEvidence     `json:"source"`
	Parts     []map[string]any `json:"parts"`
	Session   string           `json:"session_id,omitempty"`
	Delivered bool             `json:"delivered"`
	Round     int              `json:"delivered_round,omitempty"`
	// ReviewParts is, when the source is reviewed in parts, one entry per part in order; it is
	// absent for a review in one session.
	ReviewParts []Part `json:"review_parts,omitempty"`
}

// Part is the evidence of one part of a review in parts: its private file, the source range
// it carries, the exact length of its complete first prompt and its own session and delivery.
type Part struct {
	Part           int    `json:"part"`
	File           string `json:"file"`
	Bytes          int    `json:"bytes"`
	SHA256         string `json:"sha256"`
	From           int    `json:"from"`
	To             int    `json:"to"`
	PromptBytes    int    `json:"prompt_bytes"`
	SessionID      string `json:"session_id"`
	Delivered      bool   `json:"delivered"`
	DeliveredRound int    `json:"delivered_round,omitempty"`
}

type fileEvidence struct {
	File   string `json:"file"`
	Bytes  int    `json:"bytes"`
	SHA256 string `json:"sha256"`
}

func (x External) Resume(context.Context, Input, Env) (Result, error) {
	return Result{}, core.ResumeRefused("an independent review by an external executor cannot be resumed (resume capability: none)")
}

func reviewSchema() json.RawMessage {
	params := ReviewerToolDefinitions(SubmitReviewTool)[0]["parameters"]
	b, _ := json.Marshal(params)
	return b
}

// xreview is one review by an external executor in progress: its input, what it asks of its
// caller and the reviewer's executor state in the Build so far (each session of it, a fresh
// review's or a part's, adds to it).
type xreview struct {
	in       Input
	env      Env
	executor *core.ExecutorState
}

// executorChanged hands the caller the reviewer's executor state as it is now.
func (v *xreview) executorChanged() {
	x := *v.executor
	v.env.Executor(&x)
}

func (x External) Review(ctx context.Context, in Input, env Env) (Result, error) {
	v := &xreview{in: in, env: env, executor: in.Executor}
	pass := in.Evidence.Pass
	role := in.Intent.Role
	m, err := MaterialOf(in)
	if err != nil {
		return Result{}, err
	}
	// The caller's diagnostic data and the staged plan context follow the authority, exactly as
	// the native reviewer receives them; never the builder's replay, progress or reasoning.
	authority := m.Authority
	for _, item := range in.Evidence.Diagnostic {
		authority += "\n" + core.DiagnosticText(item) + "\n"
	}
	if nav := in.Intent.Plan; nav != "" {
		authority += "\nStaged plan context for this independent review." + nav + "\n"
	}
	stable := authority + "\n" + reviewTask
	dir := filepath.Join(in.Run.Dir, "executor-review")

	// The complete first prompt, source included, is measured before anything is sent: one that
	// fits is the review in one session, a larger one is reviewed in ordered parts.
	whole := reviewMeasure(x.exec, executor.Brief{Stable: stable, Dynamic: m.Source})
	if whole > reviewCeiling {
		return x.reviewInParts(ctx, v, role, pass, m, authority, whole, dir)
	}
	env.Progress(fmt.Sprintf("kogen: reviewing (review %d)", in.Number))
	ev, err := writeReviewMaterial(dir, in.Number, pass.Tree, stable, m.Source, m.Files)
	if err != nil {
		return Result{}, err
	}
	return x.session(ctx, v, role, ev, dir, reviewSend{
		brief: executor.Brief{Stable: stable, Dynamic: m.Source}, sessionDir: filepath.Join(dir, "session"), pass: pass, base: pass,
	})
}

// reviewSend is one session of the external review: what it is sent, where its artifacts go and
// the pass it reviews. part is the 1-based part of a review in parts, 0 for the review in one
// session; base is the green pass the whole review started from.
type reviewSend struct {
	brief        executor.Brief
	sessionDir   string
	part         int
	pass, base   verify.Pass
	repairRounds int
}

// reviewStop is the Build's stop for a review prompt that cannot be sent within the ceiling.
func reviewStop(detail string) *sys.Error {
	return sys.Fail("candidate", "context_budget_exceeded", "review: "+detail+"; nothing was sent", 1)
}

// reviewInParts reviews a source whose complete prompt does not fit one session: the exact
// source is cut into ordered parts, each with its own fresh session whose complete prompt fits.
// Mandatory material that leaves no room for source stops before anything is sent.
func (x External) reviewInParts(ctx context.Context, v *xreview, role project.Role, pass verify.Pass, m MaterialSet, authority string, whole int, dir string) (Result, error) {
	in, env := v.in, v.env
	stable := authority + "\n" + reviewPartsTask
	blocks, err := materialBlocks(in.Candidate, pass.Tree, m)
	if err != nil {
		return Result{}, err
	}
	catalog, err := json.Marshal(core.NonNil(m.Files))
	if err != nil {
		return Result{}, err
	}
	c := &reviewParter{
		source: m.PartsSource, sum: core.HashHex([]byte(m.PartsSource)), checks: m.Checks, catalog: string(catalog), blocks: blocks, ceiling: reviewCeiling,
		measure: func(dynamic string) int {
			return reviewMeasure(x.exec, executor.Brief{Stable: stable, Dynamic: dynamic})
		},
	}
	ev, err := writeReviewMaterial(dir, in.Number, pass.Tree, stable, m.PartsSource, m.Files)
	if err != nil {
		return Result{}, err
	}
	if !c.hasRoom() {
		return Result{}, sys.Fail("candidate", "context_budget_exceeded", fmt.Sprintf(
			"review: mandatory review prompt of executor %s is %d bytes without candidate source; fewer than %d bytes remain for source under the inclusive %d-byte ceiling; nothing was sent. "+
				"Inspect the run evidence; ordinary Refine and new exact approval are required if the Intent, README or diagnostic context must shrink.",
			x.desc.Name, c.mandatory(), MaterialPartBytes, reviewCeiling), 1)
	}
	cuts, err := c.cut()
	if err != nil {
		return Result{}, reviewStop("the source cannot be cut into parts that fit the inclusive " + strconv.Itoa(reviewCeiling) + "-byte ceiling: " + err.Error())
	}
	texts := c.texts(cuts)
	// Every part is written and its complete prompt measured before the first is sent.
	for i, text := range texts {
		prompt := reviewMeasure(x.exec, executor.Brief{Stable: stable, Dynamic: text})
		if prompt > reviewCeiling {
			return Result{}, reviewStop(fmt.Sprintf("the prompt of part %d of %d for executor %s is %d bytes, over the inclusive %d-byte ceiling", i+1, len(texts), x.desc.Name, prompt, reviewCeiling))
		}
		name := fmt.Sprintf("review-%d-part-%d.txt", in.Number, i+1)
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
			return Result{}, err
		}
		ev.ReviewParts = append(ev.ReviewParts, Part{
			Part: i + 1, File: name, Bytes: len(text), SHA256: core.HashHex([]byte(text)), From: cuts[i].From, To: cuts[i].To, PromptBytes: prompt,
		})
	}
	if err := ev.persist(dir); err != nil {
		return Result{}, err
	}
	n := len(texts)
	env.Event(map[string]any{"event": "review_parts", "review": in.Number, "parts": n, "source_bytes": len(m.PartsSource), "ceiling": reviewCeiling})
	noun := "parts"
	if n == 1 {
		noun = "part"
	}
	env.Progress(fmt.Sprintf("kogen: reviewing (review %d) in %d %s: the complete review prompt would be %d bytes, over the %d-byte ceiling", in.Number, n, noun, whole, reviewCeiling))

	current, repairs := pass, 0
	for k := 1; k <= n; k++ {
		env.Progress(fmt.Sprintf("kogen: reviewing (review %d, part %d of %d)", in.Number, k, n))
		approved, err := x.session(ctx, v, role, ev, dir, reviewSend{
			brief: executor.Brief{Stable: stable, Dynamic: texts[k-1]}, sessionDir: filepath.Join(dir, fmt.Sprintf("part-%d", k)),
			part: k, pass: current, base: pass, repairRounds: repairs,
		})
		repairs = approved.Repairs
		if err != nil {
			return approved, err
		}
		if k == n {
			return approved, nil
		}
		// An approval of an earlier part is not the review's: the next part reviews the pass it
		// bound (the green pass, or the verified pass of a repaired tree).
		pending := approved.Record
		pending.Verdict = "pending"
		if err := env.Reviewed(pending); err != nil {
			return Result{}, err
		}
		current = approved.Pass
	}
	return Result{}, nil
}

// session is one fresh session of the external review (the whole review, or one part): the
// external review loop of rounds, verdict validation, custody checks and evaluation.
func (x External) session(ctx context.Context, v *xreview, role project.Role, ev *Material, dir string, s reviewSend) (Result, error) {
	in, env := v.in, v.env
	if err := ev.check(dir, s.part); err != nil {
		return Result{}, err
	}
	if cur, err := candidateTree(in.Candidate); err != nil {
		return Result{}, err
	} else if cur != s.pass.Tree {
		when := "its green pass and before the review was sent"
		if s.part > 1 {
			when = fmt.Sprintf("the pass the approval of part %d bound and before part %d was sent", s.part-1, s.part)
		}
		return Result{}, custodyInvalid("the candidate changed after " + when + ": " + treeDrift(in.Candidate, cur, s.pass.Tree))
	}

	task := executor.Task{
		Role: executor.RoleReview, Root: in.Candidate.Root, Brief: s.brief,
		Protected: in.Candidate.Protected, Excluded: in.Candidate.Excluded, Model: role.Model, Effort: role.Effort,
		StartTree: in.Candidate.Start, RunID: in.Run.ID, Home: in.Tools.Home, MaxRounds: x.maxRounds,
		Schema: reviewSchema(), Dir: s.sessionDir,
	}
	if in.Intent.Approval != nil {
		task.Approval = core.HashHex(in.Intent.Approval)
	}
	if err := os.MkdirAll(task.Dir, 0o700); err != nil {
		return Result{}, err
	}
	sess, err := x.exec.Start(ctx, task, func(event map[string]any) { env.Event(event) })
	if err != nil {
		return Result{}, err
	}
	defer sess.Close()
	h := sess.Handle()
	// The reviewer session is never the builder's (in.Candidate.Builder, "" for the native one).
	if h.SessionID == "" || h.SessionID == in.Candidate.Builder {
		return Result{}, executor.Fail(executor.ReasonProtocol, "the reviewer session is not distinct from the builder's")
	}
	caps, _ := x.desc.For(executor.RoleReview)
	// A fresh review after one that ended without a verdict, and every part after the first, is
	// its own session; the usage of the earlier sessions stays in the Build's known totals.
	earlier := v.executor
	v.executor = &core.ExecutorState{
		Name: x.desc.Name, Version: h.Version, SessionID: h.SessionID,
		Usage: core.ExecutorUsage{Input: core.Count(0), Cached: core.Count(0), Output: core.Count(0), Reasoning: core.Count(0), State: executor.UsageComplete,
			Source: caps.Usage, CostUSD: new(float64)},
	}
	if earlier != nil {
		v.executor.Usage = earlier.Usage
	}
	v.executorChanged()
	ev.start(s.part, h.SessionID)
	if s.part > 0 {
		if err := ev.persist(dir); err != nil {
			return Result{}, err
		}
	}
	if err := env.Track(); err != nil {
		return Result{}, err
	}

	base := s.base
	r := &run{in: in, env: env, pass: s.pass, external: true, base: &base, sess: Session{Role: role, Usage: core.ZeroTokens(), Seen: s.pass.Tree, RepairRounds: s.repairRounds}}
	feedback, invalid := "", 0
	for round := 1; ; round++ {
		if round > x.maxRounds {
			return Result{}, executor.RoundLimit(x.maxRounds)
		}
		if err := ev.check(dir, s.part); err != nil {
			return Result{}, err
		}
		if err := r.save(route.StageReview); err != nil {
			return Result{}, err
		}
		if err := env.Facts("reviewing"); err != nil {
			return Result{}, err
		}
		res, err := in.Tools.Round(ctx, sess, executor.Input{Feedback: feedback})
		if err != nil {
			return Result{}, err
		}
		if res.Ending != executor.EndFinish && res.Ending != executor.EndNoCall {
			return Result{}, executor.Fail(executor.ReasonProtocol, "executor "+x.desc.Name+" returned the unknown round ending "+core.InspectString(string(res.Ending)))
		}
		v.executor.Rounds = round
		v.executor.Usage = v.executor.Usage.Plus(res.Usage, round == 1 && earlier == nil)
		if res.Handle.Version != "" {
			v.executor.Version = res.Handle.Version
		}
		v.executorChanged()
		event := map[string]any{
			"event": "executor_round", "role": executor.RoleReview, "review": in.Number, "round": round,
			"executor": x.desc.Name, "ending": string(res.Ending), "usage": res.Usage, "session_id": res.Handle.SessionID,
		}
		if s.part > 0 {
			event["part"] = s.part
		}
		env.Event(event)
		if res.Handle.SessionID == h.SessionID && res.Ending == executor.EndFinish && !ev.delivered(s.part) {
			ev.deliver(s.part, round)
			if err := ev.persist(dir); err != nil {
				return Result{}, err
			}
		}
		if err := env.Track(); err != nil {
			return Result{}, err
		}
		if res.Ending == executor.EndNoCall {
			err := r.invalidStop([]string{"the reviewer ended its round without a verdict"}, "executor_no_call", false)
			return Result{Invalid: r.invalid}, err
		}
		verdict, problems, err := x.verdictOf(r, res.Structured)
		if err != nil {
			return Result{}, err
		}
		if problems != nil {
			if invalid >= 1 {
				r.sess.Rejected = invalid
				err := r.invalidStop(problems, "rejected_verdict_exhausted", false)
				return Result{Invalid: r.invalid}, err
			}
			invalid++
			r.sess.Rejected = invalid
			r.allowance("rejected_verdict")
			// An external executor's structured verdict has no API-level tool choice to force: the
			// correction goes back as text only.
			env.Event(map[string]any{
				"event": "review_tool_choice", "review": in.Number, "tool": SubmitReviewTool, "mode": "text_fallback",
				"executor": x.desc.Name, "rejected_verdicts": r.sess.Rejected, "no_tool_reminders": r.sess.NoTool,
			})
			feedback = "Not a valid verdict: " + strings.Join(problems, "; ") + ". Submit a corrected structured verdict."
			continue
		}
		if verdict.Verdict == "approve" {
			// Before accepting an approval: the material it rests on was delivered completely in
			// a completed round of this session and its custody is unchanged.
			if !ev.delivered(s.part) || ev.session(s.part) != h.SessionID {
				return Result{}, custodyInvalid("the review material was not completely delivered in a completed round of the reviewer session")
			}
			if err := ev.check(dir, s.part); err != nil {
				return Result{}, err
			}
		}
		tree, err := candidateTree(in.Candidate)
		if err != nil {
			return Result{}, err
		}
		approved, again, err := r.evaluate(ctx, *verdict, tree)
		if err != nil || !again {
			return approved, err
		}
		feedback = lastUserContent(r.sess.Input)
		r.sess.Input = nil
		invalid = 0
	}
}

// verdictOf decodes the structured submission and validates it with the native verdict rules.
func (x External) verdictOf(r *run, raw json.RawMessage) (*Verdict, []string, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var args map[string]any
	if err := dec.Decode(&args); err != nil || args == nil {
		return nil, nil, executor.Fail(executor.ReasonProtocol, "the reviewer's structured output is not a JSON object")
	}
	return r.validate(args, nil)
}

func lastUserContent(input []any) string {
	if len(input) == 0 {
		return ""
	}
	m, _ := input[len(input)-1].(map[string]any)
	s, _ := m["content"].(string)
	return s
}

func custodyInvalid(detail string) *sys.Error {
	return sys.Fail("candidate", "context_custody_invalid", detail+"; nothing was committed and custody is preserved", 1)
}

// writeReviewMaterial retains the exact outgoing bytes privately (0700 folder, 0600 files) and
// their identity before anything is sent.
func writeReviewMaterial(dir string, review int, tree, authority, source string, files []map[string]any) (*Material, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return nil, err
	}
	write := func(name, text string) (fileEvidence, error) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
			return fileEvidence{}, err
		}
		return fileEvidence{File: name, Bytes: len(text), SHA256: core.HashHex([]byte(text))}, nil
	}
	a, err := write(fmt.Sprintf("review-%d-authority.txt", review), authority)
	if err != nil {
		return nil, err
	}
	s, err := write(fmt.Sprintf("review-%d-source.txt", review), source)
	if err != nil {
		return nil, err
	}
	ev := &Material{Review: review, Tree: tree, Authority: a, Source: s, Parts: core.NonNil(files)}
	return ev, ev.persist(dir)
}

func (e *Material) persist(dir string) error {
	b, err := json.MarshalIndent(e, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, fmt.Sprintf("review-%d-material.json", e.Review)), append(b, '\n'), 0o600)
}

// check re-reads the retained bytes of the authority, the source and, for a part, its file:
// missing, changed or unsafe custody stops safely.
func (e *Material) check(dir string, part int) error {
	files := []fileEvidence{e.Authority, e.Source}
	if part > 0 {
		p := e.ReviewParts[part-1]
		files = append(files, fileEvidence{File: p.File, Bytes: p.Bytes, SHA256: p.SHA256})
	}
	for _, f := range files {
		path := filepath.Join(dir, f.File)
		st, err := os.Lstat(path)
		if err != nil || !st.Mode().IsRegular() || st.Mode().Perm()&0o077 != 0 {
			return custodyInvalid("the retained review material " + f.File + " is missing or unsafe")
		}
		data, err := os.ReadFile(path)
		if err != nil || len(data) != f.Bytes || core.HashHex(data) != f.SHA256 {
			return custodyInvalid("the retained review material " + f.File + " changed")
		}
	}
	return nil
}

// start records the session a part (0: the review in one session) was started in.
func (e *Material) start(part int, id string) {
	e.Session = id
	if part > 0 {
		e.ReviewParts[part-1].SessionID = id
	}
}

func (e *Material) session(part int) string {
	if part > 0 {
		return e.ReviewParts[part-1].SessionID
	}
	return e.Session
}

func (e *Material) delivered(part int) bool {
	if part > 0 {
		return e.ReviewParts[part-1].Delivered
	}
	return e.Delivered
}

// deliver records that the material was delivered in a completed round of the session. The
// review's own flag is set when the review in one session delivered, or the last part did.
func (e *Material) deliver(part, round int) {
	if part == 0 {
		e.Delivered, e.Round = true, round
		return
	}
	e.ReviewParts[part-1].Delivered, e.ReviewParts[part-1].DeliveredRound = true, round
	if part == len(e.ReviewParts) {
		e.Delivered, e.Round = true, round
	}
}
