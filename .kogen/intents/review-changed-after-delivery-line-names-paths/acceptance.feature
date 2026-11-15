Feature: The progress line about a candidate that changed after delivery names the changed paths

  This feature runs a scripted native review through review.Independent Review over the contract
  suite's scripted Env and a real temporary Git candidate. The reviewer approves a tree whose
  contents differ from the contents delivered to it, so the review returns the changes to the
  reviewer. The progress line names the changed paths, at most five and then how many more, and the
  feedback sent to the reviewer is unchanged and still lists every changed path.

  Scenario: A candidate that changed in three paths after delivery names them in sorted order
    When review-changed-after-delivery-line-names-paths: a review whose approved tree differs from the delivered tree by 3 changed paths is run
    Then review-changed-after-delivery-line-names-paths: the progress lines about the change after delivery are:
      """
      ["kogen: review 1: the candidate changed after its contents were delivered (alpha/one.txt, app.txt, zeta.txt); returning the changes to the reviewer"]
      """

  Scenario: A candidate that changed in seven paths after delivery names five of them and counts the rest
    When review-changed-after-delivery-line-names-paths: a review whose approved tree differs from the delivered tree by 7 changed paths is run
    Then review-changed-after-delivery-line-names-paths: the progress lines about the change after delivery are:
      """
      ["kogen: review 1: the candidate changed after its contents were delivered (app.txt, g1.txt, g2.txt, g3.txt, g4.txt, and 2 more); returning the changes to the reviewer"]
      """

  Scenario: The reviewer feedback of a candidate that changed after delivery is unchanged
    When review-changed-after-delivery-line-names-paths: a review whose approved tree differs from the delivered tree by 7 changed paths is run
    Then review-changed-after-delivery-line-names-paths: the reviewer feedback is:
      """
      {
        "feedback_head": "Your verdict was not applied: the candidate changed after its contents were delivered to you, other than through your own Kogen tool calls: app.txt, g1.txt, g2.txt, g3.txt, g4.txt, g5.txt, g6.txt.\nThe exact diff of these changes against the contents delivered to you:\n\n",
        "diff_files": 7,
        "feedback_tail": "The new tree passed checks but has not been reviewed. Inspect these changes and submit_review for the current contents; do not restart the whole critique."
      }
      """
    And review-changed-after-delivery-line-names-paths: the progress lines about the change after delivery are:
      """
      ["kogen: review 1: the candidate changed after its contents were delivered (app.txt, g1.txt, g2.txt, g3.txt, g4.txt, and 2 more); returning the changes to the reviewer"]
      """
