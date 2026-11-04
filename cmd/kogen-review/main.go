// Command kogen-review runs this repository's review phase on its own, without Kogen: the native
// reviewer (review.Independent) reviews the candidate in a Git checkout against the approved
// Intent of that checkout, and the command prints the result as one JSON line on stdout with an
// exit code.
//
//	kogen-review -start REV -slug SLUG -model NAME [-root DIR] [-provider NAME] [-effort LEVEL] [-base-url URL]
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"slices"

	"github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
	"github.com/KogenAI/kogen-review/review"
	"github.com/KogenAI/kogen-verification/verify"
	"kogen-loop/provider"
	"kogen-loop/sys"
	"kogen-loop/tools"
)

const usage = "usage: kogen-review -start REV -slug SLUG -model NAME [-root DIR] [-provider NAME] [-effort LEVEL] [-base-url URL]"

func main() {
	sys.MaybeSupervise(os.Args[1:])
	sys.EnableSupervisor()
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// result is the line the command prints on stdout.
type result struct {
	Verdict   string           `json:"verdict"`
	Findings  []map[string]any `json:"findings"`
	Tree      string           `json:"tree"`
	Repairs   int              `json:"repairs"`
	Run       string           `json:"run"`
	Error     *stop            `json:"error"`
	Invalid   *invalid         `json:"invalid"`
	Submitted *submitted       `json:"submitted"`
}

type submitted struct {
	Verdict  string           `json:"verdict"`
	Findings []map[string]any `json:"findings"`
	Tree     string           `json:"tree"`
}

type stop struct {
	Class  string   `json:"class"`
	Reason string   `json:"reason"`
	Detail string   `json:"detail"`
	Lines  []string `json:"lines"`
}

type invalid struct {
	Reason   string   `json:"reason"`
	Problems []string `json:"problems"`
}

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("kogen-review", flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.Usage = func() { fmt.Fprintln(stderr, usage) }
	root := flags.String("root", ".", "the checkout holding the candidate")
	start := flags.String("start", "", "the commit the candidate was built on")
	slug := flags.String("slug", "", "the approved Intent's slug")
	prov := flags.String("provider", "chatgpt", "the reviewer's provider")
	model := flags.String("model", "", "the reviewer's model")
	effort := flags.String("effort", "medium", "the reviewer's reasoning effort")
	baseURL := flags.String("base-url", "", "the base URL of an openai-compatible provider")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() != 0 || *start == "" || *slug == "" || *model == "" {
		fmt.Fprintln(stderr, usage)
		return 2
	}
	refuse := func(err error) int {
		fmt.Fprintln(stderr, "kogen-review: "+err.Error())
		return 2
	}
	abs, err := filepath.Abs(*root)
	if err != nil {
		return refuse(err)
	}
	text, err := os.ReadFile(filepath.Join(abs, project.IntentDir(*slug), "intent.md"))
	if err != nil {
		return refuse(err)
	}
	if _, err := os.ReadFile(filepath.Join(abs, project.FeaturePath(*slug))); err != nil {
		return refuse(err)
	}
	cfg := &project.Config{}
	var commands review.Commands
	if _, err := os.Stat(filepath.Join(abs, project.ConfigPath)); err == nil {
		cfg, err = project.LoadConfig(abs)
		if err != nil {
			return refuse(err)
		}
		commands = review.Commands{Fix: cfg.Fix, Checks: cfg.Checks}
		if cfg.Acceptance != nil {
			commands.Acceptance = cfg.Acceptance.Run
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return refuse(err)
	}
	repo := git.New(abs, nil)
	commit, err := repo.Resolve(*start + "^{commit}")
	if err != nil {
		return refuse(fmt.Errorf("-start %s is not a commit of %s", *start, abs))
	}
	intent, err := project.LoadIntent(abs, *slug)
	if err != nil {
		return refuse(err)
	}
	feature, err := os.ReadFile(filepath.Join(abs, project.FeaturePath(*slug)))
	if err != nil {
		return refuse(err)
	}
	expected, err := project.ParseGherkin(string(feature))
	if err != nil {
		return refuse(err)
	}
	paths, err := project.Baseline(abs, *slug, cfg)
	if err != nil {
		return refuse(err)
	}
	hash := project.Hash(abs, paths)
	intact := func() error {
		current, err := project.Baseline(abs, *slug, cfg)
		if err != nil {
			return err
		}
		if !slices.Equal(paths, current) || project.Hash(abs, current) != hash {
			return fmt.Errorf("approved baseline changed")
		}
		return nil
	}
	tree, err := repo.Tree(commit, nil)
	if err != nil {
		return refuse(err)
	}
	dir, err := os.MkdirTemp("", "kogen-review-run-")
	if err != nil {
		return refuse(err)
	}
	s := sys.New()
	s.Stdout = stderr
	stopSignals := s.WatchSignals()
	defer stopSignals()
	e := &env{s: s, client: provider.NewClient("kogen-review"), dir: dir, intact: intact}
	log := &verificationLog{}
	var pass verify.Pass
	var verifyErr error
	empty := len(cfg.Checks) == 0 && len(expected) == 0 && (intent.Model == nil || intent.Model.None) && cfg.Acceptance == nil
	if empty && len(cfg.Setup) == 0 {
		pass = verify.Pass{N: 1, Tree: tree, Model: verify.ModelNone}
	} else {
		pass, verifyErr = verify.Verify(s.Context(), s, verify.Input{Root: abs, Repo: repo, Config: cfg, Intent: intent, Start: commit, N: 1, RunDir: dir, Tools: verify.Tools{Node: os.Getenv("KOGEN_NODE"), Quint: os.Getenv("KOGEN_QUINT"), Cucumber: os.Getenv("KOGEN_CUCUMBER")}, Log: log})
	}
	if verifyErr != nil {
		pass = log.partial(tree, cfg, intent)
	}
	if verifyErr == nil {
		verifyErr = intact()
	}
	current, treeErr := repo.Tree(commit, nil)
	if verifyErr == nil && treeErr != nil {
		verifyErr = treeErr
	}
	if pass.Tree == "" {
		pass.Tree = tree
	}
	if verifyErr == nil && (pass.Tree != tree || current != tree) {
		verifyErr = fmt.Errorf("candidate tree changed during verification")
	}
	state := "failed"
	if verifyErr != nil {
		state = "unavailable"
	} else if empty && len(cfg.Setup) == len(pass.Setup) && (len(pass.Failing) == 0 || (len(pass.Failing) == 1 && pass.Failing[0] == "acceptance")) {
		state = "no_checks"
	} else if pass.Complete(cfg, expected, intent.Model) {
		if len(cfg.Checks) == 0 && len(expected) == 0 && (intent.Model == nil || intent.Model.None) {
			state = "no_checks"
		} else {
			state = "passed"
		}
	} else {
		for _, c := range append(slices.Clone(pass.Setup), pass.Checks...) {
			if c.Status == 127 {
				state = "unavailable"
			}
		}
		if pass.Acceptance != nil && pass.Acceptance.Status == 127 {
			state = "unavailable"
		}
		for _, event := range log.events {
			if event["event"] == "command_result" && event["status"] == 127 {
				state = "unavailable"
			}
		}
	}
	if state != "passed" {
		pass.Green = false
	}
	record := map[string]any{"state": state, "pass": pass, "events": log.events}
	if verifyErr != nil {
		record["error"] = verifyErr.Error()
	}
	if err := e.Write("initial-verification.json", record); err != nil {
		verifyErr = err
		state = "unavailable"
	}
	if state != "passed" {
		detail := pass.Feedback(commands.Acceptance, "")
		if verifyErr != nil {
			detail += "\n" + verifyErr.Error()
		}
		detail = "initial verification " + state + ": " + detail
		out, code := report(review.Result{}, sys.Fail("verification", state, detail, 1))
		out.Run = dir
		out.Tree = pass.Tree
		line, _ := json.Marshal(out)
		fmt.Fprintf(stdout, "%s\n", line)
		return code
	}
	tree = pass.Tree
	in := review.Input{
		Candidate: review.Candidate{Root: abs, Repo: repo, Start: commit, Tree: tree},
		Intent: review.Intent{Slug: *slug, Text: string(text), Approval: text,
			Role: project.Role{Provider: *prov, Model: *model, Effort: *effort, BaseURL: *baseURL}},
		Evidence: review.Evidence{Pass: pass, Commands: commands},
		Tools: review.Tools{
			Native: func(enabled []string) *tools.Tools { return &tools.Tools{Root: abs, Session: s, Enabled: enabled} },
			Record: func(tools.Call, tools.Output) map[string]any { return nil },
			Round: func(ctx context.Context, sess executor.Session, in executor.Input) (executor.RoundResult, error) {
				return sess.Round(ctx, in)
			},
			Home: s.Getenv("HOME"),
		},
		Number: 1,
		Run:    review.Run{ID: "kogen-review", Dir: dir},
	}
	res, err := review.Independent{}.Review(s.Context(), in, e)
	out, code := report(res, err)
	out.Run = dir
	line, _ := json.Marshal(out)
	fmt.Fprintf(stdout, "%s\n", line)
	return code
}

// report is the result of a review and the command's exit code.
func report(res review.Result, err error) (result, int) {
	out := result{Verdict: "error", Findings: []map[string]any{}, Repairs: res.Repairs}
	if res.Record.Verdict != "" {
		out.Tree = res.Record.Tree
		out.Findings = core.NonNil(res.Record.Findings)
		out.Submitted = &submitted{Verdict: res.Record.Verdict, Findings: out.Findings, Tree: out.Tree}
	}
	if err == nil {
		out.Verdict = res.Record.Verdict
		return out, 0
	}
	se, ok := sys.AsError(err)
	if !ok {
		se = sys.Fail("kogen-review", "failed", err.Error(), 1)
	}
	out.Error = &stop{Class: se.Class, Reason: se.Reason, Detail: se.Detail, Lines: core.NonNil(se.Lines)}
	switch {
	case se.Class == "candidate" && se.Reason == "review_blocked":
		out.Verdict, out.Tree = "changes", res.Record.Tree
		out.Findings = core.NonNil(res.Record.Findings)
	case se.Class == "candidate" && se.Reason == "review_invalid" && res.Invalid != nil:
		out.Verdict = "invalid"
		out.Invalid = &invalid{Reason: res.Invalid.Reason, Problems: core.NonNil(res.Invalid.Problems)}
	}
	if se.Exit == 0 {
		return out, 1
	}
	return out, se.Exit
}

// env is the review's Env over a Git checkout, without any Build.
type env struct {
	s      *sys.Session
	client *provider.Client
	dir    string
	intact func() error
}

// Prepare opens the conversation with the material the review made: its authority, the
// diagnostic messages and its source.
func (e *env) Prepare(tree string, m review.MaterialSet, role project.Role, instructions string, defs, diagnostic []any) ([]any, error) {
	input := []any{map[string]any{"role": "user", "content": m.Authority}}
	input = append(input, diagnostic...)
	return append(input, map[string]any{"role": "user", "content": m.Source}), nil
}

func (e *env) Unread([]any) ([]string, error) { return nil, nil }
func (e *env) Delivered([]any) error          { return nil }
func (e *env) Custody() error                 { return nil }
func (e *env) Prefill(_ project.Role, _ string, _, input []any) ([]any, error) {
	return input, nil
}

func (e *env) Request(ctx context.Context, r review.Request) (*provider.Response, []any, error) {
	resp, err := e.client.Respond(ctx, e.s, provider.Request{
		Role: core.ProviderRole(r.Role), Instructions: r.Instructions, Input: r.Input, Tools: r.Tools, ToolChoice: r.ForceTool,
	}, nil)
	return resp, r.Input, err
}

// Verify refuses: the command verifies no repairs.
func (e *env) Verify(context.Context) (verify.Pass, error) {
	return verify.Pass{}, sys.Fail("review", "repair_unverified",
		"kogen-review verifies no repairs: the reviewer changed the candidate; its edits are left in place", 1)
}

func (e *env) Feedback(verify.Pass, string) string { return "" }
func (e *env) BaselineIntact() error               { return e.intact() }
func (e *env) Comparison() []string                { return nil }
func (e *env) Save(review.Checkpoint) error        { return nil }
func (e *env) Boundary([]any, *review.Done) error  { return nil }
func (e *env) Reviewed(core.ReviewRecord) error    { return nil }
func (e *env) Repaired() error                     { return nil }
func (e *env) Executor(*core.ExecutorState)        {}
func (e *env) Track() error                        { return nil }
func (e *env) Facts(string) error                  { return nil }
func (e *env) Progress(line string)                { e.s.Progress(line) }
func (e *env) Event(map[string]any)                {}
func (e *env) Err() error                          { return e.s.Err() }

func (e *env) Write(name string, data any) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(e.dir, name), b, 0o600)
}

