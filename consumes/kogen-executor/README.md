# Consumes: kogen-executor

This suite states exactly what kogen-review relies on from kogen-executor (module `github.com/KogenAI/kogen-executor`), at the version `go.mod` pins (`v0.0.0-20261103084720-09eabaf5b7dc`): the `agent`, `core` and `executor` identifiers that kogen-review's own code (the non-test files of `review` and `cmd/kogen-review`) uses, 83 in all. It is the consumer half of the two-sided contract; `contract/` is what kogen-review provides. It runs in kogen-review's fast gate, `go test ./...`, so a kogen-executor change that kogen-review depends on fails here without building kogen-review against it.

Run it with the rest of the module, or alone:

```sh
go test -race -count=1 ./consumes/kogen-executor/
```

## What it pins

Each item is asserted so that changing what kogen-review relies on fails the suite.

- `api_test.go` (compile-time): the type or signature of every function, method, type, field and constant of the inventory, with its types written out: the `agent`, `core` and `executor` functions, `core.Tokens`, `core.ExecutorState`, `core.ExecutorUsage` and `core.ReviewRecord` fields, the `executor.Task`, `Brief`, `Input`, `Handle`, `RoundResult` and `RoleCapabilities` fields, the string constants and `executor.Ending` values, and the methods of the interfaces `executor.Executor`, `executor.Session` and `executor.PromptSizer` as method expressions.
- `core_test.go`: `core.Count` and `core.ZeroTokens` (known zeros, bytes `{"input":0,"cached":0,"output":0,"reasoning":0}`), `core.Tokens.Plus` (unknown stays unknown), `core.ProviderRole` (the four provider fields), `core.ResponseTokens` (the compatible totals, or the analytical usage for `anthropic`), `core.ExecutorUsage.Plus` (sums, the source a round reports, state `complete`/`partial`/`unknown`, a count or cost a round lacks becomes unknown), `core.HashHex` (SHA-256 hex), `core.EncodeJSON` (no HTML escaping, no final newline), `core.NonNil` (an empty list, never `null`), `core.Display` (nil, strings, json.Number text and the other values in `TestDisplay`; it does not pin integral or exponent float rendering), `core.InspectString` and `core.DiagnosticText`, and the exact JSON keys and bytes of `core.ReviewRecord` (`n`, `verdict`, `findings`, `tree` omitted when empty), `core.ExecutorState` (`name`, `version`, `session_id`, `rounds`, `usage`) and `core.ExecutorUsage` (`input`, `cached`, `output`, `reasoning`, `state`, `source`, `cost_usd` omitted when nil) as kogen-review writes them.
- `executor_test.go`: through a fake `executor.Executor` and `executor.Session`, the `executor.Task` kogen-review builds for an external review (every field it sets reaches `Start`), the event sink, `Session.Round` with `executor.Input.Feedback`, the `executor.RoundResult` fields it reads, `Session.Handle`, `Session.Close`, `executor.PromptSizer.FirstPromptBytes` asked through a type assertion on an `Executor` (and its absence), `executor.Descriptor.For` and `Name`, the string values of `RoleReview`, `EndFinish`, `EndNoCall`, `ReasonProtocol` and `UsageComplete`, the stops made by `executor.Fail`, `executor.RoundLimit` and `core.ResumeRefused` (class, reason, detail, exit 1, no lines), and the JSON keys of the executor values. A method of an interface is named through the interface (a call on an interface value or a method expression), never only by implementing it in a fake.
- `agent_test.go`: `agent.AsAny` (lists concatenated in order), `agent.Prompt(agent.TestingRules)` (the testing rules text: opening, sections, one final newline), and `core.ShellDefinitions` (one definition per name, in order, the shell's being the executing tool's own).

A use that cannot run without a real executor (`executor.Executor.Start` of a real harness) is pinned by its signature and exercised through a fake that records the task.

## Isolation

