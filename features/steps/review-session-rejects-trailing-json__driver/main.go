// Command review-session-rejects-trailing-json__driver decodes sample checkpoint sessions with
// review.DecodeSession and writes what each decoding returned as one JSON object on stdout.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/KogenAI/kogen-review/review"
)

const valid = `{"role":{"Provider":"chatgpt","Model":"fixture-review-model","Effort":"medium"},"input":[],` +
	`"usage":{"input":10,"cached":0,"output":2,"reasoning":null},"attempts":[],` +
	`"verdict":{"verdict":"approve","findings":[]},"requests":13}`

type outcome struct {
	Error    bool   `json:"error"`
	Model    string `json:"model"`
	Requests int    `json:"requests"`
}

func main() {
	samples := map[string]json.RawMessage{
		"valid session":                           json.RawMessage(valid),
		"valid session then whitespace":           json.RawMessage(valid + " \n\t\r"),
		"valid session then a second JSON object": json.RawMessage(valid + valid),
		"valid session then non-JSON text":        json.RawMessage(valid + " x"),
		"legacy session without requests":         json.RawMessage(strings.Replace(valid, `,"requests":13`, "", 1)),
		"malformed session":                       json.RawMessage(`{"attempts":"no"}`),
		"empty input":                             nil,
	}
	out := map[string]outcome{}
	for name, raw := range samples {
		s, err := review.DecodeSession(raw)
		out[name] = outcome{Error: err != nil, Model: s.Role.Model, Requests: s.Requests}
	}
	enc, err := json.Marshal(out)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	fmt.Println(string(enc))
}
