/* ============================================================================
   DroCon Cloud — Spray Locations (deployment areas)
   Lives under Daily Spray Entry. Locations (with an optional default rate) are
   referenced by the Daily Spray Entry form and the Acre dashboard. Moved out of
   the Acre Tracker (which is now a summary dashboard only).
   ============================================================================ */
(function(){
const { $, esc, num, money } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
let locations=[];

async function loadLocations(){ const { data }=await sb().from("spray_locations").select("*").order("name"); locations=data||[]; }

async function view(){
  await loadLocations();
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Daily Spray Entry</div><h1>Locations</h1>
    <div class="callout">Deployment areas used by the Daily Spray Entry form and the Acre dashboard. Set an optional default ₹/acre per location.</div>
    <div class="row" style="margin-bottom:8px"><input id="lSearch" placeholder="Search locations…" style="max-width:280px"><div class="spacer"></div><button class="btn green sm" id="lNew">+ New location</button></div>
    <div id="lList" class="muted">Loading…</div>`;
  $("lNew").addEventListener("click",()=>locForm(null));
  function render(rows){
    $("lList").innerHTML = rows.length?`<table><thead><tr><th>Location</th><th>District</th><th>State</th><th class="num">Default rate</th></tr></thead>
      <tbody>${rows.map(l=>`<tr class="clickable" data-id="${l.id}"><td><b>${esc(l.name)}</b></td><td>${esc(l.district||'')}</td><td>${esc(l.state||'')}</td><td class="num">${l.rates&&l.rates.default!=null?money(l.rates.default):'—'}</td></tr>`).join("")}</tbody></table>`
      :'<div class="card muted">No locations yet. Add one to start logging acres.</div>';
    $("lList").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>locForm(locations.find(x=>x.id===tr.getAttribute("data-id")))));
  }
  render(locations);
  $("lSearch").addEventListener("input",e=>{ const q=e.target.value.toLowerCase().trim();
    render(!q?locations:locations.filter(l=>[l.name,l.district,l.state].some(v=>String(v||"").toLowerCase().includes(q)))); });
}

function locForm(rec){
  const e=rec||{}; const m=$("main");
  m.innerHTML=`<button class="btn sm" id="lBack">← Back to Locations</button>
    <div class="card" style="margin-top:12px"><div class="eyebrow">Daily Spray Entry</div><h1>${rec?"Edit":"New"} location</h1>
    <div class="fgrid">
      <div class="field"><label>Location name *</label><input id="lName" value="${esc(e.name||'')}"></div>
      <div class="field"><label>State</label>${window.OPS.geoUI.stateSelect("lState",e.state||"")}</div>
      <div class="field"><label>District</label>${window.OPS.geoUI.districtSelect("lDist",e.district||"",e.state||"")}</div>
      <div class="field"><label>Default rate (₹/acre)</label><input id="lRate" type="number" step="any" value="${e.rates&&e.rates.default!=null?e.rates.default:''}"></div>
    </div>
    <div class="row"><button class="btn green" id="lSave">${rec?"Save":"Create"}</button><button class="btn" id="lCancel">Cancel</button>
      <div class="spacer"></div>${rec&&window.OPS.canDelete()?'<button class="btn sm" id="lDel" style="color:#a3322a;border-color:#e4b4b4">Delete</button>':''}</div>
    <div class="err" id="lErr"></div></div>`;
  $("lBack").addEventListener("click",view); $("lCancel").addEventListener("click",view);
  window.OPS.geoUI.wire("lState","lDist");
  $("lSave").addEventListener("click",async()=>{
    const name=$("lName").value.trim(); if(!name){ $("lErr").textContent="Name required."; return; }
    const rates={ default: num($("lRate").value)||null };
    const out={ name, district:$("lDist").value||null, state:$("lState").value||null, rates };
    if(rec){ const { error }=await sb().from("spray_locations").update(out).eq("id",rec.id); if(error){ $("lErr").textContent=error.message; return; } window.OPS.audit("edited","spray_locations",rec.id,name); }
    else { out.created_by=window.OPS.me.id; const { error }=await sb().from("spray_locations").insert(out); if(error){ $("lErr").textContent=error.message; return; } window.OPS.audit("created","spray_locations",name,name); }
    window.OPS.flashTop("Saved ✓"); view();
  });
  if($("lDel")) $("lDel").addEventListener("click",async()=>{ if(!confirm("Delete location? (existing entries remain)"))return; await sb().from("spray_locations").delete().eq("id",rec.id); window.OPS.audit("deleted","spray_locations",rec.id,""); view(); });
}

window.OPS.routes.locations = view;
})();
