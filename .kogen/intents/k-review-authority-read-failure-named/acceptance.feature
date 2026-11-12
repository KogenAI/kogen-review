Feature: Review authority names unreadable model and README
  This feature checks the authority text of a review built from a fixture checkout with an Intent feature, a model file and a protected README.

  Background:
    Given k-review-authority-read-failure-named: a fixture Intent with a feature, a model file and a protected README

  Scenario: Everything readable
    When k-review-authority-read-failure-named: the review authority is built with the model file readable and the README readable
    Then k-review-authority-read-failure-named: the authority contains "# acceptance.feature\n\nFeature: test\n\n\n# model.qnt\n\nMODEL\n\n\n# Project instructions (README.md)\n\nREADME body\n\n\n"
    And k-review-authority-read-failure-named: the authority does not contain "could not be read"

  Scenario: Model file absent
    When k-review-authority-read-failure-named: the review authority is built with the model file absent and the README readable
    Then k-review-authority-read-failure-named: the authority contains "# acceptance.feature\n\nFeature: test\n\n\n# Project instructions (README.md)\n\nREADME body\n\n\n"
    And k-review-authority-read-failure-named: the authority does not contain "could not be read"

  Scenario: Model file unreadable
    When k-review-authority-read-failure-named: the review authority is built with the model file unreadable and the README readable
    Then k-review-authority-read-failure-named: the authority contains ".kogen/intents/test/model.qnt exists but could not be read"
    And k-review-authority-read-failure-named: the authority contains "is a directory"
    And k-review-authority-read-failure-named: the authority contains "README body\n"

  Scenario: Protected README unreadable
    When k-review-authority-read-failure-named: the review authority is built with the model file readable and the README unreadable
    Then k-review-authority-read-failure-named: the authority contains "README.md exists but could not be read"
    And k-review-authority-read-failure-named: the authority contains "is a directory"
    And k-review-authority-read-failure-named: the authority does not contain "(no README.md)"

  Scenario: README absent
    When k-review-authority-read-failure-named: the review authority is built with the model file readable and the README absent
    Then k-review-authority-read-failure-named: the authority contains "# Project instructions (README.md)\n\n(no README.md)\n"
    And k-review-authority-read-failure-named: the authority does not contain "could not be read"
