/* ============================================================================
   DroCon Cloud — Leads / BD Tracker
   Capture product-purchase leads from any source, log follow-ups, and work a
   reminder dashboard off the next-follow-up date. Built for speed: the add form
   and the follow-up form have NO mandatory fields, so saving never blocks.
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const me = ()=> window.OPS.me;

const SOURCES = [["whatsapp","WhatsApp"],["phone","Phone call"],["facebook","Facebook"],["instagram","Instagram"],["referral","Referral"],["walk_in","Walk-in"],["website","Website"],["other","Other"]];
const SRC_LABEL = Object.fromEntries(SOURCES);
const STATUSES = [["new","New"],["contacted","Contacted"],["interested","Interested"],["quoted","Quoted"],["won","Won"],["lost","Lost"],["on_hold","On hold"]];
const ST_LABEL = Object.fromEntries(STATUSES);
const OPEN = s => s!=="won" && s!=="lost";
const SRC_ICON = { whatsapp:"🟢", phone:"📞", facebook:"📘", instagram:"📸", referral:"🤝", walk_in:"🚶", website:"🌐", other:"•" };

let leads=[], profiles=[];
let F = { bucket:"", q:"", status:"", source:"", owner:"" };
const nameOf = id => { const p=profiles.find(x=>x.id===id); return p?(p.full_name||p.email):""; };
const digits = s => String(s||"").replace(/[^\d]/g,"");
function waLink(phone){ let d=digits(phone); if(!d) return null; if(d.length===10) d="91"+d; return "https://wa.me/"+d; }
function stChip(s){ const cls = s==="won"?"paid":s==="lost"?"rejected":s==="quoted"?"issued":s==="interested"?"approved":s==="on_hold"?"in_review":"default"; return `<span class="chip ${cls}">${esc(ST_LABEL[s]||s)}</span>`; }
function plus(days){ const d=new Date(); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); }
function bucketOf(l){
  if(!OPEN(l.status)) return "done";
  const n=l.next_follow_up; const t=todayISO();
  if(!n) return "nodate";
  if(n<t) return "overdue";
  if(n===t) return "today";
  if(n<=plus(7)) return "week";
  return "later";
}

async function load(){
  const [{ data:ls },{ data:ps }]=await Promise.all([
    sb().from("leads").select("*").order("next_follow_up",{ascending:true,nullsFirst:false}).limit(2000),
    sb().from("profiles").select("id,full_name,email,role").order("full_name")
  ]);
  leads=ls||[]; profiles=ps||[];
}

async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Business Development</div><h1>Leads &amp; Follow-ups</h1>
    <div class="callout">Log every enquiry — WhatsApp, call, Facebook, Instagram, referral, walk-in. Keep it quick:
      <b>nothing is mandatory</b>. Open a lead to add follow-up notes and set the next follow-up date; the dashboard below reminds you what's due.</div>
    <div id="ldDash" class="statrow"></div>
    <div class="row wrap" style="margin:10px 0;gap:8px;align-items:center">
      <button class="btn green sm" id="ldNew">+ New lead</button>
      <input id="ldQ" placeholder="Search name / phone / interest / city…" style="max-width:280px" value="${esc(F.q)}">
      <select id="ldStatus" style="width:auto"><option value="">All status</option>${STATUSES.map(([k,l])=>`<option value="${k}" ${F.status===k?'selected':''}>${esc(l)}</option>`).join("")}</select>
      <select id="ldSource" style="width:auto"><option value="">All sources</option>${SOURCES.map(([k,l])=>`<option value="${k}" ${F.source===k?'selected':''}>${esc(l)}</option>`).join("")}</select>
      <select id="ldOwner" style="width:auto"><option value="">All owners</option>${profiles.map(p=>`<option value="${p.id}" ${F.owner===p.id?'selected':''}>${esc(p.full_name||p.email)}</option>`).join("")}</select>
      ${F.bucket?`<button class="btn sm" id="ldClear">✕ ${esc({overdue:"Overdue",today:"Due today",week:"This week",nodate:"No date set",later:"Upcoming"}[F.bucket]||F.bucket)}</button>`:''}
      <div class="spacer"></div><span class="muted" id="ldCount"></span>
    </div>
    <div id="ldList" class="muted">Loading…</div>`;
  $("ldNew").addEventListener("click",()=>editLead(null));
  $("ldQ").addEventListener("input",()=>{ F.q=$("ldQ").value; render(); });
  $("ldStatus").addEventListener("change",()=>{ F.status=$("ldStatus").value; render(); });
  $("ldSource").addEventListener("change",()=>{ F.source=$("ldSource").value; render(); });
  $("ldOwner").addEventListener("change",()=>{ F.owner=$("ldOwner").value; render(); });
  if($("ldClear")) $("ldClear").addEventListener("click",()=>{ F.bucket=""; view(); });
  renderDash(); render();
}

function renderDash(){
  const b={ overdue:0, today:0, week:0, nodate:0 };
  leads.forEach(l=>{ const k=bucketOf(l); if(b[k]!=null) b[k]++; });
  const card=(key,label,n,bg,fg)=>`<div class="stat clickable" data-b="${key}" style="cursor:pointer;${F.bucket===key?'outline:2px solid var(--green);':''}${bg?('background:'+bg):''}">
    <div class="n" style="${fg?('color:'+fg):''}">${n}</div><div class="l">${label}</div></div>`;
  $("ldDash").innerHTML =
    card("overdue","⚠ Overdue",b.overdue,"#fbe0de","#a3322a")+
    card("today","Due today",b.today,"#fff0db","#9a5b00")+
    card("week","Due this week",b.week,"","")+
    card("nodate","No date set",b.nodate,"","");
  $("ldDash").querySelectorAll("[data-b]").forEach(c=>c.addEventListener("click",()=>{ F.bucket = F.bucket===c.getAttribute("data-b")?"":c.getAttribute("data-b"); view(); }));
}

function matches(l){
  if(F.status && l.status!==F.status) return false;
  if(F.source && l.source!==F.source) return false;
  if(F.owner && String(l.owner||"")!==F.owner) return false;
  if(F.bucket && bucketOf(l)!==F.bucket) return false;
  const q=F.q.toLowerCase().trim();
  if(q && ![l.name,l.phone,l.interest,l.city].some(v=>String(v||"").toLowerCase().includes(q))) return false;
  return true;
}
function render(){
  const list=leads.filter(matches);
  if($("ldCount")) $("ldCount").textContent = list.length+" of "+leads.length+" leads";
  const t=todayISO();
  const fuCell=l=>{ const n=l.next_follow_up; if(!n) return '<span class="muted">—</span>';
    const col = (!OPEN(l.status))?'':(n<t?'color:#a3322a;font-weight:700':(n===t?'color:#9a5b00;font-weight:700':''));
    return `<span style="${col}">${fmtDate(n)}</span>`; };
  $("ldList").innerHTML = list.length?`<div style="overflow:auto"><table><thead><tr>
      <th>Name</th><th>Source</th><th>Interest</th><th>Next follow-up</th><th>Status</th><th>Owner</th><th></th></tr></thead>
    <tbody>${list.map(l=>`<tr class="clickable" data-id="${l.id}">
      <td><b>${esc(l.name||'(no name)')}</b>${l.phone?`<br><span class="muted" style="font-size:12px">${esc(l.phone)}</span>`:''}</td>
      <td>${SRC_ICON[l.source]||''} ${esc(SRC_LABEL[l.source]||l.source||'')}</td>
      <td>${esc(l.interest||'')}</td>
      <td>${fuCell(l)}</td>
      <td>${stChip(l.status)}</td>
      <td>${esc(nameOf(l.owner))}</td>
      <td>${waLink(l.phone)?`<a class="btn sm ghost" href="${waLink(l.phone)}" target="_blank" rel="noopener" title="WhatsApp" onclick="event.stopPropagation()">💬</a> `:''}${l.phone?`<a class="btn sm ghost" href="tel:${esc(digits(l.phone))}" title="Call" onclick="event.stopPropagation()">📞</a>`:''}</td>
    </tr>`).join("")}</tbody></table></div>`
    : '<div class="card muted">No leads match. '+(leads.length?'Clear filters, or ':'')+'<a href="#" id="ldAddHere">add a lead</a>.</div>';
  $("ldList").querySelectorAll("tr[data-id]").forEach(tr=>tr.addEventListener("click",e=>{ if(e.target.closest("a")) return; detail(leads.find(x=>String(x.id)===tr.getAttribute("data-id"))); }));
  if($("ldAddHere")) $("ldAddHere").addEventListener("click",e=>{ e.preventDefault(); editLead(null); });
}

/* ---- add / edit a lead (nothing mandatory) ---- */
function editLead(rec){
  const e=rec||{}; const m=$("main");
  m.innerHTML=`<button class="btn sm" id="leBack">← Back to Leads</button>
    <div class="card" style="margin-top:12px;max-width:620px"><h1>${rec?"Edit lead":"New lead"}</h1>
      <p class="muted">Fill in whatever you have — you can save with just a name or phone and add the rest later.</p>
      <div class="fgrid">
        <div class="field"><label>Name</label><input id="le_name" value="${esc(e.name||'')}"></div>
        <div class="field"><label>Phone</label><input id="le_phone" value="${esc(e.phone||'')}" placeholder="10-digit mobile"></div>
        <div class="field"><label>Source</label><select id="le_source"><option value="">—</option>${SOURCES.map(([k,l])=>`<option value="${k}" ${e.source===k?'selected':''}>${esc(l)}</option>`).join("")}</select></div>
        <div class="field"><label>Owner (BD)</label><select id="le_owner"><option value="">— me —</option>${profiles.map(p=>`<option value="${p.id}" ${e.owner===p.id?'selected':''}>${esc(p.full_name||p.email)}</option>`).join("")}</select></div>
        <div class="field full"><label>Interested in</label><input id="le_interest" value="${esc(e.interest||'')}" placeholder="e.g. 10L spraying drone, spare battery…"></div>
        <div class="field"><label>City / area</label><input id="le_city" value="${esc(e.city||'')}"></div>
        <div class="field"><label>Est. value ₹</label><input id="le_value" type="number" step="any" value="${e.est_value!=null?e.est_value:''}"></div>
        <div class="field"><label>Status</label><select id="le_status">${STATUSES.map(([k,l])=>`<option value="${k}" ${(e.status||'new')===k?'selected':''}>${esc(l)}</option>`).join("")}</select></div>
        <div class="field"><label>Next follow-up</label><input id="le_nfu" type="date" value="${esc((e.next_follow_up||'').slice(0,10))}"></div>
        <div class="field full"><label>Notes</label><textarea id="le_notes" rows="2">${esc(e.notes||'')}</textarea></div>
      </div>
      <div class="row"><button class="btn green" id="leSave">${rec?"Save":"Add lead"}</button><button class="btn" id="leCancel">Cancel</button>
        <div class="spacer"></div>
        ${rec&&(window.OPS.canDelete&&window.OPS.canDelete()||e.created_by===me().id)?'<button class="btn sm" id="leDel" style="color:#a3322a;border-color:#e4b4b4">Delete</button>':''}</div>
      <div class="err" id="leErr"></div></div>`;
  $("leBack").addEventListener("click",view); $("leCancel").addEventListener("click",view);
  $("leSave").addEventListener("click",async()=>{
    const out={ name:$("le_name").value.trim()||null, phone:$("le_phone").value.trim()||null,
      source:$("le_source").value||null, owner:$("le_owner").value||(rec?e.owner:me().id)||null,
      interest:$("le_interest").value.trim()||null, city:$("le_city").value.trim()||null,
      est_value:$("le_value").value===""?null:num($("le_value").value),
      status:$("le_status").value||'new', next_follow_up:$("le_nfu").value||null,
      notes:$("le_notes").value.trim()||null, updated_at:new Date().toISOString() };
    if(!rec && !out.name && !out.phone && !out.interest){ $("leErr").textContent="Add at least a name, phone, or what they want."; return; }
    if(rec){ const { error }=await sb().from("leads").update(out).eq("id",rec.id); if(error){ $("leErr").textContent=error.message; return; } }
    else { out.created_by=me().id; const { error }=await sb().from("leads").insert(out); if(error){ $("leErr").textContent=error.message; return; } }
    window.OPS.flashTop("Saved ✓"); await load(); view();
  });
  if($("leDel")) $("leDel").addEventListener("click",async()=>{ if(!confirm("Delete this lead and its follow-ups?"))return;
    const { error }=await sb().from("leads").delete().eq("id",rec.id); if(error){ alert(error.message); return; }
    window.OPS.flashTop("Deleted ✓"); await load(); view(); });
}

