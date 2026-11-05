# Keep wide external reviews linear in their source

Slug: k-review-wide-change-cost-linear
Model: not applicable — the change is how a review part's text is rendered and where the source is cut, plus a one-time check of generated files before anything is sent; the part sequence, custody and approval rules keep their current state machine
Acceptance:
- .kogen/intents/k-review-wide-change-cost-linear/acceptance.feature
- features/steps/k-review-wide-change-cost-linear__steps.js
- features/steps/k-review-wide-change-cost-linear__driver.js

When an external review (`review.External`, built with `review.NewExternal`) has a complete first prompt that does not fit the inclusive 524288-byte ceiling (`reviewCeiling`, `tools.InputBudgetBytes`), it is reviewed in ordered parts. Each part runs in its own fresh session. The cost of this review in parts must grow about linearly with what the reviewer reads.

Today every part repeats the JSON catalog of every changed path. That block grows with parts × changed paths. When it alone leaves no room for source, the review stops before anything is sent, although the source could be cut into parts. A large generated data file is also sent in full. After this change:

- Above a fixed size, the catalog no longer goes into every part. Each part carries only the catalog entries of the paths whose material its own slice carries. It names the retained file that holds the complete catalog.
- A large generated data file is checked against the command that regenerates it before anything is sent. A match sends a digest instead of the text. A mismatch is a blocking finding. The file is never silently left out.
- A part whose material was never delivered names that part when its approval is refused.

Everything else stays exactly as it is today:
- The native reviewer (`review.Independent`): its conversation, its use of `Env.Request`, `Env.Prepare`, `Env.Unread`, `Env.Prefill` and `Env.Delivered`, its working-context reset (`reset.go`) and its request bytes.
- `MaterialOf` and `MaterialSet`, and the external review in one session.
- The stable text (`reviewPartsTask`, `reviewTask`) and every other line of a part's text.
- The cutting rules (a)–(c) of `reviewParter.cut`, the repaired-paths section and the re-cut after repairs.
- The ceiling, `MaterialPartBytes` (6000), the progress lines, the `review_parts` event and every existing field of `Material` and `Part`.

A change that fits one session, or whose parts carry a catalog of at most 6000 bytes and no large generated file, sends byte-identical requests.

The rules:

1. Scope. Only the review in parts changes: `External.Review` → `reviewInParts`, `parts.go`, and the custody check in `External.session` for a part (rule 4).

2. The changed-path section of a part. Let `catalog` be `json.Marshal(core.NonNil(m.Files))`, as today.
   - If `len(catalog) <= MaterialPartBytes` (6000), every part carries `catalog` exactly as today.
   - Otherwise, the text between `# Every changed path\n\n` and the `\n\n` before the repaired-paths section (or before `# Source part k of n`) is exactly:
     `This review changes <T> paths. The complete catalog of every changed path (path, status, origin, rename, mode, Git object, bytes and SHA-256) is retained in <F> under "parts"; read an entry there when this part does not carry it. The catalog entries of the <K> paths whose material this part's source carries:` + `\n` + `<J>`.
     - `<T>` is `len(m.Files)`.
     - `<F>` is `filepath.Abs(filepath.Join(in.Run.Dir, "executor-review", "review-<n>-material.json"))`, where `<n>` is the review number.
     - `<J>` is `json.Marshal` of those `<K>` entries of `m.Files`, unchanged and in catalog order (`[]` when there are none).
   - The material of a changed path in the parts source has two ranges `[start, end)`. Its block in the diff runs from the first byte of its `diff --git ` line to the first byte of the next `diff --git ` line, or to the end of the diff text, which is the newline just before `# Full text of every added file`. A renamed path's block is the one whose `b/` path is the path. Its entry in the added-files section runs from the first byte of its `--- <path>` line to the first byte of the next entry's `--- ` line, or to the end of the source for the last entry.
   - A part `[from, to)` carries a path when one of its ranges overlaps the part: `start < to && from < end`.
   - The mandatory prompt that `hasRoom` measures is part 1 of 1 with an empty slice, so it carries `[]`. Every candidate part in `cut`, `cutFrom` and `maxTo` is measured with its own section. That section can only grow as `to` grows, so the binary search stays valid. A recut after repairs uses the same rule.
   - In the wide example (3000 tiny added files), every part's text apart from its slice is at most 8192 bytes plus 600 bytes per entry it carries. Its text apart from its slice and its `<J>` line is at most 8192 bytes.

