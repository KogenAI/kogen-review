Feature: Isolate the generated command's environment

  Scenario: Regeneration isolates parent variables and preserves review outcomes
    Then generated-command-environment-isolation: a generator checking for a parent-only sentinel is "summarised", a generator using an executable only on the parent's PATH is "summarised", and a generator that writes matching bytes but exits unsuccessfully is "kept"
