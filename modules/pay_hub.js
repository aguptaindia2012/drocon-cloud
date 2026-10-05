/* ============================================================================
   DroCon Cloud — Payments & Settlements hub
   ----------------------------------------------------------------------------
   One place to clear anything owed, in either direction: collect from a client,
   pay a vendor / expense, or settle one open item against another (no cash).
   Lists every open item (from v_open_items, contra-aware) and hands each one to
   the module flow that already routes through the shared window (window.OPS.pay),
   so posting + status recompute are never duplicated here.
   Exposed as route `pay_hub`. Launchers live in payments.js / accounting.js
   (window.OPS.payFlows).
   ============================================================================ */
(function(){
const { $, esc, money, num, fmtDate } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;

// item types the hub can clear (others, e.g. advance/salary, keep their own flow)
const TYPES = {
  client_invoice:{ label:"Client invoice", act:"Collect",     launch:(it,back)=>window.OPS.payFlows.clientReceipt(it.item_id, back) },
  vendor_payable:{ label:"Vendor bill",    act:"Pay / Settle", launch:(it,back)=>window.OPS.payFlows.vendorPay(it.item_id, num(it.balance), back) },
  expense:{        label:"Expense",        act:"Pay / Settle", launch:(it,back)=>window.OPS.payFlows.expensePay(it.item_id, back) }
};

async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Finance &amp; Accounting</div><h1>Payments &amp; Settlements</h1>
    <div class="callout">Clear anything owed from one place — collect from a client, pay a vendor or expense, or
      <b>settle</b> one against another (no cash moves). Pick an item; the same window opens with explicit
      cash / settlement / TDS. Advances keep their own flow and still settle from the item they offset.</div>
    <div class="row wrap" style="margin:8px 0;gap:8px">
      <input id="ph_q" placeholder="Search party / reference…" style="max-width:280px">
      <select id="ph_side" style="width:auto">
        <option value="">Receivable &amp; Payable</option>
        <option value="receivable">Receivable (owed to us)</option>
        <option value="payable">Payable (we owe)</option></select>
      <label class="muted" style="display:inline"><input type="checkbox" id="ph_group" style="width:auto" checked> group by party</label>
    </div>
    <div id="ph_body" class="muted">Loading…</div>`;
  $("ph_q").addEventListener("input",render); $("ph_side").addEventListener("change",render); $("ph_group").addEventListener("change",render);

  let items=[];
  async function load(){
    const { data, error }=await sb().from("v_open_items").select("*");
    if(error){ $("ph_body").innerHTML='<div class="card">'+esc(error.message)+'</div>'; return; }
    items=(data||[]).filter(i=>TYPES[i.type] && num(i.balance)>0.01);
    render();
  }

  function render(){
    const q=($("ph_q").value||"").toLowerCase().trim(), side=$("ph_side").value, grp=$("ph_group").checked;
    const list=items.filter(i=>(!side||i.side===side)
      && (!q || String(i.ref||"").toLowerCase().includes(q) || String(i.party||"").toLowerCase().includes(q)));
    list.sort((a,b)=>num(b.balance)-num(a.balance));
    const rec=list.filter(i=>i.side==='receivable'), pay=list.filter(i=>i.side==='payable');
    const totR=rec.reduce((s,i)=>s+num(i.balance),0), totP=pay.reduce((s,i)=>s+num(i.balance),0);
    const rowHTML=i=>`<tr><td><span class="chip ${i.side==='receivable'?'issued':'in_review'}">${esc(TYPES[i.type].label)}</span></td>
      <td><b>${esc(i.ref||'')}</b></td><td>${esc(i.party||'')}</td>
      <td>${i.item_date?fmtDate(i.item_date):'—'}</td>
      <td class="num" style="font-weight:700;color:${i.side==='receivable'?'#3e6b20':'#a3322a'}">${money(i.balance)}</td>
      <td><button class="btn green sm" data-k="${i.type}:${i.item_id}">${TYPES[i.type].act}</button></td></tr>`;
    const table=rows=>`<div style="overflow:auto"><table><thead><tr><th>Type</th><th>Reference</th><th>Party</th>
      <th>Date</th><th class="num">Balance</th><th></th></tr></thead><tbody>${rows.map(rowHTML).join("")}</tbody></table></div>`;

    let bodyHTML;
    if(!list.length){ bodyHTML='<div class="card muted">No open items match.</div>'; }
    else if(grp){
      const byParty={}; list.forEach(i=>{ const k=(i.party||'—'); (byParty[k]=byParty[k]||[]).push(i); });
      bodyHTML=Object.keys(byParty).sort().map(pn=>{
        const g=byParty[pn]; const net=g.reduce((s,i)=>s+(i.side==='receivable'?num(i.balance):-num(i.balance)),0);
        const can = Math.abs(net)>0.01 && g.some(i=>i.side==='receivable') && g.some(i=>i.side==='payable');
        return `<div class="card"><h3 style="margin:0 0 6px">${esc(pn)}
          <span class="muted" style="font-weight:400;font-size:13px">· net ${net>=0?'owed to us':'we owe'} ${money(Math.abs(net))}${can?' · has both sides — can settle':''}</span></h3>${table(g)}</div>`;
      }).join("");
    } else { bodyHTML=`<div class="card">${table(list)}</div>`; }

    $("ph_body").innerHTML=`<div class="statrow">
      <div class="stat"><div class="n">${money(totR)}</div><div class="l">Receivable (${rec.length})</div></div>
      <div class="stat" style="background:#fbe0de"><div class="n" style="color:#a3322a">${money(totP)}</div><div class="l">Payable (${pay.length})</div></div>
    </div>${bodyHTML}`;
    $("ph_body").querySelectorAll("[data-k]").forEach(b=>b.addEventListener("click",()=>{
      const [type,itemId]=b.getAttribute("data-k").split(":");
      const it=items.find(i=>i.type===type && String(i.item_id)===String(itemId));
      if(!it){ return; }
      if(!window.OPS.payFlows || !TYPES[type]){ window.OPS.flashTop && window.OPS.flashTop("This item type opens from its own page"); return; }
      TYPES[type].launch(it, view);
    }));
  }
  load();
}
window.OPS.routes.pay_hub = view;
})();
