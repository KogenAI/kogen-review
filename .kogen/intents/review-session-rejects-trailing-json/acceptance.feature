Feature: Reject trailing JSON when decoding a review session
  This feature pins review.DecodeSession: a checkpoint holds exactly one session value, so a
  session followed by anything but whitespace is an error, and every other decoding keeps its result.

  Scenario: A valid session followed by whitespace decodes
    When review-session-rejects-trailing-json: the driver decodes every sample session with review.DecodeSession
    Then review-session-rejects-trailing-json: the sample "valid session then whitespace" decodes without an error as model "fixture-review-model" with 13 requests

  Scenario: A valid session followed by more input is an error
    When review-session-rejects-trailing-json: the driver decodes every sample session with review.DecodeSession
    Then review-session-rejects-trailing-json: the sample "valid session then a second JSON object" is rejected with an error
    And review-session-rejects-trailing-json: the sample "valid session then non-JSON text" is rejected with an error

  Scenario: The valid and legacy sessions decode as before
    When review-session-rejects-trailing-json: the driver decodes every sample session with review.DecodeSession
    Then review-session-rejects-trailing-json: the sample "valid session" decodes without an error as model "fixture-review-model" with 13 requests
    And review-session-rejects-trailing-json: the sample "legacy session without requests" decodes without an error as model "fixture-review-model" with 0 requests

  Scenario: Malformed and empty input are still errors
    When review-session-rejects-trailing-json: the driver decodes every sample session with review.DecodeSession
    Then review-session-rejects-trailing-json: the sample "malformed session" is rejected with an error
    And review-session-rejects-trailing-json: the sample "empty input" is rejected with an error
