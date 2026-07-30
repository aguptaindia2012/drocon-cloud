/* ============================================================================
   DroCon Cloud — Finance & Accounting (Phase A)
   Day Book: opening (chained) + receipts − payments = expected, against the
   ACTUAL balance typed from the bank / cash count. Approver closes and locks.
   Expense Management: Expenses and Supplier (Vendor) Invoices.
   "Paid" always means the day the money left the account.
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const isApprover = ()=> window.OPS.isAdmin() || (window.OPS.isApprover && window.OPS.isApprover());
let accounts=[], vendors=[], cats=[], acctId="", theDate=todayISO(), emMode="expense";

async function refs(){
  if(!accounts.length){
    const [a,v,c]=await Promise.all([
      sb().from("cash_accounts").select("*").eq("is_active",true).order("kind"),
      sb().from("vendors").select("id,firm_name,name").order("firm_name"),
      sb().from("expense_categories").select("*").eq("is_active",true).order("name")
    ]);
    accounts=a.data||[]; vendors=v.data||[]; cats=c.data||[];
    if(!acctId && accounts.length) acctId=accounts[0].id;
  }
}
const vName = v => (v && (v.firm_name||v.name)) || "";

/* ========================= DAY BOOK ========================= */
async function dayBook(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Finance &amp; Accounting</div><h1>Day Book</h1>
    <div class="callout">Enter every receipt and payment on <b>the day the money actually moved</b>.
      The opening balance is carried from the previous close — it is never typed. Close the day when
      the expected balance matches your bank or cash count.</div>
    <div class="card" style="padding:12px"><div class="row wrap" style="gap:10px;align-items:flex-end">
      <div class="field" style="margin:0;min-width:200px"><label>Account</label><select id="dbAcct"></select></div>
      <div class="field" style="margin:0"><label>Date</label><input type="date" id="dbDate" value="${esc(theDate)}"></div>
      <button class="btn sm" id="dbGo">Open day</button>
      <div class="spacer"></div>
      <button class="btn sm" id="dbFlags">⚑ Unmatched days</button>
    </div></div>
    <div id="dbBody" class="muted">Loading…</div>`;
  await refs();
  $("dbAcct").innerHTML=accounts.map(a=>`<option value="${a.id}" ${a.id===acctId?'selected':''}>${esc(a.name)}${a.kind==='cash'?' (cash)':''}</option>`).join("");
  $("dbAcct").addEventListener("change",()=>{ acctId=$("dbAcct").value; loadDay(); });
  $("dbGo").addEventListener("click",()=>{ theDate=$("dbDate").value||todayISO(); loadDay(); });
  $("dbFlags").addEventListener("click",flags);
  loadDay();
}

async function loadDay(){
  const host=$("dbBody"); host.innerHTML="Loading…";
  const { data:pos, error }=await sb().rpc("day_position",{ p_account:acctId, p_date:theDate });
  if(error){ host.innerHTML='<div class="card">Error: '+esc(error.message)+'</div>'; return; }
  const [{data:txns},{data:rcpts},{data:cl}]=await Promise.all([
    sb().from("cash_txns").select("*").eq("account_id",acctId).eq("txn_date",theDate).order("id"),
    sb().from("payments").select("*, doc:document_id(number)").eq("account_id",acctId).eq("paid_on",theDate),
    sb().from("day_close").select("*").eq("account_id",acctId).eq("close_date",theDate).maybeSingle()
  ]);
  const closed=!!(cl&&cl.id);
  const diffCol = c => Math.abs(num(c))<0.005 ? "#3e6b20" : "#a3322a";

  host.innerHTML=`
    <div class="card" style="max-width:520px">
      <h3>${fmtDate(theDate)} — position</h3>
      <table style="font-size:14px">
        <tr><td>Opening <span class="muted">(carried forward)</span></td><td class="num">${money(pos.opening)}</td></tr>
        <tr><td>+ Receipts</td><td class="num" style="color:#3e6b20">${money(pos.receipts)}</td></tr>
        <tr><td>− Payments</td><td class="num" style="color:#a3322a">${money(pos.payments)}</td></tr>
        <tr style="border-top:2px solid var(--line)"><td><b>= Expected closing</b></td><td class="num"><b>${money(pos.expected)}</b></td></tr>
      </table>
      ${closed?`<div class="callout" style="margin-top:10px;background:${Math.abs(num(cl.difference))<0.005?'var(--soft-green)':'#fbe0de'};border-left-color:${diffCol(cl.difference)}">
          <b>Day closed.</b> Actual ${money(cl.actual_closing)} ·
          <b style="color:${diffCol(cl.difference)}">difference ${money(cl.difference)}</b>
          ${cl.note?('<br><span class="muted">'+esc(cl.note)+'</span>'):''}
          ${isApprover()?'<div class="row" style="margin-top:8px"><button class="btn sm" id="dbReopen">Reopen day</button></div>':''}
        </div>`
      :`<div style="margin-top:12px">
          <div class="field"><label>Actual closing balance ${accounts.find(a=>a.id===acctId)&&accounts.find(a=>a.id===acctId).kind==='cash'?'(cash counted)':'(from the bank)'}</label>
            <input type="number" step="0.01" id="dbActual" placeholder="${num(pos.expected).toFixed(2)}"></div>
          <div id="dbDiff" class="muted" style="margin:-6px 0 10px"></div>
          <div class="field"><label>Note <span class="muted">(required if it does not match)</span></label><input id="dbNote"></div>
          ${isApprover()?'<button class="btn green" id="dbClose">Close day</button>'
            :'<div class="small-note">Only an approver can close the day. Enter your movements and ask them to close it.</div>'}
        </div>`}
      <div class="err" id="dbErr"></div>
    </div>

    <div class="card"><h3>Movements on this day</h3>
      ${closed?'<p class="muted" style="margin-top:-4px">This day is locked — reopen it to add or change anything.</p>'
        :`<div class="row wrap" style="margin-bottom:10px">
            <button class="btn sm" id="dbAddIn">+ Receipt</button>
            <button class="btn sm" id="dbAddOut">+ Payment</button>
            <span class="muted">Settle a supplier invoice or expense from <b>Expense Management</b> — it lands here automatically.</span>
          </div>`}
      ${(rcpts&&rcpts.length)||(txns&&txns.length)?`<div style="overflow:auto"><table>
        <thead><tr><th>Type</th><th>Details</th><th>Mode</th><th class="num">In</th><th class="num">Out</th><th></th></tr></thead>
        <tbody>
          ${(rcpts||[]).map(r=>`<tr><td><span class="chip approved">Receipt</span></td>
            <td>Invoice ${esc((r.doc&&r.doc.number)||'')} ${esc(r.note||'')}</td><td>${esc(r.mode||'')}</td>
            <td class="num" style="color:#3e6b20">${money(r.amount)}</td><td class="num">—</td><td></td></tr>`).join("")}
          ${(txns||[]).map(t=>`<tr><td><span class="chip ${t.direction==='in'?'approved':'rejected'}">${t.direction==='in'?'Receipt':'Payment'}</span></td>
            <td>${esc(t.ref_type||'')}${t.note?(' · '+esc(t.note)):''}</td><td>${esc(t.mode||'')}</td>
            <td class="num" style="color:#3e6b20">${t.direction==='in'?money(t.amount):'—'}</td>
            <td class="num" style="color:#a3322a">${t.direction==='out'?money(t.amount):'—'}</td>
            <td>${closed?'':`<span class="x" data-del="${t.id}">✕</span>`}</td></tr>`).join("")}
        </tbody></table></div>`
        :'<div class="muted">Nothing recorded on this day yet.</div>'}
    </div>`;

  if($("dbActual")) $("dbActual").addEventListener("input",()=>{
    const d=num($("dbActual").value)-num(pos.expected);
    $("dbDiff").innerHTML = $("dbActual").value===""?"" :
      (Math.abs(d)<0.005 ? '<b style="color:#3e6b20">Matches exactly ✓</b>'
        : '<b style="color:#a3322a">Difference '+money(d)+'</b> — a note is required to close.');
  });
  if($("dbClose")) $("dbClose").addEventListener("click",async()=>{
    const a=$("dbActual").value; if(a===""){ $("dbErr").textContent="Enter the actual closing balance."; return; }
    $("dbClose").disabled=true;
    const { error }=await sb().rpc("close_day",{ p_account:acctId, p_date:theDate, p_actual:num(a), p_note:$("dbNote").value||null });
    $("dbClose").disabled=false;
    if(error){ $("dbErr").textContent=error.message; return; }
    window.OPS.flashTop("Day closed ✓"); loadDay();
  });
  if($("dbReopen")) $("dbReopen").addEventListener("click",async()=>{
    const n=prompt("Why are you reopening this day?"); if(n===null) return;
    const { error }=await sb().rpc("reopen_day",{ p_account:acctId, p_date:theDate, p_note:n||null });
    if(error){ alert(error.message); return; }
    window.OPS.flashTop("Day reopened"); loadDay();
  });
  if($("dbAddIn"))  $("dbAddIn").addEventListener("click",()=>movement("in"));
  if($("dbAddOut")) $("dbAddOut").addEventListener("click",()=>movement("out"));
  host.querySelectorAll("[data-del]").forEach(x=>x.addEventListener("click",async()=>{
    if(!confirm("Remove this movement?")) return;
    const { error }=await sb().from("cash_txns").delete().eq("id",x.getAttribute("data-del"));
    if(error){ alert(error.message); return; } loadDay(); }));
}

function movement(dir){
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="mvBack">← Back to Day Book</button>
    <div class="card" style="margin-top:12px;max-width:520px"><h1>${dir==='in'?'Receipt':'Payment'} — ${fmtDate(theDate)}</h1>
    <p class="muted" style="margin-top:-4px">Recorded against <b>${esc((accounts.find(a=>a.id===acctId)||{}).name||'')}</b> on the date shown above.</p>
    <div class="field"><label>Amount *</label><input type="number" step="0.01" id="mvAmt"></div>
    <div class="field"><label>Mode</label><select id="mvMode">${["UPI","NEFT/RTGS","Cheque","Cash","Card","Other"].map(x=>`<option>${x}</option>`).join("")}</select></div>
    <div class="field"><label>What is this for</label><select id="mvRef">
      ${(dir==='out'?["expense","advance","salary","transfer","other"]:["transfer","other"]).map(x=>`<option value="${x}">${x}</option>`).join("")}
    </select></div>
    <div class="field"><label>Note</label><input id="mvNote"></div>
    <div class="row"><button class="btn green" id="mvSave">Save</button><button class="btn" id="mvCancel">Cancel</button></div>
    <div class="err" id="mvErr"></div></div>`;
  $("mvBack").addEventListener("click",loadDayBack); $("mvCancel").addEventListener("click",loadDayBack);
  $("mvSave").addEventListener("click",()=>window.OPS.once($("mvSave"),async()=>{
    const amt=num($("mvAmt").value); if(!(amt>0)){ $("mvErr").textContent="Enter an amount."; return; }
    const { error }=await sb().from("cash_txns").insert({ account_id:acctId, direction:dir, txn_date:theDate,
      amount:amt, mode:$("mvMode").value, ref_type:$("mvRef").value, note:$("mvNote").value||null,
      created_by:window.OPS.me.id });
    if(error){ $("mvErr").textContent=/duplicate|just recorded/i.test(error.message)?"That exact movement was just recorded — check before re-entering.":error.message; return; }
    window.OPS.flashTop("Saved ✓"); loadDayBack();
  }));
}
function loadDayBack(){ dayBook(); }