`TestMain` unsets every inherited `GIT_*` and `KOGEN_*` variable and `EMAIL`, sets a `HOME` of its own (`os.MkdirTemp`, removed afterwards), `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1` and `GIT_TERMINAL_PROMPT=0`. The suite imports only the standard library, kogen-executor's `agent`, `core` and `executor`, and, where a kogen-executor signature takes or returns their values, kogen-coordinator `project` and kogen-loop `provider`, `sys` and `tools`. It never imports kogen-review, uses no network (no listener, no server, no `net` package), reads no host path (files only under `t.TempDir()`), reads no source file, shares no state between tests, has no `t.Skip` and no sleep, and passes with `-race -count=1 -shuffle=on` and `-trimpath`.

## How coverage was checked

The uses are the go/types listing of every identifier in kogen-review's own non-test code (the non-test Go files of the packages outside `contract/`, `consumes/` and `features/`) that resolves (`Uses` or `Selections`) to an exported package-level object of a package of kogen-executor's module, or to a method or field of one of its named types (a promoted member by its declaring type), named `pkg.Name` or `pkg.Type.Member`. The same go/types pass over this suite's test files lists the identifiers they name; each use of the listing is named by at least one test, and the inventory below has exactly one row per use and no other. An identifier of kogen-executor that is not a use appears only to arrange or observe one (for example `executor.Executor.Describe` in the fake) and has no row.

## Inventory

