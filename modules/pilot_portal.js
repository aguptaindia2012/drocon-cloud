/* ============================================================================
   DroCon Cloud — Pilot acre reporting + review chain (Phase 2)
   - pilotReport()        : PILOT (external) submits a day's acres.
   - pilotReports()       : PILOT sees own reports + status; edit/withdraw.
   - vendorAcreReview()   : VENDOR reviews/corrects its pilots' reports.
   - pilotAcreApprovals() : DroCon (internal) approves (posts) / rejects.
   Rates are resolved server-side on approval — pilots/vendors never set them.
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const chip = (s)=>({submitted:"warn",vendor_ok:"issued",approved:"ok",rejected:"err"}[s]||"warn");
const label = (s)=>({submitted:"With vendor",vendor_ok:"With DroCon",approved:"Approved & posted",rejected:"Sent back"}[s]||s);

let crops=[], locs=[], drows=[], editingId=null;
const blank = ()=>({farmer:"",phone:"",village:"",crop:"",crop_id:"",chemical:"",acres:"",gps:false});

/* --------------------------------------------------------------- PILOT --- */
async function pilotReport(prefill){
  const m=$("main");
  [crops, locs] = await Promise.all([
    sb().from("crops").select("id,name").eq("active",true).order("name").then(r=>r.data||[]),
    sb().rpc("my_pilot_locations").then(r=>r.data||[])
  ]);
  editingId = (prefill&&prefill.id)||null;
  drows = (prefill&&Array.isArray(prefill.rows)&&prefill.rows.length)?prefill.rows.map(r=>Object.assign(blank(),r)):[blank()];
  const dDate = (prefill&&prefill.entry_date)||todayISO();
  const dLoc  = (prefill&&prefill.location_id)||"";
  m.innerHTML=`<div class="eyebrow">Pilot Portal</div><h1>${editingId?"Edit report":"Report Acres"}</h1>
    ${locs.length?"":'<div class="callout warn">You have <b>no locations assigned</b> yet. Ask the DroCon team to assign you to a location, then you can report acres.</div>'}
    <div class="card">
      <div class="fgrid">
        <div class="field"><label>Date *</label><input id="prDate" type="date" value="${esc(dDate)}"></div>
        <div class="field"><label>Location *</label><select id="prLoc"><option value="">— select —</option>${locs.map(l=>`<option value="${l.id}" ${l.id===dLoc?'selected':''}>${esc(l.name)}${l.district?(" · "+esc(l.district)):""}</option>`).join("")}</select></div>
      </div>
      <div style="overflow:auto"><table class="tt-skip"><thead><tr>
        <th>Farmer</th><th>Contact</th><th>Village</th><th>Crop</th><th>Medicine</th><th style="width:90px">Acres</th><th>GPS</th><th></th></tr></thead>
        <tbody id="prBody"></tbody></table></div>
      <div class="row" style="margin-top:8px"><button class="btn sm" id="prAdd">+ Add row</button>
        <div class="spacer"></div><button class="btn green" id="prSave">${editingId?"Update &amp; resubmit":"Submit"}</button></div>
      <div class="field" style="margin-top:8px"><label>Note (optional)</label><input id="prNote" value="${esc((prefill&&prefill.note)||"")}"></div>
      <div class="err" id="prErr"></div>
    </div>`;
  renderRows();
  $("prAdd").addEventListener("click",()=>{ drows.push(blank()); renderRows(); });
  $("prSave").addEventListener("click",save);
}
function renderRows(){
  const tb=$("prBody"); if(!tb) return;
  tb.innerHTML=drows.map((r,i)=>`<tr>
    <td><input data-i="${i}" data-k="farmer" value="${esc(r.farmer||"")}"></td>
    <td><input data-i="${i}" data-k="phone" value="${esc(r.phone||"")}" style="width:110px"></td>
    <td><input data-i="${i}" data-k="village" value="${esc(r.village||"")}"></td>
    <td><select data-i="${i}" data-k="crop_id" style="width:120px"><option value="">— crop —</option>${crops.map(c=>`<option value="${c.id}" ${String(r.crop_id||"")===String(c.id)?'selected':''}>${esc(c.name)}</option>`).join("")}</select></td>
    <td><input data-i="${i}" data-k="chemical" value="${esc(r.chemical||"")}"></td>
    <td><input data-i="${i}" data-k="acres" type="number" step="any" value="${esc(r.acres||"")}" style="width:80px"></td>
    <td style="text-align:center"><input data-i="${i}" data-k="gps" type="checkbox" ${r.gps?'checked':''}></td>
    <td>${drows.length>1?`<button class="btn sm ghost" data-del="${i}">✕</button>`:''}</td></tr>`).join("");
  tb.querySelectorAll("input[data-k],select[data-k]").forEach(el=>el.addEventListener("input",()=>{
    const i=+el.getAttribute("data-i"), k=el.getAttribute("data-k");
    let v = el.type==="checkbox" ? el.checked : el.value;
    drows[i][k]=v;
    if(k==="crop_id"){ const c=crops.find(x=>String(x.id)===String(v)); drows[i].crop=c?c.name:""; }
  }));
  tb.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{ drows.splice(+b.getAttribute("data-del"),1); renderRows(); }));
}
async function save(){
  const loc=$("prLoc").value, date=$("prDate").value;
  if(!loc){ $("prErr").textContent="Pick a location."; return; }
  if(!date){ $("prErr").textContent="Pick a date."; return; }
  const rows=drows.filter(r=>num(r.acres)>0 || (r.farmer||"").trim());
  if(!rows.length){ $("prErr").textContent="Add at least one row with acres."; return; }
  $("prSave").disabled=true;
  const { error }=await sb().rpc("submit_pilot_report",{ p_location:loc, p_date:date, p_rows:rows, p_note:$("prNote").value||null, p_id:editingId });
  $("prSave").disabled=false;
  if(error){ $("prErr").textContent=error.message; return; }
  window.OPS.flashTop("Report submitted ✓"); editingId=null; pilotReports();
}

