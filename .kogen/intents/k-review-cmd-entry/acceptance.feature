Feature: kogen-review can be run and scored on its own
  cmd/kogen-review, built with go build against this repository's own go.mod, runs the review
  phase's existing entry point (the native reviewer, review.Independent) on a saved candidate in a
  Git checkout against the approved Intent of that checkout, without Kogen, and reports the result
  as one JSON line on stdout and an exit code. The reviewer's model is a loopback
  OpenAI-compatible fake that serves scripted answers.

  Background:
    Given the kogen-review command is built from this repository with go build
    And a new Git checkout
    And the checkout's file ".kogen/intents/fixture/intent.md":
      """
      # Greet the world

      The greeting says hello, world.
      """
    And the checkout's file ".kogen/intents/fixture/acceptance.feature":
      """
      Feature: Greeting
        Scenario: The greeting
          Then it says hello, world
      """
    And the checkout's file "greeting.txt":
      """
      hello
      """

  Scenario: The command uses this module's review package and nothing of Kogen
    Then the packages of "./cmd/kogen-review" include "github.com/KogenAI/kogen-review/review" and none of the modules "github.com/KogenAI/kogen" and "github.com/KogenAI/kogen-build"

  Scenario: An approval is reported as JSON with exit 0
    Given the checkout's file ".kogen/project.yaml":
      """
      version: 1
      commands:
        fix:
          - 'make fmt'
        checks:
          - name: unit
            run: 'make unit'
      """
    And the checkout's files are committed as the start commit
    And the saved candidate commit changes "greeting.txt" to "hello, world\n"
    And a fake OpenAI-compatible model that answers in order:
      """
      [{"tool": "read_file", "args": {"path": "greeting.txt"}},
       {"tool": "submit_review", "args": {"verdict": "approve", "findings": [{"path": "greeting.txt", "line": 1, "severity": "note", "message": "says hello, world"}]}}]
      """
    When kogen-review runs with the arguments "-root $CHECKOUT -start HEAD~1 -slug fixture -provider openai-compatible -model fixture-review-model -base-url $BASE_URL"
    Then the exit code is 0
    And stdout is one JSON line equal to:
      """
      {"verdict": "approve",
       "findings": [{"path": "greeting.txt", "line": 1, "severity": "note", "message": "says hello, world"}],
       "tree": "$CANDIDATE_TREE", "repairs": 0, "run": "$RUN", "error": null, "invalid": null}
      """
    And the fake model received 2 requests at "/v1/chat/completions" for the model "fixture-review-model" with the reasoning effort "medium"
    And request 1 offered the tools "read_file, view_image, list_files, search_text, write_file, shell, submit_review"
    And the system message of request 1 begins with the text of "review/prompts/reviewer.md"
    And a message of request 1 contains "# Intent\n\n# Greet the world\n\nThe greeting says hello, world.\n"
    And a message of request 1 contains "# acceptance.feature\n\nFeature: Greeting\n  Scenario: The greeting\n    Then it says hello, world\n"
    And a message of request 1 contains "Fixers: make fmt.\nProject checks: unit: make unit.\n"
    And a message of request 1 contains "-hello\n+hello, world\n"
    And the last message of request 2 is the tool result "1\thello, world"
    And the run folder holds "review-1.json" with the verdict "approve"
    And the checkout's HEAD, index and files are unchanged

  Scenario: A blocking verdict is reported as changes with exit 1
    Given the checkout's files are committed as the start commit
    And the saved candidate commit changes "greeting.txt" to "hello, world\n"
    And a fake OpenAI-compatible model that answers in order:
      """
      [{"tool": "shell", "args": {"command": "cat greeting.txt"}},
       {"tool": "submit_review", "args": {"verdict": "changes", "findings": [{"path": "greeting.txt", "line": 1, "severity": "blocking", "message": "the greeting must end with an exclamation mark"}]}}]
      """
    When kogen-review runs with the arguments "-root $CHECKOUT -start HEAD~1 -slug fixture -provider openai-compatible -model fixture-review-model -effort high -base-url $BASE_URL"
    Then the exit code is 1
    And stdout is one JSON line equal to:
      """
      {"verdict": "changes",
       "findings": [{"path": "greeting.txt", "line": 1, "severity": "blocking", "message": "the greeting must end with an exclamation mark"}],
       "tree": "$CANDIDATE_TREE", "repairs": 0, "run": "$RUN",
       "error": {"class": "candidate", "reason": "review_blocked",
                 "detail": "the reviewer could not resolve a substantive blocker within the approved Intent; edits are left in place",
                 "lines": ["review: greeting.txt:1: the greeting must end with an exclamation mark"]},
       "invalid": null}
      """
    And the fake model received 2 requests at "/v1/chat/completions" for the model "fixture-review-model" with the reasoning effort "high"
    And a message of request 1 contains "Fixers: .\nProject checks: .\nAcceptance: .\n"
    And the last message of request 2 is the tool result "exit status: 0\nhello, world\n"
    And the run folder holds "review-1.json" with the verdict "changes"
    And the checkout's HEAD, index and files are unchanged

  Scenario: A review that ends without a valid verdict is reported as invalid with exit 1
    Given the checkout's files are committed as the start commit
    And the saved candidate commit changes "greeting.txt" to "hello, world\n"
    And a fake OpenAI-compatible model that answers in order:
      """
      [{"text": "Looks fine to me."}, {"text": "Still fine."}]
      """
    When kogen-review runs with the arguments "-root $CHECKOUT -start HEAD~1 -slug fixture -provider openai-compatible -model fixture-review-model -base-url $BASE_URL"
    Then the exit code is 1
    And stdout is one JSON line equal to:
      """
      {"verdict": "invalid", "findings": [], "tree": "", "repairs": 0, "run": "$RUN",
       "error": {"class": "candidate", "reason": "review_invalid",
                 "detail": "the reviewer did not return a valid verdict; edits are left in place", "lines": []},
       "invalid": {"reason": "no_tool_reminder_exhausted", "problems": ["the review ended without calling submit_review"]}}
      """
    And the fake model received 2 requests at "/v1/chat/completions" for the model "fixture-review-model" with the reasoning effort "medium"
    And request 2 required the tool "submit_review"

  Scenario: An approval of a tree the reviewer changed is reported as an unverified repair with exit 1
    Given the checkout's files are committed as the start commit
    And the saved candidate commit changes "greeting.txt" to "hello, world\n"
    And a fake OpenAI-compatible model that answers in order:
      """
      [{"tool": "write_file", "args": {"path": "greeting.txt", "content": "hello, world!\n"}},
       {"tool": "submit_review", "args": {"verdict": "approve", "findings": []}}]
      """
    When kogen-review runs with the arguments "-root $CHECKOUT -start HEAD~1 -slug fixture -provider openai-compatible -model fixture-review-model -base-url $BASE_URL"
    Then the exit code is 1
    And stdout is one JSON line equal to:
      """
      {"verdict": "error", "findings": [], "tree": "", "repairs": 0, "run": "$RUN",
       "error": {"class": "review", "reason": "repair_unverified",
                 "detail": "kogen-review verifies no repairs: the reviewer changed the candidate; its edits are left in place", "lines": []},
       "invalid": null}
      """
    And the fake model received 2 requests at "/v1/chat/completions" for the model "fixture-review-model" with the reasoning effort "medium"
    And the checkout's HEAD is unchanged and its file "greeting.txt" reads "hello, world!\n"

  Scenario Outline: A run without a required flag is refused as a usage error
    Given the checkout's files are committed as the start commit
    And the saved candidate commit changes "greeting.txt" to "hello, world\n"
    When kogen-review runs with the arguments "<arguments>"
    Then the exit code is 2
    And stdout is empty
    And stderr has the line "usage: kogen-review -start REV -slug SLUG -model NAME [-root DIR] [-provider NAME] [-effort LEVEL] [-base-url URL]"

    Examples:
      | arguments                                                 |
      | -root $CHECKOUT -slug fixture -model fixture-review-model |
      | -root $CHECKOUT -start HEAD~1 -model fixture-review-model |
      | -root $CHECKOUT -start HEAD~1 -slug fixture               |

  Scenario Outline: An input that cannot be used is refused before any review
    Given the checkout's file "<file>":
      """
      <text>
      """
    And the checkout's files are committed as the start commit
    And the saved candidate commit changes "greeting.txt" to "hello, world\n"
    And a fake OpenAI-compatible model that answers in order:
      """
      [{"text": "unused"}]
      """
    When kogen-review runs with the arguments "-root $CHECKOUT -start <start> -slug <slug> -provider openai-compatible -model fixture-review-model -base-url $BASE_URL"
    Then the exit code is 2
    And stdout is empty
    And stderr has the line "<line>"
    And the fake model received 0 requests at "/v1/chat/completions" for the model "fixture-review-model" with the reasoning effort "medium"

    Examples:
      | start            | slug      | file                               | text           | line                                                                                                |
      | no-such-revision | fixture   | .kogen/project.yaml                | version: 1     | kogen-review: -start no-such-revision is not a commit of $CHECKOUT                                  |
      | HEAD~1           | absent    | .kogen/project.yaml                | version: 1     | kogen-review: open $CHECKOUT/.kogen/intents/absent/intent.md: no such file or directory             |
      | HEAD~1           | nofeature | .kogen/intents/nofeature/intent.md | # No feature   | kogen-review: open $CHECKOUT/.kogen/intents/nofeature/acceptance.feature: no such file or directory |
      | HEAD~1           | fixture   | .kogen/project.yaml                | version: seven | kogen-review: environment/project_config_invalid: $CHECKOUT/.kogen/project.yaml                     |