async function flags(){
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="flBack">← Back to Day Book</button>
    <div class="card" style="margin-top:12px"><h1>Days closed with a difference</h1>
    <p class="muted" style="margin-top:-4px">Every close where the actual balance did not match the expected. Investigate and correct by reopening the day.</p>
    <div id="flBody" class="muted">Loading…</div></div>`;
  $("flBack").addEventListener("click",dayBook);
  const { data, error }=await sb().from("v_accounting_flags").select("*").order("close_date",{ascending:false});
  if(error){ $("flBody").innerHTML=esc(error.message); return; }
  $("flBody").innerHTML=(data&&data.length)?`<div style="overflow:auto"><table>
    <thead><tr><th>Date</th><th>Account</th><th class="num">Difference</th><th>Note</th></tr></thead>
    <tbody>${data.map(f=>`<tr><td>${fmtDate(f.close_date)}</td><td>${esc(f.account_name)}</td>
      <td class="num" style="color:#a3322a;font-weight:700">${money(f.difference)}</td><td>${esc(f.note||'')}</td></tr>`).join("")}</tbody></table></div>`
    :'<div class="callout">Every closed day matched exactly. 🎉</div>';
}

/* ================== EXPENSE MANAGEMENT (2 sub-sub tabs) ================== */
async function expenseMgmt(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Finance &amp; Accounting</div><h1>Expense Management</h1>
    <div class="row wrap" style="margin:10px 0">
      <button class="btn sm ${emMode==='expense'?'green':''}" id="emExp">Expenses</button>
      <button class="btn sm ${emMode==='payable'?'green':''}" id="emPay">Supplier (Vendor) Invoices</button>
      <div class="spacer"></div>
      <button class="btn green sm" id="emNew">+ New ${emMode==='expense'?'expense':'supplier invoice'}</button>
    </div>
    <div id="emBody" class="muted">Loading…</div>`;
  await refs();
  $("emExp").addEventListener("click",()=>{ emMode="expense"; expenseMgmt(); });
  $("emPay").addEventListener("click",()=>{ emMode="payable"; expenseMgmt(); });
  $("emNew").addEventListener("click",()=>emMode==='expense'?expForm(null):payForm(null));
  emMode==='expense' ? listExpenses() : listPayables();
}

async function listExpenses(){
  const { data, error }=await sb().from("expenses")
    .select("*, cat:category_id(name), vendor:vendor_id(firm_name,name)").order("expense_date",{ascending:false}).limit(300);
  if(error){ $("emBody").innerHTML='<div class="card">'+esc(error.message)+'</div>'; return; }
  const rows=data||[];
  $("emBody").innerHTML=rows.length?`<div style="overflow:auto"><table>
    <thead><tr><th>Date</th><th>Category</th><th>Paid to</th><th class="num">Amount</th><th class="num">GST</th><th class="num">Total</th><th>Bill</th><th>Status</th></tr></thead>
    <tbody>${rows.map(r=>`<tr class="clickable" data-id="${r.id}">
      <td>${fmtDate(r.expense_date)}</td><td>${esc((r.cat&&r.cat.name)||'')}</td>
      <td>${esc(vName(r.vendor)||r.payee_text||'')}</td>
      <td class="num">${money(r.amount)}</td><td class="num">${money(r.gst_amount)}</td><td class="num"><b>${money(r.total)}</b></td>
      <td>${r.has_bill?'✓'+(r.bill_no?(' '+esc(r.bill_no)):''):'·'}</td>
      <td>${r.status==='paid'?'<span class="chip paid">Paid</span>':'<span class="chip issued">Unpaid</span>'}</td></tr>`).join("")}</tbody></table></div>`
    :'<div class="card muted">No expenses yet.</div>';
  $("emBody").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>
    expForm(rows.find(x=>String(x.id)===tr.getAttribute("data-id")))));
}

