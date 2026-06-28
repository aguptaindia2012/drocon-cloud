/* ============================================================================
   DroCon Cloud — Partner Portal (#3/#4)
   - ap_rates          : Authorized-Partner billing/commission slab table (admin)
   - partner_invoices  : MANAGER view — review/approve/reject/pay + Word + invites
   - portal_submit     : EXTERNAL view — file an invoice (acres sprayed / timesheet)
   - portal_mine       : EXTERNAL view — my submitted invoices + status
   ============================================================================ */
(function(){
const { $, esc, fmt, money } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const num = v => { const n=Number(String(v==null?"":v).replace(/[₹,\s]/g,"")); return isFinite(n)?n:0; };
const todayISO = ()=> new Date().toISOString().slice(0,10);

/* ---------------------------------------------------------------------------
   Authorized-Partner rate cards — PER PARTNER (admin-managed).
   Pick a partner (or the Standard/default card), edit their commission slabs.
   Rows with partner_id = null are the Standard card (fallback for any partner
   without their own). Field rates are variable, so the partner enters the actual
   per-acre rate on each invoice and the matching slab sets the commission split.
   --------------------------------------------------------------------------- */
async function apRates(){
  const m=$("main"); const admin=window.OPS.isAdmin();
  m.innerHTML=`<div class="eyebrow">Partners · Authorized Partner</div><h1>Authorized Partner rate cards</h1>
    <div class="callout">Each authorized partner can have their <b>own commission rate card</b>. Choose a partner below (or the
      <b>Standard card</b> used as the default). On each invoice the partner enters the <b>actual per-acre rate received from the
      farmer</b>; the matching slab then splits it — partner keeps <b>Partner %</b>, DroCon Bharat retains <b>DroCon %</b> (overridable).</div>
    <div class="row wrap" style="margin:8px 0;align-items:flex-end">
      <div class="field" style="max-width:340px;margin:0"><label>Rate card for</label>
        <select id="arPartner"><option value="">— Standard (default) card —</option></select></div>
      ${admin?'<button class="btn sm" id="arSeed" title="Replace this card with the standard slabs">Copy standard slabs</button>':''}
    </div>
    <div id="arBody" class="muted">Loading…</div>
    ${admin?'<div class="row" style="margin-top:10px"><button class="btn green" id="arSave">Save rate card</button><div class="spacer"></div><div class="err" id="arErr"></div></div>':'<div class="muted">Read-only — only an admin can edit rate cards.</div>'}`;
  // partner picker
  const { data:partners }=await sb().from("authorized_partners").select("id,name,company").order("name");
  $("arPartner").innerHTML='<option value="">— Standard (default) card —</option>'+(partners||[]).map(p=>`<option value="${p.id}">${esc(p.name||p.company||"(unnamed)")}${p.company&&p.name?(" · "+esc(p.company)):""}</option>`).join("");
  let slabs=[];
  const STD=[ {slab:"Up to ₹350/- per acre",rate_upto:350,partner_pct:95,drocon_pct:5},
              {slab:"Up to ₹400/- per acre",rate_upto:400,partner_pct:93,drocon_pct:7},
              {slab:"Up to ₹450/- per acre",rate_upto:450,partner_pct:90,drocon_pct:10},
              {slab:"₹451/- & above per acre",rate_upto:null,partner_pct:85,drocon_pct:15} ];
  function draw(){
    const body=slabs.map((s,i)=>`<tr data-i="${i}">
      <td><input data-k="slab" value="${esc(s.slab||"")}" ${admin?"":"disabled"} style="min-width:180px"></td>
      <td class="num"><input data-k="rate_upto" type="number" step="any" value="${esc(s.rate_upto==null?"":s.rate_upto)}" ${admin?"":"disabled"} style="width:110px" placeholder="(top)"></td>
      <td class="num"><input data-k="partner_pct" type="number" step="any" value="${esc(s.partner_pct==null?"":s.partner_pct)}" ${admin?"":"disabled"} style="width:80px"></td>
      <td class="num"><input data-k="drocon_pct" type="number" step="any" value="${esc(s.drocon_pct==null?"":s.drocon_pct)}" ${admin?"":"disabled"} style="width:80px"></td>
      ${admin?`<td><button class="btn sm" data-del="${i}">✕</button></td>`:""}</tr>`).join("");
    $("arBody").innerHTML=`<table class="tight"><thead><tr><th>Slab</th><th class="num">Rate up to ₹/acre</th><th class="num">Partner %</th><th class="num">DroCon %</th>${admin?"<th></th>":""}</tr></thead><tbody>${body||""}</tbody></table>
      ${admin?'<div class="row" style="margin-top:8px"><button class="btn sm" id="arAdd">+ Add slab</button></div>':''}`;
    $("arBody").querySelectorAll("input[data-k]").forEach(inp=>inp.addEventListener("input",()=>{
      const i=+inp.closest("tr").getAttribute("data-i"); const k=inp.getAttribute("data-k");
      slabs[i][k] = (k==="slab") ? inp.value : (inp.value===""?null:Number(inp.value));
    }));
    $("arBody").querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{ slabs.splice(+b.getAttribute("data-del"),1); draw(); }));
    if($("arAdd")) $("arAdd").addEventListener("click",()=>{ slabs.push({slab:"",rate_upto:null,partner_pct:null,drocon_pct:null}); draw(); });
  }
  async function loadCard(){
    const pid=$("arPartner").value;
    let q=sb().from("partner_rates").select("*").eq("party_type","authorized_partner").order("rate_upto",{nullsFirst:false});
    q = pid ? q.eq("partner_id",pid) : q.is("partner_id",null);
    const { data }=await q; slabs=(data||[]).map(r=>({id:r.id,slab:r.slab,rate_upto:r.rate_upto,partner_pct:r.partner_pct,drocon_pct:r.drocon_pct}));
    if(!slabs.length && pid){ $("arBody").innerHTML=''; draw(); $("arBody").insertAdjacentHTML("afterbegin",'<div class="muted" style="margin-bottom:6px">No custom card yet — this partner currently uses the Standard card. Add slabs (or “Copy standard slabs”) to give them their own.</div>'); return; }
    draw();
  }
  $("arPartner").addEventListener("change",loadCard);
  if($("arSeed")) $("arSeed").addEventListener("click",()=>{ slabs=STD.map(s=>Object.assign({},s)); draw(); });
  if($("arSave")) $("arSave").addEventListener("click",async()=>{
    const pid=$("arPartner").value||null;
    // replace this card: delete existing rows for this partner_id, insert current
    let dq=sb().from("partner_rates").delete().eq("party_type","authorized_partner");
    dq = pid ? dq.eq("partner_id",pid) : dq.is("partner_id",null);
    const del=await dq; if(del.error){ $("arErr").textContent=del.error.message; return; }
    const recs=slabs.filter(s=>String(s.slab||"").trim()).map(s=>({ party_type:"authorized_partner", partner_id:pid,
      slab:s.slab, rate_upto:s.rate_upto, partner_pct:s.partner_pct, drocon_pct:s.drocon_pct, created_by:window.OPS.me.id }));
    if(recs.length){ const ins=await sb().from("partner_rates").insert(recs); if(ins.error){ $("arErr").textContent=ins.error.message; return; } }
    window.OPS.audit("partner_rate_card","partner_rates",pid||"standard",recs.length+" slab(s)");
    window.OPS.flashTop("Rate card saved ✓");
  });
  loadCard();
}
window.OPS.routes.ap_rates = apRates;

