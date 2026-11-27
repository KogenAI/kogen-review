Feature: A missing check is asked for once before an evidence-only stop
  The scripted reviewer reviews a saved grant candidate against the approved requirement
  "A grant needs both a name and a key: omitting either is refused and writes nothing". The
  candidate's grant.sh refuses a grant that omits its name or its key. A reviewer that objects
  without any evidence is asked once for a focused check on the current tree, and a stop that
  stays unverified is reported as such with the candidate kept.

  Scenario: An evidence-free objection after inspection gets one request for the missing check
    Given review-focus-check-before-evidence-only-stop: a saved grant candidate
    And review-focus-check-before-evidence-only-stop: the scripted reviewer answers in order:
      """
      [[{"name": "shell", "args": {"command": "pwd"}},
        {"name": "shell", "args": {"command": "git status --short"}},
        {"name": "shell", "args": {"command": "git diff HEAD~1 --stat"}}],
       [{"name": "submit_review", "args": {"verdict": "changes", "findings": [
          {"path": "grant.sh", "line": 3, "severity": "blocking", "message": "A grant needs both a name and a key: omitting either is refused and writes nothing: no evidence shows that omitting the name, or omitting the key, is refused"}], "requirements": [
          {"requirement": "A grant needs both a name and a key: omitting either is refused and writes nothing", "evidence": "none", "ref": "", "met": false}]}}],
       [{"name": "shell", "args": {"command": "d=$(mktemp -d) && GRANTS=$d sh grant.sh add '' k1; a=$?; GRANTS=$d sh grant.sh add n1 ''; b=$?; test $a -eq 2 && test $b -eq 2 && test ! -e $d/ledger && printf 'both omissions refused'"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "A grant needs both a name and a key: omitting either is refused and writes nothing", "evidence": "probe", "ref": "d=$(mktemp -d) && GRANTS=$d sh grant.sh add '' k1; a=$?; GRANTS=$d sh grant.sh add n1 ''; b=$?; test $a -eq 2 && test $b -eq 2 && test ! -e $d/ledger && printf 'both omissions refused'", "met": true}]}}]]
      """
    When review-focus-check-before-evidence-only-stop: the review driver reviews the candidate
    Then review-focus-check-before-evidence-only-stop: the checkout's files are still the saved candidate's
    And review-focus-check-before-evidence-only-stop: the review made 3 model requests
    And review-focus-check-before-evidence-only-stop: the last input of request 3 is the tool result:
      """
      invalid verdict:
      requirement "A grant needs both a name and a key: omitting either is refused and writes nothing" has no evidence, and that is the only ground of this changes verdict: no focused check of the candidate has run in this review and no tool or environment limitation is recorded. A missing check is unverified, not a defect of the candidate. Run one focused check of this requirement with shell on the current tree and cite its exact command, or, when it cannot safely run here, submit the same changes verdict with a blocking finding that states the concrete reason it cannot run
      """
    And review-focus-check-before-evidence-only-stop: the review ends with the verdict "approve" and the stop "none"
    And review-focus-check-before-evidence-only-stop: the review record keeps the requirements:
      """
      [{"requirement": "A grant needs both a name and a key: omitting either is refused and writes nothing", "evidence": "probe", "ref": "d=$(mktemp -d) && GRANTS=$d sh grant.sh add '' k1; a=$?; GRANTS=$d sh grant.sh add n1 ''; b=$?; test $a -eq 2 && test $b -eq 2 && test ! -e $d/ledger && printf 'both omissions refused'", "met": true}]
      """
    And review-focus-check-before-evidence-only-stop: the review reports no unverified requirement

  Scenario: A defect shown by a failing check blocks at once
    Given review-focus-check-before-evidence-only-stop: a saved grant candidate
    And review-focus-check-before-evidence-only-stop: the scripted reviewer answers in order:
      """
      [[{"name": "shell", "args": {"command": "d=$(mktemp -d) && GRANTS=$d sh grant.sh add '' k1; test -e $d/ledger"}},
        {"name": "submit_review", "args": {"verdict": "changes", "findings": [
          {"path": "grant.sh", "line": 3, "severity": "blocking", "message": "A grant needs both a name and a key: omitting either is refused and writes nothing: the check shows no ledger after an omitted name"}], "requirements": [
          {"requirement": "A grant needs both a name and a key: omitting either is refused and writes nothing", "evidence": "probe", "ref": "d=$(mktemp -d) && GRANTS=$d sh grant.sh add '' k1; test -e $d/ledger", "met": false}]}}]]
      """
    When review-focus-check-before-evidence-only-stop: the review driver reviews the candidate
    Then review-focus-check-before-evidence-only-stop: the review made 1 model requests
    And review-focus-check-before-evidence-only-stop: the review ends with the verdict "changes" and the stop "candidate/review_blocked"
    And review-focus-check-before-evidence-only-stop: the review record keeps the requirements:
      """
      [{"requirement": "A grant needs both a name and a key: omitting either is refused and writes nothing", "evidence": "probe", "ref": "d=$(mktemp -d) && GRANTS=$d sh grant.sh add '' k1; test -e $d/ledger", "met": false}]
      """
    And review-focus-check-before-evidence-only-stop: the review reports no unverified requirement
    And review-focus-check-before-evidence-only-stop: the checkout's files are still the saved candidate's

  Scenario: Same-tree green evidence approves without extra calls
    Given review-focus-check-before-evidence-only-stop: a saved grant candidate
    And review-focus-check-before-evidence-only-stop: the scripted reviewer answers in order:
      """
      [[{"name": "shell", "args": {"command": "d=$(mktemp -d) && GRANTS=$d sh grant.sh add '' k1; a=$?; GRANTS=$d sh grant.sh add n1 ''; b=$?; test $a -eq 2 && test $b -eq 2 && test ! -e $d/ledger && printf 'both omissions refused'"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "A grant needs both a name and a key: omitting either is refused and writes nothing", "evidence": "probe", "ref": "d=$(mktemp -d) && GRANTS=$d sh grant.sh add '' k1; a=$?; GRANTS=$d sh grant.sh add n1 ''; b=$?; test $a -eq 2 && test $b -eq 2 && test ! -e $d/ledger && printf 'both omissions refused'", "met": true}]}}]]
      """
    When review-focus-check-before-evidence-only-stop: the review driver reviews the candidate
    Then review-focus-check-before-evidence-only-stop: the review made 1 model requests
    And review-focus-check-before-evidence-only-stop: the review ends with the verdict "approve" and the stop "none"
    And review-focus-check-before-evidence-only-stop: the review reports no unverified requirement

  Scenario: A check that could not run is reported unverified and a repeated submission is not prompted again
    Given review-focus-check-before-evidence-only-stop: a saved grant candidate
    And review-focus-check-before-evidence-only-stop: the scripted reviewer answers in order:
      """
      [[{"name": "shell", "args": {"command": "pwd"}}],
       [{"name": "submit_review", "args": {"verdict": "changes", "findings": [
          {"path": "grant.sh", "line": 3, "severity": "blocking", "message": "A grant needs both a name and a key: omitting either is refused and writes nothing: unverified, the focused check could not be run here"}], "requirements": [
          {"requirement": "A grant needs both a name and a key: omitting either is refused and writes nothing", "evidence": "none", "ref": "", "met": false}]}}],
       [{"name": "submit_review", "args": {"verdict": "changes", "findings": [
          {"path": "grant.sh", "line": 3, "severity": "blocking", "message": "A grant needs both a name and a key: omitting either is refused and writes nothing: unverified, the focused check could not be run here"}], "requirements": [
          {"requirement": "A grant needs both a name and a key: omitting either is refused and writes nothing", "evidence": "none", "ref": "", "met": false}]}}]]
      """
    When review-focus-check-before-evidence-only-stop: the review driver reviews the candidate
    Then review-focus-check-before-evidence-only-stop: the checkout's files are still the saved candidate's
    And review-focus-check-before-evidence-only-stop: the review made 3 model requests
    And review-focus-check-before-evidence-only-stop: the last input of request 3 is the tool result:
      """
      invalid verdict:
      requirement "A grant needs both a name and a key: omitting either is refused and writes nothing" has no evidence, and that is the only ground of this changes verdict: no focused check of the candidate has run in this review and no tool or environment limitation is recorded. A missing check is unverified, not a defect of the candidate. Run one focused check of this requirement with shell on the current tree and cite its exact command, or, when it cannot safely run here, submit the same changes verdict with a blocking finding that states the concrete reason it cannot run
      """
    And review-focus-check-before-evidence-only-stop: the review ends with the verdict "changes" and the stop "candidate/review_blocked"
    And review-focus-check-before-evidence-only-stop: the review reports the requirement "A grant needs both a name and a key: omitting either is refused and writes nothing" unverified with the focused check "unavailable"

  Scenario: A check the restriction refused is reported unverified without a request
    Given review-focus-check-before-evidence-only-stop: a saved grant candidate
    And review-focus-check-before-evidence-only-stop: the scripted reviewer answers in order:
      """
      [[{"name": "shell", "args": {"command": "sh grant.sh add n1 k1"}}],
       [{"name": "submit_review", "args": {"verdict": "changes", "findings": [
          {"path": "grant.sh", "line": 3, "severity": "blocking", "message": "A grant needs both a name and a key: omitting either is refused and writes nothing: unverified, the fixture sandbox refused the focused check"}], "requirements": [
          {"requirement": "A grant needs both a name and a key: omitting either is refused and writes nothing", "evidence": "none", "ref": "", "met": false}]}}]]
      """
    When review-focus-check-before-evidence-only-stop: the review driver reviews the candidate under the restriction "fixture sandbox"
    Then review-focus-check-before-evidence-only-stop: the review made 2 model requests
    And review-focus-check-before-evidence-only-stop: the review ends with the verdict "changes" and the stop "candidate/review_blocked"
    And review-focus-check-before-evidence-only-stop: the checkout's files are still the saved candidate's
    And review-focus-check-before-evidence-only-stop: the review reports the requirement "A grant needs both a name and a key: omitting either is refused and writes nothing" unverified with the focused check "refused"

  Scenario: The request is not repeated after the review resumes from its checkpoint
    Given review-focus-check-before-evidence-only-stop: a saved grant candidate
    And review-focus-check-before-evidence-only-stop: the scripted reviewer answers in order:
      """
      [[{"name": "shell", "args": {"command": "pwd"}}],
       [{"name": "submit_review", "args": {"verdict": "changes", "findings": [
          {"path": "grant.sh", "line": 3, "severity": "blocking", "message": "A grant needs both a name and a key: omitting either is refused and writes nothing: unverified, the focused check could not be run here"}], "requirements": [
          {"requirement": "A grant needs both a name and a key: omitting either is refused and writes nothing", "evidence": "none", "ref": "", "met": false}]}}],
       [{"name": "submit_review", "args": {"verdict": "changes", "findings": [
          {"path": "grant.sh", "line": 3, "severity": "blocking", "message": "A grant needs both a name and a key: omitting either is refused and writes nothing: unverified, the focused check could not be run here"}], "requirements": [
          {"requirement": "A grant needs both a name and a key: omitting either is refused and writes nothing", "evidence": "none", "ref": "", "met": false}]}}]]
      """
    When review-focus-check-before-evidence-only-stop: the review driver reviews the candidate, is interrupted before request 3 and resumes from its checkpoint
    Then review-focus-check-before-evidence-only-stop: the checkout's files are still the saved candidate's
    And review-focus-check-before-evidence-only-stop: the review made 3 model requests
    And review-focus-check-before-evidence-only-stop: the review ends with the verdict "changes" and the stop "candidate/review_blocked"
    And review-focus-check-before-evidence-only-stop: the review reports the requirement "A grant needs both a name and a key: omitting either is refused and writes nothing" unverified with the focused check "unavailable"

  Scenario: Evidence of an older tree cannot approve
    Given review-focus-check-before-evidence-only-stop: a saved grant candidate
    And review-focus-check-before-evidence-only-stop: the scripted reviewer answers in order:
      """
      [[{"name": "shell", "args": {"command": "d=$(mktemp -d) && GRANTS=$d sh grant.sh add '' k1; a=$?; GRANTS=$d sh grant.sh add n1 ''; b=$?; test $a -eq 2 && test $b -eq 2 && test ! -e $d/ledger && printf 'both omissions refused'"}}],
       [{"name": "write_file", "args": {"path": "grant.sh", "content": "# edited by the reviewer\ncase $1 in\nadd) echo edited ;;\nesac\n"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "A grant needs both a name and a key: omitting either is refused and writes nothing", "evidence": "probe", "ref": "d=$(mktemp -d) && GRANTS=$d sh grant.sh add '' k1; a=$?; GRANTS=$d sh grant.sh add n1 ''; b=$?; test $a -eq 2 && test $b -eq 2 && test ! -e $d/ledger && printf 'both omissions refused'", "met": true}]}}],
       [{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "A grant needs both a name and a key: omitting either is refused and writes nothing", "evidence": "probe", "ref": "d=$(mktemp -d) && GRANTS=$d sh grant.sh add '' k1; a=$?; GRANTS=$d sh grant.sh add n1 ''; b=$?; test $a -eq 2 && test $b -eq 2 && test ! -e $d/ledger && printf 'both omissions refused'", "met": true}]}}]]
      """
    When review-focus-check-before-evidence-only-stop: the review driver reviews the candidate
    Then review-focus-check-before-evidence-only-stop: the review made 3 model requests
    And review-focus-check-before-evidence-only-stop: the last input of request 3 is the tool result:
      """
      invalid verdict:
      requirement "A grant needs both a name and a key: omitting either is refused and writes nothing" cites probe "d=$(mktemp -d) && GRANTS=$d sh grant.sh add '' k1; a=$?; GRANTS=$d sh grant.sh add n1 ''; b=$?; test $a -eq 2 && test $b -eq 2 && test ! -e $d/ledger && printf 'both omissions refused'", whose latest run in this review was on tree $CANDIDATE_TREE, not on the current tree $CURRENT_TREE: run it again on the current tree before citing it
      """
    And review-focus-check-before-evidence-only-stop: the review ends invalid with the problems:
      """
      ["requirement \"A grant needs both a name and a key: omitting either is refused and writes nothing\" cites probe \"d=$(mktemp -d) && GRANTS=$d sh grant.sh add '' k1; a=$?; GRANTS=$d sh grant.sh add n1 ''; b=$?; test $a -eq 2 && test $b -eq 2 && test ! -e $d/ledger && printf 'both omissions refused'\", whose latest run in this review was on tree $CANDIDATE_TREE, not on the current tree $CURRENT_TREE: run it again on the current tree before citing it"]
      """

  Scenario: A probe that never ran cannot approve
    Given review-focus-check-before-evidence-only-stop: a saved grant candidate
    And review-focus-check-before-evidence-only-stop: the scripted reviewer answers in order:
      """
      [[{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "A grant needs both a name and a key: omitting either is refused and writes nothing", "evidence": "probe", "ref": "sh grant.sh add '' k1", "met": true}]}}],
       [{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "A grant needs both a name and a key: omitting either is refused and writes nothing", "evidence": "probe", "ref": "sh grant.sh add '' k1", "met": true}]}}]]
      """
    When review-focus-check-before-evidence-only-stop: the review driver reviews the candidate
    Then review-focus-check-before-evidence-only-stop: the review made 2 model requests
    And review-focus-check-before-evidence-only-stop: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirement "A grant needs both a name and a key: omitting either is refused and writes nothing" cites a probe that did not run in this review: run its command with shell before citing it
      """
    And review-focus-check-before-evidence-only-stop: the review ends invalid with the problems:
      """
      ["requirement \"A grant needs both a name and a key: omitting either is refused and writes nothing\" cites a probe that did not run in this review: run its command with shell before citing it"]
      """
