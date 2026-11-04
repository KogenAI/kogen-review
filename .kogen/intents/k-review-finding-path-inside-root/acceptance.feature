Feature: A finding's path names a file inside the checkout root or of the start commit
  The reviewer's submit_review verdict is checked by review.Validate. A finding's path is accepted
  only when it names a file inside the checkout root or a file of the start commit, and it is
  recorded clean. A path that is absolute, climbs out of the root, or resolves through a link
  outside the root is refused with the problem an unknown path gets, the verdict is not accepted,
  and no refusal shows the outside file's content. The checkout holds a.txt and dir/b.txt; gone.txt
  is only in its start commit; outside.txt is a regular file next to the checkout root, not inside
  it, and link.txt is an untracked link to it.

  Background:
    Given k-review-finding-path-inside-root: a Git checkout whose start commit has the files:
      | a.txt     |
      | dir/b.txt |
      | gone.txt  |
    And k-review-finding-path-inside-root: the file "gone.txt" is deleted from the checkout
    And k-review-finding-path-inside-root: the regular file "outside.txt" next to the checkout root holds "OUTSIDE-CONTENT-5c1e"
    And k-review-finding-path-inside-root: the checkout has the untracked link "link.txt" to "../outside.txt"

  Scenario: A file of the checkout is accepted
    When k-review-finding-path-inside-root: the reviewer submits the verdict "approve" with a "note" finding on "a.txt"
    Then k-review-finding-path-inside-root: the verdict is accepted and records the finding path "a.txt"

  Scenario: A parent segment that stays inside the root is accepted and recorded clean
    When k-review-finding-path-inside-root: the reviewer submits the verdict "approve" with a "note" finding on "dir/../a.txt"
    Then k-review-finding-path-inside-root: the verdict is accepted and records the finding path "a.txt"

  Scenario: A harmless ./ segment is accepted and recorded clean
    When k-review-finding-path-inside-root: the reviewer submits the verdict "approve" with a "note" finding on "./dir/b.txt"
    Then k-review-finding-path-inside-root: the verdict is accepted and records the finding path "dir/b.txt"

  Scenario: A file of the start commit deleted from the checkout is accepted
    When k-review-finding-path-inside-root: the reviewer submits the verdict "approve" with a "note" finding on "gone.txt"
    Then k-review-finding-path-inside-root: the verdict is accepted and records the finding path "gone.txt"

  Scenario: A path that climbs out of the root is refused
    When k-review-finding-path-inside-root: the reviewer submits the verdict "changes" with a "blocking" finding on "../outside.txt"
    Then k-review-finding-path-inside-root: the verdict is refused with the one problem "../outside.txt is not a file of the repository"
    And k-review-finding-path-inside-root: the output does not contain the content of the outside file

  Scenario: A parent segment deeper in the path that leaves the root is refused
    When k-review-finding-path-inside-root: the reviewer submits the verdict "changes" with a "blocking" finding on "dir/../../outside.txt"
    Then k-review-finding-path-inside-root: the verdict is refused with the one problem "dir/../../outside.txt is not a file of the repository"
    And k-review-finding-path-inside-root: the output does not contain the content of the outside file

  Scenario: An absolute path to a file outside the root is refused
    When k-review-finding-path-inside-root: the reviewer submits the verdict "changes" with a "blocking" finding on "$OUTSIDE"
    Then k-review-finding-path-inside-root: the verdict is refused with the one problem "$OUTSIDE is not a file of the repository"
    And k-review-finding-path-inside-root: the output does not contain the content of the outside file

  Scenario: A link inside the checkout to a file outside the root is refused
    When k-review-finding-path-inside-root: the reviewer submits the verdict "changes" with a "blocking" finding on "link.txt"
    Then k-review-finding-path-inside-root: the verdict is refused with the one problem "link.txt is not a file of the repository"
    And k-review-finding-path-inside-root: the output does not contain the content of the outside file

  Scenario: An unknown path is refused with the same problem
    When k-review-finding-path-inside-root: the reviewer submits the verdict "changes" with a "blocking" finding on "missing.txt"
    Then k-review-finding-path-inside-root: the verdict is refused with the one problem "missing.txt is not a file of the repository"
