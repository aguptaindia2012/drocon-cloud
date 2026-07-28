/* ============================================================================
   DroCon Cloud — Employee Expense Claims (self-service) + Review
   Eight claim types with receipt uploads (sql/59). Employees file from
   "My Expenses"; HR/approvers review under Finance → Expense Claims.
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const DA_CAP=250, MILEAGE_RATE=5;

const TYPES = {
  da:{ label:"Daily Allowance (DA)", monthly:true, note:`Maximum ₹${DA_CAP} per day.`,
    cols:[{k:"date",l:"Date",t:"date"},{k:"location",l:"Location of operation"},{k:"amount",l:"Amount ₹",t:"num"}],
    rowErr:r=> num(r.amount)>DA_CAP ? `DA cannot exceed ₹${DA_CAP}/day` : "" },
  mileage:{ label:"Vehicle Mileage", monthly:true, note:`Reimbursed at ₹${MILEAGE_RATE}/km.`,
    cols:[{k:"date",l:"Date",t:"date"},{k:"route",l:"Purpose / Route"},{k:"odo_start",l:"Odo start",t:"num"},{k:"odo_end",l:"Odo end",t:"num"},{k:"km",l:"KM",t:"ro"},{k:"amount",l:"Amount ₹",t:"ro"}],
    compute:r=>{ r.km=Math.max(0,num(r.odo_end)-num(r.odo_start)); r.amount=Math.round(r.km*MILEAGE_RATE*100)/100; } },
  hotel:{ label:"Hotel Accommodation",
    cols:[{k:"hotel",l:"Hotel name & address"},{k:"bill_no",l:"Bill/Invoice no."},{k:"check_in",l:"Check-in",t:"date"},{k:"check_out",l:"Check-out",t:"date"},{k:"amount",l:"Amount ₹",t:"num"}] },
  local_transport:{ label:"Local Transport Rental",
    cols:[{k:"date",l:"Date",t:"date"},{k:"vehicle",l:"Vehicle type"},{k:"vendor",l:"Vendor / Provider"},{k:"from",l:"From"},{k:"to",l:"To"},{k:"amount",l:"Amount ₹",t:"num"}] },
  hired_help:{ label:"Hired Help / Co-Pilot",
    cols:[{k:"name",l:"Name"},{k:"contact",l:"Contact"},{k:"from",l:"From",t:"date"},{k:"to",l:"To",t:"date"},{k:"desc",l:"Work performed"},{k:"amount",l:"Amount ₹",t:"num"}] },
  misc:{ label:"Miscellaneous",
    cols:[{k:"desc",l:"Description"},{k:"bill_no",l:"Bill/Invoice no."},{k:"date",l:"Date",t:"date"},{k:"mode",l:"Payment mode"},{k:"amount",l:"Amount ₹",t:"num"}] },
  house_rent:{ label:"House Rent Declaration", special:"house_rent" },
  advance:{ label:"Advance Request", special:"advance" },
};
const ADV_CATS=["Daily Allowance","House Rent","Vehicle Mileage","Hotel Accommodation","Local Transport Rental","Hired Help / Co-Pilot","Other Travel","Miscellaneous / Contingency"];
const typeLabel=k=> (TYPES[k]&&TYPES[k].label)||k;

/* ---------- employee identity (link login → employee by email) ---------- */
let ME_EMP=null; // {id,name} | false
async function resolveEmployee(){
  if(ME_EMP!==null) return ME_EMP;
  try{
    const { data:eid }=await sb().rpc("link_employee_login");
    if(eid){ const { data:e }=await sb().from("employees").select("id,name").eq("id",eid).maybeSingle(); ME_EMP=e?{id:e.id,name:e.name}:false; }
    else ME_EMP=false;
  }catch(e){ ME_EMP=false; }
  return ME_EMP;
}

/* ---------- receipts ---------- */
async function uploadReceipts(claimId, empId, files){
  const out=[];
  for(const f of files){
    const safe=(f.name||"file").replace(/[^\w.\-]+/g,"_");
    const path=`${empId||"x"}/${claimId}/${Date.now()}_${safe}`;
    const { error }=await sb().storage.from("receipts").upload(path, f, {upsert:false});
    if(!error) out.push({path, name:f.name||safe});
  }
  return out;
}
async function receiptLink(path){
  try{ const { data }=await sb().storage.from("receipts").createSignedUrl(path, 3600); return data&&data.signedUrl; }catch(e){ return null; }
}

