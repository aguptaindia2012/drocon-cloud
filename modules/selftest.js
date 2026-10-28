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
const PC = window.OPS.profitCats;
const isTagged = c => !!(c && PC.isValid(c));

// Cost records missing an explicit profit category (→ counted as Overheads in
// the Category P&L). Vendor spray payouts in `payables` auto-classify via their
// category text, so they don't count as untagged.
async function fetchUntaggedCosts(){
  const [exp,pay,claims,emps,bon]=await Promise.all([
    sb().from("expenses").select("id,expense_date,total,payee_text,note,cost_category"),
    sb().from("payables").select("id,invoice_date,total,vendor_invoice_no,category,cost_category"),
    sb().from("expense_claims").select("id,created_at,total,employee_name,claim_type,status,cost_category"),
    sb().from("employees").select("id,name,cost_split").eq("emp_type","employee").eq("status","active"),
    sb().from("hr_bonuses").select("id,pay_month,amount,payee_name,cost_category"),
  ]);
  const err=[exp,pay,claims,emps,bon].find(r=>r.error); if(err) throw err.error;
  return {
    expenses:(exp.data||[]).filter(r=>!isTagged(r.cost_category)),
    payables:(pay.data||[]).filter(r=>!isTagged(r.cost_category) && !/spray|aerial/i.test(r.category||"")),
    claims:(claims.data||[]).filter(r=>["approved","part_paid","paid"].includes(r.status) && r.claim_type!=="advance" && !isTagged(r.cost_category)),
    salaries:(emps.data||[]).filter(e=>!(e.cost_split && typeof e.cost_split==="object" && Object.keys(e.cost_split).length)),
    bonuses:(bon.data||[]).filter(r=>!isTagged(r.cost_category)),
  };
}

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
    }, fix:{ list:"ledger", label:"Show unbalanced vouchers ›" } },
  { name:"Trial balance nets to zero", run: async()=>{
      const { data, error }=await sb().from("v_trial_balance").select("*");
      if(error) return { status:"warn", detail:"v_trial_balance not available: "+error.message };
      let dr=0, cr=0; (data||[]).forEach(r=>{ dr+=num(r.debit!=null?r.debit:r.dr); cr+=num(r.credit!=null?r.credit:r.cr); });
      return near(dr,cr,1) ? { status:"pass", detail:`${(data||[]).length} accounts · balanced` }
                           : { status:"fail", detail:`Trial balance off by ${money(dr-cr)}` };
    }, fix:{ list:"ledger", label:"Show unbalanced vouchers ›" } },
  { name:"Partner invoices: gross − margin = net", run: async()=>{
      const { data, error }=await sb().from("partner_invoices").select("id,gross,commission_total,net_payable,party_type").limit(500);
      if(error) return { status:"warn", detail:error.message };
      const ap=(data||[]).filter(r=>r.party_type==="authorized_partner");
      const bad=ap.filter(r=>!near(num(r.gross)-num(r.commission_total), r.net_payable, 1));
      return bad.length ? { status:"fail", detail:`${bad.length} of ${ap.length} invoices don't reconcile` }
                        : { status:"pass", detail:`${ap.length} partner invoice(s) reconcile` };
    }, fix:{ list:"partnerinv", label:"Show non-reconciling ›" } },
  { name:"Paid expense claims have ledger entries", run: async()=>{
      const { data:paid, error }=await sb().from("expense_claims").select("id").eq("status","paid").limit(1000);
      if(error) return { status:"warn", detail:"expense_claims not available: "+error.message };
      if(!paid||!paid.length) return { status:"pass", detail:"No paid claims yet." };
      const { data:ents }=await sb().from("accounting_entries").select("ref_id").eq("ref_type","expense_claim");
      const have=new Set((ents||[]).map(e=>String(e.ref_id)));
      const missing=paid.filter(p=>!have.has(String(p.id)));
      return missing.length ? { status:"fail", detail:`${missing.length} paid claim(s) not posted to accounts` }
                            : { status:"pass", detail:`${paid.length} paid claim(s) posted` };
    }, fix:{ list:"claims", label:"Show unposted claims ›" } },
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
    }, fix:{ tool:"hr_employees", label:"Open Employees ›" } },
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
  { name:"Costs tagged to a profit category (Category P&L)", run: async()=>{
      const u=await fetchUntaggedCosts();
      const parts=[];
      if(u.expenses.length) parts.push(u.expenses.length+" direct expense(s)");
      if(u.payables.length) parts.push(u.payables.length+" supplier bill(s)");
      if(u.claims.length)   parts.push(u.claims.length+" approved expense claim(s)");
      if(u.salaries.length) parts.push(u.salaries.length+" employee salary-split(s)");
      if(u.bonuses.length)  parts.push(u.bonuses.length+" bonus(es)");
      return parts.length
        ? { status:"warn", detail:`Untagged → counted as Overheads in Category P&L: ${parts.join(", ")}. Tag the ones that belong to a category (leave true overheads blank).` }
        : { status:"pass", detail:"All costs carry a profit category (or are intentional overheads)." };
    }, fix:{ list:"costs", label:"Show untagged costs ›" } },
  { name:"Stock reconciles with the movement ledger", run: async()=>{
      const [sp,mv]=await Promise.all([
        sb().from("spare_catalogue").select("id,name,current_stock"),
        sb().from("inventory_moves").select("spare_id,qty,direction").limit(100000) ]);
      if(sp.error||mv.error) return { status:"warn", detail:(sp.error||mv.error).message };
      const net={}; (mv.data||[]).forEach(m=>{ net[m.spare_id]=(net[m.spare_id]||0)+num(m.qty)*(m.direction==="in"?1:-1); });
      const bad=(sp.data||[]).filter(s=>Math.abs(num(s.current_stock)-(net[s.id]||0))>0.001);
      return bad.length ? { status:"fail", detail:`${bad.length} spare(s) where current stock ≠ sum of movements (e.g. ${bad.slice(0,3).map(s=>esc(s.name)).join(", ")}) — a move may have been inserted without the trigger.` }
                        : { status:"pass", detail:`${(sp.data||[]).length} spares reconcile with the inventory ledger` };
    }},
  { name:"No negative stock", run: async()=>{
      const { data, error }=await sb().from("spare_catalogue").select("name,current_stock").lt("current_stock",0);
      if(error) return { status:"warn", detail:error.message };
      return (data&&data.length) ? { status:"warn", detail:`${data.length} spare(s) below zero (allowed via oversell): ${data.slice(0,4).map(s=>s.name+" ("+s.current_stock+")").join(", ")}` }
                                 : { status:"pass", detail:"All spare stock ≥ 0" };
    }},
  { name:"Attendance awaiting approval", run: async()=>{
      const { count, error }=await sb().from("hr_attendance").select("id",{count:"exact",head:true}).eq("approval_status","pending");
      if(error) return { status:"warn", detail:error.message };
      return count ? { status:"warn", detail:`${count} attendance day(s) pending approval — not counted in payroll until approved` }
                   : { status:"pass", detail:"No attendance pending approval" };
    }, fix:{ tool:"hr_att_approvals", label:"Open Attendance Approvals ›" } },
  { name:"Expense claims awaiting clarification", run: async()=>{
      const { count, error }=await sb().from("expense_claims").select("id",{count:"exact",head:true}).eq("status","clarification");
      if(error) return { status:"warn", detail:error.message };
      return count ? { status:"warn", detail:`${count} claim(s) sent back for clarification, awaiting employee resubmit` }
                   : { status:"pass", detail:"No claims awaiting clarification" };
    }, fix:{ tool:"expense_review", label:"Open Expense Claims ›" } },
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
    <div class="row wrap" style="margin:0 0 10px;gap:8px"><span class="muted" style="align-self:center">Clean-up lists:</span>
      <button class="btn sm" id="stUncat">Uncategorised invoices</button>
      <button class="btn sm" id="stCosts">Untagged costs</button>
      <button class="btn sm" id="stUnlinked">Unlinked (no register client)</button>
      <button class="btn sm" id="stLedger">Unbalanced vouchers</button>
      <button class="btn sm" id="stClaims">Unposted paid claims</button></div>
    <div id="stList"></div>
    <div id="stBody" class="muted">Press <b>Run all checks</b> to begin.</div>`;
  $("stRun").addEventListener("click",e=>window.OPS.once(e.currentTarget,runAll));
  $("stUncat").addEventListener("click",()=>listInvoices("uncat"));
  $("stCosts").addEventListener("click",()=>listCosts());
  $("stUnlinked").addEventListener("click",()=>listInvoices("unlinked"));
  $("stLedger").addEventListener("click",()=>listLedger());
  $("stClaims").addEventListener("click",()=>listUnpostedClaims());
}
// ---- clean-up list: cost records missing a profit category (for Category P&L) ----
async function listCosts(){
  const host=$("stList"); if(!host) return;
  host.innerHTML='<div class="muted" style="margin:6px 0">Loading…</div>';
  let u; try{ u=await fetchUntaggedCosts(); }catch(e){ host.innerHTML='<div class="card" style="color:#a3322a">'+esc(e.message)+'</div>'; return; }
  const fd=window.OPS.helpers.fmtDate;
  const sec=(title,rows,cols,where)=>`<div class="card" style="margin-bottom:8px">
    <div class="row"><h3 style="margin:0">${esc(title)} — ${rows.length}</h3><div class="spacer"></div>${rows.length?`<button class="btn sm" data-open="${where.tool}">${esc(where.label)}</button>`:''}</div>
    ${rows.length?`<div style="overflow:auto"><table><thead><tr>${cols.map(c=>`<th class="${c.num?'num':''}">${esc(c.h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.slice(0,100).map(r=>`<tr>${cols.map(c=>`<td class="${c.num?'num':''}">${c.f(r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${rows.length>100?`<p class="muted" style="font-size:12px">Showing first 100 of ${rows.length}.</p>`:''}
      <p class="muted" style="font-size:12px">${esc(where.hint)}</p>`:'<p class="muted" style="margin:6px 0 0">None 🎉</p>'}</div>`;
  const totalU=u.expenses.length+u.payables.length+u.claims.length+u.salaries.length+u.bonuses.length;
  host.innerHTML=`<div class="muted" style="margin:4px 0 8px"><b>${totalU}</b> cost record(s) with no profit category (treated as Overheads until tagged).</div>`
   + sec("Direct expenses — no profit category", u.expenses, [
      {h:"Date",f:r=>esc(fd(r.expense_date))},{h:"Payee",f:r=>esc(r.payee_text||r.note||"")},{h:"Total",num:true,f:r=>money(r.total)}
    ], {tool:"expense_mgmt", label:"Open Expense Management ›", hint:"Open each and set its Profit category."})
   + sec("Supplier bills — no profit category", u.payables, [
      {h:"Invoice no.",f:r=>esc(r.vendor_invoice_no||"(no no.)")},{h:"Date",f:r=>esc(fd(r.invoice_date))},{h:"Total",num:true,f:r=>money(r.total)}
    ], {tool:"vendor_bills", label:"Open Vendor Bills ›", hint:"Open each and set its Profit category. (Vendor spray payouts are auto-tagged and don't appear here.)"})
   + sec("Approved expense claims — no profit category", u.claims, [
      {h:"Employee",f:r=>esc(r.employee_name||"")},{h:"Date",f:r=>esc(fd(r.created_at))},{h:"Total",num:true,f:r=>money(r.total)}
    ], {tool:"expense_review", label:"Open Expense Claims ›", hint:"Finance tags a claim's profit category when approving."})
   + sec("Active employees — no salary profit-split", u.salaries, [
      {h:"Employee",f:r=>esc(r.name||"")}
    ], {tool:"hr_employees", label:"Open Employees ›", hint:"Open each → Salary profit-split; otherwise their salary counts 100% as Overheads."})
   + sec("Bonuses — no profit category", u.bonuses, [
      {h:"Payee",f:r=>esc(r.payee_name||"")},{h:"Month",f:r=>esc(r.pay_month||"")},{h:"Amount",num:true,f:r=>money(r.amount)}
    ], {tool:"hr_bonuses", label:"Open Bonuses ›", hint:"Bonuses default to Overheads unless tagged."});
  host.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>{ if(window.OPS.openTool) window.OPS.openTool(b.getAttribute("data-open")); }));
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

// ---- clean-up list: unbalanced vouchers (the Dr≠Cr / trial-balance fails) ----
async function listLedger(){
  const host=$("stList"); if(!host) return;
  host.innerHTML='<div class="muted" style="margin:6px 0">Loading…</div>';
  const { data, error }=await sb().from("accounting_entries").select("voucher_date,narration,account,debit,credit,ref_type,ref_id").limit(100000);
  if(error){ host.innerHTML='<div class="card" style="color:#a3322a">'+esc(error.message)+'</div>'; return; }
  // group into vouchers (by source ref; entries with no ref fall back to date+narration)
  const groups={};
  (data||[]).forEach(e=>{
    const key=(e.ref_type||e.ref_id) ? (e.ref_type+"|"+e.ref_id) : ("noref|"+(e.voucher_date||"")+"|"+(e.narration||""));
    const g=groups[key]||(groups[key]={ref_type:e.ref_type||"—", ref_id:e.ref_id||"", date:e.voucher_date, narration:e.narration||"", dr:0, cr:0});
    g.dr+=num(e.debit); g.cr+=num(e.credit); if(!g.narration&&e.narration) g.narration=e.narration;
  });
  const bad=Object.values(groups).filter(g=>Math.abs(g.dr-g.cr)>0.005).sort((a,b)=>Math.abs(b.dr-b.cr)-Math.abs(a.dr-a.cr));
  const totDiff=bad.reduce((s,g)=>s+(g.dr-g.cr),0);
  const fd=window.OPS.helpers.fmtDate;
  host.innerHTML=`<div class="card">
    <div class="row"><h3 style="margin:0">Unbalanced vouchers — ${bad.length}</h3><div class="spacer"></div><button class="btn sm" data-open="ledger">Open Ledger ›</button></div>
    <p class="muted" style="font-size:12px">Each row is one voucher (grouped by its source). Debit should equal Credit. Net difference across all: <b style="color:#a3322a">${money(totDiff)}</b>.</p>
    ${bad.length?`<div style="overflow:auto"><table><thead><tr><th>Date</th><th>Source</th><th>Narration</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Diff</th></tr></thead>
      <tbody>${bad.slice(0,200).map(g=>`<tr><td>${esc(fd(g.date))}</td><td class="muted" style="font-size:12px">${esc(g.ref_type)}${g.ref_id?(" · "+esc(String(g.ref_id)).slice(0,8)):""}</td><td>${esc(g.narration)}</td><td class="num">${money(g.dr)}</td><td class="num">${money(g.cr)}</td><td class="num" style="color:#a3322a"><b>${money(g.dr-g.cr)}</b></td></tr>`).join("")}</tbody></table></div>
      <p class="muted" style="font-size:12px">Open the <b>Ledger</b> and find these vouchers (by date/narration) to correct the one-sided or mistyped posting.</p>`:'<p class="muted" style="margin:6px 0 0">All vouchers balance 🎉</p>'}
  </div>`;
  host.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>{ if(window.OPS.openTool) window.OPS.openTool(b.getAttribute("data-open")); }));
}
// ---- clean-up list: paid expense claims with no ledger posting ----
async function listUnpostedClaims(){
  const host=$("stList"); if(!host) return;
  host.innerHTML='<div class="muted" style="margin:6px 0">Loading…</div>';
  const [pc,en]=await Promise.all([
    sb().from("expense_claims").select("id,employee_name,claim_type,total,created_at").eq("status","paid").limit(2000),
    sb().from("accounting_entries").select("ref_id").eq("ref_type","expense_claim") ]);
  if(pc.error||en.error){ host.innerHTML='<div class="card" style="color:#a3322a">'+esc((pc.error||en.error).message)+'</div>'; return; }
  const have=new Set((en.data||[]).map(e=>String(e.ref_id)));
  const miss=(pc.data||[]).filter(p=>!have.has(String(p.id)));
  const fd=window.OPS.helpers.fmtDate;
  host.innerHTML=`<div class="card">
    <div class="row"><h3 style="margin:0">Paid claims not posted to accounts — ${miss.length}</h3><div class="spacer"></div><button class="btn sm" data-open="expense_review">Open Expense Claims ›</button></div>
    ${miss.length?`<div style="overflow:auto"><table><thead><tr><th>Employee</th><th>Type</th><th>Date</th><th class="num">Total</th></tr></thead>
      <tbody>${miss.map(c=>`<tr><td><b>${esc(c.employee_name||"")}</b></td><td>${esc(c.claim_type||"")}</td><td>${esc(fd(c.created_at))}</td><td class="num">${money(c.total)}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted" style="font-size:12px">These were marked paid but never hit the ledger. Open the claim in <b>Expense Claims</b> and record the payment/posting there.</p>`:'<p class="muted" style="margin:6px 0 0">All paid claims are posted 🎉</p>'}
  </div>`;
  host.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>{ if(window.OPS.openTool) window.OPS.openTool(b.getAttribute("data-open")); }));
}
// ---- clean-up list: partner invoices that don't reconcile (gross − margin ≠ net) ----
async function listPartnerInv(){
  const host=$("stList"); if(!host) return;
  host.innerHTML='<div class="muted" style="margin:6px 0">Loading…</div>';
  const { data, error }=await sb().from("partner_invoices").select("id,number,party_name,gross,commission_total,net_payable,party_type,created_at").limit(2000);
  if(error){ host.innerHTML='<div class="card" style="color:#a3322a">'+esc(error.message)+'</div>'; return; }
  const bad=(data||[]).filter(r=>r.party_type==="authorized_partner" && !near(num(r.gross)-num(r.commission_total), r.net_payable, 1));
  host.innerHTML=`<div class="card">
    <div class="row"><h3 style="margin:0">Partner invoices that don't reconcile — ${bad.length}</h3><div class="spacer"></div><button class="btn sm" data-open="partner_invoices">Open Partner Invoices ›</button></div>
    ${bad.length?`<div style="overflow:auto"><table><thead><tr><th>Invoice</th><th>Partner</th><th class="num">Gross</th><th class="num">Commission</th><th class="num">Net</th><th class="num">Gross−Comm−Net</th></tr></thead>
      <tbody>${bad.map(r=>`<tr><td><b>${esc(r.number||String(r.id).slice(0,8))}</b></td><td>${esc(r.party_name||"")}</td><td class="num">${money(r.gross)}</td><td class="num">${money(r.commission_total)}</td><td class="num">${money(r.net_payable)}</td><td class="num" style="color:#a3322a"><b>${money(num(r.gross)-num(r.commission_total)-num(r.net_payable))}</b></td></tr>`).join("")}</tbody></table></div>
      <p class="muted" style="font-size:12px">Gross − Commission should equal Net payable. Open <b>Partner Invoices</b> to review these.</p>`:'<p class="muted" style="margin:6px 0 0">All partner invoices reconcile 🎉</p>'}
  </div>`;
  host.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>{ if(window.OPS.openTool) window.OPS.openTool(b.getAttribute("data-open")); }));
}

// jump to the tab (or focused list) that resolves a check, with its filter pre-applied
function gotoFix(fix){ if(!fix) return;
  if(fix.list==="costs")      return listCosts();
  if(fix.list==="ledger")     return listLedger();
  if(fix.list==="claims")     return listUnpostedClaims();
  if(fix.list==="partnerinv") return listPartnerInv();
  if(fix.tool==="invoice")    window.OPS._invFilter=fix.filter;
  if(fix.tool==="catalogues") window.OPS._catFilter=fix.filter;
  if(window.OPS.openTool) window.OPS.openTool(fix.tool);
}

window.OPS.routes.selftest = selftest;
})();
