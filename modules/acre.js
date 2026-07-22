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
    <div class="callout">This is the summary view. To <b>correct an entry</b>, use <b>Edit acre entries</b> — changes by non-approvers go to the Review queue and apply once approved.</div>
    <div class="row" style="margin:10px 0">
      <button class="btn green sm" id="aEdit">✎ Edit acre entries</button>
      <div class="spacer"></div>
      ${window.OPS.isAdmin()?'<button class="btn sm" id="aImport">⬆ Import acre history (CSV)</button>':''}
    </div>
    <div id="aBody" class="muted">Loading…</div>`;
  if($("aImport")) $("aImport").addEventListener("click",importCSV);
  if($("aEdit")) $("aEdit").addEventListener("click",()=>{ window.OPS.entriesMode="acre"; window.OPS.openTool("entries"); });
  dashboard();
}

/* ---------- dashboard ---------- */
async function dashboard(){
  const host=$("aBody");
  const { data }=await sb().from("acre_entries").select("entry_date,acres,amount,pilot_name, loc:location_id(name,state)").limit(20000);
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
  // last 7 days by location, broken down per pilot (to spot under-supplied days)
  const MIN_ACRES=15;    // green  — at/above the daily minimum
  const WARN_ACRES=13;   // yellow — 13 to under 15; below 13 is red
  // band for a pilot-day: >=15 green, 13-14 yellow, <=12 red
  const band=v=> v>=MIN_ACRES  ? {key:"green", label:"OK",     color:"#3e6b20", bg:"#e3f0d9"}
               : v>=WARN_ACRES ? {key:"yellow",label:"Yellow", color:"#9a5b00", bg:"#fff0db"}
                               : {key:"red",   label:"Red",    color:"#a3322a", bg:"#fbe0de"};
  const since=new Date(Date.now()-7*86400000).toISOString().slice(0,10);
  const last7=rows.filter(r=>r.entry_date>=since);
  const byLoc={}; const days=new Set();
  last7.forEach(r=>{ const d=r.entry_date; days.add(d);
    const k=(r.loc&&r.loc.name)||"(none)"; const p=r.pilot_name||"(unassigned)";
    byLoc[k]=byLoc[k]||{days:{},pilots:{}};
    byLoc[k].days[d]=(byLoc[k].days[d]||0)+num(r.acres);
    byLoc[k].pilots[p]=byLoc[k].pilots[p]||{};
    byLoc[k].pilots[p][d]=(byLoc[k].pilots[p][d]||0)+num(r.acres);
  });
  const dayList=[...days].sort();
  // every pilot-day that fell short of the minimum
  const below=[];
  Object.keys(byLoc).forEach(k=>Object.keys(byLoc[k].pilots).forEach(p=>{
    dayList.forEach(d=>{ const v=byLoc[k].pilots[p][d];
      if(v!=null && v<MIN_ACRES) below.push({loc:k,pilot:p,day:d,acres:v,band:band(v)}); }); }));
  const redCount=below.filter(x=>x.band.key==="red").length;

  host.innerHTML=`
    <div class="statrow">
      <div class="stat"><div class="n">${totA.toFixed(0)}</div><div class="l">Total acres</div></div>
      <div class="stat"><div class="n">${money(totR)}</div><div class="l">Total revenue</div></div>
      <div class="stat"><div class="n">${monthA.toFixed(0)}</div><div class="l">Acres this month</div></div>
      <div class="stat"><div class="n">${money(monthR)}</div><div class="l">Revenue this month</div></div>
      <div class="stat" style="${redCount?'background:#fbe0de':(below.length?'background:#fff0db':'')}"><div class="n" style="${redCount?'color:#a3322a':(below.length?'color:#9a5b00':'')}">${below.length}</div><div class="l">Below ${MIN_ACRES} ac (7d)${redCount?" · "+redCount+" red":""}</div></div>
    </div>
    <div id="acUnbilled"></div>
    <div class="row" id="acreReport" style="margin-bottom:10px"></div>
    <div class="card"><h3>Charts</h3><div class="fgrid">
      <div>${window.OPS.report.canvas("acMonthly",560,240)}</div>
      <div>${window.OPS.report.canvas("acLoc",560,240)}</div></div></div>
    <div class="card"><h3>Last 7 days — acres by location &amp; pilot</h3>
      <p class="muted" style="margin-top:-4px">Each location expands to its pilots. A pilot-day is
        <b style="color:#3e6b20;background:#e3f0d9;padding:1px 5px;border-radius:4px">green at ${MIN_ACRES}+ acres</b>,
        <b style="color:#9a5b00;background:#fff0db;padding:1px 5px;border-radius:4px">yellow at ${WARN_ACRES}–${MIN_ACRES-1}</b>,
        <b style="color:#a3322a;background:#fbe0de;padding:1px 5px;border-radius:4px">red at ${WARN_ACRES-1} or less</b> —
        anything not green is a day the client fell short of the daily minimum. A dot (·) means no entry that day.</p>
      ${dayList.length?`<div style="overflow:auto"><table><thead><tr><th>Location / Pilot</th>${dayList.map(d=>`<th class="num">${d.slice(5)}</th>`).join("")}<th class="num">Total</th></tr></thead>
      <tbody>${Object.keys(byLoc).sort().map(k=>{
        const L=byLoc[k]; const tot=dayList.reduce((s,d)=>s+(L.days[d]||0),0);
        const locRow=`<tr style="background:var(--grey)"><td><b>${esc(k)}</b></td>${dayList.map(d=>`<td class="num">${L.days[d]?L.days[d].toFixed(1):'·'}</td>`).join("")}<td class="num"><b>${tot.toFixed(1)}</b></td></tr>`;
        const pilotRows=Object.keys(L.pilots).sort().map(p=>{
          const P=L.pilots[p]; const pt=dayList.reduce((s,d)=>s+(P[d]||0),0);
          const cells=dayList.map(d=>{ const v=P[d];
            if(v==null) return '<td class="num muted">·</td>';
            const b=band(v);
            return `<td class="num" style="font-weight:700;color:${b.color};background:${b.bg}">${v.toFixed(1)}</td>`;
          }).join("");
          return `<tr><td style="padding-left:26px">${esc(p)}</td>${cells}<td class="num">${pt.toFixed(1)}</td></tr>`;
        }).join("");
        return locRow+pilotRows;
      }).join("")}</tbody></table></div>`
        :'<div class="muted">No sprays in the last 7 days.</div>'}</div>
    ${below.length?`<div class="card"><h3>⚠ Pilot-days below ${MIN_ACRES} acres (last 7 days)</h3>
      <p class="muted" style="margin-top:-4px">Use this when raising under-supply with the client.</p>
      <div style="overflow:auto"><table><thead><tr><th>Date</th><th>Location</th><th>Pilot</th><th class="num">Acres</th><th class="num">Short by</th><th>Band</th></tr></thead>
      <tbody>${below.sort((a,b)=>a.day<b.day?1:-1).map(x=>`<tr><td>${fmtDate(x.day)}</td><td>${esc(x.loc)}</td><td>${esc(x.pilot)}</td>
        <td class="num" style="color:${x.band.color};font-weight:700">${x.acres.toFixed(1)}</td><td class="num">${(MIN_ACRES-x.acres).toFixed(1)}</td>
        <td><span style="color:${x.band.color};background:${x.band.bg};font-weight:700;padding:1px 7px;border-radius:999px;font-size:11px">${x.band.label}</span></td></tr>`).join("")}</tbody></table></div></div>`:''}
    <div class="card"><h3>Monthly work</h3><table><thead><tr><th>Month</th><th class="num">Acres</th><th class="num">Revenue</th></tr></thead>
      <tbody>${months.map(k=>`<tr><td>${k}</td><td class="num">${byM[k].a.toFixed(1)}</td><td class="num">${money(byM[k].r)}</td></tr>`).join("")}</tbody></table></div>
    <div class="card"><h3>Location-wise totals</h3><table><thead><tr><th>Location</th><th class="num">Acres</th><th class="num">Revenue</th></tr></thead>
      <tbody>${locs.map(l=>`<tr><td><b>${esc(l.k)}</b></td><td class="num">${l.a.toFixed(1)}</td><td class="num">${money(l.r)}</td></tr>`).join("")}</tbody></table>
      <p class="muted">Invoiced & balance are tracked globally in <b>Invoices &amp; Receivables</b>.</p></div>`;
  const cm=months.slice().reverse();
  loadUnbilled();
  window.OPS.report.line("acMonthly", cm, cm.map(k=>byM[k].a), "Acres / month", "#599533");
  const topL=locs.slice(0,10);
  window.OPS.report.bar("acLoc", topL.map(l=>l.k), topL.map(l=>l.r), "Revenue by location", "#0A6496");
  window.OPS.report.wordButton("acreReport","Acre Tracker Report", ()=>([
    {heading:"Summary", table:{headers:["Metric","Value"], rows:[["Total acres",totA.toFixed(1)],["Total revenue",money(totR)],["Acres this month",monthA.toFixed(1)],["Revenue this month",money(monthR)]]}},
    {heading:"Monthly work", image:window.OPS.report.img("acMonthly"), table:{headers:["Month","Acres","Revenue"], rows:cm.map(k=>[k,byM[k].a.toFixed(1),money(byM[k].r)])}},
    {heading:"Location-wise totals", image:window.OPS.report.img("acLoc"), table:{headers:["Location","Acres","Revenue"], rows:locs.map(l=>[l.k,l.a.toFixed(1),money(l.r)])}},
    {heading:"Pilot-days below "+MIN_ACRES+" acres (last 7 days) — red ≤"+(WARN_ACRES-1)+", yellow "+WARN_ACRES+"–"+(MIN_ACRES-1),
     table:{headers:["Date","Location","Pilot","Acres","Short by","Band"],
            rows: below.length? below.sort((a,b)=>a.day<b.day?1:-1).map(x=>[fmtDate(x.day),x.loc,x.pilot,x.acres.toFixed(1),(MIN_ACRES-x.acres).toFixed(1),x.band.label])
                              : [["—","All pilots met the "+MIN_ACRES+"-acre minimum","","","",""]]}},
  ]));
}

/* ---------- anything missed from billing? ---------- */
async function loadUnbilled(){
  const host=$("acUnbilled"); if(!host) return;
  const { data, error }=await sb().from("v_acre_unbilled_summary").select("*");
  if(error || !data || !data.length){ host.innerHTML=""; return; }   // view missing or nothing pending
  const rows=data.filter(r=>num(r.farmer_rows)>0 || num(r.client_rows)>0);
  if(!rows.length){ host.innerHTML=""; return; }
  const fVal=rows.reduce((s,r)=>s+num(r.farmer_value),0), cVal=rows.reduce((s,r)=>s+num(r.client_value),0);
  const oldest=rows.map(r=>r.oldest_unbilled).filter(Boolean).sort()[0];
  host.innerHTML=`<div class="card" style="border-left:4px solid var(--orange)">
    <h3>⚠ Acre work not yet billed</h3>
    <p class="muted" style="margin-top:-4px">Sprayed acres with no invoice raised against them.
      Oldest outstanding: <b>${oldest?fmtDate(oldest):'—'}</b>. Raise these in <b>Finance → Acre Invoicing</b>.</p>
    <div style="overflow:auto"><table><thead><tr><th>Location</th><th>Farmer bill to</th><th class="num">Farmer acres</th><th class="num">Farmer value</th><th>Client bill to</th><th class="num">Client value</th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td><b>${esc(r.location_name||'')}</b></td>
      <td>${r.farmer_client_name?esc(r.farmer_client_name):'<span class="chip rejected">not set</span>'}</td>
      <td class="num">${num(r.farmer_acres).toFixed(1)}</td>
      <td class="num" style="color:#9a5b00;font-weight:700">${money(r.farmer_value)}</td>
      <td>${num(r.client_rows)>0?(r.client_client_name?esc(r.client_client_name):'<span class="chip rejected">not set</span>'):'<span class="muted">—</span>'}</td>
      <td class="num">${num(r.client_rows)>0?money(r.client_value):'<span class="muted">—</span>'}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="3" class="num"><b>Total unbilled</b></td><td class="num"><b>${money(fVal)}</b></td><td></td><td class="num"><b>${money(cVal)}</b></td></tr></tfoot></table></div></div>`;
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

