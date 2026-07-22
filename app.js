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
  routes:{}, currentSection:null, currentTool:"home",
  helpers:{ $, esc, fmt, fmtDate, todayISO, money, num, fyOf } };

let sb=null, me=null, profile=null, signupMode=false;
const STATUS_LABEL={draft:"Draft",in_review:"In review",recommended:"Recommended",approved:"Approved",rejected:"Rejected",executed:"Executed",issued:"Issued",partial:"Part paid",paid:"Paid"};

/* ---------- sections + tools registry ----------
   gate: 'all' (any signed-in) | 'approver' | 'admin' | 'perm' (admin or per-tool grant) */
const SECTIONS = [
  { key:"reviews",    label:"Review / Approvals" },   // sits right after Home
  { key:"trackers",   label:"Daily Spray Entry" },
  { key:"order",      label:"Business Development" },
  { key:"agreement",  label:"Agreement" },
  { key:"finance",    label:"Finance" },
  { key:"accounting", label:"Accounting" },
  { key:"inventory",  label:"Inventory" },
  { key:"hr",         label:"HR" },
  // registers of who/where everything else selects from, plus reference material
  { key:"resources",  label:"Registers" },
  { key:"team",       label:"Team & Access" },
  { key:"audit",      label:"Audit" },
  { key:"portal",     label:"Partner Portal" },   // external (invite-only) logins only
];
const TOOLS = [
  // Daily Spray Entry (its own section, the landing tab)
  // (Daily approvals are surfaced in the consolidated Review / Approvals tab.)
  // Review / Approvals — consolidated queue; everyone sees only their assigned items
  { key:"reviews",    section:"reviews", label:"My Queue",          gate:"all" },
  // Daily Spray Entry — the trackers lead, then entry and reporting
  { key:"acre",            section:"trackers", label:"Acre Tracking",     gate:"perm" },
  { key:"farmer",          section:"trackers", label:"Farmer Tracking",   gate:"perm" },
  { key:"daily_entry",     section:"trackers", label:"Daily Spray Entry", gate:"perm" },
  { key:"entries",         section:"trackers", label:"Entries",           gate:"perm" },
  { key:"vendor_report",   section:"trackers", label:"Vendor Statement",  gate:"perm" },
  // (Farmer Bulk Entry is a sub-sub tab under Entries → Farmer sprays)
  // Business Development — Authorized Partners home, orders + sales documents
  { key:"bd_dashboard",     section:"order", label:"Ongoing Sales",   gate:"perm" },
  { key:"partners",         section:"order", label:"Authorized Partners",      gate:"all" },
  { key:"ap_rates",         section:"order", label:"Authorized Partner Rates", gate:"perm" },
  { key:"partner_invoices", section:"order", label:"Partner Invoices",         gate:"perm" },
  { key:"orders",           section:"order", label:"Order Tracker",   gate:"all" },
  { key:"quotation",        section:"order", label:"Quotation",       gate:"perm" },
  { key:"bom",              section:"order", label:"BOM Calculator",  gate:"perm" },
  // Agreement — dashboard first
  { key:"agreement_dashboard", section:"agreement", label:"Agreement Dashboard", gate:"perm" },
  { key:"agreements",       section:"agreement", label:"Agreements",      gate:"all" },
  { key:"new",              section:"agreement", label:"New agreement",   gate:"all" },
  { key:"templates",        section:"agreement", label:"Shared templates",gate:"approver" },
  // Finance — receivables first
  { key:"receivables",   section:"finance", label:"Invoice & Receivables", gate:"perm" },
  { key:"invoice",       section:"finance", label:"Invoice",        gate:"perm" },
  { key:"acre_invoice",  section:"finance", label:"Acre Invoicing", gate:"perm" },
  { key:"credit_note",   section:"finance", label:"Credit Note",    gate:"perm" },
  { key:"purchase_order",section:"finance", label:"Purchase Order", gate:"perm" },
  { key:"payment_status",section:"finance", label:"Payment Status", gate:"perm" },
  // Accounting — internal money out + daily reconciliation
  { key:"day_book",     section:"accounting", label:"Day Book",           gate:"perm" },
  { key:"expense_mgmt", section:"accounting", label:"Expense Management", gate:"perm" },
  // Inventory
  { key:"inventory",     section:"inventory", label:"Inventory",    gate:"perm" },
  { key:"catalogues",    section:"inventory", label:"Catalogue",    gate:"perm" },
  // HR
  { key:"hr_salary",     section:"hr", label:"Salary Calculator",  gate:"perm" },
  { key:"hr_employees",  section:"hr", label:"Employees",          gate:"perm" },
  { key:"hr_records",    section:"hr", label:"Salary Records",     gate:"perm" },
  { key:"hr_payslips",   section:"hr", label:"Payslips",           gate:"perm" },
  // Registers — the records every other screen selects from, then the
  // reference material (policies, manual & FAQs)
  { key:"clients",       section:"resources", label:"Client",       gate:"perm" },
  { key:"vendors",       section:"resources", label:"Vendors",      gate:"perm" },
  { key:"pilots_master", section:"resources", label:"Pilots",       gate:"perm" },
  { key:"locations",     section:"resources", label:"Locations",    gate:"perm" },
  { key:"consultants",   section:"resources", label:"Consultants",  gate:"perm" },
  { key:"resources",     section:"resources", label:"Policies",     gate:"all" },
  { key:"manual",        section:"resources", label:"User Manual",  gate:"all" },
  { key:"faqs",          section:"resources", label:"FAQs",         gate:"all" },
  // Team & Access + Audit (admin-only)
  { key:"team",       section:"team",  label:"Team & Access", gate:"admin" },
  { key:"audit",      section:"audit", label:"Audit log",     gate:"admin" },
  { key:"access_log", section:"audit", label:"Access Log",    gate:"admin" },
  // Partner Portal — visible ONLY to external (invite-only) partner logins
  { key:"portal_submit", section:"portal", label:"Submit Invoice", gate:"external" },
  { key:"portal_mine",   section:"portal", label:"My Invoices",    gate:"external" },
  { key:"portal_help",   section:"portal", label:"Help & FAQs",    gate:"external" },
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
  // IMPORTANT: only (re)initialise the app when the *logged-in user* actually changes.
  // Supabase fires onAuthStateChange for TOKEN_REFRESHED / focus / etc.; re-running
  // afterLogin() on those would re-render the screen and wipe whatever you're typing.
  sb.auth.onAuthStateChange((_e, session)=>{ handleSession(session); });
  sb.auth.getSession().then(({data})=>{ handleSession(data.session); });
})();

