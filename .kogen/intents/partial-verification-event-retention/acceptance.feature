Feature: Focused tests for partial verification evidence reconstruction
  This feature checks that the kogen-review command tests pin how a partial verification pass is rebuilt from events.

  Scenario: completed results are retained
    When partial-verification-event-retention: I run the Go tests of the kogen-review command
    Then partial-verification-event-retention: the Go tests of the kogen-review command pass
    And partial-verification-event-retention: the tests reject a partial that loses completed command evidence

  Scenario: missing work is listed
    When partial-verification-event-retention: I run the Go tests of the kogen-review command
    Then partial-verification-event-retention: the Go tests of the kogen-review command pass
    And partial-verification-event-retention: the tests reject a partial that omits missing work or misreports the model state

  Scenario: verification and review behavior stay unchanged
    Then partial-verification-event-retention: no file other than the kogen-review test file changed outside the Intent files