3. The retained material. `review-<n>-material.json` keeps the complete catalog under `parts`, as today. `review-<n>-source.txt` is the parts source as it is cut, with rule 5's summaries where they apply.

4. A part never read. In a part's session, an approval whose material was not delivered in a completed round of that session stops with `custodyInvalid("the review material of part <k> of <n> was not completely delivered in a completed round of the reviewer session")`, where `<n>` is the current number of parts. The review in one session keeps today's message. Unchanged: a retained part whose bytes changed after delivery still stops with `the retained review material review-<n>-part-<k>.txt changed`. A blocking verdict of part k still ends the review before part k+1.

5. Large generated files (review in parts only).
   - Detection. A path is a large generated file when all of these hold:
     - its status is `added` or `changed`, and it is not a rename or copy (empty `origin`);
     - it is not a gitlink;
     - its content in the pass tree is valid UTF-8 without NUL;
     - its content is longer than `MaterialPartBytes` (6000) bytes;
     - one of its first five lines matches `Code generated by (.+?)[.;]? DO NOT EDIT\.`. The first match counts: its trimmed, nonempty group 1 is the regenerating command, and its 1-based line is the marker line.
   - Regeneration happens before any part file, material file or session, once per distinct command:
     - Write the files of the pass tree, without `.git`, into a new temporary directory outside the checkout.
     - Run `sh -c <command>` there with empty stdin, the review process's environment and a 2-minute limit.
     - Remove the directory afterwards.
   - Outcome per file:
     - Exit 0 and identical bytes: summarised.
     - Exit 0 and different bytes, or the file was not written: mismatch.
     - A nonzero exit, a timeout or a failure to start: kept, with the full text as today.
   - Summarised. Only the parts source changes.
     - An added file's entry `--- <path> (added; mode <mode>)\n<content>` is replaced by the one line `--- <path> (added; mode <mode>; generated: <bytes> bytes, SHA-256 <hex>; regenerated by `<command>` with identical output; full text in the checkout)`.
     - A changed file's diff block is replaced by `diff --git a/<path> b/<path> (generated: <bytes> bytes, SHA-256 <hex>; regenerated by `<command>` with identical output; diff with git in the checkout)` followed by a newline. Its `--- <path> (changed; hunks in diff)` entry stays.
     - `<bytes>` and `<hex>` are those of the pass-tree content.
   - Any mismatch. Nothing is sent: no part is written and no session is started. The review ends with a Kogen-made `changes` verdict judged by the ordinary evaluation (`run.evaluate` with `external: true` on the green pass and its tree). That evaluation records it like any verdict and returns `candidate/review_blocked`. The verdict has one blocking finding per mismatching file, in path order: `{"path": <path>, "line": <marker line>, "severity": "blocking", "message": "generated file <path> does not match the output of its regenerating command `<command>`: reviewed SHA-256 <a>, regenerated SHA-256 <b>"}`. `<b>` is `none (the command did not write it)` when the file is missing.
   - Evidence. `Material` gains `Generated []GeneratedFile` with JSON key `generated`, omitted when empty. Each `GeneratedFile` is `{path, command, sha256, outcome}`, with `outcome` `summarised` or `kept`, one per large generated file of a review that goes on, in path order.

6. Non-source material that leaves no room. The stop is unchanged, byte for byte: `review: mandatory review prompt of executor <name> is <N> bytes without candidate source; fewer than 6000 bytes remain for source under the inclusive 524288-byte ceiling; nothing was sent. Inspect the run evidence; ordinary Refine and new exact approval are required if the Intent, README or diagnostic context must shrink.` (`candidate/context_budget_exceeded`). `<N>` is now measured with rule 2's bounded section.

7. No new command, flag or config key. The ceiling and `MaterialPartBytes` stay where they are.

## Decisions
- The review in parts stays one fresh session per part. Each part now carries only its own paths' catalog entries and the name of the retained catalog file. The full catalog stays inline while it is at most 6000 bytes, so a change with only a few paths sends identical bytes (source: request)
- A large generated file is summarised only after Kogen regenerates it in a scratch copy and gets identical bytes. The reviewer gets its digest and the command. A mismatch is a blocking finding before anything is sent. A command that cannot regenerate it leaves the full text in place (source: request)
- The native reviewer's shared conversation is not changed by this Intent. Its window, pinned parts and read ledger belong to the caller's `Env` (kogen-build). Changing it here broke three kogen-build consumer tests (source: request)
- The stop for non-source material that leaves no room keeps its exact text (source: request)

