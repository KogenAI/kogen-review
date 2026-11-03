# Add a standalone kogen-review command

Slug: k-review-cmd-entry
Model: not applicable — a one-shot command that wires the existing reviewer to a Git checkout and prints its result; the review's own state and transitions are unchanged and already covered by the contract suite
Acceptance:
- .kogen/intents/k-review-cmd-entry/acceptance.feature
- features/steps/kogen_review_cmd.js
- features/steps/kogen_review_cmd_controls/observe.sh
- features/steps/kogen_review_cmd_controls/report.cjs
- features/steps/kogen_review_cmd_controls/good_main.go.txt

Add `cmd/kogen-review`, a small `package main` in this repository, built with `go build ./cmd/kogen-review` against this repository's own `go.mod` (module `github.com/KogenAI/kogen-review`). It runs this phase's existing entry point, the native reviewer `review.Independent{}.Review`, once on a saved candidate in a given Git checkout, against the approved Intent of that checkout, without Kogen, a Build or an adoption, and reports the result as one JSON line on stdout in addition to its exit code, so an evaluator can score the phase without an assembled `kogen` binary. It is a developer entry point, not part of Kogen's user-facing CLI.

It is written against current main (cfc2fb2 and later): the review makes its own material from its `review.Input` (`review.MaterialOf`), `Env.Prepare` receives a `review.MaterialSet` (not `core.MaterialSet`), and `review.Env` has the 21 methods of `review/contract.go` (no `Material`, `Blocks`, `Tree`, `Changed`, `Diff`, `InStart` or `Drift`).

Nothing else changes: the packages `review` and `contract`, the reviewer's prompt and tool definitions (`review/prompts/reviewer.md`, `review/testdata/*_golden.json`), `go.mod` and `go.sum` stay byte-for-byte as they are; no timeout anywhere is raised and the command sets no deadline of its own; nothing of `github.com/KogenAI/kogen` or `github.com/KogenAI/kogen-build` is imported. The external reviewer (`review.External`), `Resume` and the verification of a reviewer's repairs are not offered by the command.

### Command line

`kogen-review -start REV -slug SLUG -model NAME [-root DIR] [-provider NAME] [-effort LEVEL] [-base-url URL]`, parsed with Go's `flag` package:

- `-root` (default `.`): the checkout holding the candidate; made absolute with `filepath.Abs` (no symlink resolution). Below, `<root>` is this absolute path.
- `-start` (required): the commit the candidate was built on, any revision that resolves to a commit of the checkout (`<REV>^{commit}`, for example `HEAD~1`).
- `-slug` (required): the approved Intent's slug. The Intent is the file `<root>/.kogen/intents/<SLUG>/intent.md` (its exact bytes are the Intent's text and approval bytes); its acceptance feature is `<root>/.kogen/intents/<SLUG>/acceptance.feature` (`project.FeaturePath`), which the review's material includes, and its model `model.qnt` when present.
- `-model` (required), `-provider` (default `chatgpt`), `-effort` (default `medium`), `-base-url` (default empty; the base URL an `openai-compatible` provider needs): the reviewer's role, `project.Role{Provider, Model, Effort, BaseURL}`.

