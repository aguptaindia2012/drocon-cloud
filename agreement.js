/* ============================================================================
   DroCon Cloud — Agreement section (the original Agreement Studio)
   Views: agreements list, new/edit, approvals, detail, team+access, templates,
   audit, and the embedded Studio document editor. Registered into OPS.routes.
   Relies on globals from app.js: sb, me, profile, $, esc, fmt, statusChip,
   audit, listProfiles, isAdmin, isApprover.
   ============================================================================ */
(function(){
const R = window.OPS.routes;
const back = ()=> window.OPS.openTool("agreements");

async function listAgreements(filter){
  let q = sb.from("agreements").select("*, creator:created_by(full_name,email), approver:assigned_approver(full_name,email)").order("updated_at",{ascending:false});
  if(filter==="mine") q=q.eq("created_by", me.id);
  if(filter==="review") q=q.eq("status","in_review");
  if(filter==="draft") q=q.eq("status","draft");
  const { data, error } = await q;
  if(error){ console.error(error); return []; }
  return data||[];
}

async function viewAgreements(){
  const m=$("main"); m.innerHTML=`<div class="eyebrow">Agreement</div><h1>Agreements</h1>
    <div class="row" style="margin:10px 0"><button class="btn sm" data-f="all">All</button>
    <button class="btn sm" data-f="draft">Drafts</button>
    <button class="btn sm" data-f="mine">Mine</button>
    <button class="btn sm" data-f="review">In review</button>
    <div class="spacer"></div><button class="btn green sm" id="newBtn">+ New agreement</button></div>
    <div id="listHost" class="muted">Loading…</div>`;
  $("newBtn").addEventListener("click",()=>window.OPS.openTool("new"));
  m.querySelectorAll("[data-f]").forEach(b=>b.addEventListener("click",()=>load(b.getAttribute("data-f"))));
  async function load(f){
    const rows=await listAgreements(f==="all"?null:f);
    $("listHost").innerHTML = rows.length? `<table><thead><tr><th>Title</th><th>Counterparty</th><th>Type</th><th>Status</th><th>Owner</th><th>Updated</th></tr></thead>
      <tbody>${rows.map(r=>`<tr class="clickable" data-id="${r.id}">
        <td><b>${esc(r.title)}</b></td><td>${esc(r.counterparty||"")}</td><td>${esc(r.category||"")}</td>
        <td>${statusChip(r.status)}</td><td>${esc((r.creator&&(r.creator.full_name||r.creator.email))||"")}</td><td class="muted">${fmt(r.updated_at)}</td>
      </tr>`).join("")}</tbody></table>` : '<div class="card muted">No agreements yet. Click “New agreement”.</div>';
    $("listHost").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>viewDetail(tr.getAttribute("data-id"))));
  }
  load("all");
}

async function viewApprovals(){
  const m=$("main"); m.innerHTML=`<div class="eyebrow">Review queue</div><h1>Approvals</h1>
    <p class="muted">Agreements submitted for review. Approve or reject with a note.</p><div id="listHost" class="muted">Loading…</div>`;
  const rows=await listAgreements("review");
  $("listHost").innerHTML = rows.length? `<table><thead><tr><th>Title</th><th>Counterparty</th><th>Owner</th><th>Submitted</th><th></th></tr></thead>
    <tbody>${rows.map(r=>`<tr class="clickable" data-id="${r.id}"><td><b>${esc(r.title)}</b></td><td>${esc(r.counterparty||"")}</td>
      <td>${esc((r.creator&&(r.creator.full_name||r.creator.email))||"")}</td><td class="muted">${fmt(r.updated_at)}</td>
      <td><button class="btn sm">Open</button></td></tr>`).join("")}</tbody></table>` : '<div class="card muted">Nothing awaiting review. 🎉</div>';
  $("listHost").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>viewDetail(tr.getAttribute("data-id"))));
}

