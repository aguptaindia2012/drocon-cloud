/* ============================================================================
   DroCon Cloud — shared module utilities
   - CSV parse/build + file pickers
   - makeRegistry(cfg): a generic searchable list + create/edit/delete + CSV
     import view used by Clients, Vendors and (later) the pools.
   ============================================================================ */
(function(){
const { $, esc, fmt, money } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;

/* ---------- CSV ---------- */
function parseCSV(text){
  const rows=[]; let row=[], field="", i=0, inQ=false;
  text = text.replace(/\r\n/g,"\n").replace(/\r/g,"\n");
  while(i<text.length){
    const c=text[i];
    if(inQ){
      if(c==='"'){ if(text[i+1]==='"'){ field+='"'; i+=2; continue; } inQ=false; i++; continue; }
      field+=c; i++; continue;
    }
    if(c==='"'){ inQ=true; i++; continue; }
    if(c===','){ row.push(field); field=""; i++; continue; }
    if(c==='\n'){ row.push(field); rows.push(row); row=[]; field=""; i++; continue; }
    field+=c; i++;
  }
  if(field.length||row.length){ row.push(field); rows.push(row); }
  // header objects
  if(!rows.length) return [];
  const head=rows[0].map(h=>h.trim());
  return rows.slice(1).filter(r=>r.some(c=>c.trim()!=="")).map(r=>{
    const o={}; head.forEach((h,idx)=>o[h]=(r[idx]!=null?r[idx].trim():"")); return o;
  });
}
function pickCSV(cb){
  const inp=$("csvImport");
  inp.onchange=ev=>{ const f=ev.target.files[0]; if(!f)return; const r=new FileReader();
    r.onload=()=>{ try{ cb(parseCSV(r.result)); }catch(e){ alert("Could not read CSV: "+e.message); } };
    r.readAsText(f); inp.value=""; };
  inp.click();
}
function downloadCSV(filename, headers, rows){
  const q=v=>{ v=(v==null?"":String(v)); return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };
  const csv=[headers.map(q).join(",")].concat(rows.map(r=>r.map(q).join(","))).join("\n");
  window.OPS.saveBlob(new Blob([csv],{type:"text/csv"}), filename, "text/csv", ".csv");
}
// Real .xlsx via SheetJS (falls back to CSV if the library didn't load).
// headers: string[]; rows: array of arrays (cells can be strings or numbers).
function downloadExcel(filename, sheetName, headers, rows){
  if(typeof XLSX==="undefined"){
    window.OPS.csv.downloadCSV(filename.replace(/\.xlsx$/i,".csv"), headers, rows);
    return;
  }
  const aoa=[headers].concat(rows);
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"]=headers.map((h,i)=>{ let w=String(h).length;
    rows.forEach(r=>{ const c=r[i]==null?"":String(r[i]); if(c.length>w) w=c.length; });
    return { wch: Math.min(Math.max(w+2,8), 40) }; });
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (sheetName||"Sheet1").slice(0,31));
  const out=XLSX.write(wb,{ bookType:"xlsx", type:"array" });
  window.OPS.saveBlob(new Blob([out],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),
    filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx");
}
window.OPS.csv = { parseCSV, pickCSV, downloadCSV };
window.OPS.xlsx = { download: downloadExcel };

/* ---------- Profit categories — the ONE shared revenue+cost dimension --------
   Used for category-wise P&L: every invoice/quote carries a revenue category,
   every cost (supplier bill, expense claim, salary split, incentive) carries a
   cost category. Revenue + direct cost per category = category profit; the
   "overheads" pool (cost-only) is common/indivisible spend kept in the OVERALL
   profit but not attributed to any single category. Keep keys stable — they are
   stored on records. New categories go here and flow to every picker. */
