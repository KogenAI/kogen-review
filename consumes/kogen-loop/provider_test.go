package consumes

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"

	"kogen-loop/provider"
	"kogen-loop/sys"
)

// offline is a session whose environment is a HOME of its own: no sign-in, no key, no seam.
func offline(t *testing.T) *sys.Session {
	t.Helper()
	return sys.NewWith([]string{"HOME=" + t.TempDir()}, t.TempDir())
}

func user(text string) []any { return []any{map[string]any{"role": "user", "content": text}} }

func respond(t *testing.T, r provider.Request) (*provider.Response, *sys.Error) {
	t.Helper()
	resp, err := provider.NewClient("kogen-review").Respond(context.Background(), offline(t), r, nil)
	se, ok := sys.AsError(err)
	if !ok {
		t.Fatalf("provider.Client.Respond: got error %v, want a *sys.Error", err)
	}
	return resp, se
}

func stop(se *sys.Error) string {
	return se.Class + "/" + se.Reason + " " + se.Detail + " exit " + string(rune('0'+se.Exit))
}

func TestNewClientIsAUsableClient(t *testing.T) {
	c := provider.NewClient("kogen-review")
	eq(t, "provider.NewClient", c != nil, true)
	eq(t, "provider.NewClient: a conversation cache identity store", c.Cache != nil, true)
	eq(t, "provider.NewClient: Kogen's version line is the one given", c.Version, "kogen-review")
	eq(t, "provider.NewClient: every call gives its own client", provider.NewClient("kogen-review") != c, true)
}

// cmd/kogen-review/main.go sends the request of a review and returns the stop of a provider
// that cannot be reached; none of these reach a network: they end before any transport.
func TestRespondRefusesBeforeAnyTransport(t *testing.T) {
	role := provider.Role{Provider: "chatgpt", Model: "gpt-5", Effort: "medium"}

	// Not signed in: a stop of the provider, exit 4, naming the sign-in; no response.
	resp, se := respond(t, provider.Request{Role: role, Instructions: "policy", Input: user("review"), Tools: []any{}})
	eq(t, "provider.Client.Respond: no response for a refused request", resp == nil, true)
	eq(t, "provider.Client.Respond: not signed in", stop(se), "provider/login not signed in; run kogen provider login chatgpt exit 4")

	// An unknown provider is refused by name.
	_, se = respond(t, provider.Request{Role: provider.Role{Provider: "nosuch", Model: "m"}, Input: user("review")})
	eq(t, "provider.Client.Respond: an unknown provider", stop(se), "provider/refused unknown provider nosuch exit 4")

	// openai-compatible has no default host.
	_, se = respond(t, provider.Request{Role: provider.Role{Provider: "openai-compatible", Model: "m"}, Input: user("review")})
	eq(t, "provider.Client.Respond: openai-compatible without a base URL", stop(se), "provider/refused openai-compatible needs base_url in .kogen/project.yaml exit 4")
}

func TestRequestRoleRoutesTheRequest(t *testing.T) {
	in := user("review")
	// An empty provider is ChatGPT's.
	_, se := respond(t, provider.Request{Role: provider.Role{Model: "gpt-5"}, Input: in})
	eq(t, "provider.Request.Role: an empty provider routes to chatgpt", se.Detail, "not signed in; run kogen provider login chatgpt")
	// A key provider routes to its own sign-in.
	_, se = respond(t, provider.Request{Role: provider.Role{Provider: "anthropic", Model: "claude-opus-5-5", Effort: "high"}, Input: in})
	eq(t, "provider.Request.Role: the provider names the route", se.Detail, "no usable Anthropic key; run kogen provider login anthropic")
}

// The complete request is measured before it is sent: the input, the policy text and the
// tool definitions all count against the 524288-byte ceiling (tools.InputBudgetBytes).
func TestRequestInputInstructionsAndToolsCountAgainstTheBudget(t *testing.T) {
	role := provider.Role{Provider: "chatgpt", Model: "gpt-5", Effort: "medium"}
	big := strings.Repeat("x", 600_000)
	ok := provider.Request{Role: role, Instructions: "policy", Input: user("review"), Tools: []any{map[string]any{"type": "function", "name": "t"}}}
	_, se := respond(t, ok)
	eq(t, "provider.Request: a small request passes the budget", se.Reason, "login")

	for _, tc := range []struct {
		item string
		mut  func(*provider.Request)
	}{
		{"provider.Request.Input", func(r *provider.Request) { r.Input = user(big) }},
		{"provider.Request.Instructions", func(r *provider.Request) { r.Instructions = big }},
		{"provider.Request.Tools", func(r *provider.Request) {
			r.Tools = []any{map[string]any{"type": "function", "name": "t", "description": big}}
		}},
	} {
		r := ok
		tc.mut(&r)
		resp, se := respond(t, r)
		eq(t, tc.item+": no response", resp == nil, true)
		eq(t, tc.item+": the stop is the candidate's context budget, exit 1", se.Class+"/"+se.Reason, "candidate/context_budget_exceeded")
		eq(t, tc.item+": exit 1", se.Exit, 1)
		eq(t, tc.item+": the ceiling is named", strings.Contains(se.Detail, "exceeds 524288"), true)
	}
}

