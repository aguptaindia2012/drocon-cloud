/* ============================================================================
   DroCon Cloud — Billing documents
   Quotation, Invoice, Credit Note, Purchase Order. Shared editor driven by a
   per-type CONFIG. Pulls parties from clients/vendors (Quotation is filled
   afresh, independent of the client registry). Auto-suggests the next number.
   Outputs branded Word (.docx, letterhead on every page) + retrievable JSON.
   ============================================================================ */
(function(){
const { $, esc, money, num, todayISO, fyOf, fmtDate } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const pad4 = n => String(n).padStart(4,"0");
const HSN_LIST = ["88073020","88071000","85076000","88073000","9986","88022000","8806","88072000"];

const CONFIG = {
  quotation: { title:"Quotation", partyKind:"none", pickFrom:null, partyLabel:"Buyer Details",
    number:(fy,seq)=>`DCB/${fy}/${pad4(seq)}`,
    defTerms:{ paymentTerms:"50% - Booking Amount\n50% - Before Dispatch", deliveryTerms:"Upon 100% Payment. Dispatch within 7 days of payment." } },
  invoice: { title:"Tax/Cash Credit Invoice", partyKind:"client", pickFrom:"clients", partyLabel:"Buyer Details",
    number:(fy,seq)=>`DCB/${fy}/${pad4(seq)}`, copies:true,
    defTerms:{ paymentTerms:"", deliveryTerms:"" } },
  credit_note: { title:"Credit Note", partyKind:"client", pickFrom:"clients", partyLabel:"Buyer Details",
    number:(fy,seq)=>`DCB/CN/${fy}/${pad4(seq)}`, linkInvoice:true,
    defTerms:{ notes:"This Credit Note is issued against the referenced Tax Invoice. The amount stated is credited to the buyer's account and adjustable against future supplies or refundable as mutually agreed. Subject to Meerut jurisdiction." } },
  purchase_order: { title:"Purchase Order", partyKind:"vendor", pickFrom:"vendors", partyLabel:"Supplier / Vendor Details",
    number:(fy,seq)=>`DCB${fy}${pad4(seq)}`,
    defTerms:{ poTerms:[
      "Prices, taxes and currency are as specified in the line items above.",
      "Delivery to be completed within the mutually agreed timeline; any delay must be communicated in writing.",
      "Goods must conform to the agreed specifications; non-conforming goods will be returned/replaced at the supplier's cost.",
      "Payment terms as mutually agreed (advance / against documents / on delivery).",
      "Warranty as per the manufacturer's standard terms.",
      "This Purchase Order is governed by the laws of India; courts at Meerut, Uttar Pradesh shall have jurisdiction."
    ] } },
};

let D=null, TYPE=null;

/* ---------- list of existing documents of a type ---------- */
async function listView(type){
  TYPE=type; const cfg=CONFIG[type]; const m=$("main");
  m.innerHTML=`<div class="eyebrow">Administration</div><h1>${esc(cfg.title.replace("Tax/Cash Credit Invoice","Invoice"))}s</h1>
    <div class="row" style="margin:10px 0"><input id="dSearch" placeholder="Search number / party…" style="max-width:280px">
      <div class="spacer"></div><button class="btn green sm" id="dNew">+ New ${esc(type==="purchase_order"?"PO":cfg.title.split(" ")[0])}</button></div>
    <div id="dList" class="muted">Loading…</div>`;
  $("dNew").addEventListener("click",()=>startNew(type));
  const { data }=await sb().from("documents").select("*").eq("doc_type",type).order("created_at",{ascending:false});
  const all=data||[];
  function render(rows){
    $("dList").innerHTML = rows.length ? `<table><thead><tr><th>Number</th><th>Date</th><th>${esc(cfg.partyLabel.split(" ")[0])}</th><th class="num">Total</th><th>Status</th></tr></thead>
      <tbody>${rows.map(r=>`<tr class="clickable" data-id="${r.id}"><td><b>${esc(r.number)}</b></td><td>${fmtDate(r.doc_date)}</td>
        <td>${esc(((r.party_snapshot||{}).firmName)||((r.party_snapshot||{}).name)||"")}</td>
        <td class="num">${money((r.totals||{}).total)}</td><td>${window.OPS.statusChip(dispStatus(r))}</td></tr>`).join("")}</tbody></table>`
      : '<div class="card muted">No documents yet.</div>';
    $("dList").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>openExisting(all.find(x=>String(x.id)===tr.getAttribute("data-id")))));
  }
  render(all);
  $("dSearch").addEventListener("input",e=>{ const q=e.target.value.toLowerCase().trim();
    render(!q?all:all.filter(r=>String(r.number||"").toLowerCase().includes(q)|| JSON.stringify(r.party_snapshot||{}).toLowerCase().includes(q))); });
}

