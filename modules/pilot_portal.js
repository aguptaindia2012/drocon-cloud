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
const chip = (s)=>({submitted:"warn",vendor_ok:"warn",approved:"ok",rejected:"err"}[s]||"warn");
const label = (s)=>({submitted:"Awaiting DroCon approval",vendor_ok:"Awaiting DroCon approval",approved:"Approved",rejected:"Sent back"}[s]||s);

let crops=[], locs=[], drows=[], editingId=null;
const SHORT_PILOT=15;   // a pilot-day under this many acres needs a reason (pilot side)
const blank = ()=>({farmer:"",phone:"",village:"",crop:"",crop_id:"",chemical:"",acres:"",gps:false});

/* ---- lightweight i18n for the Pilot Portal (labels only; typed data & option
   lists stay in English so the internal side is unaffected) ---- */
function lang(){ try{ return localStorage.getItem("dcb_lang")||"en"; }catch(e){ return "en"; } }
function setLang(l){ try{ localStorage.setItem("dcb_lang", l); }catch(e){} }
const DICT={ en:{}, hi:{
  "Pilot Portal":"पायलट पोर्टल","Report Acres":"एकड़ रिपोर्ट करें","Edit report":"रिपोर्ट संपादित करें",
  "Date":"दिनांक","Location":"स्थान","Mill / Party":"मिल / पार्टी","(optional)":"(वैकल्पिक)",
  "Farmer":"किसान","Contact":"संपर्क","Village":"गाँव","Crop":"फ़सल","Medicine":"दवा","Acres":"एकड़",
  "+ Add row":"+ पंक्ति जोड़ें","Submit":"जमा करें","Update & resubmit":"अपडेट कर पुनः जमा करें",
  "Day total":"दिन का कुल","acres":"एकड़","met minimum":"न्यूनतम पूर्ण","Note":"टिप्पणी",
  "My Reports":"मेरी रिपोर्ट्स","+ Report acres":"+ एकड़ रिपोर्ट करें","Status":"स्थिति","Message":"संदेश",
  "Edit":"संपादित करें","Withdraw":"वापस लें",
  "No reports yet. Click Report acres.":"अभी कोई रिपोर्ट नहीं। ‘एकड़ रिपोर्ट करें’ दबाएँ।",
  "You have no locations assigned yet — ask the DroCon team to assign you, then you can report acres.":"आपको अभी कोई स्थान नहीं सौंपा गया है — DroCon टीम से कहें, फिर आप एकड़ रिपोर्ट कर सकते हैं।",
  "Report submitted ✓":"रिपोर्ट जमा हो गई ✓","Pick a location.":"स्थान चुनें।","Pick a date.":"दिनांक चुनें।",
  "Add at least one row with acres.":"कम से कम एक पंक्ति एकड़ के साथ जोड़ें।",
  "Report message":"रिपोर्ट संदेश","Copy":"कॉपी करें","Share…":"साझा करें…","Open WhatsApp":"व्हाट्सएप खोलें","Close":"बंद करें",
  "Copied ✓ — paste into WhatsApp.":"कॉपी हो गया ✓ — व्हाट्सएप में पेस्ट करें।",
  "Copy or share this to the DroCon Pilots' Group and the location's Client Group. Edit if needed before sending.":"इसे DroCon पायलट ग्रुप और स्थान के क्लाइंट ग्रुप में कॉपी/साझा करें। भेजने से पहले आवश्यकतानुसार संपादित करें।",
  "drafts a WhatsApp-style report you can copy or share to the DroCon Pilots' Group and the location's Client Group.":"एक व्हाट्सएप-शैली रिपोर्ट तैयार करता है जिसे आप DroCon पायलट ग्रुप और स्थान के क्लाइंट ग्रुप में कॉपी/साझा कर सकते हैं।",
  "Drone Pilot":"ड्रोन पायलट","Total acres":"कुल एकड़","Farmer details":"किसान विवरण",
  "GPS photo":"जीपीएस फ़ोटो","Received":"प्राप्त","Pending":"लंबित","Pilot":"पायलट"
}};
function t(k){ const d=DICT[lang()]; return (d&&d[k])||k; }
function langToggleHTML(){ const to=lang()==="hi"?"en":"hi"; return `<button class="btn sm" id="plLang" title="Language / भाषा">${to==="hi"?"हिंदी":"English"}</button>`; }
function currentPrefill(){ return { id:editingId, rows:drows.slice(),
  entry_date:$("prDate")?$("prDate").value:todayISO(), location_id:$("prLoc")?$("prLoc").value:"",
  note:$("prNote")?$("prNote").value:"", mill:$("prMill")?$("prMill").value:"" }; }

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
  const shortPh = lang()==="hi" ? `— कम-एकड़ कारण (दिन ${SHORT_PILOT} एकड़ से कम) —` : `— short-day reason (day under ${SHORT_PILOT} ac) —`;
  m.innerHTML=`<div class="row" style="justify-content:space-between;align-items:flex-start"><div><div class="eyebrow">${t("Pilot Portal")}</div><h1 style="margin:0">${editingId?t("Edit report"):t("Report Acres")}</h1></div>${langToggleHTML()}</div>
    ${locs.length?"":`<div class="callout warn">${t("You have no locations assigned yet — ask the DroCon team to assign you, then you can report acres.")}</div>`}
    <div class="card" style="margin-top:10px">
      <div class="fgrid">
        <div class="field"><label>${t("Date")} *</label><input id="prDate" type="date" value="${esc(dDate)}"></div>
        <div class="field"><label>${t("Location")} *</label><select id="prLoc"><option value="">— select —</option>${locs.map(l=>`<option value="${l.id}" ${l.id===dLoc?'selected':''}>${esc(l.name)}${l.district?(" · "+esc(l.district)):""}</option>`).join("")}</select></div>
        <div class="field"><label>${t("Mill / Party")} <span class="muted" style="font-weight:normal">${t("(optional)")}</span></label><input id="prMill" value="${esc((prefill&&prefill.mill)||"")}" placeholder="e.g. Shree ji mill"></div>
      </div>
      <div style="overflow:auto"><table class="tt-skip"><thead><tr>
        <th>${t("Farmer")}</th><th>${t("Contact")}</th><th>${t("Village")}</th><th>${t("Crop")}</th><th>${t("Medicine")}</th><th style="width:90px">${t("Acres")}</th><th>GPS</th><th></th></tr></thead>
        <tbody id="prBody"></tbody></table></div>
      <div class="row" style="margin-top:8px"><button class="btn sm" id="prAdd">${t("+ Add row")}</button>
        <div class="spacer"></div><button class="btn green" id="prSave">${editingId?t("Update & resubmit"):t("Submit")}</button></div>
      <div class="row" style="margin-top:8px;align-items:center;gap:10px;flex-wrap:wrap">
        <span class="muted">${t("Day total")}: <b id="prTotal">0.0</b> ${t("acres")}</span>
        <span id="prShortWrap" style="display:none;align-items:center;gap:6px"><select id="prShort" style="width:300px;border-color:#e0a800;background:#fff8e6"><option value="">${esc(shortPh)}</option>${(window.OPS.SHORT_REASONS||[]).map(x=>`<option>${esc(x)}</option>`).join("")}</select></span>
        <span id="prMet" class="chip ok" style="display:none;font-size:11px">${t("met minimum")}</span>
      </div>
      <div class="field" style="margin-top:8px"><label>${t("Note")} ${t("(optional)")}</label><input id="prNote" value="${esc((prefill&&prefill.note)||"")}"></div>
      <div class="err" id="prErr"></div>
    </div>`;
  renderRows();
  if($("plLang")) $("plLang").addEventListener("click",()=>{ setLang(lang()==="hi"?"en":"hi"); pilotReport(currentPrefill()); });
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
    if(k==="acres") updateTotal();
  }));
  tb.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{ drows.splice(+b.getAttribute("data-del"),1); renderRows(); }));
  updateTotal();
}
function updateTotal(){
  const t=drows.reduce((s,r)=>s+num(r.acres),0);
  if($("prTotal")) $("prTotal").textContent=t.toFixed(1);
  const short=t>0 && t<SHORT_PILOT;
  if($("prShortWrap")) $("prShortWrap").style.display=short?"inline-flex":"none";
  if($("prMet")) $("prMet").style.display=(t>0&&!short)?"inline-flex":"none";
}
async function save(){
  const loc=$("prLoc").value, date=$("prDate").value;
  if(!loc){ $("prErr").textContent=t("Pick a location."); return; }
  if(!date){ $("prErr").textContent=t("Pick a date."); return; }
  const rows=drows.filter(r=>num(r.acres)>0 || (r.farmer||"").trim());
  if(!rows.length){ $("prErr").textContent=t("Add at least one row with acres."); return; }
  const total=rows.reduce((s,r)=>s+num(r.acres),0);
  const reason=($("prShort")?$("prShort").value:"").trim();
  if(total>0 && total<SHORT_PILOT && !reason){ $("prErr").textContent=(lang()==="hi"?("कम-एकड़ कारण जोड़ें — दिन का कुल "+SHORT_PILOT+" एकड़ से कम है।"):("Add a short-day reason — the day total is under "+SHORT_PILOT+" acres.")); return; }
  $("prSave").disabled=true;
  const { error }=await sb().rpc("submit_pilot_report",{ p_location:loc, p_date:date, p_rows:rows, p_note:$("prNote").value||null, p_id:editingId, p_reason:(reason||null), p_mill:(($("prMill")&&$("prMill").value.trim())||null) });
  $("prSave").disabled=false;
  if(error){ $("prErr").textContent=error.message; return; }
  window.OPS.flashTop(t("Report submitted ✓"));
  // messaging is independent of approval — draft the WhatsApp message right away
  const locName=(locs.find(l=>String(l.id)===String(loc))||{}).name||"";
  const draft={ entry_date:date, location_name:locName, mill:(($("prMill")&&$("prMill").value.trim())||null), rows:rows };
  editingId=null; pilotReports();
  showReportMessage(draft);
}

