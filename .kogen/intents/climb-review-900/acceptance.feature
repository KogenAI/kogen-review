Feature: Focused tests pin the reminder sent after a turn without a valid verdict
  This feature checks that review/reminder_test.go pins reminderTool and reminderText of package review.
  The tests run alone against the current reminder.go and against deliberately wrong copies of it,
  so a test that is too weak to notice a wording, forcing or cap change is rejected.

  Background:
    Given climb-review-900: the review package with reminder.go

  Scenario: The new tests pass on the current reminder code
    When climb-review-900: only review/reminder_test.go is run against the current reminder.go
    Then climb-review-900: at least one test passes and none fails or is skipped

  Scenario: A reminder that never forces read_file is noticed
    When climb-review-900: only review/reminder_test.go is run against a reminder.go where "reminderTool never forces read_file"
    Then climb-review-900: a test of review/reminder_test.go fails

  Scenario: A changed separator between problems is noticed
    When climb-review-900: only review/reminder_test.go is run against a reminder.go where "the problems are joined by a comma and a space"
    Then climb-review-900: a test of review/reminder_test.go fails

  Scenario: A dropped count of unread parts is noticed
    When climb-review-900: only review/reminder_test.go is run against a reminder.go where "the count of unread parts is dropped"
    Then climb-review-900: a test of review/reminder_test.go fails

  Scenario: Reordered unread ids are noticed
    When climb-review-900: only review/reminder_test.go is run against a reminder.go where "the named unread ids are reversed"
    Then climb-review-900: a test of review/reminder_test.go fails

  Scenario: A removed cap on the named unread ids is noticed
    When climb-review-900: only review/reminder_test.go is run against a reminder.go where "the cap on named unread ids is removed"
    Then climb-review-900: a test of review/reminder_test.go fails

  Scenario: A cap applied to the count instead of the names is noticed
    When climb-review-900: only review/reminder_test.go is run against a reminder.go where "the cap is applied to the unread count instead of the names"
    Then climb-review-900: a test of review/reminder_test.go fails

  Scenario: Only the one test file is added
    Then climb-review-900: review/reminder_test.go is the only file added outside the Intent and its steps
