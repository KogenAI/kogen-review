# Record restriction-refused reviewer checks

Slug: k-review-denied-check-is-environment
Model: not applicable — each rule judges one submission against the restriction's own report kept with the review's recorded shell runs; the review loop's stages, allowances, checkpoints and stop classes keep their transitions
Acceptance:
- .kogen/intents/k-review-denied-check-is-environment/acceptance.feature
- features/steps/k-review-denied-check-is-environment__steps.js
- features/steps/k-review-denied-check-is-environment__driver.js

A reviewer may run its checks under an execution restriction that the outer gates (Kogen's verification of the candidate and the Build's final gates) do not have. Today kogen-review has no notion of it. A check whose bind of a local lock or socket the restriction refused looks like any other red `shell` run. A ledger entry citing it gets the ordinary "did not succeed" problem, which tells the reviewer to repair the candidate or block on it. Nothing in the review result shows that the review ran with narrower permissions.

After this change, the caller can tell the review that its native commands run under a restriction, and the restriction itself reports what it refused during each `shell` call. Kogen records that report with the run. A refused run is an environment limitation, not a product defect. An approval that cites it as a requirement's evidence is refused, and the feedback names the check as unrun-by-environment. The requirement stays unestablished unless a different probe that ran and succeeded on the current tree establishes it. The review record and the review's Result show which checks were refused, which operations were refused, and that the reviewer was restricted while the outer gates were not.

The classification rests only on the restriction's own report, never on the call's output text. A run that fails with "permission denied" or "bind: operation not permitted" printed by the candidate's own code, with no refusal reported, is judged exactly as today: a probe that did not succeed, which stays a defect.

Kogen does not bypass, widen, retry or rerun the restriction, the call or the check. The reviewer gets the call's tool result unchanged. No finding is added or removed, no requirement is weakened, and every existing ledger rule stays in force. Without a restriction (`Tools.Restriction` nil), everything is byte-for-byte as today: sessions, `review-<n>.json`, `Result`, problems and `cmd/kogen-review`.

The reviewer's model-facing policy is not changed: `ReviewerInstructions()`, `review/prompts/reviewer.md`, `RequirementsRule`, `LimitRaises`, the `submit_review` definition, the external review task, `MaterialOf` and both goldens (`review/testdata/prompts_golden.json`, `defs_golden.json`) stay byte-for-byte as they are. The new text reaches a reviewer only as the problem of a refused submission, as in Intent k-review-unrun-evidence-not-met. That keeps kogen-build's consumer tests that pin the reviewer's bytes passing unchanged.

The interface, all in package `review` (module `github.com/KogenAI/kogen-review`), in numbered items the sections below refer to:

1. Restriction (`review/contract.go`). A new exported type and a new field of `Tools`:
   ```go
   // Restriction is an execution restriction the reviewer's native commands run under and the
   // outer gates (Kogen's verification of the candidate, the Build's final gates) do not.
   type Restriction struct {
   	// Name describes the restriction, as the review record states it.
   	Name string
   	// Refused are the operations the restriction itself refused during the native shell call
   	// that has just returned, as the restriction reports them (for example
   	// "bind: operation not permitted"); none when it refused nothing. It is the restriction's
   	// own report, never read from the call's output.
   	Refused func(call tools.Call) []string
   }
   ```
   `Tools` gains `Restriction *Restriction` (nil: the reviewer's commands run with the outer gates' permissions). The field names and types are exactly these; the acceptance driver sets them by name.

2. Session (`review/independent.go`). `ProbeRun` gains `Refused []string` with JSON tag `refused,omitempty`. When `Tools.Restriction` and its `Refused` are set, the native review calls `Refused(call)` exactly once for every `shell` call it appends a `ProbeRun` for, right after the call returns. It stores a non-empty result in that `ProbeRun.Refused`, keeping order and texts. It changes nothing else about the call: no rerun, no other command and no change to the tool result the reviewer receives. Without a restriction, `Refused` stays empty, so sessions encode exactly as today. Checkpoints, resumes, the `retry` and `evaluate` session rebuilds and working-window resets keep `ProbeRuns`, and with them `Refused`, as they do today.

3. Validation (`run.validate`, Intent k-review-unrun-evidence-not-met item 2). An `approve` entry with evidence `probe` (native reviewer only) whose latest run, as that Intent defines it, has a non-empty `Refused` gets this problem. It comes after the existing "did not run" check and before that Intent's probe problems (names no file, did not succeed, other tree), and it is that entry's only problem. `<R>` is the entry's `requirement`, `<ref>` its `ref`, `<Name>` the `Name` of `Tools.Restriction` (empty without one), `<ops>` the run's `Refused` joined by `; `:
   `requirement "<R>" cites probe "<ref>", which is unrun-by-environment: the reviewer's restricted execution (<Name>) refused <ops> in its latest run, and the outer gates run without this restriction; a check the restriction refused is an environment limitation, neither evidence nor a candidate defect; cite a probe you ran with shell on the current tree that exercises the requirement, or, when nothing can verify it here, submit changes with a blocking finding that quotes the requirement and says its verification could not run`
   A latest run without `Refused` is judged exactly as today, whatever its output says. Entries of a `changes` verdict, and `acceptance`, `test` and `none` entries, are checked exactly as today. The problem is an ordinary verdict problem: the native reviewer gets it in the `submit_review` tool result `invalid verdict:\n<problems joined by \n>`, and it spends the one rejected-verdict allowance as any rejection does.