/* ---------------------------------------------------------------------------
   Shared: load a partner's AP slabs (own card, else the Standard card) and
   resolve a per-acre rate -> commission %
   --------------------------------------------------------------------------- */
async function loadSlabs(partnerId){
  if(partnerId){
    const { data } = await sb().from("partner_rates").select("*").eq("party_type","authorized_partner").eq("partner_id",partnerId);
    if(data && data.length) return data;
  }
  const { data:std } = await sb().from("partner_rates").select("*").eq("party_type","authorized_partner").is("partner_id",null);
  return std||[];
}
function resolveCommission(rate, slabs){
  // find the first slab whose rate_upto >= rate (ascending); fall back to the open top slab
  const asc = slabs.slice().sort((a,b)=>(a.rate_upto==null?1e9:a.rate_upto)-(b.rate_upto==null?1e9:b.rate_upto));
  for(const s of asc){ if(s.rate_upto==null || rate<=Number(s.rate_upto)) return Number(s.drocon_pct)||0; }
  return asc.length ? (Number(asc[asc.length-1].drocon_pct)||0) : 0;
}

/* ---------------------------------------------------------------------------
   Line-item editor (shared by submit form + manager on-behalf)
   kind: 'authorized_partner' (agent invoice) | 'consultant' (timesheet)
   --------------------------------------------------------------------------- */
