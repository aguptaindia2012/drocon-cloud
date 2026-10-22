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
const PC = window.OPS.profitCats;
const GST_OVH = 5; // standard GST band applied on overhead/profit/selling chain

let design=null; // working copy
let catItems=[];  // flattened catalogue (spares + services) for the parts picker
async function loadCatalogue(){
  const [{data:svc},{data:spr}]=await Promise.all([
    sb().from("service_catalogue").select("*").eq("active",true).order("name"),
    sb().from("spare_catalogue").select("*").eq("active",true).order("name") ]);
  catItems=[];
  (spr||[]).forEach(s=>catItems.push({ kind:"spr", id:s.id, no:s.part_no||"", name:s.name,
    rate:num(s.rate_excl_gst), gst:num(s.gst_rate), rev:s.rev_category||"",
    label:"[Spare] "+(s.part_no?s.part_no+" · ":"")+s.name }));
  (svc||[]).forEach(s=>catItems.push({ kind:"svc", id:s.id, no:s.service_no||"", name:s.name,
    rate:num(s.default_rate), gst:num(s.gst_rate), rev:s.rev_category||"",
    label:"[Service] "+(s.service_no?s.service_no+" · ":"")+s.name }));
}
// next free product part number (reads spare_catalogue + existing BOMs)
async function nextPartNo(){
  const [{data:sp},{data:bm}]=await Promise.all([
    sb().from("spare_catalogue").select("part_no"), sb().from("bom_designs").select("part_no") ]);
  let max=0; [...(sp||[]),...(bm||[])].forEach(r=>{ const m=String(r.part_no||"").match(/(\d+)\s*$/); if(m){ const n=parseInt(m[1],10); if(n>max) max=n; } });
  return "PRT-"+String(max+1).padStart(4,"0");
}

