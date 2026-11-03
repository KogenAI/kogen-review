Feature: kogen-review states exactly what it relies on from each Kogen dependency
  kogen-review keeps contract/ (what it provides) and adds one consumes/<producer>/ suite per Kogen
  dependency: kogen-coordinator, kogen-executor, kogen-loop and kogen-verification. Each suite is a
  Go package of test files written only against the producer's exported API; every use of the
  producer in kogen-review's own non-test code has a test that uses it and a row in the suite's
  README inventory, and the inventory lists nothing else. The suites run in go test ./..., isolated
  from the caller's Git, HOME and module proxy, at the dependency versions go.mod pins now.

  Scenario: Each Kogen dependency's consumes suite covers exactly the uses of it in kogen-review's own code
    When k-consumes-review: the consumes observer judges this checkout against these suites:
      | suite              | module                                 |
      | kogen-coordinator  | github.com/KogenAI/kogen-coordinator   |
      | kogen-executor     | github.com/KogenAI/kogen-executor      |
      | kogen-loop         | kogen-loop                             |
      | kogen-verification | github.com/KogenAI/kogen-verification  |
    Then k-consumes-review: the observer finds no problem
    And k-consumes-review: these paths are as committed at HEAD:
      | review   |
      | cmd      |
      | contract |
      | go.mod   |
      | go.sum   |
    And k-consumes-review: the only main package outside "features" is "github.com/KogenAI/kogen-review/cmd/kogen-review"

  Scenario: The consumes suites run and pass in the repository's normal test command
    When k-consumes-review: "go test -count=1 ./..." runs in this checkout
    Then k-consumes-review: go test passed and ran tests in each of these packages:
      | github.com/KogenAI/kogen-review/consumes/kogen-coordinator  |
      | github.com/KogenAI/kogen-review/consumes/kogen-executor     |
      | github.com/KogenAI/kogen-review/consumes/kogen-loop         |
      | github.com/KogenAI/kogen-review/consumes/kogen-verification |
      | github.com/KogenAI/kogen-review/contract                    |

  Scenario: The consumes suites pass isolated from the caller's Git, HOME and module proxy, under the race detector in shuffled order
    When k-consumes-review: "go test -race -count=1 -shuffle=on ./consumes/..." runs in this checkout with a bogus GIT_DIR, a fresh HOME that signs Git commits and no module proxy
    Then k-consumes-review: go test passed and ran tests in each of these packages:
      | github.com/KogenAI/kogen-review/consumes/kogen-coordinator  |
      | github.com/KogenAI/kogen-review/consumes/kogen-executor     |
      | github.com/KogenAI/kogen-review/consumes/kogen-loop         |
      | github.com/KogenAI/kogen-review/consumes/kogen-verification |
