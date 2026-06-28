/* ============================================================================
   DroCon Cloud — application core
   Boot, auth, profile, per-tool permissions, two-level navigation, shared
   helpers, notifications. Module files (agreement.js, modules/*.js) register
   their views into OPS.routes and read shared state from window.OPS.
   ============================================================================ */
const $ = id => document.getElementById(id);
const esc = s => (s==null?"":String(s)).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt = d => d ? new Date(d).toLocaleString() : "";
const fmtDate = d => d ? new Date(d).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : "";
const todayISO = () => new Date().toISOString().slice(0,10);
const money = n => "₹" + (Number(n||0)).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const num = n => (n===""||n==null||isNaN(n)) ? 0 : Number(n);

// Indian fiscal year label for a date, e.g. 2026-06-25 -> "26-27"
function fyOf(dateStr){
  const d = dateStr ? new Date(dateStr) : new Date();
  const y = d.getFullYear(), m = d.getMonth(); // Apr (3) starts the FY
  const start = m >= 3 ? y : y - 1;
  return String(start%100).padStart(2,"0") + "-" + String((start+1)%100).padStart(2,"0");
}

// Shared mutable state + a place for modules to hang their views.
window.OPS = { sb:null, me:null, profile:null, perms:new Set(),
  routes:{}, currentSection:"agreement", currentTool:"agreements",
  helpers:{ $, esc, fmt, fmtDate, todayISO, money, num, fyOf } };

let sb=null, me=null, profile=null, signupMode=false;
const STATUS_LABEL={draft:"Draft",in_review:"In review",recommended:"Recommended",approved:"Approved",rejected:"Rejected",executed:"Executed"};

/* ---------- sections + tools registry ----------
   gate: 'all' (any signed-in) | 'approver' | 'admin' | 'perm' (admin or per-tool grant) */
const SECTIONS = [
  { key:"trackers",   label:"Daily Spray Entry" },
  { key:"agreement",  label:"Agreement" },
  { key:"reviews",    label:"Review / Approvals" },
  { key:"order",      label:"Business Development" },
  { key:"finance",    label:"Finance" },
  { key:"dashboards", label:"Dashboards" },
  { key:"hr",         label:"HR" },
  { key:"consultancy",label:"Consultancy" },
  { key:"resources",  label:"Resources" },
  { key:"team",       label:"Team & Access" },
  { key:"audit",      label:"Audit" },
];
const TOOLS = [
  // Agreement (existing studio)
  { key:"agreements", section:"agreement", label:"Agreements",      gate:"all" },
  { key:"new",        section:"agreement", label:"New agreement",   gate:"all" },
  { key:"templates",  section:"agreement", label:"Shared templates",gate:"approver" },
  // Review / Approvals — consolidated queue; everyone sees only their assigned items
  { key:"reviews",    section:"reviews", label:"My Queue",          gate:"all" },
  // Daily Spray Entry (its own section, made the landing tab)
  { key:"daily_entry",   section:"trackers", label:"Daily Spray Entry",     gate:"perm" },
  // Business Development — pools + sales documents
  { key:"orders",        section:"order", label:"Order Tracker",       gate:"all" },
  { key:"partners",      section:"order", label:"Authorized Partners", gate:"all" },
  { key:"quotation",     section:"order", label:"Quotation",           gate:"perm" },
  { key:"bom",           section:"order", label:"BOM Calculator",      gate:"perm" },
  { key:"purchase_order",section:"order", label:"Purchase Order",      gate:"perm" },
  // Finance
  { key:"invoice",       section:"finance", label:"Invoice",       gate:"perm" },
  { key:"credit_note",   section:"finance", label:"Credit Note",    gate:"perm" },
  { key:"clients",       section:"finance", label:"Client",        gate:"perm" },
  { key:"vendors",       section:"finance", label:"Vendors",       gate:"perm" },
  { key:"inventory",     section:"finance", label:"Inventory",     gate:"perm" },
  { key:"catalogues",    section:"finance", label:"Catalogue",     gate:"perm" },
  // Dashboards (Acre & Farmer trackers are dashboards now; receivables consolidated here)
  { key:"receivables",         section:"dashboards", label:"Invoice & Receivables", gate:"perm" },
  { key:"acre",                section:"dashboards", label:"Acre Tracking",         gate:"perm" },
  { key:"farmer",              section:"dashboards", label:"Farmer Tracking",       gate:"perm" },
  { key:"agreement_dashboard", section:"dashboards", label:"Agreement Dashboard",   gate:"perm" },
  { key:"bd_dashboard",        section:"dashboards", label:"Ongoing Sales",         gate:"perm" },
  // HR
  { key:"hr_salary",     section:"hr", label:"Salary Calculator",       gate:"perm" },
  { key:"hr_employees",  section:"hr", label:"Employees",               gate:"perm" },
  { key:"hr_records",    section:"hr", label:"Salary Records",           gate:"perm" },
  { key:"hr_payslips",   section:"hr", label:"Payslips",                 gate:"perm" },
  // Consultancy
  { key:"consultants",   section:"consultancy", label:"Consultants",    gate:"perm" },
  // Resources (policies & shared documents)
  { key:"resources",     section:"resources",   label:"Policies",       gate:"all" },
  // Team & Access + Audit (now top-level, admin-only)
  { key:"team",       section:"team",  label:"Team & Access", gate:"admin" },
  { key:"audit",      section:"audit", label:"Audit log",     gate:"admin" },
  { key:"access_log", section:"audit", label:"Access Log",    gate:"admin" },
];
window.OPS.TOOLS = TOOLS; window.OPS.SECTIONS = SECTIONS;
// Tools whose access an admin can grant (the per-tool permission set)
window.OPS.PERMISSIONED_TOOLS = TOOLS.filter(t=>t.gate==="perm");
// Capabilities = grantable permissions that are NOT navigable tabs (shown in Team & Access)
const CAPABILITIES = [
  { key:"view_contacts", label:"View contacts (unmask phone numbers)" },
  { key:"can_export",    label:"Export data (CSV)" },
  { key:"can_delete",    label:"Delete records" },
];
window.OPS.CAPABILITIES = CAPABILITIES;

