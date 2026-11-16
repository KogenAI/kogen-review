# Cut the rejected-verdict line at a word

Slug: review-rejected-verdict-line-cuts-at-word
Model: not applicable — the change is a pure text transformation of one progress line, with no state
Acceptance:
- .kogen/intents/review-rejected-verdict-line-cuts-at-word/acceptance.feature
- features/steps/review-rejected-verdict-line-cuts-at-word__steps.js
- features/steps/review-rejected-verdict-line-cuts-at-word__driver.js

The progress line `kogen: review <n>: verdict not accepted: <problem>` cuts the first problem at a fixed 160 runes in the middle of a word with no marker, so the reason that names what is wrong is lost. The observed line ended with the text `cites accep` followed by ` (829 s)`: the problem text is "requirement \"<statement>\" cites acceptance ...", so the 160 runes are spent on the quoted requirement and the reason after it is cut in the middle of "acceptance". When the first problem is longer than 160 runes, the line now shows the problem cut at the last word boundary within the limit, ending with " ..." (three dots, one space before). A problem of at most 160 runes is shown unchanged. The limit stays 160 runes counting the marker, so the shown problem never exceeds it. The cut is on a rune boundary. Only the progress text changes: the recorded problems (cut at 300 runes and 10 lines), the review_allowance event, verdict handling and the allowance counts stay as they are. The old mid-word cut of the progress line is replaced.

## Decisions
- The progress line for a rejected verdict shows the first problem whole when it has at most 160 runes; otherwise it shows the longest whole-word prefix that, followed by " ...", fits within 160 runes in total, so the shown problem never exceeds 160 runes (decision: D1, round 1) (constraint: progress text only: recorded problems, the review_allowance event, verdict handling and allowance counts are unchanged) (evidence: review/invalid.go; contract/external_test.go; contract/independent_test.go) (source: request)
- A word boundary is whitespace; trailing whitespace is trimmed before the marker; the cut is on rune boundaries (decision: D2, round 1) (evidence: review/invalid.go) (assumption: The request does not say what happens when the first 156 runes hold no whitespace; the implementation then cuts at 156 runes and appends the marker, which acceptance does not pin) (source: request)
- Acceptance drives the real allowance path with a scratch in-package test file written into a copy of the checkout, so it never depends on a test the Build must write (decision: D3, round 1) (evidence: review/invalid.go; review/main_hermetic_test.go) (assumption: Relies on the unexported run.allowance method and Env interface names staying as they are) (source: request)
- The progress line shows the first problem whole when it has at most 160 runes; otherwise the longest whole-word prefix followed by " ..." that fits in 160 runes in total (decision: D4, round 1) (constraint: progress text only: recorded problems, the review_allowance event, verdict handling and allowance counts are unchanged) (evidence: review/invalid.go; contract/external_test.go; contract/independent_test.go) (source: request)
- The cut of a problem over the limit is on a rune boundary: a problem with multi-byte runes is never split inside a rune (decision: D5, round 1) (evidence: review/invalid.go) (source: request)
- A word boundary is whitespace and trailing whitespace is trimmed before the marker (decision: D6, round 1) (evidence: review/invalid.go) (assumption: The request does not define a word boundary nor say what happens when the first 156 runes hold no whitespace; the implementation then cuts at 156 runes and appends the marker, which acceptance does not pin) (source: request)

## Source comparison
- Observed line (AoR climb, release 71bee33c, stderr.txt line "kogen: review 1: verdict not accepted"): the line ends with `cites accep` followed by ` (829 s)`: the mid-word cut this Intent replaces; superseded by the scenarios below.
- A 200-rune problem whose 160th rune is inside a word is shown cut at the previous word boundary with " ..." and within 160 runes: addressed by the scenarios "A problem over the limit is cut at the last word boundary" (200 runes) and "A problem of 161 runes is cut" in acceptance.feature.
- A problem within the limit is shown unchanged; exactly 160 runes is shown whole: addressed by "A problem of exactly 160 runes is shown whole".
- Multi-byte runes are cut on a rune boundary: addressed by "A problem with multi-byte runes is cut on a rune boundary".
- The limit stays 160 runes counting the marker: asserted in every cut scenario.
- No change to recorded problems, event, verdict handling or counts: asserted by the scenario "The recorded problem of a long rejected verdict stays whole"; existing pins in contract/external_test.go and contract/independent_test.go stay unchanged because their problems are within 160 runes.

## Tests
- A 200-rune problem is cut at the previous word boundary with the " ..." marker within 160 runes, 160 runes is shown whole, multi-byte runes are cut on a rune boundary: add one model-free Go test in the review package (unit)
- The progress line for a problem within the limit equals the problem: contract/external_test.go and contract/independent_test.go unchanged (existing)
- The rejected-verdict line end to end for 200, 161 and 160 rune and multi-byte problems, and the recorded problem unchanged: acceptance.feature (scenario)

## Feasibility
- none