4. Record and Result. New exported types:
   ```go
   // Environment is how a restricted review's permissions differed from the outer gates' and
   // the reviewer checks the restriction refused.
   type Environment struct {
   	ReviewerRestricted   bool         `json:"reviewer_restricted"`
   	OuterGatesRestricted bool         `json:"outer_gates_restricted"`
   	Restriction          string       `json:"restriction"`
   	Limitations          []Limitation `json:"limitations"`
   }

   // Limitation is one reviewer check the restriction refused: its shell command and the
   // operations refused.
   type Limitation struct {
   	Check   string   `json:"check"`
   	Refused []string `json:"refused"`
   }
   ```
   When `Tools.Restriction` is set, the review's environment is `{reviewer_restricted: true, outer_gates_restricted: false, restriction: Restriction.Name, limitations}`. `limitations` has one entry `{check: Command, refused: Refused}` per `ProbeRun` of the session with a non-empty `Refused`, in run order, and is `[]` (never `null`) without any. Every `review-<n>.json` the review writes, including the repair-limit stop's, gains the key `"environment"` with that value. `Result` gains `Environment *Environment`, set to the same value on the Result of an approval and of a `candidate/review_blocked` stop. Without a restriction there is no `"environment"` key and `Result.Environment` is nil. The external reviewer's records go through the same `run.evaluate`, so with a restriction they show the environment with `limitations: []`: Kogen does not see an external reviewer's tool calls. The review adds no finding for a limitation and changes no verdict, setting, restriction or file because of it.

5. Pins and docs. No golden is rewritten. `contract/README.md` names the new contract items next to their tests, and the inventory gains rows for `review.Restriction`, `review.Environment` and `review.Limitation`.

## Decisions
- A reviewer check counts as refused by the restriction only when the restriction itself reports the refusal for that call (`Restriction.Refused`). The same error text printed by the candidate's own code (`permission denied`, or even `bind: operation not permitted`) with no report stays a probe that did not succeed, which is a defect (source: request)
- A refused check is an environment limitation, not a product defect: Kogen raises no finding for it, and the review record and Result show the check, the refused operations, and that the reviewer was restricted while the outer gates were not (source: request)
- An approval citing a refused check as a requirement's only evidence is refused, and the feedback names it as unrun-by-environment. A different focused probe that ran and succeeded on the current tree may establish the requirement, or the reviewer keeps it unmet in a changes verdict whose finding says its verification could not run (source: request)
- Kogen does not bypass, widen, retry or rerun the restriction or the check, does not hide the check or alter its tool result, and does not weaken the requirement. The reviewer's instructions and tool definitions are unchanged (source: request)

