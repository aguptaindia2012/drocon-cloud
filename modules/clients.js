/* ============================================================================
   DroCon Cloud — Clients registry + Authorized Partners pool
   Both use the generic OPS.makeRegistry factory. Clients feed Invoice/Credit
   Note; Authorized Partners feed the location-based search (Phase 3 search UI).
   ============================================================================ */
(function(){
const { esc, money } = window.OPS.helpers;

window.OPS.routes.clients = window.OPS.makeRegistry({
  tool:"clients", table:"clients", title:"Clients", eyebrow:"Finance", approvable:true, logView:true,
  orderBy:"name",
  searchKeys:["name","firm_name","mobile","city","state","gstin"],
  listCols:[
    {key:"firm_name", label:"Firm / Buyer", fmt:(v,r)=>esc(v||r.name||"")},
    {key:"name", label:"Contact"},
    {key:"mobile", label:"Mobile", mask:true},
    {key:"city", label:"City"},
    {key:"state", label:"State"},
    {key:"client_type", label:"Type"},
  ],
  fields:[
    {key:"firm_name", label:"Firm / Buyer Name", required:true, full:true},
    {key:"name", label:"Contact Person"},
    {key:"mobile", label:"Mobile"},
    {key:"email", label:"Email"},
    {key:"gstin", label:"GSTIN / UIN (or URP)"},
    {key:"client_type", label:"Client Type", type:"select", options:["","Key Client","Normal"]},
    {key:"address", label:"Address", type:"textarea", full:true},
    {key:"city", label:"City"},
    {key:"state", label:"State"},
    {key:"state_code", label:"State Code"},
    {key:"pincode", label:"Pincode"},
    {key:"notes", label:"Notes", type:"textarea", full:true},
  ],
});

window.OPS.routes.partners = window.OPS.makeRegistry({
  tool:"partners", table:"authorized_partners", title:"Authorized Partners", eyebrow:"Order Management", logView:true,
  orderBy:"name",
  extraActions:[{ label:"🔎 Pilot Finder", fn:()=>{ if(window.OPS.partnerFinder) window.OPS.partnerFinder(); } }],
  searchKeys:["name","company","phone","home_state","home_district","drone_model"],
  listCols:[
    {key:"name", label:"Pilot / Partner"},
    {key:"company", label:"Company"},
    {key:"phone", label:"Phone", mask:true},
    {key:"home_district", label:"Home District"},
    {key:"home_state", label:"Home State"},
    {key:"capacity_acres_day", label:"Acres/Day", num:true},
  ],
  fields:[
    {key:"name", label:"Pilot / Partner Name", required:true, full:true},
    {key:"company", label:"Company (if drone-owning company)"},
    {key:"phone", label:"Phone"},
    {key:"email", label:"Email"},
    {key:"home_state", label:"Home State"},
    {key:"home_district", label:"Home District"},
    {key:"home_lat", label:"Home Latitude", type:"number"},
    {key:"home_lng", label:"Home Longitude", type:"number"},
    {key:"drone_model", label:"Drone Model"},
    {key:"battery", label:"Battery Sets"},
    {key:"capacity_acres_day", label:"Capacity (Acres/Day)", type:"number"},
    {key:"notes", label:"Notes", type:"textarea", full:true},
  ],
});
})();