async function pilotReports(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Pilot Portal</div><h1>My Reports</h1>
    <div class="row" style="margin:6px 0"><button class="btn green sm" id="prNew">+ Report acres</button></div>
    <div id="mrList" class="muted">Loading…</div>`;
  $("prNew").addEventListener("click",()=>pilotReport());
  const { data }=await sb().from("pilot_acre_reports").select("*").order("entry_date",{ascending:false}).order("created_at",{ascending:false});
  const rows=data||[];
  const acresOf=r=>(r.rows||[]).reduce((s,x)=>s+num(x.acres),0);
  $("mrList").innerHTML = rows.length ? `<div class="card"><div style="overflow:auto"><table><thead><tr><th>Date</th><th>Location</th><th class="num">Acres</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td>${fmtDate(r.entry_date)}</td><td>${esc(r.location_name||"")}</td><td class="num">${acresOf(r).toFixed(1)}</td>
      <td><span class="chip ${chip(r.status)}">${esc(label(r.status))}</span>${r.reject_reason?`<br><span class="small-note" style="color:#a3322a">${esc(r.reject_reason)}</span>`:''}</td>
      <td>${(r.status==="submitted"||r.status==="rejected")?`<button class="btn sm" data-edit="${r.id}">Edit</button> `:''}${r.status==="submitted"?`<button class="btn sm ghost" data-wd="${r.id}">Withdraw</button>`:''}</td></tr>`).join("")}</tbody></table></div></div>`
    : '<div class="card muted">No reports yet. Click “Report acres”.</div>';
  $("mrList").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>{ const r=rows.find(x=>x.id===b.getAttribute("data-edit")); pilotReport(r); }));
  $("mrList").querySelectorAll("[data-wd]").forEach(b=>b.addEventListener("click",async()=>{
    if(!confirm("Withdraw this report?")) return;
    const { error }=await sb().from("pilot_acre_reports").delete().eq("id",b.getAttribute("data-wd"));
    if(error){ alert(error.message); return; } window.OPS.flashTop("Withdrawn ✓"); pilotReports();
  }));
}

