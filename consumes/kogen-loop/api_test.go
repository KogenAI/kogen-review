package consumes

import (
	"context"
	"io"

	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-loop/sys"
	"github.com/KogenAI/kogen-loop/tools"
)

// The exported API kogen-review uses of kogen-loop, pinned at compile time: a change of a
// signature, a type or a field fails to compile here (item names are the inventory's).
var (
	// provider: kogen-review/cmd/kogen-review/main.go builds the client and sends requests;
	// review/independent.go asks about forced tool calls and fingerprints tool evidence.
	_ func(string) *provider.Client                                                                                          = provider.NewClient
	_ func(*provider.Client, context.Context, *sys.Session, provider.Request, provider.Observer) (*provider.Response, error) = (*provider.Client).Respond
	_ func(any) *provider.Digest                                                                                             = provider.Fingerprint
	_ func(provider.Role) string                                                                                             = provider.Name
	_ func(provider.Role) bool                                                                                               = provider.SupportsToolChoice

	// provider.Request fields kogen-review sets.
	_ = func(r provider.Request) (provider.Role, string, []any, []any, string) {
		return r.Role, r.Instructions, r.Input, r.Tools, r.ToolChoice
	}
	// provider.Response field kogen-review reads.
	_ = func(r provider.Response) []map[string]any { return r.Items }
	_ provider.Client
	_ provider.Request
	_ provider.Response

	// sys: stops, the session and the supervisor hooks.
	_ func(error) (*sys.Error, bool)               = sys.AsError
	_ func()                                       = sys.EnableSupervisor
	_ func(string, string, string, int) *sys.Error = sys.Fail
	_ func([]string)                               = sys.MaybeSupervise
	_ func() *sys.Session                          = sys.New
	_ sys.Error
	_ sys.Session

	// sys.Error fields kogen-review reads.
	_ = func(e sys.Error) (string, string, string, []string, int) {
		return e.Class, e.Detail, e.Reason, e.Lines, e.Exit
	}
	// sys.Session: its methods and the Stdout field kogen-review sets.
	_ func(*sys.Session) context.Context = (*sys.Session).Context
	_ func(*sys.Session) error           = (*sys.Session).Err
	_ func(*sys.Session, string) string  = (*sys.Session).Getenv
	_ func(*sys.Session, string)         = (*sys.Session).Progress
	_ func(*sys.Session) (stop func())   = (*sys.Session).WatchSignals
	_ func(s *sys.Session, w io.Writer)  = func(s *sys.Session, w io.Writer) { s.Stdout = w }
	_ func(s *sys.Session) io.Writer     = func(s *sys.Session) io.Writer { return s.Stdout }

	// tools: the conversation helpers, the shared bounds and the tool runner.
	_ tools.Call
	_                                                       = func(c tools.Call) (map[string]any, string, string) { return c.Item, c.Name, c.Arguments }
	_ func(tools.Call) map[string]any                       = tools.Call.Args
	_ func(tools.Call, any) map[string]any                  = tools.Call.Output
	_ func([]map[string]any) []tools.Call                   = tools.Calls
	_ func(string) string                                   = tools.Cut
	_ func(string) map[string]any                           = tools.DecodeArguments
	_ func(string) (map[string]any, bool)                   = tools.Definition
	_ func(tools.Call, tools.Output, string) map[string]any = tools.ReadEvent
	_ func([]map[string]any) []any                          = tools.Replay
	_ tools.Output
	_ func(tools.Output) tools.Output = tools.Output.Cut
	_ func(tools.Output) any          = tools.Output.Value
	_ tools.Tools
	_ func(*tools.Tools, tools.Call) (tools.Output, error) = (*tools.Tools).Call
	// tools.Tools fields kogen-review sets (cmd/kogen-review/main.go builds Tools{Root, Session,
	// Enabled}).
	_ = func(t tools.Tools) (string, *sys.Session, []string) { return t.Root, t.Session, t.Enabled }
)

// tools.InputBudgetBytes is an integer constant (review/parts.go: the review ceiling).
const _ int = tools.InputBudgetBytes
