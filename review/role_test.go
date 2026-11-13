package review

import (
	"reflect"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-loop/provider"
)

func TestProviderRole(t *testing.T) {
	got := ProviderRole(project.Role{Provider: "openai-compatible", Model: "m", Effort: "high", BaseURL: "http://x", Executor: "ignored"})
	if want := (provider.Role{Provider: "openai-compatible", Model: "m", Effort: "high", BaseURL: "http://x"}); got != want {
		t.Errorf("ProviderRole = %+v, want %+v", got, want)
	}
	if got := ProviderRole(project.Role{}); got != (provider.Role{}) {
		t.Errorf("ProviderRole empty = %+v", got)
	}
}

func TestResponseTokens(t *testing.T) {
	resp := &provider.Response{
		Usage: provider.Usage{Input: 10, Cached: 4, Output: 3, Reasoning: 2},
		Known: provider.KnownUsage{Input: core.Count(100), Cached: core.Count(40), Output: core.Count(30)},
	}
	// The compatible totals of every route but Anthropic, always integers.
	for _, p := range []string{"", "chatgpt", "openai-compatible"} {
		want := core.Tokens{Input: core.Count(10), Cached: core.Count(4), Output: core.Count(3), Reasoning: core.Count(2)}
		if got := ResponseTokens(project.Role{Provider: p}, resp); !reflect.DeepEqual(got, want) {
			t.Errorf("ResponseTokens %q = %+v, want %+v", p, got, want)
		}
	}
	// Anthropic's totals come from the validated analytical usage; a count it omits is unknown.
	want := core.Tokens{Input: core.Count(100), Cached: core.Count(40), Output: core.Count(30)}
	if got := ResponseTokens(project.Role{Provider: "anthropic"}, resp); !reflect.DeepEqual(got, want) {
		t.Errorf("ResponseTokens anthropic = %+v, want %+v", got, want)
	}
}
