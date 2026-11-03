Feature: Require a verdict after twelve working requests
  Scenario: A reviewer keeps reading without submitting
    When the bounded review case "long" runs
    Then the bounded review outcome is:
      """
      {"bound":12,"requests":13,"verdict":"approve","reason":"","interrupted":false,"forced":true,"reminders":[]}
      """

  Scenario: The bound does not waive unread source validation
    When the bounded review case "unread" runs
    Then the bounded review outcome is:
      """
      {"bound":12,"requests":15,"verdict":"approve","reason":"","interrupted":false,"forced":true,"reminders":[],"unread_through":14,"rejected_at":14}
      """

  Scenario: A third request submission has no extra messages or force
    When the bounded review case "third" runs
    Then the bounded review outcome is:
      """
      {"bound":12,"requests":3,"verdict":"approve","reason":"","interrupted":false,"forced":true,"reminders":[]}
      """

  Scenario: The bound counts requests independently of the two allowances
    When the bounded review case "allowances" runs
    Then the bounded review outcome is:
      """
      {"bound":12,"requests":13,"verdict":"approve","reason":"","interrupted":false,"forced":true,"reminders":[5],"rejected_at":3,"no_tool_at":5}
      """

  Scenario: Text fallback spends the ordinary prose allowance
    When the bounded review case "fallback" runs
    Then the bounded review outcome is:
      """
      {"bound":12,"requests":14,"verdict":"","reason":"no_tool_reminder_exhausted","interrupted":false,"forced":false,"reminders":[14],"no_tool_at":14}
      """

  Scenario: An interruption and replacement working window retain the count
    When the bounded review case "resume" runs
    Then the bounded review outcome is:
      """
      {"bound":12,"requests":13,"verdict":"approve","reason":"","interrupted":true,"forced":true,"reminders":[]}
      """
