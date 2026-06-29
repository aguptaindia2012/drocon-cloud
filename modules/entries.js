/* ============================================================================
   DroCon Cloud — Entries (raw row-level data) under Daily Spray Entry
   The home for every individual spray/acre row BEFORE it is rolled up into the
   Acre & Farmer dashboards (which are summary-only). This is where correcting /
   editing individual rows happens. Two views: Farmer sprays and Acre entries.
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const mask = v => window.OPS.helpers.maskPhone(v);
let mode="farmer", locations=[];

async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Daily Spray Entry</div><h1>Entries</h1>
    <div class="callout">Raw row-level entries that roll up into the <b>Acre</b> &amp; <b>Farmer</b> dashboards. Correct or delete individual rows here — the dashboards stay summary-only.</div>
    <div class="row wrap" style="margin:8px 0">
      <button class="btn sm ${mode==='farmer'?'green':''}" id="emFarmer">Farmer sprays</button>
      <button class="btn sm ${mode==='acre'?'green':''}" id="emAcre">Acre entries</button>
      <input id="eqSearch" placeholder="Search…" style="max-width:260px">
      <div class="spacer"></div>
    </div>
    <div id="eqList" class="muted">Loading…</div>`;
  $("emFarmer").addEventListener("click",()=>{ mode="farmer"; view(); });
  $("emAcre").addEventListener("click",()=>{ mode="acre"; view(); });
  if(!locations.length){ const { data }=await sb().from("spray_locations").select("id,name"); locations=data||[]; }
  mode==="farmer" ? loadFarmer() : loadAcre();
  $("eqSearch").addEventListener("input",e=>{ const q=e.target.value.toLowerCase().trim(); window._eqFilter=q; window._eqRender&&window._eqRender(); });
}

/* ---------------- Farmer sprays ---------------- */
async function loadFarmer(){
  const { data, error }=await sb().from("farmer_sprays").select("*").order("spray_date",{ascending:false}).limit(400);
  if(error){ $("eqList").innerHTML='<div class="card">Error: '+esc(error.message)+'</div>'; return; }
  const all=data||[];
  window._eqRender=()=>{ const q=window._eqFilter||"";
    const rows=!q?all:all.filter(r=>[r.farmer_name,r.village,r.pilot_name,r.client_name,r.crop].some(v=>String(v||"").toLowerCase().includes(q)));
    $("eqList").innerHTML = rows.length?`<div style="overflow:auto"><table><thead><tr><th>Date</th><th>Pilot</th><th>Farmer</th><th>Contact</th><th>Village</th><th>Crop</th><th class="num">Acre</th><th class="num">Amount</th><th>GPS</th></tr></thead>
      <tbody>${rows.slice(0,250).map(r=>`<tr class="clickable" data-id="${r.id}"><td>${fmtDate(r.spray_date)}</td><td>${esc(r.pilot_name||'')}</td><td>${esc(r.farmer_name||'')}</td><td>${esc(mask(r.contact_no))}</td><td>${esc(r.village||'')}</td><td>${esc(r.crop||'')}</td><td class="num">${num(r.acre)}</td><td class="num">${money(r.amount)}</td><td>${r.gps_image_present?'✓':'·'}</td></tr>`).join("")}</tbody></table></div>`
      :'<div class="card muted">No matching rows.</div>';
    $("eqList").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>farmerForm(all.find(x=>x.id===tr.getAttribute("data-id"))))); };
  window._eqRender();
}
function farmerForm(r){
  const m=$("main"); const seePhone=window.OPS.canViewContacts();
  m.innerHTML=`<button class="btn sm" id="eqBack">← Back to Entries</button>
    <div class="card" style="margin-top:12px"><div class="eyebrow">Daily Spray Entry · Farmer spray</div><h1>Edit spray</h1>
    <div class="fgrid">
      <div class="field"><label>Date</label><input id="f_spray_date" type="date" value="${esc((r.spray_date||"").slice(0,10))}"></div>
      <div class="field"><label>Pilot</label><input id="f_pilot_name" value="${esc(r.pilot_name||'')}"></div>
      <div class="field"><label>Client</label><input id="f_client_name" value="${esc(r.client_name||'')}"></div>
      <div class="field"><label>Farmer</label><input id="f_farmer_name" value="${esc(r.farmer_name||'')}"></div>
      <div class="field"><label>Contact ${seePhone?'':'(hidden — you lack View contacts)'}</label><input id="f_contact_no" value="${esc(seePhone?(r.contact_no||''):mask(r.contact_no))}" ${seePhone?'':'disabled'}></div>
      <div class="field"><label>Village</label><input id="f_village" value="${esc(r.village||'')}"></div>
      <div class="field"><label>State</label>${window.OPS.geoUI.stateSelect("f_state",r.state||"")}</div>
      <div class="field"><label>District</label>${window.OPS.geoUI.districtSelect("f_district",r.district||"",r.state||"")}</div>
      <div class="field"><label>Medicine / Chemical</label><input id="f_chemical_company" value="${esc(r.chemical_company||'')}"></div>
      <div class="field"><label>Crop</label><input id="f_crop" value="${esc(r.crop||'')}"></div>
      <div class="field"><label>Acre</label><input id="f_acre" type="number" step="any" value="${esc(r.acre)}"></div>
      <div class="field"><label>Rate (₹/acre)</label><input id="f_rate" type="number" step="any" value="${esc(r.rate)}"></div>
      <div class="field"><label>Invoice no.</label><input id="f_invoice_number" value="${esc(r.invoice_number||'')}"></div>
      <div class="field"><label>Payment status</label><input id="f_payment_status" value="${esc(r.payment_status||'')}"></div>
      <div class="field"><label>GPS image present</label><select id="f_gps"><option value="true" ${r.gps_image_present?'selected':''}>Yes</option><option value="false" ${!r.gps_image_present?'selected':''}>No</option></select></div>
    </div>
    <div class="row"><button class="btn green" id="eqSave">Save changes</button><button class="btn" id="eqCancel">Cancel</button>
      <div class="spacer"></div>${window.OPS.canDelete()?'<button class="btn sm" id="eqDel" style="color:#a3322a;border-color:#e4b4b4">Delete</button>':''}</div>
    <div class="err" id="eqErr"></div></div>`;
  $("eqBack").addEventListener("click",view); $("eqCancel").addEventListener("click",view);
  window.OPS.geoUI.wire("f_state","f_district");
  $("eqSave").addEventListener("click",async()=>{
    const acre=num($("f_acre").value), rate=num($("f_rate").value);
    const out={ spray_date:$("f_spray_date").value||null, pilot_name:$("f_pilot_name").value||null, client_name:$("f_client_name").value||null,
      farmer_name:$("f_farmer_name").value||null, village:$("f_village").value||null, state:$("f_state").value||null, district:$("f_district").value||null,
      chemical_company:$("f_chemical_company").value||null, crop:$("f_crop").value||null, acre:acre||null, rate:rate||null,
      amount:(acre*rate)||null, invoice_number:$("f_invoice_number").value||null, payment_status:$("f_payment_status").value||null,
      gps_image_present:$("f_gps").value==="true" };
    if(seePhone) out.contact_no=$("f_contact_no").value||null;   // only overwrite if user can see it
    const { error }=await sb().from("farmer_sprays").update(out).eq("id",r.id);
    if(error){ $("eqErr").textContent=error.message; return; }
    window.OPS.audit("edited","farmer_sprays",r.id,out.farmer_name||""); window.OPS.flashTop("Saved ✓"); view();
  });
  if($("eqDel")) $("eqDel").addEventListener("click",async()=>{ if(!confirm("Delete this spray row?"))return; const { error }=await sb().from("farmer_sprays").delete().eq("id",r.id); if(error){ alert(error.message); return; } window.OPS.audit("deleted","farmer_sprays",r.id,""); view(); });
}

