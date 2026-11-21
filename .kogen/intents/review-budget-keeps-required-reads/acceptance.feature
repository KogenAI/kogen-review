Feature: Keep required review reads available past the working request target
  This feature reproduces the request-count trap at public pin ae445802 in
  review/independent.go converse, not an elapsed-time budget finding. Scripted
  local reviews reuse the independent fixtures and real native read_file tools;
  no provider is called. Required parts only count when successful read outputs
  reach a model request. Existing verdict validation, requirement evidence,
  cancellation and per-response protections remain applicable.

  Scenario: Forced tool choice keeps required reads
    When review-budget-keeps-required-reads: the scripted review case "forced" crosses the request target
    Then review-budget-keeps-required-reads: the required-read outcome is:
      """
      {"verdict":"approve","delivered":3,"early_rejected":false,"reset":false,"resumed":false,"forced":true}
      """

  Scenario: Text fallback keeps required reads
    When review-budget-keeps-required-reads: the scripted review case "fallback" crosses the request target
    Then review-budget-keeps-required-reads: the required-read outcome is:
      """
      {"verdict":"approve","delivered":3,"early_rejected":false,"reset":false,"resumed":false,"forced":false}
      """

  Scenario: Early verdict remains invalid
    When review-budget-keeps-required-reads: the scripted review case "early" crosses the request target
    Then review-budget-keeps-required-reads: the required-read outcome is:
      """
      {"verdict":"approve","delivered":3,"early_rejected":true,"reset":false,"resumed":false,"forced":true}
      """

  Scenario: Repeated non-reading stops explicitly
    When review-budget-keeps-required-reads: the scripted review case "stall" crosses the request target
    Then review-budget-keeps-required-reads: the required-read outcome is:
      """
      {"verdict":"","delivered":0,"early_rejected":false,"reset":false,"resumed":false,"forced":true}
      """

  Scenario: Repeated prose stops explicitly
    When review-budget-keeps-required-reads: the scripted review case "prose" crosses the request target
    Then review-budget-keeps-required-reads: the required-read outcome is:
      """
      {"verdict":"","delivered":0,"early_rejected":false,"reset":false,"resumed":false,"forced":false}
      """

  Scenario: Context reset keeps the reading prompt
    When review-budget-keeps-required-reads: the scripted review case "reset" crosses the request target
    Then review-budget-keeps-required-reads: the required-read outcome is:
      """
      {"verdict":"approve","delivered":3,"early_rejected":false,"reset":true,"resumed":false,"forced":true}
      """

  Scenario: Resume keeps the reading prompt
    When review-budget-keeps-required-reads: the scripted review case "resume" crosses the request target
    Then review-budget-keeps-required-reads: the required-read outcome is:
      """
      {"verdict":"approve","delivered":3,"early_rejected":false,"reset":false,"resumed":true,"forced":true}
      """
