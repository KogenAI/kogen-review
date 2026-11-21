Feature: The rejected-verdict progress line keeps the reason
  This feature checks the progress line of a rejected review verdict whose first problem quotes a requirement and then states the reason it was rejected.

  Scenario: A long requirement is shortened and the reason is kept
    Given review-rejected-line-keeps-reason: a rejected verdict whose first problem quotes a requirement of 400 runes made of the word "abcdefghij" repeated and separated by single spaces, followed by the reason "has no evidence: probe it with shell against the candidate before the verdict"
    When review-rejected-line-keeps-reason: the reviewer records the rejected verdict
    Then review-rejected-line-keeps-reason: the progress problem is the first 5 words of the requirement followed by " ...", then the whole reason
    And review-rejected-line-keeps-reason: the progress problem is within 160 runes

  Scenario: A reason that leaves no room is kept whole and the requirement shrinks to the cut marker
    Given review-rejected-line-keeps-reason: a rejected verdict whose first problem quotes a requirement of 400 runes made of the word "abcdefghij" repeated and separated by single spaces, followed by the reason "has no evidence: probe it with shell against the candidate before the verdict and cite the exact command that ran, the tree it ran on and the exit status it ended with, so that the requirement is shown met by an observed run of this candidate"
    When review-rejected-line-keeps-reason: the reviewer records the rejected verdict
    Then review-rejected-line-keeps-reason: the progress problem is only the cut marker " ..." for the requirement, then the whole reason
    And review-rejected-line-keeps-reason: the progress problem is longer than 160 runes

  Scenario: A problem of at most 160 runes is shown unchanged
    Given review-rejected-line-keeps-reason: a rejected verdict whose first problem quotes a requirement of 40 runes made of the word "abcdefghij" repeated and separated by single spaces, followed by the reason "has no evidence: probe it with shell against the candidate before the verdict"
    When review-rejected-line-keeps-reason: the reviewer records the rejected verdict
    Then review-rejected-line-keeps-reason: the progress problem is the whole problem

  Scenario: A long problem that quotes no requirement is cut at 160 runes as before
    Given review-rejected-line-keeps-reason: a rejected verdict whose first problem has 200 runes made of the word "abcdefghij" repeated and separated by single spaces and quotes no requirement
    When review-rejected-line-keeps-reason: the reviewer records the rejected verdict
    Then review-rejected-line-keeps-reason: the progress problem is the first 14 words of the problem followed by " ..."
    And review-rejected-line-keeps-reason: the progress problem is within 160 runes

  Scenario: The recorded problem stays cut at 300 runes
    Given review-rejected-line-keeps-reason: a rejected verdict whose first problem quotes a requirement of 400 runes made of the word "abcdefghij" repeated and separated by single spaces, followed by the reason "has no evidence: probe it with shell against the candidate before the verdict"
    When review-rejected-line-keeps-reason: the reviewer records the rejected verdict
    Then review-rejected-line-keeps-reason: the recorded problem is the first 300 runes of the problem
