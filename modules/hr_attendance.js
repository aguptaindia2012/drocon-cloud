/* ============================================================================
   DroCon Cloud — HR / Attendance + Comp-off (earned-leave) engine
   - hr_attendance : monthly holiday calendar + per-employee attendance grid
   - hr_compoff    : comp-off balances, lapse highlighting, encashment

   Model (see sql/51):
   * Working a Sunday or a declared holiday earns 1 comp-off, expiring at the
     end of the calendar quarter it was earned in.
   * Attendance defaults to Present; only deviations are stored (Absent /
     Comp-off used / Worked-on-day-off). Absent days become LOP in salary.
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;

/* ---------- date helpers ---------- */
const iso = d => d.toISOString().slice(0,10);
function monthDays(ym){ const [y,m]=ym.split("-").map(Number); return new Date(Date.UTC(y,m,0)).getUTCDate(); }
function ymNow(){ return (window.OPS._hrMonth)||todayISO().slice(0,7); }
const DOW = ["Su","Mo","Tu","We","Th","Fr","Sa"];
function dateInMonth(ym,day){ return ym+"-"+String(day).padStart(2,"0"); }
function dowOf(isoDate){ return new Date(isoDate+"T00:00:00Z").getUTCDay(); }
function quarterEnd(isoDate){ const d=new Date(isoDate+"T00:00:00Z"); const q=Math.floor(d.getUTCMonth()/3);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), q*3+3, 0))); }

/* DroCon's 12 mandatory paid holidays (HR Policy v2.0). Only the three
   National days have fixed Gregorian dates; festival dates are set each year
   by the team. Names are the standard reference; dates are filled per year. */
const DROCON_HOLIDAYS = [
  {name:"Republic Day", fixed:"01-26"},
  {name:"Maha Shivaratri"},
  {name:"Holi / Dhulandi"},
  {name:"Ram Navami"},
  {name:"Independence Day", fixed:"08-15"},
  {name:"Janmashtami / Gokulashtami"},
  {name:"Raksha Bandhan"},
  {name:"Ganesh Chaturthi"},
  {name:"Gandhi Jayanti", fixed:"10-02"},
  {name:"Dussehra / Vijayadashami"},
  {name:"Diwali / Deepavali"},
  {name:"Guru Nanak Jayanti / Kartik Purnima"},
];

/* status cell display: code + colour */
const CELL = {
  present:   {t:"P", bg:"",                 fg:"var(--muted,#999)"},
  off:       {t:"·", bg:"var(--paper2,#f2f2f2)", fg:"var(--muted,#888)"},
  absent:    {t:"A", bg:"#fde2e1",          fg:"#a11"},
  worked_off:{t:"W", bg:"#e2f6e6",          fg:"#137a2e"},
};

/* ============================ Attendance grid ============================ */
let att = { ym:null, emps:[], holidays:[], orig:{}, work:{} };   // work/orig: "empId|date"->status