function blankParty(){ return { firmName:"", name:"", mobile:"", email:"", gstin:"", address:"", city:"", state:"", stateCode:"", pincode:"" }; }

// what chip to show in the list: payment lifecycle wins once money moves,
// otherwise reflect the approval state (so an approved doc reads "Approved",
// not "Draft"), falling back to the lifecycle status.
function dispStatus(r){
  if(r.status==="paid"||r.status==="partial") return r.status;
  const a=r.approval_status;
  if(a==="approved") return "approved";
  if(a==="submitted") return "in_review";
  if(a==="rejected")  return "rejected";
  return r.status||"draft";
}

async function startNew(type){
  const cfg=CONFIG[type]; const fy=fyOf(todayISO());
  let seq=1; try{ const { data }=await sb().rpc("next_doc_seq",{p_doc_type:type,p_fy:fy}); if(data) seq=data; }catch(e){}
  D={ id:null, doc_type:type, fiscal_year:fy, seq, number:cfg.number(fy,seq), doc_date:todayISO(),
      copyLabel:cfg.copies?"Original":null, party:blankParty(), party_id:null,
      related_doc_id:null, items:[], terms:Object.assign({},cfg.defTerms), status:"draft" };
  // seed from BOM calculator if present
  if(window.OPS._docSeed && window.OPS._docSeed.for===type){ D.items.push(Object.assign({},window.OPS._docSeed.item)); window.OPS._docSeed=null; }
  if(!D.items.length) D.items.push({desc:"",hsn:"",gst:type==="quotation"?5:0,qty:1,rate:0,per:type==="quotation"?"Unit":"Acre",disc:0});
  editor();
}
/* ---------- Quotation → Invoice: raise an invoice from an accepted quotation ---------- */
async function convertToInvoice(){
  const srcNum=D.number, cfg=CONFIG.invoice, fy=fyOf(todayISO());
  let seq=1; try{ const { data }=await sb().rpc("next_doc_seq",{p_doc_type:"invoice",p_fy:fy}); if(data) seq=data; }catch(e){}
  TYPE="invoice";
  D={ id:null, doc_type:"invoice", fiscal_year:fy, seq, number:cfg.number(fy,seq), doc_date:todayISO(),
      copyLabel:"Original", party:Object.assign(blankParty(), D.party||{}), party_id:D.party_id||null,
      related_doc_id:null, items:(D.items||[]).map(it=>Object.assign({},it)),
      terms:Object.assign({},cfg.defTerms), status:"draft", fromQuotation:srcNum||null };
  if(!D.items.length) D.items.push({desc:"",hsn:"",gst:0,qty:1,rate:0,per:"Acre",disc:0});
  window.OPS.flashTop("New invoice draft from quotation "+(srcNum||"")+" — review rates & save.");
  editor();
}

function openExisting(rec){
  TYPE=rec.doc_type;
  if(window.OPS.access) window.OPS.access.log("documents", rec.id, rec.number);
  D=Object.assign({ id:rec.id, doc_type:rec.doc_type, fiscal_year:rec.fiscal_year, seq:rec.seq, number:rec.number,
    doc_date:rec.doc_date, copyLabel:(rec.data&&rec.data.copyLabel)||null, party:rec.party_snapshot||blankParty(),
    party_id:rec.party_id, related_doc_id:rec.related_doc_id, items:rec.line_items||[], terms:rec.terms||{}, status:rec.status||"draft",
    fromQuotation:(rec.data&&rec.data.fromQuotation)||null }, {});
  editor();
}

