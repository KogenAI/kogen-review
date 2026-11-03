# kogen-review

Kogen's independent review and repair: after a Build's candidate passes verification, a reviewer that never sees the builder's conversation reads the approved Intent and the candidate's source, repairs supported defects and submits a verdict. Only an approval of the exact verified tree can be committed; a blocking finding ends the Build.

It is a component of [Kogen](https://github.com/KogenAI/kogen), which pins an exact version of it and assembles the `kogen` program. kogen-build runs every review through it. It works on the Build state and services of kogen-executor's `core` package and depends on no other component's workflow.

## Packages

- `review`: the native reviewer (`Independent`) and the reviewer served by an external executor (`External`, built with `NewExternal`): review, resume, the review loop, verdict evaluation and the review tool conversation, with the reviewer's own saved session (`Session`). Both are the `core.Reviewer` a Build runs.
- `contract`: the contract suite: what kogen-build uses, pinned in tests that run in `go test ./...`: the API it calls, the reviewer's checkpoint and record formats, verdict validation, and the native and external review flows over a fake Build. An intended interface change edits it together with paired consumer items. See [contract/](contract/).

## Testing

```sh
go build ./... && go vet ./... && go test -race -count=1 ./...
```

The tests accept the test-only flag `-update` (`go test ./... -update`) like the other components; this module has no golden files, so it changes nothing here.

The module depends on private KogenAI modules: set `GOPRIVATE=github.com/KogenAI/*`.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
