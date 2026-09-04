/* ============================================================================
   DroCon Cloud — Internal Messenger (Teams-like, no calling)
   Channels + Direct Messages + threaded replies + @mentions (bell alerts) +
   the option to attach a message to an approval item. Internal users only.
   Backed by sql/81_messenger.sql (chat_* tables + RPCs).
   ============================================================================ */
(function(){
const { $, esc, fmt } = window.OPS.helpers;
const sb  = ()=>window.OPS.sb;
const meId= ()=> (window.OPS.me && window.OPS.me.id);

let ROSTER=[];                 // [{id,name,email}]
let CUR=null;                  // current channel {id,name,kind,dm_peer,topic}
let CHANNELS=[];               // sidebar list
let THREAD=null;               // open thread root id (or null)
let _poll=null, _mentions=new Set();

function rosterName(id){ const r=ROSTER.find(x=>x.id===id); return r?r.name:"—"; }
function chTitle(c){ return c.kind==="dm" ? (c.dm_peer||"Direct message") : ("# "+(c.name||"channel")); }
function when(ts){ try{ const d=new Date(ts), now=new Date();
  const sameDay=d.toDateString()===now.toDateString();
  return sameDay ? d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})
                 : d.toLocaleDateString([], {day:"2-digit",month:"short"})+" "+d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  }catch(e){ return fmt(ts); } }

async function loadRoster(){ try{ const { data }=await sb().rpc("chat_roster"); ROSTER=data||[]; }catch(e){ ROSTER=[]; } }
async function loadChannels(){ const { data }=await sb().rpc("chat_my_channels"); CHANNELS=data||[]; }

