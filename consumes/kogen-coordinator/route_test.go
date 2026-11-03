package consumes

import (
	"testing"

	"github.com/KogenAI/kogen-coordinator/route"
)

// The checkpoint stages are persisted bytes of kogen-build's checkpoints: never renamed.
func TestRouteStages(t *testing.T) {
	eq(t, "route.StageReview", route.StageReview, "review")
	eq(t, "route.StageReviewVerify", route.StageReviewVerify, "review_verify")
	eq(t, "route.StageReviewRetry", route.StageReviewRetry, "review_retry_verify")
}
