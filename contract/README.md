# Contract suite

This package is the contract of kogen-review with its consumer, kogen-build. It pins exactly what kogen-build uses: the exported API it calls, the behaviours it relies on and the formats the reviewer writes into a Build's checkpoints and run folder. It runs in kogen-review's own fast gate, `go test ./...`, so an interface change fails here first, without the kogen-build repository.

An intended interface change edits this contract together with paired consumer items: the kogen-build tests named in each test's comment.

Run it with the rest of the module, or alone:

```sh
go test -race -count=1 ./contract/...
```

## What it is made of

- The cases are copied and adapted from kogen-build's own tests of the review, at `b47cde70dcdf4fea58f2043b31619b07e8bdc9da` (`build/review_test.go`, `review_lineup_test.go`, `review_parts_build_test.go`, `review_prefill_test.go`, `k_revod_gate_test.go`, `k_reviewretry2_test.go`, `legacy_test.go`, `state_golden_test.go`), and from its call sites: `build/host.go` (`delegate{review.Independent{}}`), `build/executor_external.go` (`delegate{review.NewExternal(ex, desc, max)}`), `build/hooks.go` (`review.File`), `build/review_retry.go` (`review.DecodeSession`) and `build/legacy.go` (`review.Session`, `Submitted`, `Verdict`, `Session.Encode`).
- The Build is a fake: a `core.Attempt` over a `core.State` with a `t.TempDir()` checkout and a real run folder (`core.StartRun`), and a `core.Host` that scripts the candidate tree, the model's answers (`provider.Response` values returned by `Request`), the verification passes and the executor's rounds, and records what the reviewer asks of the Build. The external executor is a fake `executor.Executor` whose sessions return scripted structured verdicts.
- `TestMain` strips `GIT_*` and `KOGEN_*`, sets a HOME of its own, `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`, and calls `durable.SkipSyncInTests`.
- The suite imports only the standard library, `review`, kogen-executor `core`, `agent` and `executor`, kogen-coordinator `project` and `durable`, kogen-verification `verify` and kogen-loop `provider`, `sys` and `tools`. No model runs and nothing reaches the network: there is no provider server at all, no fixed port and no shared path. It does not read kogen-review's own sources or kogen-build's goldens, has no `t.Skip`, no sleep and no build constraint, and passes with `-count=1`, `-trimpath` and `-race`.

## Behaviours and formats pinned

Each item is asserted so that changing it fails the suite.

- `api-signatures`, `api_test.go` (compile-time): `review.Independent{}` and `review.External{}` are `core.Reviewer`s; `NewExternal` is `func(executor.Executor, executor.Descriptor, int) review.External`; the `Review` and `Resume` methods of both; `File func(int) string`; `DecodeSession func(json.RawMessage) (review.Session, error)`; `Session.Encode`; `InvalidError func() *sys.Error`; `Validate func(*core.Attempt, map[string]any, []any) (*review.Verdict, []string, error)`; `ToolNames []string`.
- `api-fields`, `api_test.go` (compile-time): the fields of `Session`, `Submitted`, `Verdict`, `Part` and `Material` that kogen-build sets or reads, with their types.
- `review-file`, `TestReviewRecordFileName`: a review's record is `review-<n>.json`.
- `tool-names`, `TestReviewerToolNames`: the reviewer's native tools are read_file, view_image, list_files, search_text, write_file and shell, in that order.
- `invalid-stop`, `TestInvalidErrorIsTheReviewInvalidStop`: `candidate/review_invalid`, its detail and exit 1.
- `session-json`, `TestSessionEncodesItsCheckpointBytes`: the exact bytes of a session in `continuation.review`: key names and order, omitted empty fields, nil lists as `[]`, no HTML escaping.
- `session-decode`, `TestDecodeSessionReadsWhatACheckpointKept`: every field round-trips, numbers stay `json.Number`, and malformed or missing state is an error.
- `material-json`, `TestMaterialEvidenceJSON` and `TestExternalReviewApprovesInItsOwnSession`: the keys of `review-<n>-material.json` read through `Material` and `Part`, and the retained material's custody (0700 folder, 0600 files) and delivery.
- `validate-shape`, `TestValidateAcceptsTheVerdictShapes` (20 subtests): the accepted verdicts and the exact problem text of every shape and inner-validation failure, never disclosing submitted values; a finding's path must be a file of the checkout or of the start HEAD.
- `validate-unread`, `TestValidateRefusesAVerdictWithUnreadParts`: a native verdict needs every pinned part read, with the two problem texts.
- `independent-approve` and `review-record`, `TestIndependentReviewApprovesTheGreenPass`: a new review number, one request of the review role with the reviewer prompt and `submit_review`, the stages review → tool → review_verify, the progress lines, the material event, `review-1.json` with model, effort, usage, verdict, findings, tree and attempts, the `review` run-log event and the approval of the pass under review.
- `independent-blocked`, `TestIndependentReviewChangesIsTheReviewBlockedStop`: a changes verdict is `candidate/review_blocked` (exit 1) with one `review: <path>:<line>: <message>` line per blocking finding, and the verdict stays in a review_verify checkpoint.
- `independent-invalid`, `TestIndependentReviewWithoutAVerdictIsHandedToTheBuild`: one reminder that forces `submit_review`, then the Build gets the `core.InvalidEnd` (reason `no_tool_reminder_exhausted`) and the stop is `candidate/review_invalid`.
- `independent-exact-tree`, `TestIndependentApprovalOfAnUnverifiedTreeIsVerifiedFirst`: an approval of a tree that is not the green pass's is verified by the Build, the changes go back to the same reviewer with their diff, and only the approval of the verified tree binds.
- `independent-resume`, `TestIndependentResumeJudgesTheSavedVerdict`: a review_verify checkpoint's approval is judged again without a request; unreadable review state is `candidate/resume_refused`.
- `external-approve`, `TestExternalReviewApprovesInItsOwnSession`: one fresh executor session of the review role with the model, effort, run id, round cap and `submit_review` schema, the review executor state and the `executor_round` event, and the approval.
- `external-invalid`, `TestExternalReviewCorrectsAnInvalidVerdictOnce`: an invalid structured verdict is sent back once with its text; the second ends the review (`rejected_verdict_exhausted`, `candidate/review_invalid`).
- `external-resume`, `TestExternalReviewHasNoResume`: `External.Resume` is `candidate/resume_refused` with its detail.