function blankRow(kind){
  return kind==="consultant"
    ? {date:todayISO(),description:"",hours:"",rate:"",amount:0}
    : {date:todayISO(),farmer:"",mobile:"",rate:"",acre:"",amount:0,comm_rate:"",comm_amount:0};
}
function rowsToTotals(kind, rows){
  let gross=0, comm=0;
  rows.forEach(r=>{ gross+=num(r.amount); if(kind==="authorized_partner") comm+=num(r.comm_amount); });
  return { gross, commission_total:comm, net_payable: gross-comm };
}

function lineEditor(host, kind, rows, slabs, onChange){
  function recalc(){
    rows.forEach(r=>{
      if(kind==="consultant"){ r.amount = num(r.hours)*num(r.rate); }
      else {
        r.amount = num(r.rate)*num(r.acre);
        const cr = r.comm_rate!=="" && r.comm_rate!=null ? num(r.comm_rate) : resolveCommission(num(r.rate), slabs);
        r.comm_rate = cr;
        r.comm_amount = Math.round(r.amount*cr)/100;
      }
    });
    if(onChange) onChange(rowsToTotals(kind,rows));
  }
  function draw(){
    recalc();
    const head = kind==="consultant"
      ? `<th>Date</th><th>Description</th><th class="num">Hours</th><th class="num">Rate ₹/hr</th><th class="num">Amount ₹</th><th></th>`
      : `<th>Date</th><th>Farmer</th><th>Mobile</th><th class="num">Rate ₹/acre</th><th class="num">Acre</th><th class="num">Amount ₹</th><th class="num">Comm %</th><th class="num">Comm ₹</th><th></th>`;
    const body = rows.map((r,i)=> kind==="consultant"
      ? `<tr data-i="${i}">
          <td><input type="date" data-k="date" value="${esc(r.date||"")}"></td>
          <td><input data-k="description" value="${esc(r.description||"")}" style="min-width:200px"></td>
          <td class="num"><input type="number" step="any" data-k="hours" value="${esc(r.hours)}" style="width:80px"></td>
          <td class="num"><input type="number" step="any" data-k="rate" value="${esc(r.rate)}" style="width:90px"></td>
          <td class="num">${money(r.amount)}</td>
          <td><button class="btn sm" data-del="${i}">✕</button></td></tr>`
      : `<tr data-i="${i}">
          <td><input type="date" data-k="date" value="${esc(r.date||"")}"></td>
          <td><input data-k="farmer" value="${esc(r.farmer||"")}" style="min-width:140px"></td>
          <td><input data-k="mobile" value="${esc(r.mobile||"")}" style="width:120px"></td>
          <td class="num"><input type="number" step="any" data-k="rate" value="${esc(r.rate)}" style="width:90px"></td>
          <td class="num"><input type="number" step="any" data-k="acre" value="${esc(r.acre)}" style="width:80px"></td>
          <td class="num">${money(r.amount)}</td>
          <td class="num"><input type="number" step="any" data-k="comm_rate" value="${esc(r.comm_rate)}" style="width:70px" title="Auto from slab; override if needed"></td>
          <td class="num">${money(r.comm_amount)}</td>
          <td><button class="btn sm" data-del="${i}">✕</button></td></tr>`).join("");
    host.innerHTML = `<table class="tight"><thead><tr>${head}</tr></thead><tbody>${body||""}</tbody></table>
      <div class="row" style="margin-top:8px"><button class="btn sm" id="peAdd">+ Add row</button></div>`;
    host.querySelectorAll("input[data-k]").forEach(inp=>{
      inp.addEventListener("input",()=>{ const tr=inp.closest("tr"); const i=+tr.getAttribute("data-i"); rows[i][inp.getAttribute("data-k")]=inp.value; });
      inp.addEventListener("change",draw);
    });
    host.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{ rows.splice(+b.getAttribute("data-del"),1); draw(); }));
    $("peAdd").addEventListener("click",()=>{ rows.push(blankRow(kind)); draw(); });
  }
  draw();
  return { rows, totals:()=>rowsToTotals(kind,rows) };
}

