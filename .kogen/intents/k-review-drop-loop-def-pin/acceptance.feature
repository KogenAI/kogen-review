Feature: Consume the loop tool interface without producer byte pins
  Scenario: Main is compatible
    When k-review-drop-loop-def-pin: I run the suite against observed main with "none"
    Then k-review-drop-loop-def-pin: the definition consumer test must "pass"

  Scenario: Producer description wording is not a consumer contract
    When k-review-drop-loop-def-pin: I run the suite against observed main with "description"
    Then k-review-drop-loop-def-pin: the definition consumer test must "pass"

  Scenario: A consumed parameter cannot disappear
    When k-review-drop-loop-def-pin: I run the suite against observed main with "missing"
    Then k-review-drop-loop-def-pin: the definition consumer test must "fail"
