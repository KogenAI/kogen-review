Feature: Duplicate review findings are kept once and the findings handed on are bounded
  The reviewer's submit_review verdict is checked by review.Validate, which the native and the
  external reviewer run and kogen-build calls; the verdict it returns is what is stored and handed
  on to the builder. Findings with the same path, line, severity and message (the message compared
  after trimming whitespace) are kept once, in first-submitted order. At most 50 blocking and 50
  note findings are kept, the rest dropped in submitted order, and the verdict records how many of
  each severity were dropped. The checkout's start commit has a.txt of 3 lines.

  Background:
    Given k-review-findings-duplicates-collapsed: a Git checkout whose start commit has the file "a.txt" of 3 lines

  Scenario: Three copies of one blocking finding are kept once
    When k-review-findings-duplicates-collapsed: the reviewer submits the verdict "changes" with the findings:
      | path  | line | severity | message        |
      | a.txt | 2    | blocking | Missing check. |
      | a.txt | 2    | blocking | Missing check. |
      | a.txt | 2    | blocking | Missing check. |
    Then k-review-findings-duplicates-collapsed: the verdict "changes" is accepted with the findings:
      | path  | line | severity | message        |
      | a.txt | 2    | blocking | Missing check. |
    And k-review-findings-duplicates-collapsed: the verdict records no dropped findings

  Scenario: Two findings that differ only in line are both kept
    When k-review-findings-duplicates-collapsed: the reviewer submits the verdict "changes" with the findings:
      | path  | line | severity | message        |
      | a.txt | 1    | blocking | Missing check. |
      | a.txt | 2    | blocking | Missing check. |
    Then k-review-findings-duplicates-collapsed: the verdict "changes" is accepted with the findings:
      | path  | line | severity | message        |
      | a.txt | 1    | blocking | Missing check. |
      | a.txt | 2    | blocking | Missing check. |

  Scenario: Two findings that differ only in severity are both kept
    When k-review-findings-duplicates-collapsed: the reviewer submits the verdict "changes" with the findings:
      | path  | line | severity | message        |
      | a.txt | 1    | blocking | Missing check. |
      | a.txt | 1    | note     | Missing check. |
    Then k-review-findings-duplicates-collapsed: the verdict "changes" is accepted with the findings:
      | path  | line | severity | message        |
      | a.txt | 1    | blocking | Missing check. |
      | a.txt | 1    | note     | Missing check. |

  Scenario: Findings that differ only in the whitespace around the message are kept once
    When k-review-findings-duplicates-collapsed: the reviewer submits the verdict "changes" with the findings:
      | path  | line | severity | message               |
      | a.txt | 3    | blocking | Missing check.        |
      | a.txt | 3    | blocking | "  Missing check.\t"  |
      | a.txt | 3    | blocking | "\t Missing check.  " |
    Then k-review-findings-duplicates-collapsed: the verdict "changes" is accepted with the findings:
      | path  | line | severity | message        |
      | a.txt | 3    | blocking | Missing check. |

  Scenario: Distinct findings keep their first-submitted order when duplicates are dropped
    When k-review-findings-duplicates-collapsed: the reviewer submits the verdict "changes" with the findings:
      | path  | line | severity | message        |
      | a.txt | 2    | blocking | Second defect. |
      | a.txt | 1    | blocking | First defect.  |
      | a.txt | 2    | blocking | Second defect. |
      | a.txt | 3    | note     | A note.        |
      | a.txt | 1    | blocking | First defect.  |
    Then k-review-findings-duplicates-collapsed: the verdict "changes" is accepted with the findings:
      | path  | line | severity | message        |
      | a.txt | 2    | blocking | Second defect. |
      | a.txt | 1    | blocking | First defect.  |
      | a.txt | 3    | note     | A note.        |
    And k-review-findings-duplicates-collapsed: the verdict records no dropped findings

  Scenario: Sixty distinct blocking findings are cut to the first fifty and the cut is recorded
    When k-review-findings-duplicates-collapsed: the reviewer submits the verdict "changes" with 60 distinct "blocking" findings on "a.txt"
    Then k-review-findings-duplicates-collapsed: the verdict "changes" is accepted with the "blocking" findings 1 to 50 on "a.txt"
    And k-review-findings-duplicates-collapsed: the verdict records 10 blocking and 0 note findings dropped

  Scenario: Fifty distinct blocking findings are all kept
    When k-review-findings-duplicates-collapsed: the reviewer submits the verdict "changes" with 50 distinct "blocking" findings on "a.txt"
    Then k-review-findings-duplicates-collapsed: the verdict "changes" is accepted with the "blocking" findings 1 to 50 on "a.txt"
    And k-review-findings-duplicates-collapsed: the verdict records no dropped findings

  Scenario: Fifty-one distinct note findings are cut to the first fifty and the cut is recorded
    When k-review-findings-duplicates-collapsed: the reviewer submits the verdict "approve" with 51 distinct "note" findings on "a.txt"
    Then k-review-findings-duplicates-collapsed: the verdict "approve" is accepted with the "note" findings 1 to 50 on "a.txt"
    And k-review-findings-duplicates-collapsed: the verdict records 0 blocking and 1 note findings dropped

  Scenario: A changes verdict whose blocking findings all collapse to one stays valid
    When k-review-findings-duplicates-collapsed: the reviewer submits the verdict "changes" with the findings:
      | path  | line | severity | message          |
      | a.txt | 1    | blocking | Wrong result.    |
      | a.txt | 1    | blocking | " Wrong result." |
    Then k-review-findings-duplicates-collapsed: the verdict "changes" is accepted with the findings:
      | path  | line | severity | message       |
      | a.txt | 1    | blocking | Wrong result. |

  Scenario: An approve verdict with only duplicate note findings keeps one note
    When k-review-findings-duplicates-collapsed: the reviewer submits the verdict "approve" with the findings:
      | path  | line | severity | message      |
      | a.txt | 3    | note     | Rename this. |
      | a.txt | 3    | note     | Rename this. |
    Then k-review-findings-duplicates-collapsed: the verdict "approve" is accepted with the findings:
      | path  | line | severity | message      |
      | a.txt | 3    | note     | Rename this. |
