/* ============================================================================
   DroCon Cloud — Spray Locations (deployment areas)
   Lives under Daily Spray Entry. Locations (with an optional default rate) are
   referenced by the Daily Spray Entry form and the Acre dashboard. Moved out of
   the Acre Tracker (which is now a summary dashboard only).
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
let locations=[], clients=[];
const cName = c => (c && (c.firm_name || c.name)) || "";
const isApprover = ()=> window.OPS.isAdmin() || (window.OPS.isApprover && window.OPS.isApprover());

async function loadLocations(){
  const [l,c]=await Promise.all([
    sb().from("spray_locations").select("*, client:client_id(firm_name,name), fbt:farmer_bill_to(firm_name,name), cbt:client_bill_to(firm_name,name)").order("name"),
    sb().from("clients").select("id,firm_name,name").order("firm_name")
  ]);
  locations=l.data||[]; clients=c.data||[];
}

async function view(){
  await loadLocations();
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Daily Spray Entry</div><h1>Locations</h1>
    <div class="callout">Every location belongs to a <b>Client</b> — create the client first under <b>Finance → Client</b>.
      Locking a location freezes it: no new pilots can be assigned and it disappears from the entry drop-downs, which keeps the lists short and prevents wrong entries.</div>
    <div class="row" style="margin-bottom:8px"><input id="lSearch" placeholder="Search locations…" style="max-width:280px"><div class="spacer"></div><button class="btn green sm" id="lNew">+ New location</button></div>
    <div id="lList" class="muted">Loading…</div>`;
  $("lNew").addEventListener("click",()=>locForm(null));
  function render(rows){
    $("lList").innerHTML = rows.length?`<div style="overflow:auto"><table><thead><tr><th>Location</th><th>District / State</th><th class="num">Farmer ₹</th><th>Billed to</th><th class="num">Client ₹</th><th>Billed to</th><th>Status</th></tr></thead>
      <tbody>${rows.map(l=>`<tr class="clickable" data-id="${l.id}"><td><b>${esc(l.name)}</b></td>
        <td>${esc([l.district,l.state].filter(Boolean).join(", "))}</td>
        <td class="num">${l.farmer_rate!=null?money(l.farmer_rate):'—'}</td>
        <td>${l.fbt?esc(cName(l.fbt)):'<span class="chip rejected">not set</span>'}</td>
        <td class="num">${num(l.client_rate)>0?money(l.client_rate):'<span class="muted">0</span>'}</td>
        <td>${num(l.client_rate)>0?(l.cbt?esc(cName(l.cbt)):'<span class="chip rejected">not set</span>'):'<span class="muted">—</span>'}</td>
        <td>${l.is_locked?'<span class="chip executed">🔒 Locked</span>':'<span class="chip approved">Open</span>'}</td></tr>`).join("")}</tbody></table></div>`
      :'<div class="card muted">No locations yet. Add one to start logging acres.</div>';
    $("lList").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>locForm(locations.find(x=>String(x.id)===tr.getAttribute("data-id")))));
  }
  render(locations);
  $("lSearch").addEventListener("input",e=>{ const q=e.target.value.toLowerCase().trim();
    render(!q?locations:locations.filter(l=>[l.name,l.district,l.state,cName(l.client)].some(v=>String(v||"").toLowerCase().includes(q)))); });
}

function locForm(rec){
  const e=rec||{}; const m=$("main"); const locked=!!e.is_locked;
  if(!clients.length && !rec){
    m.innerHTML=`<button class="btn sm" id="lBack">← Back to Locations</button>
      <div class="card" style="margin-top:12px"><div class="callout warn"><b>No clients yet.</b>
      Every location must belong to a client. Create the client first under <b>Finance → Client</b>, then come back.</div></div>`;
    $("lBack").addEventListener("click",view); return;
  }
  m.innerHTML=`<button class="btn sm" id="lBack">← Back to Locations</button>
    <div class="card" style="margin-top:12px"><div class="eyebrow">Daily Spray Entry</div><h1>${rec?"Edit":"New"} location</h1>
    ${locked?'<div class="callout warn">🔒 <b>This location is locked.</b> Details cannot be edited and no pilots can be assigned. An approver must unlock it first.</div>':''}
    <div class="fgrid">
      <div class="field"><label>Client *</label><select id="lClient" ${locked?'disabled':''}>
        <option value="">— select client —</option>
        ${clients.map(c=>`<option value="${c.id}" ${e.client_id===c.id?'selected':''}>${esc(cName(c))}</option>`).join("")}
      </select></div>
      <div class="field"><label>Location name *</label><input id="lName" value="${esc(e.name||'')}" ${locked?'disabled':''}></div>
      <div class="field"><label>State</label>${window.OPS.geoUI.stateSelect("lState",e.state||"")}</div>
      <div class="field"><label>District</label>${window.OPS.geoUI.districtSelect("lDist",e.district||"",e.state||"")}</div>
    </div>
    <h3 style="margin-top:14px">Rates &amp; billing</h3>
    <p class="muted" style="margin-top:-4px">The two rate components are billed <b>separately, to different parties</b>.
      Leave the client rate at <b>0</b> where there is no client-side component — then only the farmer bill is raised.</p>
    <div class="fgrid">
      <div class="field"><label>Farmer rate (₹/acre)</label>
        <input id="lFarmerRate" type="number" step="any" value="${e.farmer_rate!=null?e.farmer_rate:''}" ${locked?'disabled':''}></div>
      <div class="field"><label>Bill farmer rate to *</label><select id="lFarmerTo" ${locked?'disabled':''}>
        <option value="">— select client —</option>
        ${clients.map(c=>`<option value="${c.id}" ${e.farmer_bill_to===c.id?'selected':''}>${esc(cName(c))}</option>`).join("")}
      </select><div class="small-note">0% GST · “Bill of Supply”</div></div>
      <div class="field"><label>Client rate (₹/acre)</label>
        <input id="lClientRate" type="number" step="any" value="${e.client_rate!=null?e.client_rate:0}" ${locked?'disabled':''}></div>
      <div class="field"><label>Bill client rate to</label><select id="lClientTo" ${locked?'disabled':''}>
        <option value="">— none (client rate is 0) —</option>
        ${clients.map(c=>`<option value="${c.id}" ${e.client_bill_to===c.id?'selected':''}>${esc(cName(c))}</option>`).join("")}
      </select><div class="small-note">18% GST · Marketing Expense / Subsidy</div></div>
    </div>
    <div class="row wrap"><button class="btn green" id="lSave" ${locked?'disabled':''}>${rec?"Save":"Create"}</button><button class="btn" id="lCancel">Cancel</button>
      <div class="spacer"></div>
      ${rec&&isApprover()?`<button class="btn sm" id="lLock">${locked?'🔓 Unlock location':'🔒 Lock location'}</button>`:''}
      ${rec&&window.OPS.canDelete()&&!locked?'<button class="btn sm" id="lDel" style="color:#a3322a;border-color:#e4b4b4">Delete</button>':''}</div>
    <div class="err" id="lErr"></div></div>
    ${rec?'<div class="card" id="lPilots"><h3>Pilots at this location</h3><div class="muted">Loading…</div></div>':''}`;
  $("lBack").addEventListener("click",view); $("lCancel").addEventListener("click",view);
  window.OPS.geoUI.wire("lState","lDist");
  if($("lLock")) $("lLock").addEventListener("click",async()=>{
    const note = locked ? null : prompt("Optional note for locking this location:","");
    if(!locked && note===null) return;
    const { error }=await sb().rpc("set_location_lock",{ p_id:rec.id, p_locked:!locked, p_note:note||null });
    if(error){ alert(error.message); return; }
    window.OPS.flashTop(locked?"Location unlocked ✓":"Location locked ✓"); view();
  });
  if(rec) loadLocPilots(rec);
  $("lSave").addEventListener("click",async()=>{
    const name=$("lName").value.trim(); if(!name){ $("lErr").textContent="Name required."; return; }
    const client_id=$("lClient").value; if(!client_id){ $("lErr").textContent="Select the client this location belongs to."; return; }
    const farmerRate=num($("lFarmerRate").value), clientRate=num($("lClientRate").value);
    const farmerTo=$("lFarmerTo").value||null, clientTo=$("lClientTo").value||null;
    if(!farmerTo){ $("lErr").textContent="Select who the farmer rate is billed to."; return; }
    if(clientRate>0 && !clientTo){ $("lErr").textContent="The client rate is above 0 — choose who it is billed to, or set the rate to 0."; return; }
    const out={ name, client_id, district:$("lDist").value||null, state:$("lState").value||null,
      farmer_rate: farmerRate||null, client_rate: clientRate||0,
      farmer_bill_to: farmerTo, client_bill_to: clientRate>0?clientTo:null,
      rates: { default: farmerRate||null } };   // keep the legacy field in step
    if(rec){ const { error }=await sb().from("spray_locations").update(out).eq("id",rec.id); if(error){ $("lErr").textContent=error.message; return; } window.OPS.audit("edited","spray_locations",rec.id,name); }
    else { out.created_by=window.OPS.me.id; const { error }=await sb().from("spray_locations").insert(out); if(error){ $("lErr").textContent=error.message; return; } window.OPS.audit("created","spray_locations",name,name); }
    window.OPS.flashTop("Saved ✓"); view();
  });
  if($("lDel")) $("lDel").addEventListener("click",async()=>{ if(!confirm("Delete location? (existing entries remain)"))return; await sb().from("spray_locations").delete().eq("id",rec.id); window.OPS.audit("deleted","spray_locations",rec.id,""); view(); });
}

/* every pilot who has ever worked this location, active and past */
async function loadLocPilots(rec){
  const host=$("lPilots"); if(!host) return;
  const { data, error }=await sb().from("pilot_assignments")
    .select("*, pilot:pilot_id(name,phone, vendor:vendor_id(firm_name,name))")
    .eq("location_id",rec.id).order("start_date",{ascending:false});
  if(error){ host.innerHTML='<h3>Pilots at this location</h3><div class="muted">'+esc(error.message)+'</div>'; return; }
  const rows=data||[];
  host.innerHTML=`<h3>Pilots at this location</h3>
    ${rows.length?`<div style="overflow:auto"><table><thead><tr><th>Pilot</th><th>Vendor</th><th>Phone</th><th>From</th><th>To</th><th>Status</th></tr></thead>
      <tbody>${rows.map(a=>`<tr><td><b>${esc((a.pilot&&a.pilot.name)||'')}</b></td>
        <td>${esc((a.pilot&&a.pilot.vendor&&cName(a.pilot.vendor))||'')}</td>
        <td>${esc(window.OPS.helpers.maskPhone((a.pilot&&a.pilot.phone)||''))}</td>
        <td>${fmtDate(a.start_date)}</td><td>${a.end_date?fmtDate(a.end_date):'—'}</td>
        <td>${a.status==="active"?'<span class="chip approved">Active</span>'
             :a.status==="paused"?'<span class="chip in_review">Paused</span>'
             :'<span class="chip executed">Closed</span>'}</td></tr>`).join("")}</tbody></table></div>`
      :'<div class="muted">No pilots assigned yet. Assign them from <b>Pilots</b>.</div>'}`;
}

window.OPS.routes.locations = view;
})();
