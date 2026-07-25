/* ============================================================================
   DroCon Cloud — Table Tools
   App-wide, zero-config sorting + filtering for every data table. A single
   MutationObserver watches the page; any <table> that renders gets:
     • a "Filter…" box that hides non-matching rows (searches all cell text)
     • click-to-sort column headers (numeric / date / text auto-detected)
   Skipped automatically: editable grids (inputs in the body), matrix tables
   tagged `tt-skip`, grouped-header tables, and tables with < 2 body rows.
   ============================================================================ */
(function(){
  function isEditable(table){ return !!table.querySelector("tbody input, tbody select, tbody textarea"); }
  function txt(td){ return td ? td.textContent.trim() : ""; }
  function toNum(s){ const t=s.replace(/[₹,\s%]/g,""); if(t==="" || isNaN(t)) return null; return parseFloat(t); }
  function toDate(s){ if(!/[a-zA-Z]/.test(s) && !/\d{4}-\d{2}-\d{2}/.test(s)) return null; const d=Date.parse(s); return isNaN(d)?null:d; }
  function cmp(a,b){
    const na=toNum(a), nb=toNum(b); if(na!==null && nb!==null) return na-nb;
    const da=toDate(a), db=toDate(b); if(da!==null && db!==null) return da-db;
    return a.localeCompare(b, undefined, {numeric:true, sensitivity:"base"});
  }
  function sortBy(table, col, dir){
    const tb=table.tBodies[0]; if(!tb) return;
    const rows=[...tb.rows].filter(r=>r.cells.length>col);
    rows.sort((r1,r2)=>{ const c=cmp(txt(r1.cells[col]), txt(r2.cells[col])); return dir==="desc"?-c:c; });
    const frag=document.createDocumentFragment(); rows.forEach(r=>frag.appendChild(r)); tb.appendChild(frag);
  }
  function enhance(table){
    if(!table || table.dataset.tt || table.classList.contains("tt-skip")) return;
    const thead=table.tHead, tb=table.tBodies[0];
    if(!thead || !tb || !thead.rows.length){ if(table.dataset) table.dataset.tt="1"; return; }
    if(tb.rows.length < 2 || isEditable(table)){ table.dataset.tt="1"; return; }
    const hrow=thead.rows[thead.rows.length-1];
    if([...hrow.cells].some(th=>th.colSpan>1)){ table.dataset.tt="1"; return; }  // grouped header → skip
    table.dataset.tt="1";

    // sortable headers
    [...hrow.cells].forEach((th,i)=>{
      if(!th.textContent.trim()) return;                    // action columns have no label
      th.style.cursor="pointer"; th.title="Click to sort";
      th.addEventListener("click",()=>{
        const dir = th.getAttribute("data-ttdir")==="asc" ? "desc" : "asc";
        [...hrow.cells].forEach(c=>{ c.removeAttribute("data-ttdir"); const a=c.querySelector(".tt-arr"); if(a) a.remove(); });
        th.setAttribute("data-ttdir",dir);
        sortBy(table, i, dir);
        const arr=document.createElement("span"); arr.className="tt-arr"; arr.textContent = dir==="asc"?" ▲":" ▼"; th.appendChild(arr);
      });
    });

    // filter box (inserted above the table / its scroll wrapper)
    const bar=document.createElement("div"); bar.className="tt-bar";
    bar.innerHTML=`<input type="search" class="tt-filter" placeholder="Filter…"><span class="tt-count muted"></span>`;
    let anchor=table;
    try{ const p=table.parentElement; if(p && /auto|scroll/.test(getComputedStyle(p).overflowX)) anchor=p; }catch(e){}
    anchor.parentNode.insertBefore(bar, anchor);
    const inp=bar.querySelector(".tt-filter"), cnt=bar.querySelector(".tt-count");
    inp.addEventListener("input",()=>{
      const q=inp.value.trim().toLowerCase(); let shown=0, total=0;
      [...tb.rows].forEach(r=>{ total++; const ok=!q || r.textContent.toLowerCase().includes(q); r.style.display=ok?"":"none"; if(ok) shown++; });
      cnt.textContent = q ? `${shown}/${total}` : "";
    });
  }
  function scan(root){ if(root && root.querySelectorAll) root.querySelectorAll("table").forEach(enhance); }
  function init(){
    scan(document);
    new MutationObserver(muts=>{ for(const m of muts){ for(const n of m.addedNodes){
      if(n.nodeType!==1) continue; if(n.tagName==="TABLE") enhance(n); else if(n.querySelectorAll) n.querySelectorAll("table").forEach(enhance);
    }}}).observe(document.body,{childList:true,subtree:true});
    if(window.OPS) window.OPS.enhanceTables=()=>scan(document);
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init); else init();
})();
