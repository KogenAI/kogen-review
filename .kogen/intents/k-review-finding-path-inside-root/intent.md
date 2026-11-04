# Refuse finding paths that leave the checkout root

Slug: k-review-finding-path-inside-root
Model: not applicable — a stateless check of each submitted finding path against the checkout and the start commit; no state or interacting rules
Acceptance:
- .kogen/intents/k-review-finding-path-inside-root/acceptance.feature
- features/steps/k-review-finding-path-inside-root__steps.js

The reviewer submits a verdict with `submit_review`, and each finding names a `path`. Verdict validation is `run.validate` in `review/independent.go`, the code behind the public `review.Validate(in, env, args, input)`. The native reviewer (`review.Independent`) and the external reviewer (`review.NewExternal`) both run it, and kogen-build calls `review.Validate`. Today it accepts a path when `os.Stat(filepath.Join(Candidate.Root, path))` is a regular file, or when `inStart(Candidate, path)` finds it in the start commit. `filepath.Join` cleans `..` segments, and `os.Stat` follows links. So a path that climbs out of the checkout, such as `../outside.txt` or `dir/../../outside.txt`, or a link inside the checkout that points at a file outside it, is accepted as a location even though it is not part of the candidate. A blocking finding on such a path then reaches the builder as a repair instruction with no usable location.

After this change, a finding path is accepted only when it names a file inside the checkout root or a file of the start commit. For each finding that has the right shape, with `p` the submitted path string:

1. Refuse `p` if it is absolute (`filepath.IsAbs`).
2. Let `c` be the cleaned path (`filepath.Clean(p)`, used in slash form). Refuse `p` if `c` is `..` or starts with `../`, because the path leaves the root. A `..` that stays inside the root, such as `dir/../a.txt`, and `./` segments are harmless.
3. If `Root/c` exists in the checkout (`os.Lstat`), resolve it with `filepath.EvalSymlinks` and compare the result with the root, also resolved with `filepath.EvalSymlinks(Root)`. A path whose resolved target is not the resolved root or below it is refused, whether or not the start commit has `c`. Resolve both sides because a temporary root can itself sit under a link (macOS `/var` is a link to `/private/var`), and a plain file such as `a.txt` must still be accepted there. A path that resolves inside the root to a regular file is accepted.
4. Otherwise accept the path when the start commit has `c` (`inStart(Candidate, c)`, as today). This covers a file of the start commit that the candidate deleted.
5. Anything else is refused.

A refused path adds exactly the problem `<p> is not a file of the repository` to the verdict's problems. `<p>` is the path as submitted. This is the same text an unknown path gets today, and no other text is added for it. The verdict is then not accepted, and the existing rejected-verdict flow sends the problems back so the reviewer can resubmit. That flow is unchanged: the native reviewer gets one more submission, and the external reviewer gets its existing feedback. A refusal never opens, reads or prints the outside file, so no problem text holds any of its content.

An accepted finding is recorded with its clean path `c` in slash form: `dir/../a.txt` is recorded as `a.txt` and `./dir/b.txt` as `dir/b.txt`. This applies in the returned `Verdict.Findings` and so in the review record and Result. A path that is already clean, such as `a.txt`, is recorded unchanged. The other finding fields (`line`, `severity`, `message`) are kept as submitted. Paths that stay inside the root are accepted as today.

Unchanged: the shape problems, the changes/approve blocking rules, the unread-parts problems, the requirements ledger, the reviewer prompt (`review/prompts/reviewer.md` and its golden files) and the `submit_review` definition.

## Decisions
- A path is accepted only when it names a file inside the checkout root or a file of the start commit. An absolute path, a path with a parent segment that leaves the root, and a path that resolves through a link to a target outside the root are refused. (source: request)
- A refused path gets the same problem text as an unknown path, `<path> is not a file of the repository`, with the path as submitted, and the verdict is not accepted, so the reviewer is asked to resubmit. (source: request)
- Paths that stay inside the root, including ones with harmless `./` segments or a `..` that stays inside, are accepted as today. An accepted path is recorded in its clean form (`dir/../a.txt` as `a.txt`). (source: request)
- A refusal does not read or print the outside file. (source: request)
- When the checkout has the path as a link that resolves outside the root, the path is refused even if the start commit also has an entry at that path, because the request refuses any path that resolves outside the root. A path missing from the checkout falls back to the start commit, as today. (source: request)
- Every accepted path is recorded in its clean form, `./dir/b.txt` as `dir/b.txt` included, so that one location has one recorded form. This applies the clean recording of synthetic example 2 to every path inside the root. (source: request)

