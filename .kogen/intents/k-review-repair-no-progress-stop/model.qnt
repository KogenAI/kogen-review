module model {
 var rounds: int
 var streak: int
 var blocked: bool
 var approved: bool
 action init = all { rounds'=0, streak'=0, blocked'=false, approved'=false }
 action failSame = all { not(approved), rounds'=rounds+1, streak'=streak+1, blocked'=(streak+1>=3 or rounds+1>=20), approved'=false }
 action progress = all { not(approved), rounds'=rounds+1, streak'=1, blocked'=(rounds+1>=20), approved'=false }
 action approve = all { not(blocked), rounds'=rounds, streak'=streak, blocked'=false, approved'=true }
 action step = any { failSame, progress, approve }
 val Bounded = (streak>=3 or rounds>=20) implies (blocked or approved)
 val Safe = not(blocked and approved)
}
