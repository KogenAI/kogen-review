# Keep the reason in the rejected-verdict line

Slug: review-rejected-line-keeps-reason
Model: not applicable — the change is a pure text transformation of one progress line, with no state
Acceptance:
- .kogen/intents/review-rejected-line-keeps-reason/acceptance.feature
- features/steps/review-rejected-line-keeps-reason__steps.js
- features/steps/review-rejected-line-keeps-reason__driver.js

The progress line `kogen: review <n>: verdict not accepted: <problem>` shows the first problem cut at 160 runes. A first problem has the form `requirement "<statement>" <reason>`, so a long quoted requirement spends the 160 runes and the reason (for example `has no evidence: probe it with shell against the candidate before the verdict`) never reaches the line. The change is one narrow Go change in the review package: rejectedLine in review/invalid.go (with cutAtWord and the 160-rune constant it already uses). When the first problem is longer than 160 runes and starts with a quoted requirement, the quoted statement is now shortened with the existing cut marker (" ...", placed inside the closing quote) and the reason after the closing quote is kept whole. The reason is never cut and has no length limit of its own: when the reason alone leaves no room within 160 runes, the line may pass 160 runes and the statement is shortened to the cut marker alone. A first problem that has no quoted requirement is cut at 160 runes as today, and a problem of 160 runes or fewer is shown byte-identical to today. The recorded problems (10 lines, 300 runes each), the review_allowance event, the text told to the reviewer and the "(first of N problems)" wording are unchanged. No configuration is added.

## Decisions
- The progress problem keeps its form for a first problem of at most 160 runes, and a first problem longer than 160 runes that starts with `requirement "` and holds a closing quote followed by a space has its statement shortened with the existing cut marker while the text after the closing quote (the reason) is kept whole; rejectedLine in review/invalid.go is where this applies (constraint: the reason is never cut and has no length limit of its own) (constraint: a problem of 160 runes or fewer is byte-identical to today) (evidence: review/invalid.go; review/independent.go) (source: request)
- The shortened statement gets the room left in 160 runes after `requirement "` and the closing quote with the reason, cut at a word boundary by the existing cutAtWord; when the reason leaves no room the statement becomes the cut marker alone and the line may pass 160 runes (constraint: the reason is never cut and has no length limit of its own) (evidence: review/invalid.go; review/invalid_cut_test.go) (source: request)
- The closing quote of the requirement is the first quote followed by a space after the opening `requirement "`; a problem with no such quote has nothing to shorten and is cut at 160 runes as today (evidence: review/independent.go) (assumption: Statements are quoted without escaping, so a statement that itself contains a quote followed by a space ends the shortened part early and more of it stays visible; acceptance does not pin this) (source: request)
- A first problem without a quoted requirement is cut at 160 runes by the existing cutAtWord (evidence: review/invalid.go) (source: request)
- The recorded problems (300 runes, 10 lines), the review_allowance event and the text told to the reviewer do not change; only the progress text does, and no configuration is added (constraint: no new configuration) (evidence: review/invalid.go) (source: request)
- Acceptance drives the real allowance path with a scratch in-package test file written into a copy of the checkout, so it never depends on a test the Build must write (evidence: review/invalid.go; review/invalid_cut_test.go) (assumption: Relies on the unexported run.allowance method and the Env interface names staying as they are) (source: request)
- A first problem longer than 160 runes that starts with a quoted requirement has its statement shortened with the existing cut marker and the reason after the closing quote kept whole; the reason is never cut (decision: D1, round 1) (constraint: the reason is never cut and has no length limit of its own) (constraint: a problem of 160 runes or fewer is byte-identical to today) (evidence: review/invalid.go; review/independent.go) (source: request)
- The statement gets the room left in 160 runes after the opening and the closing quote with the reason, cut by cutAtWord; with no room the statement is the cut marker alone and the line may pass 160 runes (decision: D2, round 1) (constraint: the reason is never cut) (evidence: review/invalid.go; review/invalid_cut_test.go) (source: request)
- The closing quote is the first quote followed by a space after the opening; without it the problem is cut at 160 runes as today (decision: D3, round 1) (evidence: review/independent.go) (assumption: Statements are quoted without escaping, so a statement containing a quote followed by a space ends the shortened part early; not pinned by acceptance) (source: request)
- A first problem without a quoted requirement is cut at 160 runes by cutAtWord (decision: D4, round 1) (evidence: review/invalid.go) (source: request)
- Recorded problems, the review_allowance event and the reviewer-told text do not change; no configuration is added (decision: D5, round 1) (constraint: no new configuration) (evidence: review/invalid.go) (source: request)
- Acceptance drives the real allowance path with a scratch in-package test file written into a copy of the checkout (decision: D6, round 1) (evidence: review/invalid.go; review/invalid_cut_test.go) (assumption: Relies on the unexported run.allowance method and Env interface names staying as they are) (source: request)

## Source comparison
- A 400-rune quoted requirement followed by the reason `has no evidence: probe it with shell against the candidate before the verdict` gives a line ending with the whole reason and a statement shortened with " ...": addressed by "A long requirement is shortened and the reason is kept".
- A reason that alone leaves no room within 160 runes is kept whole, the line passes 160 runes and the requirement is the cut marker alone: addressed by "A reason that leaves no room is kept whole and the requirement shrinks to the cut marker".
- A short requirement writes the same line as today (a problem of 160 runes or fewer is byte-identical): addressed by "A problem of at most 160 runes is shown unchanged".
- A first problem with no quoted requirement is cut at 160 runes as today: addressed by "A long problem that quotes no requirement is cut at 160 runes as before".
- Recorded problems (300 runes) unchanged: addressed by "The recorded problem stays cut at 300 runes".
- Wrong implementation named by the request, cutting the whole line at 160 runes: the control in controls.json.

## Tests
- A rejected verdict whose requirement is 400 runes long writes a progress line that ends with the reason; a short requirement writes the same line as today; a reason that leaves no room is kept whole; a problem without a quoted requirement is cut at 160 runes: add one model-free Go test in the review package next to review/invalid_cut_test.go (unit)
- The progress line end to end for a long requirement, a reason that leaves no room, a short problem, a problem without a requirement, and the recorded problem unchanged: acceptance.feature (scenario)
- The existing cut at a word and the pins in contract/external_test.go and contract/independent_test.go keep passing because their problems stay unchanged: existing tests (existing)

## Feasibility
- none
