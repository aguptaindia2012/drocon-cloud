/* ============================================================================
   DroCon Cloud — Daily Spray Entry (the primary daily form)
   One form, entered once, that writes BOTH a farmer_sprays row and an
   acre_entries row per spray (linked by source_id). Supports multiple pilots
   (per-row pilot), client pulled from the Client list, and split rates
   (client-paid + farmer-paid). The Farmer & Acre dashboards read their own data.
   ============================================================================ */
(function(){
const { $, esc, num, money, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const uuid = ()=> (crypto.randomUUID ? crypto.randomUUID() : (Date.now()+"-"+Math.random().toString(16).slice(2)));

let drows=[], clients=[];
function blank(){ return { pilot:"", farmer:"", phone:"", village:"", crop:"", chemical:"", acres:"", crate:"", frate:"", gps:false }; }

async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Daily Spray Entry</div><h1>Daily Spray Entry</h1>
    <div class="callout">Entered once → saved to <b>both</b> Farmer &amp; Acre dashboards (kept separate for client reconciliation). Add a row per spray; different rows can have <b>different pilots</b>. Tick <b>GPS</b> where a GPS-tagged image was received.</div>
    <div class="card">
      <div class="fgrid three">
        <div class="field"><label>Date</label><input id="dDate" type="date" value="${todayISO()}"></div>
        <div class="field"><label>Client (from Client list)</label><select id="dClient"><option value="">— select client —</option></select></div>
        <div class="field"><label>Location (deployment area) *</label><input id="dLoc" placeholder="e.g. Rudrapur"></div>
      </div>
      <div class="fgrid three">
        <div class="field"><label>State</label>${window.OPS.geoUI.stateSelect("dState","")}</div>
        <div class="field"><label>District</label>${window.OPS.geoUI.districtSelect("dDistrict","","")}</div>
        <div class="field"></div>
      </div>
      <h3>Sprays</h3>
      <div style="overflow:auto"><table class="linetable" id="dRows"><thead><tr>
        <th style="min-width:120px">Pilot</th><th style="min-width:120px">Farmer</th><th>Contact</th><th>Village</th><th>Crop</th><th>Medicine</th>
        <th class="num">Acres</th><th class="num" title="Rate paid by client">Client ₹</th><th class="num" title="Rate paid by farmer">Farmer ₹</th><th class="num">Amount</th><th>GPS</th><th></th>
      </tr></thead><tbody></tbody></table></div>
      <button class="btn sm" id="dAdd">+ Add spray</button>
      <div id="dSum" class="muted" style="margin-top:6px"></div>
      <div class="row" style="margin-top:14px"><button class="btn green" id="dSave">Save day (Farmer + Acre)</button>
        <button class="btn" id="dClear">Clear</button></div>
      <div class="err" id="dErr"></div>
    </div>`;
  drows=[blank(),blank()];
  $("dClear").addEventListener("click",view);
  $("dAdd").addEventListener("click",()=>{ drows.push(blank()); renderRows(); });
  $("dSave").addEventListener("click",save);
  window.OPS.geoUI.wire("dState","dDistrict");
  renderRows();
  // pull client list (all invoices pull client details from here)
  sb().from("clients").select("id,firm_name,name,state,district").order("firm_name").then(({data})=>{
    clients=data||[];
    $("dClient").innerHTML='<option value="">— select client —</option>'+clients.map(c=>`<option value="${c.id}">${esc(c.firm_name||c.name)}</option>`).join("");
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
  if(!locName){ $("dErr").textContent="Location is required (it drives the Acre Tracker)."; return; }
  const valid=drows.filter(r=>num(r.acres)>0 || String(r.farmer).trim());
  if(!valid.length){ $("dErr").textContent="Add at least one spray (acres or farmer name)."; return; }

  let loc=null;
  const { data:existing }=await sb().from("spray_locations").select("*").ilike("name",locName);
  if(existing && existing.length) loc=existing[0];
  if(!loc){ const { data, error }=await sb().from("spray_locations").insert({ name:locName, state:state||null, district:district||null, rates:{} }).select().single();
    if(error){ $("dErr").textContent="Location: "+error.message; return; } loc=data; }

  const farmerRecs=[], acreRecs=[];
  valid.forEach(r=>{ const sid=uuid(); const acres=num(r.acres); const cr=num(r.crate), fr=num(r.frate); const rate=cr+fr; const amount=acres*rate||null;
    acreRecs.push({ entry_date:date, location_id:loc.id, pilot_name:r.pilot||null, acres:acres||0, rate:rate||null, client_rate:cr||null, farmer_rate:fr||null, amount, crop:r.crop||null, source_id:sid, created_by:window.OPS.me.id });
    farmerRecs.push({ spray_date:date, pilot_name:r.pilot||null, client_name:clientName||null, farmer_name:r.farmer||null, contact_no:r.phone||null,
      village:r.village||null, state:state||null, district:district||null, chemical_company:r.chemical||null, crop:r.crop||null,
      acre:acres||null, rate:rate||null, amount, gps_image_present:!!r.gps, source_id:sid, created_by:window.OPS.me.id });
  });
  const a=await sb().from("acre_entries").insert(acreRecs);
  if(a.error){ $("dErr").textContent="Acre save: "+a.error.message; return; }
  const f=await sb().from("farmer_sprays").insert(farmerRecs);
  if(f.error){ $("dErr").textContent="Farmer save: "+f.error.message+" (acre rows saved; you may lack Farmer access)"; return; }
  window.OPS.flashTop("Saved "+valid.length+" spray(s) to Farmer + Acre ✓");
  view();
}

window.OPS.routes.daily_entry = view;
})();
