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
	Verdict  string           `json:"verdict"`
	Findings []map[string]any `json:"findings"`
	Tree     string           `json:"tree"`
	Repairs  int              `json:"repairs"`
	Run      string           `json:"run"`
	Error    *stop            `json:"error"`
	Invalid  *invalid         `json:"invalid"`
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
	var commands review.Commands
	if _, err := os.Stat(filepath.Join(abs, project.ConfigPath)); err == nil {
		cfg, err := project.LoadConfig(abs)
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
	e := &env{s: s, client: provider.NewClient("kogen-review"), dir: dir}
	in := review.Input{
		Candidate: review.Candidate{Root: abs, Repo: repo, Start: commit, Tree: tree},
		Intent: review.Intent{Slug: *slug, Text: string(text), Approval: text,
			Role: project.Role{Provider: *prov, Model: *model, Effort: *effort, BaseURL: *baseURL}},
		Evidence: review.Evidence{Pass: verify.Pass{N: 1, Clean: true, Green: true, Tree: tree}, Commands: commands},
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
	if err == nil {
		out.Verdict, out.Tree = res.Record.Verdict, res.Record.Tree
		out.Findings = core.NonNil(res.Record.Findings)
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
func (e *env) BaselineIntact() error               { return nil }
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
