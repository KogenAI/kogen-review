# Stop nonconverging reviewer repairs

Slug: k-review-repair-no-progress-stop
Model: .kogen/intents/k-review-repair-no-progress-stop/model.qnt invariants=Bounded,Safe seed=17 samples=100 steps=40
Acceptance:
- .kogen/intents/k-review-repair-no-progress-stop/acceptance.feature
- features/steps/repair_progress_steps.js
- features/steps/repair_progress_observer.cjs
- features/steps/repair_progress_test.go.txt

Bound the existing same-review targeted repair loop without discarding the candidate, restarting the builder, or weakening exact-tree verification. Replace unlimited returns to the reviewer with a resumable candidate/review_blocked stop after three consecutive final failed verifications with identical failure identities, or after twenty unsuccessful repair rounds regardless of progress. Preserve every last reviewer edit, saved conversation, usage and verification evidence. This is local review orchestration, not a new provider integration or a new CLI.

## Decisions
- Stop on the third consecutive identical final failure; use a generous hard cap of twenty repair rounds. An exact verified approval wins before either stop rule. (source: request)
- Identity is the set of stage-qualified failing items in final verification evidence, not diagnostic prose, candidate tree hashes, order, duplicate entries, pass numbers or command output. A changed set, including a smaller set, starts a new streak at one. A green but stale-tree return clears the failed-set streak but consumes a repair round toward the hard cap. (source: request)
- Use the reviewer's own persistent repair-round counter for counting and Result.Repairs. Count every unsuccessful evaluation which would otherwise return to targeted repairs, including the round that triggers the stop. Approval without another repair does not increment it. Persist round count, last failure identities and streak in Session with backward-compatible zero defaults. Keep these fields through session reconstruction, Request.Retain, working-window changes, interruption and explicit blocked-review resume. Do not count resume's fresh verification as a new reviewer repair round, and do not reset its prior streak. (source: request)
- Report a normal blocking review through candidate/review_blocked, a changes record and blocking finding(s); state whether repeated failures or the hard cap caused it, total repair rounds and current failing stage/items. Save a resumable blocking checkpoint before returning, with the final pass and candidate tree; do not send the next repair request. Retain the ordinary diagnostic feedback and no-commit semantics. (source: request)
- Explicit native blocked-review Resume runs fresh verification and reopens the same conversation as today. It must allow a new reviewer decision, even when a threshold was previously reached; the next unsuccessful repair is counted against retained totals and streak. A corrected verified approval can still succeed. External review's shared evaluation must obey the bounds, without adding unsupported external exact-resume capability. (source: request)

Implementation is expected in review/independent.go's Session, run.evaluate, save/retry and restoration paths and any shared external evaluation initialization needed to use the same counter. Update relevant contract tests and documentation of the checkpoint additions. Keep useful existing tests, tool policy, verdict validation, review delivery and caller interfaces intact; additive checkpoint metadata is sufficient. The supplied acceptance adapter calls Independent.Review and Independent.Resume over the existing saved Git fixture, runs shell edits through the real review tool loop, and verifies actual app.txt contents. It uses a bounded scripted reviewer to avoid an endless baseline test. No live models or network requests are necessary.

## Source comparison
- Addressed: Request Problem and Need's unbounded same-review repair cycle are replaced by the three-failure streak and twenty-round hard cap above, read from review-owned persistent state rather than caller bookkeeping.
- Addressed: synthetic example one is acceptance 'Three identical final failures preserve the last repair': three failed final checks, last candidate bytes, blocking result, checkpoint, round count and no fourth submission.
- Addressed: synthetic progress, one-failure recovery and green-edit approval examples are the corresponding progress, once and green scenarios. Failure order and duplicate equivalence and stage identity receive focused implementation tests rather than treating diagnostics as identity.
- Addressed: explicit resume and interruption persistence examples are the resume scenario's JSON checkpoint round-trip, fresh verification, same conversation and retained count stopping the next identical failure at round four. Add interruption-at-save regression coverage as listed below.
- Addressed: generous cap applies even with changing failures, exercised by the cap scenario. A green stale-tree return remains ordinary targeted feedback below the cap.
- No requested behavior is deliberately omitted or superseded. Existing External.Resume explicitly refuses exact resume; this contract preserves that capability boundary rather than inventing a new external executor protocol. The requested existing same-conversation blocked resume is native Independent.Resume.
- Preserved: requested slug k-review-repair-no-progress-stop, Intent paths, features/steps location, configured checks and README saved-candidate API; no .kogen/project.yaml edits are required. CLI repair_unverified behavior is not replaced.

## Tests
- Three identical final failure sets stop at round three with preserved edits and named failures: saved-candidate same scenario and a focused threshold test at rounds two and three (regression)
- Changing or shrinking failure sets reset the streak without a premature stop: progress scenario and set-identity unit tests covering reordered/duplicate items and different stages (integration)
- Twenty unsuccessful repairs stop even with changing sets or green stale-tree returns: cap scenario and boundary tests for nineteen/twenty rounds (integration)
- One failed repair then green approval and all-green reviewer edits retain current round counts and exact-tree approval: once and green scenarios and existing exact-tree tests (integration)
- Stop saves a blocking verdict and checkpoint, names current failing items and rounds, preserves candidate and opens no next model request: same and cap scenarios plus contract stop record assertions (integration)
- Explicit resume reuses the same conversation and freshly verifies without resetting counters; subsequent approval succeeds or another identical failed repair stops again: resume scenario plus focused resume-to-approval regression (integration)
- Interruption and working-window/session serialization preserve count and streak without recounting the same completed verification: checkpoint round-trip scenario and checkpoint-boundary interruption/Retain regression tests (regression)
- Shared external verdict evaluation observes repair limits without changing external resume capabilities: existing external harness with repeated failure and cap cases (integration)

## Feasibility
- Local module inspection via go doc confirmed verify.Pass supplies Tree, Green and Failing and the existing fixture can supply verification results (probe: exit 0, 0.2 s). No external protocol or provider change is involved.
- Initial Quint draft rejected unparenthesized Boolean update precedence (exit 1); corrected final model typechecked (exit 0, 0.3 s).
- evidence: {"id":"repair-observer","kind":"observer","inputs":["features/steps/repair_progress_observer.cjs"],"observers":["features/steps/repair_progress_observer.cjs"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/repair_progress_observer.cjs good","exit":0,"output":"observer accepted\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/repair_progress_observer.cjs bad","exit":1,"output":"observer rejected every altered guarantee\n"}]}