function computeTotals(){ return window.OPS.docgen.computeTotals(D.items); }

function editor(){
  const cfg=CONFIG[TYPE]; const m=$("main"); const t=computeTotals();
  m.innerHTML=`<button class="btn sm" id="dBack">← Back</button>
    <div class="card" style="margin-top:12px">
      <div class="row wrap"><div class="eyebrow">Administration</div>
        <div class="spacer"></div>
        ${cfg.copies?`<label style="display:inline;margin:0">Copy: </label><select id="dCopy" style="width:auto;display:inline-block"><option ${D.copyLabel==='Original'?'selected':''}>Original</option><option ${D.copyLabel==='Duplicate'?'selected':''}>Duplicate</option></select>`:''}
      </div>
      <h1>${D.id?"Edit ":"New "}${esc(cfg.title.replace("Tax/Cash Credit Invoice","Invoice"))}</h1>
      <div class="fgrid">
        <div class="field"><label>Number</label><input id="dNum" value="${esc(D.number)}"></div>
        <div class="field"><label>Date</label><input id="dDate" type="date" value="${esc(D.doc_date)}"></div>
      </div>
      ${cfg.pickFrom?`<div class="field"><label>Pull ${cfg.partyKind} from registry</label><select id="dParty"><option value="">— select ${cfg.partyKind} —</option></select></div>`:
        `<div class="callout">Quotation party details are filled <b>afresh</b> here and are independent of the Clients registry.</div>`}
      ${cfg.linkInvoice?`<div class="field"><label>Against Invoice</label><select id="dInv"><option value="">— select invoice —</option></select></div>`:''}
      <h3>${esc(cfg.partyLabel)}</h3>
      <div class="fgrid">
        <div class="field full"><label>Firm / ${cfg.partyKind==='vendor'?'Vendor':'Buyer'} Name</label><input id="p_firmName" value="${esc(D.party.firmName||'')}"></div>
        <div class="field"><label>Contact Person</label><input id="p_name" value="${esc(D.party.name||'')}"></div>
        <div class="field"><label>Mobile / Phone</label><input id="p_mobile" value="${esc(D.party.mobile||'')}"></div>
        <div class="field full"><label>Address</label><input id="p_address" value="${esc(D.party.address||'')}"></div>
        <div class="field"><label>City</label><input id="p_city" value="${esc(D.party.city||'')}"></div>
        <div class="field"><label>State</label><input id="p_state" value="${esc(D.party.state||'')}"></div>
        <div class="field"><label>State Code</label><input id="p_stateCode" value="${esc(D.party.stateCode||'')}"></div>
        <div class="field"><label>Pincode</label><input id="p_pincode" value="${esc(D.party.pincode||'')}"></div>
        <div class="field"><label>GSTIN / UIN</label><input id="p_gstin" value="${esc(D.party.gstin||'')}"></div>
        <div class="field"><label>Email</label><input id="p_email" value="${esc(D.party.email||'')}"></div>
      </div>

      <h3>Line Items</h3>
      <datalist id="hsnList">${HSN_LIST.map(h=>`<option value="${h}">`).join("")}</datalist>
      <div style="overflow:auto"><table class="linetable" id="dItems"><thead><tr>
        <th style="min-width:200px">Description</th><th>HSN/SAC</th><th class="num">GST%</th><th class="num">Qty</th><th class="num">Rate</th><th>Per</th><th class="num">Disc%</th><th class="num">Amount</th><th></th>
      </tr></thead><tbody></tbody></table></div>
      <div class="row" style="margin-top:6px"><button class="btn sm" id="dAddItem">+ Blank line</button>
        <select id="dCatPick" style="max-width:320px"><option value="">+ Add from catalogue…</option></select></div>

      <div id="dTotals"></div>

      <h3 style="margin-top:14px">Terms</h3>
      ${termsHTML(cfg)}

      ${TYPE==='quotation' && D.id?'<div class="callout">When this quotation is <b>accepted</b> by the client, use <b>→ Convert to Invoice</b> to raise an invoice pre-filled with these details. You can revise rates, quantities and negotiated terms before saving.</div>':''}

      <div class="row wrap" style="margin-top:14px">
        <button class="btn green" id="dSave">${D.id?"Save changes":"Save"}</button>
        ${TYPE==='quotation' && D.id?'<button class="btn blue" id="dToInvoice">→ Convert to Invoice</button>':''}
        <button class="btn blue" id="dWord">⬇ Download Word (.docx)</button>
        <button class="btn" id="dJson">⬇ Download JSON</button>
        <button class="btn sm" id="dImport">Import JSON…</button>
        ${TYPE==='invoice'?'<label class="muted" style="display:inline;margin-left:8px"><input type="checkbox" id="dStock" style="width:auto"> reduce spare stock on save</label>':''}
        <div class="spacer"></div>
        ${D.id && window.OPS.canDelete()?'<button class="btn sm" id="dDel" style="color:#a3322a;border-color:#e4b4b4">Delete</button>':''}
      </div>
      <div class="err" id="dErr"></div>
    </div>
    <div id="dApproval"></div>`;

  if(D.id && window.OPS.approvals){ sb().from("documents").select("*").eq("id",D.id).single().then(({data})=>{ if(data) window.OPS.approvals.bar("documents", data, $("dApproval"), ()=>editor()); }); }
  $("dBack").addEventListener("click",()=>listView(TYPE));
  $("dNum").addEventListener("input",()=>D.number=$("dNum").value);
  $("dDate").addEventListener("input",()=>D.doc_date=$("dDate").value);
  if($("dCopy")) $("dCopy").addEventListener("change",()=>D.copyLabel=$("dCopy").value);
  ["firmName","name","mobile","email","gstin","address","city","state","stateCode","pincode"].forEach(k=>
    $("p_"+k).addEventListener("input",()=>D.party[k]=$("p_"+k).value));
  $("dAddItem").addEventListener("click",()=>{ D.items.push({desc:"",hsn:"",gst:0,qty:1,rate:0,per:"",disc:0}); renderItems(); });
  $("dSave").addEventListener("click",save);
  $("dWord").addEventListener("click",async()=>{ syncTerms();
    const g=toDocgen();
    if(D.id){ try{ const {data}=await sb().from("documents").select("approval_status").eq("id",D.id).single(); g.systemApproved = !!(data && data.approval_status==="approved"); }catch(e){} }
    window.OPS.docgen.generateWord(g);
  });
  $("dJson").addEventListener("click",()=>{ syncTerms(); window.OPS.docgen.downloadJson(toDocgen()); });
  $("dImport").addEventListener("click",importJson);
  if($("dToInvoice")) $("dToInvoice").addEventListener("click",convertToInvoice);
  if($("dDel")) $("dDel").addEventListener("click",async()=>{ if(!confirm("Delete this document?"))return; await sb().from("documents").delete().eq("id",D.id); listView(TYPE); });
  renderItems(); loadPickers(cfg);
  bindTerms(cfg);
}

