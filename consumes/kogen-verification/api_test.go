package consumes

import "github.com/KogenAI/kogen-verification/verify"

// The exported API kogen-review uses of kogen-verification, pinned at compile time: a change of
// a type or of a field fails to compile here (inventory items verify.Pass and its members).
var (
	// review.Evidence.Pass, review.Env.Verify and cmd/kogen-review build and read passes.
	_ = verify.Pass{
		N: 0, Clean: false, Green: false, Tree: "",
		Setup:            []verify.CommandResult{},
		Acceptance:       (*verify.Acceptance)(nil),
		Model:            verify.ModelResult{},
		MaintainedModels: []verify.MaintainedModelResult{},
		Checks:           []verify.CommandResult{},
		Failing:          []string{},
	}
	_ func(verify.Pass) string = verify.Pass.Results
	// review.failureIdentities reads the structured stages of a pass.
	_                               = verify.Acceptance{Problems: []string{}}
	_                               = verify.CommandResult{Name: "", Status: 0}
	_                               = verify.MaintainedModelResult{Path: "", Result: verify.ModelResult{}}
	_ func(verify.ModelResult) bool = verify.ModelResult.Failed
)