## Inventory

Every exported member of `review` that kogen-build uses (derived with a go/types observer over `./build` at `b47cde7`, tests included) has one row.

| Interface | Derived from | Contract tests |
| --- | --- | --- |
| `review.Independent` (`Review`, `Resume`) | `build/host.go` | `api_test.go`, `TestIndependentReviewApprovesTheGreenPass`, `TestIndependentReviewChangesIsTheReviewBlockedStop`, `TestIndependentReviewWithoutAVerdictIsHandedToTheBuild`, `TestIndependentApprovalOfAnUnverifiedTreeIsVerifiedFirst`, `TestIndependentResumeJudgesTheSavedVerdict` |
| `review.NewExternal`, `review.External` (`Review`, `Resume`) | `build/executor_external.go`, `build/review_lineup_test.go` | `api_test.go`, `TestExternalReviewApprovesInItsOwnSession`, `TestExternalReviewCorrectsAnInvalidVerdictOnce`, `TestExternalReviewHasNoResume` |
| `review.File` | `build/hooks.go` | `TestReviewRecordFileName`, `TestIndependentReviewApprovesTheGreenPass` |
| `review.DecodeSession` | `build/review_retry.go`, `build/legacy_test.go` | `TestDecodeSessionReadsWhatACheckpointKept`, `TestIndependentReviewChangesIsTheReviewBlockedStop` |
| `review.Session` (`Role`, `Input`, `Usage`, `Attempts`, `Verdict`, `Tree`, `Tools`, `Encode`) | `build/legacy.go`, `build/legacy_test.go`, `build/state_golden_test.go`, `build/review_retry.go` | `api_test.go`, `TestSessionEncodesItsCheckpointBytes`, `TestDecodeSessionReadsWhatACheckpointKept` |
| `review.Submitted` (`Pass`, `Tree`, `Verdict`, `Findings`) | `build/legacy.go`, `build/state_golden_test.go` | `api_test.go`, `TestSessionEncodesItsCheckpointBytes` |
| `review.Verdict` (`Verdict`, `Findings`) | `build/legacy.go`, `build/review_retry.go`, `build/state_golden_test.go` | `api_test.go`, `TestSessionEncodesItsCheckpointBytes`, `TestValidateRefusesAVerdictWithUnreadParts` |
| `review.Validate` | `build/review_test.go`, `build/review_prefill_test.go`, `build/k_revod_gate_test.go` | `TestValidateAcceptsTheVerdictShapes`, `TestValidateRefusesAVerdictWithUnreadParts` |
| `review.InvalidError` | `build/k_reviewretry2_test.go` | `TestInvalidErrorIsTheReviewInvalidStop`, `TestIndependentReviewWithoutAVerdictIsHandedToTheBuild`, `TestExternalReviewCorrectsAnInvalidVerdictOnce` |
| `review.ToolNames` | `build/review_delivery_test.go` | `TestReviewerToolNames` |
| `review.Material` (`Authority`, `Source`, `Parts`, `Session`, `Delivered`, `Round`, `ReviewParts`; the evidence's `Bytes` and `SHA256`) | `build/review_lineup_test.go`, `build/review_parts_build_test.go` | `api_test.go`, `TestMaterialEvidenceJSON`, `TestExternalReviewApprovesInItsOwnSession` |
| `review.Part` (every field) | `build/review_parts_build_test.go` | `api_test.go`, `TestMaterialEvidenceJSON` |

`review.Prompt`, `review.PartsRule` and `review.OnDemandRule` are exported, moved unchanged, but no consumer uses them: the on_demand review mode they serve was removed from kogen-build (`dfa857f`, `b47cde7`).
