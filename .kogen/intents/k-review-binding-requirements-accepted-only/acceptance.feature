Feature: Only an accepted submission's requirements bind the later approvals of a review
  The scripted reviewer reviews a saved candidate whose tool prints a total, given a green pass
  whose acceptance scenario "Print the total of two numbers" passed. A refused submission lists
  nothing: a later approval may reword, split, merge or omit its requirements. An accepted
  submission's requirements stay binding: a later approval that drops one is refused naming it.
  A reviewer's edit that breaks the total is verified red, which sends its accepted approval back
  for another round.

  Scenario: A repair that splits a refused submission's requirement is accepted
    Given k-review-binding-requirements-accepted-only: the scripted reviewer answers in order:
      """
      [[{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "R1", "evidence": "acceptance", "ref": "Print the receipt of a total", "met": true}]}}],
       [{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "R1a", "evidence": "acceptance", "ref": "Print the total of two numbers", "met": true},
          {"requirement": "R1b", "evidence": "test", "ref": "total_test.sh", "met": true}]}}]]
      """
    When k-review-binding-requirements-accepted-only: the native reviewer reviews the saved total candidate
    Then k-review-binding-requirements-accepted-only: the review made 2 model requests
    And k-review-binding-requirements-accepted-only: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirement "R1" cites acceptance "Print the receipt of a total", which names no scenario of the acceptance result: name the scenario that exercises the requirement, or cite a probe you ran with shell on the current tree that exercises the requirement, or, when nothing can verify it here, submit changes with a blocking finding that quotes the requirement and says its verification could not run
      """
    And k-review-binding-requirements-accepted-only: the review ends with the verdict "approve" and the stop "none"
    And k-review-binding-requirements-accepted-only: the review record keeps the requirements:
      """
      [{"requirement": "R1a", "evidence": "acceptance", "ref": "Print the total of two numbers", "met": true},
       {"requirement": "R1b", "evidence": "test", "ref": "total_test.sh", "met": true}]
      """
    And k-review-binding-requirements-accepted-only: the review's last checkpoint lists the requirements:
      """
      ["R1a", "R1b"]
      """

  Scenario: A repair that omits requirements after a refused submission is accepted
    Given k-review-binding-requirements-accepted-only: the scripted reviewer answers in order:
      """
      [[{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "R1", "evidence": "acceptance", "ref": "Print the receipt of a total", "met": true}]}}],
       [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]]
      """
    When k-review-binding-requirements-accepted-only: the native reviewer reviews the saved total candidate
    Then k-review-binding-requirements-accepted-only: the review made 2 model requests
    And k-review-binding-requirements-accepted-only: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirement "R1" cites acceptance "Print the receipt of a total", which names no scenario of the acceptance result: name the scenario that exercises the requirement, or cite a probe you ran with shell on the current tree that exercises the requirement, or, when nothing can verify it here, submit changes with a blocking finding that quotes the requirement and says its verification could not run
      """
    And k-review-binding-requirements-accepted-only: the review ends with the verdict "approve" and the stop "none"
    And k-review-binding-requirements-accepted-only: the review record keeps the requirements:
      """
      []
      """
    And k-review-binding-requirements-accepted-only: the review's last checkpoint lists the requirements:
      """
      []
      """

  Scenario: An approval that drops an accepted submission's requirement is refused, and restoring it is accepted
    Given k-review-binding-requirements-accepted-only: the scripted reviewer answers in order:
      """
      [[{"name": "shell", "args": {"command": "echo 'echo $(($1 - $2))' > total.sh"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "R1", "evidence": "test", "ref": "total_test.sh", "met": true},
          {"requirement": "R2", "evidence": "test", "ref": "total_test.sh", "met": true},
          {"requirement": "R3", "evidence": "test", "ref": "total_test.sh", "met": true}]}}],
       [{"name": "shell", "args": {"command": "echo 'echo $(($1 + $2))' > total.sh"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "R1", "evidence": "test", "ref": "total_test.sh", "met": true},
          {"requirement": "R2", "evidence": "test", "ref": "total_test.sh", "met": true}]}}],
       [{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "R1", "evidence": "test", "ref": "total_test.sh", "met": true},
          {"requirement": "R2", "evidence": "test", "ref": "total_test.sh", "met": true},
          {"requirement": "R3", "evidence": "test", "ref": "total_test.sh", "met": true}]}}]]
      """
    When k-review-binding-requirements-accepted-only: the native reviewer reviews the saved total candidate
    Then k-review-binding-requirements-accepted-only: the review made 3 model requests
    And k-review-binding-requirements-accepted-only: request 2 follows a red verification of the reviewer's edit
    And k-review-binding-requirements-accepted-only: the last input of request 3 is the tool result:
      """
      invalid verdict:
      requirement "R3" was listed by an earlier submission of this review and is missing: keep every requirement in requirements, with evidence observed on the current tree
      """
    And k-review-binding-requirements-accepted-only: the reviewer's edits were verified "red, green"
    And k-review-binding-requirements-accepted-only: the review ends with the verdict "approve" and the stop "none"
    And k-review-binding-requirements-accepted-only: the review record keeps the requirements:
      """
      [{"requirement": "R1", "evidence": "test", "ref": "total_test.sh", "met": true},
       {"requirement": "R2", "evidence": "test", "ref": "total_test.sh", "met": true},
       {"requirement": "R3", "evidence": "test", "ref": "total_test.sh", "met": true}]
      """
    And k-review-binding-requirements-accepted-only: the review's last checkpoint lists the requirements:
      """
      ["R1", "R2", "R3"]
      """

  Scenario: Dropping an accepted submission's requirement twice ends the review as invalid
    Given k-review-binding-requirements-accepted-only: the scripted reviewer answers in order:
      """
      [[{"name": "shell", "args": {"command": "echo 'echo $(($1 - $2))' > total.sh"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "R1", "evidence": "test", "ref": "total_test.sh", "met": true},
          {"requirement": "R2", "evidence": "test", "ref": "total_test.sh", "met": true},
          {"requirement": "R3", "evidence": "test", "ref": "total_test.sh", "met": true}]}}],
       [{"name": "shell", "args": {"command": "echo 'echo $(($1 + $2))' > total.sh"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "R1", "evidence": "test", "ref": "total_test.sh", "met": true},
          {"requirement": "R2", "evidence": "test", "ref": "total_test.sh", "met": true}]}}],
       [{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "R1", "evidence": "test", "ref": "total_test.sh", "met": true},
          {"requirement": "R2", "evidence": "test", "ref": "total_test.sh", "met": true}]}}]]
      """
    When k-review-binding-requirements-accepted-only: the native reviewer reviews the saved total candidate
    Then k-review-binding-requirements-accepted-only: the review made 3 model requests
    And k-review-binding-requirements-accepted-only: request 2 follows a red verification of the reviewer's edit
    And k-review-binding-requirements-accepted-only: the last input of request 3 is the tool result:
      """
      invalid verdict:
      requirement "R3" was listed by an earlier submission of this review and is missing: keep every requirement in requirements, with evidence observed on the current tree
      """
    And k-review-binding-requirements-accepted-only: the review ends invalid with the problems:
      """
      ["requirement \"R3\" was listed by an earlier submission of this review and is missing: keep every requirement in requirements, with evidence observed on the current tree"]
      """
    And k-review-binding-requirements-accepted-only: the review's last checkpoint lists the requirements:
      """
      ["R1", "R2", "R3"]
      """

  Scenario: A respelled requirement of an accepted submission keeps its first accepted spelling
    Given k-review-binding-requirements-accepted-only: the scripted reviewer answers in order:
      """
      [[{"name": "shell", "args": {"command": "echo 'echo $(($1 - $2))' > total.sh"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "R1", "evidence": "test", "ref": "total_test.sh", "met": true}]}}],
       [{"name": "shell", "args": {"command": "echo 'echo $(($1 + $2))' > total.sh"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "  r1 ", "evidence": "test", "ref": "total_test.sh", "met": true}]}}]]
      """
    When k-review-binding-requirements-accepted-only: the native reviewer reviews the saved total candidate
    Then k-review-binding-requirements-accepted-only: the review made 2 model requests
    And k-review-binding-requirements-accepted-only: request 2 follows a red verification of the reviewer's edit
    And k-review-binding-requirements-accepted-only: the reviewer's edits were verified "red, green"
    And k-review-binding-requirements-accepted-only: the review ends with the verdict "approve" and the stop "none"
    And k-review-binding-requirements-accepted-only: the review record keeps the requirements:
      """
      [{"requirement": "R1", "evidence": "test", "ref": "total_test.sh", "met": true}]
      """
    And k-review-binding-requirements-accepted-only: the review's last checkpoint lists the requirements:
      """
      ["R1"]
      """

  Scenario: A malformed requirements list is refused as before
    Given k-review-binding-requirements-accepted-only: the scripted reviewer answers in order:
      """
      [[{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": "R1"}}],
       [{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "", "evidence": "test", "ref": "total_test.sh", "met": true}]}}]]
      """
    When k-review-binding-requirements-accepted-only: the native reviewer reviews the saved total candidate
    Then k-review-binding-requirements-accepted-only: the review made 2 model requests
    And k-review-binding-requirements-accepted-only: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirements must be a JSON array of objects with requirement (a non-empty string), evidence (test, acceptance, probe or none), ref (a string, non-empty unless evidence is none) and met (a boolean)
      """
    And k-review-binding-requirements-accepted-only: the review ends invalid with the problems:
      """
      ["requirements must be a JSON array of objects with requirement (a non-empty string), evidence (test, acceptance, probe or none), ref (a string, non-empty unless evidence is none) and met (a boolean)"]
      """
    And k-review-binding-requirements-accepted-only: the review's last checkpoint lists the requirements:
      """
      []
      """

  Scenario: A requirement listed twice with differing evidence is refused as before and does not bind
    Given k-review-binding-requirements-accepted-only: the scripted reviewer answers in order:
      """
      [[{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "R1", "evidence": "test", "ref": "total_test.sh", "met": true},
          {"requirement": "r1", "evidence": "acceptance", "ref": "Print the total of two numbers", "met": true}]}}],
       [{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "R2", "evidence": "test", "ref": "total_test.sh", "met": true}]}}]]
      """
    When k-review-binding-requirements-accepted-only: the native reviewer reviews the saved total candidate
    Then k-review-binding-requirements-accepted-only: the review made 2 model requests
    And k-review-binding-requirements-accepted-only: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirement "R1" is listed twice: list each requirement once in requirements, with one evidence, ref and met
      """
    And k-review-binding-requirements-accepted-only: the review ends with the verdict "approve" and the stop "none"
    And k-review-binding-requirements-accepted-only: the review record keeps the requirements:
      """
      [{"requirement": "R2", "evidence": "test", "ref": "total_test.sh", "met": true}]
      """
    And k-review-binding-requirements-accepted-only: the review's last checkpoint lists the requirements:
      """
      ["R2"]
      """

  Scenario: A cited probe must still have run, and the accepted spelling is the stored one
    Given k-review-binding-requirements-accepted-only: the scripted reviewer answers in order:
      """
      [[{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "R1", "evidence": "probe", "ref": "sh total.sh 2 3", "met": true}]}}],
       [{"name": "shell", "args": {"command": "sh total.sh 2 3"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "r1", "evidence": "probe", "ref": "sh total.sh 2 3", "met": true}]}}]]
      """
    When k-review-binding-requirements-accepted-only: the native reviewer reviews the saved total candidate
    Then k-review-binding-requirements-accepted-only: the review made 2 model requests
    And k-review-binding-requirements-accepted-only: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirement "R1" cites a probe that did not run in this review: run its command with shell before citing it
      """
    And k-review-binding-requirements-accepted-only: the review ends with the verdict "approve" and the stop "none"
    And k-review-binding-requirements-accepted-only: the review record keeps the requirements:
      """
      [{"requirement": "r1", "evidence": "probe", "ref": "sh total.sh 2 3", "met": true}]
      """
    And k-review-binding-requirements-accepted-only: the review's last checkpoint lists the requirements:
      """
      ["r1"]
      """
