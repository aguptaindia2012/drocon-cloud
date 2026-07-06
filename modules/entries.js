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
let mode="farmer", locations=[], allRows=[];
// report filters, held per sub-sub-tab so switching tabs keeps each one's state
const fltr={ farmer:{from:"",to:"",field:"",val:""}, acre:{from:"",to:"",field:"",val:""} };

// column set per sub-tab — drives both the filter dropdown and the Excel report
function fieldDefs(m){
  return m==="farmer" ? [
    {k:"spray_date",label:"Date",type:"date"},
    {k:"pilot_name",label:"Pilot"},
    {k:"client_name",label:"Client"},
    {k:"farmer_name",label:"Farmer"},
    {k:"contact_no",label:"Contact"},
    {k:"village",label:"Village"},
    {k:"state",label:"State"},
    {k:"district",label:"District"},
    {k:"chemical_company",label:"Medicine"},
    {k:"crop",label:"Crop"},
    {k:"acre",label:"Acre",type:"num"},
    {k:"rate",label:"Rate (₹/acre)",type:"num"},
    {k:"amount",label:"Amount",type:"num"},
    {k:"invoice_number",label:"Invoice no."},
    {k:"payment_status",label:"Payment status"},
    {k:"gps_image_present",label:"GPS image",type:"bool"}
  ] : [
    {k:"entry_date",label:"Date",type:"date"},
    {k:"location",label:"Location"},
    {k:"pilot_name",label:"Pilot"},
    {k:"acres",label:"Acres",type:"num"},
    {k:"client_rate",label:"Client rate (₹)",type:"num"},
    {k:"farmer_rate",label:"Farmer rate (₹)",type:"num"},
    {k:"rate",label:"Total rate (₹)",type:"num"},
    {k:"amount",label:"Amount",type:"num"},
    {k:"crop",label:"Crop"},
    {k:"chemical",label:"Medicine"}
  ];
}
function cellVal(m,r,k){ if(m==="acre" && k==="location") return (r.loc&&r.loc.name)||""; return r[k]; }
// date range is applied in the DB query; the field filter + quick search are client-side
function passFilters(m,r){
  const f=fltr[m];
  if(f.field && f.val){ const v=String(cellVal(m,r,f.field)==null?"":cellVal(m,r,f.field)).toLowerCase(); if(v.indexOf(f.val.toLowerCase())<0) return false; }
  const q=window._eqFilter||"";
  if(q){ const hay = m==="farmer"?[r.farmer_name,r.village,r.pilot_name,r.client_name,r.crop,r.chemical_company]:[(r.loc&&r.loc.name),r.pilot_name,r.crop,r.chemical];
    if(!hay.some(v=>String(v||"").toLowerCase().includes(q))) return false; }
  return true;
}

