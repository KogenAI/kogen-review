# Isolate the regeneration command environment

Slug: generated-command-environment-isolation
Model: not applicable — this changes a subprocess's environment, not the review state machine
Acceptance:
- .kogen/intents/generated-command-environment-isolation/acceptance.feature
- features/steps/generated-command-environment-isolation__steps.js
- features/steps/generated-command-environment-isolation__driver/probe_test.go.txt

Use a minimal, explicit subprocess environment for generated-file marker commands instead of forwarding the review process's complete environment. Preserve PATH lookup for ordinary generator tools, without passing through arbitrary parent variables. This is about subprocess environment inheritance, not filesystem sandboxing. Implementation scope: `review/generated.go` and `review/parts_catalog_test.go`.

Keep the existing outcomes: successful regeneration with identical bytes yields `summarised` and replaces generated text with its digest. An unsuccessful exit yields `kept` and leaves the full generated text in the review material without a mismatch finding. Marker parsing, timeout handling and scratch-tree output comparison remain unchanged. (evidence: review/generated.go; review/parts_catalog_test.go)

## Decisions
- A generator cannot read a sentinel variable set only in the parent review process. (evidence: review/generated.go) (source: request)
- Preserve the caller's PATH for tool lookup; use PATH alone in the known-good control, sufficient for the ordinary tool exercised here. Acceptance tests tool lookup and absence of the sentinel, not an exact environment listing. (evidence: review/generated.go; ran `"$KOGEN_NODE" features/steps/generated-command-environment-isolation__steps.js --good`) (source: request)
- The acceptance driver owns and supplies the test inputs: it sets its own parent-only sentinel `KOGEN_REGEN_TEST_SENTINEL` and installs its own `kogen-fixture-emitter` in a temporary PATH directory. These are fixture choices, not names the implementation must know or special-case. (source: request)
- `TestAcceptanceGeneratedCommandEnvironment`, `generated-environment-want`, and the case labels `failed_exit`, `sentinel_isolated` and `path_tool` identify only the test supplied by this Intent and the expectations passed to it by the step. The runner's buffer allocation `2 * 1024 * 1024` is test infrastructure, not a product limit. None of these literals is an expected value of the implementation under test. (source: request)
- A generator cannot read a sentinel variable set only in the parent review process. Pass through the caller's PATH and no other parent environment entries. (decision: D1, round 1) (constraint: Keep the existing sh invocation in the reviewed scratch tree; do not add an environment setting or a full-environment fallback.) (evidence: review/generated.go; review/parts_catalog_test.go; ran `"$KOGEN_NODE" features/steps/generated-command-environment-isolation__steps.js --good`) (source: request)

## Source comparison
- Addressed: evidence `ev-2d223e41` and acceptance 1; replace full `os.Environ()` inheritance at `runRegenerate` with explicit selection. The sentinel-checking generator fails under the full-inheritance control.
- Addressed: acceptance 2; the scenario requires a PATH-only tool to actually regenerate matching bytes and produce a digest summary. The no-PATH and skipped-command controls fail; Git archive excludes the reviewed CSVs from the scratch tree so a no-op cannot use preexisting bytes as matching output.
- Addressed: acceptance 3; the scenario observes retained and delivered text for an unsuccessful command even when it has written matching bytes. The ignored-exit control fails.
- Addressed: the requested two-file production/test scope and the marker, timeout and comparison exclusions are explicit above. Superseded: full-environment inheritance described in the historical wide-review Intent, only at the generated command boundary. (evidence: review/generated.go; review/parts_catalog_test.go)

## Tests
- Parent-only variables do not reach real generator subprocesses and the caller's PATH remains usable for matching regeneration: add a regression to `review/parts_catalog_test.go` with a parent-only sentinel and an executable in a temporary PATH directory, verifying real regeneration and digest summarisation (regression)
- An unsuccessful exit retains generated text: keep `TestReviewInPartsSummarisesOnlyAVerifiedGeneratedFile` (existing)
- Direct execution and timeout retention remain unchanged: keep `TestRegenerationRunsATrackedExecutableScriptDirectly`, `TestRegenerationDoesNotMakeANonExecutableScriptExecutable` and `TestReviewInPartsKeepsAGeneratedFileWhoseRegenerationTimesOut` (existing)
- Isolation, PATH tool discovery and nonzero-exit retention through external review in parts: run `acceptance.feature` with the configured strict Cucumber bridge (scenario)

## Feasibility
Use Go 1.27.2 or later, Git and `sh` on PATH and the configured Node/Cucumber runtime. The step runs `go test -json -count=1 -mod=readonly -buildvcs=false` in `./review` with the owned Go probe as a temporary overlay. It passes the feature's expected outcomes to that probe and requires that the selected test actually run and pass. The probe calls the existing `wideReview` fixture (`NewExternal(...).Review` with a real Git tree and scripted approving executor), checking ordered generated records from `executor-review/review-1-material.json`, retained `review-1-source.txt` and the delivered brief text. (evidence: go.mod; .kogen/project.yaml; review/parts_catalog_test.go)

- The existing executable-script test emitted the name-filtered Go JSON `run` and `pass` events and exited successfully. A separately overlaid test confirmed Go includes and runs the scratch probe file. The focused executable, non-executable, timeout and regeneration-failure tests passed on the unchanged implementation.
- The final observer accepted the PATH-preserving control and rejected each isolated wrong behavior for its expected reason, using real local Git, shell and Go test fixtures.
- evidence: {"id":"generated-env-observer","kind":"observer","inputs":[".kogen/intents/generated-command-environment-isolation/controls.json","features/steps/generated-command-environment-isolation__driver/probe_test.go.txt"],"observers":["features/steps/generated-command-environment-isolation__steps.js","features/steps/generated-command-environment-isolation__driver/probe_test.go.txt"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/generated-command-environment-isolation__steps.js --good","exit":0,"output":"existing executable-generator test and all environment probe cases passed\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/generated-command-environment-isolation__steps.js --bad","exit":1,"output":"rejected inherited environment, missing PATH, ignored command failure, and skipped regeneration\n"}]}
