'use strict';
// Known-good fixtures of the k-consumes-review observer controls (k-consumes-review__control.js):
// for each consumes suite, a test file that only references every use of kogen-review's code at
// HEAD (no test), and the uses its README inventory lists. Data only: no step definition.
const refs = {
  'kogen-coordinator': String.raw`package consumes

import (
	"github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-coordinator/route"
)

var _ = git.New
var _ *git.Repo
var _ = (*git.Repo).Changed
var _ = (*git.Repo).Diff
var _ = (*git.Repo).OK
var _ = (*git.Repo).Resolve
var _ = (*git.Repo).Show
var _ = (*git.Repo).Tree
var _ = (*git.Repo).TreeEntries
var _ *git.TreeEntry
var _ = func(v *git.TreeEntry) any { return v.Mode }
var _ = func(v *git.TreeEntry) any { return v.Object }
var _ = func(v *git.TreeEntry) any { return v.Path }
var _ = func(v *project.Acceptance) any { return v.Run }
var _ *project.Check
var _ = func(v *project.Check) any { return v.Name }
var _ = func(v *project.Check) any { return v.Run }
var _ = func(v *project.Config) any { return v.Acceptance }
var _ = func(v *project.Config) any { return v.Checks }
var _ = func(v *project.Config) any { return v.Fix }
var _ = project.ConfigPath
var _ = project.FeaturePath
var _ = project.IntentDir
var _ = project.LoadConfig
var _ = project.ModelPath
var _ *project.Role
var _ = func(v *project.Role) any { return v.BaseURL }
var _ = func(v *project.Role) any { return v.Effort }
var _ = func(v *project.Role) any { return v.Model }
var _ = func(v *project.Role) any { return v.Provider }
var _ = project.SourceMessage
var _ *project.SourceRef
var _ = project.ValidateSource
var _ = route.StageReview
var _ = route.StageReviewRetry
var _ = route.StageReviewVerify
`,
  'kogen-executor': String.raw`package consumes

import (
	"github.com/KogenAI/kogen-executor/agent"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
)

var _ = agent.AsAny
var _ = agent.Prompt
var _ = agent.TestingRules
var _ = core.Count
var _ = core.DiagnosticText
var _ = core.Display
var _ = core.EncodeJSON
var _ *core.ExecutorState
var _ = func(v *core.ExecutorState) any { return v.Name }
var _ = func(v *core.ExecutorState) any { return v.Rounds }
var _ = func(v *core.ExecutorState) any { return v.SessionID }
var _ = func(v *core.ExecutorState) any { return v.Usage }
var _ = func(v *core.ExecutorState) any { return v.Version }
var _ *core.ExecutorUsage
var _ = func(v *core.ExecutorUsage) any { return v.Cached }
var _ = func(v *core.ExecutorUsage) any { return v.CostUSD }
var _ = func(v *core.ExecutorUsage) any { return v.Input }
var _ = func(v *core.ExecutorUsage) any { return v.Output }
var _ = (*core.ExecutorUsage).Plus
var _ = func(v *core.ExecutorUsage) any { return v.Reasoning }
var _ = func(v *core.ExecutorUsage) any { return v.Source }
var _ = func(v *core.ExecutorUsage) any { return v.State }
var _ = core.HashHex
var _ = core.InspectString
var _ = core.NonNil[int]
var _ = core.ProviderRole
var _ = core.ResponseTokens
var _ = core.ResumeRefused
var _ *core.ReviewRecord
var _ = func(v *core.ReviewRecord) any { return v.Findings }
var _ = func(v *core.ReviewRecord) any { return v.N }
var _ = func(v *core.ReviewRecord) any { return v.Tree }
var _ = func(v *core.ReviewRecord) any { return v.Verdict }
var _ = core.ShellDefinitions
var _ *core.Tokens
var _ = (*core.Tokens).Plus
var _ = core.ZeroTokens
var _ *executor.Brief
var _ = func(v *executor.Brief) any { return v.Dynamic }
var _ = func(v *executor.Brief) any { return v.Stable }
var _ *executor.Descriptor
var _ = (*executor.Descriptor).For
var _ = func(v *executor.Descriptor) any { return v.Name }
var _ = executor.EndFinish
var _ = executor.EndNoCall
var _ *executor.Executor
var _ = executor.Executor.Start
var _ = executor.Fail
var _ = func(v *executor.Handle) any { return v.SessionID }
var _ = func(v *executor.Handle) any { return v.Version }
var _ *executor.Input
var _ = func(v *executor.Input) any { return v.Feedback }
var _ *executor.PromptSizer
var _ = executor.PromptSizer.FirstPromptBytes
var _ = executor.ReasonProtocol
var _ = func(v *executor.RoleCapabilities) any { return v.Usage }
var _ = executor.RoleReview
var _ = executor.RoundLimit
var _ *executor.RoundResult
var _ = func(v *executor.RoundResult) any { return v.Ending }
var _ = func(v *executor.RoundResult) any { return v.Handle }
var _ = func(v *executor.RoundResult) any { return v.Structured }
var _ = func(v *executor.RoundResult) any { return v.Usage }
var _ *executor.Session
var _ = executor.Session.Close
var _ = executor.Session.Handle
var _ = executor.Session.Round
var _ *executor.Task
var _ = func(v *executor.Task) any { return v.Approval }
var _ = func(v *executor.Task) any { return v.Brief }
var _ = func(v *executor.Task) any { return v.Dir }
var _ = func(v *executor.Task) any { return v.Effort }
var _ = func(v *executor.Task) any { return v.Excluded }
var _ = func(v *executor.Task) any { return v.Home }
var _ = func(v *executor.Task) any { return v.MaxRounds }
var _ = func(v *executor.Task) any { return v.Model }
var _ = func(v *executor.Task) any { return v.Protected }
var _ = func(v *executor.Task) any { return v.Role }
var _ = func(v *executor.Task) any { return v.Root }
var _ = func(v *executor.Task) any { return v.RunID }
var _ = func(v *executor.Task) any { return v.Schema }
var _ = func(v *executor.Task) any { return v.StartTree }
var _ = executor.UsageComplete
`,
  'kogen-loop': String.raw`package consumes

import (
	"kogen-loop/provider"
	"kogen-loop/sys"
	"kogen-loop/tools"
)

var _ *provider.Client
var _ = (*provider.Client).Respond
var _ = provider.Fingerprint
var _ = provider.Name
var _ = provider.NewClient
var _ *provider.Request
var _ = func(v *provider.Request) any { return v.Input }
var _ = func(v *provider.Request) any { return v.Instructions }
var _ = func(v *provider.Request) any { return v.Role }
var _ = func(v *provider.Request) any { return v.ToolChoice }
var _ = func(v *provider.Request) any { return v.Tools }
var _ *provider.Response
var _ = func(v *provider.Response) any { return v.Items }
var _ = provider.SupportsToolChoice
var _ = sys.AsError
var _ = sys.EnableSupervisor
var _ *sys.Error
var _ = func(v *sys.Error) any { return v.Class }
var _ = func(v *sys.Error) any { return v.Detail }
var _ = func(v *sys.Error) any { return v.Exit }
var _ = func(v *sys.Error) any { return v.Lines }
var _ = func(v *sys.Error) any { return v.Reason }
var _ = sys.Fail
var _ = sys.MaybeSupervise
var _ = sys.New
var _ *sys.Session
var _ = (*sys.Session).Context
var _ = (*sys.Session).Err
var _ = (*sys.Session).Getenv
var _ = (*sys.Session).Progress
var _ = func(v *sys.Session) any { return v.Stdout }
var _ = (*sys.Session).WatchSignals
var _ *tools.Call
var _ = (*tools.Call).Args
var _ = func(v *tools.Call) any { return v.Arguments }
var _ = func(v *tools.Call) any { return v.Item }
var _ = func(v *tools.Call) any { return v.Name }
var _ = (*tools.Call).Output
var _ = tools.Calls
var _ = tools.Cut
var _ = tools.DecodeArguments
var _ = tools.Definition
var _ = tools.InputBudgetBytes
var _ *tools.Output
var _ = (*tools.Output).Cut
var _ = (*tools.Output).Value
var _ = tools.ReadEvent
var _ = tools.Replay
var _ *tools.Tools
var _ = (*tools.Tools).Call
var _ = func(v *tools.Tools) any { return v.Enabled }
var _ = func(v *tools.Tools) any { return v.Root }
var _ = func(v *tools.Tools) any { return v.Session }
`,
  'kogen-verification': String.raw`package consumes

import (
	"github.com/KogenAI/kogen-verification/verify"
)

var _ = func(v *verify.Acceptance) any { return v.Problems }
var _ = func(v *verify.CommandResult) any { return v.Name }
var _ = func(v *verify.CommandResult) any { return v.Status }
var _ = func(v *verify.MaintainedModelResult) any { return v.Path }
var _ = func(v *verify.MaintainedModelResult) any { return v.Result }
var _ = (*verify.ModelResult).Failed
var _ *verify.Pass
var _ = func(v *verify.Pass) any { return v.Acceptance }
var _ = func(v *verify.Pass) any { return v.Checks }
var _ = func(v *verify.Pass) any { return v.Clean }
var _ = func(v *verify.Pass) any { return v.Failing }
var _ = func(v *verify.Pass) any { return v.Green }
var _ = func(v *verify.Pass) any { return v.MaintainedModels }
var _ = func(v *verify.Pass) any { return v.Model }
var _ = func(v *verify.Pass) any { return v.N }
var _ = (*verify.Pass).Results
var _ = func(v *verify.Pass) any { return v.Setup }
var _ = func(v *verify.Pass) any { return v.Tree }
`,
};

