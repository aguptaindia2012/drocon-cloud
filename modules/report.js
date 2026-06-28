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
    options:Object.assign({ animation:false, responsive:false, maintainAspectRatio:false,
      plugins:{ legend:{ display:(type==="pie"||type==="doughnut") } } }, opts||{}) });
  return charts[id];
}
function bar(id,labels,values,label,color){ return mk(id,"bar",{labels,datasets:[{label:label||"",data:values,backgroundColor:color||"#599533"}]},{scales:{y:{beginAtZero:true}}}); }
function line(id,labels,values,label,color){ return mk(id,"line",{labels,datasets:[{label:label||"",data:values,borderColor:color||"#0A6496",backgroundColor:"rgba(10,100,150,.15)",fill:true,tension:.3}]},{scales:{y:{beginAtZero:true}}}); }
function pie(id,labels,values){ return mk(id,"doughnut",{labels,datasets:[{data:values,backgroundColor:DCB_COLORS}]}); }
function img(id){ const cv=document.getElementById(id); try{ return cv?cv.toDataURL("image/png"):null; }catch(e){ return null; } }
// a canvas element sized for both screen and capture
function canvas(id,w,h){ return `<canvas id="${id}" width="${w||560}" height="${h||240}" style="max-width:100%;height:${(h||240)}px"></canvas>`; }
function wordButton(hostId, title, sectionsFn){
  const h=document.getElementById(hostId); if(!h) return;
  const b=document.createElement("button"); b.className="btn blue sm"; b.textContent="⬇ Download Word report";
  b.addEventListener("click",()=>{ try{ window.OPS.docgen.generateReport({ title, sections:sectionsFn() }); }catch(e){ alert("Report error: "+e.message); } });
  h.appendChild(b);
}
window.OPS.report = { bar, line, pie, img, canvas, wordButton };
})();
