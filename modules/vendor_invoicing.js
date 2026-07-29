/* ============================================================================
   DroCon Cloud — Vendor rate card + vendor→DroCon invoicing (Phase 4)
   Internal:  vendorRates()            set DroCon's payout rate per vendor/loc/crop
              vendorInvoiceApprovals()  approve (→ Payable) / reject vendor invoices
   Vendor:    vendorInvoiceNew()        build an invoice from approved acres
              vendorInvoicesMine()      list own invoices + plain print / export
              vendorReport()            acres summary (pending + invoiced)
   ============================================================================ */
(function(){
const { $, esc, money, num, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const DCB = { name:"DroCon Bharat Private Limited", gstin:"09AALCD9671N1ZO",
  addr:"315/7 Thapar Nagar, Meerut Cantt, Meerut – 250001, Uttar Pradesh, India" };
const invChip = (s)=>({submitted:"warn",approved:"ok",rejected:"err"}[s]||"warn");

/* ------------------------------------------------- INTERNAL: rate card --- */
async function vendorRates(){
  const m=$("main");
  const [vs,ls,cs]=await Promise.all([
    sb().from("vendors").select("id,name,firm_name").order("name").then(r=>r.data||[]),
    sb().from("spray_locations").select("id,name").order("name").then(r=>r.data||[]),
    sb().from("crops").select("id,name").eq("active",true).order("name").then(r=>r.data||[])
  ]);
  const vn=v=>v.firm_name||v.name;
  m.innerHTML=`<div class="eyebrow">Finance</div><h1>Vendor Rates</h1>
    <div class="callout">Set what DroCon <b>pays a vendor</b> per acre, by <b>location</b> and <b>crop</b>, effective from a date. A rate change = add a <b>new row with a later date</b> (older acres keep the old rate). Crop = <b>All</b> is the vendor+location default.</div>
    <div class="card"><h3>Add a rate</h3>
      <div class="row wrap" style="gap:8px;align-items:flex-end">
        <div class="field" style="margin:0;min-width:200px"><label>Vendor *</label><select id="vrV"><option value="">— vendor —</option>${vs.map(v=>`<option value="${v.id}">${esc(vn(v))}</option>`).join("")}</select></div>
        <div class="field" style="margin:0;min-width:200px"><label>Location *</label><select id="vrL"><option value="">— location —</option>${ls.map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select></div>
        <div class="field" style="margin:0;min-width:160px"><label>Crop</label><select id="vrC"><option value="">All crops</option>${cs.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>
        <div class="field" style="margin:0;max-width:130px"><label>₹/acre *</label><input id="vrR" type="number" step="any"></div>
        <div class="field" style="margin:0;max-width:160px"><label>Effective from *</label><input id="vrF" type="date" value="${todayISO()}"></div>
        <button class="btn green sm" id="vrAdd">+ Add</button>
      </div><div class="err" id="vrErr"></div>
    </div>
    <div id="vrList" class="muted">Loading…</div>`;
  $("vrAdd").addEventListener("click",async()=>{
    const vendor_id=$("vrV").value, location_id=$("vrL").value, rate=$("vrR").value, ef=$("vrF").value;
    if(!vendor_id||!location_id||rate===""||!ef){ $("vrErr").textContent="Vendor, location, rate and date are required."; return; }
    const { error }=await sb().from("vendor_location_crop_rates").insert({ vendor_id, location_id,
      crop_id:$("vrC").value||null, rate:num(rate), effective_from:ef, created_by:window.OPS.me.id });
    if(error){ $("vrErr").textContent=error.message; return; }
    window.OPS.flashTop("Rate added ✓"); $("vrR").value=""; load();
  });
  load();
  async function load(){
    const { data }=await sb().from("vendor_location_crop_rates")
      .select("*, vendor:vendor_id(name,firm_name), loc:location_id(name), crop:crop_id(name)")
      .order("effective_from",{ascending:false});
    const rows=data||[];
    $("vrList").innerHTML = rows.length ? `<div class="card"><div style="overflow:auto"><table><thead><tr><th>Effective</th><th>Vendor</th><th>Location</th><th>Crop</th><th class="num">₹/acre</th><th></th></tr></thead>
      <tbody>${rows.map(r=>`<tr><td>${fmtDate(r.effective_from)}</td><td>${esc(r.vendor&&(r.vendor.firm_name||r.vendor.name)||"")}</td><td>${esc(r.loc&&r.loc.name||"")}</td>
        <td>${r.crop?esc(r.crop.name):'<span class="muted">All</span>'}</td><td class="num">${money(r.rate)}</td>
        <td><button class="btn sm ghost" data-del="${r.id}">Delete</button></td></tr>`).join("")}</tbody></table></div></div>`
      : '<div class="card muted">No vendor rates yet.</div>';
    $("vrList").querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",async()=>{
      if(!confirm("Delete this rate row?")) return;
      await sb().from("vendor_location_crop_rates").delete().eq("id",b.getAttribute("data-del")); load();
    }));
  }
}

