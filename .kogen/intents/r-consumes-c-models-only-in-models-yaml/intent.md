# Follow kogen-coordinator's models-only lineup

Slug: r-consumes-c-models-only-in-models-yaml
Model: not applicable — a dependency pin move plus a test-fixture and documentation update, with no product state or behavior change in kogen-review
Acceptance:
- .kogen/intents/r-consumes-c-models-only-in-models-yaml/acceptance.feature
- features/steps/r-consumes-c-models-only-in-models-yaml__steps.js

The producer change c-models-only-in-models-yaml landed in kogen-coordinator on purpose. `project.ParseConfig`, and so `project.LoadConfig`, now refuses a `models:` key in `.kogen/project.yaml` with `environment/project_config_invalid` and the line `line <n>: models is no longer read from .kogen/project.yaml; move the model lineup to .kogen/models.yaml`. `LoadConfig` now takes every model role only from the built-in defaults, then the team file `.kogen/models.yaml` when it exists, then the host-local `.kogen/local/models.yaml` when it exists. A role a file names replaces the whole role. kogen-review follows the new contract. There is no compatibility layer and no fallback, and no test or code accepts a `models:` key in `.kogen/project.yaml`.

Today kogen-review's consumer suite writes the review role into `.kogen/project.yaml`. Against the producer's new main, two tests in `consumes/kogen-coordinator/project_test.go` fail. `TestLoadConfigReadsTheCommands` fails at `project_test.go:66`, and `TestRoleKeepsTheCheckpointBytes` fails at `project_test.go:146` and then panics on a nil Config. Both report `&sys.Error{Class:"environment", Reason:"project_config_invalid", Detail:"project.yaml", Lines:[]string{"line 15: models is no longer read from .kogen/project.yaml; ..."}}`.

Changes:
1. go.mod and go.sum: move the kogen-coordinator pin to its new main. That is commit `d74daae36f56d4e195d6ff04e79e74eab1530bb7`, the main observed while shaping, and it contains the producer change. Run `go get github.com/KogenAI/kogen-coordinator@d74daae36f56d4e195d6ff04e79e74eab1530bb7`, which writes `github.com/KogenAI/kogen-coordinator v0.0.0-20261106110407-d74daae36f56`, then run `go mod tidy`. Tidying removes the go.sum lines of the old pin `v0.0.0-20261104083402-f4bd4aebd8c2`. The other requires are unchanged: kogen-executor `v0.0.0-20261104084012-b2ffb64382e8`, kogen-loop `v0.0.0-20261104063532-dea3eb375dba` and kogen-verification `v0.0.0-20261104081401-7805cfe30d6c`. Add no replace directive and no go.work, and leave the `go 1.27.2` line as it is.
2. `consumes/kogen-coordinator/project_test.go`:
   - In the `configYAML` constant, delete the five lines `models:`, `  review:`, `    executor: claude-code`, `    model: claude-opus-5-5` and `    effort: high`. The constant then ends with `    steps_dir: 'features/steps'` and a newline.
   - Directly after `configYAML`, add the team lineup fixture, with a one-line comment that says it is the team model lineup `.kogen/models.yaml`, the only place `LoadConfig` takes the review role from:
     ```go
     const modelsYAML = `models:
       review:
         executor: claude-code
         model: claude-opus-5-5
         effort: high
     `
     ```
     The YAML inside the backticks has the same indentation as the five lines removed from `configYAML`: `models:` at column 0, `review:` indented by 2 spaces, and its keys by 4.
   - In `TestRoleKeepsTheCheckpointBytes`, add `write(t, root, ".kogen/models.yaml", modelsYAML, 0o644)` directly after `write(t, root, project.ConfigPath, configYAML, 0o644)`. Change the comment `// The role of the configuration's review model has the model and the effort it names.` to `// The review role LoadConfig takes from the team models file has the model and the effort it names.` Keep every assertion of the test unchanged, including `review.Model` `claude-opus-5-5`, `review.Effort` `high`, `review.Provider` `""` and `review.BaseURL` `""`. These values differ from the defaults (the default review role is `gpt-6.1-terra`/`medium`), so the test still proves that the role was read from the models file.
   - `TestLoadConfigReadsTheCommands` keeps all its assertions and still loads `configYAML`.
