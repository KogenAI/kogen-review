Feature: A review identifies a requirement by its text without case or whitespace differences
  The scripted reviewer reviews a saved candidate whose tool prints a total. A requirement's
  identity is its text with leading and trailing whitespace dropped, each run of whitespace as one
  space and letter case ignored. The text first listed in the review is the one stored and shown.
  Requirements that differ in words stay different.

  Scenario: A later approval may respell a listed requirement, and the first spelling is stored
    Given k-review-requirement-identity-normalized: the scripted reviewer answers in order:
      """
      [[{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "The tool prints a total", "evidence": "none", "ref": "", "met": false}]}}],
       [{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "  the TOOL prints   a total ", "evidence": "test", "ref": "total_test.sh", "met": true}]}}]]
      """
    When k-review-requirement-identity-normalized: the native reviewer reviews the saved total candidate
    Then k-review-requirement-identity-normalized: the review made 2 model requests
    And k-review-requirement-identity-normalized: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirement "The tool prints a total" has no evidence: probe it with shell against the candidate before the verdict
      """
    And k-review-requirement-identity-normalized: the review ends with the verdict "approve" and the stop "none"
    And k-review-requirement-identity-normalized: the review record keeps the requirements:
      """
      [{"requirement": "The tool prints a total", "evidence": "test", "ref": "total_test.sh", "met": true}]
      """

  Scenario: An approval that omits a listed requirement still reports it missing, once
    Given k-review-requirement-identity-normalized: the scripted reviewer answers in order:
      """
      [[{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "The tool prints a total", "evidence": "none", "ref": "", "met": false},
          {"requirement": "the tool prints a total", "evidence": "none", "ref": "", "met": false}]}}],
       [{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": []}}]]
      """
    When k-review-requirement-identity-normalized: the native reviewer reviews the saved total candidate
    Then k-review-requirement-identity-normalized: the review made 2 model requests
    And k-review-requirement-identity-normalized: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirement "The tool prints a total" has no evidence: probe it with shell against the candidate before the verdict
      """
    And k-review-requirement-identity-normalized: the review ends invalid with the problems:
      """
      ["requirement \"The tool prints a total\" was listed by an earlier submission of this review and is missing: keep every requirement in requirements, with evidence observed on the current tree"]
      """

  Scenario: One submission listing a requirement twice with different met values is refused
    Given k-review-requirement-identity-normalized: the scripted reviewer answers in order:
      """
      [[{"name": "submit_review", "args": {"verdict": "changes", "findings": [
          {"path": "total.sh", "line": 1, "severity": "blocking", "message": "The tool prints a total only for two arguments"}], "requirements": [
          {"requirement": "The tool prints a total", "evidence": "test", "ref": "total_test.sh", "met": true},
          {"requirement": "The tool prints a total", "evidence": "test", "ref": "total_test.sh", "met": false}]}}],
       [{"name": "submit_review", "args": {"verdict": "changes", "findings": [
          {"path": "total.sh", "line": 1, "severity": "blocking", "message": "The tool prints a total only for two arguments"}], "requirements": [
          {"requirement": "The tool prints a total", "evidence": "test", "ref": "total_test.sh", "met": false}]}}]]
      """
    When k-review-requirement-identity-normalized: the native reviewer reviews the saved total candidate
    Then k-review-requirement-identity-normalized: the review made 2 model requests
    And k-review-requirement-identity-normalized: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirement "The tool prints a total" is listed twice: list each requirement once in requirements, with one evidence, ref and met
      """
    And k-review-requirement-identity-normalized: the review ends with the verdict "changes" and the stop "candidate/review_blocked"
    And k-review-requirement-identity-normalized: the review record keeps the requirements:
      """
      [{"requirement": "The tool prints a total", "evidence": "test", "ref": "total_test.sh", "met": false}]
      """

  Scenario: One submission listing a requirement twice with the same evidence, ref and met is kept once
    Given k-review-requirement-identity-normalized: the scripted reviewer answers in order:
      """
      [[{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "The tool prints a total", "evidence": "test", "ref": "total_test.sh", "met": true},
          {"requirement": "the tool prints a total", "evidence": "test", "ref": "total_test.sh", "met": true}]}}]]
      """
    When k-review-requirement-identity-normalized: the native reviewer reviews the saved total candidate
    Then k-review-requirement-identity-normalized: the review made 1 model request
    And k-review-requirement-identity-normalized: the review ends with the verdict "approve" and the stop "none"
    And k-review-requirement-identity-normalized: the review record keeps the requirements:
      """
      [{"requirement": "The tool prints a total", "evidence": "test", "ref": "total_test.sh", "met": true}]
      """

  Scenario: Requirements that differ in words stay two requirements in one approval
    Given k-review-requirement-identity-normalized: the scripted reviewer answers in order:
      """
      [[{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "prints a total", "evidence": "test", "ref": "total_test.sh", "met": true},
          {"requirement": "prints a total in bytes", "evidence": "test", "ref": "total_test.sh", "met": true},
          {"requirement": "Prints a total", "evidence": "test", "ref": "total_test.sh", "met": true}]}}]]
      """
    When k-review-requirement-identity-normalized: the native reviewer reviews the saved total candidate
    Then k-review-requirement-identity-normalized: the review made 1 model request
    And k-review-requirement-identity-normalized: the review ends with the verdict "approve" and the stop "none"
    And k-review-requirement-identity-normalized: the review record keeps the requirements:
      """
      [{"requirement": "prints a total", "evidence": "test", "ref": "total_test.sh", "met": true},
       {"requirement": "prints a total in bytes", "evidence": "test", "ref": "total_test.sh", "met": true}]
      """

  Scenario: A listed requirement that differs in words is still missing when only the shorter one is kept
    Given k-review-requirement-identity-normalized: the scripted reviewer answers in order:
      """
      [[{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "prints a total", "evidence": "test", "ref": "total_test.sh", "met": true},
          {"requirement": "prints a total in bytes", "evidence": "none", "ref": "", "met": false}]}}],
       [{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "Prints  a total", "evidence": "test", "ref": "total_test.sh", "met": true}]}}]]
      """
    When k-review-requirement-identity-normalized: the native reviewer reviews the saved total candidate
    Then k-review-requirement-identity-normalized: the review made 2 model requests
    And k-review-requirement-identity-normalized: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirement "prints a total in bytes" has no evidence: probe it with shell against the candidate before the verdict
      """
    And k-review-requirement-identity-normalized: the review ends invalid with the problems:
      """
      ["requirement \"prints a total in bytes\" was listed by an earlier submission of this review and is missing: keep every requirement in requirements, with evidence observed on the current tree"]
      """

  Scenario: A changes verdict's blocking finding quotes an unmet requirement under the same identity
    Given k-review-requirement-identity-normalized: the scripted reviewer answers in order:
      """
      [[{"name": "submit_review", "args": {"verdict": "changes", "findings": [
          {"path": "total.sh", "line": 1, "severity": "blocking", "message": "the tool prints nothing for sh total.sh 1"}], "requirements": [
          {"requirement": "The tool prints a total", "evidence": "test", "ref": "total_test.sh", "met": false}]}}],
       [{"name": "submit_review", "args": {"verdict": "changes", "findings": [
          {"path": "total.sh", "line": 1, "severity": "blocking", "message": "sh total.sh 1 prints nothing, so THE TOOL prints  a total only for two arguments"}], "requirements": [
          {"requirement": "The tool prints a total", "evidence": "test", "ref": "total_test.sh", "met": false}]}}]]
      """
    When k-review-requirement-identity-normalized: the native reviewer reviews the saved total candidate
    Then k-review-requirement-identity-normalized: the review made 2 model requests
    And k-review-requirement-identity-normalized: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirement "The tool prints a total" is not met: a changes verdict needs a blocking finding whose message quotes it
      """
    And k-review-requirement-identity-normalized: the review ends with the verdict "changes" and the stop "candidate/review_blocked"
    And k-review-requirement-identity-normalized: the review record keeps the requirements:
      """
      [{"requirement": "The tool prints a total", "evidence": "test", "ref": "total_test.sh", "met": false}]
      """
