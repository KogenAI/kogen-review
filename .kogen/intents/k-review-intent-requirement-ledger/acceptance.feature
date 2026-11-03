Feature: A review approves only what it has tied to evidence, requirement by requirement
  Before its verdict the reviewer names, for each concrete, observable requirement of the approved
  Intent, the evidence that the candidate meets it (an existing test or acceptance step, or a probe
  it ran with shell in this review) in submit_review's requirements. Kogen rejects an approval
  with a requirement that has no evidence, is not met or cites a probe that did not run, and keeps
  the requirements in the review record. The review runs through cmd/kogen-review against a
  loopback OpenAI-compatible fake that serves scripted model answers.

  Background:
    Given the kogen-review command is built from this repository with go build
    And a new Git checkout
    And the checkout's file ".kogen/intents/fixture/intent.md":
      """
      # Add the tally command

      The tally command makes counting easy for everyone.

      - sh tally.sh prints the number of lines it reads on stdin, and 0 when it reads none.
      - sh tally.sh -w prints the number of words it reads on stdin.
      - sh tally.sh -c prints the number of bytes it reads on stdin.
      """
    And the checkout's file ".kogen/intents/fixture/acceptance.feature":
      """
      Feature: Tally
        Scenario: Lines
          When it reads two lines
          Then it prints 2
      """
    And the checkout's file "tally.sh":
      """
      echo 0
      """
    And the checkout's files are committed as the start commit

  Scenario: A requirement the candidate omits is probed and blocks instead of being approved
    Given the checkout's file "tally.sh":
      """
      case "$1" in
      -w) wc -w | tr -d ' ' ;;
      *) awk 'END { print NR }' ;;
      esac
      """
    And the checkout's file "tally_test.sh":
      """
      test "$(printf 'a\nb\n' | sh tally.sh)" = 2 || exit 1
      test "$(printf 'a b\nc\n' | sh tally.sh -w)" = 3 || exit 1
      """
    And the checkout's files are committed as the saved candidate
    And a fake OpenAI-compatible model that answers in order:
      """
      [{"tool": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
         {"requirement": "sh tally.sh prints the number of lines it reads on stdin, and 0 when it reads none.", "evidence": "test", "ref": "tally_test.sh:1", "met": true},
         {"requirement": "sh tally.sh -w prints the number of words it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:2", "met": true},
         {"requirement": "sh tally.sh -c prints the number of bytes it reads on stdin.", "evidence": "none", "ref": "", "met": false}]}},
       {"tool": "shell", "args": {"command": "printf 'ab\\n' | sh tally.sh -c"}},
       {"tool": "submit_review", "args": {"verdict": "changes", "findings": [
         {"path": "tally.sh", "line": 1, "severity": "blocking", "message": "printf 'ab\\n' | sh tally.sh -c prints 1, not 3: sh tally.sh -c prints the number of bytes it reads on stdin."}],
        "requirements": [
         {"requirement": "sh tally.sh prints the number of lines it reads on stdin, and 0 when it reads none.", "evidence": "test", "ref": "tally_test.sh:1", "met": true},
         {"requirement": "sh tally.sh -w prints the number of words it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:2", "met": true},
         {"requirement": "sh tally.sh -c prints the number of bytes it reads on stdin.", "evidence": "probe", "ref": "printf 'ab\\n' | sh tally.sh -c", "met": false}]}}]
      """
    When kogen-review runs with the arguments "-root $CHECKOUT -start HEAD~1 -slug fixture -provider openai-compatible -model fixture-review-model -base-url $BASE_URL"
    Then the exit code is 1
    And stdout is one JSON line equal to:
      """
      {"verdict": "changes",
       "findings": [{"path": "tally.sh", "line": 1, "severity": "blocking", "message": "printf 'ab\\n' | sh tally.sh -c prints 1, not 3: sh tally.sh -c prints the number of bytes it reads on stdin."}],
       "tree": "$CANDIDATE_TREE", "repairs": 0, "run": "$RUN",
       "error": {"class": "candidate", "reason": "review_blocked",
                 "detail": "the reviewer could not resolve a substantive blocker within the approved Intent; edits are left in place",
                 "lines": ["review: tally.sh:1: printf 'ab\\n' | sh tally.sh -c prints 1, not 3: sh tally.sh -c prints the number of bytes it reads on stdin."]},
       "invalid": null}
      """
    And the fake model received 3 requests at "/v1/chat/completions" for the model "fixture-review-model" with the reasoning effort "medium"
    And the last message of request 2 is the tool result:
      """
      invalid verdict:
      requirement "sh tally.sh -c prints the number of bytes it reads on stdin." has no evidence: probe it with shell against the candidate before the verdict
      """
    And the last message of request 3 is the tool result "exit status: 0\n1\n"
    And the run folder's "review-1.json" records the requirements:
      """
      [{"requirement": "sh tally.sh prints the number of lines it reads on stdin, and 0 when it reads none.", "evidence": "test", "ref": "tally_test.sh:1", "met": true},
       {"requirement": "sh tally.sh -w prints the number of words it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:2", "met": true},
       {"requirement": "sh tally.sh -c prints the number of bytes it reads on stdin.", "evidence": "probe", "ref": "printf 'ab\\n' | sh tally.sh -c", "met": false}]
      """
    And the checkout's HEAD, index and files are unchanged

  Scenario: A requirement no test exercises is probed once and, when it holds, approved
    Given the checkout's file "tally.sh":
      """
      case "$1" in
      -w) wc -w | tr -d ' ' ;;
      -c) wc -c | tr -d ' ' ;;
      *) awk 'END { print NR }' ;;
      esac
      """
    And the checkout's file "tally_test.sh":
      """
      test "$(printf 'a\nb\n' | sh tally.sh)" = 2 || exit 1
      test "$(printf 'a b\nc\n' | sh tally.sh -w)" = 3 || exit 1
      """
    And the checkout's files are committed as the saved candidate
    And a fake OpenAI-compatible model that answers in order:
      """
      [{"tool": "shell", "args": {"command": "printf 'ab\\n' | sh tally.sh -c"}},
       {"tool": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
         {"requirement": "sh tally.sh prints the number of lines it reads on stdin, and 0 when it reads none.", "evidence": "test", "ref": "tally_test.sh:1", "met": true},
         {"requirement": "sh tally.sh -w prints the number of words it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:2", "met": true},
         {"requirement": "sh tally.sh -c prints the number of bytes it reads on stdin.", "evidence": "probe", "ref": "printf 'ab\\n' | sh tally.sh -c", "met": true}]}}]
      """
    When kogen-review runs with the arguments "-root $CHECKOUT -start HEAD~1 -slug fixture -provider openai-compatible -model fixture-review-model -base-url $BASE_URL"
    Then the exit code is 0
    And stdout is one JSON line equal to:
      """
      {"verdict": "approve", "findings": [], "tree": "$CANDIDATE_TREE", "repairs": 0, "run": "$RUN", "error": null, "invalid": null}
      """
    And the fake model received 2 requests at "/v1/chat/completions" for the model "fixture-review-model" with the reasoning effort "medium"
    And the last message of request 2 is the tool result "exit status: 0\n3\n"
    And the run folder's "review-1.json" records the requirements:
      """
      [{"requirement": "sh tally.sh prints the number of lines it reads on stdin, and 0 when it reads none.", "evidence": "test", "ref": "tally_test.sh:1", "met": true},
       {"requirement": "sh tally.sh -w prints the number of words it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:2", "met": true},
       {"requirement": "sh tally.sh -c prints the number of bytes it reads on stdin.", "evidence": "probe", "ref": "printf 'ab\\n' | sh tally.sh -c", "met": true}]
      """
    And the checkout's HEAD, index and files are unchanged

  Scenario: Requirements that tests all exercise are approved without a probe in today's two requests
    Given the checkout's file "tally.sh":
      """
      case "$1" in
      -w) wc -w | tr -d ' ' ;;
      -c) wc -c | tr -d ' ' ;;
      *) awk 'END { print NR }' ;;
      esac
      """
    And the checkout's file "tally_test.sh":
      """
      test "$(printf '' | sh tally.sh)" = 0 || exit 1
      test "$(printf 'a\nb\n' | sh tally.sh)" = 2 || exit 1
      test "$(printf 'a b\nc\n' | sh tally.sh -w)" = 3 || exit 1
      test "$(printf 'ab\n' | sh tally.sh -c)" = 3 || exit 1
      """
    And the checkout's files are committed as the saved candidate
    And a fake OpenAI-compatible model that answers in order:
      """
      [{"tool": "read_file", "args": {"path": "tally_test.sh"}},
       {"tool": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
         {"requirement": "sh tally.sh prints the number of lines it reads on stdin, and 0 when it reads none.", "evidence": "test", "ref": "tally_test.sh:1-2", "met": true},
         {"requirement": "sh tally.sh -w prints the number of words it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:3", "met": true},
         {"requirement": "sh tally.sh -c prints the number of bytes it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:4", "met": true}]}}]
      """
    When kogen-review runs with the arguments "-root $CHECKOUT -start HEAD~1 -slug fixture -provider openai-compatible -model fixture-review-model -base-url $BASE_URL"
    Then the exit code is 0
    And stdout is one JSON line equal to:
      """
      {"verdict": "approve", "findings": [], "tree": "$CANDIDATE_TREE", "repairs": 0, "run": "$RUN", "error": null, "invalid": null}
      """
    And the fake model received 2 requests at "/v1/chat/completions" for the model "fixture-review-model" with the reasoning effort "medium"
    And request 1 offered the tools "read_file, view_image, list_files, search_text, write_file, shell, submit_review"
    And request 1 offered submit_review with the requirements parameter:
      """
      {"type": "array",
       "items": {"type": "object",
                 "properties": {"requirement": {"type": "string"},
                                "evidence": {"type": "string", "enum": ["test", "acceptance", "probe", "none"]},
                                "ref": {"type": "string"},
                                "met": {"type": "boolean"}},
                 "required": ["requirement", "evidence", "ref", "met"]}}
      """
    And the system message of request 1 contains:
      """
      Requirements: before any verdict, work through the approved Intent's concrete, observable requirements one by one and name, for each, the evidence that the candidate meets it: an existing test or acceptance step that exercises it, or a probe you ran with shell against the candidate in this review. A test or step is evidence only for the inputs it exercises: when a requirement states or implies an empty, zero or limit input that none exercises, that input needs a probe. Probe each requirement without evidence before the verdict, in your probe round, with a small focused run of the inputs it states or implies, including that empty, zero or limit input. A probe that shows the behavior missing or wrong is a substantive defect: repair it with regression coverage or, when that is not possible within the approved scope, submit changes with a blocking finding whose message quotes the requirement. Sentences that are not observable, such as a statement of purpose, and wording that only restates the acceptance scenarios need no probe of their own. Record the mapping in submit_review's requirements, one entry per requirement: requirement (quoted from the Intent), evidence (test, acceptance, probe, or none while nothing exercises it), ref (the test or acceptance step, or the exact shell command of the probe; empty for none) and met (whether that evidence shows the candidate meets the requirement). Kogen rejects an approval with an entry whose evidence is none or whose met is false and, when it sees your tool calls, one whose probe command did not run in this review; a changes verdict quotes each unmet requirement in a blocking finding.
      """
    And the system message of request 1 contains:
      """
      run your focused probes (each requirement without evidence, stated limits, empty or zero values, error paths) in one combined shell command where possible. Code whose requirements all have evidence usually needs only three rounds: reads, one probe round, then submit_review.
      """
    And the run folder's "review-1.json" records the requirements:
      """
      [{"requirement": "sh tally.sh prints the number of lines it reads on stdin, and 0 when it reads none.", "evidence": "test", "ref": "tally_test.sh:1-2", "met": true},
       {"requirement": "sh tally.sh -w prints the number of words it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:3", "met": true},
       {"requirement": "sh tally.sh -c prints the number of bytes it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:4", "met": true}]
      """

  Scenario: A statement of purpose and a requirement the acceptance states need no probe and no finding
    Given the checkout's file "tally.sh":
      """
      case "$1" in
      -w) wc -w | tr -d ' ' ;;
      -c) wc -c | tr -d ' ' ;;
      *) awk 'END { print NR }' ;;
      esac
      """
    And the checkout's file "tally_test.sh":
      """
      test "$(printf '' | sh tally.sh)" = 0 || exit 1
      test "$(printf 'a b\nc\n' | sh tally.sh -w)" = 3 || exit 1
      test "$(printf 'ab\n' | sh tally.sh -c)" = 3 || exit 1
      """
    And the checkout's files are committed as the saved candidate
    And a fake OpenAI-compatible model that answers in order:
      """
      [{"tool": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
         {"requirement": "sh tally.sh prints the number of lines it reads on stdin, and 0 when it reads none.", "evidence": "acceptance", "ref": "Scenario: Lines; tally_test.sh:1", "met": true},
         {"requirement": "sh tally.sh -w prints the number of words it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:2", "met": true},
         {"requirement": "sh tally.sh -c prints the number of bytes it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:3", "met": true}]}}]
      """
    When kogen-review runs with the arguments "-root $CHECKOUT -start HEAD~1 -slug fixture -provider openai-compatible -model fixture-review-model -base-url $BASE_URL"
    Then the exit code is 0
    And stdout is one JSON line equal to:
      """
      {"verdict": "approve", "findings": [], "tree": "$CANDIDATE_TREE", "repairs": 0, "run": "$RUN", "error": null, "invalid": null}
      """
    And the fake model received 1 requests at "/v1/chat/completions" for the model "fixture-review-model" with the reasoning effort "medium"
    And a message of request 1 contains "The tally command makes counting easy for everyone."
    And the system message of request 1 contains:
      """
      Sentences that are not observable, such as a statement of purpose, and wording that only restates the acceptance scenarios need no probe of their own.
      """
    And the run folder's "review-1.json" records the requirements:
      """
      [{"requirement": "sh tally.sh prints the number of lines it reads on stdin, and 0 when it reads none.", "evidence": "acceptance", "ref": "Scenario: Lines; tally_test.sh:1", "met": true},
       {"requirement": "sh tally.sh -w prints the number of words it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:2", "met": true},
       {"requirement": "sh tally.sh -c prints the number of bytes it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:3", "met": true}]
      """

  Scenario: A requirement broken only on empty input is probed with the empty input and blocks
    Given the checkout's file "tally.sh":
      """
      case "$1" in
      -w) wc -w | tr -d ' ' ;;
      -c) wc -c | tr -d ' ' ;;
      *) sed -n '$=' ;;
      esac
      """
    And the checkout's file "tally_test.sh":
      """
      test "$(printf 'a\nb\n' | sh tally.sh)" = 2 || exit 1
      test "$(printf 'a b\nc\n' | sh tally.sh -w)" = 3 || exit 1
      test "$(printf 'ab\n' | sh tally.sh -c)" = 3 || exit 1
      """
    And the checkout's files are committed as the saved candidate
    And a fake OpenAI-compatible model that answers in order:
      """
      [{"tool": "shell", "args": {"command": "sh tally_test.sh && printf '' | sh tally.sh"}},
       {"tool": "submit_review", "args": {"verdict": "changes", "findings": [
         {"path": "tally.sh", "line": 4, "severity": "blocking", "message": "printf '' | sh tally.sh prints nothing, not 0: sh tally.sh prints the number of lines it reads on stdin, and 0 when it reads none."}],
        "requirements": [
         {"requirement": "sh tally.sh prints the number of lines it reads on stdin, and 0 when it reads none.", "evidence": "probe", "ref": "sh tally_test.sh && printf '' | sh tally.sh", "met": false},
         {"requirement": "sh tally.sh -w prints the number of words it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:2", "met": true},
         {"requirement": "sh tally.sh -c prints the number of bytes it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:3", "met": true}]}}]
      """
    When kogen-review runs with the arguments "-root $CHECKOUT -start HEAD~1 -slug fixture -provider openai-compatible -model fixture-review-model -base-url $BASE_URL"
    Then the exit code is 1
    And stdout is one JSON line equal to:
      """
      {"verdict": "changes",
       "findings": [{"path": "tally.sh", "line": 4, "severity": "blocking", "message": "printf '' | sh tally.sh prints nothing, not 0: sh tally.sh prints the number of lines it reads on stdin, and 0 when it reads none."}],
       "tree": "$CANDIDATE_TREE", "repairs": 0, "run": "$RUN",
       "error": {"class": "candidate", "reason": "review_blocked",
                 "detail": "the reviewer could not resolve a substantive blocker within the approved Intent; edits are left in place",
                 "lines": ["review: tally.sh:4: printf '' | sh tally.sh prints nothing, not 0: sh tally.sh prints the number of lines it reads on stdin, and 0 when it reads none."]},
       "invalid": null}
      """
    And the fake model received 2 requests at "/v1/chat/completions" for the model "fixture-review-model" with the reasoning effort "medium"
    And the last message of request 2 is the tool result "exit status: 0\n"
    And the system message of request 1 contains:
      """
      A test or step is evidence only for the inputs it exercises: when a requirement states or implies an empty, zero or limit input that none exercises, that input needs a probe.
      """
    And the run folder's "review-1.json" records the requirements:
      """
      [{"requirement": "sh tally.sh prints the number of lines it reads on stdin, and 0 when it reads none.", "evidence": "probe", "ref": "sh tally_test.sh && printf '' | sh tally.sh", "met": false},
       {"requirement": "sh tally.sh -w prints the number of words it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:2", "met": true},
       {"requirement": "sh tally.sh -c prints the number of bytes it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:3", "met": true}]
      """
    And the checkout's HEAD, index and files are unchanged

  Scenario: An approval that cites a probe the review did not run is sent back until the probe runs
    Given the checkout's file "tally.sh":
      """
      case "$1" in
      -w) wc -w | tr -d ' ' ;;
      -c) wc -c | tr -d ' ' ;;
      *) awk 'END { print NR }' ;;
      esac
      """
    And the checkout's file "tally_test.sh":
      """
      test "$(printf '' | sh tally.sh)" = 0 || exit 1
      test "$(printf 'a b\nc\n' | sh tally.sh -w)" = 3 || exit 1
      """
    And the checkout's files are committed as the saved candidate
    And a fake OpenAI-compatible model that answers in order:
      """
      [{"tool": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
         {"requirement": "sh tally.sh prints the number of lines it reads on stdin, and 0 when it reads none.", "evidence": "test", "ref": "tally_test.sh:1", "met": true},
         {"requirement": "sh tally.sh -w prints the number of words it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:2", "met": true},
         {"requirement": "sh tally.sh -c prints the number of bytes it reads on stdin.", "evidence": "probe", "ref": "printf 'ab\\n' | sh tally.sh -c", "met": true}]}},
       {"tool": "shell", "args": {"command": "printf 'ab\\n' | sh tally.sh -c"}},
       {"tool": "submit_review", "args": {"verdict": "approve", "findings": [], "requirements": [
         {"requirement": "sh tally.sh prints the number of lines it reads on stdin, and 0 when it reads none.", "evidence": "test", "ref": "tally_test.sh:1", "met": true},
         {"requirement": "sh tally.sh -w prints the number of words it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:2", "met": true},
         {"requirement": "sh tally.sh -c prints the number of bytes it reads on stdin.", "evidence": "probe", "ref": "printf 'ab\\n' | sh tally.sh -c", "met": true}]}}]
      """
    When kogen-review runs with the arguments "-root $CHECKOUT -start HEAD~1 -slug fixture -provider openai-compatible -model fixture-review-model -base-url $BASE_URL"
    Then the exit code is 0
    And stdout is one JSON line equal to:
      """
      {"verdict": "approve", "findings": [], "tree": "$CANDIDATE_TREE", "repairs": 0, "run": "$RUN", "error": null, "invalid": null}
      """
    And the fake model received 3 requests at "/v1/chat/completions" for the model "fixture-review-model" with the reasoning effort "medium"
    And the last message of request 2 is the tool result:
      """
      invalid verdict:
      requirement "sh tally.sh -c prints the number of bytes it reads on stdin." cites a probe that did not run in this review: run its command with shell before citing it
      """
    And the last message of request 3 is the tool result "exit status: 0\n3\n"
    And the run folder's "review-1.json" records the requirements:
      """
      [{"requirement": "sh tally.sh prints the number of lines it reads on stdin, and 0 when it reads none.", "evidence": "test", "ref": "tally_test.sh:1", "met": true},
       {"requirement": "sh tally.sh -w prints the number of words it reads on stdin.", "evidence": "test", "ref": "tally_test.sh:2", "met": true},
       {"requirement": "sh tally.sh -c prints the number of bytes it reads on stdin.", "evidence": "probe", "ref": "printf 'ab\\n' | sh tally.sh -c", "met": true}]
      """
