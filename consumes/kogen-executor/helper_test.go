package consumes

import (
	"reflect"
	"testing"

	"github.com/KogenAI/kogen-loop/sys"
)

// eq fails with the inventory item it checks when got is not want.
func eq(t *testing.T, item string, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s: got %#v, want %#v", item, got, want)
	}
}

// stop checks the four fields of a stop's Error and that it carries no detail lines.
func stop(t *testing.T, item string, e *sys.Error, class, reason, detail string, exit int) {
	t.Helper()
	if e == nil {
		t.Fatalf("%s: got a nil stop", item)
	}
	eq(t, item+" Class", e.Class, class)
	eq(t, item+" Reason", e.Reason, reason)
	eq(t, item+" Detail", e.Detail, detail)
	eq(t, item+" Exit", e.Exit, exit)
	eq(t, item+" Lines", len(e.Lines), 0)
}

func ptr[T any](v T) *T { return &v }
