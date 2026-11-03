# kogen-loop consumes suite

This package states what kogen-review relies on from kogen-loop (module `kogen-loop`, which `go.mod` replaces with `github.com/KogenAI/kogen-loop`), at the version `go.mod` pins now (`v0.0.0-20261102055344-c6e2360290d4`). It is the consumer side of the two-sided contract: kogen-loop's own suites state what it provides, this one states exactly what kogen-review uses of it, so a change to kogen-loop that kogen-review would feel fails here, in kogen-review's own `go test ./...`, without building kogen-review against it. It asserts nothing kogen-review does not use. kogen-review's `contract/` (what kogen-review provides) is unchanged.

Run it with the rest of the module, or alone:

```sh
go test -race -count=1 ./consumes/kogen-loop/
```

## What it pins

Every item is asserted so that changing what kogen-review relies on fails the suite. Calls are real, with the producer's own values.

- `api_test.go` (compile-time): the type or signature of every function, method, type and field of the inventory, with its types written out: `provider.NewClient`, `Client.Respond`, `Fingerprint`, `Name`, `SupportsToolChoice`, the fields of `provider.Request` kogen-review sets and of `provider.Response` it reads; `sys.AsError`, `EnableSupervisor`, `Fail`, `MaybeSupervise`, `New`, the fields of `sys.Error` and the methods and the `Stdout` field of `sys.Session`; `tools.Call` and its fields and methods, `Calls`, `Cut`, `DecodeArguments`, `Definition`, `ReadEvent`, `Replay`, `Output`, `Tools` and its `Root`, `Session` and `Enabled` fields and `Call` method, and the integer constant `InputBudgetBytes`.
- `provider`: `Respond` ends before any transport, and with no network, for a request that is not signed in (`provider/login`, exit 4, the detail naming `kogen provider login chatgpt`), an unknown provider and an `openai-compatible` role without a base URL (`provider/refused`, exit 4), a forced tool a route cannot force (`provider/unsupported_capability`, exit 4, with `SupportsToolChoice` false for it and true where it can be forced) and a request whose `Input`, `Instructions` or `Tools` push the complete request over 524288 bytes (`candidate/context_budget_exceeded`, exit 1). An empty role provider routes to ChatGPT (`Name`). `Fingerprint` is the SHA-256 and byte count of a string, or of a value's JSON with sorted keys and no HTML escaping; nil gives nil. A sending `Respond` needs the network, a model and a signed-in provider and is pinned by its signature and by these offline outcomes.
- `sys`: `Fail` makes the stop kogen-review reports (class, reason, detail, exit, no lines, `<class>/<reason>: <detail>`), `AsError` finds it in a wrapped chain and not in a plain error; `New` reads the process's environment (`Getenv`), `Stdout` is where its output goes and `Progress` writes one line on stderr; `Context` and `Err` are live until an interrupt and then `interrupted by <signal>`; `WatchSignals` turns a SIGHUP of the process into that interrupt until stopped; `MaybeSupervise` returns for kogen-review's own (flag) arguments. `EnableSupervisor` starts commands under the supervisor process, which only the kogen binary is: it is pinned by its signature and not called.
- `tools`: `Calls` and `Call` (`Item`, `Name`, `Arguments`, `Args`, `Output`), `DecodeArguments` (an object, or `{"__invalid__": true}`), `Replay`, `Cut` (16384 bytes at most, the first 4096 bytes, the `[... N bytes omitted ...]` marker, UTF-8 safe, idempotent), `Output` (`Value`, `Cut`), the names and consumed parameter types and required status in `Definition` for kogen-review's six tools (`read_file`, `view_image`, `list_files`, `search_text`, `write_file`, `shell`), without pinning descriptions or unrelated schema fields, `ReadEvent` (the `image_read` event of a `view_image` result, none for any other), and `Tools.Call` over a `t.TempDir()` root: `Root` confines paths, `Enabled` gates the tools (`error: unknown tool <name>`), and `Session` is the environment of shell commands and of Git (`exit status: N` text).

## Isolation

