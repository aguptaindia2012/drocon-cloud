/* ============================================================================
   DroCon Cloud — access logging
   OPS.access.log(table, id, label) records that the current user viewed a
   sensitive record. The Access Log view (admin-only) shows the history.
   ============================================================================ */
(function(){
const { $, esc, fmt } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;

const LABELS = { clients:"Client", vendors:"Vendor", authorized_partners:"Partner",
  employees:"Employee", salary_runs:"Salary records", documents:"Document", farmer_sprays:"Farmer" };

async function log(table, id, label){
  try{ await sb().from("access_log").insert({ viewer:window.OPS.me.id, table_name:table, record_id:String(id||""), label:label||null }); }catch(e){}
}

async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Audit</div><h1>Access Log</h1>
    <p class="muted">Who opened which sensitive record (clients, vendors, partners, employees, salary records, documents).</p>
    <div class="row" style="margin:8px 0"><input id="alSearch" placeholder="Search user / record…" style="max-width:280px"></div>
    <div id="alBody" class="muted">Loading…</div>`;
  const { data }=await sb().from("access_log").select("*, who:viewer(full_name,email)").order("created_at",{ascending:false}).limit(500);
  const all=data||[];
  function render(rows){
    $("alBody").innerHTML = rows.length ? `<table><thead><tr><th>When</th><th>User</th><th>Type</th><th>Record</th></tr></thead>
      <tbody>${rows.map(e=>`<tr><td class="muted">${fmt(e.created_at)}</td><td>${esc((e.who&&(e.who.full_name||e.who.email))||"")}</td>
        <td><span class="tag">${esc(LABELS[e.table_name]||e.table_name)}</span></td><td>${esc(e.label||e.record_id||"")}</td></tr>`).join("")}</tbody></table>`
      : '<div class="card muted">No access events recorded yet.</div>';
  }
  render(all);
  $("alSearch").addEventListener("input",ev=>{ const q=ev.target.value.toLowerCase().trim();
    render(!q?all:all.filter(e=>[(e.who&&(e.who.full_name||e.who.email)),e.label,e.table_name].some(v=>String(v||"").toLowerCase().includes(q)))); });
}

window.OPS.access = { log };
window.OPS.routes.access_log = view;
})();