Usage errors (an unknown flag, a positional argument, a missing `-start`, `-slug` or `-model`) print the line `usage: kogen-review -start REV -slug SLUG -model NAME [-root DIR] [-provider NAME] [-effort LEVEL] [-base-url URL]` on stderr (the flag package's own message may precede it for an unknown flag), print nothing on stdout and exit 2.

Then, in this order, an input that cannot be used is refused before any review: one line on stderr, nothing on stdout, exit 2, no model request, no run folder:

1. The Intent file cannot be read (`os.ReadFile`): `kogen-review: ` followed by the error, e.g. `kogen-review: open <root>/.kogen/intents/absent/intent.md: no such file or directory`.
2. The acceptance feature cannot be read (`os.ReadFile`): likewise, e.g. `kogen-review: open <root>/.kogen/intents/nofeature/acceptance.feature: no such file or directory`.
3. `<root>/.kogen/project.yaml` exists but `project.LoadConfig(<root>)` rejects it: `kogen-review: ` followed by that error, e.g. `kogen-review: environment/project_config_invalid: <root>/.kogen/project.yaml` for a file holding `version: seven`.
4. `-start` does not resolve to a commit of the checkout: `kogen-review: -start <REV> is not a commit of <root>`.
5. The candidate tree cannot be computed or the run folder cannot be created: `kogen-review: ` followed by the error.

### The review it runs

`main` first calls `sys.MaybeSupervise(os.Args[1:])` and `sys.EnableSupervisor()`, as `kogen-loop/cmd/kogen-loop` does, so the reviewer's `shell` commands run under the supervisor. The session is `sys.New()` with its Stdout sent to stderr (stdout carries only the result line) and `WatchSignals` active; progress lines (`kogen: reviewing (review 1)`, ...) go to stderr.

The `review.Input`:

- `Candidate{Root: <root>, Repo: git.New(<root>, nil), Start: <the resolved start commit>, Tree}` where `Tree` is `Repo.Tree(start, nil)` (kogen-coordinator `git`: the tree of the checkout's files as they are now through a private temporary index, the same computation the review uses to observe the candidate), so the checkout's own HEAD, index and files are left unchanged. `Protected`, `Excluded` and `Builder` are empty.
- `Intent{Slug: SLUG, Text: <intent.md bytes>, Approval: <intent.md bytes>, Role}` (no `Source`, no `Plan`).
- `Evidence{Pass: verify.Pass{N: 1, Clean: true, Green: true, Tree: Tree}, Commands}`. The command runs no verification: the caller vouches that the candidate passed, as the contract suite's saved-candidate harness does. `Commands` are the checkout's configured commands when `<root>/.kogen/project.yaml` exists: `Fix` = the config's `Fix`, `Checks` = its `Checks`, `Acceptance` = its acceptance `Run` (empty when none); when the file does not exist they are empty. The review's material states them (`Fixers: ...`, `Project checks: <name>: <run>; ...`, `Acceptance: ...`).
- `Tools{Native: &tools.Tools{Root: <root>, Session, Enabled}, Record: returns nil, Round: calls sess.Round, Home: $HOME}`; `Number: 1`; `Run{ID: "kogen-review", Dir}` where `Dir` is a new folder from `os.MkdirTemp("", "kogen-review-run-")`, outside the checkout, kept after the run (the reviewer's `review-1.json` record is written there).

Its `review.Env`, without any Build:

- `Request`: `provider.NewClient("kogen-review").Respond(ctx, session, provider.Request{Role: core.ProviderRole(r.Role), Instructions: r.Instructions, Input: r.Input, Tools: r.Tools, ToolChoice: r.ForceTool}, nil)`, returning that response and `r.Input`. Credentials are the provider's stored login under `$HOME`; an `openai-compatible` host without a key needs none.
- `Prepare(tree, m, ...)` returns the user message of `m.Authority`, the diagnostic messages, then the user message of `m.Source` (the material the review made with `MaterialOf`). `Unread` reports nothing unread; `Prefill` returns its input; `Delivered`, `Custody` and `BaselineIntact` succeed.
- `Verify` refuses: it returns `sys.Fail("review", "repair_unverified", "kogen-review verifies no repairs: the reviewer changed the candidate; its edits are left in place", 1)`. An approval only counts when it is an approval of the exact candidate tree it was given; a reviewer that changed the tree and approved ends with that error and its edits stay in the checkout. `Feedback` returns `""` and `Comparison` nothing.
- `Write` writes the value as JSON into the run folder (mode 0600). `Save`, `Boundary`, `Reviewed`, `Repaired`, `Track`, `Facts` succeed without effect, `Executor` and `Event` keep nothing, `Progress` writes the line through the session (to stderr) and `Err` is the session's interrupt.

### Result

Stdout is exactly one line, a JSON object with the keys `verdict`, `findings`, `tree`, `repairs`, `run`, `error`, `invalid` (in that order):

| Outcome of `Review` | `verdict` | `findings` | `tree` | `error` | `invalid` | exit |
| --- | --- | --- | --- | --- | --- | --- |
| no error | the record's verdict (`approve`) | the record's findings | the record's tree | `null` | `null` | 0 |
| `candidate/review_blocked` | `changes` | the record's findings | the record's tree | the stop | `null` | the stop's exit (1) |
| `candidate/review_invalid` | `invalid` | `[]` | `""` | the stop | `{"reason": Invalid.Reason, "problems": Invalid.Problems}` | the stop's exit (1) |
| any other error | `error` | `[]` | `""` | the stop | `null` | the stop's exit, 1 when it has none |

`repairs` is `Result.Repairs`, `run` the run folder's absolute path. A stop is `{"class", "reason", "detail", "lines"}` from the `*sys.Error` (`lines` is `[]` when it has none); an error that is not a `*sys.Error` is `{"class": "kogen-review", "reason": "failed", "detail": <its text>, "lines": []}` with exit 1. Findings are the submitted findings as recorded (`[]` when none).

### Documentation

`README.md` gains a short section on `cmd/kogen-review`: the build command, the usage line, the JSON line and exit codes above, that it runs the native reviewer on a checkout's approved Intent without Kogen and verifies no repairs, and that it is a developer entry point, not part of Kogen's CLI.

`features/steps/kogen_review_cmd_controls/good_main.go.txt` is a known-good control of the acceptance steps (see Feasibility), not the implementation: the Build writes `cmd/kogen-review/main.go` itself and does not edit the control files.

## Decisions
- The verdict is reported as one JSON object on stdout in addition to the exit code (source: request)
- The command runs this phase's existing entry point on a given checkout and is built with go build against this repository's own go.mod, as cmd/kogen-review (source: request)
- It is a developer entry point, not part of Kogen's user-facing CLI; Kogen's CLI and the phase's behaviour are unchanged (source: request)

## Source comparison
- "A small cmd/kogen-review in this repository that runs this phase's existing entry point on a given checkout, built with go build against this repository's own go.mod": addressed by `cmd/kogen-review` running `review.Independent{}.Review` on `-root`/`-start`/`-slug`; the scenarios build it with `go build -mod=readonly -buildvcs=false -o <bin> ./cmd/kogen-review` and check with `go list -mod=readonly -deps` that it imports `github.com/KogenAI/kogen-review/review`.
- "reports the verdict as a typed, machine-readable result (for example JSON on stdout) in addition to the exit code": addressed by the one-line JSON result and the exit codes in Result, asserted exactly for approve (0), changes (1), invalid (1) and an unverified repair (1).
- "so an evaluator can score the phase without kogen" / "needs an assembled kogen binary and an adoption": addressed; the scenarios run the command on a plain temporary Git checkout with a loopback `openai-compatible` fake model and no Kogen.
- "No change to the phase's behaviour or to Kogen's CLI": addressed; `review/`, `contract/`, goldens, `go.mod` and `go.sum` are unchanged and the existing suite must pass unchanged.
- "No timeout raised": addressed; no existing timeout changes and the command sets no deadline. The new acceptance steps carry their own Cucumber step limits (300 s for the build, 120 s per run, a 100 s guard on the child), which are test-harness limits of new steps, not the phase's or Kogen's.
- "no new dependency on kogen": addressed; no `require` is added and the dependency scenario rejects any package of `github.com/KogenAI/kogen` or `github.com/KogenAI/kogen-build`.
- "Previous attempt ... cmd/kogen-review passes core.MaterialSet where Prepare now wants review.MaterialSet. Build on current main": addressed; the Env implements current main's 21-method `review.Env` with `Prepare(..., review.MaterialSet, ...)`, and the review makes its own material. Superseded from the previous attempt's Intent (Build d20bb309, never landed on main): its `-intent FILE` flag and Env-made material (`# Approved Intent` / `# Diff`). Because `MaterialOf` reads the Intent's acceptance feature from the checkout by slug, the command now takes `-slug SLUG` and reads `.kogen/intents/<SLUG>/intent.md`, and takes the configured commands from the checkout's `.kogen/project.yaml` when present.
- Omitted (not requested): the external executor reviewer, resuming a saved review, and verifying a reviewer's repairs; the command reports a repair as `review/repair_unverified` instead of approving an unverified tree.
- The problem statement's history (F14, the only `package main` being `kogen-loop/cmd/kogen-loop`) is context, not behaviour.

## Tests
- The command is built from this module with go build and uses the review package but nothing of Kogen: scenario "The command uses this module's review package and nothing of Kogen" (scenario)
- An approval runs the real reviewer (its instructions and tools, the Intent and its feature read by slug, the configured commands of `.kogen/project.yaml` and the diff reach the model; its read_file result returns) and prints the approve JSON with exit 0, records review-1.json in the run folder and leaves the checkout unchanged: scenario "An approval is reported as JSON with exit 0" (scenario)
- A blocking verdict prints changes with the review_blocked stop and its finding lines and exits 1; -effort reaches the model; the shell tool runs; without `.kogen/project.yaml` the material states no commands: scenario "A blocking verdict is reported as changes with exit 1" (scenario)
- A review without a valid verdict prints invalid with the reason and problems and exits 1: scenario "A review that ends without a valid verdict is reported as invalid with exit 1" (scenario)
- An approval of a tree the reviewer changed is reported as review/repair_unverified with exit 1 and the edits stay in the checkout: scenario "An approval of a tree the reviewer changed is reported as an unverified repair with exit 1" (scenario)
- A missing required flag prints the usage line, nothing on stdout, exit 2: scenario outline "A run without a required flag is refused as a usage error" (scenario)
- A -start that is not a commit, a slug without an Intent, an Intent without its acceptance feature and an invalid .kogen/project.yaml are each refused with their exact line and exit 2 before any model request: scenario outline "An input that cannot be used is refused before any review" (scenario)
- The phase's behaviour, formats and policy are unchanged: the existing contract and review tests and goldens pass unchanged under `go test ./...` (existing)

## Feasibility
- evidence: {"id":"cmd-steps-observer","kind":"observer","inputs":[".kogen/intents/k-review-cmd-entry/acceptance.feature","features/steps/kogen_review_cmd_controls/observe.sh","features/steps/kogen_review_cmd_controls/report.cjs","features/steps/kogen_review_cmd_controls/good_main.go.txt"],"observers":["features/steps/kogen_review_cmd.js"],"checks":[{"name":"good","command":"sh features/steps/kogen_review_cmd_controls/observe.sh good","exit":0,"output":"scenarios: 12 passed, 0 failed\n"},{"name":"bad","command":"sh features/steps/kogen_review_cmd_controls/observe.sh bad","exit":1,"output":"scenarios: 9 passed, 3 failed\nfailed step: FAILED: the exit code is 1\n"}]}
- Scratch prototype on current main b40168c (outside the checkout, not retained by Kogen): a `cmd/kogen-review` with the Env above (`Prepare` taking `review.MaterialSet`) compiled and vetted against the unchanged go.mod and drove `review.Independent` through `provider.Client.Respond` on the `openai-compatible` route at a loopback `http://127.0.0.1:<port>/v1` with no stored key. The material the review made held `# Intent\n\n# Greet the world...`, `# acceptance.feature\n\nFeature: Greeting...`, `Fixers: make fmt.\nProject checks: unit: make unit.\n` from the fixture's project.yaml (and `Fixers: .\nProject checks: .\nAcceptance: .\n` without one) and the diff `-hello\n+hello, world\n`; approve, changes, invalid, unverified repair, usage and the four refusals behaved as the scenarios state (12 of 12 passed). The refusal lines were observed: `kogen-review: open <root>/.kogen/intents/absent/intent.md: no such file or directory` and `kogen-review: environment/project_config_invalid: <root>/.kogen/project.yaml`. The good control uses that prototype's main.go; the bad control (every stop exits 0) fails exactly the three exit-1 scenarios. On the unchanged tree every scenario fails at its first step, `go build ... ./cmd/kogen-review` (no such package).
