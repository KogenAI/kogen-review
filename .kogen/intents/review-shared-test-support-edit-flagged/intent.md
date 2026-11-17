# Flag shared test support edits in review

Slug: review-shared-test-support-edit-flagged
Model: not applicable — the change derives one text line from the changed paths and adds one fixed rule to two prompt texts; it adds no state, transition or interacting rule
Acceptance:
- .kogen/intents/review-shared-test-support-edit-flagged/acceptance.feature
- features/steps/review-shared-test-support-edit-flagged__steps.js
- features/steps/review-shared-test-support-edit-flagged__driver.js

Review approves a candidate that edits a file every test loads (a test entry file or shared helper) because nothing in the review material or task points at such an edit. After this change the review material lists the changed shared test support paths and the review task says what to do with them.

**Material.** In `MaterialOf` (`review/material.go`) the review source (`MaterialSet.Source`, and the same source in `PartsSource`) gets, before the diff section (after the check results, before the heading `# Diff of existing/deleted paths against start HEAD <short>`), one line `shared test support changed: <path>, <path>` followed by a blank line. The paths are the catalog entries with status `changed` (not `added`, not `deleted`, not a rename destination) that are shared test support, comma-plus-space separated, in catalog (path) order. With no such path the line and its blank line are absent and the source is byte-identical to today. The line is a fact about the candidate: it is printed whether or not the approved Intent names the paths. The line appears once per review, in the single-session source, in the parts route source (it lies in the first part, before the diff) and in the source of the native reset route, since all of them carry the one `MaterialSet` source.

**Shared test support** is a path that existed at the start commit (status `changed`) and is one of:
- a file whose base name is `test_helper.rb`, `spec_helper.rb`, `rails_helper.rb`, `conftest.py`, `setup_tests.js` or `setup-tests.ts`;
- a file in a directory whose path has a component named `test_helpers`, `test_support`, `spec_support` or `support` that lies under a directory named `test`, `tests`, `spec` or `features` (an earlier component of the directory path), for example `test/test_helpers/session_test_helper.rb`, `spec/support/a.rb`, `features/support/env.rb`;
- `config/environments/test.rb`;
- a dependency manifest or lockfile by base name (`Gemfile`, `Gemfile.lock`, `package.json`, `package-lock.json`, `go.mod`, `go.sum`, `mix.exs`, `mix.lock`, `pyproject.toml`, `requirements.txt`) when its change touches a line that is not a plain version bump. A change is a plain version bump when the removed lines and the added lines of its diff (`git diff -U0` between the start commit and the candidate tree) pair up in order, and each removed line equals its added line after every maximal run matching `[0-9][0-9A-Za-z.+_-]*` in both is replaced by `0` (so `    rails (7.1.0)` to `    rails (7.1.1)` is a bump; `gem "rails"` to `gem "rails", require: false`, an added line or a removed line is not).

A path under `test` that is merely new, or any other path with `test` in its name, is not shared test support. Detection reads only paths and the start commit tree, and the diff of a changed manifest; it never reads other file content and never reads the hidden grader.

**Task text.** One new rule, the exported constant `SharedTestSupportRule` in `review/policy.go`, is exactly:

`Shared test support: when the review source has a line starting ` + "`shared test support changed:`" + ` and the approved Intent does not name those paths, repair it: restore each listed shared file byte for byte and move the behaviour the candidate needs into a helper or override beside the candidate's own new test files; when that cannot be done within the Intent, submit changes with a blocking finding naming the path and the line. A path the Intent names is not an issue.`

(The text of the rule is the literal in `acceptance.feature`.) It is added once to `ReviewerInstructions()` (after `RequirementsRule`, before `unsupportedClaimsRule`) and once to `reviewTaskTail` in `review/parts.go` (same position), so it appears once in the native reviewer instructions, once in the external one-session task and once in the task of every external part. The review prompts under `review/testdata` are regenerated with the existing golden update test (`go test ./review ./contract -update`); nothing else changes there.

Nothing else changes: which diffs are delivered, the catalog (`Files`), the verdict schema, the allowance counts, any other prompt text; no configuration is added.