/* ---------------------------------------------------------------------------
   EXTERNAL — Submit Invoice
   --------------------------------------------------------------------------- */
async function portalSubmit(){
  const p = window.OPS.profile||{};
  const kind = p.party_type==="consultant" ? "consultant" : "authorized_partner";
  const m=$("main");
  m.innerHTML = `<div class="eyebrow">Partner Portal</div><h1>Submit Invoice</h1>
    <div class="callout">Welcome, <b>${esc(p.full_name||p.email||"")}</b>. File your
      ${kind==="consultant"?"consultancy timesheet invoice":"acres-sprayed invoice"} below.
      Once submitted, the DroCon Bharat team will review and process payment. You can track status under <b>My Invoices</b>.</div>
    <div class="card">
      <div class="fgrid">
        <div class="field"><label>Invoice number (your ref)</label><input id="piNum" placeholder="e.g. AP/2026/07"></div>
        <div class="field"><label>Period</label><input id="piPeriod" placeholder="e.g. Jun 2026"></div>
      </div>
      <h3 style="margin:14px 0 4px">${kind==="consultant"?"Timesheet lines":"Acres sprayed"}</h3>
      ${kind==="authorized_partner"?'<div class="muted" style="margin-bottom:6px">Enter the <b>actual per-acre rate you received from the farmer</b> on each row. The commission % is filled automatically from the standard slabs (you can override it if your contract differs).</div>':''}
      <div id="piRows"></div>
      <div class="row" style="margin-top:12px;gap:24px;flex-wrap:wrap">
        <div><div class="eyebrow">Gross</div><b id="piGross">₹0</b></div>
        ${kind==="authorized_partner"?'<div><div class="eyebrow">DroCon commission</div><b id="piComm">₹0</b></div>':''}
        <div><div class="eyebrow">Net payable to you</div><b id="piNet" style="color:var(--green)">₹0</b></div>
      </div>
      <div class="field full" style="margin-top:10px"><label>Note (optional)</label><textarea id="piNote" placeholder="Anything the team should know"></textarea></div>
      <div class="row" style="margin-top:10px">
        <button class="btn green" id="piSend">Submit invoice</button>
        <div class="spacer"></div><div class="err" id="piErr"></div>
      </div>
      ${kind==="consultant"?'<div class="muted" style="margin-top:8px">All fees are exclusive of GST. TDS is deducted at source per the Income-tax Act, 1961 at the time of payment.</div>':''}
    </div>`;
  const slabs = kind==="authorized_partner" ? await loadSlabs(p.party_id) : [];
  const rows = [blankRow(kind)];
  const ed = lineEditor($("piRows"), kind, rows, slabs, t=>{
    $("piGross").textContent=money(t.gross);
    if($("piComm")) $("piComm").textContent=money(t.commission_total);
    $("piNet").textContent=money(t.net_payable);
  });
  $("piSend").addEventListener("click",async()=>{
    const clean = rows.filter(r=> kind==="consultant" ? (r.description||num(r.hours)||num(r.rate)) : (r.farmer||num(r.acre)||num(r.rate)));
    if(!clean.length){ $("piErr").textContent="Add at least one line."; return; }
    const t = rowsToTotals(kind, clean);
    const rec = {
      party_type:kind, party_id:p.party_id||null, party_name:p.full_name||p.email||null,
      submitted_by:window.OPS.me.id,
      invoice_number:$("piNum").value.trim()||null, period:$("piPeriod").value.trim()||null,
      line_items:clean, gross:t.gross, commission_total:t.commission_total, net_payable:t.net_payable,
      status:"submitted", manager_note:null
    };
    $("piSend").disabled=true;
    const { error }=await sb().from("partner_invoices").insert(rec);
    $("piSend").disabled=false;
    if(error){ $("piErr").textContent=error.message; return; }
    window.OPS.flashTop("Invoice submitted ✓");
    window.OPS.openTool("portal_mine");
  });
}
window.OPS.routes.portal_submit = portalSubmit;

/* ---------------------------------------------------------------------------
   EXTERNAL — My Invoices
   --------------------------------------------------------------------------- */