/* -------------------------------------------------------------- VENDOR --- */
async function vendorAcreReview(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Vendor Portal</div><h1>Acre Review</h1>
    <div class="callout">Review what your pilots reported. Correct the acres if needed, then <b>Pass to DroCon</b> — or <b>Send back</b> to the pilot. DroCon sets the rates and gives final approval.</div>
    <div id="vrList" class="muted">Loading…</div>`;
  load();
  async function load(){
    const { data }=await sb().from("pilot_acre_reports").select("*, pilot:pilot_id(name)").order("entry_date",{ascending:false});
    const rows=data||[];
    const pend=rows.filter(r=>r.status==="submitted");
    const rest=rows.filter(r=>r.status!=="submitted");
    $("vrList").innerHTML = `
      <div class="card"><h3>Awaiting your review (${pend.length})</h3>${pend.length?pend.map(cardHTML).join(""):'<div class="muted">Nothing to review.</div>'}</div>
      ${rest.length?`<div class="card"><h3>Recent</h3><div style="overflow:auto"><table><thead><tr><th>Date</th><th>Pilot</th><th>Location</th><th class="num">Acres</th><th>Status</th></tr></thead>
        <tbody>${rest.slice(0,40).map(r=>`<tr><td>${fmtDate(r.entry_date)}</td><td>${esc(r.pilot&&r.pilot.name||"")}</td><td>${esc(r.location_name||"")}</td><td class="num">${acresOf(r).toFixed(1)}</td><td><span class="chip ${chip(r.status)}">${esc(label(r.status))}</span></td></tr>`).join("")}</tbody></table></div></div>`:''}`;
    pend.forEach(wire);
  }
  function acresOf(r){ return (r.rows||[]).reduce((s,x)=>s+num(x.acres),0); }
  function cardHTML(r){
    return `<div class="card" style="background:#fafbf8" data-rid="${r.id}">
      <div class="row wrap"><b>${esc(r.pilot&&r.pilot.name||"Pilot")}</b><span class="muted">${fmtDate(r.entry_date)} · ${esc(r.location_name||"")}</span></div>
      <div style="overflow:auto"><table class="tt-skip"><thead><tr><th>Farmer</th><th>Village</th><th>Crop</th><th style="width:90px">Acres</th></tr></thead>
        <tbody>${(r.rows||[]).map((x,i)=>`<tr><td>${esc(x.farmer||"")}</td><td>${esc(x.village||"")}</td><td>${esc(x.crop||"")}</td>
          <td><input data-rid="${r.id}" data-i="${i}" type="number" step="any" value="${esc(x.acres||"")}" style="width:80px"></td></tr>`).join("")}</tbody></table></div>
      <div class="row" style="margin-top:6px"><button class="btn green sm" data-pass="${r.id}">Pass to DroCon</button>
        <button class="btn sm" data-back="${r.id}" style="color:#a3322a;border-color:#e4b4b4">Send back</button></div></div>`;
  }
  function collect(rid, orig){ const rows=JSON.parse(JSON.stringify(orig.rows||[]));
    document.querySelectorAll(`input[data-rid="${rid}"][data-i]`).forEach(el=>{ rows[+el.getAttribute("data-i")].acres=el.value; }); return rows; }
  function wire(r){
    const pass=document.querySelector(`[data-pass="${r.id}"]`), back=document.querySelector(`[data-back="${r.id}"]`);
    if(pass) pass.addEventListener("click",async()=>{ const { error }=await sb().rpc("vendor_review_report",{ p_id:r.id, p_status:"vendor_ok", p_rows:collect(r.id,r) });
      if(error){ alert(error.message); return; } window.OPS.flashTop("Passed to DroCon ✓"); load(); });
    if(back) back.addEventListener("click",async()=>{ const reason=prompt("Reason to send back to the pilot:",""); if(reason===null) return;
      const { error }=await sb().rpc("vendor_review_report",{ p_id:r.id, p_status:"rejected", p_rows:collect(r.id,r), p_reason:reason||null });
      if(error){ alert(error.message); return; } window.OPS.flashTop("Sent back ✓"); load(); });
  }
}

/* ------------------------------------------------------------ INTERNAL --- */
async function pilotAcreApprovals(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Review / Approvals</div><h1>Pilot Acres</h1>
    <div class="callout">Reports your vendors have cleared. Check the acres and correctness, then <b>Approve</b> — the acres post to the tracker with the DroCon rate in force for that location/crop/date (0% farmer + client component). Or <b>Reject</b>.</div>
    <div id="paList" class="muted">Loading…</div>`;
  load();
  async function load(){
    const { data }=await sb().from("pilot_acre_reports").select("*, pilot:pilot_id(name), vendor:vendor_id(name,firm_name)").order("entry_date",{ascending:false});
    const rows=data||[];
    const pend=rows.filter(r=>r.status==="vendor_ok" && !r.posted);
    const done=rows.filter(r=>r.status==="approved"||r.status==="rejected");
    const acresOf=r=>(r.rows||[]).reduce((s,x)=>s+num(x.acres),0);
    const vn=r=>(r.vendor&&(r.vendor.firm_name||r.vendor.name))||"";
    $("paList").innerHTML=`
      <div class="card"><h3>Awaiting DroCon approval (${pend.length})</h3>${pend.length?pend.map(r=>`
        <div class="card" style="background:#fafbf8">
          <div class="row wrap"><b>${esc(r.pilot&&r.pilot.name||"Pilot")}</b><span class="muted">${esc(vn(r))} · ${fmtDate(r.entry_date)} · ${esc(r.location_name||"")}</span><div class="spacer"></div><b>${acresOf(r).toFixed(1)} ac</b></div>
          <div style="overflow:auto"><table class="tt-skip"><thead><tr><th>Farmer</th><th>Village</th><th>Crop</th><th>Medicine</th><th class="num">Acres</th></tr></thead>
            <tbody>${(r.rows||[]).map(x=>`<tr><td>${esc(x.farmer||"")}</td><td>${esc(x.village||"")}</td><td>${esc(x.crop||"")}</td><td>${esc(x.chemical||"")}</td><td class="num">${num(x.acres).toFixed(1)}</td></tr>`).join("")}</tbody></table></div>
          <div class="row" style="margin-top:6px"><button class="btn green sm" data-ap="${r.id}">Approve &amp; post</button>
            <button class="btn sm" data-rj="${r.id}" style="color:#a3322a;border-color:#e4b4b4">Reject</button></div></div>`).join(""):'<div class="muted">Nothing awaiting approval.</div>'}</div>
      ${done.length?`<div class="card"><h3>Recent decisions</h3><div style="overflow:auto"><table><thead><tr><th>Date</th><th>Pilot</th><th>Vendor</th><th>Location</th><th class="num">Acres</th><th>Status</th></tr></thead>
        <tbody>${done.slice(0,40).map(r=>`<tr><td>${fmtDate(r.entry_date)}</td><td>${esc(r.pilot&&r.pilot.name||"")}</td><td>${esc(vn(r))}</td><td>${esc(r.location_name||"")}</td><td class="num">${acresOf(r).toFixed(1)}</td><td><span class="chip ${chip(r.status)}">${esc(label(r.status))}</span></td></tr>`).join("")}</tbody></table></div></div>`:''}`;
    $("paList").querySelectorAll("[data-ap]").forEach(b=>b.addEventListener("click",async()=>{
      const { error }=await sb().rpc("post_pilot_report",{ p_id:b.getAttribute("data-ap") });
      if(error){ alert(error.message); return; } window.OPS.flashTop("Approved & posted ✓"); load();
    }));
    $("paList").querySelectorAll("[data-rj]").forEach(b=>b.addEventListener("click",async()=>{
      const reason=prompt("Reason for rejection:",""); if(reason===null) return;
      const { error }=await sb().rpc("reject_pilot_report",{ p_id:b.getAttribute("data-rj"), p_reason:reason||null });
      if(error){ alert(error.message); return; } window.OPS.flashTop("Rejected ✓"); load();
    }));
  }
}

window.OPS.routes.pilot_report        = ()=>pilotReport();
window.OPS.routes.pilot_reports       = pilotReports;
window.OPS.routes.vendor_acre_review  = vendorAcreReview;
window.OPS.routes.pilot_acre_approvals= pilotAcreApprovals;
})();
