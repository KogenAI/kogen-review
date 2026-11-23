# Test partial verification evidence reconstruction

Slug: partial-verification-event-retention
Model: not applicable — the change only adds tests of a pure function; there is no state to model
Acceptance:
- .kogen/intents/partial-verification-event-retention/acceptance.feature
- features/steps/partial-verification-event-retention__steps.js

Add focused tests to cmd/kogen-review/main_test.go for `verificationLog.partial` in cmd/kogen-review/main.go. They must pin two behaviors: (1) given command and command_result events for completed setup commands and checks, the result keeps each completed item's name, command, status and output in the matching Setup or Checks list, each result attached to its own command even when events interleave; (2) given configured setup commands, acceptance, model verification and checks with only some completion events, every missing item is listed in NotRun in order (setup commands, acceptance, model when one is required, checks) and the model state is `none` when no model is required and `not_run` when one is required. Only cmd/kogen-review/main_test.go changes; verification and review behavior (main.go) stay as they are.

## Decisions
- The tests are added to cmd/kogen-review/main_test.go only, as ordinary Go tests that call `verificationLog.partial` directly with constructed events, config and Intent, and compare the whole returned `verify.Pass` exactly. (evidence: cmd/kogen-review/main.go; cmd/kogen-review/main_test.go) (source: request)
- No production file is changed: main.go keeps its current behavior. (source: request)
- Acceptance names no test: it runs `go test` of ./cmd/kogen-review on the real tree, then on copies of main.go (applied through `go test -overlay`, without editing the checkout) that each break one property of `partial`, and requires the tests to fail for every such copy. (assumption: mutation of main.go is an acceptable way to observe that the new tests pin the behavior) (source: request)
- The broken copies are: dropped output, wrong command, dropped status, acceptance missing from NotRun, model missing from NotRun, model always reported as none, model never reported as none, missing setup command not listed, missing check not listed. (evidence: cmd/kogen-review/main.go) (source: request)

## Source comparison
- Acceptance 1 (completed setup and check results preserved with name, command, status, output; wrong result assignment or dropped output fails): scenario "completed results are retained". (source: request)
- Acceptance 2 (missing items listed in NotRun, model state consistent with whether a model is required): scenario "missing work is listed". (source: request)
- Scope limited to cmd/kogen-review/main_test.go; no change to verification or review behavior: scenario "only the test file changes". (source: request)

## Tests
- Completed setup and check results keep name, command, status and output, each on its own command: new Go test in cmd/kogen-review/main_test.go (unit)
- Missing setup, acceptance, model and check items are listed in NotRun and the model state follows whether a model is required: new Go tests in cmd/kogen-review/main_test.go (unit)

## Feasibility
- none
