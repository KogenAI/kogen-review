# Verify saved candidates before review

Slug: k-review-saved-candidate-check-evidence
Model: .kogen/intents/k-review-saved-candidate-check-evidence/model.qnt invariants=ExactGreen seed=1 samples=30 steps=8
Acceptance:
- .kogen/intents/k-review-saved-candidate-check-evidence/acceptance.feature
- features/steps/k-review-saved-candidate-check-evidence__steps.js

Replace the fabricated `verify.Pass{N: 1, Clean: true, Green: true, Tree: tree}` in `cmd/kogen-review/main.go` with actual initial verification through the pinned kogen-verification ordinary whole-Intent verification path. The existing native reviewer remains a reviewer of green inputs, not invented evidence. Verify the exact current checkout tree, not merely start or HEAD. No external pass-record input is added: the requested alternative is satisfied by ordinary configured verification on each invocation. Do not implement a repair-verification cycle; `env.Verify` continues to refuse repairs with `review/repair_unverified`.

Run configured setup, acceptance, applicable Intent model and project checks using existing verification semantics, ordering, scratch isolation, process cleanup and execution bounds. Do not weaken checks, remove the protected baseline, modify the candidate with fixers merely to obtain initial green, or treat presence of test files as execution. Keep fixer declarations in review material, but initial evidence uses the verification-only path. Freeze and guard approved Intent/acceptance/model, configured protection and configuration bytes for the invocation. Recheck exact tree identity before reviewer entry; verification-time mutations or later drift cannot authorize review of different bytes. Preserve the Build-facing reviewer contract and ordinary verification behavior outside this entry point.

Retain `initial-verification.json` in the existing external run directory. Its public shape is `{ "state": "passed|failed|unavailable|no_checks", "pass": <verify.Pass JSON> }`, with additional diagnostic fields permitted. Use pinned producer JSON field names (`tree`, `green`, `checks`, `not_run`, etc.). Record actual command names, command text, exits and outputs; retain observed failures and declared items not reached. Never fabricate executions or passed acceptance from a feature file. Partial infrastructure results remain inspectable rather than discarded into a zero-valued green pass. The record's tree is the observed current candidate tree even when checks cannot execute.

Only complete actual successful verification with a real applicable verification obligation has state `passed` and enters the reviewer. A missing executable is `unavailable`: preserve observed shell exit/diagnostic without claiming the underlying assertion ran. A red assertion is `failed`. If no checks, scenarios or applicable model are intentionally declared, state is `no_checks`, green is false, with no invented commands. Distinguish declared-but-unrun checks. Non-green initial outcomes stop before any provider request, return the existing one-line stdout result with verdict `error`, non-null explicit verification error and nonzero exit, and retain the run directory and evidence. Surface actual red or verification limitation and unrun items in error detail/lines or stderr, not solely a generic stop. Green continues to existing review, passing the actual pass and its tree into `review.Input`; material identifies actual successful checks. Preserve usage errors, JSON result keys, role flags and no-commit behavior. Update README's obsolete assumed-pass sentence.

## Decisions
- Obtain initial provenance by ordinary configured verification rather than adding a supplied-record flag, choosing the first of the request's permitted alternatives (source: request)
- Stop explicitly before the reviewer for red, unavailable or intentionally empty verification; never describe these as following green (source: request)
- Keep repair verification unavailable and existing reviewer role/CLI result behavior otherwise unchanged (source: request)
- Use tiny saved Git repositories and a loopback scripted OpenAI-compatible reviewer, never a live provider (source: request)

## Source comparison
- Addressed: request Problem and Need, invented verification and exact-tree binding, by per-invocation verification, guarded identity, retained initial record and non-green stop above; replaces main.go:130's empty synthetic pass and README's assumed-pass sentence.
- Addressed: synthetic cases 1–3, `value.txt` values `wrong` and `right`, and exact command `python3 -c 'from pathlib import Path; assert Path("value.txt").read_text().strip() == "right"'`, by the first three scenarios and owned fixture's `value` check. The later `true` check observes the required unrun tail, not a replacement for the assertion. Staged working-tree edits keep start HEAD fixed and demonstrate that start-tree green cannot qualify changed bytes.
- Addressed: synthetic cases 4–5 by missing-python and intentionally-empty scenarios, zero assertion invocations, distinct states and no reviewer calls. Empty declaration is not successful verification.
- Addressed: ordinary checks, protected baseline and execution bounds by verification-only producer path and existing guards/bounds; repair-verification exclusion retained above.
- Omitted alternative, not conflicting: supplied verification-record ingestion is not added because Need permits ordinary configured verification OR validation of an actual supplied record. Each invocation establishes fresh evidence; prior green records are not consumed as authority.
- Superseded: current code and consumes/kogen-verification/pass_test.go commentary describing a constructed standalone pass are historical behavior. Keep useful producer format/API tests; update obsolete standalone expectations without weakening configured checks.

## Tests
- Red assertion must never become initial green: unchanged wrong-value saved CLI regression, no reviewer requests, retained failure/unrun evidence (regression).
- Success identifies executed check and exact tree in review material and record: right-value saved CLI and process audit (scenario).
- Changed contents cannot inherit green: consecutive right then wrong invocations against one checkout, fixed start and distinct current trees (integration).
- Missing executable exposes infrastructure/unrun evidence with no assertion invocation: PATH-isolated saved CLI (scenario).
- Empty declarations remain distinct and add no executions: no-check saved CLI (scenario).
- Ordinary whole verification, acceptance/model, protection and bounds remain intact: retain verification consumes and reviewer contract tests; add standalone integration coverage for configured acceptance/model failure and baseline/tree drift using existing fixtures (integration).
- Repair verification stays unavailable: retain existing repair_unverified and no-commit behavior tests (existing).

## Feasibility
- Pinned module source inspected in scratch: verify.Verify accepts Root/Repo/Config/Intent/Start/RunDir/Tools/Intact, materializes current tree, stops at red, records NotRun and detects moved contents; verify.Run also runs fixers and is not chosen here. Pass.Complete validates ordered evidence. (local source probes: exit 0)
- Local Cucumber empty-feature invocation reported `0 scenarios` and `0 steps`, exit 0. Fixture has a real project assertion, so empty acceptance is never proof of assertion success. Python resolved to an installed executable. (local probes: exit 0)
- Quint typecheck and TypeScript run, ExactGreen, seed 1, 30 samples, 8 steps: exit 0, no violation. This abstracts invalidation, not executable provenance proof.
- Documentation search for KogenAI kogen-verification returned generic GitHub sources, not usable API docs. Fetch https://github.com/KogenAI/kogen-verification returned retrieved, untrusted truncated HTML, not an API body relied on here; pinned module source supplies local API evidence.
- evidence: {"id":"initial-observer","kind":"observer","inputs":["features/steps/k-review-saved-candidate-check-evidence__steps.js"],"observers":["features/steps/k-review-saved-candidate-check-evidence__steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/k-review-saved-candidate-check-evidence__steps.js --control good","exit":0,"output":"observer controls passed\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/k-review-saved-candidate-check-evidence__steps.js --control bad","exit":1,"output":"rejected stale evidence\n"}]}
