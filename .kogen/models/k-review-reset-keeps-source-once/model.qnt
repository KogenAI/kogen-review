module model {
  // The pinned source parts of one review.
  val Parts = Set(1, 2, 3)
  // window: parts whose read reached the model in the current working window (a model item
  // follows the read); pending: parts read in the newest outputs, not yet delivered;
  // resetUnread: the unread parts as of the latest reviewer reset (all parts before any reset);
  // delivered: every part whose read ever reached the model; handoff: 1 when the latest reset
  // carried the handoff, 0 when only the mandatory material fitted.
  var window: Set[int]
  var pending: Set[int]
  var resetUnread: Set[int]
  var delivered: Set[int]
  var handoff: int
  var approved: bool

  // The unread parts verdict validation uses: the Env's unread parts of the window, limited to
  // those still unread at the latest reset.
  def unread(w: Set[int], u: Set[int]): Set[int] = Parts.exclude(w).intersect(u)

  action init = all {
    window' = Set(), pending' = Set(), resetUnread' = Parts, delivered' = Set(),
    handoff' = 0, approved' = false,
  }
  action read = {
    nondet p = Parts.oneOf()
    all {
      not(approved),
      pending' = pending.union(Set(p)),
      window' = window, resetUnread' = resetUnread, delivered' = delivered,
      handoff' = handoff, approved' = approved,
    }
  }
  // A model response follows the newest outputs: they are delivered.
  action respond = all {
    not(approved),
    window' = window.union(pending), delivered' = delivered.union(pending), pending' = Set(),
    resetUnread' = resetUnread, handoff' = handoff, approved' = approved,
  }
  // The Env refused the next request: the reviewer archives the window; reads that never
  // reached the model are dropped and stay unread; the handoff is carried when it fits.
  action reset = {
    nondet fits = Set(true, false).oneOf()
    all {
      not(approved),
      resetUnread' = unread(window, resetUnread), window' = Set(), pending' = Set(),
      handoff' = if (fits) 1 else 0,
      delivered' = delivered, approved' = approved,
    }
  }
  action approve = all {
    not(approved), unread(window, resetUnread) == Set(),
    approved' = true,
    window' = window, pending' = pending, resetUnread' = resetUnread, delivered' = delivered,
    handoff' = handoff,
  }
  action step = any { read, respond, reset, approve }

  val NoUnreadApproval = approved implies delivered == Parts
  val ReadStaysRead = delivered.intersect(unread(window, resetUnread)) == Set()
  val UndeliveredUnread = Parts.exclude(delivered).subseteq(unread(window, resetUnread))
  val HandoffBounded = handoff <= 1
}
