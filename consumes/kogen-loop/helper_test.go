package consumes

import (
	"reflect"
	"testing"
)

// eq fails the test when got differs from want; item names the inventory item.
func eq[T comparable](t testing.TB, item string, got, want T) {
	t.Helper()
	if got != want {
		t.Errorf("%s: got %#v, want %#v", item, got, want)
	}
}

// deepEq is eq for values that are not comparable.
func deepEq(t testing.TB, item string, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s: got %#v, want %#v", item, got, want)
	}
}