## Source comparison
- Addressed: "per-part sessions repeat the check results and the full catalog". Rule 2 bounds the catalog. The check results are one line per configured check (`verify.Pass.Results`), which is fixed by the configuration, not by the change. Scenarios 1 and 2.
- Addressed: "the review stops before anything is sent, although the source could be cut". The 3000-tiny-path change (3008 changed paths, 691812-byte catalog) stops today with `mandatory review prompt ... is 713185 bytes`. Scenario 2 requires it to be reviewed and sent.
- Addressed: "total input at most a fixed small multiple of the total part size; per-request input does not grow with the part index beyond a bounded digest". The multiple is 2× the review source, counting every first prompt plus all feedback. The digest bound is the same stable text for every part, and at most 8192 bytes apart from the slice and the entries line. Scenario 1 (N ≥ 6).
- Addressed: "a fixed bound plus a small amount per path in that part": 8192 + 600 per carried entry (scenario 2).
- Addressed: the review rules that still hold.
  - Never read: scenario 3, with the part now named.
  - Changed after it was read: scenario 4.
  - Middle blocking part: scenario 5.
  - Every changed path retained with full details: scenarios 2, 6 and 7.
  - A part that edits a path outside its slice: scenario 6. The repair is verified once and named to every later part, and the path's original entry stays in the part that carries it.
- Addressed: every hunk is still read. Scenario 1 and scenario 7 check that the parts carry the whole review source once, in order. Only verified generated files are summarised.
- Addressed: the large generated data file. Scenarios 7 and 8 use `data/table.csv` (57836 bytes, marker line 1 `# Code generated by sh gen/table.sh; DO NOT EDIT.`, SHA-256 ca6a61c86cfb1d2221f344d13502b3daf83f5ec8cd1b0eff46584266a60bf955). With row 1234 changed, its SHA-256 is 51240c73edfc6daa86da13e256c3fa06a9d48c32c87b3e944589acd528f4d5c0.
- Addressed: identical bytes for one part or few paths. Scenarios 9 and 10 pin the SHA-256 of every brief as observed on the unchanged tree. Scenario 10's fixture and hashes equal those of `k-review-parts-earlier-repairs-named`.
- Addressed: "no new command, flag or config key, and no raised limits". Scenario 12 checks the commands and flags, and scenario 11's exact stop names 6000 and 524288. The configuration is read through kogen-coordinator's `project.LoadConfig`, which is unchanged.
- Addressed: "when the non-source material still leaves no room, the stop names it and says nothing was sent". Scenario 11 checks the exact text (rule 6).
- Conflicting, resolved: "when the parts share one conversation, each part's request re-sends every earlier part". That conversation is the native reviewer's pinned-part conversation, and its working window, pinned parts and read ledger belong to kogen-build's `Env` (README: "the caller's working window stays the caller's"). The refused candidate 4c421b72 (Build c5f92308) changed it here. Three kogen-build tests then failed: TestAReviewWhosePartsAndScreenshotsCannotShareAWindowConvergesOnItsDeliveredParts ("exit 4 after 61 review requests"), TestKReviewVerdictStrandReset and TestKRevodGatePartsUnchanged. Each runs a context-based scripted reviewer that re-reads any part that is no longer in its window. The consumer gate requires these tests to pass. This Intent therefore leaves the native conversation unchanged and makes the per-part sessions linear. Shrinking the native shared window is left to the caller that owns it.
- Consumer gate, none intended:
  - TestReviewInPartsMandatoryMaterialStopsBeforeSending pins the stop text that rule 6 keeps byte for byte.
  - The three native tests above are covered by the native reviewer staying unchanged.
  - kogen-build's TestReviewInPartsLands and TestReviewInPartsOmitsAChangedFilesFullText change fewer than 25 paths, so their catalogs stay inline and their bytes are identical.
- Superseded: K-REVIEW-PARTS-LINEAR-INPUT (a per-part native conversation, parked) and K-REVIEW-PARTS-CATALOG-BOUNDED-PER-PART. This Intent replaces both.

