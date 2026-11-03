Feature: Bound nonconverging reviewer repairs without losing the candidate
  Scenario: Three identical final failures preserve the last repair
    When the repair progress saved-candidate case "same" runs
    Then the repair progress outcome is:
      """
      {"verdict":"changes","rounds":3,"repairs":3,"verified":3,"candidate":"check:lint|3","checkpoint":true,"errorIncludes":["check:lint","3"]}
      """

  Scenario: A smaller failing set is progress
    When the repair progress saved-candidate case "progress" runs
    Then the repair progress outcome is:
      """
      {"verdict":"approve","rounds":4,"repairs":3,"verified":4,"candidate":"good|4","error":""}
      """

  Scenario: A single failed repair followed by approval is unchanged
    When the repair progress saved-candidate case "once" runs
    Then the repair progress outcome is:
      """
      {"verdict":"approve","rounds":2,"repairs":1,"verified":2,"candidate":"good|2","error":""}
      """

  Scenario: Green reviewer edits approve without a repair round
    When the repair progress saved-candidate case "green" runs
    Then the repair progress outcome is:
      """
      {"verdict":"approve","rounds":1,"repairs":0,"verified":1,"candidate":"good|1","error":""}
      """

  Scenario: Explicit resume reopens the same conversation without forgiving the streak
    When the repair progress saved-candidate case "resume" runs
    Then the repair progress outcome is:
      """
      {"verdict":"changes","rounds":3,"repairs":3,"verified":3,"candidate":"check:lint|3","checkpoint":true,"errorIncludes":["check:lint","3"],"resumeRounds":1,"resumeVerified":2,"conversation":true,"resumeErrorIncludes":["check:lint","4"]}
      """

  Scenario: Changing failures cannot consume unlimited repair rounds
    When the repair progress saved-candidate case "cap" runs
    Then the repair progress outcome is:
      """
      {"verdict":"changes","rounds":20,"repairs":20,"verified":20,"candidate":"check:item19|19","checkpoint":true,"errorIncludes":["check:item19","20"]}
      """
