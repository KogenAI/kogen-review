# Test review role flag forwarding

Slug: review-cli-role-flag-forwarding
Model: not applicable — the change only adds a test of flag forwarding; there is no state to model
Acceptance:
- .kogen/intents/review-cli-role-flag-forwarding/acceptance.feature
- features/steps/review-cli-role-flag-forwarding__steps.js

Add a hermetic Go test to cmd/kogen-review/main_test.go that runs `run` of cmd/kogen-review/main.go against a loopback fake provider and checks that the review role flags reach the provider request. (1) With `-provider`, `-model`, `-effort` and `-base-url` supplied, the captured request carries those values as the review role; ignoring or swapping any supplied option fails the comparison. (2) With `-provider`, `-effort` and `-base-url` omitted and only `-model` supplied, the captured request uses the documented defaults, provider chatgpt and effort medium, and keeps the supplied model; empty or different defaults fail the comparison. Only cmd/kogen-review/main_test.go changes. Provider configuration and command flags stay as they are.

## Decisions
- The test is added to cmd/kogen-review/main_test.go only, as an ordinary Go test that calls `run` with a temporary Git checkout whose initial verification passes, and a loopback `httptest` server that records the first request and refuses it, so no real provider or network is used. (evidence: cmd/kogen-review/main.go; cmd/kogen-review/main_test.go) (source: request)
- No production file is changed: main.go keeps its flags and defaults. (source: request)
- The role is observed through the request on the wire: provider openai-compatible with a base URL is seen as the `<base-url>/chat/completions` route with `model` and `reasoning_effort` in the body; the default provider chatgpt is seen as the Responses route (path ending `/responses`, served through the loopback seam KOGEN_PROVIDER_URL with a fake saved credential in a temporary HOME) with `model` and `reasoning.effort` in the body. (evidence: cmd/kogen-review/main.go; cmd/kogen-review/main_test.go) (assumption: the wire route and body fields are an acceptable observation of the role the provider request carries) (source: request)
- Acceptance names no test: it runs `go test` of ./cmd/kogen-review on the real tree, then on copies of main.go (applied through `go test -overlay`, without editing the checkout) that each ignore or swap a supplied role option or change a documented default, and requires the tests to fail for every such copy. (assumption: mutation of main.go is an acceptable way to observe that the new test pins the behavior) (source: request)

## Source comparison
- Acceptance 1 (provider, model, effort and base-url supplied reach the request; ignoring or swapping any fails): scenario "supplied role flags reach the provider request". (source: request)
- Acceptance 2 (omitted optional flags use chatgpt and medium and keep the supplied model; empty or different defaults fail): scenario "omitted role flags use the documented defaults". (source: request)
- Scope limited to cmd/kogen-review/main_test.go; no provider configuration change or new flag: scenario "only the test file changes". (source: request)

## Tests
- Supplied provider, model, effort and base-url reach the provider request: new Go test in cmd/kogen-review/main_test.go (integration)
- Omitted provider and effort default to chatgpt and medium while the supplied model is kept: new Go test in cmd/kogen-review/main_test.go (integration)

## Feasibility
- none
