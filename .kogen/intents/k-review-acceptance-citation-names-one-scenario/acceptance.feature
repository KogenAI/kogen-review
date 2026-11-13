Feature: An acceptance citation identifies one scenario
  A requirement's acceptance reference cites a scenario only when it contains the scenario's full
  name or step text that occurs in exactly one scenario of the acceptance result. A reference
  matching only step text shared by several scenarios is refused as ambiguous, naming them. The
  scripted reviewer approves citing a reference as acceptance evidence; a refused approval is
  followed by an approval without requirements.

  Scenario: A shared step text alone is ambiguous
    Given k-review-acceptance-citation-names-one-scenario: the acceptance result has the scenarios:
      """
      [{"name": "Add two numbers", "status": "passed", "steps": ["a calculator"]},
       {"name": "Add two numbers with a carry", "status": "passed", "steps": ["a calculator"]}]
      """
    And k-review-acceptance-citation-names-one-scenario: the reviewer approves citing acceptance "Given a calculator"
    When k-review-acceptance-citation-names-one-scenario: the native reviewer reviews the saved candidate
    Then k-review-acceptance-citation-names-one-scenario: the first approval was refused with the problem:
      """
      invalid verdict:
      requirement "R1" cites acceptance "Given a calculator", which is ambiguous: it matches steps of several scenarios and names none of them ("Add two numbers", "Add two numbers with a carry"): name the scenario that exercises the requirement, or cite a probe you ran with shell on the current tree that exercises the requirement, or, when nothing can verify it here, submit changes with a blocking finding that quotes the requirement and says its verification could not run
      """

  Scenario: The longer full name cites only the longer scenario
    Given k-review-acceptance-citation-names-one-scenario: the acceptance result has the scenarios:
      """
      [{"name": "Add two numbers", "status": "failed", "steps": ["a calculator"]},
       {"name": "Add two numbers with a carry", "status": "passed", "steps": ["a calculator"]}]
      """
    And k-review-acceptance-citation-names-one-scenario: the reviewer approves citing acceptance "Add two numbers with a carry"
    When k-review-acceptance-citation-names-one-scenario: the native reviewer reviews the saved candidate
    Then k-review-acceptance-citation-names-one-scenario: the first approval was accepted

  Scenario: The shorter full name cites only the shorter scenario
    Given k-review-acceptance-citation-names-one-scenario: the acceptance result has the scenarios:
      """
      [{"name": "Add two numbers", "status": "passed", "steps": ["a calculator"]},
       {"name": "Add two numbers with a carry", "status": "failed", "steps": ["a calculator"]}]
      """
    And k-review-acceptance-citation-names-one-scenario: the reviewer approves citing acceptance "Add two numbers"
    When k-review-acceptance-citation-names-one-scenario: the native reviewer reviews the saved candidate
    Then k-review-acceptance-citation-names-one-scenario: the first approval was accepted

  Scenario: A step text of one passed scenario is accepted
    Given k-review-acceptance-citation-names-one-scenario: the acceptance result has the scenarios:
      """
      [{"name": "Add two numbers", "status": "passed", "steps": ["a calculator", "the sum is 5"]},
       {"name": "Add two numbers with a carry", "status": "passed", "steps": ["a calculator", "the sum is 15"]}]
      """
    And k-review-acceptance-citation-names-one-scenario: the reviewer approves citing acceptance "the sum is 15"
    When k-review-acceptance-citation-names-one-scenario: the native reviewer reviews the saved candidate
    Then k-review-acceptance-citation-names-one-scenario: the first approval was accepted

  Scenario: A step text of one failed scenario is refused
    Given k-review-acceptance-citation-names-one-scenario: the acceptance result has the scenarios:
      """
      [{"name": "Add two numbers", "status": "passed", "steps": ["a calculator", "the sum is 5"]},
       {"name": "Add two numbers with a carry", "status": "failed", "steps": ["a calculator", "the sum is 15"]}]
      """
    And k-review-acceptance-citation-names-one-scenario: the reviewer approves citing acceptance "the sum is 15"
    When k-review-acceptance-citation-names-one-scenario: the native reviewer reviews the saved candidate
    Then k-review-acceptance-citation-names-one-scenario: the first approval was refused with a problem containing "cites acceptance scenario \"Add two numbers with a carry\", which failed on the current tree"

  Scenario: A shared step plus one full name is judged on that scenario
    Given k-review-acceptance-citation-names-one-scenario: the acceptance result has the scenarios:
      """
      [{"name": "Subtract", "status": "failed", "steps": ["a calculator"]},
       {"name": "Multiply", "status": "passed", "steps": ["a calculator"]}]
      """
    And k-review-acceptance-citation-names-one-scenario: the reviewer approves citing acceptance "a calculator in Multiply"
    When k-review-acceptance-citation-names-one-scenario: the native reviewer reviews the saved candidate
    Then k-review-acceptance-citation-names-one-scenario: the first approval was accepted

  Scenario: Acceptance that did not run is refused
    Given k-review-acceptance-citation-names-one-scenario: the acceptance result did not run
    And k-review-acceptance-citation-names-one-scenario: the reviewer approves citing acceptance "Multiply"
    When k-review-acceptance-citation-names-one-scenario: the native reviewer reviews the saved candidate
    Then k-review-acceptance-citation-names-one-scenario: the first approval was refused with a problem containing "which did not run on the current tree (not_run)"

  Scenario: An acceptance result of an earlier tree is refused
    Given k-review-acceptance-citation-names-one-scenario: the acceptance result has the scenarios:
      """
      [{"name": "Multiply", "status": "passed", "steps": ["a calculator"]}]
      """
    And k-review-acceptance-citation-names-one-scenario: the acceptance result is of an earlier tree
    And k-review-acceptance-citation-names-one-scenario: the reviewer approves citing acceptance "Multiply"
    When k-review-acceptance-citation-names-one-scenario: the native reviewer reviews the saved candidate
    Then k-review-acceptance-citation-names-one-scenario: the first approval was refused with a problem containing "not of the current tree"
