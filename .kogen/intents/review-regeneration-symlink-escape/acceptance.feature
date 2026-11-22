Feature: Archive extraction for regeneration stays inside its scratch directory
  This feature requires that extracting the archive of a reviewed tree for regeneration refuses an entry that would be written through a symlink of the archive, while ordinary entries still extract, and that the tests of the review package pin both.

  Scenario: A file beneath a symlinked parent is refused
    Given review-regeneration-symlink-escape: a copy of the review package with the extraction probe test added
    When review-regeneration-symlink-escape: the extraction probe test runs in that copy
    Then review-regeneration-symlink-escape: the probe case "file beneath a symlinked parent" passes

  Scenario: A folder beneath a symlinked parent is refused
    Given review-regeneration-symlink-escape: a copy of the review package with the extraction probe test added
    When review-regeneration-symlink-escape: the extraction probe test runs in that copy
    Then review-regeneration-symlink-escape: the probe case "folder beneath a symlinked parent" passes

  Scenario: A file named as an earlier symlink is refused
    Given review-regeneration-symlink-escape: a copy of the review package with the extraction probe test added
    When review-regeneration-symlink-escape: the extraction probe test runs in that copy
    Then review-regeneration-symlink-escape: the probe case "file named as an earlier symlink" passes

  Scenario: Ordinary entries and a safe symlink still extract
    Given review-regeneration-symlink-escape: a copy of the review package with the extraction probe test added
    When review-regeneration-symlink-escape: the extraction probe test runs in that copy
    Then review-regeneration-symlink-escape: the probe case "ordinary entries" passes

  Scenario: The tests of the review package notice an extraction that checks only lexical paths
    Given review-regeneration-symlink-escape: a copy of the review package whose extraction is "checking only lexical path traversal"
    When review-regeneration-symlink-escape: the tests of the review package run in that copy
    Then review-regeneration-symlink-escape: a test of the review package fails

  Scenario: The tests of the review package notice an extraction that rejects every symlink
    Given review-regeneration-symlink-escape: a copy of the review package whose extraction is "rejecting every symlink"
    When review-regeneration-symlink-escape: the tests of the review package run in that copy
    Then review-regeneration-symlink-escape: a test of the review package fails
