module reviewRecord {
  var submitted: bool
  var verified: bool
  var failed: bool
  var approved: bool
  var repairs: int
  action init = all { submitted' = false, verified' = false, failed' = false, approved' = false, repairs' = 0 }
  action submit = all { submitted' = true, verified' = false, failed' = false, approved' = false, repairs' = repairs }
  action green = all { submitted, verified' = true, approved' = true, failed' = false, submitted' = submitted, repairs' = repairs }
  action red = all { submitted, repairs < 2, repairs' = repairs + 1, submitted' = submitted, verified' = false, approved' = false, failed' = false }
  action error = all { failed' = true, approved' = false, verified' = false, submitted' = submitted, repairs' = repairs }
  action step = any { submit, green, red, error }
  val Unverified = (approved implies (submitted and verified and not(failed))) and (repairs >= 0 and repairs <= 2)
}
