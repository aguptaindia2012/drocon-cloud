/* ============================================================================
   DroCon Cloud — HR / Payroll (Phase 4)
   - hr_employees : Employees & Consultants master (generic registry)
   - hr_salary    : monthly Salary Calculator (attendance/LOP-adjusted net pay,
                    replicating the Pilot Salary build-up)
   - hr_records   : Salary Records — paid/unpaid, balance, post to accounts
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;

/* ---------- date helpers ---------- */
function monthBounds(ym){ // ym 'YYYY-MM'
  const [y,m]=ym.split("-").map(Number);
  const start=new Date(Date.UTC(y,m-1,1));
  const end=new Date(Date.UTC(y,m,0));
  return { start, end, days:end.getUTCDate() };
}
const iso = d => d.toISOString().slice(0,10);
function daysInclusive(a,b){ if(b<a) return 0; return Math.floor((b-a)/86400000)+1; }
function sundays(a,b){ let n=0; const d=new Date(a); while(d<=b){ if(d.getUTCDay()===0) n++; d.setUTCDate(d.getUTCDate()+1); } return n; }
function parseISO(s){ return s?new Date(s+"T00:00:00Z"):null; }

/* ============================ Employees ============================ */
window.OPS.routes.hr_employees = window.OPS.makeRegistry({
  tool:"hr_employees", table:"employees", title:"Employees & Consultants", eyebrow:"HR", logView:true,
  orderBy:"name",
  searchKeys:["name","designation","emp_type","phone","email"],
  listCols:[
    {key:"name",label:"Name"},
    {key:"designation",label:"Designation"},
    {key:"emp_type",label:"Type"},
    {key:"monthly_salary",label:"Monthly Salary",num:true,fmt:v=>v==null?"":money(v)},
    {key:"status",label:"Status"},
  ],
  fields:[
    {key:"name",label:"Name",full:true,required:true},
    {key:"designation",label:"Designation"},
    {key:"emp_type",label:"Type",type:"select",options:["employee","consultant"]},
    {key:"monthly_salary",label:"Monthly Salary (₹)",type:"number"},
    {key:"doj",label:"Date of Joining",type:"date"},
    {key:"dol",label:"Date of Leaving (blank = active)",type:"date"},
    {key:"status",label:"Status",type:"select",options:["active","inactive"]},
    {key:"phone",label:"Phone"},
    {key:"email",label:"Email"},
    {key:"bank_details",label:"Bank details",type:"textarea",full:true},
    {key:"notes",label:"Notes",type:"textarea",full:true},
  ],
});

