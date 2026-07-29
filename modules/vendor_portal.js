/* ============================================================================
   DroCon Cloud — Vendor Portal (Phase 1: identities & logins)
   - vendorPilots()   : VENDOR (external) manages its own pilots and requests
                        a login for each; the login is pending until DroCon
                        approves it.
   - pilotApprovals() : DroCon (internal) approves / rejects pilot login
                        requests raised by vendors.
   Later phases add pilot acre reporting, field issues and vendor invoicing.
   ============================================================================ */
(function(){
const { $, esc, fmt } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const chip = (s)=>({approved:"ok",pending:"warn",rejected:"err"}[s]||"warn");

/* ---------------------------------------------------------------- VENDOR --- */
async function vendorPilots(){
  const m=$("main");
  const vendorId = window.OPS.profile && window.OPS.profile.party_id;
  m.innerHTML=`<div class="eyebrow">Vendor Portal</div><h1>My Pilots</h1>
    <div class="callout">Add your pilots and request a login for each. DroCon reviews and <b>approves</b> the login before the pilot can sign in. Once approved, the pilot signs up in the app using the <b>same email</b>.</div>
    <div class="card"><h3>Add a pilot</h3>
      <div class="fgrid">
        <div class="field"><label>Pilot name *</label><input id="vpName"></div>
        <div class="field"><label>Mobile</label><input id="vpPhone"></div>
        <div class="field"><label>RPC No.</label><input id="vpRpc"></div>
        <div class="field"><label>Drone UIN</label><input id="vpUin"></div>
      </div>
      <div class="row"><button class="btn green" id="vpAdd">Add pilot</button><div class="spacer"></div><div class="err" id="vpErr"></div></div>
    </div>
    <div id="vpList" class="muted">Loading…</div>`;
  $("vpAdd").addEventListener("click",async()=>{
    const name=$("vpName").value.trim(); if(!name){ $("vpErr").textContent="Pilot name is required."; return; }
    if(!vendorId){ $("vpErr").textContent="Your login is not linked to a vendor. Contact DroCon."; return; }
    const rec={ vendor_id:vendorId, name, phone:$("vpPhone").value.trim()||null,
      rpc_no:$("vpRpc").value.trim()||null, drone_uin:$("vpUin").value.trim()||null, created_by:window.OPS.me.id };
    $("vpAdd").disabled=true; const { error }=await sb().from("pilots").insert(rec); $("vpAdd").disabled=false;
    if(error){ $("vpErr").textContent=error.message; return; }
    window.OPS.flashTop("Pilot added ✓"); ["vpName","vpPhone","vpRpc","vpUin"].forEach(id=>$(id).value=""); load();
  });
  load();

  async function load(){
    const [{data:pilots},{data:invites}]=await Promise.all([
      sb().from("pilots").select("*").order("name"),
      sb().from("partner_invites").select("*").eq("party_type","pilot")
    ]);
    const invByPilot={}; (invites||[]).forEach(i=>{ if(i.party_id) invByPilot[i.party_id]=i; });
    const rows=pilots||[];
    $("vpList").innerHTML = rows.length ? `<div class="card"><h3>Pilots</h3><div style="overflow:auto">
      <table><thead><tr><th>Name</th><th>Mobile</th><th>RPC</th><th>Login</th><th></th></tr></thead>
      <tbody>${rows.map(p=>{ const iv=invByPilot[p.id];
        const login = iv ? (iv.used_at ? '<span class="chip ok">active</span>'
                        : `<span class="chip ${chip(iv.status)}">${esc(iv.status)}</span> <span class="muted">${esc(iv.email)}</span>`)
                       : '<span class="muted">— no login —</span>';
        return `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.phone||"")}</td><td>${esc(p.rpc_no||"")}</td>
          <td>${login}</td>
          <td>${iv?'':`<button class="btn sm" data-req="${p.id}" data-nm="${esc(p.name)}">Request login</button>`}</td></tr>`;
      }).join("")}</tbody></table></div></div>`
      : '<div class="card muted">No pilots yet. Add your first pilot above.</div>';
    $("vpList").querySelectorAll("[data-req]").forEach(b=>b.addEventListener("click",()=>requestLogin(b.getAttribute("data-req"), b.getAttribute("data-nm"))));
  }
  function requestLogin(pilotId, name){
    const email=prompt("Pilot's email for the login (they will sign up with this exact email):","");
    if(email===null) return;
    const e=email.trim().toLowerCase(); if(!e){ alert("Email required."); return; }
    sb().from("partner_invites").insert({ email:e, party_type:"pilot", party_id:pilotId, party_name:name,
      vendor_id:vendorId, status:"pending", created_by:window.OPS.me.id }).then(({error})=>{
        if(error){ alert(error.message); return; }
        window.OPS.flashTop("Login requested — pending DroCon approval ✓"); load();
      });
  }
}

