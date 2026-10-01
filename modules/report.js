/* ============================================================================
   DroCon Cloud — dashboard charts + Word report helper
   OPS.report.bar/line/pie(canvasId, ...) draws a Chart.js chart (no animation,
   fixed size) and is also captured as an image for the Word report.
   OPS.report.wordButton(hostId, title, sectionsFn) adds a "Download Word report"
   button; sectionsFn() returns the report sections (with chart images + tables).
   ============================================================================ */
(function(){
const DCB_COLORS=["#599533","#F48A1C","#0A6496","#a3322a","#9a5b00","#5b3da8","#3e6b20","#0a6496"];
const charts={};
function mk(id,type,data,opts){
  const cv=document.getElementById(id); if(!cv || typeof Chart==="undefined") return null;
  if(charts[id]){ try{charts[id].destroy();}catch(e){} }
  charts[id]=new Chart(cv.getContext("2d"),{ type, data,
    options:Object.assign({ animation:false, responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:(type==="pie"||type==="doughnut") } } }, opts||{}) });
  return charts[id];
}
function bar(id,labels,values,label,color){ return mk(id,"bar",{labels,datasets:[{label:label||"",data:values,backgroundColor:color||"#599533"}]},{scales:{y:{beginAtZero:true}}}); }
function line(id,labels,values,label,color){ return mk(id,"line",{labels,datasets:[{label:label||"",data:values,borderColor:color||"#0A6496",backgroundColor:"rgba(10,100,150,.15)",fill:true,tension:.3}]},{scales:{y:{beginAtZero:true}}}); }
function pie(id,labels,values){ return mk(id,"doughnut",{labels,datasets:[{data:values,backgroundColor:DCB_COLORS}]}); }
// multi-series line chart with a clickable legend (toggle lines).
// series:[{label,data,color,hidden,dash}]
function lines(id,labels,series){ return mk(id,"line",{labels,datasets:(series||[]).map((s,i)=>({
    label:s.label||"", data:s.data, borderColor:s.color||DCB_COLORS[i%DCB_COLORS.length],
    backgroundColor:"transparent", fill:false, tension:.3, pointRadius:2,
    hidden:!!s.hidden, borderDash:s.dash?[6,4]:undefined }))},
  {scales:{y:{beginAtZero:true}},plugins:{legend:{display:true,position:"bottom",labels:{boxWidth:12,font:{size:11}}}}}); }
function img(id){ const cv=document.getElementById(id); try{ return cv?cv.toDataURL("image/png"):null; }catch(e){ return null; } }
// responsive chart holder — fills the card width, fixed height. The wrapper's
// defined height lets Chart.js (responsive, maintainAspectRatio:false) size the
// canvas to the full available width.
function canvas(id,w,h){ return `<div style="position:relative;width:100%;height:${(h||260)}px"><canvas id="${id}"></canvas></div>`; }
function wordButton(hostId, title, sectionsFn){
  const h=document.getElementById(hostId); if(!h) return;
  const b=document.createElement("button"); b.className="btn blue sm"; b.textContent="⬇ Download Word report";
  b.addEventListener("click",()=>{ try{ window.OPS.docgen.generateReport({ title, sections:sectionsFn() }); }catch(e){ alert("Report error: "+e.message); } });
  h.appendChild(b);
}
/* ---------------------------------------------------------------------------
   Reusable consolidated panel: ONE card, a row of buttons, one content area.
   Collapses several sections into a single toggle view (like Acre Tracking),
   so dashboards don't need endless scrolling. Remembers the last view per key.
     views: [{ key, label, render(contentEl) }]   render may be async
     opts : { title, key, active, actions:[{label,fn}] }
   Returns { show(key) }.
--------------------------------------------------------------------------- */
function panel(hostId, views, opts){
  opts=opts||{}; const esc=window.OPS.helpers.esc;
  const host = typeof hostId==="string" ? document.getElementById(hostId) : hostId;
  if(!host || !views || !views.length) return { show(){} };
  const key = "dcb_panel_"+(opts.key || String(opts.title||views.map(v=>v.key).join("_")).replace(/\W+/g,"_"));
  let active = opts.active; if(!active){ try{ active=localStorage.getItem(key); }catch(e){} }
  if(!views.some(v=>v.key===active)) active=views[0].key;
  host.innerHTML=`<div class="card">
    <div class="row wrap" style="gap:6px;align-items:center;margin-bottom:8px">
      ${opts.title?`<h3 style="margin:0 8px 0 0">${esc(opts.title)}</h3>`:""}
      <div class="row wrap" id="pvBtns" style="gap:6px"></div>
      ${(opts.actions&&opts.actions.length)?'<div class="spacer"></div>':''}
      <span id="pvActions"></span>
    </div>
    <div id="pvBody" class="muted">…</div></div>`;
  const btns=host.querySelector("#pvBtns"), body=host.querySelector("#pvBody");
  btns.innerHTML=views.map(v=>`<button class="btn sm" data-pv="${esc(v.key)}">${v.label}</button>`).join("");
  if(opts.actions&&opts.actions.length){ const a=host.querySelector("#pvActions");
    opts.actions.forEach((act,i)=>{ const b=document.createElement("button"); b.className="btn sm"; b.textContent=act.label;
      b.addEventListener("click",()=>act.fn(body)); a.appendChild(b); if(i<opts.actions.length-1) a.appendChild(document.createTextNode(" ")); }); }
  function show(k){ const v=views.find(x=>x.key===k)||views[0]; active=v.key;
    try{ localStorage.setItem(key, active); }catch(e){}
    btns.querySelectorAll("[data-pv]").forEach(b=>{ const on=b.getAttribute("data-pv")===active; b.classList.toggle("green",on); b.style.fontWeight=on?"700":""; });
    body.innerHTML="";
    try{ const r=v.render(body); if(r&&r.then) r.catch(e=>{ body.innerHTML='<div class="muted">'+esc(String(e&&e.message||e))+'</div>'; }); }
    catch(e){ body.innerHTML='<div class="muted">'+esc(String(e&&e.message||e))+'</div>'; }
  }
  btns.querySelectorAll("[data-pv]").forEach(b=>b.addEventListener("click",()=>show(b.getAttribute("data-pv"))));
  show(active);
  return { show };
}
window.OPS.report = { bar, line, lines, pie, img, canvas, wordButton, panel };
})();
