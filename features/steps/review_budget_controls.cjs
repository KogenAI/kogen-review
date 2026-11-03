const observe = require('./review_budget_observer.cjs');
const cases = [
 {requests:13,verdict:'approve',reason:'',interrupted:false,bound:12,forced:true,reminders:[]},
 {requests:15,verdict:'approve',reason:'',interrupted:false,bound:12,forced:true,reminders:[],unread_through:14,rejected_at:14},
 {requests:3,verdict:'approve',reason:'',interrupted:false,bound:12,forced:true,reminders:[]},
 {requests:13,verdict:'approve',reason:'',interrupted:false,bound:12,forced:true,reminders:[5],rejected_at:3,no_tool_at:5},
 {requests:14,verdict:'',reason:'no_tool_reminder_exhausted',interrupted:false,bound:12,forced:false,reminders:[14],no_tool_at:14},
 {requests:13,verdict:'approve',reason:'',interrupted:true,bound:12,forced:true,reminders:[]}
];
function fixture(e) {
 return {verdict:e.verdict,reason:e.reason,error:e.reason ? 'invalid verdict' : '',interrupted:e.interrupted,
 rows:Array.from({length:e.requests},(_,i)=>{
 const n=i+1, budget=n>e.bound;
 return {n,count:n,policy:true,budget,force:(budget||e.reminders.includes(n))&&e.forced?'submit_review':'',rejected:e.rejected_at&&n>=e.rejected_at?1:0,no_tool:e.no_tool_at&&n>=e.no_tool_at?1:0,unread:e.unread_through&&n<=e.unread_through?1:0,users:1};
 })};
}
if (process.argv[2] === 'good') {
 for (const e of cases) observe(fixture(e),e);
 console.log('budget observer accepted controls');
} else if (process.argv[2] === 'bad') {
 const e=cases[1], f=fixture(e);
 f.rows[14].force='';
 try { observe(f,e); } catch (_) { console.log('budget observer rejected missing forced submission after unread progress'); process.exit(1); }
 console.log('budget observer incorrectly accepted bad control');
} else { throw new Error('expected good or bad'); }
