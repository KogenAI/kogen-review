Feature: k-review-display-float-unpinned: Consumer Display boundary
  Scenario Outline: k-review-display-float-unpinned: Both supported producer versions pass
    When k-review-display-float-unpinned: I run TestDisplay against executor "<version>"
    Then k-review-display-float-unpinned: TestDisplay passes exactly once
    Examples:
      | version                                    |
      | v0.0.0-20261103084720-09eabaf5b7dc           |
      | v0.0.0-20261103215046-11024a948009           |

  Scenario: k-review-display-float-unpinned: Main remains compatible with the whole consumer
    When k-review-display-float-unpinned: I run all Go tests against executor "v0.0.0-20261103215046-11024a948009"
    Then k-review-display-float-unpinned: TestDisplay passes exactly once

  Scenario: k-review-display-float-unpinned: Retain the useful table without float format ownership
    Then k-review-display-float-unpinned: the Display expectations are
      """
      {nil, ""}, {"x/y.go", "x/y.go"}, {json.Number("12"), "12"}, {json.Number("1.50"), "1.50"},
      {float64(2.5), "2.5"}, {7, "7"}, {true, "true"},
      """
    And k-review-display-float-unpinned: the Display signature remains "_ func(any) string = core.Display"

  Scenario: k-review-display-float-unpinned: Document the contract boundary
    Then k-review-display-float-unpinned: the README says "does not pin integral or exponent float rendering"
