Feature: An external review that never converges ends at its executor round cap

  kogen's spec scenario "External round caps preserve the candidate and do not restart another
  role" expects candidate/executor_round_limit from an external reviewer that edits the candidate
  wrong and approves in every round. Commit 932c061 made such a session stop earlier, after three
  identical failed verifications, with candidate/review_blocked. The driver in the step file
  reviews a saved Git candidate the same way the spec's fake claude does, with the claude-code
  review role's round cap of 6. The reproduction runs the same driver on the Go module versions of
  kogen-review commits e5005fa (v0.0.0-20261103161351-e5005fa1daf8) and b1cdd8d
  (v0.0.0-20261104034934-b1cdd8d7f5f8).

  Scenario: The external reviewer runs to its round cap and leaves its edits in place
    When k-review-round-cap-outcome: the "external" red-forever review runs on the candidate
    Then k-review-round-cap-outcome: the review observation is:
      """
      {"stop":"candidate/executor_round_limit","detail":"the executor used its 6 rounds without a verified, reviewed candidate; the candidate is left in place","sessions":1,"rounds":6,"task_max_rounds":6,"verifications":6,"repairs_recorded":6,"calc":"def is_even(n):\n    return n % 2 == 1\n","record":"approve","changes_recorded":false}
      """

  Scenario: The native reviewer still stops after three identical failed verifications
    When k-review-round-cap-outcome: the "native" red-forever review runs on the candidate
    Then k-review-round-cap-outcome: the review observation is:
      """
      {"stop":"candidate/review_blocked","detail":"repeated identical final failures after 3 repair rounds; current failing stage/items: acceptance","requests":6,"verifications":3,"repairs_recorded":3,"calc":"def is_even(n):\n    return n % 2 == 1\n","record":"changes","changes_recorded":true}
      """

  Scenario: Reproduction: kogen-review e5005fa ends the external review at its round cap
    When k-review-round-cap-outcome: the "external" red-forever review runs on kogen-review version "v0.0.0-20261103161351-e5005fa1daf8"
    Then k-review-round-cap-outcome: the review observation is:
      """
      {"stop":"candidate/executor_round_limit","detail":"the executor used its 6 rounds without a verified, reviewed candidate; the candidate is left in place","sessions":1,"rounds":6,"verifications":6,"calc":"def is_even(n):\n    return n % 2 == 1\n","record":"approve","changes_recorded":false}
      """

  Scenario: Reproduction: kogen-review b1cdd8d blocks the external review after three repair rounds
    When k-review-round-cap-outcome: the "external" red-forever review runs on kogen-review version "v0.0.0-20261104034934-b1cdd8d7f5f8"
    Then k-review-round-cap-outcome: the review observation is:
      """
      {"stop":"candidate/review_blocked","detail":"repeated identical final failures after 3 repair rounds; current failing stage/items: acceptance","sessions":1,"rounds":3,"verifications":3,"record":"changes","changes_recorded":true}
      """
