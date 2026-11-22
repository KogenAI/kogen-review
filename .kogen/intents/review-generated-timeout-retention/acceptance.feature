Feature: A timed-out regeneration keeps the generated file
  This feature requires that the tests of the review package pin what happens to a large generated file whose regenerating command does not finish within the regeneration limit. A copy of the checkout is given a wrong behavior of a timeout, and the tests of the review package must notice it.

  Scenario: A timed-out regeneration is not reported as a mismatch
    Given review-generated-timeout-retention: a copy of the review package in which a timed-out regeneration is "reported as a mismatch"
    When review-generated-timeout-retention: the tests of the review package run in that copy
    Then review-generated-timeout-retention: a test of the review package fails

  Scenario: A timed-out regeneration keeps the full text of the generated file
    Given review-generated-timeout-retention: a copy of the review package in which a timed-out regeneration is "left out of the review source"
    When review-generated-timeout-retention: the tests of the review package run in that copy
    Then review-generated-timeout-retention: a test of the review package fails
