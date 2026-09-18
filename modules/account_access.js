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
  };
}

window.OPS.accountAccess = { adminCall, panel };
})();