## Decisions
- The line is `shared test support changed: ` plus the changed shared test support paths joined by `, `, placed after the check results and before the `# Diff of existing/deleted paths` heading, followed by one blank line; absent with no such path (source: request)
- Only catalog entries with status `changed` can be listed; added, deleted and renamed paths never are (source: request)
- The directory rule means: some component of the directory path is `test_helpers`, `test_support`, `spec_support` or `support` and an earlier component is `test`, `tests`, `spec` or `features` (assumption: the request says "under a test, tests, spec or features directory"; reading it as an earlier path component at any depth is a choice) (source: request)
- A plain version bump is defined mechanically: removed and added diff lines of the manifest pair up in order and are equal once every version-like run `[0-9][0-9A-Za-z.+_-]*` is replaced by `0` (assumption: the request names "a plain version bump" without defining it; this definition is a choice that treats an added or removed dependency line, or any non-version change, as support) (source: request)
- The rule is the constant `SharedTestSupportRule`, appended to `ReviewerInstructions()` and `reviewTaskTail` right after `RequirementsRule`, with the exact wording above (assumption: the position and the exact wording are choices that fix the request's rule 2 for byte-exact acceptance) (source: request)
- The line is printed even when the Intent names the path; the rule text tells the reviewer a named path is not an issue (source: request)
- Nothing is configurable: the lists of names are constants (source: request)
- Golden prompt files are regenerated with the existing `-update` test (evidence: README.md; review/golden_update_test.go; review/prompt.go; review/parts.go; review/policy.go; review/material.go) (source: request)
- The acceptance exercises the real external review (`review.NewExternal`) of a saved Git candidate through a Go driver built from a copy of the checkout, as the existing parts-review acceptance does, and observes the exact brief of every session; the native instructions are observed through `review.ReviewerInstructions()` (evidence: features/steps/k-review-parts-earlier-repairs-named__driver.js; features/steps/k-review-parts-earlier-repairs-named__steps.js) (source: request)
- The Go tests of the review package (next to `review/material_test.go`) and of `contract/` (next to the existing material and external tests) use the existing candidate repository helpers and fake executor (evidence: review/material_test.go; contract/external_test.go; contract/helper_test.go) (source: request)

## Source comparison
- Addressed: the line `shared test support changed:` before the diff, changed paths only, in path order, absent with none (scenarios 1, 2, 6).
- Addressed: manifest and lockfile changes count only when not a plain version bump (scenarios 3a, 3b).
- Addressed: the rule text once in the native instructions, the external one-session task and each part task (scenarios 4a, 4b).
- Addressed: an Intent that names the path still gets the line (scenario 5).
- Addressed: the line once on the parts route (scenario 4b); on the reset route the same `MaterialSet.Source` is used, so the Go test of the review package checks the line once in the source the reset conversation carries.
- Addressed: no change to delivered diffs, catalog, verdict schema, allowance counts, other prompt text, configuration; goldens regenerated by the existing update test.
- Omitted by the request: content-based detection beyond the manifest line check, the hidden grader, any setting.

## Tests
- Scenario 1, a changed `test/test_helpers/session_test_helper.rb` is listed once, before the diff: add `TestSharedTestSupportLineBeforeTheDiff` to `review/material_test.go` and the acceptance scenario `A changed shared test helper is listed before the diff` (unit)
- Scenario 2, a new test file and a changed model file print no line: add `TestNoSharedTestSupportLineForANewTestFile` to `review/material_test.go` and the acceptance scenario `A new test file and a changed model print no line` (unit)
- Scenario 3, a plain version bump of `Gemfile.lock` prints no line and a `Gemfile` change adding an option names `Gemfile`: add `TestManifestChangeIsSupportOnlyWhenNotAPlainBump` to `review/material_test.go` and the acceptance scenarios `A plain version bump of a lockfile prints no line` and `A manifest change that is not a version bump is listed` (unit)
- Scenario 4, the rule appears once in the native instructions, once in the external one-session task and once in each external part task: add `TestSharedTestSupportRuleOncePerRoute` to `contract/external_test.go` (one-session and parts) and the acceptance scenarios `The rule is in the native instructions and the one-session task once` and `The rule is in every part task once and the line is in part 1 once` (unit)
- Scenario 5, an Intent that names the changed helper still gets the line and the rule says a named path is not an issue: add `TestSharedTestSupportLineWithNamedPath` to `review/material_test.go` and the acceptance scenario `An Intent that names the changed helper still gets the line` (unit)
- The line lists several changed paths in path order and never an added file: the acceptance scenario `Several changed shared paths are listed in path order and an added helper is not` (unit)
- The line is carried once on the reset route and the parts route source: add `TestSharedTestSupportLineOnceOnResetAndPartsRoutes` to `contract/reset_test.go` (unit)
- The existing prompt goldens match the new rule: regenerate `review/testdata/prompts_golden.json` with the existing update test (existing)

## Feasibility
- evidence: {"id":"shared-support-observer","kind":"observer","inputs":[".kogen/intents/review-shared-test-support-edit-flagged/acceptance.feature","features/steps/review-shared-test-support-edit-flagged__steps.js","features/steps/review-shared-test-support-edit-flagged__driver.js"],"observers":["features/steps/review-shared-test-support-edit-flagged__steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/review-shared-test-support-edit-flagged__steps.js --control good","exit":0,"output":"shared-test-support observer accepted controls\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/review-shared-test-support-edit-flagged__steps.js --control bad","exit":1,"output":"shared-test-support observer rejected 7 known-bad observations\n"}]}
- The driver source was built (`go build ./internal/shsdriver`) in a scratch copy of HEAD and compiles against the current public review API; the acceptance run itself is left to readiness.
