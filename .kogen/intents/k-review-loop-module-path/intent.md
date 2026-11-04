# Require kogen-loop by its canonical module path

Slug: k-review-loop-module-path
Model: not applicable — a dependency and import-path migration with no behavior or state change
Acceptance:
- .kogen/intents/k-review-loop-module-path/acceptance.feature
- features/steps/k-review-loop-module-path__steps.js

kogen-loop now declares its real module path, `github.com/KogenAI/kogen-loop` (L-MODULE-PATH, landed). kogen-review still requires the bare `kogen-loop` through `replace kogen-loop => github.com/KogenAI/kogen-loop v0.0.0-20261102055344-c6e2360290d4` and `kogen-loop v0.0.0`. This change makes kogen-review require `github.com/KogenAI/kogen-loop` directly and import it by that path. The behavior stays the same.

Changes:
- go.mod: drop the `replace kogen-loop => ...` line and the `kogen-loop v0.0.0` requirement. There is no replace directive and no go.work afterwards.
- Require kogen-loop at the observed main commit `dea3eb375dba2fa95f38c3e2db9caad8fa6bbc07` with `go get github.com/KogenAI/kogen-loop@dea3eb375dba2fa95f38c3e2db9caad8fa6bbc07`. That writes the pseudo-version `v0.0.0-20261104063532-dea3eb375dba` and its go.sum lines.
- Pinned Kogen components: the current pins of kogen-coordinator, kogen-executor and kogen-verification import the bare `kogen-loop`. Each has since landed its own loop-module-path row. In the same change, move each to its observed main so that no dependency in the build list imports `kogen-loop/...`:
  - `go get github.com/KogenAI/kogen-coordinator@f4bd4aebd8c25abb74cd342964deff2da00ddc8a` (writes `v0.0.0-20261104083402-f4bd4aebd8c2`)
  - `go get github.com/KogenAI/kogen-executor@b2ffb64382e84681ef358dc5fd16fc08fed57eaf` (writes `v0.0.0-20261104084012-b2ffb64382e8`)
  - `go get github.com/KogenAI/kogen-verification@7805cfe30d6cc3ea13a4d7b7ed286baa00701bad` (writes `v0.0.0-20261104081401-7805cfe30d6c`)

  Then run `go mod tidy`. go.mod's `go 1.27.2` line is unchanged.
- Imports: change every Go import of `kogen-loop/...` to `github.com/KogenAI/kogen-loop/...`. There are 45 such imports today, in `review/`, `cmd/kogen-review/`, `contract/`, `consumes/kogen-loop/` and `consumes/kogen-executor/`. Afterwards `grep -rn "\"kogen-loop/" --include=*.go .` finds nothing. Change nothing else in those files.
- `consumes/kogen-loop/README.md`, Coverage check section:
  - The prose names the producer as module `kogen-loop`; name it as module `github.com/KogenAI/kogen-loop`.
  - The observer command's last-but-one argument `kogen-loop=kogen-loop` becomes `kogen-loop=github.com/KogenAI/kogen-loop`.
  - The inventory is unchanged.

The main commits listed above were observed while shaping. They are fixed so that branch movement during the Build or verification cannot change the target.

Out of scope:
- No production code, reviewer policy, prompt or golden changes.
- No test changes beyond the import paths.
- No go.work.
- No other dependency changes.
- The step files of earlier Intents under `features/steps/` (for example `k-review-drop-loop-def-pin__steps.js`, `k-consumes-review__fixtures.js` and `*.go.txt` fixtures). These are historical acceptance harnesses that still spell the bare path in generated fixtures or local replaces. They are not edited.

## Decisions
- Drop the `replace kogen-loop => ...` line and the `kogen-loop v0.0.0` requirement from go.mod. (source: request)
- Require `github.com/KogenAI/kogen-loop` at kogen-loop main with `go get`. This writes a pseudo-version require plus go.sum, with no replace and no go.work. (source: request)
- Update every import from `kogen-loop/...` to `github.com/KogenAI/kogen-loop/...`. (source: request)
- In the same change, move kogen-coordinator, kogen-executor and kogen-verification to their current mains with `go get github.com/KogenAI/<component>@<its main sha>` so that no dependency in the build list imports `kogen-loop/...`. Then run `go mod tidy`. (source: request)
- No behavior change. (source: request)

