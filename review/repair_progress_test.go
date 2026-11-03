package review

import (
	"reflect"
	"testing"

	"github.com/KogenAI/kogen-verification/verify"
)

func TestFailureIdentitiesUseStagesAndSets(t *testing.T) {
	a := verify.Pass{Failing: []string{"lint", "lint", "compile"}, Checks: []verify.CommandResult{{Name: "lint", Status: 1}, {Name: "compile", Status: 1}}}
	b := verify.Pass{Failing: []string{"compile", "lint"}, Checks: []verify.CommandResult{{Name: "compile", Status: 1}, {Name: "lint", Status: 1}, {Name: "lint", Status: 1}}}
	want := []string{"check:compile", "check:lint"}
	if got := failureIdentities(a); !reflect.DeepEqual(got, want) {
		t.Fatalf("identities: %v", got)
	}
	if got := failureIdentities(b); !reflect.DeepEqual(got, want) {
		t.Fatalf("reordered identities: %v", got)
	}
	b.Checks = nil
	b.Setup = []verify.CommandResult{{Name: "compile", Status: 1}, {Name: "lint", Status: 1}}
	if reflect.DeepEqual(failureIdentities(a), failureIdentities(b)) {
		t.Fatal("setup and check failures must differ")
	}
}
