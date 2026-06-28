/* ============================================================================
   DroCon Cloud — Resources (Policies & shared documents) [#1]
   Documents are referenced by an external-drive LINK. Each can be opened
   (readable via the link) and shared over WhatsApp or Outlook/email.
   ============================================================================ */
(function(){
const { $, esc, fmt } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;

async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Resources</div><h1>Policies &amp; Documents</h1>
    <div class="row wrap" style="margin:10px 0"><input id="rSearch" placeholder="Search title / category…" style="max-width:280px">
      <div class="spacer"></div><button class="btn green sm" id="rNew">+ Add document</button></div>
    <div id="rList" class="muted">Loading…</div>`;
  $("rNew").addEventListener("click",()=>form(null));
  const { data }=await sb().from("resources").select("*, who:created_by(full_name,email)").order("category").order("title");
  const all=data||[];
  function render(rows){
    $("rList").innerHTML = rows.length ? `<table><thead><tr><th>Title</th><th>Category</th><th>Added by</th><th>Share</th></tr></thead>
      <tbody>${rows.map(r=>`<tr><td><b>${esc(r.title)}</b>${r.description?`<br><span class="muted">${esc(r.description)}</span>`:''}</td>
        <td>${esc(r.category||'')}</td><td class="muted">${esc((r.who&&(r.who.full_name||r.who.email))||'')}</td>
        <td><button class="btn sm" data-open="${r.id}">Open</button> <button class="btn sm" data-wa="${r.id}">WhatsApp</button> <button class="btn sm" data-mail="${r.id}">Outlook</button> <button class="btn sm" data-edit="${r.id}">Edit</button></td></tr>`).join("")}</tbody></table>`
      : '<div class="card muted">No documents yet. Click “Add document” and paste a drive link.</div>';
    const by=id=>all.find(x=>x.id===id);
    $("rList").querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>{ const r=by(b.getAttribute("data-open")); if(r&&r.link) window.open(r.link,"_blank"); else alert("No link on this document."); }));
    $("rList").querySelectorAll("[data-wa]").forEach(b=>b.addEventListener("click",()=>{ const r=by(b.getAttribute("data-wa")); window.open("https://wa.me/?text="+encodeURIComponent(r.title+(r.link?(" — "+r.link):"")),"_blank"); }));
    $("rList").querySelectorAll("[data-mail]").forEach(b=>b.addEventListener("click",()=>{ const r=by(b.getAttribute("data-mail")); window.location.href="mailto:?subject="+encodeURIComponent(r.title)+"&body="+encodeURIComponent((r.description?r.description+"\n\n":"")+(r.link||"")); }));
    $("rList").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>form(by(b.getAttribute("data-edit")))));
  }
  render(all);
  $("rSearch").addEventListener("input",e=>{ const q=e.target.value.toLowerCase().trim();
    render(!q?all:all.filter(r=>[r.title,r.category,r.description].some(v=>String(v||"").toLowerCase().includes(q)))); });
}

function form(rec){
  const e=rec||{}; const m=$("main");
  m.innerHTML=`<button class="btn sm" id="rBack">← Back to Resources</button>
    <div class="card" style="margin-top:12px"><h1>${rec?"Edit":"Add"} document</h1>
      <div class="fgrid">
        <div class="field full"><label>Title *</label><input id="dTitle" value="${esc(e.title||'')}"></div>
        <div class="field"><label>Category</label><input id="dCat" value="${esc(e.category||'')}" placeholder="Policy / SOP / Form…"></div>
        <div class="field full"><label>Document link (Google Drive / SharePoint URL)</label><input id="dLink" value="${esc(e.link||'')}" placeholder="https://…"></div>
        <div class="field full"><label>Description</label><textarea id="dDesc">${esc(e.description||'')}</textarea></div>
      </div>
      <div class="row"><button class="btn green" id="dSave">${rec?"Save":"Add"}</button><button class="btn" id="dCancel">Cancel</button>
        <div class="spacer"></div>${rec && window.OPS.canDelete()?'<button class="btn sm" id="dDel" style="color:#a3322a;border-color:#e4b4b4">Delete</button>':''}</div>
      <div class="err" id="dErr"></div></div>`;
  $("rBack").addEventListener("click",view); $("dCancel").addEventListener("click",view);
  $("dSave").addEventListener("click",async()=>{
    const title=$("dTitle").value.trim(); if(!title){ $("dErr").textContent="Title required."; return; }
    const out={ title, category:$("dCat").value||null, link:$("dLink").value.trim()||null, description:$("dDesc").value||null };
    if(rec){ const { error }=await sb().from("resources").update(out).eq("id",rec.id); if(error){ $("dErr").textContent=error.message; return; } }
    else { out.created_by=window.OPS.me.id; const { error }=await sb().from("resources").insert(out); if(error){ $("dErr").textContent=error.message; return; } }
    window.OPS.audit(rec?"edited":"created","resource",rec?rec.id:title,title); window.OPS.flashTop("Saved ✓"); view();
  });
  if($("dDel")) $("dDel").addEventListener("click",async()=>{ if(!confirm("Delete this document entry?"))return; await sb().from("resources").delete().eq("id",rec.id); window.OPS.audit("deleted","resource",rec.id,rec.title); view(); });
}

window.OPS.routes.resources = view;
})();