/* --------------------------------------------------- VENDOR: new invoice --- */
let selAcres=new Set(), billRows=[];
async function vendorInvoiceNew(){
  const m=$("main");
  const to=todayISO(); const from=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  m.innerHTML=`<div class="eyebrow">Vendor Portal</div><h1>Invoice DroCon</h1>
    <div class="callout">Pick a period, review your approved acres at the DroCon-set rates, select the rows and generate an invoice. Only acres DroCon has approved and not yet invoiced appear.</div>
    <div class="row wrap" style="margin:6px 0;gap:8px;align-items:flex-end">
      <div class="field" style="margin:0"><label>From</label><input id="viFrom" type="date" value="${from}"></div>
      <div class="field" style="margin:0"><label>To</label><input id="viTo" type="date" value="${to}"></div>
      <button class="btn sm" id="viLoad">Load acres</button></div>
    <div id="viBody" class="muted">Choose a period and click <b>Load acres</b>.</div>`;
  $("viLoad").addEventListener("click",load);
  load();
  async function load(){
    selAcres.clear();
    const { data, error }=await sb().rpc("vendor_billable_acres",{ p_from:$("viFrom").value||null, p_to:$("viTo").value||null });
    if(error){ $("viBody").innerHTML='<div class="card muted">'+esc(error.message)+'</div>'; return; }
    billRows=data||[];
    if(!billRows.length){ $("viBody").innerHTML='<div class="card muted">No approved, un-invoiced acres in this period.</div>'; return; }
    const noRate=billRows.filter(r=>!num(r.rate)).length;
    $("viBody").innerHTML=`${noRate?`<div class="callout warn">${noRate} row(s) have <b>no vendor rate set</b> — ask DroCon to set your rate for that location/crop. They are excluded from the total.</div>`:''}
      <div class="card"><div style="overflow:auto"><table class="tt-skip"><thead><tr><th><input type="checkbox" id="viAll"></th><th>Date</th><th>Location</th><th>Crop</th><th class="num">Acres</th><th class="num">₹/acre</th><th class="num">Amount</th></tr></thead>
      <tbody>${billRows.map((r,i)=>`<tr><td><input type="checkbox" data-i="${i}" ${num(r.rate)?'':'disabled'}></td><td>${fmtDate(r.entry_date)}</td><td>${esc(r.location_name||"")}</td><td>${esc(r.crop||"")}</td>
        <td class="num">${num(r.acres).toFixed(1)}</td><td class="num">${num(r.rate)?money(r.rate):'<span class="chip rejected">not set</span>'}</td><td class="num">${money(r.amount)}</td></tr>`).join("")}</tbody></table></div>
      <div class="row" style="margin-top:8px"><b id="viSum">Selected: 0 acres · ₹0</b><div class="spacer"></div>
        <input id="viNote" placeholder="Note (optional)" style="max-width:220px"><button class="btn green" id="viGen">Generate invoice</button></div>
      <div class="err" id="viErr"></div></div>`;
    const recalc=()=>{ let ac=0,amt=0; selAcres.forEach(i=>{ ac+=num(billRows[i].acres); amt+=num(billRows[i].amount); });
      $("viSum").textContent=`Selected: ${ac.toFixed(1)} acres · ${money(amt)}`; };
    $("viAll").addEventListener("change",e=>{ selAcres.clear(); if(e.target.checked) billRows.forEach((r,i)=>{ if(num(r.rate)) selAcres.add(i); });
      document.querySelectorAll("#viBody [data-i]").forEach(cb=>{ if(!cb.disabled) cb.checked=e.target.checked; }); recalc(); });
    document.querySelectorAll("#viBody [data-i]").forEach(cb=>cb.addEventListener("change",()=>{ const i=+cb.getAttribute("data-i"); cb.checked?selAcres.add(i):selAcres.delete(i); recalc(); }));
    $("viGen").addEventListener("click",gen);
  }
  async function gen(){
    if(!selAcres.size){ $("viErr").textContent="Select at least one row."; return; }
    const ids=[...selAcres].map(i=>billRows[i].entry_id);
    $("viGen").disabled=true;
    const { data, error }=await sb().rpc("generate_vendor_invoice",{ p_from:$("viFrom").value||null, p_to:$("viTo").value||null, p_ids:ids, p_note:$("viNote").value||null });
    $("viGen").disabled=false;
    if(error){ $("viErr").textContent=error.message; return; }
    window.OPS.flashTop("Invoice generated ✓"); vendorInvoicesMine(data);
  }
}

