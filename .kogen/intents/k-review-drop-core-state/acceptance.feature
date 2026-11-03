Feature: The saved-candidate contract test reads the saved state without the executor's core.State

  Scenario: Against kogen-executor main the module vets and the saved-candidate test passes
    When the checkout is copied with go.mod requiring kogen-executor "v0.0.0-20261103113250-2f13bd4bf08d" and checked with go vet and the contract test "TestReviewOfASavedCandidateWithoutABuild"
    Then the copy builds against exactly that kogen-executor version
    And go vet passes on every package of the copy
    And the contract test passes in the copy

  Scenario: Against the newest kogen-executor main seen while shaping the module vets and the saved-candidate test passes
    When the checkout is copied with go.mod requiring kogen-executor "v0.0.0-20261103180309-923b1adfa45c" and checked with go vet and the contract test "TestReviewOfASavedCandidateWithoutABuild"
    Then the copy builds against exactly that kogen-executor version
    And go vet passes on every package of the copy
    And the contract test passes in the copy

  Scenario: Against the pinned kogen-executor the contract tests still review the saved candidate from disk
    When the contract tests run with Go's test log
    Then the contract tests pass
    And a review read a saved checkpoint.json from its run folder and recorded its verdict there
    And the contract tests read no fixture from the Go module cache or from kogen-build's state goldens

  Scenario: The change is test-only
    Then the review package, its golden files, go.mod and go.sum are as committed at HEAD
