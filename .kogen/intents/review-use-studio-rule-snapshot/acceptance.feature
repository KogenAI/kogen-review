Feature: Review applies the scoped Studio rule snapshot

  This feature runs scripted native reviews through the contract suite's scripted Env, a real
  temporary Git candidate and a loopback fake Studio endpoint that requires a synthetic bearer
  token. No provider or model is called.

  Scenario: A project without Studio rules reviews as before
    When review-use-studio-rule-snapshot: the scripted reviews are run
    Then review-use-studio-rule-snapshot: case unconfigured reports requests equal to 1
    And review-use-studio-rule-snapshot: case unconfigured reports studio_requests equal to 0
    And review-use-studio-rule-snapshot: case unconfigured reports mentions_rules equal to false

  Scenario: The model request carries the exact applied rules and the finding links one
    When review-use-studio-rule-snapshot: the scripted reviews are run
    Then review-use-studio-rule-snapshot: case applied reports has_rule equal to true
    And review-use-studio-rule-snapshot: case applied reports origin_live equal to true
    And review-use-studio-rule-snapshot: case applied reports hash_matches equal to true
    And review-use-studio-rule-snapshot: case applied reports token_leaked equal to false
    And review-use-studio-rule-snapshot: case applied reports finding_rule equal to r-1@2

  Scenario: A changed revision reaches the next review
    When review-use-studio-rule-snapshot: the scripted reviews are run
    Then review-use-studio-rule-snapshot: case changed reports has_new equal to true
    And review-use-studio-rule-snapshot: case changed reports has_old equal to false

  Scenario: An outage reports the cached revision
    When review-use-studio-rule-snapshot: the scripted reviews are run
    Then review-use-studio-rule-snapshot: case outage reports origin_cached equal to true
    And review-use-studio-rule-snapshot: case outage reports fallback equal to true
    And review-use-studio-rule-snapshot: case outage reports has_rule equal to true
    And review-use-studio-rule-snapshot: case outage reports hash_matches equal to true

  Scenario: A revoked token is refused and the cache is not used
    When review-use-studio-rule-snapshot: the scripted reviews are run
    Then review-use-studio-rule-snapshot: case revoked reports error equal to "rules/refused: http_401"
    And review-use-studio-rule-snapshot: case revoked reports requests equal to 0

  Scenario: A foreign scope never reuses another scope's cache
    When review-use-studio-rule-snapshot: the scripted reviews are run
    Then review-use-studio-rule-snapshot: case foreign reports error equal to "rules/hold: http_503"
    And review-use-studio-rule-snapshot: case foreign reports requests equal to 0

  Scenario: An outage without any cache is named
    When review-use-studio-rule-snapshot: the scripted reviews are run
    Then review-use-studio-rule-snapshot: case uncached reports error equal to "rules/unavailable: http_503"
    And review-use-studio-rule-snapshot: case uncached reports requests equal to 0

  Scenario: A finding that names an unapplied rule is rejected
    When review-use-studio-rule-snapshot: the scripted reviews are run
    Then review-use-studio-rule-snapshot: case unlinked reports feedback_names_problem equal to true
    And review-use-studio-rule-snapshot: case unlinked reports requests equal to 2

  Scenario: A resumed review keeps its snapshot without asking Studio again
    When review-use-studio-rule-snapshot: the scripted reviews are run
    Then review-use-studio-rule-snapshot: case resumed reports session_retains equal to true
    And review-use-studio-rule-snapshot: case resumed reports studio_requests equal to 0
    And review-use-studio-rule-snapshot: case resumed reports finding_rule equal to r-1@2
