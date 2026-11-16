Feature: The rejected-verdict progress line is cut at a word
  This feature checks the progress line of a rejected review verdict when its first problem is longer than the 160 rune limit.

  Scenario: A problem over the limit is cut at the last word boundary
    Given review-rejected-verdict-line-cuts-at-word: a rejected verdict whose first problem has 200 runes made of the word "abcdefghij" repeated and separated by single spaces
    When review-rejected-verdict-line-cuts-at-word: the reviewer records the rejected verdict
    Then review-rejected-verdict-line-cuts-at-word: the progress line shows the first 14 words of the problem followed by " ..."
    And review-rejected-verdict-line-cuts-at-word: the progress problem is within 160 runes

  Scenario: The recorded problem of a long rejected verdict stays whole
    Given review-rejected-verdict-line-cuts-at-word: a rejected verdict whose first problem has 200 runes made of the word "abcdefghij" repeated and separated by single spaces
    When review-rejected-verdict-line-cuts-at-word: the reviewer records the rejected verdict
    Then review-rejected-verdict-line-cuts-at-word: the recorded problem is the whole problem

  Scenario: A problem of 161 runes is cut
    Given review-rejected-verdict-line-cuts-at-word: a rejected verdict whose first problem has 161 runes made of the word "abcdefghij" repeated and separated by single spaces
    When review-rejected-verdict-line-cuts-at-word: the reviewer records the rejected verdict
    Then review-rejected-verdict-line-cuts-at-word: the progress line shows the first 14 words of the problem followed by " ..."
    And review-rejected-verdict-line-cuts-at-word: the progress problem is within 160 runes

  Scenario: A problem of exactly 160 runes is shown whole
    Given review-rejected-verdict-line-cuts-at-word: a rejected verdict whose first problem has 160 runes made of the word "abcdefghij" repeated and separated by single spaces
    When review-rejected-verdict-line-cuts-at-word: the reviewer records the rejected verdict
    Then review-rejected-verdict-line-cuts-at-word: the progress line shows the whole problem
    And review-rejected-verdict-line-cuts-at-word: the progress problem is within 160 runes

  Scenario: A problem with multi-byte runes is cut on a rune boundary
    Given review-rejected-verdict-line-cuts-at-word: a rejected verdict whose first problem has 200 runes made of the word "日本語日本語日本語日" repeated and separated by single spaces
    When review-rejected-verdict-line-cuts-at-word: the reviewer records the rejected verdict
    Then review-rejected-verdict-line-cuts-at-word: the progress line shows the first 14 words of the problem followed by " ..."
    And review-rejected-verdict-line-cuts-at-word: the progress problem is within 160 runes
    And review-rejected-verdict-line-cuts-at-word: the progress line has no replacement character