/* ------------------------------------------------ VENDOR: my invoices --- */
async function vendorInvoicesMine(openId){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Vendor Portal</div><h1>My DroCon Invoices</h1>
    <div class="row" style="margin:6px 0"><button class="btn green sm" id="viNew">+ New invoice</button></div>
    <div id="miList" class="muted">Loading…</div>`;
  $("viNew").addEventListener("click",vendorInvoiceNew);
  const { data }=await sb().from("vendor_invoices").select("*").order("created_at",{ascending:false});
  const rows=data||[];
  $("miList").innerHTML = rows.length ? `<div class="card"><div style="overflow:auto"><table><thead><tr><th>Number</th><th>Period</th><th class="num">Acres</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td><b>${esc(r.number||"")}</b></td><td>${r.period_from?fmtDate(r.period_from):""} – ${r.period_to?fmtDate(r.period_to):""}</td>
      <td class="num">${num(r.acres).toFixed(1)}</td><td class="num">${money(r.amount)}</td>
      <td><span class="chip ${invChip(r.status)}">${esc(r.status)}</span>${r.reject_reason?`<br><span class="small-note" style="color:#a3322a">${esc(r.reject_reason)}</span>`:''}</td>
      <td><button class="btn sm" data-print="${r.id}">Print</button> <button class="btn sm" data-xls="${r.id}">Excel</button></td></tr>`).join("")}</tbody></table></div></div>`
    : '<div class="card muted">No invoices yet.</div>';
  const by=id=>rows.find(x=>x.id===id);
  $("miList").querySelectorAll("[data-print]").forEach(b=>b.addEventListener("click",()=>plainInvoice(by(b.getAttribute("data-print")))));
  $("miList").querySelectorAll("[data-xls]").forEach(b=>b.addEventListener("click",()=>exportInvoice(by(b.getAttribute("data-xls")))));
  if(openId){ const r=by(openId); if(r) plainInvoice(r); }
}