/* ---- lead detail: info + follow-up log + quick log ---- */
async function detail(l){
  if(!l) return; const m=$("main");
  const { data:fus }=await sb().from("lead_followups").select("*").eq("lead_id",l.id).order("created_at",{ascending:false});
  const log=fus||[];
  const wa=waLink(l.phone);
  m.innerHTML=`<button class="btn sm" id="ldBack">← Back to Leads</button>
    <div class="card" style="margin-top:12px">
      <div class="row" style="justify-content:space-between;align-items:flex-start;gap:10px">
        <div><h1 style="margin:0 0 2px">${esc(l.name||'(no name)')}</h1>
          <div class="muted">${SRC_ICON[l.source]||''} ${esc(SRC_LABEL[l.source]||l.source||'—')} ${l.city?('· '+esc(l.city)):''} · ${stChip(l.status)}</div>
          ${l.interest?`<div style="margin-top:4px"><b>Wants:</b> ${esc(l.interest)}</div>`:''}
          ${l.est_value?`<div class="muted">Est. value ${money(l.est_value)}</div>`:''}</div>
        <div style="text-align:right">
          ${l.phone?`<div><b>${esc(l.phone)}</b></div>`:''}
          <div class="row" style="justify-content:flex-end;gap:6px;margin-top:4px">
            ${wa?`<a class="btn sm" href="${wa}" target="_blank" rel="noopener">💬 WhatsApp</a>`:''}
            ${l.phone?`<a class="btn sm" href="tel:${esc(digits(l.phone))}">📞 Call</a>`:''}
            <button class="btn sm" id="ldEdit">Edit</button></div>
          <div class="muted" style="font-size:12px;margin-top:6px">Owner: ${esc(nameOf(l.owner))||'—'}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Log a follow-up</h3>
      <p class="muted" style="margin-top:-4px">Jot what happened and set the next date — all optional.</p>
      <div class="field full"><textarea id="fuNote" rows="2" placeholder="e.g. Called — wants a demo next week, sending quote…"></textarea></div>
      <div class="row wrap" style="gap:8px;align-items:flex-end">
        <div class="field" style="margin:0"><label>Update status</label><select id="fuStatus">${STATUSES.map(([k,s])=>`<option value="${k}" ${l.status===k?'selected':''}>${esc(s)}</option>`).join("")}</select></div>
        <div class="field" style="margin:0"><label>Next follow-up</label><input id="fuNext" type="date" value="${esc((l.next_follow_up||'').slice(0,10))}"></div>
        <div class="row" style="gap:6px"><button class="btn sm" data-snooze="1">+1 day</button><button class="btn sm" data-snooze="3">+3</button><button class="btn sm" data-snooze="7">+1 wk</button></div>
        <div class="spacer"></div>
        <button class="btn green" id="fuSave">Save follow-up</button>
      </div>
      <div class="err" id="fuErr"></div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">History</h3>
      ${log.length?`<div style="display:flex;flex-direction:column;gap:8px">${log.map(f=>`<div style="border-left:3px solid var(--line);padding:2px 0 2px 10px">
        <div class="muted" style="font-size:12px">${fmtDate(f.created_at)} · ${esc(nameOf(f.created_by))}${f.status?(' · '+esc(ST_LABEL[f.status]||f.status)):''}${f.next_follow_up?(' · next '+fmtDate(f.next_follow_up)):''}</div>
        ${f.note?`<div>${esc(f.note)}</div>`:'<div class="muted">(no note)</div>'}</div>`).join("")}</div>`
        :'<div class="muted">No follow-ups yet.</div>'}
      ${l.notes?`<div class="callout" style="margin-top:10px"><b>Lead notes:</b> ${esc(l.notes)}</div>`:''}
    </div>`;
  $("ldBack").addEventListener("click",view);
  $("ldEdit").addEventListener("click",()=>editLead(l));
  m.querySelectorAll("[data-snooze]").forEach(b=>b.addEventListener("click",()=>{ $("fuNext").value=plus(+b.getAttribute("data-snooze")); }));
  $("fuSave").addEventListener("click",async()=>{
    const note=$("fuNote").value.trim()||null, status=$("fuStatus").value, next=$("fuNext").value||null;
    const { error }=await sb().from("lead_followups").insert({ lead_id:l.id, note, status, next_follow_up:next, created_by:me().id });
    if(error){ $("fuErr").textContent=error.message; return; }
    // keep the lead's working fields in step with the latest follow-up
    await sb().from("leads").update({ status, next_follow_up:next, last_contacted:todayISO(), updated_at:new Date().toISOString() }).eq("id",l.id);
    window.OPS.flashTop("Follow-up saved ✓"); await load();
    const fresh=leads.find(x=>String(x.id)===String(l.id)); detail(fresh||l);
  });
}

window.OPS.routes.leads = view;
})();
