# Cover edge cases of review material in tests

Slug: fix-k-review-input-no-repeated-content
Model: not applicable — the change adds Go tests only; the review material's production code and behavior stay unchanged
Acceptance:
- .kogen/intents/fix-k-review-input-no-repeated-content/acceptance.feature
- features/steps/fix-k-review-input-no-repeated-content__steps.js

This fixes a review finding on the landed Intent k-review-input-no-repeated-content (P2). The reviewer said that no test covers several cases: an added file with no trailing newline (its range may be off by one), a mode-only or gitlink change, a binary rename, and a check that later parts reference earlier material. The reviewer also noted that deleted-file accounting changed. The work is in review/material.go and its tests.

Reproduced on main (03ceb50). Main renders every one of these cases correctly. A scratch MaterialOf run of a two-line added file without a final newline gives the file range 1..2, diff_stat added 2 and the `\ No newline at end of file` marker, so there is no off-by-one. But no test asserts any of them. Each of the nine breaks named below was applied alone to a copy of main. Every time, `go test -count=1 ./review ./contract` still passed. No Go test asserts a deleted file's material either: dropping the deletion hunk from the source leaves the suite green. The only check of deleted material is the landed acceptance feature, which `go test` does not run.

The outcome is new Go tests in package `review` (directory `review/`), for example in `review/material_test.go`, so they can call `MaterialOf`, `materialManifestAt`, `materialBlocks` and `reviewParter`. Each break below must make `go test -count=1 ./review` fail with a failing test, and that command must pass on unchanged main. The acceptance check runs only `./review`, so tests in other packages do not count. Production code does not change: `review/material.go`, `review/parts.go`, prompts and golden files stay byte-identical. The acceptance check applies each break as an exact replacement of a unique fragment of those files. Keep every existing test green, including `TestMaterialRenameCopyAndHunkLocations`: the observer's good control relies on it catching a rename-skip break. Make no unrelated changes.

The breaks to catch, each applied alone. Each is an exact replacement in the unchanged file:
1. added file without final newline: hunk range — review/material.go `n := strings.Count(content, "\n")` becomes `n := strings.Count(content, "\n"); if n > 0 && !strings.HasSuffix(content, "\n") { n-- }`. A multi-line added file without a final newline loses its last line from its range and stat.
2. added file without final newline: marker — `rendered += "\n\\ No newline at end of file"` becomes `rendered += ""`.
3. mode-only change — `diffs = append(diffs, d)` becomes `if !strings.Contains(d, "\nold mode ") { diffs = append(diffs, d) }`. The mode change vanishes from the diff.
4. gitlink change — `parts = append(parts, heading+" (gitlink; change in diff)")` becomes `parts = append(parts, heading+"\nSubproject commit "+entry.Object)`. The new commit id is repeated outside the diff.
5. binary rename heading — `parts = append(parts, heading+" (binary)")` becomes `parts = append(parts, "--- "+p+" (binary)")`.
6. binary rename content class — `case utf8.ValidString(content) && !strings.Contains(content, "\x00"):` becomes `case utf8.ValidString(content):`.
7. later part byte reference — review/parts.go `return reviewPartHeader(k, n, from, to, len(c.source)` becomes `return reviewPartHeader(k, n, 0, to, len(c.source)`. Later parts claim to carry the source from byte 0.
8. deleted file accounting — `case open < 0:` becomes `case open < 0 || f["status"] == "deleted":`. This restores the old accounting, in which a deleted path adds no diff_stat.
9. deleted file hunk — `diffs = append(diffs, d)` becomes `if _, there := current[p]; there { diffs = append(diffs, d) }`. The deletion hunk vanishes.

