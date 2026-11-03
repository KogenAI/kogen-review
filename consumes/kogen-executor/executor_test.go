package consumes

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
)

// fakeSession is an executor session that answers scripted rounds.
type fakeSession struct {
	handle executor.Handle
	inputs []executor.Input
	rounds []executor.RoundResult
	closed int
}

func (s *fakeSession) Round(_ context.Context, in executor.Input) (executor.RoundResult, error) {
	s.inputs = append(s.inputs, in)
	if len(s.inputs) > len(s.rounds) {
		return executor.RoundResult{}, errors.New("no scripted round")
	}
	return s.rounds[len(s.inputs)-1], nil
}
func (s *fakeSession) Handle() executor.Handle { return s.handle }
func (s *fakeSession) Close() error            { s.closed++; return nil }

// fakeExecutor starts the one session it is given and keeps the task and sink it was started with.
type fakeExecutor struct {
	desc    executor.Descriptor
	session *fakeSession
	task    executor.Task
	sink    executor.Sink
}

func (f *fakeExecutor) Describe() executor.Descriptor { return f.desc }
func (f *fakeExecutor) Start(_ context.Context, t executor.Task, emit executor.Sink) (executor.Session, error) {
	f.task, f.sink = t, emit
	return f.session, nil
}

// sizedExecutor is an Executor that also reports the size of its first prompt.
type sizedExecutor struct {
	fakeExecutor
	role  string
	brief executor.Brief
}

func (s *sizedExecutor) FirstPromptBytes(role string, brief executor.Brief) int {
	s.role, s.brief = role, brief
	return 1000 + len(brief.Stable)
}

