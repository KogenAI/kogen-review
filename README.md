# kogen-review

Kogen's independent review and repair: after a Build's candidate passes verification, a reviewer that never sees the builder's conversation reads the approved Intent and the candidate's source, repairs supported defects and submits a verdict. Only an approval of the exact verified tree can be committed; a blocking finding ends the Build.

It is a component of [Kogen](https://github.com/KogenAI/kogen), which pins an exact version of it and assembles the `kogen` program. kogen-build runs every review through it. It owns the reviewer's model-facing policy (its instructions and the `submit_review` tool) and depends on no other component's workflow.

## Packages

- `review`: the native reviewer (`Independent`) and the reviewer served by an external executor (`External`, built with `NewExternal`): review, resume, the review loop, verdict evaluation and the review tool conversation, with the reviewer's own saved session (`Session`) and policy (`ReviewerInstructions`, `ReviewerToolDefinitions`, `prompts/reviewer.md`). Both are `Reviewer`s with a narrow contract (`contract.go`): a review gets a saved candidate, the exact approved Intent, the verification evidence, the permitted tools and, to resume, its own checkpoint (`Input`), and returns its verdict, findings and repairs (`Result`). A review makes its own material from that input (`MaterialOf`, `material.go`: the authority of the approved Intent and the candidate's diff and files) and reads the candidate's trees and diffs from the candidate's Git repository. What else it needs while it runs — model requests with its caller's bookkeeping and working window, the verification of its repairs and the record of its progress — it asks of `Env`, which a Build provides over its own state and a saved-candidate harness provides without any Build.
- `contract`: the contract suite: what kogen-build uses, pinned in tests that run in `go test ./...`: the API it calls, the reviewer's checkpoint and record formats, verdict validation, and the native and external review flows over a fake Env, and the review of a saved Git candidate with no Build at all. An intended interface change edits it together with paired consumer items. See [contract/](contract/).

## Testing

```sh
go build ./... && go vet ./... && go test -race -count=1 ./...
```

`review/testdata/prompts_golden.json` and `defs_golden.json` record the reviewer's prompt bytes and `submit_review` definition (moved verbatim from kogen-executor's). A plain run fails on any drift and writes nothing; the test-only flag `-update` (`go test ./... -update`) rewrites them from the current output. Use it only after an intended change to the reviewer's policy, and review the diff.

The module depends on private KogenAI modules: set `GOPRIVATE=github.com/KogenAI/*`.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
