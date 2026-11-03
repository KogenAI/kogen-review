# Drop producer definition byte pins

Slug: k-review-drop-loop-def-pin
Model: not applicable — this changes a stateless consumer contract assertion
Acceptance:
- .kogen/intents/k-review-drop-loop-def-pin/acceptance.feature
- features/steps/k-review-drop-loop-def-pin__steps.js

Replace the producer-definition byte pin in consumes/kogen-loop/defs_test.go with assertions of only the interface kogen-review consumes. Preserve the existing test name TestDefinitionIsTheGenericToolDefinition so the independent acceptance harness can run it. Update consumes/kogen-loop/README.md to describe the narrower contract. Do not change production policy, reviewer-owned goldens, or unrelated consumer tests. No dependency upgrade is required.

Each of the six tools handed to the model must exist under its name. Assert these parameter names and JSON types, with the stated required status: read_file: path string required, start_line and end_line integer optional; view_image: path string required; list_files: path string optional; search_text: pattern string required and path string optional; write_file: path and content string required; shell: command and handle string optional. Required lists are sets, not ordered byte strings. Assert the consumed properties individually, not complete property maps. Do not pin descriptions, complete serialized or structural definitions, strict flags, additionalProperties, unrelated producer tools, or unrelated schema fields. Retain useful behavioral tests elsewhere.

The full go test ./... suite must pass against kogen-loop main and with only its search_text description changed. Removing a consumed parameter must still fail the definition consumer test. Acceptance fixes main to the observed revision 4a8ad8d6d1fa2d3edd4044812070d18c4207d8d0 (Go version v0.0.0-20261103223720-4a8ad8d6d1fa) rather than allowing branch movement during verification. It copies the real module and checkout to temporary directories, uses a local replace only there, and mutates the returned definition without changing tool execution. The repository and shared module cache remain untouched.

Main now declares its canonical module identity and imports its own canonical internal packages. For this narrowly scoped contract comparison, the harness mechanically normalizes github.com/KogenAI/kogen-loop to kogen-loop in the temporary producer copy's Go sources and go.mod, retaining the consumer's existing module identity. This is a test-only module-path compatibility adapter, not verification of an unmodified module-path migration. All main tool implementation and definition behavior remains in use. A production dependency/import migration is outside this delivery.

## Decisions
- A consumer pins only what it uses, never the producer's bytes; descriptions are explicitly outside this contract. (source: request)
- Preserve all six currently enabled generic tool names and the argument interface listed above. (source: request)
- Compare main behavior through a temporary module-path adapter rather than broaden this test change into a dependency migration; the first main probe failed before tests because main imports its canonical internal/delivery package while this checkout consumes the legacy module name. (evidence: go.mod and probes of main's go.mod and provider/messages.go) (source: request)

## Source comparison
- addressed: request K-REVIEW-DROP-LOOP-DEF-PIN's historical failure at consumes/kogen-loop/defs_test.go:47, TestDefinitionIsTheGenericToolDefinition, on search_text wording during l-contract-wire-goldens at 3 Nov 21:46Z: replacement assertions and the description-mutation scenario reproduce and remove that coupling.
- addressed: request Need's tool existence, names, parameter types and required status: the explicit six-tool inventory above is the complete replacement contract, with implementation unit coverage required below.
- addressed with explicit technical adaptation: request Acceptance's go test ./... on main and changed search_text description runs main source with the module-name normalization described above. It does not claim raw upstream main compiles under the old import identity. Failure on removal of a used parameter is exercised through the real producer Definition and real consumer test.
- superseded: current defs_test.go's complete JSON literals, strict pin and unrelated absent-name checks, and README's exact-definition claim: replace with the consumed interface only, as required by Need. No descriptions or full definition bytes may be compared in this consumer suite.
- addressed: supplied slug, Intent paths, steps directory, filename prefix and step sentence prefix are preserved in Acceptance and the accompanying files. The test-only adapter is the explicit deviation from testing an entirely unmodified upstream module; no consumer-interface requirement is omitted.

## Tests
- Replace full definition equality with tool names and consumed parameter names, types and required status: update TestDefinitionIsTheGenericToolDefinition using real tools.Definition values; add focused checks of the narrowed assertion against missing properties, changed consumed types and required status if not already demonstrated by the replacement test (unit)
- Producer wording changes must not break the consumer or full module suite: run full go test ./... against observed main with test-only import normalization, unchanged and with changed search_text description (regression)
- Removing search_text.pattern must fail the real definition consumer test: isolated producer mutation through local module replacement (integration)

## Feasibility
- Repository probes resolved main to v0.0.0-20261103223720-4a8ad8d6d1fa and inspected tools/defs.go's Definition seam and parameter types. The existing named consumer test and go test ./... passed on the pinned dependency. A first definitions.go read failed; the subsequent defs.go read succeeded.
- Documentation search returned irrelevant Gmail sources; it did not discover a usable source. Direct fetch of https://go.dev/ref/mod returned retrieved, untrusted documentation describing module directives and local replacement requirements.
- After import normalization, native readiness reached the existing consumer test. A focused main run confirmed failure at defs_test.go:47 on the exact list_files and search_text descriptions. This is legitimate old-byte-pin red; it does not establish every other assertion's correctness. The missing-parameter scenario passed native readiness.
- evidence: {"id":"mutation-driver","kind":"observer","inputs":["features/steps/k-review-drop-loop-def-pin__steps.js"],"observers":["features/steps/k-review-drop-loop-def-pin__steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/k-review-drop-loop-def-pin__steps.js good","exit":0,"output":"control accepted\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/k-review-drop-loop-def-pin__steps.js bad","exit":1,"output":"control rejected\n"}]}
