/* ============================================================================
   DroCon Cloud — Field-issue reporting (Phase 3)
   Pilots raise field issues; their vendor and the DroCon team review, discuss
   on a thread, and set status. One shared detail view; three entry points:
     - issueReport()   PILOT   (raise + my issues)
     - vendorIssues()  VENDOR  (its pilots' issues)
     - fieldIssues()   INTERNAL (all issues)
   ============================================================================ */
(function(){
const { $, esc, fmt, fmtDate } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const CATS = ["drone","chemical","access","farmer","weather","payment","other"];
const sevChip = (s)=>({low:"issued",medium:"warn",high:"err"}[s]||"warn");
const stChip  = (s)=>({open:"warn",in_review:"issued",resolved:"ok",closed:"ok"}[s]||"warn");
const stLabel = (s)=>({open:"Open",in_review:"In review",resolved:"Resolved",closed:"Closed"}[s]||s);

async function listView(mode){
  const m=$("main");
  const isPilot=mode==="pilot", canManage=mode!=="pilot";
  const eyebrow = isPilot?"Pilot Portal":(mode==="vendor"?"Vendor Portal":"Review / Approvals");
  m.innerHTML=`<div class="eyebrow">${eyebrow}</div><h1>Field Issues</h1>
    ${isPilot?'<div class="row" style="margin:6px 0"><button class="btn green sm" id="fiNew">+ Raise an issue</button></div>':
      '<div class="callout">Issues raised by pilots. Open one to discuss on the thread and set its status.</div>'}
    <div class="row wrap" style="margin:6px 0"><label style="margin:0">Show</label>
      <select id="fiFilter" style="width:auto"><option value="open">Open &amp; in review</option><option value="all">All</option></select></div>
    <div id="fiList" class="muted">Loading…</div>`;
  if($("fiNew")) $("fiNew").addEventListener("click",()=>raiseForm(mode));
  $("fiFilter").addEventListener("change",load);
  load();
  async function load(){
    const { data, error }=await sb().from("field_issues").select("*, pilot:pilot_id(name), vendor:vendor_id(name,firm_name)").order("updated_at",{ascending:false});
    if(error){ $("fiList").innerHTML='<div class="card muted">'+esc(error.message)+'</div>'; return; }
    let rows=data||[];
    if($("fiFilter").value==="open") rows=rows.filter(r=>r.status==="open"||r.status==="in_review");
    const vn=r=>(r.vendor&&(r.vendor.firm_name||r.vendor.name))||"";
    $("fiList").innerHTML = rows.length ? `<div class="card"><div style="overflow:auto"><table><thead><tr>
      <th>Raised</th>${isPilot?'':'<th>Pilot</th>'}${mode==="internal"?'<th>Vendor</th>':''}<th>Subject</th><th>Category</th><th>Severity</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map(r=>`<tr><td>${fmtDate(r.created_at)}</td>${isPilot?'':`<td>${esc(r.pilot&&r.pilot.name||"")}</td>`}${mode==="internal"?`<td>${esc(vn(r))}</td>`:''}
        <td><b>${esc(r.subject)}</b>${r.location_name?`<br><span class="small-note">${esc(r.location_name)}</span>`:''}</td>
        <td>${esc(r.category||"")}</td><td><span class="chip ${sevChip(r.severity)}">${esc(r.severity)}</span></td>
        <td><span class="chip ${stChip(r.status)}">${esc(stLabel(r.status))}</span></td>
        <td><button class="btn sm" data-open="${r.id}">Open</button></td></tr>`).join("")}</tbody></table></div></div>`
      : '<div class="card muted">No issues.</div>';
    $("fiList").querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>detail(b.getAttribute("data-open"), mode, canManage)));
  }
}