let _authedUserId = null;
function handleSession(session){
  const u = session ? session.user : null;
  me = u; window.OPS.me = u;
  if(!u){ _authedUserId = null; showAuth(); return; }
  if(_authedUserId === u.id) return;   // already initialised for this user — ignore repeat events
  _authedUserId = u.id;
  afterLogin();
}

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
  $("meRole").textContent = isExternal() ? "PARTNER" : (profile.role||"drafter").toUpperCase();
  // always land on Home after a login or refresh
  goHome();
  refreshNotifs(); refreshReviewCount();
  if(!window._notifPoll) window._notifPoll=setInterval(()=>{ if(me){ refreshNotifs(); refreshReviewCount(); } }, 30000);
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
  }catch(err){
    $("auErr").textContent = authErrorText(err, signupMode); console.error("Auth error:", err);
    // If it looks like a connectivity failure, run the self-test automatically.
    const m=String((err&&(err.message||""))||"");
    if(/fetch|network/i.test(m) || (err&&err.name==="AuthRetryableFetchError")) diagnoseConnection();
  }
  $("auGo").disabled=false;
});
// Connection self-test — tells the user (on THEIR device/network) exactly why a
// login can't reach Supabase: blocked by extension/VPN/firewall, wrong key, or fine.
async function diagnoseConnection(){
  const box=$("auDiag"); if(!box) return;
  const cfg=window.DCB_CONFIG||{};
  const url=(cfg.SUPABASE_URL||"").replace(/\/+$/,"");
  const key=cfg.SUPABASE_ANON_KEY||"";
  if(!url){ box.style.color="#a3322a"; box.innerHTML="✗ config.js has no Supabase URL."; return; }
  box.style.color="var(--muted)"; box.innerHTML="Testing connection to the server…";
  try{
    const r=await fetch(url+"/auth/v1/health",{ headers:{ apikey:key, Authorization:"Bearer "+key } });
    if(r.ok){ box.style.color="var(--green)";
      box.innerHTML="✓ Reached the server successfully. The connection is fine — if sign-in still fails it's the email/password (or email-confirmation), not the network."; }
    else{ box.style.color="#9a5b00";
      box.innerHTML="⚠ Reached the server but it replied HTTP "+r.status+". The project is up; the API key in config.js may be wrong or auth is misconfigured."; }
  }catch(e){
    box.style.color="#a3322a";
    box.innerHTML="✗ This device could <b>not reach</b> "+esc(url)+".<br>Almost always an <b>ad-blocker, VPN, firewall or browser extension</b> on this network is blocking it. Try an <b>incognito window with extensions off</b>, or a different network (e.g. mobile hotspot).";
  }
}
(function(){ const t=$("auTest"); if(t) t.addEventListener("click",e=>{ e.preventDefault(); diagnoseConnection(); }); })();
// Turn an opaque Supabase auth error (sometimes just "{}") into something readable.
function authErrorText(err, isSignup){
  let msg = (err && (err.message || err.error_description || err.msg)) || "";
  msg = String(msg).trim();
  if(msg==="{}" || msg==="[object Object]" || msg==="") msg="";
  const code = (err && (err.code || err.error || "")) + "";
  const status = err && (err.status || err.statusCode);
  if(/already|exists|registered/i.test(msg) || code==="user_already_exists" || status===422)
    return "That email is already registered — use “Sign in” instead (or reset the password in Supabase).";
  if(/signup|disabled|not allowed/i.test(msg) || code==="signup_disabled")
    return "Sign-ups are disabled for this workspace. Ask the admin to enable them in Supabase → Authentication → Providers, or have the admin invite you.";
  if(/invalid login|invalid credentials/i.test(msg) || code==="invalid_credentials")
    return "Wrong email or password.";
  if(/confirm|email/i.test(msg) && /send|smtp|deliver/i.test(msg))
    return "The confirmation email couldn't be sent (SMTP not configured). Turn off email confirmation in Supabase, or configure SMTP.";
  if(/fetch|network/i.test(msg) || (err&&err.name==="AuthRetryableFetchError"))
    return "Couldn't reach the server. Check your connection and that config.js points to the right Supabase URL.";
  if(msg) return msg + (status?(" (status "+status+")"):"");
  // No usable message — most common cause for a blank/{} error here:
  return isSignup
    ? "Sign-up couldn't complete"+(status?(" (status "+status+")"):"")+". This email may already be registered — try “Sign in” — or sign-ups may be disabled/restricted for this workspace."
    : "Sign-in failed"+(status?(" (status "+status+")"):"")+". Check the email and password, or that this account exists on this Supabase project.";
}
$("btnSignOut").addEventListener("click", async ()=>{ await sb.auth.signOut(); });
(function(){ const r=$("meRole"); if(r){ r.style.cursor="pointer"; r.title="Click to refresh your role & access"; r.addEventListener("click", ()=>{ if(me) refreshRole(); }); } })();