const uses = {
  'kogen-coordinator': `
    git.New git.Repo git.Repo.Changed git.Repo.Diff git.Repo.OK git.Repo.Resolve git.Repo.Show
    git.Repo.Tree git.Repo.TreeEntries git.TreeEntry git.TreeEntry.Mode git.TreeEntry.Object
    git.TreeEntry.Path project.Acceptance.Run project.Check project.Check.Name project.Check.Run
    project.Config.Acceptance project.Config.Checks project.Config.Fix project.ConfigPath
    project.FeaturePath project.IntentDir project.LoadConfig project.ModelPath project.Role
    project.Role.BaseURL project.Role.Effort project.Role.Model project.Role.Provider
    project.SourceMessage project.SourceRef project.ValidateSource route.StageReview
    route.StageReviewRetry route.StageReviewVerify
  `.split(/\s+/).filter(Boolean),
  'kogen-executor': `
    agent.AsAny agent.Prompt agent.TestingRules core.Count core.DiagnosticText core.Display
    core.EncodeJSON core.ExecutorState core.ExecutorState.Name core.ExecutorState.Rounds
    core.ExecutorState.SessionID core.ExecutorState.Usage core.ExecutorState.Version
    core.ExecutorUsage core.ExecutorUsage.Cached core.ExecutorUsage.CostUSD core.ExecutorUsage.Input
    core.ExecutorUsage.Output core.ExecutorUsage.Plus core.ExecutorUsage.Reasoning
    core.ExecutorUsage.Source core.ExecutorUsage.State core.HashHex core.InspectString core.NonNil
    core.ProviderRole core.ResponseTokens core.ResumeRefused core.ReviewRecord
    core.ReviewRecord.Findings core.ReviewRecord.N core.ReviewRecord.Tree core.ReviewRecord.Verdict
    core.ShellDefinitions core.Tokens core.Tokens.Plus core.ZeroTokens executor.Brief
    executor.Brief.Dynamic executor.Brief.Stable executor.Descriptor executor.Descriptor.For
    executor.Descriptor.Name executor.EndFinish executor.EndNoCall executor.Executor
    executor.Executor.Start executor.Fail executor.Handle.SessionID executor.Handle.Version
    executor.Input executor.Input.Feedback executor.PromptSizer executor.PromptSizer.FirstPromptBytes
    executor.ReasonProtocol executor.RoleCapabilities.Usage executor.RoleReview executor.RoundLimit
    executor.RoundResult executor.RoundResult.Ending executor.RoundResult.Handle
    executor.RoundResult.Structured executor.RoundResult.Usage executor.Session
    executor.Session.Close executor.Session.Handle executor.Session.Round executor.Task
    executor.Task.Approval executor.Task.Brief executor.Task.Dir executor.Task.Effort
    executor.Task.Excluded executor.Task.Home executor.Task.MaxRounds executor.Task.Model
    executor.Task.Protected executor.Task.Role executor.Task.Root executor.Task.RunID
    executor.Task.Schema executor.Task.StartTree executor.UsageComplete
  `.split(/\s+/).filter(Boolean),
  'kogen-loop': `
    provider.Client provider.Client.Respond provider.Fingerprint provider.Name provider.NewClient
    provider.Request provider.Request.Input provider.Request.Instructions provider.Request.Role
    provider.Request.ToolChoice provider.Request.Tools provider.Response provider.Response.Items
    provider.SupportsToolChoice sys.AsError sys.EnableSupervisor sys.Error sys.Error.Class
    sys.Error.Detail sys.Error.Exit sys.Error.Lines sys.Error.Reason sys.Fail sys.MaybeSupervise
    sys.New sys.Session sys.Session.Context sys.Session.Err sys.Session.Getenv sys.Session.Progress
    sys.Session.Stdout sys.Session.WatchSignals tools.Call tools.Call.Args tools.Call.Arguments
    tools.Call.Item tools.Call.Name tools.Call.Output tools.Calls tools.Cut tools.DecodeArguments
    tools.Definition tools.InputBudgetBytes tools.Output tools.Output.Cut tools.Output.Value
    tools.ReadEvent tools.Replay tools.Tools tools.Tools.Call tools.Tools.Enabled tools.Tools.Root
    tools.Tools.Session
  `.split(/\s+/).filter(Boolean),
  'kogen-verification': `
    verify.Acceptance.Problems verify.CommandResult.Name verify.CommandResult.Status
    verify.MaintainedModelResult.Path verify.MaintainedModelResult.Result verify.ModelResult.Failed
    verify.Pass verify.Pass.Acceptance verify.Pass.Checks verify.Pass.Clean verify.Pass.Failing
    verify.Pass.Green verify.Pass.MaintainedModels verify.Pass.Model verify.Pass.N verify.Pass.Results
    verify.Pass.Setup verify.Pass.Tree
  `.split(/\s+/).filter(Boolean),
};

// readme is the control README of suite s: an Inventory table with one row per use.
function readme(s) {
  return `# consumes/${s} (control)\n\n## Inventory\n\n| Use | Tests |\n| --- | --- |\n` + uses[s].map((u) => `| \`${u}\` | refs_test.go |\n`).join('');
}

// refsTest is the control test file of suite s.
function refsTest(s) {
  return refs[s];
}

module.exports = { refsTest, readme };
