/* ============================================================================
   DroCon Cloud — Vendors registry (pulled into the Purchase Order)
   Replicates the client tracker with vendor-specific fields (country, currency,
   default terms) so overseas suppliers (e.g. China) are supported.
   ============================================================================ */
(function(){
const { $, esc } = window.OPS.helpers;

/* Vendor POCs: authorise several portal logins per vendor (mirror of client POCs). */
async function vendorPocExtras(rec, host){
  if(!(window.OPS.isAdmin && window.OPS.isAdmin())){ return; }
  const sb=window.OPS.sb;
  host.innerHTML=`<div class="card" style="margin-top:12px"><h3 style="margin:0 0 4px">Portal logins (POCs)</h3>
    <div class="muted" style="font-size:12px;margin-bottom:8px">Authorise one or more people from this vendor to access the Vendor Portal. Each email gets its own login sharing this vendor's pilots, acre review and invoicing.</div>
    <div id="vpPoc" class="muted">Loading…</div>
    <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
      <input id="vpPocName" class="in" placeholder="Contact name" style="max-width:180px">
      <input id="vpPocEmail" class="in" type="email" placeholder="email@company.com" style="max-width:240px">
      <button class="btn green sm" id="vpPocAdd">Add &amp; create login</button>
    </div>
    <div id="vpPocOut" style="margin-top:8px"></div></div>`;
  async function loadPocs(){
    const { data }=await sb.from("vendor_pocs").select("*").eq("vendor_id",rec.id).order("created_at");
    const pocs=data||[];
    $("vpPoc").innerHTML = pocs.length ? `<div style="border:1px solid var(--line);border-radius:8px;padding:6px">${pocs.map(p=>`<div class="row" style="justify-content:space-between;padding:2px 0"><span>${esc(p.name||"")} <span class="muted">${esc(p.email)}</span></span><button class="btn sm ghost" data-poc="${esc(p.email)}">Remove</button></div>`).join("")}</div>` : '<div class="muted">No POC logins yet.</div>';
    $("vpPoc").querySelectorAll("[data-poc]").forEach(b=>b.addEventListener("click",async()=>{
      const email=b.getAttribute("data-poc");
      if(!confirm("Remove "+email+" from this vendor's POC list? (Their login is not deleted — reset or disable it separately if needed.)")) return;
      const { error }=await sb.from("vendor_pocs").delete().eq("vendor_id",rec.id).eq("email",email);
      if(error){ alert(error.message); return; } loadPocs();
    }));
  }
  loadPocs();
  $("vpPocAdd").addEventListener("click",async()=>{
    const email=($("vpPocEmail").value||"").trim().toLowerCase(), name=($("vpPocName").value||"").trim(), out=$("vpPocOut");
    if(!email){ out.innerHTML='<span class="err">Enter an email.</span>'; return; }
    $("vpPocAdd").disabled=true;
    try{
      const { error }=await sb.from("vendor_pocs").upsert({vendor_id:rec.id, email, name:name||null}); if(error) throw error;
      const r=await window.OPS.accountAccess.adminCall({ action:"create", email, full_name:name||"", access:"vendor", party_id:rec.id });
      out.innerHTML = r.temp_password
        ? `<div class="card" style="background:#fbfdf8"><b>Login created ✓</b><div style="font-size:13px;margin-top:4px">Email: <code>${esc(email)}</code><br>Temporary password: <code style="font-size:15px">${esc(r.temp_password)}</code></div><div class="muted" style="font-size:12px;margin-top:6px">Share securely (not via the messenger).</div></div>`
        : '<div class="card" style="background:#fbfdf8">An account already existed for this email — it is now linked as a vendor POC.</div>';
      $("vpPocEmail").value=""; $("vpPocName").value=""; loadPocs();
    }catch(e){ out.innerHTML='<span class="err">'+esc(e.message)+'</span>'; }
    $("vpPocAdd").disabled=false;
  });
}

window.OPS.routes.vendors = window.OPS.makeRegistry({
  tool:"vendors", table:"vendors", title:"Vendors", eyebrow:"Finance", approvable:true, logView:true,
  formExtra:(rec,host)=>{
    const a=document.createElement("div"), b=document.createElement("div");
    host.appendChild(a); host.appendChild(b);
    window.OPS.accountAccess.panel({mode:"vendor"})(rec,a);
    vendorPocExtras(rec,b);
  },
  orderBy:"name",
  searchKeys:["name","firm_name","city","country","gstin","email"],
  convertTo:{ tool:"clients", label:"→ Also add as Client",
    map:r=>({ firm_name:r.firm_name||r.name, name:r.name, mobile:r.mobile, email:r.email, gstin:r.gstin,
      address:r.address, city:r.city, state:r.state, pincode:r.pincode, notes:r.notes }) },
  listCols:[
    {key:"firm_name", label:"Firm", fmt:(v,r)=>esc(v||r.name||"")},
    {key:"name", label:"Contact"},
    {key:"country", label:"Country"},
    {key:"currency", label:"Currency"},
    {key:"mobile", label:"Phone", mask:true},
    {key:"gstin", label:"GSTIN"},
  ],
  fields:[
    {key:"firm_name", label:"Vendor / Firm Name", required:true, full:true},
    {key:"name", label:"Contact Person"},
    {key:"mobile", label:"Phone"},
    {key:"email", label:"Email"},
    {key:"gstin", label:"GSTIN / Tax ID"},
    {key:"country", label:"Country", type:"select", options:["India","China","Other"]},
    {key:"currency", label:"Currency", type:"select", options:["INR","USD","CNY","EUR"]},
    {key:"address", label:"Address", type:"textarea", full:true},
    {key:"city", label:"City"},
    {key:"state", label:"State / Province (free text — vendors may be overseas)"},
    {key:"pincode", label:"Postal Code"},
    {key:"default_terms", label:"Default PO Terms (editable per PO)", type:"textarea", full:true},
    {key:"notes", label:"Notes", type:"textarea", full:true},
  ],
});
})();
