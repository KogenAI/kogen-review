# Make kogen-review read correctly as a public repo

Slug: k-public-ready-review
Model: not applicable — documentation and text-only edits; no program state, behaviour or format changes
Acceptance:
- .kogen/intents/k-public-ready-review/acceptance.feature
- features/steps/public_tree_steps.js
- features/steps/public_tree_controls/observe.sh
- features/steps/public_tree_controls/apply.cjs
- features/steps/public_tree_controls/good_README.md.txt

kogen-review is a public GitHub repository, https://github.com/KogenAI/kogen-review. It was written while private, so its tree still carries text a public reader cannot use or should not see. This change makes the tree read correctly to a public reader without changing any behaviour, test or check, and without rewriting Git history.

Every dependency in `go.mod` (kogen-coordinator, kogen-executor, kogen-verification, kogen-loop under github.com/KogenAI) is a public module: a plain clone builds, vets and tests with the Go toolchain and the default public module proxy and checksum database, with no private-module setting and no Git URL rewrite (see Feasibility).

### README.md

Keep the title `# kogen-review`, the two opening paragraphs (what the component is and its role in Kogen, with the link `[Kogen](https://github.com/KogenAI/kogen)`), and the sections Packages, cmd/kogen-review, Testing and License as they are, except:

- Remove the line that tells the reader the module depends on private KogenAI modules and to set the Go private-module environment variable. Nothing replaces it: the README mentions no private module, private-module or proxy setting, mirror, token or Git URL rewrite.
- Add a section `## Setup` before `## Packages`: the reader needs Go 1.27.2 or later (the `go` line of `go.mod`); every dependency is a public Go module that the go command fetches from the public Go module proxy, and nothing else needs setting up; then a `sh` code block with exactly these two consecutive lines:
  ```
  git clone https://github.com/KogenAI/kogen-review.git
  cd kogen-review
  ```