func TestExecutorStartRoundAndClose(t *testing.T) {
	sess := &fakeSession{
		handle: executor.Handle{Executor: "fake", Version: "1.0", SessionID: "sess-1", Resume: executor.ResumeNone},
		rounds: []executor.RoundResult{
			{Ending: executor.EndNoCall, Claim: "no submit"},
			{Ending: executor.EndFinish, Structured: json.RawMessage(`{"verdict":"approve","findings":[]}`),
				Usage:  executor.Usage{Input: core.Count(5), State: executor.UsageComplete, Source: executor.UsageHarness},
				Handle: executor.Handle{Version: "1.1", SessionID: "sess-1"}},
		},
	}
	fake := &fakeExecutor{session: sess}
	var ex executor.Executor = fake

	task := executor.Task{
		Role: executor.RoleReview, Root: t.TempDir(),
		Brief:     executor.Brief{Stable: "authority", Dynamic: "source"},
		Protected: []string{"a.txt"}, Excluded: []string{"b.txt"},
		Model: "m", Effort: "high", Approval: core.HashHex([]byte("approved")), StartTree: "tree0", RunID: "run1",
		MaxRounds: 6, Schema: json.RawMessage(`{"type":"object"}`), Home: t.TempDir(), Dir: t.TempDir(),
	}
	var events []map[string]any
	s, err := ex.Start(context.Background(), task, func(e map[string]any) { events = append(events, e) })
	eq(t, "executor.Executor.Start", err, nil)
	// Every task field reaches the executor as set.
	eq(t, "executor.Task", fake.task, task)
	eq(t, "executor.Task.Role", fake.task.Role, "review")
	eq(t, "executor.Task.Root", fake.task.Root, task.Root)
	eq(t, "executor.Task.Brief", fake.task.Brief, executor.Brief{Stable: "authority", Dynamic: "source"})
	eq(t, "executor.Brief.Stable", fake.task.Brief.Stable, "authority")
	eq(t, "executor.Brief.Dynamic", fake.task.Brief.Dynamic, "source")
	eq(t, "executor.Task.Protected", fake.task.Protected, []string{"a.txt"})
	eq(t, "executor.Task.Excluded", fake.task.Excluded, []string{"b.txt"})
	eq(t, "executor.Task.Model", fake.task.Model, "m")
	eq(t, "executor.Task.Effort", fake.task.Effort, "high")
	eq(t, "executor.Task.Approval", fake.task.Approval, core.HashHex([]byte("approved")))
	eq(t, "executor.Task.StartTree", fake.task.StartTree, "tree0")
	eq(t, "executor.Task.RunID", fake.task.RunID, "run1")
	eq(t, "executor.Task.MaxRounds", fake.task.MaxRounds, 6)
	eq(t, "executor.Task.Schema", string(fake.task.Schema), `{"type":"object"}`)
	eq(t, "executor.Task.Home", fake.task.Home, task.Home)
	eq(t, "executor.Task.Dir", fake.task.Dir, task.Dir)

	// The sink the task is started with receives run-log events (maps).
	fake.sink(map[string]any{"event": "executor_round"})
	eq(t, "executor.Executor.Start sink", events, []map[string]any{{"event": "executor_round"}})

	h := s.Handle()
	eq(t, "executor.Session.Handle", h, sess.handle)
	eq(t, "executor.Handle.SessionID", h.SessionID, "sess-1")
	eq(t, "executor.Handle.Version", h.Version, "1.0")

	first, err := s.Round(context.Background(), executor.Input{})
	eq(t, "executor.Session.Round", err, nil)
	eq(t, "executor.RoundResult.Ending", first.Ending, executor.EndNoCall)
	eq(t, "executor.Input.Feedback", sess.inputs[0].Feedback, "")
	second, err := s.Round(context.Background(), executor.Input{Feedback: "submit_review is missing"})
	eq(t, "executor.Session.Round", err, nil)
	eq(t, "executor.Input.Feedback", sess.inputs[1].Feedback, "submit_review is missing")
	eq(t, "executor.RoundResult.Ending", second.Ending, executor.EndFinish)
	eq(t, "executor.RoundResult.Structured", string(second.Structured), `{"verdict":"approve","findings":[]}`)
	eq(t, "executor.RoundResult.Usage", second.Usage, executor.Usage{Input: core.Count(5), State: "complete", Source: "harness"})
	eq(t, "executor.RoundResult.Handle", second.Handle, executor.Handle{Version: "1.1", SessionID: "sess-1"})
	eq(t, "executor.RoundResult.Handle", second.Handle.Version, "1.1")

	// kogen-review ends the session on every return: Close is called once through the interface.
	eq(t, "executor.Session.Close", s.Close(), nil)
	eq(t, "executor.Session.Close", sess.closed, 1)
	// The method expressions name the same methods.
	_, err = executor.Session.Round(s, context.Background(), executor.Input{})
	eq(t, "executor.Session.Round", err != nil, true) // the scripted rounds are used up
	eq(t, "executor.Session.Handle", executor.Session.Handle(s), sess.handle)
	eq(t, "executor.Session.Close", executor.Session.Close(s), nil)
	_, err = executor.Executor.Start(ex, context.Background(), task, nil)
	eq(t, "executor.Executor.Start", err, nil)
}

func TestExecutorPromptSizer(t *testing.T) {
	brief := executor.Brief{Stable: "abc", Dynamic: "defgh"}
	// An executor that reports its prompt size is asked through PromptSizer for the review role.
	sized := &sizedExecutor{}
	var ex executor.Executor = sized
	p, ok := ex.(executor.PromptSizer)
	eq(t, "executor.PromptSizer", ok, true)
	eq(t, "executor.PromptSizer.FirstPromptBytes", p.FirstPromptBytes(executor.RoleReview, brief), 1003)
	eq(t, "executor.PromptSizer.FirstPromptBytes", sized.role, "review")
	eq(t, "executor.PromptSizer.FirstPromptBytes", sized.brief, brief)
	eq(t, "executor.PromptSizer.FirstPromptBytes", executor.PromptSizer.FirstPromptBytes(p, "review", brief), 1003)
	// One that does not is measured by len(Stable)+len(Dynamic) by kogen-review.
	ex = &fakeExecutor{}
	_, ok = ex.(executor.PromptSizer)
	eq(t, "executor.PromptSizer", ok, false)
}

