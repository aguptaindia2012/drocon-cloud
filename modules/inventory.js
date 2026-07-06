/* ============================================================================
   DroCon Cloud — Inventory
   Two views (sub-tabs):
     • Adjust stock — quick bulk +Purchased / −Sold grid across spares.
     • Entries      — the full ledger of every stock entry (purchase or sale),
                      carrying the purchase invoice no. (hand-entered) and the
                      sales invoice no. (hand-entered, or auto-stamped when an
                      invoice was saved with "reduce spare stock" ticked).
   Creating an entry is immediate. EDITING an existing entry is held for
   approval — the change only takes effect once a designated approver/admin
   approves it (enforced by RLS + propose/approve RPCs).
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const isApprover = ()=> window.OPS.isAdmin() || (window.OPS.isApprover && window.OPS.isApprover());

function subnav(active){
  return `<div class="row wrap" style="margin:6px 0 12px">
    <button class="btn sm ${active==='adjust'?'green':''}" id="ivAdjust">Adjust stock</button>
    <button class="btn sm ${active==='entries'?'green':''}" id="ivEntries">Entries (ledger)</button>
  </div>`;
}
function wireSubnav(){
  if($("ivAdjust")) $("ivAdjust").addEventListener("click",view);
  if($("ivEntries")) $("ivEntries").addEventListener("click",entriesView);
}

/* ------------------------------- Adjust stock ------------------------------- */
let pending={};   // { spareId: {purchased, sold} } — survives search re-render
async function view(){
  pending={};
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Finance</div><h1>Inventory</h1>${subnav('adjust')}
    <div class="callout">Enter quantities <b>Purchased</b> (adds stock) and/or <b>Sold/Issued</b> (subtracts stock) against any spares, then click <b>Save changes</b>. For entries that need an invoice number, use <b>Entries → + New entry</b>.</div>
    <div class="row wrap" style="margin:10px 0;align-items:flex-end">
      <input id="iSearch" placeholder="Search spare…" style="max-width:240px">
      <div class="field" style="margin:0;max-width:170px"><label>Movement date</label><input id="iDate" type="date" value="${todayISO()}"></div>
      <div class="spacer"></div>
      <button class="btn green" id="iSave">Save changes</button>
    </div>
    <div id="iList" class="muted">Loading…</div>
    <div class="err" id="iErr"></div>`;
  wireSubnav();
  const { data }=await sb().from("spare_catalogue").select("*").order("name");
  const all=data||[];
  function newStock(r){ const p=pending[r.id]||{}; return num(r.current_stock)+num(p.purchased)-num(p.sold); }
  function render(rows){
    let low=0;
    $("iList").innerHTML = `<div style="overflow:auto"><table><thead><tr><th>Spare</th><th>HSN</th><th>Unit</th><th class="num">In Stock</th><th class="num">Purchased +</th><th class="num">Sold −</th><th class="num">New stock</th></tr></thead>
      <tbody>${rows.map(r=>{ if(num(r.current_stock)<=0) low++; const p=pending[r.id]||{}; return `<tr data-row="${r.id}">
        <td><b>${esc(r.name)}</b></td><td>${esc(r.hsn_code||'')}</td><td>${esc(r.unit||'')}</td>
        <td class="num" style="${num(r.current_stock)<=0?'color:#a3322a;font-weight:700':''}">${num(r.current_stock)}</td>
        <td class="num"><input data-id="${r.id}" data-k="purchased" type="number" step="any" min="0" value="${p.purchased!=null?esc(p.purchased):''}" style="width:84px;text-align:right" placeholder="0"></td>
        <td class="num"><input data-id="${r.id}" data-k="sold" type="number" step="any" min="0" value="${p.sold!=null?esc(p.sold):''}" style="width:84px;text-align:right" placeholder="0"></td>
        <td class="num" data-new="${r.id}"><b>${newStock(r)}</b></td>
      </tr>`; }).join("")}</tbody></table></div>
      <p class="muted">${rows.length} spares · ${low} at/below zero.</p>`;
    $("iList").querySelectorAll("input[data-k]").forEach(inp=>inp.addEventListener("input",()=>{
      const id=inp.getAttribute("data-id"), k=inp.getAttribute("data-k");
      pending[id]=pending[id]||{}; pending[id][k]=inp.value;
      const r=all.find(x=>x.id===id); const cell=$("iList").querySelector(`[data-new="${id}"]`); if(cell) cell.innerHTML="<b>"+newStock(r)+"</b>";
    }));
  }
  function applyFilter(){ const q=($("iSearch").value||"").toLowerCase().trim(); render(!q?all:all.filter(r=>String(r.name||"").toLowerCase().includes(q))); }
  applyFilter();
  $("iSearch").addEventListener("input",applyFilter);
  $("iSave").addEventListener("click",async()=>{
    const date=$("iDate").value||todayISO(); const moves=[];
    Object.keys(pending).forEach(id=>{ const p=pending[id];
      if(num(p.purchased)>0) moves.push({ spare_id:id, qty:num(p.purchased), direction:"in",  reason:"purchase", moved_on:date, created_by:window.OPS.me.id });
      if(num(p.sold)>0)      moves.push({ spare_id:id, qty:num(p.sold),      direction:"out", reason:"issue",    moved_on:date, created_by:window.OPS.me.id });
    });
    if(!moves.length){ $("iErr").textContent="Enter a Purchased or Sold quantity on at least one spare."; return; }
    $("iSave").disabled=true;
    const { error }=await sb().from("inventory_moves").insert(moves);
    $("iSave").disabled=false;
    if(error){ $("iErr").textContent=error.message; return; }
    window.OPS.audit("inventory_adjust","inventory_moves","batch",moves.length+" move(s)");
    window.OPS.flashTop("Saved "+moves.length+" stock movement(s) ✓"); view();
  });
}

/* --------------------------------- Entries ---------------------------------- */
let entries=[], spares=[], eq="", edir="", estatus="";
async function entriesView(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Finance</div><h1>Inventory — Entries</h1>${subnav('entries')}
    <div class="callout">Every stock entry — <b>Purchased</b> or <b>Sold</b> — with its purchase and sales invoice numbers. Creating an entry is immediate. <b>Editing</b> an existing entry is sent for approval and only takes effect once the designated approver/admin approves it.</div>
    <div class="row wrap" style="margin:8px 0;align-items:flex-end">
      <input id="enSearch" placeholder="Search spare / invoice / reason…" style="max-width:260px" value="${esc(eq)}">
      <div class="field" style="margin:0"><label>Type</label><select id="enDir"><option value="">All</option><option value="in">Purchased</option><option value="out">Sold</option></select></div>
      <div class="field" style="margin:0"><label>Status</label><select id="enStatus"><option value="">All</option><option value="approved">Approved</option><option value="submitted">Edit in review</option></select></div>
      <div class="spacer"></div>
      <button class="btn green sm" id="enNew">+ New entry</button>
    </div>
    <div id="enList" class="muted">Loading…</div>`;
  wireSubnav();
  $("enNew").addEventListener("click",()=>editEntry(null));
  $("enSearch").addEventListener("input",e=>{ eq=e.target.value.toLowerCase().trim(); renderEntries(); });
  $("enDir").addEventListener("change",e=>{ edir=e.target.value; renderEntries(); });
  $("enStatus").addEventListener("change",e=>{ estatus=e.target.value; renderEntries(); });
  if(!spares.length){ const { data }=await sb().from("spare_catalogue").select("id,name,unit").order("name"); spares=data||[]; }
  const { data, error }=await sb().from("inventory_moves").select("*, spare:spare_id(name,unit)").order("created_at",{ascending:false}).limit(500);
  if(error){ $("enList").innerHTML='<div class="card">Error: '+esc(error.message)+'</div>'; return; }
  entries=data||[];
  $("enDir").value=edir; $("enStatus").value=estatus;
  renderEntries();
}
function renderEntries(){
  const rows=entries.filter(r=>{
    if(edir && r.direction!==edir) return false;
    if(estatus && (r.approval_status||"approved")!==estatus) return false;
    if(eq){ const hay=[r.spare&&r.spare.name, r.purchase_invoice_no, r.sales_invoice_no, r.reason].some(v=>String(v||"").toLowerCase().includes(eq)); if(!hay) return false; }
    return true;
  });
  $("enList").innerHTML = rows.length?`<div style="overflow:auto"><table><thead><tr><th>Date</th><th>Spare</th><th>Type</th><th class="num">Qty</th><th>Purchase Inv#</th><th>Sales Inv#</th><th>Reason</th><th>Status</th></tr></thead>
    <tbody>${rows.map(r=>`<tr class="clickable" data-id="${r.id}"><td>${fmtDate(r.moved_on)}</td><td><b>${esc(r.spare&&r.spare.name||'')}</b></td>
      <td>${r.direction==='in'?'<span class="chip approved">Purchased</span>':'<span class="chip rejected">Sold</span>'}</td>
      <td class="num">${num(r.qty)}</td><td>${esc(r.purchase_invoice_no||'')}</td><td>${esc(r.sales_invoice_no||'')}</td><td>${esc(r.reason||'')}</td>
      <td>${r.approval_status==='submitted'?'<span class="chip in_review">edit in review</span>':'<span class="chip approved">OK</span>'}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted">${rows.length} entr${rows.length===1?'y':'ies'}.</p>`
    :'<div class="card muted">No entries match.</div>';
  $("enList").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>editEntry(entries.find(x=>String(x.id)===tr.getAttribute("data-id")))));
}

