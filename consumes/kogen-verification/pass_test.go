package consumes

import (
	"slices"
	"testing"

	"github.com/KogenAI/kogen-verification/verify"
)

func eq[T comparable](t *testing.T, item string, got, want T) {
	t.Helper()
	if got != want {
		t.Errorf("%s: got %#v, want %#v", item, got, want)
	}
}

func eqs(t *testing.T, item string, got, want []string) {
	t.Helper()
	if !slices.Equal(got, want) {
		t.Errorf("%s: got %q, want %q", item, got, want)
	}
}

// Pass fields retain the producer format consumed by the reviewer.
func TestPassFields(t *testing.T) {
	const tree = "0123456789abcdef0123456789abcdef01234567"
	p := verify.Pass{N: 1, Clean: true, Green: true, Tree: tree}
	eq(t, "verify.Pass.N", p.N, 1)
	eq(t, "verify.Pass.Clean", p.Clean, true)
	eq(t, "verify.Pass.Green", p.Green, true)
	eq(t, "verify.Pass.Tree", p.Tree, tree)
	var zero verify.Pass
	eq(t, "verify.Pass", zero.N, 0)
	eq(t, "verify.Pass.Clean", zero.Clean, false)
	eq(t, "verify.Pass.Green", zero.Green, false)
	eq(t, "verify.Pass.Tree", zero.Tree, "")
	eq(t, "verify.Pass.Acceptance", zero.Acceptance == nil, true)
	eq(t, "verify.Pass.Failing", len(zero.Failing), 0)
	eq(t, "verify.Pass.Setup", len(zero.Setup), 0)
	eq(t, "verify.Pass.Checks", len(zero.Checks), 0)
	eq(t, "verify.Pass.MaintainedModels", len(zero.MaintainedModels), 0)
	eq(t, "verify.Pass.Model", zero.Model.Failed(), false)
}

// The reviewer's material states the green pass as Results: the scenarios passed, the model
// and each check, one line each.
func TestPassResults(t *testing.T) {
	green := verify.Pass{
		N: 2, Clean: true, Green: true, Tree: "t",
		Acceptance: &verify.Acceptance{Scenarios: []verify.ScenarioResult{{}, {}, {}}, Passed: 3},
		Model:      verify.ModelResult{State: "ok"},
		Checks: []verify.CommandResult{
			{Name: "format", Command: "gofmt -l .", Status: 0},
			{Name: "go-test", Command: "go test ./...", Status: 0},
		},
	}
	eq(t, "verify.Pass.Results", green.Results(),
		"acceptance: passed (3 scenarios)\nmodel: passed\ncheck format: passed\ncheck go-test: passed")
	eq(t, "verify.Pass.Acceptance", green.Acceptance != nil && len(green.Acceptance.Scenarios) == 3, true)
	eq(t, "verify.Pass.Checks", len(green.Checks), 2)
	eq(t, "verify.CommandResult.Name", green.Checks[1].Name, "go-test")
	eq(t, "verify.CommandResult.Status", green.Checks[1].Status, 0)
	eq(t, "verify.Pass.Model", green.Model.State, "ok")

	// A pass whose model is "none" says so; no acceptance is zero scenarios; no checks no lines.
	none := verify.Pass{Green: true, Model: verify.ModelResult{State: "none"}}
	eq(t, "verify.Pass.Results", none.Results(), "acceptance: passed (0 scenarios)\nmodel: not applicable")
	eq(t, "verify.Pass.Model", none.Model.State, "none")
	// Any other model state reads as passed, and Results does not depend on Failing or Green.
	other := verify.Pass{Failing: []string{"x"}}
	eq(t, "verify.Pass.Results", other.Results(), "acceptance: passed (0 scenarios)\nmodel: passed")
	eq(t, "verify.Pass.Failing", len(other.Failing), 1)
}

// review.failureIdentities reads the stage results of a red pass: the acceptance problems, the
// model and maintained models, the setup commands' and checks' statuses and the failing names.
func TestPassStagesOfARedPass(t *testing.T) {
	p := verify.Pass{
		N: 3, Clean: true, Tree: "t",
		Setup:      []verify.CommandResult{{Name: "setup-1", Command: "make deps", Status: 2, Output: "no"}},
		Acceptance: &verify.Acceptance{Status: 1, Problems: []string{"scenario failed", "step undefined"}},
		Model:      verify.ModelResult{State: "failed", Problems: []string{"typecheck"}},
		MaintainedModels: []verify.MaintainedModelResult{
			{Path: ".kogen/intents/a/model.qnt", Result: verify.ModelResult{State: "failed", Problems: []string{"run"}}},
			{Path: ".kogen/intents/b/model.qnt", Result: verify.ModelResult{State: "ok"}},
		},
		Checks:  []verify.CommandResult{{Name: "vet", Command: "go vet ./...", Status: 1}, {Name: "format", Status: 0}},
		Failing: []string{"acceptance", "model", "vet"},
	}
	eqs(t, "verify.Acceptance.Problems", p.Acceptance.Problems, []string{"scenario failed", "step undefined"})
	eq(t, "verify.Pass.Acceptance", p.Acceptance.Status, 1)
	eq(t, "verify.Pass.Model", p.Model.Failed(), true)
	eq(t, "verify.ModelResult.Failed", p.Model.Failed(), true)
	eq(t, "verify.ModelResult.Failed", verify.ModelResult{State: "ok"}.Failed(), false)
	eq(t, "verify.ModelResult.Failed", verify.ModelResult{State: "not_run"}.Failed(), false)
	eq(t, "verify.ModelResult.Failed", verify.ModelResult{State: "none"}.Failed(), false)
	eq(t, "verify.ModelResult.Failed", verify.ModelResult{}.Failed(), false)
	eq(t, "verify.Pass.MaintainedModels", len(p.MaintainedModels), 2)
	eq(t, "verify.MaintainedModelResult.Path", p.MaintainedModels[0].Path, ".kogen/intents/a/model.qnt")
	eq(t, "verify.MaintainedModelResult.Result", p.MaintainedModels[0].Result.Failed(), true)
	eq(t, "verify.MaintainedModelResult.Result", p.MaintainedModels[1].Result.Failed(), false)
	eq(t, "verify.Pass.Setup", len(p.Setup), 1)
	eq(t, "verify.CommandResult.Name", p.Setup[0].Name, "setup-1")
	eq(t, "verify.CommandResult.Status", p.Setup[0].Status, 2)
	eq(t, "verify.Pass.Checks", p.Checks[0].Name, "vet")
	eq(t, "verify.CommandResult.Status", p.Checks[0].Status, 1)
	eqs(t, "verify.Pass.Failing", p.Failing, []string{"acceptance", "model", "vet"})
}
