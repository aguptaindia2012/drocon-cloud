/* ============================================================================
   DroCon Cloud — Review / Approvals (Phase 4)
   One consolidated queue: each user sees only items assigned to them (plus
   admins see all submitted). Provides submit/approve/reject for clients,
   vendors, documents and BOM designs, and surfaces agreements in_review too.
   Also exports OPS.approvals.bar(...) to embed approval controls in any form.
   ============================================================================ */
(function(){
const { $, esc, fmt, fmtDate, money, num } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const me = ()=>window.OPS.me;

const TYPES = {
  clients:     { label:"Client",  title:r=>r.firm_name||r.name||"" },
  vendors:     { label:"Vendor",  title:r=>r.firm_name||r.name||"" },
  documents:   { label:r=>({quotation:"Quotation",invoice:"Invoice",credit_note:"Credit Note",purchase_order:"Purchase Order"}[r.doc_type]||"Document"),
                 title:r=>(r.number||"")+" · "+((r.party_snapshot||{}).firmName||(r.party_snapshot||{}).name||"") },
  bom_designs: { label:"BOM",     title:r=>r.name||"" },
  inventory_moves: { label:"Inventory edit",
    title:r=>{ const c=r.pending_changes||{}; const dir=((c.direction!=null?c.direction:r.direction)==='in')?'Purchased':'Sold';
      const qty=(c.qty!=null?c.qty:r.qty); const inv=r.sales_invoice_no||r.purchase_invoice_no||r.reason||"";
      return dir+" · qty "+qty+(inv?(" · "+inv):""); } },
  acre_entries: { label:"Acre entry edit",
    title:r=>{ const c=r.pending_changes||{}; const d=(c.entry_date!=null?c.entry_date:r.entry_date)||"";
      const p=(c.pilot_name!=null?c.pilot_name:r.pilot_name)||""; const a=(c.acres!=null?c.acres:r.acres);
      return (d?String(d).slice(0,10):"")+(p?(" · "+p):"")+(a!=null?(" · "+a+" ac"):""); } },
};
let invSpares={};   // id -> name cache for the inventory review summary
/* Internal margin from the cost snapshot on each line (base + shipping).
   Reviewers see it here; it is never printed on the customer's document. */
function marginNote(items){
  const priced=(items||[]).filter(li=>(num(li._cb)+num(li._cs))>0);
  if(!priced.length) return "";
  const rev=priced.reduce((s,li)=>s+num(li.qty)*num(li.rate)*(1-num(li.disc)/100),0);
  const cost=priced.reduce((s,li)=>s+num(li.qty)*(num(li._cb)+num(li._cs)),0);
  const pft=rev-cost, pct=rev>0?(pft/rev*100):0;
  const col = pft<0 ? "#a3322a" : (pct<10 ? "#9a5b00" : "#3e6b20");
  return `<div class="callout" style="margin-top:10px;background:var(--cream);border-left-color:var(--orange)">
    <b>Margin (internal):</b> revenue ${money(rev)} · cost ${money(cost)} ·
    <b style="color:${col}">profit ${money(pft)} (${pct.toFixed(1)}%)</b>
    ${priced.length<(items||[]).length?` <span class="muted">— ${(items.length-priced.length)} line(s) have no catalogue cost</span>`:""}
    ${pft<0?'<br><b style="color:#a3322a">⚠ Priced below cost.</b>':''}</div>`;
}
const labelOf = (table,r)=>{ const l=TYPES[table].label; return typeof l==="function"?l(r):l; };

async function listProfilesCached(){ if(!window.OPS._profilesCache){ const {data}=await sb().from("profiles").select("id,full_name,email,role").order("full_name"); window.OPS._profilesCache=data||[]; } return window.OPS._profilesCache; }
function nameOf(ps,id){ const p=(ps||[]).find(x=>x.id===id); return p?(p.full_name||p.email):""; }

/* ---------- actions ---------- */
async function notify(userId, message){ try{ if(userId && userId!==me().id) await sb().from("notifications").insert({ user_id:userId, message }); }catch(e){} }

async function submit(table, id, approverId, title){
  const { error }=await sb().from(table).update({ approval_status:"submitted", submitted_by:me().id, submitted_at:new Date().toISOString(), assigned_approver:approverId||null, reject_note:null }).eq("id",id);
  if(error){ alert(error.message); return false; }
  window.OPS.audit("submitted",table,id,title||"");
  await notify(approverId, "Review requested: "+labelOf(table,{})+" "+(title||""));
  window.OPS.refreshNotifs(); window.OPS.refreshReviewCount&&window.OPS.refreshReviewCount(); return true;
}
async function approve(table, id, title){
  if(table==="agreements"){ const { error }=await sb().rpc("approve_agreement",{p_id:id,p_note:null}); if(error){ alert(error.message); return false; } }
  else if(table==="inventory_moves"){ const { error }=await sb().rpc("approve_inventory_edit",{p_id:id}); if(error){ alert(error.message); return false; } }
  else if(table==="acre_entries"){ const { error }=await sb().rpc("approve_acre_edit",{p_id:id}); if(error){ alert(error.message); return false; } }
  else { const { error }=await sb().from(table).update({ approval_status:"approved", approved_by:me().id, approved_at:new Date().toISOString() }).eq("id",id); if(error){ alert(error.message); return false; } }
  window.OPS.audit("approved",table,id,title||""); window.OPS.flashTop("Approved ✓"); window.OPS.refreshReviewCount&&window.OPS.refreshReviewCount(); return true;
}
async function reject(table, id, note, title){
  if(table==="agreements"){ const { error }=await sb().rpc("reject_agreement",{p_id:id,p_note:note||null}); if(error){ alert(error.message); return false; } }
  else if(table==="inventory_moves"){ const { error }=await sb().rpc("reject_inventory_edit",{p_id:id,p_note:note||null}); if(error){ alert(error.message); return false; } }
  else if(table==="acre_entries"){ const { error }=await sb().rpc("reject_acre_edit",{p_id:id,p_note:note||null}); if(error){ alert(error.message); return false; } }
  else { const { error }=await sb().from(table).update({ approval_status:"rejected", approved_by:me().id, approved_at:new Date().toISOString(), reject_note:note||null }).eq("id",id); if(error){ alert(error.message); return false; } }
  window.OPS.audit("rejected",table,id,note||""); window.OPS.flashTop("Rejected"); window.OPS.refreshReviewCount&&window.OPS.refreshReviewCount(); return true;
}

/* ---------- embeddable approval bar ---------- */
// host = a DOM element; rec = the saved DB row; refresh = () => reload the form
async function bar(table, rec, host, refresh){
  if(!host) return;
  const st = rec.approval_status||"draft";
  const ps = await listProfilesCached();
  const amApprover = rec.assigned_approver===me().id || window.OPS.isAdmin();
  let html = `<div class="card" style="background:#fbfdf8"><div class="row wrap" style="align-items:center">
    <b>Approval:</b> ${window.OPS.statusChip(st==="submitted"?"in_review":st)} `;
  if(st==="draft"||st==="rejected"){
    html += `<span class="muted">Assign reviewer</span>
      <select id="apApprover" style="width:auto;max-width:220px">${ps.filter(p=>p.id!==me().id).map(p=>`<option value="${p.id}">${esc(p.full_name||p.email)} (${p.role})</option>`).join("")}</select>
      <button class="btn orange sm" id="apSubmit">Submit for review</button>`;
    if(st==="rejected" && rec.reject_note) html += `<div class="muted" style="flex-basis:100%;margin-top:6px">Rejected: ${esc(rec.reject_note)}</div>`;
  } else if(st==="submitted"){
    html += `<span class="muted">Awaiting ${esc(nameOf(ps,rec.assigned_approver)||"reviewer")}</span>`;
    if(amApprover) html += ` <button class="btn green sm" id="apApprove">Approve</button> <button class="btn sm" id="apReject" style="color:#a3322a;border-color:#e4b4b4">Reject…</button>`;
  } else if(st==="approved"){
    html += `<span class="muted">Approved by ${esc(nameOf(ps,rec.approved_by)||"")} ${rec.approved_at?("· "+fmtDate(rec.approved_at)):""}</span>`;
  }
  html += `</div></div>`;
  host.innerHTML = html;
  if($("apSubmit")) $("apSubmit").addEventListener("click",async()=>{ if(await submit(table,rec.id,$("apApprover").value,labelOf(table,rec)+" "+TYPES[table].title(rec))) refresh&&refresh(); });
  if($("apApprove")) $("apApprove").addEventListener("click",async()=>{ if(await approve(table,rec.id,TYPES[table].title(rec))) refresh&&refresh(); });
  if($("apReject")) $("apReject").addEventListener("click",async()=>{ const n=prompt("Reason for rejection:"); if(n===null)return; if(await reject(table,rec.id,n,TYPES[table].title(rec))) refresh&&refresh(); });
}

/* ---------- consolidated Review queue ---------- */
async function reviewQueue(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Review / Approvals</div><h1>My review queue</h1>
    <p class="muted">Items submitted for your review. ${window.OPS.isAdmin()?"As an admin you also see everything pending.":""}</p>
    <div id="rvBody" class="muted">Loading…</div>
    <div id="rvDaily"></div>`;
  // Daily spray submissions are surfaced here too (no separate tab).
  if(window.OPS.renderDailyApprovals){ try{ window.OPS.renderDailyApprovals($("rvDaily")); }catch(e){} }
  const admin=window.OPS.isAdmin();
  const ps=await listProfilesCached();
  async function pending(table, extraCols){
    let q=sb().from(table).select("*").eq("approval_status","submitted");
    if(!admin) q=q.eq("assigned_approver",me().id);
    const { data }=await q; return (data||[]).map(r=>({table,r}));
  }
  // agreements use their own status
  async function pendingAgs(){
    let q=sb().from("agreements").select("*").eq("status","in_review");
    if(!admin) q=q.eq("assigned_approver",me().id);
    const { data }=await q; return (data||[]).map(r=>({table:"agreements",r}));
  }
  const groups=await Promise.all([ pendingAgs(), pending("documents"), pending("clients"), pending("vendors"), pending("bom_designs"), pending("inventory_moves"), pending("acre_entries") ]);
  const items=[].concat(...groups);
  // preload spare names for any inventory items so the summary can name them
  try{
    const invItems=items.filter(x=>x.table==="inventory_moves");
    if(invItems.length){
      const ids=[...new Set(invItems.flatMap(x=>[x.r.spare_id, (x.r.pending_changes||{}).spare_id]).filter(Boolean))];
      if(ids.length){ const { data }=await sb().from("spare_catalogue").select("id,name").in("id",ids); (data||[]).forEach(s=>invSpares[s.id]=s.name); }
    }
  }catch(e){}
  if(!items.length){ $("rvBody").innerHTML='<div class="card muted">Nothing awaiting your review. 🎉</div>'; return; }
  const titleOf=(table,r)=> table==="agreements" ? (r.title||"") : TYPES[table].title(r);
  const lblOf=(table,r)=> table==="agreements" ? "Agreement" : labelOf(table,r);
  $("rvBody").innerHTML=`<div class="card"><table><thead><tr><th>Type</th><th>Item</th><th>Submitted by</th><th></th></tr></thead>
    <tbody>${items.map((it,i)=>`<tr><td><span class="tag">${esc(lblOf(it.table,it.r))}</span></td>
      <td><b>${esc(titleOf(it.table,it.r))}</b></td>
      <td>${esc(nameOf(ps, it.table==="agreements"?it.r.created_by:it.r.submitted_by))}</td>
      <td><button class="btn green sm" data-act="approve" data-i="${i}">Approve</button>
          <button class="btn sm" data-act="reject" data-i="${i}" style="color:#a3322a;border-color:#e4b4b4">Reject</button>
          <button class="btn sm" data-act="open" data-i="${i}">Open</button></td></tr>`).join("")}</tbody></table></div>`;
  $("rvBody").querySelectorAll("[data-act]").forEach(b=>b.addEventListener("click",async()=>{
    const it=items[+b.getAttribute("data-i")]; const act=b.getAttribute("data-act");
    if(act==="approve"){ if(await approve(it.table,it.r.id,titleOf(it.table,it.r))) reviewQueue(); }
    else if(act==="reject"){ const n=prompt("Reason for rejection:"); if(n===null)return; if(await reject(it.table,it.r.id,n,titleOf(it.table,it.r))) reviewQueue(); }
    else { reviewDetail(it); }
  }));
}

/* ---------- review detail: show WHAT is being approved + recent changes ----------
   Opening a queue item lands here (not on the raw list/sheet): a quick summary of
   the record and its recent change history, with Approve/Reject in place. Applies
   to every type awaiting approval. "Open full record" still jumps to the editor. */
function kv(k,v){ return (v!==undefined&&v!==null&&v!=="")?`<div><span class="muted">${esc(k)}:</span> <b>${esc(v)}</b></div>`:''; }
function summaryHTML(it){
  const r=it.r;
  if(it.table==="documents"){
    const p=r.party_snapshot||{}, t=r.totals||{}, items=r.line_items||[];
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 18px">
        ${kv("Number",r.number)}${kv("Date",fmtDate(r.doc_date))}
        ${kv("Party",p.firmName||p.name)}${kv("GSTIN",p.gstin)}
        ${kv("Line items",String(items.length))}${kv("Total",money(t.total))}
        ${r.data&&r.data.fromQuotation?kv("From quotation",r.data.fromQuotation):""}</div>
      ${items.length?`<table class="tight" style="margin-top:8px"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
        <tbody>${items.slice(0,15).map(li=>`<tr><td>${esc(li.desc||'')}</td><td class="num">${esc(li.qty??'')}</td><td class="num">${money(li.rate)}</td><td class="num">${money(num(li.qty)*num(li.rate)*(1-num(li.disc)/100))}</td></tr>`).join("")}</tbody></table>`:''}
      ${marginNote(items)}`;
  }
  if(it.table==="clients"||it.table==="vendors")
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 18px">${kv("Firm",r.firm_name)}${kv("Contact",r.name)}${kv("Mobile",r.mobile)}${kv("Email",r.email)}${kv("GSTIN",r.gstin)}${kv("City",r.city)}${kv("State",r.state)}</div>`;
  if(it.table==="bom_designs"){ const parts=r.parts||[];
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 18px">${kv("Name",r.name)}${kv("Parts",String(parts.length))}${kv("Overhead %",r.overhead_pct)}${kv("Profit %",r.profit_pct)}${kv("Commission %",r.commission_pct)}</div>`; }
  if(it.table==="agreements")
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 18px">${kv("Title",r.title)}${kv("Category",r.category)}${kv("Counterparty",r.counterparty_name||r.counterparty)}${kv("Status",r.status)}</div>`;
  if(it.table==="inventory_moves"){
    const c=r.pending_changes||{};
    const nm=id=>invSpares[id]||id||"";
    const dir=v=>v==='in'?'Purchased':(v==='out'?'Sold':(v||""));
    const cur={ spare:nm(r.spare_id), type:dir(r.direction), qty:r.qty, date:r.moved_on?fmtDate(r.moved_on):"", reason:r.reason||"", purch:r.purchase_invoice_no||"", sales:r.sales_invoice_no||"" };
    const has=k=>Object.prototype.hasOwnProperty.call(c,k);
    const prop={ spare:has('spare_id')?nm(c.spare_id):cur.spare, type:has('direction')?dir(c.direction):cur.type,
      qty:has('qty')?c.qty:cur.qty, date:has('moved_on')?fmtDate(c.moved_on):cur.date, reason:has('reason')?(c.reason||""):cur.reason,
      purch:has('purchase_invoice_no')?(c.purchase_invoice_no||""):cur.purch, sales:has('sales_invoice_no')?(c.sales_invoice_no||""):cur.sales };
    const rowsDef=[["Spare","spare"],["Type","type"],["Quantity","qty"],["Date","date"],["Reason","reason"],["Purchase invoice #","purch"],["Sales invoice #","sales"]];
    return `<p class="muted">Proposed edit to an inventory entry — the values below take effect only when you approve.</p>
      <table class="tight" style="margin-top:6px"><thead><tr><th>Field</th><th>Current</th><th>Proposed</th></tr></thead>
      <tbody>${rowsDef.map(([lab,k])=>{ const changed=String(cur[k]??"")!==String(prop[k]??"");
        return `<tr${changed?' style="background:#fff7e6"':''}><td>${esc(lab)}</td><td>${esc(cur[k]??"")}</td><td>${changed?"<b>"+esc(prop[k]??"")+"</b>":esc(prop[k]??"")}</td></tr>`; }).join("")}</tbody></table>`;
  }
  if(it.table==="acre_entries"){
    const c=r.pending_changes||{};
    const has=k=>Object.prototype.hasOwnProperty.call(c,k);
    const cur={ date:r.entry_date?fmtDate(r.entry_date):"", pilot:r.pilot_name||"", acres:r.acres, client:r.client_rate, farmer:r.farmer_rate,
      rate:r.rate, amount:r.amount, crop:r.crop||"", chem:r.chemical||"" };
    const prop={ date:has('entry_date')?fmtDate(c.entry_date):cur.date, pilot:has('pilot_name')?(c.pilot_name||""):cur.pilot,
      acres:has('acres')?c.acres:cur.acres, client:has('client_rate')?c.client_rate:cur.client, farmer:has('farmer_rate')?c.farmer_rate:cur.farmer,
      rate:has('rate')?c.rate:cur.rate, amount:has('amount')?c.amount:cur.amount, crop:has('crop')?(c.crop||""):cur.crop,
      chem:has('chemical')?(c.chemical||""):cur.chem };
    const rowsDef=[["Date","date"],["Pilot","pilot"],["Acres","acres"],["Client rate","client"],["Farmer rate","farmer"],["Total rate","rate"],["Amount","amount"],["Crop","crop"],["Medicine","chem"]];
    return `<p class="muted">Proposed edit to an acre entry — the values below take effect only when you approve.</p>
      <table class="tight" style="margin-top:6px"><thead><tr><th>Field</th><th>Current</th><th>Proposed</th></tr></thead>
      <tbody>${rowsDef.map(([lab,k])=>{ const changed=String(cur[k]??"")!==String(prop[k]??"");
        return `<tr${changed?' style="background:#fff7e6"':''}><td>${esc(lab)}</td><td>${esc(cur[k]??"")}</td><td>${changed?"<b>"+esc(prop[k]??"")+"</b>":esc(prop[k]??"")}</td></tr>`; }).join("")}</tbody></table>`;
  }
  return '<p class="muted">No summary available.</p>';
}
async function loadChanges(it){
  const host=$("rdChanges"); if(!host) return;
  const variants=({ documents:["document","documents"], agreements:["agreement","agreements"],
    clients:["client","clients"], vendors:["vendor","vendors"], bom_designs:["bom_design","bom_designs","bom"],
    inventory_moves:["inventory_move","inventory_moves"],
    acre_entries:["acre_entry","acre_entries"] }[it.table])||[it.table];
  const { data }=await sb().from("audit_log").select("*").in("entity",variants).eq("entity_id",String(it.r.id)).order("created_at",{ascending:false}).limit(8);
  const rows=data||[]; if(!rows.length){ host.innerHTML=""; return; }
  const ps=await listProfilesCached();
  host.innerHTML=`<h3 style="margin-top:16px">Recent changes</h3>
    <table class="tight"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
    <tbody>${rows.map(a=>`<tr><td>${fmt(a.created_at)}</td><td>${esc(nameOf(ps,a.actor))}</td><td>${esc(String(a.action||"").replace(/_/g," "))}</td><td>${esc(a.note||"")}</td></tr>`).join("")}</tbody></table>`;
}
async function reviewDetail(it){
  const { table, r }=it; const m=$("main"); const ps=await listProfilesCached();
  const lbl=table==="agreements"?"Agreement":labelOf(table,r);
  const title=table==="agreements"?(r.title||""):TYPES[table].title(r);
  const submittedBy=nameOf(ps, table==="agreements"?r.created_by:r.submitted_by);
  const st=table==="agreements"?(r.status||"draft"):(r.approval_status||"draft");
  const amApprover=(r.assigned_approver===me().id)||window.OPS.isAdmin();
  m.innerHTML=`<button class="btn sm" id="rdBack">← Back to review queue</button>
    <div class="card" style="margin-top:12px">
      <div class="eyebrow">Review / Approvals · ${esc(lbl)}</div>
      <h1 style="margin:2px 0">${esc(title)}</h1>
      <div>${window.OPS.statusChip(st==="submitted"?"in_review":st)} <span class="muted">· submitted by <b>${esc(submittedBy||"—")}</b>${r.submitted_at?(" · "+fmt(r.submitted_at)):""}</span></div>
      ${r.reject_note?`<div class="muted" style="color:#a3322a;margin-top:6px">Earlier rejection note: ${esc(r.reject_note)}</div>`:''}
      <h3 style="margin-top:14px">What you're approving</h3>
      ${summaryHTML(it)}
      <div id="rdChanges"><p class="muted" style="margin-top:12px">Loading change history…</p></div>
      <div class="row wrap" style="margin-top:16px">
        ${amApprover?`<button class="btn green" id="rdApprove">Approve</button>
          <button class="btn" id="rdReject" style="color:#a3322a;border-color:#e4b4b4">Reject…</button>`:'<span class="muted">You are not the assigned reviewer for this item.</span>'}
        <div class="spacer"></div>
        <button class="btn sm" id="rdOpen">Open full record ↗</button>
      </div>
    </div>`;
  $("rdBack").addEventListener("click",reviewQueue);
  $("rdOpen").addEventListener("click",()=>openItem(it));
  if($("rdApprove")) $("rdApprove").addEventListener("click",async()=>{ if(await approve(table,r.id,title)) reviewQueue(); });
  if($("rdReject"))  $("rdReject").addEventListener("click",async()=>{ const n=prompt("Reason for rejection:"); if(n===null)return; if(await reject(table,r.id,n,title)) reviewQueue(); });
  loadChanges(it);
}
function openItem(it){
  if(it.table==="agreements"){ window.OPS.openTool("agreements"); window.OPS.routes.viewAgreementDetail(it.r.id); }
  else if(it.table==="documents"){ const map={quotation:"quotation",invoice:"invoice",credit_note:"credit_note",purchase_order:"purchase_order"}; window.OPS.openTool(map[it.r.doc_type]); }
  else if(it.table==="clients"){ window.OPS.openTool("clients"); }
  else if(it.table==="vendors"){ window.OPS.openTool("vendors"); }
  else if(it.table==="bom_designs"){ window.OPS.openTool("bom"); }
  else if(it.table==="inventory_moves"){ window.OPS.openTool("inventory"); }
  else if(it.table==="acre_entries"){ window.OPS.openTool("entries"); }
}

window.OPS.approvals = { submit, approve, reject, bar };
window.OPS.routes.reviews = reviewQueue;
})();