/* ---------- generic line editor for tabular types ---------- */
function lineEditor(host, type, rows, onTotal){
  const cols=type.cols;
  function recompute(){ rows.forEach(r=>{ if(type.compute) type.compute(r); }); if(onTotal) onTotal(rows.reduce((s,r)=>s+num(r.amount),0)); }
  function draw(){
    recompute();
    const head=cols.map(c=>`<th class="${(c.t==='num'||c.t==='ro')?'num':''}">${esc(c.l)}</th>`).join("")+"<th></th>";
    const body=rows.map((r,i)=>`<tr data-i="${i}">${cols.map(c=>{
      if(c.t==="ro") return `<td class="num">${c.k==="amount"?money(r[c.k]):num(r[c.k])}</td>`;
      const inp = c.t==="date" ? `<input type="date" data-k="${c.k}" value="${esc(r[c.k]||"")}">`
        : c.t==="num" ? `<input type="number" step="any" data-k="${c.k}" value="${esc(r[c.k]==null?"":r[c.k])}" style="width:100px">`
        : `<input data-k="${c.k}" value="${esc(r[c.k]||"")}" style="min-width:130px">`;
      const err = (c.k==="amount"&&type.rowErr)?type.rowErr(r):"";
      return `<td class="${(c.t==='num')?'num':''}">${inp}${err?`<div class="err" style="font-size:11px">${esc(err)}</div>`:""}</td>`;
    }).join("")}<td><button class="btn sm" data-del="${i}">✕</button></td></tr>`).join("");
    host.innerHTML=`<div style="overflow:auto"><table class="tight"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="row" style="margin-top:6px"><button class="btn sm" id="elAdd">+ Add ${type.monthly?"day":"line"}</button></div>`;
    host.querySelectorAll("input[data-k]").forEach(inp=>{
      inp.addEventListener("input",()=>{ const i=+inp.closest("tr").getAttribute("data-i"); rows[i][inp.getAttribute("data-k")]=inp.value; });
      inp.addEventListener("change",draw);
    });
    host.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{ rows.splice(+b.getAttribute("data-del"),1); draw(); }));
    $("elAdd").addEventListener("click",()=>{ rows.push({}); draw(); });
  }
  draw();
}

/* ============================ My Expenses (self-service) ============================ */
async function myExpenses(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">My Space</div><h1>My Attendance &amp; Expenses</h1><div id="meBody" class="muted">Loading…</div>`;
  const emp=await resolveEmployee();
  if(!emp){ $("meBody").innerHTML='<div class="card muted">Your login isn\'t linked to an employee record yet. Ask HR to set your <b>email</b> (the one you sign in with) on your entry in <b>Registers → Employees</b>.</div>'; return; }
  const { data:claims }=await sb().from("expense_claims").select("*").eq("employee_id",emp.id).order("created_at",{ascending:false});
  const rows=claims||[];
  $("meBody").innerHTML=`
    <div class="callout">Welcome, <b>${esc(emp.name)}</b>. Mark your attendance and file expense claims below; HR reviews and processes them.</div>
    <div id="myAtt"></div>
    <h3 style="margin-top:14px">File an expense claim</h3>
    <div class="row" style="flex-wrap:wrap;gap:6px;margin:8px 0">
      ${Object.keys(TYPES).map(k=>`<button class="btn sm" data-new="${k}">+ ${esc(TYPES[k].label)}</button>`).join("")}
    </div>
    <h3 style="margin-top:14px">My claims</h3>
    ${rows.length?`<div style="overflow:auto"><table><thead><tr><th>Type</th><th>Period</th><th class="num">Total</th><th>Receipts</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map(r=>`<tr><td><b>${esc(typeLabel(r.claim_type))}</b>${r.title?`<br><span class="muted">${esc(r.title)}</span>`:""}</td>
        <td>${esc(r.period||"—")}</td><td class="num">${money(r.total)}</td>
        <td>${(r.receipts||[]).length||0}</td><td>${window.OPS.statusChip(r.status)}</td>
        <td>${r.status==="submitted"||r.status==="draft"||r.status==="rejected"?`<button class="btn sm ghost" data-del="${r.id}">Delete</button>`:''}</td></tr>`).join("")}</tbody></table></div>`
      :'<div class="card muted">No claims yet — pick a type above to file one.</div>'}`;
  $("meBody").querySelectorAll("[data-new]").forEach(b=>b.addEventListener("click",()=>claimForm(emp, b.getAttribute("data-new"))));
  $("meBody").querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",async()=>{
    if(!confirm("Delete this claim?")) return;
    await sb().from("expense_claims").delete().eq("id",b.getAttribute("data-del")); myExpenses();
  }));
  attendanceCard(emp);
}

