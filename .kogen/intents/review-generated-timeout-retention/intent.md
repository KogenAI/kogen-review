# Pin generated-file behavior on a regeneration

Slug: review-generated-timeout-retention
Model: not applicable — the change adds a test of existing behavior; there is no state machine to model
Acceptance:
- .kogen/intents/review-generated-timeout-retention/acceptance.feature
- features/steps/review-generated-timeout-retention__steps.js

This feature adds a model-free Go test to `review/parts_catalog_test.go` that pins what `regenerate` in `review/generated.go` does when a regenerating command does not finish within `regenerateLimit`. The test lowers `regenerateLimit` temporarily, restores it afterwards, and reviews in parts a candidate with a large generated file whose regenerating command blocks. It confirms that the review finishes after the timeout, that the file's outcome is `kept`, that no finding claims the file mismatches (the review is approved with no findings), and that the file's full text remains in the review source and in the parts sent to the reviewer. The code in `review/generated.go` already behaves this way (its `!ran` branch sets `kept`), so production code is unchanged.

Out of scope and unchanged: the regeneration time limit value, the command environment, and the generated-file mismatch policy. No setting, flag or helper is added to production code.

## Decisions
- A timed-out regeneration keeps the full generated-file text in review material, records its outcome as kept, and does not claim that the file mismatches. (constraint: only review/parts_catalog_test.go gains a test; review/generated.go is unchanged) (evidence: review/generated.go; review/parts_catalog_test.go) (source: request)
- The test lowers the package variable regenerateLimit for its own duration and restores it with t.Cleanup; the production value of two minutes is untouched. (decision: D2, round 1) (evidence: review/generated.go) (source: request)
- The blocking generator is `exec sleep 30`, so the shell is replaced and the deadline kill stops the command itself; the test asserts that the review finishes well before the command would. (decision: D3, round 1) (evidence: review/generated.go) (assumption: the sleep length and the 20 second bound on the review are test fixture values, not product behavior) (source: request)
- Acceptance observes the behavior without naming a test the Build must invent: a copy of the checkout gets a wrong timeout behavior written into review/generated.go (the timeout reported as a mismatch, or the timed-out file's text left out of the review source) and the tests of the review package must fail in that copy. The unchanged tree passes both, so both scenarios fail until the test is added. (decision: D4, round 1) (evidence: review/generated.go; review/parts_catalog_test.go) (source: request)
- Only review/parts_catalog_test.go gains a test; review/generated.go is unchanged because it already keeps a timed-out generated file with no mismatch. (decision: D1, round 1) (constraint: Production code unchanged) (constraint: regenerateLimit lowered only inside the test and restored) (evidence: review/generated.go; review/parts_catalog_test.go) (assumption: A scratch run in a copy outside the checkout showed the new test passes on the unchanged production code and fails under both wrong mutants; those runs are not Kogen's retained evidence.) (source: request)

## Source comparison
- Request acceptance 1 (a blocking generator finishes after the lowered limit with outcome kept and no mismatch finding; treating a timeout as different output is wrong): addressed by the new test and the scenario "A timed-out regeneration is not reported as a mismatch".
- Request acceptance 2 (the generated file's full text remains in the review source after a timeout; omitting it is wrong): addressed by the new test and the scenario "A timed-out regeneration keeps the full text of the generated file".
- Out of scope as the request states: the regeneration time limit, the command environment, the generated-file mismatch policy.

## Tests
- A timed-out regeneration finishes after the limit with outcome kept, no mismatch finding, and the full text in the review source: add TestReviewInPartsKeepsAGeneratedFileWhoseRegenerationTimesOut to review/parts_catalog_test.go (integration)
- The tests of the review package fail when a timed-out regeneration is reported as a mismatch or its text is left out: acceptance.feature (scenario)

## Feasibility
- none