function viewForm(existing){
  const e=existing||{};
  const m=$("main"); m.innerHTML=`<div class="eyebrow">${existing?"Edit":"Create"}</div><h1>${existing?"Edit agreement":"New agreement"}</h1>
    <div class="card">
    <div class="fgrid">
      <div class="field full"><label>Title</label><input id="fTitle" value="${esc(e.title||"")}" placeholder="e.g. Aggregator Agreement — Acme"></div>
      <div class="field"><label>Counterparty</label><input id="fCp" value="${esc(e.counterparty||"")}"></div>
      <div class="field"><label>Type</label><select id="fCat">
        ${["client","vendor","module","Authorized Partner"].map(c=>`<option ${e.category===c?'selected':''}>${c}</option>`).join("")}</select></div>
      <div class="field"><label>Template key (optional)</label><input id="fTpl" value="${esc(e.template_key||"")}" placeholder="aggregator / entrepreneur / pm_engagement…"></div>
      <div class="field"><label>Assign approver</label><select id="fApp"></select></div>
      <div class="field full"><label>Draft data (JSON from the desktop Studio — optional)</label>
        <textarea id="fData" placeholder='Paste a "Save JSON draft" export here, or use Import.'>${e.data?esc(JSON.stringify(e.data,null,2)):""}</textarea>
        <div class="row" style="margin-top:6px"><button class="btn sm" id="impBtn">Import JSON file…</button>
        <span class="muted">Links this record to a draft built in the offline Studio.</span></div>
      </div>
    </div>
    <div class="row"><button class="btn green" id="saveBtn">${existing?"Save changes":"Create (as Draft)"}</button>
      <button class="btn" id="cancelBtn">Cancel</button></div>
    <div class="err" id="fErr"></div>
    </div>`;
  listProfiles().then(ps=>{
    const approvers=ps.filter(p=>p.role==="approver"||p.role==="admin");
    $("fApp").innerHTML = '<option value="">— none —</option>'+approvers.map(p=>`<option value="${p.id}" ${e.assigned_approver===p.id?'selected':''}>${esc(p.full_name||p.email)} (${p.role})</option>`).join("");
  });
  $("impBtn").addEventListener("click",()=>{ $("jsonImport").onchange=ev=>{ const f=ev.target.files[0]; if(!f)return;
    const r=new FileReader(); r.onload=()=>{ try{ const o=JSON.parse(r.result); $("fData").value=JSON.stringify(o.draft||o,null,2);
      if(!$("fTitle").value && o.draft){ $("fTitle").value=(o.draft.title||"")+" — "+((o.draft.fields&&o.draft.fields.cpName)||""); }
    }catch(err){ alert("Not valid JSON"); } }; r.readAsText(f); $("jsonImport").value=""; }; $("jsonImport").click();
  });
  $("cancelBtn").addEventListener("click",back);
  $("saveBtn").addEventListener("click",async()=>{
    const title=$("fTitle").value.trim(); if(!title){ $("fErr").textContent="Title is required."; return; }
    let data=null; const raw=$("fData").value.trim(); if(raw){ try{ data=JSON.parse(raw); }catch(e){ $("fErr").textContent="Draft data is not valid JSON."; return; } }
    const rec={ title, counterparty:$("fCp").value.trim(), category:$("fCat").value, template_key:$("fTpl").value.trim()||null,
      assigned_approver:$("fApp").value||null, data };
    if(existing){
      const { error }=await sb.from("agreements").update(rec).eq("id",existing.id);
      if(error){ $("fErr").textContent=error.message; return; }
      await audit("edited","agreement",existing.id,"edited fields"); viewDetail(existing.id);
    }else{
      rec.created_by=me.id; rec.status="draft";
      const { data:ins, error }=await sb.from("agreements").insert(rec).select().single();
      if(error){ $("fErr").textContent=error.message; return; }
      await audit("created","agreement",ins.id,title); viewDetail(ins.id);
    }
  });
}

