/* ============================================================================
   DroCon Cloud — Inventory
   Shows current stock per spare and records stock moves (in/out). The DB
   trigger keeps spare_catalogue.current_stock in sync. Invoices can later push
   an automatic 'out' move; here we support manual receipts/issues/adjustments.
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;

async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Administration</div><h1>Inventory</h1>
    <div class="row" style="margin:10px 0">
      <input id="iSearch" placeholder="Search spare…" style="max-width:260px">
      <div class="spacer"></div>
      <button class="btn sm" id="iMoves">Recent moves</button>
    </div>
    <div id="iList" class="muted">Loading…</div>`;
  const { data }=await sb().from("spare_catalogue").select("*").order("name");
  const all=data||[];
  function render(rows){
    let low=0;
    $("iList").innerHTML = `<table><thead><tr><th>Spare</th><th>HSN</th><th>Unit</th><th class="num">In Stock</th><th></th></tr></thead>
      <tbody>${rows.map(r=>{ if(num(r.current_stock)<=0) low++; return `<tr>
        <td><b>${esc(r.name)}</b></td><td>${esc(r.hsn_code||'')}</td><td>${esc(r.unit||'')}</td>
        <td class="num" style="${num(r.current_stock)<=0?'color:#a3322a;font-weight:700':''}">${num(r.current_stock)}</td>
        <td><button class="btn sm" data-in="${r.id}">+ In</button> <button class="btn sm" data-out="${r.id}">− Out</button></td>
      </tr>`; }).join("")}</tbody></table>
      <p class="muted">${rows.length} spares · ${low} at/below zero.</p>`;
    $("iList").querySelectorAll("[data-in]").forEach(b=>b.addEventListener("click",()=>move(all.find(x=>x.id===b.getAttribute("data-in")),"in")));
    $("iList").querySelectorAll("[data-out]").forEach(b=>b.addEventListener("click",()=>move(all.find(x=>x.id===b.getAttribute("data-out")),"out")));
  }
  render(all);
  $("iSearch").addEventListener("input",e=>{ const q=e.target.value.toLowerCase().trim();
    render(!q?all:all.filter(r=>String(r.name||"").toLowerCase().includes(q))); });
  $("iMoves").addEventListener("click",recentMoves);
}

function move(spare, dir){
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="mBack">← Back to Inventory</button>
    <div class="card" style="margin-top:12px;max-width:480px">
      <h1>${dir==="in"?"Stock In":"Stock Out"} — ${esc(spare.name)}</h1>
      <p class="muted">Current stock: <b>${num(spare.current_stock)}</b> ${esc(spare.unit||'')}</p>
      <div class="fgrid">
        <div class="field"><label>Quantity *</label><input id="mQty" type="number" step="any" value="1"></div>
        <div class="field"><label>Date</label><input id="mDate" type="date" value="${todayISO()}"></div>
        <div class="field full"><label>Reason</label><input id="mReason" value="${dir==='in'?'purchase':'issue'}"></div>
      </div>
      <div class="row"><button class="btn green" id="mSave">Record ${dir==="in"?"receipt":"issue"}</button>
        <button class="btn" id="mCancel">Cancel</button></div>
      <div class="err" id="mErr"></div>
    </div>`;
  $("mBack").addEventListener("click",view); $("mCancel").addEventListener("click",view);
  $("mSave").addEventListener("click",async()=>{
    const qty=num($("mQty").value); if(qty<=0){ $("mErr").textContent="Enter a positive quantity."; return; }
    const { error }=await sb().from("inventory_moves").insert({
      spare_id:spare.id, qty, direction:dir, reason:$("mReason").value||null,
      moved_on:$("mDate").value||todayISO(), created_by:window.OPS.me.id });
    if(error){ $("mErr").textContent=error.message; return; }
    window.OPS.flashTop("Stock updated ✓"); view();
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
