Feature: kogen-review reads correctly as a public repository
  A public reader of github.com/KogenAI/kogen-review learns from the README what the component is
  and what role it plays in Kogen, sets it up and tests it from a plain public clone with the Go
  toolchain, and finds nothing private, internal or unavailable in the tree. Behaviour and every
  existing check stay as they are.

  Scenario: The README introduces the component to a public reader
    Then the README links to Kogen at "https://github.com/KogenAI/kogen" or "https://kogen.dev"
    And the README states "contact@kogen.dev" exactly once
    And the README mentions none of these words, in any letter case:
      | private       |
      | mirror        |
      | token         |
      | issue         |
      | pull request  |
      | contribut     |
      | maintain      |
      | security      |
      | branding      |

  Scenario: The README's setup and test steps work from a public clone without private settings
    Given the README has a sh code block with the lines:
      """
      git clone https://github.com/KogenAI/kogen-review.git
      cd kogen-review
      """
    When the README command "go build ./... && go vet ./... && go test -race -count=1 ./..." runs in this checkout without private Go or Git settings
    Then the command succeeds and the packages "github.com/KogenAI/kogen-review/contract" and "github.com/KogenAI/kogen-review/review" pass their tests

  Scenario: The tree holds nothing private, internal or unavailable
    Then the tree has no file named "SECURITY.md", "CONTRIBUTING.md" or "BRANDING.md" and no issue or pull request template
    And every URL in the tree starts with one of these public prefixes:
      | https://kogen.dev                          |
      | https://github.com/KogenAI/kogen           |
      | https://github.com/KogenAI/kogen-review    |
      | https://github.com/KogenAI/kogen-build     |
      | https://github.com/KogenAI/kogen-coordinator |
      | https://github.com/KogenAI/kogen-executor  |
      | https://github.com/KogenAI/kogen-verification |
      | https://github.com/KogenAI/kogen-loop      |
      | http://www.apache.org/licenses             |
      | https://www.apache.org/licenses            |
      | https://go.dev                             |
      | https://pkg.go.dev                         |
      | http://127.0.0.1                           |
      | http://localhost                           |
    And every relative link of a Markdown file in the tree names a file or folder of the tree
    And every email address in the tree is "contact@kogen.dev" or an address at "example.invalid"
    And no Markdown file of the tree outside ".kogen/intents/k-public-ready-review/" mentions, in any letter case:
      | contribut    |
      | pull request |
      | maintain     |
    And no file of the tree except ".kogen/project.yaml" matches any of these patterns:
      | kind                           | pattern                                          | flags |
      | runner or home path            | /(Users\|home)/[A-Za-z0-9_]                      |       |
      | macOS temporary folder         | /var/folders?/                                   |       |
      | runner workspace               | work[.]noindex\|kogen-run(?:ner)                 |       |
      | host name                      | [A-Za-z0-9-]+[.](local\|internal\|lan\|corp)(?![A-Za-z0-9]) |       |
      | private-module Go setting      | GO(PRIVATE\|NOPROXY\|NOSUMDB\|INSECURE)          |       |
      | Git URL rewrite                | instead[O]f                                      | i     |
      | internal Build id              | Build [0-9a-f]{8}(?![0-9a-z])                    |       |
      | commit of an unpublished main  | main [0-9a-f]{7,40}(?![0-9a-z])                  |       |
      | landing note                   | (?<![a-z])land(?:ed)(?![a-z])                    | i     |
      | local-only note                | not for pu(?:sh)                                 | i     |

  Scenario: Behaviour, tests and checks are unchanged
    Then these paths are as committed at HEAD:
      """
      *.go
      go.mod
      go.sum
      review/prompts
      review/testdata
      features/steps/kogen_review_cmd.js
      features/steps/kogen_review_cmd_controls
      features/steps/saved_candidate_observer.cjs
      features/steps/saved_candidate_steps.js
      .kogen/intents/k-review-cmd-entry/acceptance.feature
      .kogen/intents/k-review-saved-candidate/acceptance.feature
      """
