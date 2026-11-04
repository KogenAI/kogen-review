Feature: Requirement evidence is observed on the current tree
  The scripted reviewer reviews a saved parcel candidate against the approved requirement
  "Replacing a parcel preserves its receipt", whose acceptance scenario is "Replace a parcel and
  read its receipt". A ledger entry establishes the requirement only with evidence observed on the
  current tree: an acceptance scenario that passed there, or a probe that ran there, succeeded and
  exercised the candidate.

  Scenario: An acceptance scenario that did not run does not establish the requirement
    Given k-review-unrun-evidence-not-met: a saved parcel candidate
    And k-review-unrun-evidence-not-met: the scripted reviewer answers in order:
      """
      [[{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "Replacing a parcel preserves its receipt", "evidence": "acceptance", "ref": "Replace a parcel and read its receipt", "met": true}]}}],
       [{"name": "submit_review", "args": {"verdict": "changes", "findings": [
          {"path": "parcel.sh", "line": 4, "severity": "blocking", "message": "Replacing a parcel preserves its receipt: not verified; acceptance did not run on this tree and no check of it could run in this review"}], "requirements": [
          {"requirement": "Replacing a parcel preserves its receipt", "evidence": "none", "ref": "", "met": false}]}}]]
      """
    When k-review-unrun-evidence-not-met: the review driver reviews the candidate given the pass "not_run"
    Then k-review-unrun-evidence-not-met: the review was given a green pass of the candidate that records acceptance not_run
    And k-review-unrun-evidence-not-met: the review made 2 model requests
    And k-review-unrun-evidence-not-met: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirement "Replacing a parcel preserves its receipt" cites acceptance "Replace a parcel and read its receipt", which did not run on the current tree (not_run): naming a scenario is not evidence; cite a probe you ran with shell on the current tree that exercises the requirement, or, when nothing can verify it here, submit changes with a blocking finding that quotes the requirement and says its verification could not run
      """
    And k-review-unrun-evidence-not-met: the review ends with the verdict "changes" and the stop "candidate/review_blocked"
    And k-review-unrun-evidence-not-met: the review record keeps the requirements:
      """
      [{"requirement": "Replacing a parcel preserves its receipt", "evidence": "none", "ref": "", "met": false}]
      """

  Scenario: A requirement whose evidence was refused cannot be dropped from a later approval
    Given k-review-unrun-evidence-not-met: a saved parcel candidate
    And k-review-unrun-evidence-not-met: the scripted reviewer answers in order:
      """
      [[{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "Replacing a parcel preserves its receipt", "evidence": "acceptance", "ref": "Replace a parcel and read its receipt", "met": true}]}}],
       [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]]
      """
    When k-review-unrun-evidence-not-met: the review driver reviews the candidate given the pass "not_run"
    Then k-review-unrun-evidence-not-met: the review made 2 model requests
    And k-review-unrun-evidence-not-met: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirement "Replacing a parcel preserves its receipt" cites acceptance "Replace a parcel and read its receipt", which did not run on the current tree (not_run): naming a scenario is not evidence; cite a probe you ran with shell on the current tree that exercises the requirement, or, when nothing can verify it here, submit changes with a blocking finding that quotes the requirement and says its verification could not run
      """
    And k-review-unrun-evidence-not-met: the review ends invalid with the problems:
      """
      ["requirement \"Replacing a parcel preserves its receipt\" was listed by an earlier submission of this review and is missing: keep every requirement in requirements, with evidence observed on the current tree"]
      """

  Scenario: An acceptance scenario that failed on the current tree contradicts a met entry
    Given k-review-unrun-evidence-not-met: a saved parcel candidate
    And k-review-unrun-evidence-not-met: the scripted reviewer answers in order:
      """
      [[{"name": "write_file", "args": {"path": "parcel.sh", "content": "# parcel.sh: parcels kept as files of the folder $PARCELS, each holding its receipt.\ncase \"$1\" in\nadd) printf '%s\\n' \"$3\" > \"$PARCELS/$2\" ;;\nreplace) rm \"$PARCELS/$2\" && : > \"$PARCELS/$2\" ;;\nreceipt) cat \"$PARCELS/$2\" ;;\nesac\n"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": []}}],
       [{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "Replacing a parcel preserves its receipt", "evidence": "acceptance", "ref": "Replace a parcel and read its receipt", "met": true}]}}],
       [{"name": "submit_review", "args": {"verdict": "changes", "findings": [
          {"path": "parcel.sh", "line": 4, "severity": "blocking", "message": "Replacing a parcel preserves its receipt: the replacement empties the receipt"}], "requirements": [
          {"requirement": "Replacing a parcel preserves its receipt", "evidence": "acceptance", "ref": "Replace a parcel and read its receipt", "met": false}]}}]]
      """
    When k-review-unrun-evidence-not-met: the review driver reviews the candidate given the pass "verified"
    Then k-review-unrun-evidence-not-met: the review was given a green pass of the candidate in which the scenario "Replace a parcel and read its receipt" passed
    And k-review-unrun-evidence-not-met: the review made 3 model requests
    And k-review-unrun-evidence-not-met: the last input of request 3 is the tool result:
      """
      invalid verdict:
      requirement "Replacing a parcel preserves its receipt" cites acceptance scenario "Replace a parcel and read its receipt", which failed on the current tree: the observed result contradicts met; repair the candidate, or submit changes with a blocking finding that quotes the requirement
      """
    And k-review-unrun-evidence-not-met: Kogen verified the reviewer's edit once, and the scenario "Replace a parcel and read its receipt" "failed" on the current tree
    And k-review-unrun-evidence-not-met: the review ends with the verdict "changes" and the stop "candidate/review_blocked"

  Scenario: An acceptance scenario that passed on the exact current tree establishes the requirement without a probe
    Given k-review-unrun-evidence-not-met: a saved parcel candidate
    And k-review-unrun-evidence-not-met: the scripted reviewer answers in order:
      """
      [[{"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "Replacing a parcel preserves its receipt", "evidence": "acceptance", "ref": "Replace a parcel and read its receipt", "met": true}]}}]]
      """
    When k-review-unrun-evidence-not-met: kogen-review reviews the candidate
    Then k-review-unrun-evidence-not-met: the review was given a green pass of the candidate in which the scenario "Replace a parcel and read its receipt" passed
    And k-review-unrun-evidence-not-met: the review made 1 model requests
    And k-review-unrun-evidence-not-met: the review ends with the verdict "approve" and the stop "none"
    And k-review-unrun-evidence-not-met: the review record keeps the requirements:
      """
      [{"requirement": "Replacing a parcel preserves its receipt", "evidence": "acceptance", "ref": "Replace a parcel and read its receipt", "met": true}]
      """

  Scenario: An acceptance pass of an older tree is history once the receipt handling changes
    Given k-review-unrun-evidence-not-met: a saved parcel candidate
    And k-review-unrun-evidence-not-met: the scripted reviewer answers in order:
      """
      [[{"name": "write_file", "args": {"path": "parcel.sh", "content": "# parcel.sh: parcels kept as files of the folder $PARCELS, each holding its receipt.\ncase \"$1\" in\nadd) printf '%s\\n' \"$3\" > \"$PARCELS/$2\" ;;\nreplace) cp \"$PARCELS/$2\" \"$PARCELS/$2.new\" && mv \"$PARCELS/$2.new\" \"$PARCELS/$2\" ;;\nreceipt) cat \"$PARCELS/$2\" ;;\nesac\n"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "Replacing a parcel preserves its receipt", "evidence": "acceptance", "ref": "Replace a parcel and read its receipt", "met": true}]}}],
       [{"name": "submit_review", "args": {"verdict": "changes", "findings": [
          {"path": "parcel.sh", "line": 4, "severity": "blocking", "message": "Replacing a parcel preserves its receipt: not verified on the changed tree; its acceptance result is of the earlier tree and no check of the change could run in this review"}], "requirements": [
          {"requirement": "Replacing a parcel preserves its receipt", "evidence": "none", "ref": "", "met": false}]}}]]
      """
    When k-review-unrun-evidence-not-met: kogen-review reviews the candidate
    Then k-review-unrun-evidence-not-met: the review was given a green pass of the candidate in which the scenario "Replace a parcel and read its receipt" passed
    And k-review-unrun-evidence-not-met: the review made 2 model requests
    And k-review-unrun-evidence-not-met: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirement "Replacing a parcel preserves its receipt" cites acceptance "Replace a parcel and read its receipt", whose result is of tree $CANDIDATE_TREE, not of the current tree $CURRENT_TREE: an earlier result is history and does not establish the requirement on the current tree; cite a probe you ran with shell on the current tree that exercises the requirement, or, when nothing can verify it here, submit changes with a blocking finding that quotes the requirement and says its verification could not run
      """
    And k-review-unrun-evidence-not-met: the review ends with the verdict "changes" and the stop "candidate/review_blocked"

  Scenario: A focused probe on the current tree establishes the requirement when acceptance cannot run, and echo ok does not
    Given k-review-unrun-evidence-not-met: a saved parcel candidate
    And k-review-unrun-evidence-not-met: the scripted reviewer answers in order:
      """
      [[{"name": "shell", "args": {"command": "echo ok"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "Replacing a parcel preserves its receipt", "evidence": "probe", "ref": "echo ok", "met": true}]}}],
       [{"name": "shell", "args": {"command": "d=$(mktemp -d) && PARCELS=$d sh parcel.sh add P-1 R-1 && PARCELS=$d sh parcel.sh replace P-1 && test \"$(PARCELS=$d sh parcel.sh receipt P-1)\" = R-1 && printf 'receipt kept'"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
          {"requirement": "Replacing a parcel preserves its receipt", "evidence": "probe", "ref": "d=$(mktemp -d) && PARCELS=$d sh parcel.sh add P-1 R-1 && PARCELS=$d sh parcel.sh replace P-1 && test \"$(PARCELS=$d sh parcel.sh receipt P-1)\" = R-1 && printf 'receipt kept'", "met": true}]}}]]
      """
    When k-review-unrun-evidence-not-met: the review driver reviews the candidate given the pass "not_run"
    Then k-review-unrun-evidence-not-met: the review made 2 model requests
    And k-review-unrun-evidence-not-met: the last input of request 2 is the tool result:
      """
      invalid verdict:
      requirement "Replacing a parcel preserves its receipt" cites probe "echo ok", which names no file or directory of the current tree: a probe is evidence only when it exercises the candidate; run a focused probe of the requirement with shell on the current tree and cite its exact command
      """
    And k-review-unrun-evidence-not-met: the review ends with the verdict "approve" and the stop "none"
    And k-review-unrun-evidence-not-met: Kogen verified no edit of the reviewer
    And k-review-unrun-evidence-not-met: the review record keeps the requirements:
      """
      [{"requirement": "Replacing a parcel preserves its receipt", "evidence": "probe", "ref": "d=$(mktemp -d) && PARCELS=$d sh parcel.sh add P-1 R-1 && PARCELS=$d sh parcel.sh replace P-1 && test \"$(PARCELS=$d sh parcel.sh receipt P-1)\" = R-1 && printf 'receipt kept'", "met": true}]
      """
