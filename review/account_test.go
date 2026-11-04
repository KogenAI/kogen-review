package review

import (
	"testing"

	"github.com/KogenAI/kogen-executor/core"
)

func deref[T any](p *T) any {
	if p == nil {
		return nil
	}
	return *p
}

// TestAttemptOfSumsAndDividesTheFigures pins the attempt's totals (the caller's figures before the
// review plus the review's) and the review's share of each (item review-account): unknown counts
// stay nil, a zero attempt figure gives a nil share and a zero Input.Attempt leaves the token totals nil.
func TestAttemptOfSumsAndDividesTheFigures(t *testing.T) {
	t.Parallel()
	spent := Spend{Requests: 2, Input: core.Count(3000), Cached: core.Count(1000), Output: core.Count(300), WallMS: 1000}
	cases := []struct {
		name    string
		before  Spend
		spent   Spend
		attempt Spend
		share   [5]any
	}{
		{"builder and review", Spend{Requests: 6, Input: core.Count(9000), Cached: core.Count(3000), Output: core.Count(1700), WallMS: 4000}, spent,
			Spend{Requests: 8, Input: core.Count(12000), Cached: core.Count(4000), Output: core.Count(2000), WallMS: 5000},
			[5]any{0.25, 0.25, 0.25, 0.15, 0.2}},
		{"no attempt before", Spend{}, spent,
			Spend{Requests: 2, WallMS: 1000},
			[5]any{1.0, nil, nil, nil, 1.0}},
		{"unknown review output", Spend{Requests: 1, Input: core.Count(10), Cached: core.Count(0), Output: core.Count(5), WallMS: 1},
			Spend{Requests: 1, Input: core.Count(10), Cached: core.Count(0), WallMS: 3},
			Spend{Requests: 2, Input: core.Count(20), Cached: core.Count(0), WallMS: 4},
			[5]any{0.5, 0.5, nil, nil, 0.75}},
		{"zero attempt figures", Spend{Input: core.Count(0), Cached: core.Count(0), Output: core.Count(0)}, Spend{Input: core.Count(0), Cached: core.Count(0), Output: core.Count(0)},
			Spend{Input: core.Count(0), Cached: core.Count(0), Output: core.Count(0)},
			[5]any{nil, nil, nil, nil, nil}},
	}
	for _, c := range cases {
		got, share := attemptOf(c.before, c.spent)
		if got.Requests != c.attempt.Requests || got.WallMS != c.attempt.WallMS ||
			deref(got.Input) != deref(c.attempt.Input) || deref(got.Cached) != deref(c.attempt.Cached) || deref(got.Output) != deref(c.attempt.Output) {
			t.Errorf("%s: attempt %+v, want %+v", c.name, got, c.attempt)
		}
		have := [5]any{deref(share.Requests), deref(share.Input), deref(share.Cached), deref(share.Output), deref(share.WallMS)}
		if have != c.share {
			t.Errorf("%s: share %v, want %v", c.name, have, c.share)
		}
	}
}
