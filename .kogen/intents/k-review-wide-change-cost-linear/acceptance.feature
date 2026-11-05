Feature: Reviewing a wide change in parts costs about linearly in what the reviewer reads
  An external review (review.NewExternal over a scripted executor, through the review driver
  features/steps/k-review-wide-change-cost-linear__driver.js) of a saved candidate whose complete
  review prompt does not fit the inclusive 524288-byte ceiling is reviewed in ordered parts, each
  in its own fresh session. Every part carries the complete authority (its stable text), its
  position, the check results, its changed-path section and one consecutive slice of the review
  source. When the JSON catalog of every changed path is longer than 6000 bytes, a part's
  changed-path section carries only the catalog entries of the paths whose material its slice
  carries and names the retained catalog (review-1-material.json, "parts"). A large generated data
  file is checked against the command that regenerates it before anything is sent. The fixtures'
  commits have fixed dates, so their prompts are the same bytes in every run; the prompts the
  review sent before this Intent are pinned by their SHA-256.

  Scenario: A change that needs six or more parts costs at most twice its review source
    Given k-review-wide-change-cost-linear: a saved candidate that changes a.txt, deletes d.txt and adds 6 files of 9000 lines and 3000 tiny files
    And k-review-wide-change-cost-linear: the reviewer of every part approves without repairs
    When k-review-wide-change-cost-linear: the review runs
    Then k-review-wide-change-cost-linear: the review approves in at least 6 parts, each delivered in its own session
    And k-review-wide-change-cost-linear: the review's total input is at most twice its review source
    And k-review-wide-change-cost-linear: every part is sent the same stable text, and its text apart from its source slice and its catalog entries is at most 8192 bytes
    And k-review-wide-change-cost-linear: the parts carry the whole review source once, in order
    And k-review-wide-change-cost-linear: every part's measured prompt is at most 524288 bytes and is what its material evidence records

  Scenario: A change of 3000 tiny paths is reviewed in parts and sent, each part bounded by the paths it carries
    Given k-review-wide-change-cost-linear: a saved candidate that changes a.txt, deletes d.txt and adds 6 files of 9000 lines and 3000 tiny files
    And k-review-wide-change-cost-linear: the reviewer of every part approves without repairs
    When k-review-wide-change-cost-linear: the review runs
    Then k-review-wide-change-cost-linear: the review approves in at least 2 parts, each delivered in its own session
    And k-review-wide-change-cost-linear: every sent part carries exactly the catalog entries of the paths whose material its source carries and names the retained catalog of 3008 paths
    And k-review-wide-change-cost-linear: every part's text apart from its source slice is at most 8192 bytes plus 600 bytes per catalog entry it carries
    And k-review-wide-change-cost-linear: the retained review material lists every changed path with its full details

  Scenario: A part that was never read refuses approval and names the part
    Given k-review-wide-change-cost-linear: a saved candidate that changes a.txt, deletes d.txt and adds 6 files of 9000 lines and 600 tiny files
    And k-review-wide-change-cost-linear: the reviewer of part 2 answers under another session's handle and approves
    When k-review-wide-change-cost-linear: the review runs
    Then k-review-wide-change-cost-linear: the review stops with "candidate/context_custody_invalid" after 2 sessions
    And k-review-wide-change-cost-linear: the stop's detail, with N the number of parts the review material records, is:
      """
      the review material of part 2 of <N> was not completely delivered in a completed round of the reviewer session; nothing was committed and custody is preserved
      """
    And k-review-wide-change-cost-linear: every sent part carries exactly the catalog entries of the paths whose material its source carries and names the retained catalog of 608 paths

  Scenario: A part whose retained text changed after it was read blocks approval
    Given k-review-wide-change-cost-linear: a saved candidate that changes a.txt, deletes d.txt and adds 6 files of 9000 lines and 600 tiny files
    And k-review-wide-change-cost-linear: the reviewer of part 2 appends to the retained text of its part and approves
    When k-review-wide-change-cost-linear: the review runs
    Then k-review-wide-change-cost-linear: the review stops with "candidate/context_custody_invalid" after 2 sessions
    And k-review-wide-change-cost-linear: the stop's detail is:
      """
      the retained review material review-1-part-2.txt changed; nothing was committed and custody is preserved
      """
    And k-review-wide-change-cost-linear: every sent part carries exactly the catalog entries of the paths whose material its source carries and names the retained catalog of 608 paths

  Scenario: A blocking finding in a middle part stops the later parts
    Given k-review-wide-change-cost-linear: a saved candidate that changes a.txt, deletes d.txt and adds 6 files of 9000 lines and 600 tiny files
    And k-review-wide-change-cost-linear: the reviewer of part 3 submits changes with the findings:
      """
      [{"path": "a.txt", "line": 2, "severity": "blocking", "message": "ALPHA is not a word"}]
      """
    When k-review-wide-change-cost-linear: the review runs
    Then k-review-wide-change-cost-linear: the review stops with "candidate/review_blocked" after 3 sessions
    And k-review-wide-change-cost-linear: the review material records at least 4 parts
    And k-review-wide-change-cost-linear: the review's findings are:
      """
      [{"path": "a.txt", "line": 2, "severity": "blocking", "message": "ALPHA is not a word"}]
      """
    And k-review-wide-change-cost-linear: every sent part carries exactly the catalog entries of the paths whose material its source carries and names the retained catalog of 608 paths

  Scenario: A repair of a path outside its part's slice is verified and named to every later part
    Given k-review-wide-change-cost-linear: a saved candidate that changes a.txt, deletes d.txt and adds 6 files of 9000 lines and 600 tiny files
    And k-review-wide-change-cost-linear: the reviewer of part 1 repairs the files:
      """
      {"tiny/t-0600.txt": "tiny 0600 repaired\n"}
      """
    When k-review-wide-change-cost-linear: the review runs
    Then k-review-wide-change-cost-linear: the review approves in at least 4 parts, each delivered in its own session
    And k-review-wide-change-cost-linear: Kogen verified the candidate 1 time
    And k-review-wide-change-cost-linear: part 1 does not carry the catalog entry of "tiny/t-0600.txt"
    And k-review-wide-change-cost-linear: every part after the first lists the repaired paths '["tiny/t-0600.txt"]'
    And k-review-wide-change-cost-linear: every sent part carries exactly the catalog entries of the paths whose material its source carries and names the retained catalog of 608 paths
    And k-review-wide-change-cost-linear: the retained review material lists every changed path with its full details

  Scenario: A large generated data file reaches the reviewer as its digest and regenerating command
    Given k-review-wide-change-cost-linear: a saved candidate that adds a file of 44000 lines and data/table.csv exactly as its generator gen/table.sh writes it
    And k-review-wide-change-cost-linear: the reviewer of every part approves without repairs
    When k-review-wide-change-cost-linear: the review runs
    Then k-review-wide-change-cost-linear: the review approves in at least 2 parts, each delivered in its own session
    And k-review-wide-change-cost-linear: exactly one part carries, and no part carries "row 1234,value 1234" of the data file, the line:
      """
      --- data/table.csv (added; mode 100644; generated: 57836 bytes, SHA-256 ca6a61c86cfb1d2221f344d13502b3daf83f5ec8cd1b0eff46584266a60bf955; regenerated by `sh gen/table.sh` with identical output; full text in the checkout)
      """
    And k-review-wide-change-cost-linear: the review material records the generated files:
      """
      [{"path": "data/table.csv", "command": "sh gen/table.sh", "sha256": "ca6a61c86cfb1d2221f344d13502b3daf83f5ec8cd1b0eff46584266a60bf955", "outcome": "summarised"}]
      """
    And k-review-wide-change-cost-linear: the retained review material lists every changed path with its full details
    And k-review-wide-change-cost-linear: the parts carry the whole review source once, in order

  Scenario: A large generated data file that does not match its regenerated output is a blocking finding
    Given k-review-wide-change-cost-linear: a saved candidate that adds a file of 44000 lines and data/table.csv as gen/table.sh writes it but with row 1234 changed
    And k-review-wide-change-cost-linear: the reviewer of every part approves without repairs
    When k-review-wide-change-cost-linear: the review runs
    Then k-review-wide-change-cost-linear: the review stops with "candidate/review_blocked" after 0 sessions
    And k-review-wide-change-cost-linear: the review's findings are:
      """
      [{"path": "data/table.csv", "line": 1, "severity": "blocking", "message": "generated file data/table.csv does not match the output of its regenerating command `sh gen/table.sh`: reviewed SHA-256 51240c73edfc6daa86da13e256c3fa06a9d48c32c87b3e944589acd528f4d5c0, regenerated SHA-256 ca6a61c86cfb1d2221f344d13502b3daf83f5ec8cd1b0eff46584266a60bf955"}]
      """

  Scenario: A change that fits one session sends the same request bytes as before
    Given k-review-wide-change-cost-linear: a saved candidate that changes a.txt only
    And k-review-wide-change-cost-linear: the reviewer of every part approves without repairs
    When k-review-wide-change-cost-linear: the review runs
    Then k-review-wide-change-cost-linear: every session is sent exactly the prompt it was sent before this Intent:
      | session | prompt bytes | stable sha256                                                    | dynamic sha256                                                   |
      | 1       | 20928        | c17f28429cc949fe83832ded1691f02d9b23c03227458efefc3ae3795c813398 | 9b22b6bbf60af796b604d560a672a686a2ffb05b79d90b8a15e66ed09c78c271 |

  Scenario: A change in parts that touches only a few paths sends the same request bytes as before
    Given k-review-wide-change-cost-linear: a saved candidate that changes a.txt and adds a file of 44000 lines
    And k-review-wide-change-cost-linear: the reviewer of every part approves without repairs
    When k-review-wide-change-cost-linear: the review runs
    Then k-review-wide-change-cost-linear: every session is sent exactly the prompt it was sent before this Intent:
      | session | prompt bytes | stable sha256                                                    | dynamic sha256                                                   |
      | 1       | 524262       | 206a31b3cee10cf103d96f72caa9a6737caa954eaf783f620c5678026a0efbe0 | b0112a28069805ef1fe0e8e9c423974f361f0754ffde18b3d09fb6752f294a64 |
      | 2       | 524274       | 206a31b3cee10cf103d96f72caa9a6737caa954eaf783f620c5678026a0efbe0 | c08b83b8f61f1474c5d8266f4ab28f1ca614139f9866ef815a270316cb34d7ad |
      | 3       | 337406       | 206a31b3cee10cf103d96f72caa9a6737caa954eaf783f620c5678026a0efbe0 | 1e276e55446341c31657f665044089a4293fc218567ead52754fde73e2b79e7c |

  Scenario: Non-source material that leaves no room for source stops before anything is sent, names it and keeps the limits
    Given k-review-wide-change-cost-linear: a saved candidate whose start README.md has 12000 lines and that changes a.txt
    And k-review-wide-change-cost-linear: the reviewer of every part approves without repairs
    When k-review-wide-change-cost-linear: the review runs
    Then k-review-wide-change-cost-linear: the review stops with "candidate/context_budget_exceeded" after 0 sessions
    And k-review-wide-change-cost-linear: the stop's detail is:
      """
      review: mandatory review prompt of executor fixture-executor is 585578 bytes without candidate source; fewer than 6000 bytes remain for source under the inclusive 524288-byte ceiling; nothing was sent. Inspect the run evidence; ordinary Refine and new exact approval are required if the Intent, README or diagnostic context must shrink.
      """

  Scenario: The review adds no command or flag
    Then k-review-wide-change-cost-linear: the checkout's cmd folder holds only "kogen-review"
    And k-review-wide-change-cost-linear: kogen-review defines exactly the flags "root, start, slug, provider, model, effort, base-url"