// ---------- boot ----------
(function boot(){
  if(!window.DCB_CONFIG || !window.DCB_CONFIG.SUPABASE_URL || window.DCB_CONFIG.SUPABASE_URL.indexOf("YOUR-")>=0){
    $("auConfigWarn").textContent="⚠ config.js is missing your Supabase URL/key. See SETUP_OPS.md.";
    $("auGo").disabled=true; return;
  }
  sb = supabase.createClient(window.DCB_CONFIG.SUPABASE_URL, window.DCB_CONFIG.SUPABASE_ANON_KEY);
  window.OPS.sb = sb;
  sb.auth.onAuthStateChange((_e, session)=>{ me = session ? session.user : null; window.OPS.me=me; if(me) afterLogin(); else showAuth(); });
  sb.auth.getSession().then(({data})=>{ me = data.session ? data.session.user : null; window.OPS.me=me; if(me) afterLogin(); else showAuth(); });
})();

function showAuth(){ $("appView").classList.add("hidden"); $("authView").classList.remove("hidden"); }

let _loadingProfile=false;
async function loadProfile(){
  for(let i=0;i<8;i++){
    const { data } = await sb.from("profiles").select("*").eq("id", me.id).maybeSingle();
    if(data) return data;
    await new Promise(r=>setTimeout(r, 400));
  }
  return null;
}
async function loadPerms(){
  const { data } = await sb.from("app_permissions").select("tool_key").eq("user_id", me.id);
  window.OPS.perms = new Set((data||[]).map(r=>r.tool_key));
}
async function afterLogin(){
  if(_loadingProfile) return; _loadingProfile=true;
  let data=null;
  try{ data = await loadProfile(); }catch(e){}
  _loadingProfile=false;
  profile = data || { id:me.id, email:me.email, role:"drafter", full_name:me.email };
  window.OPS.profile = profile;
  try{ await loadPerms(); }catch(e){}
  $("authView").classList.add("hidden"); $("appView").classList.remove("hidden");
  applyProfile();
}
function applyProfile(){
  $("meEmail").textContent = profile.email || me.email;
  $("meRole").textContent = (profile.role||"drafter").toUpperCase();
  // pick a valid landing tool — default to the first visible tool (Daily Spray Entry)
  if(!canSee(toolByKey(window.OPS.currentTool))){
    const firstSec = SECTIONS.find(s=>TOOLS.some(t=>t.section===s.key && canSee(t)));
    const firstTool = firstSec && TOOLS.find(t=>t.section===firstSec.key && canSee(t));
    window.OPS.currentTool = firstTool ? firstTool.key : "agreements";
  }
  window.OPS.currentSection = (toolByKey(window.OPS.currentTool)||{}).section || "trackers";
  renderNav();
  openTool(window.OPS.currentTool);
  refreshNotifs();
  if(!window._notifPoll) window._notifPoll=setInterval(()=>{ if(me) refreshNotifs(); }, 30000);
}
async function refreshRole(){
  const data = await loadProfile();
  if(data){ profile = data; window.OPS.profile=profile; await loadPerms(); applyProfile(); }
}