var _ review.Env = (*env)(nil)

// verificationLog retains producer events even when verification cannot return a pass.
type verificationLog struct{ events []map[string]any }

func (l *verificationLog) Log(e map[string]any) { l.events = append(l.events, e) }

// partial preserves completed commands when the producer returns an infrastructure error.
func (l *verificationLog) partial(tree string, cfg *project.Config, intent *project.Intent) verify.Pass {
	p := verify.Pass{N: 1, Tree: tree, Model: verify.ModelNotRun, Setup: []verify.CommandResult{}, Checks: []verify.CommandResult{}, NotRun: []string{}}
	if intent.Model == nil || intent.Model.None {
		p.Model = verify.ModelNone
	}
	completed := map[string]verify.CommandResult{}
	commands := map[string]string{}
	for _, e := range l.events {
		name, _ := e["name"].(string)
		if e["event"] == "command" {
			commands[name], _ = e["command"].(string)
		}
		if e["event"] == "command_result" {
			status, ok := e["status"].(int)
			if ok {
				output, _ := e["output"].(string)
				completed[name] = verify.CommandResult{Name: name, Command: commands[name], Status: status, Output: output}
			}
		}
	}
	for i := range cfg.Setup {
		name := fmt.Sprintf("setup-%d", i+1)
		if c, ok := completed[name]; ok {
			p.Setup = append(p.Setup, c)
		} else {
			p.NotRun = append(p.NotRun, name)
		}
	}
	if _, ok := completed["acceptance"]; !ok {
		p.NotRun = append(p.NotRun, "acceptance")
	}
	if intent.Model != nil && !intent.Model.None {
		if _, ok := completed["model"]; !ok {
			p.NotRun = append(p.NotRun, "model")
		}
	}
	for _, check := range cfg.Checks {
		if c, ok := completed[check.Name]; ok {
			p.Checks = append(p.Checks, c)
		} else {
			p.NotRun = append(p.NotRun, check.Name)
		}
	}
	return p
}
