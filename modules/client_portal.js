/* ============================================================================
   DroCon Cloud — Client Portal (external client logins)
   - clientDashboard()  : live acre summary for the client's assigned locations
   - clientEntries()    : farmer-wise approved rows + Excel export + raise query
   - clientIssues()     : the client's raised queries + thread + close
   - clientIssueQueue() : DroCon (internal) resolution queue for client queries
   All data is read-only over APPROVED rows for assigned locations, via the
   security-definer RPCs in sql/92. Farmer phone is never exposed.
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const chip  = (s)=>({open:"warn",in_review:"issued",resolved:"ok",closed:"muted"}[s]||"warn");
const label = (s)=>({open:"Open",in_review:"With DroCon",resolved:"Resolved",closed:"Closed"}[s]||s);
const acresOf = (rows)=>rows.reduce((s,r)=>s+num(r.acres),0);
const amtOf   = (rows)=>rows.reduce((s,r)=>s+num(r.amount),0);
const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const ymLabel=(ym)=>{ if(!ym||ym==='?') return '?'; const p=String(ym).split('-'); return (MONTHS[(+p[1])-1]||p[1])+" "+p[0]; };

async function feed(from,to){
  const { data, error } = await sb().rpc("client_spray_rows",{ p_from:from||null, p_to:to||null, p_client:null });
  if(error) throw error; return data||[];
}

/* ---- expandable drill-down (ported from the internal Acre Tracker) ---------- */
function sortChildKeys(c, mode){ const ks=Object.keys(c);
  if(mode==="keyDesc") return ks.sort().reverse();
  if(mode==="acres")   return ks.sort((x,y)=>c[y].a-c[x].a);
  return ks.sort((x,y)=>(c[y].f+c[y].c)-(c[x].f+c[x].c)); // 'rev' → by total value
}
function drillTable(rows, defs, prefix, header){
  const root={a:0,f:0,c:0,ch:{}};
  (rows||[]).forEach(row=>{ const a=num(row.acres), fa=num(row.farmer), cl=num(row.client); let node=root; node.a+=a; node.f+=fa; node.c+=cl;
    defs.forEach(d=>{ const k=d.get(row)||"—"; node.ch[k]=node.ch[k]||{a:0,f:0,c:0,ch:{}}; node=node.ch[k]; node.a+=a; node.f+=fa; node.c+=cl; }); });
  if(!Object.keys(root.ch).length) return '<div class="muted">No data.</div>';
  const out=[]; const idRef={n:0};
  (function walk(node, depth, parentId){
    sortChildKeys(node.ch, defs[depth].sort).forEach(k=>{ const child=node.ch[k]; const id=prefix+(idRef.n++);
      const leaf=depth===defs.length-1; const d=defs[depth];
      const lbl=d.label?d.label(k):k; const txt=d.bold?`<b>${esc(lbl)}</b>`:esc(lbl);
      const caret=leaf?'':'<span class="dcar" style="display:inline-block;width:12px;color:var(--muted)">▸</span> ';
      const b=(v)=>d.bold?'<b>'+money(v)+'</b>':money(v);
      out.push(`<tr class="drow ${leaf?'dleaf':'dgrp'}" data-id="${id}" data-parent="${parentId||''}" style="display:${depth===0?'':'none'};${leaf?'':'cursor:pointer'};${depth===1?'background:#f7f8f6':''}">`
        +`<td style="padding-left:${4+depth*24}px"${leaf?' class="muted"':''}>${caret}${leaf?esc(lbl):txt}</td>`
        +`<td class="num">${child.a.toFixed(1)}</td><td class="num">${b(child.f)}</td><td class="num">${b(child.c)}</td><td class="num">${b(child.f+child.c)}</td></tr>`);
      if(!leaf) walk(child, depth+1, id);
    });
  })(root,0,"");
  return `<div style="overflow:auto"><table class="tt-skip"><thead><tr><th>${esc(header)}</th><th class="num">Acres</th><th class="num">Farmer</th><th class="num">Client</th><th class="num">Total</th></tr></thead><tbody>${out.join("")}</tbody></table></div>`;
}
function wireDrills(host){
  if(!host) return;
  const hideDesc=(id)=>{ host.querySelectorAll('.drow[data-parent="'+id+'"]').forEach(r=>{ r.style.display="none"; const c=r.querySelector(".dcar"); if(c)c.textContent="▸"; hideDesc(r.getAttribute("data-id")); }); };
  host.querySelectorAll(".dgrp").forEach(tr=>tr.addEventListener("click",()=>{
    const id=tr.getAttribute("data-id");
    const kids=host.querySelectorAll('.drow[data-parent="'+id+'"]');
    const show = kids.length && kids[0].style.display==="none";
    if(show) kids.forEach(k=>k.style.display=""); else hideDesc(id);
    const car=tr.querySelector(".dcar"); if(car) car.textContent=show?"▾":"▸";
  }));
}

