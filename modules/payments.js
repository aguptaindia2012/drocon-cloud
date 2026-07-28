/* ============================================================================
   DroCon Cloud — Finance · Payment Status
   Where the team records and updates payment status against invoices (moved out
   of the read-only Invoices & Receivables dashboard). Recording a receipt is a
   direct team function. EDITING or DELETING an existing payment is a correction:
   for non-admins it is applied but the invoice is sent back for re-approval
   (shows in Review/Approvals) — i.e. corrections take effect upon approval.
   ============================================================================ */
(function(){
const { $, esc, money, num, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
function daysBetween(d){ if(!d) return 0; return Math.max(0, Math.floor((Date.now()-new Date(d).getTime())/86400000)); }

async function fetchRows(entity){
  let invQ=sb().from("documents").select("*").eq("doc_type","invoice").order("doc_date",{ascending:false});
  if(entity) invQ=invQ.eq("entity",entity);
  const [{data:invs},{data:cns},{data:pays}]=await Promise.all([
    invQ,
    sb().from("documents").select("id,related_doc_id,totals").eq("doc_type","credit_note"),
    sb().from("payments").select("*") ]);
  const paidByDoc={}, creditByInv={};
  // settled against the invoice = cash + any TDS the client withheld
  (pays||[]).forEach(p=>{ paidByDoc[p.document_id]=(paidByDoc[p.document_id]||0)+num(p.amount)+num(p.tds_amount); });
  (cns||[]).forEach(c=>{ if(c.related_doc_id) creditByInv[c.related_doc_id]=(creditByInv[c.related_doc_id]||0)+num((c.totals||{}).total); });
  return (invs||[]).map(r=>{
    const gross=num((r.totals||{}).total); const credit=creditByInv[r.id]||0; const paid=paidByDoc[r.id]||0;
    const balance=Math.round((gross-credit-paid)*100)/100;
    const age = balance>0 ? daysBetween(r.doc_date) : 0;
    const status = balance<=0.01 ? "paid" : (paid>0||credit>0 ? "partial" : "issued");
    return { r, gross, credit, paid, balance, age, status, party:((r.party_snapshot||{}).firmName)||((r.party_snapshot||{}).name)||"" };
  });
}

async function recomputeStatus(x){
  const { data:ps }=await sb().from("payments").select("amount,tds_amount").eq("document_id",x.r.id);
  const paid=(ps||[]).reduce((s,p)=>s+num(p.amount)+num(p.tds_amount),0);
  const bal=x.gross-x.credit-paid;
  await sb().from("documents").update({ status: bal<=0.01?"paid":(paid>0||x.credit>0?"partial":"issued") }).eq("id",x.r.id);
}
// corrections by a non-admin send the invoice back for re-approval (#13 pattern)
async function gateCorrection(x, action){
  if(window.OPS.isAdmin()) return;
  await sb().from("documents").update({ approval_status:"submitted", submitted_by:window.OPS.me.id, submitted_at:new Date().toISOString() }).eq("id",x.r.id);
  try{ if(x.r.assigned_approver) await sb().from("notifications").insert({ user_id:x.r.assigned_approver, message:"Re-review: payment "+action+" on invoice "+x.r.number }); }catch(e){}
  window.OPS.refreshReviewCount && window.OPS.refreshReviewCount();
}

async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Finance</div><h1>Payment Status</h1>
    <div class="callout">Record receipts and update payment status here. Editing or deleting an existing payment is a correction — for non-admins it is applied and the invoice is sent for <b>re-approval</b>. The read-only summary &amp; charts live in <b>Dashboards → Invoices &amp; Receivables</b>.</div>
    <div class="row wrap" style="margin:6px 0">
      <label style="margin:0">Entity</label>
      <select id="pEntity" style="width:auto"><option value="">All</option><option>DCB</option><option>IBS</option></select>
      <input id="pSearch" placeholder="Search invoice / client…" style="max-width:260px">
      <label class="muted" style="display:inline"><input type="checkbox" id="pOnlyDue" style="width:auto" checked> only with balance</label>
      <div class="spacer"></div>
      ${window.OPS.isAdmin()?'<button class="btn sm" id="pImport">⬆ Import invoice tracker (CSV)</button>':''}
    </div>
    <div id="pTable" class="muted">Loading…</div>`;
  if($("pImport")) $("pImport").addEventListener("click",()=>{ if(window.OPS.importInvoiceTracker) window.OPS.importInvoiceTracker(); });
  $("pEntity").addEventListener("change",load); $("pSearch").addEventListener("input",render); $("pOnlyDue").addEventListener("change",render);
  let rows=[];
  async function load(){ rows=await fetchRows($("pEntity").value); render(); }
  function render(){
    const q=($("pSearch").value||"").toLowerCase().trim(); const onlyDue=$("pOnlyDue").checked;
    const list=rows.filter(x=>(!onlyDue||x.balance>0) && (!q || x.r.number.toLowerCase().includes(q) || x.party.toLowerCase().includes(q)));
    $("pTable").innerHTML = list.length?`<table><thead><tr><th>Entity</th><th>Invoice</th><th>Date</th><th>Client</th><th class="num">Invoiced</th><th class="num">Paid</th><th class="num">Credit</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map(x=>`<tr><td><span class="tag" style="background:${x.r.entity==='IBS'?'var(--blue)':'var(--green)'}">${esc(x.r.entity||'DCB')}</span></td><td><b>${esc(x.r.number)}</b></td><td>${fmtDate(x.r.doc_date)}</td><td>${esc(x.party)}</td>
        <td class="num">${money(x.gross)}</td><td class="num">${money(x.paid)}</td>
        <td class="num">${x.credit>0.005?money(x.credit):'—'}</td>
        <td class="num" style="${x.balance>0?'font-weight:700':''}">${money(x.balance)}</td>
        <td>${window.OPS.statusChip(x.status)}${x.r.approval_status==='submitted'?' <span class="chip in_review">in review</span>':''}</td>
        <td>${x.balance>0?`<button class="btn green sm" data-pay="${x.r.id}">+ Payment</button> `:''}<button class="btn sm" data-mng="${x.r.id}">Payments</button></td></tr>`).join("")}</tbody></table>`
      : '<div class="card muted">No invoices match.</div>';
    $("pTable").querySelectorAll("[data-pay]").forEach(b=>b.addEventListener("click",()=>recordPayment(rows.find(z=>String(z.r.id)===b.getAttribute("data-pay")),view)));
    $("pTable").querySelectorAll("[data-mng]").forEach(b=>b.addEventListener("click",()=>managePayments(rows.find(z=>String(z.r.id)===b.getAttribute("data-mng")),view)));
  }
  load();
}

function recordPayment(x, back){
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="pBack">← Back to Payment Status</button>
    <div class="card" style="margin-top:12px;max-width:480px">
      <h1>Record payment</h1>
      <p class="muted">Invoice <b>${esc(x.r.number)}</b> · ${esc(x.party)} · Balance <b>${money(x.balance)}</b></p>
      <div class="fgrid">
        <div class="field"><label>Amount settled *</label><input id="pAmt" type="number" step="any" value="${x.balance>0?x.balance:''}">
          <div class="small-note">Invoice value being cleared (cash + any TDS).</div></div>
        <div class="field"><label>Received into *</label><select id="pAcct"><option value="">— loading —</option></select>
          <div class="small-note">Which account the money landed in — this is what puts it on the Day Book.</div></div>
        <div class="field full"><label style="display:inline"><input type="checkbox" id="pTds" style="width:auto"> Client deducted TDS</label></div>
        <div class="field"><label>TDS %</label><input id="pTdsPct" type="number" step="any" placeholder="e.g. 2" disabled></div>
        <div class="field"><label>TDS amount ₹ <span class="muted">(verify)</span></label><input id="pTdsAmt" type="number" step="any" value="0" disabled></div>
        <div class="field full"><div class="callout" id="pSplit" style="margin:0"></div></div>
        <div class="field"><label>Date <span class="muted">(the day it actually reached the account)</span></label><input id="pDate" type="date" value="${todayISO()}"></div>
        <div class="field"><label>Mode</label><select id="pMode"><option>UPI</option><option>NEFT/RTGS</option><option>Cash</option><option>Cheque</option><option>Other</option></select></div>
        <div class="field full"><label>Note</label><input id="pNote"></div>
      </div>
      <div class="row"><button class="btn green" id="pSave">Save payment</button><button class="btn" id="pCancel">Cancel</button></div>
      <div class="err" id="pErr"></div>
    </div>`;
  $("pBack").addEventListener("click",back); $("pCancel").addEventListener("click",back);
  const syncTds=()=>{ const on=$("pTds").checked; $("pTdsPct").disabled=!on; $("pTdsAmt").disabled=!on;
    const settled=num($("pAmt").value); const tds=on?num($("pTdsAmt").value):0; const cash=Math.round((settled-tds)*100)/100;
    $("pSplit").innerHTML = on ? `Settling <b>${money(settled)}</b> = cash into account <b>${money(cash)}</b> + TDS <b>${money(tds)}</b> (booked to TDS Receivable).` : `Cash into account: <b>${money(settled)}</b>`;
  };
  $("pTds").addEventListener("change",()=>{ if($("pTds").checked && !num($("pTdsPct").value)) {} syncTds(); });
  $("pAmt").addEventListener("input",()=>{ if($("pTds").checked && num($("pTdsPct").value)) $("pTdsAmt").value=Math.round(num($("pAmt").value)*num($("pTdsPct").value))/100; syncTds(); });
  $("pTdsPct").addEventListener("input",()=>{ $("pTdsAmt").value=Math.round(num($("pAmt").value)*num($("pTdsPct").value))/100; syncTds(); });
  $("pTdsAmt").addEventListener("input",syncTds);
  syncTds();
  // which account the receipt landed in — without this it never reaches the Day Book
  sb().from("cash_accounts").select("id,name,kind").eq("is_active",true).order("kind").then(({data,error})=>{
    if(error || !data || !data.length){ $("pAcct").innerHTML='<option value="">— no accounts set up —</option>'; return; }
    $("pAcct").innerHTML=data.map(a=>`<option value="${a.id}">${esc(a.name)}${a.kind==='cash'?' (cash)':''}</option>`).join("");
  });
  $("pSave").addEventListener("click",()=>window.OPS.once($("pSave"),async()=>{
    const settled=num($("pAmt").value); if(settled<=0){ $("pErr").textContent="Enter a positive amount."; return; }
    const on=$("pTds").checked; const tds=on?num($("pTdsAmt").value):0;
    if(tds<0 || tds>settled){ $("pErr").textContent="TDS must be between 0 and the amount settled."; return; }
    const cash=Math.round((settled-tds)*100)/100;
    const acct=$("pAcct")?$("pAcct").value:null;
    const { error }=await sb().from("payments").insert({ document_id:x.r.id, amount:cash,
      tds_pct:on?(num($("pTdsPct").value)||null):null, tds_amount:tds,
      paid_on:$("pDate").value||todayISO(), account_id:acct||null, mode:$("pMode").value, note:$("pNote").value||null, created_by:window.OPS.me.id });
    if(error){ $("pErr").textContent=/duplicate|just recorded/i.test(error.message)?"This exact receipt was just recorded — check the list before re-entering.":error.message; return; }
    x.paid+=settled; await recomputeStatus(x);
    window.OPS.audit("payment","document",x.r.id,money(cash)+(tds>0?(" + TDS "+money(tds)):"")+" via "+$("pMode").value);
    window.OPS.flashTop("Payment recorded ✓"); back();
  }));
}

async function managePayments(x, back){
  const m=$("main");
  const { data:pays }=await sb().from("payments").select("*").eq("document_id",x.r.id).order("paid_on",{ascending:false});
  const list=pays||[];
  m.innerHTML=`<button class="btn sm" id="pBack">← Back to Payment Status</button>
    <div class="card" style="margin-top:12px">
      <h1>Payments — ${esc(x.r.number)}</h1>
      <p class="muted">${esc(x.party)} · Invoiced ${money(x.gross)} · Credit ${money(x.credit)} · Balance <b>${money(x.balance)}</b></p>
      ${!window.OPS.isAdmin()?'<div class="callout warn">Editing or deleting a payment will send this invoice for re-approval.</div>':''}
      <div class="row" style="margin-bottom:8px"><div class="spacer"></div>${x.balance>0?'<button class="btn green sm" id="pAdd">+ Payment</button>':''}</div>
      ${list.length?`<table><thead><tr><th>Date</th><th class="num">Amount</th><th>Mode</th><th>Note</th><th></th></tr></thead>
        <tbody>${list.map(p=>`<tr><td>${fmtDate(p.paid_on)}</td><td class="num">${money(p.amount)}</td><td>${esc(p.mode||'')}</td><td>${esc(p.note||'')}</td>
          <td><button class="btn sm" data-edit="${p.id}">Edit</button> ${window.OPS.canDelete()||p.created_by===window.OPS.me.id?`<button class="btn sm" data-del="${p.id}" style="color:#a3322a;border-color:#e4b4b4">Delete</button>`:''}</td></tr>`).join("")}</tbody></table>`
        :'<div class="card muted">No payments recorded.</div>'}
    </div>`;
  $("pBack").addEventListener("click",back);
  if($("pAdd")) $("pAdd").addEventListener("click",()=>recordPayment(x, ()=>managePayments(x,back)));
  m.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>editPayment(x, list.find(p=>String(p.id)===b.getAttribute("data-edit")), back)));
  m.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",async()=>{
    const p=list.find(z=>String(z.id)===b.getAttribute("data-del")); if(!p||!confirm("Delete this payment of "+money(p.amount)+"?")) return;
    const { error }=await sb().from("payments").delete().eq("id",p.id); if(error){ alert(error.message); return; }
    x.paid-=num(p.amount); await recomputeStatus(x); await gateCorrection(x,"deleted");
    window.OPS.audit("payment_deleted","document",x.r.id,money(p.amount));
    window.OPS.flashTop(window.OPS.isAdmin()?"Payment deleted ✓":"Deleted — sent for re-approval"); managePayments(x,back);
  }));
}

