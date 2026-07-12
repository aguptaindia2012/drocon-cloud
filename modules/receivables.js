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
  m.innerHTML=`<div class="eyebrow">Dashboards</div><h1>Invoices &amp; Receivables</h1>
    <div class="callout">Summary view. To <b>record or update payments</b>, use <b>Finance → Payment Status</b>.</div>
    <div class="row" style="margin:6px 0"><label style="margin:0">Entity</label>
      <select id="rEntity" style="width:auto"><option value="">All</option><option>DCB</option><option>IBS</option></select></div>
    <div id="rHost" class="muted">Loading…</div>`;
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
  const totReceived=rows.reduce((s,x)=>s+x.paid,0);
  const totCredit=rows.reduce((s,x)=>s+x.credit,0);
  // "advances" = money received/credited BEYOND the invoice value (a negative balance).
  // These are the rows that make Receivable look bigger than Invoiced − Received,
  // and usually flag a data problem (payment logged against the wrong invoice, or twice).
  const overpaid=rows.filter(x=>x.balance<-0.01).sort((a,b)=>a.balance-b.balance);
  const totAdvance=overpaid.reduce((s,x)=>s+(-x.balance),0);
  const buckets={"0-30":0,"31-60":0,"61-90":0,">90":0};
  rows.forEach(x=>{ if(x.balance>0) buckets[bucket(x.age)]+=x.balance; });
  const overdue=rows.filter(x=>x.balance>0 && x.age>30).length;

  // monthly series: credit raised (invoiced) and funds received (payments)
  const ym=d=>String(d||"").slice(0,7);
  const invByM={}, payByM={};
  rows.forEach(x=>{ const k=ym(x.r.doc_date); if(k) invByM[k]=(invByM[k]||0)+x.gross; });
  (pays||[]).forEach(p=>{ const k=ym(p.paid_on); if(k) payByM[k]=(payByM[k]||0)+num(p.amount); });
  const months=[...new Set([...Object.keys(invByM),...Object.keys(payByM)])].sort().slice(-12);

  $("rHost").innerHTML=`
    <div class="statrow">
      <div class="stat"><div class="n">${money(totReceivable)}</div><div class="l">Total receivable</div></div>
      <div class="stat"><div class="n">${money(totInvoiced)}</div><div class="l">Total invoiced</div></div>
      <div class="stat"><div class="n">${money(totReceived)}</div><div class="l">Total received</div></div>
      <div class="stat"><div class="n">${overdue}</div><div class="l">Overdue &gt;30d</div></div>
    </div>
    <div class="card"><h3>How the receivable is built up</h3>
      <table><tbody>
        <tr><td>Total invoiced</td><td class="num">${money(totInvoiced)}</td></tr>
        <tr><td>Less: credit notes</td><td class="num">− ${money(totCredit)}</td></tr>
        <tr><td>Less: amount received</td><td class="num">− ${money(totReceived)}</td></tr>
        <tr style="border-top:2px solid var(--line)"><td>= Net of all invoices</td><td class="num">${money(totInvoiced-totCredit-totReceived)}</td></tr>
        <tr><td>Add back: advances / over-collections${totAdvance>0?' <span class="chip rejected">check data</span>':''}</td><td class="num">+ ${money(totAdvance)}</td></tr>
        <tr style="border-top:2px solid var(--green)"><td><b>= Total receivable (still owed)</b></td><td class="num"><b>${money(totReceivable)}</b></td></tr>
      </tbody></table>
      <p class="muted">Receivable counts only invoices with money <b>still owed</b>. It can exceed “invoiced − received” when some invoices are <b>over-collected</b> (received more than billed) — that surplus is added back above and almost always means a payment was logged against the wrong invoice or entered twice. Review those rows below and fix them in <b>Finance → Payment Status</b> or the Invoice.</p>
    </div>
    ${overpaid.length?`<div class="card"><h3>⚠ Over-collected invoices (received &gt; billed) — likely bad data</h3>
      <div style="overflow:auto"><table><thead><tr><th>Entity</th><th>Invoice</th><th>Date</th><th>Client</th><th class="num">Billed</th><th class="num">Credit</th><th class="num">Received</th><th class="num">Over by</th></tr></thead>
      <tbody>${overpaid.map(x=>`<tr><td>${esc(x.r.entity||'DCB')}</td><td><b>${esc(x.r.number)}</b></td><td>${fmtDate(x.r.doc_date)}</td><td>${esc(x.party)}</td><td class="num">${money(x.gross)}</td><td class="num">${money(x.credit)}</td><td class="num">${money(x.paid)}</td><td class="num" style="color:#a3322a;font-weight:700">${money(-x.balance)}</td></tr>`).join("")}</tbody></table></div></div>`:''}
    <div class="row" id="recReport" style="margin-bottom:8px"></div>
    <div class="card"><h3>Monthly credit in market (invoiced)</h3>${window.OPS.report.canvas("recCredit",560,240)}</div>
    <div class="card"><h3>Flow of funds — payments received by month</h3>${window.OPS.report.canvas("recFunds",560,240)}</div>
    <div class="card"><h3>Invoicing vs receipts (same timeline)</h3>${window.OPS.report.canvas("recTimeline",560,240)}</div>
    <div class="card"><h3>Receivables aging</h3>
      <table><thead><tr><th>0–30 days</th><th>31–60 days</th><th>61–90 days</th><th>&gt; 90 days</th></tr></thead>
      <tbody><tr>
        <td>${money(buckets["0-30"])}</td><td>${money(buckets["31-60"])}</td>
        <td style="${buckets["61-90"]>0?'color:#9a5b00;font-weight:700':''}">${money(buckets["61-90"])}</td>
        <td style="${buckets[">90"]>0?'color:#a3322a;font-weight:700':''}">${money(buckets[">90"])}</td>
      </tr></tbody></table>
      ${window.OPS.report.canvas("recAging",560,220)}
    </div>
    <div class="card"><h3>Top outstanding</h3>
      <table><thead><tr><th>Entity</th><th>Invoice</th><th>Date</th><th>Client</th><th class="num">Balance</th><th class="num">Age (d)</th></tr></thead>
      <tbody>${rows.filter(x=>x.balance>0).sort((a,b)=>b.age-a.age).slice(0,15).map(x=>`<tr><td>${esc(x.r.entity||'DCB')}</td><td><b>${esc(x.r.number)}</b></td><td>${fmtDate(x.r.doc_date)}</td><td>${esc(x.party)}</td><td class="num" style="font-weight:700">${money(x.balance)}</td><td class="num" style="${x.age>30?'color:#a3322a;font-weight:700':''}">${x.age}</td></tr>`).join("")||'<tr><td colspan="6" class="muted">Nothing outstanding.</td></tr>'}</tbody></table>
    </div>`;

  window.OPS.report.bar("recCredit", months, months.map(k=>invByM[k]||0), "Invoiced (₹)", "#0A6496");
  window.OPS.report.line("recFunds", months, months.map(k=>payByM[k]||0), "Received (₹)", "#599533");
  window.OPS.report.line("recTimeline", months, months.map(k=>invByM[k]||0), "Invoiced (₹)", "#0A6496");
  window.OPS.report.bar("recAging", ["0–30","31–60","61–90",">90"], [buckets["0-30"],buckets["31-60"],buckets["61-90"],buckets[">90"]], "Receivable (₹)", "#F48A1C");
  const due=rows.filter(x=>x.balance>0).sort((a,b)=>b.age-a.age);
  window.OPS.report.wordButton("recReport","Invoices & Receivables Report"+(entity?(" — "+entity):""), ()=>([
    {heading:"Summary", table:{headers:["Metric","Value"], rows:[["Total receivable",money(totReceivable)],["Total invoiced",money(totInvoiced)],["Total received",money(totReceived)],["Overdue >30d",overdue]]}},
    {heading:"Monthly credit in market (invoiced)", image:window.OPS.report.img("recCredit"), table:{headers:["Month","Invoiced"], rows:months.map(k=>[k,money(invByM[k]||0)])}},
    {heading:"Funds received by month", image:window.OPS.report.img("recFunds"), table:{headers:["Month","Received"], rows:months.map(k=>[k,money(payByM[k]||0)])}},
    {heading:"Receivables aging", image:window.OPS.report.img("recAging"), table:{headers:["0–30","31–60","61–90",">90"], rows:[[money(buckets["0-30"]),money(buckets["31-60"]),money(buckets["61-90"]),money(buckets[">90"])]]}},
    {heading:"Outstanding invoices", table:{headers:["Entity","Invoice","Date","Client","Balance","Age (d)"], rows:due.map(x=>[x.r.entity||"DCB",x.r.number,fmtDate(x.r.doc_date),x.party,money(x.balance),x.age])}},
  ]));
}

/* ---------- import invoice tracker (DCB + IBS) — used by the Finance Payment Status tool ---------- */
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
    window.OPS.flashTop("Imported "+valid.length+" invoices ✓");
    if(window.OPS.routes.payment_status) window.OPS.openTool("payment_status"); else view();
  });
}

window.OPS.routes.receivables = view;
window.OPS.importInvoiceTracker = importInvoices;   // used by Finance → Payment Status
})();