function renderItems(){
  const tb=$("dItems").querySelector("tbody");
  tb.innerHTML=D.items.map((it,i)=>{
    const amt=num(it.qty)*num(it.rate)*(1-num(it.disc)/100);
    return `<tr>
      <td><input data-i="${i}" data-k="desc" value="${esc(it.desc||'')}"><input data-i="${i}" data-k="sub" placeholder="(sub-line, optional)" value="${esc(it.sub||'')}" style="font-size:11px;margin-top:2px"></td>
      <td><input data-i="${i}" data-k="hsn" list="hsnList" value="${esc(it.hsn||'')}" style="width:90px"></td>
      <td><input data-i="${i}" data-k="gst" type="number" step="any" value="${num(it.gst)}" style="width:55px;text-align:right"></td>
      <td><input data-i="${i}" data-k="qty" type="number" step="any" value="${num(it.qty)}" style="width:60px;text-align:right"></td>
      <td><input data-i="${i}" data-k="rate" type="number" step="any" value="${num(it.rate)}" style="width:90px;text-align:right"></td>
      <td><input data-i="${i}" data-k="per" value="${esc(it.per||'')}" style="width:60px"></td>
      <td><input data-i="${i}" data-k="disc" type="number" step="any" value="${num(it.disc)}" style="width:55px;text-align:right"></td>
      <td class="num">${money(amt)}</td><td class="x" data-del="${i}">✕</td></tr>`;
  }).join("");
  tb.querySelectorAll("input").forEach(inp=>inp.addEventListener("input",()=>{
    const i=+inp.getAttribute("data-i"), k=inp.getAttribute("data-k");
    D.items[i][k]=(k==="desc"||k==="sub"||k==="hsn"||k==="per")?inp.value:num(inp.value);
    // update only amount + totals without losing focus
    const row=inp.closest("tr"); const amt=num(D.items[i].qty)*num(D.items[i].rate)*(1-num(D.items[i].disc)/100);
    row.children[7].textContent=money(amt); renderTotals();
  }));
  tb.querySelectorAll("[data-del]").forEach(x=>x.addEventListener("click",()=>{ D.items.splice(+x.getAttribute("data-del"),1); if(!D.items.length) D.items.push({desc:"",hsn:"",gst:0,qty:1,rate:0,per:"",disc:0}); renderItems(); }));
  renderTotals();
}
function renderTotals(){
  const t=computeTotals();
  let gstLines=Object.keys(t.gstBuckets||{}).filter(g=>num(g)>0&&t.gstBuckets[g]>0).map(g=>`<tr><td>GST @ ${g}%</td><td class="num">${money(t.gstBuckets[g])}</td></tr>`).join("");
  $("dTotals").innerHTML=`<div class="card" style="background:var(--soft-green);max-width:340px;margin-left:auto">
    <table style="font-size:13px"><tr><td>Sub Total</td><td class="num">${money(t.sub)}</td></tr>${gstLines}
    <tr><td><b style="color:var(--green)">Grand Total</b></td><td class="num"><b style="color:var(--green)">${money(t.total)}</b></td></tr></table>
    <div class="muted" style="margin-top:6px">${window.OPS.docgen.amountInWords(t.total)}</div></div>`;
}