## Source comparison
- addressed: Need, "drop the replace line and the `kogen-loop v0.0.0` requirement". Covered by the go.mod scenario: exact require list, no replace, no bare go.sum line.
- addressed: Need, "`go get github.com/KogenAI/kogen-loop@<kogen-loop main sha>`". kogen-loop main was observed at `dea3eb375dba2fa95f38c3e2db9caad8fa6bbc07` (`git ls-remote`, 2026-11-04), which yields pseudo-version `v0.0.0-20261104063532-dea3eb375dba`. The go.sum lines for it are checked exactly. The absence of go.work is checked.
- technical choice in shaping: "current main" is fixed to the commits observed while shaping, so that branch movement during the Build or verification cannot change the target.
- addressed: Need, "update every import", and Acceptance, `grep -rn "\"kogen-loop/" --include=*.go .` finds nothing. That exact grep is run by the import scenario.
- addressed: Acceptance, "go.mod has no replace directive for kogen-loop". The go.mod scenario asserts that go.mod has no replace directive at all.
- addressed: Acceptance, `go build ./... && go vet ./... && go test ./...` pass. The configured checks run these: compile, vet, and go-test with `-trimpath`. They are not duplicated in the feature.
- addressed: Order, "move each component to its current main". The request's component list is "kogen-coordinator kogen-executor kogen-review kogen-verification". kogen-review is this repository itself, and no dependency in its build list requires it, so there is nothing to move for it. The observed mains of the other three are listed above. Each requires `github.com/KogenAI/kogen-loop` and imports no bare `kogen-loop/...` package. The only bare spelling in kogen-loop main is a `//go:build ignore` driver under `features/steps/`, which is outside the build. The build-list scenario checks that no package or module named `kogen-loop` remains, and the go.mod scenario checks that `go mod tidy -diff` is clean.
- addressed: Order, "go.mod keeps no replace and no `kogen-loop v0.0.0` requirement". Covered by the go.mod scenario.
- addressed: Automatic retry cause, "no candidate/intent/shape line in ~/logs/k-review-loop-module-path.log". The previous attempt produced no shaping output. This attempt shapes and submits a complete Intent. The cause concerns the delivery runner's log and needs no product change.
- superseded: go.mod's `kogen-loop v0.0.0` requirement and its `replace`; the go.sum lines of the older component pins and of `github.com/KogenAI/kogen-loop v0.0.0-20261102055344-c6e2360290d4`, as far as `go mod tidy` removes them; the bare module naming in `consumes/kogen-loop/README.md`'s Coverage check.
- omitted, by design: historical acceptance harnesses of earlier Intents that spell the bare path (see Out of scope above).

## Tests
- go.mod requires the canonical kogen-loop and the three components at the observed mains, with no replace, no go.work, matching go.sum and a tidy module: the go.mod scenario in acceptance.feature (integration)
- No Go file imports `kogen-loop/...`: the import scenario, which runs the request's exact grep (integration)
- The build resolves kogen-loop's packages only through `github.com/KogenAI/kogen-loop`, and no bare `kogen-loop` package or module is in the build list: the build-list scenario, running `go list -deps -test ./...` and `go list -m all` (integration)
- No behavior change: the existing `go build ./...`, `go vet ./...` and `go test ./...` suites, including `contract/` and the `consumes/` suites, pass unchanged apart from import paths (existing)

## Feasibility
- `git ls-remote` resolved these main commits: kogen-loop `dea3eb375dba2fa95f38c3e2db9caad8fa6bbc07`, kogen-coordinator `f4bd4aebd8c25abb74cd342964deff2da00ddc8a`, kogen-executor `b2ffb64382e84681ef358dc5fd16fc08fed57eaf`, kogen-verification `7805cfe30d6cc3ea13a4d7b7ed286baa00701bad`. kogen-review's own main is `f04169324523c40df832e5fd0803b2362a6ca633`, the parent of this checkout's HEAD. (probe: exit 0)
- `go mod download -json` of each main commit gave the pseudo-versions listed above. The component go.mod files require `github.com/KogenAI/kogen-loop` (coordinator at `v0.0.0-20261103215300-3e292bb34b90`; executor and verification at `v0.0.0-20261104002337-25d87c2177c3`) and contain no bare `kogen-loop/` import outside a `//go:build ignore` driver. (probe: exit 0)
- A scratch copy outside the repository applied the migration: `go mod edit -dropreplace=kogen-loop -droprequire=kogen-loop`, the import rewrite, the four `go get` commands and `go mod tidy`. The result was a go.mod with exactly the four requires above, `go 1.27.2` and no replace, and go.sum lines `github.com/KogenAI/kogen-loop v0.0.0-20261104063532-dea3eb375dba h1:lVdZBUWyKzLtcgnEO7PG3iK6dYpIkD3a+iLh3W0fl3k=` and `/go.mod h1:yPduvTAVdxH5egqW82Uis/ZhemRb5gNSdzTll/f6bG0=`. In that copy, `go build ./...` and `go vet ./...` passed with no output, `go mod tidy -diff` exited 0, `go mod graph` had no edge to `kogen-loop@`, and `go test -count=1 ./consumes/...` passed for all four consumes suites. The full `go test ./...` was not run in the probe; the configured checks cover it.
- On the unchanged tree, `go mod tidy -diff` exits 0, so the tidy assertion is not a missing-feature failure. The go.mod scenario still fails now, on the require list and the replace directive.
- No declared evidence obligations: the step file runs only read-only go, grep and file checks on the candidate tree.