window.OPS.profitCats = (function(){
  // revenue-eligible categories (also valid on the cost side)
  const REV = [
    ["spray","Agriculture Spraying"],
    ["demo","Demonstrations"],
    ["part","Part sales"],
    ["service","Servicing of drones & batteries"],
    ["dronesale","Drone Sales"],
    ["other","Other / uncategorised"],
  ];
  // cost side = the same list + cost-only categories (no revenue of their own,
  // kept in the OVERALL profit but not attributed to any sales line):
  //   Overheads = common/indivisible spend · R&D = research spend, not for sale
  const COST_ONLY = [["overheads","Overheads (common)"],["rnd","Research & Development"]];
  const COST = REV.concat(COST_ONLY);
  const LABEL = Object.fromEntries(COST);
  const n = (v)=>{ const x=parseFloat(v); return isNaN(x)?0:x; };
  // Classify ONE invoice line to a revenue category by description + HSN/SAC.
  // Whole-drone sales (explicit model/unit terms) → dronesale; spares → part.
  // Keep in step with receivables.js (both call this).
  function classifyLine(desc, sub, hsn){
    const d=((desc||"")+" "+(sub||"")).toLowerCase(); const h=String(hsn||"").replace(/\s/g,"");
    if(/demo/.test(d)) return "demo";
    if(/servic|repair|mainten|overhaul|\bmro\b|\bamc\b|refurb/.test(d) || /^9987/.test(h)) return "service";
    if(/spray|aerial|agri/.test(d) || /^9986/.test(h)) return "spray";
    if(/\bagras\b|\bt\d{2}p?\b|\bmg-?1\b|\buav\b|multirotor|quadcopter|agri[- ]?drone|drone\s*(unit|kit|set|package|system|combo)|complete\s*drone|full\s*drone|\baircraft\b/.test(d)) return "dronesale";
    if(/part|spare|batter|propeller|\bmotor\b|nozzle|\bpump\b|blade|\besc\b|frame|charger|drone|kit|\barm\b/.test(d) || /^(8806|8807|8508|8507|8479|8413)/.test(h)) return "part";
    return "other";
  }
  // Whole-invoice revenue category: a manual override (data.rev_category) wins;
  // else the category of the highest-value line. One invoice → one category.
  function classifyInvoice(doc){
    const ov=(doc && doc.data || {}).rev_category;
    if(ov && Object.prototype.hasOwnProperty.call(LABEL, ov)) return ov;
    const items=(doc && doc.line_items) || []; if(!items.length) return "other";
    const tally={}; items.forEach(it=>{ const base=Math.max(0,(n(it.qty))*(n(it.rate))*(1-(n(it.disc))/100));
      const c=classifyLine(it.desc,it.sub,it.hsn); tally[c]=(tally[c]||0)+base+0.0001; });
    let best="other",bv=-1; Object.keys(tally).forEach(c=>{ if(tally[c]>bv){bv=tally[c];best=c;} }); return best;
  }
  return {
    revenue: REV,
    cost: COST,
    costOnly: COST_ONLY,          // cost-only categories (Overheads, R&D)
    label: (k)=> LABEL[k] || k,
    isValid: (k)=> Object.prototype.hasOwnProperty.call(LABEL, k),
    classifyLine, classifyInvoice,
    // <option> string for a <select>; pass 'cost' to include Overheads
    options(selected, which){ const list = which==="cost" ? COST : REV;
      return list.map(([k,l])=>`<option value="${k}"${selected===k?' selected':''}>${l}</option>`).join(""); },
  };
})();

/* ---------- inline editable profit-category cell (for cost lists) -------------
   Drop `window.OPS.profitCatCell(table,id,current)` into a list cell, then call
   `window.OPS.wireProfitCatCells(rootEl, onSaved)` after rendering. On change it
   writes `cost_category` straight to that row (blank = Overheads). Clicks are
   stopped so an editable cell inside a clickable row doesn't open the record. */
window.OPS.profitCatCell = function(table, id, current){
  const blank = `<option value="">— not set —</option>`;
  return `<select class="pcCell" data-pc-table="${esc(table)}" data-pc-id="${esc(id)}" style="max-width:160px">${blank}${window.OPS.profitCats.options(current,'cost')}</select>`;
};
/* ---------- small dropdown menu button (returns a DOM node) ------------------
   window.OPS.menuButton("Download", [{label:"Word (.docx)",fn},{label:"PDF",fn}])
   Appends a "Download ▾" button that opens a click-menu. Items' fn may be async;
   errors surface via a flash. Used for the Word/PDF download & email choices. */
