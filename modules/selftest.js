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
      const tbls=["employees","clients","vendors","acre_entries","hr_attendance","hr_comp_offs","expense_claims","partner_billing","partner_pilots","hr_month_locks","advances"];
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
];

async function selftest(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Audit</div><h1>System Health</h1>
    <div class="callout">Read-only checks against the live database — run after a deploy or a large edit to confirm the accounting, billing and expense data all reconcile. Nothing here changes any data.</div>
    <div class="row" style="margin:10px 0"><button class="btn green sm" id="stRun">▶ Run all checks</button><span id="stSum" class="muted"></span></div>
    <div id="stBody" class="muted">Press <b>Run all checks</b> to begin.</div>`;
  $("stRun").addEventListener("click",e=>window.OPS.once(e.currentTarget,runAll));
}
async function runAll(){
  const body=$("stBody"); const chip=s=> s==="pass"?'<span class="chip ok">PASS</span>':s==="warn"?'<span class="chip warn">WARN</span>':'<span class="chip err">FAIL</span>';
  body.innerHTML=`<div style="overflow:auto"><table><thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead><tbody>
    ${CHECKS.map((c,i)=>`<tr id="st_${i}"><td><b>${esc(c.name)}</b></td><td>…</td><td class="muted">running…</td></tr>`).join("")}</tbody></table></div>`;
  let pass=0,warn=0,fail=0; const t0=Date.now();
  for(let i=0;i<CHECKS.length;i++){
    let r; try{ r=await CHECKS[i].run(); }catch(e){ r={ status:"fail", detail:String(e&&e.message||e) }; }
    if(r.status==="pass")pass++; else if(r.status==="warn")warn++; else fail++;
    const row=$("st_"+i); if(row){ row.children[1].innerHTML=chip(r.status); row.children[2].innerHTML=esc(r.detail||""); row.children[2].className=r.status==="fail"?"":"muted"; }
  }
  $("stSum").innerHTML=` ${pass} pass · ${warn} warn · ${fail} fail · ${((Date.now()-t0)/1000).toFixed(1)}s`;
  window.OPS.flashTop(fail? (fail+" check(s) FAILED") : (warn? "All critical checks passed (some warnings)":"All checks passed ✓"));
}
window.OPS.routes.selftest = selftest;
})();
