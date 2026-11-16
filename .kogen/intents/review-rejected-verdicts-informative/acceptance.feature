Feature: Rejected review verdicts are informative
  This feature covers the reviewer's ref rule and the progress line of a refused review verdict.

  Scenario: The requirements rule names what an acceptance ref contains
    Given review-rejected-verdicts-informative: the reviewer texts are read
    Then review-rejected-verdicts-informative: RequirementsRule contains "ref (for test, the test; for acceptance, the scenario's name exactly as written after Scenario: in acceptance.feature, or the text of a step that occurs in that one scenario only, never a driver test or test method name; for probe, the exact shell command; empty for none)"
    And review-rejected-verdicts-informative: RequirementsRule no longer contains "ref (the test or acceptance step, or the exact shell command of the probe; empty for none)"

  Scenario: Every review prompt carries the new requirements rule once
    Given review-rejected-verdicts-informative: the reviewer texts are read
    Then review-rejected-verdicts-informative: the native reviewer instructions contain "ref (for test, the test; for acceptance, the scenario's name exactly as written after Scenario: in acceptance.feature, or the text of a step that occurs in that one scenario only, never a driver test or test method name; for probe, the exact shell command; empty for none)" exactly once
    And review-rejected-verdicts-informative: the external one-session review task contains "ref (for test, the test; for acceptance, the scenario's name exactly as written after Scenario: in acceptance.feature, or the text of a step that occurs in that one scenario only, never a driver test or test method name; for probe, the exact shell command; empty for none)" exactly once
    And review-rejected-verdicts-informative: the external part task contains "ref (for test, the test; for acceptance, the scenario's name exactly as written after Scenario: in acceptance.feature, or the text of a step that occurs in that one scenario only, never a driver test or test method name; for probe, the exact shell command; empty for none)" exactly once

  Scenario: One rejected problem keeps the progress line unchanged
    Given review-rejected-verdicts-informative: the reviewer submits these verdicts, one per round:
      """
      [{"findings": []}, {"findings": []}]
      """
    When review-rejected-verdicts-informative: the external review runs on a saved candidate
    Then review-rejected-verdicts-informative: the rejected-verdict progress lines are exactly 'kogen: review 1: verdict not accepted: submit_review needs verdict (approve or changes) and a findings list; verdict must be approve or changes but was missing' twice

  Scenario: Twelve rejected problems name their total in the progress line
    Given review-rejected-verdicts-informative: the reviewer submits these verdicts, one per round:
      """
      [
        {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "R1", "evidence": "none", "ref": "", "met": false},
          {"requirement": "R2", "evidence": "none", "ref": "", "met": false},
          {"requirement": "R3", "evidence": "none", "ref": "", "met": false},
          {"requirement": "R4", "evidence": "none", "ref": "", "met": false},
          {"requirement": "R5", "evidence": "none", "ref": "", "met": false},
          {"requirement": "R6", "evidence": "none", "ref": "", "met": false},
          {"requirement": "R7", "evidence": "none", "ref": "", "met": false},
          {"requirement": "R8", "evidence": "none", "ref": "", "met": false},
          {"requirement": "R9", "evidence": "none", "ref": "", "met": false},
          {"requirement": "R10", "evidence": "none", "ref": "", "met": false},
          {"requirement": "R11", "evidence": "none", "ref": "", "met": false},
          {"requirement": "R12", "evidence": "none", "ref": "", "met": false}
        ]},
        {"verdict": "approve", "findings": []}
      ]
      """
    When review-rejected-verdicts-informative: the external review runs on a saved candidate
    Then review-rejected-verdicts-informative: the rejected-verdict progress line is exactly 'kogen: review 1: verdict not accepted (first of 12 problems): requirement "R1" has no evidence: probe it with shell against the candidate before the verdict'

  Scenario: An exhausted external rejection shows both verdicts in the progress
    Given review-rejected-verdicts-informative: the reviewer submits these verdicts, one per round:
      """
      [{"verdict":"approve","findings":[],"requirements":[{"requirement":"R1","evidence":"none","ref":"","met":false},{"requirement":"R2","evidence":"none","ref":"","met":false}]}, {"verdict":"approve","findings":[],"requirements":[{"requirement":"R1","evidence":"none","ref":"","met":false},{"requirement":"R2","evidence":"none","ref":"","met":false}]}]
      """
    When review-rejected-verdicts-informative: the external review runs on a saved candidate
    Then review-rejected-verdicts-informative: the rejected-verdict progress lines are exactly 'kogen: review 1: verdict not accepted (first of 2 problems): requirement "R1" has no evidence: probe it with shell against the candidate before the verdict' twice

  Scenario: An exhausted native rejection shows both verdicts in the progress
    Given review-rejected-verdicts-informative: the reviewer submits these verdicts, one per round:
      """
      [{"verdict":"approve","findings":[],"requirements":[{"requirement":"R1","evidence":"none","ref":"","met":false},{"requirement":"R2","evidence":"none","ref":"","met":false}]}, {"verdict":"approve","findings":[],"requirements":[{"requirement":"R1","evidence":"none","ref":"","met":false},{"requirement":"R2","evidence":"none","ref":"","met":false}]}]
      """
    When review-rejected-verdicts-informative: the native review runs on a saved candidate
    Then review-rejected-verdicts-informative: the rejected-verdict progress lines are exactly 'kogen: review 1: verdict not accepted (first of 2 problems): requirement "R1" has no evidence: probe it with shell against the candidate before the verdict' twice
