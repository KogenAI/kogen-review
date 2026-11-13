# Force read_file in reminders with unread parts

Slug: review-reminder-reads-unread-parts
Model: not applicable — the change picks a tool and a text per reminder request; the review session state is unchanged
Acceptance:
- .kogen/intents/review-reminder-reads-unread-parts/acceptance.feature
- features/steps/review-reminder-reads-unread-parts__steps.js

After a reviewer turn without a tool call, converse sets the reminder and the next request forces a tool through the existing ForceTool field and provider.SupportsToolChoice, exactly as the submit_review forcing does now. While pinned parts are unread (the list the verdict check uses, `r.unread`), that request forces `read_file` instead of `submit_review`, since a verdict then is guaranteed invalid. The reminder text names the next unread parts (at most 8, the first in the unread list) and their count. When no pinned parts are unread the request forces `submit_review` as before. Where the route cannot force a tool (provider.SupportsToolChoice false), the text fallback is unchanged apart from naming the unread parts. The `review_tool_choice` event records the forced tool in `tool` and the unread count in a new `unread` field. The over-budget path still forces `submit_review`. Allowances, caps, `Request`, `provider.Request`, `cmd/kogen-review` and `go.mod` are unchanged.

The choice of tool and the reminder text live in a new small file `review/reminder.go`: `reminderTool(unread []string) string` returns `read_file` when `unread` is non-empty and `SubmitReviewTool` otherwise; `reminderText(problems, unread []string) string` returns `Not a valid verdict: <problems joined by "; ">. ` followed, when parts are unread, by `<n> pinned part(s) unread; call read_file on <first up to 8 parts, comma-separated> before a verdict.` and otherwise by `Call submit_review.`. `converse` calls them.

## Decisions
- Unread parts are taken from `r.unread` at the time the reminder is written and again when the reminder request is built (decision: D1, round 1) (evidence: review/independent.go; review/reset.go) (source: request)
- The `review_tool_choice` event gains an integer `unread` field; its `tool` is the forced tool, also in text_fallback mode (decision: D2, round 1) (evidence: review/independent.go) (assumption: the tool field in text_fallback mode names the tool the reminder asks for) (source: request)
- Acceptance drives scripted reviews through `review.Independent.Review` with a scripted Env, so any implementation behind converse is observed (decision: D3, round 1) (evidence: features/steps/fix-k-review-reset-keeps-source-once__steps.js) (source: request)

## Source comparison
- Reminder forces read_file with unread parts, submit_review otherwise, over-budget unchanged: addressed in acceptance.feature (all three scenarios) and the Decisions above.
- No new fields on Request or provider.Request, no change to cmd/kogen-review or go.mod: addressed by the prose; no step touches them.
- Text fallback naming unread parts and the 8-part cap: addressed by `reminderText`; the cap is observed in scenario 1.

## Tests
- A no-tool turn with 86 unread parts is followed by a forced read_file whose reminder names the first 8 unread parts: scenario 1 (scenario)
- After that reminder the reviewer reads and approves, ending with a valid verdict: scenario 2 (scenario)
- With no unread parts a no-tool turn is followed by a forced submit_review: scenario 3 (scenario)
- Run the review package tests: existing `go test ./...` configured check (existing)

## Feasibility
- evidence: {"id":"reminder-observer","kind":"observer","inputs":["features/steps/review-reminder-reads-unread-parts__steps.js"],"observers":["features/steps/review-reminder-reads-unread-parts__steps.js"],"checks":[{"name":"good","command":"node features/steps/review-reminder-reads-unread-parts__steps.js --control good","exit":0,"output":"reminder observer accepted controls\n"},{"name":"bad","command":"node features/steps/review-reminder-reads-unread-parts__steps.js --control bad","exit":1,"output":"reminder observer rejected a forced submit_review with unread parts\n"}]}
