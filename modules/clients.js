/* ============================================================================
   DroCon Cloud — Clients registry + Authorized Partners pool
   Both use the generic OPS.makeRegistry factory. Clients feed Invoice/Credit
   Note; Authorized Partners feed the location-based search (Phase 3 search UI).
   ============================================================================ */
(function(){
const { $, esc, money } = window.OPS.helpers;

/* Client Portal admin: assign which locations a client login can see, and the
   NDA-gated Excel download toggle. Rendered under the Clients edit form. */
async function clientPortalExtras(rec, host){
  if(!(window.OPS.isAdmin && window.OPS.isAdmin())){ return; }
  const sb=window.OPS.sb;
  host.innerHTML=`<div class="card" style="margin-top:12px"><h3 style="margin:0 0 4px">Client portal</h3>
    <div class="muted" style="font-size:12px;margin-bottom:8px">Create the client's login in <b>Account access</b> above (access type <b>Client portal</b>), then pick the locations they may see. The live view is always allowed; <b>downloads stay off until you enable them after an NDA</b>.</div>
    <div id="cpLocs" class="muted">Loading locations…</div>
    <div style="margin-top:12px;border-top:1px solid var(--line);padding-top:10px">
      <label style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" id="cpExp" style="width:auto"> Allow Excel downloads (only after NDA is signed)</label>
      <label style="display:block;margin-top:6px">NDA reference / note</label>
      <input id="cpExpNote" class="in" style="max-width:420px" placeholder="e.g. NDA signed 2026-09-18">
      <div style="margin-top:8px"><button class="btn sm" id="cpExpSave">Save download setting</button> <span id="cpExpOut" class="muted" style="font-size:12px"></span></div>
    </div></div>
    <div class="card" style="margin-top:12px"><h3 style="margin:0 0 4px">Portal logins (POCs)</h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px">Authorise one or more people from the client to access this portal. Each email gets its own login and sees this client's assigned locations.</div>
      <div id="cpPoc" class="muted">Loading…</div>
      <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
        <input id="cpPocName" class="in" placeholder="Contact name" style="max-width:180px">
        <input id="cpPocEmail" class="in" type="email" placeholder="email@company.com" style="max-width:240px">
        <button class="btn green sm" id="cpPocAdd">Add &amp; create login</button>
      </div>
      <div id="cpPocOut" style="margin-top:8px"></div></div>`;
  // ---- POC logins (multiple emails per client) ----
  async function loadPocs(){
    const { data }=await sb.from("client_pocs").select("*").eq("client_id",rec.id).order("created_at");
    const pocs=data||[];
    $("cpPoc").innerHTML = pocs.length ? `<div style="border:1px solid var(--line);border-radius:8px;padding:6px">${pocs.map(p=>`<div class="row" style="justify-content:space-between;padding:2px 0"><span>${esc(p.name||"")} <span class="muted">${esc(p.email)}</span></span><button class="btn sm ghost" data-poc="${esc(p.email)}">Remove</button></div>`).join("")}</div>` : '<div class="muted">No POC logins yet.</div>';
    $("cpPoc").querySelectorAll("[data-poc]").forEach(b=>b.addEventListener("click",async()=>{
      const email=b.getAttribute("data-poc");
      if(!confirm("Remove "+email+" from this client's POC list? (Their login is not deleted — reset or disable it separately if needed.)")) return;
      const { error }=await sb.from("client_pocs").delete().eq("client_id",rec.id).eq("email",email);
      if(error){ alert(error.message); return; } loadPocs();
    }));
  }
  loadPocs();
  $("cpPocAdd").addEventListener("click",async()=>{
    const email=($("cpPocEmail").value||"").trim().toLowerCase(), name=($("cpPocName").value||"").trim(), out=$("cpPocOut");
    if(!email){ out.innerHTML='<span class="err">Enter an email.</span>'; return; }
    $("cpPocAdd").disabled=true;
    try{
      const { error }=await sb.from("client_pocs").upsert({client_id:rec.id, email, name:name||null}); if(error) throw error;
      const r=await window.OPS.accountAccess.adminCall({ action:"create", email, full_name:name||"", access:"client", party_id:rec.id });
      out.innerHTML = r.temp_password
        ? `<div class="card" style="background:#fbfdf8"><b>Login created ✓</b><div style="font-size:13px;margin-top:4px">Email: <code>${esc(email)}</code><br>Temporary password: <code style="font-size:15px">${esc(r.temp_password)}</code></div><div class="muted" style="font-size:12px;margin-top:6px">Share securely (not via the messenger). They sign in and change it.</div></div>`
        : '<div class="card" style="background:#fbfdf8">An account already existed for this email — it is now linked as a client POC.</div>';
      $("cpPocEmail").value=""; $("cpPocName").value=""; loadPocs();
    }catch(e){ out.innerHTML='<span class="err">'+esc(e.message)+'</span>'; }
    $("cpPocAdd").disabled=false;
  });
  $("cpExp").checked = !!rec.portal_export_allowed;
  $("cpExpNote").value = rec.portal_export_note||"";
  $("cpExpSave").addEventListener("click",async()=>{
    $("cpExpSave").disabled=true;
    const { error }=await sb.from("clients").update({ portal_export_allowed:$("cpExp").checked, portal_export_note:$("cpExpNote").value||null }).eq("id",rec.id);
    $("cpExpSave").disabled=false;
    $("cpExpOut").textContent = error ? ("Error: "+error.message) : "Saved ✓";
  });
  const [allLocs, assigned] = await Promise.all([
    sb.from("spray_locations").select("id,name,district,state").order("name").then(r=>r.data||[]),
    sb.from("client_locations").select("location_id").eq("client_id",rec.id).then(r=>(r.data||[]).map(x=>x.location_id))
  ]);
  const set=new Set(assigned), locsHost=$("cpLocs");
  if(!allLocs.length){ locsHost.innerHTML='<div class="muted">No locations exist yet — add them in Trackers → Locations first.</div>'; return; }
  locsHost.innerHTML=`<div style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:8px">
    ${allLocs.map(l=>`<label style="display:flex;gap:8px;align-items:center;padding:2px 0"><input type="checkbox" class="cpL" value="${l.id}" ${set.has(l.id)?'checked':''} style="width:auto"><span>${esc(l.name)}${l.district?` <span class="muted">· ${esc(l.district)}</span>`:''}</span></label>`).join("")}</div>
    <div style="margin-top:8px"><button class="btn sm green" id="cpLocSave">Save assigned locations</button> <span id="cpLocOut" class="muted" style="font-size:12px"></span></div>`;
  $("cpLocSave").addEventListener("click",async()=>{
    const now=new Set(Array.from(document.querySelectorAll(".cpL:checked")).map(e=>e.value));
    const toAdd=[...now].filter(id=>!set.has(id)), toDel=[...set].filter(id=>!now.has(id));
    $("cpLocSave").disabled=true;
    try{
      if(toAdd.length){ const { error }=await sb.from("client_locations").insert(toAdd.map(location_id=>({client_id:rec.id,location_id}))); if(error) throw error; }
      if(toDel.length){ const { error }=await sb.from("client_locations").delete().eq("client_id",rec.id).in("location_id",toDel); if(error) throw error; }
      set.clear(); now.forEach(id=>set.add(id)); $("cpLocOut").textContent="Saved ✓";
    }catch(e){ $("cpLocOut").textContent="Error: "+e.message; }
    $("cpLocSave").disabled=false;
  });
}

const MSA_RESPONSIBILITIES = [
"Authorized Partner responsibilities (as per the Master Service Agreement):",
"1. Provide airworthy, DGCA-compliant drones with valid UIN and third-party liability insurance.",
"2. Deploy trained pilots holding valid Remote Pilot Certificates (RPC).",
"3. Mobilise to assigned locations on time and adhere to the agreed spray schedule.",
"4. Keep drones, batteries and spares in serviceable condition; carry adequate backups.",
"5. Record daily acreage and farmer data and share GPS-tagged proof of every spray.",
"6. Follow all safety, regulatory and DroCon Bharat operational guidelines.",
"7. Bill at the agreed rate; DroCon Bharat's fee/commission applies as per the MSA."
].join("\n");

window.OPS.routes.clients = window.OPS.makeRegistry({
  tool:"clients", table:"clients", title:"Clients", eyebrow:"Finance", approvable:true, logView:true,
  orderBy:"firm_name",
  autoNumber:{ field:"client_ref", rpc:"next_client_code" },
  formExtra:(rec,host)=>{
    const a=document.createElement("div"), b=document.createElement("div");
    host.appendChild(a); host.appendChild(b);
    window.OPS.accountAccess.panel({mode:"client"})(rec,a);
    clientPortalExtras(rec,b);
  },
  convertTo:{ tool:"vendors", label:"→ Also add as Vendor",
    map:r=>({ firm_name:r.firm_name||r.name, name:r.name, mobile:r.mobile, email:r.email, gstin:r.gstin,
      address:r.address, city:r.city||r.district, state:r.state, pincode:r.pincode, notes:r.notes,
      country:"India", currency:"INR" }) },
  searchKeys:["name","firm_name","client_ref","mobile","district","state","gstin"],
  listCols:[
    {key:"firm_name", label:"Party Name", fmt:(v,r)=>esc(v||r.name||"")},
    {key:"client_ref", label:"Client No."},
    {key:"gstin", label:"GSTIN"},
    {key:"district", label:"District"},
    {key:"state", label:"State"},
    {key:"mobile", label:"Mobile", mask:true},
  ],
  fields:[
    {key:"firm_name", label:"Party Name", required:true, full:true},
    {key:"client_ref", label:"Client Number"},
    {key:"gstin", label:"GST Number (or URP)", required:true},
    {key:"state", label:"State", type:"state"},
    {key:"district", label:"District", type:"district", dependsOn:"state"},
    {key:"name", label:"Contact Person", required:true},
    {key:"mobile", label:"Mobile", required:true},
    {key:"email", label:"Email"},
    {key:"client_type", label:"Client Type", type:"select", options:["","Key Client","Normal"]},
    {key:"address", label:"Address", type:"textarea", full:true, required:true},
    {key:"city", label:"City"},
    {key:"pincode", label:"Pincode"},
    {key:"notes", label:"Notes", type:"textarea", full:true},
  ],
});

window.OPS.routes.partners = window.OPS.makeRegistry({
  tool:"partners", table:"authorized_partners", title:"Authorized Partners", eyebrow:"Business Development", logView:true,
  orderBy:"name",
  extraActions:[{ label:"🔎 Pilot Finder", fn:()=>{ if(window.OPS.partnerFinder) window.OPS.partnerFinder(); } }],
  searchKeys:["name","company","phone","home_state","home_district","drone_model"],
  defaults:{ responsibilities:MSA_RESPONSIBILITIES },
  summary:(rows)=>{ const drones=rows.reduce((s,r)=>s+(Number(r.drones_provided)||0),0);
    const cap=rows.reduce((s,r)=>s+(Number(r.capacity_acres_day)||0),0);
    const cos=rows.filter(r=>r.company).length;
    return `<div class="callout">This is the <b>home of all contracted Authorized Partners</b> — onboard and list every partner here. Their commission <b>rate cards</b> live in <b>Partners → Authorized Partner</b>, and you create their portal <b>login + review their invoices</b> in <b>Partners → Invoice Approvals</b>. Link each partner's signed agreement below.</div>
    <div class="statrow">
      <div class="stat"><div class="n">${rows.length}</div><div class="l">Partners / pilots</div></div>
      <div class="stat"><div class="n">${drones}</div><div class="l">Drones provided</div></div>
      <div class="stat"><div class="n">${cap}</div><div class="l">Capacity (acres/day)</div></div>
      <div class="stat"><div class="n">${cos}</div><div class="l">Drone-owning companies</div></div>
    </div>`; },
  listCols:[
    {key:"name", label:"Pilot / Partner"},
    {key:"company", label:"Company"},
    {key:"phone", label:"Phone", mask:true},
    {key:"home_district", label:"Home District"},
    {key:"drones_provided", label:"Drones", num:true},
    {key:"capacity_acres_day", label:"Acres/Day", num:true},
  ],
  fields:[
    {key:"name", label:"Pilot / Partner Name", required:true, full:true},
    {key:"company", label:"Company (if drone-owning company)"},
    {key:"phone", label:"Phone"},
    {key:"email", label:"Email"},
    {key:"home_state", label:"Home State", type:"state"},
    {key:"home_district", label:"Home District", type:"district", dependsOn:"home_state"},
    {key:"drones_provided", label:"No. of Drones Provided", type:"number"},
    {key:"drone_model", label:"Drone Model"},
    {key:"battery", label:"Battery Sets"},
    {key:"capacity_acres_day", label:"Capacity (Acres/Day)", type:"number"},
    {key:"home_lat", label:"Home Latitude", type:"number"},
    {key:"home_lng", label:"Home Longitude", type:"number"},
    {key:"agreement_link", label:"Signed agreement link (drive URL)", full:true},
    {key:"responsibilities", label:"Responsibilities (as per MSA)", type:"textarea", full:true},
    {key:"notes", label:"Notes", type:"textarea", full:true},
  ],
});
})();
