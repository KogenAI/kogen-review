# Name earlier parts' repaired paths in later parts

Slug: k-review-parts-earlier-repairs-named
Model: not applicable — each part's list is a pure function of two verified trees, and re-cutting the unsent parts is a deterministic recomputation over the unchanged review source; no new lifecycle or interacting state
Acceptance:
- .kogen/intents/k-review-parts-earlier-repairs-named/acceptance.feature
- features/steps/k-review-parts-earlier-repairs-named__steps.js
- features/steps/k-review-parts-earlier-repairs-named__driver.js

When an external review (`review.External`, `review/external.go` `reviewInParts`, `review/parts.go`) reviews a source too large for one prompt in ordered parts, the prompt of every part after the first names, as exact data, the paths whose content differs from the review source because a reviewer of an earlier part repaired them, and tells the reviewer to read those files from the checkout. Today a later part is only told in general (`reviewPartsTask`) that earlier reviewers may have made verified repairs. When no earlier part repaired anything, every prompt and the material evidence stay byte-identical to today's. The native reviewer (`review.Independent`) and an external review in one session are unchanged. `reviewPartsTask`, `reviewTask`, `prompts/reviewer.md` and the goldens are unchanged.

The list of part k (k ≥ 2). Just before part k is sent, its list is the paths that differ between the tree of the green pass the review started from (`in.Evidence.Pass.Tree`, the tree the review source was cut from) and the tree of the verified pass the approval of part k−1 bound (the `current` pass `reviewInParts` already carries into part k), as `Candidate.Repo.Changed(base, current)` lists them (no rename detection: a renamed path appears under both names). The list is sorted in byte order with each path once. It therefore holds every earlier part's verified repairs: a path repaired in two parts appears once, and a repair that restored a path's content leaves it out. Part 1 never has a list.

The section. A non-empty list is sent as this section of part k's dynamic text (the part text; the stable text, authority plus `reviewPartsTask`, is unchanged). It is placed right after the `# Every changed path` catalog and its blank line, just before the `# Source part k of n` heading:

```text
# Paths repaired by earlier parts

Reviewers of earlier parts repaired these paths, and Kogen verified the repairs, after the review source was cut: what the review source shows of them is stale or missing. Read each of them from the checkout.

<list line>

```

That is the heading line, a blank line, the instruction line, a blank line, the list line and a blank line, each ending in `\n`. The list line is the shown paths as `json.Marshal` of a `[]string` encodes them (for example `["a.txt","d/new.txt"]`). When paths are left out, it is followed by ` and N more`, where N is the number left out (for example `["a.txt"] and 3 more`). An empty list adds no section.

The cut of the list. The whole section, from the heading to the final blank line, is at most 3000 bytes (`MaterialPartBytes / 2`). When the whole list fits, every path is shown. Otherwise the shown paths are the longest prefix of the sorted list whose section, with its ` and N more`, is at most 3000 bytes; this can be the empty prefix, shown as `[] and N more`. Example: 2200 repaired paths of 240 bytes each (their full JSON list is 534601 bytes, over the 524288-byte ceiling) show the first 11 and ` and 2189 more`, a 2935-byte section.

The ceiling still holds. The section counts toward each part's measured first prompt (`reviewMeasure`, inclusive `reviewCeiling`). Parts are cut as long as possible, so a section cannot just be added to an already cut part. So whenever part k's list differs from the list the not-yet-sent parts were last rendered with (initially the empty list), the review source from part k's start byte to its end is cut again before part k is sent. The new cut uses the existing rules (`reviewParter`: each complete prompt at most the ceiling, equality fits; one path's material kept whole when it fits one part; otherwise end after a newline, else at a UTF-8 character boundary). Each re-cut part's header carries part k's section, with the cut of the list computed for that part. Parts are numbered on from k, and the headers of the re-cut parts name the new total number of parts. Parts already sent are never changed, and the source itself is never changed. Every re-cut part's text is written to its private file (`review-<n>-part-<k>.txt`, 0600) and measured before part k is sent; a part over the ceiling stops with the existing `candidate/context_budget_exceeded` stop. Its `Material.ReviewParts` entry (from, to, bytes, sha256, prompt_bytes) replaces the entry for that part number. The entries end at the new count, the part files of numbers beyond the new count are removed, and the material evidence is persisted. The following parts' progress lines and the last-part delivery rule use the new count. A list that does not change from one part to the next causes no re-cut, so a review without repairs is cut and sent exactly as today. Because `hasRoom` already requires at least `MaterialPartBytes` (6000) bytes of room for source and the section takes at most 3000, a re-cut part always has room.

