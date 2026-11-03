module model {
 var requests: int
 var saved: int
 var forced: bool
 var notice: bool
 var unread: bool
 var approved: bool
 action init = all { requests'=0, saved'=0, forced'=false, notice'=false, unread'=true, approved'=false }
 action request = all { not(approved), requests'=requests+1, saved'=requests+1, forced'=(requests>=12), notice'=(requests>=12), unread'=unread, approved'=false }
 action read = all { requests'=requests, saved'=saved, forced'=forced, notice'=notice, unread'=false, approved'=approved }
 action resume = all { requests'=saved, saved'=saved, forced'=forced, notice'=notice, unread'=unread, approved'=approved }
 action approve = all { not(unread), requests'=requests, saved'=saved, forced'=forced, notice'=notice, unread'=unread, approved'=true }
 action step = any { request, read, resume, approve }
 val Budget = (requests>12) implies (forced and notice)
 val Persistent = saved==requests
 val Valid = approved implies not(unread)
}
