/* ============================================================================
   DroCon Cloud — Order Tracker (Phase 3)
   Pool of potential orders + a follow-up dashboard. The dashboard surfaces
   orders whose start is approaching so the team can follow up >= 15 days ahead.
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
let tab="upcoming";

// parse "Mar-26" / "March 2026" / ISO date -> YYYY-MM-DD (first of month for month-only)
function toDate(v){
  if(!v) return null;
  if(/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0,10);
  const m=String(v).match(/([A-Za-z]{3,})[-\s]?(\d{2,4})/);
  if(m){ const mon=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(m[1].slice(0,3).toLowerCase());
    if(mon>=0){ let y=+m[2]; if(y<100) y+=2000; return `${y}-${String(mon+1).padStart(2,"0")}-01`; } }
  const d=new Date(v); return isNaN(d)?null:d.toISOString().slice(0,10);
}
function daysTo(d){ if(!d) return null; return Math.round((new Date(d).getTime()-Date.now())/86400000); }

async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Order Management</div><h1>Order Tracker</h1>
    <div class="row" style="margin:10px 0">
      <button class="btn sm ${tab==='upcoming'?'green':''}" data-t="upcoming">Upcoming &amp; follow-ups</button>
      <button class="btn sm ${tab==='all'?'green':''}" data-t="all">All orders</button>
      <div class="spacer"></div>
      <button class="btn sm" id="oImport">⬆ Import CSV</button>
      <button class="btn green sm" id="oNew">+ New order</button>
    </div>
    <div id="oBody" class="muted">Loading…</div>`;
  m.querySelectorAll("[data-t]").forEach(b=>b.addEventListener("click",()=>{ tab=b.getAttribute("data-t"); view(); }));
  $("oNew").addEventListener("click",()=>form(null));
  $("oImport").addEventListener("click",importCSV);
  const { data }=await sb().from("potential_orders").select("*").order("created_at",{ascending:false});
  const all=data||[];
  if(tab==="upcoming") upcoming(all); else listAll(all);
}

function upcoming(all){
  const rows=all.map(o=>{ const sd=o.start_date||toDate(o.start_month); return {o, sd, d:daysTo(sd)}; })
    .filter(x=> x.d!=null && x.d>=-7 && (x.o.status||"").toLowerCase()!=="work completed")
    .sort((a,b)=>a.d-b.d);
  const followNow=rows.filter(x=>x.d<=15);
  $("oBody").innerHTML=`
    <div class="statrow">
      <div class="stat"><div class="n">${rows.length}</div><div class="l">Upcoming (next ~)</div></div>
      <div class="stat"><div class="n">${followNow.length}</div><div class="l">Follow up now (&le;15d)</div></div>
    </div>
    <div class="card"><h3>Follow-up queue</h3>
      ${rows.length?`<div style="overflow:auto"><table><thead><tr><th>Client</th><th>Phone</th><th>Region</th><th>Crop</th><th>Starts</th><th class="num">Days</th><th class="num">Daily acres</th><th>Action</th></tr></thead>
      <tbody>${rows.map(x=>{ const urgent=x.d<=15; return `<tr class="clickable" data-id="${x.o.id}">
        <td><b>${esc(x.o.client_name||'')}</b></td><td>${esc(window.OPS.helpers.maskPhone(x.o.client_phone))}</td>
        <td>${esc([x.o.location,x.o.city,x.o.state].filter(Boolean).join(", "))}</td><td>${esc(x.o.crop||'')}</td>
        <td>${esc(x.o.start_month||fmtDate(x.sd))}</td><td class="num">${x.d}</td><td class="num">${x.o.avg_daily_order||''}</td>
        <td>${urgent?'<span class="chip rejected">Follow up now</span>':'<span class="chip in_review">Upcoming</span>'}</td></tr>`; }).join("")}</tbody></table></div>`
      :'<div class="muted">No upcoming orders with a start date. Add start dates to orders to populate this queue.</div>'}
      <p class="muted">Tip: "Days" is days until the order's start. &le; 15 days &rarr; follow up now.</p></div>`;
  $("oBody").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>form(all.find(o=>String(o.id)===tr.getAttribute("data-id")))));
}

function listAll(all){
  $("oBody").innerHTML=`<div class="searchbar"><input id="oSearch" placeholder="Search client / region / status…" style="max-width:300px"></div><div id="oList"></div>`;
  function render(rows){
    $("oList").innerHTML = rows.length ? `<div style="overflow:auto"><table><thead><tr><th>Client</th><th>Phone</th><th>Status</th><th>Region</th><th>Crop</th><th>Window</th><th class="num">Rate</th></tr></thead>
      <tbody>${rows.map(o=>`<tr class="clickable" data-id="${o.id}"><td><b>${esc(o.client_name||'')}</b></td><td>${esc(window.OPS.helpers.maskPhone(o.client_phone))}</td>
        <td>${esc(o.status||'')}</td><td>${esc([o.city,o.state].filter(Boolean).join(", "))}</td><td>${esc(o.crop||'')}</td>
        <td>${esc([o.start_month,o.end_month].filter(Boolean).join(" → "))}</td><td class="num">${o.gross_rate?money(o.gross_rate):''}</td></tr>`).join("")}</tbody></table></div>`
      : '<div class="card muted">No orders yet.</div>';
    $("oList").querySelectorAll("[data-id]").forEach(tr=>tr.addEventListener("click",()=>form(all.find(o=>String(o.id)===tr.getAttribute("data-id")))));
  }
  render(all);
  $("oSearch").addEventListener("input",e=>{ const q=e.target.value.toLowerCase().trim();
    render(!q?all:all.filter(o=>[o.client_name,o.state,o.city,o.location,o.status,o.crop].some(v=>String(v||"").toLowerCase().includes(q)))); });
}

const FIELDS=[
  {key:"client_name",label:"Client Name",full:true,req:true},
  {key:"client_phone",label:"Phone"},
  {key:"referral_agent",label:"Referral (Agent)"},
  {key:"status",label:"Status",type:"select",opts:["New Client","In Discussion","Confirmed","Work Completed","Lost"]},
  {key:"state",label:"State",type:"state"},{key:"district",label:"District",type:"district",dependsOn:"state"},
  {key:"city",label:"City"},{key:"location",label:"Location"},
  {key:"crop",label:"Crop"},
  {key:"start_month",label:"Start (month, e.g. Mar-26)"},{key:"end_month",label:"End (month)"},
  {key:"start_date",label:"Start date (for follow-up)",type:"date"},
  {key:"gross_rate",label:"Gross Rate (₹/acre)",type:"number"},
  {key:"commission",label:"Commission (₹/acre)",type:"number"},
  {key:"avg_daily_order",label:"Avg Daily Order (acres)",type:"number"},
  {key:"client_pref",label:"Client Preference"},
  {key:"order_pref",label:"Order Preference"},
  {key:"notes",label:"Notes",type:"textarea",full:true},
];
function form(rec){
  const e=rec||{}; const m=$("main");
  m.innerHTML=`<button class="btn sm" id="oBack">← Back to Order Tracker</button>
    <div class="card" style="margin-top:12px"><h1>${rec?"Edit":"New"} order</h1>
      <div class="fgrid">${FIELDS.map(f=>{ const v=e[f.key]==null?"":e[f.key];
        const inner=f.type==="select"?`<select id="of_${f.key}"><option value=""></option>${f.opts.map(o=>`<option ${String(v)===o?'selected':''}>${o}</option>`).join("")}</select>`
          :f.type==="state"?window.OPS.geoUI.stateSelect("of_"+f.key,v)
          :f.type==="district"?window.OPS.geoUI.districtSelect("of_"+f.key,v,e.state||"")
          :f.type==="textarea"?`<textarea id="of_${f.key}">${esc(v)}</textarea>`
          :`<input id="of_${f.key}" type="${f.type==='number'?'number':f.type==='date'?'date':'text'}" ${f.type==='number'?'step="any"':''} value="${esc(v)}">`;
        return `<div class="field ${f.full?'full':''}"><label>${esc(f.label)}${f.req?' *':''}</label>${inner}</div>`; }).join("")}</div>
      <div class="row"><button class="btn green" id="oSave">${rec?"Save":"Create"}</button><button class="btn" id="oCancel">Cancel</button>
        <div class="spacer"></div>${rec && window.OPS.canDelete()?'<button class="btn sm" id="oDel" style="color:#a3322a;border-color:#e4b4b4">Delete</button>':''}</div>
      <div class="err" id="oErr"></div></div>`;
  $("oBack").addEventListener("click",view); $("oCancel").addEventListener("click",view);
  window.OPS.geoUI.wire("of_state","of_district");
  $("oSave").addEventListener("click",async()=>{
    const out={}; for(const f of FIELDS){ let v=$("of_"+f.key).value; if(f.type==="number") v=v===""?null:num(v); out[f.key]=v===""?null:v;
      if(f.req&&!v){ $("oErr").textContent=f.label+" required."; return; } }
    if(!out.start_date && out.start_month) out.start_date=toDate(out.start_month);
    if(rec){ const { error }=await sb().from("potential_orders").update(out).eq("id",rec.id); if(error){ $("oErr").textContent=error.message; return; } }
    else { out.created_by=window.OPS.me.id; const { error }=await sb().from("potential_orders").insert(out); if(error){ $("oErr").textContent=error.message; return; } }
    window.OPS.flashTop("Saved ✓"); view();
  });
  if($("oDel")) $("oDel").addEventListener("click",async()=>{ if(!confirm("Delete this order?"))return; await sb().from("potential_orders").delete().eq("id",rec.id); view(); });
}

function importCSV(){
  window.OPS.csv.pickCSV(async rows=>{
    if(!rows.length){ alert("No rows."); return; }
    const map={"client name":"client_name","client phone number":"client_phone","client phone":"client_phone",
      "client referal (agent name)":"referral_agent","referral":"referral_agent","status":"status","state":"state","district":"district","city":"city",
      "location":"location","crop":"crop","start date":"start_month","end date":"end_month","gross rate":"gross_rate",
      "commission":"commission","average daily order":"avg_daily_order","client preference":"client_pref","order preference":"order_pref"};
    const recs=rows.map(r=>{ const o={created_by:window.OPS.me.id};
      Object.keys(r).forEach(h=>{ const k=map[h.toLowerCase().trim()]; if(!k) return; let v=r[h];
        if(["gross_rate","commission","avg_daily_order"].includes(k)) v=v===""?null:num(String(v).replace(/[₹,\s]/g,""));
        o[k]=v===""?null:v; });
      if(o.start_month) o.start_date=toDate(o.start_month);
      return o;
    }).filter(o=>o.client_name);
    if(!confirm("Import "+recs.length+" orders?")) return;
    const { error }=await sb().from("potential_orders").insert(recs);
    if(error){ alert("Import failed: "+error.message); return; }
    window.OPS.flashTop("Imported "+recs.length+" ✓"); view();
  });
}

window.OPS.routes.orders = view;
window.OPS._orderHelpers = { toDate, daysTo };
})();
