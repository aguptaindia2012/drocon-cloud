/* ============================================================================
   DroCon Cloud — Acre Tracker (Phase 2)
   Locations (with rates) → per-pilot daily acres (acre_entries) → dashboard:
   monthly acre & revenue, location-wise totals, and the last-7-day trend by
   location. Mirrors the spreadsheet's location-tabs → summaries → dashboard flow,
   normalised into rows.
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
let tab="dashboard", locations=[];

async function loadLocations(){ const { data }=await sb().from("spray_locations").select("*").order("name"); locations=data||[]; }

async function view(){
  await loadLocations();
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Administration · Field Ops</div><h1>Acre Tracker</h1>
    <div class="row" style="margin:10px 0">
      <button class="btn sm ${tab==='dashboard'?'green':''}" data-t="dashboard">Dashboard</button>
      <button class="btn sm ${tab==='entry'?'green':''}" data-t="entry">Daily Entry</button>
      <button class="btn sm ${tab==='locations'?'green':''}" data-t="locations">Locations</button>
    </div>
    <div id="aBody" class="muted">Loading…</div>`;
  m.querySelectorAll("[data-t]").forEach(b=>b.addEventListener("click",()=>{ tab=b.getAttribute("data-t"); view(); }));
  if(tab==="dashboard") dashboard();
  else if(tab==="entry") entry();
  else locationsView();
}

/* ---------- locations ---------- */
function locationsView(){
  const host=$("aBody");
  host.innerHTML=`<div class="row" style="margin-bottom:8px"><div class="spacer"></div><button class="btn green sm" id="lNew">+ New location</button></div>
    ${locations.length?`<table><thead><tr><th>Location</th><th>District</th><th>State</th><th class="num">Default rate</th></tr></thead>
      <tbody>${locations.map(l=>`<tr class="clickable" data-id="${l.id}"><td><b>${esc(l.name)}</b></td><td>${esc(l.district||'')}</td><td>${esc(l.state||'')}</td><td class="num">${l.rates&&l.rates.default?money(l.rates.default):'—'}</td></tr>`).join("")}</tbody></table>`
      :'<div class="card muted">No locations yet. Add one to start logging acres.</div>'}`;
  $("lNew").addEventListener("click",()=>locForm(null));
  host.querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>locForm(locations.find(x=>x.id===tr.getAttribute("data-id")))));
}
function locForm(rec){
  const e=rec||{}; const host=$("aBody");
  host.innerHTML=`<div class="card"><h3>${rec?"Edit":"New"} location</h3>
    <div class="fgrid">
      <div class="field"><label>Location name *</label><input id="lName" value="${esc(e.name||'')}"></div>
      <div class="field"><label>District</label><input id="lDist" value="${esc(e.district||'')}"></div>
      <div class="field"><label>State</label><input id="lState" value="${esc(e.state||'')}"></div>
      <div class="field"><label>Default rate (₹/acre)</label><input id="lRate" type="number" step="any" value="${e.rates&&e.rates.default!=null?e.rates.default:''}"></div>
    </div>
    <div class="row"><button class="btn green" id="lSave">${rec?"Save":"Create"}</button><button class="btn" id="lCancel">Cancel</button>
      <div class="spacer"></div>${rec?'<button class="btn sm" id="lDel" style="color:#a3322a;border-color:#e4b4b4">Delete</button>':''}</div>
    <div class="err" id="lErr"></div></div>`;
  $("lCancel").addEventListener("click",locationsView);
  $("lSave").addEventListener("click",async()=>{
    const name=$("lName").value.trim(); if(!name){ $("lErr").textContent="Name required."; return; }
    const rates={ default: num($("lRate").value)||null };
    const out={ name, district:$("lDist").value||null, state:$("lState").value||null, rates };
    if(rec){ const { error }=await sb().from("spray_locations").update(out).eq("id",rec.id); if(error){ $("lErr").textContent=error.message; return; } }
    else { const { error }=await sb().from("spray_locations").insert(out); if(error){ $("lErr").textContent=error.message; return; } }
    await loadLocations(); locationsView();
  });
  if($("lDel")) $("lDel").addEventListener("click",async()=>{ if(!confirm("Delete location? (entries remain)"))return; await sb().from("spray_locations").delete().eq("id",rec.id); await loadLocations(); locationsView(); });
}

