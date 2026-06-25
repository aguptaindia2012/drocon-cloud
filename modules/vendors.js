/* ============================================================================
   DroCon Cloud — Vendors registry (pulled into the Purchase Order)
   Replicates the client tracker with vendor-specific fields (country, currency,
   default terms) so overseas suppliers (e.g. China) are supported.
   ============================================================================ */
(function(){
const { esc } = window.OPS.helpers;

window.OPS.routes.vendors = window.OPS.makeRegistry({
  tool:"vendors", table:"vendors", title:"Vendors", eyebrow:"Administration",
  orderBy:"name",
  searchKeys:["name","firm_name","city","country","gstin","email"],
  listCols:[
    {key:"firm_name", label:"Firm", fmt:(v,r)=>esc(v||r.name||"")},
    {key:"name", label:"Contact"},
    {key:"country", label:"Country"},
    {key:"currency", label:"Currency"},
    {key:"mobile", label:"Phone"},
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
    {key:"state", label:"State / Province"},
    {key:"pincode", label:"Postal Code"},
    {key:"default_terms", label:"Default PO Terms (editable per PO)", type:"textarea", full:true},
    {key:"notes", label:"Notes", type:"textarea", full:true},
  ],
});
})();
