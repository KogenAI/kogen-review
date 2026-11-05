# Record the non-reproducing probe run finding

Slug: fix-k-review-unrun-evidence-not-met
Model: not applicable — no production code changes; the Intent records a review finding that does not reproduce and pins it with an existing test
Acceptance:
- .kogen/intents/fix-k-review-unrun-evidence-not-met/acceptance.feature
- features/steps/fix-k-review-unrun-evidence-not-met__steps.js

This answers a review finding on the landed commit of k-review-unrun-evidence-not-met (`review/independent.go`, `converse`). The finding says that `ProbeRuns` is appended only inside `if edits`. So when `edits` is false, a shell probe would get no run, `latestRun` would fall back, and a successful probe would be refused as having no exit status. The finding asks for the ProbeRun to be appended unconditionally.

The scenario does not reproduce on main (c8e7857). In `converse`, `edits := call.Name == "write_file" || call.Name == "shell"` (review/independent.go line 836). A probe is recorded only when `call.Name == "shell"` and the `command` argument is non-empty (line 848), so every probe also has `edits` true. Its `ProbeRun{Command, Status, Tree}` is therefore always appended (lines 857-863). `edits` is false only for calls that are not `shell`, and those are never probes. A successful shell probe always has its own ProbeRun with its exit status, so `latestRun` never falls back to a run without one. The existing `TestIndependentReviewRecordsItsProbesAndRequirements` (contract/independent_test.go) already shows this end to end through `review.Independent{}.Review`. A `shell` call of `cat app.txt` is recorded as `ProbeRun{Command: "cat app.txt", Status: 0, Tree: <current tree>}`, and an approval whose requirement cites that probe as evidence is accepted.

As the request directs for a scenario that does not hold, there is no code change. `review/independent.go`, every other production file, every Go test, the prompts and the golden files stay byte-identical. The Build adds nothing beyond this Intent and its acceptance files. The acceptance runs the existing test by name in package `./contract` (`go test -count=1 -run '^TestIndependentReviewRecordsItsProbesAndRequirements$' -v ./contract`) and requires it to have run and passed. It passes on the unchanged tree, because the reported failure does not exist.

## Decisions
- The reported scenario does not reproduce on main: every shell probe also sets `edits`, so its ProbeRun is always appended (evidence: review/independent.go) (source: request)
- A successful shell probe that is cited as evidence is already recorded with exit status 0 and the current tree and is accepted (evidence: ran `go test -count=1 -run '^TestIndependentReviewRecordsItsProbesAndRequirements$' -v ./contract`, `--- PASS`) (source: request)
- Stop with no code change: do not move the append, add no production code and add no new Go test, because a new regression test must fail on the unfixed behavior and nothing here is unfixed (evidence: contract/independent_test.go, docs/testing-rules.md section 4) (source: request)

## Source comparison
- Addressed: Problem (`ProbeRuns` appended only inside `if edits`; without edits a shell probe gets no run and a successful probe is refused with no exit status). It was checked on main and does not hold: `edits` is true for every `shell` call (line 836), and probes are only `shell` calls (line 848).
- Addressed: Need 1 ("First reproduce it ... If the scenario does not hold on main, stop and report that it does not reproduce (no code change)"). That branch applies. This Intent is the report, and there is no code change.
- Omitted, by Need 1's stop branch: Need 2 ("Append the ProbeRun unconditionally"). There is no failing test for it to make pass, and the change would not alter behavior.
- Addressed: Need 3 ("Keep every existing test green; no unrelated changes"). Nothing changes, and the configured checks run the whole suite.

## Tests
- A successful shell probe in the native review is recorded with its exit status and current tree, and an approval citing it is accepted: existing `TestIndependentReviewRecordsItsProbesAndRequirements` in `contract/independent_test.go`, which the acceptance scenario runs by name (existing)
- Every other behavior stays unchanged: the existing suite through the configured checks (existing)

## Feasibility
- none