/* ---------- My attendance (single-employee self-service grid) ---------- */
const DOWL=["Su","Mo","Tu","We","Th","Fr","Sa"];
const ACELL={present:{t:"P",bg:"",fg:"var(--muted,#999)"},off:{t:"·",bg:"var(--paper2,#f2f2f2)",fg:"var(--muted,#888)"},absent:{t:"A",bg:"#fde2e1",fg:"#a11"},worked_off:{t:"W",bg:"#e2f6e6",fg:"#137a2e"}};
function monthDaysOf(ym){ const [y,mm]=ym.split("-").map(Number); return new Date(Date.UTC(y,mm,0)).getUTCDate(); }
let att={ym:null,emp:null,orig:{},work:{},hol:{},locked:false};
async function attendanceCard(emp){
  const host=$("myAtt"); if(!host) return;
  const ym=(window.OPS._myAttMonth)||todayISO().slice(0,7);
  att.ym=ym; att.emp=emp;
  host.innerHTML=`<div class="card"><div class="row" style="align-items:center;flex-wrap:wrap;gap:8px">
      <b>My attendance</b><input id="maMonth" type="month" value="${ym}" style="width:auto"><span id="maLock"></span>
      <span class="spacer"></span><button class="btn green sm" id="maSave">Save attendance</button></div>
    <div class="muted" style="font-size:12px;margin:4px 0">Mark <b>A</b> for a day off you took, <b>W</b> if you worked a Sunday/holiday (earns a comp-off). Present is the default — click a day to cycle.</div>
    <div id="maGrid" class="muted">Loading…</div></div>`;
  $("maMonth").addEventListener("change",()=>{ window.OPS._myAttMonth=$("maMonth").value; attendanceCard(emp); });
  $("maSave").addEventListener("click",e=>window.OPS.once(e.currentTarget,saveMyAtt));
  const first=ym+"-01", last=ym+"-"+String(monthDaysOf(ym)).padStart(2,"0");
  const [{data:rows},{data:hol}]=await Promise.all([
    sb().from("hr_attendance").select("work_date,status").eq("employee_id",emp.id).gte("work_date",first).lte("work_date",last),
    sb().from("hr_holidays").select("holiday_date,name").gte("holiday_date",first).lte("holiday_date",last),
  ]);
  att.orig={}; att.work={}; (rows||[]).forEach(r=>{ att.orig[r.work_date]=r.status; att.work[r.work_date]=r.status; });
  att.hol={}; (hol||[]).forEach(h=>att.hol[h.holiday_date]=h.name);
  const lock = window.OPS.hrMonthLock ? await window.OPS.hrMonthLock(ym) : null;
  att.locked=!!lock;
  if($("maLock")) $("maLock").innerHTML = lock ? '<span class="chip" style="background:#fde2e1;color:#a11;border:1px solid #e6a0a0;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">🔒 Locked</span>' : '';
  if(lock){ const b=$("maSave"); if(b){ b.disabled=true; b.textContent="Locked 🔒"; } }
  drawMyGrid();
}
function maState(date){ const st=att.work[date]; if(st==="absent"||st==="worked_off") return st; const d=new Date(date+"T00:00:00Z").getUTCDay(); return (d===0||att.hol[date])?"off":"present"; }
function drawMyGrid(){
  const nd=monthDaysOf(att.ym), cells=[];
  for(let dd=1;dd<=nd;dd++){ const date=att.ym+"-"+String(dd).padStart(2,"0"); const w=new Date(date+"T00:00:00Z").getUTCDay(); const off=w===0||att.hol[date]; const c=ACELL[maState(date)];
    cells.push(`<div data-d="${date}" title="${DOWL[w]}${off?' · day off':''}" style="min-width:36px;text-align:center;border:1px solid var(--line,#ddd);border-radius:6px;padding:3px 2px;cursor:${att.locked?'default':'pointer'};background:${c.bg};color:${c.fg}"><div style="font-size:10px" class="muted">${dd} ${DOWL[w]}</div><b>${c.t}</b></div>`);
  }
  $("maGrid").innerHTML=`<div style="display:flex;flex-wrap:wrap;gap:4px">${cells.join("")}</div>`;
  if(att.locked) return;
  $("maGrid").querySelectorAll("[data-d]").forEach(el=>el.addEventListener("click",()=>{
    const date=el.getAttribute("data-d"), w=new Date(date+"T00:00:00Z").getUTCDay(), off=w===0||att.hol[date], cur=att.work[date]||"";
    const nx = off ? (cur==="worked_off"?"":"worked_off") : (cur==="absent"?"":"absent");
    if(nx) att.work[date]=nx; else delete att.work[date];
    drawMyGrid();
  }));
}
async function saveMyAtt(){
  const ups=[], dels=[], keys=new Set([...Object.keys(att.orig),...Object.keys(att.work)]);
  keys.forEach(d=>{ const nw=att.work[d]||"", ol=att.orig[d]||""; if(nw===ol) return;
    if(nw) ups.push({employee_id:att.emp.id, work_date:d, status:nw, created_by:window.OPS.me.id}); else dels.push(d); });
  if(!ups.length&&!dels.length){ window.OPS.flashTop("Nothing changed."); return; }
  if(ups.length){ const {error}=await sb().from("hr_attendance").upsert(ups,{onConflict:"employee_id,work_date"}); if(error){ alert("Save failed: "+error.message); return; } }
  for(const d of dels){ await sb().from("hr_attendance").delete().eq("employee_id",att.emp.id).eq("work_date",d); }
  window.OPS.flashTop("Attendance saved ✓"); attendanceCard(att.emp);
}

