Feature: Review role flags reach the provider request
  This feature checks that the kogen-review command tests pin how the role flags are forwarded to the provider request.

  Scenario: supplied role flags reach the provider request
    When review-cli-role-flag-forwarding: I run the Go tests of the kogen-review command
    Then review-cli-role-flag-forwarding: the Go tests of the kogen-review command pass
    Then review-cli-role-flag-forwarding: the tests reject a review that ignores or swaps a supplied role option

  Scenario: omitted role flags use the documented defaults
    When review-cli-role-flag-forwarding: I run the Go tests of the kogen-review command
    Then review-cli-role-flag-forwarding: the Go tests of the kogen-review command pass
    Then review-cli-role-flag-forwarding: the tests reject a review that changes a documented default

  Scenario: only the test file changes
    Then review-cli-role-flag-forwarding: no file other than the kogen-review test file changed outside the Intent files
