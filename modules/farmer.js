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
  m.innerHTML=`<div class="eyebrow">Dashboards</div><h1>Farmer Tracker</h1>
    <div class="callout">Summary view. New sprays are logged in <b>Daily Spray Entry</b>; raw editable rows live under <b>Daily Spray Entry → Entries</b>.</div>
    <div class="row wrap" style="margin:10px 0">
      <input id="fSearch" placeholder="Search farmer / village / pilot…" style="max-width:280px">
      <div class="spacer"></div>
      <button class="btn sm" id="fSnap">Snapshot</button>
      ${window.OPS.isAdmin()?'<button class="btn sm" id="fImport">⬆ Import history (CSV)</button>':''}
    </div>
    <div id="fStats"></div>
    <div id="fList" class="muted">Loading…</div>`;
  $("fSnap").addEventListener("click",snapshot);
  if($("fImport")) $("fImport").addEventListener("click",importCSV);
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
  $("sHost").innerHTML=`<div class="row" id="fmReport" style="margin-bottom:10px"></div>
    <div class="card"><h3>Top villages by acres</h3>${window.OPS.report.canvas("fmVillages",560,260)}</div>
    <div class="card"><h3>Top villages by acres sprayed</h3>
    <table><thead><tr><th>Village</th><th class="num">Sprays</th><th class="num">Total acres</th><th class="num">Avg acres/spray</th></tr></thead>
    <tbody>${list.map(x=>`<tr><td><b>${esc(x.v)}</b></td><td class="num">${x.n}</td><td class="num">${x.tot.toFixed(1)}</td><td class="num">${x.avg.toFixed(2)}</td></tr>`).join("")}</tbody></table></div>`;
  const top=list.slice(0,10);
  window.OPS.report.bar("fmVillages", top.map(x=>x.v), top.map(x=>x.tot), "Total acres", "#599533");
  window.OPS.report.wordButton("fmReport","Farmer Snapshot Report", ()=>([
    {heading:"Top villages by acres", image:window.OPS.report.img("fmVillages"), table:{headers:["Village","Sprays","Total acres","Avg/spray"], rows:list.map(x=>[x.v,x.n,x.tot.toFixed(1),x.avg.toFixed(2)])}},
  ]));
}

function importCSV(){
  window.OPS.csv.pickCSV(async rows=>{
    if(!rows.length){ alert("No rows."); return; }
    const map={ "date":"spray_date","pilot name":"pilot_name","client name":"client_name","company name":"client_name",
      "farmer name":"farmer_name","contact no.":"contact_no","contact":"contact_no","village":"village","city":"city",
      "state":"state","district":"district","chemical company":"chemical_company","crop":"crop","acre":"acre","rate":"rate","amount":"amount",
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