function plainInvoice(inv){
  if(!inv) return;
  const rows=(inv.rows||[]);
  const tr=rows.map(x=>`<tr><td>${esc(fmtDate(x.date))}</td><td>${esc(x.location||"")}</td><td>${esc(x.crop||"")}</td>
    <td style="text-align:right">${num(x.acres).toFixed(1)}</td><td style="text-align:right">₹${num(x.rate).toFixed(2)}</td><td style="text-align:right">₹${num(x.amount).toFixed(2)}</td></tr>`).join("");
  const html=`<html><head><meta charset="utf-8"><title>${esc(inv.number||"Invoice")}</title>
    <style>body{font-family:Arial,sans-serif;color:#111;margin:32px;font-size:13px}
    h1{font-size:20px;margin:0 0 2px} table{border-collapse:collapse;width:100%;margin-top:14px}
    th,td{border:1px solid #ccc;padding:6px 8px} th{background:#f2f2f2;text-align:left}
    .r{text-align:right}.muted{color:#666}.tot{font-weight:bold}.note{margin-top:8px;color:#666;font-size:11px}
    @media print{.noprint{display:none}}</style></head><body>
    <div class="noprint" style="margin-bottom:10px"><button onclick="window.print()">Print / Save as PDF</button>
      <span class="muted"> — plain format; paste onto your letterhead if preferred.</span></div>
    <h1>${esc(inv.vendor_name||"Vendor")}</h1>
    <div class="muted">Invoice ${esc(inv.number||"")} · ${inv.period_from?fmtDate(inv.period_from):""} – ${inv.period_to?fmtDate(inv.period_to):""}</div>
    <div style="margin-top:12px"><b>Bill to:</b><br>${esc(DCB.name)}<br>${esc(DCB.addr)}<br>GSTIN: ${esc(DCB.gstin)}</div>
    <table><thead><tr><th>Date</th><th>Location</th><th>Crop</th><th class="r">Acres</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
      <tbody>${tr}</tbody>
      <tfoot><tr class="tot"><td colspan="3">Total</td><td class="r">${num(inv.acres).toFixed(1)}</td><td></td><td class="r">₹${num(inv.amount).toFixed(2)}</td></tr></tfoot></table>
    ${inv.note?`<div class="note">Note: ${esc(inv.note)}</div>`:''}
    <div class="note">Aerial agricultural spraying services. Amounts in INR.</div>
    </body></html>`;
  const w=window.open("","_blank"); if(!w){ alert("Allow pop-ups to view the invoice."); return; }
  w.document.write(html); w.document.close();
}
function exportInvoice(inv){
  if(!inv||!window.OPS.xlsx) return;
  const headers=["Date","Location","Crop","Acres","Rate","Amount"];
  const aoa=(inv.rows||[]).map(x=>[fmtDate(x.date),x.location||"",x.crop||"",num(x.acres),num(x.rate),num(x.amount)]);
  aoa.push(["","","Total",num(inv.acres),"",num(inv.amount)]);
  window.OPS.xlsx.download((inv.number||"vendor-invoice").replace(/[^\w-]/g,"_")+".xlsx","Invoice",headers,aoa);
}