## Source comparison
- "classify it as an environment limitation, not a product defect. Keep it visible in the review result: which check, which refused operation, and that the reviewer's permissions differed from the outer gates": items 2 and 4 (`ProbeRun.Refused`, `"environment"` in `review-<n>.json`, `Result.Environment`).
- "A requirement whose only evidence is such a check stays unestablished in the requirement ledger (or is covered by a different probe that did run)": item 3.
- "Do not bypass, widen or silently retry the restriction, do not hide the check, and do not weaken the requirement": items 2 and 4 (no rerun, unchanged tool result, no new finding, unchanged ledger rules), and the unchanged reviewer policy.
- "Genuine failures that merely mention 'permission' (for example the candidate's own access-control code) stay defects": item 3's last paragraph. Classification rests only on the restriction's report, so a text match on the output cannot pass scenario "The bind error printed by the candidate's own code is not an environment limitation".
- Synthetic acceptance (scripted reviewer, fixture with requirement `Starting the helper creates its lock`, a check whose output the fixture controls): the review driver `features/steps/k-review-denied-check-is-environment__driver.js` runs `review.Independent` with a scripted model under the restriction `fixture sandbox`. Its `Refused` reports the lines the fixture's simulated restriction appended to its own log, outside the checkout, during the call. The check is `sh check-lock.sh`.
- Synthetic acceptance 1 (fails with `bind: operation not permitted` raised by the restriction; the result records an environment limitation naming the check and operation; no defect): scenario "A check the reviewer's restriction refused is an environment limitation, and a focused probe that ran establishes the requirement". The record keeps no finding and shows the limitation `{check: "sh check-lock.sh", refused: ["bind: operation not permitted"]}`.
- Synthetic acceptance 2 (a met entry with only that check as evidence is not established; feedback names it unrun-by-environment): the item 3 problem in that scenario and in scenario "A requirement whose only evidence the restriction refused stays unestablished", which ends in a changes verdict that keeps the entry unmet.
- Synthetic acceptance 3 (a separate focused probe that ran and passed on this tree is cited; it may establish the requirement): the second submission of the first scenario, `d=$(mktemp -d) && LOCKDIR=$d sh helper.sh start && test -f "$d/helper.lock" && printf 'lock created'`, is approved.
- Synthetic acceptance 4 (`permission denied` printed by the candidate's own code, whose test expects access to be allowed, stays a defect): scenario "A permission denied printed by the candidate's own code stays a defect". The candidate's access check tests the lock it is about to create, the check expects access to its writable lock folder, and the restriction reports nothing. The citation gets today's "did not succeed (exit status 1)" problem and the record has no limitation.
- Synthetic acceptance 5 (the record shows reviewer restricted, outer gate not; no setting is changed): `reviewer_restricted: true` and `outer_gates_restricted: false` in the same `"environment"` record of every scenario, and the checkout's files, including `.kogen/project.yaml`, are still the saved candidate's after the review.
- Omitted (not requested): reading an external reviewer's tool calls, new `cmd/kogen-review` flags or stdout keys, progress lines or events for refusals, and changes to allowances or stop classes.

## Tests
- A shell call the restriction reported refused is recorded, an approval citing it is refused as unrun-by-environment, and a focused probe that ran establishes the requirement with the limitation in the record and the Result: scenario "A check the reviewer's restriction refused is an environment limitation, and a focused probe that ran establishes the requirement" (scenario)
- A requirement whose only evidence was refused stays unmet in a changes verdict, with the limitation recorded: scenario "A requirement whose only evidence the restriction refused stays unestablished" (scenario)
- A failure printed by the candidate's own code with no reported refusal stays a defect: scenarios "A permission denied printed by the candidate's own code stays a defect" and "The bind error printed by the candidate's own code is not an environment limitation" (scenario)
- With `Tools.Restriction` set, the native review calls `Refused` once per recorded shell call and keeps a non-empty report in `ProbeRun.Refused` through the checkpoint and a repair round. An approval citing a refused latest run gets the item 3 problem, and a later run of the same command that was not refused is judged as today. `review-1.json` has `"environment"` with the limitations, and `Result.Environment` is equal on approval and on `candidate/review_blocked`. Without a restriction there is no `"environment"` key, `Result.Environment` is nil and `ProbeRun` encodes without `refused`: a new test in `contract/independent_test.go` (integration)
- With a restriction, the external reviewer's `review-1.json` and Result show the environment with `limitations: []`: `contract/external_test.go` (integration)
- The reviewer's instructions, the `submit_review` definition and the external task are unchanged: the existing goldens and `review/policy_test.go` pass without `-update` (existing)
- Sessions, verdicts, records and `cmd/kogen-review` stdout without a restriction stay unchanged: the existing `contract` suite, including `formats_test.go` and `TestValidateJudgesRequirementEvidenceOnTheCurrentTree` (existing)

## Feasibility
- evidence: {"id":"denied-check-observer","kind":"observer","inputs":[".kogen/intents/k-review-denied-check-is-environment/acceptance.feature","features/steps/k-review-denied-check-is-environment__driver.js"],"observers":["features/steps/k-review-denied-check-is-environment__steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/k-review-denied-check-is-environment__steps.js --control good","exit":0,"output":"observer controls passed\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/k-review-denied-check-is-environment__steps.js --control bad","exit":1,"output":"rejected today's review of a check the restriction refused\n"}]}
- How the controls work: the step file's judgments compare an observation with the feature's expected values. An observation holds the requests, the last input of each request, the shell results the reviewer was given, the verdict, stop, `review-1.json`'s findings, requirements and environment, `Result.Environment`, the driver's restriction setup, the verifications asked and the tree after the review. The good control runs the judgments on the expected observations of the refused-check scenario and of the candidate-printed `permission denied` scenario, and requires each of their mutations to be rejected: the did-not-succeed text, a missing or wrong environment, a limitation for the candidate's own failure, an outer gate shown restricted, a hidden check output, a blocking verdict, a finding, a verification and a changed tree. The bad control judges today's observation of the refused-check scenario (the did-not-succeed problem, no environment) and must reject it.
- The driver sets `Tools.Restriction` and reads `Result.Environment` by reflection, by the names in items 1 and 4. So it builds on the unchanged tree, and the scenarios fail at their assertions, not at compilation. Today it reports `review.Tools has no field Restriction` in the observation, which the environment judgment's message quotes.
