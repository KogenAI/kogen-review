Feature: Review material tests fail when edge-case delivery breaks
  Each break, applied alone to review/material.go or review/parts.go in a copy of the checkout,
  must make go test -count=1 ./review fail with a failing test, while the unchanged checkout
  passes.

  Background:
    Given fix-k-review-input-no-repeated-content: go test passes for review on the unchanged checkout

  Scenario Outline: A test catches the broken <behaviour>
    When fix-k-review-input-no-repeated-content: I break "<behaviour>" in a copy of the checkout and run go test for review
    Then fix-k-review-input-no-repeated-content: a test fails on the break

    Examples:
      | behaviour                                    |
      | added file without final newline: hunk range |
      | added file without final newline: marker     |
      | mode-only change                             |
      | gitlink change                               |
      | binary rename heading                        |
      | binary rename content class                  |
      | later part byte reference                    |
      | deleted file accounting                      |
      | deleted file hunk                            |
