/* ============================================================================
   DroCon Cloud — System Health / Self-test (admin)
   Runs a battery of read-only checks against the live database and reports
   pass / warn / fail, so you can confirm the tool's data is consistent after
   deploys or big edits. Nothing here writes data.
   ============================================================================ */
(function(){
const { $, esc, num, money } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const near = (a,b,tol)=> Math.abs(num(a)-num(b)) <= (tol==null?0.5:tol);

// each check returns { status:'pass'|'warn'|'fail', detail:string }
const CHECKS = [
  { name:"Session & role", run: async()=>{
      const { data:{ session } }=await sb().auth.getSession();
      if(!session) return { status:"fail", detail:"No active session." };
      const p=window.OPS.profile||{};
      return { status:"pass", detail:`Signed in as ${p.email||p.full_name||"?"} · role ${p.role||"?"}` };
    }},
  { name:"Accounting entries balanced (Dr = Cr)", run: async()=>{
      const { data, error }=await sb().from("accounting_entries").select("debit,credit").limit(100000);
      if(error) return { status:"warn", detail:error.message };
      const dr=(data||[]).reduce((s,r)=>s+num(r.debit),0), cr=(data||[]).reduce((s,r)=>s+num(r.credit),0);
      return near(dr,cr,1) ? { status:"pass", detail:`Dr ${money(dr)} = Cr ${money(cr)}` }
                           : { status:"fail", detail:`Out of balance by ${money(dr-cr)} (Dr ${money(dr)} / Cr ${money(cr)})` };
    }},
  { name:"Trial balance nets to zero", run: async()=>{
      const { data, error }=await sb().from("v_trial_balance").select("*");
      if(error) return { status:"warn", detail:"v_trial_balance not available: "+error.message };
      let dr=0, cr=0; (data||[]).forEach(r=>{ dr+=num(r.debit!=null?r.debit:r.dr); cr+=num(r.credit!=null?r.credit:r.cr); });
      return near(dr,cr,1) ? { status:"pass", detail:`${(data||[]).length} accounts · balanced` }
                           : { status:"fail", detail:`Trial balance off by ${money(dr-cr)}` };
    }},
  { name:"Partner invoices: gross − margin = net", run: async()=>{
      const { data, error }=await sb().from("partner_invoices").select("id,gross,commission_total,net_payable,party_type").limit(500);
      if(error) return { status:"warn", detail:error.message };
      const ap=(data||[]).filter(r=>r.party_type==="authorized_partner");
      const bad=ap.filter(r=>!near(num(r.gross)-num(r.commission_total), r.net_payable, 1));
      return bad.length ? { status:"fail", detail:`${bad.length} of ${ap.length} invoices don't reconcile` }
                        : { status:"pass", detail:`${ap.length} partner invoice(s) reconcile` };
    }},
  { name:"Paid expense claims have ledger entries", run: async()=>{
      const { data:paid, error }=await sb().from("expense_claims").select("id").eq("status","paid").limit(1000);
      if(error) return { status:"warn", detail:"expense_claims not available: "+error.message };
      if(!paid||!paid.length) return { status:"pass", detail:"No paid claims yet." };
      const { data:ents }=await sb().from("accounting_entries").select("ref_id").eq("ref_type","expense_claim");
      const have=new Set((ents||[]).map(e=>String(e.ref_id)));
      const missing=paid.filter(p=>!have.has(String(p.id)));
      return missing.length ? { status:"fail", detail:`${missing.length} paid claim(s) not posted to accounts` }
                            : { status:"pass", detail:`${paid.length} paid claim(s) posted` };
    }},
  { name:"Acre unbilled view reachable", run: async()=>{
      const { data, error }=await sb().from("v_acre_unbilled_summary").select("location_id").limit(1);
      return error ? { status:"warn", detail:error.message } : { status:"pass", detail:"OK" };
    }},
  { name:"Receipts storage bucket reachable", run: async()=>{
      try{ const { error }=await sb().storage.from("receipts").list("", { limit:1 });
        return error ? { status:"warn", detail:error.message } : { status:"pass", detail:"Bucket OK" };
      }catch(e){ return { status:"warn", detail:String(e&&e.message||e) }; }
    }},
  { name:"Recorded-acres RPC callable", run: async()=>{
      const { error }=await sb().rpc("partner_recorded_acres",{ p_from:"2000-01-01", p_to:"2000-01-02" });
      return error ? { status:"warn", detail:error.message } : { status:"pass", detail:"RPC OK" };
    }},
  { name:"Core tables reachable", run: async()=>{
      const tbls=["employees","clients","vendors","acre_entries","hr_attendance","hr_comp_offs","expense_claims","partner_billing","partner_pilots","hr_month_locks","advances","documents","payments","service_catalogue","spare_catalogue"];
      const bad=[];
      for(const t of tbls){ const { error }=await sb().from(t).select("*",{count:"exact",head:true}); if(error) bad.push(t); }
      return bad.length ? { status:"fail", detail:"Unreachable: "+bad.join(", ") } : { status:"pass", detail:`${tbls.length} tables OK` };
    }},
  { name:"Employee↔login links", run: async()=>{
      const { data, error }=await sb().from("employees").select("id,user_id,status").eq("emp_type","employee");
      if(error) return { status:"warn", detail:error.message };
      const active=(data||[]).filter(e=>e.status==="active");
      const linked=active.filter(e=>e.user_id).length;
      return { status: linked? "pass":"warn", detail:`${linked}/${active.length} active employees have a linked login (needed for self-service)` };
    }},
  { name:"Catalogue items are revenue-categorised", run: async()=>{
      const [svc,spr]=await Promise.all([
        sb().from("service_catalogue").select("rev_category,active"),
        sb().from("spare_catalogue").select("rev_category,active") ]);
      if(svc.error||spr.error) return { status:"warn", detail:"rev_category not available (run sql/111): "+((svc.error||spr.error).message) };
      const all=[...(svc.data||[]),...(spr.data||[])].filter(r=>r.active!==false);
      const unl=all.filter(r=>!r.rev_category).length;
      const cats=new Set(all.map(r=>r.rev_category).filter(Boolean));
      const missing=["spray","demo","part","service"].filter(k=>!cats.has(k));
      if(missing.length) return { status:"warn", detail:`${all.length} items · ${unl} unlabelled · no items in: ${missing.join(", ")}` };
      return unl ? { status:"warn", detail:`${all.length} items · ${unl} still unlabelled` }
                 : { status:"pass", detail:`${all.length} items · all labelled · 4 categories covered` };
    }, fix:{ tool:"catalogues", filter:"unlabelled", label:"Fix in Catalogues ›" } },
  { name:"Invoices linked to a registered client", run: async()=>{
      const { data, error }=await sb().from("documents").select("party_id,data").eq("doc_type","invoice");
      if(error) return { status:"warn", detail:error.message };
      const tax=(data||[]).filter(r=>!(r.data&&r.data.title==="Bill of Supply"));   // acre Bills of Supply aren't client-linked
      const unl=tax.filter(r=>!r.party_id).length;
      return unl ? { status:"warn", detail:`${unl}/${tax.length} tax invoice(s) have no register-linked client — legacy or tracker-imported (client was free-typed). Harmless for reports; to clear, open each and pick/create the client.` }
                 : { status:"pass", detail:`${tax.length} tax invoice(s) all client-linked` };
    }, fix:{ tool:"invoice", filter:"unlinked", label:"Fix in Invoices ›" } },
  { name:"Invoices have a revenue category", run: async()=>{
      const { data, error }=await sb().from("documents").select("data").eq("doc_type","invoice");
      if(error) return { status:"warn", detail:error.message };
      const tot=(data||[]).length; const miss=(data||[]).filter(r=>!(r.data&&r.data.rev_category)).length;
      return miss ? { status:"warn", detail:`${miss}/${tot} invoice(s) have no saved revenue category — created/imported before categories existed. The FY report infers them from HSN/description (figures stay correct); tag via Receivables → By revenue category, or open & save each.` }
                  : { status:"pass", detail:`${tot} invoice(s) categorised` };
    }, fix:{ tool:"invoice", filter:"uncat", label:"Fix in Invoices ›" } },
  { name:"Idle-tracking views reachable", run: async()=>{
      const a=await sb().from("v_idle_active_pilots").select("*").limit(1);
      const b=await sb().from("v_idle_active_locations").select("*").limit(1);
      const bad=[]; if(a.error)bad.push("pilots"); if(b.error)bad.push("locations");
      return bad.length ? { status:"warn", detail:"Unavailable: "+bad.join(", ") } : { status:"pass", detail:"Both idle views OK" };
    }},
];

async function selftest(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Audit</div><h1>System Health</h1>
    <div class="callout">Read-only checks against the live database — run after a deploy or a large edit to confirm the accounting, billing and expense data all reconcile. Nothing here changes any data.</div>
    <details style="margin:8px 0"><summary style="cursor:pointer;font-weight:600">What the results mean</summary>
      <div class="card" style="margin-top:8px">
        <p><span class="chip ok">PASS</span> all good. <span class="chip warn">WARN</span> <b>advisory</b> — usually legacy/imported data worth tidying; nothing is broken and reports are still correct. <span class="chip err">FAIL</span> a real problem to investigate (e.g. ledgers out of balance).</p>
        <p><b>Invoices linked to a registered client (WARN):</b> tax invoices whose client was <b>free-typed or imported</b> before the app enforced picking from the Clients register. Their name/details are still on the invoice, they're just not linked to a client record. Optional to fix — open one and pick/create the client. New invoices are always linked.</p>
        <p><b>Invoices have a revenue category (WARN):</b> invoices <b>created or imported before revenue categories existed</b>. They have no saved category, so the FY report classifies them automatically from HSN/description — the totals are correct, they're just not explicitly tagged. Tag them in <b>Finance → Invoices &amp; Receivables → By revenue category</b> (expand a bucket, select, move), or open &amp; save each. These won't appear as “special” anywhere in the accounting screens — that's why you can't spot them by browsing.</p>
      </div>
    </details>
    <div class="row" style="margin:10px 0"><button class="btn green sm" id="stRun">▶ Run all checks</button><span id="stSum" class="muted"></span></div>
    <div class="row" style="margin:0 0 10px;gap:8px"><span class="muted" style="align-self:center">Clean-up lists:</span>
      <button class="btn sm" id="stUncat">Uncategorised invoices</button>
      <button class="btn sm" id="stUnlinked">Unlinked (no register client)</button></div>
    <div id="stList"></div>
    <div id="stBody" class="muted">Press <b>Run all checks</b> to begin.</div>`;
  $("stRun").addEventListener("click",e=>window.OPS.once(e.currentTarget,runAll));
  $("stUncat").addEventListener("click",()=>listInvoices("uncat"));
  $("stUnlinked").addEventListener("click",()=>listInvoices("unlinked"));
}
async function runAll(){
  const body=$("stBody"); const chip=s=> s==="pass"?'<span class="chip ok">PASS</span>':s==="warn"?'<span class="chip warn">WARN</span>':'<span class="chip err">FAIL</span>';
  body.innerHTML=`<div style="overflow:auto"><table><thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead><tbody>
    ${CHECKS.map((c,i)=>`<tr id="st_${i}"><td><b>${esc(c.name)}</b></td><td>…</td><td class="muted">running…</td></tr>`).join("")}</tbody></table></div>`;
  let pass=0,warn=0,fail=0; const t0=Date.now();
  for(let i=0;i<CHECKS.length;i++){
    let r; try{ r=await CHECKS[i].run(); }catch(e){ r={ status:"fail", detail:String(e&&e.message||e) }; }
    if(r.status==="pass")pass++; else if(r.status==="warn")warn++; else fail++;
    const row=$("st_"+i); if(row){ row.children[1].innerHTML=chip(r.status);
      const fx=CHECKS[i].fix;
      row.children[2].innerHTML=esc(r.detail||"")+((r.status!=="pass"&&fx)?` <button class="btn sm" data-fix="${i}" style="margin-left:6px">${esc(fx.label||"Go fix ›")}</button>`:"");
      row.children[2].className=r.status==="fail"?"":"muted"; }
  }
  $("stBody").querySelectorAll("[data-fix]").forEach(b=>b.addEventListener("click",()=>gotoFix(CHECKS[+b.getAttribute("data-fix")].fix)));
  $("stSum").innerHTML=` ${pass} pass · ${warn} warn · ${fail} fail · ${((Date.now()-t0)/1000).toFixed(1)}s`;
  window.OPS.flashTop(fail? (fail+" check(s) FAILED") : (warn? "All critical checks passed (some warnings)":"All checks passed ✓"));
}
// ---- clean-up lists: invoices missing a revenue category / not linked to a client ----
async function listInvoices(kind){
  const host=$("stList"); if(!host) return;
  host.innerHTML='<div class="muted" style="margin:6px 0">Loading…</div>';
  const { data, error }=await sb().from("documents").select("number,doc_date,party_id,party_snapshot,totals,data")
    .eq("doc_type","invoice").order("doc_date",{ascending:false});
  if(error){ host.innerHTML='<div class="card" style="color:#a3322a">'+esc(error.message)+'</div>'; return; }
  const isBoS=r=> r.data && r.data.title==="Bill of Supply";
  let rows=data||[]; let title;
  if(kind==="uncat"){ rows=rows.filter(r=>!(r.data&&r.data.rev_category)); title="Invoices with no saved revenue category"; }
  else { rows=rows.filter(r=>!r.party_id && !isBoS(r)); title="Tax invoices not linked to a register client"; }
  const fd=window.OPS.helpers.fmtDate;
  host.innerHTML=`<div class="card">
    <div class="row"><h3 style="margin:0">${esc(title)} — ${rows.length}</h3><div class="spacer"></div>
      <button class="btn sm" id="stOpenInv">Open Invoices tab ›</button></div>
    ${rows.length?`<div style="overflow:auto"><table><thead><tr><th>Invoice</th><th>Date</th><th>Client</th><th class="num">Total</th>${kind==='uncat'?'<th>Type</th>':''}</tr></thead>
      <tbody>${rows.map(r=>`<tr><td><b>${esc(r.number||'')}</b></td><td>${esc(fd(r.doc_date))}</td>
        <td>${esc((r.party_snapshot||{}).firmName||(r.party_snapshot||{}).name||'')}</td>
        <td class="num">${money((r.totals||{}).total)}</td>${kind==='uncat'?('<td>'+(isBoS(r)?'Bill of Supply':'Tax Invoice')+'</td>'):''}</tr>`).join("")}</tbody></table></div>
      <p class="muted">${kind==='uncat'
        ? 'Tag these in <b>Finance → Invoices &amp; Receivables → By revenue category</b> (expand a bucket → select → move), or open &amp; save each.'
        : 'Open each and pick/create the client to link it. Harmless to leave as historical.'}</p>`
    :'<p class="muted">None 🎉</p>'}
  </div>`;
  const ob=$("stOpenInv"); if(ob) ob.addEventListener("click",()=>gotoFix({tool:"invoice", filter:(kind==='uncat'?'uncat':'unlinked')}));
}

// jump to the tab that can fix a warning, with its filter pre-applied
function gotoFix(fix){ if(!fix) return;
  if(fix.tool==="invoice")    window.OPS._invFilter=fix.filter;
  if(fix.tool==="catalogues") window.OPS._catFilter=fix.filter;
  if(window.OPS.openTool) window.OPS.openTool(fix.tool);
}

window.OPS.routes.selftest = selftest;
})();
