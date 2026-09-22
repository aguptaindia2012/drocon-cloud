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
// Indian financial year runs Apr 1 → Mar 31. fyStart() returns the FY's START year (int).
function fyStart(d){ if(!d) return null; const dt=new Date(d); if(isNaN(dt)) return null; const y=dt.getFullYear(), m=dt.getMonth()+1; return m>=4?y:y-1; }
function fyLabel(s){ return "FY "+s+"–"+String((s+1)%100).padStart(2,"0"); }   // e.g. FY 2026–27

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

  // Per-financial-year split (grouped by the INVOICE date's FY, Apr–Mar).
  // "Received" and "Still owed" are amounts against invoices raised in that FY,
  // so Invoiced − Credit − Received − Advances = Still owed reconciles per year.
  const byFY={};
  rows.forEach(x=>{ const s=fyStart(x.r.doc_date); if(s==null) return;
    const o=byFY[s]||(byFY[s]={inv:0,rec:0,recv:0,over:0});
    o.inv+=x.gross; o.rec+=x.paid; o.recv+=Math.max(0,x.balance);
    if(x.balance>0 && x.age>30) o.over++; });
  const now=new Date(); const curFY=(now.getMonth()+1>=4)?now.getFullYear():now.getFullYear()-1;
  const fyRow=s=>byFY[s]||{inv:0,rec:0,recv:0,over:0};
  const fyCur=fyRow(curFY), fyLast=fyRow(curFY-1);

  // Further split by revenue line of business, per FY. Each invoice LINE is
  // classified by its description + HSN/SAC; a mixed invoice is split across
  // categories in proportion to each line's value, so category totals reconcile
  // to the financial-year card above.
  const CATS=[["spray","Agriculture Spraying"],["demo","Demonstrations"],["part","Part sales"],["service","Servicing of drones & batteries"],["other","Other / uncategorised"]];
  const REV_LABEL=Object.fromEntries(CATS);
  const classifyLine=(desc,sub,hsn)=>{
    const d=((desc||"")+" "+(sub||"")).toLowerCase(); const h=String(hsn||"").replace(/\s/g,"");
    if(/demo/.test(d)) return "demo";
    if(/servic|repair|mainten|overhaul|\bmro\b|\bamc\b|refurb/.test(d) || /^9987/.test(h)) return "service";
    if(/spray|aerial|agri/.test(d) || /^9986/.test(h)) return "spray";
    if(/part|spare|batter|propeller|\bmotor\b|nozzle|\bpump\b|blade|\besc\b|frame|charger|drone|kit|\barm\b/.test(d) || /^(8806|8807|8508|8507|8479|8413)/.test(h)) return "part";
    return "other"; };
  // Whole-invoice category: a manual override (documents.data.rev_category) wins;
  // otherwise the category of the highest-value line. One invoice → one category,
  // so the drill lists and reconciliation stay unambiguous and totals still tie out.
  const autoCat=inv=>{ const items=inv.line_items||[]; if(!items.length) return "other";
    const tally={}; items.forEach(it=>{ const base=Math.max(0,(num(it.qty)||0)*(num(it.rate)||0)*(1-(num(it.disc)||0)/100));
      const c=classifyLine(it.desc,it.sub,it.hsn); tally[c]=(tally[c]||0)+base+0.0001; });
    let best="other",bv=-1; Object.keys(tally).forEach(c=>{ if(tally[c]>bv){bv=tally[c];best=c;} }); return best; };
  const catOf=inv=>{ const ov=(inv.data||{}).rev_category; return (ov && REV_LABEL[ov])?ov:autoCat(inv); };
  const catFY={}, catInv={};
  CATS.forEach(([k])=>{ catFY[k]={cur:{inv:0,rec:0,recv:0},last:{inv:0,rec:0,recv:0}}; catInv[k]=[]; });
  rows.forEach(x=>{ const s=fyStart(x.r.doc_date); if(s!==curFY && s!==curFY-1) return;
    const slot=s===curFY?"cur":"last"; const c=catOf(x.r); const o=catFY[c][slot];
    o.inv+=x.gross; o.rec+=x.paid; o.recv+=Math.max(0,x.balance);
    catInv[c].push({x,s,overridden:!!((x.r.data||{}).rev_category)}); });
  const catShow=CATS.filter(([k])=> k!=="other" || catInv.other.length);
  const catTot={cur:{inv:0,rec:0,recv:0},last:{inv:0,rec:0,recv:0}};
  catShow.forEach(([k])=>["cur","last"].forEach(s=>{ catTot[s].inv+=catFY[k][s].inv; catTot[s].rec+=catFY[k][s].rec; catTot[s].recv+=catFY[k][s].recv; }));
  // dropdown to reconcile a single invoice into another category
  const catSelect=(inv,curk)=>`<select class="catMove" data-inv="${esc(inv.id)}" style="width:auto;font-size:12px">
      <option value="">Move to…</option>${CATS.map(([ck,cl])=>`<option value="${ck}"${ck===curk?' disabled':''}>${cl}</option>`).join("")}<option value="__auto">Auto-detect</option>
    </select>`;
  // persist / clear the override, then refresh
  async function setRevCategory(id, cat){
    const rec=rows.find(x=>x.r.id===id); const data=Object.assign({}, rec?rec.r.data:null);
    if(cat) data.rev_category=cat; else delete data.rev_category;
    const { error }=await sb().from("documents").update({ data }).eq("id",id);
    if(error){ alert("Could not re-categorise: "+error.message); return; }
    window.OPS.flashTop("Invoice re-categorised ✓"); load();
  }
  // move many invoices at once (data is merged per-row from what's in memory)
  async function setRevCategoryBulk(ids, cat){
    let done=0;
    for(let i=0;i<ids.length;i+=10){
      const res=await Promise.all(ids.slice(i,i+10).map(id=>{
        const rec=rows.find(x=>x.r.id===id); const data=Object.assign({}, rec?rec.r.data:null);
        if(cat) data.rev_category=cat; else delete data.rev_category;
        return sb().from("documents").update({ data }).eq("id",id); }));
      const bad=res.find(r=>r&&r.error);
      if(bad){ alert("Stopped after "+done+" — "+bad.error.message); load(); return; }
      done+=Math.min(10, ids.length-i);
    }
    window.OPS.flashTop(done+" invoice"+(done===1?"":"s")+" re-categorised ✓"); load();
  }

  // Pending invoicing: approved acre work not yet turned into an invoice.
  // farmer component = 0% GST (Bill of Supply); client component grossed up by
  // 18% so it is comparable to the GST-inclusive invoice receivable above.
  // Acre work is not entity-tagged, so this is shown only in the "All" view.
  const CLIENT_GST = 18;
  let pendFarmer=0, pendClientBase=0, pendRows=0, pendShown=false;
  if(!entity){
    pendShown=true;
    const { data:ab } = await sb().from("v_acre_billing")
      .select("farmer_amount,client_amount,farmer_doc_id,client_doc_id,farmer_billed_override,client_billed_override");
    (ab||[]).forEach(r=>{
      let hit=false;
      if(r.farmer_doc_id==null && !r.farmer_billed_override && num(r.farmer_amount)>0){ pendFarmer+=num(r.farmer_amount); hit=true; }
      if(r.client_doc_id==null && !r.client_billed_override && num(r.client_amount)>0){ pendClientBase+=num(r.client_amount); hit=true; }
      if(hit) pendRows++;
    });
  }
  const pendClient = Math.round(pendClientBase*(1+CLIENT_GST/100)*100)/100;   // + 18% GST
  const pendInvoicing = Math.round((pendFarmer+pendClient)*100)/100;
  const totToReceive = Math.round((totReceivable+pendInvoicing)*100)/100;

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
      ${pendShown?`<div class="stat"><div class="n">${money(pendInvoicing)}</div><div class="l">Pending invoicing</div></div>
      <div class="stat" style="background:#e7f0de;border-color:#c9dcb6"><div class="n" style="color:var(--green)">${money(totToReceive)}</div><div class="l">Total still to receive</div></div>`:''}
    </div>
    <div class="card"><h3>By financial year${entity?` — ${esc(entity)}`:''}</h3>
      <div style="overflow:auto"><table><thead><tr><th>Financial year</th><th class="num">Invoiced</th><th class="num">Received</th><th class="num">Still owed</th><th class="num">Overdue &gt;30d</th></tr></thead>
      <tbody>
        <tr style="background:#e7f0de"><td><b>${fyLabel(curFY)} (current)</b></td><td class="num"><b>${money(fyCur.inv)}</b></td><td class="num">${money(fyCur.rec)}</td><td class="num" style="font-weight:700;color:var(--green)">${money(fyCur.recv)}</td><td class="num" style="${fyCur.over>0?'color:#a3322a;font-weight:700':''}">${fyCur.over}</td></tr>
        <tr><td><b>${fyLabel(curFY-1)} (last)</b></td><td class="num"><b>${money(fyLast.inv)}</b></td><td class="num">${money(fyLast.rec)}</td><td class="num" style="font-weight:700">${money(fyLast.recv)}</td><td class="num" style="${fyLast.over>0?'color:#a3322a;font-weight:700':''}">${fyLast.over}</td></tr>
        <tr style="border-top:2px solid var(--green)"><td><b>Total (all years)</b></td><td class="num"><b>${money(totInvoiced)}</b></td><td class="num"><b>${money(totReceived)}</b></td><td class="num" style="font-weight:700;color:var(--green)"><b>${money(totReceivable)}</b></td><td class="num" style="${overdue>0?'color:#a3322a;font-weight:700':''}"><b>${overdue}</b></td></tr>
      </tbody></table></div>
      <p class="muted">Grouped by the <b>invoice date's</b> financial year (Apr–Mar). <b>Received</b> and <b>Still owed</b> are amounts against invoices raised in that year, so they reconcile within the year. Pending invoicing (un-billed acre work) is not date-tagged and is excluded here.</p>
    </div>
    <div class="card"><h3>By revenue category &amp; financial year${entity?` — ${esc(entity)}`:''}</h3>
      <div style="overflow:auto"><table><thead>
        <tr><th rowspan="2">Revenue category</th><th colspan="3" style="text-align:center;border-left:2px solid var(--line)">${fyLabel(curFY)} (current)</th><th colspan="3" style="text-align:center;border-left:2px solid var(--line)">${fyLabel(curFY-1)} (last)</th></tr>
        <tr><th class="num" style="border-left:2px solid var(--line)">Invoiced</th><th class="num">Received</th><th class="num">Still owed</th><th class="num" style="border-left:2px solid var(--line)">Invoiced</th><th class="num">Received</th><th class="num">Still owed</th></tr>
      </thead><tbody>
        ${catShow.map(([k,label])=>{
          const list=catInv[k].slice().sort((a,b)=> new Date(b.x.r.doc_date)-new Date(a.x.r.doc_date));
          const bulk=`<div class="row" style="margin:0 0 8px;gap:8px;align-items:center;flex-wrap:wrap">
              <label style="margin:0"><input type="checkbox" class="catAll" data-cat="${k}" style="width:auto"> Select all</label>
              <span class="muted">move selected to</span>
              <select class="catBulk" data-cat="${k}" style="width:auto;font-size:12px">${CATS.filter(([ck])=>ck!==k).map(([ck,cl])=>`<option value="${ck}">${cl}</option>`).join("")}<option value="__auto">Auto-detect</option></select>
              <button class="btn sm catApply" data-cat="${k}">Move selected</button>
              <span class="muted catCount" data-cat="${k}">0 selected</span></div>`;
          const detail=`<tr class="catDetail" data-cat="${k}" style="display:none"><td colspan="7" style="padding:0;background:#fafbf6">
            <div style="padding:8px 14px;overflow:auto">${bulk}<table style="margin:0;font-size:13px"><thead><tr><th></th><th>FY</th><th>Invoice</th><th>Client</th><th class="num">Invoiced</th><th class="num">Received</th><th class="num">Still owed</th><th>Reconcile to</th></tr></thead>
            <tbody>${list.map(({x,s,overridden})=>`<tr>
              <td><input type="checkbox" class="catChk" data-cat="${k}" data-inv="${esc(x.r.id)}" style="width:auto"></td>
              <td>${s+"–"+String((s+1)%100).padStart(2,"0")}</td>
              <td><b>${esc(x.r.number||"")}</b>${overridden?' <span class="chip" title="Manually re-categorised">manual</span>':''}</td>
              <td>${esc(x.party||"")}</td>
              <td class="num">${money(x.gross)}</td>
              <td class="num">${money(x.paid)}</td>
              <td class="num" style="${x.balance>0?'font-weight:600':''}">${money(Math.max(0,x.balance))}</td>
              <td>${catSelect(x.r,k)}</td></tr>`).join("")||'<tr><td colspan="8" class="muted">No invoices in this category.</td></tr>'}</tbody></table></div></td></tr>`;
          return `<tr class="catToggle" data-cat="${k}" style="cursor:pointer">
            <td><span class="caret" data-cat="${k}" style="display:inline-block;width:14px;color:var(--green)">▸</span>${label} <span class="muted">(${list.length})</span></td>
            <td class="num" style="border-left:2px solid var(--line)">${money(catFY[k].cur.inv)}</td><td class="num">${money(catFY[k].cur.rec)}</td><td class="num">${money(catFY[k].cur.recv)}</td>
            <td class="num" style="border-left:2px solid var(--line)">${money(catFY[k].last.inv)}</td><td class="num">${money(catFY[k].last.rec)}</td><td class="num">${money(catFY[k].last.recv)}</td></tr>${detail}`;
        }).join("")}
        <tr style="border-top:2px solid var(--green)"><td><b>Total</b></td>
          <td class="num" style="border-left:2px solid var(--line)"><b>${money(catTot.cur.inv)}</b></td><td class="num"><b>${money(catTot.cur.rec)}</b></td><td class="num"><b>${money(catTot.cur.recv)}</b></td>
          <td class="num" style="border-left:2px solid var(--line)"><b>${money(catTot.last.inv)}</b></td><td class="num"><b>${money(catTot.last.rec)}</b></td><td class="num"><b>${money(catTot.last.recv)}</b></td></tr>
      </tbody></table></div>
      <p class="muted"><b>Click a category</b> to expand the invoices in it (number, client and amounts). Each invoice is placed by its highest-value line's description + HSN/SAC. If one is in the wrong bucket, use <b>Reconcile to</b> to move that invoice — the choice is saved and the totals here (matching the financial-year card above, bar rounding) update. “Auto-detect” clears a manual override.</p>
    </div>
    <div class="card"><h3>How the receivable is built up</h3>
      <table><tbody>
        <tr><td>Total invoiced</td><td class="num">${money(totInvoiced)}</td></tr>
        <tr><td>Less: credit notes</td><td class="num">− ${money(totCredit)}</td></tr>
        <tr><td>Less: amount received</td><td class="num">− ${money(totReceived)}</td></tr>
        <tr style="border-top:2px solid var(--line)"><td>= Net of all invoices</td><td class="num">${money(totInvoiced-totCredit-totReceived)}</td></tr>
        <tr><td>Add back: advances / over-collections${totAdvance>0?' <span class="chip rejected">check data</span>':''}</td><td class="num">+ ${money(totAdvance)}</td></tr>
        <tr style="border-top:2px solid var(--green)"><td><b>= Total receivable (still owed)</b></td><td class="num"><b>${money(totReceivable)}</b></td></tr>
        ${pendShown?`<tr><td>Add: pending invoicing — farmer rate (Bill of Supply, 0% GST)</td><td class="num">+ ${money(pendFarmer)}</td></tr>
        <tr><td>Add: pending invoicing — client rate incl. 18% GST</td><td class="num">+ ${money(pendClient)}</td></tr>
        <tr style="border-top:2px solid var(--green)"><td><b>= Total still to receive (billed + un-invoiced)</b></td><td class="num"><b>${money(totToReceive)}</b></td></tr>`:''}
      </tbody></table>
      <p class="muted">Receivable counts only invoices with money <b>still owed</b>. It can exceed “invoiced − received” when some invoices are <b>over-collected</b> (received more than billed) — that surplus is added back above and almost always means a payment was logged against the wrong invoice or entered twice. Review those rows below and fix them in <b>Finance → Payment Status</b> or the Invoice.</p>
      ${pendShown?`<p class="muted"><b>Pending invoicing</b> is approved acre work (${pendRows} row${pendRows===1?'':'s'}) not yet turned into an invoice — the value still to be billed and then collected. Client-rate work is shown <b>incl. 18% GST</b> to match invoice values; farmer-rate work is 0% GST. Raise these in <b>Finance → Acre Invoicing</b>. This figure covers all entities and is shown only in the “All” view.</p>`:''}
    </div>
    ${overpaid.length?`<div class="card"><h3>⚠ Over-collected invoices (received &gt; billed) — likely bad data</h3>
      <div style="overflow:auto"><table><thead><tr><th>Entity</th><th>Invoice</th><th>Date</th><th>Client</th><th class="num">Billed</th><th class="num">Credit</th><th class="num">Received</th><th class="num">Over by</th></tr></thead>
      <tbody>${overpaid.map(x=>`<tr><td>${esc(x.r.entity||'DCB')}</td><td><b>${esc(x.r.number)}</b></td><td>${fmtDate(x.r.doc_date)}</td><td>${esc(x.party)}</td><td class="num">${money(x.gross)}</td><td class="num">${money(x.credit)}</td><td class="num">${money(x.paid)}</td><td class="num" style="color:#a3322a;font-weight:700">${money(-x.balance)}</td></tr>`).join("")}</tbody></table></div></div>`:''}
    <div class="row" id="recReport" style="margin-bottom:8px"></div>
    <div class="card"><h3>Monthly credit in market (invoiced)</h3>${window.OPS.report.canvas("recCredit",560,240)}</div>
    <div class="card"><h3>Flow of funds — payments received by month</h3>${window.OPS.report.canvas("recFunds",560,240)}</div>
    <div class="card"><h3>Invoicing, receipts &amp; receivable — trend</h3>
      <p class="muted" style="margin-top:-4px">Cumulative as-of-date totals are on each legend label. <b>Click a legend entry to show/hide that line</b> — the per-month lines (dashed) are hidden by default.</p>
      ${window.OPS.report.canvas("recTimeline",640,280)}</div>
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

  // expand/collapse a revenue category, and reconcile an invoice into another category
  $("rHost").querySelectorAll(".catToggle").forEach(tr=>tr.addEventListener("click",e=>{
    if(e.target.closest("select")) return;
    const k=tr.getAttribute("data-cat");
    const d=$("rHost").querySelector('.catDetail[data-cat="'+k+'"]');
    const car=tr.querySelector(".caret");
    if(d){ const show=d.style.display==="none"; d.style.display=show?"":"none"; if(car) car.textContent=show?"▾":"▸"; }
  }));
  $("rHost").querySelectorAll(".catMove").forEach(sel=>sel.addEventListener("change",()=>{
    const val=sel.value; if(!val) return; setRevCategory(sel.getAttribute("data-inv"), val==="__auto"?null:val);
  }));
  // bulk selection + move
  const catCount=k=>{ const n=$("rHost").querySelectorAll('.catChk[data-cat="'+k+'"]:checked').length;
    const el=$("rHost").querySelector('.catCount[data-cat="'+k+'"]'); if(el) el.textContent=n+" selected"; };
  $("rHost").querySelectorAll(".catAll").forEach(cb=>cb.addEventListener("change",()=>{
    const k=cb.getAttribute("data-cat");
    $("rHost").querySelectorAll('.catChk[data-cat="'+k+'"]').forEach(c=>{ c.checked=cb.checked; });
    catCount(k);
  }));
  $("rHost").querySelectorAll(".catChk").forEach(cb=>cb.addEventListener("change",()=>catCount(cb.getAttribute("data-cat"))));
  $("rHost").querySelectorAll(".catApply").forEach(btn=>btn.addEventListener("click",()=>{
    const k=btn.getAttribute("data-cat");
    const ids=[...$("rHost").querySelectorAll('.catChk[data-cat="'+k+'"]:checked')].map(c=>c.getAttribute("data-inv"));
    if(!ids.length){ alert("Select one or more invoices first."); return; }
    const sel=$("rHost").querySelector('.catBulk[data-cat="'+k+'"]'); const val=sel?sel.value:"";
    const label=val==="__auto"?"Auto-detect":(REV_LABEL[val]||val);
    if(!confirm("Move "+ids.length+" invoice"+(ids.length===1?"":"s")+" to “"+label+"”?")) return;
    setRevCategoryBulk(ids, val==="__auto"?null:val);
  }));

  window.OPS.report.bar("recCredit", months, months.map(k=>invByM[k]||0), "Invoiced (₹)", "#0A6496");
  window.OPS.report.line("recFunds", months, months.map(k=>payByM[k]||0), "Received (₹)", "#599533");
  // build monthly + cumulative (trend) series; labels carry the as-of-date total
  const cM=v=>{ v=num(v); const s=v<0?"-":""; v=Math.abs(v);
    return s+(v>=1e7?"₹"+(v/1e7).toFixed(2)+"Cr":v>=1e5?"₹"+(v/1e5).toFixed(2)+"L":v>=1e3?"₹"+(v/1e3).toFixed(1)+"k":"₹"+v.toFixed(0)); };
  const invM=months.map(k=>invByM[k]||0), recM=months.map(k=>payByM[k]||0), balM=months.map(k=>(invByM[k]||0)-(payByM[k]||0));
  let ci=0,cr=0; const cumInv=[],cumRec=[],cumBal=[];
  months.forEach(k=>{ ci+=invByM[k]||0; cr+=payByM[k]||0; cumInv.push(Math.round(ci*100)/100); cumRec.push(Math.round(cr*100)/100); cumBal.push(Math.round((ci-cr)*100)/100); });
  const last=a=>a.length?a[a.length-1]:0;
  window.OPS.report.lines("recTimeline", months, [
    { label:"Invoiced trend · "+cM(last(cumInv)),   data:cumInv, color:"#0A6496" },
    { label:"Received trend · "+cM(last(cumRec)),   data:cumRec, color:"#599533" },
    { label:"Receivable / balance trend · "+cM(last(cumBal)), data:cumBal, color:"#a3322a" },
    { label:"Invoiced / month",  data:invM, color:"#5b9bd5", dash:true, hidden:true },
    { label:"Received / month",  data:recM, color:"#8fce7a", dash:true, hidden:true },
    { label:"Balance / month",   data:balM, color:"#F48A1C", dash:true, hidden:true }
  ]);
  window.OPS.report.bar("recAging", ["0–30","31–60","61–90",">90"], [buckets["0-30"],buckets["31-60"],buckets["61-90"],buckets[">90"]], "Receivable (₹)", "#F48A1C");
  const due=rows.filter(x=>x.balance>0).sort((a,b)=>b.age-a.age);
  window.OPS.report.wordButton("recReport","Invoices & Receivables Report"+(entity?(" — "+entity):""), ()=>([
    {heading:"Summary", table:{headers:["Metric","Value"], rows:[["Total receivable",money(totReceivable)],["Total invoiced",money(totInvoiced)],["Total received",money(totReceived)],["Overdue >30d",overdue]].concat(pendShown?[["Pending invoicing (all entities, client incl. GST)",money(pendInvoicing)],["Total still to receive",money(totToReceive)]]:[])}},
    {heading:"By financial year", table:{headers:["Financial year","Invoiced","Received","Still owed","Overdue >30d"], rows:[
      [fyLabel(curFY)+" (current)",money(fyCur.inv),money(fyCur.rec),money(fyCur.recv),fyCur.over],
      [fyLabel(curFY-1)+" (last)",money(fyLast.inv),money(fyLast.rec),money(fyLast.recv),fyLast.over],
      ["Total (all years)",money(totInvoiced),money(totReceived),money(totReceivable),overdue]]}},
    {heading:"By revenue category & financial year", table:{headers:["Category",fyLabel(curFY)+" invoiced","received","still owed",fyLabel(curFY-1)+" invoiced","received","still owed"], rows:catShow.map(([k,label])=>[label,money(catFY[k].cur.inv),money(catFY[k].cur.rec),money(catFY[k].cur.recv),money(catFY[k].last.inv),money(catFY[k].last.rec),money(catFY[k].last.recv)]).concat([["Total",money(catTot.cur.inv),money(catTot.cur.rec),money(catTot.cur.recv),money(catTot.last.inv),money(catTot.last.rec),money(catTot.last.recv)]])}},
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
