package consumes

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"syscall"
	"testing"

	"kogen-loop/sys"
)

// kogen-review stops with sys.Fail and reads the stop back with sys.AsError
// (review/invalid.go, review/independent.go, cmd/kogen-review/main.go).
func TestFailMakesTheStopKogenReviewReports(t *testing.T) {
	e := sys.Fail("candidate", "review_invalid", "the reviewer did not return a valid verdict; edits are left in place", 1)
	eq(t, "sys.Error.Class", e.Class, "candidate")
	eq(t, "sys.Error.Reason", e.Reason, "review_invalid")
	eq(t, "sys.Error.Detail", e.Detail, "the reviewer did not return a valid verdict; edits are left in place")
	eq(t, "sys.Error.Exit", e.Exit, 1)
	eq(t, "sys.Error.Lines: a stop made by sys.Fail has no lines", len(e.Lines), 0)
	// The other stops kogen-review makes.
	r := sys.Fail("review", "repair_unverified", "x", 1)
	eq(t, "sys.Fail: a stop with a class, reason, detail and exit", fmt.Sprintf("%s|%s|%s|%d", r.Class, r.Reason, r.Detail, r.Exit), "review|repair_unverified|x|1")
	eq(t, "sys.Fail: kogen-review/failed wraps a plain error", sys.Fail("kogen-review", "failed", "boom", 1).Error(), "kogen-review/failed: boom")
	// Error() is `<class>/<reason>: <detail>`.
	eq(t, "sys.Fail", e.Error(), "candidate/review_invalid: the reviewer did not return a valid verdict; edits are left in place")
	// Lines are a field kogen-review reads, filled by the producer's own stops.
	e.Lines = []string{"a", "b"}
	deepEq(t, "sys.Error.Lines", e.Lines, []string{"a", "b"})
}

func TestAsErrorFindsTheStopInAnErrorChain(t *testing.T) {
	stop := sys.Fail("candidate", "review_blocked", "blocked", 1)
	got, ok := sys.AsError(stop)
	eq(t, "sys.AsError: the stop itself", ok, true)
	eq(t, "sys.AsError: the same stop", got, stop)

	wrapped := fmt.Errorf("while reviewing: %w", stop)
	got, ok = sys.AsError(wrapped)
	eq(t, "sys.AsError: a wrapped stop", ok, true)
	eq(t, "sys.AsError: the wrapped stop is returned as is", got, stop)

	got, ok = sys.AsError(errors.New("plain"))
	eq(t, "sys.AsError: a plain error is no stop", ok, false)
	eq(t, "sys.AsError: a plain error gives nil", got == nil, true)
	got, ok = sys.AsError(nil)
	eq(t, "sys.AsError: nil is no stop", ok, false)
	eq(t, "sys.AsError: nil gives nil", got == nil, true)
}

// cmd/kogen-review/main.go: sys.New() reads this process's environment (HOME for the
// reviewer's home) and its stdout is replaced by the command's stderr.
func TestNewReadsTheProcessEnvironment(t *testing.T) {
	t.Setenv("KOGEN_REVIEW_CONSUMES_MARK", "marked")
	s := sys.New()
	eq(t, "sys.New", s != nil, true)
	eq(t, "sys.Session.Getenv: a variable of the process", s.Getenv("KOGEN_REVIEW_CONSUMES_MARK"), "marked")
	eq(t, "sys.Session.Getenv: HOME is the test's own", s.Getenv("HOME"), os.Getenv("HOME"))
	eq(t, "sys.Session.Getenv: HOME is set", s.Getenv("HOME") != "", true)
	eq(t, "sys.Session.Getenv: an unset variable is empty", s.Getenv("KOGEN_REVIEW_CONSUMES_UNSET"), "")
}

func TestSessionStdoutIsWhereTheSessionWritesItsOutput(t *testing.T) {
	s := sys.New()
	eq(t, "sys.Session.Stdout: New writes to the process's stdout", s.Stdout == os.Stdout, true)
	var out bytes.Buffer
	s.Stdout = &out
	s.Puts("one")
	s.Out("two")
	eq(t, "sys.Session.Stdout: the replaced writer receives the output unchanged", out.String(), "one\ntwo")
}

func TestSessionProgressWritesOneLine(t *testing.T) {
	s := sys.New()
	var errs, out bytes.Buffer
	s.Stderr, s.Stdout = &errs, &out
	s.Progress("kogen: reviewing (review 1)")
	s.Progress("kogen: review 1: approve, 0 blocking")
	eq(t, "sys.Session.Progress: one line each on stderr", errs.String(), "kogen: reviewing (review 1)\nkogen: review 1: approve, 0 blocking\n")
	eq(t, "sys.Session.Progress: nothing on stdout", out.Len(), 0)
}

func TestSessionContextAndErrStartLiveAndEndWithTheInterrupt(t *testing.T) {
	s := sys.New()
	eq(t, "sys.Session.Err: nil before an interrupt", s.Err() == nil, true)
	eq(t, "sys.Session.Context: not done before an interrupt", s.Context().Err() == nil, true)
	select {
	case <-s.Context().Done():
		t.Fatal("sys.Session.Context: done before an interrupt")
	default:
	}
	eq(t, "sys.Session.Err: the first interrupt counts", s.Interrupt("SIGINT"), true)
	<-s.Context().Done()
	eq(t, "sys.Session.Context: done after an interrupt", s.Context().Err() != nil, true)
	err := s.Err()
	eq(t, "sys.Session.Err: the interrupt", err != nil && err.Error() == "interrupted by SIGINT", true)
	eq(t, "sys.Session.Err: a second interrupt does not change it", s.Interrupt("SIGTERM"), false)
	eq(t, "sys.Session.Err: the first signal stays", s.Err().Error(), "interrupted by SIGINT")
}

// cmd/kogen-review/main.go: stop := s.WatchSignals(); defer stop().
func TestWatchSignalsTurnsATerminalSignalIntoTheSessionsInterrupt(t *testing.T) {
	s := sys.New()
	stop := s.WatchSignals()
	defer stop()
	if err := syscall.Kill(os.Getpid(), syscall.SIGHUP); err != nil {
		t.Fatal(err)
	}
	<-s.Context().Done()
	err := s.Err()
	eq(t, "sys.Session.WatchSignals: SIGHUP interrupts the session", err != nil && err.Error() == "interrupted by SIGHUP", true)
}

func TestWatchSignalsStopEndsTheWatch(t *testing.T) {
	s := sys.New()
	stop := s.WatchSignals()
	stop()
	eq(t, "sys.Session.WatchSignals: the stop function returns", s.Err() == nil, true)
}

// The supervisor argument is the first argument only of a process Kogen itself starts;
// kogen-review's own arguments are flags, and MaybeSupervise then returns at once.
func TestMaybeSuperviseReturnsWhenTheArgumentsDoNotStartTheSupervisor(t *testing.T) {
	for _, args := range [][]string{
		nil,
		{},
		{"-start", "abc", "-slug", "x", "-model", "m"},
		{"-h"},
		{"__kogen_review_not_the_supervisor", "echo hi"},
	} {
		sys.MaybeSupervise(args)
	}
	eq(t, "sys.MaybeSupervise: returns for kogen-review's arguments", true, true)
}