## Source comparison
- Addressed: Problem. The check joins the path onto the checkout root and tests for a regular file, so `../` paths and links reach files outside the checkout. This is replaced by rules 1–5 above. Today, on the fixture of this Intent, `../outside.txt`, `dir/../../outside.txt` and the untracked `link.txt` -> `../outside.txt` are accepted; that was observed with the acceptance driver on the unchanged tree.
- Addressed: synthetic acceptance 1 (`a.txt` accepted): scenario "A file of the checkout is accepted".
- Addressed: synthetic acceptance 2 (`dir/../a.txt` accepted and recorded with a clean path): scenario "A parent segment that stays inside the root is accepted and recorded clean", which expects the recorded path `a.txt`.
- Addressed: synthetic acceptance 3 (`../outside.txt` refused with the not-a-file problem, verdict not accepted): scenario "A path that climbs out of the root is refused". Also covered: "A parent segment deeper in the path that leaves the root is refused" (`dir/../../outside.txt`).
- Addressed: synthetic acceptance 4 (absolute path to `outside.txt` refused the same way): scenario "An absolute path to a file outside the root is refused". The unchanged tree already refuses this case, and the scenario keeps it that way.
- Addressed: synthetic acceptance 5 (a link inside the checkout pointing at `outside.txt` refused): scenario "A link inside the checkout to a file outside the root is refused".
- Addressed: synthetic acceptance 6 (no refusal text holds any of the outside file's content): every refusal scenario checks that the driver's whole output holds no line of `outside.txt` (`OUTSIDE-CONTENT-5c1e`).
- Addressed: "harmless `./` segments behave as today": scenario "A harmless ./ segment is accepted and recorded clean" (`./dir/b.txt`, recorded `dir/b.txt`).
- Addressed: "or a file of the start commit": scenario "A file of the start commit deleted from the checkout is accepted" (`gone.txt`).
- Addressed: "the same kind of problem text as an unknown path": scenario "An unknown path is refused with the same problem" (`missing.txt`) pins the shared text.
- Fixture: a temporary folder holds the checkout `checkout/` and the regular file `outside.txt` next to it. The checkout's start commit has `a.txt`, `dir/b.txt` and `gone.txt`. `gone.txt` is then deleted from the checkout, and `link.txt` is created as an untracked link to `../outside.txt`.

## Tests
- A finding path that leaves the root (`../x`, `dir/../../x`, an absolute path, or an untracked link whose target is outside the root) is refused with exactly `<path> is not a file of the repository` and the verdict is not accepted. The problem holds no content of the outside file: add these cases to `TestValidateAcceptsTheVerdictShapes` in `contract/validate_test.go`, with a file next to the fixture's checkout root and a link to it, plus the acceptance scenarios (regression)
- A path that stays inside the root (`dir/../app.txt`, `./app.txt`) is accepted and recorded in its clean form: add cases to `contract/validate_test.go` that check the accepted verdict's finding path, plus the acceptance scenarios (integration)
- A file of the start commit deleted from the checkout is still accepted, and an unknown path is still refused with the same text: the existing `deleted.txt` and `missing.txt` cases of `TestValidateAcceptsTheVerdictShapes` and the acceptance scenarios (existing)

Also update `contract/README.md`'s `validate-shape` line: give its new subtest count, and say that a finding's path must name a file inside the checkout root or of the start HEAD, that a path leaving the root (absolute, `..` or through a link) is refused like an unknown path, and that an accepted path is recorded clean.

## Feasibility
- The acceptance driver, a Go program in `features/steps/k-review-finding-path-inside-root__steps.js` built with `go build -overlay` from the checkout into a temporary file, builds on the unchanged tree and leaves the checkout clean (`git status --porcelain` empty). On the fixture it showed today's behavior: `a.txt`, `gone.txt`, `../outside.txt`, `dir/../../outside.txt` and `link.txt` are accepted; `dir/../a.txt` and `./dir/b.txt` are accepted but recorded unclean; the absolute path and `missing.txt` are refused with `<path> is not a file of the repository`. This was observed in this session with a scratch script outside the checkout; it is not a Kogen probe record. (exit 0, about 1 s with a warm build cache)
- How the controls work: the step file's judgments compare the driver's observation `{accepted, findings, problems}` and its whole output with the feature's values. The good control runs them on the expected accepted, refused and undisclosed observations, and requires nine mutations to be rejected: an unclean recorded path, a refused inside path, another severity, a missing finding, an accepted outside path, other problem wording, an extra problem, no problem, and output that discloses the outside content. The bad control judges today's observed acceptance of a blocking finding on `../outside.txt` and must reject it.
- evidence: {"id":"finding-path-observer","kind":"observer","inputs":[".kogen/intents/k-review-finding-path-inside-root/acceptance.feature"],"observers":["features/steps/k-review-finding-path-inside-root__steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/k-review-finding-path-inside-root__steps.js --control good","exit":0,"output":"observer controls passed\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/k-review-finding-path-inside-root__steps.js --control bad","exit":1,"output":"rejected the accepted finding on ../outside.txt\n"}]}
