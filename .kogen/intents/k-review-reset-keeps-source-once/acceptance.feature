Feature: A refused review request resets the working context with each source and reference once

  If the Env refuses the native reviewer's next request because it does not fit the
  request ceiling (candidate/context_budget_exceeded, nothing sent), the reviewer resets
  its own working context: the request it sends again is the unchanged mandatory opening,
  one bounded handoff and Kogen's newest undelivered feedback; the replaced conversation is
  archived as a custody record, and reads that reached the model stay counted. Each scenario
  runs a scripted review program through review.Independent over a scripted Env that refuses
  every request over the ceiling, as the provider client does, and a real temporary Git
  candidate, and reports the bytes of every request after a reset.

  Scenario: Resets after a read, a shell result and a rejected verdict carry each source part and reference once, and a second reset does not grow the handoff
    When k-review-reset-keeps-source-once: the scripted review case "points" runs
    Then k-review-reset-keeps-source-once: the reset outcome is:
      """
      {
        "sent": 7,
        "refusals": 4,
        "resets": [4, 5, 6, 7],
        "after": ["read_file", "shell", "submit_review", "read_file"],
        "carried": [["handoff"], ["handoff"], ["handoff", "feedback"], ["handoff"]],
        "unread_parts": [0, 0, 0, 0],
        "parts": [1, 1, 1],
        "refs": [1, 1, 1],
        "feedback": [0, 0, 1, 0],
        "handoff_max": 2048,
        "steady": [[4, 5], [6, 7]],
        "verdict": "approve",
        "rejected_verdicts": 1
      }
      """

  Scenario: Read parts stay read after a reset and an unread part still blocks approval
    When k-review-reset-keeps-source-once: the scripted review case "pinned" runs
    Then k-review-reset-keeps-source-once: the reset outcome is:
      """
      {
        "sent": 5,
        "refusals": 1,
        "resets": [3],
        "after": ["read_file"],
        "carried": [["handoff"]],
        "unread_parts": [1],
        "parts": [0, 0, 0],
        "refs": [1, 1, 1],
        "feedback": [0],
        "handoff_max": 2048,
        "verdict": "approve",
        "rejected_verdicts": 1,
        "rejections": ["invalid verdict:\nRead all pinned source evidence before approving: 1 unread part(s); use read_file on src/part-3.txt"]
      }
      """

  Scenario: When only the mandatory material fits, the request after the reset is the mandatory material and fits
    When k-review-reset-keeps-source-once: the scripted review case "tight" runs
    Then k-review-reset-keeps-source-once: the reset outcome is:
      """
      {
        "sent": 2,
        "refusals": 1,
        "resets": [2],
        "after": ["read_file"],
        "carried": [[]],
        "unread_parts": [null],
        "parts": [1, 1, 1],
        "refs": [1, 1, 1],
        "feedback": [0],
        "handoff_max": 2048,
        "verdict": "approve",
        "rejected_verdicts": 0
      }
      """

  Scenario: Mandatory material that cannot fit the ceiling still refuses before anything is sent
    When k-review-reset-keeps-source-once: the scripted review case "mandatory" runs
    Then k-review-reset-keeps-source-once: the reset outcome is:
      """
      {
        "sent": 0,
        "refusals": 1,
        "resets": [],
        "after": [],
        "verdict": "",
        "class": "candidate",
        "reason": "context_budget_exceeded"
      }
      """

  Scenario: A conversation that never outgrows the ceiling is sent with unchanged bytes
    When k-review-reset-keeps-source-once: the scripted review case "fits" runs
    Then k-review-reset-keeps-source-once: the reset outcome is:
      """
      {
        "sent": 2,
        "refusals": 0,
        "resets": [],
        "after": [],
        "items": [0, 2],
        "bytes": [45194, 50605],
        "verdict": "approve",
        "rejected_verdicts": 0
      }
      """