/* ---------------- Acre entries ---------------- */
async function loadAcre(){
  const { data, error }=await sb().from("acre_entries").select("*, loc:location_id(name)").order("entry_date",{ascending:false}).limit(400);
  if(error){ $("eqList").innerHTML='<div class="card">Error: '+esc(error.message)+'</div>'; return; }
  const all=data||[];
  window._eqRender=()=>{ const q=window._eqFilter||"";
    const rows=!q?all:all.filter(r=>[(r.loc&&r.loc.name),r.pilot_name,r.crop].some(v=>String(v||"").toLowerCase().includes(q)));
    $("eqList").innerHTML = rows.length?`<div style="overflow:auto"><table><thead><tr><th>Date</th><th>Location</th><th>Pilot</th><th class="num">Acres</th><th class="num">Client ₹</th><th class="num">Farmer ₹</th><th class="num">Amount</th><th>Crop</th></tr></thead>
      <tbody>${rows.slice(0,250).map(r=>`<tr class="clickable" data-id="${r.id}"><td>${fmtDate(r.entry_date)}</td><td>${esc(r.loc&&r.loc.name||'')}</td><td>${esc(r.pilot_name||'')}</td><td class="num">${num(r.acres)}</td><td class="num">${r.client_rate!=null?money(r.client_rate):'—'}</td><td class="num">${r.farmer_rate!=null?money(r.farmer_rate):'—'}</td><td class="num">${money(r.amount)}</td><td>${esc(r.crop||'')}</td></tr>`).join("")}</tbody></table></div>`
      :'<div class="card muted">No matching rows.</div>';
    $("eqList").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>acreForm(all.find(x=>x.id===tr.getAttribute("data-id"))))); };
  window._eqRender();
}
function acreForm(r){
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="eqBack">← Back to Entries</button>
    <div class="card" style="margin-top:12px"><div class="eyebrow">Daily Spray Entry · Acre entry</div><h1>Edit acre entry</h1>
    <div class="fgrid">
      <div class="field"><label>Date</label><input id="a_entry_date" type="date" value="${esc((r.entry_date||"").slice(0,10))}"></div>
      <div class="field"><label>Location</label><select id="a_location_id"><option value="">— none —</option>${locations.map(l=>`<option value="${l.id}" ${r.location_id===l.id?'selected':''}>${esc(l.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Pilot</label><input id="a_pilot_name" value="${esc(r.pilot_name||'')}"></div>
      <div class="field"><label>Acres</label><input id="a_acres" type="number" step="any" value="${esc(r.acres)}"></div>
      <div class="field"><label>Client rate (₹/acre)</label><input id="a_client_rate" type="number" step="any" value="${esc(r.client_rate)}"></div>
      <div class="field"><label>Farmer rate (₹/acre)</label><input id="a_farmer_rate" type="number" step="any" value="${esc(r.farmer_rate)}"></div>
      <div class="field"><label>Crop</label><input id="a_crop" value="${esc(r.crop||'')}"></div>
    </div>
    <div class="row"><button class="btn green" id="eqSave">Save changes</button><button class="btn" id="eqCancel">Cancel</button>
      <div class="spacer"></div>${window.OPS.canDelete()?'<button class="btn sm" id="eqDel" style="color:#a3322a;border-color:#e4b4b4">Delete</button>':''}</div>
    <div class="err" id="eqErr"></div></div>`;
  $("eqBack").addEventListener("click",view); $("eqCancel").addEventListener("click",view);
  $("eqSave").addEventListener("click",async()=>{
    const acres=num($("a_acres").value), cr=num($("a_client_rate").value), fr=num($("a_farmer_rate").value); const rate=cr+fr;
    const out={ entry_date:$("a_entry_date").value||null, location_id:$("a_location_id").value||null, pilot_name:$("a_pilot_name").value||null,
      acres:acres||0, client_rate:cr||null, farmer_rate:fr||null, rate:rate||null, amount:(acres*rate)||null, crop:$("a_crop").value||null };
    const { error }=await sb().from("acre_entries").update(out).eq("id",r.id);
    if(error){ $("eqErr").textContent=error.message; return; }
    window.OPS.audit("edited","acre_entries",r.id,out.pilot_name||""); window.OPS.flashTop("Saved ✓"); view();
  });
  if($("eqDel")) $("eqDel").addEventListener("click",async()=>{ if(!confirm("Delete this acre row?"))return; const { error }=await sb().from("acre_entries").delete().eq("id",r.id); if(error){ alert(error.message); return; } window.OPS.audit("deleted","acre_entries",r.id,""); view(); });
}

window.OPS.routes.entries = view;
})();