`TestMain` unsets every inherited `GIT_*` and `KOGEN_*` variable and `EMAIL`, sets a `HOME` of its own (`os.MkdirTemp`, removed afterwards), `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1` and `GIT_TERMINAL_PROMPT=0`, as `contract/` does. The suite imports only the standard library and kogen-loop's `provider`, `sys` and `tools`, never a package of kogen-review or any other module (`net` or `net/...` included), and requires nothing in `go.mod`. There is no listener, HTTP server or fixed port; every file is under `t.TempDir()`; it reads neither kogen-review's sources, the module cache nor another repository; there is no `t.Skip`, sleep or build constraint, no state is shared between tests, and it passes under `-race -count=1 -shuffle=on` and `-trimpath`, with a Git directory that does not exist, a `HOME` whose `.gitconfig` signs commits with a key that does not exist and `GOPROXY=off`.

## Coverage check

The inventory below was derived with a go/types observer over the non-test Go files of kogen-review's packages outside `contract/`, `consumes/` and `features/` (`review`, `cmd/kogen-review`): every identifier that resolves (`Uses` or `Selections`) to an exported package-level object of a package of module `kogen-loop`, or to a method or field of one of its named types, named `pkg.Name` or `pkg.Type.Member` by the declaring type (53 uses). The same observer, run on the checkout, compares that list with the identifiers the tests of this package name and with this inventory; it must print `ok`:

```sh
d=$(mktemp -d) && node -e "process.stdout.write(require('./features/steps/k-consumes-review__observer.js').source)" > "$d/main.go" && printf 'module observer\n\ngo 1.27\n' > "$d/go.mod" && (cd "$d" && go build -o observer .) && "$d/observer" . kogen-coordinator=github.com/KogenAI/kogen-coordinator kogen-executor=github.com/KogenAI/kogen-executor kogen-loop=kogen-loop kogen-verification=github.com/KogenAI/kogen-verification
```

## Inventory

One row per use; the other cells name the tests asserting it (`api_test.go` holds the compile-time pins).