window.OPS.menuButton = function(label, items, opts){
  opts=opts||{};
  const wrap=document.createElement("span"); wrap.style.cssText="position:relative;display:inline-block";
  const btn=document.createElement("button"); btn.type="button"; btn.className=opts.className||"btn blue sm"; btn.textContent=label+" ▾";
  const menu=document.createElement("div");
  menu.style.cssText="position:absolute;top:calc(100% + 2px);left:0;z-index:70;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.14);min-width:170px;display:none;padding:4px";
  (items||[]).forEach(it=>{ const b=document.createElement("button"); b.type="button"; b.className="btn sm";
    b.style.cssText="display:block;width:100%;text-align:left;border:none;background:none;padding:7px 10px;border-radius:6px";
    b.textContent=it.label;
    b.addEventListener("mouseenter",()=>b.style.background="#f2f5ef"); b.addEventListener("mouseleave",()=>b.style.background="none");
    b.addEventListener("click",async(e)=>{ e.stopPropagation(); menu.style.display="none";
      try{ await it.fn(); }catch(err){ window.OPS.flashTop && window.OPS.flashTop("Failed: "+(err&&err.message||err)); } });
    menu.appendChild(b); });
  btn.addEventListener("click",e=>{ e.stopPropagation();
    const isOpen=menu.style.display==="block";
    document.querySelectorAll(".dcb-menu").forEach(m=>m.style.display="none");
    menu.style.display=isOpen?"none":"block"; });
  menu.className="dcb-menu";
  document.addEventListener("click",()=>{ menu.style.display="none"; });
  wrap.appendChild(btn); wrap.appendChild(menu);
  return wrap;
};

/* ---------- in-app document Preview (see exactly what will download) ----------
   window.OPS.previewDoc({ title, getDocx, email })
     getDocx: async () => ({blob, filename, mime})   // the .docx (built on demand)
     email  : { to, who, subject }                   // optional → shows Email menu
   Renders the .docx as a PDF (via window.OPS.docxToPdf — true fidelity) inside a
   modal, with Download (Word/PDF) and Email (Word/PDF) actions. The docx & pdf
   are built once and reused across the buttons. */