function expForm(rec){
  const e=rec||{}; const m=$("main");
  m.innerHTML=`<button class="btn sm" id="exBack">← Back</button>
    <div class="card" style="margin-top:12px"><div class="eyebrow">Expense Management</div><h1>${rec?"Edit":"New"} expense</h1>
    <div class="fgrid">
      <div class="field"><label>Date *</label><input type="date" id="ex_date" value="${esc(e.expense_date||todayISO())}"></div>
      <div class="field"><label>Category</label><select id="ex_cat"><option value="">— select —</option>
        ${cats.map(c=>`<option value="${c.id}" ${e.category_id===c.id?'selected':''}>${esc(c.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Paid to (vendor)</label><select id="ex_vendor"><option value="">— none / other —</option>
        ${vendors.map(v=>`<option value="${v.id}" ${e.vendor_id===v.id?'selected':''}>${esc(vName(v))}</option>`).join("")}</select></div>
      <div class="field"><label>Or name the payee</label><input id="ex_payee" value="${esc(e.payee_text||'')}"></div>
      <div class="field"><label>Amount *</label><input type="number" step="0.01" id="ex_amt" value="${esc(e.amount||'')}"></div>
      <div class="field"><label>GST</label><input type="number" step="0.01" id="ex_gst" value="${esc(e.gst_amount||0)}"></div>
      <div class="field"><label>Bill received?</label><select id="ex_hasbill">
        <option value="false" ${!e.has_bill?'selected':''}>No</option><option value="true" ${e.has_bill?'selected':''}>Yes</option></select></div>
      <div class="field"><label>Bill number</label><input id="ex_billno" value="${esc(e.bill_no||'')}"></div>
      <div class="field full"><label>Note</label><input id="ex_note" value="${esc(e.note||'')}"></div>
    </div>
    <div class="row wrap"><button class="btn green" id="exSave">${rec?"Save changes":"Create"}</button>
      <button class="btn" id="exCancel">Cancel</button>
      <div class="spacer"></div>
      ${rec&&rec.status!=='paid'?'<button class="btn blue sm" id="exPay">Mark paid…</button>':''}
      ${rec&&rec.status==='paid'?'<span class="chip paid">Paid</span>':''}</div>
    <div class="err" id="exErr"></div></div>`;
  $("exBack").addEventListener("click",expenseMgmt); $("exCancel").addEventListener("click",expenseMgmt);
  $("exSave").addEventListener("click",async()=>{
    const amt=num($("ex_amt").value), gst=num($("ex_gst").value);
    if(!(amt>0)){ $("exErr").textContent="Enter an amount."; return; }
    const out={ expense_date:$("ex_date").value||todayISO(), category_id:$("ex_cat").value||null,
      vendor_id:$("ex_vendor").value||null, payee_text:$("ex_payee").value||null,
      payee_kind: $("ex_vendor").value?'vendor':'other',
      amount:amt, gst_amount:gst, total:amt+gst,
      has_bill:$("ex_hasbill").value==="true", bill_no:$("ex_billno").value||null, note:$("ex_note").value||null };
    let err;
    if(rec){ ({error:err}=await sb().from("expenses").update(out).eq("id",rec.id)); }
    else { out.created_by=window.OPS.me.id; ({error:err}=await sb().from("expenses").insert(out)); }
    if(err){ $("exErr").textContent=err.message; return; }
    window.OPS.audit(rec?"edited":"created","expenses",rec?rec.id:"new",out.note||""); window.OPS.flashTop("Saved ✓"); expenseMgmt();
  });
  if($("exPay")) $("exPay").addEventListener("click",()=>settle("expense",rec.id,num(rec.total),expenseMgmt));
}

const payStatusChip = st => st==='paid'?'<span class="chip paid">Paid</span>'
  : st==='part_paid'?'<span class="chip partial">Part paid</span>'
  : st==='cheque_issued'?'<span class="chip in_review">Cheque issued</span>'
  : '<span class="chip issued">Unpaid</span>';

// balance = total − payments (cash_txns) − vendor credit notes (payable_credits)
async function loadPayables(){
  const [{data:pys,error},{data:txns},{data:creds}]=await Promise.all([
    sb().from("payables").select("*, vendor:vendor_id(firm_name,name)").order("invoice_date",{ascending:false}).limit(500),
    sb().from("cash_txns").select("ref_id,amount,tds_amount").eq("ref_type","payable"),
    sb().from("payable_credits").select("payable_id,amount")
  ]);
  if(error) return { rows:[], error };
  const paidBy={}, credBy={};
  (txns||[]).forEach(t=>{ paidBy[t.ref_id]=(paidBy[t.ref_id]||0)+num(t.amount)+num(t.tds_amount); });
  (creds||[]).forEach(c=>{ credBy[c.payable_id]=(credBy[c.payable_id]||0)+num(c.amount); });
  const rows=(pys||[]).map(p=>{ const paid=paidBy[p.id]||0, credit=credBy[p.id]||0;
    const bal=Math.round((num(p.total)-paid-credit)*100)/100;
    return { p, paid, credit, balance:bal, vendor_name:vName(p.vendor) }; });
  return { rows };
}

let _payOnlyDue=true;
async function listPayables(){
  const { rows, error }=await loadPayables();
  if(error){ $("emBody").innerHTML='<div class="card">'+esc(error.message)+'</div>'; return; }
  const outstanding=rows.filter(x=>x.balance>0.005).reduce((s,x)=>s+x.balance,0);
  const list=rows.filter(x=>!_payOnlyDue || x.balance>0.005);
  $("emBody").innerHTML=`
    <div class="statrow">
      <div class="stat" style="background:#fbe0de"><div class="n" style="color:#a3322a">${money(outstanding)}</div><div class="l">Payable outstanding</div></div>
      <div class="stat"><div class="n">${rows.filter(x=>x.balance>0.005).length}</div><div class="l">Open invoices</div></div>
    </div>
    <div class="row wrap" style="margin-bottom:8px">
      <label class="muted" style="display:inline"><input type="checkbox" id="pyOnlyDue" style="width:auto" ${_payOnlyDue?'checked':''}> only with balance</label>
      <div class="spacer"></div><span class="muted">Record part or full payments; each one lands on the Day Book.</span></div>
    <div id="pyList">${list.length?`<div style="overflow:auto"><table>
      <thead><tr><th>Vendor</th><th>Invoice no.</th><th>Date</th><th>Due</th><th class="num">Invoiced</th><th class="num">Paid</th><th class="num">Credit</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map(x=>`<tr><td><b>${esc(x.vendor_name)}</b></td>
        <td class="clickable" data-edit="${x.p.id}" style="text-decoration:underline">${esc(x.p.vendor_invoice_no||'(no no.)')}</td>
        <td>${fmtDate(x.p.invoice_date)}</td><td>${x.p.due_date?fmtDate(x.p.due_date):'—'}</td>
        <td class="num">${money(x.p.total)}</td><td class="num">${money(x.paid)}</td>
        <td class="num">${x.credit>0.005?money(x.credit):'—'}</td>
        <td class="num" style="${x.balance>0.005?'font-weight:700':''}">${money(x.balance)}</td>
        <td>${payStatusChip(x.p.status)}</td>
        <td>${x.balance>0.005?`<button class="btn green sm" data-pay="${x.p.id}">+ Payment</button> `:''}<button class="btn sm" data-mng="${x.p.id}">Payments</button>${(window.OPS.canDelete()&&x.paid<=0.005&&x.credit<=0.005)?` <button class="btn sm" data-delp="${x.p.id}" style="color:#a3322a;border-color:#e4b4b4">Delete</button>`:''}</td></tr>`).join("")}</tbody></table></div>`
      :'<div class="card muted">No supplier invoices'+(_payOnlyDue?' with a balance':'')+'.</div>'}</div>`;
  $("pyOnlyDue").addEventListener("change",()=>{ _payOnlyDue=$("pyOnlyDue").checked; listPayables(); });
  const find=id=>rows.find(x=>String(x.p.id)===id);
  // back must rebuild the whole Expense Management page — the payment screens
  // replace all of #main, so refilling #emBody alone would target a dead node.
  $("emBody").querySelectorAll("[data-edit]").forEach(el=>el.addEventListener("click",()=>payForm(find(el.getAttribute("data-edit")).p)));
  $("emBody").querySelectorAll("[data-pay]").forEach(b=>b.addEventListener("click",()=>payVendor(find(b.getAttribute("data-pay")), expenseMgmt)));
  $("emBody").querySelectorAll("[data-mng]").forEach(b=>b.addEventListener("click",()=>managePayable(find(b.getAttribute("data-mng")), expenseMgmt)));
  $("emBody").querySelectorAll("[data-delp]").forEach(b=>b.addEventListener("click",async()=>{
    const x=find(b.getAttribute("data-delp")); if(!x) return;
    if(!confirm("Delete supplier invoice “"+(x.p.vendor_invoice_no||'(no no.)')+"” for "+x.vendor_name+" ("+money(x.p.total)+")?\n\nThis also reverses its ledger entry. Only invoices with no payments/credits can be deleted.")) return;
    const { error }=await sb().rpc("delete_payable",{ p_id:x.p.id });
    if(error){ alert(error.message); return; }
    window.OPS.audit("deleted","payables",x.p.id,(x.p.vendor_invoice_no||'')+" "+money(x.p.total));
    window.OPS.flashTop("Supplier invoice deleted ✓"); listPayables();
  }));
}

async function recomputePayable(id, total){
  const [{data:tx},{data:cr}]=await Promise.all([
    sb().from("cash_txns").select("amount,tds_amount").eq("ref_type","payable").eq("ref_id",String(id)),
    sb().from("payable_credits").select("amount").eq("payable_id",id)
  ]);
  const paid=(tx||[]).reduce((s,t)=>s+num(t.amount)+num(t.tds_amount),0);
  const credit=(cr||[]).reduce((s,c)=>s+num(c.amount),0);
  const settled=paid+credit;   // a credit note settles the balance just like a payment
  const status = settled>=num(total)-0.005 ? "paid" : (settled>0 ? "part_paid" : "unpaid");
  await sb().from("payables").update({ status }).eq("id",id);
}

/* + Payment against a supplier invoice — mirrors Payment Status */
function payVendor(x, back){
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="vpBack">← Back</button>
    <div class="card" style="margin-top:12px;max-width:520px"><h1>Record payment</h1>
    <p class="muted">${esc(x.vendor_name)} · Invoice <b>${esc(x.p.vendor_invoice_no||'(no no.)')}</b> · Balance <b>${money(x.balance)}</b></p>
    <div class="callout warn">Enter the date the money <b>actually left the account</b> — not the date a cheque was handed over.</div>
    <div class="fgrid">
      <div class="field"><label>Amount settled *</label><input type="number" step="0.01" id="vp_amt" value="${x.balance>0?x.balance:''}">
        <div class="small-note">Bill value being cleared (cash + any TDS we withhold).</div></div>
      <div class="field"><label>Paid from *</label><select id="vp_acct">${accounts.map(a=>`<option value="${a.id}">${esc(a.name)}${a.kind==='cash'?' (cash)':''}</option>`).join("")}</select></div>
      <div class="field full"><label style="display:inline"><input type="checkbox" id="vp_tds" style="width:auto"> We deducted TDS</label></div>
      <div class="field"><label>TDS %</label><input id="vp_tdspct" type="number" step="any" placeholder="e.g. 2" disabled></div>
      <div class="field"><label>TDS amount ₹ <span class="muted">(verify)</span></label><input id="vp_tdsamt" type="number" step="any" value="0" disabled></div>
      <div class="field full"><div class="callout" id="vp_split" style="margin:0"></div></div>
      <div class="field"><label>Date paid *</label><input type="date" id="vp_date" value="${todayISO()}"></div>
      <div class="field"><label>Mode</label><select id="vp_mode">${["UPI","NEFT/RTGS","Cheque","Cash","Card","Other"].map(x=>`<option>${x}</option>`).join("")}</select></div>
      <div class="field full"><label>Note</label><input id="vp_note"></div>
    </div>
    <div class="row"><button class="btn green" id="vpGo">Record payment</button><button class="btn" id="vpCancel">Cancel</button></div>
    <div class="err" id="vpErr"></div></div>`;
  $("vpBack").addEventListener("click",back); $("vpCancel").addEventListener("click",back);
  const vpSync=()=>{ const on=$("vp_tds").checked; $("vp_tdspct").disabled=!on; $("vp_tdsamt").disabled=!on;
    const settled=num($("vp_amt").value), tds=on?num($("vp_tdsamt").value):0, cash=Math.round((settled-tds)*100)/100;
    $("vp_split").innerHTML = on ? `Settling <b>${money(settled)}</b> = cash out <b>${money(cash)}</b> + TDS <b>${money(tds)}</b> (booked to TDS Payable).` : `Cash out of account: <b>${money(settled)}</b>`; };
  $("vp_tds").addEventListener("change",vpSync);
  $("vp_amt").addEventListener("input",()=>{ if($("vp_tds").checked && num($("vp_tdspct").value)) $("vp_tdsamt").value=Math.round(num($("vp_amt").value)*num($("vp_tdspct").value))/100; vpSync(); });
  $("vp_tdspct").addEventListener("input",()=>{ $("vp_tdsamt").value=Math.round(num($("vp_amt").value)*num($("vp_tdspct").value))/100; vpSync(); });
  $("vp_tdsamt").addEventListener("input",vpSync); vpSync();
  $("vpGo").addEventListener("click",()=>window.OPS.once($("vpGo"),async()=>{
    const settled=num($("vp_amt").value); if(!(settled>0)){ $("vpErr").textContent="Enter an amount."; return; }
    const on=$("vp_tds").checked, tds=on?num($("vp_tdsamt").value):0;
    if(tds<0||tds>settled){ $("vpErr").textContent="TDS must be between 0 and the amount settled."; return; }
    const cash=Math.round((settled-tds)*100)/100;
    const { error }=await sb().from("cash_txns").insert({ account_id:$("vp_acct").value, direction:"out",
      txn_date:$("vp_date").value||todayISO(), amount:cash, tds_pct:on?(num($("vp_tdspct").value)||null):null, tds_amount:tds, mode:$("vp_mode").value,
      ref_type:"payable", ref_id:String(x.p.id), note:$("vp_note").value||("Payment — "+(x.p.vendor_invoice_no||"")),
      created_by:window.OPS.me.id });
    if(error){ $("vpErr").textContent=/duplicate|just recorded/i.test(error.message)?"This exact payment was just recorded — check before re-entering.":error.message; return; }
    await recomputePayable(x.p.id, x.p.total);
    window.OPS.audit("paid","payables",x.p.id,money(cash)+(tds>0?(" + TDS "+money(tds)):"")); window.OPS.flashTop("Payment recorded ✓"); back();
  }));
}

/* Payments ledger for a supplier invoice — list, edit, delete */
async function managePayable(x, back){
  const m=$("main");
  const [{data:txns},{data:creds}]=await Promise.all([
    sb().from("cash_txns").select("*, acct:account_id(name)").eq("ref_type","payable").eq("ref_id",String(x.p.id)).order("txn_date",{ascending:false}),
    sb().from("payable_credits").select("*").eq("payable_id",x.p.id).order("credit_date",{ascending:false})
  ]);
  const list=txns||[], cList=creds||[];
  const paid=list.reduce((s,t)=>s+num(t.amount),0), credit=cList.reduce((s,c)=>s+num(c.amount),0);
  const bal=Math.round((num(x.p.total)-paid-credit)*100)/100;
  m.innerHTML=`<button class="btn sm" id="mpBack">← Back</button>
    <div class="card" style="margin-top:12px"><h1>Payments — ${esc(x.p.vendor_invoice_no||'(no no.)')}</h1>
    <p class="muted">${esc(x.vendor_name)} · Invoiced ${money(x.p.total)} · Paid ${money(paid)}${credit>0.005?(' · Credit '+money(credit)):''} · Balance <b>${money(bal)}</b></p>
    <div class="row wrap" style="margin-bottom:8px"><div class="spacer"></div>
      ${bal>0.005?'<button class="btn green sm" id="mpAdd">+ Payment</button>':''}
      <button class="btn sm" id="mpCredit">＋ Credit note from vendor</button></div>
    <h3>Payments</h3>
    ${list.length?`<div style="overflow:auto"><table><thead><tr><th>Date</th><th class="num">Amount</th><th>From</th><th>Mode</th><th>Note</th><th></th></tr></thead>
      <tbody>${list.map(t=>`<tr><td>${fmtDate(t.txn_date)}</td><td class="num">${money(t.amount)}</td>
        <td>${esc((t.acct&&t.acct.name)||'')}</td><td>${esc(t.mode||'')}</td><td>${esc(t.note||'')}</td>
        <td>${window.OPS.canDelete()||t.created_by===window.OPS.me.id?`<button class="btn sm" data-del="${t.id}" style="color:#a3322a;border-color:#e4b4b4">Delete</button>`:''}</td></tr>`).join("")}</tbody></table></div>`
      :'<div class="muted">No payments recorded.</div>'}
    ${cList.length?`<h3 style="margin-top:16px">Credit notes from the vendor</h3>
      <div style="overflow:auto"><table><thead><tr><th>Date</th><th>Credit no.</th><th class="num">Amount</th><th>Note</th><th></th></tr></thead>
      <tbody>${cList.map(c=>`<tr><td>${fmtDate(c.credit_date)}</td><td>${esc(c.credit_no||'')}</td>
        <td class="num" style="color:#3e6b20">${money(c.amount)}</td><td>${esc(c.note||'')}</td>
        <td>${window.OPS.canDelete()||c.created_by===window.OPS.me.id?`<button class="btn sm" data-delc="${c.id}" style="color:#a3322a;border-color:#e4b4b4">Delete</button>`:''}</td></tr>`).join("")}</tbody></table></div>`:''}
    </div>`;
  $("mpBack").addEventListener("click",back);
  const x2={ ...x, balance:bal };
  if($("mpAdd")) $("mpAdd").addEventListener("click",()=>payVendor(x2, ()=>managePayable(x,back)));
  $("mpCredit").addEventListener("click",()=>creditVendor(x, ()=>managePayable(x,back)));
  m.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",async()=>{
    const t=list.find(z=>String(z.id)===b.getAttribute("data-del")); if(!t||!confirm("Delete this payment of "+money(t.amount)+"?")) return;
    const { error }=await sb().from("cash_txns").delete().eq("id",t.id);
    if(error){ alert(error.message); return; }
    await recomputePayable(x.p.id, x.p.total);
    window.OPS.audit("payment_deleted","payables",x.p.id,money(t.amount));
    window.OPS.flashTop("Payment removed ✓"); managePayable(x,back);
  }));
  m.querySelectorAll("[data-delc]").forEach(b=>b.addEventListener("click",async()=>{
    const c=cList.find(z=>String(z.id)===b.getAttribute("data-delc")); if(!c||!confirm("Delete this credit note of "+money(c.amount)+"?")) return;
    const { error }=await sb().from("payable_credits").delete().eq("id",c.id);
    if(error){ alert(error.message); return; }
    await recomputePayable(x.p.id, x.p.total);
    window.OPS.audit("credit_deleted","payables",x.p.id,money(c.amount));
    window.OPS.flashTop("Credit note removed ✓"); managePayable(x,back);
  }));
}