/* ------------------------------------------------------------- DASHBOARD --- */
async function clientDashboard(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Client Portal</div><h1>Acre Dashboard</h1>
    <div class="callout">Live view of the acres sprayed for your locations. Figures update as DroCon Bharat approves each day's work.</div>
    <div id="cdBody" class="muted">Loading…</div>`;
  let rows, locs, acts, shorts, summ;
  try{ [rows, locs, acts, shorts, summ] = await Promise.all([
    feed(),
    sb().rpc("my_client_locations").then(r=>r.data||[]),
    sb().rpc("client_active_assignments").then(r=>r.data||[]),
    sb().rpc("short_days",{p_scope:"client",p_from:null,p_to:null}).then(r=>r.data||[]),
    sb().rpc("client_location_summary",{p_client:null}).then(r=>r.data||[])
  ]); }
  catch(e){ $("cdBody").innerHTML=`<div class="err">${esc(e.message)}</div>`; return; }
  if(!locs.length){ $("cdBody").innerHTML='<div class="card muted">No locations have been assigned to your account yet. Please contact DroCon Bharat.</div>'; return; }
  // reason lookup for hover tooltips: location_id | pilot | date -> reason
  const reasonMap={}; (shorts||[]).forEach(s=>{ if(s.reason) reasonMap[`${s.location_id}|${s.pilot_name}|${s.entry_date}`]=s.reason; });
  const farmers=new Set(rows.map(r=>(r.farmer_name||"").trim().toLowerCase()).filter(Boolean)).size;
  // ---- this week (last 7 days): acres by location & pilot ----
  // Fixed 7-day axis so zero days show as dots.
  const dayList=[]; for(let i=6;i>=0;i--){ dayList.push(new Date(Date.now()-i*86400000).toISOString().slice(0,10)); }
  const inWeek=new Set(dayList);
  const wLoc={}, dayTot={};   // wLoc keyed by location_id -> {name, days, pilots}
  // seed every ASSIGNED location so it shows even with no sprays this week
  locs.forEach(l=>{ wLoc[l.id]={name:l.name, days:{}, pilots:{}}; });
  // seed ACTIVE pilots at each location so they show even with zero
  (acts||[]).forEach(a=>{ const w=wLoc[a.location_id]||(wLoc[a.location_id]={name:a.location_name,days:{},pilots:{}}); const p=(a.pilot_name||"").trim()||"(unassigned)"; w.pilots[p]=w.pilots[p]||{}; });
  rows.filter(r=>inWeek.has(r.entry_date)).forEach(r=>{ const d=r.entry_date, lid=r.location_id, p=(r.pilot||"").trim()||"(unassigned)";
    dayTot[d]=(dayTot[d]||0)+num(r.acres);
    const w=wLoc[lid]||(wLoc[lid]={name:r.location_name||"(none)",days:{},pilots:{}});
    w.days[d]=(w.days[d]||0)+num(r.acres);
    w.pilots[p]=w.pilots[p]||{}; w.pilots[p][d]=(w.pilots[p][d]||0)+num(r.acres);
  });
  const grand=dayList.reduce((s,d)=>s+(dayTot[d]||0),0);
  const cell=(lid,p,d,v)=>{ const reason=reasonMap[`${lid}|${p}|${d}`]; const t=reason?` title="${esc(reason)}" style="cursor:help;text-decoration:underline dotted"`:''; return `<span${t}>${v!=null?v.toFixed(1):'·'}</span>`; };
  // ---- rows for the expandable report ----
  const drows=rows.map(r=>({location:r.location_name||"(none)", pilot:(r.pilot||"").trim()||"(unassigned)", entry_date:r.entry_date, acres:num(r.acres), farmer:num(r.farmer_amount), client:num(r.client_amount)}));
  const farmerTot=rows.reduce((s,r)=>s+num(r.farmer_amount),0), clientTot=rows.reduce((s,r)=>s+num(r.client_amount),0);
  $("cdBody").innerHTML=`
    <div class="statrow">
      <div class="stat"><div class="n">${acresOf(rows).toFixed(1)}</div><div class="l">Total acres</div></div>
      <div class="stat"><div class="n">${money(farmerTot)}</div><div class="l">Farmer value</div></div>
      <div class="stat"><div class="n">${money(clientTot)}</div><div class="l">Client value</div></div>
      <div class="stat"><div class="n">${money(farmerTot+clientTot)}</div><div class="l">Total value</div></div>
      <div class="stat"><div class="n">${locs.length}</div><div class="l">Locations</div></div>
      <div class="stat"><div class="n">${farmers}</div><div class="l">Farmers served</div></div>
    </div>
    <div class="card"><h3>This week — acres by location &amp; pilot</h3>
      <p class="muted" style="margin-top:-4px">Last 7 days, all your active locations &amp; pilots. A dot (·) = no spray that day. Underlined numbers have a short-day reason — hover to read it.</p>
      <div style="overflow:auto"><table class="tt-skip"><thead><tr><th>Location / Pilot</th>${dayList.map(d=>`<th class="num">${d.slice(5)}</th>`).join("")}<th class="num">Total</th></tr></thead>
      <tbody>
        <tr style="background:var(--charcoal);color:#fff"><td><b>ALL LOCATIONS — daily total</b></td>${dayList.map(d=>`<td class="num"><b>${dayTot[d]?dayTot[d].toFixed(1):'·'}</b></td>`).join("")}<td class="num"><b>${grand.toFixed(1)}</b></td></tr>
        ${Object.keys(wLoc).sort((a,b)=>(wLoc[a].name||"").localeCompare(wLoc[b].name||"")).map(lid=>{ const L=wLoc[lid]; const tot=dayList.reduce((s,d)=>s+(L.days[d]||0),0);
          const locRow=`<tr style="background:var(--grey)"><td><b>${esc(L.name)}</b></td>${dayList.map(d=>`<td class="num">${L.days[d]?L.days[d].toFixed(1):'·'}</td>`).join("")}<td class="num"><b>${tot.toFixed(1)}</b></td></tr>`;
          const pr=Object.keys(L.pilots).sort().map(p=>{ const P=L.pilots[p]; const pt=dayList.reduce((s,d)=>s+(P[d]||0),0);
            return `<tr><td style="padding-left:26px">${esc(p)}</td>${dayList.map(d=>`<td class="num${P[d]==null?' muted':''}">${cell(lid,p,d,P[d]!=null?P[d]:null)}</td>`).join("")}<td class="num">${pt.toFixed(1)}</td></tr>`; }).join("");
          return locRow+pr;
        }).join("")}</tbody></table></div></div>
    <div class="card"><h3>Location summary</h3>
      <p class="muted" style="margin-top:-4px">Per location: when spraying started, whether it's still active, days deployed (first spray → deactivation or today), total acres and the average acres per deployed day.</p>
      <div style="overflow:auto"><table><thead><tr><th>Location</th><th>Started</th><th>Status</th><th class="num">Days deployed</th><th class="num">Acres</th><th class="num">Avg/day</th></tr></thead>
      <tbody>${(summ||[]).map(s=>`<tr>
        <td>${esc(s.location_name||"")}</td>
        <td>${s.start_date?fmtDate(s.start_date):'<span class="muted">—</span>'}</td>
        <td>${s.active?'<span class="chip ok">Active</span>':(s.deactivated_on?('Deactivated '+fmtDate(s.deactivated_on)):'<span class="muted">Inactive</span>')}</td>
        <td class="num">${s.days_deployed!=null?s.days_deployed:'—'}</td>
        <td class="num">${num(s.acres).toFixed(1)}</td>
        <td class="num">${s.avg_daily!=null?num(s.avg_daily).toFixed(1):'—'}</td></tr>`).join("")||'<tr><td colspan="6" class="muted">No locations assigned.</td></tr>'}</tbody></table></div></div>
    <div class="card"><h3>Acre report</h3>
      <p class="muted" style="margin-top:-4px">Expand any row to drill down.</p>
      <p class="muted" style="margin-top:-8px;font-size:12px">Grouped by month — open the <b>Entries</b> tab for day-by-day detail.</p>
      <div class="row" style="gap:6px;margin-bottom:8px"><button class="btn sm" data-drill="month">By Month</button><button class="btn sm" data-drill="loc">By Location</button><button class="btn sm" data-drill="pilot">By Pilot</button></div>
      <div id="cdDrill"></div></div>`;
  const ym=r=>r.entry_date?r.entry_date.slice(0,7):'?';
  const dMonthB={get:ym,label:ymLabel,sort:"keyDesc",bold:true}, dMonth={get:ym,label:ymLabel,sort:"keyDesc"},
        dLoc={get:r=>r.location,sort:"rev",bold:true}, dLocN={get:r=>r.location,sort:"rev"},
        dPil={get:r=>r.pilot,sort:"acres"}, dPilB={get:r=>r.pilot,sort:"acres",bold:true};
  const VIEWS={ month:[[dMonthB,dLocN,dPil],"Month / Location / Pilot"], loc:[[dLoc,dMonth,dPil],"Location / Month / Pilot"], pilot:[[dPilB,dLocN,dMonth],"Pilot / Location / Month"] };
  function drill(kind){ const [defs,hdr]=VIEWS[kind]||VIEWS.month;
    $("cdDrill").innerHTML=drillTable(drows, defs, "d"+kind, hdr); wireDrills($("cdDrill"));
    document.querySelectorAll("[data-drill]").forEach(b=>b.style.fontWeight=(b.getAttribute("data-drill")===kind)?"700":"");
  }
  document.querySelectorAll("[data-drill]").forEach(b=>b.addEventListener("click",()=>drill(b.getAttribute("data-drill"))));
  drill("month");
}

/* --------------------------------------------------------------- ENTRIES --- */
async function clientEntries(){
  const m=$("main");
  let locs=[], canExport=false;
  try{ [locs, canExport] = await Promise.all([
    sb().rpc("my_client_locations").then(r=>r.data||[]),
    sb().rpc("my_client_can_export").then(r=>!!r.data)
  ]); }catch(e){}
  m.innerHTML=`<div class="eyebrow">Client Portal</div><h1>Entries</h1>
    <div class="card">
      <div class="row wrap" style="gap:8px;align-items:flex-end">
        <div class="field"><label>From</label><input id="ceFrom" type="date"></div>
        <div class="field"><label>To</label><input id="ceTo" type="date"></div>
        <div class="field"><label>Location</label><select id="ceLoc"><option value="">All assigned</option>${locs.map(l=>`<option value="${esc(l.name)}">${esc(l.name)}</option>`).join("")}</select></div>
        <div class="field" style="flex:1;min-width:160px"><label>Search farmer / village</label><input id="ceQ" placeholder="type to filter"></div>
        <button class="btn sm" id="ceGo">Apply</button>
        ${canExport?'<button class="btn sm green" id="ceXls">⬇ Excel</button>':'<span class="muted" style="font-size:12px">Downloads disabled — contact DroCon (NDA required)</span>'}
      </div>
    </div>
    <div id="ceList" class="muted">Loading…</div>`;
  let rows=[];
  async function run(){
    $("ceList").innerHTML='<div class="muted">Loading…</div>';
    try{ rows=await feed($("ceFrom").value||null, $("ceTo").value||null); }
    catch(e){ $("ceList").innerHTML=`<div class="err">${esc(e.message)}</div>`; return; }
    render();
  }
  function filtered(){
    const loc=$("ceLoc").value, q=($("ceQ").value||"").trim().toLowerCase();
    return rows.filter(r=>(!loc||r.location_name===loc) && (!q || (`${r.farmer_name||""} ${r.village||""}`).toLowerCase().includes(q)));
  }
  function render(){
    const fr=filtered();
    $("ceList").innerHTML=`<div class="card"><div class="row" style="margin-bottom:6px"><b>${fr.length} entr${fr.length===1?'y':'ies'}</b><span class="muted" style="margin-left:8px">${acresOf(fr).toFixed(1)} acres · ${money(amtOf(fr))}</span></div>
      <div style="overflow:auto"><table><thead><tr><th>Date</th><th>Location</th><th>Farmer</th><th>Phone</th><th>Village</th><th>Crop</th><th>Medicine</th><th>Pilot</th><th class="num">Acres</th><th>GPS</th><th class="num">Farmer rate</th><th class="num">Farmer amt</th><th class="num">Client rate</th><th class="num">Client amt</th><th class="num">Total</th><th></th></tr></thead>
      <tbody>${fr.map(r=>`<tr>
        <td>${fmtDate(r.entry_date)}</td><td>${esc(r.location_name||"")}</td><td>${esc(r.farmer_name||"")}</td><td>${esc(r.farmer_phone||"")}</td>
        <td>${esc(r.village||"")}</td><td>${esc(r.crop||"")}</td><td>${esc(r.medicine||"")}</td><td>${esc(r.pilot||"")}</td>
        <td class="num">${num(r.acres).toFixed(1)}</td>
        <td style="text-align:center">${r.gps?'<span title="GPS-tagged image received" style="color:#3e6b20">✓</span>':'<span title="No GPS image" class="muted">—</span>'}</td>
        <td class="num">${r.farmer_rate!=null?money(r.farmer_rate):''}</td><td class="num">${money(r.farmer_amount)}</td>
        <td class="num">${r.client_rate!=null?money(r.client_rate):''}</td><td class="num">${money(r.client_amount)}</td>
        <td class="num">${money(r.amount)}</td>
        <td>${r.open_issue?'<span class="chip warn">query</span>':`<button class="btn sm ghost" data-raise="${r.spray_id}">Raise query</button>`}</td></tr>`).join("")||'<tr><td colspan="16" class="muted">No approved entries for this filter.</td></tr>'}</tbody></table></div></div>`;
    $("ceList").querySelectorAll("[data-raise]").forEach(b=>b.addEventListener("click",()=>{
      const r=rows.find(x=>String(x.spray_id)===b.getAttribute("data-raise")); if(r) raiseModal(r, run);
    }));
  }
  $("ceGo").addEventListener("click",run);
  $("ceQ").addEventListener("input",()=>{ if(rows.length) render(); });
  $("ceLoc").addEventListener("change",()=>{ if(rows.length) render(); });
  if(canExport && $("ceXls")) $("ceXls").addEventListener("click",async()=>{
    try{
      const { data, error }=await sb().rpc("client_export_rows",{ p_from:$("ceFrom").value||null, p_to:$("ceTo").value||null });
      if(error) throw error;
      const headers=["Date","Location","Farmer","Phone","Village","Crop","Medicine","Pilot","Acres","GPS","Farmer rate","Farmer amount","Client rate","Client amount","Total"];
      const out=(data||[]).map(r=>[r.entry_date, r.location_name, r.farmer_name, r.farmer_phone, r.village, r.crop, r.medicine, r.pilot, num(r.acres), r.gps?"Yes":"No", num(r.farmer_rate), num(r.farmer_amount), num(r.client_rate), num(r.client_amount), num(r.amount)]);
      window.OPS.xlsx.download("drocon-acres-"+todayISO()+".xlsx", headers, out);
    }catch(e){ alert("Export failed: "+e.message); }
  });
  run();
}

/* raise-a-query modal (client side) */
function raiseModal(r, onDone){
  const wrap=document.createElement("div");
  wrap.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:60;display:flex;align-items:center;justify-content:center";
  wrap.innerHTML=`<div class="card" style="width:min(560px,94vw)">
    <h3 style="margin:0 0 4px">Raise a query</h3>
    <div class="muted" style="font-size:12px;margin-bottom:8px">${esc(fmtDate(r.entry_date))} · ${esc(r.location_name||"")} · ${esc(r.farmer_name||"")} · ${num(r.acres).toFixed(1)} ac</div>
    <label>Subject *</label><input id="rqSub" class="in" style="width:100%" placeholder="What's the concern?">
    <label>Details</label><textarea id="rqDesc" class="in" style="width:100%;min-height:90px"></textarea>
    <div class="err" id="rqErr" style="min-height:16px"></div>
    <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn sm" id="rqCancel">Cancel</button><button class="btn green sm" id="rqSend">Submit</button></div>
  </div>`;
  document.body.appendChild(wrap);
  const close=()=>wrap.remove();
  wrap.addEventListener("click",e=>{ if(e.target===wrap) close(); });
  $("rqCancel").addEventListener("click",close);
  $("rqSend").addEventListener("click",async()=>{
    const sub=$("rqSub").value.trim(); if(!sub){ $("rqErr").textContent="A subject is required."; return; }
    $("rqSend").disabled=true;
    const { error }=await sb().rpc("raise_client_issue",{ p_subject:sub, p_description:$("rqDesc").value||null,
      p_farmer_spray_id:r.spray_id, p_source:r.source_id, p_location:r.location_id, p_occurred:r.entry_date });
    if(error){ $("rqErr").textContent=error.message; $("rqSend").disabled=false; return; }
    close(); window.OPS.flashTop("Query raised ✓"); if(onDone) onDone();
  });
}

/* ------------------------------------------------------- CLIENT ISSUES ---- */
function threadHtml(t){ return (t||[]).map(n=>`<div style="border-left:2px solid var(--line);padding:2px 0 2px 8px;margin:4px 0"><b>${esc(n.role||"")}</b> <span class="muted" style="font-size:11px">${n.name?esc(n.name)+" · ":""}${n.at?fmtDate(n.at):""}</span><br>${esc(n.text||"")}</div>`).join("")||'<span class="muted">No notes yet.</span>'; }

async function clientIssues(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Client Portal</div><h1>My Queries</h1>
    <div class="callout">Queries you raise on any entry. DroCon Bharat reviews and resolves after discussion; you can close a query once you're satisfied.</div>
    <div id="ciList" class="muted">Loading…</div>`;
  async function load(){
    const { data }=await sb().from("client_entry_issues").select("*").order("updated_at",{ascending:false});
    const rows=data||[];
    $("ciList").innerHTML = rows.length ? rows.map(r=>`
      <div class="card"><div class="row wrap"><b>${esc(r.subject)}</b><span class="chip ${chip(r.status)}">${esc(label(r.status))}</span>
        <div class="spacer"></div><span class="muted">${esc(r.location_name||"")} · ${r.occurred_on?fmtDate(r.occurred_on):''}</span></div>
        ${r.description?`<div style="margin:6px 0">${esc(r.description)}</div>`:''}
        <div style="margin-top:6px">${threadHtml(r.thread)}</div>
        ${r.status!=='closed'?`<div class="row" style="gap:6px;margin-top:8px"><input class="in" data-note="${r.id}" placeholder="Add a note" style="flex:1"><button class="btn sm" data-addn="${r.id}">Send</button><button class="btn sm" data-close="${r.id}" style="color:#a3322a">Close query</button></div>`:''}</div>`).join("")
      : '<div class="card muted">No queries yet. Raise one from the Entries tab.</div>';
    $("ciList").querySelectorAll("[data-addn]").forEach(b=>b.addEventListener("click",async()=>{
      const id=b.getAttribute("data-addn"), txt=document.querySelector(`[data-note="${id}"]`).value.trim(); if(!txt) return;
      const { error }=await sb().rpc("add_client_issue_note",{ p_id:id, p_text:txt }); if(error){ alert(error.message); return; } load();
    }));
    $("ciList").querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",async()=>{
      if(!confirm("Close this query?")) return;
      const { error }=await sb().rpc("set_client_issue_status",{ p_id:b.getAttribute("data-close"), p_status:"closed", p_note:null }); if(error){ alert(error.message); return; } window.OPS.flashTop("Closed ✓"); load();
    }));
  }
  load();
}

