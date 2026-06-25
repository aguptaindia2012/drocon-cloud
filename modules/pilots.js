/* ============================================================================
   DroCon Cloud — Pilot / Partner Finder (Phase 3)
   Search the Authorized Partners pool by region (state/district) to staff an
   upcoming order with the nearest available pilots. Can sync partners from
   agreements issued under the "Authorized Partner" category.
   ============================================================================ */
(function(){
const { $, esc, num } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;

async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Order Management</div><h1>Pilot Finder</h1>
    <div class="callout">Search the Authorized Partner pool by region to assign work to the nearest pilots. Add partners in <b>Order Management → Authorized Partners</b>, or sync them from signed agreements below.</div>
    <div class="card">
      <div class="fgrid three">
        <div class="field"><label>State</label><select id="qState"><option value="">— any —</option></select></div>
        <div class="field"><label>District</label><select id="qDist"><option value="">— any —</option></select></div>
        <div class="field"><label>Search (name / company / drone)</label><input id="qText" placeholder="optional keyword"></div>
      </div>
      <div class="row"><button class="btn sm" id="qSync">⟳ Sync partners from agreements</button>
        <div class="spacer"></div><span class="muted" id="qCount"></span></div>
    </div>
    <div id="pResults" class="muted">Loading…</div>`;
  const { data }=await sb().from("authorized_partners").select("*").order("name");
  const all=data||[];
  const states=[...new Set(all.map(p=>p.home_state).filter(Boolean))].sort();
  $("qState").innerHTML='<option value="">— any —</option>'+states.map(s=>`<option>${esc(s)}</option>`).join("");
  function fillDistricts(){
    const st=$("qState").value;
    const ds=[...new Set(all.filter(p=>!st||p.home_state===st).map(p=>p.home_district).filter(Boolean))].sort();
    $("qDist").innerHTML='<option value="">— any —</option>'+ds.map(d=>`<option>${esc(d)}</option>`).join("");
  }
  fillDistricts();
  function run(){
    const st=$("qState").value, di=$("qDist").value, q=$("qText").value.toLowerCase().trim();
    let rows=all.filter(p=>(!st||p.home_state===st)&&(!di||p.home_district===di)&&(!q||[p.name,p.company,p.drone_model,p.battery].some(v=>String(v||"").toLowerCase().includes(q))));
    // nearest-first when a district is chosen: exact district match already filtered; sort by capacity desc
    rows.sort((a,b)=>num(b.capacity_acres_day)-num(a.capacity_acres_day));
    $("qCount").textContent=rows.length+" of "+all.length+" partners";
    $("pResults").innerHTML = rows.length ? `<div style="overflow:auto"><table><thead><tr><th>Pilot / Partner</th><th>Company</th><th>Phone</th><th>Home</th><th>Drone</th><th class="num">Acres/Day</th><th>Source</th></tr></thead>
      <tbody>${rows.map(p=>`<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.company||'')}</td><td>${esc(p.phone||'')}</td>
        <td>${esc([p.home_district,p.home_state].filter(Boolean).join(", "))}</td><td>${esc(p.drone_model||'')}</td>
        <td class="num">${p.capacity_acres_day||''}</td><td>${p.source==='agreement'?'<span class="chip executed">agreement</span>':'<span class="chip draft">manual</span>'}</td></tr>`).join("")}</tbody></table></div>`
      : '<div class="card muted">No partners match. Widen the search, add partners, or sync from agreements.</div>';
  }
  $("qState").addEventListener("change",()=>{ fillDistricts(); run(); });
  $("qDist").addEventListener("change",run); $("qText").addEventListener("input",run);
  $("qSync").addEventListener("click",()=>syncFromAgreements(run));
  run();
}

async function syncFromAgreements(then){
  // pull agreements categorised as Authorized Partner and create partner rows not already linked
  const { data:ags }=await sb().from("agreements").select("id,title,counterparty,category,data");
  const partnerAgs=(ags||[]).filter(a=>(a.category||"").toLowerCase().includes("authorized partner") || (a.category||"").toLowerCase()==="authorized partner");
  if(!partnerAgs.length){ alert("No agreements categorised as 'Authorized Partner' yet."); return; }
  const { data:existing }=await sb().from("authorized_partners").select("agreement_id,name");
  const linked=new Set((existing||[]).map(p=>p.agreement_id).filter(Boolean));
  const names=new Set((existing||[]).map(p=>(p.name||"").toLowerCase()));
  const toAdd=[];
  partnerAgs.forEach(a=>{
    if(a.agreement_id && linked.has(a.id)) return;
    const f=(a.data&&a.data.fields)||{};
    const name=a.counterparty||f.cpName||a.title; if(!name) return;
    if(linked.has(a.id) || names.has(String(name).toLowerCase())) return;
    toAdd.push({ name, company:f.cpName&&f.cpName!==name?f.cpName:null, phone:f.cpMobile||f.recipientPhone||null,
      email:f.cpEmail||null, home_state:f.cpState||null, home_district:f.cpCity||null,
      source:"agreement", agreement_id:a.id, created_by:window.OPS.me.id });
  });
  if(!toAdd.length){ alert("All Authorized-Partner agreements are already in the pool."); return; }
  const { error }=await sb().from("authorized_partners").insert(toAdd);
  if(error){ alert("Sync failed: "+error.message); return; }
  window.OPS.flashTop("Added "+toAdd.length+" partner(s) from agreements ✓");
  view();
}

window.OPS.routes.pilots = view;
})();
