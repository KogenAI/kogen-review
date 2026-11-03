# Consumes suite: kogen-coordinator

This package states what kogen-review relies on from kogen-coordinator (module `github.com/KogenAI/kogen-coordinator`), at the version `go.mod` pins. It is the consumer's half of the two-sided contract: kogen-coordinator keeps its own `contract/` suite for what it provides, and this suite pins exactly what kogen-review's own code uses of it, so a change in kogen-coordinator that kogen-review does not survive fails here, without building kogen-review's callers. kogen-review's own `contract/` (what it provides) is unchanged.

Run it with the rest of the module, or alone:

```sh
go test -race -count=1 ./consumes/kogen-coordinator/
```

## What it pins

Each item is asserted so that changing what kogen-review relies on fails the suite. The suite is written only against kogen-coordinator's exported API.

- Signatures, types, fields and constants (`api_test.go`, compile-time, with their types written out): `git.New`, the `git.Repo` methods `Resolve`, `Tree`, `Changed`, `Diff`, `OK`, `Show` and `TreeEntries`, `git.TreeEntry` and its `Mode`, `Object` and `Path`; `project.IntentDir`, `FeaturePath`, `ModelPath`, `ConfigPath`, `LoadConfig`, `SourceMessage`, `ValidateSource`, `SourceRef`, `Config` (`Fix`, `Checks`, `Acceptance`), `Check`, `Acceptance`, `Role`; the three review stages of `route`.
- `git.Repo` on a Git checkout made in `t.TempDir()` (`git_test.go`): `Resolve` of `<rev>^{commit}` to the commit id and the refusal of an unknown revision or an option; `Tree` is the candidate (tracked and untracked files not ignored, with content and mode, excluded paths left out, the user's index untouched); `Changed` lists the paths between two trees without rename detection, as plain `-z` names; `Diff` is the plain unified diff limited to literally taken paths, empty without paths; `OK("show", tree+":path")` returns the file's exact bytes; `Show` returns a revision's file or not found; `TreeEntries` lists every file with its mode, blob id and full path, and a gitlink as mode `160000` with its commit.
- `project` (`project_test.go`): the Intent, feature, model and configuration paths; `LoadConfig` of a `.kogen/project.yaml` in `t.TempDir()` (the fixers, the checks in order with name and command, the acceptance command, a missing acceptance as nil) and its refusals' text (`environment/not_initialized`, `project_config_invalid` with its lines, `old_kogen_config`); `Role`'s checkpoint JSON bytes and fields; `SourceMessage`'s text, with and without a receipt; `ValidateSource` of nil, of a receipt with safe custody and of a receipt that is missing, changed, readable by others or in an open folder (the `candidate/source_provenance_changed` text).
- `route` (`route_test.go`): the exact stage strings `review`, `review_verify` and `review_retry_verify`.

## Isolation

`TestMain` unsets every inherited `GIT_*` and `KOGEN_*` variable and `EMAIL`, sets a `HOME` of its own (removed afterwards), `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1` and `GIT_TERMINAL_PROMPT=0`. Every file is under `t.TempDir()`: no read of kogen-review's sources, the module cache or another repository. No network (no listener, no HTTP server, no fixed port; the suite imports no `net` package), no sleep, no `t.Skip`, no build constraint, no shared state between tests. It imports only the standard library and kogen-coordinator, and passes with `-race -count=1 -shuffle=on` and `-trimpath`.

## How coverage was checked

The uses were derived with a go/types listing: every identifier in the non-test Go files of the packages of kogen-review outside `contract/`, `consumes/` and `features/` (`review`, `cmd/kogen-review`) that resolves (`Uses` or `Selections`) to an exported package-level object of a kogen-coordinator package, named `pkg.Name`, or to a method or field of one of its named types, named `pkg.Type.Member`. The same listing run over this suite's test files shows that its tests name every one of them, and the inventory below lists exactly those 36 uses and nothing else. Other exported identifiers (for example `Repo.Dir`, `Config.Models`) appear only to arrange or observe a use.

## Inventory

| Use | Tests |
| --- | --- |
| `git.New` | `api_test.go`, `TestNewMakesARepoWithoutCheckingIt` |
| `git.Repo` | `api_test.go`, `TestNewMakesARepoWithoutCheckingIt` |
| `git.Repo.Changed` | `api_test.go`, `TestRepoChanged` |
| `git.Repo.Diff` | `api_test.go`, `TestRepoDiff` |
| `git.Repo.OK` | `api_test.go`, `TestRepoOK` |
| `git.Repo.Resolve` | `api_test.go`, `TestRepoResolve` |
| `git.Repo.Show` | `api_test.go`, `TestRepoShow` |
| `git.Repo.Tree` | `api_test.go`, `TestRepoTree` |
| `git.Repo.TreeEntries` | `api_test.go`, `TestRepoTreeEntries` |
| `git.TreeEntry` | `api_test.go`, `TestTreeEntryFields` |
| `git.TreeEntry.Mode` | `api_test.go`, `TestRepoTreeEntries`, `TestTreeEntryFields` |
| `git.TreeEntry.Object` | `api_test.go`, `TestRepoTreeEntries`, `TestTreeEntryFields` |
| `git.TreeEntry.Path` | `api_test.go`, `TestRepoTreeEntries`, `TestTreeEntryFields` |
| `project.Acceptance.Run` | `api_test.go`, `TestLoadConfigReadsTheCommands` |
| `project.Check` | `api_test.go`, `TestLoadConfigReadsTheCommands` |
| `project.Check.Name` | `api_test.go`, `TestLoadConfigReadsTheCommands`, `TestLoadConfigWithoutAcceptanceHasNone` |
| `project.Check.Run` | `api_test.go`, `TestLoadConfigReadsTheCommands`, `TestLoadConfigWithoutAcceptanceHasNone` |
| `project.Config.Acceptance` | `api_test.go`, `TestLoadConfigReadsTheCommands`, `TestLoadConfigWithoutAcceptanceHasNone` |
| `project.Config.Checks` | `api_test.go`, `TestLoadConfigReadsTheCommands`, `TestLoadConfigWithoutAcceptanceHasNone` |
| `project.Config.Fix` | `api_test.go`, `TestLoadConfigReadsTheCommands`, `TestLoadConfigWithoutAcceptanceHasNone` |
| `project.ConfigPath` | `api_test.go`, `TestProjectPaths` |
| `project.FeaturePath` | `api_test.go`, `TestProjectPaths` |
| `project.IntentDir` | `api_test.go`, `TestProjectPaths` |
| `project.LoadConfig` | `api_test.go`, `TestLoadConfigReadsTheCommands`, `TestLoadConfigWithoutAcceptanceHasNone`, `TestLoadConfigRefusals` |
| `project.ModelPath` | `api_test.go`, `TestProjectPaths` |
| `project.Role` | `api_test.go`, `TestRoleKeepsTheCheckpointBytes` |
| `project.Role.BaseURL` | `api_test.go`, `TestRoleKeepsTheCheckpointBytes` |
| `project.Role.Effort` | `api_test.go`, `TestRoleKeepsTheCheckpointBytes` |
| `project.Role.Model` | `api_test.go`, `TestRoleKeepsTheCheckpointBytes` |
| `project.Role.Provider` | `api_test.go`, `TestRoleKeepsTheCheckpointBytes` |
| `project.SourceMessage` | `api_test.go`, `TestSourceMessage` |
| `project.SourceRef` | `api_test.go`, `TestSourceMessage`, `TestValidateSource` |
| `project.ValidateSource` | `api_test.go`, `TestValidateSource` |
| `route.StageReview` | `api_test.go`, `TestRouteStages` |
| `route.StageReviewRetry` | `api_test.go`, `TestRouteStages` |
| `route.StageReviewVerify` | `api_test.go`, `TestRouteStages` |
