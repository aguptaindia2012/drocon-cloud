/* ============================================================================
   DroCon Cloud — shared "Account access" panel (admin provisioning)
   Reused by Employees, Vendors, Pilots, Consultants registers. Talks to the
   admin-users Edge Function to create logins, show activation status, reset
   passwords, and set access type (internal My Space vs external portal).
   Wire into a makeRegistry via:  formExtra: OPS.accountAccess.panel({mode:'vendor'})
   ============================================================================ */
(function(){
const { $, esc, fmtDate } = window.OPS.helpers;

async function adminCall(payload){
  const cfg=window.DCB_CONFIG||{};
  const base=(cfg.SUPABASE_URL||"").replace(/\/+$/,"");
  const anon=cfg.SUPABASE_ANON_KEY||"";
  const { data:sess }=await window.OPS.sb.auth.getSession();
  const tok=sess&&sess.session&&sess.session.access_token;
  const res=await fetch(base+"/functions/v1/admin-users",{ method:"POST",
    headers:{ "Content-Type":"application/json", apikey:anon, Authorization:"Bearer "+tok },
    body:JSON.stringify(payload) });
  const j=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error((j.error||("HTTP "+res.status))+(j.detail?(" — "+JSON.stringify(j.detail)):""));
  return j;
}

// All selectable access types (employees can be any; external registers are fixed).
const ALL_OPTS=[
  {v:"internal",           label:"Employee — My Space & internal access"},
  {v:"vendor",             label:"Vendor portal (external)"},
  {v:"authorized_partner", label:"Authorized Partner portal (external)"},
  {v:"consultant",         label:"Consultant portal (external)"},
  {v:"pilot",              label:"Pilot portal (external)"},
  {v:"client",             label:"Client portal (external)"},
];
const LABEL=Object.fromEntries(ALL_OPTS.map(o=>[o.v,o.label]));

// mode: 'employee' (choose any) | 'vendor' | 'pilot' | 'consultant' (fixed external)
function panel(opts){
  const mode=(opts&&opts.mode)||"employee";
  const fixed = mode!=="employee" ? mode : null;     // external registers lock the access type
  return async function(rec, host){
    if(!window.OPS.isAdmin()){ host.innerHTML=""; return; }
    const email=(rec.email||"").trim();
    const fullName=rec.name||rec.firm_name||"";
    host.innerHTML=`<div class="card" style="margin-top:12px"><h3 style="margin:0 0 6px">Account access</h3><div id="acctBody" class="muted">Checking…</div></div>`;
    const body=$("acctBody");
    if(!email){ body.innerHTML='Add the <b>Email</b> above and <b>Save</b> first — then you can create a login here.'; return; }

    let st;
    try{ st=await adminCall({action:"status", email}); }
    catch(e){ body.innerHTML='<span class="err">Account service unavailable: '+esc(e.message)+'</span>'; return; }
    const row=(st.rows&&st.rows[0])||{};
    const wantAccess = fixed || "internal";
    // linked when the account's profile already carries the right access
    const linked = row.has_account && (fixed
      ? (row.party_type===fixed && String(row.party_id||"")===String(rec.id))
      : (row.is_external===false));
    const badge = row.has_account
      ? (row.last_sign_in_at ? '🟢 Active — last sign-in '+fmtDate(row.last_sign_in_at) : '🟡 Created — not signed in yet')
      : '⚪ No account yet';

    const accessControl = fixed
      ? `<div><b>${esc(LABEL[fixed])}</b></div>`
      : `<label>Access type</label><select id="acAccess" style="max-width:340px">${ALL_OPTS.map(o=>`<option value="${o.v}">${esc(o.label)}</option>`).join("")}</select>`;

    body.innerHTML=`
      <div style="margin-bottom:8px">${badge}${row.has_account&&!linked?' <span class="muted">(needs '+esc(fixed?LABEL[fixed]:"internal")+' — click Apply)</span>':''}</div>
      ${accessControl}
      <div class="row" style="gap:8px;margin-top:8px">
        ${row.has_account
          ? '<button class="btn sm" id="acReset">Reset password</button><button class="btn sm" id="acApply">Apply access type</button>'
          : '<button class="btn green sm" id="acCreate">Create login</button>'}
      </div>
      <div id="acOut" style="margin-top:8px"></div>`;
    const out=$("acOut");
    const chosenAccess=()=> fixed || ($("acAccess")?$("acAccess").value:"internal");
    function payloadFor(){
      const access=chosenAccess();
      const p={ action:"create", email, full_name:fullName, access };
      if(access==="internal") p.employee_id=rec.id; else p.party_id=rec.id;
      return p;
    }
    function showPw(pw,note){
      out.innerHTML=`<div class="card" style="background:#fbfdf8"><b>${esc(note||"Login ready")}</b>
        <div style="font-size:13px;margin-top:4px">Email: <code>${esc(email)}</code><br>Temporary password: <code style="font-size:15px">${esc(pw)}</code></div>
        <div class="muted" style="font-size:12px;margin-top:6px">Share this securely (not in the messenger). They can sign in now and should change it after.</div></div>`;
    }
    if($("acCreate")) $("acCreate").addEventListener("click",async()=>{
      const b=$("acCreate"); b.disabled=true; b.textContent="Creating…";
      try{ const r=await adminCall(payloadFor());
        if(r.temp_password) showPw(r.temp_password,"Login created ✓");
        else out.innerHTML='<div class="card" style="background:#fbfdf8">An account already existed for this email — it is now linked. Use <b>Reset password</b> if they need a new one.</div>';
      }catch(e){ out.innerHTML='<span class="err">'+esc(e.message)+'</span>'; b.disabled=false; b.textContent="Create login"; }
    });
    if($("acApply")) $("acApply").addEventListener("click",async()=>{
      try{ await adminCall(payloadFor()); out.innerHTML='<div class="card" style="background:#fbfdf8">Access type applied ✓</div>'; }
      catch(e){ out.innerHTML='<span class="err">'+esc(e.message)+'</span>'; }
    });
    if($("acReset")) $("acReset").addEventListener("click",async()=>{
      if(!confirm("Reset this person's password to a new temporary one?")) return;
      try{ const r=await adminCall({action:"reset", email}); showPw(r.temp_password,"Password reset ✓"); }
      catch(e){ out.innerHTML='<span class="err">'+esc(e.message)+'</span>'; }
    });
    // Pilots register: also allow granting the Pilot Portal to an INTERNAL employee
    if(fixed==="pilot") renderInternalPilotLink(rec, host);
    // Employees register: optionally grant the Pilot Portal to this employee
    if(mode==="employee") renderEmployeePilotGrant(rec, host);
  };
}

// Employees register: pick a pilot record to link this employee's internal login
// to, so they also get the Pilot Portal on top of their internal access.
async function renderEmployeePilotGrant(rec, host){
  if(!rec || !rec.id) return;
  const sb=window.OPS.sb;
  const div=document.createElement("div"); host.appendChild(div);
  const email=(rec.email||"").trim();
  if(!email){ div.innerHTML='<div class="card" style="margin-top:12px"><h3 style="margin:0 0 4px">Pilot Portal (optional)</h3><div class="muted" style="font-size:12px">Add the employee\'s <b>Email</b> above and <b>Save</b>, then create their internal login — after that you can also grant them the Pilot Portal here.</div></div>'; return; }
  let pilots=[], curLink=null;
  try{ [pilots, curLink]=await Promise.all([
    sb.from("pilots").select("id,name").order("name").then(r=>r.data||[]),
    sb.rpc("login_linked_pilot",{p_email:email}).then(r=>(r.data&&r.data[0])||null) ]); }catch(e){}
  const curId=(curLink&&curLink.pilot_id)||"";
  div.innerHTML=`<div class="card" style="margin-top:12px"><h3 style="margin:0 0 4px">Pilot Portal (optional)</h3>
    <div class="muted" style="font-size:12px;margin-bottom:6px">If this employee also flies, grant them the <b>Pilot Portal</b> (Report Acres, My Reports, Field Issues) on top of their internal access. Pick their pilot record below — they must have an <b>internal login</b> (above) first.</div>
    <div class="row" style="gap:6px;flex-wrap:wrap;align-items:center">
      <select id="acEmpPilot" style="max-width:280px"><option value="">— none (no Pilot Portal) —</option>${pilots.map(p=>`<option value="${p.id}"${String(curId)===String(p.id)?' selected':''}>${esc(p.name||"")}</option>`).join("")}</select>
      <button class="btn green sm" id="acEmpPilotSave">Save</button></div>
    <div id="acEmpPilotOut" class="muted" style="font-size:12px;margin-top:6px">${curLink&&curLink.pilot_id?('Currently linked to pilot <b>'+esc(curLink.pilot_name||"")+'</b>.'):''}</div></div>`;
  div.querySelector("#acEmpPilotSave").addEventListener("click",async()=>{
    const pid=div.querySelector("#acEmpPilot").value||null;
    const { error }=await sb.rpc("admin_link_pilot_login",{p_email:email,p_pilot:pid});
    const o=div.querySelector("#acEmpPilotOut");
    o.innerHTML = error ? ('<span class="err">'+esc(error.message)+'</span>')
      : (pid ? "Granted ✓ — they get the Pilot Portal after signing out and back in." : "Removed the Pilot Portal for this login ✓");
  });
}

// Link a DroCon employee's internal login to this pilot record: they keep My
// Space / Mail / Messenger / Policies and ALSO get the Pilot Portal. Rendered
// under the Account access panel in the Pilots register (admins only).
async function renderInternalPilotLink(rec, host){
  const sb=window.OPS.sb;
  const div=document.createElement("div"); host.appendChild(div);
  let cur=null; try{ cur=await sb.rpc("pilot_linked_login",{p_pilot:rec.id}).then(r=>r.data); }catch(e){}
  div.innerHTML=`<div class="card" style="margin-top:12px"><h3 style="margin:0 0 4px">Internal-employee pilot</h3>
    <div class="muted" style="font-size:12px;margin-bottom:6px">If this pilot is a <b>DroCon employee</b>, link their existing internal login here. They keep <b>My Space, Mail, Messenger &amp; Policies</b> and additionally get the <b>Pilot Portal</b> (Report Acres, My Reports, Field Issues) with their regular sign-in — no separate external login needed.</div>
    ${cur?`<div style="margin-bottom:6px">Linked to <b>${esc(cur)}</b></div>`:'<div class="muted" style="margin-bottom:6px">Not linked to any internal login.</div>'}
    <div class="row" style="gap:6px;flex-wrap:wrap"><input id="acPilotEmail" placeholder="employee@droconbharat.com" value="${esc(cur||'')}" style="max-width:280px">
      <button class="btn green sm" id="acPilotLink">Link internal login</button>${cur?'<button class="btn sm" id="acPilotUnlink">Unlink</button>':''}</div>
    <div id="acPilotOut" class="muted" style="font-size:12px;margin-top:6px"></div></div>`;
  const out=()=>div.querySelector("#acPilotOut");
  div.querySelector("#acPilotLink").addEventListener("click",async()=>{
    const email=(div.querySelector("#acPilotEmail").value||"").trim(); if(!email){ out().textContent="Enter the employee's email."; return; }
    const { error }=await sb.rpc("admin_link_pilot_login",{p_email:email,p_pilot:rec.id});
    out().textContent=error?("Error: "+error.message):"Linked ✓ — they get the Pilot Portal after signing out and back in.";
  });
  const un=div.querySelector("#acPilotUnlink"); if(un) un.addEventListener("click",async()=>{
    const { error }=await sb.rpc("admin_link_pilot_login",{p_email:cur,p_pilot:null});
    out().textContent=error?("Error: "+error.message):"Unlinked ✓";
  });
}

window.OPS.accountAccess = { adminCall, panel };
})();