/* ---------------------------------------------------- DROCON QUEUE (int) --- */
async function clientIssueQueue(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Review / Approvals</div><h1>Client Queries</h1>
    <div class="callout">Queries clients raised on their entries. Discuss, then set the status. Clients can close their own once satisfied.</div>
    <div id="cqList" class="muted">Loading…</div>`;
  async function load(){
    const { data }=await sb().from("v_client_issues").select("*").order("updated_at",{ascending:false});
    const rows=data||[];
    const open=rows.filter(r=>r.status!=="closed"), done=rows.filter(r=>r.status==="closed");
    const cardHtml=r=>`<div class="card" style="background:#fafbf8"><div class="row wrap"><b>${esc(r.subject)}</b><span class="chip ${chip(r.status)}">${esc(label(r.status))}</span>
        <div class="spacer"></div><span class="muted">${esc(r.client_name||"")} · ${esc(r.location_name||"")} · ${r.occurred_on?fmtDate(r.occurred_on):''}</span></div>
        ${r.description?`<div style="margin:6px 0">${esc(r.description)}</div>`:''}
        <div style="margin-top:6px">${threadHtml(r.thread)}</div>
        <div class="row wrap" style="gap:6px;margin-top:8px"><input class="in" data-note="${r.id}" placeholder="Reply / note" style="flex:1;min-width:160px">
          <button class="btn sm" data-addn="${r.id}">Send</button>
          <select class="in sm" data-st="${r.id}" style="width:auto"><option value="">Set status…</option><option value="in_review">In review</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></div></div>`;
    $("cqList").innerHTML=`<div class="card"><h3>Open (${open.length})</h3>${open.length?open.map(cardHtml).join(""):'<div class="muted">Nothing open.</div>'}</div>
      ${done.length?`<div class="card"><h3>Closed</h3>${done.slice(0,30).map(cardHtml).join("")}</div>`:''}`;
    $("cqList").querySelectorAll("[data-addn]").forEach(b=>b.addEventListener("click",async()=>{
      const id=b.getAttribute("data-addn"), txt=document.querySelector(`[data-note="${id}"]`).value.trim(); if(!txt) return;
      const { error }=await sb().rpc("add_client_issue_note",{ p_id:id, p_text:txt }); if(error){ alert(error.message); return; } load();
    }));
    $("cqList").querySelectorAll("[data-st]").forEach(sel=>sel.addEventListener("change",async()=>{
      if(!sel.value) return; const id=sel.getAttribute("data-st"); const note=document.querySelector(`[data-note="${id}"]`).value.trim()||null;
      const { error }=await sb().rpc("set_client_issue_status",{ p_id:id, p_status:sel.value, p_note:note }); if(error){ alert(error.message); return; } window.OPS.flashTop("Updated ✓"); load();
    }));
  }
  load();
}

window.OPS.routes.client_dashboard   = clientDashboard;
window.OPS.routes.client_entries     = clientEntries;
window.OPS.routes.client_issues      = clientIssues;
window.OPS.routes.client_issue_queue = clientIssueQueue;
})();
