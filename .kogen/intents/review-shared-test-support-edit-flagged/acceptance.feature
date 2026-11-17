Feature: Review flags edits to shared test support
  This feature covers the review material line that lists changed shared test support paths and the review rule that tells the reviewer what to do with them.

  Scenario: A changed shared test helper is listed before the diff
    Given review-shared-test-support-edit-flagged: a start commit with the files:
      """
      {"test/test_helpers/session_test_helper.rb":"module SessionTestHelper\nend\n","app/models/thing.rb":"class Thing\nend\n"}
      """
    And review-shared-test-support-edit-flagged: the candidate writes the files:
      """
      {"test/test_helpers/session_test_helper.rb":"module SessionTestHelper\n  def sign_in\n  end\nend\n"}
      """
    When review-shared-test-support-edit-flagged: the review runs
    Then review-shared-test-support-edit-flagged: the review approves
    And review-shared-test-support-edit-flagged: the review source has exactly the line "shared test support changed: test/test_helpers/session_test_helper.rb" before the diff

  Scenario: A new test file and a changed model print no line
    Given review-shared-test-support-edit-flagged: a start commit with the files:
      """
      {"app/models/thing.rb":"class Thing\nend\n","test/models/old_test.rb":"# old\n"}
      """
    And review-shared-test-support-edit-flagged: the candidate writes the files:
      """
      {"test/models/new_thing_test.rb":"# new\n","app/models/thing.rb":"class Thing\n  def x; end\nend\n"}
      """
    When review-shared-test-support-edit-flagged: the review runs
    Then review-shared-test-support-edit-flagged: the review approves
    And review-shared-test-support-edit-flagged: the review source has no shared test support line

  Scenario: A plain version bump of a lockfile prints no line
    Given review-shared-test-support-edit-flagged: a start commit with the files:
      """
      {"Gemfile.lock":"GEM\n  specs:\n    rails (7.1.0)\n"}
      """
    And review-shared-test-support-edit-flagged: the candidate writes the files:
      """
      {"Gemfile.lock":"GEM\n  specs:\n    rails (7.1.1)\n"}
      """
    When review-shared-test-support-edit-flagged: the review runs
    Then review-shared-test-support-edit-flagged: the review approves
    And review-shared-test-support-edit-flagged: the review source has no shared test support line

  Scenario: A manifest change that is not a version bump is listed
    Given review-shared-test-support-edit-flagged: a start commit with the files:
      """
      {"Gemfile":"source 'https://rubygems.org'\ngem 'rails'\n"}
      """
    And review-shared-test-support-edit-flagged: the candidate writes the files:
      """
      {"Gemfile":"source 'https://rubygems.org'\ngem 'rails', require: false\n"}
      """
    When review-shared-test-support-edit-flagged: the review runs
    Then review-shared-test-support-edit-flagged: the review approves
    And review-shared-test-support-edit-flagged: the review source has exactly the line "shared test support changed: Gemfile" before the diff

  Scenario: Several changed shared paths are listed in path order and an added helper is not
    Given review-shared-test-support-edit-flagged: a start commit with the files:
      """
      {"test/test_helper.rb":"# helper\n","spec/support/a.rb":"# a\n","app/models/thing.rb":"class Thing\nend\n"}
      """
    And review-shared-test-support-edit-flagged: the candidate writes the files:
      """
      {"test/test_helper.rb":"# helper\n# changed\n","spec/support/a.rb":"# a\n# changed\n","test/test_helpers/new_helper.rb":"# new\n"}
      """
    When review-shared-test-support-edit-flagged: the review runs
    Then review-shared-test-support-edit-flagged: the review approves
    And review-shared-test-support-edit-flagged: the review source has exactly the line "shared test support changed: spec/support/a.rb, test/test_helper.rb" before the diff

  Scenario: An Intent that names the changed helper still gets the line
    Given review-shared-test-support-edit-flagged: the approved Intent text is:
      """
      # Add the thing

      Slug: fixture
      Model: not applicable — text files
      Acceptance:
      - .kogen/intents/fixture/acceptance.feature

      The candidate extends test/test_helpers/session_test_helper.rb with a sign_in helper.
      """
    And review-shared-test-support-edit-flagged: a start commit with the files:
      """
      {"test/test_helpers/session_test_helper.rb":"module SessionTestHelper\nend\n"}
      """
    And review-shared-test-support-edit-flagged: the candidate writes the files:
      """
      {"test/test_helpers/session_test_helper.rb":"module SessionTestHelper\n  def sign_in\n  end\nend\n"}
      """
    When review-shared-test-support-edit-flagged: the review runs
    Then review-shared-test-support-edit-flagged: the review approves
    And review-shared-test-support-edit-flagged: the one-session review task names the path "test/test_helpers/session_test_helper.rb"
    And review-shared-test-support-edit-flagged: the review source has exactly the line "shared test support changed: test/test_helpers/session_test_helper.rb" before the diff

  Scenario: The rule is in the native instructions and the one-session task once
    Given review-shared-test-support-edit-flagged: a start commit with the files:
      """
      {"app/models/thing.rb":"class Thing\nend\n"}
      """
    And review-shared-test-support-edit-flagged: the candidate writes the files:
      """
      {"app/models/thing.rb":"class Thing\n  def x; end\nend\n"}
      """
    When review-shared-test-support-edit-flagged: the review runs
    Then review-shared-test-support-edit-flagged: the review approves
    And review-shared-test-support-edit-flagged: the native reviewer instructions carry this rule text once:
      """
      Shared test support: when the review source has a line starting `shared test support changed:` and the approved Intent does not name those paths, repair it: restore each listed shared file byte for byte and move the behaviour the candidate needs into a helper or override beside the candidate's own new test files; when that cannot be done within the Intent, submit changes with a blocking finding naming the path and the line. A path the Intent names is not an issue.
      """
    And review-shared-test-support-edit-flagged: the one-session review task carries this rule text once:
      """
      Shared test support: when the review source has a line starting `shared test support changed:` and the approved Intent does not name those paths, repair it: restore each listed shared file byte for byte and move the behaviour the candidate needs into a helper or override beside the candidate's own new test files; when that cannot be done within the Intent, submit changes with a blocking finding naming the path and the line. A path the Intent names is not an issue.
      """

  Scenario: The rule is in every part task once and the line is in part 1 once
    Given review-shared-test-support-edit-flagged: a start commit with the files:
      """
      {"test/test_helpers/session_test_helper.rb":"module SessionTestHelper\nend\n"}
      """
    And review-shared-test-support-edit-flagged: the candidate writes the files:
      """
      {"test/test_helpers/session_test_helper.rb":"module SessionTestHelper\n  def sign_in\n  end\nend\n"}
      """
    And review-shared-test-support-edit-flagged: the candidate also adds a file big.txt of 25000 lines
    When review-shared-test-support-edit-flagged: the review runs
    Then review-shared-test-support-edit-flagged: the review approves
    And review-shared-test-support-edit-flagged: the parts of the review carry exactly the line "shared test support changed: test/test_helpers/session_test_helper.rb" in part 1, before the diff
    And review-shared-test-support-edit-flagged: the task of every part carries this rule text once:
      """
      Shared test support: when the review source has a line starting `shared test support changed:` and the approved Intent does not name those paths, repair it: restore each listed shared file byte for byte and move the behaviour the candidate needs into a helper or override beside the candidate's own new test files; when that cannot be done within the Intent, submit changes with a blocking finding naming the path and the line. A path the Intent names is not an issue.
      """
