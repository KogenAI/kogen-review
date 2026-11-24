# Limit manifest normalization to versions

Slug: manifest-number-normalization-scope
Model: not applicable — this is a stateless classification of a Git change
Acceptance:
- .kogen/intents/manifest-number-normalization-scope/acceptance.feature
- features/steps/manifest-number-normalization-scope__steps.js
- features/steps/manifest-number-normalization-scope__driver/main.go

When review material is prepared, a changed manifest is a plain version bump only if the changed numbers are version values and nothing outside those version values changes. Replace the blanket replacement of version-like runs in `plainVersionBump`. Recognize a version by its role in the manifest's syntax, not by a number-like spelling alone. For `package.json`, use JSON field context: the package's root `version` and version specifications in its dependency maps are eligible, but script commands and arguments are not. Keep non-version text significant, including dependency names and numeric settings, even when they look like versions. If a value cannot be identified as a version by its context and syntax, do not mask it.

The existing manifest set, path eligibility, non-manifest classifications, review policy, and material format stay unchanged. The manifest exemption does not override a path already classified as shared support by the unchanged path rules. Only `review/material.go` and `review/material_test.go` are in implementation scope.

## Decisions
- Treat a manifest change as a plain version bump only when the changed numbers are version values (source: request)
- Use version-bearing positions in the applicable manifest syntax; do not treat every numeric run, every JSON string, or an arbitrary field named `version` as a version value (evidence: review/material.go; review/material_test.go) (source: request)
- Keep `sharedTestSupportLine` and the `MaterialOf` output contract: include listed paths in catalog order after `shared test support changed: `; omit the line when none qualify (evidence: review/material.go; review/material_test.go) (source: request)
- Preserve actual dependency version changes in their version-only case, including the existing lockfile version case; retain the current cases for non-version edits, additions and removals of lines, and renamed dependencies (evidence: review/material_test.go) (source: request)

- The catalog stays exactly the existing manifest basename set; existing non-manifest support rules are unchanged (evidence: review/material.go; review/material_test.go) (source: request)
- Use the established 110000 ms Cucumber watchdog and 100000 ms subprocess watchdog for the local acceptance helper; they are fixture timeouts, not product guarantees (evidence: features/steps/review-session-rejects-trailing-json__steps.js) (source: request)

## Source comparison
- Superseded: `ev-f72ddaa4` identifies the unconditional numeric-run replacement in `review/material.go`; the contract above replaces it with normalization limited to version values. The previous shared-support Intent's numeric-run definition is superseded, not its output format or eligibility rules.
- Addressed: request acceptance 1 is the numeric script scenario, changing `--workers=1` to `--workers=2` and requiring `shared test support changed: web/package.json`. Acceptance 2 and 3 are separate version-only scenarios requiring no line, so neither can be hidden by another changed path. The wrong controls exercise all three requested counterexamples against those assertions.
- Addressed: the catalog scenario makes non-version edits to all existing manifest basenames and checks that the changed test helper is listed and the non-catalog package file is not; reviewer policy and prompt changes are omitted as outside the request.

## Tests
- Numeric script argument changes are shared support: add a regression case to `TestManifestChangeIsSupportOnlyWhenNotAPlainBump` and run the numeric script acceptance scenario (regression)
- A package version-only change is excluded: isolate the existing nested package case in `TestManifestChangeIsSupportOnlyWhenNotAPlainBump` and run the package version-only acceptance scenario (integration)
- A dependency version-only change is excluded: use an actual dependency map instead of the old top-level fixture entry in a separate `TestManifestChangeIsSupportOnlyWhenNotAPlainBump` case and run the dependency version-only acceptance scenario (integration)
- Existing lockfile bump, manifest non-version cases, and non-manifest classification remain intact: retain the other cases in `TestManifestChangeIsSupportOnlyWhenNotAPlainBump`, `TestSharedTestSupportLineBeforeTheDiff`, and `TestNoSharedTestSupportLineForANewTestFile` (existing)

- Keep the existing catalog and path rules: run `The manifest catalog and non-manifest path rules stay unchanged` (scenario)

## Feasibility
The configured Cucumber runner uses Node and the declared step files. From the module root, the steps run `go run ./features/steps/manifest-number-normalization-scope__driver` with Go 1.27.2, Git and the pinned project modules. Its stdin is one JSON array of edit objects with string fields `manifest` (relative path), `before` and `after` (complete file contents, including trailing newlines). The driver constructs a local start commit and candidate tree with exactly those edits. It calls `review.MaterialOf(review.Input)` with that commit and tree, an on-disk fixture acceptance file and a green `verify.Pass`. On success stdout is raw `MaterialSet.Source` from the returned set; execution errors fail the step rather than being observed as an empty source. The source assertion compares the exact ordered list of lines beginning `shared test support changed:` with the expected single line or empty list. No reviewer model, network, or package script execution is needed by the scenarios.

- Go 1.27.2 and Git 2.43.0 are available; the existing manifest test passes before the change. The scratch correct control passes the focused material tests. Both observer controls below were run against the retained driver and assertion bytes.
- evidence: {"id":"manifest-line-observer","kind":"observer","inputs":["features/steps/manifest-number-normalization-scope__driver/main.go","features/steps/manifest-number-normalization-scope__steps.js"],"observers":["features/steps/manifest-number-normalization-scope__steps.js"],"checks":[{"name":"good","command":"f=$(printf '%s\\n' '[{\"manifest\":\"Gemfile\",\"before\":\"gem '\\''rails'\\''\\n\",\"after\":\"gem '\\''rails'\\'', require: false\\n\"}]' | go run ./features/steps/manifest-number-normalization-scope__driver) && printf '%s\\n' \"$f\" | \"$KOGEN_NODE\" features/steps/manifest-number-normalization-scope__steps.js 'shared test support changed: Gemfile'","exit":0,"output":""},{"name":"bad","command":"printf '# Check results of the final pass\\n\\nshared test support changed: web/package.json\\n\\nshared test support changed: web/package.json\\n\\n# Diff of existing/deleted paths\\n' | \"$KOGEN_NODE\" features/steps/manifest-number-normalization-scope__steps.js 'shared test support changed: web/package.json'","exit":1,"output":"support lines: got [\"shared test support changed: web/package.json\",\"shared test support changed: web/package.json\"], want [\"shared test support changed: web/package.json\"]\n"}]}
