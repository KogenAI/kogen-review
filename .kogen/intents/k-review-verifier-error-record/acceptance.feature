Feature: Preserve submitted review evidence without approving errors
  Scenario: Verification unavailable after a submitted repair
    When k-review-verifier-error-record: scripted review runs in mode "error"
    Then k-review-verifier-error-record: the submitted note is "Corrected the count" with truthful verification status

  Scenario: Exact-tree verification succeeds
    When k-review-verifier-error-record: scripted review runs in mode "success"
    Then k-review-verifier-error-record: the submitted note is "Corrected the count" with truthful verification status

  Scenario: Error after two completed repair cycles
    When k-review-verifier-error-record: scripted review runs in mode "two"
    Then k-review-verifier-error-record: the submitted note is "Corrected the count" with truthful verification status

  Scenario: Failure before any submission
    When k-review-verifier-error-record: scripted review runs in mode "before"
    Then k-review-verifier-error-record: the submitted note is "Corrected the count" with truthful verification status

  Scenario: Submitted changes remains blocked
    When k-review-verifier-error-record: scripted review runs in mode "blocked"
    Then k-review-verifier-error-record: the submitted note is "Corrected the count" with truthful verification status