function claimForm(emp, typeKey){
  const type=TYPES[typeKey]; const m=$("main");
  const common=`<div class="fgrid">
      <div class="field"><label>${type.monthly?"Month":"Period / ref"}</label><input id="ecPeriod" ${type.monthly?'type="month"':''} value="${type.monthly?todayISO().slice(0,7):''}"></div>
      <div class="field"><label>Title (optional)</label><input id="ecTitle" placeholder="short label"></div>
    </div>`;
  let inner="";
  if(type.special==="house_rent"){
    inner=`<div class="fgrid">
      <div class="field"><label>Landlord name *</label><input id="hrLandlord"></div>
      <div class="field"><label>Monthly rent ₹ *</label><input id="hrRent" type="number" step="any"></div>
      <div class="field full"><label>Property address *</label><input id="hrAddr"></div>
      <div class="field"><label>Landlord contact</label><input id="hrContact"></div>
    </div>`;
  } else if(type.special==="advance"){
    inner=`<div id="advRows"></div>`;
  } else {
    inner=`${type.note?`<div class="muted" style="margin-bottom:6px">${esc(type.note)}</div>`:""}<div id="ecRows"></div>`;
  }
  m.innerHTML=`<button class="btn sm" id="ecBack">← Back to My Expenses</button>
    <div class="card" style="margin-top:12px"><div class="eyebrow">${esc(emp.name)}</div><h1 style="margin:2px 0">${esc(type.label)}</h1>
      ${common}
      <h3 style="margin:12px 0 4px">Details</h3>
      ${inner}
      <div class="row" style="margin-top:10px;gap:24px;flex-wrap:wrap"><div><div class="eyebrow">Total</div><b id="ecTotal" style="font-size:18px;color:var(--green)">₹0</b></div></div>
      <div class="field full" style="margin-top:8px"><label>Purpose / justification</label><textarea id="ecPurpose"></textarea></div>
      <div class="field full"><label>Receipts (photos / PDFs — attach the originals)</label><input id="ecFiles" type="file" accept="image/*,application/pdf" multiple></div>
      <div class="row" style="margin-top:8px"><button class="btn green" id="ecSubmit">Submit claim</button><div class="spacer"></div><div class="err" id="ecErr"></div></div>
      <div class="muted" style="margin-top:8px;font-size:12px">All amounts are exclusive of GST; TDS applies as per the Income-tax Act, 1961.</div>
    </div>`;
  $("ecBack").addEventListener("click",myExpenses);
  const setTot=t=>{ $("ecTotal").textContent=money(t); };
  let rows=[{}]; let advRows=ADV_CATS.map(c=>({category:c,amount:"",note:""}));
  if(type.special==="advance"){
    const drawAdv=()=>{ const host=$("advRows");
      host.innerHTML=`<div style="overflow:auto"><table class="tight"><thead><tr><th>Category</th><th class="num">Estimated ₹</th><th>Notes</th></tr></thead>
        <tbody>${advRows.map((r,i)=>`<tr data-i="${i}"><td>${esc(r.category)}</td>
          <td class="num"><input type="number" step="any" data-k="amount" value="${esc(r.amount)}" style="width:120px"></td>
          <td><input data-k="note" value="${esc(r.note||"")}" style="min-width:200px"></td></tr>`).join("")}</tbody></table></div>`;
      host.querySelectorAll("input[data-k]").forEach(inp=>inp.addEventListener("input",()=>{ const i=+inp.closest("tr").getAttribute("data-i"); advRows[i][inp.getAttribute("data-k")]=inp.value; if(inp.getAttribute("data-k")==="amount") setTot(advRows.reduce((s,r)=>s+num(r.amount),0)); }));
    };
    drawAdv(); setTot(0);
  } else if(!type.special){
    lineEditor($("ecRows"), type, rows, setTot);
  } else if(type.special==="house_rent"){
    const upd=()=>setTot(num($("hrRent").value)); setTimeout(()=>{ if($("hrRent")) $("hrRent").addEventListener("input",upd); },0);
  }
  $("ecSubmit").addEventListener("click",e=>window.OPS.once(e.currentTarget,async()=>{
    let lines=[], extra=null, total=0;
    if(type.special==="house_rent"){
      const rent=num($("hrRent").value);
      if(!$("hrLandlord").value.trim()||!$("hrAddr").value.trim()||rent<=0){ $("ecErr").textContent="Fill landlord, address and monthly rent."; return; }
      extra={ landlord:$("hrLandlord").value.trim(), address:$("hrAddr").value.trim(), contact:$("hrContact").value.trim(), monthly_rent:rent, tenant:emp.name };
      total=rent;
    } else if(type.special==="advance"){
      lines=advRows.filter(r=>num(r.amount)>0).map(r=>({category:r.category, amount:num(r.amount), note:r.note||""}));
      if(!lines.length){ $("ecErr").textContent="Enter at least one estimated amount."; return; }
      total=lines.reduce((s,r)=>s+num(r.amount),0);
    } else {
      lines=rows.filter(r=>num(r.amount)>0 || Object.keys(r).some(k=>k!=="km"&&k!=="amount"&&r[k]));
      if(!lines.length){ $("ecErr").textContent="Add at least one line."; return; }
      if(type.rowErr){ const bad=lines.find(r=>type.rowErr(r)); if(bad){ $("ecErr").textContent=type.rowErr(bad); return; } }
      total=lines.reduce((s,r)=>s+num(r.amount),0);
    }
    const rec={ employee_id:emp.id, employee_name:emp.name, claim_type:typeKey,
      period:$("ecPeriod").value||null, title:$("ecTitle").value.trim()||null, purpose:$("ecPurpose").value.trim()||null,
      lines, extra, total, status:"submitted", created_by:window.OPS.me.id };
    const { data:ins, error }=await sb().from("expense_claims").insert(rec).select("id").single();
    if(error){ $("ecErr").textContent=error.message; return; }
    const files=$("ecFiles").files;
    if(files&&files.length){ const rc=await uploadReceipts(ins.id, emp.id, files);
      if(rc.length) await sb().from("expense_claims").update({receipts:rc}).eq("id",ins.id); }
    window.OPS.flashTop("Claim submitted ✓"); myExpenses();
  }));
}