function invChip(s){ const map={submitted:"warn",approved:"ok",paid:"ok",rejected:"err"};
  return `<span class="chip ${map[s]||""}">${esc(s)}</span>`; }

async function portalMine(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Partner Portal</div><h1>My Invoices</h1>
    <div class="row" style="margin:8px 0"><button class="btn green sm" id="miNew">+ Submit new invoice</button></div>
    <div id="miList" class="muted">Loading…</div>`;
  $("miNew").addEventListener("click",()=>window.OPS.openTool("portal_submit"));
  const { data, error }=await sb().from("partner_invoices").select("*").eq("submitted_by",window.OPS.me.id).order("created_at",{ascending:false});
  if(error){ $("miList").innerHTML='<div class="card">Error: '+esc(error.message)+'</div>'; return; }
  const rows=data||[];
  $("miList").innerHTML = rows.length ? `<table><thead><tr><th>Submitted</th><th>Invoice #</th><th>Period</th><th class="num">Net ₹</th><th>Status</th><th>Note</th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td>${fmt(r.created_at)}</td><td>${esc(r.invoice_number||"—")}</td><td>${esc(r.period||"—")}</td>
      <td class="num">${money(r.net_payable)}</td><td>${invChip(r.status)}${r.status==="paid"&&r.paid_at?`<div class="muted">${fmt(r.paid_at)}</div>`:''}</td>
      <td class="muted">${esc(r.manager_note||"")}</td></tr>`).join("")}</tbody></table>`
    : '<div class="card muted">No invoices yet. Click “Submit new invoice”.</div>';
}
window.OPS.routes.portal_mine = portalMine;

/* ---------------------------------------------------------------------------
   MANAGER — Invoice Approvals (+ partner login invites)
   --------------------------------------------------------------------------- */