async function loadPickers(cfg){
  // catalogue picker (services + spares)
  const [{data:svc},{data:spr}]=await Promise.all([
    sb().from("service_catalogue").select("*").order("name"),
    sb().from("spare_catalogue").select("*").order("name") ]);
  const opt=[];
  (svc||[]).forEach(s=>opt.push(`<option value="svc:${s.id}">[Service] ${esc(s.name)}${s.default_rate?(" — "+money(s.default_rate)):""}</option>`));
  (spr||[]).forEach(s=>opt.push(`<option value="spr:${s.id}">[Spare] ${esc(s.name)}${s.rate_excl_gst?(" — "+money(s.rate_excl_gst)):""}</option>`));
  $("dCatPick").innerHTML='<option value="">+ Add from catalogue…</option>'+opt.join("");
  $("dCatPick").addEventListener("change",()=>{ const v=$("dCatPick").value; if(!v) return; const [kind,id]=v.split(":");
    const s=(kind==="svc"?svc:spr).find(x=>x.id===id);
    if(kind==="svc") D.items.push({desc:s.name,hsn:s.hsn_sac||"",gst:num(s.gst_rate),qty:1,rate:num(s.default_rate),per:s.unit||"",disc:0});
    else D.items.push({desc:s.name,hsn:s.hsn_code||"",gst:num(s.gst_rate),qty:1,rate:num(s.rate_excl_gst),per:s.unit||"",disc:0, _spareId:s.id});
    $("dCatPick").value=""; renderItems(); });
  // party picker
  if(cfg.pickFrom){
    const { data }=await sb().from(cfg.pickFrom).select("*").order(cfg.pickFrom==="clients"?"firm_name":"firm_name");
    const rows=data||[];
    $("dParty").innerHTML='<option value="">— select '+cfg.partyKind+' —</option>'+rows.map(r=>`<option value="${r.id}">${esc(r.firm_name||r.name)}</option>`).join("");
    if(D.party_id) $("dParty").value=D.party_id;
    $("dParty").addEventListener("change",()=>{ const r=rows.find(x=>x.id===$("dParty").value); if(!r) return;
      D.party_id=r.id;
      D.party={ firmName:r.firm_name||r.name||"", name:r.name||"", mobile:r.mobile||"", email:r.email||"",
        gstin:r.gstin||"", address:r.address||"", city:r.city||"", state:r.state||"", stateCode:r.state_code||"", pincode:r.pincode||"" };
      ["firmName","name","mobile","email","gstin","address","city","state","stateCode","pincode"].forEach(k=>{ if($("p_"+k)) $("p_"+k).value=D.party[k]||""; });
      if(cfg.defTerms && r.default_terms && cfg.defTerms.poTerms){ /* vendor default terms */ const ta=$("t_poTerms"); if(ta) ta.value=r.default_terms; }
    });
  }
  // credit note: link invoice
  if(cfg.linkInvoice){
    const { data }=await sb().from("documents").select("id,number,party_snapshot,totals").eq("doc_type","invoice").order("created_at",{ascending:false});
    const inv=data||[];
    $("dInv").innerHTML='<option value="">— select invoice —</option>'+inv.map(r=>`<option value="${r.id}">${esc(r.number)} — ${esc((r.party_snapshot||{}).firmName||"")}</option>`).join("");
    if(D.related_doc_id) $("dInv").value=D.related_doc_id;
    $("dInv").addEventListener("change",()=>{ D.related_doc_id=$("dInv").value||null; const r=inv.find(x=>x.id===D.related_doc_id);
      if(r){ if(!D.party.firmName){ D.party=r.party_snapshot||D.party; ["firmName","name","mobile","email","gstin","address","city","state","stateCode","pincode"].forEach(k=>{ if($("p_"+k)) $("p_"+k).value=D.party[k]||""; }); }
        const note=$("t_notes"); if(note && r.number) note.value=(CONFIG.credit_note.defTerms.notes).replace("the referenced Tax Invoice","Tax Invoice No. "+r.number); } });
  }
}

