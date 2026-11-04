# kogen-review

Kogen's independent review and repair: after a Build's candidate passes verification, a reviewer that never sees the builder's conversation reads the approved Intent and the candidate's source, repairs supported defects and submits a verdict. Only an approval of the exact verified tree can be committed; a blocking finding ends the Build.

It is a component of [Kogen](https://github.com/KogenAI/kogen), which pins an exact version of it and assembles the `kogen` program. kogen-build runs every review through it. It owns the reviewer's model-facing policy (its instructions and the `submit_review` tool) and depends on no other component's workflow.

## Setup

You need Go 1.27.2 or later. Every dependency is a public Go module that the go command fetches from the public Go module proxy; nothing else needs setting up.

```sh
git clone https://github.com/KogenAI/kogen-review.git
cd kogen-review
```

## Packages

- `review`: the native reviewer (`Independent`) and the reviewer served by an external executor (`External`, built with `NewExternal`): review, resume, the review loop, verdict evaluation and the review tool conversation, with the reviewer's own saved session (`Session`) and policy (`ReviewerInstructions`, `ReviewerToolDefinitions`, `prompts/reviewer.md`). Both are `Reviewer`s with a narrow contract (`contract.go`): a review gets a saved candidate, the exact approved Intent, the verification evidence, the permitted tools and, to resume, its own checkpoint (`Input`), and returns its verdict, findings and repairs (`Result`). A review makes its own material from that input (`MaterialOf`, `material.go`: the authority of the approved Intent and the candidate's diff and files) and reads the candidate's trees and diffs from the candidate's Git repository. What else it needs while it runs — model requests with its caller's bookkeeping and working window, the verification of its repairs and the record of its progress — it asks of `Env`, which a Build provides over its own state and a saved-candidate harness provides without any Build.
- `contract`: the contract suite: what kogen-build uses, pinned in tests that run in `go test ./...`: the API it calls, the reviewer's checkpoint and record formats, verdict validation, and the native and external review flows over a fake Env, and the review of a saved Git candidate with no Build at all, whose Input and resume checkpoint come from a version 4 checkpoint read from the saved candidate's run folder. An intended interface change edits it together with paired consumer items. See [contract/](contract/).
- `consumes`: the consumes suites, one per Kogen dependency (`consumes/kogen-coordinator/`, `consumes/kogen-executor/`, `consumes/kogen-loop/`, `consumes/kogen-verification/`): what kogen-review relies on from each producer, pinned in tests that run in `go test ./...` at the versions `go.mod` pins. See each suite's `README.md`.

## cmd/kogen-review

A developer entry point, not part of Kogen's CLI: it runs the native reviewer (`review.Independent`) once on a saved candidate in a Git checkout, against the approved Intent of that checkout, without Kogen, a Build or an adoption. It verifies no repairs: a reviewer that changes the candidate ends with `review/repair_unverified` and its edits stay in the checkout.

```sh
go build ./cmd/kogen-review
kogen-review -start REV -slug SLUG -model NAME [-root DIR] [-provider NAME] [-effort LEVEL] [-base-url URL]
```

`-start` is the commit the candidate was built on, `-slug` the Intent whose `.kogen/intents/SLUG/intent.md` and `acceptance.feature` are read from the checkout (`-root`, default `.`), and `-provider` (default `chatgpt`), `-model`, `-effort` (default `medium`) and `-base-url` the reviewer's role. The checkout's `.kogen/project.yaml`, when present, supplies the configured commands the review's material states. Each invocation verifies the current candidate with the configured verification commands before review; the run folder retains `initial-verification.json`.

Stdout is exactly one JSON line with the keys `verdict`, `findings`, `tree`, `repairs`, `run` (the run folder, kept) and `error` (the stop `{class, reason, detail, lines}` or `null`) `invalid` (`{reason, problems}` or `null`), and `submitted` (the submitted `{verdict, findings, tree}`, or `null` if none). On a verification stop, `findings` and `tree` retain the submitted evidence; a submitted `approve` is not command approval of an unverified tree. The verdict is `approve` (exit 0), `changes` (a blocking review, exit 1), `invalid` (no valid verdict, exit 1) or `error` (any other stop, exit 1 unless the stop has its own). A usage error or an input that cannot be used (no Intent or acceptance feature, an invalid `project.yaml`, a `-start` that is not a commit) prints one line on stderr, nothing on stdout, and exits 2 before any review. Progress goes to stderr.

## Testing

```sh
go build ./... && go vet ./... && go test -race -count=1 ./...
```

`review/testdata/prompts_golden.json` and `defs_golden.json` record the reviewer's prompt bytes and `submit_review` definition (moved verbatim from kogen-executor's). A plain run fails on any drift and writes nothing; the test-only flag `-update` (`go test ./... -update`) rewrites them from the current output. Use it only after an intended change to the reviewer's policy, and review the diff.

## Contact

Inquiries: contact@kogen.dev

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
