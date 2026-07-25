/* ============================================================================
   DroCon Cloud — HR / Incentives + Bonuses  (per HR Policy v2.0)
   - hr_incentives : monthly, per-pilot, acreage-driven
        Tier 1 >= 400 acres -> ₹3,000 ; Tier 2 >= 550 acres -> ₹7,000
        No-Crash Bonus: 0 crashes AND acreage >= 200 -> ₹3,000
        Minor-incident waiver flagged when month repair cost <= ₹6,000
   - hr_bonuses    : ad-hoc discretionary bonuses to any employee / pilot
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const ymNow = ()=> (window.OPS._hrMonth)||todayISO().slice(0,7);
function monthBounds(ym){ const [y,m]=ym.split("-").map(Number); return { first:ym+"-01", last:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10) }; }
const norm = s => (s||"").replace(/\s+/g," ").trim().toLowerCase();

/* policy thresholds — single source of truth */
const TIER2_ACRES=550, TIER2_AMT=7000, TIER1_ACRES=400, TIER1_AMT=3000;
const NOCRASH_MIN_ACRES=200, NOCRASH_AMT=3000, MINOR_REPAIR_CAP=6000;
function tierOf(acres){ if(acres>=TIER2_ACRES) return {tier:"tier2",amt:TIER2_AMT}; if(acres>=TIER1_ACRES) return {tier:"tier1",amt:TIER1_AMT}; return {tier:null,amt:0}; }

/* ============================ Incentives ============================ */
let incRows=[];
async function incentives(){
  const ym=ymNow(), m=$("main");
  m.innerHTML=`<div class="eyebrow">HR</div><h1>Pilot Incentives</h1>
    <div class="row" style="margin:10px 0">
      <label style="margin:0">Month</label><input id="inMonth" type="month" value="${ym}" style="width:auto">
      <label style="margin:0 0 0 10px">Pay via</label><select id="inMode" style="width:auto"><option>Bank</option><option>UPI</option><option>Cash</option></select>
      <div class="spacer"></div><button class="btn green sm" id="inSave">Save / recompute</button></div>
    <div class="callout">Lists DroCon employees whose designation includes "Pilot". Acreage is summed automatically from approved acre entries, matched to the employee by name. <b>Tier 1</b> ≥ ${TIER1_ACRES} acres = ${money(TIER1_AMT)}, <b>Tier 2</b> ≥ ${TIER2_ACRES} acres = ${money(TIER2_AMT)} (highest tier only). <b>No-Crash Bonus</b> ${money(NOCRASH_AMT)} when crashes = 0 and acreage ≥ ${NOCRASH_MIN_ACRES}. Minor-incident waiver applies when the month's repair cost ≤ ${money(MINOR_REPAIR_CAP)}. Enter crashes &amp; repair cost, Save, then Pay.</div>
    <div id="inBody" class="muted">Loading…</div>`;
  $("inMonth").addEventListener("change",()=>{ window.OPS._hrMonth=$("inMonth").value; incentives(); });
  $("inSave").addEventListener("click",e=>window.OPS.once(e.currentTarget,saveIncentives));
  const {first,last}=monthBounds(ym);
  const [{data:emps},{data:pilots},{data:entries},{data:saved}]=await Promise.all([
    sb().from("employees").select("id,name,designation,emp_type,status").eq("emp_type","employee").order("name"),
    sb().from("pilots").select("id,name"),
    sb().from("acre_entries").select("acres,pilot_id,pilot_name,approval_status,entry_date").gte("entry_date",first).lte("entry_date",last),
    sb().from("hr_incentives").select("*").eq("period_month",ym),
  ]);
  const pilotName={}; (pilots||[]).forEach(p=>pilotName[p.id]=p.name);
  // acreage summed by pilot NAME — employee-pilots are not in the vendor pilots list
  const byName={};
  (entries||[]).forEach(e=>{ if((e.approval_status||"approved")!=="approved") return; const a=num(e.acres);
    const nm=norm(e.pilot_name || (e.pilot_id?pilotName[e.pilot_id]:"")); if(!nm) return; byName[nm]=(byName[nm]||0)+a; });
  const savedBy={}; (saved||[]).forEach(s=>{ if(s.employee_id) savedBy[s.employee_id]=s; });
  // DroCon employees whose designation marks them a Pilot
  const empPilots=(emps||[]).filter(e=>/pilot/i.test(e.designation||""));
  incRows=empPilots.map(e=>{
    const acres=Math.round((byName[norm(e.name)]||0)*100)/100;
    const ex=savedBy[e.id];
    return { emp:e, acres, crashes:ex?num(ex.crashes):0, repair:ex?num(ex.repair_cost):0,
             status:ex?ex.status:null, id:ex?ex.id:null };
  }).filter(r=>r.acres>0 || savedBy[r.emp.id] || r.emp.status==="active");
  renderIncentives(ym);
}
function incCompute(r){ const t=tierOf(r.acres); const noCrash=(num(r.crashes)===0 && r.acres>=NOCRASH_MIN_ACRES)?NOCRASH_AMT:0;
  return { ...t, noCrash, waiver:num(r.repair)<=MINOR_REPAIR_CAP, total:t.amt+noCrash }; }
