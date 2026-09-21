/* ============================================================================
   DroCon Cloud — Vendor Portal (Phase 1: identities & logins)
   - vendorPilots()   : VENDOR (external) manages its own pilots and requests
                        a login for each; the login is pending until DroCon
                        approves it.
   - pilotApprovals() : DroCon (internal) approves / rejects pilot login
                        requests raised by vendors.
   Later phases add pilot acre reporting, field issues and vendor invoicing.
   ============================================================================ */
(function(){
const { $, esc, fmt, num, money, fmtDate } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const chip = (s)=>({approved:"ok",pending:"warn",rejected:"err"}[s]||"warn");
const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const ymLabel=(ym)=>{ if(!ym||ym==='?') return '?'; const p=String(ym).split('-'); return (MONTHS[(+p[1])-1]||p[1])+" "+p[0]; };

/* ---- expandable acre drill-down (acres only) ---- */
function vdSort(c,mode){ const ks=Object.keys(c); if(mode==="keyDesc") return ks.sort().reverse(); return ks.sort((x,y)=>c[y].a-c[x].a); }
function vdDrill(rows, defs, prefix, header){
  const root={a:0,c:{}};
  (rows||[]).forEach(row=>{ const a=num(row.acres); let node=root; node.a+=a; defs.forEach(d=>{ const k=d.get(row)||"—"; node.c[k]=node.c[k]||{a:0,c:{}}; node=node.c[k]; node.a+=a; }); });
  if(!Object.keys(root.c).length) return '<div class="muted">No data.</div>';
  const out=[]; const idRef={n:0};
  (function walk(node,depth,parentId){ vdSort(node.c, defs[depth].sort).forEach(k=>{ const child=node.c[k]; const id=prefix+(idRef.n++);
    const leaf=depth===defs.length-1, d=defs[depth]; const lbl=d.label?d.label(k):k;
    const caret=leaf?'':'<span class="dcar" style="display:inline-block;width:12px;color:var(--muted)">▸</span> ';
    out.push(`<tr class="drow ${leaf?'dleaf':'dgrp'}" data-id="${id}" data-parent="${parentId||''}" style="display:${depth===0?'':'none'};${leaf?'':'cursor:pointer'};${depth===1?'background:#f7f8f6':''}"><td style="padding-left:${4+depth*24}px"${leaf?' class="muted"':''}>${caret}${d.bold?'<b>'+esc(lbl)+'</b>':esc(lbl)}</td><td class="num">${child.a.toFixed(1)}</td></tr>`);
    if(!leaf) walk(child,depth+1,id); }); })(root,0,"");
  return `<div style="overflow:auto"><table class="tt-skip"><thead><tr><th>${esc(header)}</th><th class="num">Acres</th></tr></thead><tbody>${out.join("")}</tbody></table></div>`;
}
function vdWire(host){ if(!host) return;
  const hide=(id)=>{ host.querySelectorAll('.drow[data-parent="'+id+'"]').forEach(r=>{ r.style.display="none"; const c=r.querySelector(".dcar"); if(c)c.textContent="▸"; hide(r.getAttribute("data-id")); }); };
  host.querySelectorAll(".dgrp").forEach(tr=>tr.addEventListener("click",()=>{ const id=tr.getAttribute("data-id"); const kids=host.querySelectorAll('.drow[data-parent="'+id+'"]'); const show=kids.length&&kids[0].style.display==="none"; if(show) kids.forEach(k=>k.style.display=""); else hide(id); const car=tr.querySelector(".dcar"); if(car) car.textContent=show?"▾":"▸"; }));
}

/* ------------------------------------------------------ VENDOR DASHBOARD --- */
async function vendorDashboard(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Vendor Portal</div><h1>Acre Dashboard</h1>
    <div class="callout">Your pilots' approved acres, and your billing position with DroCon Bharat.</div>
    <div id="vdBody" class="muted">Loading…</div>`;
  let rows, locs, summ, bill;
  try{ [rows, locs, summ, bill] = await Promise.all([
    sb().rpc("vendor_acre_rows",{p_from:null,p_to:null,p_vendor:null}).then(r=>r.data||[]),
    sb().rpc("my_vendor_locations").then(r=>r.data||[]),
    sb().rpc("vendor_location_summary",{p_vendor:null}).then(r=>r.data||[]),
    sb().rpc("my_vendor_billing",{p_vendor:null}).then(r=>(r.data&&r.data[0])||{})
  ]); }catch(e){ $("vdBody").innerHTML=`<div class="err">${esc(e.message)}</div>`; return; }
  const totAc=rows.reduce((s,r)=>s+num(r.acres),0);
  // this-week grid
  const dayList=[]; for(let i=6;i>=0;i--){ dayList.push(new Date(Date.now()-i*86400000).toISOString().slice(0,10)); }
  const inWeek=new Set(dayList), wLoc={}, dayTot={};
  locs.forEach(l=>{ wLoc[l.id]={name:l.name,days:{},pilots:{}}; });
  rows.filter(r=>inWeek.has(r.entry_date)).forEach(r=>{ const d=r.entry_date,lid=r.location_id,p=(r.pilot_name||"").trim()||"(unassigned)";
    dayTot[d]=(dayTot[d]||0)+num(r.acres); const w=wLoc[lid]||(wLoc[lid]={name:r.location_name||"(none)",days:{},pilots:{}});
    w.days[d]=(w.days[d]||0)+num(r.acres); w.pilots[p]=w.pilots[p]||{}; w.pilots[p][d]=(w.pilots[p][d]||0)+num(r.acres); });
  const grand=dayList.reduce((s,d)=>s+(dayTot[d]||0),0);
  const drows=rows.map(r=>({location:r.location_name||"(none)", pilot:(r.pilot_name||"").trim()||"(unassigned)", ym:r.entry_date?r.entry_date.slice(0,7):'?', acres:num(r.acres)}));
  $("vdBody").innerHTML=`
    <div class="statrow">
      <div class="stat"><div class="n">${totAc.toFixed(1)}</div><div class="l">Total acres</div></div>
      <div class="stat" style="background:#fff0db"><div class="n" style="color:#9a5b00">${num(bill.unbilled_acres).toFixed(1)}</div><div class="l">Unbilled acres${num(bill.unbilled_amount)>0?` <span class="muted" style="font-size:11px">(${money(bill.unbilled_amount)})</span>`:''}</div></div>
      <div class="stat"><div class="n" style="color:var(--green)">${money(bill.pending_payment)}</div><div class="l">Pending payment from DroCon</div></div>
      <div class="stat" style="${num(bill.due_to_drocon)>0?'background:#fbe0de':''}"><div class="n" style="${num(bill.due_to_drocon)>0?'color:#a3322a':''}">${money(bill.due_to_drocon)}</div><div class="l">Amount due to DroCon (advances)</div></div>
      <div class="stat"><div class="n">${locs.length}</div><div class="l">Locations</div></div>
    </div>
    <div class="card"><h3>This week — acres by location &amp; pilot</h3>
      <p class="muted" style="margin-top:-4px">Last 7 days. A dot (·) means no spray that day.</p>
      <div style="overflow:auto"><table class="tt-skip"><thead><tr><th>Location / Pilot</th>${dayList.map(d=>`<th class="num">${d.slice(5)}</th>`).join("")}<th class="num">Total</th></tr></thead>
      <tbody>
        <tr style="background:var(--charcoal);color:#fff"><td><b>ALL LOCATIONS — daily total</b></td>${dayList.map(d=>`<td class="num"><b>${dayTot[d]?dayTot[d].toFixed(1):'·'}</b></td>`).join("")}<td class="num"><b>${grand.toFixed(1)}</b></td></tr>
        ${Object.keys(wLoc).sort((a,b)=>(wLoc[a].name||"").localeCompare(wLoc[b].name||"")).map(lid=>{ const L=wLoc[lid]; const tot=dayList.reduce((s,d)=>s+(L.days[d]||0),0);
          const locRow=`<tr style="background:var(--grey)"><td><b>${esc(L.name)}</b></td>${dayList.map(d=>`<td class="num">${L.days[d]?L.days[d].toFixed(1):'·'}</td>`).join("")}<td class="num"><b>${tot.toFixed(1)}</b></td></tr>`;
          const pr=Object.keys(L.pilots).sort().map(p=>{ const P=L.pilots[p]; const pt=dayList.reduce((s,d)=>s+(P[d]||0),0);
            return `<tr><td style="padding-left:26px">${esc(p)}</td>${dayList.map(d=>`<td class="num${P[d]==null?' muted':''}">${P[d]!=null?P[d].toFixed(1):'·'}</td>`).join("")}<td class="num">${pt.toFixed(1)}</td></tr>`; }).join("");
          return locRow+pr; }).join("")}</tbody></table></div></div>
    <div class="card"><h3>Location summary</h3>
      <div style="overflow:auto"><table><thead><tr><th>Location</th><th>Started</th><th>Status</th><th class="num">Days</th><th class="num">Acres</th><th class="num">Avg/day</th></tr></thead>
      <tbody>${(summ||[]).map(s=>`<tr><td>${esc(s.location_name||"")}</td><td>${s.start_date?fmtDate(s.start_date):'<span class="muted">—</span>'}</td>
        <td>${s.active?'<span class="chip ok">Active</span>':(s.deactivated_on?('Deactivated '+fmtDate(s.deactivated_on)):'<span class="muted">Inactive</span>')}</td>
        <td class="num">${s.days_deployed!=null?s.days_deployed:'—'}</td><td class="num">${num(s.acres).toFixed(1)}</td><td class="num">${s.avg_daily!=null?num(s.avg_daily).toFixed(1):'—'}</td></tr>`).join("")||'<tr><td colspan="6" class="muted">No locations.</td></tr>'}</tbody></table></div></div>
    <div class="card"><h3>Acre report</h3>
      <div class="row" style="gap:6px;margin-bottom:8px"><button class="btn sm" data-vd="month">By Month</button><button class="btn sm" data-vd="loc">By Location</button><button class="btn sm" data-vd="pilot">By Pilot</button></div>
      <div id="vdDrill"></div></div>`;
  const dMonthB={get:r=>r.ym,label:ymLabel,sort:"keyDesc",bold:true}, dMonth={get:r=>r.ym,label:ymLabel,sort:"keyDesc"},
        dLoc={get:r=>r.location,sort:"acres",bold:true}, dLocN={get:r=>r.location,sort:"acres"},
        dPil={get:r=>r.pilot,sort:"acres"}, dPilB={get:r=>r.pilot,sort:"acres",bold:true};
  const VIEWS={ month:[[dMonthB,dLocN,dPil],"Month / Location / Pilot"], loc:[[dLoc,dMonth,dPil],"Location / Month / Pilot"], pilot:[[dPilB,dLocN,dMonth],"Pilot / Location / Month"] };
  function drill(k){ const [defs,hdr]=VIEWS[k]||VIEWS.month; $("vdDrill").innerHTML=vdDrill(drows,defs,"vd"+k,hdr); vdWire($("vdDrill"));
    document.querySelectorAll("[data-vd]").forEach(b=>b.style.fontWeight=(b.getAttribute("data-vd")===k)?"700":""); }
  document.querySelectorAll("[data-vd]").forEach(b=>b.addEventListener("click",()=>drill(b.getAttribute("data-vd"))));
  drill("month");
}

/* ---------------------------------------------------------------- VENDOR --- */
async function vendorPilots(){
  const m=$("main");
  const vendorId = window.OPS.profile && window.OPS.profile.party_id;
  m.innerHTML=`<div class="eyebrow">Vendor Portal</div><h1>My Pilots</h1>
    <div class="callout">Add your pilots and request a login for each. DroCon reviews and <b>approves</b> the login before the pilot can sign in. Once approved, the pilot signs up in the app using the <b>same email</b>.</div>
    <div class="card"><h3>Add a pilot</h3>
      <div class="fgrid">
        <div class="field"><label>Pilot name *</label><input id="vpName"></div>
        <div class="field"><label>Mobile</label><input id="vpPhone"></div>
        <div class="field"><label>RPC No.</label><input id="vpRpc"></div>
        <div class="field"><label>Drone UIN</label><input id="vpUin"></div>
      </div>
      <div class="row"><button class="btn green" id="vpAdd">Add pilot</button><div class="spacer"></div><div class="err" id="vpErr"></div></div>
    </div>
    <div id="vpList" class="muted">Loading…</div>`;
  $("vpAdd").addEventListener("click",async()=>{
    const name=$("vpName").value.trim(); if(!name){ $("vpErr").textContent="Pilot name is required."; return; }
    if(!vendorId){ $("vpErr").textContent="Your login is not linked to a vendor. Contact DroCon."; return; }
    const rec={ vendor_id:vendorId, name, phone:$("vpPhone").value.trim()||null,
      rpc_no:$("vpRpc").value.trim()||null, drone_uin:$("vpUin").value.trim()||null, created_by:window.OPS.me.id };
    $("vpAdd").disabled=true; const { error }=await sb().from("pilots").insert(rec); $("vpAdd").disabled=false;
    if(error){ $("vpErr").textContent=error.message; return; }
    window.OPS.flashTop("Pilot added ✓"); ["vpName","vpPhone","vpRpc","vpUin"].forEach(id=>$(id).value=""); load();
  });
  load();

  async function load(){
    const [{data:pilots},{data:invites}]=await Promise.all([
      sb().from("pilots").select("*").order("name"),
      sb().from("partner_invites").select("*").eq("party_type","pilot")
    ]);
    const invByPilot={}; (invites||[]).forEach(i=>{ if(i.party_id) invByPilot[i.party_id]=i; });
    const rows=pilots||[];
    $("vpList").innerHTML = rows.length ? `<div class="card"><h3>Pilots</h3><div style="overflow:auto">
      <table><thead><tr><th>Name</th><th>Mobile</th><th>RPC</th><th>Login</th><th></th></tr></thead>
      <tbody>${rows.map(p=>{ const iv=invByPilot[p.id];
        const login = iv ? (iv.used_at ? '<span class="chip ok">active</span>'
                        : `<span class="chip ${chip(iv.status)}">${esc(iv.status)}</span> <span class="muted">${esc(iv.email)}</span>`)
                       : '<span class="muted">— no login —</span>';
        return `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.phone||"")}</td><td>${esc(p.rpc_no||"")}</td>
          <td>${login}</td>
          <td>${iv?'':`<button class="btn sm" data-req="${p.id}" data-nm="${esc(p.name)}">Request login</button>`}</td></tr>`;
      }).join("")}</tbody></table></div></div>`
      : '<div class="card muted">No pilots yet. Add your first pilot above.</div>';
    $("vpList").querySelectorAll("[data-req]").forEach(b=>b.addEventListener("click",()=>requestLogin(b.getAttribute("data-req"), b.getAttribute("data-nm"))));
  }
  function requestLogin(pilotId, name){
    const email=prompt("Pilot's email for the login (they will sign up with this exact email):","");
    if(email===null) return;
    const e=email.trim().toLowerCase(); if(!e){ alert("Email required."); return; }
    sb().from("partner_invites").insert({ email:e, party_type:"pilot", party_id:pilotId, party_name:name,
      vendor_id:vendorId, status:"pending", created_by:window.OPS.me.id }).then(({error})=>{
        if(error){ alert(error.message); return; }
        window.OPS.flashTop("Login requested — pending DroCon approval ✓"); load();
      });
  }
}

/* ------------------------------------------------------------- INTERNAL --- */
async function pilotApprovals(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Review / Approvals</div><h1>Pilot Logins</h1>
    <div class="callout">Vendors request logins for their pilots here. <b>Approve</b> to let the pilot sign up (with the listed email); <b>reject</b> to decline. Approving does not create the account — the pilot self-signs-up afterwards.</div>
    <div id="paList" class="muted">Loading…</div>`;
  load();
  async function load(){
    const { data, error }=await sb().from("v_pilot_login_requests").select("*").order("created_at",{ascending:false});
    if(error){ $("paList").innerHTML='<div class="card muted">'+esc(error.message)+'</div>'; return; }
    const rows=data||[];
    const pending=rows.filter(r=>r.status==="pending" && !r.used_at);
    $("paList").innerHTML=`
      <div class="card"><h3>Pending (${pending.length})</h3>${
        pending.length?`<div style="overflow:auto"><table><thead><tr><th>Pilot</th><th>Vendor</th><th>Email</th><th>Requested</th><th></th></tr></thead>
        <tbody>${pending.map(r=>`<tr><td><b>${esc(r.pilot_name||"")}</b></td><td>${esc(r.vendor_name||"")}</td><td>${esc(r.email)}</td>
          <td class="muted">${fmt(r.created_at)}</td>
          <td><button class="btn sm green" data-ap="${r.id}">Approve</button> <button class="btn sm" data-rj="${r.id}" style="color:#a3322a;border-color:#e4b4b4">Reject</button></td></tr>`).join("")}</tbody></table></div>`
        :'<div class="muted">Nothing awaiting approval.</div>'}</div>
      ${rows.length?`<div class="card"><h3>All requests</h3><div style="overflow:auto">
        <table><thead><tr><th>Pilot</th><th>Vendor</th><th>Email</th><th>Status</th><th>Login</th></tr></thead>
        <tbody>${rows.map(r=>`<tr><td>${esc(r.pilot_name||"")}</td><td>${esc(r.vendor_name||"")}</td><td>${esc(r.email)}</td>
          <td><span class="chip ${chip(r.status)}">${esc(r.status)}</span></td>
          <td>${r.used_at?'<span class="chip ok">active</span>':'<span class="muted">not signed up</span>'}</td></tr>`).join("")}</tbody></table></div></div>`:''}`;
    $("paList").querySelectorAll("[data-ap]").forEach(b=>b.addEventListener("click",()=>act(b.getAttribute("data-ap"),"approved")));
    $("paList").querySelectorAll("[data-rj]").forEach(b=>b.addEventListener("click",()=>act(b.getAttribute("data-rj"),"rejected")));
  }
  async function act(id, status){
    if(status==="rejected" && !confirm("Reject this pilot login request?")) return;
    const { error }=await sb().rpc("set_pilot_invite_status",{ p_id:id, p_status:status });
    if(error){ alert(error.message); return; }
    window.OPS.flashTop("Pilot login "+status+" ✓"); load();
  }
}

/* ------------------------------------------------------- VENDOR ENTRIES --- */
async function vendorEntries(){
  const m=$("main");
  let locs=[]; try{ locs=await sb().rpc("my_vendor_locations").then(r=>r.data||[]); }catch(e){}
  m.innerHTML=`<div class="eyebrow">Vendor Portal</div><h1>Entries</h1>
    <div class="callout">Every approved acre row for your pilots, line by line — with its billing status.</div>
    <div class="card"><div class="row wrap" style="gap:8px;align-items:flex-end">
      <div class="field" style="margin:0"><label>From</label><input id="veFrom" type="date"></div>
      <div class="field" style="margin:0"><label>To</label><input id="veTo" type="date"></div>
      <div class="field" style="margin:0"><label>Location</label><select id="veLoc"><option value="">All</option>${locs.map(l=>`<option value="${esc(l.name)}">${esc(l.name)}</option>`).join("")}</select></div>
      <div class="field" style="margin:0"><label>Billing</label><select id="veBill"><option value="">All</option><option value="billed">Billed</option><option value="unbilled">Unbilled</option></select></div>
      <button class="btn sm" id="veGo">Apply</button><button class="btn sm green" id="veXls">⬇ Excel</button></div></div>
    <div id="veList" class="muted">Loading…</div>`;
  let rows=[];
  async function run(){ $("veList").innerHTML='<div class="muted">Loading…</div>';
    try{ rows=await sb().rpc("vendor_acre_rows",{p_from:$("veFrom").value||null,p_to:$("veTo").value||null,p_vendor:null}).then(r=>r.data||[]); }
    catch(e){ $("veList").innerHTML=`<div class="err">${esc(e.message)}</div>`; return; } render(); }
  function filtered(){ const loc=$("veLoc").value, bill=$("veBill").value;
    return rows.filter(r=>(!loc||r.location_name===loc)&&(!bill||(bill==='billed'?r.billed:!r.billed))); }
  function render(){ const fr=filtered(); const tot=fr.reduce((s,r)=>s+num(r.acres),0);
    $("veList").innerHTML=`<div class="card"><div class="row" style="margin-bottom:6px"><b>${fr.length} row${fr.length===1?'':'s'}</b><span class="muted" style="margin-left:8px">${tot.toFixed(1)} acres</span></div>
      <div style="overflow:auto"><table><thead><tr><th>Date</th><th>Location</th><th>Pilot</th><th>Crop</th><th class="num">Acres</th><th>Billing</th></tr></thead>
      <tbody>${fr.map(r=>`<tr><td>${fmtDate(r.entry_date)}</td><td>${esc(r.location_name||"")}</td><td>${esc(r.pilot_name||"")}</td><td>${esc(r.crop||"")}</td><td class="num">${num(r.acres).toFixed(1)}</td><td>${r.billed?'<span class="chip ok">Billed</span>':'<span class="chip warn">Unbilled</span>'}</td></tr>`).join("")||'<tr><td colspan="6" class="muted">No approved entries for this filter.</td></tr>'}</tbody></table></div></div>`; }
  $("veGo").addEventListener("click",run);
  $("veLoc").addEventListener("change",()=>{ if(rows.length) render(); });
  $("veBill").addEventListener("change",()=>{ if(rows.length) render(); });
  $("veXls").addEventListener("click",()=>{ const fr=filtered(); if(window.OPS.xlsx) window.OPS.xlsx.download("vendor-entries.xlsx","Entries",["Date","Location","Pilot","Crop","Acres","Billing"], fr.map(r=>[r.entry_date,r.location_name,r.pilot_name,r.crop,num(r.acres),r.billed?"Billed":"Unbilled"])); });
  run();
}

window.OPS.routes.vendor_dashboard = vendorDashboard;
window.OPS.routes.vendor_entries  = vendorEntries;
window.OPS.routes.vendor_pilots   = vendorPilots;
window.OPS.routes.pilot_approvals = pilotApprovals;
})();