async function attendance(){
  const ym = ymNow();
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">HR</div><h1>Attendance</h1>
    <div class="row" style="margin:10px 0">
      <label style="margin:0">Month</label><input id="atMonth" type="month" value="${ym}" style="width:auto">
      <span id="atLock"></span>
      <div class="spacer"></div>
      <button class="btn green sm" id="atSave">Save attendance</button>
    </div>
    <div class="callout">Declare this month's <b>holidays first</b> (Sundays are automatic), then mark attendance. Click a cell to cycle: <b>P</b> Present ↔ <b>A</b> Absent (a day off taken); on a Sunday/holiday, <b>W</b> = Worked (earns a comp-off). Absences are netted against the comp-off balance — paid while the balance lasts, then LOP. Manage the balance in <b>Comp-offs</b>.</div>
    <div id="atHol"></div>
    <div id="atGrid" class="muted" style="margin-top:14px">Loading…</div>`;
  $("atMonth").addEventListener("change",()=>{ window.OPS._hrMonth=$("atMonth").value; attendance(); });
  $("atSave").addEventListener("click",e=>window.OPS.once(e.currentTarget,saveAttendance));

  const first=ym+"-01", last=dateInMonth(ym,monthDays(ym));
  const [{data:emps},{data:hol},{data:rows}]=await Promise.all([
    sb().from("employees").select("id,name,designation").eq("status","active").eq("emp_type","employee").order("name"),
    sb().from("hr_holidays").select("*").gte("holiday_date",first).lte("holiday_date",last).order("holiday_date"),
    sb().from("hr_attendance").select("id,employee_id,work_date,status").gte("work_date",first).lte("work_date",last),
  ]);
  att.ym=ym; att.emps=emps||[]; att.holidays=hol||[]; att.orig={}; att.work={};
  (rows||[]).forEach(r=>{ const k=r.employee_id+"|"+r.work_date; att.orig[k]=r.status; att.work[k]=r.status; });
  const lock = window.OPS.hrMonthLock ? await window.OPS.hrMonthLock(ym) : null;
  att.locked=!!lock;
  if($("atLock")) $("atLock").innerHTML = lock
    ? `<span class="chip" style="background:#fde2e1;border:1px solid #e6a0a0;color:#a11;padding:3px 10px;border-radius:12px;font-weight:700">🔒 Locked — reopen in Salary Records to edit</span>`
    : `<span class="chip" style="background:#e2f6e6;border:1px solid #a6d9b4;color:#137a2e;padding:3px 10px;border-radius:12px">Open</span>`;
  if(lock){ const b=$("atSave"); if(b){ b.disabled=true; b.textContent="Locked 🔒"; b.title="This month is locked."; } }
  renderHolidays(); renderGrid();
}

function holidaySet(){ const s={}; att.holidays.forEach(h=>s[h.holiday_date]=h.name); return s; }

function renderHolidays(){
  const hs=att.holidays;
  $("atHol").innerHTML=`<div class="card" style="padding:12px">
    <b>Holidays — ${att.ym}</b>
    <div class="row" style="margin:8px 0;flex-wrap:wrap">
      <input id="hDate" type="date" min="${att.ym}-01" max="${dateInMonth(att.ym,monthDays(att.ym))}" style="width:auto">
      <input id="hName" placeholder="Holiday name (e.g. Independence Day)" style="min-width:240px">
      <button class="btn sm" id="hAdd">+ Add holiday</button>
      <button class="btn sm ghost" id="hStd">DroCon standard holidays…</button>
    </div>
    ${hs.length?`<div style="display:flex;flex-wrap:wrap;gap:6px">${hs.map(h=>`<span class="chip" style="background:#fff4d6;border:1px solid #e6cf7a;padding:3px 8px;border-radius:12px;font-size:12px">
       ${fmtDate(h.holiday_date)} · ${esc(h.name)} <a href="#" data-delh="${h.id}" style="color:#a11;text-decoration:none;font-weight:700">×</a></span>`).join("")}</div>`
      :'<span class="muted">No holidays declared for this month.</span>'}</div>
    <div id="atStd"></div>`;
  $("hStd").addEventListener("click",stdHolidays);
  $("hAdd").addEventListener("click",async()=>{
    const d=$("hDate").value, n=$("hName").value.trim();
    if(!d){ alert("Pick a date."); return; }
    if(d<att.ym+"-01"||d>dateInMonth(att.ym,monthDays(att.ym))){ alert("Date must be inside "+att.ym+"."); return; }
    if(!n){ alert("Enter a holiday name."); return; }
    const { error }=await sb().from("hr_holidays").insert({ holiday_date:d, name:n, created_by:window.OPS.me.id });
    if(error){ alert(error.code==="23505"?"That date is already a holiday.":error.message); return; }
    window.OPS.audit&&window.OPS.audit("added","hr_holiday",d,n); attendance();
  });
  $("atHol").querySelectorAll("[data-delh]").forEach(a=>a.addEventListener("click",async ev=>{
    ev.preventDefault(); if(!confirm("Remove this holiday? Comp-offs already earned for it stay unless you also clear that day's attendance.")) return;
    await sb().from("hr_holidays").delete().eq("id",a.getAttribute("data-delh")); attendance();
  }));
}

function stdHolidays(){
  const yr=(att.ym||todayISO()).slice(0,4);
  $("atStd").innerHTML=`<div class="card" style="padding:12px;margin-top:10px">
    <div class="row"><b>DroCon standard holidays</b><label style="margin:0 0 0 10px">Year</label><input id="stYear" type="number" value="${yr}" style="width:92px"></div>
    <p class="muted" style="font-size:12px">Enter the date your team has fixed for each holiday this year. The three National days are pre-filled; festival dates change every year. Blank rows are skipped. Saving adds them to the holiday calendar (existing dates are updated).</p>
    <div id="stRows"></div>
    <div class="row" style="margin-top:8px"><button class="btn green sm" id="stSave">Save standard holidays</button><button class="btn sm ghost" id="stClose">Close</button></div></div>`;
  const renderRows=()=>{ const y=$("stYear").value||yr;
    $("stRows").innerHTML=`<div style="overflow:auto"><table><tbody>${DROCON_HOLIDAYS.map((h,i)=>`<tr>
      <td style="white-space:nowrap;padding-right:12px">${esc(h.name)}</td>
      <td><input data-std="${i}" type="date" value="${h.fixed?(y+"-"+h.fixed):""}" min="${y}-01-01" max="${y}-12-31"></td></tr>`).join("")}</tbody></table></div>`; };
  renderRows();
  $("stYear").addEventListener("change",renderRows);
  $("stClose").addEventListener("click",()=>{ $("atStd").innerHTML=""; });
  $("stSave").addEventListener("click",e=>window.OPS.once(e.currentTarget,async()=>{
    const recs=[]; $("stRows").querySelectorAll("input[data-std]").forEach(inp=>{ const d=inp.value;
      if(d) recs.push({ holiday_date:d, name:DROCON_HOLIDAYS[+inp.getAttribute("data-std")].name, created_by:window.OPS.me.id }); });
    if(!recs.length){ alert("Enter at least one date."); return; }
    const { error }=await sb().from("hr_holidays").upsert(recs,{onConflict:"holiday_date"});
    if(error){ alert("Save failed: "+error.message); return; }
    window.OPS.audit&&window.OPS.audit("set","standard_holidays",$("stYear").value,recs.length+" dates");
    window.OPS.flashTop("Saved "+recs.length+" standard holiday date(s) ✓"); attendance();
  }));
}

function cellState(k,isoDate){
  const st=att.work[k];
  if(st==="absent"||st==="worked_off") return st;
  const off = dowOf(isoDate)===0 || (isoDate in holidaySet());
  return off?"off":"present";
}
function nextState(cur,off){
  if(off) return cur==="worked_off"?"":"worked_off";   // off day: Off <-> Worked (W)
  return cur==="absent"?"":"absent";                    // work day: Present (P) <-> Absent (A)
}

function renderGrid(){
  if(!att.emps.length){ $("atGrid").innerHTML='<div class="card muted">No active employees. Add them in <b>Employees</b>.</div>'; return; }
  const nd=monthDays(att.ym), hset=holidaySet();
  const head=[`<th style="position:sticky;left:0;background:var(--charcoal,#222);color:#fff;text-align:left;z-index:2">Employee</th>`];
  for(let d=1;d<=nd;d++){ const iso=dateInMonth(att.ym,d), w=dowOf(iso), off=(w===0)||(iso in hset);
    head.push(`<th title="${DOW[w]}${off?' · day off':''}" style="min-width:26px;padding:2px;${off?'background:#fff4d6':''}">${d}<br><span class="muted" style="font-size:10px">${DOW[w]}</span></th>`); }
  const rowsHtml=att.emps.map(e=>{
    const tds=[];
    for(let d=1;d<=nd;d++){ const isoD=dateInMonth(att.ym,d), k=e.id+"|"+isoD, st=cellState(k,isoD), c=CELL[st];
      tds.push(`<td data-k="${k}" data-d="${isoD}" style="text-align:center;cursor:pointer;user-select:none;padding:2px;background:${c.bg};color:${c.fg};font-weight:700">${c.t||"&nbsp;"}</td>`); }
    return `<tr><td style="position:sticky;left:0;background:var(--paper,#fff);white-space:nowrap"><b>${esc(e.name)}</b></td>${tds.join("")}</tr>`;
  }).join("");
  $("atGrid").innerHTML=`<div style="overflow:auto;max-height:64vh;border:1px solid var(--line,#ddd);border-radius:8px">
    <table class="tt-skip" style="border-collapse:collapse;font-size:13px"><thead><tr>${head.join("")}</tr></thead><tbody>${rowsHtml}</tbody></table></div>
    <div class="muted" style="margin-top:6px;font-size:12px">Legend: <b>P</b> Present · <b>A</b> Absent (day off — netted against comp-off, LOP only if balance runs out) · <b>W</b> Worked on day off (earns comp-off) · <b>·</b> weekly off/holiday. Click to cycle, then <b>Save attendance</b>.</div>`;
  $("atGrid").querySelectorAll("td[data-k]").forEach(td=>td.addEventListener("click",()=>{
    const k=td.getAttribute("data-k"), isoD=td.getAttribute("data-d");
    const off = dowOf(isoD)===0 || (isoD in holidaySet());
    const cur = att.work[k]||"";
    const nx = nextState(cur,off);
    if(nx) att.work[k]=nx; else delete att.work[k];
    const st=cellState(k,isoD), c=CELL[st];
    td.style.background=c.bg; td.style.color=c.fg; td.innerHTML=c.t||"&nbsp;";
  }));
}

async function saveAttendance(){
  const ups=[], dels=[];
  const keys=new Set([...Object.keys(att.orig),...Object.keys(att.work)]);
  keys.forEach(k=>{
    const [empId,date]=k.split("|"); const nw=att.work[k]||"", ol=att.orig[k]||"";
    if(nw===ol) return;
    if(nw) ups.push({ employee_id:empId, work_date:date, status:nw, created_by:window.OPS.me.id });
    else   dels.push({ employee_id:empId, work_date:date });
  });
  if(!ups.length && !dels.length){ window.OPS.flashTop("Nothing changed."); return; }
  if(ups.length){ const { error }=await sb().from("hr_attendance").upsert(ups,{onConflict:"employee_id,work_date"});
    if(error){ alert("Save failed: "+error.message); return; } }
  for(const d of dels){ await sb().from("hr_attendance").delete().eq("employee_id",d.employee_id).eq("work_date",d.work_date); }
  window.OPS.audit&&window.OPS.audit("saved","hr_attendance",att.ym,`${ups.length} set, ${dels.length} cleared`);
  window.OPS.flashTop(`Attendance saved ✓ (${ups.length} updated, ${dels.length} cleared)`);
  attendance();
}

/* ============================ Comp-offs & lapses ============================ */
async function compoff(){
  const ym=ymNow();
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">HR</div><h1>Comp-offs &amp; lapses</h1>
    <div class="row" style="margin:10px 0"><label style="margin:0">Encash in month</label>
      <input id="coMonth" type="month" value="${ym}" style="width:auto">
      <span class="muted" style="font-size:12px">— daily rate = monthly salary ÷ days in this month</span></div>
    <div class="callout">A comp-off must be used or encashed before the end of the calendar quarter it was earned in. <b style="color:#a11">Red</b> = already lapsed, <b style="color:#b8860b">amber</b> = expires this quarter — encash it now or remind the employee to take it.</div>
    <div id="coBody" class="muted">Loading…</div>`;
  $("coMonth").addEventListener("change",()=>{ window.OPS._hrMonth=$("coMonth").value; compoff(); });
  const [{data:emps},{data:credits},{data:absAll}]=await Promise.all([
    sb().from("employees").select("id,name,designation,monthly_salary").eq("status","active").eq("emp_type","employee").order("name"),
    sb().from("hr_comp_offs").select("*").order("earned_on"),
    sb().from("hr_attendance").select("employee_id,work_date").eq("status","absent"),
  ]);
  const credBy={}; (credits||[]).forEach(c=>{ (credBy[c.employee_id]=credBy[c.employee_id]||[]).push(c); });
  const absBy={}; (absAll||[]).forEach(a=>{ (absBy[a.employee_id]=absBy[a.employee_id]||[]).push(a.work_date); });
  const today=todayISO(), qEnd=quarterEnd(today);

  const rows=(emps||[]).map(e=>{
    const sim=window.OPS.simulateLeave(credBy[e.id]||[], absBy[e.id]||[], today);
    const open=sim.credits.filter(c=>c.status==="open");            // available to use / encash
    const expiring=open.filter(c=>c.expires_on<=qEnd);              // must act before quarter-end
    const lapsedCount=sim.credits.filter(c=>c.status==="lapsed").length;
    return { e, earned:sim.earned, taken:sim.taken, covered:sim.coveredTotal, lop:sim.lopTotal,
             encashed:sim.encashed, available:sim.available, avail:open, lapsed:[], expiring, lapsedCount };
  });
  const anyEarned=rows.some(r=>r.earned>0 || r.taken>0);
  $("coBody").innerHTML = anyEarned ? `<div style="overflow:auto"><table><thead><tr>
      <th>Employee</th><th class="num">Earned</th><th class="num">Taken</th><th class="num">Covered</th><th class="num">LOP</th><th class="num">Encashed</th>
      <th class="num">Available</th><th class="num">Lapsable</th><th></th></tr></thead>
    <tbody>${rows.map(r=>`<tr>
      <td><b>${esc(r.e.name)}</b><br><span class="muted">${esc(r.e.designation||'')}</span></td>
      <td class="num">${r.earned}</td><td class="num">${r.taken}</td><td class="num">${r.covered}</td>
      <td class="num">${r.lop?`<span style="color:#a11;font-weight:700">${r.lop}</span>`:'—'}</td><td class="num">${r.encashed}</td>
      <td class="num"><b>${r.available}</b></td>
      <td class="num">${r.expiring.length?`<span style="color:#b8860b;font-weight:700">${r.expiring.length}</span>`:'—'}${r.lapsedCount?` <span class="muted" title="already lapsed">(+${r.lapsedCount} lost)</span>`:''}</td>
      <td>${r.available?`<button class="btn sm" data-mng="${r.e.id}">Manage</button>`:''}</td></tr>`).join("")}</tbody></table></div>`
    : '<div class="card muted">No comp-offs or leave yet. Comp-offs appear when someone is marked <b>W</b> (worked on a Sunday/holiday) in <b>Attendance</b>; absences (<b>A</b>) draw them down.</div>';
  $("coBody").querySelectorAll("[data-mng]").forEach(b=>b.addEventListener("click",()=>manageEmp(rows.find(r=>r.e.id===b.getAttribute("data-mng")))));
}

