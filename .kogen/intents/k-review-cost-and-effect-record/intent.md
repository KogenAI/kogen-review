# Record each review's cost and effect

Slug: k-review-cost-and-effect-record
Model: not applicable — the account is arithmetic over counters the review already keeps (two more travel in its checkpoint); there are no interacting state rules
Acceptance:
- .kogen/intents/k-review-cost-and-effect-record/acceptance.feature
- features/steps/k-review-cost-and-effect-record__steps.js
- features/steps/k-review-cost-and-effect-record__driver.js

Today a review's `Result` (`review/contract.go`) carries its verdict, its findings, the approved pass, its repair count and, when it has one, its `Invalid` or `Environment`. It does not say what the review cost or what it changed. The native session already sums the review's token usage (`Session.Usage`) and counts its requests (`Session.Requests`). The external reviewer only adds round usage to the Build's executor totals (`Input.Executor`), which also hold earlier sessions and reviews. Nothing measures a review's wall time or gives the attempt's totals.

After this change, every review's `Result` carries an `Account`. It records the requests, the input, cached and output tokens and the wall time the review used, its repair rounds, and its effect as plain facts: whether the tree changed, how many files and lines, the blockers the reviewer raised with their named defects, and whether the first reviewed tree got through review unchanged. It also records the same cost totals for the whole attempt, which are the caller's figures before the review (`Input.Attempt`) plus the review's, and the review's share of each, which is a plain division. It applies to the native reviewer (`review.Independent`, `Review` and `Resume`) and to the external one (`review.External`, a review in one session or in parts). The `Account` is still filled in when the review stops on an error.

This is observability only. Nothing about how a review runs changes: its verdicts, stops and errors, what is approved, its model requests and their bytes, its executor rounds, its `Env` calls, `review-<n>.json`, the run-log events, progress lines, the reviewer's policy and both goldens in `review/testdata/` all stay as they are. `Result.Record`, `Pass`, `Repairs`, `Invalid` and `Environment` also keep their meaning. Two new session keys can appear in checkpoints (item 4). `cmd/kogen-review` keeps its stdout keys.

The interface, all in package `review` (module `github.com/KogenAI/kogen-review`), in numbered items the sections below refer to:

1. Types (`review/contract.go`), with exactly these fields and JSON keys:
   ```go
   // Spend is what a review, or a whole attempt, used.
   type Spend struct {
       Requests int   `json:"requests"`
       Input    *int  `json:"input"`  // nil: unknown
       Cached   *int  `json:"cached"` // nil: unknown
       Output   *int  `json:"output"` // nil: unknown
       WallMS   int64 `json:"wall_ms"`
   }
   // Share is a review's share of its attempt, per figure: review / attempt (nil: not computable).
   type Share struct {
       Requests *float64 `json:"requests"`
       Input    *float64 `json:"input"`
       Cached   *float64 `json:"cached"`
       Output   *float64 `json:"output"`
       WallMS   *float64 `json:"wall_ms"`
   }
   // Effect is what a review changed, as plain facts.
   type Effect struct {
       FirstTree      string   `json:"first_tree"`
       FinalTree      string   `json:"final_tree"`
       TreeChanged    *bool    `json:"tree_changed"`
       FilesChanged   *int     `json:"files_changed"`
       LinesAdded     *int     `json:"lines_added"`
       LinesDeleted   *int     `json:"lines_deleted"`
       Blockers       int      `json:"blockers"`
       Defects        []string `json:"defects"` // [] when none, never null
       FirstTreeGreen bool     `json:"first_tree_green"`
   }
   // Account is a review's cost and effect record.
   type Account struct {
       Review       Spend  `json:"review"`
       Attempt      Spend  `json:"attempt"`
       Share        Share  `json:"share"`
       RepairRounds int    `json:"repair_rounds"`
       Effect       Effect `json:"effect"`
   }
   ```
   `Input` gains `Attempt Spend`: what the candidate's attempt used before this review, the builder's requests, tokens and wall time, as the caller counts them. Its zero value (nil counts) means the caller gave none. `Result` gains `Account *Account`.

2. When the account is set. Every `Result` that `Independent.Review`, `Independent.Resume` and `External.Review` return carries a non-nil `Account`. That covers an approval, a blocked review, a review without a valid verdict and every other error, including one before the first request (zero requests). It is filled in when the call returns. There are only two exceptions, and both keep `Account` nil: `Independent.Resume` refusing a saved state it cannot use (`candidate/resume_refused`: unreadable, or no verdict where one is needed), and `External.Resume`, which refuses at once as today.