/* ---------------------------------------------------- VENDOR: report --- */
async function vendorReport(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Vendor Portal</div><h1>Vendor Report</h1><div id="vrpBody" class="muted">Loading…</div>`;
  const [{data:inv},{data:pend}]=await Promise.all([
    sb().from("vendor_invoices").select("*").order("created_at",{ascending:false}),
    sb().rpc("vendor_billable_acres",{ p_from:null, p_to:null }).then(r=>r).catch(()=>({data:[]}))
  ]);
  const invoices=inv||[]; const pending=(pend&&pend.data)||pend||[];
  const sum=(a,f)=>a.reduce((s,x)=>s+num(f(x)),0);
  const pendAc=sum(pending,x=>x.acres), pendAmt=sum(pending,x=>x.amount);
  const invAc=sum(invoices,x=>x.acres), invAmt=sum(invoices,x=>x.amount);
  const paidAmt=sum(invoices.filter(x=>x.status==="approved"),x=>x.amount);
  $("vrpBody").innerHTML=`
    <div class="statrow">
      <div class="stat"><div class="n">${pendAc.toFixed(1)}</div><div class="l">Acres awaiting invoicing</div></div>
      <div class="stat"><div class="n">${money(pendAmt)}</div><div class="l">Value awaiting invoicing</div></div>
      <div class="stat"><div class="n">${invAc.toFixed(1)}</div><div class="l">Acres invoiced</div></div>
      <div class="stat"><div class="n">${money(paidAmt)}</div><div class="l">Approved by DroCon</div></div>
    </div>
    <div class="card"><h3>Your invoices</h3>${invoices.length?`<div style="overflow:auto"><table><thead><tr><th>Number</th><th>Period</th><th class="num">Acres</th><th class="num">Amount</th><th>Status</th></tr></thead>
      <tbody>${invoices.map(r=>`<tr><td><b>${esc(r.number||"")}</b></td><td>${r.period_from?fmtDate(r.period_from):""} – ${r.period_to?fmtDate(r.period_to):""}</td><td class="num">${num(r.acres).toFixed(1)}</td><td class="num">${money(r.amount)}</td><td><span class="chip ${invChip(r.status)}">${esc(r.status)}</span></td></tr>`).join("")}</tbody></table></div>`:'<div class="muted">No invoices yet.</div>'}</div>`;
}

/* --------------------------------------- INTERNAL: invoice approvals --- */
async function vendorInvoiceApprovals(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Review / Approvals</div><h1>Vendor Invoices</h1>
    <div class="callout">Vendor invoices for approved acres, at the DroCon-set rates. <b>Approve</b> to create a Payable (pay via Accounting → Payables), or <b>Reject</b> to release the acres.</div>
    <div id="viaList" class="muted">Loading…</div>`;
  load();
  async function load(){
    const { data }=await sb().from("vendor_invoices").select("*").order("created_at",{ascending:false});
    const rows=data||[]; const pend=rows.filter(r=>r.status==="submitted"); const done=rows.filter(r=>r.status!=="submitted");
    $("viaList").innerHTML=`<div class="card"><h3>Awaiting approval (${pend.length})</h3>${pend.length?pend.map(cardHTML).join(""):'<div class="muted">Nothing awaiting approval.</div>'}</div>
      ${done.length?`<div class="card"><h3>Recent</h3><div style="overflow:auto"><table><thead><tr><th>Number</th><th>Vendor</th><th class="num">Acres</th><th class="num">Amount</th><th>Status</th></tr></thead>
        <tbody>${done.slice(0,40).map(r=>`<tr><td>${esc(r.number||"")}</td><td>${esc(r.vendor_name||"")}</td><td class="num">${num(r.acres).toFixed(1)}</td><td class="num">${money(r.amount)}</td><td><span class="chip ${invChip(r.status)}">${esc(r.status)}</span></td></tr>`).join("")}</tbody></table></div></div>`:''}`;
    rows.filter(r=>r.status==="submitted").forEach(wire);
  }
  function cardHTML(r){ const rows=r.rows||[];
    return `<div class="card" style="background:#fafbf8"><div class="row wrap"><b>${esc(r.vendor_name||"")}</b><span class="muted">${esc(r.number||"")} · ${num(r.acres).toFixed(1)} ac · ${money(r.amount)}</span></div>
      <div style="overflow:auto"><table class="tt-skip"><thead><tr><th>Date</th><th>Location</th><th>Crop</th><th class="num">Acres</th><th class="num">₹/acre</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows.map(x=>`<tr><td>${esc(fmtDate(x.date))}</td><td>${esc(x.location||"")}</td><td>${esc(x.crop||"")}</td><td class="num">${num(x.acres).toFixed(1)}</td><td class="num">${money(x.rate)}</td><td class="num">${money(x.amount)}</td></tr>`).join("")}</tbody></table></div>
      <div class="row" style="margin-top:6px"><button class="btn green sm" data-ap="${r.id}">Approve → Payable</button><button class="btn sm" data-rj="${r.id}" style="color:#a3322a;border-color:#e4b4b4">Reject</button></div></div>`;
  }
  function wire(r){
    const ap=document.querySelector(`[data-ap="${r.id}"]`), rj=document.querySelector(`[data-rj="${r.id}"]`);
    if(ap) ap.addEventListener("click",async()=>{ const { error }=await sb().rpc("approve_vendor_invoice",{ p_id:r.id }); if(error){ alert(error.message); return; } window.OPS.flashTop("Approved → Payable created ✓"); load(); });
    if(rj) rj.addEventListener("click",async()=>{ const reason=prompt("Reason for rejection:",""); if(reason===null) return;
      const { error }=await sb().rpc("reject_vendor_invoice",{ p_id:r.id, p_reason:reason||null }); if(error){ alert(error.message); return; } window.OPS.flashTop("Rejected ✓"); load(); });
  }
}

window.OPS.routes.vendor_rates             = vendorRates;
window.OPS.routes.vendor_invoice_new       = vendorInvoiceNew;
window.OPS.routes.vendor_invoices_mine     = ()=>vendorInvoicesMine();
window.OPS.routes.vendor_report            = vendorReport;
window.OPS.routes.vendor_invoice_approvals = vendorInvoiceApprovals;
})();
