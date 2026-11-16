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