// ToolChoice names the tool the provider must call; a route that cannot force one refuses it
// before any transport, and SupportsToolChoice says so beforehand (review/independent.go).
func TestRequestToolChoiceIsRefusedWhereItCannotBeForced(t *testing.T) {
	tool := []any{map[string]any{"type": "function", "name": "submit_review"}}
	role := provider.Role{Provider: "anthropic", Model: "claude-opus-5-5", Effort: "high"}
	eq(t, "provider.SupportsToolChoice: anthropic's adaptive thinking cannot force a tool", provider.SupportsToolChoice(role), false)
	_, se := respond(t, provider.Request{Role: role, Input: user("review"), Tools: tool, ToolChoice: "submit_review"})
	eq(t, "provider.Request.ToolChoice: refused with the provider's own stop", se.Class+"/"+se.Reason, "provider/unsupported_capability")
	eq(t, "provider.Request.ToolChoice: exit 4", se.Exit, 4)

	// Without a forced tool the same request is only not signed in.
	_, se = respond(t, provider.Request{Role: role, Input: user("review"), Tools: tool})
	eq(t, "provider.Request.ToolChoice: empty is not refused as unsupported", se.Reason, "login")

	// A route that can force one is not refused for it.
	chat := provider.Role{Provider: "chatgpt", Model: "gpt-5", Effort: "medium"}
	_, se = respond(t, provider.Request{Role: chat, Input: user("review"), Tools: tool, ToolChoice: "submit_review"})
	eq(t, "provider.Request.ToolChoice: chatgpt can force the tool", se.Reason, "login")
}

func TestSupportsToolChoice(t *testing.T) {
	for _, tc := range []struct {
		role provider.Role
		want bool
	}{
		{provider.Role{}, true},
		{provider.Role{Provider: "chatgpt", Model: "gpt-5", Effort: "medium"}, true},
		{provider.Role{Provider: "supergrok", Model: "grok-4.7"}, true},
		{provider.Role{Provider: "opencode-go", Model: "kimi-k3"}, true},
		{provider.Role{Provider: "openai-compatible", Model: "m", BaseURL: "http://127.0.0.1:1"}, true},
		{provider.Role{Provider: "anthropic", Model: "claude-opus-5-5", Effort: "high"}, false},
		{provider.Role{Provider: "anthropic", Model: "claude-sonnet-5-5"}, false},
		{provider.Role{Provider: "nosuch", Model: "m"}, false},
	} {
		eq(t, "provider.SupportsToolChoice: "+tc.role.Provider+" "+tc.role.Model, provider.SupportsToolChoice(tc.role), tc.want)
	}
}

func TestName(t *testing.T) {
	eq(t, "provider.Name: a role that omits the provider routes to chatgpt", provider.Name(provider.Role{Model: "gpt-5"}), "chatgpt")
	eq(t, "provider.Name: the role's provider", provider.Name(provider.Role{Provider: "anthropic"}), "anthropic")
	eq(t, "provider.Name: sent unchanged, even unknown", provider.Name(provider.Role{Provider: "nosuch"}), "nosuch")
}

// review/independent.go: arguments and results of a tool call are recorded as fingerprints.
func TestFingerprintIsTheSHA256AndLengthOfTheBytes(t *testing.T) {
	sum := func(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }

	d := provider.Fingerprint("abc")
	eq(t, "provider.Fingerprint: a string is hashed as is", d.SHA256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
	eq(t, "provider.Fingerprint: its byte count", d.Bytes, 3)

	d = provider.Fingerprint("é\n")
	eq(t, "provider.Fingerprint: UTF-8 bytes", d.SHA256, sum("é\n"))
	eq(t, "provider.Fingerprint: counted in bytes", d.Bytes, 3)

	d = provider.Fingerprint("")
	eq(t, "provider.Fingerprint: the empty string is a digest, not nil", d != nil, true)
	eq(t, "provider.Fingerprint: the empty string", d.SHA256, sum(""))
	eq(t, "provider.Fingerprint: its byte count is 0", d.Bytes, 0)

	// Any other value is hashed as its JSON encoding with sorted keys, not HTML-escaped.
	const enc = `{"a":1,"b":[true,"<"]}`
	d = provider.Fingerprint(map[string]any{"b": []any{true, "<"}, "a": 1})
	eq(t, "provider.Fingerprint: a value is hashed as its JSON", d.SHA256, sum(enc))
	eq(t, "provider.Fingerprint: the JSON's byte count", d.Bytes, len(enc))

	eq(t, "provider.Fingerprint: nil gives nil", provider.Fingerprint(nil) == nil, true)
}

// The Items of a Response are the received output items, in order (kogen-review feeds them
// to tools.Replay and tools.Calls); a Response is the producer's value, built here directly.
func TestResponseItemsAreTheOutputItemsInOrder(t *testing.T) {
	resp := &provider.Response{Items: []map[string]any{
		{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "hi"}}},
		{"type": "function_call", "call_id": "c1", "name": "read_file", "arguments": `{"path":"a"}`},
	}}
	eq(t, "provider.Response.Items", len(resp.Items), 2)
	eq(t, "provider.Response.Items: first item", resp.Items[0]["type"], any("message"))
	eq(t, "provider.Response.Items: second item", resp.Items[1]["name"], any("read_file"))
}