/* record a credit note received from the vendor against this payable */
function creditVendor(x, back){
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="cvBack">← Back</button>
    <div class="card" style="margin-top:12px;max-width:520px"><h1>Vendor credit note</h1>
    <p class="muted">${esc(x.vendor_name)} · Invoice <b>${esc(x.p.vendor_invoice_no||'(no no.)')}</b> · Balance <b>${money(x.balance)}</b></p>
    <div class="callout">A credit note from the vendor reduces what we owe — it settles part of the balance without any money moving.</div>
    <div class="fgrid">
      <div class="field"><label>Credit note no.</label><input id="cv_no"></div>
      <div class="field"><label>Date</label><input type="date" id="cv_date" value="${todayISO()}"></div>
      <div class="field"><label>Amount *</label><input type="number" step="0.01" id="cv_amt" value="${x.balance>0?x.balance:''}"></div>
      <div class="field full"><label>Note</label><input id="cv_note"></div>
    </div>
    <div class="row"><button class="btn green" id="cvGo">Record credit note</button><button class="btn" id="cvCancel">Cancel</button></div>
    <div class="err" id="cvErr"></div></div>`;
  $("cvBack").addEventListener("click",back); $("cvCancel").addEventListener("click",back);
  $("cvGo").addEventListener("click",()=>window.OPS.once($("cvGo"),async()=>{
    const amt=num($("cv_amt").value); if(!(amt>0)){ $("cvErr").textContent="Enter an amount."; return; }
    const { error }=await sb().from("payable_credits").insert({ payable_id:x.p.id, credit_no:$("cv_no").value||null,
      credit_date:$("cv_date").value||todayISO(), amount:amt, note:$("cv_note").value||null, created_by:window.OPS.me.id });
    if(error){ $("cvErr").textContent=error.message; return; }
    await recomputePayable(x.p.id, x.p.total);
    window.OPS.audit("credit","payables",x.p.id,money(amt)); window.OPS.flashTop("Credit note recorded ✓"); back();
  }));
}

function payForm(rec){
  const e=rec||{}; const m=$("main");
  m.innerHTML=`<button class="btn sm" id="pyBack">← Back</button>
    <div class="card" style="margin-top:12px"><div class="eyebrow">Expense Management</div><h1>${rec?"Supplier invoice":"New supplier invoice"}</h1>
    <p class="muted" style="margin-top:-4px">Type the vendor's own invoice details — nothing is uploaded. Marking it paid records the money movement on the day it left the account.</p>
    <div class="fgrid">
      <div class="field"><label>Vendor * <a href="#" id="pyNewVendor" style="font-weight:400">+ new vendor</a></label>
        <select id="py_vendor"><option value="">— select vendor —</option>
        ${vendors.map(v=>`<option value="${v.id}" ${e.vendor_id===v.id?'selected':''}>${esc(vName(v))}</option>`).join("")}</select></div>
      <div class="field"><label>Their invoice number</label><input id="py_no" value="${esc(e.vendor_invoice_no||'')}"></div>
      <div class="field"><label>Invoice date *</label><input type="date" id="py_date" value="${esc(e.invoice_date||todayISO())}"></div>
      <div class="field"><label>Due date</label><input type="date" id="py_due" value="${esc(e.due_date||'')}"></div>
      <div class="field"><label>Amount *</label><input type="number" step="0.01" id="py_amt" value="${esc(e.amount||'')}"></div>
      <div class="field"><label>GST</label><input type="number" step="0.01" id="py_gst" value="${esc(e.gst_amount||0)}"></div>
      <div class="field"><label>Category</label><input id="py_cat" value="${esc(e.category||'')}"></div>
      <div class="field"><label>Status</label><select id="py_status">
        ${["unpaid","cheque_issued","part_paid","paid"].map(s=>`<option value="${s}" ${e.status===s?'selected':''}>${s.replace("_"," ")}</option>`).join("")}</select>
        <div class="small-note">A cheque handed over is <b>cheque issued</b>, not paid — it only hits the Day Book when the bank debits it.</div></div>
      <div class="field full"><label>Note</label><input id="py_note" value="${esc(e.note||'')}"></div>
    </div>
    <div class="row wrap"><button class="btn green" id="pySave">${rec?"Save changes":"Create"}</button>
      <button class="btn" id="pyCancel">Cancel</button>
      <div class="spacer"></div>
      ${rec&&rec.status!=='paid'?`<button class="btn blue sm" id="pyPay">Mark paid…</button>`:''}</div>
    <div class="err" id="pyErr"></div></div>`;
  $("pyBack").addEventListener("click",expenseMgmt); $("pyCancel").addEventListener("click",expenseMgmt);
  $("pyNewVendor").addEventListener("click",ev=>{ ev.preventDefault(); window.OPS.openTool("vendors"); });
  $("pySave").addEventListener("click",async()=>{
    const amt=num($("py_amt").value), gst=num($("py_gst").value);
    if(!$("py_vendor").value){ $("pyErr").textContent="Select the vendor."; return; }
    if(!(amt>0)){ $("pyErr").textContent="Enter an amount."; return; }
    const out={ vendor_id:$("py_vendor").value, vendor_invoice_no:$("py_no").value||null,
      invoice_date:$("py_date").value||todayISO(), due_date:$("py_due").value||null,
      amount:amt, gst_amount:gst, total:amt+gst, category:$("py_cat").value||null,
      status:$("py_status").value, note:$("py_note").value||null };
    let err;
    if(rec){ ({error:err}=await sb().from("payables").update(out).eq("id",rec.id)); }
    else { out.created_by=window.OPS.me.id; ({error:err}=await sb().from("payables").insert(out)); }
    if(err){ $("pyErr").textContent=err.message; return; }
    window.OPS.audit(rec?"edited":"created","payables",rec?rec.id:"new",out.vendor_invoice_no||"");
    window.OPS.flashTop("Saved ✓"); expenseMgmt();
  });
  if($("pyPay")) $("pyPay").addEventListener("click",async()=>{
    const { data }=await sb().from("cash_txns").select("amount").eq("ref_type","payable").eq("ref_id",String(rec.id));
    const paid=(data||[]).reduce((s,t)=>s+num(t.amount),0);
    const bal=Math.round((num(rec.total)-paid)*100)/100;
    payVendor({ p:rec, paid, balance:bal, vendor_name:vName(rec.vendor||vendors.find(v=>v.id===rec.vendor_id)) }, expenseMgmt);
  });
}

/* settle a payable or expense — records the money movement on the chosen date */
function settle(kind, id, suggested, back){
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="stBack">← Cancel</button>
    <div class="card" style="margin-top:12px;max-width:520px"><h1>Mark paid</h1>
    <div class="callout warn">Enter the date the money <b>actually left the account</b> — not the date a cheque was handed over.</div>
    <div class="fgrid">
      <div class="field"><label>Account *</label><select id="st_acct">${accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Date paid *</label><input type="date" id="st_date" value="${todayISO()}"></div>
      <div class="field"><label>Amount settled *</label><input type="number" step="0.01" id="st_amt" value="${suggested||''}"></div>
      <div class="field"><label>Mode</label><select id="st_mode">${["UPI","NEFT/RTGS","Cheque","Cash","Card","Other"].map(x=>`<option>${x}</option>`).join("")}</select></div>
      <div class="field full"><label style="display:inline"><input type="checkbox" id="st_tds" style="width:auto"> We deducted TDS</label></div>
      <div class="field"><label>TDS %</label><input id="st_tdspct" type="number" step="any" placeholder="e.g. 2" disabled></div>
      <div class="field"><label>TDS amount ₹ <span class="muted">(verify)</span></label><input id="st_tdsamt" type="number" step="any" value="0" disabled></div>
      <div class="field full"><div class="callout" id="st_split" style="margin:0"></div></div>
      <div class="field full"><label>Note</label><input id="st_note"></div>
    </div>
    <div class="row"><button class="btn green" id="stGo">Record payment</button></div>
    <div class="err" id="stErr"></div></div>`;
  $("stBack").addEventListener("click",back);
  const stSync=()=>{ const on=$("st_tds").checked; $("st_tdspct").disabled=!on; $("st_tdsamt").disabled=!on;
    const settled=num($("st_amt").value), tds=on?num($("st_tdsamt").value):0, cash=Math.round((settled-tds)*100)/100;
    $("st_split").innerHTML = on ? `Settling <b>${money(settled)}</b> = cash out <b>${money(cash)}</b> + TDS <b>${money(tds)}</b> (TDS Payable).` : `Cash out: <b>${money(settled)}</b>`; };
  $("st_tds").addEventListener("change",stSync);
  $("st_amt").addEventListener("input",()=>{ if($("st_tds").checked && num($("st_tdspct").value)) $("st_tdsamt").value=Math.round(num($("st_amt").value)*num($("st_tdspct").value))/100; stSync(); });
  $("st_tdspct").addEventListener("input",()=>{ $("st_tdsamt").value=Math.round(num($("st_amt").value)*num($("st_tdspct").value))/100; stSync(); });
  $("st_tdsamt").addEventListener("input",stSync); stSync();
  $("stGo").addEventListener("click",()=>window.OPS.once($("stGo"),async()=>{
    const settled=num($("st_amt").value); if(!(settled>0)){ $("stErr").textContent="Enter an amount."; return; }
    const on=$("st_tds").checked, tds=on?num($("st_tdsamt").value):0;
    if(tds<0||tds>settled){ $("stErr").textContent="TDS must be between 0 and the amount settled."; return; }
    const cash=Math.round((settled-tds)*100)/100;
    const { error }=await sb().from("cash_txns").insert({ account_id:$("st_acct").value, direction:"out",
      txn_date:$("st_date").value||todayISO(), amount:cash, tds_pct:on?(num($("st_tdspct").value)||null):null, tds_amount:tds, mode:$("st_mode").value,
      ref_type:kind, ref_id:String(id), note:$("st_note").value||null, created_by:window.OPS.me.id });
    if(error){ $("stErr").textContent=/duplicate|just recorded/i.test(error.message)?"This exact payment was just recorded — check before re-entering.":error.message; return; }
    // recompute status from cumulative settled (cash + TDS) across all payments
    const { data:all }=await sb().from("cash_txns").select("amount,tds_amount").eq("ref_type",kind).eq("ref_id",String(id));
    const paidTot=(all||[]).reduce((s,t)=>s+num(t.amount)+num(t.tds_amount),0);
    const status = paidTot>=num(suggested)-0.005 ? "paid" : (paidTot>0 ? "part_paid" : "unpaid");
    const tbl = kind==="payable" ? "payables" : "expenses";
    await sb().from(tbl).update({ status }).eq("id",id);
    window.OPS.audit("paid",tbl,id,money(cash)+(tds>0?(" + TDS "+money(tds)):""));
    window.OPS.flashTop("Payment recorded ✓"); back();
  }));
}

