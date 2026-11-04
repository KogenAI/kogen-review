Feature: Calls after a refused submit_review are not answered as if a verdict existed
  The scripted reviewer reviews a saved candidate whose one pinned part, app.txt, is unread until
  a read_file output of it has reached the model. When a submit_review call of a response is
  refused, the later read-only calls of that response run and the later edit or shell calls are
  answered with a refusal text and not run; after an accepted verdict, the later calls are
  ignored as today.

  Scenario: A read after a refused approve runs, a shell call is not run, and the next approve is accepted
    Given k-review-ignored-call-after-rejected-verdict: the scripted reviewer answers in order:
      """
      [
       {"calls": [
         {"name": "submit_review", "args": {"verdict": "approve", "findings": []}},
         {"name": "read_file", "args": {"path": "app.txt"}},
         {"name": "shell", "args": {"command": "echo x"}}
       ]},
       {"calls": [
         {"name": "submit_review", "args": {"verdict": "approve", "findings": []}}
       ]}
      ]
      """
    When k-review-ignored-call-after-rejected-verdict: the native reviewer reviews the saved candidate
    Then k-review-ignored-call-after-rejected-verdict: the calls of response 1 were answered:
      """
      [
       {"name": "submit_review", "output": "invalid verdict:\nRead all pinned source evidence before approving: 1 unread part(s); use read_file on app.txt"},
       {"name": "read_file", "output": "1\tcandidate"},
       {"name": "shell", "output": "not run: the submission was refused; make this call again in the next response"}
      ]
      """
    And k-review-ignored-call-after-rejected-verdict: the output of call 3 of response 1 does not contain "already has a verdict"
    And k-review-ignored-call-after-rejected-verdict: the tools that ran are:
      """
      ["read_file"]
      """
    And k-review-ignored-call-after-rejected-verdict: the review records the probes:
      """
      []
      """
    And k-review-ignored-call-after-rejected-verdict: the run log records these allowance spendings:
      """
      [{"why": "rejected_verdict", "rejected_verdicts": 1, "no_tool_reminders": 0}]
      """
    And k-review-ignored-call-after-rejected-verdict: the calls of response 2 were answered:
      """
      [{"name": "submit_review", "output": "accepted"}]
      """
    And k-review-ignored-call-after-rejected-verdict: the review made 2 model requests
    And k-review-ignored-call-after-rejected-verdict: the review ends with the verdict "approve" and the stop "none"

  Scenario: The calls after an accepted verdict are ignored
    Given k-review-ignored-call-after-rejected-verdict: the scripted reviewer answers in order:
      """
      [
       {"calls": [
         {"name": "read_file", "args": {"path": "app.txt"}}
       ]},
       {"calls": [
         {"name": "submit_review", "args": {"verdict": "approve", "findings": []}},
         {"name": "read_file", "args": {"path": "app.txt"}},
         {"name": "shell", "args": {"command": "echo x"}}
       ]}
      ]
      """
    When k-review-ignored-call-after-rejected-verdict: the native reviewer reviews the saved candidate
    Then k-review-ignored-call-after-rejected-verdict: the calls of response 1 were answered:
      """
      [{"name": "read_file", "output": "1\tcandidate"}]
      """
    And k-review-ignored-call-after-rejected-verdict: the calls of response 2 were answered:
      """
      [
       {"name": "submit_review", "output": "accepted"},
       {"name": "read_file", "output": "ignored: the review already has a verdict"},
       {"name": "shell", "output": "ignored: the review already has a verdict"}
      ]
      """
    And k-review-ignored-call-after-rejected-verdict: the tools that ran are:
      """
      ["read_file"]
      """
    And k-review-ignored-call-after-rejected-verdict: the review records the probes:
      """
      []
      """
    And k-review-ignored-call-after-rejected-verdict: the run log records these allowance spendings:
      """
      []
      """
    And k-review-ignored-call-after-rejected-verdict: the review made 2 model requests
    And k-review-ignored-call-after-rejected-verdict: the review ends with the verdict "approve" and the stop "none"

  Scenario: A refused submission spends the rejected-verdict allowance once while a list runs and a write does not
    Given k-review-ignored-call-after-rejected-verdict: the scripted reviewer answers in order:
      """
      [
       {"calls": [
         {"name": "submit_review", "args": {"verdict": "maybe", "findings": []}},
         {"name": "list_files", "args": {}},
         {"name": "write_file", "args": {"path": "app.txt", "content": "x\n"}}
       ]},
       {"calls": [
         {"name": "submit_review", "args": {"verdict": "maybe", "findings": []}}
       ]}
      ]
      """
    When k-review-ignored-call-after-rejected-verdict: the native reviewer reviews the saved candidate
    Then k-review-ignored-call-after-rejected-verdict: the calls of response 1 were answered:
      """
      [
       {"name": "submit_review", "output": "invalid verdict:\nsubmit_review needs verdict (approve or changes) and a findings list; verdict must be approve or changes but was a string with an unsupported value"},
       {"name": "list_files", "output": ".gitignore\n.kogen/intents/fixture/acceptance.feature\napp.txt"},
       {"name": "write_file", "output": "not run: the submission was refused; make this call again in the next response"}
      ]
      """
    And k-review-ignored-call-after-rejected-verdict: the output of call 3 of response 1 does not contain "already has a verdict"
    And k-review-ignored-call-after-rejected-verdict: app.txt holds "candidate" and a newline
    And k-review-ignored-call-after-rejected-verdict: the tools that ran are:
      """
      ["list_files"]
      """
    And k-review-ignored-call-after-rejected-verdict: the run log records these allowance spendings:
      """
      [{"why": "rejected_verdict", "rejected_verdicts": 1, "no_tool_reminders": 0}]
      """
    And k-review-ignored-call-after-rejected-verdict: the review made 2 model requests
    And k-review-ignored-call-after-rejected-verdict: the review ends with the verdict "invalid" and the stop "candidate/review_invalid"
    And k-review-ignored-call-after-rejected-verdict: the review hands off the Invalid fields:
      """
      {"Reason": "rejected_verdict_exhausted", "Problems": ["submit_review needs verdict (approve or changes) and a findings list; verdict must be approve or changes but was a string with an unsupported value"], "RejectedVerdict": 1, "NoToolReminder": 0}
      """
