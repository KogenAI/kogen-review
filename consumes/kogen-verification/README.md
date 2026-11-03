# kogen-verification consumes suite

This package states exactly what kogen-review relies on from kogen-verification (module `github.com/KogenAI/kogen-verification`), at the version `go.mod` pins (`v0.0.0-20261103020618-01aa16c01767`): the `verify.Pass` evidence of a verification pass, which kogen-review reads and (in `cmd/kogen-review`) builds, and the stage results it reads from it. It is the other side of kogen-verification's own contract: what that repository provides is stated there, what kogen-review uses is stated here, so a change to what kogen-review uses fails this suite without building kogen-review's other code.

Run it alone, or with the rest of the module in `go test ./...`:

```sh
go test -race -count=1 ./consumes/kogen-verification/
```

## What it pins

- `api_test.go` (compile-time): the type of every field of `verify.Pass` that kogen-review sets or reads (`N`, `Clean`, `Green`, `Tree`, `Setup`, `Acceptance` as `*verify.Acceptance`, `Model`, `MaintainedModels`, `Checks`, `Failing`), `verify.Pass.Results` as `func(verify.Pass) string`, `verify.Acceptance.Problems` as `[]string`, `verify.CommandResult.Name` and `Status`, `verify.MaintainedModelResult.Path` and `Result`, and `verify.ModelResult.Failed` as `func(verify.ModelResult) bool`.
- `TestPassFields`: the pass `cmd/kogen-review` builds (`verify.Pass{N: 1, Clean: true, Green: true, Tree: tree}`) keeps those fields, and the zero pass has no acceptance, no failing names, no setup, checks or maintained models and a model that has not failed.
- `TestPassResults`: the text of `Pass.Results`, which the reviewer's material states as the check results of the final pass: `acceptance: passed (<n> scenarios)`, `model: passed` (`model: not applicable` for the model state `none`), then `check <name>: passed` per check, joined by newlines; no acceptance counts as zero scenarios, and the text depends on neither `Green` nor `Failing`.
- `TestPassStagesOfARedPass`: the stage results the reviewer's failure identities read from a red pass: the acceptance problems, `ModelResult.Failed` (true only for the state `failed`), each maintained model's `Path` and `Result`, and the `Name` and `Status` of setup commands and checks, and the failing names.

## Isolation

`TestMain` unsets every inherited `GIT_*` and `KOGEN_*` variable and `EMAIL`, sets a `HOME` of its own (`os.MkdirTemp`, removed afterwards), `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1` and `GIT_TERMINAL_PROMPT=0`. The suite imports only the standard library and `verify`, opens no connection, reads no file and shares no state between tests; it has no `t.Skip`, no sleep and no build constraint, and passes with `-race -count=1 -shuffle=on` and `-trimpath`.

## How coverage was checked

A go/types observer lists every use of the producer in kogen-review's own code: each identifier in the non-test Go files of the packages of `github.com/KogenAI/kogen-review` outside `contract/`, `consumes/` and `features/` (`review` and `cmd/kogen-review`) that resolves (`Uses` or `Selections`) to an exported package-level object of a package of the module, named `pkg.Name`, or to a method or field of one of its named types, named `pkg.Type.Member`. The same type-check of this suite's test files must name every one of the 18 uses, and the inventory below must equal that list: one row per use, nothing else.

## Inventory

| Use | Tests |
| --- | --- |
| `verify.Acceptance.Problems` | `api_test.go`, `TestPassStagesOfARedPass` |
| `verify.CommandResult.Name` | `api_test.go`, `TestPassResults`, `TestPassStagesOfARedPass` |
| `verify.CommandResult.Status` | `api_test.go`, `TestPassResults`, `TestPassStagesOfARedPass` |
| `verify.MaintainedModelResult.Path` | `api_test.go`, `TestPassStagesOfARedPass` |
| `verify.MaintainedModelResult.Result` | `api_test.go`, `TestPassStagesOfARedPass` |
| `verify.ModelResult.Failed` | `api_test.go`, `TestPassFields`, `TestPassStagesOfARedPass` |
| `verify.Pass` | `api_test.go`, `TestPassFields`, `TestPassResults`, `TestPassStagesOfARedPass` |
| `verify.Pass.Acceptance` | `api_test.go`, `TestPassFields`, `TestPassResults`, `TestPassStagesOfARedPass` |
| `verify.Pass.Checks` | `api_test.go`, `TestPassFields`, `TestPassResults`, `TestPassStagesOfARedPass` |
| `verify.Pass.Clean` | `api_test.go`, `TestPassFields` |
| `verify.Pass.Failing` | `api_test.go`, `TestPassFields`, `TestPassResults`, `TestPassStagesOfARedPass` |
| `verify.Pass.Green` | `api_test.go`, `TestPassFields` |
| `verify.Pass.MaintainedModels` | `api_test.go`, `TestPassFields`, `TestPassStagesOfARedPass` |
| `verify.Pass.Model` | `api_test.go`, `TestPassFields`, `TestPassResults`, `TestPassStagesOfARedPass` |
| `verify.Pass.N` | `api_test.go`, `TestPassFields` |
| `verify.Pass.Results` | `api_test.go`, `TestPassResults` |
| `verify.Pass.Setup` | `api_test.go`, `TestPassFields`, `TestPassStagesOfARedPass` |
| `verify.Pass.Tree` | `api_test.go`, `TestPassFields` |
