/* ============================================================================
   DroCon Cloud — Daily Spray Entry (the primary daily form) + two-level approval
   A day's sprays are SUBMITTED as one daily_submissions batch (rows held as JSON)
   and assigned to a reviewer. Approving the batch (Daily Approvals tab) POSTS it —
   expanding it into BOTH farmer_sprays and acre_entries via a SECURITY DEFINER
   function — so nothing reaches the Farmer/Acre dashboards until approved (#12).
   Posted days can only be reopened by an admin (#13).
   ============================================================================ */
(function(){
const { $, esc, num, money, todayISO, fmt, fmtDate } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;

let drows=[], clients=[], editingId=null;
function blank(){ return { pilot:"", farmer:"", phone:"", village:"", crop:"", chemical:"", acres:"", crate:"", frate:"", gps:false }; }

async function view(editSub){
  editingId = editSub ? editSub.id : null;
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Daily Spray Entry</div><h1>${editSub?"Edit submission":"Daily Spray Entry"}</h1>
    <div class="callout">Entered once → on <b>approval</b> it posts to <b>both</b> Farmer &amp; Acre dashboards (kept separate for client reconciliation). Add a row per spray; different rows can have <b>different pilots</b>. Tick <b>GPS</b> where a GPS-tagged image was received. The day is <b>submitted for review</b> — it only counts once a reviewer approves it.</div>
    <div class="card">
      <div class="fgrid three">
        <div class="field"><label>Date</label><input id="dDate" type="date" value="${esc(editSub?editSub.entry_date:todayISO())}"></div>
        <div class="field"><label>Client (from Client list)</label><select id="dClient"><option value="">— select client —</option></select></div>
        <div class="field"><label>Location (deployment area) *</label><input id="dLoc" placeholder="e.g. Rudrapur" value="${esc(editSub?editSub.location_name:"")}"></div>
      </div>
      <div class="fgrid three">
        <div class="field"><label>State</label>${window.OPS.geoUI.stateSelect("dState",editSub?editSub.state:"")}</div>
        <div class="field"><label>District</label>${window.OPS.geoUI.districtSelect("dDistrict",editSub?editSub.district:"",editSub?editSub.state:"")}</div>
        <div class="field"></div>
      </div>
      <h3>Sprays</h3>
      <div style="overflow:auto"><table class="linetable" id="dRows"><thead><tr>
        <th style="min-width:120px">Pilot</th><th style="min-width:120px">Farmer</th><th>Contact</th><th>Village</th><th>Crop</th><th>Medicine</th>
        <th class="num">Acres</th><th class="num" title="Rate paid by client">Client ₹</th><th class="num" title="Rate paid by farmer">Farmer ₹</th><th class="num">Amount</th><th>GPS</th><th></th>
      </tr></thead><tbody></tbody></table></div>
      <button class="btn sm" id="dAdd">+ Add spray</button>
      <div id="dSum" class="muted" style="margin-top:6px"></div>
      <div class="fgrid" style="margin-top:14px">
        <div class="field"><label>Assign reviewer *</label><select id="dApprover"><option value="">— select reviewer —</option></select></div>
      </div>
      <div class="row" style="margin-top:8px"><button class="btn green" id="dSave">${editSub?"Update &amp; resubmit":"Submit for approval"}</button>
        <button class="btn" id="dClear">${editSub?"Cancel":"Clear"}</button></div>
      <div class="err" id="dErr"></div>
    </div>`;
  drows = editSub && Array.isArray(editSub.rows) && editSub.rows.length ? editSub.rows.map(r=>Object.assign(blank(),r)) : [blank(),blank()];
  $("dClear").addEventListener("click",()=> editSub ? window.OPS.openTool("daily_approvals") : view());
  $("dAdd").addEventListener("click",()=>{ drows.push(blank()); renderRows(); });
  $("dSave").addEventListener("click",save);
  window.OPS.geoUI.wire("dState","dDistrict");
  renderRows();
  // reviewer dropdown (any internal user except yourself; admins can also approve from the queue)
  window.OPS.listProfiles().then(ps=>{
    const opts=(ps||[]).filter(p=>!p.is_external && p.id!==window.OPS.me.id);
    $("dApprover").innerHTML='<option value="">— select reviewer —</option>'+opts.map(p=>`<option value="${p.id}" ${editSub&&editSub.assigned_approver===p.id?'selected':''}>${esc(p.full_name||p.email)} (${esc(p.role)})</option>`).join("");
  });
  // client list (drives state/district auto-fill)
  sb().from("clients").select("id,firm_name,name,state,district").order("firm_name").then(({data})=>{
    clients=data||[];
    $("dClient").innerHTML='<option value="">— select client —</option>'+clients.map(c=>`<option value="${c.id}" ${editSub&&editSub.client_id===c.id?'selected':''}>${esc(c.firm_name||c.name)}</option>`).join("");
    $("dClient").addEventListener("change",()=>{ const c=clients.find(x=>x.id===$("dClient").value);
      if(c){ if(c.state && $("dState")){ $("dState").value=c.state; const ds=window.OPS.geoUI.districts(c.state); $("dDistrict").innerHTML='<option value="">— select district —</option>'+ds.map(x=>`<option ${c.district===x?'selected':''}>${esc(x)}</option>`).join(""); } }
    });
  });
}
function renderRows(){
  const tb=$("dRows").querySelector("tbody");
  tb.innerHTML=drows.map((r,i)=>{ const amt=num(r.acres)*(num(r.crate)+num(r.frate)); return `<tr>
    <td><input data-i="${i}" data-k="pilot" value="${esc(r.pilot)}"></td>
    <td><input data-i="${i}" data-k="farmer" value="${esc(r.farmer)}"></td>
    <td><input data-i="${i}" data-k="phone" value="${esc(r.phone)}" style="width:100px"></td>
    <td><input data-i="${i}" data-k="village" value="${esc(r.village)}"></td>
    <td><input data-i="${i}" data-k="crop" value="${esc(r.crop)}" style="width:85px"></td>
    <td><input data-i="${i}" data-k="chemical" value="${esc(r.chemical)}" style="width:100px"></td>
    <td><input data-i="${i}" data-k="acres" type="number" step="any" value="${esc(r.acres)}" style="width:64px;text-align:right"></td>
    <td><input data-i="${i}" data-k="crate" type="number" step="any" value="${esc(r.crate)}" style="width:64px;text-align:right"></td>
    <td><input data-i="${i}" data-k="frate" type="number" step="any" value="${esc(r.frate)}" style="width:64px;text-align:right"></td>
    <td class="num">${money(amt)}</td>
    <td style="text-align:center"><input data-i="${i}" data-k="gps" type="checkbox" style="width:auto" ${r.gps?'checked':''}></td>
    <td class="x" data-del="${i}">✕</td></tr>`; }).join("");
  tb.querySelectorAll("input").forEach(inp=>inp.addEventListener("input",()=>{
    const i=+inp.getAttribute("data-i"), k=inp.getAttribute("data-k");
    drows[i][k]= k==="gps"?inp.checked:inp.value;
    if(["acres","crate","frate"].includes(k)){ const tr=inp.closest("tr"); tr.children[9].textContent=money(num(drows[i].acres)*(num(drows[i].crate)+num(drows[i].frate))); sumRow(); }
  }));
  tb.querySelectorAll("[data-del]").forEach(x=>x.addEventListener("click",()=>{ drows.splice(+x.getAttribute("data-del"),1); if(!drows.length) drows.push(blank()); renderRows(); }));
  sumRow();
}
function sumRow(){ let a=0,amt=0; const pilots=new Set();
  drows.forEach(r=>{ a+=num(r.acres); amt+=num(r.acres)*(num(r.crate)+num(r.frate)); if(r.pilot) pilots.add(r.pilot); });
  $("dSum").innerHTML=`Day total: <b>${a.toFixed(2)} acres</b> · <b>${money(amt)}</b> · ${pilots.size} pilot(s) · ${drows.filter(r=>num(r.acres)>0).length} spray(s)`; }

async function save(){
  const date=$("dDate").value||todayISO();
  const clientId=$("dClient").value; const clientName=(clients.find(c=>c.id===clientId)||{}).firm_name||"";
  const locName=$("dLoc").value.trim(); const state=$("dState").value.trim(), district=$("dDistrict").value.trim();
  const approver=$("dApprover").value;
  if(!locName){ $("dErr").textContent="Location is required (it drives the Acre Tracker)."; return; }
  if(!approver){ $("dErr").textContent="Choose a reviewer to submit this day for approval."; return; }
  const valid=drows.filter(r=>num(r.acres)>0 || String(r.farmer).trim());
  if(!valid.length){ $("dErr").textContent="Add at least one spray (acres or farmer name)."; return; }
  let a=0,amt=0; valid.forEach(r=>{ a+=num(r.acres); amt+=num(r.acres)*(num(r.crate)+num(r.frate)); });

  const rec={ entry_date:date, client_id:clientId||null, client_name:clientName||null,
    location_name:locName, state:state||null, district:district||null,
    rows:valid, total_acres:a, total_amount:amt, spray_count:valid.length,
    approval_status:"submitted", assigned_approver:approver, submitted_by:window.OPS.me.id,
    submitted_at:new Date().toISOString(), reject_note:null };

  $("dSave").disabled=true;
  let err;
  if(editingId){ ({ error:err }=await sb().from("daily_submissions").update(rec).eq("id",editingId)); }
  else { rec.created_by=window.OPS.me.id; ({ error:err }=await sb().from("daily_submissions").insert(rec)); }
  $("dSave").disabled=false;
  if(err){ $("dErr").textContent=err.message; return; }
  window.OPS.audit(editingId?"daily_resubmitted":"daily_submitted","daily_submissions",editingId||locName,locName+" · "+valid.length+" spray(s)");
  window.OPS.refreshNotifs && window.OPS.refreshNotifs();
  window.OPS.flashTop("Submitted "+valid.length+" spray(s) for approval ✓");
  window.OPS.openTool("reviews");
}
window.OPS.routes.daily_entry = ()=>view(null);

/* ============================ Daily Approvals ============================ */
/* Rendered inside the consolidated Review / Approvals tab (host passed in), or
   standalone if called with no host. */
function subChip(s){ const map={submitted:"warn",approved:"ok",rejected:"err",draft:""}; return `<span class="chip ${map[s]||""}">${esc(s)}</span>`; }

async function approvals(host){
  const embedded=!!host; const m=host||$("main"); const admin=window.OPS.isAdmin();
  m.innerHTML=`${embedded?'<h3 style="margin-top:22px">Daily spray submissions</h3>':'<div class="eyebrow">Daily Spray Entry</div><h1>Daily Approvals</h1>'}
    <div class="row wrap" style="margin:8px 0">
      <select id="daFilter" style="max-width:220px">
        <option value="submitted">Pending my review</option>
        <option value="mine">My submissions</option>
        <option value="approved">Approved (posted)</option>
        <option value="rejected">Rejected</option>
        ${admin?'<option value="all">All</option>':''}
      </select>
      <div class="spacer"></div>
      <button class="btn green sm" id="daNew">+ New daily entry</button>
    </div>
    <div id="daBody" class="muted">Loading…</div>`;
  $("daNew").addEventListener("click",()=>window.OPS.openTool("daily_entry"));
  $("daFilter").addEventListener("change",load);
  async function load(){
    const f=$("daFilter").value; const meId=window.OPS.me.id;
    let q=sb().from("daily_submissions").select("*").order("created_at",{ascending:false});
    if(f==="submitted"){ q=q.eq("approval_status","submitted"); if(!admin) q=q.eq("assigned_approver",meId); }
    else if(f==="mine"){ q=q.eq("submitted_by",meId); }
    else if(f==="approved"){ q=q.eq("approval_status","approved"); }
    else if(f==="rejected"){ q=q.eq("approval_status","rejected"); }
    const { data, error }=await q;
    if(error){ $("daBody").innerHTML='<div class="card">Error: '+esc(error.message)+'</div>'; return; }
    const rows=data||[];
    $("daBody").innerHTML = rows.length ? rows.map(card).join("") : '<div class="card muted">Nothing here.</div>';
    rows.forEach(wire);
  }
  function card(r){
    const meId=window.OPS.me.id;
    const canReview = (r.approval_status==="submitted") && (admin || r.assigned_approver===meId);
    const canEdit   = (r.submitted_by===meId) && !r.posted && (r.approval_status==="rejected"||r.approval_status==="submitted"||r.approval_status==="draft");
    const sprays=(r.rows||[]);
    return `<div class="card" id="da_${r.id}" style="margin-bottom:12px">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><div class="eyebrow">${esc(r.entry_date||"")} · ${esc(r.location_name||"")}${r.client_name?(" · "+esc(r.client_name)):""}</div>
          <h3 style="margin:2px 0">${Number(r.total_acres||0).toFixed(2)} acres · ${money(r.total_amount)} · ${r.spray_count||sprays.length} spray(s)</h3>
          <div class="muted">${subChip(r.approval_status)} ${r.posted?'<span class="chip ok">posted</span>':''} · submitted ${fmt(r.submitted_at||r.created_at)}</div>
          ${r.approval_status==="rejected"&&r.reject_note?`<div class="muted" style="color:#a3322a">Rejected: ${esc(r.reject_note)}</div>`:''}</div>
      </div>
      <details style="margin-top:8px"><summary class="muted">View ${sprays.length} spray row(s)</summary>
        <table class="tight" style="margin-top:6px"><thead><tr><th>Pilot</th><th>Farmer</th><th>Contact</th><th>Village</th><th>Crop</th><th class="num">Acres</th><th class="num">Client ₹</th><th class="num">Farmer ₹</th><th>GPS</th></tr></thead>
        <tbody>${sprays.map(x=>`<tr><td>${esc(x.pilot||"")}</td><td>${esc(x.farmer||"")}</td><td>${esc(window.OPS.helpers.maskPhone(x.phone))}</td><td>${esc(x.village||"")}</td><td>${esc(x.crop||"")}</td><td class="num">${esc(x.acres||"")}</td><td class="num">${esc(x.crate||"")}</td><td class="num">${esc(x.frate||"")}</td><td>${x.gps?"✓":""}</td></tr>`).join("")}</tbody></table>
      </details>
      <div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap">
        ${canEdit?`<button class="btn sm" data-act="edit" data-id="${r.id}">Edit</button>`:''}
        <div class="spacer"></div>
        ${canReview?`<button class="btn green sm" data-act="approve" data-id="${r.id}">Approve &amp; post</button>
          <button class="btn sm" data-act="reject" data-id="${r.id}" style="color:#a3322a;border-color:#e4b4b4">Reject…</button>`:''}
        ${(admin && r.posted)?`<button class="btn sm" data-act="reopen" data-id="${r.id}" style="color:#a3322a;border-color:#e4b4b4">Reopen (delete posted rows)</button>`:''}
      </div></div>`;
  }
  function wire(r){
    const root=$("da_"+r.id); if(!root) return;
    root.querySelectorAll("[data-act]").forEach(b=>b.addEventListener("click",async()=>{
      const act=b.getAttribute("data-act");
      if(act==="edit"){ view(r); return; }
      if(act==="approve"){
        if(!confirm("Approve this day and post "+(r.spray_count||(r.rows||[]).length)+" spray(s) to the Farmer & Acre trackers?")) return;
        b.disabled=true;
        const { error }=await sb().rpc("post_daily_submission",{ p_id:r.id });
        if(error){ alert(error.message); b.disabled=false; return; }
        window.OPS.audit("daily_approved","daily_submissions",r.id,r.location_name||"");
        window.OPS.flashTop("Approved & posted ✓"); load();
      }
      if(act==="reject"){
        const n=prompt("Reason for rejection (sent back to the submitter):"); if(n===null) return;
        b.disabled=true;
        const { error }=await sb().from("daily_submissions").update({ approval_status:"rejected", reject_note:n||null, approved_by:window.OPS.me.id, approved_at:new Date().toISOString(), updated_at:new Date().toISOString() }).eq("id",r.id);
        if(error){ alert(error.message); b.disabled=false; return; }
        window.OPS.audit("daily_rejected","daily_submissions",r.id,n||""); window.OPS.flashTop("Rejected"); load();
      }
      if(act==="reopen"){
        if(!confirm("Reopen this posted day? This DELETES its rows from the Farmer & Acre trackers so it can be edited and re-approved.")) return;
        b.disabled=true;
        const { error }=await sb().rpc("reopen_daily_submission",{ p_id:r.id });
        if(error){ alert(error.message); b.disabled=false; return; }
        window.OPS.audit("daily_reopened","daily_submissions",r.id,r.location_name||""); window.OPS.flashTop("Reopened"); load();
      }
    }));
  }
  load();
}
window.OPS.routes.daily_approvals = ()=>approvals();      // fallback (not in nav)
window.OPS.renderDailyApprovals = (host)=>approvals(host); // embedded in Review/Approvals
})();
