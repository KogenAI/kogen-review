# Confine review CLI Intent paths

Slug: confine-cli-intent-paths
Model: not applicable — this is a one-shot filesystem input check, not a state machine
Acceptance:
- .kogen/intents/confine-cli-intent-paths/acceptance.feature
- features/steps/confine-cli-intent-paths__steps.js

`kogen-review -root DIR -start REV -slug SLUG -model NAME` confines the two authority files `.kogen/intents/SLUG/intent.md` and `.kogen/intents/SLUG/acceptance.feature` to the checkout at `DIR` (default `.`). Refuse a traversal slug or either authority path that resolves outside the checkout before reading outside authority or starting verification. An unusable input exits 2 with no stdout and one `kogen-review: ` refusal line on stderr; it starts no verification and creates no review run directory.

Change only `cmd/kogen-review/main.go` and `cmd/kogen-review/main_test.go` outside this Intent's artifacts. Replace the unchecked reads at the CLI input boundary. Keep the existing Intent formats, other input checks, verification, review behavior, flags and result format for valid paths. This is not a general sandbox for verification commands or unrelated checkout files.

## Decisions
- A slug containing path traversal is refused with exit 2, no stdout, and no read of files outside the checkout. (evidence: cmd/kogen-review/main.go) (source: request)
- An intent or acceptance feature symlink resolving outside the checkout is refused before verification. (evidence: cmd/kogen-review/main.go) (source: request)
- Valid slugs and authority files inside the checkout retain the existing CLI behavior. (evidence: cmd/kogen-review/main.go; cmd/kogen-review/main_test.go; README.md) (source: request)
- A slug containing path traversal is refused with exit 2, no stdout, and no read of files outside the checkout. (decision: D1, round 1) (constraint: Reject a parent-directory component before constructing or reading the authority paths; do not add a new slug format for valid inputs.) (evidence: cmd/kogen-review/main.go) (source: request)
- An intent or acceptance feature symlink resolving outside the checkout is refused before verification. (decision: D2, round 1) (constraint: Before the initial authority content reads, resolve both paths including linked parents and compare them to the resolved checkout by path components, not textual prefix.) (constraint: Feed the confined bytes to the existing parsers instead of reading the unchecked paths again.) (evidence: cmd/kogen-review/main.go) (source: request)
- Valid slugs and authority files inside the checkout retain the existing CLI behavior. (decision: D3, round 1) (constraint: Ordinary files and symlinks whose targets remain inside the checkout are not refused by the confinement check.) (evidence: cmd/kogen-review/main.go; cmd/kogen-review/main_test.go; README.md) (source: request)
- A slug containing path traversal is refused with exit 2, no stdout, and no read of files outside the checkout. (decision: D4, round 1) (evidence: cmd/kogen-review/main.go) (source: request)
- An intent or acceptance feature symlink resolving outside the checkout is refused before verification. (decision: D5, round 1) (evidence: cmd/kogen-review/main.go) (source: request)
- Valid slugs and authority files inside the checkout retain the existing CLI behavior. (decision: D6, round 1) (evidence: cmd/kogen-review/main.go; cmd/kogen-review/main_test.go; README.md) (source: request)

## Source comparison
- Addressed — evidence `ev-78f2974b` and acceptance 1: `run` currently joins an unchecked slug and reads before `project.LoadIntent` (`cmd/kogen-review/main.go`). The traversal scenario and late-read control pin pre-read rejection rather than just the final exit code.
- Addressed — acceptance 2: external intent and acceptance symlinks, including a symlinked parent, are covered by the outside-link scenarios. A readable target checks real escapes; a no-writer FIFO catches an `os.ReadFile` followed by an otherwise correct refusal. No setup marker or run directory may appear.
- Addressed — acceptance 3 and the out-of-scope behavior clause: the ordinary and inside-link scenarios exercise the existing verification path and result format (`README.md`, cmd/kogen-review). No change to valid Intent syntax, verification policy or review semantics.
- Superseded — unchecked traversal and external-link reads in `run`; the prior tests for missing files and invalid configuration are kept. No requested behavior or implementation scope is omitted.

## Tests
- Reject a traversal slug before an external authority read: add a bounded checkout regression in `cmd/kogen-review/main_test.go` exercising `run`, exit 2, empty stdout and no verification (regression)
- Reject an escaping intent or feature link before an external authority read: cover both link positions in the same regression with a no-writer FIFO to distinguish a late refusal (regression)
- Verify ordinary checkout inputs retain their existing behavior: `TestInitialVerificationStops` (existing)
- Verify the exact CLI boundary for traversal, outside file and parent links, and ordinary and inside-link inputs: run the built command in `acceptance.feature`, using local Git and a deliberately failing setup, with no provider calls (scenario)

## Feasibility
- Acceptance uses the configured Cucumber runner (evidence: .kogen/project.yaml), Go from `go.mod`, Git and POSIX `mkfifo`. The steps build `./cmd/kogen-review`, make a temporary committed checkout and sibling target, and invoke the binary directly. The no-writer FIFO blocks an attempted authority read; the child is killed at the test watchdog deadline. A timeout fails the assertion rather than qualifying as refusal; the watchdog is a test fixture, not a CLI timing requirement.
- Local probes confirmed Go 1.27.2, Git, `mkfifo`, configured Node and a successful CLI build. The pinned coordinator's `ReadIntent` accepts supplied bytes without disk fallback. The scratch correct control passed the command package tests and the focused outside-acceptance-link and inside-link CLI scenarios. A focused unchanged-tree traversal run reached the expected FIFO assertion.
- evidence: {"id":"cli-authority-observer","kind":"observer","inputs":["features/steps/confine-cli-intent-paths__steps.js"],"observers":["features/steps/confine-cli-intent-paths__steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/confine-cli-intent-paths__steps.js good","exit":0,"output":"observer accepted refusal and verification evidence\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/confine-cli-intent-paths__steps.js bad","exit":1,"output":"observer rejected blocked reads and invalid refusal or verification evidence\n"}]}
