Feature: kogen-review's fixtures and code no longer set the removed models role round cap

  Scenario: The whole suite passes against the coordinator candidate that rejects the removed key
    When k-review-config-no-max-rounds: I run the whole Go suite against kogen-coordinator "v0.0.0-20261104042648-ce1e6baa2d77"
    Then k-review-config-no-max-rounds: the suite used kogen-coordinator "v0.0.0-20261104042648-ce1e6baa2d77" and passed
    And k-review-config-no-max-rounds: these tests passed exactly once:
      | package                    | test                                    |
      | consumes/kogen-coordinator | TestLoadConfigReadsTheCommands          |
      | consumes/kogen-coordinator | TestRoleKeepsTheCheckpointBytes         |
      | consumes/kogen-coordinator | TestLoadConfigRefusals                  |
      | consumes/kogen-executor    | TestProviderRole                        |
      | consumes/kogen-executor    | TestExecutorValueJSONKeys               |
      | consumes/kogen-executor    | TestExecutorStartRoundAndClose          |
      | contract                   | TestExternalReviewApprovesInItsOwnSession |

  Scenario: The whole suite passes against kogen-coordinator main
    When k-review-config-no-max-rounds: I run the whole Go suite against kogen-coordinator "v0.0.0-20261104081556-2a74649374bb"
    Then k-review-config-no-max-rounds: the suite used kogen-coordinator "v0.0.0-20261104081556-2a74649374bb" and passed
    And k-review-config-no-max-rounds: these tests passed exactly once:
      | package                    | test                                    |
      | consumes/kogen-coordinator | TestLoadConfigReadsTheCommands          |
      | consumes/kogen-coordinator | TestRoleKeepsTheCheckpointBytes         |
      | consumes/kogen-executor    | TestProviderRole                        |
      | consumes/kogen-executor    | TestExecutorValueJSONKeys               |
      | contract                   | TestExternalReviewApprovesInItsOwnSession |

  Scenario: No fixture or code of kogen-review sets the removed key
    Then k-review-config-no-max-rounds: no non-doc file outside .git and .kogen names the removed models key
    And k-review-config-no-max-rounds: no Go file sets MaxRounds in a project.Role literal
    And k-review-config-no-max-rounds: the coordinator fixture configuration ends with:
      """
      models:
        review:
          executor: claude-code
          model: claude-opus-5-5
          effort: high
      """
    And k-review-config-no-max-rounds: go.mod still requires "github.com/KogenAI/kogen-coordinator v0.0.0-20261103113131-ffca7072fe15"