async function pilotReports(){
  const m=$("main");
  m.innerHTML=`<div class="row" style="justify-content:space-between;align-items:flex-start"><div><div class="eyebrow">${t("Pilot Portal")}</div><h1 style="margin:0">${t("My Reports")}</h1></div>${langToggleHTML()}</div>
    <div class="row" style="margin:8px 0"><button class="btn green sm" id="prNew">${t("+ Report acres")}</button></div>
    <div id="mrList" class="muted">Loading…</div>`;
  if($("plLang")) $("plLang").addEventListener("click",()=>{ setLang(lang()==="hi"?"en":"hi"); pilotReports(); });
  $("prNew").addEventListener("click",()=>pilotReport());
  const myPid=await sb().rpc("my_pilot_id").then(r=>r.data).catch(()=>null);
  let q=sb().from("pilot_acre_reports").select("*").order("entry_date",{ascending:false}).order("created_at",{ascending:false});
  if(myPid) q=q.eq("pilot_id",myPid);   // internal-linked pilots are is_internal (would otherwise see all)
  const { data }=await q;
  const rows=data||[];
  const acresOf=r=>(r.rows||[]).reduce((s,x)=>s+num(x.acres),0);
  $("mrList").innerHTML = rows.length ? `<div class="card"><div style="overflow:auto"><table><thead><tr><th>${t("Date")}</th><th>${t("Location")}</th><th class="num">${t("Acres")}</th><th>${t("Status")}</th><th></th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td>${fmtDate(r.entry_date)}</td><td>${esc(r.location_name||"")}</td><td class="num">${acresOf(r).toFixed(1)}</td>
      <td><span class="chip ${chip(r.status)}">${esc(label(r.status))}</span>${r.reject_reason?`<br><span class="small-note" style="color:#a3322a">${esc(r.reject_reason)}</span>`:''}</td>
      <td><button class="btn sm blue" data-msg="${r.id}">📤 ${t("Message")}</button> ${(r.status==="submitted"||r.status==="rejected")?`<button class="btn sm" data-edit="${r.id}">${t("Edit")}</button> `:''}${r.status==="submitted"?`<button class="btn sm ghost" data-wd="${r.id}">${t("Withdraw")}</button>`:''}</td></tr>`).join("")}</tbody></table></div>
    <p class="muted" style="font-size:12px;margin-top:6px">📤 <b>${t("Message")}</b> ${t("drafts a WhatsApp-style report you can copy or share to the DroCon Pilots' Group and the location's Client Group.")}</p></div>`
    : `<div class="card muted">${t("No reports yet. Click Report acres.")}</div>`;
  $("mrList").querySelectorAll("[data-msg]").forEach(b=>b.addEventListener("click",()=>{ const r=rows.find(x=>x.id===b.getAttribute("data-msg")); if(r) showReportMessage(r); }));
  $("mrList").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>{ const r=rows.find(x=>x.id===b.getAttribute("data-edit")); pilotReport(r); }));
  $("mrList").querySelectorAll("[data-wd]").forEach(b=>b.addEventListener("click",async()=>{
    if(!confirm("Withdraw this report?")) return;
    const { error }=await sb().from("pilot_acre_reports").delete().eq("id",b.getAttribute("data-wd"));
    if(error){ alert(error.message); return; } window.OPS.flashTop("Withdrawn ✓"); pilotReports();
  }));
}

/* ---- WhatsApp-style report draft (copy / share to the groups) ---- */
function buildReportMessage(r){
  const p=window.OPS.profile||{};
  const name=p.full_name||p.email||"Pilot";
  const total=(r.rows||[]).reduce((s,x)=>s+num(x.acres),0);
  const L=[];
  L.push(name+" — "+t("Drone Pilot"));
  L.push(t("Date")+" - "+fmtDate(r.entry_date));
  L.push(t("Location")+" - "+(r.location_name||""));
  if(r.mill) L.push(t("Mill / Party")+" - "+r.mill);
  L.push(t("Total acres")+" - "+total.toFixed(2));
  L.push("");
  L.push(t("Farmer details"));
  L.push("");
  (r.rows||[]).forEach((x,i)=>{
    L.push((i+1)+". "+(x.farmer||"—"));
    L.push(t("Acres")+" - "+num(x.acres).toFixed(2));
    if(x.village) L.push(t("Village")+" - "+x.village);
    if(x.crop) L.push(t("Crop")+" - "+x.crop);
    L.push(t("GPS photo")+" - "+(x.gps?("✅ "+t("Received")):("❌ "+t("Pending"))));
    L.push("");
  });
  L.push(t("Pilot")+" - "+name);
  return L.join("\n");
}
function showReportMessage(r){
  const text=buildReportMessage(r);
  const ov=document.createElement("div");
  ov.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px";
  ov.innerHTML=`<div class="card" style="max-width:520px;width:100%;max-height:90vh;overflow:auto;margin:0">
    <h3 style="margin:0 0 4px">${t("Report message")}</h3>
    <p class="muted" style="margin-top:0;font-size:12px">${t("Copy or share this to the DroCon Pilots' Group and the location's Client Group. Edit if needed before sending.")}</p>
    <textarea id="pmText" style="width:100%;min-height:300px;font-size:13px;line-height:1.4">${esc(text)}</textarea>
    <div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap">
      <button class="btn green" id="pmCopy">📋 ${t("Copy")}</button>
      <button class="btn blue" id="pmShare">${t("Share…")}</button>
      <button class="btn" id="pmWa">${t("Open WhatsApp")}</button>
      <div class="spacer"></div><button class="btn sm" id="pmClose">${t("Close")}</button></div>
    <div id="pmOut" class="muted" style="font-size:12px;margin-top:6px"></div></div>`;
  document.body.appendChild(ov);
  const q=id=>ov.querySelector(id);
  const close=()=>ov.remove();
  ov.addEventListener("click",e=>{ if(e.target===ov) close(); });
  q("#pmClose").addEventListener("click",close);
  q("#pmCopy").addEventListener("click",async()=>{
    const val=q("#pmText").value;
    try{ await navigator.clipboard.writeText(val); q("#pmOut").textContent=t("Copied ✓ — paste into WhatsApp."); }
    catch(e){ q("#pmText").select(); try{ document.execCommand("copy"); q("#pmOut").textContent="Copied ✓"; }catch(_){ q("#pmOut").textContent="Select the text and copy manually."; } }
  });
  const sh=q("#pmShare");
  if(navigator.share){ sh.addEventListener("click",async()=>{ try{ await navigator.share({text:q("#pmText").value}); }catch(e){} }); }
  else { sh.style.display="none"; }
  q("#pmWa").addEventListener("click",()=>{ window.open("https://wa.me/?text="+encodeURIComponent(q("#pmText").value),"_blank"); });
}

/* -------------------------------------------------------------- VENDOR --- */
/* Read-only: pilot reports go straight to DroCon for verification. The vendor
   sees status only (Awaiting approval → Approved / Sent back). */
async function vendorAcreReview(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Vendor Portal</div><h1>Pilot Reports</h1>
    <div class="callout">Acres your pilots reported. These go directly to DroCon for verification — you'll see them here as <b>Awaiting DroCon approval</b>, then <b>Approved</b> once DroCon signs off. Approved acres appear on your <b>Acre Dashboard</b> and can be invoiced.</div>
    <div id="vrList" class="muted">Loading…</div>`;
  const acresOf=r=>(r.rows||[]).reduce((s,x)=>s+num(x.acres),0);
  const { data }=await sb().from("pilot_acre_reports").select("*, pilot:pilot_id(name)").order("entry_date",{ascending:false});
  const rows=data||[];
  const pend=rows.filter(r=>r.status!=="approved"&&r.status!=="rejected");
  $("vrList").innerHTML = rows.length ? `<div class="card"><div class="row" style="margin-bottom:6px"><b>${pend.length}</b><span class="muted" style="margin-left:6px">awaiting DroCon approval</span></div>
    <div style="overflow:auto"><table><thead><tr><th>Date</th><th>Pilot</th><th>Location</th><th class="num">Acres</th><th>Status</th></tr></thead>
    <tbody>${rows.slice(0,120).map(r=>`<tr><td>${fmtDate(r.entry_date)}</td><td>${esc(r.pilot&&r.pilot.name||"")}</td><td>${esc(r.location_name||"")}</td><td class="num">${acresOf(r).toFixed(1)}</td>
      <td><span class="chip ${chip(r.status)}">${esc(label(r.status))}</span>${r.reject_reason?`<br><span class="small-note" style="color:#a3322a">${esc(r.reject_reason)}</span>`:''}</td></tr>`).join("")}</tbody></table></div></div>`
    : '<div class="card muted">No pilot reports yet.</div>';
}

