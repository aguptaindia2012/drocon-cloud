/* ============================================================================
   DroCon Cloud — Vendor Acreage & Billing Statement
   A period statement per VENDOR (the employer of the pilots), so the vendor can
   reconcile it against their own billing to DroCon before we invoice the client.
   Resolves acre rows -> pilot -> vendor, so it covers work entered since the
   Pilots master went live.
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
let vendors=[], rows=[], cur=null;
const F={ vendor:"", from:"", to:"" };

async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Daily Spray Entry</div><h1>Vendor Acreage Statement</h1>
    <div class="callout">A period statement for a <b>vendor</b> — every acre their pilots flew, by date, location and pilot.
      Share it so they can match it against their own billing to DroCon. Once they confirm the acreage,
      raise the client invoice in <b>Finance → Acre Invoicing</b>.</div>
    <div class="card" style="padding:12px">
      <div class="row wrap" style="gap:10px;align-items:flex-end">
        <div class="field" style="margin:0;min-width:240px"><label>Vendor</label>
          <select id="vrVendor"><option value="">— select vendor —</option></select></div>
        <div class="field" style="margin:0"><label>From</label><input type="date" id="vrFrom" value="${esc(F.from)}"></div>
        <div class="field" style="margin:0"><label>To</label><input type="date" id="vrTo" value="${esc(F.to)}"></div>
        <button class="btn green sm" id="vrGo">Build statement</button>
        <div class="spacer"></div>
        <button class="btn sm" id="vrNewVendor">+ New vendor</button>
      </div>
    </div>
    <div id="vrBody" class="muted">Choose a vendor and period, then click <b>Build statement</b>.</div>`;
  $("vrNewVendor").addEventListener("click",()=>window.OPS.openTool("vendors"));
  $("vrGo").addEventListener("click",()=>{ F.vendor=$("vrVendor").value; F.from=$("vrFrom").value; F.to=$("vrTo").value; load(); });
  const { data }=await sb().from("vendors").select("id,firm_name,name").order("firm_name");
  vendors=data||[];
  $("vrVendor").innerHTML='<option value="">— select vendor —</option>'+
    vendors.map(v=>`<option value="${v.id}" ${F.vendor===v.id?'selected':''}>${esc(v.firm_name||v.name)}</option>`).join("");
  if(!vendors.length) $("vrBody").innerHTML='<div class="card muted">No vendors yet — create one under <b>Finance → Vendors</b>.</div>';
}

async function load(){
  const host=$("vrBody");
  if(!F.vendor){ host.innerHTML='<div class="card muted">Select a vendor first.</div>'; return; }
  host.innerHTML="Building…";
  let q=sb().from("v_vendor_acreage").select("*").eq("vendor_id",F.vendor).order("entry_date");
  if(F.from) q=q.gte("entry_date",F.from);
  if(F.to)   q=q.lte("entry_date",F.to);
  const { data, error }=await q.range(0,9999);
  if(error){ host.innerHTML='<div class="card">Error: '+esc(error.message)+'</div>'; return; }
  rows=data||[];
  cur=vendors.find(v=>String(v.id)===String(F.vendor))||null;
  if(!rows.length){ host.innerHTML='<div class="card muted">No acreage for this vendor in that period.<br>'+
    '<span class="small-note">Only work entered with a <b>selected pilot</b> can be attributed to a vendor — older rows that carry a typed pilot name are not included.</span></div>'; return; }
  render();
}

function render(){
  const totA=rows.reduce((s,r)=>s+num(r.acres),0);
  // per pilot
  const byP={}; rows.forEach(r=>{ const k=r.pilot_name||"(none)";
    byP[k]=byP[k]||{acres:0,days:new Set()}; byP[k].acres+=num(r.acres); byP[k].days.add(r.entry_date); });
  // per location
  const byL={}; rows.forEach(r=>{ const k=r.location_name||"(none)";
    byL[k]=byL[k]||{acres:0}; byL[k].acres+=num(r.acres); });
  const unbilled=rows.filter(r=>!r.farmer_billed).length;

  $("vrBody").innerHTML=`
    <div class="callout" style="margin-bottom:10px">This statement shows <b>acres only</b> — for the vendor/partner to verify the acreage they flew. Billing rates are intentionally omitted.</div>
    <div class="statrow">
      <div class="stat"><div class="n">${totA.toFixed(1)}</div><div class="l">Total acres</div></div>
      <div class="stat"><div class="n">${Object.keys(byP).length}</div><div class="l">Pilots</div></div>
      <div class="stat"><div class="n">${Object.keys(byL).length}</div><div class="l">Locations</div></div>
    </div>
    <div class="row wrap" style="margin-bottom:10px">
      ${window.OPS.canExport()?'<button class="btn green sm" id="vrXls">⬇ Download Excel (share with vendor)</button>':'<span class="muted">🔒 export restricted</span>'}
      <div id="vrWord"></div>
      <div class="spacer"></div><span class="muted">${rows.length} row(s)</span>
    </div>
    <div class="card"><h3>Summary by pilot</h3>
      <table><thead><tr><th>Pilot</th><th class="num">Days</th><th class="num">Acres</th></tr></thead>
      <tbody>${Object.entries(byP).sort((a,b)=>b[1].acres-a[1].acres).map(([k,v])=>
        `<tr><td><b>${esc(k)}</b></td><td class="num">${v.days.size}</td><td class="num">${v.acres.toFixed(1)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="2" class="num"><b>Total</b></td><td class="num"><b>${totA.toFixed(1)}</b></td></tr></tfoot></table></div>
    <div class="card"><h3>Summary by location</h3>
      <table><thead><tr><th>Location</th><th class="num">Acres</th></tr></thead>
      <tbody>${Object.entries(byL).sort((a,b)=>b[1].acres-a[1].acres).map(([k,v])=>
        `<tr><td><b>${esc(k)}</b></td><td class="num">${v.acres.toFixed(1)}</td></tr>`).join("")}</tbody></table></div>
    <div class="card"><h3>Detail</h3>
      <div style="overflow:auto"><table><thead><tr><th>Date</th><th>Pilot</th><th>Location</th><th>Client</th><th class="num">Acres</th></tr></thead>
      <tbody>${rows.map(r=>`<tr><td>${fmtDate(r.entry_date)}</td><td>${esc(r.pilot_name||'')}</td>
        <td>${esc(r.location_name||'')}</td><td>${esc(r.client_name||'')}</td>
        <td class="num">${num(r.acres)}</td></tr>`).join("")}</tbody></table></div></div>`;

  if($("vrXls")) $("vrXls").addEventListener("click",exportExcel);
  window.OPS.report.wordButton("vrWord","Vendor Acreage Statement — "+((cur&&(cur.firm_name||cur.name))||""), ()=>([
    {heading:"Period", table:{headers:["From","To","Total acres","Pilots","Locations"],
      rows:[[F.from||"—",F.to||todayISO(),totA.toFixed(1),Object.keys(byP).length,Object.keys(byL).length]]}},
    {heading:"By pilot", table:{headers:["Pilot","Days","Acres"],
      rows:Object.entries(byP).sort((a,b)=>b[1].acres-a[1].acres).map(([k,v])=>[k,v.days.size,v.acres.toFixed(1)])}},
    {heading:"By location", table:{headers:["Location","Acres"],
      rows:Object.entries(byL).sort((a,b)=>b[1].acres-a[1].acres).map(([k,v])=>[k,v.acres.toFixed(1)])}},
    {heading:"Detail", table:{headers:["Date","Pilot","Location","Acres"],
      rows:rows.map(r=>[fmtDate(r.entry_date),r.pilot_name||"",r.location_name||"",num(r.acres)])}},
  ]));
}

function exportExcel(){
  if(!window.OPS.canExport()){ alert("You don't have permission to export."); return; }
  const headers=["Date","Pilot","Location","Client","Acres"];
  const data=rows.map(r=>[fmtDate(r.entry_date), r.pilot_name||"", r.location_name||"", r.client_name||"", num(r.acres)]);
  const name=((cur&&(cur.firm_name||cur.name))||"Vendor").replace(/[^\w\- ]+/g,"").replace(/\s+/g,"_");
  const base="Vendor_Acreage_"+name+"_"+(F.from||"start")+"_to_"+(F.to||todayISO());
  window.OPS.xlsx.download(base+".xlsx","Vendor acreage",headers,data);
  window.OPS.audit("exported","vendor_acreage",F.vendor,rows.length+" rows");
}

window.OPS.routes.vendor_report = view;
})();
