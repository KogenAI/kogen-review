# Name the changed file in a path refusal

Slug: review-finding-path-refusal-names-changed-file
Model: not applicable — a stateless check of one cited path against an in-memory catalog of changed paths; no state or interacting rules
Acceptance:
- .kogen/intents/review-finding-path-refusal-names-changed-file/acceptance.feature
- features/steps/review-finding-path-refusal-names-changed-file__steps.js

A review verdict whose finding names a path that is not a file of the repository is refused with `PATH is not a file of the repository`. The reviewer then has to guess the right path. This change makes that refusal name the matching changed file when exactly one exists.

Verdict validation is `run.validate` in `review/independent.go`; the native reviewer, the external reviewer (`External.verdictOf`) and the public `review.Validate` all run it. Where `r.findingPath(path)` fails, it appends `path+" is not a file of the repository"`.

After this change, when the cited path is not a file of the repository, the problem gets a hint if exactly one path of the catalog of changed paths (`MaterialSet.Files` in `review/material.go`, obtained as `MaterialOf(r.in).Files`; each entry's `path`) is a path suffix of the cited path or has the cited path as a path suffix. The comparison is on whole path components after cleaning the cited path (`studio_web.ex` does not match `web.ex`). The problem is then `PATH is not a file of the repository; did you mean MATCH`, with PATH as submitted and MATCH the catalog path. With no match or more than one, the text is exactly as today.

One helper on `run` builds the hint, and the one call in `validate` uses it, so the native and external routes give the same text. The helper returns no hint, and does not read the catalog, for an absolute path, a path whose clean form is `..` or starts with `../`, or a path that exists in the checkout (`os.Lstat`; such a path was refused for resolving outside the root, a link). No file system search beyond the in-memory catalog.

Unchanged: `findingPath`, the acceptance check, the allowance counts, the verdict schema, the `review_allowance` and review events, and every other problem text. No configuration is added.

## Decisions
- The hint is `; did you mean MATCH` appended to the unchanged refusal text, only when exactly one changed path matches by whole-component suffix in either direction. (source: request)
- The catalog is `MaterialSet.Files`, obtained as `MaterialOf(r.in).Files` only when a refusal happens, because `validate` (also reached through the public `review.Validate`) holds no material. (evidence: review/independent.go; review/material.go; review/external.go) (source: request)
- A cited path that exists in the checkout, is absolute or leaves the root gets no hint, so an escape reveals nothing outside the root. (evidence: review/independent.go) (source: request)
- If `MaterialOf` fails, the refusal has no hint and keeps today's text, because the request says nothing about a catalog that cannot be read and no hint is the unchanged behavior. (assumption: a failed catalog read must not turn a refusal into a different error) (source: request)
- Tests are focused, model-free Go tests in `contract/validate_test.go` next to the existing `missing.txt` case. (evidence: contract/validate_test.go) (source: request)
- Build the hint in one helper on run that reads the catalog from MaterialOf(r.in).Files only on a refusal, skipping absolute, ../ and checkout-existing paths. (decision: D1, round 1) (constraint: findingPath and all other problem texts unchanged) (constraint: no file system search beyond the in-memory catalog) (evidence: review/independent.go; review/material.go; review/external.go) (assumption: The shape of the external feedback line 'Not a valid verdict: <problems>. Submit a corrected structured verdict.' for a single problem was read from an existing test, not run; the driver overlay was not run in this session.) (source: request)

## Source comparison
- Observed (kogen-loops run studio-redesign-app-shell, runs/studio-redesign-app-shell/build.log), the log lines that motivate this change: `kogen: reviewing (review 1, part 1 of 3) (5458 s)`, then `kogen: review 1: verdict not accepted: lib/studio_web/lib/studio_web.ex is not a file of the repository (5513 s)`, then `kogen: review 1: approve, 0 blocking (5522 s)`. The cited `lib/studio_web/lib/studio_web.ex` is the doubled-prefix path of the first scenario; with this change the refusal reads `lib/studio_web/lib/studio_web.ex is not a file of the repository; did you mean lib/studio_web.ex` when the candidate changed `lib/studio_web.ex`.
- Addressed: expected 1 (one matching changed path gives the hint): scenario "A doubled-prefix path names the one changed file".
- Addressed: expected 2 (no match keeps today's text): scenario "A path matching no changed file keeps the old text".
- Addressed: expected 1 (more than one match gives no hint): scenario "Two matching changed files give no hint".
- Addressed: expected 3 (escapes never get a hint): scenario "A path that leaves the root gets no hint" (`../outside.txt` with a changed `outside.txt`); absolute and link paths are covered by the helper rule and the unit tests.
- Addressed: expected 3 (one helper for both routes): scenario "The external review gives the same hint".
- Preserved: the existing `missing.txt`, `../outside.txt`, `dir/../../outside.txt`, `$OUTSIDE` and `link.txt` cases of `contract/validate_test.go`, `contract/reset_test.go` and the acceptance of k-review-finding-path-inside-root keep their exact text.

## Tests
- A cited path that matches exactly one changed path by whole-component suffix gets `; did you mean MATCH`: add a case in `contract/validate_test.go` next to the `missing.txt` case with a changed `lib/studio_web.ex` and the finding path `lib/studio_web/lib/studio_web.ex`, plus the first acceptance scenario (unit)
- A path matching no changed file keeps exactly today's text: the existing `missing.txt` case in `contract/validate_test.go` plus the second acceptance scenario (unit)
- Two matching changed files (`app/a/config.ex`, `app/b/config.ex`, cited `config.ex`) give no hint: add a case in `contract/validate_test.go` plus the third acceptance scenario (unit)
- A path that escapes the root (`../outside.txt` with a changed `outside.txt`, an absolute path, a link) gets no hint: add cases in `contract/validate_test.go` next to the existing escape cases plus the fourth acceptance scenario (unit)
- The external route gives the same problem text for the same cited path: add a case in `contract/validate_test.go` that runs the external review on it and compares the problem text, plus the fifth acceptance scenario (unit)

## Feasibility
- none
