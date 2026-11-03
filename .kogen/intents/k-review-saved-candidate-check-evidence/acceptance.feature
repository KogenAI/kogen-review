Feature: Truthful initial saved-candidate verification
  Scenario: An unchanged wrong candidate has no invented green
    Given k-review-saved-candidate-check-evidence: a saved repository with check mode "configured"
    When k-review-saved-candidate-check-evidence: the current value is "wrong" and standalone review runs
    Then k-review-saved-candidate-check-evidence: verification is "failed" with 1 assertion executions

  Scenario: A successful assertion qualifies the exact current tree
    Given k-review-saved-candidate-check-evidence: a saved repository with check mode "configured"
    When k-review-saved-candidate-check-evidence: the current value is "right" and standalone review runs
    Then k-review-saved-candidate-check-evidence: verification is "passed" with 1 assertion executions

  Scenario: Changing contents invalidates an earlier tree's green
    Given k-review-saved-candidate-check-evidence: a saved repository with check mode "configured"
    When k-review-saved-candidate-check-evidence: the current value is "right" and standalone review runs
    Then k-review-saved-candidate-check-evidence: verification is "passed" with 1 assertion executions
    When k-review-saved-candidate-check-evidence: the current value is "wrong" and standalone review runs
    Then k-review-saved-candidate-check-evidence: verification is "failed" with 1 assertion executions

  Scenario: A missing executable is infrastructure evidence not green
    Given k-review-saved-candidate-check-evidence: a saved repository with check mode "missing"
    When k-review-saved-candidate-check-evidence: the current value is "wrong" and standalone review runs
    Then k-review-saved-candidate-check-evidence: verification is "unavailable" with 0 assertion executions

  Scenario: An intentional empty check declaration invents no execution
    Given k-review-saved-candidate-check-evidence: a saved repository with check mode "none"
    When k-review-saved-candidate-check-evidence: the current value is "wrong" and standalone review runs
    Then k-review-saved-candidate-check-evidence: verification is "no_checks" with 0 assertion executions
