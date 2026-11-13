Feature: A reviewer reminder reads unread pinned parts before a verdict
  This feature runs scripted native reviews and observes the tool each reminder request forces.

  Scenario: A no-tool turn with 86 unread parts is followed by a forced read_file naming unread parts
    When review-reminder-reads-unread-parts: a fake reviewer answers without a tool call while 86 pinned parts are unread, then reads them and submits approve
    Then review-reminder-reads-unread-parts: the outcome is:
      """
      {"requests":[
        {"force":"","reminder":false,"reminder_parts":[],"reminder_unread":0},
        {"force":"read_file","reminder":true,"reminder_parts":["part-001","part-002","part-003","part-004","part-005","part-006","part-007","part-008"],"reminder_unread":86},
        {"force":"","reminder":false,"reminder_parts":[],"reminder_unread":0}],
       "choices":[{"tool":"read_file","mode":"api_forced","unread":86}],
       "verdict":"approve","stop":null}
      """

  Scenario: Reading the parts after the reminder lets the review end with a valid approval
    When review-reminder-reads-unread-parts: a fake reviewer answers without a tool call while 86 pinned parts are unread, then reads them and submits approve
    Then review-reminder-reads-unread-parts: the outcome is:
      """
      {"requests":[
        {"force":"","reminder":false,"reminder_parts":[],"reminder_unread":0},
        {"force":"read_file","reminder":true,"reminder_parts":["part-001","part-002","part-003","part-004","part-005","part-006","part-007","part-008"],"reminder_unread":86},
        {"force":"","reminder":false,"reminder_parts":[],"reminder_unread":0}],
       "choices":[{"tool":"read_file","mode":"api_forced","unread":86}],
       "verdict":"approve","stop":null}
      """

  Scenario: With no unread parts a no-tool turn is followed by a forced submit_review
    When review-reminder-reads-unread-parts: a fake reviewer answers without a tool call while no pinned parts are unread, then submits approve
    Then review-reminder-reads-unread-parts: the outcome is:
      """
      {"requests":[
        {"force":"","reminder":false,"reminder_parts":[],"reminder_unread":0},
        {"force":"submit_review","reminder":true,"reminder_parts":[],"reminder_unread":0}],
       "choices":[{"tool":"submit_review","mode":"api_forced","unread":0}],
       "verdict":"approve","stop":null}
      """