// ---------- role + permission helpers ----------
const isAdmin    = ()=> profile && profile.role==="admin" && !profile.is_external;
const isApprover = ()=> profile && !profile.is_external && (profile.role==="admin"||profile.role==="approver");
const isExternal = ()=> profile && profile.is_external===true;
window.OPS.isExternal = isExternal;
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
  // External (invite-only) partner logins are sandboxed to the Partner Portal only.
  if(isExternal()) return tool.gate==="external";
  if(tool.gate==="external") return false;
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
  // top section bar — Home is the first tab
  const secs = visibleSections();
  const homeBtn = `<button data-sec="__home" class="${window.OPS.currentTool==='home'?'active':''}">🏠 Home</button>`;
  $("sectionBar").innerHTML = homeBtn + secs.map(s=>{
    const badge = (s.key==="reviews" && window.OPS.reviewCount) ? ` <span style="background:var(--orange);color:#fff;border-radius:999px;padding:1px 7px;font-size:11px;margin-left:4px">🔔 ${window.OPS.reviewCount}</span>` : "";
    return `<button data-sec="${s.key}" class="${(window.OPS.currentTool!=='home' && s.key===window.OPS.currentSection)?'active':''}">${esc(s.label)}${badge}</button>`;
  }).join("");
  $("sectionBar").querySelectorAll("[data-sec]").forEach(b=>b.addEventListener("click",()=>{
    const k=b.getAttribute("data-sec"); if(k==="__home") goHome(); else openSection(k); }));
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

