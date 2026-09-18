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

async function feed(from,to){
  const { data, error } = await sb().rpc("client_spray_rows",{ p_from:from||null, p_to:to||null, p_client:null });
  if(error) throw error; return data||[];
}

/* ------------------------------------------------------------- DASHBOARD --- */
async function clientDashboard(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Client Portal</div><h1>Acre Dashboard</h1>
    <div class="callout">Live view of the acres sprayed for your locations. Figures update as DroCon Bharat approves each day's work.</div>
    <div id="cdBody" class="muted">Loading…</div>`;
  let rows, locs;
  try{ [rows, locs] = await Promise.all([feed(), sb().rpc("my_client_locations").then(r=>r.data||[])]); }
  catch(e){ $("cdBody").innerHTML=`<div class="err">${esc(e.message)}</div>`; return; }
  if(!locs.length){ $("cdBody").innerHTML='<div class="card muted">No locations have been assigned to your account yet. Please contact DroCon Bharat.</div>'; return; }
  const byLoc={}; rows.forEach(r=>{ const k=r.location_name||"(none)"; (byLoc[k]=byLoc[k]||{acres:0,amount:0,last:null}); byLoc[k].acres+=num(r.acres); byLoc[k].amount+=num(r.amount); if(!byLoc[k].last||r.entry_date>byLoc[k].last) byLoc[k].last=r.entry_date; });
  const farmers=new Set(rows.map(r=>(r.farmer_name||"").trim().toLowerCase()).filter(Boolean)).size;
  // recent 14 days
  const byDay={}; rows.forEach(r=>{ byDay[r.entry_date]=(byDay[r.entry_date]||0)+num(r.acres); });
  const days=Object.keys(byDay).sort().reverse().slice(0,14);
  $("cdBody").innerHTML=`
    <div class="statrow">
      <div class="stat"><div class="n">${acresOf(rows).toFixed(1)}</div><div class="l">Total acres</div></div>
      <div class="stat"><div class="n">${money(amtOf(rows))}</div><div class="l">Total value</div></div>
      <div class="stat"><div class="n">${locs.length}</div><div class="l">Locations</div></div>
      <div class="stat"><div class="n">${farmers}</div><div class="l">Farmers served</div></div>
    </div>
    <div class="card"><h3>By location</h3><div style="overflow:auto"><table><thead><tr><th>Location</th><th class="num">Acres</th><th class="num">Value</th><th>Last spray</th></tr></thead>
      <tbody>${Object.entries(byLoc).sort((a,b)=>b[1].acres-a[1].acres).map(([k,v])=>`<tr><td>${esc(k)}</td><td class="num">${v.acres.toFixed(1)}</td><td class="num">${money(v.amount)}</td><td>${v.last?fmtDate(v.last):''}</td></tr>`).join("")||'<tr><td colspan="4" class="muted">No approved data yet.</td></tr>'}</tbody></table></div></div>
    <div class="card"><h3>Recent days</h3><div style="overflow:auto"><table><thead><tr><th>Date</th><th class="num">Acres</th></tr></thead>
      <tbody>${days.map(d=>`<tr><td>${fmtDate(d)}</td><td class="num">${byDay[d].toFixed(1)}</td></tr>`).join("")||'<tr><td colspan="2" class="muted">No approved data yet.</td></tr>'}</tbody></table></div></div>`;
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
      <div style="overflow:auto"><table><thead><tr><th>Date</th><th>Location</th><th>Farmer</th><th>Village</th><th>Crop</th><th>Medicine</th><th>Pilot</th><th class="num">Acres</th><th class="num">Value</th><th></th></tr></thead>
      <tbody>${fr.map(r=>`<tr>
        <td>${fmtDate(r.entry_date)}</td><td>${esc(r.location_name||"")}</td><td>${esc(r.farmer_name||"")}</td>
        <td>${esc(r.village||"")}</td><td>${esc(r.crop||"")}</td><td>${esc(r.medicine||"")}</td><td>${esc(r.pilot||"")}</td>
        <td class="num">${num(r.acres).toFixed(1)}</td><td class="num">${money(r.amount)}</td>
        <td>${r.open_issue?'<span class="chip warn">query</span>':`<button class="btn sm ghost" data-raise="${r.spray_id}">Raise query</button>`}</td></tr>`).join("")||'<tr><td colspan="10" class="muted">No approved entries for this filter.</td></tr>'}</tbody></table></div></div>`;
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
      const headers=["Date","Location","Farmer","Village","Crop","Medicine","Pilot","Acres","Value"];
      const out=(data||[]).map(r=>[r.entry_date, r.location_name, r.farmer_name, r.village, r.crop, r.medicine, r.pilot, num(r.acres), num(r.amount)]);
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
