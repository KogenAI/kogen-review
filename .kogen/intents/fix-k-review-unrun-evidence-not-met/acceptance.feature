Feature: A successful shell probe of the native review keeps its exit status
  The reported finding (a shell probe without edits gets no ProbeRun, so a successful probe is
  refused as having no exit status) does not reproduce: every shell call sets edits. The existing
  contract test shows a successful probe recorded with exit status 0 and accepted as evidence.

  Scenario: A successful shell probe is recorded with its exit status and accepted as cited evidence
    When fix-k-review-unrun-evidence-not-met: I run the existing Go test "TestIndependentReviewRecordsItsProbesAndRequirements" in package "./contract"
    Then fix-k-review-unrun-evidence-not-met: that test ran and passed
