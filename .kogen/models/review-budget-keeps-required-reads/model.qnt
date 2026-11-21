module model {
  type State = { requests: int, unread: int, rejected: int, stopped: bool, approved: bool, prompt: str }
  var live: State
  var saved: State
  pure def nextPrompt(n: int): str = if (n > 0) "read" else "verdict"
  pure val initial: State = {requests: 11, unread: 3, rejected: 0, stopped: false, approved: false, prompt: "ordinary"}
  action init = all { live' = initial, saved' = initial }
  action advance(s: State): bool = all { not(live.stopped), live' = s, saved' = s }
  action progress = all {
    live.unread > 0,
    advance({ ...live, requests: live.requests + 1, unread: live.unread - 1,
      prompt: if (live.requests >= 12) nextPrompt(live.unread - 1) else "ordinary" })
  }
  action idle = advance({ ...live, requests: live.requests + 1,
    rejected: if (live.requests >= 12) live.rejected + 1 else live.rejected,
    stopped: live.requests >= 12 and live.rejected >= 1,
    prompt: if (live.requests >= 12) nextPrompt(live.unread) else "ordinary" })
  action verdict = advance({ ...live, requests: live.requests + 1,
    approved: live.unread == 0, stopped: live.unread == 0 or live.rejected >= 1,
    rejected: if (live.unread > 0) live.rejected + 1 else live.rejected,
    prompt: if (live.requests >= 12) nextPrompt(live.unread) else "ordinary" })
  action resetOrResume = all { live' = saved, saved' = saved }
  action done = all { live.stopped, live' = live, saved' = saved }
  action step = any { progress, idle, verdict, resetOrResume, done }
  val ReadBeforeApproval = live.approved implies live.unread == 0
  val BoundedStalls = live.rejected <= 2
  val Persistent = live == saved
  val ReadPrompt = (live.requests > 12 and live.unread > 0) implies live.prompt == "read"
}
