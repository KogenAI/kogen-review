Feature: A prose-only reviewer turn after a working tool call gets its own reminder
  The scripted reviewer reviews a saved candidate whose one pinned part, app.txt, stays unread
  until the reviewer reads it with read_file; an approval before that read is sent back as a
  rejected verdict. A prose-only turn is an answer without a tool call. The first one of a review
  gets a reminder, and the next request requires submit_review; a later one gets the same
  reminder when the reviewer made a tool call since the last reminder, up to three reminders per
  review. The "forced" route is openai-compatible with the model "scripted", which supports forced
  tool choice; the "text" route is anthropic with the model "scripted-text", which does not.
  Each request is shown as its required tool (force), the mode of the review_tool_choice event
  recorded for it (mode), its last input (last) and the scripted answer (answer).

  Scenario: A prose-only turn after the reviewer worked gets a reminder and a forced request, and the review ends with the verdict
    Given k-review-prose-allowance-per-streak: the scripted reviewer on the "forced" route answers in order:
      """
      [{"prose": "I think it is fine."},
       {"calls": [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]},
       {"calls": [{"name": "read_file", "args": {"path": "app.txt"}}]},
       {"prose": "I read it; it is fine."},
       {"calls": [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]}]
      """
    When k-review-prose-allowance-per-streak: the native reviewer reviews the saved candidate
    Then k-review-prose-allowance-per-streak: the review made these requests:
      """
      [{"force": "", "mode": "", "last": {"user": "<opening>"}, "answer": "prose"},
       {"force": "submit_review", "mode": "api_forced", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": ["submit_review"]},
       {"force": "", "mode": "", "last": {"tool_result": "invalid verdict:\nRead all pinned source evidence before approving: 1 unread part(s); use read_file on app.txt"}, "answer": ["read_file"]},
       {"force": "", "mode": "", "last": {"tool_result": "1\tcandidate"}, "answer": "prose"},
       {"force": "submit_review", "mode": "api_forced", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": ["submit_review"]}]
      """
    And k-review-prose-allowance-per-streak: the review ends with the verdict "approve" and the stop "none"
    And k-review-prose-allowance-per-streak: the run log records the provider faults:
      """
      []
      """

  Scenario: A reviewer that keeps working between prose-only turns stops at the reminder cap with the exact cause
    Given k-review-prose-allowance-per-streak: the scripted reviewer on the "forced" route answers in order:
      """
      [{"prose": "I think it is fine."},
       {"calls": [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]},
       {"calls": [{"name": "read_file", "args": {"path": "app.txt"}}]},
       {"prose": "I read it; it is fine."},
       {"calls": [{"name": "list_files", "args": {"path": "."}}]},
       {"prose": "The files are fine."},
       {"calls": [{"name": "read_file", "args": {"path": "app.txt"}}]},
       {"prose": "Still fine."},
       {"calls": [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]}]
      """
    When k-review-prose-allowance-per-streak: the native reviewer reviews the saved candidate
    Then k-review-prose-allowance-per-streak: the review made these requests:
      """
      [{"force": "", "mode": "", "last": {"user": "<opening>"}, "answer": "prose"},
       {"force": "submit_review", "mode": "api_forced", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": ["submit_review"]},
       {"force": "", "mode": "", "last": {"tool_result": "invalid verdict:\nRead all pinned source evidence before approving: 1 unread part(s); use read_file on app.txt"}, "answer": ["read_file"]},
       {"force": "", "mode": "", "last": {"tool_result": "1\tcandidate"}, "answer": "prose"},
       {"force": "submit_review", "mode": "api_forced", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": ["list_files"]},
       {"force": "", "mode": "", "last": {"tool_result": ".gitignore\n.kogen/intents/fixture/acceptance.feature\napp.txt"}, "answer": "prose"},
       {"force": "submit_review", "mode": "api_forced", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": ["read_file"]},
       {"force": "", "mode": "", "last": {"tool_result": "1\tcandidate"}, "answer": "prose"}]
      """
    And k-review-prose-allowance-per-streak: the review ends with the verdict "invalid" and the stop "candidate/review_invalid"
    And k-review-prose-allowance-per-streak: the review hands off the Invalid fields:
      """
      {"Reason": "no_tool_reminder_cap", "Problems": ["the review ended without calling submit_review"],
       "RejectedVerdict": 1, "NoToolReminder": 3, "ProseTurns": 4, "ForcedRequests": 3, "ForcedAnswered": 3,
       "Route": "openai-compatible", "Model": "scripted", "ToolChoice": "api_forced", "ForcedRoute": "", "ForcedModel": ""}
      """
    And k-review-prose-allowance-per-streak: the run log records the invalid review event with:
      """
      {"reason": "no_tool_reminder_cap", "problems": ["the review ended without calling submit_review"],
       "rejected_verdicts": 1, "no_tool_reminders": 3, "prose_turns": 4, "forced_requests": 3, "forced_answered_with_tool": 3,
       "route": "openai-compatible", "model": "scripted", "tool_choice": "api_forced"}
      """
    And k-review-prose-allowance-per-streak: the run log records the provider faults:
      """
      []
      """

  Scenario: A forced request answered with prose only is a provider fault and ends the review with no forced request answered
    Given k-review-prose-allowance-per-streak: the scripted reviewer on the "forced" route answers in order:
      """
      [{"prose": "I think it is fine."},
       {"prose": "It is fine, really."},
       {"calls": [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]}]
      """
    When k-review-prose-allowance-per-streak: the native reviewer reviews the saved candidate
    Then k-review-prose-allowance-per-streak: the review made these requests:
      """
      [{"force": "", "mode": "", "last": {"user": "<opening>"}, "answer": "prose"},
       {"force": "submit_review", "mode": "api_forced", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": "prose"}]
      """
    And k-review-prose-allowance-per-streak: the review ends with the verdict "invalid" and the stop "candidate/review_invalid"
    And k-review-prose-allowance-per-streak: the run log records the provider faults:
      """
      [{"event": "provider_fault", "fault": "forced_tool_not_called", "review": 1, "tool": "submit_review", "mode": "api_forced", "route": "openai-compatible", "model": "scripted"}]
      """
    And k-review-prose-allowance-per-streak: the review hands off the Invalid fields:
      """
      {"Reason": "no_tool_reminder_exhausted", "Problems": ["the review ended without calling submit_review"],
       "RejectedVerdict": 0, "NoToolReminder": 1, "ProseTurns": 2, "ForcedRequests": 1, "ForcedAnswered": 0,
       "Route": "openai-compatible", "Model": "scripted", "ToolChoice": "api_forced", "ForcedRoute": "openai-compatible", "ForcedModel": "scripted"}
      """
    And k-review-prose-allowance-per-streak: the run log records the invalid review event with:
      """
      {"reason": "no_tool_reminder_exhausted", "rejected_verdicts": 0, "no_tool_reminders": 1, "prose_turns": 2, "forced_requests": 1, "forced_answered_with_tool": 0,
       "route": "openai-compatible", "model": "scripted", "tool_choice": "api_forced"}
      """

  Scenario: A reviewer that worked and then answers a forced request with prose only ends with the cause told apart from the cap
    Given k-review-prose-allowance-per-streak: the scripted reviewer on the "forced" route answers in order:
      """
      [{"prose": "I think it is fine."},
       {"calls": [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]},
       {"calls": [{"name": "read_file", "args": {"path": "app.txt"}}]},
       {"prose": "I read it; it is fine."},
       {"prose": "It is fine, really."},
       {"calls": [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]}]
      """
    When k-review-prose-allowance-per-streak: the native reviewer reviews the saved candidate
    Then k-review-prose-allowance-per-streak: the review made these requests:
      """
      [{"force": "", "mode": "", "last": {"user": "<opening>"}, "answer": "prose"},
       {"force": "submit_review", "mode": "api_forced", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": ["submit_review"]},
       {"force": "", "mode": "", "last": {"tool_result": "invalid verdict:\nRead all pinned source evidence before approving: 1 unread part(s); use read_file on app.txt"}, "answer": ["read_file"]},
       {"force": "", "mode": "", "last": {"tool_result": "1\tcandidate"}, "answer": "prose"},
       {"force": "submit_review", "mode": "api_forced", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": "prose"}]
      """
    And k-review-prose-allowance-per-streak: the review ends with the verdict "invalid" and the stop "candidate/review_invalid"
    And k-review-prose-allowance-per-streak: the review hands off the Invalid fields:
      """
      {"Reason": "no_tool_reminder_exhausted", "RejectedVerdict": 1, "NoToolReminder": 2, "ProseTurns": 3, "ForcedRequests": 2, "ForcedAnswered": 1,
       "Route": "openai-compatible", "Model": "scripted", "ToolChoice": "api_forced", "ForcedRoute": "openai-compatible", "ForcedModel": "scripted"}
      """
    And k-review-prose-allowance-per-streak: the run log records the provider faults:
      """
      [{"event": "provider_fault", "fault": "forced_tool_not_called", "review": 1, "tool": "submit_review", "mode": "api_forced", "route": "openai-compatible", "model": "scripted"}]
      """

  Scenario: A review that submits on its first request makes the same single request as today
    Given k-review-prose-allowance-per-streak: the scripted reviewer on the "forced" route answers in order:
      """
      [{"calls": [{"name": "read_file", "args": {"path": "app.txt"}}, {"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]}]
      """
    When k-review-prose-allowance-per-streak: the native reviewer reviews the saved candidate
    Then k-review-prose-allowance-per-streak: the review made these requests:
      """
      [{"force": "", "mode": "", "last": {"user": "<opening>"}, "answer": ["read_file", "submit_review"]}]
      """
    And k-review-prose-allowance-per-streak: the review ends with the verdict "approve" and the stop "none"

  Scenario: A review with exactly one prose-only turn before submitting makes the same requests as today
    Given k-review-prose-allowance-per-streak: the scripted reviewer on the "forced" route answers in order:
      """
      [{"prose": "I think it is fine."},
       {"calls": [{"name": "read_file", "args": {"path": "app.txt"}}, {"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]}]
      """
    When k-review-prose-allowance-per-streak: the native reviewer reviews the saved candidate
    Then k-review-prose-allowance-per-streak: the review made these requests:
      """
      [{"force": "", "mode": "", "last": {"user": "<opening>"}, "answer": "prose"},
       {"force": "submit_review", "mode": "api_forced", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": ["read_file", "submit_review"]}]
      """
    And k-review-prose-allowance-per-streak: the review ends with the verdict "approve" and the stop "none"

  Scenario: A rejected verdict and then a prose-only turn spend the two allowances as today
    Given k-review-prose-allowance-per-streak: the scripted reviewer on the "forced" route answers in order:
      """
      [{"calls": [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]},
       {"prose": "I think it is fine."},
       {"calls": [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]}]
      """
    When k-review-prose-allowance-per-streak: the native reviewer reviews the saved candidate
    Then k-review-prose-allowance-per-streak: the review made these requests:
      """
      [{"force": "", "mode": "", "last": {"user": "<opening>"}, "answer": ["submit_review"]},
       {"force": "", "mode": "", "last": {"tool_result": "invalid verdict:\nRead all pinned source evidence before approving: 1 unread part(s); use read_file on app.txt"}, "answer": "prose"},
       {"force": "submit_review", "mode": "api_forced", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": ["submit_review"]}]
      """
    And k-review-prose-allowance-per-streak: the review ends with the verdict "invalid" and the stop "candidate/review_invalid"
    And k-review-prose-allowance-per-streak: the review hands off the Invalid fields:
      """
      {"Reason": "rejected_verdict_exhausted", "Problems": ["Read all pinned source evidence before approving: 1 unread part(s); use read_file on app.txt"],
       "RejectedVerdict": 1, "NoToolReminder": 1}
      """

  Scenario: A prose-only turn and then a rejected verdict spend the two allowances as today
    Given k-review-prose-allowance-per-streak: the scripted reviewer on the "forced" route answers in order:
      """
      [{"prose": "I think it is fine."},
       {"calls": [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]},
       {"calls": [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]}]
      """
    When k-review-prose-allowance-per-streak: the native reviewer reviews the saved candidate
    Then k-review-prose-allowance-per-streak: the review made these requests:
      """
      [{"force": "", "mode": "", "last": {"user": "<opening>"}, "answer": "prose"},
       {"force": "submit_review", "mode": "api_forced", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": ["submit_review"]},
       {"force": "", "mode": "", "last": {"tool_result": "invalid verdict:\nRead all pinned source evidence before approving: 1 unread part(s); use read_file on app.txt"}, "answer": ["submit_review"]}]
      """
    And k-review-prose-allowance-per-streak: the review ends with the verdict "invalid" and the stop "candidate/review_invalid"
    And k-review-prose-allowance-per-streak: the review hands off the Invalid fields:
      """
      {"Reason": "rejected_verdict_exhausted", "Problems": ["Read all pinned source evidence before approving: 1 unread part(s); use read_file on app.txt"],
       "RejectedVerdict": 1, "NoToolReminder": 1}
      """

  Scenario: A resume between a reminder and the next request continues the reminder count to the cap
    Given k-review-prose-allowance-per-streak: the scripted reviewer on the "forced" route answers in order:
      """
      [{"prose": "I think it is fine."},
       {"calls": [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]},
       {"calls": [{"name": "read_file", "args": {"path": "app.txt"}}]},
       {"prose": "I read it; it is fine."},
       {"interrupt": true},
       {"calls": [{"name": "list_files", "args": {"path": "."}}]},
       {"prose": "The files are fine."},
       {"calls": [{"name": "read_file", "args": {"path": "app.txt"}}]},
       {"prose": "Still fine."},
       {"calls": [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]}]
      """
    When k-review-prose-allowance-per-streak: the native reviewer reviews the saved candidate
    Then k-review-prose-allowance-per-streak: the review resumed once, from a checkpoint of the stage "review" whose session has:
      """
      {"no_tool_reminders": 2, "remind": true, "no_tool_restored": null, "rejected_verdicts": 1,
       "prose_turns": 2, "forced_requests": 1, "forced_answered_with_tool": 1}
      """
    And k-review-prose-allowance-per-streak: the review made these requests:
      """
      [{"force": "", "mode": "", "last": {"user": "<opening>"}, "answer": "prose"},
       {"force": "submit_review", "mode": "api_forced", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": ["submit_review"]},
       {"force": "", "mode": "", "last": {"tool_result": "invalid verdict:\nRead all pinned source evidence before approving: 1 unread part(s); use read_file on app.txt"}, "answer": ["read_file"]},
       {"force": "", "mode": "", "last": {"tool_result": "1\tcandidate"}, "answer": "prose"},
       {"force": "submit_review", "mode": "api_forced", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": "interrupted"},
       {"force": "submit_review", "mode": "api_forced", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": ["list_files"]},
       {"force": "", "mode": "", "last": {"tool_result": ".gitignore\n.kogen/intents/fixture/acceptance.feature\napp.txt"}, "answer": "prose"},
       {"force": "submit_review", "mode": "api_forced", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": ["read_file"]},
       {"force": "", "mode": "", "last": {"tool_result": "1\tcandidate"}, "answer": "prose"}]
      """
    And k-review-prose-allowance-per-streak: the review ends with the verdict "invalid" and the stop "candidate/review_invalid"
    And k-review-prose-allowance-per-streak: the review hands off the Invalid fields:
      """
      {"Reason": "no_tool_reminder_cap", "RejectedVerdict": 1, "NoToolReminder": 3, "ProseTurns": 4, "ForcedRequests": 3, "ForcedAnswered": 3,
       "Route": "openai-compatible", "Model": "scripted", "ToolChoice": "api_forced", "ForcedRoute": "", "ForcedModel": ""}
      """

  Scenario: A resume after the forced request was answered with a tool call continues the restored allowance
    Given k-review-prose-allowance-per-streak: the scripted reviewer on the "forced" route answers in order:
      """
      [{"prose": "I think it is fine."},
       {"calls": [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]},
       {"interrupt": true},
       {"calls": [{"name": "read_file", "args": {"path": "app.txt"}}]},
       {"prose": "I read it; it is fine."},
       {"calls": [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]}]
      """
    When k-review-prose-allowance-per-streak: the native reviewer reviews the saved candidate
    Then k-review-prose-allowance-per-streak: the review resumed once, from a checkpoint of the stage "review" whose session has:
      """
      {"no_tool_reminders": 1, "no_tool_restored": true, "remind": null, "rejected_verdicts": 1,
       "prose_turns": 1, "forced_requests": 1, "forced_answered_with_tool": 1}
      """
    And k-review-prose-allowance-per-streak: the review made these requests:
      """
      [{"force": "", "mode": "", "last": {"user": "<opening>"}, "answer": "prose"},
       {"force": "submit_review", "mode": "api_forced", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": ["submit_review"]},
       {"force": "", "mode": "", "last": {"tool_result": "invalid verdict:\nRead all pinned source evidence before approving: 1 unread part(s); use read_file on app.txt"}, "answer": "interrupted"},
       {"force": "", "mode": "", "last": {"tool_result": "invalid verdict:\nRead all pinned source evidence before approving: 1 unread part(s); use read_file on app.txt"}, "answer": ["read_file"]},
       {"force": "", "mode": "", "last": {"tool_result": "1\tcandidate"}, "answer": "prose"},
       {"force": "submit_review", "mode": "api_forced", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": ["submit_review"]}]
      """
    And k-review-prose-allowance-per-streak: the review ends with the verdict "approve" and the stop "none"

  Scenario: On a route without forced tool choice the reminder is text and the cap applies the same way
    Given k-review-prose-allowance-per-streak: the scripted reviewer on the "text" route answers in order:
      """
      [{"prose": "I think it is fine."},
       {"calls": [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]},
       {"calls": [{"name": "read_file", "args": {"path": "app.txt"}}]},
       {"prose": "I read it; it is fine."},
       {"calls": [{"name": "list_files", "args": {"path": "."}}]},
       {"prose": "The files are fine."},
       {"calls": [{"name": "read_file", "args": {"path": "app.txt"}}]},
       {"prose": "Still fine."},
       {"calls": [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]}]
      """
    When k-review-prose-allowance-per-streak: the native reviewer reviews the saved candidate
    Then k-review-prose-allowance-per-streak: the review made these requests:
      """
      [{"force": "", "mode": "", "last": {"user": "<opening>"}, "answer": "prose"},
       {"force": "", "mode": "text_fallback", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": ["submit_review"]},
       {"force": "", "mode": "", "last": {"tool_result": "invalid verdict:\nRead all pinned source evidence before approving: 1 unread part(s); use read_file on app.txt"}, "answer": ["read_file"]},
       {"force": "", "mode": "", "last": {"tool_result": "1\tcandidate"}, "answer": "prose"},
       {"force": "", "mode": "text_fallback", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": ["list_files"]},
       {"force": "", "mode": "", "last": {"tool_result": ".gitignore\n.kogen/intents/fixture/acceptance.feature\napp.txt"}, "answer": "prose"},
       {"force": "", "mode": "text_fallback", "last": {"user": "Not a valid verdict: the review ended without calling submit_review. Call submit_review."}, "answer": ["read_file"]},
       {"force": "", "mode": "", "last": {"tool_result": "1\tcandidate"}, "answer": "prose"}]
      """
    And k-review-prose-allowance-per-streak: the review ends with the verdict "invalid" and the stop "candidate/review_invalid"
    And k-review-prose-allowance-per-streak: the review hands off the Invalid fields:
      """
      {"Reason": "no_tool_reminder_cap", "RejectedVerdict": 1, "NoToolReminder": 3, "ProseTurns": 4, "ForcedRequests": 3, "ForcedAnswered": 3,
       "Route": "anthropic", "Model": "scripted-text", "ToolChoice": "text_fallback", "ForcedRoute": "", "ForcedModel": ""}
      """
    And k-review-prose-allowance-per-streak: the run log records the provider faults:
      """
      []
      """
