/* ============================================================================
   DroCon Cloud — Clients registry + Authorized Partners pool
   Both use the generic OPS.makeRegistry factory. Clients feed Invoice/Credit
   Note; Authorized Partners feed the location-based search (Phase 3 search UI).
   ============================================================================ */
(function(){
const { esc, money } = window.OPS.helpers;

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
    {key:"gstin", label:"GST Number (or URP)"},
    {key:"state", label:"State", type:"state"},
    {key:"district", label:"District", type:"district", dependsOn:"state"},
    {key:"name", label:"Contact Person"},
    {key:"mobile", label:"Mobile"},
    {key:"email", label:"Email"},
    {key:"client_type", label:"Client Type", type:"select", options:["","Key Client","Normal"]},
    {key:"address", label:"Address", type:"textarea", full:true},
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
