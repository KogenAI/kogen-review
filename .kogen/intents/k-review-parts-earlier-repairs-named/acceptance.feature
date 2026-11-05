Feature: Later review parts name the paths earlier parts repaired
  A saved candidate whose review source needs three parts is reviewed by a scripted external
  reviewer (review.NewExternal over a scripted executor). Each part is its own fresh session. A
  reviewer of a part may write files in the checkout and approve; Kogen verifies the repaired
  tree (always green here) and the next part reviews it. The prompt of every part after the
  first lists, as exact data, the paths whose content differs from the review source because an
  earlier part's reviewer repaired them, and tells the reviewer to read them from the checkout.
  The prompts sent, the measured prompt sizes and the review material evidence
  (review-1-material.json) are observed exactly. The fixture's commits have fixed dates, so its
  review source and prompts are the same bytes in every run; the prompts the review sent before
  this Intent (observed on the unchanged tree) are pinned by their SHA-256.

  Background:
    Given k-review-parts-earlier-repairs-named: a saved candidate that changes a.txt and adds a file of 44000 lines, whose review source needs three parts
    And k-review-parts-earlier-repairs-named: the repaired-paths section of a part's prompt begins with:
      """
      # Paths repaired by earlier parts

      Reviewers of earlier parts repaired these paths, and Kogen verified the repairs, after the review source was cut: what the review source shows of them is stale or missing. Read each of them from the checkout.
      """

  Scenario: Without repairs every part's prompt is byte-identical to the prompt sent before
    Given k-review-parts-earlier-repairs-named: the reviewer of every part approves without repairs
    When k-review-parts-earlier-repairs-named: the review runs
    Then k-review-parts-earlier-repairs-named: the review approves in 3 parts
    And k-review-parts-earlier-repairs-named: every part's prompt is byte-identical to the prompt sent before this Intent:
      | part | from    | to      | prompt bytes | stable sha256                                                    | dynamic sha256                                                   |
      | 1    | 0       | 502434  | 524262       | 206a31b3cee10cf103d96f72caa9a6737caa954eaf783f620c5678026a0efbe0 | b0112a28069805ef1fe0e8e9c423974f361f0754ffde18b3d09fb6752f294a64 |
      | 2    | 502434  | 1004874 | 524274       | 206a31b3cee10cf103d96f72caa9a6737caa954eaf783f620c5678026a0efbe0 | c08b83b8f61f1474c5d8266f4ab28f1ca614139f9866ef815a270316cb34d7ad |
      | 3    | 1004874 | 1320445 | 337406       | 206a31b3cee10cf103d96f72caa9a6737caa954eaf783f620c5678026a0efbe0 | 1e276e55446341c31657f665044089a4293fc218567ead52754fde73e2b79e7c |
    And k-review-parts-earlier-repairs-named: no part's prompt has a repaired-paths section
    And k-review-parts-earlier-repairs-named: no part's material evidence records repaired paths

  Scenario: A path repaired in part 1 is listed in part 2 and in part 3
    Given k-review-parts-earlier-repairs-named: the reviewer of part 1 repairs the files:
      """
      {"a.txt": "alpha\nALPHA\nrepaired in part 1\n"}
      """
    When k-review-parts-earlier-repairs-named: the review runs
    Then k-review-parts-earlier-repairs-named: the review approves in 3 parts
    And k-review-parts-earlier-repairs-named: part 1's prompt has no repaired-paths section
    And k-review-parts-earlier-repairs-named: part 2's prompt lists the repaired paths '["a.txt"]'
    And k-review-parts-earlier-repairs-named: part 3's prompt lists the repaired paths '["a.txt"]'
    And k-review-parts-earlier-repairs-named: every part's measured prompt is at most 524288 bytes and is what its material evidence records
    And k-review-parts-earlier-repairs-named: the parts carry the whole review source once, in order

  Scenario: Different paths repaired in parts 1 and 2 are listed in part 3 sorted, once each
    Given k-review-parts-earlier-repairs-named: the reviewer of part 1 repairs the files:
      """
      {"c.txt": "gamma\nrepaired in part 1\n"}
      """
    And k-review-parts-earlier-repairs-named: the reviewer of part 2 repairs the files:
      """
      {"a.txt": "alpha\nALPHA\nrepaired in part 2\n"}
      """
    When k-review-parts-earlier-repairs-named: the review runs
    Then k-review-parts-earlier-repairs-named: the review approves in 3 parts
    And k-review-parts-earlier-repairs-named: part 1's prompt has no repaired-paths section
    And k-review-parts-earlier-repairs-named: part 2's prompt lists the repaired paths '["c.txt"]'
    And k-review-parts-earlier-repairs-named: part 3's prompt lists the repaired paths '["a.txt","c.txt"]'
    And k-review-parts-earlier-repairs-named: every part's measured prompt is at most 524288 bytes and is what its material evidence records
    And k-review-parts-earlier-repairs-named: the parts carry the whole review source once, in order

  Scenario: A path repaired in part 1 and again in part 2 is listed once
    Given k-review-parts-earlier-repairs-named: the reviewer of part 1 repairs the files:
      """
      {"a.txt": "alpha\nALPHA\nrepaired in part 1\n"}
      """
    And k-review-parts-earlier-repairs-named: the reviewer of part 2 repairs the files:
      """
      {"a.txt": "alpha\nALPHA\nrepaired in part 1\nand again in part 2\n"}
      """
    When k-review-parts-earlier-repairs-named: the review runs
    Then k-review-parts-earlier-repairs-named: the review approves in 3 parts
    And k-review-parts-earlier-repairs-named: part 2's prompt lists the repaired paths '["a.txt"]'
    And k-review-parts-earlier-repairs-named: part 3's prompt lists the repaired paths '["a.txt"]'
    And k-review-parts-earlier-repairs-named: every part's measured prompt is at most 524288 bytes and is what its material evidence records
    And k-review-parts-earlier-repairs-named: the parts carry the whole review source once, in order

  Scenario: A list longer than the ceiling is cut with a visible count and every prompt stays within the ceiling
    Given k-review-parts-earlier-repairs-named: the reviewer of part 1 adds 2200 files whose paths are 240 bytes long
    When k-review-parts-earlier-repairs-named: the review runs
    Then k-review-parts-earlier-repairs-named: the review approves in 3 parts
    And k-review-parts-earlier-repairs-named: part 1's prompt has no repaired-paths section
    And k-review-parts-earlier-repairs-named: part 2's prompt lists the first 11 added paths followed by " and 2189 more"
    And k-review-parts-earlier-repairs-named: part 3's prompt lists the first 11 added paths followed by " and 2189 more"
    And k-review-parts-earlier-repairs-named: every part's measured prompt is at most 524288 bytes and is what its material evidence records
    And k-review-parts-earlier-repairs-named: the parts carry the whole review source once, in order
    And k-review-parts-earlier-repairs-named: the material evidence of part 1 records no repaired paths
    And k-review-parts-earlier-repairs-named: the material evidence of part 2 records the first 11 added paths and 2189 more

  Scenario: The material evidence of each part records exactly the list it was sent
    Given k-review-parts-earlier-repairs-named: the reviewer of part 1 repairs the files:
      """
      {"a.txt": "alpha\nALPHA\nrepaired in part 1\n", "d/new.txt": "added by the reviewer of part 1\n"}
      """
    When k-review-parts-earlier-repairs-named: the review runs
    Then k-review-parts-earlier-repairs-named: the review approves in 3 parts
    And k-review-parts-earlier-repairs-named: part 2's prompt lists the repaired paths '["a.txt","d/new.txt"]'
    And k-review-parts-earlier-repairs-named: the material evidence of part 1 records no repaired paths
    And k-review-parts-earlier-repairs-named: the material evidence of part 2 records the repaired paths '["a.txt","d/new.txt"]' and no count of more
    And k-review-parts-earlier-repairs-named: the material evidence of part 3 records the repaired paths '["a.txt","d/new.txt"]' and no count of more
    And k-review-parts-earlier-repairs-named: every part's measured prompt is at most 524288 bytes and is what its material evidence records