// ---------- auth UI ----------
$("auToggle").addEventListener("click",e=>{ e.preventDefault(); signupMode=!signupMode;
  $("authTitle").textContent = signupMode?"Create account":"Sign in";
  $("auGo").textContent = signupMode?"Create account":"Sign in";
  $("auNameField").classList.toggle("hidden", !signupMode);
  $("auToggleText").textContent = signupMode?"Already have an account?":"New to the workspace?";
  $("auToggle").textContent = signupMode?"Sign in":"Create an account";
  $("auErr").textContent="";
});
$("auGo").addEventListener("click", async ()=>{
  const email=$("auEmail").value.trim(), pass=$("auPass").value;
  $("auErr").textContent=""; if(!email||!pass){ $("auErr").textContent="Enter email and password."; return; }
  $("auGo").disabled=true;
  try{
    if(signupMode){
      const { error } = await sb.auth.signUp({ email, password:pass, options:{ data:{ full_name:$("auName").value.trim() } } });
      if(error) throw error;
      $("auErr").innerHTML='<span class="ok">Account created. If email confirmation is on, check your inbox; otherwise you are now signed in.</span>';
    }else{
      const { error } = await sb.auth.signInWithPassword({ email, password:pass });
      if(error) throw error;
    }
  }catch(err){ $("auErr").textContent = err.message || "Authentication failed."; }
  $("auGo").disabled=false;
});
$("btnSignOut").addEventListener("click", async ()=>{ await sb.auth.signOut(); });
(function(){ const r=$("meRole"); if(r){ r.style.cursor="pointer"; r.title="Click to refresh your role & access"; r.addEventListener("click", ()=>{ if(me) refreshRole(); }); } })();

// ---------- role + permission helpers ----------
const isAdmin    = ()=> profile && profile.role==="admin";
const isApprover = ()=> profile && (profile.role==="admin"||profile.role==="approver");
const canViewContacts = ()=> isAdmin() || window.OPS.perms.has("view_contacts");
const canExport = ()=> isAdmin() || window.OPS.perms.has("can_export");
const canDelete = ()=> isAdmin() || window.OPS.perms.has("can_delete");
window.OPS.canExport=canExport; window.OPS.canDelete=canDelete;
function maskPhone(v){ if(v==null||v==="") return ""; if(canViewContacts()) return v; const d=String(v).replace(/\D/g,""); return d.length<=3 ? "•••" : ("•••••• "+d.slice(-3)); }
window.OPS.isAdmin=isAdmin; window.OPS.isApprover=isApprover;
window.OPS.canViewContacts=canViewContacts; window.OPS.helpers.maskPhone=maskPhone;
function toolByKey(k){ return TOOLS.find(t=>t.key===k); }
function canSee(tool){
  if(!tool) return false;
  if(tool.gate==="admin")    return isAdmin();
  if(tool.gate==="approver") return isApprover();
  if(tool.gate==="perm")     return isAdmin() || window.OPS.perms.has(tool.key);
  return true; // 'all'
}
window.OPS.canSee = canSee;