3. `consumes/kogen-coordinator/README.md`, `project` bullet of "What it pins": replace `` `Role`'s checkpoint JSON bytes and fields; `` with `` `Role`'s checkpoint JSON bytes and fields, and the review role `LoadConfig` takes from a `.kogen/models.yaml` (the `.kogen/project.yaml` holds no `models` key); ``. Leave the rest of the README unchanged, including its 36-use inventory. No non-test code of kogen-review gains or loses a kogen-coordinator use.

Out of scope:
- Production code (`review/`, `cmd/kogen-review/`) and `contract/`. They pass against the new main unchanged.
- `.kogen/project.yaml`. It is this checkout's Kogen host configuration, a protected path, and no test reads it.
- Step files and Intents of earlier changes.
- Any other dependency.

## Decisions
- kogen-review follows the new contract: no compatibility layer, no fallback, and no test or code that accepts `models:` in `.kogen/project.yaml`. (source: request)
- Move the go.mod pin of kogen-coordinator to the producer's new main with `go get`, in the same change. (source: request)
- Test fixtures describe only the new contract: the review role moves from the `configYAML` fixture into a `.kogen/models.yaml` fixture. (source: request)
- Nothing else changes, and every other test stays green. (source: request)
- Pin kogen-coordinator at d74daae36f56d4e195d6ff04e79e74eab1530bb7 (v0.0.0-20261106110407-d74daae36f56) via go get plus go mod tidy (decision: D1, round 1) (constraint: No replace and no go.work) (constraint: Other requires unchanged) (constraint: Old pin's go.sum lines removed by tidy) (evidence: go.mod; go.sum) (assumption: The commit, pseudo-version and go.sum hashes come from this session's own git ls-remote and go mod download, not from a Kogen-recorded probe; readiness and the Build's go get confirm or refute them) (source: request)
- Move the review role in the consumer fixture from configYAML into a .kogen/models.yaml fixture written by TestRoleKeepsTheCheckpointBytes; keep all assertions (decision: D2, round 1) (constraint: No test accepts models in project.yaml) (constraint: No production code change) (evidence: consumes/kogen-coordinator/project_test.go; cmd/kogen-review/main_test.go; cmd/kogen-review/main.go; consumes/kogen-coordinator/README.md) (source: request)
- Leave .kogen/project.yaml untouched (decision: D3, round 1) (evidence: .kogen/project.yaml) (source: request)

## Source comparison
- addressed: Problem. The failures of `TestLoadConfigReadsTheCommands` (`project_test.go:66`) and `TestRoleKeepsTheCheckpointBytes` (`project_test.go:146`) with `environment/project_config_invalid`, `line 15: models is no longer read from .kogen/project.yaml`, were reproduced in a scratch copy after `go get` of the new main. Acceptance scenario 2 runs exactly these two tests against the new pin and requires each to pass exactly once.
- addressed: Need, "move this repository's go.mod pin of the producer to that main (go get against the mirror)". The local mirror `mirrors/kogen-coordinator.git` was still at `c8126f4`, before the change. `git ls-remote https://github.com/KogenAI/kogen-coordinator.git` gave main `d74daae36f56d4e195d6ff04e79e74eab1530bb7`. Its module source has the refusal in `project/config.go`, and apart from the local lineup override in `.kogen/project.yaml` it is identical to the producer change's checkout. The commit is fixed so that branch movement cannot change the target. Acceptance scenario 1 checks the exact require list, the go.sum lines, the removal of the old pin's go.sum lines, no replace, no go.work and a tidy module.
- addressed: Need, "code, tests, fixtures and docs". The only fixture that writes `models:` into a `.kogen/project.yaml` is `configYAML` in `consumes/kogen-coordinator/project_test.go`. No step file or other Go source writes one. `cmd/kogen-review/main_test.go` writes project files without `models`, and no non-test code reads `Config.Models` from `LoadConfig`. The docs change is the consumes README bullet, checked by acceptance scenario 3.
- addressed: Need, "No test or code accepts the old behaviour, and no fallback is added". With the new pin, any fixture that still put `models:` in `.kogen/project.yaml` makes `LoadConfig` fail, so scenario 2 together with the configured `go test ./...` rejects it. Scenario 2 also requires the review-role assertions to stay in `TestRoleKeepsTheCheckpointBytes`. Their non-default values can only come from the models file.
- addressed: Need, "Nothing else changes. Keep every other test green." The configured checks (`gofmt`, `go build ./...`, `go vet ./...`, `GOFLAGS=-trimpath go test ./...`) cover the rest. They are not duplicated in the feature.
- omitted, by design: `.kogen/project.yaml` of this checkout still has a `models:` block, from the local lineup override commit. It is protected Kogen host configuration, read by the installed Kogen release, not by any kogen-review test.
- superseded: the `models:` block of the `configYAML` fixture; the go.mod require `github.com/KogenAI/kogen-coordinator v0.0.0-20261104083402-f4bd4aebd8c2` and its go.sum lines.

## Tests
- The consumer fixture no longer puts the review role in `.kogen/project.yaml`, and `LoadConfig` takes it from `.kogen/models.yaml`: update `configYAML` and `TestRoleKeepsTheCheckpointBytes` in `consumes/kogen-coordinator/project_test.go`. Acceptance scenario 2 runs `TestLoadConfigReadsTheCommands` and `TestRoleKeepsTheCheckpointBytes` against the new pin and checks that the role assertions are intact (regression)
- go.mod pins kogen-coordinator at `v0.0.0-20261106110407-d74daae36f56` with matching go.sum, no old-pin lines, no replace, no go.work and a tidy module: acceptance scenario 1 (integration)
- The consumes README states that the review role comes from `.kogen/models.yaml`: acceptance scenario 3 reads the README (scenario)
- Everything else is unchanged: the existing `go build ./...`, `go vet ./...` and `go test ./...` suites pass (existing)

## Feasibility
- `git ls-remote https://github.com/KogenAI/kogen-coordinator.git refs/heads/main` gave `d74daae36f56d4e195d6ff04e79e74eab1530bb7`. `go mod download -json` of it gave version `v0.0.0-20261106110407-d74daae36f56`, Sum `h1:8VmqsU9EArCYwqOTw8e9uuS54nRSlUHSUaDl8W+lYqs=` and GoModSum `h1:MMc15p3YwlY71dMxfCdX6QlR2jXJbSxL6YA9Y7971c8=`. Its `project/config.go` refuses `models` in `.kogen/project.yaml`, and its go.mod requires kogen-loop `v0.0.0-20261103215300-3e292bb34b90`, older than this module's pin, so the kogen-loop pin stays. (probe: exit 0)
- In a scratch clone, `go get` of that commit changed only the coordinator require and added its go.sum lines. `go test ./consumes/kogen-coordinator/` then failed in `TestRoleKeepsTheCheckpointBytes` with a nil-pointer panic at `project_test.go:147`, reproducing the report. After the fixture edit above and `go mod tidy`, the old pin's two go.sum lines were gone. `go test -count=1 ./consumes/kogen-coordinator/ ./cmd/...` passed, `go build ./...` and `go vet ./...` passed, and `go mod tidy -diff` exited 0. The full `go test ./...` was not run in the probe; the configured checks cover it. (probe: exit 0)
- On the unchanged tree, `go test -count=1 -v -run '^(TestLoadConfigReadsTheCommands|TestRoleKeepsTheCheckpointBytes)$' ./consumes/kogen-coordinator/` printed `--- PASS: TestLoadConfigReadsTheCommands (0.00s)` and `--- PASS: TestRoleKeepsTheCheckpointBytes (0.00s)`, and `GOFLAGS=-mod=readonly go mod tidy -diff` exited 0 with no output. The step's observer reads that real output. Scenarios 1 and 2 fail now on the pin, and scenario 3 fails on the README. (probe: exit 0)
- No declared evidence obligations: the step file runs only read-only `go mod edit -json`, `go mod tidy -diff`, one focused `go test` and file reads on the candidate tree.
