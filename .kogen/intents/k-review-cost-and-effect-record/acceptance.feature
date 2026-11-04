Feature: Every review records what it cost and what it changed
  A scripted reviewer, whose every model call (a native model request or an external executor
  round) reports the same fixed usage, reviews a saved candidate of a Git checkout against the
  approved Intent "fixture". The review's result carries its account: the requests, input,
  cached and output tokens and wall time the review used, its repair rounds and its effect, with
  the same cost totals for the whole attempt and the review's share of them. The account is
  observability only: every review here ends as it does without it.

  Background:
    Given k-review-cost-and-effect-record: a saved candidate whose files are, at its start commit and in the candidate:
      """
      {"start": {"app.txt": "one\ntwo\nthree\n", "lib.txt": "alpha\nbeta\n"},
       "candidate": {"app.txt": "one\n2\nthree\n"}}
      """
    And k-review-cost-and-effect-record: every call of the scripted reviewer reports 1500 input, 500 cached and 150 output tokens and takes 100 ms

  Scenario: An approval without edits records its cost, no repair round and an unchanged first tree that passed
    Given k-review-cost-and-effect-record: the native reviewer answers in order:
      """
      [[{"name": "read_file", "args": {"path": "app.txt"}}],
       [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]]
      """
    When k-review-cost-and-effect-record: the review runs
    Then k-review-cost-and-effect-record: the review ends with the verdict "approve" and the stop "none"
    And k-review-cost-and-effect-record: the review's account records 2 requests, 3000 input, 1000 cached and 300 output tokens
    And k-review-cost-and-effect-record: the review's account records at least 200 ms of wall time and no more than the driver measured inside the review's calls
    And k-review-cost-and-effect-record: the review's account records 0 repair rounds
    And k-review-cost-and-effect-record: the review's account records the effect:
      """
      {"tree_changed": false, "files_changed": 0, "lines_added": 0, "lines_deleted": 0,
       "blockers": 0, "defects": [], "first_tree_green": true}
      """

  Scenario: A reviewer that edits two files and approves after a repair round records the exact files and lines it changed
    Given k-review-cost-and-effect-record: the native reviewer answers in order:
      """
      [[{"name": "write_file", "args": {"path": "app.txt", "content": "one\ntwo\nthree\nfour\n"}},
        {"name": "write_file", "args": {"path": "lib.txt", "content": "alpha\nBETA\ngamma\n"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": []}}],
       [{"name": "write_file", "args": {"path": "lib.txt", "content": "alpha\nBETA\n"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]]
      """
    And k-review-cost-and-effect-record: Kogen's verifications of the candidate are in order "red, green"
    When k-review-cost-and-effect-record: the review runs
    Then k-review-cost-and-effect-record: the review ends with the verdict "approve" and the stop "none"
    And k-review-cost-and-effect-record: the review's account records 2 requests, 3000 input, 1000 cached and 300 output tokens
    And k-review-cost-and-effect-record: the review's account records 1 repair rounds
    And k-review-cost-and-effect-record: the review's account records the effect:
      """
      {"tree_changed": true, "files_changed": 2, "lines_added": 3, "lines_deleted": 2,
       "blockers": 0, "defects": [], "first_tree_green": false}
      """

  Scenario: A blocker naming a defect, resumed and approved after the reviewer's repair, is counted once with its defect
    Given k-review-cost-and-effect-record: every call of the scripted reviewer reports 1500 input, 500 cached and 150 output tokens and takes 300 ms
    And k-review-cost-and-effect-record: the native reviewer answers in order:
      """
      [[{"name": "read_file", "args": {"path": "app.txt"}}],
       [{"name": "submit_review", "args": {"verdict": "changes", "findings": [
          {"path": "app.txt", "line": 2, "severity": "blocking", "message": "app.txt counts 2 in digits where the Intent requires two"}]}}],
       [{"name": "write_file", "args": {"path": "app.txt", "content": "one\ntwo\nthree\n"}},
        {"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]]
      """
    And k-review-cost-and-effect-record: Kogen's verifications of the candidate are in order "green, green"
    When k-review-cost-and-effect-record: the review runs, stops blocked and, after a pause of 1000 ms, is resumed from its latest checkpoint
    Then k-review-cost-and-effect-record: its first call ended with the verdict "changes" and the stop "candidate/review_blocked", and the resumed checkpoint of the stage "review_verify" kept at least 600 ms of wall time and the blockers:
      """
      ["app.txt:2: app.txt counts 2 in digits where the Intent requires two"]
      """
    And k-review-cost-and-effect-record: the review ends with the verdict "approve" and the stop "none"
    And k-review-cost-and-effect-record: the review's account records 3 requests, 4500 input, 1500 cached and 450 output tokens
    And k-review-cost-and-effect-record: the review's account records at least 900 ms of wall time and no more than the driver measured inside the review's calls
    And k-review-cost-and-effect-record: the review's account records 0 repair rounds
    And k-review-cost-and-effect-record: the review's account records the effect:
      """
      {"tree_changed": true, "files_changed": 1, "lines_added": 1, "lines_deleted": 1,
       "blockers": 1, "defects": ["app.txt:2: app.txt counts 2 in digits where the Intent requires two"], "first_tree_green": false}
      """

  Scenario: A review in two parts sums the usage of both parts once and records the elapsed span as its wall time
    Given k-review-cost-and-effect-record: a saved candidate that adds two files of 10000 lines each, too large for one review prompt
    And k-review-cost-and-effect-record: every call of the scripted reviewer reports 1500 input, 500 cached and 150 output tokens and takes 300 ms
    And k-review-cost-and-effect-record: the reviewer's executor state in the Build already holds 7000 input, 2000 cached and 700 output tokens
    And k-review-cost-and-effect-record: the external reviewer's rounds return in order:
      """
      [{"verdict": "approve", "findings": []}, {"verdict": "approve", "findings": []}]
      """
    And k-review-cost-and-effect-record: Kogen takes 600 ms to record the pending review between the parts
    When k-review-cost-and-effect-record: the review runs
    Then k-review-cost-and-effect-record: the review ends with the verdict "approve" and the stop "none"
    And k-review-cost-and-effect-record: the review was reviewed in 2 parts
    And k-review-cost-and-effect-record: the review's account records 2 requests, 3000 input, 1000 cached and 300 output tokens
    And k-review-cost-and-effect-record: the review's account records at least 1200 ms of wall time and no more than the driver measured inside the review's calls
    And k-review-cost-and-effect-record: the review's account records 0 repair rounds
    And k-review-cost-and-effect-record: the review's account records the effect:
      """
      {"tree_changed": false, "files_changed": 0, "lines_added": 0, "lines_deleted": 0,
       "blockers": 0, "defects": [], "first_tree_green": true}
      """

  Scenario: A review that stops on an error records the cost and the effect so far
    Given k-review-cost-and-effect-record: the native reviewer answers in order:
      """
      [[{"name": "write_file", "args": {"path": "app.txt", "content": "one\ntwo\nthree\n"}}],
       {"error": "the scripted provider is unavailable"}]
      """
    When k-review-cost-and-effect-record: the review runs
    Then k-review-cost-and-effect-record: the review ends with the verdict "error" and the stop "provider/scripted_failure"
    And k-review-cost-and-effect-record: the review's account records 2 requests, 1500 input, 500 cached and 150 output tokens
    And k-review-cost-and-effect-record: the review's account records at least 200 ms of wall time and no more than the driver measured inside the review's calls
    And k-review-cost-and-effect-record: the review's account records 0 repair rounds
    And k-review-cost-and-effect-record: the review's account records the effect:
      """
      {"tree_changed": true, "files_changed": 1, "lines_added": 1, "lines_deleted": 1,
       "blockers": 0, "defects": [], "first_tree_green": false}
      """

  Scenario: The attempt's totals are the builder's usage plus the review's, and the review's share is their division
    Given k-review-cost-and-effect-record: the native reviewer answers in order:
      """
      [[{"name": "read_file", "args": {"path": "app.txt"}}],
       [{"name": "submit_review", "args": {"verdict": "approve", "findings": []}}]]
      """
    And k-review-cost-and-effect-record: the attempt before the review used 6 requests, 9000 input, 3000 cached and 1700 output tokens and 4000 ms
    When k-review-cost-and-effect-record: the review runs
    Then k-review-cost-and-effect-record: the review ends with the verdict "approve" and the stop "none"
    And k-review-cost-and-effect-record: the review's account records 2 requests, 3000 input, 1000 cached and 300 output tokens
    And k-review-cost-and-effect-record: the attempt's account records 8 requests, 12000 input, 4000 cached and 2000 output tokens and 4000 ms plus the review's wall time
    And k-review-cost-and-effect-record: the review's share of the attempt is 0.25 of the requests, 0.25 of the input, 0.25 of the cached and 0.15 of the output tokens, and its wall time divided by the attempt's
