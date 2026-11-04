Feature: Require kogen-loop by its canonical module path

  Scenario: go.mod requires the canonical kogen-loop and the component mains with no replace
    When k-review-loop-module-path: I read the module file
    Then k-review-loop-module-path: the module requires exactly:
      | path                                    | version                            |
      | github.com/KogenAI/kogen-coordinator    | v0.0.0-20261104083402-f4bd4aebd8c2 |
      | github.com/KogenAI/kogen-executor       | v0.0.0-20261104084012-b2ffb64382e8 |
      | github.com/KogenAI/kogen-loop           | v0.0.0-20261104063532-dea3eb375dba |
      | github.com/KogenAI/kogen-verification   | v0.0.0-20261104081401-7805cfe30d6c |
    And k-review-loop-module-path: the module has no replace directive
    And k-review-loop-module-path: the checkout has no go.work file
    And k-review-loop-module-path: go.sum contains the lines:
      """
      github.com/KogenAI/kogen-loop v0.0.0-20261104063532-dea3eb375dba h1:lVdZBUWyKzLtcgnEO7PG3iK6dYpIkD3a+iLh3W0fl3k=
      github.com/KogenAI/kogen-loop v0.0.0-20261104063532-dea3eb375dba/go.mod h1:yPduvTAVdxH5egqW82Uis/ZhemRb5gNSdzTll/f6bG0=
      """
    And k-review-loop-module-path: go.sum has no line for module "kogen-loop"
    And k-review-loop-module-path: the module is tidy

  Scenario: No Go source imports the bare kogen-loop path
    When k-review-loop-module-path: I search the Go sources for bare kogen-loop imports
    Then k-review-loop-module-path: the search finds nothing

  Scenario: The build resolves kogen-loop only through its canonical path
    When k-review-loop-module-path: I list the packages and modules of the build
    Then k-review-loop-module-path: the packages include:
      | package                                  |
      | github.com/KogenAI/kogen-loop/provider   |
      | github.com/KogenAI/kogen-loop/sys        |
      | github.com/KogenAI/kogen-loop/tools      |
    And k-review-loop-module-path: no package path starts with "kogen-loop/"
    And k-review-loop-module-path: no module in the build list is "kogen-loop"
