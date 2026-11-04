Feature: A reviewer check the restriction refused is an environment limitation
  The scripted reviewer reviews a saved helper candidate against the approved requirement
  "Starting the helper creates its lock" under the execution restriction "fixture sandbox", which
  the outer gates do not have. Its check is "sh check-lock.sh", whose output the fixture controls.
  A check counts as refused only when the restriction itself reports the refusal; then it is an
  environment limitation, not a candidate defect, and it is not evidence for the requirement.

  Scenario: A check the reviewer's restriction refused is an environment limitation, and a focused probe that ran establishes the requirement
    Given k-review-denied-check-is-environment: a saved helper candidate whose check "sh check-lock.sh" fails with "bind: operation not permitted" raised by the restriction
    And k-review-denied-check-is-environment: the scripted reviewer answers in order:
      """
      [[{"name": "shell", "args": {"command": "sh check-lock.sh"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "Starting the helper creates its lock", "evidence": "probe", "ref": "sh check-lock.sh", "met": true}]}}],
       [{"name": "shell", "args": {"command": "d=$(mktemp -d) && LOCKDIR=$d sh helper.sh start && test -f \"$d/helper.lock\" && printf 'lock created'"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "Starting the helper creates its lock", "evidence": "probe", "ref": "d=$(mktemp -d) && LOCKDIR=$d sh helper.sh start && test -f \"$d/helper.lock\" && printf 'lock created'", "met": true}]}}]]
      """
    When k-review-denied-check-is-environment: the review driver reviews the candidate under the restriction "fixture sandbox"
    Then k-review-denied-check-is-environment: the review made 2 model requests
    And k-review-denied-check-is-environment: the reviewer was given the output of "sh check-lock.sh" with exit status 1 and the text "bind: operation not permitted"
    And k-review-denied-check-is-environment: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirement "Starting the helper creates its lock" cites probe "sh check-lock.sh", which is unrun-by-environment: the reviewer's restricted execution (fixture sandbox) refused bind: operation not permitted in its latest run, and the outer gates run without this restriction; a check the restriction refused is an environment limitation, neither evidence nor a candidate defect; cite a probe you ran with shell on the current tree that exercises the requirement, or, when nothing can verify it here, submit changes with a blocking finding that quotes the requirement and says its verification could not run
      """
    And k-review-denied-check-is-environment: the review ends with the verdict "approve" and the stop "none"
    And k-review-denied-check-is-environment: the review record keeps no finding against the candidate
    And k-review-denied-check-is-environment: the review record keeps the requirements:
      """
      [{"requirement": "Starting the helper creates its lock", "evidence": "probe", "ref": "d=$(mktemp -d) && LOCKDIR=$d sh helper.sh start && test -f \"$d/helper.lock\" && printf 'lock created'", "met": true}]
      """
    And k-review-denied-check-is-environment: the review record and its result show the environment:
      """
      {"reviewer_restricted": true, "outer_gates_restricted": false, "restriction": "fixture sandbox",
       "limitations": [{"check": "sh check-lock.sh", "refused": ["bind: operation not permitted"]}]}
      """
    And k-review-denied-check-is-environment: Kogen verified no edit of the reviewer
    And k-review-denied-check-is-environment: the checkout's files are still the saved candidate's

  Scenario: A requirement whose only evidence the restriction refused stays unestablished
    Given k-review-denied-check-is-environment: a saved helper candidate whose check "sh check-lock.sh" fails with "bind: operation not permitted" raised by the restriction
    And k-review-denied-check-is-environment: the scripted reviewer answers in order:
      """
      [[{"name": "shell", "args": {"command": "sh check-lock.sh"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "Starting the helper creates its lock", "evidence": "probe", "ref": "sh check-lock.sh", "met": true}]}}],
       [{"name": "submit_review", "args": {"verdict": "changes", "findings": [
          {"path": "check-lock.sh", "line": 1, "severity": "blocking", "message": "Starting the helper creates its lock: not verified; the reviewer's restriction refused the bind its check needs and no other check of it could run in this review"}], "requirements": [
          {"requirement": "Starting the helper creates its lock", "evidence": "probe", "ref": "sh check-lock.sh", "met": false}]}}]]
      """
    When k-review-denied-check-is-environment: the review driver reviews the candidate under the restriction "fixture sandbox"
    Then k-review-denied-check-is-environment: the review made 2 model requests
    And k-review-denied-check-is-environment: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirement "Starting the helper creates its lock" cites probe "sh check-lock.sh", which is unrun-by-environment: the reviewer's restricted execution (fixture sandbox) refused bind: operation not permitted in its latest run, and the outer gates run without this restriction; a check the restriction refused is an environment limitation, neither evidence nor a candidate defect; cite a probe you ran with shell on the current tree that exercises the requirement, or, when nothing can verify it here, submit changes with a blocking finding that quotes the requirement and says its verification could not run
      """
    And k-review-denied-check-is-environment: the review ends with the verdict "changes" and the stop "candidate/review_blocked"
    And k-review-denied-check-is-environment: the review record keeps the requirements:
      """
      [{"requirement": "Starting the helper creates its lock", "evidence": "probe", "ref": "sh check-lock.sh", "met": false}]
      """
    And k-review-denied-check-is-environment: the review record and its result show the environment:
      """
      {"reviewer_restricted": true, "outer_gates_restricted": false, "restriction": "fixture sandbox",
       "limitations": [{"check": "sh check-lock.sh", "refused": ["bind: operation not permitted"]}]}
      """

  Scenario: A permission denied printed by the candidate's own code stays a defect
    Given k-review-denied-check-is-environment: a saved helper candidate whose check "sh check-lock.sh" fails with "permission denied" printed by the candidate's own code
    And k-review-denied-check-is-environment: the scripted reviewer answers in order:
      """
      [[{"name": "shell", "args": {"command": "sh check-lock.sh"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "Starting the helper creates its lock", "evidence": "probe", "ref": "sh check-lock.sh", "met": true}]}}],
       [{"name": "submit_review", "args": {"verdict": "changes", "findings": [
          {"path": "helper.sh", "line": 3, "severity": "blocking", "message": "Starting the helper creates its lock: start refuses with permission denied although access to the lock folder is allowed"}], "requirements": [
          {"requirement": "Starting the helper creates its lock", "evidence": "probe", "ref": "sh check-lock.sh", "met": false}]}}]]
      """
    When k-review-denied-check-is-environment: the review driver reviews the candidate under the restriction "fixture sandbox"
    Then k-review-denied-check-is-environment: the review made 2 model requests
    And k-review-denied-check-is-environment: the reviewer was given the output of "sh check-lock.sh" with exit status 1 and the text "permission denied"
    And k-review-denied-check-is-environment: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirement "Starting the helper creates its lock" cites probe "sh check-lock.sh", whose latest run in this review did not succeed (exit status 1): a probe that did not succeed does not show the requirement met; repair the candidate, or submit changes with a blocking finding that quotes the requirement
      """
    And k-review-denied-check-is-environment: the review ends with the verdict "changes" and the stop "candidate/review_blocked"
    And k-review-denied-check-is-environment: the review record and its result show the environment:
      """
      {"reviewer_restricted": true, "outer_gates_restricted": false, "restriction": "fixture sandbox", "limitations": []}
      """
    And k-review-denied-check-is-environment: the checkout's files are still the saved candidate's

  Scenario: The bind error printed by the candidate's own code is not an environment limitation
    Given k-review-denied-check-is-environment: a saved helper candidate whose check "sh check-lock.sh" fails with "bind: operation not permitted" printed by the candidate's own code
    And k-review-denied-check-is-environment: the scripted reviewer answers in order:
      """
      [[{"name": "shell", "args": {"command": "sh check-lock.sh"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "Starting the helper creates its lock", "evidence": "probe", "ref": "sh check-lock.sh", "met": true}]}}],
       [{"name": "submit_review", "args": {"verdict": "changes", "findings": [
          {"path": "helper.sh", "line": 3, "severity": "blocking", "message": "Starting the helper creates its lock: start fails with its own bind: operation not permitted although access to the lock folder is allowed"}], "requirements": [
          {"requirement": "Starting the helper creates its lock", "evidence": "probe", "ref": "sh check-lock.sh", "met": false}]}}]]
      """
    When k-review-denied-check-is-environment: the review driver reviews the candidate under the restriction "fixture sandbox"
    Then k-review-denied-check-is-environment: the review made 2 model requests
    And k-review-denied-check-is-environment: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirement "Starting the helper creates its lock" cites probe "sh check-lock.sh", whose latest run in this review did not succeed (exit status 1): a probe that did not succeed does not show the requirement met; repair the candidate, or submit changes with a blocking finding that quotes the requirement
      """
    And k-review-denied-check-is-environment: the review ends with the verdict "changes" and the stop "candidate/review_blocked"
    And k-review-denied-check-is-environment: the review record and its result show the environment:
      """
      {"reviewer_restricted": true, "outer_gates_restricted": false, "restriction": "fixture sandbox", "limitations": []}
      """