/* ========================= ADVANCES ========================= */
async function advances(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Finance &amp; Accounting</div><h1>Advances</h1>
    <div class="callout">Money paid out <b>before</b> the expense is known — a tour or fuel advance to an employee,
      or an advance to a vendor. It stays outstanding until it is accounted for: either by the expenses actually
      incurred, or by returning the balance.</div>
    <div class="row wrap" style="margin:10px 0"><div class="spacer"></div>
      <button class="btn green sm" id="adNew">+ New advance</button></div>
    <div id="adBody" class="muted">Loading…</div>`;
  await refs();
  $("adNew").addEventListener("click",()=>advForm(null));
  const { data, error }=await sb().from("v_advances_open").select("*").order("issued_on",{ascending:false});
  if(error){ $("adBody").innerHTML='<div class="card">'+esc(error.message)+'</div>'; return; }
  const rows=data||[], open=rows.filter(r=>r.status==='open');
  const tot=open.reduce((s,r)=>s+num(r.outstanding),0);
  $("adBody").innerHTML=`
    ${open.length?`<div class="statrow"><div class="stat" style="background:#fff0db"><div class="n" style="color:#9a5b00">${money(tot)}</div><div class="l">Advances outstanding</div></div>
      <div class="stat"><div class="n">${open.length}</div><div class="l">Open advances</div></div></div>`:''}
    <div class="card"><h3>Advances</h3>
    ${rows.length?`<div style="overflow:auto"><table><thead><tr><th>Issued</th><th>To</th><th>Purpose</th>
      <th class="num">Amount</th><th class="num">Settled</th><th class="num">Outstanding</th><th>Status</th></tr></thead>
      <tbody>${rows.map(r=>`<tr class="clickable" data-id="${r.id}"><td>${fmtDate(r.issued_on)}</td>
        <td><b>${esc(r.party_name||'')}</b> <span class="muted">${esc(r.party_kind)}</span></td>
        <td>${esc(r.purpose||'')}</td><td class="num">${money(r.amount)}</td>
        <td class="num">${money(r.settled)}</td>
        <td class="num" style="font-weight:700;color:${num(r.outstanding)>0?'#9a5b00':'#3e6b20'}">${money(r.outstanding)}</td>
        <td>${r.status==='settled'?'<span class="chip paid">Settled</span>':'<span class="chip issued">Open</span>'}</td></tr>`).join("")}</tbody></table></div>`
      :'<div class="muted">No advances yet.</div>'}</div>`;
  $("adBody").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>
    advForm(rows.find(x=>String(x.id)===tr.getAttribute("data-id")))));
}

function advForm(rec){
  const e=rec||{}; const m=$("main"); const isNew=!rec;
  m.innerHTML=`<button class="btn sm" id="avBack">← Back to Advances</button>
    <div class="card" style="margin-top:12px"><div class="eyebrow">Accounting</div><h1>${isNew?"New advance":"Advance"}</h1>
    ${!isNew?`<div class="callout"><b>${esc(e.party_name||'')}</b> · issued ${fmtDate(e.issued_on)} ·
      ${money(e.amount)} · settled ${money(e.settled)} ·
      <b style="color:${num(e.outstanding)>0?'#9a5b00':'#3e6b20'}">outstanding ${money(e.outstanding)}</b></div>`:''}
    <div class="fgrid">
      <div class="field"><label>Paid to *</label><select id="av_kind" ${isNew?'':'disabled'}>
        ${["employee","vendor","other"].map(k=>`<option value="${k}" ${e.party_kind===k?'selected':''}>${k}</option>`).join("")}</select></div>
      <div class="field"><label>Vendor <span class="muted">(if a vendor advance)</span></label><select id="av_vendor" ${isNew?'':'disabled'}>
        <option value="">— none —</option>
        ${vendors.map(v=>`<option value="${v.id}" ${e.vendor_id===v.id?'selected':''}>${esc(vName(v))}</option>`).join("")}</select></div>
      <div class="field"><label>Or name the person</label><input id="av_payee" value="${esc(e.payee_text||'')}" ${isNew?'':'disabled'}></div>
      <div class="field"><label>Amount *</label><input type="number" step="0.01" id="av_amt" value="${esc(e.amount||'')}" ${isNew?'':'disabled'}></div>
      <div class="field"><label>Issued on *</label><input type="date" id="av_on" value="${esc(e.issued_on||todayISO())}" ${isNew?'':'disabled'}></div>
      <div class="field"><label>Purpose</label><input id="av_purpose" value="${esc(e.purpose||'')}" ${isNew?'':'disabled'}></div>
      ${isNew?`<div class="field"><label>Pay from account *</label><select id="av_acct">${accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Mode</label><select id="av_mode">${["UPI","NEFT/RTGS","Cheque","Cash","Other"].map(x=>`<option>${x}</option>`).join("")}</select></div>`:''}
    </div>
    ${isNew?'<div class="small-note">Issuing the advance records the money leaving the account on the date above, so it appears in that day\'s Day Book.</div>':''}
    <div class="row" style="margin-top:10px">${isNew?'<button class="btn green" id="avSave">Issue advance</button>':''}
      <button class="btn" id="avCancel">${isNew?'Cancel':'Back'}</button></div>
    <div class="err" id="avErr"></div></div>
    ${!isNew && num(e.outstanding)>0?`<div class="card"><h3>Account for this advance</h3>
      <p class="muted" style="margin-top:-4px">Record what the money was spent on, or the balance returned.</p>
      <div class="fgrid">
        <div class="field"><label>How</label><select id="sv_kind">
          <option value="expense">Spent — expense incurred</option>
          <option value="repayment">Returned — money back</option>
          <option value="write_off">Written off</option></select></div>
        <div class="field"><label>Amount *</label><input type="number" step="0.01" id="sv_amt" value="${num(e.outstanding)}"></div>
        <div class="field"><label>Date</label><input type="date" id="sv_on" value="${todayISO()}"></div>
        <div class="field"><label>Note</label><input id="sv_note"></div>
      </div>
      <div class="small-note">A <b>repayment</b> also needs the money-in entry on the Day Book for the day it was returned.</div>
      <div class="row" style="margin-top:8px"><button class="btn green" id="svGo">Record</button></div>
      <div class="err" id="svErr"></div></div>`:''}`;
  $("avBack").addEventListener("click",advances); $("avCancel").addEventListener("click",advances);
  if($("avSave")) $("avSave").addEventListener("click",()=>window.OPS.once($("avSave"),async()=>{
    const amt=num($("av_amt").value); if(!(amt>0)){ $("avErr").textContent="Enter an amount."; return; }
    const on=$("av_on").value||todayISO();
    const { data:ins, error }=await sb().from("advances").insert({
      party_kind:$("av_kind").value, vendor_id:$("av_vendor").value||null,
      payee_text:$("av_payee").value||null, amount:amt, issued_on:on,
      purpose:$("av_purpose").value||null, created_by:window.OPS.me.id }).select().single();
    if(error){ $("avErr").textContent=error.message; return; }
    const { error:tErr }=await sb().from("cash_txns").insert({ account_id:$("av_acct").value, direction:"out",
      txn_date:on, amount:amt, mode:$("av_mode").value, ref_type:"advance", ref_id:String(ins.id),
      note:"Advance — "+($("av_purpose").value||""), created_by:window.OPS.me.id });
    if(tErr){ $("avErr").textContent="Advance saved, but the payment could not be recorded: "+tErr.message; return; }
    window.OPS.audit("created","advances",ins.id,money(amt)); window.OPS.flashTop("Advance issued ✓"); advances();
  }));
  if($("svGo")) $("svGo").addEventListener("click",async()=>{
    const amt=num($("sv_amt").value); if(!(amt>0)){ $("svErr").textContent="Enter an amount."; return; }
    if(amt>num(e.outstanding)+0.005){ $("svErr").textContent="That is more than the outstanding balance."; return; }
    const { error }=await sb().rpc("settle_advance",{ p_id:rec.id, p_kind:$("sv_kind").value, p_ref:null,
      p_amount:amt, p_on:$("sv_on").value||todayISO(), p_note:$("sv_note").value||null });
    if(error){ $("svErr").textContent=error.message; return; }
    window.OPS.flashTop("Recorded ✓"); advances();
  });
}

/* ========================= POSITION ========================= */
async function position(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Finance &amp; Accounting</div><h1>Position</h1>
    <div class="callout">Where the money stands right now — what we owe, what is owed to us, what is sitting as
      advances, and anything the Day Book has flagged.</div>
    <div id="poBody" class="muted">Loading…</div>`;
  await refs();
  const [pay,rec,adv,flag,uncl]=await Promise.all([
    sb().from("v_payables_open").select("*"),
    sb().from("v_receivables_open").select("*"),
    sb().from("v_advances_open").select("*").eq("status","open"),
    sb().from("v_accounting_flags").select("*").order("close_date",{ascending:false}).limit(20),
    sb().from("v_days_unclosed").select("*").order("day",{ascending:false}).limit(20)
  ]);
  loadBankBalances();
  const P=(pay.data||[]), R=(rec.data||[]).filter(r=>num(r.balance)>0.01), A=(adv.data||[]);
  const F=(flag.data||[]), U=(uncl.data||[]);
  const tp=P.reduce((s,r)=>s+num(r.balance),0), tr=R.reduce((s,r)=>s+num(r.balance),0), ta=A.reduce((s,r)=>s+num(r.outstanding),0);
  const bucket=d=>d<=30?'0–30':d<=60?'31–60':d<=90?'61–90':'>90';
  const age={}; R.forEach(r=>{ const b=bucket(num(r.age_days)); age[b]=(age[b]||0)+num(r.balance); });

  const net=tr - tp + ta;   // due to us − we owe + advances we can recover
  $("poBody").innerHTML=`
    <div class="statrow">
      <div class="stat"><div class="n">${money(tr)}</div><div class="l">Receivable</div></div>
      <div class="stat" style="background:#fbe0de"><div class="n" style="color:#a3322a">${money(tp)}</div><div class="l">Payable</div></div>
      <div class="stat" style="background:#fff0db"><div class="n" style="color:#9a5b00">${money(ta)}</div><div class="l">Advances out</div></div>
      <div class="stat" style="background:${net>=0?'var(--soft-green)':'#fbe0de'}"><div class="n" style="color:${net>=0?'#3e6b20':'#a3322a'}">${money(net)}</div><div class="l">Net (receivable − payable + advances)</div></div>
      <div class="stat" style="${(F.length||U.length)?'background:#fbe0de':''}"><div class="n" style="${(F.length||U.length)?'color:#a3322a':''}">${F.length+U.length}</div><div class="l">Red flags</div></div>
    </div>
    <div id="poBank" class="statrow"></div>
    ${(F.length||U.length)?`<div class="card" style="border-left:4px solid #a3322a"><h3>⚑ Needs attention</h3>
      ${F.length?`<p class="muted" style="margin:-4px 0 6px"><b>Days closed with a difference</b></p>
        <table><thead><tr><th>Date</th><th>Account</th><th class="num">Difference</th><th>Note</th></tr></thead>
        <tbody>${F.map(f=>`<tr><td>${fmtDate(f.close_date)}</td><td>${esc(f.account_name)}</td>
          <td class="num" style="color:#a3322a;font-weight:700">${money(f.difference)}</td><td>${esc(f.note||'')}</td></tr>`).join("")}</tbody></table>`:''}
      ${U.length?`<p class="muted" style="margin:10px 0 6px"><b>Days with movement that were never closed</b></p>
        <table><thead><tr><th>Date</th><th>Account</th></tr></thead>
        <tbody>${U.map(u=>`<tr><td>${fmtDate(u.day)}</td><td>${esc(u.account_name)}</td></tr>`).join("")}</tbody></table>`:''}
    </div>`:'<div class="callout">No red flags — every day with movement is closed and matched. 🎉</div>'}

    <div class="card"><h3>Receivables ageing</h3>
      <table><thead><tr><th>0–30</th><th>31–60</th><th>61–90</th><th>&gt;90</th></tr></thead>
      <tbody><tr>${['0–30','31–60','61–90','>90'].map(b=>`<td class="num" style="${b==='>90'&&age[b]?'color:#a3322a;font-weight:700':''}">${money(age[b]||0)}</td>`).join("")}</tr></tbody></table></div>

    <div class="card"><h3>Payable to vendors</h3>
      ${P.length?`<div style="overflow:auto"><table><thead><tr><th>Vendor</th><th>Invoice</th><th>Due</th><th class="num">Balance</th><th>Status</th></tr></thead>
        <tbody>${P.sort((a,b)=>String(a.due_date||'').localeCompare(String(b.due_date||''))).map(r=>`<tr><td><b>${esc(r.vendor_name||'')}</b></td>
          <td>${esc(r.vendor_invoice_no||'')}</td><td>${r.due_date?fmtDate(r.due_date):'—'}</td>
          <td class="num"><b>${money(r.balance)}</b></td>
          <td>${r.status==='cheque_issued'?'<span class="chip in_review">Cheque issued</span>':'<span class="chip issued">'+esc(r.status.replace("_"," "))+'</span>'}</td></tr>`).join("")}</tbody></table></div>`
        :'<div class="muted">Nothing payable. 🎉</div>'}</div>

    <div class="card"><h3>Advances outstanding</h3>
      ${A.length?`<table><thead><tr><th>Issued</th><th>To</th><th>Purpose</th><th class="num">Outstanding</th></tr></thead>
        <tbody>${A.map(a=>`<tr><td>${fmtDate(a.issued_on)}</td><td><b>${esc(a.party_name||'')}</b></td>
          <td>${esc(a.purpose||'')}</td><td class="num" style="color:#9a5b00;font-weight:700">${money(a.outstanding)}</td></tr>`).join("")}</tbody></table>`
        :'<div class="muted">No advances outstanding.</div>'}</div>
    <div id="poTB"></div>`;
  loadTrialBalance();
}