/* ---------- daily entry ---------- */
let erows=[];
function entry(){
  if(!locations.length){ $("aBody").innerHTML='<div class="callout warn">Add a <b>Location</b> first (Locations tab).</div>'; return; }
  erows=[{pilot:"",acres:"",rate:""},{pilot:"",acres:"",rate:""}];
  const host=$("aBody");
  host.innerHTML=`<div class="card">
    <div class="fgrid three">
      <div class="field"><label>Location</label><select id="eLoc">${locations.map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Date</label><input id="eDate" type="date" value="${todayISO()}"></div>
      <div class="field"><label>Crop (optional)</label><input id="eCrop"></div>
    </div>
    <h3>Per-pilot acres</h3>
    <table class="linetable" id="eRows"><thead><tr><th style="min-width:150px">Pilot</th><th class="num">Acres</th><th class="num">Rate (₹/acre)</th><th class="num">Amount</th><th></th></tr></thead><tbody></tbody></table>
    <button class="btn sm" id="eAdd">+ Add pilot</button>
    <div id="eSum" class="muted" style="margin-top:6px"></div>
    <div class="row" style="margin-top:12px"><button class="btn green" id="eSave">Save day</button><button class="btn" id="eCancel">Cancel</button></div>
    <div class="err" id="eErr"></div></div>
    <div id="eRecent" style="margin-top:14px"></div>`;
  $("eLoc").addEventListener("change",fillRate);
  $("eCancel").addEventListener("click",()=>{ tab="dashboard"; view(); });
  $("eAdd").addEventListener("click",()=>{ erows.push({pilot:"",acres:"",rate:""}); renderERows(); });
  $("eSave").addEventListener("click",saveDay);
  renderERows(); recentEntries();
}
function curLoc(){ return locations.find(l=>l.id===$("eLoc").value); }
function fillRate(){ const l=curLoc(); const dr=l&&l.rates&&l.rates.default; if(dr){ erows.forEach(r=>{ if(!r.rate) r.rate=dr; }); renderERows(); } }
function renderERows(){
  const tb=$("eRows").querySelector("tbody"); const l=curLoc(); const dr=(l&&l.rates&&l.rates.default)||"";
  tb.innerHTML=erows.map((r,i)=>{ const amt=num(r.acres)*(num(r.rate)||num(dr)); return `<tr>
    <td><input data-i="${i}" data-k="pilot" value="${esc(r.pilot)}"></td>
    <td><input data-i="${i}" data-k="acres" type="number" step="any" value="${esc(r.acres)}" style="text-align:right"></td>
    <td><input data-i="${i}" data-k="rate" type="number" step="any" value="${esc(r.rate)}" placeholder="${dr}" style="text-align:right"></td>
    <td class="num">${money(amt)}</td><td class="x" data-del="${i}">✕</td></tr>`; }).join("");
  tb.querySelectorAll("input").forEach(inp=>inp.addEventListener("input",()=>{ const i=+inp.getAttribute("data-i"),k=inp.getAttribute("data-k"); erows[i][k]=inp.value;
    const tr=inp.closest("tr"); const amt=num(erows[i].acres)*(num(erows[i].rate)||num(dr)); tr.children[3].textContent=money(amt); sumRow(); }));
  tb.querySelectorAll("[data-del]").forEach(x=>x.addEventListener("click",()=>{ erows.splice(+x.getAttribute("data-del"),1); if(!erows.length) erows.push({pilot:"",acres:"",rate:""}); renderERows(); }));
  sumRow();
}
function sumRow(){ const l=curLoc(); const dr=(l&&l.rates&&l.rates.default)||0;
  let a=0,amt=0; erows.forEach(r=>{ a+=num(r.acres); amt+=num(r.acres)*(num(r.rate)||dr); });
  $("eSum").innerHTML=`Day total: <b>${a.toFixed(2)} acres</b> · <b>${money(amt)}</b>`; }
