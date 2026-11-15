Feature: A rejected review verdict records its problems
  This feature runs scripted external and native reviews whose first verdict is rejected and observes the run log and the progress.

  Scenario: An external reviewer's rejected verdict records the problems it was told
    When review-rejected-verdict-records-problems: a scripted external reviewer first submits a verdict with no verdict value, then submits approve
    Then review-rejected-verdict-records-problems: the outcome is:
      """
      {"allowances":[{"why":"rejected_verdict","rejected_verdicts":1,"no_tool_reminders":0,"problems":["submit_review needs verdict (approve or changes) and a findings list; verdict must be approve or changes but was missing"]}],
       "told":["submit_review needs verdict (approve or changes) and a findings list; verdict must be approve or changes but was missing"],
       "progress":["kogen: review 1: verdict not accepted: submit_review needs verdict (approve or changes) and a findings list; verdict must be approve or changes but was missing"],
       "verdict":"approve"}
      """

  Scenario: A native reviewer's rejected verdict records the problems it was told
    When review-rejected-verdict-records-problems: a scripted native reviewer first submits a verdict with no verdict value, then submits approve
    Then review-rejected-verdict-records-problems: the outcome is:
      """
      {"allowances":[{"why":"rejected_verdict","rejected_verdicts":1,"no_tool_reminders":0,"problems":["submit_review needs verdict (approve or changes) and a findings list; verdict must be approve or changes but was missing"]}],
       "told":["submit_review needs verdict (approve or changes) and a findings list; verdict must be approve or changes but was missing"],
       "progress":["kogen: review 1: verdict not accepted: submit_review needs verdict (approve or changes) and a findings list; verdict must be approve or changes but was missing"],
       "verdict":"approve"}
      """

  Scenario: Recorded problems are cut at 300 runes and ten lines and the progress line at 160 runes
    When review-rejected-verdict-records-problems: a scripted native reviewer first submits a verdict with 12 findings whose paths are not files and are 400 characters long, then submits approve
    Then review-rejected-verdict-records-problems: the outcome is:
      """
      {"verdict":"approve","why":"rejected_verdict","problem_count":10,"problem_runes":[300,300,300,300,300,300,300,300,300,300],"first_head":"p01-",
       "progress_count":1,"progress_prefix_ok":true,"progress_runes":160,"progress_head":"p01-"}
      """

  Scenario: A no-tool turn event stays without problems while the later rejected verdict records them
    When review-rejected-verdict-records-problems: a scripted native reviewer first answers without a tool call, then submits a verdict with no verdict value, then submits approve
    Then review-rejected-verdict-records-problems: the outcome is:
      """
      {"allowances":[{"why":"no_tool_turn","rejected_verdicts":0,"no_tool_reminders":1},
                     {"why":"rejected_verdict","rejected_verdicts":1,"no_tool_reminders":1,"problems":["submit_review needs verdict (approve or changes) and a findings list; verdict must be approve or changes but was missing"]}],
       "progress":["kogen: review 1: verdict not accepted: submit_review needs verdict (approve or changes) and a findings list; verdict must be approve or changes but was missing"],
       "verdict":"approve"}
      """