async function managerInvoices(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Partners</div><h1>Invoice Approvals</h1>
    <div class="row wrap" style="margin:8px 0">
      <select id="miFilter" style="max-width:200px">
        <option value="submitted">Pending (submitted)</option>
        <option value="approved">Approved (to pay)</option>
        <option value="paid">Paid</option>
        <option value="rejected">Rejected</option>
        <option value="">All</option>
      </select>
      <div class="spacer"></div>
      <button class="btn sm" id="miInvites">Partner Logins / Invites</button>
    </div>
    <div id="miBody" class="muted">Loading…</div>`;
  $("miInvites").addEventListener("click",inviteManager);
  $("miFilter").addEventListener("change",load);
  async function load(){
    const f=$("miFilter").value;
    let q=sb().from("partner_invoices").select("*").order("created_at",{ascending:false});
    if(f) q=q.eq("status",f);
    const { data, error }=await q;
    if(error){ $("miBody").innerHTML='<div class="card">Error: '+esc(error.message)+'</div>'; return; }
    const rows=data||[];
    $("miBody").innerHTML = rows.length ? rows.map(r=>card(r)).join("") : '<div class="card muted">Nothing here.</div>';
    rows.forEach(r=>wire(r));
  }
  function card(r){
    const isAP=r.party_type==="authorized_partner";
    const li=r.line_items||[];
    const head = isAP ? `<th>Date</th><th>Farmer</th><th>Mobile</th><th class="num">Rate</th><th class="num">Acre</th><th class="num">Amount</th><th class="num">Comm ₹</th>`
                      : `<th>Date</th><th>Description</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th>`;
    const body = li.map(x=> isAP
      ? `<tr><td>${esc(x.date||"")}</td><td>${esc(x.farmer||"")}</td><td>${esc(window.OPS.helpers.maskPhone(x.mobile))}</td><td class="num">${money(x.rate)}</td><td class="num">${esc(x.acre||"")}</td><td class="num">${money(x.amount)}</td><td class="num">${money(x.comm_amount)}</td></tr>`
      : `<tr><td>${esc(x.date||"")}</td><td>${esc(x.description||"")}</td><td class="num">${esc(x.hours||"")}</td><td class="num">${money(x.rate)}</td><td class="num">${money(x.amount)}</td></tr>`).join("");
    return `<div class="card" id="inv_${r.id}" style="margin-bottom:12px">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><div class="eyebrow">${isAP?"Authorized Partner":"Consultant"} · ${esc(r.party_name||"")}</div>
          <h3 style="margin:2px 0">${esc(r.invoice_number||"(no number)")} · ${esc(r.period||"")}</h3>
          <div class="muted">Submitted ${fmt(r.created_at)} ${invChip(r.status)}</div></div>
        <div style="text-align:right"><div class="eyebrow">Net payable</div><b style="font-size:18px">${money(r.net_payable)}</b>
          ${isAP?`<div class="muted">Gross ${money(r.gross)} · Comm ${money(r.commission_total)}</div>`:''}</div>
      </div>
      <table class="tight" style="margin-top:8px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      <div class="field full" style="margin-top:8px"><label>Manager note (sent to partner)</label><input id="mn_${r.id}" value="${esc(r.manager_note||"")}"></div>
      <div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap">
        <button class="btn sm" data-word="${r.id}">⬇ Word</button>
        <div class="spacer"></div>
        ${r.status==="submitted"?`<button class="btn green sm" data-act="approve" data-id="${r.id}">Approve</button>
          <button class="btn sm" data-act="reject" data-id="${r.id}" style="color:#a3322a;border-color:#e4b4b4">Reject</button>`:''}
        ${r.status==="approved"?`<button class="btn green sm" data-act="paid" data-id="${r.id}">Mark paid</button>`:''}
      </div></div>`;
  }
  function wire(r){
    const root=$("inv_"+r.id); if(!root) return;
    root.querySelector(`[data-word="${r.id}"]`).addEventListener("click",()=>wordInvoice(r));
    root.querySelectorAll("[data-act]").forEach(b=>b.addEventListener("click",async()=>{
      const act=b.getAttribute("data-act");
      const patch={ updated_at:new Date().toISOString(), manager_note:($("mn_"+r.id).value.trim()||null) };
      if(act==="approve"){ patch.status="approved"; patch.approver=window.OPS.me.id; patch.approved_at=new Date().toISOString(); }
      if(act==="reject"){ patch.status="rejected"; patch.approver=window.OPS.me.id; patch.approved_at=new Date().toISOString(); }
      if(act==="paid"){ patch.status="paid"; patch.paid_at=new Date().toISOString(); }
      b.disabled=true;
      const { error }=await sb().from("partner_invoices").update(patch).eq("id",r.id);
      if(error){ alert(error.message); b.disabled=false; return; }
      window.OPS.audit("partner_invoice_"+act,"partner_invoices",r.id,r.party_name||"");
      window.OPS.flashTop(act==="paid"?"Invoice marked paid ✓":("Invoice "+act+"d ✓")); load();
    }));
  }
  load();
}
window.OPS.routes.partner_invoices = managerInvoices;

function wordInvoice(r){
  const isAP=r.party_type==="authorized_partner";
  const li=r.line_items||[];
  const headers = isAP ? ["Date","Farmer Name","Farmer Mobile","Rate ₹","Acre","Amount ₹","Comm %","Commission ₹"]
                       : ["Date","Description","Hours","Rate ₹/hr","Amount ₹"];
  const body = li.map(x=> isAP
    ? [x.date||"", x.farmer||"", x.mobile||"", money(x.rate), x.acre||"", money(x.amount), (x.comm_rate||"")+"%", money(x.comm_amount)]
    : [x.date||"", x.description||"", x.hours||"", money(x.rate), money(x.amount)]);
  const totRow = isAP ? ["","","","","Totals", money(r.gross), "", money(r.commission_total)]
                      : ["","","","Total", money(r.gross)];
  body.push(totRow);
  const sections=[{ heading:(isAP?"Acres Sprayed":"Consultancy Services"),
    note:`Partner: ${r.party_name||""}   ·   Invoice ${r.invoice_number||"—"}   ·   Period ${r.period||"—"}   ·   Status: ${r.status}`,
    table:{headers, rows:body} }];
  sections.push({ heading:"Settlement", table:{ headers:["Description","Amount ₹"], rows:[
    ["Gross", money(r.gross)],
    ...(isAP?[["Less: DroCon commission", money(r.commission_total)]]:[]),
    ["Net payable to partner", money(r.net_payable)],
  ]}});
  if(r.manager_note) sections.push({ heading:"Note", note:r.manager_note });
  window.OPS.docgen.generateReport({ title:"Partner Invoice", subtitle:r.party_name||"", sections });
}

/* ---------- partner login invites (admin/manager) ---------- */
async function inviteManager(){
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="ivBack">← Back to Invoice Approvals</button>
    <div class="card" style="margin-top:12px">
      <div class="eyebrow">Partners</div><h1>Partner Logins / Invites</h1>
      <div class="callout">Pre-authorise an external email so the consultant or authorized partner can self-create a login
        (bypassing the staff-domain restriction) and reach <b>only</b> the Partner Portal. After you save, ask them to
        open the app and choose <b>Create account</b> with this exact email.</div>
      <div class="fgrid">
        <div class="field"><label>Email *</label><input id="ivEmail" placeholder="partner@example.com"></div>
        <div class="field"><label>Display name</label><input id="ivName" placeholder="Partner / firm name"></div>
        <div class="field"><label>Type *</label><select id="ivType">
          <option value="authorized_partner">Authorized Partner</option>
          <option value="consultant">Consultant</option></select></div>
        <div class="field"><label>Link to record (optional)</label><select id="ivParty"><option value="">— none —</option></select></div>
      </div>
      <div class="row" style="margin-top:8px"><button class="btn green" id="ivSave">Create invite</button>
        <div class="spacer"></div><div class="err" id="ivErr"></div></div>
    </div>
    <h3 style="margin-top:18px">Existing invites</h3><div id="ivList" class="muted">Loading…</div>`;
  $("ivBack").addEventListener("click",managerInvoices);
  async function fillParty(){
    const t=$("ivType").value; const sel=$("ivParty"); sel.innerHTML='<option value="">— none —</option>';
    try{
      if(t==="consultant"){ const {data}=await sb().from("employees").select("id,name").eq("emp_type","consultant").order("name");
        (data||[]).forEach(x=>sel.innerHTML+=`<option value="${x.id}">${esc(x.name)}</option>`); }
      else { const {data}=await sb().from("authorized_partners").select("id,name").order("name");
        (data||[]).forEach(x=>sel.innerHTML+=`<option value="${x.id}">${esc(x.name)}</option>`); }
    }catch(e){}
  }
  $("ivType").addEventListener("change",fillParty); fillParty();
  async function refresh(){
    const { data }=await sb().from("partner_invites").select("*").order("created_at",{ascending:false});
    const rows=data||[];
    $("ivList").innerHTML = rows.length ? `<table><thead><tr><th>Email</th><th>Type</th><th>Name</th><th>Status</th><th>Created</th><th></th></tr></thead>
      <tbody>${rows.map(r=>`<tr><td>${esc(r.email)}</td><td>${esc(r.party_type)}</td><td>${esc(r.party_name||"")}</td>
        <td>${r.used_at?'<span class="chip ok">used</span>':'<span class="chip warn">pending</span>'}</td>
        <td class="muted">${fmt(r.created_at)}</td>
        <td>${r.used_at?'':`<button class="btn sm" data-rv="${r.id}">Revoke</button>`}</td></tr>`).join("")}</tbody></table>`
      : '<div class="card muted">No invites yet.</div>';
    $("ivList").querySelectorAll("[data-rv]").forEach(b=>b.addEventListener("click",async()=>{
      if(!confirm("Revoke this invite?")) return;
      await sb().from("partner_invites").delete().eq("id",b.getAttribute("data-rv")); refresh();
    }));
  }
  refresh();
  $("ivSave").addEventListener("click",async()=>{
    const email=$("ivEmail").value.trim().toLowerCase();
    if(!email){ $("ivErr").textContent="Email is required."; return; }
    const partySel=$("ivParty");
    const rec={ email, party_type:$("ivType").value,
      party_id:partySel.value||null,
      party_name:$("ivName").value.trim() || (partySel.value?partySel.options[partySel.selectedIndex].text:null),
      created_by:window.OPS.me.id };
    $("ivSave").disabled=true;
    const { error }=await sb().from("partner_invites").insert(rec);
    $("ivSave").disabled=false;
    if(error){ $("ivErr").textContent=error.message; return; }
    window.OPS.audit("partner_invite","partner_invites",email,rec.party_type);
    window.OPS.flashTop("Invite created ✓"); $("ivEmail").value=""; $("ivName").value=""; refresh();
  });
}
window.OPS.partnerInvites = inviteManager;
})();