| Use | Tests |
| --- | --- |
| `provider.Client` | api_test.go, TestNewClientIsAUsableClient, TestRespondRefusesBeforeAnyTransport |
| `provider.Client.Respond` | api_test.go, TestRespondRefusesBeforeAnyTransport, TestRequestRoleRoutesTheRequest, TestRequestInputInstructionsAndToolsCountAgainstTheBudget, TestRequestToolChoiceIsRefusedWhereItCannotBeForced |
| `provider.Fingerprint` | api_test.go, TestFingerprintIsTheSHA256AndLengthOfTheBytes |
| `provider.Name` | api_test.go, TestName |
| `provider.NewClient` | api_test.go, TestNewClientIsAUsableClient |
| `provider.Request` | api_test.go, TestRespondRefusesBeforeAnyTransport |
| `provider.Request.Input` | api_test.go, TestRequestInputInstructionsAndToolsCountAgainstTheBudget |
| `provider.Request.Instructions` | api_test.go, TestRequestInputInstructionsAndToolsCountAgainstTheBudget |
| `provider.Request.Role` | api_test.go, TestRequestRoleRoutesTheRequest, TestRespondRefusesBeforeAnyTransport |
| `provider.Request.ToolChoice` | api_test.go, TestRequestToolChoiceIsRefusedWhereItCannotBeForced |
| `provider.Request.Tools` | api_test.go, TestRequestInputInstructionsAndToolsCountAgainstTheBudget |
| `provider.Response` | api_test.go, TestResponseItemsAreTheOutputItemsInOrder |
| `provider.Response.Items` | api_test.go, TestResponseItemsAreTheOutputItemsInOrder |
| `provider.SupportsToolChoice` | api_test.go, TestSupportsToolChoice, TestRequestToolChoiceIsRefusedWhereItCannotBeForced |
| `sys.AsError` | api_test.go, TestAsErrorFindsTheStopInAnErrorChain |
| `sys.EnableSupervisor` | api_test.go (signature only: it makes commands start under the supervisor process, which only the kogen binary is) |
| `sys.Error` | api_test.go, TestFailMakesTheStopKogenReviewReports |
| `sys.Error.Class` | api_test.go, TestFailMakesTheStopKogenReviewReports, TestRespondRefusesBeforeAnyTransport |
| `sys.Error.Detail` | api_test.go, TestFailMakesTheStopKogenReviewReports, TestRespondRefusesBeforeAnyTransport |
| `sys.Error.Exit` | api_test.go, TestFailMakesTheStopKogenReviewReports, TestRespondRefusesBeforeAnyTransport |
| `sys.Error.Lines` | api_test.go, TestFailMakesTheStopKogenReviewReports |
| `sys.Error.Reason` | api_test.go, TestFailMakesTheStopKogenReviewReports, TestRespondRefusesBeforeAnyTransport |
| `sys.Fail` | api_test.go, TestFailMakesTheStopKogenReviewReports |
| `sys.MaybeSupervise` | api_test.go, TestMaybeSuperviseReturnsWhenTheArgumentsDoNotStartTheSupervisor |
| `sys.New` | api_test.go, TestNewReadsTheProcessEnvironment |
| `sys.Session` | api_test.go, TestNewReadsTheProcessEnvironment |
| `sys.Session.Context` | api_test.go, TestSessionContextAndErrStartLiveAndEndWithTheInterrupt |
| `sys.Session.Err` | api_test.go, TestSessionContextAndErrStartLiveAndEndWithTheInterrupt |
| `sys.Session.Getenv` | api_test.go, TestNewReadsTheProcessEnvironment |
| `sys.Session.Progress` | api_test.go, TestSessionProgressWritesOneLine |
| `sys.Session.Stdout` | api_test.go, TestSessionStdoutIsWhereTheSessionWritesItsOutput |
| `sys.Session.WatchSignals` | api_test.go, TestWatchSignalsTurnsATerminalSignalIntoTheSessionsInterrupt, TestWatchSignalsStopEndsTheWatch |
| `tools.Call` | api_test.go, TestCallsListsTheFunctionCallsInOrder, TestCallOutputAnswersTheCall |
| `tools.Call.Args` | api_test.go, TestCallArgsDecodesAnObject |
| `tools.Call.Arguments` | api_test.go, TestCallsListsTheFunctionCallsInOrder |
| `tools.Call.Item` | api_test.go, TestCallsListsTheFunctionCallsInOrder |
| `tools.Call.Name` | api_test.go, TestCallsListsTheFunctionCallsInOrder |
| `tools.Call.Output` | api_test.go, TestCallOutputAnswersTheCall |
| `tools.Calls` | api_test.go, TestCallsListsTheFunctionCallsInOrder |
| `tools.Cut` | api_test.go, TestCutBoundsTheTextTheModelReads |
| `tools.DecodeArguments` | api_test.go, TestDecodeArguments |
| `tools.Definition` | api_test.go, TestDefinitionIsTheGenericToolDefinition |
| `tools.InputBudgetBytes` | api_test.go, TestInputBudgetBytesIsTheRequestCeiling, TestRequestInputInstructionsAndToolsCountAgainstTheBudget |
| `tools.Output` | api_test.go, TestOutputValueIsTheTextOrTheParts, TestOutputCutBoundsTextAndLeavesTypedPartsAlone |
| `tools.Output.Cut` | api_test.go, TestOutputCutBoundsTextAndLeavesTypedPartsAlone |
| `tools.Output.Value` | api_test.go, TestOutputValueIsTheTextOrTheParts |
| `tools.ReadEvent` | api_test.go, TestReadEventDescribesAnImageRead |
| `tools.Replay` | api_test.go, TestReplayKeepsOnlyWhatTheProviderAcceptsBack |
| `tools.Tools` | api_test.go, TestToolsCallRunsTheEnabledToolsInTheRoot |
| `tools.Tools.Call` | api_test.go, TestToolsCallRunsTheEnabledToolsInTheRoot, TestToolsEnabledGatesTheTools, TestToolsSessionIsTheEnvironmentOfShellCommands |
| `tools.Tools.Enabled` | api_test.go, TestToolsEnabledGatesTheTools |
| `tools.Tools.Root` | api_test.go, TestToolsCallRunsTheEnabledToolsInTheRoot, TestToolsSessionGivesGitsEnvironmentToTheFileTools |
| `tools.Tools.Session` | api_test.go, TestToolsSessionIsTheEnvironmentOfShellCommands, TestToolsSessionGivesGitsEnvironmentToTheFileTools |
