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
  $("mvSave").addEventListener("click",async()=>{
    const amt=num($("mvAmt").value); if(!(amt>0)){ $("mvErr").textContent="Enter an amount."; return; }
    const { error }=await sb().from("cash_txns").insert({ account_id:acctId, direction:dir, txn_date:theDate,
      amount:amt, mode:$("mvMode").value, ref_type:$("mvRef").value, note:$("mvNote").value||null,
      created_by:window.OPS.me.id });
    if(error){ $("mvErr").textContent=error.message; return; }
    window.OPS.flashTop("Saved ✓"); loadDayBack();
  });
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

async function listPayables(){
  const { data, error }=await sb().from("v_payables_open").select("*").order("invoice_date",{ascending:false}).limit(300);
  const { data:paid }=await sb().from("payables").select("*, vendor:vendor_id(firm_name,name)").eq("status","paid").order("invoice_date",{ascending:false}).limit(100);
  if(error){ $("emBody").innerHTML='<div class="card">'+esc(error.message)+'</div>'; return; }
  const open=data||[];
  const tot=open.reduce((s,r)=>s+num(r.balance),0);
  $("emBody").innerHTML=`
    ${open.length?`<div class="statrow"><div class="stat"><div class="n">${money(tot)}</div><div class="l">Payable outstanding</div></div>
      <div class="stat"><div class="n">${open.length}</div><div class="l">Open invoices</div></div></div>`:''}
    <div class="card"><h3>Open supplier invoices</h3>
    ${open.length?`<div style="overflow:auto"><table>
      <thead><tr><th>Vendor</th><th>Their invoice no.</th><th>Date</th><th>Due</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th></tr></thead>
      <tbody>${open.map(r=>`<tr class="clickable" data-id="${r.id}"><td><b>${esc(r.vendor_name||'')}</b></td>
        <td>${esc(r.vendor_invoice_no||'')}</td><td>${fmtDate(r.invoice_date)}</td>
        <td>${r.due_date?fmtDate(r.due_date):'—'}</td><td class="num">${money(r.total)}</td>
        <td class="num"><b>${money(r.balance)}</b></td>
        <td>${r.status==='cheque_issued'?'<span class="chip in_review">Cheque issued</span>':(r.status==='part_paid'?'<span class="chip partial">Part paid</span>':'<span class="chip issued">Unpaid</span>')}</td></tr>`).join("")}</tbody></table></div>`
      :'<div class="muted">Nothing outstanding. 🎉</div>'}</div>
    ${(paid&&paid.length)?`<div class="card"><h3>Recently paid</h3><div style="overflow:auto"><table>
      <thead><tr><th>Vendor</th><th>Invoice no.</th><th>Date</th><th class="num">Total</th></tr></thead>
      <tbody>${paid.map(r=>`<tr class="clickable" data-pid="${r.id}"><td>${esc(vName(r.vendor))}</td><td>${esc(r.vendor_invoice_no||'')}</td>
        <td>${fmtDate(r.invoice_date)}</td><td class="num">${money(r.total)}</td></tr>`).join("")}</tbody></table></div></div>`:''}`;
  $("emBody").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>
    payForm(open.find(x=>String(x.id)===tr.getAttribute("data-id")))));
  $("emBody").querySelectorAll("[data-pid]").forEach(tr=>tr.addEventListener("click",()=>
    payForm((paid||[]).find(x=>String(x.id)===tr.getAttribute("data-pid")))));
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
  if($("pyPay")) $("pyPay").addEventListener("click",()=>settle("payable",rec.id,num(rec.balance!=null?rec.balance:rec.total),expenseMgmt));
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
      <div class="field"><label>Amount *</label><input type="number" step="0.01" id="st_amt" value="${suggested||''}"></div>
      <div class="field"><label>Mode</label><select id="st_mode">${["UPI","NEFT/RTGS","Cheque","Cash","Card","Other"].map(x=>`<option>${x}</option>`).join("")}</select></div>
      <div class="field full"><label>Note</label><input id="st_note"></div>
    </div>
    <div class="row"><button class="btn green" id="stGo">Record payment</button></div>
    <div class="err" id="stErr"></div></div>`;
  $("stBack").addEventListener("click",back);
  $("stGo").addEventListener("click",async()=>{
    const amt=num($("st_amt").value); if(!(amt>0)){ $("stErr").textContent="Enter an amount."; return; }
    $("stGo").disabled=true;
    const { error }=await sb().from("cash_txns").insert({ account_id:$("st_acct").value, direction:"out",
      txn_date:$("st_date").value||todayISO(), amount:amt, mode:$("st_mode").value,
      ref_type:kind, ref_id:String(id), note:$("st_note").value||null, created_by:window.OPS.me.id });
    if(error){ $("stGo").disabled=false; $("stErr").textContent=error.message; return; }
    // update the source record's status
    const tbl = kind==="payable" ? "payables" : "expenses";
    const newStatus = kind==="payable" ? (amt>=suggested-0.005 ? "paid" : "part_paid") : "paid";
    await sb().from(tbl).update({ status:newStatus }).eq("id",id);
    window.OPS.audit("paid",tbl,id,money(amt));
    window.OPS.flashTop("Payment recorded ✓"); back();
  });
}

window.OPS.routes.day_book    = dayBook;
window.OPS.routes.expense_mgmt = expenseMgmt;
})();
