# Require acceptance citations to name one scenario

Slug: k-review-acceptance-citation-names-one-scenario
Model: not applicable — a stateless matching rule on a reference string
Acceptance:
- .kogen/intents/k-review-acceptance-citation-names-one-scenario/acceptance.feature
- features/steps/k-review-acceptance-citation-names-one-scenario__steps.js
- features/steps/k-review-acceptance-citation-names-one-scenario__driver.js

A requirement with evidence of kind acceptance cites a scenario of the acceptance result only when its reference identifies that scenario: the reference contains the scenario's full name, or step text that occurs in exactly one scenario of the acceptance result. A name that is a proper substring of another contained scenario name does not count (only the longer, contained name cites). When the reference identifies no scenario but contains step text shared by several scenarios, the approval is refused with this problem: `requirement "<R>" cites acceptance "<ref>", which is ambiguous: it matches steps of several scenarios and names none of them ("<A>", "<B>"): name the scenario that exercises the requirement, or <the existing requirement suffix>`, listing matched scenario names in acceptance-result order. For example, with scenarios "Add two numbers" and "Add two numbers with a carry" both passed and both having the step "Given a calculator", the reference "Given a calculator" is ambiguous. Failed and not-passed handling, the not-run refusal and the tree-currency refusal are unchanged; a reference matching nothing keeps the existing "names no scenario" problem. The old rule (any shared step text cites every scenario having it) is removed.

## Decisions
- Name matches take precedence: if any whole scenario name is contained in the reference, only those scenarios are cited and step text is not consulted (evidence: review/independent.go) (source: request)
- A reference that ties several scenarios only by shared step text, with no name and no unique step text, is ambiguous (evidence: review/independent.go) (source: request)
- The ambiguity problem reuses the existing requirement suffix wording after "name the scenario that exercises the requirement, or" (evidence: review/independent.go) (assumption: exact problem wording is the reviewer-facing text) (source: request)

## Source comparison
- Whole-name matching, unique-step matching, ambiguity refusal naming scenarios, and unchanged not-run/stale/failed handling are all addressed; the synthetic examples are scenarios in acceptance.feature, including the reference "Given a calculator".

## Tests
- A shared step text alone is refused as ambiguous naming scenarios: scenario "A shared step text alone is ambiguous" (scenario)
- Whole-name matching, prefix names and unique step text: the name and step scenarios (scenario)
- Shared step plus one full name judged on that scenario: its scenario (scenario)
- Not-run and earlier-tree refusals unchanged: their scenarios (scenario)

## Feasibility
- none
