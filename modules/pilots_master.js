/* ============================================================================
   DroCon Cloud — Pilots (master data)
   A pilot belongs to a VENDOR (which must exist first) and works ONE location
   at a time. Assignments can be paused so an older one can be reactivated to
   correct historic data, then closed permanently. Acre entry, dashboards and
   invoicing all key off these records instead of free-text names.
   ============================================================================ */
(function(){
const { $, esc, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
let vendors=[], locations=[], pilots=[], assigns={};   // pilot_id -> [assignments]

const vName = v => (v && (v.firm_name || v.name)) || "";
const locName = l => l ? (l.name + (l.is_locked?" 🔒":"")) : "";

async function loadRefs(){
  const [v,l]=await Promise.all([
    sb().from("vendors").select("id,firm_name,name").order("firm_name"),
    sb().from("spray_locations").select("id,name,is_locked,client_id, client:client_id(firm_name,name)").order("name")
  ]);
  vendors=v.data||[]; locations=l.data||[];
}

/* ----------------------------- list ----------------------------- */
async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Daily Spray Entry</div><h1>Pilots</h1>
    <div class="callout">Pilots are selected from this list when entering acre data, so names stay consistent.
      A pilot must belong to a <b>Vendor</b> — create the vendor first under <b>Finance → Vendors</b>.
      Each pilot works <b>one location at a time</b>.</div>
    <div class="row wrap" style="margin:10px 0">
      <input id="plSearch" placeholder="Search pilot / vendor / phone…" style="max-width:280px">
      <div class="spacer"></div>
      <button class="btn green sm" id="plNew">+ New pilot</button>
    </div>
    <div id="plList" class="muted">Loading…</div>`;
  $("plNew").addEventListener("click",()=>form(null));
  await loadRefs();
  await loadPilots();
  $("plSearch").addEventListener("input",e=>render(e.target.value.toLowerCase().trim()));
}

async function loadPilots(){
  const { data, error }=await sb().from("pilots")
    .select("*, vendor:vendor_id(firm_name,name)").order("name");
  if(error){ $("plList").innerHTML='<div class="card">Error: '+esc(error.message)+'</div>'; return; }
  pilots=data||[];
  const { data:pa }=await sb().from("pilot_assignments")
    .select("*, loc:location_id(name,is_locked)").order("start_date",{ascending:false});
  assigns={}; (pa||[]).forEach(a=>{ (assigns[a.pilot_id]=assigns[a.pilot_id]||[]).push(a); });
  render("");
}

function activeOf(pid){ return (assigns[pid]||[]).find(a=>a.status==="active"); }

function render(q){
  const rows=pilots.filter(p=>!q ||
    [p.name,vName(p.vendor),p.phone,p.rpc_no,p.drone_uin].some(x=>String(x||"").toLowerCase().includes(q)));
  $("plList").innerHTML = rows.length ? `<div style="overflow:auto"><table>
    <thead><tr><th>Pilot</th><th>Vendor</th><th>Phone</th><th>RPC</th><th>Drone UIN</th><th>Current location</th><th>Status</th></tr></thead>
    <tbody>${rows.map(p=>{ const a=activeOf(p.id);
      return `<tr class="clickable" data-id="${p.id}">
        <td><b>${esc(p.name)}</b></td><td>${esc(vName(p.vendor))}</td><td>${esc(p.phone||'')}</td>
        <td>${esc(p.rpc_no||'—')}</td><td>${esc(p.drone_uin||'—')}</td>
        <td>${a?esc((a.loc&&a.loc.name)||''):'<span class="muted">— unassigned —</span>'}</td>
        <td>${p.is_active?'<span class="chip approved">Active</span>':'<span class="chip draft">Inactive</span>'}</td></tr>`;
    }).join("")}</tbody></table></div>`
    : '<div class="card muted">No pilots yet. Click “New pilot”.</div>';
  $("plList").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>{
    const p=pilots.find(x=>String(x.id)===tr.getAttribute("data-id")); if(p) form(p); }));
}

/* ----------------------------- create / edit ----------------------------- */
function form(rec){
  const e=rec||{}; const m=$("main");
  if(!vendors.length){
    m.innerHTML=`<button class="btn sm" id="plBack">← Back to Pilots</button>
      <div class="card" style="margin-top:12px"><div class="callout warn"><b>No vendors yet.</b>
      A pilot must be linked to the vendor who employs them. Create the vendor first under
      <b>Finance → Vendors</b>, then come back.</div></div>`;
    $("plBack").addEventListener("click",view); return;
  }
  m.innerHTML=`<button class="btn sm" id="plBack">← Back to Pilots</button>
    <div class="card" style="margin-top:12px">
      <div class="eyebrow">Daily Spray Entry · Pilot</div><h1>${rec?"Edit pilot":"New pilot"}</h1>
      <div class="fgrid">
        <div class="field"><label>Vendor (employer) *</label><select id="p_vendor">
          <option value="">— select vendor —</option>
          ${vendors.map(v=>`<option value="${v.id}" ${e.vendor_id===v.id?'selected':''}>${esc(vName(v))}</option>`).join("")}
        </select></div>
        <div class="field"><label>Pilot name *</label><input id="p_name" value="${esc(e.name||'')}"></div>
        <div class="field"><label>Phone number</label><input id="p_phone" value="${esc(e.phone||'')}"></div>
        <div class="field"><label>RPC number <span class="muted">(optional)</span></label><input id="p_rpc" value="${esc(e.rpc_no||'')}"></div>
        <div class="field"><label>Drone UIN <span class="muted">(optional)</span></label><input id="p_uin" value="${esc(e.drone_uin||'')}"></div>
        <div class="field"><label>PAN <span class="muted">(optional)</span></label><input id="p_pan" value="${esc(e.pan_no||'')}"></div>
        <div class="field"><label>Aadhaar <span class="muted">(optional)</span></label><input id="p_aadhaar" value="${esc(e.aadhaar_no||'')}"></div>
        <div class="field"><label>Active</label><select id="p_active">
          <option value="true" ${e.is_active!==false?'selected':''}>Yes</option>
          <option value="false" ${e.is_active===false?'selected':''}>No</option></select></div>
      </div>
      <div class="row"><button class="btn green" id="plSave">${rec?"Save changes":"Create pilot"}</button>
        <button class="btn" id="plCancel">Cancel</button></div>
      <div class="err" id="plErr"></div>
    </div>
    ${rec?`<div class="card" id="plAssign"><h3>Location assignment</h3><div class="muted">Loading…</div></div>`:''}`;
  $("plBack").addEventListener("click",view); $("plCancel").addEventListener("click",view);
  $("plSave").addEventListener("click",async()=>{
    const out={ vendor_id:$("p_vendor").value||null, name:$("p_name").value.trim(),
      phone:$("p_phone").value.trim()||null, rpc_no:$("p_rpc").value.trim()||null,
      drone_uin:$("p_uin").value.trim()||null, pan_no:$("p_pan").value.trim()||null,
      aadhaar_no:$("p_aadhaar").value.trim()||null, is_active:$("p_active").value==="true" };
    if(!out.vendor_id){ $("plErr").textContent="Select the vendor who employs this pilot."; return; }
    if(!out.name){ $("plErr").textContent="Pilot name is required."; return; }
    $("plSave").disabled=true;
    let err;
    if(rec){ ({ error:err }=await sb().from("pilots").update(out).eq("id",rec.id)); }
    else { out.created_by=window.OPS.me.id; ({ error:err }=await sb().from("pilots").insert(out)); }
    $("plSave").disabled=false;
    if(err){ $("plErr").textContent = /duplicate|unique/i.test(err.message)
      ? "That pilot already exists for this vendor." : err.message; return; }
    window.OPS.audit(rec?"edited":"created","pilots",rec?rec.id:"new",out.name);
    window.OPS.flashTop("Saved ✓"); view();
  });
  if(rec) renderAssign(rec);
}

/* ----------------------------- assignments ----------------------------- */
function renderAssign(p){
  const host=$("plAssign"); if(!host) return;
  const list=(assigns[p.id]||[]);
  const active=list.find(a=>a.status==="active");
  const free=locations.filter(l=>!l.is_locked);
  host.innerHTML=`<h3>Location assignment</h3>
    ${active?`<div class="callout"><b>Currently at ${esc((active.loc&&active.loc.name)||'')}</b>
        since ${fmtDate(active.start_date)}.
        <div class="row wrap" style="margin-top:8px">
          <button class="btn sm" data-pause="${active.id}">⏸ Pause (to switch or correct history)</button>
          <button class="btn sm" data-close="${active.id}" style="color:#a3322a;border-color:#e4b4b4">🔒 Close location</button>
        </div></div>`
      :`<div class="callout warn">This pilot has <b>no active location</b>. Assign one so acre data can be entered for them.
        <div class="row wrap" style="margin-top:8px;gap:8px;align-items:flex-end">
          <div class="field" style="margin:0;min-width:220px"><label>Location</label><select id="asLoc">
            <option value="">— select location —</option>
            ${free.map(l=>`<option value="${l.id}">${esc(l.name)}${l.client?(' · '+esc(vName(l.client))):''}</option>`).join("")}
          </select></div>
          <div class="field" style="margin:0"><label>Start date</label><input type="date" id="asStart" value="${todayISO()}"></div>
          <button class="btn green sm" id="asGo">Assign</button>
        </div>
        ${free.length?'':'<div class="small-note" style="margin-top:6px">All locations are locked — unlock one under <b>Locations</b> first.</div>'}
      </div>`}
    ${list.length?`<table><thead><tr><th>Location</th><th>From</th><th>To</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map(a=>`<tr>
        <td>${esc((a.loc&&a.loc.name)||'')}</td><td>${fmtDate(a.start_date)}</td>
        <td>${a.end_date?fmtDate(a.end_date):'—'}</td>
        <td>${a.status==="active"?'<span class="chip approved">Active</span>'
             :a.status==="paused"?'<span class="chip in_review">Paused</span>'
             :'<span class="chip executed">Closed</span>'}</td>
        <td>${a.status==="paused"?`<button class="btn sm" data-react="${a.id}">Reactivate</button>`:''}</td>
      </tr>`).join("")}</tbody></table>
      <p class="muted">Closed assignments are permanent — no acre data can be entered for that pilot at that location.
        To correct older data, <b>pause</b> the current location and <b>reactivate</b> the earlier one.</p>`:''}`;

  host.querySelectorAll("[data-pause]").forEach(b=>b.addEventListener("click",()=>rpc("pause_pilot_assignment",{p_id:b.getAttribute("data-pause")},p)));
  host.querySelectorAll("[data-react]").forEach(b=>b.addEventListener("click",()=>rpc("reactivate_pilot_assignment",{p_id:b.getAttribute("data-react")},p)));
  host.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>{
    if(!confirm("Close this location for the pilot? No further acre data can be entered for it.")) return;
    rpc("close_pilot_assignment",{p_id:b.getAttribute("data-close"),p_note:null},p); }));
  if($("asGo")) $("asGo").addEventListener("click",async()=>{
    const loc=$("asLoc").value; if(!loc){ alert("Choose a location."); return; }
    rpc("assign_pilot_location",{p_pilot:p.id,p_location:loc,p_start:$("asStart").value||todayISO()},p);
  });
}
async function rpc(fn,args,p){
  const { error }=await sb().rpc(fn,args);
  if(error){ alert(error.message); return; }
  const { data:pa }=await sb().from("pilot_assignments")
    .select("*, loc:location_id(name,is_locked)").order("start_date",{ascending:false});
  assigns={}; (pa||[]).forEach(a=>{ (assigns[a.pilot_id]=assigns[a.pilot_id]||[]).push(a); });
  window.OPS.flashTop("Updated ✓"); renderAssign(p);
}

/* expose a helper the acre-entry form can use to list selectable pilots */
window.OPS.activePilotsFor = async function(locationId){
  const { data }=await sb().from("pilot_assignments")
    .select("pilot_id, status, pilot:pilot_id(id,name,phone)")
    .eq("location_id",locationId).eq("status","active");
  return (data||[]).map(a=>a.pilot).filter(Boolean);
};

window.OPS.routes.pilots_master = view;
})();
