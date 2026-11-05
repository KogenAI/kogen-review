Feature: A reset of a resumed post-reset request keeps the undelivered rejected-verdict feedback

  After a working-context reset, the native reviewer's conversation is the unchanged opening,
  one handoff and Kogen's newest undelivered feedback, here the rejection of a submitted verdict.
  If the Env refuses that post-reset request again, the review stops, and a resume sends the
  checkpointed post-reset conversation again. If the Env refuses that resumed request too, the
  reviewer resets once more. The conversation then has no model item: its items after the handoff
  are still undelivered, so the request sent after this reset carries the rejected-verdict
  feedback once, after the new handoff. The scenario runs a scripted review program through
  review.Independent Review and Resume over a scripted Env, which refuses every request over the
  ceiling and the two scripted requests that fit, and a real temporary Git candidate.

  Scenario: The request after the reset of a resumed post-reset request carries the rejected-verdict feedback once
    When fix-k-review-reset-keeps-source-once: a review whose request after a reset is refused again is resumed and refused once more
    Then fix-k-review-reset-keeps-source-once: the outcome is:
      """
      {
        "review_stop": {"class": "candidate", "reason": "context_budget_exceeded"},
        "checkpoint_items": ["handoff", "feedback"],
        "calls": [
          {"phase": "review", "outcome": "sent", "opening": true, "items": [], "feedback": 0, "handoff": ""},
          {"phase": "review", "outcome": "sent", "opening": true, "items": ["function_call", "function_call_output"], "feedback": 0, "handoff": ""},
          {"phase": "review", "outcome": "refused over the ceiling", "opening": true, "items": ["function_call", "function_call_output", "message", "function_call", "function_call_output"], "feedback": 1, "handoff": ""},
          {"phase": "review", "outcome": "refused", "opening": true, "items": ["handoff", "feedback"], "feedback": 1, "handoff": "review-1-window-1.json"},
          {"phase": "resume", "outcome": "refused", "opening": true, "items": ["handoff", "feedback"], "feedback": 1, "handoff": "review-1-window-1.json"},
          {"phase": "resume", "outcome": "sent", "opening": true, "items": ["handoff", "feedback"], "feedback": 1, "handoff": "review-1-window-2.json"}
        ],
        "resets": [
          {"window": "review-1-window-1.json", "trigger": "submit_review"},
          {"window": "review-1-window-2.json", "trigger": "feedback"}
        ],
        "resume_stop": null,
        "verdict": "approve"
      }
      """
