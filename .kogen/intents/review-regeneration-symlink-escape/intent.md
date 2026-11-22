# Keep generated-file extraction inside scratch

Slug: review-regeneration-symlink-escape
Model: not applicable — extraction of an archive is a stateless function of the archive; there is no state machine to model
Acceptance:
- .kogen/intents/review-regeneration-symlink-escape/acceptance.feature
- features/steps/review-regeneration-symlink-escape__steps.js
- features/steps/review-regeneration-symlink-escape__driver/probe_test.go.txt

`extractTree(dir, archive string) error` in `review/generated.go` extracts the tar archive of a reviewed tree into the scratch directory `dir` before a generated file is regenerated. It checks archive paths lexically only, so an archive that holds a symlink and then an entry beneath it (or an entry with the symlink's own name) writes outside `dir`. After this change extraction returns an error for any entry whose parent folders, or whose own name for a folder or regular file, already exist in `dir` as a symlink made by the archive, and writes nothing through that symlink. `regenerate` already returns an extraction error before running the regenerating command, so no regeneration runs after the refusal. Ordinary folders, regular files and symlinks of a reviewed tree still extract with their content, mode and link target.

Out of scope and unchanged: generated-file detection, the regenerating commands and the review verdict policy. The signature of `extractTree` stays. No setting, flag or new file is added; the work is in `review/generated.go` and `review/parts_catalog_test.go`.

## Decisions
- An entry is refused with an error when a folder on its path below the scratch directory already exists as a symlink (for a symlink entry, only the folders above it are checked; for a folder or regular file, its own name is checked too). Nothing is written through the symlink. (decision: D1, round 1) (constraint: extractTree keeps its signature and returns the error to regenerate, which returns it before runRegenerate) (evidence: review/generated.go) (source: request)
- A symlink entry itself is created as before, whatever its target; only a later entry written through it is refused. A tree whose reviewed symlinks are never written through extracts unchanged. (decision: D2, round 1) (evidence: review/generated.go) (assumption: refusing every write through an archive symlink, even one whose target stays inside the scratch directory, is acceptable because a git archive of a valid tree never needs it) (source: request)
- The Build adds focused tests to review/parts_catalog_test.go: one that an archive with a symlinked parent pointing outside followed by a regular file beneath it (and the folder and same-name variants) makes extractTree return an error and leaves the outside target untouched, and one that ordinary folders, regular files and a relative safe symlink still extract. (decision: D3, round 1) (evidence: review/parts_catalog_test.go) (source: request)
- Acceptance names no test the Build must invent: a probe test owned by the acceptance (an acceptance helper) is copied into a copy of the checkout and run against the copy's own review/generated.go, and the copy's own tests of the review package must fail when extractTree is replaced by a lexical-only or a reject-every-symlink version. (decision: D4, round 1) (evidence: review/generated.go; review/parts_catalog_test.go) (source: request)

## Source comparison
- Request acceptance 1 (symlinked parent pointing outside, then a regular file beneath it: error and outside target untouched; lexical-only check is wrong): addressed by scenarios "A file beneath a symlinked parent is refused", the folder and same-name variants, and "The tests of the review package notice an extraction that checks only lexical paths".
- Request acceptance 2 (ordinary directories, regular files and safe symlinks still extract; rejecting all symlinks or regular entries is wrong): addressed by "Ordinary entries and a safe symlink still extract" and "The tests of the review package notice an extraction that rejects every symlink".
- Out of scope as the request states: generated-file detection, regeneration commands, review verdict policy.

## Tests
- An entry written through an archive symlink (file or folder beneath it, or a file named as it) makes extractTree return an error and leaves the outside target untouched: add TestExtractTreeRefusesEntriesWrittenThroughASymlink to review/parts_catalog_test.go (unit)
- Ordinary folders, regular files and a safe symlink still extract: add TestExtractTreeWritesOrdinaryEntriesAndSafeSymlinks to review/parts_catalog_test.go (unit)
- The extraction refuses writes through symlinks and keeps valid trees, and the review tests notice the wrong versions: acceptance.feature (scenario)

## Feasibility
- none