async function listView(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Administration</div><h1>BOM / Quotation Calculator</h1>
    <div class="row" style="margin:10px 0"><div class="spacer"></div>
      <button class="btn green sm" id="bNew">+ New design</button></div>
    <div id="bList" class="muted">Loading…</div>`;
  $("bNew").addEventListener("click",()=>edit(null));
  const { data }=await sb().from("bom_designs").select("*").order("updated_at",{ascending:false});
  const rows=data||[]; const fd=window.OPS.helpers.fmtDate;
  const stChip=s=>window.OPS.statusChip(s==="submitted"?"in_review":(s||"draft"));
  $("bList").innerHTML = rows.length ? `<div style="overflow:auto"><table><thead><tr>
      <th>Product</th><th>Part #</th><th>Rev. cat.</th><th class="num">Base cost</th><th class="num">Overheads</th><th class="num">Profit</th><th class="num">Total cost</th><th>Status</th><th>Date</th></tr></thead>
    <tbody>${rows.map(r=>{ const c=compute(r); const dt=r.approved_at||r.updated_at; return `<tr class="clickable" data-id="${r.id}">
      <td><b>${esc(r.name)}</b></td><td class="muted">${esc(r.part_no||"—")}</td>
      <td>${esc(r.rev_category?PC.label(r.rev_category):"—")}</td>
      <td class="num">${money(c.bomExcl)}</td><td class="num">${money(c.ovh)}</td><td class="num">${money(c.profit)}</td>
      <td class="num"><b>${money(c.sellingExcl)}</b></td>
      <td>${stChip(r.approval_status)}</td><td class="num muted">${esc(fd(dt))}</td></tr>`; }).join("")}</tbody></table></div>`
    : '<div class="card muted">No BOMs yet. Click “New design”.</div>';
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
        <div class="field"><label>Revenue category</label><select id="bRevCat"><option value="">— select —</option>${PC.revenue.map(([k,l])=>`<option value="${k}"${design.rev_category===k?' selected':''}>${esc(l)}</option>`).join("")}</select></div>
        <div class="field"><label>Product part number <span class="muted" style="font-weight:normal">(auto for new)</span></label><input id="bPartNo" value="${esc(design.part_no||'')}" placeholder="auto-assigned"></div>
        <div class="field full"><label>Re-costing an existing catalogue product? Pick it (loads its number &amp; category)</label>
          <input id="bExisting" placeholder="type a part number or name…" autocomplete="off"><div id="bExistingList" class="combo-list" style="display:none"></div></div>
      </div>
      <h3>Parts <span class="muted" style="font-weight:400">(pick from the catalogue, or add Labour / Logistics manually)</span></h3>
      <div class="field" style="position:relative;max-width:520px"><input id="bPartSearch" placeholder="+ Add part from catalogue — type a number or name…" autocomplete="off" style="width:100%"><div id="bPartList" class="combo-list" style="display:none"></div></div>
      <table class="linetable" id="bParts"><thead><tr><th style="width:12%">No.</th><th style="width:28%">Part</th><th class="num">Qty</th><th class="num">Rate excl. GST</th><th class="num">GST%</th><th class="num">Amount</th><th class="num">Total incl.</th><th></th></tr></thead><tbody></tbody></table>
      <button class="btn sm" id="bAddPart">+ Add blank line (Labour / Logistics)</button>
      <div class="fgrid three" style="margin-top:16px">
        <div class="field"><label>Overhead %</label><input id="bOvh" type="number" step="any" value="${num(design.overhead_pct)}"></div>
        <div class="field"><label>Profit %</label><input id="bProfit" type="number" step="any" value="${num(design.profit_pct)}"></div>
        <div class="field"><label>Commission %</label><input id="bComm" type="number" step="any" value="${num(design.commission_pct)}"></div>
      </div>
      <div id="bSummary"></div>
      <div class="row wrap" style="margin-top:12px">
        <button class="btn green" id="bSave">${design.id?"Save design":"Save design"}</button>
        <button class="btn blue" id="bQuote">Use in Quotation →</button>
        <span id="bDocHost" style="display:inline-flex;gap:6px;align-items:center"></span>
        ${design.id?'<button class="btn" id="bTransfer">⇪ Transfer product to Catalogue</button>':''}
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
  $("bRevCat").addEventListener("change",()=>{ design.rev_category=$("bRevCat").value||null; });
  $("bPartNo").addEventListener("input",()=>{ design.part_no=$("bPartNo").value.trim()||null; });
  $("bAddPart").addEventListener("click",()=>{ design.parts.push({part:"",qty:1,rate_excl:0,gst_rate:5}); renderParts(); renderSummary(); });
  $("bSave").addEventListener("click",save);
  $("bQuote").addEventListener("click",useInQuotation);
  if($("bTransfer")) $("bTransfer").addEventListener("click",transferToCatalogue);
  // letterhead BOM document — Preview / Download / Email (Word or PDF)
  if($("bDocHost") && window.OPS.report && window.OPS.report.wordButton){
    const title=(design.part_no?("BOM "+design.part_no+" — "):"BOM — ")+(design.name||"Assembly");
    window.OPS.report.wordButton("bDocHost", title, ()=>bomReportSections(), { who:design.client_name||"Sir/Madam" });
  }
  if($("bDel")) $("bDel").addEventListener("click",async()=>{ if(!confirm("Delete this design?"))return;
    await sb().from("bom_designs").delete().eq("id",design.id); listView(); });
  // auto-assign a new product part number (only for a brand-new design, editable)
  if(!design.id && !design.part_no){ nextPartNo().then(no=>{ if($("bPartNo") && !$("bPartNo").value){ $("bPartNo").value=no; design.part_no=no; } }).catch(()=>{}); }
  // catalogue parts picker + existing-product picker
  loadCatalogue().then(()=>{
    combo("bPartSearch","bPartList", ()=>catItems, it=>{
      design.parts.push({ part:it.name, qty:1, rate_excl:it.rate, gst_rate:it.gst, _partNo:it.no, _catId:it.id, _kind:it.kind });
      if(it.rev && !design.rev_category){ design.rev_category=it.rev; if($("bRevCat")) $("bRevCat").value=it.rev; }
      renderParts(); renderSummary(); $("bPartSearch").value="";
    });
    const existing=catItems.filter(x=>x.kind==="spr");
    combo("bExisting","bExistingList", ()=>existing, it=>{
      design.part_no=it.no||design.part_no; if($("bPartNo")) $("bPartNo").value=design.part_no||"";
      if(!design.name){ design.name=it.name; if($("bName")) $("bName").value=it.name; }
      if(it.rev){ design.rev_category=it.rev; if($("bRevCat")) $("bRevCat").value=it.rev; }
      $("bExisting").value=it.name; window.OPS.flashTop&&window.OPS.flashTop("Re-costing "+(it.no||it.name)+" — add/adjust parts, then Save");
    });
  });
}
// minimal type-to-filter combobox: items() → [{label,...}], onPick(item)
function combo(inputId, listId, items, onPick){
  const box=$(inputId), listEl=$(listId); if(!box||!listEl) return;
  listEl.style.cssText="position:absolute;z-index:60;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.12);max-height:260px;overflow:auto;min-width:320px;display:none";
  let cur=[], hi=-1;
  const close=()=>{ listEl.style.display="none"; hi=-1; };
  const paint=()=>{ listEl.innerHTML=cur.map((it,i)=>`<div data-i="${i}" style="padding:7px 10px;cursor:pointer;${i===hi?'background:#eef5e9':''}">${esc(it.label)}</div>`).join("")||'<div class="muted" style="padding:7px 10px">No match</div>';
    listEl.style.display="block";
    listEl.querySelectorAll("[data-i]").forEach(d=>d.addEventListener("mousedown",e=>{ e.preventDefault(); onPick(cur[+d.getAttribute("data-i")]); close(); })); };
  box.addEventListener("input",()=>{ const q=box.value.toLowerCase().trim(); const all=items();
    cur = q ? all.filter(it=>it.label.toLowerCase().includes(q)).slice(0,40) : all.slice(0,40); hi=-1; paint(); });
  box.addEventListener("focus",()=>{ if(box.value.trim()){ box.dispatchEvent(new Event("input")); } });
  box.addEventListener("keydown",e=>{ if(listEl.style.display==="none") return;
    if(e.key==="ArrowDown"){ e.preventDefault(); hi=Math.min(hi+1,cur.length-1); paint(); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); hi=Math.max(hi-1,0); paint(); }
    else if(e.key==="Enter"){ e.preventDefault(); if(cur[hi]){ onPick(cur[hi]); close(); } }
    else if(e.key==="Escape"){ close(); } });
  box.addEventListener("blur",()=>setTimeout(close,150));
}

function renderParts(){
  const tb=$("bParts").querySelector("tbody");
  tb.innerHTML = design.parts.map((p,i)=>{
    const amt=num(p.qty)*num(p.rate_excl); const tot=amt*(1+num(p.gst_rate)/100);
    return `<tr>
      <td class="muted" style="font-size:12px">${esc(p._partNo||(p._kind?"":"—"))}</td>
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
      <tr><td><b>Base part cost (excl. GST)</b></td><td class="num"><b>${money(c.bomExcl)}</b></td><td class="muted">sum of catalogue base rates × qty</td></tr>
      <tr><td>+ Overheads (${num(design.overhead_pct)}%)</td><td class="num">${money(c.ovh)}</td><td></td></tr>
      <tr><td>+ Profit (${num(design.profit_pct)}%)</td><td class="num">${money(c.profit)}</td><td class="muted">on base + overheads</td></tr>
      <tr style="border-top:2px solid var(--line)"><td><b style="color:var(--green)">Total cost (excl. GST)</b></td><td class="num"><b style="color:var(--green)">${money(c.sellingExcl)}</b></td><td class="muted">incl. GST ${money(c.sellingIncl)}</td></tr>
      ${num(design.commission_pct)?`<tr><td class="muted">Commission (${num(design.commission_pct)}%)</td><td class="num muted">${money(c.commission)}</td><td></td></tr>`:''}
    </table></div>`;
}

async function save(){
  design.name=$("bName").value.trim();
  if(!design.name){ $("bErr").textContent="Design name is required."; return; }
  const rec={ name:design.name, description:$("bDesc").value||null, parts:design.parts,
    overhead_pct:num($("bOvh").value), profit_pct:num($("bProfit").value), commission_pct:num($("bComm").value),
    client_name:$("bClient").value||null, design_type:$("bType").value||null,
    delivery_state:$("bState").value||null, delivery_district:$("bDistrict").value||null,
    rev_category:design.rev_category||null, part_no:($("bPartNo").value.trim()||null) };
  if(design.id){ const { error }=await sb().from("bom_designs").update(rec).eq("id",design.id); if(error){ $("bErr").textContent=error.message; return; } }
  else { rec.created_by=window.OPS.me.id; const { data:ins, error }=await sb().from("bom_designs").insert(rec).select().single(); if(error){ $("bErr").textContent=error.message; return; } design.id=ins.id; }
  window.OPS.flashTop("Design saved ✓"); listView();
}

// sections for the branded BOM document (title/parts/costing) from any BOM row
function bomSections(d){
  const c=compute(d);
  return [
    { heading:"Product", table:{ headers:["Field","Value"], rows:[
      ["Product", d.name||""], ["Part number", d.part_no||""],
      ["Revenue category", d.rev_category?PC.label(d.rev_category):""],
      ["Potential client", d.client_name||""] ] } },
    { heading:"Parts", table:{ headers:["Part #","Part","Qty","Rate (excl GST)","Amount"],
      rows:(d.parts||[]).map(p=>[ p._partNo||"", p.part||"", num(p.qty), money(num(p.rate_excl)), money(num(p.qty)*num(p.rate_excl)) ]) } },
    { heading:"Costing", note:"Total cost = base part cost + overheads + profit.",
      table:{ headers:["Component","Amount (₹)"], rows:[
      ["Base part cost (excl GST)", money(c.bomExcl)],
      ["Overheads ("+num(d.overhead_pct)+"%)", money(c.ovh)],
      ["Profit ("+num(d.profit_pct)+"%)", money(c.profit)],
      ["Total cost (excl GST)", money(c.sellingExcl)],
      ["Total cost (incl GST)", money(c.sellingIncl)] ] } },
  ];
}
const bomReportSections=()=>bomSections(design);
function bomDocTitle(d){ return (d.part_no?("BOM "+d.part_no+" — "):"BOM — ")+(d.name||"Assembly"); }
// expose a row-based preview for the approval module
window.OPS.bom = {
  previewRow(row){ window.OPS.previewDoc({ title:bomDocTitle(row),
    getDocx:()=>window.OPS.docgen.generateReport({ title:bomDocTitle(row), sections:bomSections(row) },{asBlob:true}) }); }
};

// Transfer the finished assembly to the Spares catalogue as a sellable product,
// carrying its number, revenue category and the BOM's total cost as the rate.
async function transferToCatalogue(){
  if(!design.id){ alert("Save the BOM first."); return; }
  const pn=($("bPartNo").value.trim()||design.part_no||"").trim();
  if(!pn){ alert("Set a product part number first."); return; }
  if(!design.name){ alert("Give the product a name first."); return; }
  const c=compute(design);
  const rec={ name:design.name, part_no:pn, product_category:design.name,
    rev_category:design.rev_category||null, hsn_code:null, unit:"unit", gst_rate:18,
    rate_excl_gst:Math.round(c.sellingExcl*100)/100, base_cost:Math.round(c.sellingExcl*100)/100,
    cost_base:Math.round(c.bomExcl*100)/100, cost_shipping:0, active:true,
    description:"Assembly — built via BOM calculator ("+(design.name||"")+")" };
  const { data:ex }=await sb().from("spare_catalogue").select("id").eq("part_no",pn).maybeSingle();
  if(ex){ if(!confirm("Part "+pn+" already exists in the Spares catalogue. Update it with this BOM's costing?")) return;
    const { error }=await sb().from("spare_catalogue").update(rec).eq("id",ex.id); if(error){ alert(error.message); return; } }
  else { if(!confirm("Add product "+pn+" — "+design.name+" to the Spares catalogue (rate = total cost "+money(c.sellingExcl)+")?")) return;
    const { error }=await sb().from("spare_catalogue").insert(rec); if(error){ alert(error.message); return; } }
  window.OPS.audit&&window.OPS.audit("bom_to_catalogue","spare_catalogue",pn,design.name||"");
  window.OPS.flashTop("Product saved to Catalogue ✓ ("+pn+")");
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
