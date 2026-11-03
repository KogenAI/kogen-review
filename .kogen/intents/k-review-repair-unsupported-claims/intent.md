# Repair unsupported candidate claims

Slug: k-review-repair-unsupported-claims
Model: not applicable — this changes model-facing review policy, not the review lifecycle or verdict state machine
Acceptance:
- .kogen/intents/k-review-repair-unsupported-claims/acceptance.feature
- features/steps/unsupported_claim_steps.js
- features/steps/claim_policy/main.go

Make unsupported candidate-authored prose a scoped repair rather than a reason to stop a Build when the approved Intent does not require the claimed outcome. This includes documentation, comments and changelog figures such as speedups, counts and coverage. Remove the unsupported statement or restate only what the review actually measured, verify the repair through the existing verification flow, and approve when no substantive blockers remain. Do not invent measurements. An unmet required outcome remains blocking; removing the claim cannot satisfy it. Protected files remain uneditable. This is a policy change, not a new claim parser, benchmark service, verdict filter, review round or public API.

## Decisions
- Distinguish the approved Intent's requirements from incidental candidate-authored claims by consulting the approved Intent and actual review evidence. (source: request)
- Preserve blocking findings for unmet Intent requirements and protected-file defects; preserve unchanged approval without an extra round for a correct candidate. (source: request)
- Apply the rule to both native and external review, including source-parts delivery. (source: request)

## Source comparison
- Addressed: Request Problem and Need, candidate-authored documentation/comment/changelog claims and numeric figures, are covered by the repair policy above and executable policy examples below; generic existing repair language is insufficient to settle this distinction.
- Addressed: synthetic examples README "this is 3x faster", measured about 1.1x, Intent silent on performance versus requiring at least 2x, false comment, protected path, and no unsupported statement are preserved in acceptance.feature's exact policy examples.
- Addressed: existing blocking behaviour and Build preservation are unchanged; no further builder cycle or protection override is introduced.
- Omitted: none of the requested outcomes. The deterministic acceptance observes the model-facing policy, not stochastic model compliance; implementation regression tests also cover delivery to both reviewer routes. No live provider probe is required for this policy-only change.

## Tests
- Unsupported optional candidate-authored prose is repaired and verified before approval: exact public ReviewerInstructions output examples for README, comments and numeric figures (regression)
- Required outcomes cannot be satisfied by editing away a false claim: exact public policy example naming the 2x requirement and 1.1x measurement (regression)
- Protection overrides repair permission: exact public policy example requiring a blocking finding naming the protected path (regression)
- Correct candidates need no edit or extra round: exact public policy example (regression)
- Both native and external whole/parts delivery carry the same rule: update policy delivery tests through ReviewerInstructions and fake external executor requests, retaining existing lifecycle verification tests (integration)
- Existing exact-tree repair verification and verdict validation remain intact: existing contract suite and configured checks (existing)

The acceptance sentences are required model-facing policy text, in addition to any concise general explanation the implementation needs. Keep existing useful tests; deliberately update prompt golden bytes and policy hash assertions affected by this approved policy edit using the README's documented golden procedure. Do not alter the submit_review schema or runtime verdict semantics. Regression delivery tests must exercise actual outgoing external prompts, not merely source-file searches. Existing repair verification is reused rather than replaced.

## Feasibility
- Local toolchain inspected: go version reported go1.27.2 darwin/arm64; go list -m reported github.com/KogenAI/kogen-review (probe: exit 0, 0.1 s). No external dependency or protocol change; no capability obligations.