async function raiseForm(mode){
  const m=$("main");
  const locs = await sb().rpc("my_pilot_locations").then(r=>r.data||[]);
  m.innerHTML=`<button class="btn sm" id="fiBack">← Back</button>
    <div class="card" style="margin-top:12px"><div class="eyebrow">Pilot Portal</div><h1>Raise a field issue</h1>
      <div class="fgrid">
        <div class="field"><label>Subject *</label><input id="fiSub" placeholder="Short summary"></div>
        <div class="field"><label>Category</label><select id="fiCat">${CATS.map(c=>`<option value="${c}">${c}</option>`).join("")}</select></div>
        <div class="field"><label>Severity</label><select id="fiSev"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select></div>
        <div class="field"><label>Date it occurred</label><input id="fiDate" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
        <div class="field"><label>Location (optional)</label><select id="fiLoc"><option value="">— none —</option>${locs.map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select></div>
      </div>
      <div class="field"><label>Details</label><textarea id="fiDesc" placeholder="What happened, and what help you need."></textarea></div>
      <div class="row"><button class="btn green" id="fiSave">Submit issue</button><div class="spacer"></div><div class="err" id="fiErr"></div></div>
    </div>`;
  $("fiBack").addEventListener("click",()=>listView(mode));
  $("fiSave").addEventListener("click",async()=>{
    const subject=$("fiSub").value.trim(); if(!subject){ $("fiErr").textContent="Subject is required."; return; }
    $("fiSave").disabled=true;
    const { error }=await sb().rpc("raise_field_issue",{ p_subject:subject, p_description:$("fiDesc").value||null,
      p_category:$("fiCat").value, p_severity:$("fiSev").value, p_location:$("fiLoc").value||null, p_occurred:$("fiDate").value||null });
    $("fiSave").disabled=false;
    if(error){ $("fiErr").textContent=error.message; return; }
    window.OPS.flashTop("Issue submitted ✓"); listView(mode);
  });
}

async function detail(id, mode, canManage){
  const m=$("main");
  const { data:r }=await sb().from("field_issues").select("*, pilot:pilot_id(name), vendor:vendor_id(name,firm_name)").eq("id",id).single();
  if(!r){ listView(mode); return; }
  const vn=(r.vendor&&(r.vendor.firm_name||r.vendor.name))||"";
  const thread=Array.isArray(r.thread)?r.thread:[];
  m.innerHTML=`<button class="btn sm" id="fiBack">← Back</button>
    <div class="card" style="margin-top:12px">
      <div class="row wrap"><h1 style="margin:0">${esc(r.subject)}</h1><div class="spacer"></div>
        <span class="chip ${sevChip(r.severity)}">${esc(r.severity)}</span> <span class="chip ${stChip(r.status)}">${esc(stLabel(r.status))}</span></div>
      <p class="muted" style="margin:6px 0">${esc(r.category||"")}${r.location_name?" · "+esc(r.location_name):""} · raised ${fmtDate(r.created_at)}${mode!=="pilot"?" · "+esc(r.pilot&&r.pilot.name||""):""}${mode==="internal"?" · "+esc(vn):""}</p>
      ${r.description?`<p>${esc(r.description).replace(/\n/g,"<br>")}</p>`:''}
      ${canManage?`<div class="row wrap" style="margin-top:8px">
        <button class="btn sm" data-st="in_review">Mark in review</button>
        <button class="btn sm green" data-st="resolved">Resolve</button>
        <button class="btn sm" data-st="closed">Close</button>
        <button class="btn sm" data-st="open">Reopen</button></div>`:''}
    </div>
    <div class="card"><h3>Discussion</h3>
      <div id="fiThread">${thread.length?thread.map(t=>`<div style="margin:6px 0;padding:8px;border:1px solid var(--line);border-radius:8px">
        <div class="small-note"><b>${esc(t.name||"")}</b> <span class="chip ${t.role==='DroCon'?'ok':(t.role==='Vendor'?'issued':'warn')}">${esc(t.role||"")}</span> · ${fmt(t.at)}</div>
        <div>${esc(t.text||"").replace(/\n/g,"<br>")}</div></div>`).join(""):'<div class="muted">No messages yet.</div>'}</div>
      <div class="row" style="margin-top:8px"><input id="fiNote" placeholder="Add a note…" style="flex:1"><button class="btn" id="fiSend">Send</button></div>
    </div>`;
  $("fiBack").addEventListener("click",()=>listView(mode));
  $("fiSend").addEventListener("click",async()=>{
    const text=$("fiNote").value.trim(); if(!text) return;
    const { error }=await sb().rpc("add_issue_note",{ p_id:id, p_text:text });
    if(error){ alert(error.message); return; } detail(id, mode, canManage);
  });
  m.querySelectorAll("[data-st]").forEach(b=>b.addEventListener("click",async()=>{
    const st=b.getAttribute("data-st");
    const note = (st==="resolved"||st==="closed") ? (prompt("Add a resolution note (optional):","")||"") : "";
    const { error }=await sb().rpc("set_issue_status",{ p_id:id, p_status:st, p_note:note||null });
    if(error){ alert(error.message); return; } window.OPS.flashTop("Status updated ✓"); detail(id, mode, canManage);
  }));
}

window.OPS.routes.issue_report = ()=>listView("pilot");
window.OPS.routes.vendor_issues = ()=>listView("vendor");
window.OPS.routes.field_issues  = ()=>listView("internal");
})();
