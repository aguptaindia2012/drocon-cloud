/* ============================================================================
   DroCon Cloud — Service & Spare catalogues
   One tool with a Services | Spares toggle. Both are the line-item source for
   the billing documents. Spares also carry current stock (managed in Inventory).
   ============================================================================ */
(function(){
const { $, esc, money, num } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;

const CATS = {
  service: { table:"service_catalogue", label:"Services", rateKey:"default_rate", hsnKey:"hsn_sac",
    cols:[["name","Service"],["hsn_sac","HSN/SAC"],["unit","Unit"],["default_rate","Rate",true],["gst_rate","GST%",true]],
    fields:[
      {key:"name",label:"Service name",full:true,required:true},
      {key:"hsn_sac",label:"HSN/SAC"},
      {key:"unit",label:"Unit"},
      {key:"default_rate",label:"Default Rate (₹)",type:"number"},
      {key:"gst_rate",label:"GST %",type:"number"},
      {key:"description",label:"Description",type:"textarea",full:true},
    ] },
  spare: { table:"spare_catalogue", label:"Spares", rateKey:"rate_excl_gst", hsnKey:"hsn_code",
    cols:[["name","Spare"],["hsn_code","HSN"],["unit","Unit"],["rate_excl_gst","Rate excl.GST",true],["gst_rate","GST%",true],["current_stock","Stock",true]],
    fields:[
      {key:"name",label:"Spare name",full:true,required:true},
      {key:"hsn_code",label:"HSN Code"},
      {key:"unit",label:"Unit"},
      {key:"rate_excl_gst",label:"Rate excl. GST (₹)",type:"number"},
      {key:"gst_rate",label:"GST %",type:"number"},
      {key:"description",label:"Description",type:"textarea",full:true},
    ] },
};

let active="service";

async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Administration</div><h1>Service &amp; Spare Catalogues</h1>
    <div class="row" style="margin:10px 0">
      <button class="btn sm ${active==='service'?'green':''}" data-c="service">Services</button>
      <button class="btn sm ${active==='spare'?'green':''}" data-c="spare">Spares</button>
      <div class="spacer"></div>
      <input id="cSearch" placeholder="Search…" style="max-width:240px">
      <button class="btn green sm" id="cNew">+ New ${active==='service'?'service':'spare'}</button>
    </div>
    <div id="cList" class="muted">Loading…</div>`;
  m.querySelectorAll("[data-c]").forEach(b=>b.addEventListener("click",()=>{ active=b.getAttribute("data-c"); view(); }));
  $("cNew").addEventListener("click",()=>form(null));
  const cfg=CATS[active];
  const { data }=await sb().from(cfg.table).select("*").order("name");
  const all=data||[];
  function render(rows){
    $("cList").innerHTML = rows.length ? `<table><thead><tr>${cfg.cols.map(c=>`<th class="${c[2]?'num':''}">${esc(c[1])}</th>`).join("")}<th></th></tr></thead>
      <tbody>${rows.map(r=>`<tr class="clickable" data-id="${r.id}">${cfg.cols.map(c=>{
        let v=r[c[0]]; if(c[2]&&c[0]!=='gst_rate'&&c[0]!=='current_stock') v=(v==null?'—':money(v));
        else if(c[0]==='gst_rate') v=(v==null?'':v+'%'); else if(c[0]==='current_stock') v=(v==null?0:v);
        return `<td class="${c[2]?'num':''}">${esc(v==null?'':v)}</td>`; }).join("")}<td class="muted">edit ›</td></tr>`).join("")}</tbody></table>`
      : '<div class="card muted">No items yet.</div>';
    $("cList").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>form(all.find(x=>x.id===tr.getAttribute("data-id")))));
  }
  render(all);
  $("cSearch").addEventListener("input",e=>{ const q=e.target.value.toLowerCase().trim();
    render(!q?all:all.filter(r=>String(r.name||"").toLowerCase().includes(q)|| String(r[cfg.hsnKey]||"").toLowerCase().includes(q))); });
}

function form(rec){
  const cfg=CATS[active]; const e=rec||{};
  const m=$("main");
  m.innerHTML=`<button class="btn sm" id="cBack">← Back to ${esc(cfg.label)}</button>
    <div class="card" style="margin-top:12px">
      <h1>${rec?"Edit":"New"} ${active==='service'?'service':'spare'}</h1>
      ${rec&&active==='spare'?`<div class="callout">Current stock: <b>${num(rec.current_stock)}</b> ${esc(rec.unit||'')}. Adjust stock in the <b>Inventory</b> tool.</div>`:''}
      <div class="fgrid">${cfg.fields.map(f=>{
        const v=e[f.key]==null?"":e[f.key];
        const inner=f.type==="textarea"?`<textarea id="cf_${f.key}">${esc(v)}</textarea>`:`<input id="cf_${f.key}" type="${f.type==='number'?'number':'text'}" ${f.type==='number'?'step="any"':''} value="${esc(v)}">`;
        return `<div class="field ${f.full?'full':''}"><label>${esc(f.label)}${f.required?' *':''}</label>${inner}</div>`;
      }).join("")}</div>
      <div class="row"><button class="btn green" id="cSave">${rec?"Save":"Create"}</button>
        <button class="btn" id="cCancel">Cancel</button><div class="spacer"></div>
        ${rec && window.OPS.canDelete()?'<button class="btn sm" id="cDel" style="color:#a3322a;border-color:#e4b4b4">Delete</button>':''}</div>
      <div class="err" id="cErr"></div>
    </div>`;
  $("cBack").addEventListener("click",view); $("cCancel").addEventListener("click",view);
  $("cSave").addEventListener("click",async()=>{
    const out={};
    for(const f of cfg.fields){ let v=$("cf_"+f.key).value; if(f.type==="number") v=v===""?null:Number(v); out[f.key]=v===""?null:v;
      if(f.required&&!v){ $("cErr").textContent=f.label+" required."; return; } }
    if(rec){ const { error }=await sb().from(cfg.table).update(out).eq("id",rec.id); if(error){ $("cErr").textContent=error.message; return; } }
    else { const { error }=await sb().from(cfg.table).insert(out); if(error){ $("cErr").textContent=error.message; return; } }
    window.OPS.flashTop("Saved ✓"); view();
  });
  if($("cDel")) $("cDel").addEventListener("click",async()=>{ if(!confirm("Delete this item?"))return;
    const { error }=await sb().from(cfg.table).delete().eq("id",rec.id); if(error){ alert(error.message); return; } view(); });
}

window.OPS.routes.catalogues = view;
})();