## Tests
- A catalog over 6000 bytes is carried per part, as the exact section of the entries of the paths whose material overlaps the slice, in catalog order, naming the retained catalog: unit tests in `review/parts_test.go` for catalogs of exactly 6000 bytes (inline) and 6001 bytes (per part), a diff block that straddles a cut (listed in both parts) and an empty slice (`[]`); scenarios 2–6 (unit)
- A change whose full catalog leaves no room is reviewed and sent, and each part's text apart from its slice is at most 8192 + 600 per carried entry: scenario 2 reproduces today's stop (regression)
- A review in N ≥ 6 parts sends at most twice its review source in total, with the same stable text for every part and at most 8192 bytes apart from the slice and the entries: scenario 1 (integration)
- The requests of a one-session review and of a review in parts with an inline catalog are byte-identical to today's: scenarios 9 and 10 with pinned SHA-256 (regression)
- An approval of a part whose material was not delivered names the part: scenario 3; update the external custody test in `review/` (integration)
- A part whose retained text changed blocks approval; a blocking middle part stops the later parts: scenarios 4 and 5 (existing)
- A repair outside the part's slice is verified and named to every later part, and the path's original entry stays with the part that carries it: scenario 6 (integration)
- The retained material lists every changed path with its full details: scenarios 2, 6 and 7 (integration)
- Large-generated-file detection: unit tests for a marker on line 5 vs line 6; `;`, `.` and no separator; content of 6001 vs 6000 bytes; renamed, binary and deleted paths not considered (unit)
- A regenerated identical file is summarised with its digest and command, and its text is not sent: scenario 7 (integration)
- A regenerated file that differs is a blocking finding before any session: scenario 8 (integration)
- A command that exits nonzero keeps the full text and records `kept`; a changed generated file's diff block is summarised: Go test over a temporary Git checkout in `review/` (integration)
- `Material.generated` JSON: update `contract/formats_test.go` `TestMaterialEvidenceJSON` and the `review.Material` row of `contract/README.md` (integration)
- The stop for non-source material that leaves no room keeps its exact text: scenario 11 and kogen-build's TestReviewInPartsMandatoryMaterialStopsBeforeSending (regression)
- No new command or flag: scenario 12 (existing)
- The native reviewer is unchanged: the existing `review/` and `contract/` tests and kogen-build's native consumer tests (existing)

## Feasibility
- The review driver (a Go program over review's public API, built in a copy of the checkout at HEAD f71c745) reviews every fixture deterministically (probe: driver built from HEAD, exit 0):
  - The 3008-path wide fixture stops in about 46 s with `candidate/context_budget_exceeded`, a mandatory prompt of 713185 bytes and a 691812-byte catalog, and starts 0 sessions.
  - The 608-path fixture is reviewed in 6 parts in 8 s, with a 139812-byte catalog repeated in each part.
  - The few-paths fixture matches the three pinned briefs.
  - The one-session fixture sends 20928 bytes (stable c17f2842…, dynamic 9b22b6bb…).
  - The README fixture stops with the exact rule 6 text at 585578 bytes.
  - The generated fixture is reviewed in 4 parts with the data file sent in full, and its row-1234 mismatch approves.
- `sh gen/table.sh` writes `data/table.csv` with 57836 bytes and SHA-256 ca6a61c86cfb1d2221f344d13502b3daf83f5ec8cd1b0eff46584266a60bf955 in 0.04 s (probe: exit 0).
- On a history-free copy of the unchanged tree with this package, a cucumber run of the 12 scenarios took about 65 s of execution: 30.9 s for ten scenarios and 34.5 s for the two wide ones, whose shared review runs once. Scenarios 9–12 (identical bytes, stop text, no new command or flag) pass. Each of the other eight fails at its first missing-feature step:
  - 1 and 2 at "approves" (the stop for lack of room);
  - 3 at the stop's detail (the part is not named);
  - 4, 5 and 6 at the per-part section (the full catalog);
  - 7 at the summary line;
  - 8 at the stop (it approves).
  The custody, middle-block and repair steps before those failures pass on real data.
- The range rule computed on the real 608-path source lists every path in at least one part (union 608). In that source, `a.txt` and `d.txt` each have a diff block and an entry, and `tiny/t-0600.txt` lies only in the last part. The expected catalog entries (blob SHA-1, bytes, SHA-256) equal the real catalog's.
- evidence: {"id":"wide-observer","kind":"observer","inputs":["features/steps/k-review-wide-change-cost-linear__steps.js","features/steps/k-review-wide-change-cost-linear__driver.js"],"observers":["features/steps/k-review-wide-change-cost-linear__steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/k-review-wide-change-cost-linear__steps.js --control good","exit":0,"output":"known-good observations accepted\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/k-review-wide-change-cost-linear__steps.js --control bad","exit":1,"output":"rejected 21 known-bad observations\n"}]}
