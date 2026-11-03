Feature: Review runs against a saved candidate without a Build attempt

  Scenario: The contract tests review a candidate from the saved state an earlier Build left on disk
    When the contract tests run with Go's test log
    Then the contract tests pass
    And a review read a saved checkpoint.json from its run folder and recorded its verdict there
    And the contract tests read no fixture from the Go module cache or from kogen-build's state goldens

  Scenario: The change is test-only
    Then the review package, its golden files, go.mod and go.sum are as committed at HEAD
