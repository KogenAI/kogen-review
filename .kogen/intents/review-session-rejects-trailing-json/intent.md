# Reject trailing JSON when decoding a review

Slug: review-session-rejects-trailing-json
Model: not applicable — DecodeSession is a stateless function of its input bytes
Acceptance:
- .kogen/intents/review-session-rejects-trailing-json/acceptance.feature
- features/steps/review-session-rejects-trailing-json__steps.js
- features/steps/review-session-rejects-trailing-json__driver/main.go

`review.DecodeSession` (review/independent.go) decodes one JSON value and returns without looking at the rest of its input, so a valid session followed by another JSON value is accepted although a checkpoint holds exactly one session value. After this change DecodeSession accepts one JSON value followed by optional whitespace and returns an error when any non-whitespace input follows that value. Nothing is replaced or removed: session fields, checkpoint encoding and review behavior are unchanged, and the valid, legacy, malformed and empty-input results stay as they are. The change is confined to `review/independent.go` and `contract/formats_test.go`.

## Decisions
- DecodeSession returns an error when any non-whitespace input follows the first JSON value (a second JSON object or any other text), and still accepts trailing whitespace. (evidence: review/independent.go; contract/formats_test.go) (source: request)
- The check is made on the same decoder after the first value, with no new option, setting or exported name; the returned error text is not part of the contract. (evidence: review/independent.go) (source: request)
- Existing results are kept: valid and legacy sessions decode, malformed state and empty input are errors, numbers stay json.Number. (evidence: contract/formats_test.go) (source: request)
- The regression cases are added to TestDecodeSessionReadsWhatACheckpointKept in contract/formats_test.go. (evidence: contract/formats_test.go) (source: request)

## Source comparison
- Trailing whitespace after a valid session decodes successfully: addressed by the whitespace scenario and the contract test.
- A valid session followed by a second JSON object returns an error: addressed by the second-input scenario and the contract test.
- Existing valid, legacy, malformed and empty-input cases keep their results: addressed by the last two scenarios and the existing test.
- Session fields, checkpoint encoding and review behavior: out of scope, untouched.

## Tests
- A session followed by whitespace decodes; a session followed by a second JSON object or other non-whitespace text is an error: add these cases to TestDecodeSessionReadsWhatACheckpointKept in contract/formats_test.go (unit)
- Existing valid, legacy, malformed and empty-input results are unchanged: the existing cases of TestDecodeSessionReadsWhatACheckpointKept (existing)
- DecodeSession through its public API on sample inputs: acceptance.feature scenarios driven by a Go program calling review.DecodeSession (scenario)

## Feasibility
- none
