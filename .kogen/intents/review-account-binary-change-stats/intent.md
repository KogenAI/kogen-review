# Cover binary and mode-only account totals

Slug: review-account-binary-change-stats
Model: not applicable — this change adds regression tests for existing calculations, not state or transitions
Acceptance:
- .kogen/intents/review-account-binary-change-stats/acceptance.feature
- features/steps/review-account-binary-change-stats__steps.js
- features/steps/review-account-binary-change-stats__observer.js

Add regression coverage for account effect totals on binary and mode-only changes, limited to `contract/independent_test.go` and `review/account_test.go`. Preserve useful existing tests. Do not change account fields, production accounting, or Git diff behavior.

Original request record:
> Evidence: ev-8854ae1a review/account.go documents that a binary numstat column of - counts as 0, and effectOf records changed-file and line totals from Git numstat. contract/independent_test.go checks account totals for a text repair, but does not check binary or mode-only changes.
>
> Expected: Add regression coverage for account effect totals on binary and mode-only changes.
>
> Scope: contract/independent_test.go and review/account_test.go. Out of scope: changes to account fields or Git diff behavior.
>
> Acceptance:
> 1. A repair that changes one binary file records one changed file and zero added or deleted lines. Wrong-implementation: counting the binary placeholder as a number or omitting the file would fail the asserted totals.
> 2. A mode-only repair records one changed file and zero added or deleted lines. Wrong-implementation: treating a mode change as a content change or no change would fail the asserted totals.

## Decisions
- Keep implementation changes confined to contract/independent_test.go and review/account_test.go; account fields and Git diff behavior remain unchanged. (decision: D1, round 1) (evidence: review/account.go; review/account_test.go; contract/independent_test.go) (source: request)
- Regression tests in both scoped files assert that binary and mode-only repairs each record one changed file and zero added or deleted lines. (decision: D4, round 1) (evidence: review/account.go; review/account_test.go; contract/independent_test.go) (revises: D2 because State the requested observable totals without mandating a fixture design) (source: request)
- The asserted totals catch counting the binary placeholder as a number or omitting the file, and treating a mode change as a content change or no change. (decision: D5, round 1) (evidence: review/account.go; review/account_test.go; contract/independent_test.go) (revises: D3 because State the requested counterexamples without making harness mechanics product requirements) (source: request)

## Source comparison
- Addressed: Request evidence ev-8854ae1a and review/account.go's binary placeholder handling are retained in the request record above; Decisions D1, D4 and D5 and acceptance.feature's Binary scenario require coverage that catches counting the placeholder numerically and omitting its file.
- Addressed: Request acceptance 1's one changed file and zero added/deleted lines are the Binary scenario's explicit totals. Request acceptance 2's same totals for a mode-only repair and its content/no-change counterexamples are the Mode-only scenario's explicit totals and two mutations.
- Addressed: Request scope paths contract/independent_test.go and review/account_test.go are the only implementation paths in this contract; both must reject each faulty accounting behavior. D4 requires account-effect totals, not a particular fixture design. The existing local Git and review harnesses are available for constructing those repairs.
- Addressed: Request exclusions on account fields and Git diff behavior are preserved by D1. No production behavior is replaced or removed. Acceptance-only observers and controls are protected proof artifacts, not requested production edits.
- Omitted: no requested behavior or settled non-secret input. Conflicting: none. Superseded: none.

## Tests
- Binary repair totals: add regression coverage of binary repair account totals in review/account_test.go and contract/independent_test.go; the Binary acceptance scenario requires both files to catch omitted-file and numeric-placeholder mutations (regression)
- Mode-only repair totals: add regression coverage of mode-only repair account totals in review/account_test.go and contract/independent_test.go; the Mode-only acceptance scenario requires both files to catch omitted-file and spurious-content mutations (regression)
- Preserve existing behavior: keep the existing text-repair and attempt accounting tests passing, along with the configured Go checks (existing)

The acceptance harness uses scratch mutations as evidence of regression effectiveness, not as delivered Git behavior. Its runtime cancellation uses the native 120-second per-step acceptance limit, not a requested product performance bound. It selects test names from the current scoped files.

## Feasibility
- Local Git fixture probe: the bounded correct overlay's two added Go tests passed for binary and mode-only effects through effectOf and review.Independent.Review (probe: exit 0, 1.8 s). No external provider or network capability is introduced.
- The observer fixture retains real go test -json output from existing TestAttemptOfSumsAndDividesTheFigures and TestIndependentReviewApprovesTheGreenPass runs, followed by runs of those same tests with deliberate failing assertions. This qualifies parsing of real successful and failed named-test events rather than synthetic runner summaries (probe: exit 0, 1.8 s).
- evidence: {"id":"test-output-observer","kind":"observer","inputs":[".kogen/intents/review-account-binary-change-stats/observer-output.json"],"observers":["features/steps/review-account-binary-change-stats__observer.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/review-account-binary-change-stats__observer.js good","exit":0,"output":"observer accepted\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/review-account-binary-change-stats__observer.js bad","exit":1,"output":"observer rejected\n"}]}
