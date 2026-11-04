# Stop writing max_rounds in kogen-review fixtures

Slug: k-review-config-no-max-rounds
Model: not applicable — the change edits test fixtures and pins only; no review state, transition or round accounting changes
Acceptance:
- .kogen/intents/k-review-config-no-max-rounds/acceptance.feature
- features/steps/k-review-config-no-max-rounds__steps.js

kogen-coordinator now refuses a project configuration that sets `models.<role>.max_rounds` (commit `ce1e6ba` "Reject removed max_rounds configuration", pseudo-version `v0.0.0-20261104042648-ce1e6baa2d77`; kogen-coordinator `main` is now `2a74649`, pseudo-version `v0.0.0-20261104081556-2a74649374bb`, which contains it). Its refusal is `environment/project_config_invalid` with the line `line 20: models.review.max_rounds was removed; the external executor's own round limit caps a role, and 6 caps a review role whose executor supplies none`. kogen-review's own consumer fixture still writes the key, so against that coordinator `TestLoadConfigReadsTheCommands` and `TestRoleKeepsTheCheckpointBytes` (in `consumes/kogen-coordinator/project_test.go`) fail, and the second then panics on a nil Config. This was reproduced in a scratch copy with `go mod edit -require=github.com/KogenAI/kogen-coordinator@<version>` and `GOWORK=off GOFLAGS=-mod=mod go test ./consumes/kogen-coordinator/`. Every other package of kogen-review compiles against both versions. Removing the fixture line makes the package pass against `main`.

The outcome is consumer-first: kogen-review's fixtures and code no longer write or read `models.<role>.max_rounds`, and its whole Go suite passes against the coordinator it pins today (`v0.0.0-20261103113131-ffca7072fe15`, unchanged in `go.mod`) and against the coordinator that rejects the key. Review behaviour is unchanged. kogen-review does not compute a round cap from configuration. `review.NewExternal(exec, desc, maxRounds)` keeps taking the cap from its caller, which applies what the coordinator provides today: the external executor's own limit, or 6 for a review role whose executor supplies none. That cap still reaches `executor.Task.MaxRounds` and `executor.RoundLimit` as before.

Required edits (and nothing else):
- `consumes/kogen-coordinator/project_test.go`: in the `configYAML` fixture, delete the line `    max_rounds: 2` so that the fixture's `models:` section is exactly `models:` / `  review:` / `    executor: claude-code` / `    model: claude-opus-5-5` / `    effort: high` and the fixture still ends there. `TestLoadConfigReadsTheCommands` and `TestRoleKeepsTheCheckpointBytes` keep all their current assertions.
- `consumes/kogen-executor/core_test.go`: in `TestProviderRole`, drop `MaxRounds: 3` from the `project.Role` literal. Keep `Executor: "ignored"` and the existing expectations. No kogen-review Go file sets `MaxRounds` in a `project.Role` literal.
- `consumes/kogen-executor/executor_test.go`: in `TestExecutorValueJSONKeys`, drop the `"max_rounds"` entry from the `executor.Task` key list. `executor.Task.MaxRounds` stays pinned by `TestExecutorStartRoundAndClose` (value 6 reaches `Start`) and by the compile-time line in `api_test.go`.

After these edits, `grep -rn max_rounds --exclude-dir=.git --exclude-dir=.kogen --exclude='*.md' .` at the repository root finds nothing. Markdown documentation and `.kogen/` (Kogen's own checkout configuration and Intent records) are outside that search. `.kogen/project.yaml` is protected, and its `max_rounds` lines belong to the local lineup override commit "Local lineup override (not for push)", not to kogen-review's fixtures or code. The Build does not touch it. `go.mod`, `go.sum`, the `review` package, `cmd/kogen-review` and the contract suite stay unchanged.

## Decisions
- kogen-review's fixtures and code never write or read `models.<role>.max_rounds`; behaviour is otherwise unchanged (source: request)
- Consumer-first: kogen-review keeps pinning kogen-coordinator `v0.0.0-20261103113131-ffca7072fe15`; no dependency bump (source: request)
- The review round cap stays whatever the caller passes to `review.NewExternal`: the external executor's own limit, or 6 for a review role whose executor supplies none (source: request)

## Source comparison
- Problem (land check of k-coord-reject-max-rounds, 3 Nov 23:48Z: `TestLoadConfigReadsTheCommands` and `TestRoleKeepsTheCheckpointBytes` fail with `project_config_invalid`): addressed. The `configYAML` fixture loses the line, and acceptance runs the whole suite against the rejecting coordinator `ce1e6baa2d77` and requires both tests to pass exactly once.
- "kogen-review's suite passes against kogen-coordinator main and against the candidate that rejects max_rounds": addressed. Two scenarios run `go test -json -count=1 ./...` in a copy of the working tree whose `go.mod` requires `v0.0.0-20261104042648-ce1e6baa2d77` (the rejecting commit) or `v0.0.0-20261104081556-2a74649374bb` (current `main`). Each checks that the resolved version is the one named, that the suite exits 0 and that the named consumer tests passed once. The pinned version keeps being run by the configured `go-test` check.
- "`grep -rn max_rounds` over kogen-review's non-doc files finds nothing": addressed. A scenario runs that grep excluding `.git`, `.kogen` and `*.md`; it must exit 1 with no output. Superseded detail: `.kogen/project.yaml` (protected, local not-for-push override) is not one of kogen-review's fixtures or code and stays out of the search.
- "fixtures and code never write or read models.<role>.max_rounds": addressed for the YAML fixture, the `executor.Task` JSON-key pin and the `project.Role{... MaxRounds: 3}` fixture in `TestProviderRole`.
- "A review role's round cap comes from what the coordinator provides today": already true. `review.NewExternal` takes the cap from its caller (`TestExternalReviewApprovesInItsOwnSession` pins 4 reaching `executor.Task.MaxRounds`). Unchanged.
- Retry cause ("every scenario that exercises it passes on the unchanged tree"): addressed. The coordinator-compatibility scenarios now run against the coordinator versions that reject the key, so they are red on the unchanged tree at the suite assertion.

## Tests
- The consumer fixture configuration no longer sets the removed key and still loads against the rejecting coordinator: update the `configYAML` fixture used by `TestLoadConfigReadsTheCommands` and `TestRoleKeepsTheCheckpointBytes`; acceptance reproduces the reported failure against `ce1e6baa2d77` and `main` (regression)
- No kogen-review fixture sets a role's round cap: drop `MaxRounds: 3` from `TestProviderRole`'s `project.Role` and the key from `TestExecutorValueJSONKeys` (existing)
- No non-doc file outside `.kogen` names the removed key: grep scenario in acceptance (scenario)
- The external review's round cap still comes from its caller and reaches the executor task: `TestExternalReviewApprovesInItsOwnSession`, `TestExecutorStartRoundAndClose` (existing)

## Feasibility
- none
