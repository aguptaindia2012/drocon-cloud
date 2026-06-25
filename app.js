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
  { key:"agreement",  label:"Agreement" },
  { key:"reviews",    label:"Review / Approvals" },
  { key:"order",      label:"Order Management" },
  { key:"finance",    label:"Finance" },
  { key:"trackers",   label:"Trackers" },
  { key:"dashboards", label:"Dashboards" },
  { key:"hr",         label:"HR" },
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
  // Order Management — pools + sales documents
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
  // Trackers
  { key:"receivables",   section:"trackers", label:"Invoice & Receivables", gate:"perm" },
  { key:"acre",          section:"trackers", label:"Acre Tracking",         gate:"perm" },
  { key:"farmer",        section:"trackers", label:"Farmer Tracking",       gate:"perm" },
  // Dashboards
  { key:"dashboards",          section:"dashboards", label:"Current",                   gate:"perm" },
  { key:"agreement_dashboard", section:"dashboards", label:"Agreement Dashboard",       gate:"perm" },
  { key:"bd_dashboard",        section:"dashboards", label:"Business Development",       gate:"perm" },
  // HR
  { key:"hr_salary",     section:"hr", label:"Salary Calculator",       gate:"perm" },
  { key:"hr_employees",  section:"hr", label:"Employees & Consultants",  gate:"perm" },
  { key:"hr_records",    section:"hr", label:"Salary Records",           gate:"perm" },
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
  // pick a valid landing tool
  if(!canSee(toolByKey(window.OPS.currentTool))) window.OPS.currentTool="agreements";
  window.OPS.currentSection = (toolByKey(window.OPS.currentTool)||{}).section || "agreement";
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

/* ===================== PWA install ===================== */
if("serviceWorker" in navigator && (location.protocol==="https:"||location.protocol==="http:")){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));
}