window.OPS.previewDoc = async function(opts){
  opts=opts||{};
  const ov=document.createElement("div");
  ov.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:80;display:flex;align-items:center;justify-content:center;padding:16px";
  ov.innerHTML=`<div class="card" style="width:min(920px,97vw);height:92vh;display:flex;flex-direction:column;padding:12px">
    <div class="row" style="align-items:center;margin-bottom:8px">
      <h3 style="margin:0">${esc(opts.title||"Preview")}</h3>
      <div class="spacer"></div>
      <span id="pvActions" style="display:flex;gap:6px;align-items:center"></span>
      <button class="btn sm" id="pvClose" style="margin-left:8px">✕ Close</button>
    </div>
    <div id="pvFrame" style="flex:1;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#f4f5f2;display:flex;align-items:center;justify-content:center">
      <div class="muted" id="pvLoad">Rendering preview…</div>
    </div></div>`;
  document.body.appendChild(ov);
  let _url=null;
  const close=()=>{ try{ if(_url) URL.revokeObjectURL(_url); }catch(e){} ov.remove(); };
  ov.addEventListener("click",e=>{ if(e.target===ov) close(); });
  $("pvClose").addEventListener("click",close);
  let _docx=null,_pdf=null;
  const getDocx=async()=>{ if(!_docx) _docx=await opts.getDocx(); return _docx; };
  const getPdf=async()=>{ if(!_pdf){ const d=await getDocx(); _pdf={ blob:await window.OPS.docxToPdf(d.blob), filename:(d.filename||"document.docx").replace(/\.docx$/i,".pdf"), mime:"application/pdf" }; } return _pdf; };
  const body=()=>"Dear "+((opts.email&&opts.email.who)||"Sir/Madam")+",\n\nPlease find the attached document.\n\nWarm regards,";
  // render the PDF preview
  try{
    const p=await getPdf(); _url=URL.createObjectURL(p.blob);
    $("pvFrame").innerHTML=`<iframe src="${_url}#toolbar=1" title="preview" style="width:100%;height:100%;border:0"></iframe>`;
  }catch(e){
    $("pvFrame").innerHTML=`<div class="muted" style="padding:20px;text-align:center">Couldn't render the PDF preview — ${esc(String(e&&e.message||e))}.<br>You can still download the Word file below.</div>`;
  }
  // action menus (reuse the built docx/pdf)
  const act=$("pvActions");
  act.appendChild(window.OPS.menuButton("⬇ Download", [
    { label:"Word (.docx)", fn:async()=>{ const d=await getDocx(); window.OPS.saveBlob(d.blob,d.filename,d.mime,".docx"); } },
    { label:"PDF", fn:async()=>{ window.OPS.flashTop&&window.OPS.flashTop("Making PDF…"); const p=await getPdf(); window.OPS.saveBlob(p.blob,p.filename,p.mime,".pdf"); } },
  ], {className:"btn blue sm"}));
  if(opts.email && window.OPS.mailComposeWithBlob){
    act.appendChild(window.OPS.menuButton("📧 Email", [
      { label:"Email as Word", fn:async()=>{ const d=await getDocx(); close(); await window.OPS.mailComposeWithBlob({ to:opts.email.to, subject:opts.email.subject, body:body(), blob:d.blob, filename:d.filename, mime:d.mime }); } },
      { label:"Email as PDF", fn:async()=>{ const p=await getPdf(); close(); await window.OPS.mailComposeWithBlob({ to:opts.email.to, subject:opts.email.subject, body:body(), blob:p.blob, filename:p.filename, mime:p.mime }); } },
    ], {className:"btn green sm"}));
  }
};

window.OPS.wireProfitCatCells = function(root, onSaved){
  (root||document).querySelectorAll("select.pcCell").forEach(sel=>{
    sel.addEventListener("click", e=>e.stopPropagation());
    sel.addEventListener("change", async (e)=>{
      e.stopPropagation();
      const table=sel.getAttribute("data-pc-table"), id=sel.getAttribute("data-pc-id"), val=sel.value||null;
      sel.disabled=true;
      const { error }=await window.OPS.sb.from(table).update({ cost_category: val }).eq("id", id);
      sel.disabled=false;
      if(error){ window.OPS.flashTop && window.OPS.flashTop("Save failed: "+error.message); return; }
      window.OPS.audit && window.OPS.audit("edited", table, id, "profit category → "+(val||"overheads"));
      window.OPS.flashTop && window.OPS.flashTop("Category saved ✓");
      if(onSaved) onSaved();
    });
  });
};

/* ---------- reusable State/District dropdowns (for custom forms) ---------- */
window.OPS.geoUI = {
  states(){ return Object.keys(window.OPS.GEO||{}).sort(); },
  districts(st){ return (window.OPS.GEO&&window.OPS.GEO[st])||[]; },
  stateSelect(id,val){ val=val||""; const o=this.states();
    return `<select id="${id}"><option value="">— select state —</option>`+o.map(s=>`<option ${val===s?'selected':''}>${esc(s)}</option>`).join("")+(val&&!o.includes(val)?`<option selected>${esc(val)}</option>`:'')+`</select>`; },
  districtSelect(id,val,st){ val=val||""; const o=this.districts(st);
    return `<select id="${id}"><option value="">— select district —</option>`+o.map(d=>`<option ${val===d?'selected':''}>${esc(d)}</option>`).join("")+(val&&!o.includes(val)?`<option selected>${esc(val)}</option>`:'')+`</select>`; },
  wire(stateId,distId){ const s=$(stateId), d=$(distId); if(!s||!d) return;
    s.addEventListener("change",()=>{ const opts=this.districts(s.value);
      d.innerHTML='<option value="">— select district —</option>'+opts.map(x=>`<option>${esc(x)}</option>`).join(""); }); }
};

