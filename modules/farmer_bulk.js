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
function blank(prev){ // carry the previous row's repeating values so typing stays fast
  const p=prev||{};
  return { pilot:p.pilot||"", client:p.client||"", state:p.state||"", district:p.district||"",
           farmer:"", phone:"", village:p.village||"", crop:p.crop||"", chemical:p.chemical||"",
           acre:"", rate:p.rate||"", gps:false };
}

// the most recent row that actually has repeating values, so "+ Add row" copies
// something useful even when the form still has seeded blank rows below it
function lastFilled(){
  for(let i=rows.length-1;i>=0;i--){ const r=rows[i]||{};
    if(String(r.pilot||"").trim() || String(r.client||"").trim() || String(r.state||"").trim()
       || String(r.village||"").trim() || String(r.rate||"").trim()) return r; }
  return null;
}
function view(){
  rows = rows.length ? rows : [blank(),blank(),blank(),blank(),blank()];
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Daily Spray Entry</div><h1>Farmer Bulk Entry</h1>
    <div class="callout warn"><b>Temporary catch-up form</b> for re-entering historic farmer records.
      Only dates <b>up to ${CUTOFF}</b> are accepted — anything from 1 June 2026 onward must be entered through
      <b>Daily Spray Entry</b> so it also reaches the Acre dashboards and billing.
      These rows go straight into Farmer Tracking and are <b>not</b> part of the acre/approval flow.</div>
    <div class="card">
      <div class="row wrap" style="gap:12px;align-items:flex-end">
        <div class="field" style="margin:0"><label>Spray date * <span class="muted">(on or before ${CUTOFF})</span></label>
          <input type="date" id="fbDate" max="${CUTOFF}"></div>
        <div class="small-note">Everything else is per row, so one date can cover many pilots, clients and villages.
          Adding a row copies the previous row's pilot / client / state / district / village / rate — just overwrite what changes.</div>
      </div>
      <h3 style="margin-top:14px">Entries</h3>
      <div style="overflow:auto"><table class="linetable" id="fbRows"><thead><tr>
        <th style="min-width:120px">Pilot</th><th style="min-width:120px">Client</th>
        <th style="min-width:130px">Farmer</th><th>Contact</th><th>Village</th>
        <th>State</th><th>District</th><th>Crop</th><th>Medicine</th>
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
    </div>
    <datalist id="fbStates"></datalist>`;
  // keep the standard state list available on the per-row State input
  try{
    const st=(window.OPS.geoUI && window.OPS.geoUI.states && window.OPS.geoUI.states()) || [];
    if($("fbStates")) $("fbStates").innerHTML = st.map(x=>'<option value="'+esc(x)+'">').join("");
  }catch(e){}
  $("fbAdd").addEventListener("click",()=>{ rows.push(blank(lastFilled())); renderRows(); });
  $("fbAdd10").addEventListener("click",()=>{ for(let i=0;i<10;i++) rows.push(blank(lastFilled())); renderRows(); });
  $("fbClear").addEventListener("click",()=>{ rows=[blank(),blank(),blank(),blank(),blank()]; view(); });
  $("fbSave").addEventListener("click",save);
  renderRows();
}

function renderRows(){
  const tb=$("fbRows").querySelector("tbody");
  tb.innerHTML=rows.map((r,i)=>`<tr>
    <td><input data-i="${i}" data-k="pilot" value="${esc(r.pilot)}" style="width:120px"></td>
    <td><input data-i="${i}" data-k="client" value="${esc(r.client)}" style="width:120px"></td>
    <td><input data-i="${i}" data-k="farmer" value="${esc(r.farmer)}" style="width:130px"></td>
    <td><input data-i="${i}" data-k="phone" value="${esc(r.phone)}" style="width:105px"></td>
    <td><input data-i="${i}" data-k="village" value="${esc(r.village)}" style="width:105px"></td>
    <td><input data-i="${i}" data-k="state" value="${esc(r.state)}" list="fbStates" style="width:110px"></td>
    <td><input data-i="${i}" data-k="district" value="${esc(r.district)}" style="width:110px"></td>
    <td><input data-i="${i}" data-k="crop" value="${esc(r.crop)}" style="width:85px"></td>
    <td><input data-i="${i}" data-k="chemical" value="${esc(r.chemical)}" style="width:105px"></td>
    <td><input data-i="${i}" data-k="acre" type="number" step="any" value="${esc(r.acre)}" style="width:66px;text-align:right"></td>
    <td><input data-i="${i}" data-k="rate" type="number" step="any" value="${esc(r.rate)}" style="width:66px;text-align:right"></td>
    <td class="num">${money(num(r.acre)*num(r.rate))}</td>
    <td style="text-align:center"><input data-i="${i}" data-k="gps" type="checkbox" style="width:auto" ${r.gps?'checked':''}></td>
    <td class="x" data-del="${i}">✕</td></tr>`).join("");
  tb.querySelectorAll("input").forEach(inp=>inp.addEventListener("input",()=>{
    const i=+inp.getAttribute("data-i"), k=inp.getAttribute("data-k");
    rows[i][k] = k==="gps" ? inp.checked : inp.value;
    if(k==="acre"||k==="rate"){ inp.closest("tr").children[11].textContent=money(num(rows[i].acre)*num(rows[i].rate)); }
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
  const T=v=>String(v==null?"":v).trim()||null;
  const out=filled.map(r=>({
    spray_date:date, pilot_name:T(r.pilot), client_name:T(r.client),
    farmer_name:T(r.farmer), contact_no:T(r.phone),
    village:T(r.village), state:T(r.state), district:T(r.district),
    crop:T(r.crop), chemical_company:T(r.chemical),
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