/* ---------- terms editors ---------- */
function termsHTML(cfg){
  const t=D.terms||{};
  let h="";
  if("paymentTerms" in (cfg.defTerms||{})) h+=`<div class="field"><label>Terms of Payment</label><textarea id="t_paymentTerms">${esc(t.paymentTerms||"")}</textarea></div>`;
  if("deliveryTerms" in (cfg.defTerms||{})) h+=`<div class="field"><label>Terms of Delivery</label><textarea id="t_deliveryTerms">${esc(t.deliveryTerms||"")}</textarea></div>`;
  if("poTerms" in (cfg.defTerms||{})) h+=`<div class="field"><label>Terms &amp; Conditions (one per line — editable)</label><textarea id="t_poTerms" style="min-height:140px">${esc((t.poTerms||cfg.defTerms.poTerms||[]).join("\n"))}</textarea></div>`;
  if("notes" in (cfg.defTerms||{})) h+=`<div class="field"><label>Notes</label><textarea id="t_notes">${esc(t.notes||cfg.defTerms.notes||"")}</textarea></div>`;
  return h||'<p class="muted">No standard terms for this document.</p>';
}
function bindTerms(cfg){ /* values read on demand via syncTerms */ }
function syncTerms(){
  D.terms=D.terms||{};
  if($("t_paymentTerms")) D.terms.paymentTerms=$("t_paymentTerms").value;
  if($("t_deliveryTerms")) D.terms.deliveryTerms=$("t_deliveryTerms").value;
  if($("t_poTerms")) D.terms.poTerms=$("t_poTerms").value.split("\n").map(s=>s.trim()).filter(Boolean);
  if($("t_notes")) D.terms.notes=$("t_notes").value;
}

/* ---------- map to the docgen shape ---------- */
function toDocgen(){
  const cfg=CONFIG[TYPE];
  const refs=[];
  if(D.copyLabel) {/* title carries copy */}
  if(TYPE==="credit_note" && D.related_doc_id){ /* shown in notes */ }
  const title = TYPE==="invoice" ? `Tax/Cash Credit Invoice (${D.copyLabel||"Original"})` : cfg.title;
  return { doc_type:TYPE, number:D.number, doc_date:D.doc_date, title,
    party:D.party, refs, items:D.items, totals:computeTotals(), terms:D.terms, copyLabel:D.copyLabel };
}