/* ------------------------------------------------------------ INTERNAL --- */
async function pilotAcreApprovals(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Review / Approvals</div><h1>Pilot Acres</h1>
    <div class="callout">Acres pilots reported, for your verification. Check the acres and correctness, then <b>Approve</b> — they post to the tracker at the rate in force for that location/crop/date. Or <b>Reject</b> (the pilot fixes and resubmits). Approved acres then show on the vendor &amp; client portals.</div>
    <div id="paList" class="muted">Loading…</div>`;
  load();
  async function load(){
    const { data }=await sb().from("pilot_acre_reports").select("*, pilot:pilot_id(name), vendor:vendor_id(name,firm_name)").order("entry_date",{ascending:false});
    const rows=data||[];
    const pend=rows.filter(r=>(r.status==="submitted"||r.status==="vendor_ok") && !r.posted);
    const done=rows.filter(r=>r.status==="approved"||r.status==="rejected");
    const acresOf=r=>(r.rows||[]).reduce((s,x)=>s+num(x.acres),0);
    const vn=r=>(r.vendor&&(r.vendor.firm_name||r.vendor.name))||"";
    // short-day reason: on the report (new) or short_day_logs (older reports)
    let sdMap={};
    try{ if(rows.length){ const minD=rows.reduce((a,r)=>(r.entry_date&&r.entry_date<a)?r.entry_date:a, rows[0].entry_date);
      const { data:sd }=await sb().from("short_day_logs").select("entry_date,location_name,pilot_name,reason").gte("entry_date",minD);
      (sd||[]).forEach(x=>{ if(x.reason) sdMap[`${x.entry_date}|${x.location_name}|${x.pilot_name}`]=x.reason; }); } }catch(e){}
    const reasonOf=r=> (r.short_reason||"").trim() || sdMap[`${r.entry_date}|${r.location_name||""}|${(r.pilot&&r.pilot.name)||""}`] || "";
    $("paList").innerHTML=`
      <div class="card"><h3>Awaiting DroCon approval (${pend.length})</h3>${pend.length?pend.map(r=>{ const reason=reasonOf(r); return `
        <div class="card" style="background:#fafbf8">
          <div class="row wrap"><b>${esc(r.pilot&&r.pilot.name||"Pilot")}</b><span class="muted">${esc(vn(r))} · ${fmtDate(r.entry_date)} · ${esc(r.location_name||"")}</span><div class="spacer"></div><b>${acresOf(r).toFixed(1)} ac</b></div>
          ${reason?`<div class="callout" style="margin:6px 0;background:#fff7e6;border-color:#f0d8a8"><b>Short-day reason:</b> ${esc(reason)}</div>`:''}
          <div style="overflow:auto"><table class="tt-skip"><thead><tr><th>Farmer</th><th>Village</th><th>Crop</th><th>Medicine</th><th class="num">Acres</th></tr></thead>
            <tbody>${(r.rows||[]).map(x=>`<tr><td>${esc(x.farmer||"")}</td><td>${esc(x.village||"")}</td><td>${esc(x.crop||"")}</td><td>${esc(x.chemical||"")}</td><td class="num">${num(x.acres).toFixed(1)}</td></tr>`).join("")}</tbody></table></div>
          <div class="row" style="margin-top:6px"><button class="btn green sm" data-ap="${r.id}">Approve &amp; post</button>
            <button class="btn sm" data-rj="${r.id}" style="color:#a3322a;border-color:#e4b4b4">Reject</button></div></div>`; }).join(""):'<div class="muted">Nothing awaiting approval.</div>'}</div>
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