// ---------- two-level navigation ----------
function visibleSections(){
  return SECTIONS.filter(s => TOOLS.some(t=>t.section===s.key && canSee(t)));
}
function renderNav(){
  // top section bar
  const secs = visibleSections();
  $("sectionBar").innerHTML = secs.map(s=>
    `<button data-sec="${s.key}" class="${s.key===window.OPS.currentSection?'active':''}">${esc(s.label)}</button>`).join("");
  $("sectionBar").querySelectorAll("[data-sec]").forEach(b=>b.addEventListener("click",()=>openSection(b.getAttribute("data-sec"))));
  // sub-tabs for the active section
  const tools = TOOLS.filter(t=>t.section===window.OPS.currentSection && canSee(t));
  $("nav").innerHTML = tools.map(t=>
    `<button data-tab="${t.key}" class="${t.key===window.OPS.currentTool?'active':''}">${esc(t.label)}${t.phase?` <span class="soon">soon</span>`:''}</button>`).join("");
  $("nav").querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>openTool(b.getAttribute("data-tab"))));
}
function openSection(secKey){
  window.OPS.currentSection = secKey;
  const first = TOOLS.find(t=>t.section===secKey && canSee(t));
  if(first) openTool(first.key); else renderNav();
}
function openTool(key){
  const tool = toolByKey(key);
  if(!tool || !canSee(tool)){ return; }
  window.OPS.currentTool = key;
  window.OPS.currentSection = tool.section;
  renderNav();
  const view = window.OPS.routes[key];
  if(view){ try{ view(); }catch(e){ $("main").innerHTML='<div class="card">Error: '+esc(e.message)+'</div>'; console.error(e); } }
  else { $("main").innerHTML = comingSoon(tool); }
}
window.OPS.openTool = openTool; window.OPS.openSection = openSection; window.OPS.renderNav = renderNav;

function comingSoon(tool){
  return `<div class="eyebrow">${esc(SECTIONS.find(s=>s.key===tool.section).label)}</div><h1>${esc(tool.label)}</h1>
    <div class="callout warn">This module is being built — its navigation slot is in place and it will appear here once ready.</div>`;
}

// ---------- shared data helpers ----------
async function audit(action, entity, entity_id, note){
  try{ await sb.from("audit_log").insert({ actor:me.id, action, entity, entity_id:String(entity_id||""), note:note||null }); }catch(e){}
}
async function listProfiles(){ const {data}=await sb.from("profiles").select("*").order("created_at"); return data||[]; }
window.OPS.audit=audit; window.OPS.listProfiles=listProfiles;

function statusChip(s){ return `<span class="chip ${s}">${STATUS_LABEL[s]||s}</span>`; }
window.OPS.statusChip = statusChip;

// ---------- file save (Word/JSON downloads) ----------
async function saveBlob(blob, filename, mime, ext){
  if(window.showSaveFilePicker){
    try{
      const handle = await window.showSaveFilePicker({ suggestedName:filename,
        types:[{description:mime||"File", accept:{[mime||"application/octet-stream"]:[ext||""]}}] });
      const w = await handle.createWritable(); await w.write(blob); await w.close();
      flashTop("Saved: "+filename); return;
    }catch(e){ if(e && e.name==="AbortError"){ return; } }
  }
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
  flashTop("Downloaded: "+filename);
}
window.OPS.saveBlob = saveBlob;

function flashTop(msg){ let t=$("toast"); if(!t){ t=document.createElement("div"); t.id="toast";
  t.style.cssText="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--green);color:#fff;padding:9px 16px;border-radius:8px;font-weight:700;z-index:120;box-shadow:0 8px 20px rgba(0,0,0,.25)"; document.body.appendChild(t); }
  t.textContent=msg; t.style.opacity="1"; setTimeout(()=>{ t.style.transition="opacity .5s"; t.style.opacity="0"; },1800); }
window.OPS.flashTop = flashTop;

