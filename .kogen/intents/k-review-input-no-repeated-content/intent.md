# Deliver review source without repetition

Slug: k-review-input-no-repeated-content
Model: not applicable — this is a deterministic transformation of a saved Git candidate into review material and disjoint source slices, not a new workflow or mutable lifecycle
Acceptance:
- .kogen/intents/k-review-input-no-repeated-content/acceptance.feature
- features/steps/k-review-input-no-repeated-content__steps.js

Within one assembled review, including all its ordered parts, deliver each piece of candidate source once without losing changed lines. Apply this consistently to MaterialOf's ordinary Source and PartsSource and to the native and external consumers. Replace the ordinary full-text repetition of changed files with headings: their hunks remain in the diff. Added text files appear once with their Git mode, not also as an added-file diff. Renamed and copied files are represented once under the destination path, naming the origin without separately delivering its text. Preserve deletion hunks. Later parts refer to earlier material rather than resending it. Repeated authority and path-only catalogs are not candidate source duplication; independent reviews of newly verified repair trees are separate reviews. This does not ban reading additional checkout context with reviewer tools or change context-reset custody policy.

All changed lines, including removed lines and the small rename edit, must remain reachable exactly once; removing a file to meet a budget is not a valid implementation. Keep binary, gitlink, mode-only and no-final-newline behavior useful, and keep manifest, segments, hunk ranges and required-read accounting consistent with where material is actually delivered. Update misleading prompt text and affected existing tests when removing full changed-file texts. No new provider integration, configuration, or public API is required.

## Decisions
- Count source across the whole review, not per part; a changed file has diff hunks and only a heading outside the diff. (source: request)
- Deliver new files once with mode, and rename/copy destinations once with the old path named. (source: request)
- Preserve every changed line; zero occurrences is as invalid as two. (source: request)
- Later parts use references rather than repeated source. (source: request)

## Source comparison
- Addressed: request Problem and Need, ordinary duplicate changed-file text in review/material.go:159-168,216-228, and all-part delivery in review/parts.go are covered by the outcome above and the mixed-candidate acceptance; ordinary and split material must share the no-duplication guarantee.
- Addressed: synthetic examples 1-5 are represented by a real temporary Git repository containing added.txt, edit.txt, rename.txt -> renamed.txt with a small edit, copy.txt -> copied.txt and delete.txt. The feature requires exactly one occurrence of both added lines, edit old/new, rename old/new, copied content and deleted content in each complete route; context occurs once, added mode and origin/destination names remain visible. Split delivery is forced to two parts by reducing the byte ceiling.
- Addressed: dropping changed material is rejected by the same exact-one observer as duplicate material, with independent good/bad controls over every distinctive changed-line marker. The control is observer qualification, not a replacement for product execution.
- Superseded: existing full-text-of-every-changed-file descriptions are not intended behavior after this change. Preserve authority and verification evidence; do not remove useful source to save tokens. No requested behavior is intentionally omitted.

## Tests
- Added text appears exactly once with its mode: mixed Git MaterialOf capture and marker counts (integration)
- Changed text appears in diff hunks with headings only elsewhere and no repeated context: mixed candidate regression in both material routes (regression)
- Renames with edits and copies use their destination once and name their origin without a second source body: mixed Git fixture and destination/origin checks, with focused implementation tests of rename/copy rendering (integration)
- Deletion hunks and every changed line remain reachable exactly once: exact-one marker checks including removed and deleted lines (regression)
- Two ordered parts deliver disjoint source, and later parts reference prior material rather than resend it: actual materialBlocks/reviewParter rendering under a reduced ceiling, combined exact-one checks and existing part coverage tests (integration)
- Missing material fails just as duplicate material does: good control and missing/duplicate mutations of each marker through the same acceptance observer (unit)
- Native and external entry points consume the nonrepeating material without broken hunk-read accounting: update affected existing review and contract flow tests and run configured full checks (integration)

## Feasibility
- evidence: {"id":"source-observer","kind":"observer","inputs":["features/steps/k-review-input-no-repeated-content__steps.js"],"observers":["features/steps/k-review-input-no-repeated-content__steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/k-review-input-no-repeated-content__steps.js good","exit":0,"output":"observer good\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/k-review-input-no-repeated-content__steps.js bad","exit":1,"output":"observer rejected missing and duplicate material\n"}]}
