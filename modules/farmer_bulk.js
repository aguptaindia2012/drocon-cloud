/* ============================================================================
   DroCon Cloud — Farmer Bulk Entry (temporary catch-up form)
   For re-entering the historic farmer records that were cleared. Writes straight
   to farmer_sprays and is HARD-CAPPED at 31 May 2026 — anything from 1 June
   onward must go through the normal Daily Spray Entry so it reaches the Acre
   dashboards and billing too.
   ============================================================================ */
(function(){
const { $, esc, num, money, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const CUTOFF = "2026-05-31";           // no entries dated after this
let rows=[];
function blank(){ return { farmer:"", phone:"", village:"", crop:"", chemical:"", acre:"", rate:"", gps:false }; }

function view(){
  rows = rows.length ? rows : [blank(),blank(),blank(),blank(),blank()];
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Daily Spray Entry</div><h1>Farmer Bulk Entry</h1>
    <div class="callout warn"><b>Temporary catch-up form</b> for re-entering historic farmer records.
      Only dates <b>up to ${CUTOFF}</b> are accepted — anything from 1 June 2026 onward must be entered through
      <b>Daily Spray Entry</b> so it also reaches the Acre dashboards and billing.
      These rows go straight into Farmer Tracking and are <b>not</b> part of the acre/approval flow.</div>
    <div class="card">
      <div class="fgrid three">
        <div class="field"><label>Spray date * <span class="muted">(on or before ${CUTOFF})</span></label>
          <input type="date" id="fbDate" max="${CUTOFF}"></div>
        <div class="field"><label>Pilot</label><input id="fbPilot" placeholder="pilot name as recorded"></div>
        <div class="field"><label>Client</label><input id="fbClient" placeholder="client / mill name"></div>
      </div>
      <div class="fgrid three">
        <div class="field"><label>State</label>${window.OPS.geoUI.stateSelect("fbState","")}</div>
        <div class="field"><label>District</label>${window.OPS.geoUI.districtSelect("fbDist","","")}</div>
        <div class="field"><label>Default village <span class="muted">(applied to blank rows)</span></label><input id="fbVillage"></div>
      </div>
      <h3>Farmer rows</h3>
      <div style="overflow:auto"><table class="linetable" id="fbRows"><thead><tr>
        <th style="min-width:140px">Farmer</th><th>Contact</th><th>Village</th><th>Crop</th><th>Medicine</th>
        <th class="num">Acre</th><th class="num">Rate ₹</th><th class="num">Amount</th><th>GPS</th><th></th>
      </tr></thead><tbody></tbody></table></div>
      <div class="row wrap" style="margin-top:8px">
        <button class="btn sm" id="fbAdd">+ Add row</button>
        <button class="btn sm" id="fbAdd10">+ 10 rows</button>
        <div class="spacer"></div><span class="muted" id="fbSum"></span>
      </div>
      <div class="row" style="margin-top:12px"><button class="btn green" id="fbSave">Save all rows</button>
        <button class="btn" id="fbClear">Clear form</button></div>
      <div class="err" id="fbErr"></div>
    </div>`;
  window.OPS.geoUI.wire("fbState","fbDist");
  $("fbAdd").addEventListener("click",()=>{ rows.push(blank()); renderRows(); });
  $("fbAdd10").addEventListener("click",()=>{ for(let i=0;i<10;i++) rows.push(blank()); renderRows(); });
  $("fbClear").addEventListener("click",()=>{ rows=[blank(),blank(),blank(),blank(),blank()]; view(); });
  $("fbSave").addEventListener("click",save);
  renderRows();
}

function renderRows(){
  const tb=$("fbRows").querySelector("tbody");
  tb.innerHTML=rows.map((r,i)=>`<tr>
    <td><input data-i="${i}" data-k="farmer" value="${esc(r.farmer)}"></td>
    <td><input data-i="${i}" data-k="phone" value="${esc(r.phone)}" style="width:110px"></td>
    <td><input data-i="${i}" data-k="village" value="${esc(r.village)}"></td>
    <td><input data-i="${i}" data-k="crop" value="${esc(r.crop)}" style="width:90px"></td>
    <td><input data-i="${i}" data-k="chemical" value="${esc(r.chemical)}" style="width:110px"></td>
    <td><input data-i="${i}" data-k="acre" type="number" step="any" value="${esc(r.acre)}" style="width:70px;text-align:right"></td>
    <td><input data-i="${i}" data-k="rate" type="number" step="any" value="${esc(r.rate)}" style="width:70px;text-align:right"></td>
    <td class="num">${money(num(r.acre)*num(r.rate))}</td>
    <td style="text-align:center"><input data-i="${i}" data-k="gps" type="checkbox" style="width:auto" ${r.gps?'checked':''}></td>
    <td class="x" data-del="${i}">✕</td></tr>`).join("");
  tb.querySelectorAll("input").forEach(inp=>inp.addEventListener("input",()=>{
    const i=+inp.getAttribute("data-i"), k=inp.getAttribute("data-k");
    rows[i][k] = k==="gps" ? inp.checked : inp.value;
    if(k==="acre"||k==="rate"){ inp.closest("tr").children[7].textContent=money(num(rows[i].acre)*num(rows[i].rate)); }
    sum();
  }));
  tb.querySelectorAll("[data-del]").forEach(x=>x.addEventListener("click",()=>{
    rows.splice(+x.getAttribute("data-del"),1); if(!rows.length) rows.push(blank()); renderRows(); }));
  sum();
}
function sum(){
  const filled=rows.filter(r=>String(r.farmer).trim()||num(r.acre)>0);
  const a=filled.reduce((s,r)=>s+num(r.acre),0), amt=filled.reduce((s,r)=>s+num(r.acre)*num(r.rate),0);
  $("fbSum").innerHTML=`<b>${filled.length}</b> row(s) · <b>${a.toFixed(2)} acres</b> · <b>${money(amt)}</b>`;
}

async function save(){
  const err=$("fbErr"); err.textContent="";
  const date=$("fbDate").value;
  if(!date){ err.textContent="Enter the spray date."; return; }
  if(date > CUTOFF){ err.textContent="This form only accepts dates up to "+CUTOFF+". Use Daily Spray Entry for 1 June 2026 onward."; return; }
  const filled=rows.filter(r=>String(r.farmer).trim() || num(r.acre)>0);
  if(!filled.length){ err.textContent="Add at least one farmer row."; return; }
  const pilot=$("fbPilot").value.trim()||null, client=$("fbClient").value.trim()||null;
  const state=$("fbState").value||null, dist=$("fbDist").value||null, vill=$("fbVillage").value.trim();
  const out=filled.map(r=>({
    spray_date:date, pilot_name:pilot, client_name:client,
    farmer_name:String(r.farmer).trim()||null, contact_no:String(r.phone).trim()||null,
    village:(String(r.village).trim()||vill||null), state, district:dist,
    crop:String(r.crop).trim()||null, chemical_company:String(r.chemical).trim()||null,
    acre:num(r.acre)||null, rate:num(r.rate)||null,
    amount:(num(r.acre)*num(r.rate))||null,
    gps_image_present:!!r.gps, created_by:window.OPS.me.id
  }));
  $("fbSave").disabled=true;
  const { error }=await sb().from("farmer_sprays").insert(out);
  $("fbSave").disabled=false;
  if(error){ err.textContent=error.message; return; }
  window.OPS.audit("bulk_created","farmer_sprays",date,out.length+" rows");
  window.OPS.flashTop("Saved "+out.length+" farmer row(s) ✓");
  rows=[blank(),blank(),blank(),blank(),blank()]; view();
}

window.OPS.routes.farmer_bulk = view;
})();
