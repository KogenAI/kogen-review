# Unpin Display integral float rendering

Slug: k-review-display-float-unpinned
Model: not applicable — this narrows a test contract and documentation, without changing runtime state
Acceptance:
- .kogen/intents/k-review-display-float-unpinned/acceptance.feature
- features/steps/k-review-display-float-unpinned__steps.js

Remove the `{float64(3), "3"}` expectation from `consumes/kogen-executor/core_test.go` TestDisplay, not replace it with `"3.0"`. Retain the signature in api_test.go and useful nil, string, json.Number and finding path/line/message coverage. Keep json.Number("12") -> "12" and json.Number("1.50") -> "1.50"; float64(2.5) -> "2.5" may remain. Do not add expectations for integral or exponent floats. Update the README's What it pins entry to describe the narrower Display contract and explicitly say it does not pin integral or exponent float rendering. Do not change production review formatting, executor, dependency pins, or other consumes contracts.

## Decisions
- Float formatting belongs to executor; this row only unpins it. Choosing `review: path:12: message` versus `review: path:12.0: message` for float64 finding lines is a separate row, not this change. (source: request)
- Keep nil, strings and json.Number text; retain existing other useful unchanged cases, including 2.5. (source: request)

## Source comparison
- Addressed: request Need and Acceptance are implemented by narrowing TestDisplay, retaining the compile-time API, updating the README and running the actual consumer tests against pinned 09eabaf5b7dc and supplied main 11024a9; see prose, Tests and acceptance scenarios. Main is fixed to v0.0.0-20261103215046-11024a948009, not a moving branch.
- Addressed historical reproduction: request identifies executor 64ffa58 (core-display-float-parity), parent 70ceb5a, consumer 81d3bae, bisect 09eabaf5b7dc..11024a9, and `core.Display: got "3.0", want "3"`. These are reported historical observations, not rerun claims. The main-versus-pinned scenario reproduces the actual incompatible expectation, including float64(3), without implementing executor's Elixir 1.20 shortest-round-trip/fractional-part/fixed-versus-exponent rules here.
- Addressed scope: existing review code composes invalid finding lines with core.Display for path, line and message (now independent.go:446); decoding uses UseNumber. The requested example `path:12.0: message` is executor's intended result, not new review output acceptance. No runtime formatting decision is authorized.
- Addressed external acceptance: retain `consumer-check.sh github.com/KogenAI/kogen-executor <executor-main-checkout> <mirrors> 'kogen-review|<fix-sha>|.|'` rc=0 as the post-commit consumer acceptance command. That script, mirrors and future fix-sha are not present in this checkout; do not claim to have run it or invent their values. Local executable acceptance runs the full Go suite against the exact supplied main in a disposable module, in addition to TestDisplay against both versions. This is local evidence, not a claim that the external script ran.
- Omitted: no requested product behavior. Superseded: the consumes suite's old integral-float expectation only. README currently names core.Display generically, so make the boundary explicit rather than claiming an existing literal integral-float phrase was found.

## Tests
- Remove the old integral-float consumer expectation while retaining nil, strings, json.Number text and useful unchanged finding values: update existing TestDisplay (regression)
- Compatibility with pinned 09eabaf5b7dc and main 11024a9: run TestDisplay in disposable copies against each exact version (integration)
- Preserve other consumer and review behavior against supplied main: run go test ./... in the main-version copy (integration)
- Document the narrower Display contract: check the README explicitly disclaims integral and exponent float rendering (regression)

## Feasibility
- Probe observed the existing TestDisplay pass at the pinned version using go test -json, and resolved supplied main 11024a9 to v0.0.0-20261103215046-11024a948009. consumer-check.sh was not found by command lookup or the targeted /tmp and /home/lanes search (exit 0, 10.3 s). No external provider/protocol behavior is changed.
- evidence: {"id":"test-observer","kind":"observer","inputs":["features/steps/k-review-display-float-unpinned__steps.js"],"observers":["features/steps/k-review-display-float-unpinned__steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/k-review-display-float-unpinned__steps.js good","exit":0,"output":"observer accepted\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/k-review-display-float-unpinned__steps.js bad","exit":1,"output":"observer rejected\n"}]}