/* Live balance of each account = opening + all receipts − all payments to date,
   so cash on hand sits next to what is owed and owing. */
async function loadBankBalances(){
  const host=$("poBank"); if(!host) return;
  const [{data:accs},{data:closes},{data:txns},{data:rc}]=await Promise.all([
    sb().from("cash_accounts").select("*").eq("is_active",true).order("kind"),
    sb().from("day_close").select("account_id,close_date,actual_closing").order("close_date",{ascending:false}),
    sb().from("cash_txns").select("account_id,direction,amount,txn_date"),
    sb().from("payments").select("account_id,amount,paid_on")
  ]);
  host.innerHTML=(accs||[]).map(a=>{
    // start from the latest actual close if there is one, else the opening balance
    const lastClose=(closes||[]).find(c=>c.account_id===a.id);
    const base = lastClose ? { on:lastClose.close_date, bal:num(lastClose.actual_closing) } : { on:a.opened_on, bal:num(a.opening_balance) };
    let bal=base.bal;
    (txns||[]).forEach(t=>{ if(t.account_id===a.id && t.txn_date>base.on) bal += (t.direction==='in'?num(t.amount):-num(t.amount)); });
    (rc||[]).forEach(p=>{ if(p.account_id===a.id && p.paid_on>base.on) bal += num(p.amount); });
    return `<div class="stat" style="background:#eef3fb"><div class="n" style="color:var(--blue)">${money(bal)}</div><div class="l">${esc(a.name)}${a.kind==='cash'?' (cash)':''}</div></div>`;
  }).join("");
}