3. The figures.
   - `Review.Requests`. For the native reviewer it is `Session.Requests` when the call returns: the requests the review handed to `Env.Request`, counted as the working budget counts them. A request that failed counts. The resend after a working-window reset does not count again. A request that was interrupted and sent again after a resume counts twice. For the external reviewer it is the executor rounds this review ran over all its sessions (every `Tools.Round` call, including one that failed).
   - `Review.Input`, `Cached` and `Output`. For the native reviewer they are `Session.Usage`'s `Input`, `Cached` and `Output`, the sum of each answered response's `core.ResponseTokens`. For the external reviewer they are the sums of the `executor.Usage` `Input`, `Cached` and `Output` of this review's own rounds, over all its sessions and parts. They never come from the executor state's running totals (`Input.Executor`, `core.ExecutorState.Usage`), which hold earlier sessions and reviews of the Build. A count that is unknown in any round or response makes that total nil (JSON `null`).
   - `Review.WallMS`, in whole milliseconds (`time.Duration.Milliseconds`). For the external reviewer it is the elapsed time from the start of `External.Review` to its return: one span over all parts and Kogen's work between them, not a sum of per-part or per-round times. For the native reviewer it is the elapsed time of this `Review` or `Resume` call, plus the `Session.WallMS` of the checkpoint a `Resume` continues. Every checkpoint the native reviewer saves carries `WallMS`: the earlier calls' wall time plus this call's elapsed time up to that save. Time between calls, while the review is not running (between a blocked stop and its resume), is not counted.
   - `RepairRounds`. For the native reviewer it is `Session.RepairRounds` when the call returns. For the external reviewer it is the repair rounds of the review over its parts (what `Result.Repairs` reports for an approval). Unlike `Result.Repairs`, it is also set on an error.
   - `Attempt`: `Input.Attempt` plus `Review`. `Requests` and `WallMS` are sums. `Input`, `Cached` and `Output` are sums, nil when either side is nil, so a zero `Input.Attempt` leaves them nil.
   - `Share`: for each of `Requests`, `Input`, `Cached`, `Output` and `WallMS`, the value is `float64(review) / float64(attempt)`. It is nil when either figure is nil or the attempt's figure is 0.

4. The effect.
   - `FirstTree` is the tree of the green pass the review started from. For `Review` that is `Input.Evidence.Pass.Tree`. For a native `Resume` it is the checkpoint's `Base` tree, or the checkpoint's pass tree when `Base` is nil.
   - `FinalTree` is `Result.Pass.Tree` for an approval (no error). Otherwise it is the candidate's tree in the checkout when the call returns (`Repo.Tree(Candidate.Start, Candidate.Excluded)`, as the review computes it), or `""` when that cannot be read.
   - `TreeChanged` is `FinalTree != FirstTree`. `FilesChanged`, `LinesAdded` and `LinesDeleted` come from `git diff --numstat --no-renames <FirstTree> <FinalTree> --` in the candidate's repository: the number of entries, and the sums of the added and deleted columns. A binary file's `-` counts 0. Equal trees give 0, 0, 0. All four are nil when `FinalTree` is `""`, and the three counts are also nil when the diff cannot be read. A failure here never changes the verdict, the error or the pass.
   - `Defects` lists every blocking finding of every valid verdict the reviewer submitted in this review: over repair rounds, parts and resumes, each verdict once, in order. Each entry is formatted `<path>:<line>: <message>` with `core.Display`, exactly as the `candidate/review_blocked` stop's lines without their `review: ` prefix. `Blockers` is `len(Defects)`. Kogen's own repair-limit block (`Session.SyntheticBlock`) is not a reviewer verdict and is not counted. Re-judging a saved approval on `Resume` adds nothing.
   - For the native reviewer, the defects travel in the session: `Session` gains `Blockers []string` (JSON `blockers`, `omitempty`). `run.evaluate` appends a verdict's blocking findings before it saves that verdict's `review_verify` checkpoint, so a blocked review's checkpoint already holds them. It also gains `WallMS int64` (JSON `wall_ms`, `omitempty`). Both come directly after `ResetUnread`, in this order, so a session without them encodes exactly as today. The `Session` literals that `evaluate` (a repair round) and `retry` (the reopened blocked review) rebuild carry both forward.
   - `FirstTreeGreen` is true exactly when the review ended with an approval (no error) whose tree is `FirstTree` and `Blockers` is 0. It means the first reviewed tree got through review unchanged.

5. Pins and docs. Pin the new types and fields in the compile-time API test `contract/api_test.go`. Pin the session keys `blockers` and `wall_ms` in `contract/formats_test.go`. Add items to `contract/README.md` (`review-account`, `account-session`), named next to their tests, and add the new types to its inventory. In `README.md`, the `review` package paragraph says that `Result` also carries the review's `Account`.