async function view(){
  const m=$("main"); const canX=window.OPS.canExport();
  const defs=fieldDefs(mode); const f=fltr[mode];
  m.innerHTML=`<div class="eyebrow">Daily Spray Entry</div><h1>Entries</h1>
    <div class="callout">Raw row-level entries that roll up into the <b>Acre</b> &amp; <b>Farmer</b> dashboards. Correct or delete individual rows here — and download a filtered <b>Excel report</b> for the client (periodic or ad-hoc).</div>
    <div class="row wrap" style="margin:8px 0">
      <button class="btn sm ${mode==='farmer'?'green':''}" id="emFarmer">Farmer sprays</button>
      <button class="btn sm ${mode==='acre'?'green':''}" id="emAcre">Acre entries</button>
      <input id="eqSearch" placeholder="Quick search…" style="max-width:220px" value="${esc(window._eqFilter||'')}">
      <div class="spacer"></div>
    </div>
    <div class="card" style="padding:12px;margin-bottom:10px">
      <div class="row wrap" style="gap:10px;align-items:flex-end">
        <div class="field" style="margin:0"><label>Date from</label><input type="date" id="eqFrom" value="${esc(f.from)}"></div>
        <div class="field" style="margin:0"><label>Date to</label><input type="date" id="eqTo" value="${esc(f.to)}"></div>
        <div class="field" style="margin:0"><label>Filter field</label><select id="eqField"><option value="">— any field —</option>${defs.filter(d=>d.type!=="date").map(d=>`<option value="${d.k}" ${f.field===d.k?'selected':''}>${esc(d.label)}</option>`).join("")}</select></div>
        <div class="field" style="margin:0"><label>Field contains</label><input id="eqVal" value="${esc(f.val)}" placeholder="e.g. Rudrapur"></div>
        <button class="btn sm" id="eqApply">Apply</button>
        <button class="btn sm" id="eqClear">Clear</button>
        <div class="spacer"></div>
        <span class="muted" id="eqCount"></span>
        ${canX?`<button class="btn green sm" id="eqExcel">⬇ Download Excel</button>`:'<span class="muted" title="Needs export permission">🔒 export restricted</span>'}
      </div>
      <div class="small-note" style="margin-top:8px">Set a date range for a period report, or leave blank for the latest entries. Add a field filter for an ad-hoc slice. The Excel matches exactly what is listed below.</div>
    </div>
    <div id="eqList" class="muted">Loading…</div>`;
  $("emFarmer").addEventListener("click",()=>{ mode="farmer"; window._eqFilter=""; view(); });
  $("emAcre").addEventListener("click",()=>{ mode="acre"; window._eqFilter=""; view(); });
  $("eqSearch").addEventListener("input",e=>{ window._eqFilter=e.target.value.toLowerCase().trim(); renderList(); });
  $("eqApply").addEventListener("click",()=>{ const g=fltr[mode]; g.from=$("eqFrom").value; g.to=$("eqTo").value; g.field=$("eqField").value; g.val=$("eqVal").value.trim(); load(); });
  $("eqClear").addEventListener("click",()=>{ fltr[mode]={from:"",to:"",field:"",val:""}; window._eqFilter=""; view(); });
  if($("eqExcel")) $("eqExcel").addEventListener("click",exportExcel);
  if(!locations.length){ const { data }=await sb().from("spray_locations").select("id,name"); locations=data||[]; }
  load();
}

function load(){ return mode==="farmer" ? loadFarmer() : loadAcre(); }
function renderList(){
  const rows=(allRows||[]).filter(r=>passFilters(mode,r));
  if($("eqCount")) $("eqCount").textContent = rows.length+" row(s)"+(rows.length>250?" · showing first 250":"");
  if(mode==="farmer") renderFarmer(rows); else renderAcre(rows);
}
function renderFarmer(rows){
  $("eqList").innerHTML = rows.length?`<div style="overflow:auto"><table><thead><tr><th>Date</th><th>Pilot</th><th>Farmer</th><th>Contact</th><th>Village</th><th>Crop</th><th>Medicine</th><th class="num">Acre</th><th class="num">Amount</th><th>GPS</th></tr></thead>
    <tbody>${rows.slice(0,250).map(r=>`<tr class="clickable" data-id="${r.id}"><td>${fmtDate(r.spray_date)}</td><td>${esc(r.pilot_name||'')}</td><td>${esc(r.farmer_name||'')}</td><td>${esc(mask(r.contact_no))}</td><td>${esc(r.village||'')}</td><td>${esc(r.crop||'')}</td><td>${esc(r.chemical_company||'')}</td><td class="num">${num(r.acre)}</td><td class="num">${money(r.amount)}</td><td>${r.gps_image_present?'✓':'·'}</td></tr>`).join("")}</tbody></table></div>`
    :'<div class="card muted">No matching rows.</div>';
  $("eqList").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>farmerForm(allRows.find(x=>x.id===tr.getAttribute("data-id")))));
}
function renderAcre(rows){
  $("eqList").innerHTML = rows.length?`<div style="overflow:auto"><table><thead><tr><th>Date</th><th>Location</th><th>Pilot</th><th class="num">Acres</th><th class="num">Client ₹</th><th class="num">Farmer ₹</th><th class="num">Amount</th><th>Crop</th><th>Medicine</th></tr></thead>
    <tbody>${rows.slice(0,250).map(r=>`<tr class="clickable" data-id="${r.id}"><td>${fmtDate(r.entry_date)}</td><td>${esc(r.loc&&r.loc.name||'')}</td><td>${esc(r.pilot_name||'')}</td><td class="num">${num(r.acres)}</td><td class="num">${r.client_rate!=null?money(r.client_rate):'—'}</td><td class="num">${r.farmer_rate!=null?money(r.farmer_rate):'—'}</td><td class="num">${money(r.amount)}</td><td>${esc(r.crop||'')}</td><td>${esc(r.chemical||'')}</td></tr>`).join("")}</tbody></table></div>`
    :'<div class="card muted">No matching rows.</div>';
  $("eqList").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>acreForm(allRows.find(x=>x.id===tr.getAttribute("data-id")))));
}

