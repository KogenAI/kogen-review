Feature: Regression coverage for non-text repair account totals
  This feature requires tests in both scoped files to pin real Git account effects.
  Temporary production mutations qualify the regressions without changing delivered behavior.

  Scenario: Binary repairs count files but not lines
    Given review-account-binary-change-stats: the scoped regression sources are available
    Then review-account-binary-change-stats: both scoped test files reject "binary omitted" while accepting totals 1, 0, 0
    And review-account-binary-change-stats: both scoped test files reject "binary numeric" while accepting totals 1, 0, 0

  Scenario: Mode-only repairs count files but not lines
    Given review-account-binary-change-stats: the scoped regression sources are available
    Then review-account-binary-change-stats: both scoped test files reject "mode-only omitted" while accepting totals 1, 0, 0
    And review-account-binary-change-stats: both scoped test files reject "mode-only numeric" while accepting totals 1, 0, 0