/* ============================ Review (Finance → Expense Claims) ============================ */
async function expenseReview(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Finance</div><h1>Expense Claims</h1>
    <div class="row" style="margin:10px 0"><label style="margin:0">Show</label>
      <select id="erStatus" style="width:auto"><option value="submitted">Pending review</option><option value="approved">Approved (to pay)</option><option value="part_paid">Part-paid</option><option value="paid">Paid</option><option value="rejected">Rejected</option><option value="">All</option></select></div>
    <div id="erBody" class="muted">Loading…</div>`;
  const load=async()=>{
    const st=$("erStatus").value;
    let q=sb().from("expense_claims").select("*").order("created_at",{ascending:false});
    if(st) q=q.eq("status",st);
    const [{ data },{ data:tx }]=await Promise.all([ q, sb().from("cash_txns").select("ref_id,amount,tds_amount").eq("ref_type","expense_claim") ]);
    const paidBy={}; (tx||[]).forEach(t=>paidBy[t.ref_id]=(paidBy[t.ref_id]||0)+num(t.amount)+num(t.tds_amount));
    const rows=(data||[]).map(r=>{ r._paid=paidBy[r.id]||0; r._bal=Math.round((num(r.total)-r._paid)*100)/100; return r; });
    $("erBody").innerHTML = rows.length ? rows.map(cardHTML).join("") : '<div class="card muted">Nothing here.</div>';
    rows.forEach(wire);
  };
  $("erStatus").addEventListener("change",load);
  window.OPS._expReviewLoad=load;
  load();
}
function cardHTML(r){
  const t=TYPES[r.claim_type]||{}; const li=r.lines||[];
  let detail="";
  if(r.claim_type==="house_rent"){ const e=r.extra||{};
    detail=`<table class="tight"><tbody>
      <tr><td>Landlord</td><td>${esc(e.landlord||"")}</td></tr>
      <tr><td>Property</td><td>${esc(e.address||"")}</td></tr>
      <tr><td>Contact</td><td>${esc(e.contact||"")}</td></tr>
      <tr><td>Monthly rent</td><td class="num">${money(e.monthly_rent)}</td></tr></tbody></table>`;
  } else if(r.claim_type==="advance"){
    detail=`<table class="tight"><thead><tr><th>Category</th><th class="num">Estimate ₹</th><th>Notes</th></tr></thead>
      <tbody>${li.map(x=>`<tr><td>${esc(x.category||"")}</td><td class="num">${money(x.amount)}</td><td>${esc(x.note||"")}</td></tr>`).join("")}</tbody></table>`;
  } else if(t.cols){
    detail=`<div style="overflow:auto"><table class="tight"><thead><tr>${t.cols.map(c=>`<th class="${(c.t==='num'||c.t==='ro')?'num':''}">${esc(c.l)}</th>`).join("")}</tr></thead>
      <tbody>${li.map(x=>`<tr>${t.cols.map(c=>`<td class="${(c.t==='num'||c.t==='ro')?'num':''}">${(c.t==='num'||c.t==='ro')&&c.k==='amount'?money(x[c.k]):esc(x[c.k]==null?"":x[c.k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  const receipts=(r.receipts||[]);
  return `<div class="card" id="ec_${r.id}" style="margin-bottom:12px">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div><div class="eyebrow">${esc(typeLabel(r.claim_type))} · ${esc(r.employee_name||"")}</div>
        <h3 style="margin:2px 0">${esc(r.title||"")} ${r.period?("· "+esc(r.period)):""}</h3>
        <div class="muted">Submitted ${fmtDate(r.created_at)} ${window.OPS.statusChip(r.status)}</div></div>
      <div style="text-align:right"><div class="eyebrow">Total</div><b style="font-size:18px">${money(r.total)}</b></div>
    </div>
    ${detail}
    ${r.purpose?`<div class="muted" style="margin-top:6px"><b>Purpose:</b> ${esc(r.purpose)}</div>`:""}
    <div class="row" style="margin-top:6px;gap:6px;flex-wrap:wrap">${receipts.length?receipts.map((x,i)=>`<button class="btn sm ghost" data-rc="${r.id}|${i}">📎 ${esc(x.name||("receipt "+(i+1)))}</button>`).join(""):'<span class="muted" style="font-size:12px">No receipts attached.</span>'}</div>
    <div class="field full" style="margin-top:8px"><label>Note to employee</label><input id="en_${r.id}" value="${esc(r.note||"")}"></div>
    <div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap;align-items:center">
      ${r.status==="submitted"?`<button class="btn green sm" data-act="approve" data-id="${r.id}">Approve</button>
        <button class="btn sm" data-act="reject" data-id="${r.id}" style="color:#a3322a;border-color:#e4b4b4">Reject</button>`:''}
      ${(r.status==="approved"||r.status==="part_paid")?`<button class="btn green sm" data-act="pay" data-id="${r.id}">Record payment…</button>
        <span class="muted" style="font-size:12px">Paid ${money(r._paid||0)} · Balance <b>${money(r._bal!=null?r._bal:r.total)}</b></span>`:''}
    </div></div>`;
}
function wire(r){
  const root=$("ec_"+r.id); if(!root) return;
  root.querySelectorAll("[data-rc]").forEach(b=>b.addEventListener("click",async()=>{
    const [id,i]=b.getAttribute("data-rc").split("|"); const rc=(r.receipts||[])[+i]; if(!rc) return;
    const url=await receiptLink(rc.path); if(url) window.open(url,"_blank"); else alert("Could not open the receipt.");
  }));
  root.querySelectorAll("[data-act]").forEach(b=>b.addEventListener("click",e=>{
    const act=b.getAttribute("data-act");
    if(act==="pay"){ payExpenseClaim(r); return; }
    window.OPS.once(e.currentTarget,async()=>{
      const note=($("en_"+r.id).value.trim()||null); const now=new Date().toISOString();
      if(act==="approve"){
        const patch={ status:"approved", approver:window.OPS.me.id, approved_at:now, note };
        // an approved advance request becomes a real advance to the employee
        if(r.claim_type==="advance"){
          const { data:adv }=await sb().from("advances").insert({ party_kind:"employee", employee_id:r.employee_id, payee_text:r.employee_name,
            amount:num(r.total), purpose:("Advance request "+(r.period||"")), note, created_by:window.OPS.me.id }).select("id").single();
          if(adv) patch.advance_id=adv.id;
        }
        await sb().from("expense_claims").update(patch).eq("id",r.id);
      } else if(act==="reject"){
        await sb().from("expense_claims").update({ status:"rejected", approver:window.OPS.me.id, approved_at:now, note }).eq("id",r.id);
      }
      window.OPS.audit&&window.OPS.audit("expense_"+act,"expense_claims",r.id,r.employee_name||"");
      window.OPS.flashTop("Claim "+act+"d ✓");
      if(window.OPS._expReviewLoad) window.OPS._expReviewLoad();
    });
  }));
}

/* Pay an approved claim — partial allowed, TDS optional; posts via cash_txns
   (Dr Employee Expenses / Cr Bank / Cr TDS Payable). */
function payExpenseClaim(r){
  const m=$("main"); const bal=(r._bal!=null?r._bal:num(r.total));
  m.innerHTML=`<button class="btn sm" id="epBack">← Back to Expense Claims</button>
    <div class="card" style="margin-top:12px;max-width:520px"><h1>Pay expense claim</h1>
      <p class="muted">${esc(typeLabel(r.claim_type))} · ${esc(r.employee_name||"")} · Balance <b>${money(bal)}</b></p>
      <div class="fgrid">
        <div class="field"><label>Amount settled *</label><input id="ep_amt" type="number" step="any" value="${bal}"></div>
        <div class="field"><label>Paid from *</label><select id="ep_acct"><option value="">— loading —</option></select></div>
        <div class="field"><label>Date</label><input id="ep_date" type="date" value="${todayISO()}"></div>
        <div class="field"><label>Mode</label><select id="ep_mode"><option>Bank</option><option>UPI</option><option>Cash</option></select></div>
        <div class="field full"><label style="display:inline"><input type="checkbox" id="ep_tds" style="width:auto"> Deduct TDS</label></div>
        <div class="field"><label>TDS %</label><input id="ep_tdspct" type="number" step="any" disabled></div>
        <div class="field"><label>TDS amount ₹ <span class="muted">(verify)</span></label><input id="ep_tdsamt" type="number" step="any" value="0" disabled></div>
        <div class="field full"><div class="callout" id="ep_split" style="margin:0"></div></div>
      </div>
      <div class="row"><button class="btn green" id="ep_go">Record payment</button><button class="btn" id="ep_cancel">Cancel</button></div>
      <div class="err" id="ep_err"></div></div>`;
  $("epBack").addEventListener("click",expenseReview); $("ep_cancel").addEventListener("click",expenseReview);
  sb().from("cash_accounts").select("id,name,kind").eq("is_active",true).order("kind").then(({data})=>{
    $("ep_acct").innerHTML=(data||[]).map(a=>`<option value="${a.id}">${esc(a.name)}${a.kind==='cash'?' (cash)':''}</option>`).join("")||'<option value="">— no accounts —</option>'; });
  const sync=()=>{ const on=$("ep_tds").checked; $("ep_tdspct").disabled=!on; $("ep_tdsamt").disabled=!on;
    const s=num($("ep_amt").value), t=on?num($("ep_tdsamt").value):0, c=Math.round((s-t)*100)/100;
    $("ep_split").innerHTML = on?`Settling <b>${money(s)}</b> = paid <b>${money(c)}</b> + TDS <b>${money(t)}</b> (TDS Payable).`:`Paid: <b>${money(s)}</b>`; };
  $("ep_tds").addEventListener("change",sync);
  $("ep_amt").addEventListener("input",()=>{ if($("ep_tds").checked&&num($("ep_tdspct").value)) $("ep_tdsamt").value=Math.round(num($("ep_amt").value)*num($("ep_tdspct").value))/100; sync(); });
  $("ep_tdspct").addEventListener("input",()=>{ $("ep_tdsamt").value=Math.round(num($("ep_amt").value)*num($("ep_tdspct").value))/100; sync(); });
  $("ep_tdsamt").addEventListener("input",sync); sync();
  $("ep_go").addEventListener("click",e=>window.OPS.once(e.currentTarget,async()=>{
    const settled=num($("ep_amt").value); if(settled<=0){ $("ep_err").textContent="Enter an amount."; return; }
    if(!$("ep_acct").value){ $("ep_err").textContent="Pick the account the money left."; return; }
    const on=$("ep_tds").checked, tds=on?num($("ep_tdsamt").value):0;
    if(tds<0||tds>settled){ $("ep_err").textContent="TDS must be between 0 and the amount."; return; }
    const cash=Math.round((settled-tds)*100)/100;
    const { error }=await sb().from("cash_txns").insert({ account_id:$("ep_acct").value, direction:"out",
      txn_date:$("ep_date").value||todayISO(), amount:cash, tds_pct:on?(num($("ep_tdspct").value)||null):null, tds_amount:tds, mode:$("ep_mode").value,
      ref_type:"expense_claim", ref_id:String(r.id), note:typeLabel(r.claim_type)+" — "+(r.employee_name||""), created_by:window.OPS.me.id });
    if(error){ $("ep_err").textContent=/duplicate|just recorded/i.test(error.message)?"That exact payment was just recorded.":error.message; return; }
    const { data:all }=await sb().from("cash_txns").select("amount,tds_amount").eq("ref_type","expense_claim").eq("ref_id",String(r.id));
    const paid=(all||[]).reduce((s,t)=>s+num(t.amount)+num(t.tds_amount),0);
    const status = paid>=num(r.total)-0.005 ? "paid" : "part_paid";
    const patch={ status }; if(status==="paid") patch.paid_at=new Date().toISOString();
    await sb().from("expense_claims").update(patch).eq("id",r.id);
    window.OPS.audit&&window.OPS.audit("expense_paid","expense_claims",r.id,money(cash)+(tds>0?(" + TDS "+money(tds)):""));
    window.OPS.flashTop("Payment recorded ✓"); expenseReview();
  }));
}

window.OPS.routes.my_expenses    = myExpenses;
window.OPS.routes.expense_review = expenseReview;
})();
