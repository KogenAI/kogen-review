Feature: Confine review CLI Intent paths
  This feature exercises the built kogen-review command on a local Git checkout.
  Each outside case uses a readable regular file and then a FIFO with no writer.
  A refusal prints one kogen-review: line on stderr and leaves no run directory.
  The configured setup writes a marker and exits 9. When paths are valid, the CLI
  exits 1 with one JSON result (verdict error, error class verification and reason
  failed) and retains initial-verification.json with setup-1 at status 9.

  Scenario: Refuse a traversal slug before reading
    Given confine-cli-intent-paths: a checkout with a "traversal" authority path
    When confine-cli-intent-paths: the review command runs against that checkout
    Then confine-cli-intent-paths: the command exits 2 with empty stdout before any outside authority read or verification

  Scenario: Refuse an outside intent link before reading
    Given confine-cli-intent-paths: a checkout with an "intent link" authority path
    When confine-cli-intent-paths: the review command runs against that checkout
    Then confine-cli-intent-paths: the command exits 2 with empty stdout before any outside authority read or verification

  Scenario: Refuse an outside acceptance link before reading
    Given confine-cli-intent-paths: a checkout with a "feature link" authority path
    When confine-cli-intent-paths: the review command runs against that checkout
    Then confine-cli-intent-paths: the command exits 2 with empty stdout before any outside authority read or verification

  Scenario: Refuse an outside parent link before reading
    Given confine-cli-intent-paths: a checkout with a "parent link" authority path
    When confine-cli-intent-paths: the review command runs against that checkout
    Then confine-cli-intent-paths: the command exits 2 with empty stdout before any outside authority read or verification

  Scenario: Preserve review verification for ordinary authority files
    Given confine-cli-intent-paths: a checkout with an "ordinary" authority path
    When confine-cli-intent-paths: the review command runs against that checkout
    Then confine-cli-intent-paths: the command runs the configured setup and reports its verification failure as before

  Scenario: Preserve review verification for links inside the checkout
    Given confine-cli-intent-paths: a checkout with an "inside links" authority path
    When confine-cli-intent-paths: the review command runs against that checkout
    Then confine-cli-intent-paths: the command runs the configured setup and reports its verification failure as before
