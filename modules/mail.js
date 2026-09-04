/* ============================================================================
   DroCon Cloud — in-app Email (Hostinger IMAP/SMTP via the mail backend)
   Talks to window.DCB_CONFIG.MAIL_API. Dormant until that URL is set.
   Each user connects their OWN mailbox; the password goes straight to the
   backend over HTTPS (encrypted at rest there) and never touches Supabase/app
   storage. HTML email is rendered inside a sandboxed iframe (no scripts).
   ============================================================================ */
(function(){
const { $, esc, fmt } = window.OPS.helpers;
const API = ()=> (window.DCB_CONFIG && window.DCB_CONFIG.MAIL_API) || "";

let STATE={ mailbox:"INBOX", messages:[], total:0, lowest:null, box:null, current:null, mailboxes:[] };

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
async function route(){
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
    <p class="muted" style="margin:0 0 10px">Enter your Hostinger email password once. It's stored encrypted on the mail server and never shown again. <b>Never share it in chat.</b></p>
    <label>Email address</label><input id="cEmail" class="in" style="width:100%" value="${esc(email)}">
    <label>Mailbox password</label><input id="cPass" type="password" class="in" style="width:100%">
    <details style="margin:8px 0"><summary class="muted" style="cursor:pointer">Advanced server settings (usually leave blank)</summary>
      <div class="row wrap" style="gap:8px;margin-top:6px">
        <div><label>IMAP host</label><input id="cImapHost" class="in" placeholder="imap.hostinger.com"></div>
        <div><label>IMAP port</label><input id="cImapPort" class="in" placeholder="993" style="width:90px"></div>
        <div><label>SMTP host</label><input id="cSmtpHost" class="in" placeholder="smtp.hostinger.com"></div>
        <div><label>SMTP port</label><input id="cSmtpPort" class="in" placeholder="465" style="width:90px"></div>
      </div></details>
    <div id="cErr" class="err" style="min-height:18px"></div>
    <button class="btn green" id="cGo">Connect</button>
  </div>`;
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
        <button class="btn sm" id="mRefresh">↻</button><button class="btn sm" id="mDisc">Disconnect</button></div>
    </div>
    <div style="display:grid;grid-template-columns:170px 340px 1fr;gap:12px;align-items:start">
      <div class="card" id="mBoxes" style="padding:8px">Loading…</div>
      <div class="card" id="mList" style="padding:0;max-height:70vh;overflow:auto">Loading…</div>
      <div class="card" id="mReader" style="padding:14px;min-height:60vh">Select a message.</div>
    </div>`;
  $("mCompose").addEventListener("click",()=>compose());
  $("mRefresh").addEventListener("click",()=>loadList(STATE.mailbox,true));
  $("mDisc").addEventListener("click",async()=>{ if(confirm("Disconnect this mailbox from the app? (Your email is not deleted.)")){ await api("/mail/disconnect",{method:"DELETE"}); route(); } });
  try{
    const { mailboxes }=await api("/mail/mailboxes");
    STATE.mailboxes=(mailboxes||[]).sort((a,b)=>boxRank(a)-boxRank(b)||a.name.localeCompare(b.name));
    renderBoxes();
    loadList("INBOX", true);
  }catch(e){ $("mBoxes").innerHTML=`<div class="err">${esc(e.message)}</div>`; }
}
function renderBoxes(){
  const host=$("mBoxes"); if(!host) return;
  host.innerHTML=STATE.mailboxes.map(b=>`<div data-box="${esc(b.path)}" style="padding:7px 8px;border-radius:7px;cursor:pointer;${b.path===STATE.mailbox?'background:#eef4e8;font-weight:600':''}">${esc(boxLabel(b))}</div>`).join("");
  host.querySelectorAll("[data-box]").forEach(el=>el.addEventListener("click",()=>loadList(el.getAttribute("data-box"),true)));
}

async function loadList(mailbox, reset){
  STATE.mailbox=mailbox; renderBoxes();
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
  if(!STATE.messages.length){ host.innerHTML='<div class="muted" style="padding:14px">No messages.</div>'; return; }
  const more = STATE.messages.length < STATE.total;
  host.innerHTML=STATE.messages.map(m=>`<div data-uid="${m.uid}" data-seq="${m.seq}" style="padding:9px 11px;border-bottom:1px solid var(--line);cursor:pointer;${!m.seen?'background:#fbfdf8':''}">
      <div class="row" style="gap:6px"><b style="font-size:13px;${!m.seen?'':'font-weight:500'}">${esc(addr(m.from)||'(unknown)')}</b>
        <span class="muted" style="font-size:11px;margin-left:auto">${m.date?fmt(m.date):''}</span></div>
      <div style="font-size:13px;${!m.seen?'font-weight:600':''}">${esc(m.subject)}</div></div>`).join("")
    + (more?`<div style="padding:10px;text-align:center"><button class="btn sm" id="mMore">Load older</button></div>`:"");
  host.querySelectorAll("[data-uid]").forEach(el=>el.addEventListener("click",()=>openMessage(el.getAttribute("data-uid"))));
  if($("mMore")) $("mMore").addEventListener("click",()=>loadList(STATE.mailbox,false));
}

async function openMessage(uid){
  const reader=$("mReader"); reader.innerHTML='<div class="muted">Loading…</div>';
  try{
    const m=await api(`/mail/message?mailbox=${encodeURIComponent(STATE.mailbox)}&uid=${encodeURIComponent(uid)}`);
    STATE.current=m;
    const it=STATE.messages.find(x=>String(x.uid)===String(uid)); if(it) it.seen=true; renderList();
    const from=(m.from||[]).map(a=>esc(a.name?`${a.name} <${a.address}>`:a.address)).join(", ");
    const to=(m.to||[]).map(a=>esc(a.address)).join(", ");
    const atts=(m.attachments||[]).map(a=>`<button class="btn sm" data-att="${a.index}" data-name="${esc(a.filename)}" style="margin:2px 4px 0 0">📎 ${esc(a.filename)} <span class="muted">${a.size?Math.round(a.size/1024)+'KB':''}</span></button>`).join("");
    reader.innerHTML=`
      <div class="row" style="gap:6px;margin-bottom:6px">
        <button class="btn sm" id="mReply">↩ Reply</button>
        <button class="btn sm" id="mReplyAll">↩ Reply all</button>
        <button class="btn sm" id="mFwd">➡ Forward</button>
        <button class="btn sm" id="mUnread">Mark unread</button>
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
function quote(m){
  const who=(m.from&&m.from[0])?(m.from[0].name||m.from[0].address):"";
  const body=m.text || (m.html?m.html.replace(/<[^>]+>/g," "):"");
  return `\n\n----- On ${m.date?fmt(m.date):''}, ${who} wrote: -----\n`+String(body).split("\n").map(l=>"> "+l).join("\n");
}
function replyDraft(m, all){
  const to=(m.from||[]).map(a=>a.address).join(", ");
  const cc=all?(m.to||[]).map(a=>a.address).filter(x=>x&&x!==((window.OPS.profile&&window.OPS.profile.email))).join(", "):"";
  return { to, cc, subject:/^re:/i.test(m.subject||"")?m.subject:("Re: "+(m.subject||"")), body:quote(m),
    inReplyTo:m.messageId, references:m.messageId };
}
function forwardDraft(m){
  return { to:"", subject:/^fwd:/i.test(m.subject||"")?m.subject:("Fwd: "+(m.subject||"")), body:quote(m) };
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
    <label>Message</label><textarea id="coBody" class="in" rows="10" style="width:100%">${esc(seed.body||'')}</textarea>
    <div class="row" style="gap:8px;margin-top:6px"><button class="btn sm" id="coAttach">📎 Attach</button><input type="file" id="coFile" multiple style="display:none"><span id="coFiles" class="muted" style="font-size:12px"></span></div>
    <div id="coErr" class="err" style="min-height:18px"></div>
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:6px"><button class="btn sm" id="coCancel">Cancel</button><button class="btn green" id="coSend">Send</button></div>
  </div>`;
  document.body.appendChild(wrap);
  const close=()=>wrap.remove();
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
      await api("/mail/send",{ method:"POST", body:{ to, cc:$("coCc").value.trim()||undefined,
        subject:$("coSub").value.trim(), text:$("coBody").value,
        inReplyTo:seed.inReplyTo, references:seed.references, attachments } });
      close();
    }catch(e){ err.textContent=e.message; $("coSend").disabled=false; $("coSend").textContent="Send"; }
  });
}
function toB64(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).split(",")[1]||""); r.onerror=rej; r.readAsDataURL(file); }); }

window.OPS.routes.mail = route;
})();
