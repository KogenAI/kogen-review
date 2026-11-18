# Pin the reminder wording, forced tool and cap

Slug: climb-review-900
Model: not applicable — reminderTool and reminderText are pure functions of their arguments with no state
Acceptance:
- .kogen/intents/climb-review-900/acceptance.feature
- features/steps/climb-review-900__steps.js

The reminder that the reviewer sends after a turn without a valid verdict (`reminderTool` and `reminderText` in `review/reminder.go`) has no direct test, so a change of its wording, of the forced tool or of the cap of 8 named unread parts would pass the suite unnoticed. Add one new file, `review/reminder_test.go`, with model-free unit tests in package `review` that pin today's behaviour. It must be self-contained (it may not use helpers from other test files) and use no model, network or Studio tooling. Production code, other tests, golden files and configuration stay unchanged; the tests pass on the current code.

The tests pin exactly this behaviour of the current code:
- `reminderTool` returns `read_file` when one unread part is given, and `SubmitReviewTool` when none is given.
- `reminderText` with the problems `first problem` and `second problem` and no unread parts returns exactly `Not a valid verdict: first problem; second problem. Call submit_review.`.
- `reminderText` with the problem `unread parts` and the unread ids `p1`, `p2` returns exactly `Not a valid verdict: unread parts. 2 pinned part(s) unread; call read_file on p1, p2 before a verdict.`.
- `reminderText` with ten unread ids p1 to p10 (and the problem `unread parts`) names exactly p1 to p8 in order, does not name p9 or p10, and still states the count 10.

The acceptance feature runs the new test file alone (a Go overlay hides the package's other test files) against the current `review/reminder.go` and against deliberately wrong copies of it, and requires the tests to pass on the first (at least one passing test, none failing or skipped) and fail on each wrong copy; it also requires that the new test file is the only file added outside the Intent.

## Decisions
- Add one file, review/reminder_test.go, in package review, and change no production code, other test, golden file or configuration. (constraint: tests only) (constraint: one new file) (evidence: review/reminder.go) (source: request)
- Acceptance runs the new test file alone via a Go overlay hiding other review test files and judges it by mutating a scratch overlay copy of reminder.go, so no test name must be invented by the Build. (decision: D2, round 1) (constraint: the new test file must be self-contained) (evidence: review/reminder.go) (assumption: a local scratch run (not a Kogen probe) showed the overlay approach works in about 3 s for 8 scenarios; Kogen's own readiness is authoritative) (source: request)
- The tests assert exact full reminder strings for the no-unread, two-unread and ten-unread cases. (decision: D3, round 1) (constraint: no substring-only assertions) (evidence: review/reminder.go) (assumption: none) (source: request)
- Add one file, review/reminder_test.go, in package review, and change no production code, other test, golden file or configuration. (decision: D1, round 1) (constraint: tests only) (constraint: one new file) (evidence: review/reminder.go) (assumption: none beyond the request) (source: request)
- Require at least 4 passed tests (test functions or subtests) in the new file. (decision: D4, round 1) (constraint: at least 4 passing tests, none failing or skipped) (assumption: the reference suite is assumed to hold one test per listed behaviour) (source: request)

## Source comparison
- Addressed: reminderTool read_file with one unread part and SubmitReviewTool with none (scenarios "The new tests pass on the current reminder code" and "A reminder that never forces read_file is noticed").
- Addressed: exact text `Not a valid verdict: first problem; second problem. Call submit_review.` (scenario "A changed separator between problems is noticed").
- Addressed: exact text `Not a valid verdict: unread parts. 2 pinned part(s) unread; call read_file on p1, p2 before a verdict.` with count and id order (scenarios "A dropped count of unread parts is noticed" and "Reordered unread ids are noticed").
- Addressed: ten unread ids p1 to p10 name only p1 to p8, keep the count 10 (scenarios "A removed cap on the named unread ids is noticed" and "A cap applied to the count instead of the names is noticed").
- Addressed: tests only, one new file, production code, other tests, golden files and configuration unchanged (scenario "Only the one test file is added"). gofmt, go vet and go test for the whole module are the configured project checks.
- Addressed (correction of a builder-reported stop, unproven): the last step passed only when `git status` listed the test file as untracked; in Kogen's verification copy the file existed but git status showed nothing outside .kogen/ and features/steps/, so the step could not pass. It now accepts the test file untracked, staged or already committed: anything else pending outside those directories fails, and a committed candidate must add only the test file over its parent commit. The scenario, the Intent's scope and the other steps are unchanged.
- Omitted: the request's reference patch and its measured deltas are lower-authority evidence about the reference run, not scope; recorded verbatim: `"train_mean": 1.0,` `"train_base": 0.0,` `"test_mean": 1.0,` `"test_base": 0.0,` `"outcome": "keep",` `"p_train": 0.03,` `"p_test": 0.03`.

## Tests
- reminderTool forces read_file while a part is unread and submit_review otherwise: reminderTool with one and with no unread part (unit)
- reminderText joins problems with a semicolon and a space and ends with Call submit_review. when nothing is unread: exact string for two problems (unit)
- reminderText states the unread count and names the unread ids in order: exact string for two unread ids (unit)
- reminderText names at most 8 unread ids but still states the full count: exact string and absence of p9 and p10 for ten unread ids p1 to p10 (unit)
- Existing tests keep passing and nothing else changes: configured format, compile, vet and go-test checks (existing)

## Feasibility
- none