/* ---------- persist ---------- */
async function save(){
  syncTerms();
  if(!D.number){ $("dErr").textContent="Document number is required."; return; }
  const t=computeTotals();
  const rec={ doc_type:TYPE, number:D.number, fiscal_year:D.fiscal_year, seq:D.seq, doc_date:D.doc_date,
    party_kind:CONFIG[TYPE].partyKind, party_id:D.party_id||null, party_snapshot:D.party,
    line_items:D.items, totals:t, terms:D.terms, status:D.status||"draft",
    related_doc_id:D.related_doc_id||null, data:{ copyLabel:D.copyLabel, fromQuotation:D.fromQuotation||null } };
  let savedId=D.id;
  let reverted=false, reviewerId=null;   // #13: a non-admin editing an APPROVED doc sends it back to review
  if(D.id){
    if(!window.OPS.isAdmin()){
      const { data:cur }=await sb().from("documents").select("approval_status,assigned_approver").eq("id",D.id).single();
      if(cur && cur.approval_status==="approved"){
        rec.approval_status="submitted"; rec.submitted_by=window.OPS.me.id; rec.submitted_at=new Date().toISOString(); rec.reject_note=null;
        reverted=true; reviewerId=cur.assigned_approver||null;
      }
    }
    const { error }=await sb().from("documents").update(rec).eq("id",D.id); if(error){ $("dErr").textContent=error.message; return; }
  }
  else { rec.created_by=window.OPS.me.id; const { data:ins, error }=await sb().from("documents").insert(rec).select().single();
    if(error){ $("dErr").textContent=(error.code==="23505")?"That number already exists for this type — change it.":error.message; return; }
    D.id=ins.id; savedId=ins.id; }
  window.OPS.audit(D.id&&savedId?"saved":"created","document",savedId,TYPE+" "+D.number);
  if(reverted){
    window.OPS.audit("edit_reapproval","document",savedId,TYPE+" "+D.number+" reverted to review after edit");
    try{ if(reviewerId) await sb().from("notifications").insert({ user_id:reviewerId, message:"Re-review needed: "+TYPE+" "+D.number+" was edited after approval." }); }catch(e){}
    window.OPS.refreshNotifs && window.OPS.refreshNotifs();
    window.OPS.flashTop("Saved — sent back for re-approval (edited after approval)"); editor(); return;
  }
  // optional inventory decrement for invoice spare lines
  if(TYPE==="invoice" && $("dStock") && $("dStock").checked){
    for(const it of D.items){ if(it._spareId && num(it.qty)>0){
      await sb().from("inventory_moves").insert({ spare_id:it._spareId, qty:num(it.qty), direction:"out", reason:"invoice "+D.number, sales_invoice_no:D.number, ref_doc_id:savedId, created_by:window.OPS.me.id }); } }
  }
  window.OPS.flashTop("Saved ✓"); editor();
}

function importJson(){
  const inp=$("jsonImport");
  inp.onchange=ev=>{ const f=ev.target.files[0]; if(!f)return; const r=new FileReader();
    r.onload=()=>{ try{ const o=JSON.parse(r.result);
      D.number=o.number||D.number; D.doc_date=o.doc_date||D.doc_date; D.party=o.party||D.party;
      D.items=o.items||o.line_items||D.items; D.terms=o.terms||D.terms; D.copyLabel=o.copyLabel||D.copyLabel;
      editor(); window.OPS.flashTop("Imported JSON ✓");
    }catch(e){ alert("Not valid document JSON."); } }; r.readAsText(f); inp.value=""; };
  inp.click();
}

window.OPS.routes.quotation     = ()=>listView("quotation");
window.OPS.routes.invoice       = ()=>listView("invoice");
window.OPS.routes.credit_note   = ()=>listView("credit_note");
window.OPS.routes.purchase_order= ()=>listView("purchase_order");
window.OPS.billing = { listView }; // for receivables to reuse
})();
