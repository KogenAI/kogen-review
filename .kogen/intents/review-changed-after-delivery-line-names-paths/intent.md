# Name changed paths in the review delivery line

Slug: review-changed-after-delivery-line-names-paths
Model: not applicable — the change only extends the text of one progress line with values already computed; it adds no state, transition or interacting rule
Acceptance:
- .kogen/intents/review-changed-after-delivery-line-names-paths/acceptance.feature
- features/steps/review-changed-after-delivery-line-names-paths__steps.js

When the native reviewer's verdict cannot be applied because the candidate changed after its contents were delivered, `evaluate` in `review/independent.go` prints `kogen: review <n>: the candidate changed after its contents were delivered; returning the changes to the reviewer`. A reader of the log cannot tell a formatter touch from a real edit. Observed in an AoR climb (release 30cf6619): after `kogen: pass 2: all checks passed` the line appears, followed by `review 1: approve, 0 blocking`. The paths and the diff exist (`deliverySection` builds them for the reviewer feedback), but only the reviewer sees them.

After this change the `env.Progress` call after `deliverySection` names the changed paths. Expected: `kogen: review 1: the candidate changed after its contents were delivered (app/models/x.rb, db/schema.rb); returning the changes to the reviewer`. In general the line is `kogen: review <n>: the candidate changed after its contents were delivered (<path>, <path>); returning the changes to the reviewer`. The paths are the `Changed(seen, now)` result that `deliverySection` already computes, in the order it returns them (sorted by git). At most 5 paths are named; when there are more, the first five are followed by `and N more`, N being the number of the others: `(a, b, c, d, e, and 2 more)`.

`deliverySection` returns its paths together with the feedback text, so the list is computed once and used for both the feedback and the line; no extra git call is made. Nothing else changes: when the line is printed (only when the feedback is not empty), the reviewer feedback text (byte-identical, including the full list of paths in it and the diff), verdict handling and every review decision. The line `final verification failed; continuing targeted repairs` is unchanged. Only the native reviewer prints this line.

The acceptance scenarios are listed in the Tests section as `- <rule>: <test to add or update> (<layer>)`.

## Decisions
- The progress line is `kogen: review <n>: the candidate changed after its contents were delivered (<paths>); returning the changes to the reviewer`, with the paths joined by `, ` (source: request)
- With more than 5 changed paths the line names the first five and ends the list with `, and N more` inside the parentheses, for example `(app.txt, g1.txt, g2.txt, g3.txt, g4.txt, and 2 more)` (assumption: the request names `and N more` but not its exact punctuation; the comma before `and` is a choice) (source: request)
- The reviewer feedback stays byte-identical and still lists every changed path (source: request)
- `deliverySection` returns the paths it computed so the caller does not call git again; its other caller, the resume feedback, ignores them (evidence: review/independent.go) (source: request)
- Add a focused model-free regression test in the review package, `review/delivery_progress_test.go`, over a scripted delivery through a temporary Git candidate; the existing delivery test `TestIndependentApprovalOfAnUnverifiedTreeIsVerifiedFirst` in `contract/independent_test.go` has its one-path progress expectation updated to `(app.txt)` (evidence: review/repair_progress_test.go; contract/independent_test.go) (source: request)

## Source comparison
- Addressed: the progress line names the changed paths, at most 5, then `and N more` (scenarios with three and seven changed paths).
- Addressed: paths come from the `Changed(seen, now)` result already computed, with no extra git call (the signature of `deliverySection`).
- Addressed: three changed paths print in sorted order; seven print five and `and 2 more`; the reviewer feedback is unchanged (the three acceptance scenarios, the third comparing the feedback head, diff file count and tail).
- Addressed: no change to when the line is printed, to the feedback, to verdict handling or to any review decision (boundaries above).
- Addressed: a focused model-free regression test in the review package (Tests).
- Addressed: the tests are listed as `- <rule>: <test to add or update> (<layer>)` (Tests).
- Omitted by the request: external reviewer, other progress lines, any setting or flag.

## Tests
- The delivery line names three changed paths in sorted order, five of seven then `and 2 more`, and the reviewer feedback is unchanged: add `TestTheChangedAfterDeliveryLineNamesTheChangedPaths` to `review/delivery_progress_test.go` (package review), a scripted delivery with a three-path and a seven-path case that checks the progress line and the unchanged feedback (regression)
- The single-path delivery line of the existing test names its path: update the progress expectation of `TestIndependentApprovalOfAnUnverifiedTreeIsVerifiedFirst` to `(app.txt)` (existing)
- Three changed paths are named in sorted order: the acceptance scenario `A candidate that changed in three paths after delivery names them in sorted order` (scenario)
- Seven changed paths name five and `and 2 more`: the acceptance scenario `A candidate that changed in seven paths after delivery names five of them and counts the rest` (scenario)
- The reviewer feedback is unchanged: the acceptance scenario `The reviewer feedback of a candidate that changed after delivery is unchanged` (scenario)

## Feasibility
- evidence: {"id":"delivery-observer","kind":"observer","inputs":[".kogen/intents/review-changed-after-delivery-line-names-paths/acceptance.feature","features/steps/review-changed-after-delivery-line-names-paths__steps.js"],"observers":["features/steps/review-changed-after-delivery-line-names-paths__steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/review-changed-after-delivery-line-names-paths__steps.js --control good","exit":0,"output":"delivery observer accepted controls\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/review-changed-after-delivery-line-names-paths__steps.js --control bad","exit":1,"output":"delivery observer rejected a progress line without the changed paths\n"}]}
- The wrong-implementation control patches were generated in a scratch copy of HEAD with the correct patch applied; each applies with `git apply --check` and the result builds with `go build ./...`. The acceptance driver was not run end to end by this shaping session; readiness runs it.