## Decisions
- Every review's result records its cost: requests, input, cached and output tokens, and wall time. It also records its repair rounds and its effect: whether the tree changed, files and lines changed, blockers raised with their named defects, and whether the first reviewed tree got through review unchanged. Both the native and the external reviewer do this (source: request)
- The attempt's totals use the same figures: the caller's figures before the review (`Input.Attempt`) plus the review's. The share is stated per figure as the plain division review / attempt, `null` when it cannot be computed (source: request)
- A review that stops on an error still records the cost and effect so far (source: request)
- A review in parts (the external reviewer's ordered parts) sums the usage of its parts' rounds once each. Its wall time is the elapsed span of the whole review (source: request)
- A blocked native review that is resumed is one review. Its account covers both calls, and its wall time adds the calls' running times, not the pause between them. A stopped review uses no time, and the request's two-part rule speaks of the parts of one running review. Kogen chose this because the request does not cover resumes (source: request)
- "The first reviewed tree passed unchanged" (`first_tree_green`) means the review approved the tree it was first given, with no edit and no blocker. The review is only ever given a green tree, and the request's examples (approve without edits: true; a blocker then a repair: false) settle this reading (source: request)
- "Requests" are the requests the review made, as its working budget counts them (a failed one included), or the external reviewer's executor rounds. Token totals are the answered responses' and rounds' usage. Kogen chose this counting because the request names the figures but not how to count them (source: request)
- No policy change: no review is skipped or shortened, and what is approved does not change (source: request)

## Source comparison
- Cost per review (requests, input, cached input and output tokens, wall time): items 1 and 3. Scenarios "An approval without edits records its cost, no repair round and an unchanged first tree that passed" (synthetic acceptance 1), "A reviewer that edits two files and approves after a repair round records the exact files and lines it changed" (2), "A blocker naming a defect, resumed and approved after the reviewer's repair, is counted once with its defect" (3), "A review in two parts sums the usage of both parts once and records the elapsed span as its wall time" (4) and "A review that stops on an error records the cost and the effect so far" (5).
- Repair rounds: item 3, `RepairRounds`. The scenarios expect 0 (approval without edits), 1 (one red verification of the reviewer's edits sent back), 0 (the reopened blocker repaired and approved on its first verification) and 0 (error).
- Effect (tree changed, files and lines, blocker with a named defect, first tree green): item 4. Synthetic acceptance 2's "files and lines changed are exact" is 2 files, 3 lines added and 2 deleted against the candidate's tree, the reviewer's own edits as `git diff --numstat` counts them. Synthetic acceptance 3's "blocker count 1 with the defect named; first tree not green" is `blockers` 1 and `defects` `["app.txt:2: app.txt counts 2 in digits where the Intent requires two"]`. In this codebase a blocking verdict ends the review, so "then approves after a repair" is the explicit resume of that blocked review (`Independent.Resume` from its `review_verify` checkpoint). The scenario also checks that the checkpoint already holds the blocker and wall time.
- Attempt totals and share (synthetic acceptance 6): `Input.Attempt` and item 3. Scenario "The attempt's totals are the builder's usage plus the review's, and the review's share is their division" uses builder 6 requests, 9000/3000/1700 tokens and 4000 ms. With the review's 2 requests and 3000/1000/300 that gives 8 requests and 12000/4000/2000 tokens, shares 0.25, 0.25, 0.25 and 0.15, and wall time 4000 ms plus the review's, its share being the review's wall time divided by the attempt's.
- "Scripted reviewer with fixed usage figures per call": every native model response and every external round in the fixtures reports 1500 input, 500 cached and 150 output tokens. The two-part scenario also gives the Build's executor state 7000/2000/700 from earlier, so totals taken from the executor state, or summed per part from its running totals, are told apart from the sum of this review's rounds.
- "Wall time is the elapsed span, not the sum" (synthetic acceptance 4): the rounds take 300 ms each and Kogen takes 600 ms to record the pending review between the parts. The wall time must be at least 1200 ms and no more than the driver measured around the call.
- "Record ... in the existing review result": `review.Result`, which kogen-build receives. Recording it in kogen-build's own state, and giving `Input.Attempt` from the builder's usage, are kogen-build's paired consumer change, outside this repository. Adding the account to `review-<n>.json` or to `cmd/kogen-review`'s stdout is not requested (omitted).
- Omitted (not requested): any change to how reviews run, retry, stop or approve, cost estimates in money, and a reasoning-token figure.

## Tests
- An approval without edits records its cost, 0 repair rounds, an unchanged tree, no blocker and a first tree that passed: scenario "An approval without edits records its cost, no repair round and an unchanged first tree that passed" (scenario)
- A reviewer's edits are counted exactly in files and lines and its repair rounds are recorded: scenario "A reviewer that edits two files and approves after a repair round records the exact files and lines it changed" (scenario)
- A raised blocker is recorded once with its defect across the resume, the account covers both calls without the pause, and the first tree is not green: scenario "A blocker naming a defect, resumed and approved after the reviewer's repair, is counted once with its defect" (scenario)
- A review in parts sums its own rounds once each and records the elapsed span: scenario "A review in two parts sums the usage of both parts once and records the elapsed span as its wall time" (scenario)
- A review that stops on an error records the cost and effect so far: scenario "A review that stops on an error records the cost and the effect so far" (scenario)
- The attempt's totals are `Input.Attempt` plus the review's, and the shares are their divisions: scenario "The attempt's totals are the builder's usage plus the review's, and the review's share is their division" (scenario)
- Attempt and share arithmetic: unknown counts stay `null`, a zero attempt figure gives a `null` share, a zero `Input.Attempt` leaves the attempt's token totals `null`: a table test in package `review` of the function that builds the account's `Attempt` and `Share` from `Input.Attempt` and the review's `Spend` (unit)
- The native review's `Result.Account` in the contract flow: extend `TestIndependentReviewApprovesTheGreenPass` (requests 1, the fake's usage, `repair_rounds` 0, `first_tree_green` true, `tree_changed` false) and `TestIndependentReviewChangesIsTheReviewBlockedStop` (`blockers` 1 with its defect, `first_tree_green` false) in `contract/independent_test.go` (integration)
- The external review's account counts only its own rounds: extend `TestExternalReviewApprovesInItsOwnSession` in `contract/external_test.go` (requests 1 and the scripted round's usage, with `Input.Executor` holding earlier usage) (integration)
- The session encodes and decodes `blockers` and `wall_ms` after `reset_unread`, a session without them encodes the same bytes, and both survive the repair and retry reconstructions: update `TestSessionEncodesItsCheckpointBytes` and `TestDecodeSessionReadsWhatACheckpointKept` in `contract/formats_test.go` (unit)
- The new types and fields are part of the contract API: pin `Spend`, `Share`, `Effect`, `Account`, `Input.Attempt`, `Result.Account`, `Session.Blockers` and `Session.WallMS` in `contract/api_test.go` (unit)
- Verdicts, stops, requests, rounds, records, events, the reviewer's policy and `cmd/kogen-review` are unchanged: the existing contract suite, `review` tests, goldens and `cmd` tests pass without `-update`, and every scenario's verdict and stop step already passes on the unchanged tree (existing)

