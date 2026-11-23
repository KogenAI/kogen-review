Feature: The kogen-review command's invalid-input contract is pinned by tests
  This feature checks that the tests of cmd/kogen-review pass on the current main.go and fail on
  deliberately wrong copies of it, so a test too weak to notice a changed exit code, stream or
  refusal is rejected.

  Background:
    Given cli-invalid-input-contract: the kogen-review command with main.go and main_test.go

  Scenario: The tests pass on the current command and include invalid-input cases
    When cli-invalid-input-contract: the tests of cmd/kogen-review are run against the current main.go
    Then cli-invalid-input-contract: every test passes and a test beyond the existing ones ran

  Scenario: A missing required flag is refused as a usage error
    When cli-invalid-input-contract: the tests of cmd/kogen-review are run against a main.go where "a missing -model is not checked"
    Then cli-invalid-input-contract: a test fails
    When cli-invalid-input-contract: the tests of cmd/kogen-review are run against a main.go where "the usage line is printed on stdout"
    Then cli-invalid-input-contract: a test fails

  Scenario: An unexpected positional argument is refused as a usage error
    When cli-invalid-input-contract: the tests of cmd/kogen-review are run against a main.go where "a positional argument is accepted"
    Then cli-invalid-input-contract: a test fails

  Scenario: An unusable checkout is refused with a message on stderr
    When cli-invalid-input-contract: the tests of cmd/kogen-review are run against a main.go where "a refusal is printed on stdout"
    Then cli-invalid-input-contract: a test fails
    When cli-invalid-input-contract: the tests of cmd/kogen-review are run against a main.go where "a refusal exits 1"
    Then cli-invalid-input-contract: a test fails

  Scenario: An invalid project configuration is refused
    When cli-invalid-input-contract: the tests of cmd/kogen-review are run against a main.go where "an invalid project configuration is ignored"
    Then cli-invalid-input-contract: a test fails

  Scenario: An unresolvable start commit is refused
    When cli-invalid-input-contract: the tests of cmd/kogen-review are run against a main.go where "an unresolvable start commit is ignored"
    Then cli-invalid-input-contract: a test fails
