Feature: The feedback that returns a reviewer to another round lists the requirements it already listed

  This feature runs scripted native and external reviews through the contract suite's scripted Env
  and a real temporary Git candidate. The candidate changes after the first approval, so the review
  returns the reviewer to a second round. The feedback of that round ends with the requirements an
  accepted submission already listed, so the next approval can list each of them again.

  Scenario: A green final pass returns the listed requirements to the native reviewer
    When review-repair-feedback-lists-requirements: the green scripted review is run
    Then review-repair-feedback-lists-requirements: the feedback of the second request ends with:
      """
      "do not restart the whole critique.\n\nRequirements already listed in this review (your next approval must list each of them, with this text and with evidence observed on the current tree):\n- R1\n- R2"
      """

  Scenario: A failed final verification returns the listed requirements to the native reviewer
    When review-repair-feedback-lists-requirements: the red scripted review is run
    Then review-repair-feedback-lists-requirements: the feedback of the second request ends with:
      """
      "fixture feedback of pass 2; call submit_review\n\nRequirements already listed in this review (your next approval must list each of them, with this text and with evidence observed on the current tree):\n- R1"
      """

  Scenario: An external review returns the listed requirements to the executor
    When review-repair-feedback-lists-requirements: the external scripted review is run
    Then review-repair-feedback-lists-requirements: the feedback of the second request ends with:
      """
      "do not restart the whole critique.\n\nRequirements already listed in this review (your next approval must list each of them, with this text and with evidence observed on the current tree):\n- R1\n- R2"
      """
    And review-repair-feedback-lists-requirements: the reviewer made 2 requests and approved

  Scenario: A review that listed no requirement gets no requirements block
    When review-repair-feedback-lists-requirements: the none scripted review is run
    Then review-repair-feedback-lists-requirements: the feedback of the second request does not contain "Requirements already listed"
    And review-repair-feedback-lists-requirements: the feedback of the second request ends with:
      """
      "do not restart the whole critique."
      """

  Scenario: A listed requirement is shown with its whitespace collapsed
    When review-repair-feedback-lists-requirements: the multiline scripted review is run
    Then review-repair-feedback-lists-requirements: the feedback of the second request ends with:
      """
      "do not restart the whole critique.\n\nRequirements already listed in this review (your next approval must list each of them, with this text and with evidence observed on the current tree):\n- R1 second line"
      """
    And review-repair-feedback-lists-requirements: the feedback of the second request does not contain "second   line"