async function editEntry(row){
  const m=$("main"); const isNew=!row; const admin=isApprover();
  if(!spares.length){ const { data }=await sb().from("spare_catalogue").select("id,name,unit").order("name"); spares=data||[]; }
  const cur = row ? { spare_id:row.spare_id, direction:row.direction, qty:row.qty, moved_on:(row.moved_on||"").slice(0,10), reason:row.reason||"", purchase_invoice_no:row.purchase_invoice_no||"", sales_invoice_no:row.sales_invoice_no||"" }
                  : { spare_id:(spares[0]&&spares[0].id)||"", direction:"in", qty:"", moved_on:todayISO(), reason:"purchase", purchase_invoice_no:"", sales_invoice_no:"" };
  m.innerHTML=`<button class="btn sm" id="enBack">← Back to Entries</button>
    <div class="card" style="margin-top:12px;max-width:640px"><div class="eyebrow">Finance · Inventory entry</div><h1>${isNew?"New entry":"Edit entry"}</h1>
    ${row&&row.approval_status==='submitted'?'<div class="callout warn">This entry already has an edit awaiting approval. Saving again replaces that pending edit.</div>':''}
    ${row&&row.reject_note?`<div class="callout">A previous edit was rejected: ${esc(row.reject_note)}</div>`:''}
    ${(!isNew && !admin)?'<div class="callout">Your change will be <b>sent for approval</b> and will only take effect once approved.</div>':''}
    <div class="fgrid">
      <div class="field full"><label>Spare *</label><select id="e_spare">${spares.map(s=>`<option value="${s.id}" ${cur.spare_id===s.id?'selected':''}>${esc(s.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Type *</label><select id="e_dir"><option value="in" ${cur.direction==='in'?'selected':''}>Purchased (in)</option><option value="out" ${cur.direction==='out'?'selected':''}>Sold / Issued (out)</option></select></div>
      <div class="field"><label>Quantity *</label><input id="e_qty" type="number" step="any" min="0" value="${esc(cur.qty)}"></div>
      <div class="field"><label>Date</label><input id="e_date" type="date" value="${esc(cur.moved_on)}"></div>
      <div class="field"><label>Purchase invoice no.</label><input id="e_purch" value="${esc(cur.purchase_invoice_no)}" placeholder="hand-entered"></div>
      <div class="field"><label>Sales invoice no.</label><input id="e_sales" value="${esc(cur.sales_invoice_no)}" placeholder="hand-entered or from invoice"></div>
      <div class="field full"><label>Reason / note</label><input id="e_reason" value="${esc(cur.reason)}"></div>
      ${(!isNew && !admin)?`<div class="field full"><label>Send approval to *</label><select id="e_approver"><option value="">— select approver —</option></select></div>`:''}
    </div>
    <div class="row"><button class="btn green" id="enSave">${isNew?"Create entry":(admin?"Save changes":"Submit for approval")}</button><button class="btn" id="enCancel">Cancel</button>
      <div class="spacer"></div>${(row&&isApprover())?'<button class="btn sm" id="enDel" style="color:#a3322a;border-color:#e4b4b4">Delete</button>':''}</div>
    <div class="err" id="enErr"></div></div>`;
  $("enBack").addEventListener("click",entriesView); $("enCancel").addEventListener("click",entriesView);
  if($("e_approver")){ window.OPS.listProfiles().then(ps=>{ const opts=(ps||[]).filter(p=>!p.is_external && p.id!==window.OPS.me.id);
    $("e_approver").innerHTML='<option value="">— select approver —</option>'+opts.map(p=>`<option value="${p.id}">${esc(p.full_name||p.email)} (${esc(p.role)})</option>`).join(""); }); }
  if($("enDel")) $("enDel").addEventListener("click",async()=>{ if(!confirm("Delete this entry? Stock will be adjusted back."))return;
    const { error }=await sb().from("inventory_moves").delete().eq("id",row.id); if(error){ alert(error.message); return; }
    window.OPS.audit("deleted","inventory_moves",row.id,(row.spare&&row.spare.name)||""); window.OPS.flashTop("Entry deleted ✓"); entriesView(); });
  $("enSave").addEventListener("click",async()=>{
    const vals={ spare_id:$("e_spare").value, direction:$("e_dir").value, qty:num($("e_qty").value),
      moved_on:$("e_date").value||todayISO(), reason:$("e_reason").value||null,
      purchase_invoice_no:$("e_purch").value||null, sales_invoice_no:$("e_sales").value||null };
    if(!vals.spare_id){ $("enErr").textContent="Choose a spare."; return; }
    if(!(vals.qty>0)){ $("enErr").textContent="Enter a quantity greater than zero."; return; }
    $("enSave").disabled=true;
    if(isNew){
      const { error }=await sb().from("inventory_moves").insert(Object.assign({ created_by:window.OPS.me.id }, vals));
      $("enSave").disabled=false; if(error){ $("enErr").textContent=error.message; return; }
      window.OPS.audit("created","inventory_moves","new", vals.direction+" "+vals.qty); window.OPS.flashTop("Entry created ✓"); entriesView(); return;
    }
    if(admin){
      const { error }=await sb().from("inventory_moves").update(vals).eq("id",row.id);
      $("enSave").disabled=false; if(error){ $("enErr").textContent=error.message; return; }
      window.OPS.audit("edited","inventory_moves",row.id,"direct edit (approver)"); window.OPS.flashTop("Saved ✓"); entriesView(); return;
    }
    // non-admin: park the change for approval — nothing changes until approved
    const approver=$("e_approver")?$("e_approver").value:"";
    if(!approver){ $("enSave").disabled=false; $("enErr").textContent="Choose who should approve this change."; return; }
    const { error }=await sb().rpc("propose_inventory_edit",{ p_id:row.id, p_changes:vals, p_approver:approver });
    $("enSave").disabled=false; if(error){ $("enErr").textContent=error.message; return; }
    window.OPS.audit("edit_requested","inventory_moves",row.id,"proposed edit sent for approval");
    try{ await sb().from("notifications").insert({ user_id:approver, message:"Review: inventory entry edit ("+((row.spare&&row.spare.name)||"")+")" }); }catch(e){}
    window.OPS.refreshNotifs&&window.OPS.refreshNotifs(); window.OPS.refreshReviewCount&&window.OPS.refreshReviewCount();
    window.OPS.flashTop("Edit submitted for approval ✓"); entriesView();
  });
}

window.OPS.routes.inventory = view;
})();
