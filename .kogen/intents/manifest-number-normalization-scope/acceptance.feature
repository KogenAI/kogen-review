Feature: Distinguish manifest versions from numeric settings

  Scenario: A numeric script argument lists the package manifest
    Given manifest-number-normalization-scope: the start commit contains this manifest at "web/package.json":
      """
      {
        "version": "1.2.3",
        "scripts": {
          "test": "test --workers=1"
        }
      }
      """
    When manifest-number-normalization-scope: review material is prepared after replacing only that manifest with:
      """
      {
        "version": "1.2.3",
        "scripts": {
          "test": "test --workers=2"
        }
      }
      """
    Then manifest-number-normalization-scope: the source has exactly this shared test support line: "shared test support changed: web/package.json"

  Scenario: A package version-only edit does not list the manifest
    Given manifest-number-normalization-scope: the start commit contains this manifest at "web/package.json":
      """
      {
        "version": "1.2.3"
      }
      """
    When manifest-number-normalization-scope: review material is prepared after replacing only that manifest with:
      """
      {
        "version": "1.2.4"
      }
      """
    Then manifest-number-normalization-scope: the source has no shared test support line

  Scenario: A dependency version-only edit does not list the manifest
    Given manifest-number-normalization-scope: the start commit contains this manifest at "web/package.json":
      """
      {
        "dependencies": {
          "a": "^2.0.0-beta.1"
        }
      }
      """
    When manifest-number-normalization-scope: review material is prepared after replacing only that manifest with:
      """
      {
        "dependencies": {
          "a": "^2.1.0"
        }
      }
      """
    Then manifest-number-normalization-scope: the source has no shared test support line

  Scenario: The manifest catalog and non-manifest path rules stay unchanged
    When manifest-number-normalization-scope: review material is prepared for these non-version edits:
      | manifest                  | before                                 | after                                  |
      | Gemfile                   | gem 'rails'                            | gem 'rack'                             |
      | Gemfile.lock              | GEM\n  specs:\n    rails (7.1.0)       | GEM\n  specs:\n    rack (7.1.0)        |
      | go.mod                    | module example.com/a                   | module example.com/b                   |
      | go.sum                    | example.com/a v1.0.0 h1:example        | example.com/b v1.0.0 h1:example        |
      | mix.exs                   | [app: :alpha]                          | [app: :beta]                           |
      | mix.lock                  | %{"alpha": {:path, "../alpha"}}        | %{"beta": {:path, "../beta"}}          |
      | package-lock.json         | {"name":"alpha","lockfileVersion":3}   | {"name":"beta","lockfileVersion":3}    |
      | package.json              | {"name":"alpha"}                       | {"name":"beta"}                        |
      | pyproject.toml            | [project]\nname = "alpha"             | [project]\nname = "beta"              |
      | requirements.txt          | alpha==1.0                             | beta==1.0                              |
      | test/test_helper.rb       | # helper                               | # updated helper                       |
      | web/package.local.json    | {"name":"alpha"}                       | {"name":"beta"}                        |
    Then manifest-number-normalization-scope: the source has exactly this shared test support line: "shared test support changed: Gemfile, Gemfile.lock, go.mod, go.sum, mix.exs, mix.lock, package-lock.json, package.json, pyproject.toml, requirements.txt, test/test_helper.rb"