function renderIncentives(ym){
  if(!incRows.length){ $("inBody").innerHTML='<div class="card muted">No employee-pilots found. In <b>Employees</b>, set the designation to include "Pilot" for DroCon\'s own pilots.</div>'; return; }
  let tot=0;
  const body=incRows.map((r,i)=>{ const c=incCompute(r); tot+=c.total; const paid=r.status==="paid"; return `<tr>
    <td><b>${esc(r.emp.name)}</b><br><span class="muted">${esc(r.emp.designation||'')}</span></td>
    <td class="num">${r.acres}</td>
    <td>${c.tier?`<b>${c.tier==="tier2"?"Tier 2":"Tier 1"}</b> · ${money(c.amt)}`:'<span class="muted">—</span>'}</td>
    <td><input data-crash="${i}" type="number" min="0" step="1" value="${r.crashes}" ${paid?"disabled":""} style="width:56px;text-align:right"></td>
    <td><input data-rep="${i}" type="number" min="0" step="any" value="${r.repair}" ${paid?"disabled":""} style="width:80px;text-align:right"></td>
    <td class="num">${c.noCrash?money(c.noCrash):'—'}</td>
    <td>${c.waiver?'<span style="color:#137a2e">✓ waived</span>':'<span style="color:#a11">exceeds cap</span>'}</td>
    <td class="num"><b>${money(c.total)}</b></td>
    <td>${paid?window.OPS.statusChip("paid"):(r.id?'<span class="muted">saved</span>':'<span class="muted">new</span>')}</td>
    <td>${(!paid && r.id && c.total>0)?`<button class="btn sm" data-pay="${i}">Pay</button>`:''}</td></tr>`; }).join("");
  $("inBody").innerHTML=`<div style="overflow:auto"><table><thead><tr><th>Pilot</th><th class="num">Acres</th><th>Tier</th><th class="num">Crashes</th><th class="num">Repair ₹</th><th class="num">No-crash</th><th>Minor waiver</th><th class="num">Total</th><th>Status</th><th></th></tr></thead>
    <tbody>${body}</tbody><tfoot><tr><th colspan="7" style="text-align:right">Total incentive</th><th class="num">${money(tot)}</th><th colspan="2"></th></tr></tfoot></table></div>`;
  $("inBody").querySelectorAll("input[data-crash]").forEach(inp=>inp.addEventListener("input",()=>{ incRows[+inp.getAttribute("data-crash")].crashes=num(inp.value); renderIncentives(ym); reFocus("data-crash",inp.getAttribute("data-crash")); }));
  $("inBody").querySelectorAll("input[data-rep]").forEach(inp=>inp.addEventListener("input",()=>{ incRows[+inp.getAttribute("data-rep")].repair=num(inp.value); renderIncentives(ym); reFocus("data-rep",inp.getAttribute("data-rep")); }));
  $("inBody").querySelectorAll("[data-pay]").forEach(b=>b.addEventListener("click",e=>window.OPS.once(e.currentTarget,()=>payIncentive(incRows[+b.getAttribute("data-pay")],ym))));
}
function reFocus(attr,i){ const el=$("inBody").querySelector(`input[${attr}="${i}"]`); if(el){ el.focus(); el.setSelectionRange(el.value.length,el.value.length); } }
async function saveIncentives(){
  const ym=$("inMonth").value;
  const recs=incRows.filter(r=>r.status!=="paid").map(r=>{ const c=incCompute(r); return {
    period_month:ym, employee_id:r.emp.id, pilot_name:r.emp.name, acres:r.acres,
    tier:c.tier, tier_amount:c.amt, crashes:num(r.crashes), repair_cost:num(r.repair),
    minor_waiver:c.waiver, no_crash_bonus:c.noCrash, total:c.total,
    status:r.status||"calculated", created_by:window.OPS.me.id }; });
  if(!recs.length){ window.OPS.flashTop("Nothing to save."); return; }
  const { error }=await sb().from("hr_incentives").upsert(recs,{onConflict:"period_month,employee_id"});
  if(error){ alert("Save failed: "+error.message); return; }
  window.OPS.flashTop("Saved "+recs.length+" incentive row(s) ✓"); incentives();
}
async function payIncentive(r,ym){
  const c=incCompute(r); const mode=$("inMode").value; const today=todayISO();
  if(!confirm("Pay "+money(c.total)+" incentive to "+r.emp.name+" ("+ym+") via "+mode+"?")) return;
  await sb().from("accounting_entries").insert([
    { voucher_date:today, narration:"Pilot incentive "+ym+" — "+r.emp.name, account:"Pilot Incentives", debit:c.total, credit:0, ref_type:"incentive", ref_id:r.id, created_by:window.OPS.me.id },
    { voucher_date:today, narration:"Incentive paid via "+mode, account:mode, debit:0, credit:c.total, ref_type:"incentive", ref_id:r.id, created_by:window.OPS.me.id },
  ]);
  await sb().from("hr_incentives").update({ status:"paid", paid_on:today, mode }).eq("id",r.id);
  window.OPS.audit&&window.OPS.audit("paid","incentive",r.id,money(c.total));
  window.OPS.flashTop("Incentive paid ✓"); incentives();
}