function editPayment(x, p, back){
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="pBack">← Back</button>
    <div class="card" style="margin-top:12px;max-width:480px">
      <h1>Edit payment — ${esc(x.r.number)}</h1>
      ${!window.OPS.isAdmin()?'<div class="callout warn">Saving will send this invoice for re-approval.</div>':''}
      <div class="fgrid">
        <div class="field"><label>Amount *</label><input id="eAmt" type="number" step="any" value="${esc(p.amount)}"></div>
        <div class="field"><label>Date</label><input id="eDate" type="date" value="${esc((p.paid_on||'').slice(0,10))}"></div>
        <div class="field"><label>Mode</label><input id="eMode" value="${esc(p.mode||'')}"></div>
        <div class="field"><label>Note</label><input id="eNote" value="${esc(p.note||'')}"></div>
      </div>
      <div class="row"><button class="btn green" id="eSave">Save changes</button><button class="btn" id="eCancel">Cancel</button></div>
      <div class="err" id="eErr"></div>
    </div>`;
  const goBack=()=>managePayments(x,back);
  $("pBack").addEventListener("click",goBack); $("eCancel").addEventListener("click",goBack);
  $("eSave").addEventListener("click",async()=>{
    const amt=num($("eAmt").value); if(amt<=0){ $("eErr").textContent="Enter a positive amount."; return; }
    const oldAmt=num(p.amount);
    const { error }=await sb().from("payments").update({ amount:amt, paid_on:$("eDate").value||p.paid_on, mode:$("eMode").value||null, note:$("eNote").value||null }).eq("id",p.id);
    if(error){ $("eErr").textContent=error.message; return; }
    x.paid += (amt-oldAmt); await recomputeStatus(x); await gateCorrection(x,"edited");
    window.OPS.audit("payment_edited","document",x.r.id,money(oldAmt)+"→"+money(amt));
    window.OPS.flashTop(window.OPS.isAdmin()?"Saved ✓":"Saved — sent for re-approval"); goBack();
  });
}

window.OPS.routes.payment_status = view;
})();
