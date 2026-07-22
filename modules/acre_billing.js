/* ============================================================================
   DroCon Cloud — Acre Invoicing
   Raises billing straight from the acre data instead of retyping it.
   Two-layer filter: pick the LOCATION(s) first, then the CLIENT — because one
   location bills two different parties:
     • farmer rate -> "Bill of Supply", 0% GST   (farmer sub-lines per day)
     • client rate -> Tax Invoice, 18% GST, described as the client's
       Marketing Expense / Subsidy label.
   Billed acre rows are stamped so nothing can be invoiced twice.
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate, todayISO, fyOf } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const HSN = "9986";
const CLIENT_GST = 18;

let side="farmer", rows=[], farmerBySource={}, sel=new Set();
const F = { from:"", to:"" };
const partyName = c => (c && (c.firm_name || c.name)) || "";

/* ------------------------------------------------------------- screen ---- */
async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Finance</div><h1>Acre Invoicing</h1>
    <div class="callout">Bills the <b>acre tracking data</b> directly — no retyping. Choose the period and the
      <b>locations</b>, then the <b>client</b>. The two rate components are billed separately:
      the <b>farmer rate</b> as a 0% <b>Bill of Supply</b>, the <b>client rate</b> at 18% GST as that client's
      Marketing Expense / Subsidy. Only <b>unbilled</b> work is offered.</div>
    <div class="card" style="padding:12px">
      <div class="row wrap" style="gap:10px;align-items:flex-end">
        <div class="field" style="margin:0"><label>From</label><input type="date" id="abFrom" value="${esc(F.from)}"></div>
        <div class="field" style="margin:0"><label>To</label><input type="date" id="abTo" value="${esc(F.to)}"></div>
        <div class="field" style="margin:0"><label>Bill which component</label><select id="abSide">
          <option value="farmer" ${side==='farmer'?'selected':''}>Farmer rate — Bill of Supply (0%)</option>
          <option value="client" ${side==='client'?'selected':''}>Client rate — Marketing Expense / Subsidy (18%)</option>
        </select></div>
        <button class="btn sm" id="abLoad">Find unbilled work</button>
        <div class="spacer"></div>
        <button class="btn sm" id="abCN">↩ Credit note from an acre bill</button>
      </div>
    </div>
    <div id="abBody" class="muted">Set a period and click <b>Find unbilled work</b>.</div>`;
  $("abLoad").addEventListener("click",()=>{ F.from=$("abFrom").value; F.to=$("abTo").value; side=$("abSide").value; sel.clear(); load(); });
  $("abSide").addEventListener("change",()=>{ side=$("abSide").value; sel.clear(); if(rows.length) renderPick(); });
  $("abCN").addEventListener("click",creditList);
}

/* ------------------------------------------------------- credit notes ---- */
/* Mirrors the billing flow: pick an acre-raised document, credit all or part of
   it, and the credited acre rows are released so they can be billed again. */
async function creditList(){
  const host=$("abBody"); host.innerHTML="Loading acre bills…";
  const { data, error }=await sb().from("documents").select("*")
    .eq("doc_type","invoice").order("doc_date",{ascending:false}).limit(300);
  if(error){ host.innerHTML='<div class="card">Error: '+esc(error.message)+'</div>'; return; }
  const docs=(data||[]).filter(d=>d.data && d.data.source==="acre_billing");
  host.innerHTML=`<div class="card"><h3>Credit note — choose the acre bill to credit</h3>
    <p class="muted" style="margin-top:-4px">Crediting releases those acre rows so the work can be billed again correctly.</p>
    ${docs.length?`<div style="overflow:auto"><table><thead><tr><th>Number</th><th>Date</th><th>Party</th><th>Type</th><th class="num">Total</th></tr></thead>
      <tbody>${docs.map(d=>`<tr class="clickable" data-doc="${d.id}"><td><b>${esc(d.number)}</b></td><td>${fmtDate(d.doc_date)}</td>
        <td>${esc((d.party_snapshot||{}).firmName||'')}</td>
        <td>${d.data.side==="farmer"?'<span class="chip approved">Bill of Supply</span>':'<span class="chip issued">Client rate</span>'}</td>
        <td class="num">${money((d.totals||{}).total)}</td></tr>`).join("")}</tbody></table></div>`
      :'<div class="muted">No acre-raised bills yet.</div>'}
    <div class="row" style="margin-top:10px"><button class="btn sm" id="abBack">← Back to billing</button></div></div>`;
  host.querySelectorAll("[data-doc]").forEach(tr=>tr.addEventListener("click",()=>{
    const d=docs.find(x=>String(x.id)===tr.getAttribute("data-doc")); if(d) creditForm(d); }));
  $("abBack").addEventListener("click",view);
}

function creditForm(doc){
  const items=doc.line_items||[];
  const host=$("abBody");
  const isFarmer = doc.data.side==="farmer";
  host.innerHTML=`<div class="card"><h3>Credit note against ${esc(doc.number)}</h3>
    <p class="muted" style="margin-top:-4px">${esc((doc.party_snapshot||{}).firmName||'')} ·
      ${isFarmer?'Bill of Supply (0%)':'Client rate (18%)'} · tick the day-lines to credit.</p>
    <div style="overflow:auto"><table><thead><tr><th></th><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
    <tbody>${items.map((it,i)=>`<tr>
      <td style="text-align:center"><input type="checkbox" style="width:auto" data-cn="${i}" checked></td>
      <td>${esc(String(it.desc||"").split("\\n")[0])}</td>
      <td class="num">${esc(it.qty)}</td><td class="num">${money(it.rate)}</td>
      <td class="num">${money(num(it.qty)*num(it.rate))}</td></tr>`).join("")}</tbody></table></div>
    <div class="field" style="margin-top:10px"><label>Reason for the credit</label><input id="cnReason" placeholder="e.g. acres over-billed / rate corrected"></div>
    <div class="row"><button class="btn green" id="cnGo">Generate credit note</button>
      <button class="btn" id="cnCancel">Cancel</button></div>
    <div class="err" id="cnErr"></div></div>`;
  $("cnCancel").addEventListener("click",creditList);
  $("cnGo").addEventListener("click",()=>makeCredit(doc));
}

async function makeCredit(doc){
  const err=$("cnErr"); const btn=$("cnGo"); btn.disabled=true; err.textContent="";
  try{
    const picked=[...document.querySelectorAll("[data-cn]")].filter(c=>c.checked).map(c=>+c.getAttribute("data-cn"));
    if(!picked.length) throw new Error("Tick at least one line to credit.");
    const items=(doc.line_items||[]).filter((_,i)=>picked.includes(i));
    const isFarmer = doc.data.side==="farmer";
    const sub=items.reduce((s,it)=>s+num(it.qty)*num(it.rate),0);
    const gstTotal = isFarmer ? 0 : Math.round(sub*CLIENT_GST)/100;
    const fy=fyOf(todayISO());
    let seq=1; try{ const { data }=await sb().rpc("next_doc_seq",{p_doc_type:"credit_note",p_fy:fy}); if(data) seq=data; }catch(e){}
    const number="DCB/CN/"+fy+"/"+String(seq).padStart(4,"0");

    const rec={ doc_type:"credit_note", number, fiscal_year:fy, seq, doc_date:todayISO(),
      party_kind:"client", party_id:doc.party_id, party_snapshot:doc.party_snapshot,
      related_doc_id:doc.id, line_items:items,
      totals:{ sub, gstTotal, total: sub+gstTotal },
      terms:{ delivery:"Credit against "+doc.number+($("cnReason").value?(" — "+$("cnReason").value):"") },
      status:"issued", approval_status:"draft",
      data:{ source:"acre_billing", side:doc.data.side, creditOf:doc.number,
             title: isFarmer ? "Credit Note (Bill of Supply)" : null },
      created_by:window.OPS.me.id };
    const { data:ins, error }=await sb().from("documents").insert(rec).select().single();
    if(error) throw error;

    // release the acre rows that sat behind the credited lines so they can be re-billed
    const dates=items.map(it=>String(it.desc||"").match(/\(([^)]+)\)/)).filter(Boolean).map(m=>m[1]);
    let released=0;
    try{
      const col = isFarmer ? "farmer_doc_id" : "client_doc_id";
      const { data:acre }=await sb().from("acre_entries").select("id,entry_date").eq(col,doc.id);
      const want=new Set(dates.map(d=>new Date(d).toDateString()));
      const ids=(acre||[]).filter(a=>want.has(new Date(a.entry_date).toDateString())).map(a=>a.id);
      if(ids.length){ const { data:n }=await sb().rpc("release_acre_rows",{p_ids:ids,p_side:doc.data.side}); released=n||ids.length; }
    }catch(e){}

    window.OPS.audit("created","documents",ins.id, number+" · credit of "+doc.number);
    window.OPS.flashTop(number+" created ✓"+(released?(" · "+released+" acre row(s) released"):""));
    creditList();
  }catch(e){ err.textContent=e.message||String(e); }
  if(btn) btn.disabled=false;
}

/* --------------------------------------------------------------- data ---- */
async function load(){
  const host=$("abBody"); host.innerHTML="Loading…";
  let q=sb().from("v_acre_billing").select("*").order("entry_date");
  if(F.from) q=q.gte("entry_date",F.from);
  if(F.to)   q=q.lte("entry_date",F.to);
  q = side==="farmer" ? q.is("farmer_doc_id",null) : q.is("client_doc_id",null).gt("client_rate",0);
  const { data, error }=await q.range(0,9999);
  if(error){ host.innerHTML='<div class="card">Error: '+esc(error.message)+'</div>'; return; }
  rows=(data||[]).filter(r=>num(side==="farmer"?r.farmer_rate:r.client_rate)>0);
  if(!rows.length){ host.innerHTML='<div class="card muted">No unbilled '+(side==="farmer"?"farmer-rate":"client-rate")+' work in that period. 🎉</div>'; return; }

  // exact farmer detail for the sub-lines, linked by source_id (set when the
  // day was posted), so names always match the acres being billed
  const ids=[...new Set(rows.map(r=>r.id))];
  farmerBySource={};
  try{
    const { data:acre }=await sb().from("acre_entries").select("id,source_id").in("id",ids);
    const srcByAcre={}; (acre||[]).forEach(a=>{ if(a.source_id) srcByAcre[a.id]=a.source_id; });
    const srcs=[...new Set(Object.values(srcByAcre))];
    if(srcs.length){
      const { data:fs }=await sb().from("farmer_sprays").select("source_id,farmer_name,acre,contact_no").in("source_id",srcs);
      (fs||[]).forEach(f=>{ if(f.source_id) (farmerBySource[f.source_id]=farmerBySource[f.source_id]||[]).push(f); });
    }
    rows.forEach(r=>{ r._src = srcByAcre[r.id]||null; });
  }catch(e){}
  renderPick();
}

/* ------------------------------------------- layer 1: pick locations ----- */
function billTo(r){ return side==="farmer" ? r.farmer_bill_to : r.client_bill_to; }
function billToName(r){ return side==="farmer" ? r.farmer_client_name : r.client_client_name; }
function rateOf(r){ return num(side==="farmer" ? r.farmer_rate : r.client_rate); }

function renderPick(){
  // group the unbilled work by location, carrying its billing client
  const byLoc={};
  rows.forEach(r=>{ const k=r.location_id;
    byLoc[k]=byLoc[k]||{ id:k, name:r.location_name, client:billTo(r), clientName:billToName(r), acres:0, value:0, n:0, from:r.entry_date, to:r.entry_date };
    const g=byLoc[k]; g.acres+=num(r.acres); g.value+=num(r.acres)*rateOf(r); g.n++;
    if(r.entry_date<g.from) g.from=r.entry_date; if(r.entry_date>g.to) g.to=r.entry_date;
  });
  const list=Object.values(byLoc).sort((a,b)=>String(a.clientName||"").localeCompare(String(b.clientName||""))||a.name.localeCompare(b.name));
  const chosen=list.filter(l=>sel.has(String(l.id)));
  const clients=[...new Set(chosen.map(l=>String(l.client||"")))];
  const clash=clients.length>1;

  $("abBody").innerHTML=`
    <div class="card"><h3>1 · Choose locations</h3>
      <p class="muted" style="margin-top:-4px">Tick every location to bill. You may combine locations, but they must all bill the <b>same client</b>.</p>
      <div style="overflow:auto"><table><thead><tr><th></th><th>Location</th><th>Bills to (client)</th><th>Period</th><th class="num">Acres</th><th class="num">Value</th></tr></thead>
      <tbody>${list.map(l=>`<tr>
        <td style="text-align:center"><input type="checkbox" style="width:auto" data-loc="${l.id}" ${sel.has(String(l.id))?'checked':''} ${l.client?'':'disabled'}></td>
        <td><b>${esc(l.name)}</b></td>
        <td>${l.client?esc(l.clientName||''):'<span class="chip rejected">no billing party set</span>'}</td>
        <td class="muted">${fmtDate(l.from)} – ${fmtDate(l.to)}</td>
        <td class="num">${l.acres.toFixed(1)}</td><td class="num">${money(l.value)}</td></tr>`).join("")}</tbody></table></div>
      ${clash?'<div class="callout warn" style="margin-top:10px">⚠ The ticked locations bill <b>different clients</b>. One invoice can only cover one client — untick until a single client remains.</div>':''}
      ${list.some(l=>!l.client)?'<div class="small-note" style="margin-top:8px">Locations without a billing party can\'t be billed — set one on the <b>Location</b> first.</div>':''}
    </div>
    ${(chosen.length && !clash)?buildPreview(chosen):''}`;

  $("abBody").querySelectorAll("[data-loc]").forEach(cb=>cb.addEventListener("change",()=>{
    const k=cb.getAttribute("data-loc"); if(cb.checked) sel.add(k); else sel.delete(k); renderPick(); }));
  const gen=$("abGen"); if(gen) gen.addEventListener("click",()=>generate(chosen));
}

/* ------------------------------------------- layer 2: preview the doc ---- */
function linesFor(chosen){
  const keep=new Set(chosen.map(l=>String(l.id)));
  const mine=rows.filter(r=>keep.has(String(r.location_id)));
  // one line per day + rate (a rate change mid-period splits the line)
  const byKey={};
  mine.forEach(r=>{ const k=r.entry_date+"|"+rateOf(r);
    byKey[k]=byKey[k]||{ date:r.entry_date, rate:rateOf(r), acres:0, ids:[], srcs:[] };
    const g=byKey[k]; g.acres+=num(r.acres); g.ids.push(r.id); if(r._src) g.srcs.push(r._src);
  });
  return Object.values(byKey).sort((a,b)=>a.date<b.date?-1:1).map(g=>{
    let sub="";
    if(side==="farmer"){
      const fs=[]; g.srcs.forEach(s=>(farmerBySource[s]||[]).forEach(f=>fs.push(f)));
      const names=fs.filter(f=>f.farmer_name).map(f=>esc(f.farmer_name)+"("+num(f.acre)+")");
      const phone=(fs.find(f=>f.contact_no)||{}).contact_no||"";
      sub = names.length ? names.join(", ")+(phone?(" - "+phone):"") : "";
    }
    return { date:g.date, rate:g.rate, acres:g.acres, ids:g.ids, sub,
             amount: Math.round(g.acres*g.rate*100)/100 };
  });
}

function buildPreview(chosen){
  const L=linesFor(chosen);
  const acres=L.reduce((s,x)=>s+x.acres,0), sub=L.reduce((s,x)=>s+x.amount,0);
  const gst = side==="client" ? Math.round(sub*CLIENT_GST)/100 : 0;
  const label = side==="farmer" ? "Aerial Spraying - Agriculture Services"
                                : (chosen[0].rateLabel || "Marketing Expense");
  return `<div class="card"><h3>2 · ${side==="farmer"?"Bill of Supply":"Tax Invoice"} preview — ${esc(chosen[0].clientName||'')}</h3>
    <p class="muted" style="margin-top:-4px">${esc(chosen.map(c=>c.name).join(", "))} ·
      ${L.length} day-line(s) · ${acres.toFixed(1)} acres ·
      ${side==="farmer"?'<b>0% GST</b> (Bill of Supply)':'<b>'+CLIENT_GST+'% GST</b>'}</p>
    <div style="overflow:auto"><table><thead><tr><th>#</th><th>Description</th><th>HSN/SAC</th><th class="num">GST%</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
    <tbody>${L.map((x,i)=>`<tr><td>${i+1}</td>
      <td>${esc(label)} (${fmtDate(x.date)})${x.sub?`<br><span class="muted" style="font-style:italic">${x.sub}</span>`:''}</td>
      <td>${HSN}</td><td class="num">${side==="client"?CLIENT_GST:0}%</td>
      <td class="num">${x.acres}</td><td class="num">${money(x.rate)}</td><td class="num">${money(x.amount)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="6" class="num"><b>Sub total</b></td><td class="num"><b>${money(sub)}</b></td></tr>
      ${side==="client"?`<tr><td colspan="6" class="num">GST @ ${CLIENT_GST}%</td><td class="num">${money(gst)}</td></tr>`:''}
      <tr><td colspan="6" class="num"><b>Grand total (Qty ${acres.toFixed(1)})</b></td><td class="num"><b>${money(sub+gst)}</b></td></tr></tfoot></table></div>
    <div class="row" style="margin-top:10px"><button class="btn green" id="abGen">Generate ${side==="farmer"?"Bill of Supply":"Invoice"}</button>
      <span class="muted">Creates the document and marks these acre rows as billed.</span></div>
    <div class="err" id="abErr"></div></div>`;
}

/* --------------------------------------------------------- generate ----- */
async function generate(chosen){
  const btn=$("abGen"); const err=$("abErr");
  const L=linesFor(chosen);
  if(!L.length){ err.textContent="Nothing to bill."; return; }
  btn.disabled=true; err.textContent="";
  try{
    const partyId=chosen[0].client;
    const { data:party }=await sb().from("clients").select("*").eq("id",partyId).single();
    const label = side==="farmer" ? "Aerial Spraying - Agriculture Services"
                                  : ((party&&party.client_rate_label)||"Marketing Expense");
    const fy=fyOf(todayISO());
    let seq=1; try{ const { data }=await sb().rpc("next_doc_seq",{p_doc_type:"invoice",p_fy:fy}); if(data) seq=data; }catch(e){}
    const number="DCB/"+fy+"/"+String(seq).padStart(4,"0");

    const items=L.map(x=>({ desc: label+" ("+fmtDate(x.date)+")"+(x.sub?("\n"+x.sub):""),
      hsn:HSN, gst: side==="client"?CLIENT_GST:0, qty:x.acres, rate:x.rate, per:"Acre", disc:0 }));
    const sub=L.reduce((s,x)=>s+x.amount,0);
    const gstTotal = side==="client" ? Math.round(sub*CLIENT_GST)/100 : 0;

    const rec={ doc_type:"invoice", number, fiscal_year:fy, seq, doc_date:todayISO(),
      party_kind:"client", party_id:partyId,
      party_snapshot:{ firmName:partyName(party), gstin:party&&party.gstin, state:party&&party.state,
                       address:party&&party.address, mobile:party&&party.mobile },
      line_items:items, totals:{ sub, gstTotal, total: sub+gstTotal },
      terms:{ delivery:"For acre spraying work "+fmtDate(L[0].date)+" to "+fmtDate(L[L.length-1].date) },
      status:"issued", approval_status:"draft",
      data:{ source:"acre_billing", side,
             title: side==="farmer" ? "Bill of Supply" : null,
             locations: chosen.map(c=>({id:c.id,name:c.name})) },
      created_by:window.OPS.me.id };

    const { data:ins, error }=await sb().from("documents").insert(rec).select().single();
    if(error) throw error;

    const ids=[].concat(...L.map(x=>x.ids));
    const { data:n, error:mErr }=await sb().rpc("mark_acre_billed",{ p_ids:ids, p_doc:ins.id, p_side:side });
    if(mErr) throw mErr;

    window.OPS.audit("created","documents",ins.id, number+" · acre billing · "+side);
    window.OPS.flashTop(number+" created ✓ ("+(n||ids.length)+" acre rows marked billed)");
    sel.clear(); load();
  }catch(e){ err.textContent = e.message||String(e); }
  if(btn) btn.disabled=false;
}

window.OPS.routes.acre_invoice = view;
})();
