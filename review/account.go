package review

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/KogenAI/kogen-executor/core"
	"github.com/KogenAI/kogen-executor/executor"
)

// The review's account (observability only): what a review cost and what it changed, built from
// the counters the review already keeps. Nothing here changes how a review runs.

// clone is a copy of a count, so an account never shares memory with a session.
func clone(n *int) *int {
	if n == nil {
		return nil
	}
	return core.Count(*n)
}

// sum is a + b, nil when either is nil.
func sum(a, b *int) *int {
	if a == nil || b == nil {
		return nil
	}
	return core.Count(*a + *b)
}

// ratio is review / attempt, nil when either figure is unknown or the attempt's is 0.
func ratio(review, attempt *float64) *float64 {
	if review == nil || attempt == nil || *attempt == 0 {
		return nil
	}
	v := *review / *attempt
	return &v
}

func known(n *int) *float64 {
	if n == nil {
		return nil
	}
	v := float64(*n)
	return &v
}

func number[T int | int64](n T) *float64 {
	v := float64(n)
	return &v
}

// attemptOf is the whole attempt's spend, the caller's figures before the review plus the
// review's, and the review's share of each figure.
func attemptOf(before, spent Spend) (Spend, Share) {
	total := Spend{
		Requests: before.Requests + spent.Requests,
		Input:    sum(before.Input, spent.Input),
		Cached:   sum(before.Cached, spent.Cached),
		Output:   sum(before.Output, spent.Output),
		WallMS:   before.WallMS + spent.WallMS,
	}
	return total, Share{
		Requests: ratio(number(spent.Requests), number(total.Requests)),
		Input:    ratio(known(spent.Input), known(total.Input)),
		Cached:   ratio(known(spent.Cached), known(total.Cached)),
		Output:   ratio(known(spent.Output), known(total.Output)),
		WallMS:   ratio(number(spent.WallMS), number(total.WallMS)),
	}
}

// newAccount is the account of a review that spent spent and took repairs repair rounds, with
// its effect.
func newAccount(in Input, spent Spend, repairs int, effect Effect) *Account {
	attempt, share := attemptOf(in.Attempt, spent)
	return &Account{Review: spent, Attempt: attempt, Share: share, RepairRounds: repairs, Effect: effect}
}

// blockerLines are the lines of a verdict's blocking findings, <path>:<line>: <message>.
func blockerLines(findings []map[string]any) []string {
	var lines []string
	for _, f := range findings {
		if f["severity"] == "blocking" {
			lines = append(lines, fmt.Sprintf("%s:%s: %s", core.Display(f["path"]), core.Display(f["line"]), core.Display(f["message"])))
		}
	}
	return lines
}

// effectOf is what the review changed: first is the tree of the green pass it started from,
// res and err how it ended and defects the blockers it raised.
func effectOf(c Candidate, first string, res Result, err error, defects []string) Effect {
	e := Effect{FirstTree: first, Blockers: len(defects), Defects: core.NonNil(slices.Clone(defects))}
	if err == nil {
		e.FinalTree = res.Pass.Tree
	} else if c.Repo != nil {
		if tree, terr := candidateTree(c); terr == nil {
			e.FinalTree = tree
		}
	}
	e.FirstTreeGreen = err == nil && e.FinalTree == first && e.Blockers == 0
	if e.FinalTree == "" {
		return e
	}
	changed := e.FinalTree != first
	e.TreeChanged = &changed
	files, added, deleted := 0, 0, 0
	if changed {
		if c.Repo == nil {
			return e
		}
		out, derr := c.Repo.OK("diff", "--numstat", "--no-renames", first, e.FinalTree, "--")
		if derr != nil {
			return e
		}
		for _, line := range strings.Split(out, "\n") {
			if line == "" {
				continue
			}
			cols := strings.SplitN(line, "\t", 3)
			if len(cols) != 3 {
				return e
			}
			a, aok := numstatCount(cols[0])
			d, dok := numstatCount(cols[1])
			if !aok || !dok {
				return e
			}
			files, added, deleted = files+1, added+a, deleted+d
		}
	}
	e.FilesChanged, e.LinesAdded, e.LinesDeleted = &files, &added, &deleted
	return e
}

// numstatCount is a numstat column: a binary file's "-" counts 0.
func numstatCount(col string) (int, bool) {
	if col == "-" {
		return 0, true
	}
	n, err := strconv.Atoi(col)
	return n, err == nil
}

// tokensOf is the usage of one executor round as token totals: unknown stays unknown.
func tokensOf(u executor.Usage) core.Tokens {
	return core.Tokens{Input: clone(u.Input), Cached: clone(u.Cached), Output: clone(u.Output), Reasoning: clone(u.Reasoning)}
}

// wallMS is the review's wall time so far: the earlier calls' (a resumed checkpoint's) plus this
// call's elapsed time.
func (r *run) wallMS() int64 {
	return r.wallBase + time.Since(r.began).Milliseconds()
}

// account is the native review's account when its call returns.
func (r *run) account(res Result, err error) *Account {
	u := r.sess.Usage
	spent := Spend{Requests: r.sess.Requests, Input: clone(u.Input), Cached: clone(u.Cached), Output: clone(u.Output), WallMS: r.wallMS()}
	return newAccount(r.in, spent, r.sess.RepairRounds, effectOf(r.in.Candidate, r.first, res, err, r.sess.Blockers))
}

// account is the external review's account when its call returns: only its own rounds count.
func (v *xreview) account(res Result, err error) *Account {
	u := v.usage
	spent := Spend{Requests: v.rounds, Input: clone(u.Input), Cached: clone(u.Cached), Output: clone(u.Output), WallMS: time.Since(v.began).Milliseconds()}
	return newAccount(v.in, spent, v.repairs, effectOf(v.in.Candidate, v.in.Evidence.Pass.Tree, res, err, v.defects))
}
