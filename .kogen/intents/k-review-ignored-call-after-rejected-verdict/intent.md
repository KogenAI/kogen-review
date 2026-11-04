# Answer calls after a refused verdict by outcome

Slug: k-review-ignored-call-after-rejected-verdict
Model: not applicable — the change picks the answer to each later call of one response from the outcome of that response's submit_review call; it adds no state across responses, and the allowance counters and unread tracking stay as they are
Acceptance:
- .kogen/intents/k-review-ignored-call-after-rejected-verdict/acceptance.feature
- features/steps/k-review-ignored-call-after-rejected-verdict__steps.js
- features/steps/k-review-ignored-call-after-rejected-verdict__driver.js

Today the native reviewer (`review.Independent`, `run.converse` in `review/independent.go`) answers every call that follows a `submit_review` call in the same model response with `ignored: the review already has a verdict`. It does this whether the submission was accepted or refused (the `case verdict != nil || problems != nil:` branch of the per-call `switch`). After a refused submission no verdict exists, so the reviewer is told something false. The ignored calls may be exactly the reads the refusal asked for, such as an unread pinned part. The reviewer then repeats them in its next turn and spends a request. With an approve refused for an unread part, the next approve is refused again and the review ends `rejected_verdict_exhausted`.

After this change, the calls that follow a `submit_review` call in the same response are handled by what happened to that submission:

1. **Accepted verdict.** Every later call of the response (any tool, including another `submit_review`) is answered with `ignored: the review already has a verdict`, as today, and is not run.
2. **Refused submission.** The submission is the one whose `run.validate` returned problems. Its own output is unchanged: `invalid verdict:\n` followed by the problems joined with newlines.
   - The later read-only calls of the response, `read_file`, `view_image`, `list_files` and `search_text`, run exactly as they would in a later turn. They go through the same `env.Boundary` checks, the native tools (`tl.Call`), `out.Cut()`, `tools.ReadEvent` and the `review_tool_call` event. Their results are returned in that response's outputs, next to the refusal and in call order.
   - Every other later call of the response is answered with exactly `not run: the submission was refused; make this call again in the next response` and is not run. This covers `write_file`, `shell`, another `submit_review`, and a name that is not a reviewer tool. Such a call records no `review_tool_call` event, no `Session.Probes` or `Session.ProbeRuns` entry and no tree change, and an answered `submit_review` is not validated.
3. **Allowance and unread parts.** The refused submission is accounted once, exactly as a refused submission that is the only call of its response is accounted today: the existing `switch` after the calls (unread-progress exemption, `rejected_verdict` allowance, or `invalidStop` with `rejected_verdict_exhausted`), with the same counters and `review_allowance` events. Reads run this way are part of the conversation input like any other tool output. When the next response's submission is validated, they count as progress on unread parts exactly as if they had been made in a later turn (the Env's `Unread` sees them).

Calls before the first `submit_review` of a response are handled as today. Unchanged: the text of the existing ignored answer, verdict validation and its problem texts, the allowances and their limits, the working budget, the reviewer's model-facing policy (`ReviewerInstructions()`, `review/prompts/reviewer.md`, the `submit_review` definition and both goldens in `review/testdata/`), the external reviewer (`review.External`, `review/external.go`) and the stdout of `cmd/kogen-review`.

## Decisions
- After a refused submission, read-only calls (reading, listing, searching) of the same response run and return their results next to the refusal (source: request)
- After a refused submission, edit and shell calls are answered with exactly `not run: the submission was refused; make this call again in the next response`, a text that says the submission was refused and the call was not run and does not claim a verdict exists (source: request)
- After an accepted verdict, later calls keep the existing text `ignored: the review already has a verdict` (source: request)
- The refused verdict still counts once against the allowance, and reads run this way count as progress on unread parts exactly as if made in a later turn (source: request)
- Only the read-only tools of `review.ToolNames` (`read_file`, `view_image`, `list_files`, `search_text`) run after a refusal; a second `submit_review` or an unknown tool name is answered like an edit or shell call, so one response never validates two submissions (source: request)