/* ---------------- Excel report download (respects the filters + contact privacy) ---------------- */
function exportCell(m,r,def){
  let v=cellVal(m,r,def.k);
  if(def.type==="date") return v?fmtDate(v):"";
  if(def.type==="bool") return v?"Yes":"No";
  if(def.k==="contact_no") return window.OPS.canViewContacts()?(v||""):mask(v);
  if(def.type==="num") return (v==null||v==="")?"":num(v);
  return v==null?"":v;
}
function exportExcel(){
  if(!window.OPS.canExport()){ alert("You don't have permission to export reports."); return; }
  const defs=fieldDefs(mode);
  const rows=(allRows||[]).filter(r=>passFilters(mode,r));
  if(!rows.length){ alert("No rows match the current filters — nothing to export."); return; }
  const headers=defs.map(d=>d.label);
  const data=rows.map(r=>defs.map(d=>exportCell(mode,r,d)));
  const f=fltr[mode];
  const tag=(f.from||f.to)?("_"+(f.from||"start")+"_to_"+(f.to||todayISO())):"";
  const base=(mode==="farmer"?"Farmer_Sprays":"Acre_Entries")+tag+"_"+todayISO();
  window.OPS.xlsx.download(base+".xlsx", mode==="farmer"?"Farmer sprays":"Acre entries", headers, data);
  window.OPS.audit("exported", mode==="farmer"?"farmer_sprays":"acre_entries", "", rows.length+" rows"+tag);
}

/* ---------------- Farmer sprays ---------------- */
async function loadFarmer(){
  const f=fltr.farmer;
  let q=sb().from("farmer_sprays").select("*").order("spray_date",{ascending:false});
  if(f.from) q=q.gte("spray_date",f.from);
  if(f.to)   q=q.lte("spray_date",f.to);
  const { data, error }=await q.range(0,9999);
  if(error){ $("eqList").innerHTML='<div class="card">Error: '+esc(error.message)+'</div>'; return; }
  allRows=data||[]; renderList();
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
  const f=fltr.acre;
  let q=sb().from("acre_entries").select("*, loc:location_id(name)").order("entry_date",{ascending:false});
  if(f.from) q=q.gte("entry_date",f.from);
  if(f.to)   q=q.lte("entry_date",f.to);
  const { data, error }=await q.range(0,9999);
  if(error){ $("eqList").innerHTML='<div class="card">Error: '+esc(error.message)+'</div>'; return; }
  allRows=data||[]; renderList();
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
      <div class="field"><label>Medicine / Chemical</label><input id="a_chemical" value="${esc(r.chemical||'')}"></div>
    </div>
    <div class="row"><button class="btn green" id="eqSave">Save changes</button><button class="btn" id="eqCancel">Cancel</button>
      <div class="spacer"></div>${window.OPS.canDelete()?'<button class="btn sm" id="eqDel" style="color:#a3322a;border-color:#e4b4b4">Delete</button>':''}</div>
    <div class="err" id="eqErr"></div></div>`;
  $("eqBack").addEventListener("click",view); $("eqCancel").addEventListener("click",view);
  $("eqSave").addEventListener("click",async()=>{
    const acres=num($("a_acres").value), cr=num($("a_client_rate").value), fr=num($("a_farmer_rate").value); const rate=cr+fr;
    const out={ entry_date:$("a_entry_date").value||null, location_id:$("a_location_id").value||null, pilot_name:$("a_pilot_name").value||null,
      acres:acres||0, client_rate:cr||null, farmer_rate:fr||null, rate:rate||null, amount:(acres*rate)||null, crop:$("a_crop").value||null, chemical:$("a_chemical").value||null };
    const { error }=await sb().from("acre_entries").update(out).eq("id",r.id);
    if(error){ $("eqErr").textContent=error.message; return; }
    window.OPS.audit("edited","acre_entries",r.id,out.pilot_name||""); window.OPS.flashTop("Saved ✓"); view();
  });
  if($("eqDel")) $("eqDel").addEventListener("click",async()=>{ if(!confirm("Delete this acre row?"))return; const { error }=await sb().from("acre_entries").delete().eq("id",r.id); if(error){ alert(error.message); return; } window.OPS.audit("deleted","acre_entries",r.id,""); view(); });
}

window.OPS.routes.entries = view;
})();
