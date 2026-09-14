/* ============================================================================
   DroCon Cloud — in-app Email (Hostinger IMAP/SMTP via the mail backend)
   Talks to window.DCB_CONFIG.MAIL_API. Dormant until that URL is set.
   Each user connects their OWN mailbox; the password goes straight to the
   backend over HTTPS (encrypted at rest there) and never touches Supabase/app
   storage. HTML email is rendered inside a sandboxed iframe (no scripts).
   ============================================================================ */
(function(){
const { $, esc, fmt } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const API = ()=> (window.DCB_CONFIG && window.DCB_CONFIG.MAIL_API) || "";

let STATE={ mailbox:"INBOX", messages:[], total:0, lowest:null, box:null, current:null, mailboxes:[], signatures:[], search:"" };

/* -------------------------------------------------- signatures -------------------------------------------------- */
async function loadSignatures(){
  try{ const { data }=await sb().from("mail_signatures").select("*").order("created_at"); STATE.signatures=data||[]; }
  catch(e){ STATE.signatures=[]; }
}
function defaultSig(){ return STATE.signatures.find(s=>s.is_default) || null; }
// signatures may be rich HTML or plain text — helpers to render each safely
function sigIsHtml(b){ return /<[a-z!/][\s\S]*>/i.test(b||""); }
function sanitizeHtml(h){
  const d=document.createElement("div"); d.innerHTML=h||"";
  d.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach(n=>n.remove());
  d.querySelectorAll("*").forEach(n=>[...n.attributes].forEach(a=>{
    if(/^on/i.test(a.name)) n.removeAttribute(a.name);
    if((a.name==="href"||a.name==="src")&&/^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
  }));
  return d.innerHTML;
}
function htmlToText(h){ const d=document.createElement("div");
  d.innerHTML=(h||"").replace(/<br\s*\/?>/gi,"\n").replace(/<\/(p|div|li|tr|h[1-6])>/gi,"\n");
  return (d.textContent||"").replace(/\n{3,}/g,"\n\n").trim(); }
function sigToHtml(s){ if(!s) return ""; return sigIsHtml(s.body)? sanitizeHtml(s.body) : esc(s.body).replace(/\n/g,"<br>"); }
function sigToText(s){ if(!s) return ""; return sigIsHtml(s.body)? htmlToText(s.body) : s.body; }

// Company-branded standard signature (hosted logo). Name/email prefilled from the
// user's profile; they fill designation + phone, and can edit anything.
const DROCON_LOGO="https://aguptaindia2012.github.io/drocon-cloud/assets/drocon-logo.png";
function droconSigHtml(){
  const p=window.OPS.profile||{};
  const name=esc(p.full_name||"[Your Name]");
  const email=esc(p.email||"you@droconbharat.com");
  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#333333;line-height:1.5"><tr>`
    +`<td style="padding-right:16px;border-right:3px solid #599533;vertical-align:middle"><img src="${DROCON_LOGO}" alt="DroCon Bharat" width="120" style="display:block;width:120px;height:auto"></td>`
    +`<td style="padding-left:16px;vertical-align:middle">`
      +`<div style="font-size:16px;font-weight:bold;color:#111111">${name}</div>`
      +`<div style="font-size:13px;font-weight:bold;color:#599533">[Designation]</div>`
      +`<div style="margin-top:6px;font-size:12px;color:#333333">M: [Your Phone] &nbsp;|&nbsp; E: <a href="mailto:${email}" style="color:#0A6496;text-decoration:none">${email}</a></div>`
      +`<div style="margin-top:8px;font-size:12px;color:#555555"><span style="font-weight:bold;color:#333333">DroCon Bharat Private Limited</span><br>`
      +`315/7 Thapar Nagar, Meerut, Uttar Pradesh 250001, India<br>`
      +`T: +91 73026 27122 &nbsp;|&nbsp; <a href="mailto:info@droconbharat.com" style="color:#0A6496;text-decoration:none">info@droconbharat.com</a> &nbsp;|&nbsp; <a href="https://droconbharat.com" style="color:#0A6496;text-decoration:none">droconbharat.com</a></div>`
    +`</td></tr></table>`;
}

function signaturesPanel(){
  const wrap=document.createElement("div");
  wrap.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:60;display:flex;align-items:center;justify-content:center";
  wrap.innerHTML=`<div class="card" style="width:min(660px,94vw);max-height:90vh;overflow:auto">
    <div class="row" style="justify-content:space-between"><h3 style="margin:0 0 8px">Email signatures</h3><button class="btn sm" id="sgClose">Close</button></div>
    <div id="sgList" class="muted">Loading…</div>
    <div style="border-top:1px solid var(--line);margin-top:12px;padding-top:10px">
      <h4 style="margin:0 0 6px" id="sgFormTitle">Add a signature</h4>
      <input type="hidden" id="sgId">
      <label>Name</label><input id="sgName" class="in" style="width:100%" placeholder="e.g. Full / Short">
      <label>Signature</label>
      <div class="row" style="gap:3px;flex-wrap:wrap;margin:4px 0">
        <button type="button" class="btn sm" data-cmd="bold" style="font-weight:700;min-width:28px">B</button>
        <button type="button" class="btn sm" data-cmd="italic" style="font-style:italic;min-width:28px">I</button>
        <button type="button" class="btn sm" data-cmd="underline" style="text-decoration:underline;min-width:28px">U</button>
        <button type="button" class="btn sm" data-cmd="insertUnorderedList" style="min-width:28px">• </button>
        <button type="button" class="btn sm" id="sgLink">🔗 Link</button>
        <button type="button" class="btn sm" id="sgImgUp">🖼 Upload image</button>
        <button type="button" class="btn sm" id="sgImgUrl">🌐 Image URL</button>
        <input type="file" id="sgImgFile" accept="image/*" style="display:none">
        <button type="button" class="btn sm" data-cmd="removeFormat">Clear</button>
        <button type="button" class="btn blue sm" id="sgTpl" style="margin-left:auto">★ DroCon template</button>
      </div>
      <div id="sgBody" contenteditable="true" class="in" style="width:100%;min-height:120px;overflow:auto;background:#fff" placeholder="Your name, title, phone, links…"></div>
      <div class="muted" style="font-size:11px;margin-top:3px">Tip for a logo: <b>Upload image</b> from your computer (it's hosted automatically), or <b>Image URL</b> to link one already online.</div>
      <label class="row" style="gap:6px;margin-top:6px"><input type="checkbox" id="sgDefault"> Use as my default signature</label>
      <div id="sgErr" class="err" style="min-height:16px"></div>
      <div class="row" style="gap:8px"><button class="btn green sm" id="sgSave">Save signature</button><button class="btn sm" id="sgReset">Clear form</button></div>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  const close=()=>wrap.remove();
  wrap.addEventListener("click",e=>{ if(e.target===wrap) close(); });
  $("sgClose").addEventListener("click",close);
  const ed=$("sgBody");
  // rich-text toolbar (execCommand keeps the selection when we preventDefault on mousedown)
  wrap.querySelectorAll("[data-cmd]").forEach(b=>b.addEventListener("mousedown",e=>{ e.preventDefault(); ed.focus(); document.execCommand(b.getAttribute("data-cmd"),false,null); }));
  $("sgLink").addEventListener("mousedown",e=>{ e.preventDefault(); ed.focus(); const u=prompt("Link URL (https://…)"); if(u) document.execCommand("createLink",false,u); });
  function capImages(){ ed.querySelectorAll("img:not([data-sized])").forEach(im=>{ im.style.maxWidth="220px"; im.style.height="auto"; im.setAttribute("data-sized","1"); }); }
  function insertImg(url){ ed.focus(); document.execCommand("insertImage",false,url); capImages(); }
  $("sgImgUrl").addEventListener("mousedown",e=>{ e.preventDefault(); ed.focus(); const u=prompt("Image URL (https://…)"); if(u) insertImg(u); });
  $("sgTpl").addEventListener("mousedown",e=>{ e.preventDefault();
    if(ed.innerHTML.trim() && !confirm("Replace the current signature content with the DroCon standard template?")) return;
    ed.innerHTML=droconSigHtml(); capImages(); if(!$("sgName").value.trim()) $("sgName").value="DroCon standard"; });
  $("sgImgUp").addEventListener("mousedown",e=>{ e.preventDefault(); $("sgImgFile").click(); });
  $("sgImgFile").addEventListener("change",async()=>{
    const f=$("sgImgFile").files[0]; if(!f) return;
    if(f.size>2*1024*1024){ alert("Please use an image under 2 MB."); $("sgImgFile").value=""; return; }
    const safe=(f.name||"logo").replace(/[^\w.\-]+/g,"_");
    const path=`${(window.OPS.me&&window.OPS.me.id)||"x"}/${Date.now()}_${safe}`;
    try{
      const { error }=await sb().storage.from("sig-assets").upload(path, f, { upsert:false, contentType:f.type||"image/png" });
      if(error) throw error;
      const { data }=sb().storage.from("sig-assets").getPublicUrl(path);
      if(data&&data.publicUrl) insertImg(data.publicUrl);
    }catch(err){ alert("Upload failed: "+(err.message||err)); }
    $("sgImgFile").value="";
  });
  function resetForm(){ $("sgId").value=""; $("sgName").value=""; ed.innerHTML=""; $("sgDefault").checked=false; $("sgFormTitle").textContent="Add a signature"; $("sgErr").textContent=""; }
  $("sgReset").addEventListener("click",resetForm);
  function renderList(){
    const host=$("sgList");
    host.innerHTML = STATE.signatures.length ? STATE.signatures.map(s=>`
      <div class="row" style="gap:8px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line)">
        <div style="flex:1"><b>${esc(s.name)}</b>${s.is_default?' <span class="muted" style="font-size:11px">· default</span>':''}
          <div style="font-size:13px;margin-top:2px;border-left:2px solid var(--line);padding-left:8px">${sigToHtml(s)}</div></div>
        <button class="btn sm" data-edit="${s.id}">Edit</button>
        <button class="btn sm" data-del="${s.id}" style="color:#a3322a">Delete</button>
      </div>`).join("") : '<div class="muted">No signatures yet — add one below.</div>';
    host.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>{
      const s=STATE.signatures.find(x=>x.id===b.getAttribute("data-edit")); if(!s) return;
      $("sgId").value=s.id; $("sgName").value=s.name; ed.innerHTML=sigIsHtml(s.body)?s.body:esc(s.body).replace(/\n/g,"<br>"); $("sgDefault").checked=!!s.is_default;
      $("sgFormTitle").textContent="Edit signature"; $("sgName").focus();
    }));
    host.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",async()=>{
      if(!confirm("Delete this signature?")) return;
      await sb().from("mail_signatures").delete().eq("id",b.getAttribute("data-del"));
      await loadSignatures(); renderList();
    }));
  }
  $("sgSave").addEventListener("click",async()=>{
    const err=$("sgErr"); err.textContent="";
    const name=$("sgName").value.trim(), body=sanitizeHtml(ed.innerHTML), isDef=$("sgDefault").checked, id=$("sgId").value;
    if(!name){ err.textContent="Give the signature a name."; return; }
    try{
      if(isDef){ await sb().from("mail_signatures").update({is_default:false}).neq("id", id||"00000000-0000-0000-0000-000000000000"); }
      if(id){ await sb().from("mail_signatures").update({name,body,is_default:isDef}).eq("id",id); }
      else { await sb().from("mail_signatures").insert({name,body,is_default:isDef}); }
      await loadSignatures(); renderList(); resetForm();
    }catch(e){ err.textContent=e.message||"Save failed"; }
  });
  loadSignatures().then(renderList);
}

async function token(){ try{ const { data }=await window.OPS.sb.auth.getSession(); return data && data.session && data.session.access_token; }catch(e){ return null; } }
async function api(path, opts){
  opts=opts||{}; const base=API(); if(!base) throw new Error("MAIL_API not configured");
  const t=await token(); if(!t) throw new Error("not signed in");
  const res=await fetch(base+path, { method:opts.method||"GET",
    headers:Object.assign({ Authorization:"Bearer "+t }, opts.body?{ "Content-Type":"application/json" }:{}),
    body:opts.body?JSON.stringify(opts.body):undefined });
  if(opts.raw) return res;
  const j=await res.json().catch(()=>({}));
  if(!res.ok){ const e=new Error(j.detail||j.error||("HTTP "+res.status)); e.code=j.error; e.status=res.status; throw e; }
  return j;
}

/* -------------------------------------------------- entry -------------------------------------------------- */
let _poll=null;
function startPoll(){
  stopPoll();
  _poll=setInterval(async()=>{
    if(window.OPS.currentTool!=="mail"){ stopPoll(); return; }
    if(STATE.search) return;                              // don't clobber search results
    if(document.getElementById("coTo")) return;           // compose modal open — don't disrupt
    try{
      const r=await api(`/mail/messages?mailbox=${encodeURIComponent(STATE.mailbox)}&limit=30`);
      STATE.total=r.total||0; STATE.messages=r.messages||[];
      STATE.lowest=STATE.messages.length?Math.min(...STATE.messages.map(m=>m.seq)):null;
      renderList();
    }catch(e){}
  }, 60000);
}
function stopPoll(){ if(_poll){ clearInterval(_poll); _poll=null; } }
async function route(){
  stopPoll();
  const m=$("main");
  if(!API()){
    m.innerHTML=`<div class="eyebrow">Mail</div><h1>Email</h1>
      <div class="card"><p>The email client isn't switched on yet.</p>
      <p class="muted">Once the mail server is set up, an admin adds its address to <code>config.js</code> as <code>MAIL_API</code>, and this screen goes live — no other change needed.</p></div>`;
    return;
  }
  m.innerHTML=`<div class="eyebrow">Mail</div><h1>Email</h1><div id="mailHost" class="muted">Loading…</div>`;
  try{
    const st=await api("/mail/status");
    if(!st.connected){ renderConnect(); return; }
    renderMail(st);
  }catch(e){
    $("mailHost").innerHTML=`<div class="card"><b>Can't reach the mail server.</b><div class="muted">${esc(e.message)}</div>
      <div style="margin-top:8px"><button class="btn sm" id="mailRetry">Retry</button></div></div>`;
    if($("mailRetry")) $("mailRetry").addEventListener("click",route);
  }
}

/* -------------------------------------------------- connect -------------------------------------------------- */
function renderConnect(){
  const email=(window.OPS.profile && window.OPS.profile.email) || (window.OPS.me && window.OPS.me.email) || "";
  $("mailHost").innerHTML=`<div class="card" style="max-width:520px">
    <h3 style="margin:0 0 6px">Connect your mailbox</h3>
    <p class="muted" style="margin:0 0 10px">Enter your email password once. It's stored encrypted on the mail server and never shown again. <b>Never share it in chat.</b></p>
    <label>Mail provider</label>
    <select id="cProvider" class="in" style="width:100%;margin-bottom:8px">
      <option value="hostinger">Hostinger (Hostinger Email)</option>
      <option value="zoho">Zoho Mail (paid / Pro)</option>
      <option value="titan">Titan (Hostinger Business Email)</option>
      <option value="custom">Other / custom servers</option>
    </select>
    <label>Email address</label><input id="cEmail" class="in" style="width:100%" value="${esc(email)}">
    <label>Mailbox password</label><input id="cPass" type="password" class="in" style="width:100%">
    <details id="cAdv" style="margin:8px 0"><summary class="muted" style="cursor:pointer">Advanced server settings</summary>
      <div class="row wrap" style="gap:8px;margin-top:6px">
        <div><label>IMAP host</label><input id="cImapHost" class="in" placeholder="imap.hostinger.com"></div>
        <div><label>IMAP port</label><input id="cImapPort" class="in" placeholder="993" style="width:90px"></div>
        <div><label>SMTP host</label><input id="cSmtpHost" class="in" placeholder="smtp.hostinger.com"></div>
        <div><label>SMTP port</label><input id="cSmtpPort" class="in" placeholder="465" style="width:90px"></div>
      </div></details>
    <div id="cErr" class="err" style="min-height:18px"></div>
    <button class="btn green" id="cGo">Connect</button>
  </div>`;
  const PRESETS={
    hostinger:{ imap:"imap.hostinger.com", smtp:"smtp.hostinger.com" },
    zoho:     { imap:"imappro.zoho.in",    smtp:"smtppro.zoho.in" },
    titan:    { imap:"imap.titan.email",   smtp:"smtp.titan.email" },
  };
  function applyPreset(){
    const p=PRESETS[$("cProvider").value];
    if(p){ $("cImapHost").value=p.imap; $("cImapPort").value=993; $("cSmtpHost").value=p.smtp; $("cSmtpPort").value=465; }
    else { $("cImapHost").value=""; $("cImapPort").value=""; $("cSmtpHost").value=""; $("cSmtpPort").value=""; $("cAdv").open=true; }
  }
  $("cProvider").addEventListener("change",applyPreset);
  applyPreset();
  $("cGo").addEventListener("click",async()=>{
    const err=$("cErr"); err.textContent="";
    const email=$("cEmail").value.trim(), password=$("cPass").value;
    if(!email||!password){ err.textContent="Enter your email and password."; return; }
    const body={ email, password };
    if($("cImapHost").value.trim()) body.imap_host=$("cImapHost").value.trim();
    if($("cImapPort").value.trim()) body.imap_port=Number($("cImapPort").value.trim());
    if($("cSmtpHost").value.trim()) body.smtp_host=$("cSmtpHost").value.trim();
    if($("cSmtpPort").value.trim()) body.smtp_port=Number($("cSmtpPort").value.trim());
    $("cGo").disabled=true; $("cGo").textContent="Checking…";
    try{ await api("/mail/connect",{ method:"POST", body }); route(); }
    catch(e){ err.textContent = e.code==="login_failed" ? "Login failed — check the password (and IMAP is enabled on the mailbox)." : e.message; $("cGo").disabled=false; $("cGo").textContent="Connect"; }
  });
}

/* -------------------------------------------------- main mail UI -------------------------------------------------- */
function boxLabel(b){
  const su=(b.specialUse||"").replace(/\\/g,"");
  const map={ Inbox:"📥 Inbox", Sent:"📤 Sent", Drafts:"📝 Drafts", Trash:"🗑 Trash", Junk:"⚠ Spam", Archive:"🗄 Archive" };
  return map[su] || (b.path==="INBOX"?"📥 Inbox":("📁 "+b.name));
}
function boxRank(b){ const su=(b.specialUse||"").replace(/\\/g,""); const o={Inbox:0,Sent:1,Drafts:2,Archive:3,Junk:8,Trash:9}; return b.path==="INBOX"?0:(o[su]!=null?o[su]:5); }

async function renderMail(st){
  $("mailHost").innerHTML=`
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px">
      <div class="muted">Signed in as <b>${esc(st.email)}</b>${st.status==='error'?' · <span class="err">connection issue</span>':''}</div>
      <div class="row" style="gap:6px"><button class="btn green sm" id="mCompose">✏️ Compose</button>
        <button class="btn sm" id="mSig">✍ Signatures</button>
        <button class="btn sm" id="mRefresh">↻</button><button class="btn sm" id="mDisc">Disconnect</button></div>
    </div>
    <div class="row" style="gap:6px;margin-bottom:8px">
      <input id="mSearch" class="in" placeholder="Search this folder (sender, subject, text)…" style="max-width:380px">
      <button class="btn sm" id="mSearchGo">🔍 Search</button>
      <button class="btn sm" id="mSearchClear" style="display:none">✕ Clear</button>
    </div>
    <div style="display:grid;grid-template-columns:170px 340px 1fr;gap:12px;align-items:start">
      <div class="card" id="mBoxes" style="padding:8px">Loading…</div>
      <div class="card" id="mList" style="padding:0;max-height:70vh;overflow:auto">Loading…</div>
      <div class="card" id="mReader" style="padding:14px;min-height:60vh">Select a message.</div>
    </div>`;
  $("mCompose").addEventListener("click",()=>compose());
  $("mSig").addEventListener("click",signaturesPanel);
  $("mRefresh").addEventListener("click",()=>loadList(STATE.mailbox,true));
  $("mDisc").addEventListener("click",async()=>{ if(confirm("Disconnect this mailbox from the app? (Your email is not deleted.)")){ await api("/mail/disconnect",{method:"DELETE"}); route(); } });
  $("mSearchGo").addEventListener("click",()=>runSearch($("mSearch").value));
  $("mSearch").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); runSearch($("mSearch").value); } });
  $("mSearchClear").addEventListener("click",clearSearch);
  loadSignatures();
  try{
    const { mailboxes }=await api("/mail/mailboxes");
    STATE.mailboxes=(mailboxes||[]).sort((a,b)=>boxRank(a)-boxRank(b)||a.name.localeCompare(b.name));
    renderBoxes();
    loadList("INBOX", true);
    startPoll();
  }catch(e){ $("mBoxes").innerHTML=`<div class="err">${esc(e.message)}</div>`; }
}
function renderBoxes(){
  const host=$("mBoxes"); if(!host) return;
  host.innerHTML=STATE.mailboxes.map(b=>`<div data-box="${esc(b.path)}" style="padding:7px 8px;border-radius:7px;cursor:pointer;${b.path===STATE.mailbox?'background:#eef4e8;font-weight:600':''}">${esc(boxLabel(b))}</div>`).join("");
  host.querySelectorAll("[data-box]").forEach(el=>el.addEventListener("click",()=>loadList(el.getAttribute("data-box"),true)));
}

async function runSearch(q){
  q=(q||"").trim();
  if(!q){ clearSearch(); return; }
  STATE.search=q; if($("mSearchClear")) $("mSearchClear").style.display="";
  const host=$("mList"); host.innerHTML='<div class="muted" style="padding:12px">Searching…</div>';
  try{
    const r=await api(`/mail/search?mailbox=${encodeURIComponent(STATE.mailbox)}&q=${encodeURIComponent(q)}`);
    STATE.messages=r.messages||[]; STATE.total=r.total||0; STATE.lowest=null; renderList();
  }catch(e){ host.innerHTML=`<div class="err" style="padding:12px">${esc(e.message)}</div>`; }
}
function clearSearch(){ STATE.search=""; if($("mSearchClear")) $("mSearchClear").style.display="none"; if($("mSearch")) $("mSearch").value=""; loadList(STATE.mailbox,true); }

async function loadList(mailbox, reset){
  STATE.mailbox=mailbox; STATE.search=""; if($("mSearchClear")) $("mSearchClear").style.display="none"; if($("mSearch")) $("mSearch").value="";
  renderBoxes();
  const host=$("mList"); if(reset){ host.innerHTML='<div class="muted" style="padding:12px">Loading…</div>'; STATE.messages=[]; STATE.lowest=null; }
  try{
    const q=`/mail/messages?mailbox=${encodeURIComponent(mailbox)}&limit=30${STATE.lowest&&!reset?`&before=${STATE.lowest}`:""}`;
    const r=await api(q);
    STATE.total=r.total||0;
    STATE.messages = reset ? (r.messages||[]) : STATE.messages.concat(r.messages||[]);
    STATE.lowest = STATE.messages.length ? Math.min(...STATE.messages.map(m=>m.seq)) : null;
    renderList();
  }catch(e){ host.innerHTML=`<div class="err" style="padding:12px">${esc(e.message)}</div>`; }
}
function addr(a){ return a && a.length ? (a[0].name||a[0].address||"") : ""; }
function renderList(){
  const host=$("mList"); if(!host) return;
  const banner = STATE.search ? `<div class="row" style="padding:8px 11px;background:#eef4e8;font-size:12px"><span>Results for “<b>${esc(STATE.search)}</b>” · ${STATE.messages.length}</span><a href="#" id="mSbClear" style="margin-left:auto">✕ Clear</a></div>` : "";
  if(!STATE.messages.length){ host.innerHTML=banner+'<div class="muted" style="padding:14px">'+(STATE.search?'No matches.':'No messages.')+'</div>'; if($("mSbClear")) $("mSbClear").addEventListener("click",e=>{e.preventDefault();clearSearch();}); return; }
  const more = !STATE.search && STATE.messages.length < STATE.total;
  host.innerHTML=banner+STATE.messages.map(m=>{ const u=!m.seen; return `<div data-uid="${m.uid}" data-seq="${m.seq}" style="padding:9px 11px;border-bottom:1px solid var(--line);cursor:pointer;border-left:4px solid ${u?'#F48A1C':'transparent'};background:${u?'#fff7ec':'transparent'}">
      <div class="row" style="gap:6px"><b style="font-size:13px;font-weight:${u?'700':'500'};color:${u?'#F48A1C':'#333'}">${u?'● ':''}${esc(addr(m.from)||'(unknown)')}</b>
        <span style="font-size:11px;margin-left:auto;color:${u?'#F48A1C':'var(--muted)'}">${m.date?fmt(m.date):''}</span></div>
      <div style="font-size:13px;font-weight:${u?'700':'400'};color:${u?'#c96a00':'#555'}">${esc(m.subject)}</div></div>`; }).join("")
    + (more?`<div style="padding:10px;text-align:center"><button class="btn sm" id="mMore">Load older</button></div>`:"");
  host.querySelectorAll("[data-uid]").forEach(el=>el.addEventListener("click",()=>openMessage(el.getAttribute("data-uid"))));
  if($("mMore")) $("mMore").addEventListener("click",()=>loadList(STATE.mailbox,false));
  if($("mSbClear")) $("mSbClear").addEventListener("click",e=>{e.preventDefault();clearSearch();});
}

function specialPath(su, names){
  const b=STATE.mailboxes.find(x=>(x.specialUse||"").replace(/\\/g,"")===su);
  if(b) return b.path;
  const n=STATE.mailboxes.find(x=>names.includes(String(x.name||"").toLowerCase())||names.includes(String(x.path||"").toLowerCase()));
  return n?n.path:null;
}
const trashPath=()=>specialPath("Trash",["trash","deleted","deleted items","deleted messages"]);
const archivePath=()=>specialPath("Archive",["archive","archives"]);
const inboxPath=()=>(STATE.mailboxes.find(x=>x.path==="INBOX")||{}).path||"INBOX";
async function afterMsgAction(){ $("mReader").innerHTML='<div class="muted">Select a message.</div>'; STATE.current=null; await loadList(STATE.mailbox,true); }

async function openMessage(uid){
  const reader=$("mReader"); reader.innerHTML='<div class="muted">Loading…</div>';
  try{
    const m=await api(`/mail/message?mailbox=${encodeURIComponent(STATE.mailbox)}&uid=${encodeURIComponent(uid)}`);
    STATE.current=m;
    const it=STATE.messages.find(x=>String(x.uid)===String(uid)); if(it) it.seen=true; renderList();
    const from=(m.from||[]).map(a=>esc(a.name?`${a.name} <${a.address}>`:a.address)).join(", ");
    const to=(m.to||[]).map(a=>esc(a.address)).join(", ");
    const atts=(m.attachments||[]).map(a=>`<button class="btn sm" data-att="${a.index}" data-name="${esc(a.filename)}" style="margin:2px 4px 0 0">📎 ${esc(a.filename)} <span class="muted">${a.size?Math.round(a.size/1024)+'KB':''}</span></button>`).join("");
    const arch=archivePath(), trash=trashPath(), inTrash=STATE.mailbox===trash;
    const moveOpts=STATE.mailboxes.filter(b=>b.path!==STATE.mailbox).map(b=>`<option value="${esc(b.path)}">${esc(boxLabel(b))}</option>`).join("");
    reader.innerHTML=`
      <div class="row wrap" style="gap:6px;margin-bottom:6px">
        <button class="btn sm" id="mReply">↩ Reply</button>
        <button class="btn sm" id="mReplyAll">↩ Reply all</button>
        <button class="btn sm" id="mFwd">➡ Forward</button>
        ${arch && STATE.mailbox!==arch && !inTrash ? '<button class="btn sm" id="mArchive">🗄 Archive</button>':''}
        ${inTrash ? '<button class="btn sm" id="mRestore">♻ Restore</button>':''}
        <button class="btn sm" id="mDelete" style="color:#a3322a">🗑 ${inTrash?'Delete permanently':'Delete'}</button>
        <button class="btn sm" id="mUnread">Mark unread</button>
        <select id="mMoveTo" class="in sm" style="width:auto"><option value="">Move to…</option>${moveOpts}</select>
      </div>
      <h3 style="margin:4px 0">${esc(m.subject)}</h3>
      <div class="muted" style="font-size:12px">From: ${from}</div>
      <div class="muted" style="font-size:12px">To: ${to}</div>
      <div class="muted" style="font-size:12px;margin-bottom:8px">${m.date?fmt(m.date):''}</div>
      ${atts?`<div style="margin-bottom:8px">${atts}</div>`:""}
      <div id="mBodyWrap" style="border-top:1px solid var(--line);padding-top:10px"></div>`;
    const bw=$("mBodyWrap");
    if(m.html){
      const ifr=document.createElement("iframe");
      ifr.setAttribute("sandbox",""); // no scripts, no same-origin
      ifr.style.cssText="width:100%;min-height:420px;border:0";
      ifr.srcdoc=`<base target="_blank"><div style="font-family:system-ui,Arial;font-size:14px;color:#222">${m.html}</div>`;
      bw.appendChild(ifr);
    }else{
      const pre=document.createElement("div"); pre.style.cssText="white-space:pre-wrap;font-size:14px"; pre.textContent=m.text||"(no content)"; bw.appendChild(pre);
    }
    $("mReply").addEventListener("click",()=>compose(replyDraft(m,false)));
    $("mReplyAll").addEventListener("click",()=>compose(replyDraft(m,true)));
    $("mFwd").addEventListener("click",()=>compose(forwardDraft(m)));
    $("mUnread").addEventListener("click",async()=>{ await api("/mail/flags",{method:"POST",body:{mailbox:STATE.mailbox,uid:Number(uid),seen:false}}); const it=STATE.messages.find(x=>String(x.uid)===String(uid)); if(it) it.seen=false; renderList(); });
    const move=async(dest)=>{ try{ await api("/mail/move",{method:"POST",body:{mailbox:STATE.mailbox,uid:Number(uid),dest}}); await afterMsgAction(); }catch(e){ alert("Couldn't move: "+e.message); } };
    if($("mArchive")) $("mArchive").addEventListener("click",()=>move(arch));
    if($("mRestore")) $("mRestore").addEventListener("click",()=>move(inboxPath()));
    if($("mMoveTo")) $("mMoveTo").addEventListener("change",e=>{ if(e.target.value) move(e.target.value); });
    $("mDelete").addEventListener("click",async()=>{
      if(inTrash || !trash){
        if(!confirm("Permanently delete this message? This can't be undone.")) return;
        try{ await api("/mail/delete",{method:"POST",body:{mailbox:STATE.mailbox,uid:Number(uid)}}); await afterMsgAction(); }catch(e){ alert("Couldn't delete: "+e.message); }
      } else { move(trash); }
    });
    reader.querySelectorAll("[data-att]").forEach(el=>el.addEventListener("click",()=>downloadAttachment(uid, el.getAttribute("data-att"), el.getAttribute("data-name"))));
  }catch(e){ reader.innerHTML=`<div class="err">${esc(e.message)}</div>`; }
}

async function downloadAttachment(uid, index, name){
  try{
    const res=await api(`/mail/attachment?mailbox=${encodeURIComponent(STATE.mailbox)}&uid=${encodeURIComponent(uid)}&index=${index}`,{raw:true});
    if(!res.ok) throw new Error("HTTP "+res.status);
    const blob=await res.blob(); const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=name||"attachment"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
  }catch(e){ alert("Couldn't download: "+e.message); }
}

/* -------------------------------------------------- compose -------------------------------------------------- */
function quoteHtml(m){
  const who=(m.from&&m.from[0])?(m.from[0].name||m.from[0].address):"";
  const orig=m.html? sanitizeHtml(m.html) : esc(m.text||"").replace(/\n/g,"<br>");
  return `<br><br><div style="color:#777;font-size:12px">----- On ${m.date?esc(fmt(m.date)):''}, ${esc(who)} wrote: -----</div>`
    +`<blockquote style="margin:6px 0 0;padding-left:10px;border-left:2px solid #ccc;color:#555">${orig}</blockquote>`;
}
function replyDraft(m, all){
  const to=(m.from||[]).map(a=>a.address).join(", ");
  const cc=all?(m.to||[]).map(a=>a.address).filter(x=>x&&x!==((window.OPS.profile&&window.OPS.profile.email))).join(", "):"";
  return { to, cc, subject:/^re:/i.test(m.subject||"")?m.subject:("Re: "+(m.subject||"")), bodyHtml:quoteHtml(m),
    inReplyTo:m.messageId, references:m.messageId };
}
function forwardDraft(m){
  return { to:"", subject:/^fwd:/i.test(m.subject||"")?m.subject:("Fwd: "+(m.subject||"")), bodyHtml:quoteHtml(m) };
}
function compose(seed){
  seed=seed||{};
  const pending=[];
  const wrap=document.createElement("div");
  wrap.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:60;display:flex;align-items:center;justify-content:center";
  wrap.innerHTML=`<div class="card" style="width:min(680px,94vw);max-height:90vh;overflow:auto">
    <h3 style="margin:0 0 10px">New message</h3>
    <label>To</label><input id="coTo" class="in" style="width:100%" value="${esc(seed.to||'')}">
    <label>Cc</label><input id="coCc" class="in" style="width:100%" value="${esc(seed.cc||'')}">
    <label>Subject</label><input id="coSub" class="in" style="width:100%" value="${esc(seed.subject||'')}">
    <label>Signature</label>
    <select id="coSig" class="in" style="width:auto;max-width:100%;margin-bottom:6px">
      <option value="">No signature</option>
      ${STATE.signatures.map(s=>`<option value="${s.id}" ${s.is_default?'selected':''}>${esc(s.name)}</option>`).join("")}
    </select>
    <label>Message</label>
    <div class="row" style="gap:3px;flex-wrap:wrap;margin:4px 0">
      <button type="button" class="btn sm" data-cmd="bold" style="font-weight:700;min-width:28px">B</button>
      <button type="button" class="btn sm" data-cmd="italic" style="font-style:italic;min-width:28px">I</button>
      <button type="button" class="btn sm" data-cmd="underline" style="text-decoration:underline;min-width:28px">U</button>
      <button type="button" class="btn sm" data-cmd="strikeThrough" style="text-decoration:line-through;min-width:28px">S</button>
      <button type="button" class="btn sm" data-cmd="insertUnorderedList" style="min-width:28px">•</button>
      <button type="button" class="btn sm" data-cmd="insertOrderedList" style="min-width:28px">1.</button>
      <button type="button" class="btn sm" id="coLink">🔗 Link</button>
      <button type="button" class="btn sm" data-cmd="removeFormat">Clear</button>
    </div>
    <div id="coBody" contenteditable="true" class="in" style="width:100%;min-height:200px;max-height:45vh;overflow:auto;background:#fff"></div>
    <div id="coSigPrev" style="margin-top:4px"></div>
    <div class="row" style="gap:8px;margin-top:6px"><button class="btn sm" id="coAttach">📎 Attach</button><input type="file" id="coFile" multiple style="display:none"><span id="coFiles" class="muted" style="font-size:12px"></span></div>
    <div id="coErr" class="err" style="min-height:18px"></div>
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:6px"><button class="btn sm" id="coCancel">Cancel</button><button class="btn green" id="coSend">Send</button></div>
  </div>`;
  document.body.appendChild(wrap);
  const close=()=>wrap.remove();
  const ed=$("coBody");
  ed.innerHTML = seed.bodyHtml || (seed.body? esc(seed.body).replace(/\n/g,"<br>") : "");
  // rich-text toolbar
  wrap.querySelectorAll("[data-cmd]").forEach(b=>b.addEventListener("mousedown",e=>{ e.preventDefault(); ed.focus(); document.execCommand(b.getAttribute("data-cmd"),false,null); }));
  $("coLink").addEventListener("mousedown",e=>{ e.preventDefault(); ed.focus(); const u=prompt("Link URL (https://…)"); if(u) document.execCommand("createLink",false,u); });
  // signature is appended at send time; show a live preview of the chosen one
  const curSig=()=>STATE.signatures.find(x=>x.id===$("coSig").value)||null;
  function renderSigPrev(){ const s=curSig();
    $("coSigPrev").innerHTML = s ? `<div class="muted" style="font-size:11px">Signature (added on send):</div><div style="border-left:2px solid var(--line);padding-left:8px;font-size:13px">${sigToHtml(s)}</div>` : ""; }
  $("coSig").addEventListener("change",renderSigPrev);
  renderSigPrev();
  wrap.addEventListener("click",e=>{ if(e.target===wrap) close(); });
  $("coCancel").addEventListener("click",close);
  $("coAttach").addEventListener("click",()=>$("coFile").click());
  $("coFile").addEventListener("change",()=>{ pending.push(...$("coFile").files); $("coFile").value="";
    $("coFiles").textContent=pending.map(f=>f.name).join(", "); });
  $("coSend").addEventListener("click",async()=>{
    const err=$("coErr"); err.textContent="";
    const to=$("coTo").value.trim(); if(!to){ err.textContent="Add at least one recipient."; return; }
    $("coSend").disabled=true; $("coSend").textContent="Sending…";
    try{
      const attachments=[];
      for(const f of pending){ attachments.push({ filename:f.name, content_type:f.type||"application/octet-stream", content_base64:await toB64(f) }); }
      const bodyHtml=sanitizeHtml($("coBody").innerHTML), s=curSig();
      const sigH = s ? "<br><br>-- <br>"+sigToHtml(s) : "";
      const sigT = s ? "\n\n-- \n"+sigToText(s) : "";
      const payload={ to, cc:$("coCc").value.trim()||undefined, subject:$("coSub").value.trim(),
        html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">${bodyHtml}${sigH}</div>`,
        text: htmlToText(bodyHtml)+sigT,
        inReplyTo:seed.inReplyTo, references:seed.references, attachments };
      await api("/mail/send",{ method:"POST", body:payload });
      close();
    }catch(e){ err.textContent=e.message; $("coSend").disabled=false; $("coSend").textContent="Send"; }
  });
}
function toB64(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).split(",")[1]||""); r.onerror=rej; r.readAsDataURL(file); }); }

window.OPS.routes.mail = route;
})();
