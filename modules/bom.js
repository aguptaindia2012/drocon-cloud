/* ============================================================================
   DroCon Cloud — Bill of Material / Quotation Calculator (drones)
   Mirrors the "Drone Quotations Builder": parts → Total BOM → +Overhead% →
   Total Cost → +Profit% → Selling Price → Commission%. Rates default to the
   standard values (seeded) and are fully editable. Save designs; push the
   computed selling price into the Quotation builder as a line item.
   ============================================================================ */
(function(){
const { $, esc, money, num } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const GST_OVH = 5; // standard GST band applied on overhead/profit/selling chain

let design=null; // working copy

async function listView(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Administration</div><h1>BOM / Quotation Calculator</h1>
    <div class="row" style="margin:10px 0"><div class="spacer"></div>
      <button class="btn green sm" id="bNew">+ New design</button></div>
    <div id="bList" class="muted">Loading…</div>`;
  $("bNew").addEventListener("click",()=>edit(null));
  const { data }=await sb().from("bom_designs").select("*").order("updated_at",{ascending:false});
  const rows=data||[];
  $("bList").innerHTML = rows.length ? `<table><thead><tr><th>Design</th><th class="num">Parts</th><th class="num">Selling Price (incl GST)</th><th class="num">Updated</th></tr></thead>
    <tbody>${rows.map(r=>{ const c=compute(r); return `<tr class="clickable" data-id="${r.id}">
      <td><b>${esc(r.name)}</b></td><td class="num">${(r.parts||[]).length}</td>
      <td class="num">${money(c.sellingIncl)}</td><td class="num muted">${window.OPS.helpers.fmtDate(r.updated_at)}</td></tr>`; }).join("")}</tbody></table>`
    : '<div class="card muted">No designs yet. Click “New design”.</div>';
  $("bList").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>edit(rows.find(x=>String(x.id)===tr.getAttribute("data-id")))));
}

function compute(d){
  let bomExcl=0, bomGst=0;
  (d.parts||[]).forEach(p=>{ const amt=num(p.qty)*num(p.rate_excl); bomExcl+=amt; bomGst+=amt*num(p.gst_rate)/100; });
  const ovh = bomExcl*num(d.overhead_pct)/100;
  const costExcl = bomExcl + ovh;
  const profit = costExcl*num(d.profit_pct)/100;
  const sellingExcl = costExcl + profit;
  const sellingGst = sellingExcl*GST_OVH/100;
  const sellingIncl = sellingExcl + sellingGst;
  const commission = sellingExcl*num(d.commission_pct)/100;
  return { bomExcl, bomGst, bomIncl:bomExcl+bomGst, ovh, costExcl, profit, sellingExcl, sellingGst, sellingIncl, commission };
}

const STANDARD_BOM=[
  {part:"Frame",qty:1,rate_excl:33999,gst_rate:5},{part:"Flight Controller",qty:1,rate_excl:30499,gst_rate:5},
  {part:"Remote controller",qty:1,rate_excl:17500,gst_rate:5},{part:"Motor",qty:6,rate_excl:8950,gst_rate:5},
  {part:"Battery",qty:0,rate_excl:27874,gst_rate:18},{part:"Propellor",qty:6,rate_excl:600,gst_rate:5},
  {part:"Propellor Hub",qty:6,rate_excl:402,gst_rate:5},{part:"Centrifugal Nozzle",qty:0,rate_excl:5999,gst_rate:5},
  {part:"Nozzle",qty:4,rate_excl:989,gst_rate:5},{part:"Spraying Kit",qty:1,rate_excl:891.45,gst_rate:5},
  {part:"Terrain Radar",qty:0,rate_excl:14999,gst_rate:5},{part:"Optical Radar",qty:0,rate_excl:15299,gst_rate:5},
  {part:"CAN hub",qty:0,rate_excl:6500,gst_rate:5},{part:"Pump",qty:1,rate_excl:5000,gst_rate:5},
  {part:"Charger",qty:0,rate_excl:17500,gst_rate:18}
];
const LABOUR_LINES=[{part:"Labour",qty:1,rate_excl:0,gst_rate:18},{part:"Logistics",qty:1,rate_excl:0,gst_rate:18}];

function edit(rec){
  if(rec){ design=JSON.parse(JSON.stringify(rec)); render(); return; }
  newIntro();   // new design → ask context first
}
function newIntro(){
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="iBack">← Back to designs</button>
    <div class="card" style="margin-top:12px"><h1>New design</h1>
      <p class="muted">Capture the client &amp; delivery location (for logistics), then choose the design type.</p>
      <div class="fgrid">
        <div class="field full"><label>Potential client</label><input id="iClient" placeholder="client / company name"></div>
        <div class="field"><label>Delivery State</label>${window.OPS.geoUI.stateSelect("iState","")}</div>
        <div class="field"><label>Delivery District</label>${window.OPS.geoUI.districtSelect("iDistrict","","")}</div>
      </div>
      <div class="callout">Is this an <b>agriculture</b> drone design? Agriculture loads the standard BOM (edit as needed); other gives a blank parts template. Both include <b>Labour</b> and <b>Logistics</b> line items.</div>
      <div class="row"><button class="btn green" id="iAgri">Agriculture (load standard BOM)</button>
        <button class="btn" id="iOther">Other (blank template)</button></div>
    </div>`;
  $("iBack").addEventListener("click",listView);
  window.OPS.geoUI.wire("iState","iDistrict");
  const start=(type)=>{ design={ name:"", description:"", client_name:$("iClient").value.trim()||null,
      delivery_state:$("iState").value||null, delivery_district:$("iDistrict").value||null, design_type:type,
      parts: (type==="agriculture"?STANDARD_BOM:[{part:"",qty:1,rate_excl:0,gst_rate:18}]).map(p=>({...p})).concat(LABOUR_LINES.map(p=>({...p}))),
      overhead_pct:15, profit_pct:10, commission_pct:2 }; render(); };
  $("iAgri").addEventListener("click",()=>start("agriculture"));
  $("iOther").addEventListener("click",()=>start("other"));
}

function render(){
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="bBack">← Back to designs</button>
    <div class="card" style="margin-top:12px">
      <div class="fgrid">
        <div class="field full"><label>Design name *</label><input id="bName" value="${esc(design.name||'')}" placeholder="e.g. 10L Agri Drone with Sensor"></div>
        <div class="field"><label>Potential client</label><input id="bClient" value="${esc(design.client_name||'')}"></div>
        <div class="field"><label>Design type</label><select id="bType"><option value="agriculture" ${design.design_type!=='other'?'selected':''}>Agriculture</option><option value="other" ${design.design_type==='other'?'selected':''}>Other</option></select></div>
        <div class="field"><label>Delivery State</label>${window.OPS.geoUI.stateSelect("bState",design.delivery_state||"")}</div>
        <div class="field"><label>Delivery District</label>${window.OPS.geoUI.districtSelect("bDistrict",design.delivery_district||"",design.delivery_state||"")}</div>
        <div class="field full"><label>Description</label><input id="bDesc" value="${esc(design.description||'')}"></div>
      </div>
      <h3>Parts <span class="muted" style="font-weight:400">(includes Labour &amp; Logistics line items)</span></h3>
      <table class="linetable" id="bParts"><thead><tr><th style="width:34%">Part</th><th class="num">Qty</th><th class="num">Rate excl. GST</th><th class="num">GST%</th><th class="num">Amount</th><th class="num">Total incl.</th><th></th></tr></thead><tbody></tbody></table>
      <button class="btn sm" id="bAddPart">+ Add part</button>
      <div class="fgrid three" style="margin-top:16px">
        <div class="field"><label>Overhead %</label><input id="bOvh" type="number" step="any" value="${num(design.overhead_pct)}"></div>
        <div class="field"><label>Profit %</label><input id="bProfit" type="number" step="any" value="${num(design.profit_pct)}"></div>
        <div class="field"><label>Commission %</label><input id="bComm" type="number" step="any" value="${num(design.commission_pct)}"></div>
      </div>
      <div id="bSummary"></div>
      <div class="row wrap" style="margin-top:12px">
        <button class="btn green" id="bSave">${design.id?"Save design":"Save design"}</button>
        <button class="btn blue" id="bQuote">Use in Quotation →</button>
        <button class="btn" id="bCancel">Cancel</button>
        <div class="spacer"></div>
        ${design.id && window.OPS.canDelete()?'<button class="btn sm" id="bDel" style="color:#a3322a;border-color:#e4b4b4">Delete</button>':''}
      </div>
      <div class="err" id="bErr"></div>
    </div>
    <div id="bApproval"></div>`;
  if(design.id && window.OPS.approvals){ sb().from("bom_designs").select("*").eq("id",design.id).single().then(({data})=>{ if(data) window.OPS.approvals.bar("bom_designs", data, $("bApproval"), ()=>render()); }); }
  $("bBack").addEventListener("click",listView); $("bCancel").addEventListener("click",listView);
  renderParts(); renderSummary();
  window.OPS.geoUI.wire("bState","bDistrict");
  ["bName","bDesc"].forEach(id=>$(id).addEventListener("input",()=>{ design.name=$("bName").value; design.description=$("bDesc").value; }));
  ["bClient","bType","bState","bDistrict"].forEach(id=>$(id).addEventListener("input",()=>{ design.client_name=$("bClient").value; design.design_type=$("bType").value; design.delivery_state=$("bState").value; design.delivery_district=$("bDistrict").value; }));
  ["bOvh","bProfit","bComm"].forEach(id=>$(id).addEventListener("input",()=>{ design.overhead_pct=num($("bOvh").value); design.profit_pct=num($("bProfit").value); design.commission_pct=num($("bComm").value); renderSummary(); }));
  $("bAddPart").addEventListener("click",()=>{ design.parts.push({part:"",qty:1,rate_excl:0,gst_rate:5}); renderParts(); renderSummary(); });
  $("bSave").addEventListener("click",save);
  $("bQuote").addEventListener("click",useInQuotation);
  if($("bDel")) $("bDel").addEventListener("click",async()=>{ if(!confirm("Delete this design?"))return;
    await sb().from("bom_designs").delete().eq("id",design.id); listView(); });
}

function renderParts(){
  const tb=$("bParts").querySelector("tbody");
  tb.innerHTML = design.parts.map((p,i)=>{
    const amt=num(p.qty)*num(p.rate_excl); const tot=amt*(1+num(p.gst_rate)/100);
    return `<tr>
      <td><input data-i="${i}" data-k="part" value="${esc(p.part||'')}"></td>
      <td><input data-i="${i}" data-k="qty" type="number" step="any" value="${num(p.qty)}" style="text-align:right"></td>
      <td><input data-i="${i}" data-k="rate_excl" type="number" step="any" value="${num(p.rate_excl)}" style="text-align:right"></td>
      <td><input data-i="${i}" data-k="gst_rate" type="number" step="any" value="${num(p.gst_rate)}" style="text-align:right;width:60px"></td>
      <td class="num">${money(amt)}</td><td class="num">${money(tot)}</td>
      <td class="x" data-del="${i}">✕</td></tr>`;
  }).join("");
  tb.querySelectorAll("input").forEach(inp=>inp.addEventListener("input",()=>{
    const i=+inp.getAttribute("data-i"), k=inp.getAttribute("data-k");
    design.parts[i][k] = (k==="part")?inp.value:num(inp.value);
    renderParts(); renderSummary();
    // keep focus after re-render
    const sel=tb.querySelector(`input[data-i="${i}"][data-k="${k}"]`); if(sel){ sel.focus(); sel.setSelectionRange(sel.value.length,sel.value.length); }
  }));
  tb.querySelectorAll("[data-del]").forEach(x=>x.addEventListener("click",()=>{ design.parts.splice(+x.getAttribute("data-del"),1); if(!design.parts.length) design.parts.push({part:"",qty:1,rate_excl:0,gst_rate:5}); renderParts(); renderSummary(); }));
}

function renderSummary(){
  const c=compute(design);
  $("bSummary").innerHTML=`<div class="card" style="background:var(--soft-green)">
    <table style="font-size:13px">
      <tr><td>Total BOM (excl. GST)</td><td class="num"><b>${money(c.bomExcl)}</b></td><td class="muted">GST ${money(c.bomGst)} · incl ${money(c.bomIncl)}</td></tr>
      <tr><td>Overheads (${num(design.overhead_pct)}%)</td><td class="num">${money(c.ovh)}</td><td></td></tr>
      <tr><td><b>Total Cost (excl. GST)</b></td><td class="num"><b>${money(c.costExcl)}</b></td><td></td></tr>
      <tr><td>Profit (${num(design.profit_pct)}%)</td><td class="num">${money(c.profit)}</td><td></td></tr>
      <tr><td><b>Selling Price (excl. GST)</b></td><td class="num"><b>${money(c.sellingExcl)}</b></td><td class="muted">+ ${GST_OVH}% GST</td></tr>
      <tr><td><b style="color:var(--green)">Selling Price (incl. GST)</b></td><td class="num"><b style="color:var(--green)">${money(c.sellingIncl)}</b></td><td></td></tr>
      <tr><td>Commission (${num(design.commission_pct)}%)</td><td class="num">${money(c.commission)}</td><td></td></tr>
    </table></div>`;
}

async function save(){
  design.name=$("bName").value.trim();
  if(!design.name){ $("bErr").textContent="Design name is required."; return; }
  const rec={ name:design.name, description:$("bDesc").value||null, parts:design.parts,
    overhead_pct:num($("bOvh").value), profit_pct:num($("bProfit").value), commission_pct:num($("bComm").value),
    client_name:$("bClient").value||null, design_type:$("bType").value||null,
    delivery_state:$("bState").value||null, delivery_district:$("bDistrict").value||null };
  if(design.id){ const { error }=await sb().from("bom_designs").update(rec).eq("id",design.id); if(error){ $("bErr").textContent=error.message; return; } }
  else { rec.created_by=window.OPS.me.id; const { data:ins, error }=await sb().from("bom_designs").insert(rec).select().single(); if(error){ $("bErr").textContent=error.message; return; } design.id=ins.id; }
  window.OPS.flashTop("Design saved ✓"); listView();
}

function useInQuotation(){
  const c=compute(design);
  window.OPS._docSeed = { for:"quotation", item:{
    desc: design.name||"Agri Drone", sub: design.description||"",
    hsn:"88022000", gst:GST_OVH, qty:1, rate:Math.round(c.sellingExcl*100)/100, per:"Unit", disc:0 } };
  window.OPS.openTool("quotation");
}

window.OPS.routes.bom = listView;
})();
