/* ============================================================================
   DroCon Cloud — Inventory
   Shows current stock per spare and records stock moves (in/out). The DB
   trigger keeps spare_catalogue.current_stock in sync. Invoices can later push
   an automatic 'out' move; here we support manual receipts/issues/adjustments.
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;

let pending={};   // { spareId: {purchased, sold} } — survives search re-render
async function view(){
  pending={};
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Finance</div><h1>Inventory</h1>
    <div class="callout">Enter quantities <b>Purchased</b> (adds stock) and/or <b>Sold/Issued</b> (subtracts stock) against any spares, then click <b>Save changes</b>. You can update many rows at once.</div>
    <div class="row wrap" style="margin:10px 0;align-items:flex-end">
      <input id="iSearch" placeholder="Search spare…" style="max-width:240px">
      <div class="field" style="margin:0;max-width:170px"><label>Movement date</label><input id="iDate" type="date" value="${todayISO()}"></div>
      <div class="spacer"></div>
      <button class="btn sm" id="iMoves">Recent moves</button>
      <button class="btn green" id="iSave">Save changes</button>
    </div>
    <div id="iList" class="muted">Loading…</div>
    <div class="err" id="iErr"></div>`;
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
  $("iMoves").addEventListener("click",recentMoves);
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

async function recentMoves(){
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="rBack">← Back to Inventory</button>
    <h1 style="margin-top:12px">Recent stock moves</h1><div id="rHost" class="muted">Loading…</div>`;
  $("rBack").addEventListener("click",view);
  const { data }=await sb().from("inventory_moves").select("*, spare:spare_id(name,unit)").order("created_at",{ascending:false}).limit(100);
  const rows=data||[];
  $("rHost").innerHTML = rows.length ? `<table><thead><tr><th>Date</th><th>Spare</th><th>Direction</th><th class="num">Qty</th><th>Reason</th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td>${fmtDate(r.moved_on)}</td><td>${esc(r.spare&&r.spare.name||'')}</td>
      <td>${r.direction==='in'?'<span class="chip approved">IN</span>':'<span class="chip rejected">OUT</span>'}</td>
      <td class="num">${num(r.qty)}</td><td>${esc(r.reason||'')}</td></tr>`).join("")}</tbody></table>`
    : '<div class="card muted">No moves recorded yet.</div>';
}

window.OPS.routes.inventory = view;
})();