/* Trial balance straight from the journal — every movement posts double-entry,
   so total debits must equal total credits. If they ever differ, something
   bypassed the journal and needs investigating. */
async function loadTrialBalance(){
  const host=$("poTB"); if(!host) return;
  const { data, error }=await sb().from("v_trial_balance").select("*");
  if(error || !data || !data.length){ host.innerHTML=""; return; }
  const dr=data.reduce((s,r)=>s+num(r.debit),0), cr=data.reduce((s,r)=>s+num(r.credit),0);
  const ok=Math.abs(dr-cr)<0.005;
  host.innerHTML=`<div class="card"><h3>Trial balance</h3>
    <p class="muted" style="margin-top:-4px">Built from the journal — every receipt, payment, supplier invoice, expense and advance posts here automatically.</p>
    <div style="overflow:auto"><table><thead><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
    <tbody>${data.map(r=>`<tr><td>${esc(r.account)}</td><td class="num">${money(r.debit)}</td>
      <td class="num">${money(r.credit)}</td>
      <td class="num" style="font-weight:700">${money(r.balance)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td><b>Total</b></td><td class="num"><b>${money(dr)}</b></td><td class="num"><b>${money(cr)}</b></td>
      <td class="num" style="color:${ok?'#3e6b20':'#a3322a'}"><b>${ok?'balanced ✓':money(dr-cr)}</b></td></tr></tfoot></table></div>
    ${ok?'':'<div class="callout warn" style="margin-top:10px">⚠ The journal does not balance. Something was written without a matching entry — tell the developer.</div>'}</div>`;
}

window.OPS.routes.day_book     = dayBook;
window.OPS.routes.expense_mgmt = expenseMgmt;
window.OPS.routes.advances     = advances;
window.OPS.routes.acct_position = position;
})();
