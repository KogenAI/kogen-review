Feature: Repair unsupported candidate-authored claims in review policy
  The examples are instructions to the reviewer, not claims that a scripted model proves reasoning.

  Scenario Outline: The native reviewer receives each settled outcome
    When I obtain the public reviewer instructions
    Then the unsupported-claim policy includes "<instruction>"

    Examples:
      | instruction |
      | Unsupported candidate-authored prose or figures in documentation, comments or changelogs are scoped repairs when the approved Intent does not require the claimed outcome: remove the claim or restate only what you actually measured, verify the repair, and approve if no substantive blockers remain. |
      | If the Intent asks for a feature and says nothing about performance, and the candidate implements it but adds a README line saying this is 3x faster while your probe measures about 1.1x, remove the line or correct it to the measured figure, verify green, and approve. |
      | If instead the Intent requires the operation to be at least 2x faster and your probe measures 1.1x, submit changes with a blocking finding naming that requirement and the measured 1.1x; deleting or correcting the prose does not meet the requirement. |
      | Correct or remove a false candidate-authored code comment about behaviour the Intent does not mention, verify the repair, and approve when no blockers remain. |
      | Do not edit a false statement in a protected file: submit changes with a blocking finding naming the protected path. |
      | With no unsupported statement and no other defect, approve unchanged without an extra round or edit. |
