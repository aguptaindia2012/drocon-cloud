/* ============================================================================
   DroCon Cloud — Consolidated Output Dashboard (Phase 3)
   The "one screen" the user asked for: receivables & aging, upcoming orders to
   follow up, last-7-day acreage by state, and a farmer-data snapshot.
   Read-only roll-up across modules.
   ============================================================================ */
(function(){
const { $, esc, num, money, fmtDate, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const days = d => d ? Math.max(0, Math.floor((Date.now()-new Date(d).getTime())/86400000)) : 0;

async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Administration</div><h1>Dashboards</h1><div id="dbBody" class="muted">Loading…</div>`;
  const [inv, cn, pay, far, acre, ord] = await Promise.all([
    sb().from("documents").select("id,doc_date,totals").eq("doc_type","invoice"),
    sb().from("documents").select("related_doc_id,totals").eq("doc_type","credit_note"),
    sb().from("payments").select("document_id,amount"),
    sb().from("farmer_sprays").select("village,acre"),
    sb().from("acre_entries").select("entry_date,acres,amount, loc:location_id(name,state)"),
    sb().from("potential_orders").select("*"),
  ]);
  const invoices=inv.data||[], credits=cn.data||[], pays=pay.data||[], farmers=far.data||[], acres=acre.data||[], orders=ord.data||[];

  // ---- receivables aging ----
  const paidBy={}, credBy={};
  pays.forEach(p=>paidBy[p.document_id]=(paidBy[p.document_id]||0)+num(p.amount));
  credits.forEach(c=>{ if(c.related_doc_id) credBy[c.related_doc_id]=(credBy[c.related_doc_id]||0)+num((c.totals||{}).total); });
  const buckets={"0-30":0,"31-60":0,"61-90":0,">90":0}; let totRec=0, totInv=0;
  invoices.forEach(r=>{ const gross=num((r.totals||{}).total); totInv+=gross;
    const bal=gross-(paidBy[r.id]||0)-(credBy[r.id]||0); if(bal>0.01){ totRec+=bal; const a=days(r.doc_date);
      buckets[a<=30?"0-30":a<=60?"31-60":a<=90?"61-90":">90"]+=bal; } });

  // ---- upcoming orders ----
  const oh=window.OPS._orderHelpers||{toDate:()=>null,daysTo:()=>null};
  const up=orders.map(o=>{ const sd=o.start_date||oh.toDate(o.start_month); return {o,sd,d:oh.daysTo(sd)}; })
    .filter(x=>x.d!=null && x.d>=-3 && (x.o.status||"").toLowerCase()!=="work completed").sort((a,b)=>a.d-b.d).slice(0,10);

  // ---- last 7 days acreage by state ----
  const since=new Date(Date.now()-7*86400000).toISOString().slice(0,10);
  const byState={}; acres.filter(r=>r.entry_date>=since).forEach(r=>{ const s=(r.loc&&r.loc.state)||"(unknown)"; byState[s]=byState[s]||{a:0,r:0}; byState[s].a+=num(r.acres); byState[s].r+=num(r.amount); });
  const states=Object.entries(byState).map(([k,v])=>({k,...v})).sort((a,b)=>b.a-a.a);

  // ---- farmer snapshot ----
  const byV={}; farmers.forEach(r=>{ const v=r.village||"(unknown)"; byV[v]=byV[v]||{t:0,n:0}; byV[v].t+=num(r.acre); byV[v].n++; });
  const villages=Object.entries(byV).map(([v,o])=>({v,t:o.t,n:o.n,avg:o.t/o.n})).sort((a,b)=>b.t-a.t).slice(0,8);

  $("dbBody").innerHTML=`
    <div class="statrow">
      <div class="stat"><div class="n">${money(totRec)}</div><div class="l">Total receivable</div></div>
      <div class="stat"><div class="n">${money(totInv)}</div><div class="l">Total invoiced</div></div>
      <div class="stat"><div class="n">${up.length}</div><div class="l">Upcoming orders</div></div>
      <div class="stat"><div class="n">${states.reduce((s,x)=>s+x.a,0).toFixed(0)}</div><div class="l">Acres last 7 days</div></div>
    </div>

    <div class="card"><h3>Receivables aging</h3>
      <table><thead><tr><th>0–30</th><th>31–60</th><th>61–90</th><th>&gt;90</th></tr></thead>
      <tbody><tr><td>${money(buckets["0-30"])}</td><td>${money(buckets["31-60"])}</td>
        <td style="${buckets["61-90"]>0?'color:#9a5b00;font-weight:700':''}">${money(buckets["61-90"])}</td>
        <td style="${buckets[">90"]>0?'color:#a3322a;font-weight:700':''}">${money(buckets[">90"])}</td></tr></tbody></table>
      <p class="muted">Detail + record payments in <b>Invoices &amp; Receivables</b>.</p></div>

    <div class="card"><h3>Upcoming orders — follow up</h3>
      ${up.length?`<table><thead><tr><th>Client</th><th>Region</th><th>Crop</th><th>Starts</th><th class="num">Days</th></tr></thead>
      <tbody>${up.map(x=>`<tr><td><b>${esc(x.o.client_name||'')}</b> ${x.d<=15?'<span class="chip rejected">now</span>':''}</td>
        <td>${esc([x.o.city,x.o.state].filter(Boolean).join(", "))}</td><td>${esc(x.o.crop||'')}</td>
        <td>${esc(x.o.start_month||fmtDate(x.sd))}</td><td class="num">${x.d}</td></tr>`).join("")}</tbody></table>`
      :'<div class="muted">No upcoming orders. Add start dates in the Order Tracker.</div>'}</div>

    <div class="card"><h3>Daily acreage — last 7 days by state</h3>
      ${states.length?`<table><thead><tr><th>State</th><th class="num">Acres</th><th class="num">Revenue</th></tr></thead>
      <tbody>${states.map(s=>`<tr><td><b>${esc(s.k)}</b></td><td class="num">${s.a.toFixed(1)}</td><td class="num">${money(s.r)}</td></tr>`).join("")}</tbody></table>`
      :'<div class="muted">No spraying logged in the last 7 days.</div>'}</div>

    <div class="card"><h3>Farmer snapshot — top villages</h3>
      ${villages.length?`<table><thead><tr><th>Village</th><th class="num">Sprays</th><th class="num">Total acres</th><th class="num">Avg/spray</th></tr></thead>
      <tbody>${villages.map(v=>`<tr><td><b>${esc(v.v)}</b></td><td class="num">${v.n}</td><td class="num">${v.t.toFixed(1)}</td><td class="num">${v.avg.toFixed(2)}</td></tr>`).join("")}</tbody></table>`
      :'<div class="muted">No farmer data yet.</div>'}</div>`;
}

window.OPS.routes.dashboards = view;
})();
