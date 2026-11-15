# Record the problems of a rejected review verdict

Slug: review-rejected-verdict-records-problems
Model: not applicable — the change adds fields and one progress line to an existing log event; it adds no state, transition or interacting rule
Acceptance:
- .kogen/intents/review-rejected-verdict-records-problems/acceptance.feature
- features/steps/review-rejected-verdict-records-problems__steps.js

When a reviewer's `submit_review` verdict is rejected, the run log keeps only counters. Today `review/external.go`, in the round loop after `verdictOf`, builds `feedback = "Not a valid verdict: " + strings.Join(problems, "; ") + ...` (the text sent back is `Not a valid verdict: ...`), and `review/independent.go` (case `problems != nil`) calls `r.allowance("rejected_verdict")`. `allowance` in `review/invalid.go` records `event, review, why, rejected_verdicts, no_tool_reminders`, so the problem lines sent back to the reviewer are lost from the record.

After this change every rejected verdict records its problems, in both the external path (`review/external.go`) and the native path (`review/independent.go`, `converse`):

1. The `review_allowance` event with `why: rejected_verdict` carries `problems`: a JSON array of strings, the problem lines the reviewer is told, in order, each cut at 300 runes (plain truncation, no marker) and at most the first 10 lines.
2. Before the reviewer is asked again, the review progress (`Env.Progress`) shows exactly one line `kogen: review <n>: verdict not accepted: <first problem>`, where `<n>` is the review number and `<first problem>` is the first problem cut at 160 runes.
3. `review/invalid.go`: `allowance` takes the problems as a second argument, `allowance(why string, problems []string)`. Only `why == "rejected_verdict"` adds the `problems` field and the progress line; the call sites of `no_tool_turn` and `unread_progress_exempt` pass `nil` and their events are unchanged. The two `rejected_verdict` call sites pass the problems they already hold.

Unchanged: which verdicts are accepted or rejected, every allowance count, the text sent to the reviewer (no cut is applied to it), the final Invalid result and the `review` / `review_tool_choice` events. No configuration is added.

## Decisions
- `allowance` records `problems` and the progress line only for `rejected_verdict`; other `why` values keep their event exactly (decision: D1, round 1) (evidence: review/invalid.go; review/independent.go; review/external.go) (source: request)
- Truncation is by runes with no ellipsis: problems at 300 runes and at most 10 lines, the progress problem at 160 runes (decision: D2, round 1) (assumption: plain truncation without a marker is acceptable) (source: request)
- The progress line is emitted from `allowance`, so it appears once per rejected verdict, before the next request, and is not emitted for the second rejection, which ends the review through `invalidStop` and already records `problems` (decision: D3, round 1) (evidence: review/invalid.go; review/independent.go; review/external.go) (source: request)
- Acceptance runs a Go test file the step writes into a disposable copy of the checkout, next to the contract suite, using its fake Env, fake executor and scripted reviewer; any implementation behind `allowance` is observed through the run log events and progress lines. The failure message of each step prints that test's `go test -v` output (decision: D4, round 1) (evidence: contract/external_test.go; contract/helper_test.go; features/steps/review-reminder-reads-unread-parts__steps.js) (source: request)

## Source comparison
- Addressed: the `review_allowance` event for `rejected_verdict` carries `problems` in the external path (scenario 1) and the native path (scenario 2); the recorded lines equal the lines the reviewer is told (the step asserts equality with the feedback text and the tool output).
- Addressed: each problem cut at 300 runes, at most 10 lines, and the progress problem cut at 160 runes (scenario 3: 12 findings of 400-rune paths).
- Addressed: one progress line `kogen: review <n>: verdict not accepted: <first problem>` per rejected verdict (all scenarios assert exactly one such line).
- Addressed: the final verdict is unchanged (`approve` in every scenario) and the allowance counters are unchanged (`rejected_verdicts` 1, `no_tool_reminders` 0).
- Addressed: `no_tool_turn` and `unread_progress_exempt` events unchanged: their call sites pass `nil` and only `rejected_verdict` adds fields; existing contract tests such as `contract/independent_test.go` stay green.
- Addressed: the one wrong-implementation control is the current counters-only event.

## Tests
- A rejected external verdict records its problems in the `review_allowance` event, equal to the lines of the feedback, with one progress line and an unchanged approve: the rejected-verdict test run by the acceptance scenario, and a permanent `TestExternalRejectedVerdictRecordsItsProblems` in `contract/external_test.go` (scripted executor: a verdict without `verdict`, then approve) (integration)
- A rejected native verdict does the same, equal to the lines of the `invalid verdict:` tool output: a permanent test in `contract/independent_test.go` next to the existing rejected-verdict case, and the acceptance scenario (integration)
- Problems are cut at 300 runes and 10 lines and the progress problem at 160 runes: the third acceptance scenario (unit)
- Other allowance events and counts, the feedback text and the Invalid result are unchanged: existing `contract` and `review` tests (existing)

## Feasibility
- Probed in a scratch copy: with the change applied the Go test observes the problems, progress line and cuts of all three scenarios and approve verdicts; on the unchanged tree the same test observes allowance events without `problems` and no progress line. The step's observer controls are declared below.
- evidence: {"id":"rejected-verdict-observer","kind":"observer","inputs":["features/steps/review-rejected-verdict-records-problems__steps.js"],"observers":["features/steps/review-rejected-verdict-records-problems__steps.js"],"checks":[{"name":"good","command":"node features/steps/review-rejected-verdict-records-problems__steps.js --control good","exit":0,"output":"rejected-verdict observer accepted controls\n"},{"name":"bad","command":"node features/steps/review-rejected-verdict-records-problems__steps.js --control bad","exit":1,"output":"rejected-verdict observer rejected an allowance event without problems\n"}]}
