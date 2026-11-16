package consumes

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/KogenAI/kogen-coordinator/rules"
)

// What review/independent.go and review/rules.go call of package rules, pinned at compile time:
// a change of a signature, a type, a field or a constant fails to compile here.
var (
	_ func(context.Context, string, rules.Options) (*rules.Snapshot, error) = rules.Load
	_                                                                       = rules.Options{}
	_                                                                       = rules.Snapshot{Rules: []rules.Rule{}, ContentHash: "", RetrievedAt: time.Time{}, Origin: rules.Live, FallbackReason: ""}
	_                                                                       = rules.Rule{ID: "", Revision: json.RawMessage(nil), Scope: "", Topic: "", Text: "", Owner: ""}
	_ error                                                                 = &rules.Error{Class: "", Reason: ""}
	_ error                                                                 = rules.ErrNotConfigured
	_ rules.Origin                                                          = rules.Cached
)

// roundTrip answers every request of the rules client from memory: no listener is opened.
type roundTrip func(*http.Request) *http.Response

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r), nil }

func coordinatorDir(t *testing.T) string {
	t.Helper()
	out, err := exec.Command("go", "list", "-m", "-f", "{{.Dir}}", "github.com/KogenAI/kogen-coordinator").Output()
	if err != nil || strings.TrimSpace(string(out)) == "" {
		t.Fatalf("the pinned kogen-coordinator module is not available: %v", err)
	}
	return strings.TrimSpace(string(out))
}

// TestRulesLoadsTheProducersOfflineFixture loads the producer's recorded-shape Studio response
// live, with the clock fixed, and gets the producer's recorded snapshot; the review's use of the
// snapshot (origin, hash, retrieval time, fallback and the rules with raw revisions) is in it.
func TestRulesLoadsTheProducersOfflineFixture(t *testing.T) {
	dir := filepath.Join(coordinatorDir(t), "rules", "testdata", "consumer")
	response, err := os.ReadFile(filepath.Join(dir, "response.json"))
	if err != nil {
		t.Fatal(err)
	}
	recorded, err := os.ReadFile(filepath.Join(dir, "snapshot.json"))
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	config := "version: 1\nurl: http://studio.invalid\nworkspace_id: optimum\nproduct_id: kogen\nrepo: kogen-shaping\ntoken_env: STUDIO_TOKEN\non_unavailable: hold\n"
	if err := os.MkdirAll(filepath.Join(root, ".kogen"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".kogen", "studio-rules.yaml"), []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Transport: roundTrip(func(r *http.Request) *http.Response {
		status := 200
		if r.Header.Get("Authorization") != "Bearer synthetic" {
			status = 401
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(string(response))), Header: http.Header{}, Request: r}
	})}
	at := time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC)
	snap, err := rules.Load(context.Background(), root, rules.Options{
		Getenv: func(k string) string {
			if k == "STUDIO_TOKEN" {
				return "synthetic"
			}
			return ""
		},
		Now:    func() time.Time { return at },
		Client: client,
	})
	if err != nil {
		t.Fatal(err)
	}
	var got, want any
	raw, err := json.Marshal(snap)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(recorded, &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("snapshot\n got %s\nwant %s", raw, recorded)
	}
	if snap.Origin != rules.Live || snap.FallbackReason != "" || len(snap.Rules) == 0 || !strings.HasPrefix(snap.ContentHash, "sha256:") {
		t.Fatalf("snapshot provenance: %+v", snap)
	}

	// An unconfigured project is the sentinel, with no request.
	empty := t.TempDir()
	if _, err := rules.Load(context.Background(), empty, rules.Options{Client: &http.Client{Transport: roundTrip(func(*http.Request) *http.Response {
		t.Fatal("a request was made without configuration")
		return nil
	})}}); !errors.Is(err, rules.ErrNotConfigured) {
		t.Fatalf("unconfigured: %v", err)
	}

	// A refusal is a *rules.Error whose text is <class>: <reason>.
	refused, err := rules.Load(context.Background(), root, rules.Options{Getenv: func(string) string { return "wrong" }, Client: client})
	var re *rules.Error
	if refused != nil || !errors.As(err, &re) || err.Error() != "rules/refused: http_401" {
		t.Fatalf("refusal: %v %v", refused, err)
	}
}