// ---------- post-login landing page ----------
function renderHome(){
  window.OPS.currentTool="home"; window.OPS.currentSection=null;
  const ext=isExternal();
  const name=esc((profile&&(profile.full_name||profile.email))||(me&&me.email)||"");
  const secs=visibleSections();
  let cards="";
  secs.forEach(s=>{
    const tools=TOOLS.filter(t=>t.section===s.key && canSee(t));
    if(!tools.length) return;
    const badge = (s.key==="reviews" && window.OPS.reviewCount) ? `<span class="navcard-badge">🔔 ${window.OPS.reviewCount}</span>` : "";
    cards+=`<div class="card navcard">
      <div class="navcard-h"><span class="eyebrow">${esc(s.label)}</span>${badge}</div>
      <div class="navlist">
        ${tools.map(t=>`<button class="navrow" data-go="${t.key}"><span>${esc(t.label)}</span><span class="navrow-arrow">›</span></button>`).join("")}
      </div></div>`;
  });
  const helpBtns = ext
    ? `<button class="btn sm green" data-go="portal_help">💬 Help &amp; FAQs</button>`
    : `<button class="btn sm green" data-go="manual">📖 User Manual</button> <button class="btn sm" data-go="faqs">❓ FAQs</button>`;
  $("main").innerHTML=`
    <div class="eyebrow">DroCon Cloud · Operations Suite</div>
    <h1 style="margin-bottom:2px">Welcome${name?(", "+name):""}</h1>
    <p class="muted">Select a module from the directory below. Return here anytime with the 🏠 Home button in the header.</p>
    <div class="card" style="background:var(--soft-green);border:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><b>Getting started:</b> ${helpBtns}</div>
    <div class="homegrid">${cards}</div>`;
  $("main").querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>openTool(b.getAttribute("data-go"))));
  renderNav();
}
function goHome(){ renderHome(); }
window.OPS.goHome=goHome; window.OPS.routes.home=renderHome;

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
async function markAllRead(){
  // Clear the notification history, then close the panel.
  // Deleting needs the notif_delete policy (sql/30); if that isn't in place yet,
  // fall back to marking everything read so the bell still clears.
  let cleared=false;
  try{ const { error }=await sb.from("notifications").delete().eq("user_id",me.id); if(!error) cleared=true; }catch(e){}
  if(!cleared){ try{ await sb.from("notifications").update({is_read:true}).eq("user_id",me.id).eq("is_read",false); }catch(e){} }
  $("notifPanel").classList.add("hidden");
  await refreshNotifs(); renderNotifs();
}
window.OPS.refreshNotifs = refreshNotifs;

