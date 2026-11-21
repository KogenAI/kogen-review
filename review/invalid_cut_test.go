package review

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestCutAtWord(t *testing.T) {
	words := func(word string, runes int) string {
		var b []string
		for n := 0; n < runes; {
			b = append(b, word)
			n += utf8.RuneCountInString(word) + 1
		}
		return string([]rune(strings.Join(b, " "))[:runes])
	}
	cases := []struct {
		name, in, want string
	}{
		{"within", words("abcdefghij", 160), words("abcdefghij", 160)},
		{"161", words("abcdefghij", 161), strings.TrimSuffix(strings.Repeat("abcdefghij ", 14), " ") + " ..."},
		{"200", words("abcdefghij", 200), strings.TrimSuffix(strings.Repeat("abcdefghij ", 14), " ") + " ..."},
		{"no whitespace", strings.Repeat("x", 200), strings.Repeat("x", 156) + " ..."},
	}
	for _, c := range cases {
		got := cutAtWord(c.in, progressProblemRunes)
		if got != c.want {
			t.Errorf("%s: got %q want %q", c.name, got, c.want)
		}
		if utf8.RuneCountInString(got) > progressProblemRunes {
			t.Errorf("%s: %d runes", c.name, utf8.RuneCountInString(got))
		}
	}
	multi := cutAtWord(words("日本語日本語日本語日", 200), progressProblemRunes)
	if !utf8.ValidString(multi) || strings.ContainsRune(multi, utf8.RuneError) || !strings.HasSuffix(multi, " ...") || utf8.RuneCountInString(multi) > progressProblemRunes {
		t.Errorf("multi-byte: %q", multi)
	}
}

func TestCutProblemKeepsReason(t *testing.T) {
	statement := func(runes int) string {
		return string([]rune(strings.TrimSuffix(strings.Repeat("abcdefghij ", runes/11+1), " "))[:runes])
	}
	reason := "has no evidence: probe it with shell against the candidate before the verdict"
	long := strings.Repeat("and cite the exact command that ran, the tree it ran on and the exit status ", 2) + "end"
	cases := []struct {
		name, in, want string
	}{
		{"short", `requirement "` + statement(40) + `" ` + reason, `requirement "` + statement(40) + `" ` + reason},
		{"long statement", `requirement "` + statement(400) + `" ` + reason, `requirement "` + strings.TrimSuffix(strings.Repeat("abcdefghij ", 5), " ") + ` ..." ` + reason},
		{"no room", `requirement "` + statement(400) + `" ` + long, `requirement " ..." ` + long},
		{"no quoted requirement", statement(200), strings.TrimSuffix(strings.Repeat("abcdefghij ", 14), " ") + " ..."},
		{"no closing quote", `requirement "` + statement(400), cutAtWord(`requirement "`+statement(400), progressProblemRunes)},
	}
	for _, c := range cases {
		if got := cutProblem(c.in, progressProblemRunes); got != c.want {
			t.Errorf("%s: got %q want %q", c.name, got, c.want)
		}
	}
}
