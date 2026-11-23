# Verify executable permissions in generated scratch

Slug: review-generated-executable-script
Model: not applicable — the change adds tests of existing extraction behavior; there is no state machine to model
Acceptance:
- .kogen/intents/review-generated-executable-script/acceptance.feature
- features/steps/review-generated-executable-script__steps.js

This feature adds two model-free Go tests to `review/parts_catalog_test.go` that pin how the scratch copy of a reviewed tree, in which `regenerate` in `review/generated.go` runs a generated file's marker command, treats file permissions. In the first, a tracked executable script (mode 755, with a shebang line) is invoked directly by the marker command (`./gen/table.sh`): the regenerated file is identical and the generated file is summarised with its digest. In the second, the same script is not executable in the reviewed tree (mode 644): the direct invocation cannot run, so the file is kept and no finding is raised, which shows extraction adds no execute permission the reviewed tree lacked. `extractTree` already writes regular entries with their archived permission bits, so production code is unchanged.

Out of scope and unchanged: shell command syntax, marker parsing, and the regeneration time limit. No setting, flag or helper is added to production code.

## Decisions
- A tracked executable script keeps its execute permission in the scratch copy, so a marker command that invokes it directly regenerates the identical file and the file is summarised with its SHA-256 digest. (constraint: review/generated.go is unchanged) (evidence: review/generated.go; review/parts_catalog_test.go) (source: request)
- A script that is not executable in the reviewed tree stays non-executable in the scratch copy: the direct invocation fails, the outcome is kept and no finding is raised. (evidence: review/generated.go; review/parts_catalog_test.go) (source: request)
- Only review/parts_catalog_test.go gains tests; both use the existing wideReview helper with a large generated file and an `exactly(reviewCeiling+20000, "b")` file so the review is in parts. (evidence: review/parts_catalog_test.go) (source: request)
- Acceptance observes the behavior without naming tests the Build must invent: a copy of the checkout gets a wrong permission treatment written into review/generated.go just before the marker command runs (execute bits dropped from, or added to, every regular file of the scratch copy), and the tests of the review package must fail in that copy; the unchanged copy must pass. Both wrong copies pass on the unchanged tree, so both scenarios fail until the tests are added. The mutation inserts a call before the `ran := runRegenerate(ctx, dir, command)` line, so that line must remain in regenerate. (evidence: review/generated.go; review/parts_catalog_test.go) (assumption: a scratch run in a copy outside the checkout showed the new tests pass on the unchanged production code and fail under both wrong treatments; those runs are not Kogen's retained evidence) (source: request)

## Source comparison
- Request acceptance 1 (a model-free fixture tracks an executable generator script, invoked directly by the marker command, identical output summarised with the expected digest; dropping the execute bit is wrong): addressed by the executable-script test and the scenario "Dropping the execute permission is noticed".
- Request acceptance 2 (a control fixture with a non-executable script confirms extraction adds no execute permission; granting execute permission to every extracted file is wrong): addressed by the non-executable control test and the scenario "Granting execute permission to every file is noticed".
- Out of scope as the request states: shell command syntax, marker parsing, the regeneration time limit.

## Tests
- A marker command that directly invokes a tracked executable script regenerates the identical file and the file is summarised with its digest: add a test to review/parts_catalog_test.go that reviews a candidate in parts with such a script (integration)
- A script that is not executable in the reviewed tree is not made executable in the scratch copy: add a control test to review/parts_catalog_test.go with a mode 644 script whose direct invocation fails and whose file is kept (integration)
- The tests of the review package fail when execute bits are dropped from, or granted to, every file of the scratch copy, and pass on the unchanged extraction: acceptance.feature (scenario)

## Feasibility
- none
