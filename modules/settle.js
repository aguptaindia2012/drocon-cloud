/* ============================================================================
   DroCon Cloud — cross-module Settlement helper (shared)
   Powers the "Settle against" block on payment screens and reflects settlements
   in balances everywhere. A settlement offsets an amount owed the OTHER way
   (receivable ↔ payable) — no cash moves — via a balanced contra journal
   (apply_settlement / delete_settlement RPCs, sql/70).
   Exposes window.OPS.settle = { settledBy, openItems, block, saveLines, listFor, del }.
   ============================================================================ */
(function(){
const { $, esc, money, num, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;

// map {itemId: totalSettled} for a given open-item type (either side of a settlement)
async function settledBy(type){
  const { data }=await sb().from("settlements").select("amount,a_type,a_id,b_type,b_id");
  const map={};
  (data||[]).forEach(s=>{ if(s.a_type===type) map[s.a_id]=(map[s.a_id]||0)+num(s.amount);
                          if(s.b_type===type) map[s.b_id]=(map[s.b_id]||0)+num(s.amount); });
  return map;
}
async function openItems(side){
  let q=sb().from("v_open_items_due").select("*").order("item_date",{ascending:true});
  if(side) q=q.eq("side",side);
  const { data }=await q; return data||[];
}
// existing settlements touching an item (for the manage/edit screens)
async function listFor(type, id){
  const { data }=await sb().from("settlements").select("*").or(`and(a_type.eq.${type},a_id.eq.${id}),and(b_type.eq.${type},b_id.eq.${id})`);
  return data||[];
}
async function del(id){ const { error }=await sb().rpc("delete_settlement",{ p_id:id }); if(error) throw error; }

/* Render a "settle against" block. aItem = {type,id,label,side}.
   Returns { lines, total() }. Caller reads total() to reduce net cash. */
function block(hostId, aItem){
  const host=$(hostId); if(!host) return { lines:[], total:()=>0 };
  const oppSide = aItem.side==="receivable" ? "payable" : "receivable";
  let items=[]; const lines=[];
  host.innerHTML=`<label style="font-size:12px;font-weight:700;display:block;margin:8px 0 4px">Settle against <span class="hint" style="font-weight:400;color:var(--muted)">(optional — offsets an amount owed the other way; taken after TDS, before cash)</span></label>
    <div id="${hostId}_list"></div>
    <div class="row" style="gap:6px;margin-top:4px">
      <select id="${hostId}_sel" style="max-width:340px"><option value="">— loading open items —</option></select>
      <input id="${hostId}_amt" type="number" step="any" placeholder="₹" style="max-width:110px">
      <button class="btn sm" id="${hostId}_add" type="button">+ Add</button></div>`;
  // only types whose module pages already reflect settlements in their balances
  const REFLECTED={ client_invoice:1, vendor_payable:1, advance:1 };
  openItems(oppSide).then(d=>{
    items=d.filter(i=>REFLECTED[i.type] && !(String(i.item_id)===String(aItem.id) && i.type===aItem.type));
    $(hostId+"_sel").innerHTML='<option value="">— select item to settle against —</option>'+
      items.map((i,ix)=>`<option value="${ix}">${esc(i.type.replace(/_/g," "))}: ${esc(i.ref)} — ${esc(i.party||"")} · bal ${money(i.balance)}</option>`).join("");
  });
  function draw(){
    $(hostId+"_list").innerHTML=lines.map((l,ix)=>`<div class="row" style="gap:6px;align-items:center;margin:2px 0">
      <span class="chip issued">${esc(l.b.ref)}</span><span class="muted">${esc(l.b.type.replace(/_/g," "))}</span><b>${money(l.amt)}</b>
      <button class="btn sm ghost" data-rm="${ix}" type="button">✕</button></div>`).join("");
    $(hostId+"_list").querySelectorAll("[data-rm]").forEach(b=>b.addEventListener("click",()=>{ lines.splice(+b.getAttribute("data-rm"),1); draw(); if(host._onchange) host._onchange(); }));
  }
  $(hostId+"_add").addEventListener("click",()=>{
    const ix=$(hostId+"_sel").value; const amt=num($(hostId+"_amt").value);
    if(ix===""||!(amt>0)){ return; }
    const b=items[+ix];
    if(amt>num(b.balance)+0.01){ alert("That exceeds the item's balance of "+money(b.balance)+"."); return; }
    lines.push({ b, amt }); $(hostId+"_amt").value=""; draw(); if(host._onchange) host._onchange();
  });
  return { lines, total:()=>lines.reduce((s,l)=>s+num(l.amt),0), onChange:(fn)=>{ host._onchange=fn; } };
}
// apply the collected settlement lines for initiator aItem
async function saveLines(aItem, lines, date, from){
  for(const l of lines){
    const { error }=await sb().rpc("apply_settlement",{
      p_a_type:aItem.type, p_a_id:String(aItem.id), p_a_label:aItem.label,
      p_b_type:l.b.type, p_b_id:String(l.b.item_id), p_b_label:l.b.ref,
      p_amount:l.amt, p_date:date||todayISO(), p_note:null, p_initiated_from:from||null });
    if(error) throw error;
  }
}
window.OPS.settle = { settledBy, openItems, block, saveLines, listFor, del };
})();