async function viewDetail(id){
  const { data:r, error }=await sb.from("agreements").select("*, creator:created_by(full_name,email), approver:assigned_approver(full_name,email)").eq("id",id).single();
  if(error||!r){ $("main").innerHTML='<div class="card">Not found.</div>'; return; }
  const { data:events }=await sb.from("audit_log").select("*, who:actor(full_name,email)").eq("entity","agreement").eq("entity_id",id).order("created_at",{ascending:false});
  const owner = r.created_by===me.id;
  const isExec = r.status==="executed";
  const canEditDoc  = !isExec && ( (owner && (r.status==="draft"||r.status==="rejected")) || isApprover() );
  const canSubmit   = owner && (r.status==="draft"||r.status==="rejected");
  const adminCanDecide    = isAdmin() && (r.status==="in_review"||r.status==="recommended");
  const approverCanDecide = profile.role==="approver" && r.status==="in_review" && !owner;
  const canApprove = adminCanDecide || approverCanDecide;
  const canReject  = (adminCanDecide || approverCanDecide);
  const approveLabel = isAdmin() ? "Approve (final)" : "Approve & recommend";
  const canExecute = isApprover() && r.status==="approved";
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="back">← Back</button>
    <div class="card" style="margin-top:12px">
      <div class="row"><div><div class="eyebrow">${esc(r.category||"")}</div><h1 style="margin:2px 0">${esc(r.title)}</h1></div>
        <div class="spacer"></div>${statusChip(r.status)}</div>
      <p class="muted">Counterparty: <b>${esc(r.counterparty||"—")}</b> · Template: ${esc(r.template_key||"—")} ·
        Owner: ${esc((r.creator&&(r.creator.full_name||r.creator.email))||"")} ·
        Approver: ${esc((r.approver&&(r.approver.full_name||r.approver.email))||"unassigned")}</p>
      ${r.status==="recommended"?'<div class="callout">Reviewed and <b>recommended</b> — awaiting an <b>admin</b> for final approval.</div>':''}
      <div class="row wrap" style="margin-top:8px">
        ${canEditDoc?'<button class="btn green sm" id="editdoc">✎ Open document editor</button>':''}
        <button class="btn sm" id="editmeta">Edit details</button>
        ${canSubmit?'<button class="btn orange sm" id="submit">Submit for review</button>':''}
        ${canApprove?`<button class="btn green sm" id="approve">${approveLabel}</button>`:''}
        ${canReject?'<button class="btn sm" id="reject" style="color:#a3322a;border-color:#e4b4b4">Reject…</button>':''}
        ${canExecute?'<button class="btn blue sm" id="execute">Mark executed (signed)</button>':''}
        ${r.data?'<button class="btn sm" id="dl">Download draft JSON</button>':''}
        ${(isAdmin()||(owner&&r.status==='draft'))?'<button class="btn sm" id="del" style="color:#a3322a;border-color:#e4b4b4">Delete</button>':''}
      </div>
    </div>
    <div class="card"><h3>History</h3>
      ${ (events&&events.length)? events.map(ev=>`<div class="evt"><b>${esc(ev.action)}</b> — ${esc((ev.who&&(ev.who.full_name||ev.who.email))||"")} <span class="muted">· ${fmt(ev.created_at)}</span>${ev.note?`<br>${esc(ev.note)}`:""}</div>`).join("") : '<div class="muted">No history yet.</div>' }
    </div>`;
  $("back").addEventListener("click",back);
  if($("editdoc")) $("editdoc").addEventListener("click",()=>viewStudio(r));
  if($("editmeta")) $("editmeta").addEventListener("click",()=>viewForm(r));
  if($("submit")) $("submit").addEventListener("click",()=>runRpc("submit_for_review",{p_id:r.id},r.id));
  if($("approve")) $("approve").addEventListener("click",()=>runRpc("approve_agreement",{p_id:r.id,p_note:null},r.id));
  if($("reject")) $("reject").addEventListener("click",()=>{ const note=prompt("Reason for rejection / changes requested:"); if(note===null) return; runRpc("reject_agreement",{p_id:r.id,p_note:note||null},r.id); });
  if($("execute")) $("execute").addEventListener("click",()=>runRpc("mark_executed",{p_id:r.id,p_note:null},r.id));
  if($("dl")) $("dl").addEventListener("click",()=>{ const blob=new Blob([JSON.stringify({draft:r.data},null,2)],{type:"application/json"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=(r.title||"agreement")+".json"; a.click(); });
  if($("del")) $("del").addEventListener("click",async()=>{ if(!confirm("Delete this agreement?"))return;
    await sb.from("agreements").delete().eq("id",id); await audit("deleted","agreement",id,r.title); back(); });
}
async function runRpc(fn, args, agId){
  const { error }=await sb.rpc(fn, args);
  if(error){ alert(error.message); return; }
  window.OPS.refreshNotifs(); viewDetail(agId);
}

async function viewTeam(){
  const m=$("main"); m.innerHTML=`<div class="eyebrow">Administration</div><h1>Team &amp; access</h1>
    <div class="callout">The first person to sign up is the <b>admin</b>. Assign roles, then grant each person access to the specific <b>Administration</b> tools they need.</div>
    <h3>Roles</h3><div id="teamHost" class="muted">Loading…</div>
    <h3 style="margin-top:22px">Tool access</h3>
    <p class="muted">Pick a section, tick the tools each member may use, then <b>Save changes</b>. Changes across sections are saved together. Admins always have full access.</p>
    <div class="row wrap" style="margin-bottom:8px"><label style="margin:0">Section</label><select id="permSection" style="width:auto"></select>
      <div class="spacer"></div><button class="btn green sm" id="permSave">Save changes</button><span id="permStatus" class="muted"></span></div>
    <div id="permHost" class="muted">Loading…</div>`;
  const ps=await listProfiles();
  $("teamHost").innerHTML=`<table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead><tbody>
    ${ps.map(p=>`<tr><td>${esc(p.full_name||"")}</td><td>${esc(p.email||"")}</td>
      <td><select data-uid="${p.id}" ${p.id===me.id?'disabled':''}>
        ${["admin","approver","drafter","viewer"].map(r=>`<option value="${r}" ${p.role===r?'selected':''}>${r}</option>`).join("")}
      </select></td><td class="muted">${fmt(p.created_at)}</td></tr>`).join("")}
  </tbody></table><p class="muted">Tip: you cannot change your own role (prevents lock-out).</p>`;
  $("teamHost").querySelectorAll("select[data-uid]").forEach(s=>s.addEventListener("change",async()=>{
    const { error }=await sb.rpc("admin_set_role",{ target:s.getAttribute("data-uid"), new_role:s.value });
    if(error) alert(error.message); else { s.style.borderColor="var(--green)"; }
  }));

  // ----- Tool access: select a section, edit locally, then Save -----
  const PT=window.OPS.PERMISSIONED_TOOLS, CAPS=window.OPS.CAPABILITIES||[];
  const groups=window.OPS.SECTIONS.filter(s=>PT.some(t=>t.section===s.key)).map(s=>({key:s.key,label:s.label,tools:PT.filter(t=>t.section===s.key)}));
  groups.push({key:"_caps",label:"Capabilities",tools:CAPS});
  const members=ps.filter(p=>p.role!=="admin");
  const { data:permRows }=await sb.from("app_permissions").select("user_id,tool_key");
  let granted=new Set((permRows||[]).map(r=>r.user_id+"|"+r.tool_key));
  let working=new Set(granted);
  $("permSection").innerHTML=groups.map(g=>`<option value="${g.key}">${esc(g.label)}</option>`).join("");
  function renderPerm(){
    if(!members.length){ $("permHost").innerHTML='<div class="muted">No non-admin members yet.</div>'; return; }
    const g=groups.find(x=>x.key===$("permSection").value)||groups[0];
    $("permHost").innerHTML=`<div style="overflow:auto"><table><thead><tr><th>Member</th>${g.tools.map(t=>`<th style="text-align:center">${esc(t.label)}</th>`).join("")}</tr></thead>
      <tbody>${members.map(p=>`<tr><td><b>${esc(p.full_name||p.email)}</b><br><span class="muted">${esc(p.role)}</span></td>
        ${g.tools.map(t=>`<td style="text-align:center"><input type="checkbox" style="width:auto" data-u="${p.id}" data-t="${t.key}" ${working.has(p.id+"|"+t.key)?"checked":""}></td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    $("permHost").querySelectorAll("input[type=checkbox]").forEach(cb=>cb.addEventListener("change",()=>{
      const k=cb.getAttribute("data-u")+"|"+cb.getAttribute("data-t");
      if(cb.checked) working.add(k); else working.delete(k);
      $("permStatus").textContent=" unsaved changes…"; $("permStatus").style.color="var(--orange)";
    }));
  }
  $("permSection").addEventListener("change",renderPerm);
  $("permSave").addEventListener("click",async()=>{
    const all=new Set([...granted,...working]); const changes=[];
    all.forEach(k=>{ if(working.has(k)!==granted.has(k)){ const i=k.indexOf("|"); changes.push({u:k.slice(0,i),t:k.slice(i+1),grant:working.has(k)}); } });
    if(!changes.length){ $("permStatus").textContent=" nothing to save"; $("permStatus").style.color="var(--muted)"; return; }
    $("permSave").disabled=true; $("permStatus").textContent=" saving…";
    for(const c of changes){ const { error }=await sb.rpc("admin_set_permission",{ target:c.u, p_tool:c.t, p_grant:c.grant }); if(error){ alert(error.message); } }
    granted=new Set(working); $("permSave").disabled=false;
    $("permStatus").textContent=" ✓ saved "+changes.length+" change(s)"; $("permStatus").style.color="var(--green)";
  });
  renderPerm();
}

async function viewTemplates(){
  const m=$("main"); m.innerHTML=`<div class="eyebrow">Standards</div><h1>Shared templates</h1>
    <div class="callout">Saved here, a template's clauses become the standard for the <b>whole team</b>.</div>
    <div class="field"><label>Template key</label><input id="tKey" placeholder="aggregator"></div>
    <div class="field"><label>Clauses (JSON array)</label><textarea id="tJson" style="min-height:200px" placeholder='[ { "id":"scope", "title":"Scope", "body":"<p>…</p>", "on":true } ]'></textarea></div>
    <div class="row"><button class="btn sm" id="tLoad">Load</button><button class="btn green sm" id="tSave">Save to team</button></div>
    <div class="err" id="tErr"></div>
    <h3 style="margin-top:20px">Current shared templates</h3><div id="tList" class="muted">Loading…</div>`;
  async function refresh(){ const { data }=await sb.from("template_overrides").select("template_key, updated_at, updater:updated_by(full_name,email)").order("updated_at",{ascending:false});
    $("tList").innerHTML=(data&&data.length)? `<table><thead><tr><th>Template</th><th>Updated by</th><th>When</th></tr></thead><tbody>${data.map(x=>`<tr><td><b>${esc(x.template_key)}</b></td><td>${esc((x.updater&&(x.updater.full_name||x.updater.email))||"")}</td><td class="muted">${fmt(x.updated_at)}</td></tr>`).join("")}</tbody></table>`:'<div class="muted">No shared overrides yet.</div>'; }
  $("tLoad").addEventListener("click",async()=>{ const k=$("tKey").value.trim(); if(!k)return;
    const { data }=await sb.from("template_overrides").select("clauses").eq("template_key",k).single();
    $("tJson").value = data? JSON.stringify(data.clauses,null,2) : ""; if(!data) $("tErr").textContent="No override for that key yet — paste clauses to create one."; else $("tErr").textContent=""; });
  $("tSave").addEventListener("click",async()=>{ const k=$("tKey").value.trim(); let clauses;
    try{ clauses=JSON.parse($("tJson").value); }catch(e){ $("tErr").textContent="Clauses must be valid JSON."; return; }
    if(!k){ $("tErr").textContent="Template key required."; return; }
    const { error }=await sb.from("template_overrides").upsert({ template_key:k, clauses, updated_by:me.id, updated_at:new Date().toISOString() });
    if(error){ $("tErr").textContent=error.message; return; }
    await audit("template_saved","template",k,"updated shared clauses"); $("tErr").innerHTML='<span class="ok">Saved for the team.</span>'; refresh();
  });
  refresh();
}

async function viewAudit(){
  const m=$("main"); m.innerHTML=`<div class="eyebrow">Compliance</div><h1>Audit log</h1><div id="aHost" class="muted">Loading…</div>`;
  const { data }=await sb.from("audit_log").select("*, who:actor(full_name,email)").order("created_at",{ascending:false}).limit(200);
  $("aHost").innerHTML=(data&&data.length)? `<table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Note</th></tr></thead><tbody>
    ${data.map(e=>`<tr><td class="muted">${fmt(e.created_at)}</td><td>${esc((e.who&&(e.who.full_name||e.who.email))||"")}</td><td><b>${esc(e.action)}</b></td><td>${esc(e.entity)} ${esc(e.entity_id||"")}</td><td>${esc(e.note||"")}</td></tr>`).join("")}
  </tbody></table>`:'<div class="muted">No activity yet.</div>';
}

/* ---------- embedded Studio document editor ---------- */
let currentEdit=null;
function viewStudio(rec){
  currentEdit = rec || null;
  window.OPS.currentTool="new"; window.OPS.renderNav();
  const m=$("main");
  m.innerHTML = `<div class="row" style="margin-bottom:8px;align-items:center">
      <div class="eyebrow">${rec?"Edit document":"New agreement"}</div>
      <span class="muted" style="margin-left:8px">${rec?esc(rec.title||""):"Pick a template, fill it in, then “Save to cloud” — it’s added to Agreements automatically."}</span>
      <div class="spacer"></div>
      <button class="btn sm" id="stClose">${rec?"← Back to agreement":"← Back to list"}</button>
    </div>
    <iframe id="studioFrame" title="Document editor" style="width:100%;height:calc(100vh - 210px);border:1px solid var(--line);border-radius:10px;background:#fff"></iframe>`;
  $("studioFrame").src = "studio.html?ts="+Date.now();
  $("stClose").addEventListener("click",()=>closeStudio());
}
function closeStudio(){
  if(currentEdit){ const id=currentEdit.id; currentEdit=null; viewDetail(id); }
  else window.OPS.openTool("agreements");
}
async function saveStudioDraft(d){
  if(!d){ return; }
  const cp = (d.fields && d.fields.cpName) || "";
  const baseTitle = d.title || "Agreement";
  const title = cp ? (baseTitle + " — " + cp) : baseTitle;
  const cat = d.cat || null; const tplKey = d.templateKey || null;
  if(!currentEdit){
    const rec={ title, counterparty:cp||null, category:cat, template_key:tplKey, status:"draft", created_by:me.id, data:d };
    const { data:ins, error }=await sb.from("agreements").insert(rec).select().single();
    if(error){ alert("Save failed: "+error.message); return; }
    currentEdit=ins; await audit("created","agreement",ins.id,title); window.OPS.flashTop("Added to Agreements ✓");
  } else {
    const patch={ data:d };
    if(cp) patch.counterparty=cp; if(title) patch.title=title;
    if(cat && !currentEdit.category) patch.category=cat;
    if(tplKey && !currentEdit.template_key) patch.template_key=tplKey;
    const { error }=await sb.from("agreements").update(patch).eq("id",currentEdit.id);
    if(error){ alert("Save failed: "+error.message); return; }
    currentEdit=Object.assign(currentEdit,patch); await audit("edited","agreement",currentEdit.id,"document updated in editor"); window.OPS.flashTop("Saved to cloud ✓");
  }
}
window.addEventListener("message",function(ev){
  const f=$("studioFrame"); if(!f || ev.source!==f.contentWindow) return;
  const msg=ev.data||{};
  if(msg.type==="dcb-ready"){ f.contentWindow.postMessage({type:"dcb-load", draft: currentEdit?currentEdit.data:null}, "*"); }
  else if(msg.type==="dcb-save"){ saveStudioDraft(msg.draft); }
  else if(msg.type==="dcb-close"){ closeStudio(); }
});

// register routes
R.agreements = viewAgreements;
R.new        = ()=>viewStudio(null);
R.approvals  = viewApprovals;
R.templates  = viewTemplates;
R.team       = viewTeam;
R.audit      = viewAudit;
R.viewAgreementDetail = viewDetail;
})();
