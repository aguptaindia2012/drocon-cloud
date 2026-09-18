/* ============================================================================
   DroCon Cloud — Short-day reasons (<12 acres)
   One screen, three scopes via the short_days() RPC:
     short_days        (internal)  — DroCon staff record reasons
     vendor_short_days (vendor)     — a vendor records reasons for its locations
     client_short_days (client)     — read-only for the client's locations
   Reasons flow into the Client & Vendor portals and help time location closures
   and pilot/vendor deactivation. Threshold (12 ac) is enforced in the RPC.
   ============================================================================ */
(function(){
const { $, esc, num, fmtDate } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;

async function render(scope){
  const m=$("main");
  const editable = scope==="internal" || scope==="vendor";
  const eyebrow  = scope==="client" ? "Client Portal" : scope==="vendor" ? "Vendor Portal" : "Review / Approvals";
  m.innerHTML=`<div class="eyebrow">${eyebrow}</div><h1>Short-day Reasons</h1>
    <div class="callout">Pilot-days under <b>12 acres</b> (last 45 days).${editable
      ? " Record why the day fell short — this is shared with the client and helps decide when to close a location or deactivate a pilot/vendor."
      : " Reasons recorded by the DroCon team or vendor for days below the minimum on your locations."}</div>
    <div id="sdList" class="muted">Loading…</div>`;
  let rows;
  try{ const { data, error }=await sb().rpc("short_days",{ p_scope:scope, p_from:null, p_to:null }); if(error) throw error; rows=data||[]; }
  catch(e){ $("sdList").innerHTML=`<div class="err">${esc(e.message)}</div>`; return; }
  if(!rows.length){ $("sdList").innerHTML='<div class="card muted">No pilot-days under 12 acres in the last 45 days. 👍</div>'; return; }
  $("sdList").innerHTML=`<div class="card"><div class="row" style="margin-bottom:6px"><b>${rows.length}</b><span class="muted" style="margin-left:6px">short day${rows.length===1?'':'s'} · ${rows.filter(r=>!r.reason).length} without a reason</span></div>
    <div style="overflow:auto"><table><thead><tr><th>Date</th><th>Location</th><th>Pilot</th><th class="num">Acres</th><th style="min-width:260px">Reason</th>${editable?'<th></th>':''}</tr></thead>
    <tbody>${rows.map((r,i)=>`<tr>
      <td>${fmtDate(r.entry_date)}</td><td>${esc(r.location_name||"")}</td><td>${esc(r.pilot_name||"")}</td><td class="num">${num(r.acres).toFixed(1)}</td>
      <td>${editable?`<input class="in sdr" data-i="${i}" value="${esc(r.reason||"")}" placeholder="Reason for the short day" style="width:100%">`:(r.reason?esc(r.reason):'<span class="muted">—</span>')}</td>
      ${editable?`<td><button class="btn sm" data-save="${i}">Save</button></td>`:''}</tr>`).join("")}</tbody></table></div></div>`;
  if(editable){
    $("sdList").querySelectorAll("[data-save]").forEach(b=>b.addEventListener("click",async()=>{
      const i=+b.getAttribute("data-save"), r=rows[i];
      const reason=$("sdList").querySelector(`.sdr[data-i="${i}"]`).value.trim();
      b.disabled=true; b.textContent="…";
      const { error }=await sb().rpc("set_short_day_reason",{ p_date:r.entry_date, p_location:r.location_id, p_pilot_name:r.pilot_name, p_acres:r.acres, p_reason:reason||null });
      b.disabled=false; b.textContent="Save";
      if(error){ alert(error.message); return; } r.reason=reason; window.OPS.flashTop("Saved ✓");
    }));
  }
}

window.OPS.routes.short_days        = ()=>render("internal");
window.OPS.routes.vendor_short_days = ()=>render("vendor");
window.OPS.routes.client_short_days = ()=>render("client");
})();
