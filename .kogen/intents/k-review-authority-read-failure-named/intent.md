# Name unreadable model and README in authority

Slug: k-review-authority-read-failure-named
Model: not applicable — the change is a stateless text rendering rule of the review authority
Acceptance:
- .kogen/intents/k-review-authority-read-failure-named/acceptance.feature
- features/steps/k-review-authority-read-failure-named__steps.js

The review's authority text (built by `MaterialOf` in review/material.go) reads the optional model file and the protected README from the candidate's checkout. Only a file that does not exist is absent. Any other read error (permission, the path is a directory, I/O error) on the model file or on the protected README makes the authority say, in the place the file would appear, that the file exists but could not be read, naming its path and the error text. An absent file keeps today's wording: no model section for an absent model, and "(no README.md)" for an absent README. When everything is readable the authority is byte-identical to today's. The review still runs: the notice is data for the reviewer, `MaterialOf` does not fail, and the cost-and-effect record is unchanged. The feature read still stops the review on any error, as today. A README that is not protected is read from the start commit and is unchanged.

## Decisions
- The notice is an ordinary line in the authority at the file's place: for the model, under the `# model.qnt` heading; for the README, in place of the README body under its heading. It contains the file's path (`.kogen/intents/<slug>/model.qnt` or `README.md`), the words "exists but could not be read" and the error text of the failed read. (source: request)
- Absence is decided by `errors.Is(err, fs.ErrNotExist)` only. (evidence: review/material.go) (source: request)
- The acceptance fixture makes a file unreadable by replacing it with a directory, which fails the same way for any user, including root. (assumption: mode 000 is covered by the same code path) (source: request)

## Source comparison
- Readable model and README: authority unchanged (addressed, acceptance scenario 1).
- Absent model: no notice, no model section (addressed, scenario 2).
- Unreadable model: notice with path and error, review runs (addressed, scenario 3).
- Unreadable protected README: notice naming README.md and the error, not "(no README.md)" (addressed, scenario 4).
- Absent README: "(no README.md)" (addressed, scenario 5).
- Cost-and-effect record unchanged (not touched).

## Tests
- Readable files leave the authority unchanged; an absent model adds nothing: scenarios 1 and 2 of acceptance.feature (scenario)
- Unreadable model and unreadable protected README are named with path and error; absent README keeps its wording: scenarios 3, 4 and 5 of acceptance.feature (scenario)

## Feasibility
- none