/* ============================ Salary Calculator ============================ */
let calcRows=[];
async function salaryCalc(){
  const ym = (window.OPS._hrMonth)||todayISO().slice(0,7);
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">HR</div><h1>Salary Calculator</h1>
    <div class="row" style="margin:10px 0">
      <label style="margin:0">Month</label><input id="scMonth" type="month" value="${ym}" style="width:auto">
      <div class="spacer"></div>
      <button class="btn green sm" id="scSave">Save / Recalculate month</button>
    </div>
    <div class="callout">Net = Monthly Salary × (engaged days − LOP days) ÷ days in month. Enter <b>LOP days</b> (loss-of-pay / unauthorised absence); joining/leaving mid-month is handled automatically.</div>
    <div id="scBody" class="muted">Loading…</div>`;
  $("scMonth").addEventListener("change",()=>{ window.OPS._hrMonth=$("scMonth").value; salaryCalc(); });
  $("scSave").addEventListener("click",saveMonth);
  const mb=monthBounds(ym);
  const [{data:emps},{data:runs}]=await Promise.all([
    sb().from("employees").select("*").eq("status","active").order("name"),
    sb().from("salary_runs").select("*").eq("period_month",ym) ]);
  const runByEmp={}; (runs||[]).forEach(r=>runByEmp[r.employee_id]=r);
  // who is engaged this month
  const active=(emps||[]).filter(e=>{
    const doj=parseISO(e.doj), dol=parseISO(e.dol);
    if(doj && doj>mb.end) return false;
    if(dol && dol<mb.start) return false;
    return true;
  });
  calcRows=active.map(e=>{
    const doj=parseISO(e.doj), dol=parseISO(e.dol);
    const ps = doj && doj>mb.start ? doj : mb.start;
    const pe = dol && dol<mb.end ? dol : mb.end;
    const wd=daysInclusive(ps,pe);
    const off=sundays(ps,pe);
    const ex=runByEmp[e.id];
    const lop=ex?num(ex.lop_days):0;
    return { emp:e, ps:iso(ps), pe:iso(pe), monthDays:mb.days, working:wd, off, lop, status:ex?ex.status:null, id:ex?ex.id:null };
  });
  renderCalc();
}
function compute(r){ const eff=Math.max(0,num(r.working)-num(r.lop)); const mw=r.monthDays?eff/r.monthDays:0; return { mw, net:Math.round(num(r.emp.monthly_salary)*mw) }; }
function renderCalc(){
  if(!calcRows.length){ $("scBody").innerHTML='<div class="card muted">No active employees engaged this month. Add them in <b>Employees & Consultants</b>.</div>'; return; }
  let totNet=0;
  const body=calcRows.map((r,i)=>{ const c=compute(r); totNet+=c.net; return `<tr>
    <td><b>${esc(r.emp.name)}</b><br><span class="muted">${esc(r.emp.designation||'')}</span></td>
    <td class="num">${money(r.emp.monthly_salary)}</td>
    <td class="muted">${r.ps.slice(8)}–${r.pe.slice(8)}</td>
    <td class="num">${r.working}</td><td class="num">${r.off}</td>
    <td><input data-i="${i}" type="number" step="any" value="${r.lop}" style="width:64px;text-align:right"></td>
    <td class="num">${(c.mw).toFixed(2)}</td>
    <td class="num"><b>${money(c.net)}</b></td>
    <td>${r.status?window.OPS.statusChip(r.status):'<span class="muted">new</span>'}</td></tr>`; }).join("");
  $("scBody").innerHTML=`<div style="overflow:auto"><table><thead><tr><th>Employee</th><th class="num">Monthly</th><th>Period</th><th class="num">Days</th><th class="num">Sun</th><th class="num">LOP</th><th class="num">×Factor</th><th class="num">Net Payable</th><th>Status</th></tr></thead>
    <tbody>${body}</tbody><tfoot><tr><th colspan="7" style="text-align:right">Total net payable</th><th class="num">${money(totNet)}</th><th></th></tr></tfoot></table></div>`;
  $("scBody").querySelectorAll("input[data-i]").forEach(inp=>inp.addEventListener("input",()=>{ calcRows[+inp.getAttribute("data-i")].lop=num(inp.value); renderCalc();
    const sel=$("scBody").querySelector(`input[data-i="${inp.getAttribute("data-i")}"]`); if(sel){ sel.focus(); sel.setSelectionRange(sel.value.length,sel.value.length);} }));
}
async function saveMonth(){
  const ym=$("scMonth").value;
  const recs=calcRows.map(r=>{ const c=compute(r); return {
    id:r.id||undefined, employee_id:r.emp.id, period_month:ym, period_start:r.ps, period_end:r.pe,
    monthly_salary:num(r.emp.monthly_salary), working_days:r.working, off_days:r.off, lop_days:num(r.lop),
    month_days:r.monthDays, month_worked:c.mw, net_payable:c.net,
    status:r.status||"calculated", created_by:window.OPS.me.id }; });
  // upsert by (employee_id, period_month)
  const { error }=await sb().from("salary_runs").upsert(recs,{onConflict:"employee_id,period_month"});
  if(error){ alert("Save failed: "+error.message); return; }
  window.OPS.flashTop("Saved "+recs.length+" salary run(s) for "+ym+" ✓"); salaryCalc();
}

/* ============================ Salary Records ============================ */
async function records(){
  const ym=(window.OPS._hrMonth)||todayISO().slice(0,7);
  if(window.OPS.access) window.OPS.access.log("salary_runs", ym, "Salary records "+ym);
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">HR</div><h1>Salary Records</h1>
    <div class="row" style="margin:10px 0"><label style="margin:0">Month</label><input id="rMonth" type="month" value="${ym}" style="width:auto">
      <div class="spacer"></div><button class="btn sm" id="rLedger">Accounting ledger</button></div>
    <div id="rBody" class="muted">Loading…</div>`;
  $("rMonth").addEventListener("change",()=>{ window.OPS._hrMonth=$("rMonth").value; records(); });
  $("rLedger").addEventListener("click",ledger);
  const { data:runs }=await sb().from("salary_runs").select("*, emp:employee_id(name,designation,emp_type)").eq("period_month",ym).order("created_at");
  const ids=(runs||[]).map(r=>r.id);
  let payBy={};
  if(ids.length){ const { data:pays }=await sb().from("salary_payments").select("salary_run_id,amount").in("salary_run_id",ids);
    (pays||[]).forEach(p=>payBy[p.salary_run_id]=(payBy[p.salary_run_id]||0)+num(p.amount)); }
  const rows=(runs||[]).map(r=>{ const paid=payBy[r.id]||0; return {r, paid, bal:num(r.net_payable)-paid}; });
  const totNet=rows.reduce((s,x)=>s+num(x.r.net_payable),0), totPaid=rows.reduce((s,x)=>s+x.paid,0);
  $("rBody").innerHTML=`
    <div class="statrow">
      <div class="stat"><div class="n">${money(totNet)}</div><div class="l">Calculated</div></div>
      <div class="stat"><div class="n">${money(totPaid)}</div><div class="l">Paid</div></div>
      <div class="stat"><div class="n">${money(totNet-totPaid)}</div><div class="l">Balance</div></div>
      <div class="stat"><div class="n">${rows.length}</div><div class="l">Employees</div></div>
    </div>
    ${rows.length?`<div style="overflow:auto"><table><thead><tr><th>Employee</th><th class="num">Net</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map(x=>`<tr><td><b>${esc(x.r.emp&&x.r.emp.name||'')}</b></td><td class="num">${money(x.r.net_payable)}</td>
        <td class="num">${money(x.paid)}</td><td class="num" style="${x.bal>0?'font-weight:700':''}">${money(x.bal)}</td>
        <td>${window.OPS.statusChip(x.r.status)}</td>
        <td>${x.r.status==='calculated'?`<button class="btn sm" data-post="${x.r.id}">Post</button> `:''}${x.bal>0.01?`<button class="btn sm" data-pay="${x.r.id}">+ Pay</button>`:''}</td></tr>`).join("")}</tbody></table></div>`
      :'<div class="card muted">No salary runs for this month. Calculate them in <b>Salary Calculator</b>.</div>'}`;
  $("rBody").querySelectorAll("[data-post]").forEach(b=>b.addEventListener("click",()=>postRun(rows.find(x=>x.r.id===b.getAttribute("data-post")).r)));
  $("rBody").querySelectorAll("[data-pay]").forEach(b=>b.addEventListener("click",()=>payRun(rows.find(x=>x.r.id===b.getAttribute("data-pay")))));
}
async function postRun(run){
  if(!confirm("Post "+money(run.net_payable)+" salary expense to accounts?")) return;
  await sb().from("accounting_entries").insert([
    { voucher_date:todayISO(), narration:"Salary "+run.period_month+" — "+(run.emp&&run.emp.name||""), account:"Salaries & Wages", debit:num(run.net_payable), credit:0, ref_type:"salary_run", ref_id:run.id, created_by:window.OPS.me.id },
    { voucher_date:todayISO(), narration:"Salary payable "+run.period_month, account:"Salaries Payable", debit:0, credit:num(run.net_payable), ref_type:"salary_run", ref_id:run.id, created_by:window.OPS.me.id },
  ]);
  await sb().from("salary_runs").update({status:"posted"}).eq("id",run.id);
  window.OPS.audit("posted","salary_run",run.id,money(run.net_payable)); window.OPS.flashTop("Posted to accounts ✓"); records();
}
function payRun(x){
  const run=x.r;
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="pBack">← Back</button>
    <div class="card" style="margin-top:12px;max-width:460px"><h1>Pay salary</h1>
      <p class="muted"><b>${esc(run.emp&&run.emp.name||'')}</b> · ${run.period_month} · Balance <b>${money(x.bal)}</b></p>
      <div class="fgrid"><div class="field"><label>Amount *</label><input id="pAmt" type="number" step="any" value="${x.bal}"></div>
        <div class="field"><label>Date</label><input id="pDate" type="date" value="${todayISO()}"></div>
        <div class="field"><label>Mode</label><select id="pMode"><option>Bank</option><option>UPI</option><option>Cash</option></select></div></div>
      <div class="row"><button class="btn green" id="pSave">Record payment</button><button class="btn" id="pCancel">Cancel</button></div>
      <div class="err" id="pErr"></div></div>`;
  $("pBack").addEventListener("click",records); $("pCancel").addEventListener("click",records);
  $("pSave").addEventListener("click",async()=>{
    const amt=num($("pAmt").value); if(amt<=0){ $("pErr").textContent="Enter an amount."; return; }
    await sb().from("salary_payments").insert({ salary_run_id:run.id, amount:amt, paid_on:$("pDate").value||todayISO(), mode:$("pMode").value, created_by:window.OPS.me.id });
    await sb().from("accounting_entries").insert([
      { voucher_date:$("pDate").value||todayISO(), narration:"Salary paid — "+(run.emp&&run.emp.name||""), account:"Salaries Payable", debit:amt, credit:0, ref_type:"salary_payment", ref_id:run.id, created_by:window.OPS.me.id },
      { voucher_date:$("pDate").value||todayISO(), narration:"Salary paid via "+$("pMode").value, account:$("pMode").value, debit:0, credit:amt, ref_type:"salary_payment", ref_id:run.id, created_by:window.OPS.me.id },
    ]);
    if(amt>=x.bal-0.01) await sb().from("salary_runs").update({status:"paid"}).eq("id",run.id);
    window.OPS.flashTop("Payment recorded ✓"); records();
  });
}
async function ledger(){
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="lBack">← Back to Salary Records</button><h1 style="margin-top:12px">Accounting ledger</h1><div id="lBody" class="muted">Loading…</div>`;
  $("lBack").addEventListener("click",records);
  const { data }=await sb().from("accounting_entries").select("*").order("voucher_date",{ascending:false}).limit(200);
  const rows=data||[];
  const dr=rows.reduce((s,r)=>s+num(r.debit),0), cr=rows.reduce((s,r)=>s+num(r.credit),0);
  $("lBody").innerHTML = rows.length?`<div style="overflow:auto"><table><thead><tr><th>Date</th><th>Narration</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td>${fmtDate(r.voucher_date)}</td><td>${esc(r.narration||'')}</td><td>${esc(r.account)}</td><td class="num">${r.debit?money(r.debit):''}</td><td class="num">${r.credit?money(r.credit):''}</td></tr>`).join("")}</tbody>
    <tfoot><tr><th colspan="3" style="text-align:right">Totals</th><th class="num">${money(dr)}</th><th class="num">${money(cr)}</th></tr></tfoot></table></div>`
    :'<div class="card muted">No accounting entries yet. Post a salary run to create them.</div>';
}

window.OPS.routes.hr_salary = salaryCalc;
window.OPS.routes.hr_records = records;
})();