/* ============================ Ad-hoc Bonuses ============================ */
async function bonuses(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">HR</div><h1>Bonuses</h1>
    <div class="callout">Discretionary one-off bonuses for any employee or pilot — separate from the acreage incentive. Add, then Pay to post it to the accounts.</div>
    <div id="bnForm"></div>
    <div id="bnBody" class="muted" style="margin-top:12px">Loading…</div>`;
  const [{data:emps},{data:pilots},{data:list}]=await Promise.all([
    sb().from("employees").select("id,name,designation,emp_type").order("name"),
    sb().from("pilots").select("id,name").order("name"),
    sb().from("hr_bonuses").select("*").order("created_at",{ascending:false}).limit(200),
  ]);
  const payees=[
    ...(emps||[]).map(e=>({kind:e.emp_type==="consultant"?"other":"employee",id:e.id,name:e.name,label:(e.emp_type==="consultant"?"Consultant: ":"Employee: ")+e.name})),
    ...(pilots||[]).map(p=>({kind:"pilot",id:p.id,name:p.name,label:"Pilot: "+p.name})),
  ];
  $("bnForm").innerHTML=`<div class="card" style="max-width:620px"><div class="fgrid">
    <div class="field" style="grid-column:1/-1"><label>Payee *</label><select id="bnPayee"><option value="">— select —</option>${payees.map((p,i)=>`<option value="${i}">${esc(p.label)}</option>`).join("")}</select></div>
    <div class="field"><label>Title *</label><input id="bnTitle" placeholder="Festival bonus / spot award"></div>
    <div class="field"><label>Amount (₹) *</label><input id="bnAmt" type="number" step="any"></div>
    <div class="field"><label>For month</label><input id="bnMonth" type="month" value="${ymNow()}"></div>
    <div class="field"><label>Pay via</label><select id="bnMode"><option>Bank</option><option>UPI</option><option>Cash</option></select></div>
    <div class="field" style="grid-column:1/-1"><label>Reason / note</label><input id="bnReason"></div>
    </div><button class="btn green" id="bnAdd">Add bonus</button><div class="err" id="bnErr"></div></div>`;
  $("bnAdd").addEventListener("click",e=>window.OPS.once(e.currentTarget,async()=>{
    const pi=$("bnPayee").value, title=$("bnTitle").value.trim(), amt=num($("bnAmt").value);
    if(pi===""){ $("bnErr").textContent="Pick a payee."; return; }
    if(!title){ $("bnErr").textContent="Enter a title."; return; }
    if(amt<=0){ $("bnErr").textContent="Enter an amount."; return; }
    const p=payees[+pi];
    const { error }=await sb().from("hr_bonuses").insert({ pay_month:$("bnMonth").value||null, payee_kind:p.kind, payee_id:p.id, payee_name:p.name,
      title, amount:amt, reason:$("bnReason").value.trim()||null, status:"pending", created_by:window.OPS.me.id });
    if(error){ $("bnErr").textContent=error.message; return; }
    window.OPS.audit&&window.OPS.audit("added","bonus",p.name,money(amt)); window.OPS.flashTop("Bonus added ✓"); bonuses();
  }));
  const rows=list||[];
  $("bnBody").innerHTML = rows.length ? `<div style="overflow:auto"><table><thead><tr><th>Payee</th><th>Title</th><th>Month</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map(b=>`<tr><td><b>${esc(b.payee_name)}</b><br><span class="muted">${esc(b.payee_kind)}</span></td>
      <td>${esc(b.title)}${b.reason?`<br><span class="muted">${esc(b.reason)}</span>`:''}</td>
      <td>${b.pay_month||'—'}</td><td class="num">${money(b.amount)}</td>
      <td>${window.OPS.statusChip(b.status==="paid"?"paid":"pending")}${b.status==="paid"&&b.paid_on?`<br><span class="muted">${fmtDate(b.paid_on)} · ${esc(b.mode||'')}</span>`:''}</td>
      <td>${b.status!=="paid"?`<button class="btn sm" data-bpay="${b.id}">Pay</button> <button class="btn sm ghost" data-bdel="${b.id}">Delete</button>`:''}</td></tr>`).join("")}</tbody></table></div>`
    : '<div class="card muted">No bonuses yet.</div>';
  $("bnBody").querySelectorAll("[data-bpay]").forEach(x=>x.addEventListener("click",e=>window.OPS.once(e.currentTarget,()=>payBonus(rows.find(b=>b.id===x.getAttribute("data-bpay"))))));
  $("bnBody").querySelectorAll("[data-bdel]").forEach(x=>x.addEventListener("click",async()=>{
    if(!confirm("Delete this bonus?")) return;
    await sb().from("hr_bonuses").delete().eq("id",x.getAttribute("data-bdel")); bonuses();
  }));
}
async function payBonus(b){
  if(!b) return; const mode=$("bnMode")?$("bnMode").value:"Bank"; const today=todayISO();
  if(!confirm("Pay "+money(b.amount)+" bonus to "+b.payee_name+" via "+mode+"?")) return;
  await sb().from("accounting_entries").insert([
    { voucher_date:today, narration:"Bonus — "+b.payee_name+" ("+b.title+")", account:"Staff Bonus", debit:num(b.amount), credit:0, ref_type:"bonus", ref_id:b.id, created_by:window.OPS.me.id },
    { voucher_date:today, narration:"Bonus paid via "+mode, account:mode, debit:0, credit:num(b.amount), ref_type:"bonus", ref_id:b.id, created_by:window.OPS.me.id },
  ]);
  await sb().from("hr_bonuses").update({ status:"paid", paid_on:today, mode }).eq("id",b.id);
  window.OPS.audit&&window.OPS.audit("paid","bonus",b.id,money(b.amount));
  window.OPS.flashTop("Bonus paid ✓"); bonuses();
}

window.OPS.routes.hr_incentives = incentives;
window.OPS.routes.hr_bonuses    = bonuses;
})();
