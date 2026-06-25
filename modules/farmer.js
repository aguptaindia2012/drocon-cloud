/* ============================================================================
   DroCon Cloud — Farmer Tracker (Phase 2)
   Intern enters daily WhatsApp spraying data: one Date + Pilot + Client, then
   multiple farmer-sprays, each with a GPS-tagged-image checkbox. Plus a recent
   list, search, CSV import for history, and a quick snapshot (top villages).
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;

async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Administration · Field Ops</div><h1>Farmer Tracker</h1>
    <div class="row wrap" style="margin:10px 0">
      <input id="fSearch" placeholder="Search farmer / village / pilot…" style="max-width:280px">
      <div class="spacer"></div>
      <button class="btn sm" id="fSnap">Snapshot</button>
      <button class="btn sm" id="fImport">⬆ Import CSV</button>
      <button class="btn green sm" id="fNew">+ New entry (multi-spray)</button>
    </div>
    <div id="fStats"></div>
    <div id="fList" class="muted">Loading…</div>`;
  $("fNew").addEventListener("click",()=>entry());
  $("fSnap").addEventListener("click",snapshot);
  $("fImport").addEventListener("click",importCSV);
  const { data }=await sb().from("farmer_sprays").select("*").order("spray_date",{ascending:false}).limit(500);
  const all=data||[];
  const totAcre=all.reduce((s,r)=>s+num(r.acre),0);
  const gps=all.filter(r=>r.gps_image_present).length;
  $("fStats").innerHTML=`<div class="statrow">
    <div class="stat"><div class="n">${all.length}</div><div class="l">Sprays logged</div></div>
    <div class="stat"><div class="n">${totAcre.toFixed(1)}</div><div class="l">Total acres</div></div>
    <div class="stat"><div class="n">${all.length?Math.round(gps*100/all.length):0}%</div><div class="l">GPS image present</div></div>
  </div>`;
  function render(rows){
    $("fList").innerHTML = rows.length ? `<div style="overflow:auto"><table><thead><tr><th>Date</th><th>Pilot</th><th>Farmer</th><th>Village</th><th>Crop</th><th class="num">Acre</th><th class="num">Amount</th><th>GPS</th></tr></thead>
      <tbody>${rows.map(r=>`<tr><td>${fmtDate(r.spray_date)}</td><td>${esc(r.pilot_name||'')}</td><td>${esc(r.farmer_name||'')}</td>
        <td>${esc(r.village||'')}</td><td>${esc(r.crop||'')}</td><td class="num">${num(r.acre)}</td><td class="num">${money(r.amount)}</td>
        <td>${r.gps_image_present?'<span class="chip approved">✓</span>':'<span class="chip rejected">✗</span>'}</td></tr>`).join("")}</tbody></table></div>`
      : '<div class="card muted">No sprays logged yet.</div>';
  }
  render(all.slice(0,200));
  $("fSearch").addEventListener("input",e=>{ const q=e.target.value.toLowerCase().trim();
    render((!q?all:all.filter(r=>[r.farmer_name,r.village,r.pilot_name,r.crop,r.city].some(v=>String(v||"").toLowerCase().includes(q)))).slice(0,200)); });
}

let rows=[];
function blankRow(){ return { farmer_name:"", contact_no:"", village:"", crop:"", chemical_company:"", acre:"", rate:"", gps:false }; }
function entry(){
  rows=[blankRow(),blankRow()];
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="eBack">← Back to Farmer Tracker</button>
    <div class="card" style="margin-top:12px">
      <h1>New spraying entry</h1>
      <div class="callout warn">Tick <b>GPS</b> for every spray where the pilot sent a GPS-tagged image.</div>
      <div class="fgrid three">
        <div class="field"><label>Date</label><input id="eDate" type="date" value="${todayISO()}"></div>
        <div class="field"><label>Pilot name</label><input id="ePilot" placeholder="applies to all rows"></div>
        <div class="field"><label>Client name</label><input id="eClient"></div>
      </div>
      <div class="fgrid three">
        <div class="field"><label>State</label><input id="eState"></div>
        <div class="field"><label>City</label><input id="eCity"></div>
        <div class="field"><label>Default rate (₹/acre)</label><input id="eRate" type="number" step="any" placeholder="optional"></div>
      </div>
      <h3>Sprays</h3>
      <div style="overflow:auto"><table class="linetable" id="eRows"><thead><tr>
        <th style="min-width:130px">Farmer</th><th>Contact</th><th>Village</th><th>Crop</th><th>Medicine</th><th class="num">Acre</th><th class="num">Rate</th><th>GPS</th><th></th>
      </tr></thead><tbody></tbody></table></div>
      <button class="btn sm" id="eAdd">+ Add spray</button>
      <div class="row" style="margin-top:14px"><button class="btn green" id="eSave">Save all sprays</button>
        <button class="btn" id="eCancel">Cancel</button></div>
      <div class="err" id="eErr"></div>
    </div>`;
  $("eBack").addEventListener("click",view); $("eCancel").addEventListener("click",view);
  $("eAdd").addEventListener("click",()=>{ rows.push(blankRow()); renderRows(); });
  $("eSave").addEventListener("click",save);
  renderRows();
}
function renderRows(){
  const tb=$("eRows").querySelector("tbody");
  tb.innerHTML=rows.map((r,i)=>`<tr>
    <td><input data-i="${i}" data-k="farmer_name" value="${esc(r.farmer_name)}"></td>
    <td><input data-i="${i}" data-k="contact_no" value="${esc(r.contact_no)}" style="width:110px"></td>
    <td><input data-i="${i}" data-k="village" value="${esc(r.village)}"></td>
    <td><input data-i="${i}" data-k="crop" value="${esc(r.crop)}" style="width:90px"></td>
    <td><input data-i="${i}" data-k="chemical_company" value="${esc(r.chemical_company)}" style="width:110px"></td>
    <td><input data-i="${i}" data-k="acre" type="number" step="any" value="${esc(r.acre)}" style="width:70px;text-align:right"></td>
    <td><input data-i="${i}" data-k="rate" type="number" step="any" value="${esc(r.rate)}" style="width:80px;text-align:right"></td>
    <td style="text-align:center"><input data-i="${i}" data-k="gps" type="checkbox" style="width:auto" ${r.gps?'checked':''}></td>
    <td class="x" data-del="${i}">✕</td></tr>`).join("");
  tb.querySelectorAll("input").forEach(inp=>inp.addEventListener("input",()=>{
    const i=+inp.getAttribute("data-i"), k=inp.getAttribute("data-k");
    rows[i][k]= k==="gps"?inp.checked : inp.value;
  }));
  tb.querySelectorAll("[data-del]").forEach(x=>x.addEventListener("click",()=>{ rows.splice(+x.getAttribute("data-del"),1); if(!rows.length) rows.push(blankRow()); renderRows(); }));
}
async function save(){
  const date=$("eDate").value||todayISO();
  const pilot=$("ePilot").value.trim(), client=$("eClient").value.trim();
  const state=$("eState").value.trim(), city=$("eCity").value.trim(), defRate=num($("eRate").value);
  const recs=rows.filter(r=>String(r.farmer_name).trim()||num(r.acre)>0).map(r=>{
    const rate=num(r.rate)||defRate; const acre=num(r.acre);
    return { spray_date:date, pilot_name:pilot||null, client_name:client||null, farmer_name:r.farmer_name||null,
      contact_no:r.contact_no||null, village:r.village||null, city:city||null, state:state||null,
      chemical_company:r.chemical_company||null, crop:r.crop||null, acre:acre||null, rate:rate||null,
      amount:(acre*rate)||null, gps_image_present:!!r.gps, created_by:window.OPS.me.id };
  });
  if(!recs.length){ $("eErr").textContent="Add at least one spray (farmer name or acres)."; return; }
  const { error }=await sb().from("farmer_sprays").insert(recs);
  if(error){ $("eErr").textContent=error.message; return; }
  window.OPS.flashTop("Saved "+recs.length+" spray(s) ✓"); view();
}

async function snapshot(){
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="sBack">← Back to Farmer Tracker</button>
    <h1 style="margin-top:12px">Farmer snapshot</h1><div id="sHost" class="muted">Loading…</div>`;
  $("sBack").addEventListener("click",view);
  const { data }=await sb().from("farmer_sprays").select("village,acre,spray_date");
  const all=data||[];
  const byV={};
  all.forEach(r=>{ const v=r.village||"(unknown)"; byV[v]=byV[v]||{tot:0,n:0}; byV[v].tot+=num(r.acre); byV[v].n++; });
  const list=Object.entries(byV).map(([v,o])=>({v,tot:o.tot,n:o.n,avg:o.tot/o.n})).sort((a,b)=>b.tot-a.tot).slice(0,15);
  $("sHost").innerHTML=`<div class="card"><h3>Top villages by acres sprayed</h3>
    <table><thead><tr><th>Village</th><th class="num">Sprays</th><th class="num">Total acres</th><th class="num">Avg acres/spray</th></tr></thead>
    <tbody>${list.map(x=>`<tr><td><b>${esc(x.v)}</b></td><td class="num">${x.n}</td><td class="num">${x.tot.toFixed(1)}</td><td class="num">${x.avg.toFixed(2)}</td></tr>`).join("")}</tbody></table></div>`;
}

function importCSV(){
  window.OPS.csv.pickCSV(async rows=>{
    if(!rows.length){ alert("No rows."); return; }
    const map={ "date":"spray_date","pilot name":"pilot_name","client name":"client_name","company name":"client_name",
      "farmer name":"farmer_name","contact no.":"contact_no","contact":"contact_no","village":"village","city":"city",
      "state":"state","chemical company":"chemical_company","crop":"crop","acre":"acre","rate":"rate","amount":"amount",
      "invoice number":"invoice_number","payment status":"payment_status" };
    const recs=rows.map(r=>{ const o={created_by:window.OPS.me.id, gps_image_present:false};
      Object.keys(r).forEach(h=>{ const k=map[h.toLowerCase().trim()]; if(!k) return; let v=r[h];
        if(["acre","rate","amount"].includes(k)) v=v===""?null:num(String(v).replace(/[₹,]/g,""));
        if(k==="spray_date" && v){ const d=new Date(v); if(!isNaN(d)) v=d.toISOString().slice(0,10); }
        o[k]=v===""?null:v; });
      return o;
    }).filter(o=>o.farmer_name||o.acre||o.village);
    if(!confirm("Import "+recs.length+" spray rows?")) return;
    const { error }=await sb().from("farmer_sprays").insert(recs);
    if(error){ alert("Import failed: "+error.message); return; }
    window.OPS.flashTop("Imported "+recs.length+" ✓"); view();
  });
}

window.OPS.routes.farmer = view;
})();
