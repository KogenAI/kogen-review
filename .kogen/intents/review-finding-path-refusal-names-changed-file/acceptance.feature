Feature: A refused finding path names the one changed file it matches
  This feature covers the problem text of a review verdict whose finding names a path that is not
  a file of the repository. When exactly one changed path matches the cited path by whole-component
  suffix, in either direction, the problem ends with a did-you-mean hint; otherwise the text is
  unchanged, and a path that leaves the root never gets a hint. The native and the external review
  route give the same text.

  Scenario: A doubled-prefix path names the one changed file
    Given review-finding-path-refusal-names-changed-file: a candidate that changed the files:
      | lib/studio_web.ex |
    When review-finding-path-refusal-names-changed-file: the reviewer submits a blocking finding on the path "lib/studio_web/lib/studio_web.ex"
    Then review-finding-path-refusal-names-changed-file: the verdict is refused with the one problem "lib/studio_web/lib/studio_web.ex is not a file of the repository; did you mean lib/studio_web.ex"

  Scenario: A path matching no changed file keeps the old text
    Given review-finding-path-refusal-names-changed-file: a candidate that changed the files:
      | lib/studio_web.ex |
    When review-finding-path-refusal-names-changed-file: the reviewer submits a blocking finding on the path "missing.txt"
    Then review-finding-path-refusal-names-changed-file: the verdict is refused with the one problem "missing.txt is not a file of the repository"

  Scenario: Two matching changed files give no hint
    Given review-finding-path-refusal-names-changed-file: a candidate that changed the files:
      | app/a/config.ex |
      | app/b/config.ex |
    When review-finding-path-refusal-names-changed-file: the reviewer submits a blocking finding on the path "config.ex"
    Then review-finding-path-refusal-names-changed-file: the verdict is refused with the one problem "config.ex is not a file of the repository"

  Scenario: A path that leaves the root gets no hint
    Given review-finding-path-refusal-names-changed-file: a candidate that changed the files:
      | outside.txt |
    When review-finding-path-refusal-names-changed-file: the reviewer submits a blocking finding on the path "../outside.txt"
    Then review-finding-path-refusal-names-changed-file: the verdict is refused with the one problem "../outside.txt is not a file of the repository"

  Scenario: The external review gives the same hint
    Given review-finding-path-refusal-names-changed-file: a candidate that changed the files:
      | lib/studio_web.ex |
    When review-finding-path-refusal-names-changed-file: the reviewer submits a blocking finding on the path "lib/studio_web/lib/studio_web.ex"
    Then review-finding-path-refusal-names-changed-file: the external review feedback has the one problem "lib/studio_web/lib/studio_web.ex is not a file of the repository; did you mean lib/studio_web.ex"
