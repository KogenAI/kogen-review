// The prose-only allowance of one native review (Intent k-review-prose-allowance-per-streak).
// A turn is the reviewer's answer to one request: prose only, tool calls, or a valid verdict.
// The first prose-only turn of a review gets a reminder, and the next request requires
// submit_review (forced where the route supports it). A later prose-only turn gets a reminder
// only when the reviewer made a tool call since the last reminder (the allowance is restored)
// and fewer than CAP reminders were given; otherwise the review stops, by cause. Every turn is
// checkpointed before the next request, and a resume continues the checkpoint. Requests
// required by the working budget are left out.
module model {
  pure val CAP = 3

  type State = { reminders: int, restored: bool, remind: bool, prose: int, forced: int, answered: int, stop: str }

  var live: State
  var saved: State

  pure val start: State = { reminders: 0, restored: false, remind: false, prose: 0, forced: 0, answered: 0, stop: "none" }

  action init = all { live' = start, saved' = start }

  // The state after a prose-only answer to the request.
  pure def proseTurn(s: State): State = {
    val forced = if (s.remind) s.forced + 1 else s.forced
    val give = s.reminders == 0 or (s.restored and s.reminders < CAP)
    if (give) { ...s, reminders: s.reminders + 1, restored: false, remind: true, prose: s.prose + 1, forced: forced }
    else { ...s, remind: false, prose: s.prose + 1, forced: forced, stop: if (s.restored) "cap" else "exhausted" }
  }

  // The state after an answer with tool calls (verdict: one of them is a valid verdict).
  pure def toolTurn(s: State, verdict: bool): State = {
    { ...s,
      restored: s.restored or s.reminders >= 1,
      remind: false,
      forced: if (s.remind) s.forced + 1 else s.forced,
      answered: if (s.remind) s.answered + 1 else s.answered,
      stop: if (verdict) "verdict" else "none" }
  }

  action answer(after: State): bool = all { live.stop == "none", live' = after, saved' = after }
  action prose = answer(proseTurn(live))
  action tools = answer(toolTurn(live, false))
  action verdict = answer(toolTurn(live, true))
  // An interrupted request is lost; the resume continues the latest checkpoint.
  action interruptAndResume = all { live.stop == "none", live' = saved, saved' = saved }
  action done = all { live.stop != "none", live' = live, saved' = saved }

  action step = any { prose, tools, verdict, interruptAndResume, done }

  // At most CAP reminders, however often the reviewer works.
  val Capped = live.reminders <= CAP
  // The stop names its cause: no tool call since the last reminder, or the cap after working.
  val Cause = (live.stop == "exhausted" implies not(live.restored)) and (live.stop == "cap" implies (live.restored and live.reminders == CAP))
  // Every prose-only turn got a reminder, except the one that stopped the review.
  val Counted = live.prose == live.reminders + (if (live.stop == "exhausted" or live.stop == "cap") 1 else 0)
  // Each reminder is followed by one forced request; only one answered with prose stops the review.
  val Forced = live.forced == live.reminders - (if (live.remind) 1 else 0) and live.answered == live.forced - (if (live.stop == "exhausted") 1 else 0)
  // A resume continues the reminder count and the restored allowance.
  val Persistent = saved == live
}
