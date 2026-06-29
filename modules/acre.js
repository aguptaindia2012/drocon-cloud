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
let locations=[];

async function loadLocations(){ const { data }=await sb().from("spray_locations").select("*").order("name"); locations=data||[]; }

/* Acre Tracker is now a summary DASHBOARD only. Daily entry happens in
   Daily Spray Entry; locations live under Daily Spray Entry → Locations;
   raw editable rows live under Daily Spray Entry → Entries. */
async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Dashboards</div><h1>Acre Tracker</h1>
    <div class="row" style="margin:10px 0"><div class="spacer"></div>
      ${window.OPS.isAdmin()?'<button class="btn sm" id="aImport">⬆ Import acre history (CSV)</button>':''}
    </div>
    <div id="aBody" class="muted">Loading…</div>`;
  if($("aImport")) $("aImport").addEventListener("click",importCSV);
  dashboard();
}

/* ---------- dashboard ---------- */
async function dashboard(){
  const host=$("aBody");
  const { data }=await sb().from("acre_entries").select("entry_date,acres,amount, loc:location_id(name,state)").limit(20000);
  const rows=data||[];
  if(!rows.length){ host.innerHTML='<div class="card muted">No acre data yet. Use <b>Daily Spray Entry</b> to start, or import history.</div>'; return; }
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
    <div class="row" id="acreReport" style="margin-bottom:10px"></div>
    <div class="card"><h3>Charts</h3><div class="fgrid">
      <div>${window.OPS.report.canvas("acMonthly",560,240)}</div>
      <div>${window.OPS.report.canvas("acLoc",560,240)}</div></div></div>
    <div class="card"><h3>Last 7 days — acres by location</h3>
      ${dayList.length?`<div style="overflow:auto"><table><thead><tr><th>Location</th>${dayList.map(d=>`<th class="num">${d.slice(5)}</th>`).join("")}<th class="num">Total</th></tr></thead>
      <tbody>${Object.keys(byDayLoc).map(k=>{ const tot=dayList.reduce((s,d)=>s+(byDayLoc[k][d]||0),0); return `<tr><td><b>${esc(k)}</b></td>${dayList.map(d=>`<td class="num">${byDayLoc[k][d]?byDayLoc[k][d].toFixed(1):'·'}</td>`).join("")}<td class="num"><b>${tot.toFixed(1)}</b></td></tr>`; }).join("")}</tbody></table></div>`
        :'<div class="muted">No sprays in the last 7 days.</div>'}</div>
    <div class="card"><h3>Monthly work</h3><table><thead><tr><th>Month</th><th class="num">Acres</th><th class="num">Revenue</th></tr></thead>
      <tbody>${months.map(k=>`<tr><td>${k}</td><td class="num">${byM[k].a.toFixed(1)}</td><td class="num">${money(byM[k].r)}</td></tr>`).join("")}</tbody></table></div>
    <div class="card"><h3>Location-wise totals</h3><table><thead><tr><th>Location</th><th class="num">Acres</th><th class="num">Revenue</th></tr></thead>
      <tbody>${locs.map(l=>`<tr><td><b>${esc(l.k)}</b></td><td class="num">${l.a.toFixed(1)}</td><td class="num">${money(l.r)}</td></tr>`).join("")}</tbody></table>
      <p class="muted">Invoiced & balance are tracked globally in <b>Invoices &amp; Receivables</b>.</p></div>`;
  const cm=months.slice().reverse();
  window.OPS.report.line("acMonthly", cm, cm.map(k=>byM[k].a), "Acres / month", "#599533");
  const topL=locs.slice(0,10);
  window.OPS.report.bar("acLoc", topL.map(l=>l.k), topL.map(l=>l.r), "Revenue by location", "#0A6496");
  window.OPS.report.wordButton("acreReport","Acre Tracker Report", ()=>([
    {heading:"Summary", table:{headers:["Metric","Value"], rows:[["Total acres",totA.toFixed(1)],["Total revenue",money(totR)],["Acres this month",monthA.toFixed(1)],["Revenue this month",money(monthR)]]}},
    {heading:"Monthly work", image:window.OPS.report.img("acMonthly"), table:{headers:["Month","Acres","Revenue"], rows:cm.map(k=>[k,byM[k].a.toFixed(1),money(byM[k].r)])}},
    {heading:"Location-wise totals", image:window.OPS.report.img("acLoc"), table:{headers:["Location","Acres","Revenue"], rows:locs.map(l=>[l.k,l.a.toFixed(1),money(l.r)])}},
  ]));
}

/* ---------- CSV import (Date,Location,Pilot,Acres,Rate[,State,District,Crop]) ---------- */
function importCSV(){
  window.OPS.csv.pickCSV(async rows=>{
    if(!rows.length){ alert("No rows found."); return; }
    const low=r=>{ const o={}; Object.keys(r).forEach(h=>o[h.toLowerCase().trim()]=r[h]); return o; };
    const recs=rows.map(low);
    await loadLocations();
    const byName={}; locations.forEach(l=>byName[(l.name||"").toLowerCase().trim()]=l);
    // create any missing locations (carry first-seen rate/state/district)
    const need={};
    recs.forEach(r=>{ const n=(r.location||"").trim(); if(!n) return; const k=n.toLowerCase();
      if(!byName[k] && !need[k]) need[k]={ name:n, state:r.state||null, district:r.district||null, rate:num(r.rate)||null }; });
    for(const k in need){ const t=need[k];
      const { data, error }=await sb().from("spray_locations").insert({ name:t.name, state:t.state, district:t.district, rates:{default:t.rate} }).select().single();
      if(!error && data) byName[k]=data; }
    // build entries
    const entries=[];
    recs.forEach(r=>{ const n=(r.location||"").trim(); if(!n) return; const loc=byName[n.toLowerCase()]; if(!loc) return;
      const acres=num(r.acres!=null?r.acres:r.acre); if(!(acres>0)) return;
      let d=(r.date||"").trim(); if(d && !/^\d{4}-\d{2}-\d{2}/.test(d)){ const dt=new Date(d); if(!isNaN(dt)) d=dt.toISOString().slice(0,10); }
      const rate=num(r.rate) || (loc.rates&&loc.rates.default) || 0;
      entries.push({ entry_date:d||null, location_id:loc.id, pilot_name:r.pilot||null, acres, rate:rate||null, amount:rate?acres*rate:null, crop:r.crop||null, created_by:window.OPS.me.id });
    });
    const valid=entries.filter(e=>e.entry_date);
    if(!valid.length){ alert("No valid rows (need Date, Location, Acres)."); return; }
    if(!confirm("Import "+valid.length+" acre entries across "+Object.keys(byName).length+" locations?")) return;
    for(let i=0;i<valid.length;i+=500){ const { error }=await sb().from("acre_entries").insert(valid.slice(i,i+500)); if(error){ alert("Import failed: "+error.message); return; } }
    window.OPS.flashTop("Imported "+valid.length+" acre entries ✓"); await loadLocations(); tab="dashboard"; view();
  });
}

window.OPS.routes.acre = view;
})();