/* ---------- generic registry ---------- */
function makeRegistry(cfg){
  // cfg: { tool, table, title, eyebrow, fields[], listCols[], searchKeys[], orderBy }
  async function list(){
    const m=$("main");
    // handoff: another registry asked to pre-fill a NEW record here (e.g. Client→Vendor)
    const seed=window.OPS._registrySeed&&window.OPS._registrySeed[cfg.tool];
    if(seed){ delete window.OPS._registrySeed[cfg.tool]; return form(null, seed); }
    m.innerHTML=`<div class="eyebrow">${esc(cfg.eyebrow)}</div><h1>${esc(cfg.title)}</h1>
      <div class="row wrap" style="margin:10px 0">
        <input id="rqSearch" placeholder="Search ${esc(cfg.title.toLowerCase())}…" style="max-width:280px">
        <div class="spacer"></div>
        ${(cfg.extraActions||[]).map((a,i)=>`<button class="btn sm" data-extra="${i}">${esc(a.label)}</button>`).join("")}
        <button class="btn sm" id="rqImport">⬆ Import CSV</button>
        ${window.OPS.canExport()?'<button class="btn sm" id="rqExport">⬇ Export CSV</button>':''}
        ${window.OPS.isAdmin()?'<button class="btn sm" id="rqClear" style="color:#a3322a;border-color:#e4b4b4">Clear all</button>':''}
        <button class="btn green sm" id="rqNew">+ New</button>
      </div>
      <div id="rqFilters" class="row wrap" style="gap:8px;margin:0 0 8px"></div>
      <div id="rqSummary"></div>
      <div id="rqList" class="muted">Loading…</div>`;
    (cfg.extraActions||[]).forEach((a,i)=>{ const b=$("main").querySelector(`[data-extra="${i}"]`); if(b) b.addEventListener("click",a.fn); });
    let all=[];
    let lq=sb().from(cfg.table).select("*").order(cfg.orderBy||"created_at",{ascending:false});
    if(cfg.filter) lq=lq.eq(cfg.filter.col, cfg.filter.val);
    const { data, error } = await lq;
    if(error){ $("rqList").innerHTML='<div class="card">Error: '+esc(error.message)+'</div>'; return; }
    all=data||[];
    if(cfg.summary && $("rqSummary")){ try{ $("rqSummary").innerHTML=cfg.summary(all); }catch(e){} }
    // ---- filter bar: Active/Inactive (via cfg.activeField) + any cfg.filters ----
    const af = cfg.activeField;
    const filterDefs = [];
    if(af) filterDefs.push({ key:af.key, label:"Status",
      options:[[String(af.activeVal), af.activeLabel||"Active"],[String(af.inactiveVal), af.inactiveLabel||"Inactive"]],
      def:String(af.activeVal) });
    (cfg.filters||[]).forEach(f=>filterDefs.push(Object.assign({},f)));
    for(const f of filterDefs){
      if(!f.options){ const seen=new Set(); f.options=[]; all.forEach(r=>{ const v=r[f.key];
        if(v!=null&&v!==""&&!seen.has(String(v))){ seen.add(String(v)); f.options.push([String(v),String(v)]); } });
        f.options.sort((a,b)=>a[1].localeCompare(b[1])); }
      else if(typeof f.options==="function"){ try{ f.options=await f.options(all)||[]; }catch(e){ f.options=[]; } }
    }
    if($("rqFilters")) $("rqFilters").innerHTML = filterDefs.map((f,i)=>`<select data-fi="${i}" style="width:auto"><option value="">All ${esc(f.label)}</option>${f.options.map(o=>`<option value="${esc(o[0])}"${(f.def!=null&&String(f.def)===String(o[0]))?' selected':''}>${esc(o[1])}</option>`).join("")}</select>`).join("");
    function statusCell(r){ const isA=String(r[af.key])===String(af.activeVal);
      return `<td>${isA?'<span class="chip approved">'+esc(af.activeLabel||'Active')+'</span>':'<span class="chip draft">'+esc(af.inactiveLabel||'Inactive')+'</span>'} <button class="btn sm" data-tog="${r.id}">${isA?'Deactivate':'Activate'}</button></td>`; }
    async function toggleActive(r){ if(!r) return;
      const isA=String(r[af.key])===String(af.activeVal), to=isA?af.inactiveVal:af.activeVal, verb=isA?"Deactivate":"Activate";
      if(!confirm(verb+' "'+(r[cfg.listCols[0].key]||"")+'"?')) return;
      const patch={}; patch[af.key]=to;
      const { error }=await sb().from(cfg.table).update(patch).eq("id",r.id);
      if(error){ alert(error.message); return; }
      window.OPS.audit(isA?"deactivated":"activated",cfg.table,r.id,String(r[cfg.listCols[0].key]||""));
      window.OPS.flashTop(verb+"d ✓"); list();
    }
    function render(rows){
      $("rqList").innerHTML = rows.length ? `<table><thead><tr>${cfg.listCols.map(c=>`<th class="${c.num?'num':''}">${esc(c.label)}</th>`).join("")}${af?'<th>Status</th>':''}</tr></thead>
        <tbody>${rows.map(r=>`<tr class="clickable" data-id="${r.id}">${cfg.listCols.map(c=>`<td class="${c.num?'num':''}">${c.fmt?c.fmt(r[c.key],r):(c.mask?esc(window.OPS.helpers.maskPhone(r[c.key])):esc(r[c.key]==null?"":r[c.key]))}</td>`).join("")}${af?statusCell(r):''}</tr>`).join("")}</tbody></table>`
        : '<div class="card muted">No records match.</div>';
      $("rqList").querySelectorAll("tr[data-id]").forEach(tr=>tr.addEventListener("click",e=>{ if(e.target.closest("button")) return; form(all.find(x=>String(x.id)===tr.getAttribute("data-id"))); }));
      if(af) $("rqList").querySelectorAll("[data-tog]").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); toggleActive(all.find(x=>String(x.id)===b.getAttribute("data-tog"))); }));
    }
    function applyFilters(){
      const q=($("rqSearch").value||"").toLowerCase().trim();
      const sels=filterDefs.map((f,i)=>({k:f.key, v:((($("rqFilters")&&$("rqFilters").querySelector('[data-fi="'+i+'"]'))||{}).value)||""}));
      let rows=all.filter(r=> sels.every(s=> s.v==="" || String(r[s.k]==null?"":r[s.k])===s.v));
      if(q) rows=rows.filter(r=>(cfg.searchKeys||cfg.listCols.map(c=>c.key)).some(k=>String(r[k]||"").toLowerCase().includes(q)));
      render(rows);
    }
    applyFilters();
    $("rqSearch").addEventListener("input",applyFilters);
    if($("rqFilters")) $("rqFilters").querySelectorAll("[data-fi]").forEach(s=>s.addEventListener("change",applyFilters));
    $("rqNew").addEventListener("click",()=>form(null));
    if($("rqExport")) $("rqExport").addEventListener("click",()=>{
      downloadCSV(cfg.table+".csv", cfg.fields.map(f=>f.label), all.map(r=>cfg.fields.map(f=>r[f.key]==null?"":r[f.key])));
    });
    if($("rqClear")) $("rqClear").addEventListener("click",async()=>{
      if(!all.length){ alert("Nothing to clear."); return; }
      if(!confirm("Delete ALL "+all.length+" "+cfg.title+" records? This is logged in the Audit log and cannot be undone.")) return;
      if(!confirm("Final confirm — clear the entire "+cfg.title+" table?")) return;
      const { error }=await sb().from(cfg.table).delete().neq("id","00000000-0000-0000-0000-000000000000");
      if(error){ alert(error.message); return; }
      window.OPS.audit("cleared", cfg.table, "all", all.length+" records cleared");
      window.OPS.flashTop("Cleared "+cfg.title); list();
    });
    $("rqImport").addEventListener("click",()=>importCSV());
  }

  function form(rec, seed){
    const e=rec||seed||(cfg.defaults?Object.assign({},cfg.defaults):{});
    const m=$("main");
    m.innerHTML=`<button class="btn sm" id="rqBack">← Back to ${esc(cfg.title)}</button>
      <div class="card" style="margin-top:12px">
        <div class="eyebrow">${esc(cfg.eyebrow)}</div><h1>${rec?"Edit":"New "+cfg.title.replace(/s$/,"")}</h1>
        ${(!rec&&seed)?'<div class="callout">Pre-filled from another record — review the details and <b>Create</b> to save it here. The original is not changed.</div>':''}
        <div class="fgrid">${cfg.fields.map(f=>fieldHTML(f,e)).join("")}</div>
        <div class="row" style="margin-top:6px">
          <button class="btn green" id="rqSave">${rec?"Save changes":"Create"}</button>
          <button class="btn" id="rqCancel">Cancel</button>
          <div class="spacer"></div>
          ${(cfg.convertTo&&rec)?`<button class="btn sm" id="rqConvert" title="Create a matching record in the other register">${esc(cfg.convertTo.label||("→ "+cfg.convertTo.tool))}</button> `:''}
          ${rec && window.OPS.canDelete()?'<button class="btn sm" id="rqDel" style="color:#a3322a;border-color:#e4b4b4">Delete</button>':''}
        </div>
        <div class="err" id="rqErr"></div>
      </div>
      <div id="rqApproval"></div>`;
    // auto-populate the next number in the series for a NEW record (still editable)
    if(!rec && cfg.autoNumber){
      const el=$("f_"+cfg.autoNumber.field);
      if(el && !el.value){
        el.placeholder="fetching next number…";
        sb().rpc(cfg.autoNumber.rpc, cfg.autoNumber.args||{}).then(({data,error})=>{
          if(!error && data && !el.value){ el.value=data; el.title="Next available — edit if you need a different number"; }
          el.placeholder="";
        }).catch(()=>{ el.placeholder=""; });
      }
    }
    // optional per-record extra panel (e.g. account access on Employees)
    if(cfg.formExtra && rec){ const ex=document.createElement("div"); ex.id="rqExtra"; $("rqApproval").before(ex); try{ cfg.formExtra(rec, ex); }catch(e){ console.error(e); } }
    if(cfg.approvable && rec && window.OPS.approvals){ window.OPS.approvals.bar(cfg.table, rec, $("rqApproval"), ()=>{ sb().from(cfg.table).select("*").eq("id",rec.id).single().then(({data})=>form(data||rec)); }); }
    if(cfg.logView && rec && window.OPS.access){ window.OPS.access.log(cfg.table, rec.id, rec[cfg.fields[0].key]||""); }
    // dependent State -> District dropdowns
    $("main").querySelectorAll('select[data-depends]').forEach(dsel=>{
      const ssel=$("f_"+dsel.getAttribute("data-depends"));
      if(ssel) ssel.addEventListener("change",()=>{ const ds=(window.OPS.GEO&&window.OPS.GEO[ssel.value])||[];
        dsel.innerHTML='<option value="">— select district —</option>'+ds.map(o=>`<option>${esc(o)}</option>`).join(""); });
    });
    $("rqBack").addEventListener("click",list);
    $("rqCancel").addEventListener("click",list);
    if($("rqConvert")) $("rqConvert").addEventListener("click",()=>{
      const cur={}; cfg.fields.forEach(f=>{ const el=$("f_"+f.key); cur[f.key]= el?el.value:(rec?rec[f.key]:""); });
      window.OPS._registrySeed=window.OPS._registrySeed||{};
      window.OPS._registrySeed[cfg.convertTo.tool]=cfg.convertTo.map(cur);
      window.OPS.openTool(cfg.convertTo.tool);
    });
    $("rqSave").addEventListener("click",async()=>{
      const out={};
      for(const f of cfg.fields){
        let v=$("f_"+f.key).value;
        if(f.type==="number") v = v===""?null:Number(v);
        out[f.key]=v===""?null:v;
        if(f.required && (v===null||v==="")){ $("rqErr").textContent=f.label+" is required."; return; }
      }
      if(rec){
        const { error }=await sb().from(cfg.table).update(out).eq("id",rec.id);
        if(error){ $("rqErr").textContent=error.message; return; }
        window.OPS.audit("edited",cfg.table,rec.id,out[cfg.fields[0].key]); window.OPS.flashTop("Saved ✓"); list();
      }else{
        out.created_by=window.OPS.me.id;
        if(cfg.filter) out[cfg.filter.col]=cfg.filter.val;
        const { data:ins, error }=await sb().from(cfg.table).insert(out).select().single();
        if(error){ $("rqErr").textContent=error.message; return; }
        window.OPS.audit("created",cfg.table,ins.id,out[cfg.fields[0].key]); window.OPS.flashTop("Created ✓"); list();
      }
    });
    if($("rqDel")) $("rqDel").addEventListener("click",async()=>{
      if(!confirm("Delete this record?")) return;
      const { error }=await sb().from(cfg.table).delete().eq("id",rec.id);
      if(error){ alert(error.message); return; }
      window.OPS.audit("deleted",cfg.table,rec.id,""); list();
    });
  }

  function geoStates(){ return Object.keys(window.OPS.GEO||{}).sort(); }
  function geoDistricts(st){ return (window.OPS.GEO&&window.OPS.GEO[st])||[]; }
  function fieldHTML(f,e){
    const v=e[f.key]==null?"":e[f.key];
    const cls=f.full?"field full":"field";
    let inner;
    if(f.type==="select"){
      inner=`<select id="f_${f.key}">${(f.options||[]).map(o=>`<option value="${esc(o)}" ${String(v)===String(o)?'selected':''}>${esc(o)}</option>`).join("")}</select>`;
    } else if(f.type==="state"){
      inner=`<select id="f_${f.key}"><option value="">— select state —</option>${geoStates().map(o=>`<option ${String(v)===o?'selected':''}>${esc(o)}</option>`).join("")}${v && !geoStates().includes(v)?`<option selected>${esc(v)}</option>`:''}</select>`;
    } else if(f.type==="district"){
      const ds=geoDistricts(e[f.dependsOn]||"");
      inner=`<select id="f_${f.key}" data-depends="${esc(f.dependsOn)}"><option value="">— select district —</option>${ds.map(o=>`<option ${String(v)===o?'selected':''}>${esc(o)}</option>`).join("")}${v && !ds.includes(v)?`<option selected>${esc(v)}</option>`:''}</select>`;
    } else if(f.type==="textarea"){
      inner=`<textarea id="f_${f.key}">${esc(v)}</textarea>`;
    } else {
      const itype = f.type==="number"?"number":f.type==="date"?"date":"text";
      inner=`<input id="f_${f.key}" type="${itype}" value="${esc(v)}" ${f.type==="number"?'step="any"':''}>`;
    }
    return `<div class="${cls}"><label>${esc(f.label)}${f.required?' *':''}</label>${inner}</div>`;
  }

  function importCSV(){
    pickCSV(async rows=>{
      if(!rows.length){ alert("No rows found."); return; }
      // map by field label (case-insensitive) or key
      const headerOf={}; cfg.fields.forEach(f=>{ headerOf[f.label.toLowerCase()]=f.key; headerOf[f.key.toLowerCase()]=f.key; });
      const recs=rows.map(r=>{
        const o={created_by:window.OPS.me.id};
        if(cfg.filter) o[cfg.filter.col]=cfg.filter.val;
        Object.keys(r).forEach(h=>{ const k=headerOf[h.toLowerCase().trim()]; if(k){ const f=cfg.fields.find(x=>x.key===k);
          let val=r[h]; if(f&&f.type==="number") val=val===""?null:Number(val.replace(/[₹,]/g,"")); o[k]=val===""?null:val; } });
        return o;
      }).filter(o=>o[cfg.fields[0].key]);
      if(!confirm("Import "+recs.length+" record(s) into "+cfg.title+"?")) return;
      const { error }=await sb().from(cfg.table).insert(recs);
      if(error){ alert("Import failed: "+error.message); return; }
      window.OPS.flashTop("Imported "+recs.length+" ✓"); list();
    });
  }

  return list;
}
window.OPS.makeRegistry = makeRegistry;
})();
