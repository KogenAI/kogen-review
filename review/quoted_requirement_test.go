package review

import (
	"testing"
)

func TestChangesVerdictAcceptsSerializedRequirementQuote(t *testing.T) {
	const requirement = "The login command says it \"opens a browser\"."
	for _, tc := range []struct {
		name, message, severity string
		wantProblem             bool
	}{
		{"plain quote", `Unmet: The login command says it "opens a browser".`, "blocking", false},
		{"serialized quote", `Unmet: "The login command says it \"opens a browser\"."`, "blocking", false},
		{"changed wording", `Unmet: "The login command says it \"opens a terminal\"."`, "blocking", true},
		{"partial quote", `The login command says it`, "blocking", true},
		{"note only", `Unmet: "The login command says it \"opens a browser\"."`, "note", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := &run{}
			args := map[string]any{"requirements": []any{map[string]any{
				"requirement": requirement, "evidence": "none", "ref": "", "met": false,
			}}}
			got, problems, err := r.requirements(args, "changes", []map[string]any{{
				"path": "login.txt", "line": 1, "severity": tc.severity, "message": tc.message,
			}}, nil)
			if err != nil || (len(problems) > 0) != tc.wantProblem || len(got) != 1 || got[0].Met {
				t.Fatalf("requirements=%v problems=%v err=%v", got, problems, err)
			}
		})
	}
}
