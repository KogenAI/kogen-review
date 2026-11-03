module model {
  var tree: int
  var verified: int
  var success: bool
  val ExactGreen = success implies verified == tree
  action init = all { tree' = 0, verified' = -1, success' = false }
  action change = all { tree' = tree + 1, verified' = verified, success' = false }
  action pass = all { tree' = tree, verified' = tree, success' = true }
  action red = all { tree' = tree, verified' = tree, success' = false }
  action step = any { change, pass, red }
}
