/* ============================================================================
   DroCon Cloud — Review / Approvals (Phase 4)
   One consolidated queue: each user sees only items assigned to them (plus
   admins see all submitted). Provides submit/approve/reject for clients,
   vendors, documents and BOM designs, and surfaces agreements in_review too.
   Also exports OPS.approvals.bar(...) to embed approval controls in any form.
   ============================================================================ */
(function(){
const { $, esc, fmt, fmtDate, money } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const me = ()=>window.OPS.me;

const TYPES = {
  clients:     { label:"Client",  title:r=>r.firm_name||r.name||"" },
  vendors:     { label:"Vendor",  title:r=>r.firm_name||r.name||"" },
  documents:   { label:r=>({quotation:"Quotation",invoice:"Invoice",credit_note:"Credit Note",purchase_order:"Purchase Order"}[r.doc_type]||"Document"),
                 title:r=>(r.number||"")+" · "+((r.party_snapshot||{}).firmName||(r.party_snapshot||{}).name||"") },
  bom_designs: { label:"BOM",     title:r=>r.name||"" },
};
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
  window.OPS.refreshNotifs(); return true;
}
async function approve(table, id, title){
  if(table==="agreements"){ const { error }=await sb().rpc("approve_agreement",{p_id:id,p_note:null}); if(error){ alert(error.message); return false; } }
  else { const { error }=await sb().from(table).update({ approval_status:"approved", approved_by:me().id, approved_at:new Date().toISOString() }).eq("id",id); if(error){ alert(error.message); return false; } }
  window.OPS.audit("approved",table,id,title||""); window.OPS.flashTop("Approved ✓"); return true;
}
async function reject(table, id, note, title){
  if(table==="agreements"){ const { error }=await sb().rpc("reject_agreement",{p_id:id,p_note:note||null}); if(error){ alert(error.message); return false; } }
  else { const { error }=await sb().from(table).update({ approval_status:"rejected", approved_by:me().id, approved_at:new Date().toISOString(), reject_note:note||null }).eq("id",id); if(error){ alert(error.message); return false; } }
  window.OPS.audit("rejected",table,id,note||""); window.OPS.flashTop("Rejected"); return true;
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
    <div id="rvBody" class="muted">Loading…</div>`;
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
  const groups=await Promise.all([ pendingAgs(), pending("documents"), pending("clients"), pending("vendors"), pending("bom_designs") ]);
  const items=[].concat(...groups);
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
    else { openItem(it); }
  }));
}
function openItem(it){
  if(it.table==="agreements"){ window.OPS.openTool("agreements"); window.OPS.routes.viewAgreementDetail(it.r.id); }
  else if(it.table==="documents"){ const map={quotation:"quotation",invoice:"invoice",credit_note:"credit_note",purchase_order:"purchase_order"}; window.OPS.openTool(map[it.r.doc_type]); }
  else if(it.table==="clients"){ window.OPS.openTool("clients"); }
  else if(it.table==="vendors"){ window.OPS.openTool("vendors"); }
  else if(it.table==="bom_designs"){ window.OPS.openTool("bom"); }
}

window.OPS.approvals = { submit, approve, reject, bar };
window.OPS.routes.reviews = reviewQueue;
})();