| Use | Tests |
| --- | --- |
| `agent.AsAny` | `TestAsAny`, `api_test.go` (compile-time) |
| `agent.Prompt` | `TestTestingRulesPrompt`, `api_test.go` (compile-time) |
| `agent.TestingRules` | `TestTestingRulesPrompt`, `api_test.go` (compile-time) |
| `core.Count` | `TestCountAndZeroTokens`, `TestExecutorUsagePlus`, `api_test.go` (compile-time) |
| `core.DiagnosticText` | `TestDiagnosticText`, `api_test.go` (compile-time) |
| `core.Display` | `TestDisplay`, `api_test.go` (compile-time) |
| `core.EncodeJSON` | `TestHashHexAndEncodeJSONBytes`, `TestReviewRecordAndExecutorStateJSON`, `TestCountAndZeroTokens`, `TestTokensPlus`, `api_test.go` (compile-time) |
| `core.ExecutorState` | `TestReviewRecordAndExecutorStateJSON`, `api_test.go` (compile-time) |
| `core.ExecutorState.Name` | `TestReviewRecordAndExecutorStateJSON`, `api_test.go` (compile-time) |
| `core.ExecutorState.Rounds` | `TestReviewRecordAndExecutorStateJSON`, `api_test.go` (compile-time) |
| `core.ExecutorState.SessionID` | `TestReviewRecordAndExecutorStateJSON`, `api_test.go` (compile-time) |
| `core.ExecutorState.Usage` | `TestReviewRecordAndExecutorStateJSON`, `api_test.go` (compile-time) |
| `core.ExecutorState.Version` | `TestReviewRecordAndExecutorStateJSON`, `api_test.go` (compile-time) |
| `core.ExecutorUsage` | `TestReviewRecordAndExecutorStateJSON`, `TestExecutorUsagePlus`, `api_test.go` (compile-time) |
| `core.ExecutorUsage.Cached` | `TestReviewRecordAndExecutorStateJSON`, `TestExecutorUsagePlus`, `api_test.go` (compile-time) |
| `core.ExecutorUsage.CostUSD` | `TestReviewRecordAndExecutorStateJSON`, `TestExecutorUsagePlus`, `api_test.go` (compile-time) |
| `core.ExecutorUsage.Input` | `TestReviewRecordAndExecutorStateJSON`, `TestExecutorUsagePlus`, `api_test.go` (compile-time) |
| `core.ExecutorUsage.Output` | `TestReviewRecordAndExecutorStateJSON`, `TestExecutorUsagePlus`, `api_test.go` (compile-time) |
| `core.ExecutorUsage.Plus` | `TestExecutorUsagePlus`, `api_test.go` (compile-time) |
| `core.ExecutorUsage.Reasoning` | `TestReviewRecordAndExecutorStateJSON`, `TestExecutorUsagePlus`, `api_test.go` (compile-time) |
| `core.ExecutorUsage.Source` | `TestReviewRecordAndExecutorStateJSON`, `TestExecutorUsagePlus`, `api_test.go` (compile-time) |
| `core.ExecutorUsage.State` | `TestReviewRecordAndExecutorStateJSON`, `TestExecutorUsagePlus`, `api_test.go` (compile-time) |
| `core.HashHex` | `TestHashHexAndEncodeJSONBytes`, `api_test.go` (compile-time) |
| `core.InspectString` | `TestInspectString`, `api_test.go` (compile-time) |
| `core.NonNil` | `TestNonNil`, `api_test.go` (compile-time) |
| `core.ProviderRole` | `TestProviderRole`, `api_test.go` (compile-time) |
| `core.ResponseTokens` | `TestResponseTokens`, `api_test.go` (compile-time) |
| `core.ResumeRefused` | `TestExecutorStops`, `api_test.go` (compile-time) |
| `core.ReviewRecord` | `TestReviewRecordAndExecutorStateJSON`, `api_test.go` (compile-time) |
| `core.ReviewRecord.Findings` | `TestReviewRecordAndExecutorStateJSON`, `api_test.go` (compile-time) |
| `core.ReviewRecord.N` | `TestReviewRecordAndExecutorStateJSON`, `api_test.go` (compile-time) |
| `core.ReviewRecord.Tree` | `TestReviewRecordAndExecutorStateJSON`, `api_test.go` (compile-time) |
| `core.ReviewRecord.Verdict` | `TestReviewRecordAndExecutorStateJSON`, `api_test.go` (compile-time) |
| `core.ShellDefinitions` | `TestShellDefinitions`, `api_test.go` (compile-time) |
| `core.Tokens` | `TestTokensPlus`, `api_test.go` (compile-time) |
| `core.Tokens.Plus` | `TestTokensPlus`, `api_test.go` (compile-time) |
| `core.ZeroTokens` | `TestCountAndZeroTokens`, `api_test.go` (compile-time) |
| `executor.Brief` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Brief.Dynamic` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Brief.Stable` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Descriptor` | `TestDescriptorForAndName`, `api_test.go` (compile-time) |
| `executor.Descriptor.For` | `TestDescriptorForAndName`, `api_test.go` (compile-time) |
| `executor.Descriptor.Name` | `TestDescriptorForAndName`, `api_test.go` (compile-time) |
| `executor.EndFinish` | `TestExecutorConstants`, `api_test.go` (compile-time) |
| `executor.EndNoCall` | `TestExecutorConstants`, `api_test.go` (compile-time) |
| `executor.Executor` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Executor.Start` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Fail` | `TestExecutorStops`, `api_test.go` (compile-time) |
| `executor.Handle.SessionID` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Handle.Version` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Input` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Input.Feedback` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.PromptSizer` | `TestExecutorPromptSizer`, `api_test.go` (compile-time) |
| `executor.PromptSizer.FirstPromptBytes` | `TestExecutorPromptSizer`, `api_test.go` (compile-time) |
| `executor.ReasonProtocol` | `TestExecutorConstants`, `api_test.go` (compile-time) |
| `executor.RoleCapabilities.Usage` | `TestDescriptorForAndName`, `api_test.go` (compile-time) |
| `executor.RoleReview` | `TestExecutorConstants`, `api_test.go` (compile-time) |
| `executor.RoundLimit` | `TestExecutorStops`, `api_test.go` (compile-time) |
| `executor.RoundResult` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.RoundResult.Ending` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.RoundResult.Handle` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.RoundResult.Structured` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.RoundResult.Usage` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Session` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Session.Close` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Session.Handle` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Session.Round` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Task` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Task.Approval` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Task.Brief` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Task.Dir` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Task.Effort` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Task.Excluded` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Task.Home` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Task.MaxRounds` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Task.Model` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Task.Protected` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Task.Role` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Task.Root` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Task.RunID` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Task.Schema` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.Task.StartTree` | `TestExecutorStartRoundAndClose`, `api_test.go` (compile-time) |
| `executor.UsageComplete` | `TestExecutorConstants`, `api_test.go` (compile-time) |
