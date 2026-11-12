package contract

import (
	"context"
	"errors"
	"testing"

	"github.com/KogenAI/kogen-loop/provider"
	"github.com/KogenAI/kogen-review/review"
)

// refusingEnv is a fake Env whose environment checks fail with err.
type refusingEnv struct {
	*fakeEnv
	err                       error
	baseline, custody, hasErr bool
}

func (h *refusingEnv) BaselineIntact() error {
	if h.baseline {
		return h.err
	}
	return nil
}

func (h *refusingEnv) Custody() error {
	if h.custody {
		return h.err
	}
	return nil
}

func (h *refusingEnv) Err() error {
	if h.hasErr {
		return h.err
	}
	return nil
}

// The environment's refusals end the native review with that very error: a baseline no longer
// intact after the verdict (nothing is recorded), and an error or a custody failure before a
// tool call runs.
func TestIndependentReviewReturnsTheEnvironmentsRefusals(t *testing.T) {
	t.Parallel()
	refusal := errors.New("environment refused")
	for _, tc := range []struct {
		name string
		env  func(*fakeEnv) *refusingEnv
	}{
		{"baseline", func(h *fakeEnv) *refusingEnv { return &refusingEnv{fakeEnv: h, err: refusal, baseline: true} }},
		{"custody", func(h *fakeEnv) *refusingEnv { return &refusingEnv{fakeEnv: h, err: refusal, custody: true} }},
		{"err", func(h *fakeEnv) *refusingEnv { return &refusingEnv{fakeEnv: h, err: refusal, hasErr: true} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			in, h := newReview(t)
			h.answers = []*provider.Response{submitReview(`{"verdict":"approve","findings":[]}`)}
			_, err := review.Independent{}.Review(context.Background(), in, tc.env(h))
			if !errors.Is(err, refusal) {
				t.Fatalf("the review ended with %v, want the environment's refusal", err)
			}
			if h.last != nil {
				t.Errorf("a review was recorded after the refusal: %v", *h.last)
			}
		})
	}
}
