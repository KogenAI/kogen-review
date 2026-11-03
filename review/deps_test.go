package review

import (
	"os/exec"
	"slices"
	"strings"
	"testing"
)

const module = "github.com/KogenAI/kogen-review"

// guarded are the modules whose packages the dependency rule restricts: this module, and
// kogen-build, which uses review and core and must stay the only side that points at them.
var guarded = []string{module, "github.com/KogenAI/kogen-build"}

// TestDependencyRule is the dependency rule of the seam between kogen-build, kogen-review and
// kogen-executor's core: tests included, review depends on itself alone among the packages of
// this module and of kogen-build, and kogen-executor's core on none of them. Packages of other
// modules are free. The dependency direction is kogen-build → kogen-review → kogen-executor,
// so a package of this module or of kogen-build that either of them imports must not appear.
func TestDependencyRule(t *testing.T) {
	for _, tc := range []struct {
		pkg     string
		allowed []string
	}{
		{module + "/review", []string{module + "/review"}},
		{"github.com/KogenAI/kogen-executor/core", nil},
	} {
		t.Run(strings.TrimPrefix(tc.pkg, "github.com/KogenAI/"), func(t *testing.T) {
			for _, problem := range forbiddenImports(t, tc.pkg, tc.allowed) {
				t.Error(problem)
			}
		})
	}
}

// forbiddenImports are the imports of packages of the guarded modules, by a package pkg
// depends on (tests included), that are outside allowed.
func forbiddenImports(t *testing.T, pkg string, allowed []string) []string {
	t.Helper()
	out, err := exec.Command("go", "list", "-deps", "-test", "-f", `{{.ImportPath}}{{"\t"}}{{join .Imports " "}}`, pkg).CombinedOutput()
	if err != nil {
		t.Fatalf("go list -deps -test %s: %v\n%s", pkg, err, out)
	}
	var problems []string
	for _, line := range strings.Split(string(out), "\n") {
		path, imports, _ := strings.Cut(line, "\t")
		importer := ownPackage(path)
		if importer == "" {
			continue
		}
		for _, imported := range strings.Fields(imports) {
			imported = ownPackage(imported)
			if guardedPackage(imported) && !slices.Contains(allowed, imported) && imported != importer {
				problem := importer + " imports " + imported + ", which the dependency rule forbids"
				if !slices.Contains(problems, problem) {
					problems = append(problems, problem)
				}
			}
		}
	}
	return problems
}

// guardedPackage reports whether path is a package of a guarded module.
func guardedPackage(path string) bool {
	for _, m := range guarded {
		if path == m || strings.HasPrefix(path, m+"/") {
			return true
		}
	}
	return false
}

// ownPackage is the package a go list entry belongs to: its test variants (`p [p.test]`,
// `p.test` and `p_test`) count as p.
func ownPackage(path string) string {
	path, _, _ = strings.Cut(strings.TrimSpace(path), " [")
	return strings.TrimSuffix(strings.TrimSuffix(path, ".test"), "_test")
}
