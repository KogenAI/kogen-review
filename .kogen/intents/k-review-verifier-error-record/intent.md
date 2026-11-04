# Preserve submitted reviews on verification errors

Slug: k-review-verifier-error-record
Model: .kogen/intents/k-review-verifier-error-record/model.qnt invariants=Unverified seed=17 samples=100 steps=10
Acceptance:
- .kogen/intents/k-review-verifier-error-record/acceptance.feature
- features/steps/k-review-verifier-error-record__steps.js

Preserve the latest actual submitted review when a later verification operation returns an error. Return its submitted Record, exact candidate tree, findings and number of completed repair cycles alongside the original error. This replaces empty Result returns that erase that evidence. Do not infer a record when none was submitted. Preserve native and external library behavior and resume paths where applicable; do not change verifier policy, retry limits, blocking semantics or successful exact-tree approval requirements.

Result.Record is the submitted decision, not proof of final approval: an error still means unsuccessful review. Never return a green approval pass for an unverified tree. Keep the Result API; document its error-bearing Record semantics. Do not overwrite the returned submitted verdict with the progress-only pending verdict. Only completed repair rounds count: an errored Verify does not complete another round.

The standalone report continues to use top-level verdict error for verification stops, with nonzero exit and its original error class, reason, detail and lines. Populate top-level findings and tree from the retained submission. Add submitted to every result JSON line: null without a submitted record, otherwise exactly {verdict, findings, tree}. This separates submitted approve from command approval. Populate it on success and blocked results too. Keep existing keys and ordinary changes/review_blocked behavior, and update README's stdout contract. Never include conversation or secrets. The standalone verifier still refuses repairs with review/repair_unverified; do not enable repair verification in that command.

## Decisions
- Retain submitted approve as evidence without final approval and keep command failure (source: request)
- Preserve exact notes, blocking findings, edited tree and completed count, without reconstructing absent records (source: request)

## Source comparison
- Addressed: Problem and Need are covered by retained Result.Record, original error, unchanged failure/approval gate and standalone submitted distinction above; the nullable submitted object is the settled technical representation.
- Addressed: synthetic cases 1–5 appear individually in acceptance.feature: wrong to right, exact Corrected the count note at value.txt:1, unavailable error, exact-tree success with zero extra repairs, two completed cycles and latest tree, no submission, and blocking changes.
- Addressed: automatic retry's reported uppercase Pass contradiction is corrected: observer reads producer JSON Pass.tree and Pass.green, not Pass.Tree or Pass.Green; controls reject uppercase-only evidence. No production serialization aliases are requested.
- Addressed: standalone result is exercised through its real report function in cmd/kogen-review, paired with real Independent.Review over Git via an independent overlay test harness. No provider protocol changes are requested.
- Omitted: no requested behavior is intentionally removed. The harness uses an overlay, not builder-invented tests or changes to protected acceptance. Historical provider/UI examples are unrelated and confer no scope.

## Tests
- Retain submitted approve, note, edited Git tree and original unavailable error with no approval: scripted Git review regression (regression)
- Successful verification of the exact submitted tree returns once with one finding and zero extra cycles: scripted green Git review (integration)
- Two completed red verification cycles followed by unavailable preserve count two and latest tree: bounded scripted repair loop (regression)
- Failure before submission has no invented record or findings and reports submitted null: scripted pre-submission stop (integration)
- Blocking changes retains blocking findings, blocked error and nonzero status: scripted blocked review (regression)
- Standalone output retains error status while exposing submitted evidence, tree, findings and count: real report boundary in independent overlay harness (integration)
- Resume and external verification-error results follow the retained-record contract: add focused implementation regressions using existing local fixtures (regression)

## Feasibility
- evidence: {"id":"record-observer","kind":"observer","inputs":["features/steps/k-review-verifier-error-record__steps.js"],"observers":["features/steps/k-review-verifier-error-record__steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/k-review-verifier-error-record__steps.js good","exit":0,"output":"observer controls passed\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/k-review-verifier-error-record__steps.js bad","exit":1,"output":"rejected uppercase pass\n"}]}