async function saveDay(){
  const l=curLoc(); const dr=(l&&l.rates&&l.rates.default)||0; const date=$("eDate").value||todayISO(); const crop=$("eCrop").value||null;
  const recs=erows.filter(r=>num(r.acres)>0).map(r=>{ const rate=num(r.rate)||dr; const acres=num(r.acres);
    return { entry_date:date, location_id:l.id, pilot_name:r.pilot||null, acres, rate:rate||null, amount:acres*rate, crop, created_by:window.OPS.me.id }; });
  if(!recs.length){ $("eErr").textContent="Enter acres for at least one pilot."; return; }
  const { error }=await sb().from("acre_entries").insert(recs);
  if(error){ $("eErr").textContent=error.message; return; }
  window.OPS.flashTop("Saved "+recs.length+" pilot row(s) ✓"); entry();
}
async function recentEntries(){
  const { data }=await sb().from("acre_entries").select("*, loc:location_id(name)").order("entry_date",{ascending:false}).limit(40);
  const rows=data||[];
  $("eRecent").innerHTML = rows.length ? `<h3>Recent entries</h3><table><thead><tr><th>Date</th><th>Location</th><th>Pilot</th><th class="num">Acres</th><th class="num">Amount</th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td>${fmtDate(r.entry_date)}</td><td>${esc(r.loc&&r.loc.name||'')}</td><td>${esc(r.pilot_name||'')}</td><td class="num">${num(r.acres)}</td><td class="num">${money(r.amount)}</td></tr>`).join("")}</tbody></table>` : "";
}

/* ---------- dashboard ---------- */
async function dashboard(){
  const host=$("aBody");
  const { data }=await sb().from("acre_entries").select("entry_date,acres,amount, loc:location_id(name,state)").limit(20000);
  const rows=data||[];
  if(!rows.length){ host.innerHTML='<div class="card muted">No acre data yet. Use <b>Daily Entry</b> to start, or import history.</div>'; return; }
  const totA=rows.reduce((s,r)=>s+num(r.acres),0), totR=rows.reduce((s,r)=>s+num(r.amount),0);
  const ym=d=>String(d).slice(0,7);
  const thisYM=ym(todayISO());
  const monthA=rows.filter(r=>ym(r.entry_date)===thisYM).reduce((s,r)=>s+num(r.acres),0);
  const monthR=rows.filter(r=>ym(r.entry_date)===thisYM).reduce((s,r)=>s+num(r.amount),0);

  // monthly
  const byM={}; rows.forEach(r=>{ const k=ym(r.entry_date); byM[k]=byM[k]||{a:0,r:0}; byM[k].a+=num(r.acres); byM[k].r+=num(r.amount); });
  const months=Object.keys(byM).sort().reverse().slice(0,12);
  // location-wise
  const byL={}; rows.forEach(r=>{ const k=(r.loc&&r.loc.name)||"(none)"; byL[k]=byL[k]||{a:0,r:0}; byL[k].a+=num(r.acres); byL[k].r+=num(r.amount); });
  const locs=Object.entries(byL).map(([k,o])=>({k,...o})).sort((a,b)=>b.r-a.r);
  // last 7 days by location
  const since=new Date(Date.now()-7*86400000).toISOString().slice(0,10);
  const last7=rows.filter(r=>r.entry_date>=since);
  const byDayLoc={}; const days=new Set();
  last7.forEach(r=>{ const d=r.entry_date; days.add(d); const k=(r.loc&&r.loc.name)||"(none)"; byDayLoc[k]=byDayLoc[k]||{}; byDayLoc[k][d]=(byDayLoc[k][d]||0)+num(r.acres); });
  const dayList=[...days].sort();

  host.innerHTML=`
    <div class="statrow">
      <div class="stat"><div class="n">${totA.toFixed(0)}</div><div class="l">Total acres</div></div>
      <div class="stat"><div class="n">${money(totR)}</div><div class="l">Total revenue</div></div>
      <div class="stat"><div class="n">${monthA.toFixed(0)}</div><div class="l">Acres this month</div></div>
      <div class="stat"><div class="n">${money(monthR)}</div><div class="l">Revenue this month</div></div>
    </div>
    <div class="card"><h3>Monthly work</h3><table><thead><tr><th>Month</th><th class="num">Acres</th><th class="num">Revenue</th></tr></thead>
      <tbody>${months.map(k=>`<tr><td>${k}</td><td class="num">${byM[k].a.toFixed(1)}</td><td class="num">${money(byM[k].r)}</td></tr>`).join("")}</tbody></table></div>
    <div class="card"><h3>Location-wise totals</h3><table><thead><tr><th>Location</th><th class="num">Acres</th><th class="num">Revenue</th></tr></thead>
      <tbody>${locs.map(l=>`<tr><td><b>${esc(l.k)}</b></td><td class="num">${l.a.toFixed(1)}</td><td class="num">${money(l.r)}</td></tr>`).join("")}</tbody></table>
      <p class="muted">Invoiced & balance are tracked globally in <b>Invoices &amp; Receivables</b>.</p></div>
    <div class="card"><h3>Last 7 days — acres by location</h3>
      ${dayList.length?`<div style="overflow:auto"><table><thead><tr><th>Location</th>${dayList.map(d=>`<th class="num">${d.slice(5)}</th>`).join("")}<th class="num">Total</th></tr></thead>
      <tbody>${Object.keys(byDayLoc).map(k=>{ const tot=dayList.reduce((s,d)=>s+(byDayLoc[k][d]||0),0); return `<tr><td><b>${esc(k)}</b></td>${dayList.map(d=>`<td class="num">${byDayLoc[k][d]?byDayLoc[k][d].toFixed(1):'·'}</td>`).join("")}<td class="num"><b>${tot.toFixed(1)}</b></td></tr>`; }).join("")}</tbody></table></div>`
        :'<div class="muted">No sprays in the last 7 days.</div>'}</div>`;
}

window.OPS.routes.acre = view;
})();
