Feature: Deliver candidate source exactly once per review
  Scenario: Preserve all mixed-candidate changes without repeating source
    When k-review-input-no-repeated-content: I assemble the mixed Git candidate
    Then k-review-input-no-repeated-content: all source is delivered exactly once including two ordered parts