The evidence. `review.Part` (the entries of `review_parts` in `review-<n>-material.json`) gains `RepairedPaths []string` with JSON key `repaired_paths` (the paths shown in that part's section, in order) and `RepairedMore int` with JSON key `repaired_more` (the N of ` and N more`). Both are `omitempty`, so a part sent without a section, and a list with nothing left out, keep today's keys.

## Decisions
- Every part after the first names the paths earlier parts' reviewers repaired, as exact data, and tells the reviewer to read them from the checkout; with no repairs the prompts are unchanged byte for byte. (source: request)
- The list holds paths only, from the verified change set of the earlier parts (the green start tree against the tree the previous part's approval bound), sorted, each once. (source: request)
- The list counts toward the measured prompt, the ceiling holds, and a list that cannot fit is cut with a visible ` and N more`. (source: request)
- The material evidence records the list each part was sent (`repaired_paths`, `repaired_more`). (source: request)
- The section text, its placement before the source heading and its 3000-byte cap are technical choices of this Intent. The unsent parts are re-cut because the existing cut fills parts to within a few bytes of the ceiling (observed: 26 and 14 bytes left in parts 1 and 2 of the fixture). (source: request)

## Source comparison
- Addressed: Problem (later parts review stale diff text of rewritten files) and Need (exact path list for every part after the first, from the verified change set of earlier parts, read from the checkout) are covered by the list, section and re-cut rules above and scenarios 2–4 and 6.
- Addressed: "When no earlier part repaired anything the prompt is unchanged byte for byte" is checked by pinning, for each of the 3 parts, the source range, the measured prompt bytes and the SHA-256 of the exact stable and dynamic brief the review sent on the unchanged tree. The fixture's commits have fixed dates, so its review source is the same bytes in every run.
- Addressed: "the list counts toward the measured size … cut with a visible count rather than exceeding the ceiling" is covered by the 3000-byte section cap, the re-cut and scenario 5, which uses a list longer than the ceiling itself (2200 paths of 240 bytes) and expects ` and 2189 more`.
- Addressed: "The private review material evidence records the list sent to each part" is covered by `repaired_paths`/`repaired_more` and scenarios 5 and 6.
- Addressed: synthetic acceptance 1–6 maps to the six scenarios, in order, over a synthetic Git repository whose review source needs three parts (a.txt changed, big.txt of 44000 lines added), with a scripted external reviewer that writes files in the checkout before it approves.
- Superseded: today's later parts are sent from a cut made before part 1 and are never re-rendered. That stays true only while the list is unchanged.
- Omitted: nothing requested. The general sentence in `reviewPartsTask` stays (changing it would change the unrepaired prompt bytes).

## Tests
- A review in parts without repairs sends byte-identical prompts and records no repaired paths: scenario 1, against the SHA-256 of every brief observed on the unchanged tree (integration)
- Part k lists the sorted, unique paths changed between the green start tree and the tree part k−1's approval bound, in the specified section just before the source heading, and part 1 has none: scenarios 2–4 and 6; unit tests of the section rendering in `review/parts_test.go` (integration)
- A list whose section exceeds 3000 bytes shows the longest fitting prefix and ` and N more`: unit tests at the boundary (a section of exactly 3000 bytes shows every path; one more byte cuts with the count; the empty prefix `[] and N more`) and scenario 5 (unit)
- Re-cutting the unsent parts keeps every part's measured prompt within the ceiling and the slices consecutive over the whole source, with headers naming the new count: unit test of the re-cut from a part in `review/parts_test.go` and the ceiling/coverage checks of scenarios 2–6 (unit)
- `review_parts` entries record `repaired_paths` and `repaired_more`, absent when there is no section or nothing is left out: scenarios 5 and 6; update `contract/formats_test.go` `TestMaterialEvidenceJSON` to pin the two keys (integration)

## Feasibility
- The fixture (a.txt changed, big.txt of 44000 30-byte lines added, commits with fixed dates) is reviewed in exactly 3 parts on the unchanged tree, with the same bytes in every run. The parts are [0, 502434), [502434, 1004874) and [1004874, 1320445), with measured prompts of 524262, 524274 and 337406 bytes, so parts 1 and 2 are 26 and 14 bytes under the ceiling. A scripted part-1 repair is verified and approved in two rounds, and parts 2 and 3 are then sent without any list. (probe: driver built from HEAD, exit 0, 0.9 s)
- In a history-free copy of the unchanged tree, scenario 1 passes (11 of 11 steps). Scenario 2 fails only at "part 2's prompt lists the repaired paths '["a.txt"]'". (probe: cucumber on single scenarios, 1.3 s each)
- 2200 files of 240-byte paths written by the part-1 reviewer are reviewed in 3 parts on the unchanged tree. (probe: exit 0, 1.6 s)
- evidence: {"id":"parts-observer","kind":"observer","inputs":["features/steps/k-review-parts-earlier-repairs-named__steps.js"],"observers":["features/steps/k-review-parts-earlier-repairs-named__steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/k-review-parts-earlier-repairs-named__steps.js --control good","exit":0,"output":"known-good observation accepted\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/k-review-parts-earlier-repairs-named__steps.js --control bad","exit":1,"output":"rejected 11 known-bad observations\n"}]}