/* ------------------------------------------------------------- INTERNAL --- */
async function pilotApprovals(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Review / Approvals</div><h1>Pilot Logins</h1>
    <div class="callout">Vendors request logins for their pilots here. <b>Approve</b> to let the pilot sign up (with the listed email); <b>reject</b> to decline. Approving does not create the account — the pilot self-signs-up afterwards.</div>
    <div id="paList" class="muted">Loading…</div>`;
  load();
  async function load(){
    const { data, error }=await sb().from("v_pilot_login_requests").select("*").order("created_at",{ascending:false});
    if(error){ $("paList").innerHTML='<div class="card muted">'+esc(error.message)+'</div>'; return; }
    const rows=data||[];
    const pending=rows.filter(r=>r.status==="pending" && !r.used_at);
    $("paList").innerHTML=`
      <div class="card"><h3>Pending (${pending.length})</h3>${
        pending.length?`<div style="overflow:auto"><table><thead><tr><th>Pilot</th><th>Vendor</th><th>Email</th><th>Requested</th><th></th></tr></thead>
        <tbody>${pending.map(r=>`<tr><td><b>${esc(r.pilot_name||"")}</b></td><td>${esc(r.vendor_name||"")}</td><td>${esc(r.email)}</td>
          <td class="muted">${fmt(r.created_at)}</td>
          <td><button class="btn sm green" data-ap="${r.id}">Approve</button> <button class="btn sm" data-rj="${r.id}" style="color:#a3322a;border-color:#e4b4b4">Reject</button></td></tr>`).join("")}</tbody></table></div>`
        :'<div class="muted">Nothing awaiting approval.</div>'}</div>
      ${rows.length?`<div class="card"><h3>All requests</h3><div style="overflow:auto">
        <table><thead><tr><th>Pilot</th><th>Vendor</th><th>Email</th><th>Status</th><th>Login</th></tr></thead>
        <tbody>${rows.map(r=>`<tr><td>${esc(r.pilot_name||"")}</td><td>${esc(r.vendor_name||"")}</td><td>${esc(r.email)}</td>
          <td><span class="chip ${chip(r.status)}">${esc(r.status)}</span></td>
          <td>${r.used_at?'<span class="chip ok">active</span>':'<span class="muted">not signed up</span>'}</td></tr>`).join("")}</tbody></table></div></div>`:''}`;
    $("paList").querySelectorAll("[data-ap]").forEach(b=>b.addEventListener("click",()=>act(b.getAttribute("data-ap"),"approved")));
    $("paList").querySelectorAll("[data-rj]").forEach(b=>b.addEventListener("click",()=>act(b.getAttribute("data-rj"),"rejected")));
  }
  async function act(id, status){
    if(status==="rejected" && !confirm("Reject this pilot login request?")) return;
    const { error }=await sb().rpc("set_pilot_invite_status",{ p_id:id, p_status:status });
    if(error){ alert(error.message); return; }
    window.OPS.flashTop("Pilot login "+status+" ✓"); load();
  }
}

window.OPS.routes.vendor_pilots   = vendorPilots;
window.OPS.routes.pilot_approvals = pilotApprovals;
})();