function manageEmp(r){
  const ym=$("coMonth")?$("coMonth").value:ymNow();
  const rate=Math.round(num(r.e.monthly_salary)/monthDays(ym));
  const today=todayISO(), qEnd=quarterEnd(today);
  const m=$("main");
  const rowFor=c=>{
    const lapsed=c.expires_on<today, expiring=!lapsed&&c.expires_on<=qEnd;
    const tag=lapsed?'<span style="color:#a11;font-weight:700">Lapsed</span>':expiring?'<span style="color:#b8860b;font-weight:700">Expires this quarter</span>':'<span class="muted">Open</span>';
    return `<tr><td>${fmtDate(c.earned_on)}</td><td>${c.source==='sunday'?'Sunday':'Holiday'}</td>
      <td>${fmtDate(c.expires_on)}</td><td>${tag}</td>
      <td><button class="btn sm" data-encash="${c.id}">Encash ₹${rate}</button> <button class="btn sm ghost" data-remind="${c.id}">Remind</button></td></tr>`;
  };
  m.innerHTML=`<button class="btn sm" id="coBack">← Back to Comp-offs</button>
    <div style="margin-top:12px"><h1 style="margin:0">${esc(r.e.name)}</h1>
    <p class="muted">Available comp-offs: <b>${r.available}</b> · encashment daily rate for ${ym}: <b>${money(rate)}</b> (monthly ${money(r.e.monthly_salary)} ÷ ${monthDays(ym)} days)</p>
    <div class="row" style="margin:8px 0"><label style="margin:0">Encash / pay via</label>
      <select id="coMode" style="width:auto"><option>Bank</option><option>UPI</option><option>Cash</option></select>
      ${(r.lapsed.length+r.expiring.length)?`<button class="btn green sm" id="coEncashAll">Encash all ${r.lapsed.length+r.expiring.length} lapsing</button>`:''}</div>
    <div style="overflow:auto"><table><thead><tr><th>Earned</th><th>Source</th><th>Expires</th><th>Status</th><th></th></tr></thead>
      <tbody>${r.avail.map(rowFor).join("")}</tbody></table></div></div>`;
  $("coBack").addEventListener("click",compoff);
  const doEncash=async(credit,mode)=>{
    await sb().from("accounting_entries").insert([
      { voucher_date:today, narration:"Comp-off encashment — "+r.e.name+" (earned "+fmtDate(credit.earned_on)+")",
        account:"Comp-off Encashment", debit:rate, credit:0, ref_type:"comp_off", ref_id:credit.id, created_by:window.OPS.me.id },
      { voucher_date:today, narration:"Comp-off encashment via "+mode,
        account:mode, debit:0, credit:rate, ref_type:"comp_off", ref_id:credit.id, created_by:window.OPS.me.id },
    ]);
    await sb().from("hr_comp_offs").update({ encashed_on:today, encash_amount:rate, encash_month:ym }).eq("id",credit.id);
    window.OPS.audit&&window.OPS.audit("encashed","comp_off",credit.id,money(rate));
  };
  m.querySelectorAll("[data-encash]").forEach(b=>b.addEventListener("click",e=>window.OPS.once(e.currentTarget,async()=>{
    const c=r.avail.find(x=>x.id===b.getAttribute("data-encash")); if(!c) return;
    if(!confirm("Encash this comp-off for "+money(rate)+" via "+$("coMode").value+"?")) return;
    await doEncash(c,$("coMode").value); window.OPS.flashTop("Encashed "+money(rate)+" ✓"); compoff();
  })));
  m.querySelectorAll("[data-remind]").forEach(b=>b.addEventListener("click",()=>{
    const c=r.avail.find(x=>x.id===b.getAttribute("data-remind")); if(!c) return;
    window.OPS.audit&&window.OPS.audit("reminded","comp_off",c.id,r.e.name);
    window.OPS.flashTop("Reminder logged — ask "+r.e.name+" to take the comp-off before "+fmtDate(c.expires_on));
  }));
  if($("coEncashAll")) $("coEncashAll").addEventListener("click",e=>window.OPS.once(e.currentTarget,async()=>{
    const list=[...r.lapsed,...r.expiring]; const mode=$("coMode").value;
    if(!confirm("Encash "+list.length+" comp-off(s) for "+r.e.name+" at "+money(rate)+" each = "+money(rate*list.length)+" via "+mode+"?")) return;
    for(const c of list) await doEncash(c,mode);
    window.OPS.flashTop("Encashed "+list.length+" comp-off(s) ✓"); compoff();
  }));
}

window.OPS.routes.hr_attendance = attendance;
window.OPS.routes.hr_compoff    = compoff;
})();