func TestDescriptorForAndName(t *testing.T) {
	d := executor.Descriptor{
		Name: "fake", Contract: "kogen.executor/v2", Version: "1.0",
		Capabilities: executor.Capabilities{Roles: []string{"build"}, Usage: "provider", MaxRounds: 4},
		RoleCapabilities: map[string]executor.RoleCapabilities{
			executor.RoleReview: {Resume: executor.ResumeNone, Usage: executor.UsageHarness, Structured: true, MaxRounds: 3},
		},
	}
	eq(t, "executor.Descriptor.Name", d.Name, "fake")
	caps, ok := d.For(executor.RoleReview)
	eq(t, "executor.Descriptor.For", ok, true)
	eq(t, "executor.RoleCapabilities.Usage", caps.Usage, "harness")
	// A role the descriptor does not list is not served: the zero capabilities, false.
	caps, ok = d.For("shape")
	eq(t, "executor.Descriptor.For", ok, false)
	eq(t, "executor.Descriptor.For", caps, executor.RoleCapabilities{})
	// kogen-review ignores ok: the zero capabilities have the empty usage source.
	eq(t, "executor.RoleCapabilities.Usage", caps.Usage, "")
	// Without a review entry the aggregate capabilities only serve the build role.
	d.RoleCapabilities = nil
	_, ok = d.For(executor.RoleReview)
	eq(t, "executor.Descriptor.For", ok, false)
	caps, ok = d.For("build")
	eq(t, "executor.Descriptor.For", ok, true)
	eq(t, "executor.RoleCapabilities.Usage", caps.Usage, "provider")
}

func TestExecutorConstants(t *testing.T) {
	eq(t, "executor.RoleReview", executor.RoleReview, "review")
	eq(t, "executor.EndFinish", string(executor.EndFinish), "finish")
	eq(t, "executor.EndNoCall", string(executor.EndNoCall), "no_call")
	eq(t, "executor.ReasonProtocol", executor.ReasonProtocol, "protocol")
	eq(t, "executor.UsageComplete", executor.UsageComplete, "complete")
}

func TestExecutorStops(t *testing.T) {
	stop(t, "executor.Fail", executor.Fail(executor.ReasonProtocol, "the reviewer session is not distinct from the builder's"),
		"executor", "protocol", "the reviewer session is not distinct from the builder's", 1)
	eq(t, "executor.Fail text", executor.Fail(executor.ReasonProtocol, "d").Error(), "executor/protocol: d")
	stop(t, "executor.RoundLimit", executor.RoundLimit(6), "candidate", "executor_round_limit",
		"the executor used its 6 rounds without a verified, reviewed candidate; the candidate is left in place", 1)
	stop(t, "core.ResumeRefused", core.ResumeRefused("the saved review state has no verdict"),
		"candidate", "resume_refused", "the saved review state has no verdict", 1)
	eq(t, "core.ResumeRefused text", core.ResumeRefused("d").Error(), "candidate/resume_refused: d")
}

// The JSON keys of the executor values a checkpoint, a run record and an executor's own
// protocol carry, as kogen-review sets them.
func TestExecutorValueJSONKeys(t *testing.T) {
	keys := func(v any) map[string]any {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		var m map[string]any
		if err := json.Unmarshal(b, &m); err != nil {
			t.Fatal(err)
		}
		return m
	}
	has := func(item string, m map[string]any, want ...string) {
		t.Helper()
		for _, k := range want {
			if _, ok := m[k]; !ok {
				t.Errorf("%s: no key %q in %v", item, k, m)
			}
		}
	}
	has("executor.Task", keys(executor.Task{}), "role", "root", "brief", "protected", "excluded", "model", "effort", "approval", "start_tree", "run_id", "max_rounds", "home", "dir")
	has("executor.Task.Schema", keys(executor.Task{Schema: json.RawMessage(`{}`)}), "schema")
	has("executor.Brief", keys(executor.Brief{}), "stable", "dynamic")
	has("executor.Input", keys(executor.Input{}), "feedback")
	has("executor.RoundResult", keys(executor.RoundResult{Structured: json.RawMessage(`{}`)}), "ending", "structured", "usage", "handle")
	has("executor.Handle", keys(executor.Handle{}), "session_id", "version")
}
