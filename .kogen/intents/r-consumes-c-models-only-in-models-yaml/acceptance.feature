Feature: kogen-review follows kogen-coordinator's models-only-in-models-yaml contract

  Scenario: go.mod pins kogen-coordinator at its new main
    When r-consumes-c-models-only-in-models-yaml: I read the module file
    Then r-consumes-c-models-only-in-models-yaml: the module requires exactly:
      | path                                  | version                            |
      | github.com/KogenAI/kogen-coordinator  | v0.0.0-20261106110407-d74daae36f56 |
      | github.com/KogenAI/kogen-executor     | v0.0.0-20261104084012-b2ffb64382e8 |
      | github.com/KogenAI/kogen-loop         | v0.0.0-20261104063532-dea3eb375dba |
      | github.com/KogenAI/kogen-verification | v0.0.0-20261104081401-7805cfe30d6c |
    And r-consumes-c-models-only-in-models-yaml: the module has no replace directive
    And r-consumes-c-models-only-in-models-yaml: the checkout has no go.work file
    And r-consumes-c-models-only-in-models-yaml: go.sum contains the lines:
      """
      github.com/KogenAI/kogen-coordinator v0.0.0-20261106110407-d74daae36f56 h1:8VmqsU9EArCYwqOTw8e9uuS54nRSlUHSUaDl8W+lYqs=
      github.com/KogenAI/kogen-coordinator v0.0.0-20261106110407-d74daae36f56/go.mod h1:MMc15p3YwlY71dMxfCdX6QlR2jXJbSxL6YA9Y7971c8=
      """
    And r-consumes-c-models-only-in-models-yaml: go.sum has no line for "github.com/KogenAI/kogen-coordinator" at "v0.0.0-20261104083402-f4bd4aebd8c2"
    And r-consumes-c-models-only-in-models-yaml: the module is tidy

  Scenario: The reported consumer tests pass against the new main, with the review role read from .kogen/models.yaml
    When r-consumes-c-models-only-in-models-yaml: I read the module file
    Then r-consumes-c-models-only-in-models-yaml: the module requires "github.com/KogenAI/kogen-coordinator" at "v0.0.0-20261106110407-d74daae36f56"
    When r-consumes-c-models-only-in-models-yaml: I run the Go tests "^(TestLoadConfigReadsTheCommands|TestRoleKeepsTheCheckpointBytes)$" in "./consumes/kogen-coordinator/"
    Then r-consumes-c-models-only-in-models-yaml: the run passed with each of these tests passing exactly once:
      | test                            |
      | TestLoadConfigReadsTheCommands  |
      | TestRoleKeepsTheCheckpointBytes |
    And r-consumes-c-models-only-in-models-yaml: the function "TestRoleKeepsTheCheckpointBytes" in "consumes/kogen-coordinator/project_test.go" still has the lines:
      """
      eq(t, "project.Role.Model", review.Model, "claude-opus-5-5")
      eq(t, "project.Role.Effort", review.Effort, "high")
      eq(t, "project.Role.Provider", review.Provider, "")
      eq(t, "project.Role.BaseURL", review.BaseURL, "")
      """

  Scenario: The consumes README says where the review role is read from
    When r-consumes-c-models-only-in-models-yaml: I read "consumes/kogen-coordinator/README.md"
    Then r-consumes-c-models-only-in-models-yaml: the file contains the text:
      """
      `Role`'s checkpoint JSON bytes and fields, and the review role `LoadConfig` takes from a `.kogen/models.yaml` (the `.kogen/project.yaml` holds no `models` key);
      """