## Source comparison
- Problem (a refused submission makes later calls claim "already has a verdict"; repeated reads cost a request): addressed by rule 2; acceptance scenario 1 reproduces it.
- Need, accepted verdict: rule 1; scenario 2.
- Need, read-only calls run after a refusal: rule 2; scenario 1 (`read_file`) and scenario 3 (`list_files`).
- Need, edit or shell calls answered with a refusal text and not run: rule 2; scenario 1 (`shell` `echo x`: no `review_tool_call` event and no recorded probe) and scenario 3 (`write_file`: app.txt unchanged).
- Need, the refused verdict counts once against the allowance: rule 3. In scenario 1 there is one `rejected_verdict` spending. In scenario 3 there is one spending, and the second refusal ends the review `rejected_verdict_exhausted` with `RejectedVerdict` 1.
- Need, reads count as unread progress as if made in a later turn: rule 3; scenario 1, where the next approve is accepted in the second and last request.
- Synthetic acceptance 1 to 4 (submit_review approve with one unread part, read_file of it, shell `echo x`; the problem text; the part's text; the refusal without "already has a verdict" and the command not run; next turn unread zero and the approve accepted without another read request): scenario 1, literally.
- Synthetic acceptance 5 (a valid submit_review first, later calls get the existing ignored text): scenario 2.
- Scenario 3 (a `maybe` verdict, `list_files`, `write_file`) is added by shaping. It covers the listing and edit sides of the rule and the single allowance count.

## Tests
- After a refused submit_review, later read_file/view_image/list_files/search_text calls of the same response run and their outputs follow the refusal: add a test in `contract/independent_test.go` over the fake Env (scripted response: an approve refused for an unread part, then read_file and list_files; assert the outputs in order and the `review_tool_call` events), plus acceptance scenarios 1 and 3 (integration)
- After a refused submit_review, later write_file, shell and submit_review calls are answered with `not run: the submission was refused; make this call again in the next response` and not run: the same contract test asserts the exact outputs, that the file is unchanged, and that no probe and no tool-call event is recorded, plus acceptance scenarios 1 and 3 (integration)
- After an accepted verdict, later calls are answered `ignored: the review already has a verdict`: add a case to that contract test (a valid approve, then read_file and shell), plus acceptance scenario 2 (integration)
- The refused submission is accounted once, and reads run after it count as unread progress in the next turn: in the contract test, the next response's approve is accepted with one `rejected_verdict` allowance event and two requests, plus acceptance scenarios 1 and 3 (regression)
- Contract inventory: add an item for the new contract test to the "Behaviours and formats pinned" list of `contract/README.md` (existing)

## Feasibility
- evidence: {"id":"after-refusal-observer","kind":"observer","inputs":[".kogen/intents/k-review-ignored-call-after-rejected-verdict/acceptance.feature","features/steps/k-review-ignored-call-after-rejected-verdict__driver.js"],"observers":["features/steps/k-review-ignored-call-after-rejected-verdict__steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/k-review-ignored-call-after-rejected-verdict__steps.js --control good","exit":0,"output":"observer controls passed\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/k-review-ignored-call-after-rejected-verdict__steps.js --control bad","exit":1,"output":"rejected the review that ignored the calls after a refused submission\n"}]}
- How the controls work: the step file's judgments compare an observation with the feature's expected values. The observation holds the number of requests, each scripted response's calls with their outputs in the final conversation, the ending, the `Invalid` fields, the `review_allowance` events, the `review_tool_call` names, the latest checkpoint's probes and probe runs, and the final app.txt. The good control runs the judgments on the expected observations of the three scenarios. It requires each of 26 mutations to be rejected, among them:
  - an ignored read;
  - an ignored or run shell call;
  - a refusal text that mentions a verdict;
  - a recorded probe;
  - a missing or doubled allowance spending;
  - a third request;
  - a refused second approve;
  - a write that ran;
  - an extra `RejectedVerdict`.
  The bad control judges today's observation of scenario 1 and must reject it. That observation is copied from the driver's actual output on the unchanged tree: read and shell ignored, the second approve refused, `rejected_verdict_exhausted`.
- These were observed in this session in a scratch copy outside the checkout, on the unchanged tree. They are not Kogen probe records:
  - The driver builds in a copy of the checkout and passes `go vet`.
  - Scenario 1's script ends today `invalid`/`candidate/review_invalid`. Its read_file and shell outputs are `ignored: the review already has a verdict`, and it has one `rejected_verdict` allowance event: an approve refused for unread parts is not unread-progress exempt, because only the changes-verdict unread text is counted by `unreadProblemCount`.
  - Scenario 2's script approves today with exactly the expected observation.
  - Scenario 3's script ends today `rejected_verdict_exhausted` with `list_files` and `write_file` ignored.
  - With the calls in their own turns, the real tool outputs are `1\tcandidate` for read_file of app.txt and `.gitignore\n.kogen/intents/fixture/acceptance.feature\napp.txt` for list_files. A shell `echo x` that runs records `review_tool_call` `shell`, and the probe and probe run `echo x`.
  - A Cucumber dry run of the feature binds all 38 steps.