What the tests assert. These are the current outputs on main, observed in a scratch run. Build a temporary Git repository the way the existing material test does, with a start commit and a candidate commit, then call `MaterialOf` and `materialManifestAt(c.Repo, start, tree, m.Files, m.Texts, m.Source, partsHeading)`:
- Added `tail.txt` with bytes `TAIL_ONE\nTAIL_TWO`, which has no final newline. The source contains `--- tail.txt (added; mode 100644)\nTAIL_ONE\nTAIL_TWO\n\\ No newline at end of file\n`. The manifest entry has diff_stat added 2, deleted 0, and one hunk with header `@@ -0,0 +1,2 @@`. The ranges include exactly `{tail.txt file 1 2}`. A `file` segment covers exactly `TAIL_ONE\nTAIL_TWO`.
- Mode-only change of `script.sh` with content `echo MODE_BODY\n`, mode 100644 to 100755, for example with `git update-index --chmod=+x`. The source contains `diff --git a/script.sh b/script.sh\nold mode 100644\nnew mode 100755\n` exactly once and the heading `--- script.sh (changed; hunks in diff)`. `MODE_BODY` does not occur in the source. The catalog entry has status `changed` and mode `100755`. The manifest has no hunks and diff_stat 0/0.
- Gitlink `sub` changed from `1111111111111111111111111111111111111111` to `2222222222222222222222222222222222222222`, written with `git update-index --add --cacheinfo 160000,<id>,sub` after `git add -A`. The source contains `-Subproject commit 1111111111111111111111111111111111111111` and `+Subproject commit 2222222222222222222222222222222222222222`, and `Subproject commit 2222222222222222222222222222222222222222` exactly once. It contains the heading `--- sub (gitlink; change in diff)`. The catalog entry has mode `160000` and git_object `2222222222222222222222222222222222222222`.
- Exact binary rename `old.bin` to `new.bin`. The content is valid UTF-8 that contains NUL: `BIN\x00` followed by 30 repetitions of `binary payload\x00\x01\x02`. The source contains `rename from old.bin\nrename to new.bin\n` and the line `--- new.bin (from old.bin) (binary)`. It has no `--- old.bin` heading and no `binary payload`. The catalog has exactly one entry for the pair: path `new.bin`, status `changed`, origin `old.bin`, rename true. There is no catalog entry with path `old.bin`.
- Deleted `gone.txt` with content `GONE_ONE\nGONE_TWO\n`. The source contains its deletion block `diff --git a/gone.txt b/gone.txt\ndeleted file mode 100644\n`, followed by `@@ -1,2 +0,0 @@\n-GONE_ONE\n-GONE_TWO\n`. `GONE_ONE` occurs exactly once, and the source has the heading `--- gone.txt (deleted)`. The catalog entry has status `deleted` and mode `100644`. The manifest entry has diff_stat added 0, deleted 2, and one hunk: old_start 1, old_count 2, new_start 0, new_count 0, header `@@ -1,2 +0,0 @@`. There is a `diff` segment for `gone.txt`, and the ranges include exactly `{gone.txt diff 6 8}`.
- Later parts reference earlier material. Take a real `MaterialOf` source of such a candidate. Build `materialBlocks(c, tree, m)` and a `reviewParter` over `m.PartsSource`, with measure `len` and a ceiling that yields at least two parts; the landed acceptance capture shows how to search for such a ceiling. Then, for every rendered part k: its text is `c.header(k, n, from, to)` followed by exactly `PartsSource[from:to]`. Its header contains `This part carries bytes [from, to) of the N bytes of the candidate's complete review source (SHA-256 sum); the other parts carry the rest, in order.`, where N is `len(PartsSource)`. The first part's `from` is 0, and each later part's `from` equals the previous part's `to`. The slices joined in order equal `PartsSource`.

## Decisions
- Fix by adding tests only. The edge cases behave correctly on main, so production code and the delivered material stay unchanged. (source: request)
- Keep the current deleted-file accounting: a deleted path's manifest entry counts its removed lines and lists its hunks, and its hunk range lies in its diff block. Pin it with a test instead of reverting to the earlier "no stat" accounting. The manifest is not populated by any production caller, so this changes nothing a reviewer receives. (source: request)
- "Later parts reference earlier material" means each later part's header names the exact byte range it carries within the whole source, continuing from the previous part, and its slice resends no earlier byte. (source: request)

## Source comparison
- Addressed: request "show it first". The nine breaks above, each applied alone to a copy of main, leave `go test -count=1 ./review` green; on main `./review ./contract` together stay green too. The acceptance feature reproduces this on the unchanged tree: legitimate missing-coverage red.
- Addressed: "added file with no trailing newline (range may be off by one)". Main computes range 1..2 for a two-line file without a final newline, so there is no off-by-one, but nothing asserts it. Breaks 1 and 2.
- Addressed: "a mode-only or gitlink change". Breaks 3 and 4.
- Addressed: "a binary rename". Breaks 5 and 6.
- Addressed: "later parts reference earlier material". Break 7.
- Addressed: "Deleted-file accounting changed" and "Confirm a deleted-file test exists". No Go test asserts deleted-file material on main; only the landed acceptance feature does, and `go test` does not run it. Breaks 8 and 9 require one.
- Addressed: "Keep every existing test green; no unrelated changes". The acceptance runs the unchanged-tree baseline, and the configured checks run the whole suite. Production files stay byte-identical, because each break must find its exact fragment once.
- Omitted: an added gitlink and added binary files. The request does not name them.

## Tests
- A multi-line added file without a final newline has the file range, stat and hunk header for all its lines and the no-newline marker in the source: new MaterialOf/materialManifestAt test of `tail.txt` (regression)
- A mode-only change reaches the source as its old/new mode diff with a changed heading, without its content: new MaterialOf test of `script.sh` (regression)
- A changed gitlink appears in the diff and its new commit id appears exactly once: new MaterialOf test of `sub` (regression)
- A binary rename is one catalog entry under the destination, naming the origin and marked binary, without content: new MaterialOf test of `old.bin` to `new.bin` (regression)
- Later parts name their exact continuing byte range and carry only their own slice: new materialBlocks/reviewParter test over a real MaterialOf source split into at least two parts (regression)
- A deleted file's deletion hunk is delivered once, with its heading, catalog status, manifest stat, hunk and diff range: new MaterialOf/materialManifestAt test of `gone.txt` (regression)
- Existing tests keep passing: the existing review and contract tests and the configured checks (existing)

## Feasibility
- evidence: {"id":"break-observer","kind":"observer","inputs":["features/steps/fix-k-review-input-no-repeated-content__steps.js"],"observers":["features/steps/fix-k-review-input-no-repeated-content__steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/fix-k-review-input-no-repeated-content__steps.js good","exit":0,"output":"observer good\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/fix-k-review-input-no-repeated-content__steps.js bad","exit":1,"output":"observer rejected surviving and uncompilable breaks\n"}]}