/* ------------------------------------ shell ------------------------------------ */
async function route(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Messenger</div><h1>Team Chat</h1>
    <div class="callout" style="margin-bottom:8px">Channels for the whole team, direct messages 1:1, threaded replies, and <b>@mentions</b> that ring the bell. No calls.</div>
    <div id="msgWrap" style="display:grid;grid-template-columns:270px 1fr;gap:12px;align-items:start">
      <div class="card" style="padding:10px">
        <div class="row" style="gap:6px;margin-bottom:8px">
          <button class="btn green sm" id="mNewCh">+ Channel</button>
          <button class="btn blue sm" id="mNewDm">+ Direct</button>
        </div>
        <input id="mFind" class="in" placeholder="Search…" style="width:100%;margin-bottom:8px">
        <div id="mList" class="muted" style="max-height:62vh;overflow:auto">Loading…</div>
      </div>
      <div id="mPane" class="card" style="min-height:60vh;padding:0;display:flex;flex-direction:column"></div>
    </div>`;
  $("mNewCh").addEventListener("click",newChannel);
  $("mNewDm").addEventListener("click",newDm);
  $("mFind").addEventListener("input",renderList);
  await loadRoster(); await loadChannels(); renderList();
  if(CHANNELS.length && !CUR) openChannel(CHANNELS[0]);
  else if(CUR){ const c=CHANNELS.find(x=>x.id===CUR.id); openChannel(c||CUR); }
  else $("mPane").innerHTML='<div class="muted" style="margin:auto;padding:30px">Pick a conversation, or start a new one.</div>';
  startPoll();
}

function renderList(){
  const host=$("mList"); if(!host) return;
  const q=($("mFind")&&$("mFind").value||"").toLowerCase();
  const rows=CHANNELS.filter(c=>chTitle(c).toLowerCase().includes(q));
  if(!rows.length){ host.innerHTML='<div class="muted" style="padding:8px">No conversations yet.</div>'; return; }
  host.innerHTML=rows.map(c=>{
    const active=CUR&&CUR.id===c.id;
    const badge=Number(c.unread)>0?`<span style="background:var(--orange);color:#fff;border-radius:999px;padding:0 7px;font-size:11px;margin-left:auto">${c.unread}</span>`:"";
    return `<div data-cid="${c.id}" class="row" style="gap:6px;padding:8px 9px;border-radius:8px;cursor:pointer;${active?'background:#eef4e8':''}">
      <span style="font-weight:${Number(c.unread)>0?700:500}">${esc(chTitle(c))}</span>${badge}</div>`;
  }).join("");
  host.querySelectorAll("[data-cid]").forEach(el=>el.addEventListener("click",()=>{
    const c=CHANNELS.find(x=>String(x.id)===el.getAttribute("data-cid")); if(c) openChannel(c);
  }));
}

/* --------------------------------- open a channel --------------------------------- */
async function openChannel(c){
  CUR=c; THREAD=null; renderList();
  const pane=$("mPane"); if(!pane) return;
  pane.innerHTML='<div class="muted" style="margin:auto;padding:30px">Loading…</div>';
  const { data:msgs }=await sb().rpc("chat_messages_for",{ p_channel:c.id });
  try{ await sb().rpc("chat_mark_read",{ p_channel:c.id }); }catch(e){}
  drawPane(msgs||[]);
  // refresh unread in the sidebar/nav after marking read
  loadChannels().then(()=>{ renderList(); if(window.OPS.refreshChatBadge) window.OPS.refreshChatBadge(); });
}

function drawPane(msgs){
  const pane=$("mPane"); if(!pane) return;
  const top=msgs.filter(x=>!x.parent_id);
  const replyCount={}; msgs.forEach(x=>{ if(x.parent_id) replyCount[x.parent_id]=(replyCount[x.parent_id]||0)+1; });
  const isDm=CUR.kind==="dm";
  pane.innerHTML=`
    <div class="row" style="gap:8px;padding:11px 14px;border-bottom:1px solid var(--line)">
      <b>${esc(chTitle(CUR))}</b>
      ${CUR.topic?`<span class="muted" style="font-size:12px">${esc(CUR.topic)}</span>`:""}
      <span style="margin-left:auto"></span>
      ${!isDm?'<button class="btn sm" id="mAdd">+ People</button><button class="btn sm" id="mLeave">Leave</button>':""}
    </div>
    <div id="mMsgs" style="flex:1;overflow:auto;padding:12px 14px">${top.map(x=>msgHTML(x,replyCount[x.id]||0)).join("")||'<div class="muted">No messages yet — say hello.</div>'}</div>
    <div id="mComposeWrap" style="border-top:1px solid var(--line);padding:10px 12px">${composerHTML("mMain")}</div>`;
  if($("mAdd")) $("mAdd").addEventListener("click",()=>addPeople(CUR.id));
  if($("mLeave")) $("mLeave").addEventListener("click",()=>leaveChannel(CUR.id));
  wireComposer("mMain", null);
  wireMsgActions();
  const box=$("mMsgs"); if(box) box.scrollTop=box.scrollHeight;
}

function msgHTML(x, replies){
  const mine=x.author===meId();
  const ref=x.ref_type?`<a href="#" data-ref="${esc(x.ref_type)}:${esc(x.ref_id||'')}" style="font-size:11px">🔗 ${esc(x.ref_type.replace(/_/g,' '))}</a>`:"";
  const rc=replies?`<a href="#" data-thread="${x.id}" style="font-size:12px">💬 ${replies} ${replies===1?'reply':'replies'}</a>`:`<a href="#" data-thread="${x.id}" style="font-size:12px;color:var(--muted)">Reply</a>`;
  return `<div class="msgRow" style="margin-bottom:12px">
    <div class="row" style="gap:8px;align-items:baseline">
      <b style="font-size:13px">${esc(mine?'You':x.author_name)}</b>
      <span class="muted" style="font-size:11px">${when(x.created_at)}</span>${x.edited_at?'<span class="muted" style="font-size:11px">(edited)</span>':''}
    </div>
    <div style="font-size:14px;white-space:pre-wrap;margin:1px 0 2px">${linkifyMentions(x.body)}</div>
    <div class="row" style="gap:12px">${rc} ${ref}</div>
  </div>`;
}
function linkifyMentions(body){
  // bold @Name tokens for readability (names come from roster)
  let h=esc(body);
  ROSTER.concat([{name:(window.OPS.profile&&window.OPS.profile.full_name)||"you"}]).forEach(r=>{
    if(!r.name) return; const n=esc(r.name);
    h=h.replace(new RegExp("@"+n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"g"),'<b style="color:var(--blue)">@'+n+'</b>');
  });
  return h;
}

/* --------------------------------- composer + mentions --------------------------------- */
function composerHTML(id){
  return `<div style="position:relative">
    <div id="${id}Ment" class="card" style="display:none;position:absolute;bottom:100%;left:0;max-height:180px;overflow:auto;z-index:5;min-width:200px;padding:4px"></div>
    <textarea id="${id}Txt" class="in" rows="2" placeholder="Write a message… use @ to mention" style="width:100%;resize:vertical"></textarea>
    <div class="row" style="justify-content:space-between;margin-top:6px">
      <span class="muted" style="font-size:11px">Enter to send · Shift+Enter for a new line</span>
      <button class="btn green sm" id="${id}Send">Send</button>
    </div>
  </div>`;
}
function wireComposer(id, parentId){
  const txt=$(id+"Txt"), send=$(id+"Send"), ment=$(id+"Ment");
  if(!txt) return;
  _mentions=new Set();
  function closeMent(){ ment.style.display="none"; }
  txt.addEventListener("keydown",e=>{
    if(e.key==="Enter" && !e.shiftKey && ment.style.display==="none"){ e.preventDefault(); doSend(id,parentId); }
  });
  txt.addEventListener("input",()=>{
    const v=txt.value, caret=txt.selectionStart, upto=v.slice(0,caret);
    const mm=upto.match(/@([\w.]*)$/);
    if(!mm){ closeMent(); return; }
    const term=mm[1].toLowerCase();
    const hits=ROSTER.filter(r=>r.name.toLowerCase().includes(term)).slice(0,6);
    if(!hits.length){ closeMent(); return; }
    ment.innerHTML=hits.map(r=>`<div data-uid="${r.id}" data-name="${esc(r.name)}" style="padding:6px 8px;cursor:pointer;border-radius:6px">${esc(r.name)}</div>`).join("");
    ment.style.display="block";
    ment.querySelectorAll("[data-uid]").forEach(el=>el.addEventListener("mousedown",ev=>{
      ev.preventDefault();
      const name=el.getAttribute("data-name"), uid=el.getAttribute("data-uid");
      txt.value=upto.replace(/@([\w.]*)$/,"@"+name+" ")+v.slice(caret);
      _mentions.add(uid); closeMent(); txt.focus();
    }));
  });
  send.addEventListener("click",()=>doSend(id,parentId));
}
async function doSend(id, parentId){
  const txt=$(id+"Txt"); if(!txt) return;
  const body=txt.value.trim(); if(!body) return;
  // keep only mentions whose @Name still appears in the text
  const mentions=[..._mentions].filter(uid=>{ const r=ROSTER.find(x=>x.id===uid); return r && body.indexOf("@"+r.name)>=0; });
  txt.disabled=true;
  const { error }=await sb().rpc("chat_post",{ p_channel:CUR.id, p_body:body, p_parent:parentId||null,
    p_mentions:mentions.length?mentions:null });
  txt.disabled=false;
  if(error){ alert("Couldn't send: "+error.message); return; }
  txt.value=""; _mentions=new Set();
  if(THREAD) openThread(THREAD, true); else openChannel(CUR);
}

/* --------------------------------- threads --------------------------------- */
function wireMsgActions(){
  const pane=$("mPane"); if(!pane) return;
  pane.querySelectorAll("[data-thread]").forEach(el=>el.addEventListener("click",e=>{ e.preventDefault(); openThread(el.getAttribute("data-thread")); }));
  pane.querySelectorAll("[data-ref]").forEach(el=>el.addEventListener("click",e=>{ e.preventDefault();
    const [t,i]=el.getAttribute("data-ref").split(":"); window.OPS.openTool && window.OPS.openTool("reviews"); }));
}
async function openThread(rootId, keepScroll){
  THREAD=rootId;
  const { data:msgs }=await sb().rpc("chat_messages_for",{ p_channel:CUR.id });
  const root=(msgs||[]).find(x=>String(x.id)===String(rootId));
  const replies=(msgs||[]).filter(x=>String(x.parent_id)===String(rootId));
  const pane=$("mPane");
  pane.innerHTML=`
    <div class="row" style="gap:8px;padding:11px 14px;border-bottom:1px solid var(--line)">
      <button class="btn sm" id="mBack">← Back</button><b>Thread</b>
    </div>
    <div id="mMsgs" style="flex:1;overflow:auto;padding:12px 14px">
      ${root?`<div style="border-left:3px solid var(--green);padding-left:10px;margin-bottom:14px">${msgHTML(root,0)}</div>`:''}
      <div class="muted" style="font-size:12px;margin-bottom:8px">${replies.length} ${replies.length===1?'reply':'replies'}</div>
      ${replies.map(x=>msgHTML(x,0)).join("")}
    </div>
    <div style="border-top:1px solid var(--line);padding:10px 12px">${composerHTML("mThr")}</div>`;
  $("mBack").addEventListener("click",()=>{ THREAD=null; openChannel(CUR); });
  wireComposer("mThr", rootId);
  const box=$("mMsgs"); if(box) box.scrollTop=box.scrollHeight;
}

/* --------------------------------- create / manage --------------------------------- */
function pickPeople(preselect){
  const chosen=new Set(preselect||[]);
  const html=`<input id="ppFind" class="in" placeholder="Filter people…" style="width:100%;margin-bottom:6px">
    <div id="ppList" style="max-height:230px;overflow:auto"></div>`;
  return { html, chosen, wire(){
    const render=()=>{ const q=($("ppFind").value||"").toLowerCase();
      $("ppList").innerHTML=ROSTER.filter(r=>r.name.toLowerCase().includes(q)).map(r=>
        `<label class="row" style="gap:8px;padding:5px 4px"><input type="checkbox" data-uid="${r.id}" ${chosen.has(r.id)?'checked':''}> ${esc(r.name)} <span class="muted" style="font-size:11px">${esc(r.email||'')}</span></label>`).join("")||'<div class="muted">No one matches.</div>';
      $("ppList").querySelectorAll("[data-uid]").forEach(cb=>cb.addEventListener("change",()=>{
        const id=cb.getAttribute("data-uid"); if(cb.checked) chosen.add(id); else chosen.delete(id); })); };
    $("ppFind").addEventListener("input",render); render();
  }};
}
function modal(title, bodyHTML, onOk, okLabel){
  const wrap=document.createElement("div");
  wrap.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:60;display:flex;align-items:center;justify-content:center";
  wrap.innerHTML=`<div class="card" style="width:min(460px,92vw);max-height:86vh;overflow:auto">
    <h3 style="margin:0 0 10px">${esc(title)}</h3>${bodyHTML}
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px">
      <button class="btn sm" id="mkCancel">Cancel</button><button class="btn green sm" id="mkOk">${esc(okLabel||"Create")}</button>
    </div></div>`;
  document.body.appendChild(wrap);
  const close=()=>wrap.remove();
  wrap.addEventListener("click",e=>{ if(e.target===wrap) close(); });
  $("mkCancel").addEventListener("click",close);
  $("mkOk").addEventListener("click",async()=>{ try{ await onOk(close); }catch(err){ alert(err.message||err); } });
  return { close };
}
function newChannel(){
  const pp=pickPeople();
  modal("New channel",
    `<label>Channel name</label><input id="ncName" class="in" placeholder="e.g. Operations" style="width:100%;margin-bottom:8px">
     <label>Topic (optional)</label><input id="ncTopic" class="in" style="width:100%;margin-bottom:10px">
     <label>Add people</label>${pp.html}`,
    async(close)=>{
      const name=$("ncName").value.trim(); if(!name){ alert("Give the channel a name."); return; }
      const { data, error }=await sb().rpc("chat_create_channel",{ p_name:name, p_members:[...pp.chosen], p_topic:$("ncTopic").value.trim()||null });
      if(error) throw error;
      close(); await loadChannels(); renderList();
      const c=CHANNELS.find(x=>String(x.id)===String(data)); if(c) openChannel(c);
    });
  pp.wire();
}
function newDm(){
  modal("New direct message",
    `<input id="dmFind" class="in" placeholder="Search people…" style="width:100%;margin-bottom:6px">
     <div id="dmList" style="max-height:280px;overflow:auto"></div>`,
    async(close)=>{ close(); },"Close");
  const render=()=>{ const q=($("dmFind").value||"").toLowerCase();
    $("dmList").innerHTML=ROSTER.filter(r=>r.name.toLowerCase().includes(q)).map(r=>
      `<div data-uid="${r.id}" class="row" style="gap:8px;padding:7px 6px;cursor:pointer;border-radius:6px"><span>${esc(r.name)}</span><span class="muted" style="font-size:11px;margin-left:auto">${esc(r.email||'')}</span></div>`).join("")||'<div class="muted">No one matches.</div>';
    $("dmList").querySelectorAll("[data-uid]").forEach(el=>el.addEventListener("click",async()=>{
      const uid=el.getAttribute("data-uid");
      const { data, error }=await sb().rpc("chat_open_dm",{ p_other:uid });
      if(error){ alert(error.message); return; }
      document.querySelectorAll(".card").forEach(()=>{}); // no-op
      const modalWrap=el.closest('[style*="position:fixed"]'); if(modalWrap) modalWrap.remove();
      await loadChannels(); renderList();
      const c=CHANNELS.find(x=>String(x.id)===String(data)); if(c) openChannel(c);
    }));
  };
  $("dmFind").addEventListener("input",render); render();
}
function addPeople(cid){
  const pp=pickPeople();
  modal("Add people",pp.html,async(close)=>{
    if(!pp.chosen.size){ close(); return; }
    const { error }=await sb().rpc("chat_add_members",{ p_channel:cid, p_members:[...pp.chosen] });
    if(error) throw error; close();
  },"Add");
  pp.wire();
}
async function leaveChannel(cid){
  if(!confirm("Leave this channel?")) return;
  await sb().rpc("chat_leave",{ p_channel:cid });
  CUR=null; await loadChannels(); renderList();
  $("mPane").innerHTML='<div class="muted" style="margin:auto;padding:30px">Pick a conversation.</div>';
}

/* --------------------------------- polling --------------------------------- */
function startPoll(){
  stopPoll();
  _poll=setInterval(async()=>{
    if(window.OPS.currentTool!=="messenger"){ stopPoll(); return; }
    await loadChannels(); renderList();
    if(CUR && !THREAD){ // refresh open channel quietly
      const { data:msgs }=await sb().rpc("chat_messages_for",{ p_channel:CUR.id });
      const box=$("mMsgs"); const atBottom = box && (box.scrollHeight-box.scrollTop-box.clientHeight<40);
      drawPane(msgs||[]);
      if(atBottom){ const b=$("mMsgs"); if(b) b.scrollTop=b.scrollHeight; }
      sb().rpc("chat_mark_read",{ p_channel:CUR.id }).catch(()=>{});
    }
  }, 12000);
}
function stopPoll(){ if(_poll){ clearInterval(_poll); _poll=null; } }

/* open a channel from a bell notification: link "messenger:<id>" */
window.OPS._notifOpen = window.OPS._notifOpen || {};
window.OPS._notifOpen.messenger = async function(id){
  await loadRoster(); await loadChannels(); renderList();
  const c=CHANNELS.find(x=>String(x.id)===String(id)); if(c) openChannel(c);
};

window.OPS.routes.messenger = route;
})();
