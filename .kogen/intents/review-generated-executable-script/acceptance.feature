Feature: Extraction keeps the permissions of a reviewed tree for generated-file regeneration
  This feature requires that the tests of the review package pin that a marker command of a generated file can run a tracked executable script directly, and that a script that is not executable in the reviewed tree is not made executable. A copy of the checkout gets a wrong treatment of permissions in the scratch copy, and the tests of the review package must notice it.

  Scenario: Dropping the execute permission is noticed
    Given review-generated-executable-script: a copy of the review package in which the scratch copy of a reviewed tree has "the execute permission dropped"
    When review-generated-executable-script: the tests of the review package run in that copy
    Then review-generated-executable-script: a test of the review package fails

  Scenario: Granting execute permission to every file is noticed
    Given review-generated-executable-script: a copy of the review package in which the scratch copy of a reviewed tree has "execute permission granted to every file"
    When review-generated-executable-script: the tests of the review package run in that copy
    Then review-generated-executable-script: a test of the review package fails

  Scenario: The unchanged extraction passes every test
    Given review-generated-executable-script: a copy of the review package in which the scratch copy of a reviewed tree has "unchanged"
    When review-generated-executable-script: the tests of the review package run in that copy
    Then review-generated-executable-script: every test of the review package passes