## Feasibility
- evidence: {"id":"review-account-observer","kind":"observer","inputs":[".kogen/intents/k-review-cost-and-effect-record/acceptance.feature","features/steps/k-review-cost-and-effect-record__driver.js"],"observers":["features/steps/k-review-cost-and-effect-record__steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/k-review-cost-and-effect-record__steps.js --control good","exit":0,"output":"observer controls passed\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/k-review-cost-and-effect-record__steps.js --control bad","exit":1,"output":"rejected the review result without its account\n"}]}
- How the controls work: the step file's judgments compare the driver's observation with the feature's expected values. The good control runs them on expected observations of the two-part review, the resumed blocker and the attempt-share review. It requires each of 25 mutations to be rejected, among them usage that includes the executor state's earlier totals, a sum-of-rounds wall time, a wall time that includes the pause or only the resumed call, a lost blocker or defect, a wrong line count, a checkpoint without `wall_ms` or `blockers`, a wrong attempt total or share, and a driver that could not set `Input.Attempt`. The bad control judges today's observation of the first scenario (approve, no `Account` field), copied from the driver's actual output on the unchanged tree, and must reject it.
- These were observed in this session in a scratch copy outside the checkout, on the unchanged tree, with this driver. They are not Kogen probe records:
  - The driver builds and vets in a copy of the checkout. It reports `review.Result has no field Account` and `review.Input has no field Attempt`.
  - Every scenario's verdict and stop is as the feature expects: approve after 2 requests; approve after 2 requests with `Repairs` 1 and 2 verifications (red, green); changes `candidate/review_blocked` and then, resumed from a `review_verify` checkpoint, approve after 3 requests in all; error `provider/scripted_failure` after 2 requests with the edit left in place.
  - The fixture with two added files of 10000 lines (320000 bytes each) is reviewed in 2 parts ("the complete review prompt would be 660889 bytes, over the 524288-byte ceiling") with 2 sessions of one round each.
  - `git diff --numstat` of the candidate tree against the reviewer's final tree in the repair scenario gives `2 1 app.txt` and `1 1 lib.txt`.
  - A Cucumber dry run binds all 80 steps of the 6 scenarios. The two-part scenario ran once, and its first failing step was the account (`the review's result has no account`).