- The Testing section keeps its `sh` code block with the line `go build ./... && go vet ./... && go test -race -count=1 ./...` and its paragraph on the golden files and `-update`.
- Add a section `## Contact` before `## License` with the line `Inquiries: contact@kogen.dev`. `contact@kogen.dev` appears exactly once in README.md.
- The README says nothing about issues, pull requests, contributions, maintenance, a security policy or branding (none of the words in the first scenario's table, in any letter case).

`features/steps/public_tree_controls/good_README.md.txt` is a known-good control of the acceptance steps (see Feasibility), not the implementation: the Build writes README.md itself and does not edit the control files.

### The rest of the tree

The tree is every tracked file plus every untracked file Git does not ignore. In it:

- No file named SECURITY.md, CONTRIBUTING.md or BRANDING.md (any letter case, any folder) and no issue or pull request template is added. None exists today; none is added, and nothing says that issues and pull requests are disabled.
- Every URL starts with one of the public prefixes listed in the third scenario (https://kogen.dev, the public github.com/KogenAI repositories, the Apache license URLs, go.dev, pkg.go.dev, and the loopback addresses that test fixtures serve); Kogen-wide links point to https://kogen.dev or https://github.com/KogenAI/kogen. Every relative Markdown link names a file or folder of the tree. Every email address is `contact@kogen.dev` or a synthetic address at `example.invalid`.
- No Markdown file outside this Intent's folder mentions contributions, pull requests or maintenance.
- No file except `.kogen/project.yaml` (see below) matches any pattern of the third scenario's last table: runner or home paths, the macOS temporary folder, the runner's work folder or account, host names on local/internal/lan/corp, the Go private-module settings, Git URL rewrites, internal Build ids, commits of an unpublished main, landing notes and local-only notes. Today these are, and the Build rewords them in place (it does not delete either earlier Intent):
  - `.kogen/intents/k-review-saved-candidate/intent.md` line 37: the internal Build id in "superseded: Build <id>'s acceptance" becomes "superseded: an earlier attempt's acceptance".
  - `.kogen/intents/k-review-saved-candidate/intent.md` line 46: the runner's absolute Go module cache path, the last argument of both Feasibility evidence commands, becomes the synthetic path `/synthetic/gomodcache`.
  - `.kogen/intents/k-review-cmd-entry/intent.md` line 86: the parenthetical naming the earlier attempt's Build id and saying it never reached main is removed ("Superseded from the previous attempt's Intent: ...").
  - `.kogen/intents/k-review-cmd-entry/intent.md` line 102: "Scratch prototype on current" followed by the unpublished commit b40168c becomes "Scratch prototype (outside the checkout, not retained by Kogen)".
  - `README.md` line 33: the private-module line removed above.

`.kogen/project.yaml` at this checkout's tip is commit c25cde2, a host-local lineup override of Kogen's own configuration whose go-test check runs host helper scripts by absolute runner paths. It is protected for this Intent, Kogen's configured checks run through it, and its subject marks it as local-only; the published configuration (commit 4870fdd) runs `GOFLAGS=-trimpath go test ./...` and has no runner path. This change does not edit it, and the scan excludes it; it is listed below for the owner.

### Unchanged

Every Go file, `go.mod`, `go.sum`, `review/prompts/`, `review/testdata/`, the existing step files and controls under `features/steps/` and the two earlier acceptance features stay as committed at HEAD, the commit the Build starts from: none of them is modified, deleted or added (scenario 4 compares each listed file's Git blob hash with HEAD's tree, as the saved-candidate step does). No assertion, test or check changes, and every configured check passes. `contract/README.md`, `features/steps/README.md`, LICENSE, NOTICE, `.gitignore` and `.tool-versions` hold nothing of the kinds above and stay as they are.

### History, for the owner

Git history is not rewritten, amended or filtered. A scan of every commit for the same kinds found these hits, left unchanged for the owner to decide on (commit, file, what was found):

- 1c3a641, 11d8300, cfc2fb2, 889ed92 (`README.md` line 20) and 4870fdd, c25cde2 (`README.md` line 33): the instruction that the module depends on private KogenAI modules and to set the Go private-module environment variable for github.com/KogenAI/*.
- 889ed92, 4870fdd, c25cde2, `.kogen/intents/k-review-saved-candidate/intent.md` line 46: the runner's absolute Go module cache path (under the runner account's macOS home folder and work folder), twice, in the Feasibility evidence commands.
- 889ed92, 4870fdd, c25cde2, `.kogen/intents/k-review-saved-candidate/intent.md` line 37: the internal Build id of an earlier attempt.
- 4870fdd, c25cde2, `.kogen/intents/k-review-cmd-entry/intent.md` line 86: the internal Build id of an earlier attempt and a note that it never reached main.
- 4870fdd, c25cde2, `.kogen/intents/k-review-cmd-entry/intent.md` line 102: a scratch-prototype note naming commit b40168c, which is not in this repository.
- c25cde2, `.kogen/project.yaml` line 14: absolute runner paths to host helper scripts in the go-test check; the commit's subject also marks it as a local-only override.

No hit was found for host names, private URLs, Git URL rewrites, SECURITY/CONTRIBUTING/BRANDING files or contribution text in any commit. The loopback URL `http://127.0.0.1` of `features/steps/kogen_review_cmd.js` (4870fdd, c25cde2) is a local test fixture, not a private link.

## Decisions
- The README tells a public reader what kogen-review is and its role in Kogen, and gives setup and test steps that work from a plain public clone with the Go toolchain; nothing private or unavailable is mentioned (source: request)
- Kogen-wide links point to https://kogen.dev or https://github.com/KogenAI/kogen; inquiries go to contact@kogen.dev, stated once in the README (source: request)
- No SECURITY.md, CONTRIBUTING.md or BRANDING.md, no contribution refusal and no maintenance promise; nothing says that issues and pull requests are disabled (source: request)

## Source comparison
- addressed: setup instructions for private modules: the README's private-module line is removed; scenario 1 bans the words in the README and scenario 3's patterns ban the Go private-module settings and Git URL rewrites tree-wide; scenario 2 runs the README's test command with no private Go setting, no Go env file and no Git config.
- addressed: links that only work inside Kogen's private workspace and "every link in the tree resolves publicly": scenario 3's URL prefixes and relative-link check; every listed github.com/KogenAI repository was observed public (HTTP 200).
- addressed: text that refuses contributions or describes unavailable workflows; "no SECURITY.md, CONTRIBUTING.md, BRANDING.md, contribution refusal or maintenance promise": scenario 1's README words and scenario 3's file and Markdown checks. None of these exists today; the checks keep the Build from adding them.
- addressed: "Issues and pull requests are disabled, and nothing needs to say so": the README and other Markdown mention neither; the bad observer control is exactly a README saying so.
- addressed: runner or home paths, host names, internal landing or delivery notes, private URLs, and "test fixtures that need a path use a synthetic one": the four rewordings above and scenario 3's pattern table; the saved-candidate Feasibility path becomes `/synthetic/gomodcache`.
- conflicting, resolved: "the current tree has no runner or home paths" against `.kogen/project.yaml`, which is protected and is the host-local override c25cde2; it is excluded from the scan, not edited, and listed for the owner.
- addressed: "Behaviour is unchanged: every existing check passes, and no assertion is weakened": scenario 4 and the configured checks.
- addressed: "Git history is never rewritten. The result lists any history hits": the History section above lists every hit; no Git history operation is part of the change.
- addressed: the README stating what the component is and its role: its opening paragraphs stay, linking https://github.com/KogenAI/kogen.

## Tests
- The README introduces the component, links Kogen publicly, states contact@kogen.dev once and mentions nothing private or about issues, pull requests, contributions, maintenance, security policy or branding: scenario "The README introduces the component to a public reader" (scenario)
- The README's clone and test steps work with the Go toolchain and no private Go or Git settings: scenario "The README's setup and test steps work from a public clone without private settings" (scenario)
- The tree holds no forbidden policy files, no non-public URL, no unresolved relative link, no private email, no contribution or maintenance text and no runner path, host name, private-module setting or internal note: scenario "The tree holds nothing private, internal or unavailable" (integration)
- Behaviour, tests and checks are unchanged: scenario "Behaviour, tests and checks are unchanged" and the existing `go test ./...` suite (existing)

## Feasibility
- evidence: {"id":"public-tree-observer","kind":"observer","inputs":[".kogen/intents/k-public-ready-review/acceptance.feature","features/steps/public_tree_controls/observe.sh","features/steps/public_tree_controls/apply.cjs","features/steps/public_tree_controls/good_README.md.txt","features/steps/kogen_review_cmd_controls/report.cjs"],"observers":["features/steps/public_tree_steps.js"],"checks":[{"name":"good","command":"sh features/steps/public_tree_controls/observe.sh good","exit":0,"output":"scenarios: 3 passed, 0 failed\n"},{"name":"bad","command":"sh features/steps/public_tree_controls/observe.sh bad","exit":1,"output":"scenarios: 1 passed, 2 failed\nfailed step: FAILED: no Markdown file of the tree outside \".kogen/intents/k-public-ready-review/\" mentions, in any letter case:\nfailed step: FAILED: the README mentions none of these words, in any letter case:\n"}]}
- The control runs the three scenarios with masked checks (names beginning "The README" or "The tree"). The good control applies the README of good_README.md.txt and the four rewordings above to a scratch copy and passes all three, including the README test command run with the -race suite; the bad control adds only the README sentence that issues and pull requests are disabled and fails exactly the two scenarios whose masked checks it reaches. A copy that is not a Git work tree gets a new empty repository so the tree listing works; scenario 4 compares with the copy's HEAD, which such a repository lacks, so it is not part of the control. In a scratch clone of this checkout, scenario 4 passed on the unchanged tree and failed, naming each file, after one Go file was modified, one golden file deleted and one Go test file added. Both control modes were run in scratch clones of this checkout with and without `.git` (observed in this session, outside Kogen's probe records).
- Public dependencies (observed in this session, outside Kogen's probe records): https://github.com/KogenAI/kogen, kogen-review, kogen-build, kogen-coordinator, kogen-executor, kogen-verification and kogen-loop answered HTTP 200; in a fresh clone with an empty module cache, no private-module setting and the default public proxy, `go mod download`, `go build ./...`, `go vet ./...` and `go test -count=1 ./...` succeeded (contract and review ok).
- On the unchanged tree scenario 1 fails at the contact line, scenario 2 at the clone lines, scenario 3 at the pattern table (the hits listed above) and scenario 4 passes.
