/* ============================================================================
   DroCon Cloud — Invoices & Receivables
   The headline output: every invoice with amount paid, balance, and the AGE of
   the receivable from the invoice date, plus aging buckets. Credit notes linked
   to an invoice reduce its outstanding. Record payments inline.
   ============================================================================ */
(function(){
const { $, esc, money, num, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;

function daysBetween(d){ if(!d) return 0; return Math.max(0, Math.floor((Date.now()-new Date(d).getTime())/86400000)); }
function bucket(age){ return age<=30?"0-30":age<=60?"31-60":age<=90?"61-90":">90"; }

async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Trackers</div><h1>Invoices &amp; Receivables</h1>
    <div class="row" style="margin:6px 0"><label style="margin:0">Entity</label>
      <select id="rEntity" style="width:auto"><option value="">All</option><option>DCB</option><option>IBS</option></select>
      <div class="spacer"></div><button class="btn sm" id="rImport">⬆ Import invoice tracker (CSV)</button></div>
    <div id="rHost" class="muted">Loading…</div>`;
  $("rImport").addEventListener("click",importInvoices);
  $("rEntity").addEventListener("change",()=>{ window.OPS._recEntity=$("rEntity").value; load(); });
  if(window.OPS._recEntity) $("rEntity").value=window.OPS._recEntity;
  load();
}
async function load(){
  const entity=window.OPS._recEntity||"";
  let invQ=sb().from("documents").select("*").eq("doc_type","invoice").order("doc_date",{ascending:false});
  if(entity) invQ=invQ.eq("entity",entity);
  const [{data:invs},{data:cns},{data:pays}]=await Promise.all([
    invQ,
    sb().from("documents").select("id,number,related_doc_id,totals").eq("doc_type","credit_note"),
    sb().from("payments").select("*") ]);
  const paidByDoc={}, creditByInv={};
  (pays||[]).forEach(p=>{ paidByDoc[p.document_id]=(paidByDoc[p.document_id]||0)+num(p.amount); });
  (cns||[]).forEach(c=>{ if(c.related_doc_id) creditByInv[c.related_doc_id]=(creditByInv[c.related_doc_id]||0)+num((c.totals||{}).total); });

  const rows=(invs||[]).map(r=>{
    const gross=num((r.totals||{}).total); const credit=creditByInv[r.id]||0; const paid=paidByDoc[r.id]||0;
    const balance=Math.round((gross-credit-paid)*100)/100;
    const age = balance>0 ? daysBetween(r.doc_date) : 0;
    const status = balance<=0.01 ? "paid" : (paid>0||credit>0 ? "partial" : "issued");
    return { r, gross, credit, paid, balance, age, status, party:((r.party_snapshot||{}).firmName)||((r.party_snapshot||{}).name)||"" };
  });

  const totReceivable=rows.reduce((s,x)=>s+Math.max(0,x.balance),0);
  const totInvoiced=rows.reduce((s,x)=>s+x.gross,0);
  const buckets={"0-30":0,"31-60":0,"61-90":0,">90":0};
  rows.forEach(x=>{ if(x.balance>0) buckets[bucket(x.age)]+=x.balance; });
  const overdue=rows.filter(x=>x.balance>0 && x.age>30).length;

  $("rHost").innerHTML=`
    <div class="statrow">
      <div class="stat"><div class="n">${money(totReceivable)}</div><div class="l">Total receivable</div></div>
      <div class="stat"><div class="n">${money(totInvoiced)}</div><div class="l">Total invoiced</div></div>
      <div class="stat"><div class="n">${rows.length}</div><div class="l">Invoices</div></div>
      <div class="stat"><div class="n">${overdue}</div><div class="l">Overdue &gt;30d</div></div>
    </div>
    <div class="card"><h3>Receivables aging</h3>
      <table><thead><tr><th>0–30 days</th><th>31–60 days</th><th>61–90 days</th><th>&gt; 90 days</th></tr></thead>
      <tbody><tr>
        <td>${money(buckets["0-30"])}</td><td>${money(buckets["31-60"])}</td>
        <td style="${buckets["61-90"]>0?'color:#9a5b00;font-weight:700':''}">${money(buckets["61-90"])}</td>
        <td style="${buckets[">90"]>0?'color:#a3322a;font-weight:700':''}">${money(buckets[">90"])}</td>
      </tr></tbody></table>
    </div>
    <div class="row" style="margin:8px 0"><input id="rSearch" placeholder="Search invoice / client…" style="max-width:280px">
      <div class="spacer"></div>
      <label class="muted" style="display:inline"><input type="checkbox" id="rOnlyDue" style="width:auto"> only with balance</label></div>
    <div id="rTable"></div>`;

  function renderTable(){
    const q=($("rSearch").value||"").toLowerCase().trim(); const onlyDue=$("rOnlyDue").checked;
    let list=rows.filter(x=>(!onlyDue||x.balance>0) && (!q || x.r.number.toLowerCase().includes(q) || x.party.toLowerCase().includes(q)));
    $("rTable").innerHTML = `<table><thead><tr><th>Entity</th><th>Invoice</th><th>Date</th><th>Client</th><th class="num">Invoiced</th><th class="num">Paid</th><th class="num">Balance</th><th class="num">Age (d)</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map(x=>`<tr><td><span class="tag" style="background:${x.r.entity==='IBS'?'var(--blue)':'var(--green)'}">${esc(x.r.entity||'DCB')}</span></td><td><b>${esc(x.r.number)}</b></td><td>${fmtDate(x.r.doc_date)}</td><td>${esc(x.party)}</td>
        <td class="num">${money(x.gross)}</td><td class="num">${money(x.paid+x.credit)}</td>
        <td class="num" style="${x.balance>0?'font-weight:700':''}">${money(x.balance)}</td>
        <td class="num" style="${x.balance>0&&x.age>30?'color:#a3322a;font-weight:700':''}">${x.balance>0?x.age:'—'}</td>
        <td>${window.OPS.statusChip(x.status)}</td>
        <td>${x.balance>0?`<button class="btn sm" data-pay="${x.r.id}">+ Payment</button>`:''}</td></tr>`).join("")}</tbody></table>`;
    $("rTable").querySelectorAll("[data-pay]").forEach(b=>b.addEventListener("click",()=>recordPayment(rows.find(z=>z.r.id===b.getAttribute("data-pay")))));
  }
  renderTable();
  $("rSearch").addEventListener("input",renderTable);
  $("rOnlyDue").addEventListener("change",renderTable);
}

function recordPayment(x){
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="pBack">← Back to Receivables</button>
    <div class="card" style="margin-top:12px;max-width:480px">
      <h1>Record payment</h1>
      <p class="muted">Invoice <b>${esc(x.r.number)}</b> · ${esc(x.party)} · Balance <b>${money(x.balance)}</b></p>
      <div class="fgrid">
        <div class="field"><label>Amount *</label><input id="pAmt" type="number" step="any" value="${x.balance>0?x.balance:''}"></div>
        <div class="field"><label>Date</label><input id="pDate" type="date" value="${todayISO()}"></div>
        <div class="field"><label>Mode</label><select id="pMode"><option>UPI</option><option>NEFT/RTGS</option><option>Cash</option><option>Cheque</option><option>Other</option></select></div>
        <div class="field"><label>Note</label><input id="pNote"></div>
      </div>
      <div class="row"><button class="btn green" id="pSave">Save payment</button><button class="btn" id="pCancel">Cancel</button></div>
      <div class="err" id="pErr"></div>
    </div>`;
  $("pBack").addEventListener("click",view); $("pCancel").addEventListener("click",view);
  $("pSave").addEventListener("click",async()=>{
    const amt=num($("pAmt").value); if(amt<=0){ $("pErr").textContent="Enter a positive amount."; return; }
    const { error }=await sb().from("payments").insert({ document_id:x.r.id, amount:amt, paid_on:$("pDate").value||todayISO(),
      mode:$("pMode").value, note:$("pNote").value||null, created_by:window.OPS.me.id });
    if(error){ $("pErr").textContent=error.message; return; }
    // update invoice status
    const newPaid=x.paid+amt; const newBal=x.gross-x.credit-newPaid;
    await sb().from("documents").update({ status: newBal<=0.01?"paid":"partial" }).eq("id",x.r.id);
    window.OPS.audit("payment","document",x.r.id,money(amt)+" via "+$("pMode").value);
    window.OPS.flashTop("Payment recorded ✓"); view();
  });
}

/* ---------- import invoice tracker (DCB + IBS) ---------- */
function importInvoices(){
  window.OPS.csv.pickCSV(async rows=>{
    if(!rows.length){ alert("No rows."); return; }
    const g=(r,k)=>{ const kk=Object.keys(r).find(h=>h.toLowerCase().trim()===k); return kk?String(r[kk]).trim():""; };
    const n=v=>{ v=String(v||"").replace(/[₹,%\s]/g,""); return v===""?0:(isNaN(+v)?0:+v); };
    const fyOfNum=num0=>{ const m=String(num0).match(/(\d{2})-(\d{2})/); return m?(m[1]+"-"+m[2]):null; };
    const docs=[], recvByKey={};
    rows.forEach(r=>{
      const number=g(r,"invoice number"); if(!number) return;
      const entity=g(r,"entity")||"DCB";
      const billed=n(g(r,"billed acres")); const amount=n(g(r,"amount"));
      const gstRate=n(g(r,"gst rate")); const gstAmt=n(g(r,"gst amount"));
      const payable=n(g(r,"total payable"))|| (amount+gstAmt) || n(g(r,"total invoiced"));
      const received=n(g(r,"amount received"));
      const st=(g(r,"status")||"").toLowerCase();
      const status= st.includes("paid")&&!st.includes("partial")&&!st.includes("un") ? "paid" : (received>0?"partial":"issued");
      docs.push({
        doc_type:"invoice", number, entity, fiscal_year: fyOfNum(number) || fyOfNum(g(r,"fy")),
        doc_date: g(r,"date")||null, party_kind:"client", party_id:null,
        party_snapshot:{ firmName:g(r,"party name"), gstin:g(r,"gst number"), state:g(r,"state"), district:g(r,"district"), clientRef:g(r,"client ref") },
        line_items:[{ desc:"Aerial Spraying - Agriculture Services", hsn:g(r,"hsn/sac")||"9986", gst:gstRate, qty:billed||1, rate: billed?Math.round(amount/billed*100)/100:amount, per:billed?"Acre":"", disc:0 }],
        totals:{ sub:amount, gstTotal:gstAmt, total:payable, invoiced:n(g(r,"total invoiced")), tds:n(g(r,"tds amount")), adjustment:n(g(r,"adjustment")) },
        status, approval_status:"approved",
        data:{ entity, acre_ref:g(r,"acre reference"), remarks:g(r,"remarks"), fy:g(r,"fy") },
        created_by:window.OPS.me.id
      });
      if(received>0) recvByKey[entity+"|"+number]={ amount:received, date:g(r,"payment date")||g(r,"date")||todayISO() };
    });
    if(!docs.filter(d=>d.doc_date).length){ alert("No rows with a valid invoice date."); return; }
    // de-duplicate by entity+number (DB key) so one upsert can't hit a row twice
    const byKey={}; docs.filter(d=>d.doc_date).forEach(d=>{ byKey[d.entity+"|"+d.number]=d; });
    const valid=Object.values(byKey);
    if(!confirm("Import "+valid.length+" invoices (DCB + IBS)? Existing ones (same entity + number) are updated.")) return;
    // upsert documents in chunks, collect ids by entity+number
    const idByKey={};
    for(let i=0;i<valid.length;i+=200){
      const { data, error }=await sb().from("documents").upsert(valid.slice(i,i+200),{onConflict:"doc_type,entity,number"}).select("id,number,entity");
      if(error){ alert("Import failed: "+error.message); return; }
      (data||[]).forEach(d=>idByKey[d.entity+"|"+d.number]=d.id);
    }
    // payments for received amounts (idempotent: clear prior tracker payments first)
    const ids=Object.values(idByKey);
    if(ids.length){ await sb().from("payments").delete().in("document_id",ids).eq("mode","Tracker import"); }
    const pays=[];
    Object.keys(recvByKey).forEach(k=>{ const id=idByKey[k]; if(!id) return; const p=recvByKey[k];
      pays.push({ document_id:id, amount:p.amount, paid_on:p.date, mode:"Tracker import", note:"historical", created_by:window.OPS.me.id }); });
    for(let i=0;i<pays.length;i+=200){ const { error }=await sb().from("payments").insert(pays.slice(i,i+200)); if(error){ alert("Payments import failed: "+error.message); return; } }
    window.OPS.flashTop("Imported "+valid.length+" invoices ✓"); view();
  });
}

window.OPS.routes.receivables = view;
})();