// ---------- pending-approval counter (badge on the Review / Approvals tab) ----------
async function refreshReviewCount(){
  if(!me || isExternal()){ window.OPS.reviewCount=0; return; }
  const admin=isAdmin();
  async function cnt(table, col, val){
    try{ let q=sb.from(table).select("id",{count:"exact",head:true}).eq(col,val);
      if(!admin) q=q.eq("assigned_approver",me.id);
      const { count }=await q; return count||0; }catch(e){ return 0; }
  }
  const parts=await Promise.all([
    cnt("documents","approval_status","submitted"),
    cnt("clients","approval_status","submitted"),
    cnt("vendors","approval_status","submitted"),
    cnt("bom_designs","approval_status","submitted"),
    cnt("agreements","status","in_review"),
    cnt("daily_submissions","approval_status","submitted"),
    cnt("inventory_moves","approval_status","submitted"),
    cnt("acre_entries","approval_status","submitted"),
  ]);
  window.OPS.reviewCount = parts.reduce((a,b)=>a+b,0);
  renderNav();
}
window.OPS.refreshReviewCount = refreshReviewCount;
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
  const who=`<p class="muted">You are signed in as <b>${esc((profile&&profile.email)||(me&&me.email)||"")}</b> · role <b>${esc(isExternal()?"Authorized Partner / Consultant":((profile&&profile.role)||""))}</b>.</p>`;
  if(isExternal()){
    // Partner-facing privacy notice — about THEIR data and any farmer data they enter
    b.innerHTML=`<p class="muted">How DroCon Cloud protects your information and the farmer data you submit.</p>
      <div class="callout"><b>Encryption:</b> all traffic is HTTPS in transit and data is stored encrypted at rest (AES-256, Supabase).</div>
      <ul style="font-size:13px;line-height:1.7">
        <li><b>Your portal is private to you.</b> Your login can see <b>only</b> your own invoices, your rate card and this portal — never DroCon's internal records or any other partner's data. This is enforced by the database (Row-Level Security), not just the screen.</li>
        <li><b>Your details</b> (contact, bank/payment details on invoices) are visible only to you and DroCon Bharat's authorised finance/management team for processing your payments.</li>
        <li><b>Farmer data you enter</b> (farmer name, mobile, village, acres) is collected only to bill and document the spraying service. Please enter it accurately and only with the farmer's awareness, and do not share it outside DroCon Bharat.</li>
        <li><b>Data protection (DPDP Act, 2023):</b> DroCon Bharat is the <b>Data Fiduciary</b> for farmer personal data and you (the pilot) collect it <b>as a Data Processor on DroCon's behalf</b>. Give the farmer the required notice, take only their consent-based, necessary details, and report any suspected data breach to DroCon Bharat immediately.</li>
        <li><b>Farmer phone numbers</b> you submit are treated as sensitive — they are masked in shared views and access to them is restricted.</li>
        <li><b>You are responsible</b> for keeping your login confidential. Everything submitted from your account is recorded with your identity and time.</li>
        <li><b>Data ownership:</b> service and farmer records generated under your engagement belong to DroCon Bharat per your agreement. You may request a copy or correction of your own submissions at any time.</li>
      </ul>
      <p class="muted">Questions about your data? Email <a href="mailto:info@droconbharat.com">info@droconbharat.com</a>.</p>${who}`;
  } else {
    b.innerHTML=`<p class="muted">How DroCon Cloud protects your data.</p>
      <div class="callout"><b>Encryption:</b> HTTPS in transit, AES-256 at rest (Supabase).</div>
      <ul style="font-size:13px;line-height:1.7">
        <li><b>Access:</b> not signed in = no access. Sign-up is restricted to approved company domains (partners are invite-only).</li>
        <li><b>Row-Level Security</b> is enforced by the database — the browser cannot bypass it.</li>
        <li><b>Data protection (DPDP Act, 2023):</b> DroCon Bharat is the <b>Data Fiduciary</b> for farmer/end-client personal data; pilots and partners collect it only as <b>Data Processors</b> on DroCon's behalf, on notice-and-consent, for the spraying service alone.</li>
        <li><b>Sensitive data</b> (salaries, bank details, farmer phone numbers) is readable only by admins or staff you grant access in <b>Team &amp; Access</b>.</li>
        <li><b>Phone numbers</b> are masked in lists unless you hold the “View contacts” grant.</li>
        <li><b>External partners</b> are sandboxed to their own portal and cannot read any internal data.</li>
        <li><b>Access log:</b> opening sensitive records is recorded (admins can review under Audit → Access Log).</li>
        <li><b>Deletions</b> are restricted and recorded in the Audit log.</li>
      </ul>${who}`;
  }
  $("privacyOverlay").classList.remove("hidden");
}
// ---------- soft refresh (re-pull data, stay on the same screen) ----------
async function softRefresh(){
  if(!me) return;
  const btn=$("btnRefresh"); const label=btn?btn.textContent:"";
  if(btn){ btn.disabled=true; btn.textContent="⏳ Refreshing…"; }
  try{ await loadPerms(); }catch(e){}
  try{ const p=await loadProfile(); if(p){ profile=p; window.OPS.profile=p; } }catch(e){}
  try{ await refreshNotifs(); }catch(e){}
  try{ await refreshReviewCount(); }catch(e){}
  // re-render whatever screen the user is on, so they land back on the same sheet
  try{
    const key=window.OPS.currentTool;
    if(!key || key==="home") goHome();
    else if(canSee(toolByKey(key))) openTool(key);
    else goHome();
  }catch(e){ console.error(e); }
  if(btn){ btn.disabled=false; btn.textContent=label||"🔄 Refresh Suite"; }
  flashTop("Suite refreshed ✓");
}
window.OPS.softRefresh = softRefresh;
(function(){
  const rf=$("btnRefresh"); if(rf) rf.addEventListener("click",softRefresh);
  const h=$("btnHome"); if(h) h.addEventListener("click",goHome);
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
