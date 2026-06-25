/* ============================================================================
   DroCon Cloud — Common Daily Spray Entry (Phase 5, item #9)
   One form, entered once, that writes BOTH a farmer_sprays row and an
   acre_entries row per spray (linked by a shared source_id). The Farmer Tracker
   and Acre Tracker keep showing their own data separately for reconciliation.
   ============================================================================ */
(function(){
const { $, esc, num, money, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const uuid = ()=> (crypto.randomUUID ? crypto.randomUUID() : (Date.now()+"-"+Math.random().toString(16).slice(2)));

let drows=[];
function blank(){ return { farmer:"", phone:"", village:"", crop:"", chemical:"", acres:"", rate:"", gps:false }; }

async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Trackers</div><h1>Daily Spray Entry</h1>
    <div class="callout">Enter each spray <b>once</b> — it is saved to <b>both</b> the Farmer Tracker and the Acre Tracker (kept separate for client reconciliation). Tick <b>GPS</b> where the pilot sent a GPS-tagged image.</div>
    <div class="card">
      <div class="fgrid three">
        <div class="field"><label>Date</label><input id="dDate" type="date" value="${todayISO()}"></div>
        <div class="field"><label>Pilot name</label><input id="dPilot"></div>
        <div class="field"><label>Client / Company</label><input id="dClient"></div>
      </div>
      <div class="fgrid three">
        <div class="field"><label>Location (deployment area) *</label><input id="dLoc" placeholder="e.g. Rudrapur"></div>
        <div class="field"><label>State</label>${window.OPS.geoUI.stateSelect("dState","")}</div>
        <div class="field"><label>District</label>${window.OPS.geoUI.districtSelect("dDistrict","","")}</div>
      </div>
      <div class="fgrid three">
        <div class="field"><label>Default rate (₹/acre)</label><input id="dRate" type="number" step="any" placeholder="optional"></div>
      </div>
      <h3>Sprays</h3>
      <div style="overflow:auto"><table class="linetable" id="dRows"><thead><tr>
        <th style="min-width:130px">Farmer</th><th>Contact</th><th>Village</th><th>Crop</th><th>Medicine</th><th class="num">Acres</th><th class="num">Rate</th><th>GPS</th><th></th>
      </tr></thead><tbody></tbody></table></div>
      <button class="btn sm" id="dAdd">+ Add spray</button>
      <div id="dSum" class="muted" style="margin-top:6px"></div>
      <div class="row" style="margin-top:14px"><button class="btn green" id="dSave">Save day (Farmer + Acre)</button>
        <button class="btn" id="dCancel">Clear</button></div>
      <div class="err" id="dErr"></div>
    </div>`;
  drows=[blank(),blank()];
  $("dCancel").addEventListener("click",view);
  $("dAdd").addEventListener("click",()=>{ drows.push(blank()); renderRows(); });
  $("dSave").addEventListener("click",save);
  window.OPS.geoUI.wire("dState","dDistrict");
  renderRows();
}
function renderRows(){
  const tb=$("dRows").querySelector("tbody"); const dr=num($("dRate")&&$("dRate").value);
  tb.innerHTML=drows.map((r,i)=>{ const amt=num(r.acres)*(num(r.rate)||dr); return `<tr>
    <td><input data-i="${i}" data-k="farmer" value="${esc(r.farmer)}"></td>
    <td><input data-i="${i}" data-k="phone" value="${esc(r.phone)}" style="width:110px"></td>
    <td><input data-i="${i}" data-k="village" value="${esc(r.village)}"></td>
    <td><input data-i="${i}" data-k="crop" value="${esc(r.crop)}" style="width:90px"></td>
    <td><input data-i="${i}" data-k="chemical" value="${esc(r.chemical)}" style="width:110px"></td>
    <td><input data-i="${i}" data-k="acres" type="number" step="any" value="${esc(r.acres)}" style="width:70px;text-align:right"></td>
    <td><input data-i="${i}" data-k="rate" type="number" step="any" value="${esc(r.rate)}" style="width:80px;text-align:right"></td>
    <td style="text-align:center"><input data-i="${i}" data-k="gps" type="checkbox" style="width:auto" ${r.gps?'checked':''}></td>
    <td class="x" data-del="${i}">✕</td></tr>`; }).join("");
  tb.querySelectorAll("input").forEach(inp=>inp.addEventListener("input",()=>{
    const i=+inp.getAttribute("data-i"), k=inp.getAttribute("data-k");
    drows[i][k]= k==="gps"?inp.checked:inp.value; sumRow(); }));
  tb.querySelectorAll("[data-del]").forEach(x=>x.addEventListener("click",()=>{ drows.splice(+x.getAttribute("data-del"),1); if(!drows.length) drows.push(blank()); renderRows(); }));
  sumRow();
}
function sumRow(){ const dr=num($("dRate").value); let a=0,amt=0; drows.forEach(r=>{ a+=num(r.acres); amt+=num(r.acres)*(num(r.rate)||dr); });
  $("dSum").innerHTML=`Day total: <b>${a.toFixed(2)} acres</b> · <b>${money(amt)}</b> across ${drows.filter(r=>num(r.acres)>0).length} spray(s)`; }

async function save(){
  const date=$("dDate").value||todayISO();
  const pilot=$("dPilot").value.trim(), client=$("dClient").value.trim();
  const locName=$("dLoc").value.trim(); const state=$("dState").value.trim(), district=$("dDistrict").value.trim();
  const defRate=num($("dRate").value);
  if(!locName){ $("dErr").textContent="Location is required (it drives the Acre Tracker)."; return; }
  const valid=drows.filter(r=>num(r.acres)>0 || String(r.farmer).trim());
  if(!valid.length){ $("dErr").textContent="Add at least one spray (acres or farmer name)."; return; }

  // find-or-create the spray location
  let loc=null;
  const { data:existing }=await sb().from("spray_locations").select("*").ilike("name",locName);
  if(existing && existing.length) loc=existing[0];
  if(!loc){ const { data, error }=await sb().from("spray_locations").insert({ name:locName, state:state||null, district:district||null, rates:{default:defRate||null} }).select().single();
    if(error){ $("dErr").textContent="Location: "+error.message; return; } loc=data; }

  const farmerRecs=[], acreRecs=[];
  valid.forEach(r=>{ const sid=uuid(); const acres=num(r.acres); const rate=num(r.rate)||defRate; const amount=acres*rate||null;
    acreRecs.push({ entry_date:date, location_id:loc.id, pilot_name:pilot||null, acres:acres||0, rate:rate||null, amount, crop:r.crop||null, source_id:sid, created_by:window.OPS.me.id });
    farmerRecs.push({ spray_date:date, pilot_name:pilot||null, client_name:client||null, farmer_name:r.farmer||null, contact_no:r.phone||null,
      village:r.village||null, state:state||null, district:district||null, chemical_company:r.chemical||null, crop:r.crop||null,
      acre:acres||null, rate:rate||null, amount, gps_image_present:!!r.gps, source_id:sid, created_by:window.OPS.me.id });
  });
  // write both; acre first (less gated), then farmer (gated by has_farmer_access)
  const a=await sb().from("acre_entries").insert(acreRecs);
  if(a.error){ $("dErr").textContent="Acre save: "+a.error.message; return; }
  const f=await sb().from("farmer_sprays").insert(farmerRecs);
  if(f.error){ $("dErr").textContent="Farmer save: "+f.error.message+" (acre rows saved; you may lack Farmer access)"; return; }
  window.OPS.flashTop("Saved "+valid.length+" spray(s) to Farmer + Acre ✓");
  view();
}

window.OPS.routes.daily_entry = view;
})();
