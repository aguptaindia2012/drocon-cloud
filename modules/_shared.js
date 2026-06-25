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
window.OPS.csv = { parseCSV, pickCSV, downloadCSV };

/* ---------- generic registry ---------- */
function makeRegistry(cfg){
  // cfg: { tool, table, title, eyebrow, fields[], listCols[], searchKeys[], orderBy }
  async function list(){
    const m=$("main");
    m.innerHTML=`<div class="eyebrow">${esc(cfg.eyebrow)}</div><h1>${esc(cfg.title)}</h1>
      <div class="row wrap" style="margin:10px 0">
        <input id="rqSearch" placeholder="Search ${esc(cfg.title.toLowerCase())}…" style="max-width:280px">
        <div class="spacer"></div>
        ${(cfg.extraActions||[]).map((a,i)=>`<button class="btn sm" data-extra="${i}">${esc(a.label)}</button>`).join("")}
        <button class="btn sm" id="rqImport">⬆ Import CSV</button>
        <button class="btn sm" id="rqExport">⬇ Export CSV</button>
        <button class="btn green sm" id="rqNew">+ New</button>
      </div>
      <div id="rqList" class="muted">Loading…</div>`;
    (cfg.extraActions||[]).forEach((a,i)=>{ const b=$("main").querySelector(`[data-extra="${i}"]`); if(b) b.addEventListener("click",a.fn); });
    let all=[];
    const { data, error } = await sb().from(cfg.table).select("*").order(cfg.orderBy||"created_at",{ascending:false});
    if(error){ $("rqList").innerHTML='<div class="card">Error: '+esc(error.message)+'</div>'; return; }
    all=data||[];
    function render(rows){
      $("rqList").innerHTML = rows.length ? `<table><thead><tr>${cfg.listCols.map(c=>`<th class="${c.num?'num':''}">${esc(c.label)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(r=>`<tr class="clickable" data-id="${r.id}">${cfg.listCols.map(c=>`<td class="${c.num?'num':''}">${c.fmt?c.fmt(r[c.key],r):esc(r[c.key]==null?"":r[c.key])}</td>`).join("")}</tr>`).join("")}</tbody></table>`
        : '<div class="card muted">No records yet.</div>';
      $("rqList").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>form(all.find(x=>x.id===tr.getAttribute("data-id")))));
    }
    render(all);
    $("rqSearch").addEventListener("input",e=>{
      const q=e.target.value.toLowerCase().trim();
      render(!q?all:all.filter(r=>(cfg.searchKeys||cfg.listCols.map(c=>c.key)).some(k=>String(r[k]||"").toLowerCase().includes(q))));
    });
    $("rqNew").addEventListener("click",()=>form(null));
    $("rqExport").addEventListener("click",()=>{
      downloadCSV(cfg.table+".csv", cfg.fields.map(f=>f.label), all.map(r=>cfg.fields.map(f=>r[f.key]==null?"":r[f.key])));
    });
    $("rqImport").addEventListener("click",()=>importCSV());
  }

  function form(rec){
    const e=rec||(cfg.defaults?Object.assign({},cfg.defaults):{});
    const m=$("main");
    m.innerHTML=`<button class="btn sm" id="rqBack">← Back to ${esc(cfg.title)}</button>
      <div class="card" style="margin-top:12px">
        <div class="eyebrow">${esc(cfg.eyebrow)}</div><h1>${rec?"Edit":"New "+cfg.title.replace(/s$/,"")}</h1>
        <div class="fgrid">${cfg.fields.map(f=>fieldHTML(f,e)).join("")}</div>
        <div class="row" style="margin-top:6px">
          <button class="btn green" id="rqSave">${rec?"Save changes":"Create"}</button>
          <button class="btn" id="rqCancel">Cancel</button>
          <div class="spacer"></div>
          ${rec?'<button class="btn sm" id="rqDel" style="color:#a3322a;border-color:#e4b4b4">Delete</button>':''}
        </div>
        <div class="err" id="rqErr"></div>
      </div>
      <div id="rqApproval"></div>`;
    if(cfg.approvable && rec && window.OPS.approvals){ window.OPS.approvals.bar(cfg.table, rec, $("rqApproval"), ()=>{ sb().from(cfg.table).select("*").eq("id",rec.id).single().then(({data})=>form(data||rec)); }); }
    $("rqBack").addEventListener("click",list);
    $("rqCancel").addEventListener("click",list);
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

  function fieldHTML(f,e){
    const v=e[f.key]==null?"":e[f.key];
    const cls=f.full?"field full":"field";
    let inner;
    if(f.type==="select"){
      inner=`<select id="f_${f.key}">${(f.options||[]).map(o=>`<option value="${esc(o)}" ${String(v)===String(o)?'selected':''}>${esc(o)}</option>`).join("")}</select>`;
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
