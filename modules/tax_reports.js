/* ============================================================================
   DroCon Cloud — GST & TDS Reports (for the CA)
   Four period reports, each downloadable as Excel in the CA's format:
     1. Client Invoice GST     (GST we charged clients)
     2. Client Invoice TDS     (TDS clients deducted from our receipts)
     3. Vendor GST Paid        (GST on vendor bills)
     4. Vendor TDS Deducted    (TDS we withheld from vendor payments)
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const iso = d => d.toISOString().slice(0,10);
function lastMonth(){ const d=new Date(); return { from:iso(new Date(d.getFullYear(),d.getMonth()-1,1)), to:iso(new Date(d.getFullYear(),d.getMonth(),0)) }; }
const paidLabel = (paid,total)=> paid>=num(total)-0.5 ? "Paid" : (paid>0 ? "Partial" : "Unpaid");

async function clientGst(from,to,entity){
  let q=sb().from("documents").select("*").eq("doc_type","invoice").gte("doc_date",from).lte("doc_date",to).order("doc_date");
  if(entity) q=q.eq("entity",entity);
  const { data:invs }=await q; const list=invs||[];
  const ids=list.map(d=>d.id); const paidBy={};
  if(ids.length){ const { data:ps }=await sb().from("payments").select("document_id,amount,tds_amount").in("document_id",ids);
    (ps||[]).forEach(p=>paidBy[p.document_id]=(paidBy[p.document_id]||0)+num(p.amount)+num(p.tds_amount)); }
  const headers=["S.No","Party Name","GST Number","State name","Invoice Number","Date","HSN/SAC","Amount","GST Amount","Total","Paid/Unpaid"];
  const aoa=list.map((d,i)=>{ const t=d.totals||{}, ps=d.party_snapshot||{}, hsn=((d.line_items||[])[0]||{}).hsn||"";
    return [i+1, ps.firmName||ps.name||"", ps.gstin||"URP", ps.state||"", d.number, fmtDate(d.doc_date), hsn,
            num(t.sub), num(t.gstTotal), num(t.total), paidLabel(paidBy[d.id]||0, t.total)]; });
  return { title:"Client Invoice GST", file:"Client GST", headers, aoa, numCols:[7,8,9] };
}

async function clientTds(from,to,entity){
  const { data:ps }=await sb().from("payments").select("*, doc:document_id(number,doc_date,entity,party_snapshot,totals)")
    .gt("tds_amount",0).gte("paid_on",from).lte("paid_on",to).order("paid_on");
  let list=(ps||[]).filter(p=>p.doc); if(entity) list=list.filter(p=>p.doc.entity===entity);
  const headers=["S.No","Party Name","GST Number","Invoice Number","Date deducted","Invoice Total","TDS %","TDS Amount"];
  const aoa=list.map((p,i)=>{ const d=p.doc||{}, sp=d.party_snapshot||{};
    return [i+1, sp.firmName||sp.name||"", sp.gstin||"URP", d.number||"", fmtDate(p.paid_on), num((d.totals||{}).total), num(p.tds_pct), num(p.tds_amount)]; });
  return { title:"Client Invoice TDS (deducted by clients)", file:"Client TDS", headers, aoa, numCols:[5,7] };
}

async function vendorGst(from,to){
  const { data:pys }=await sb().from("payables").select("*, vendor:vendor_id(firm_name,name,gstin,state)")
    .gte("invoice_date",from).lte("invoice_date",to).order("invoice_date");
  const list=pys||[]; const ids=list.map(p=>String(p.id)); const paidBy={};
  if(ids.length){ const { data:tx }=await sb().from("cash_txns").select("ref_id,amount,tds_amount").eq("ref_type","payable").in("ref_id",ids);
    (tx||[]).forEach(t=>paidBy[t.ref_id]=(paidBy[t.ref_id]||0)+num(t.amount)+num(t.tds_amount)); }
  const headers=["S.No","Vendor","GST Number","State","Invoice Number","Date","Amount","GST Amount","Total","Paid/Unpaid"];
  const aoa=list.map((p,i)=>{ const v=p.vendor||{};
    return [i+1, v.firm_name||v.name||"", v.gstin||"URP", v.state||"", p.vendor_invoice_no||"", fmtDate(p.invoice_date),
            num(p.amount), num(p.gst_amount), num(p.total), paidLabel(paidBy[String(p.id)]||0, p.total)]; });
  return { title:"Vendor GST Paid", file:"Vendor GST", headers, aoa, numCols:[6,7,8] };
}

async function vendorTds(from,to){
  const { data:tx }=await sb().from("cash_txns").select("*").eq("ref_type","payable").gt("tds_amount",0)
    .gte("txn_date",from).lte("txn_date",to).order("txn_date");
  const list=tx||[]; const ids=[...new Set(list.map(t=>t.ref_id))]; const pmap={};
  if(ids.length){ const { data:pys }=await sb().from("payables").select("id,vendor_invoice_no,total,vendor:vendor_id(firm_name,name,gstin)").in("id",ids);
    (pys||[]).forEach(p=>pmap[String(p.id)]=p); }
  const headers=["S.No","Vendor","GST Number","Invoice Number","Date paid","Amount settled","TDS %","TDS Amount"];
  const aoa=list.map((t,i)=>{ const p=pmap[String(t.ref_id)]||{}, v=p.vendor||{};
    return [i+1, v.firm_name||v.name||"", v.gstin||"URP", p.vendor_invoice_no||"", fmtDate(t.txn_date), num(t.amount)+num(t.tds_amount), num(t.tds_pct), num(t.tds_amount)]; });
  return { title:"Vendor TDS Deducted (by us)", file:"Vendor TDS", headers, aoa, numCols:[5,7] };
}

async function view(){
  const lm=lastMonth(); const m=$("main");
  m.innerHTML=`<div class="eyebrow">Accounting</div><h1>GST &amp; TDS Reports</h1>
    <div class="callout">Period reports for your CA — download each as Excel and email along with the invoices. Amounts are exclusive of GST; TDS is what was withheld.</div>
    <div class="row wrap" style="margin:10px 0;align-items:flex-end;gap:10px">
      <div class="field" style="margin:0;max-width:150px"><label>From</label><input id="trFrom" type="date" value="${lm.from}"></div>
      <div class="field" style="margin:0;max-width:150px"><label>To</label><input id="trTo" type="date" value="${lm.to}"></div>
      <div class="field" style="margin:0;max-width:170px"><label>Entity (client side)</label><select id="trEntity"><option value="">All</option><option>DCB</option><option>IBS</option></select></div>
      <button class="btn green sm" id="trRun">▶ Run reports</button>
    </div>
    <div id="trBody" class="muted">Set a period and Run.</div>`;
  $("trRun").addEventListener("click",e=>window.OPS.once(e.currentTarget,run));
  run();
}
async function run(){
  const from=$("trFrom").value, to=$("trTo").value, entity=$("trEntity").value;
  if(!from||!to){ $("trBody").innerHTML='<div class="card muted">Pick a period.</div>'; return; }
  $("trBody").innerHTML="Loading…";
  let reps;
  try{ reps=await Promise.all([clientGst(from,to,entity),clientTds(from,to,entity),vendorGst(from,to),vendorTds(from,to)]); }
  catch(e){ $("trBody").innerHTML='<div class="card">Error: '+esc(e.message||String(e))+'</div>'; return; }
  $("trBody").innerHTML=reps.map(card).join("");
  reps.forEach((rep,i)=>{ const b=$("trDl_"+i); if(b) b.addEventListener("click",()=>window.OPS.xlsx.download(rep.file+" ("+from+" to "+to+").xlsx", rep.title.slice(0,31), rep.headers, rep.aoa)); });
}
function card(rep,i){
  const nc=rep.numCols||[];
  const tot=nc.length? nc.reduce((o,ci)=>{ o[ci]=rep.aoa.reduce((s,r)=>s+num(r[ci]),0); return o; },{}) : {};
  return `<div class="card" style="margin-bottom:14px"><div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap">
    <h3 style="margin:0">${esc(rep.title)} <span class="muted" style="font-weight:400">· ${rep.aoa.length} row(s)</span></h3>
    <button class="btn sm green" id="trDl_${i}">⬇ Excel</button></div>
    ${rep.aoa.length?`<div style="overflow:auto;margin-top:8px"><table><thead><tr>${rep.headers.map((h,ci)=>`<th class="${nc.includes(ci)?'num':''}">${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${rep.aoa.map(r=>`<tr>${r.map((c,ci)=>`<td class="${nc.includes(ci)?'num':''}">${nc.includes(ci)?money(c):esc(String(c==null?'':c))}</td>`).join("")}</tr>`).join("")}</tbody>
      <tfoot><tr>${rep.headers.map((h,ci)=>`<td class="${nc.includes(ci)?'num':''}">${ci===0?'<b>Total</b>':(nc.includes(ci)?'<b>'+money(tot[ci])+'</b>':'')}</td>`).join("")}</tr></tfoot></table></div>`
    :'<div class="muted" style="margin-top:8px">No rows in this period.</div>'}</div>`;
}
window.OPS.routes.tax_reports = view;
})();
