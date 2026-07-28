/* ============================================================================
   DroCon Cloud — Crops register (name + auto number). Selected via dropdown
   wherever a crop is entered; drives crop-wise location rates.
   ============================================================================ */
(function(){
window.OPS.routes.crops_master = window.OPS.makeRegistry({
  tool:"crops_master", table:"crops", title:"Crops", eyebrow:"Registers", orderBy:"crop_no",
  searchKeys:["name"],
  listCols:[
    {key:"crop_no", label:"ID"},
    {key:"name",    label:"Crop"},
  ],
  fields:[
    {key:"name", label:"Crop name", required:true, full:true},
  ],
});
})();
