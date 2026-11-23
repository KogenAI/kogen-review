# Test the kogen-review invalid-input contract

Slug: cli-invalid-input-contract
Model: not applicable — only tests are added for a one-shot command's input refusals; no state or interacting rules change
Acceptance:
- .kogen/intents/cli-invalid-input-contract/acceptance.feature
- features/steps/cli-invalid-input-contract__steps.js

Add hermetic tests to `cmd/kogen-review/main_test.go` that pin the command's invalid-input contract: when required arguments are missing or the checkout inputs cannot be used, `run` returns exit code 2, prints usage or a refusal on stderr and leaves stdout empty. Only `cmd/kogen-review/main_test.go` changes outside the Intent's own files; the command's behavior and its verification are out of scope and stay as they are.

The tests call `run` directly with in-memory stdout and stderr buffers and use temporary Git checkouts; a refusal must leave no run folder in the temporary directory.

1. Usage errors: no arguments, a missing `-start`, `-slug` or `-model`, and an unexpected positional argument each return 2, print the usage line (`usage: kogen-review -start REV ...`) on stderr and write nothing to stdout.
2. Unusable inputs: a slug without `intent.md`, an Intent without `acceptance.feature`, a `.kogen/project.yaml` that `project.LoadConfig` rejects (`version: seven`), and a `-start` that is not a commit each return 2, print one `kogen-review: ` refusal on stderr that names the case, write nothing to stdout and start no review work.

## Decisions
- The tests live in the existing `cmd/kogen-review/main_test.go` and call `run` in-process with buffers, reusing the package's hermetic `TestMain` (decision: D1, round 1) (evidence: cmd/kogen-review/main_test.go; cmd/kogen-review/main_hermetic_test.go; cmd/kogen-review/main.go) (source: request)
- Acceptance observes the tests by running `go test ./cmd/kogen-review` against the current `main.go` and against deliberately wrong copies of `main.go` supplied through a Go overlay, so no test name is invented (decision: D2, round 1) (evidence: features/steps/climb-review-900__steps.js) (source: request)
- Command behavior is unchanged: nothing outside `cmd/kogen-review/main_test.go` is edited; the baseline scenario runs the tests against the current `main.go` (decision: D3, round 1) (source: request)

## Source comparison
- Request acceptance 1 (missing required flags and positional arguments return 2, usage on stderr, empty stdout): addressed by the usage scenarios and mutants (missing `-model`, accepted positional argument, usage on stdout).
- Request acceptance 2 (missing Intent or feature, invalid configuration, unresolvable start return 2 with a refusal on stderr and no stdout): addressed by the checkout scenarios and mutants (refusal on stdout, refusal exit 1, invalid configuration ignored, unresolvable start ignored).
- Out of scope (changes to command behavior or verification): preserved; the baseline scenario passes only against the unchanged `main.go`.

## Tests
- Missing required flags and a positional argument are refused with exit 2, usage on stderr and empty stdout: new table test in cmd/kogen-review/main_test.go (unit)
- An absent Intent, an absent acceptance feature, an invalid project.yaml and an unresolvable start commit are refused with exit 2, a case-specific stderr line, empty stdout and no run folder: new table test in cmd/kogen-review/main_test.go (integration)
- The new tests pass on the current command and fail on each wrong main.go: scenarios in acceptance.feature (scenario)
- The verification stops and report conversion keep passing: TestInitialVerificationStops and TestReportVerificationErrorRetainsSubmittedEvidence (existing)

## Feasibility
- none