/* ===================== Notifications ===================== */
let _notifs=[];
async function refreshNotifs(){
  if(!me) return;
  const { data }=await sb.from("notifications").select("*").order("created_at",{ascending:false}).limit(50);
  _notifs=data||[];
  const unread=_notifs.filter(n=>!n.is_read).length;
  const c=$("bellCount"); if(c){ c.textContent=unread; c.style.display=unread?"inline-block":"none"; }
}
function renderNotifs(){
  const host=$("notifList"); if(!host) return;
  host.innerHTML = _notifs.length ? _notifs.map(n=>`<div data-nid="${n.id}" data-ag="${n.agreement_id||''}" style="padding:9px 14px;border-bottom:1px solid var(--line);cursor:pointer;${n.is_read?'opacity:.6':'background:#fbfdf8'}">
      <div style="font-size:13px">${esc(n.message)}</div><div class="muted" style="font-size:11px">${fmt(n.created_at)}</div></div>`).join("")
    : '<div class="muted" style="padding:14px">No notifications.</div>';
  host.querySelectorAll("[data-nid]").forEach(el=>el.addEventListener("click",async()=>{
    const nid=el.getAttribute("data-nid"), ag=el.getAttribute("data-ag");
    await sb.from("notifications").update({is_read:true}).eq("id",nid);
    $("notifPanel").classList.add("hidden"); refreshNotifs();
    if(ag && window.OPS.routes.viewAgreementDetail){ openTool("agreements"); window.OPS.routes.viewAgreementDetail(ag); }
  }));
}
function toggleNotif(){ const p=$("notifPanel"); if(p.classList.contains("hidden")){ renderNotifs(); p.classList.remove("hidden"); } else p.classList.add("hidden"); }
async function markAllRead(){ await sb.from("notifications").update({is_read:true}).eq("user_id",me.id).eq("is_read",false); refreshNotifs(); renderNotifs(); }
window.OPS.refreshNotifs = refreshNotifs;
(function(){ const b=$("bell"); if(b) b.addEventListener("click",toggleNotif);
  const mk=$("notifMark"); if(mk) mk.addEventListener("click",markAllRead); })();

/* ===================== Top-bar utilities (Calculator / Calendar / Privacy) ===================== */
function openCalc(){
  const w=window.open("","dcbCalc","width=300,height=430");
  if(!w){ alert("Allow pop-ups to open the calculator."); return; }
  w.document.write(`<!doctype html><title>Calculator</title><style>
    body{font-family:Lato,system-ui,Arial;margin:0;background:#282828}
    #d{color:#fff;text-align:right;font-size:30px;padding:18px 14px;min-height:46px;word-break:break-all}
    .g{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#444}
    button{border:none;font-size:20px;padding:18px 0;background:#3a3a3a;color:#fff;cursor:pointer}
    button:hover{background:#4a4a4a}.op{background:#F48A1C}.eq{background:#599533}.fn{background:#555}
    </style><div id="d">0</div><div class="g" id="g"></div><script>
    var e="";function p(v){if(v==="="){try{e=String(Function("return ("+e.replace(/[^-()\\d/*+.%]/g,"")+")")());}catch(_){e="Error";}}
    else if(v==="C"){e="";}else if(v==="back"){e=e.slice(0,-1);}else{e+=v;}d.textContent=e||"0";}
    var keys=["C","back","%","/","7","8","9","*","4","5","6","-","1","2","3","+","0",".","="];
    var g=document.getElementById("g"),d=document.getElementById("d");
    keys.forEach(function(k){var b=document.createElement("button");b.textContent=k==="back"?"⌫":k;
      b.className=(["/","*","-","+"].indexOf(k)>=0?"op":k==="="?"eq":["C","back","%"].indexOf(k)>=0?"fn":"");
      b.onclick=function(){p(k);};g.appendChild(b);});
    document.addEventListener("keydown",function(ev){var k=ev.key;if(k==="Enter")p("=");else if(k==="Backspace")p("back");else if(k==="Escape")p("C");else if("0123456789.+-*/%".indexOf(k)>=0)p(k);});
    <\/script>`);
  w.document.close();
}
function openCalendar(){
  const w=window.open("","dcbCal","width=340,height=360");
  if(!w){ alert("Allow pop-ups to open the calendar."); return; }
  const now=new Date();
  w.document.write(`<!doctype html><title>Calendar</title><style>
    body{font-family:Lato,system-ui,Arial;margin:0;padding:12px;color:#282828}
    .hd{display:flex;align-items:center;gap:8px;margin-bottom:8px}.hd b{flex:1;text-align:center;color:#599533;font-size:16px}
    button{border:1px solid #e2e6df;background:#fff;border-radius:6px;cursor:pointer;padding:4px 9px}
    table{width:100%;border-collapse:collapse}td,th{text-align:center;padding:7px 0;font-size:13px}
    th{color:#7a8071;font-size:11px}td.t{background:#599533;color:#fff;border-radius:50%}
    </style><div class="hd"><button onclick="m(-1)">‹</button><b id="lbl"></b><button onclick="m(1)">›</button></div>
    <table><thead><tr><th>S</th><th>M</th><th>T</th><th>W</th><th>T</th><th>F</th><th>S</th></tr></thead><tbody id="b"></tbody></table>
    <script>var y=${now.getFullYear()},mo=${now.getMonth()},td=${now.getDate()};
    function m(d){mo+=d;if(mo<0){mo=11;y--;}if(mo>11){mo=0;y++;}r();}
    function r(){var f=new Date(y,mo,1).getDay(),n=new Date(y,mo+1,0).getDate();
      document.getElementById("lbl").textContent=new Date(y,mo,1).toLocaleString("en",{month:"long",year:"numeric"});
      var h="<tr>",c=0,i;for(i=0;i<f;i++){h+="<td></td>";c++;}
      for(var day=1;day<=n;day++){if(c%7===0&&c>0)h+="</tr><tr>";var t=(day===td&&mo===${now.getMonth()}&&y===${now.getFullYear()})?" class='t'":"";h+="<td"+t+">"+day+"</td>";c++;}
      h+="</tr>";document.getElementById("b").innerHTML=h;}
    r();<\/script>`);
  w.document.close();
}
function openPrivacy(){
  const b=$("privacyBody"); if(!b) return;
  b.innerHTML=`<p class="muted">How DroCon Cloud protects your data.</p>
    <div class="callout"><b>Encryption:</b> HTTPS in transit, AES-256 at rest (Supabase).</div>
    <ul style="font-size:13px;line-height:1.7">
      <li><b>Access:</b> not signed in = no access. Sign-up is restricted to approved company domains.</li>
      <li><b>Row-Level Security</b> is enforced by the database — the browser cannot bypass it.</li>
      <li><b>Sensitive data</b> (salaries, bank details, farmer phone numbers) is readable only by admins or staff you grant access in <b>Team &amp; Access</b>.</li>
      <li><b>Phone numbers</b> are masked in lists unless you hold the “View contacts” grant.</li>
      <li><b>Access log:</b> opening sensitive records is recorded (admins can review under Audit → Access Log).</li>
      <li><b>Deletions</b> are restricted and recorded in the Audit log.</li>
    </ul>
    <p class="muted">You are signed in as <b>${esc((profile&&profile.email)||(me&&me.email)||"")}</b> · role <b>${esc((profile&&profile.role)||"")}</b>.</p>`;
  $("privacyOverlay").classList.remove("hidden");
}
(function(){
  const c=$("btnCalc"); if(c) c.addEventListener("click",openCalc);
  const cal=$("btnCalendar"); if(cal) cal.addEventListener("click",openCalendar);
  const p=$("btnPrivacy"); if(p) p.addEventListener("click",openPrivacy);
  const pc=$("privClose"); if(pc) pc.addEventListener("click",()=>$("privacyOverlay").classList.add("hidden"));
  const po=$("privacyOverlay"); if(po) po.addEventListener("click",e=>{ if(e.target.id==="privacyOverlay") po.classList.add("hidden"); });
})();

/* ===================== PWA install ===================== */
if("serviceWorker" in navigator && (location.protocol==="https:"||location.protocol==="http:")){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));
}
