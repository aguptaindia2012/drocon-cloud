/* ============================================================================
   DroCon Cloud — shared Payment / Collection / Settlement window
   ----------------------------------------------------------------------------
   One form for clearing any open item (a client invoice, a vendor bill, an
   expense, an advance) using an EXPLICIT mix of methods:
       • Cash in/out  (money that actually moves through a bank/cash account)
       • Settle       (contra against an item owed the other way — no cash moves)
       • TDS          (withheld / deducted)
   Nothing is pre-filled as cash, so you can never accidentally record a cash
   payment when you meant a settlement (the bug that let a vendor bill clear
   against DCB Bank instead of against a client invoice).

   UI-only: each caller supplies a `commit(payload)` that does its own module
   inserts + status recompute, so posting semantics stay where they belong.
   Exposes window.OPS.pay = { form }.
   ============================================================================ */
(function(){
const { $, esc, money, num, todayISO } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;

/* opts = {
     dir:'in'|'out',
     item:{ type, id, label, party, balance, side },
     title?, modes?, accounts?,            // accounts optional; fetched if absent
     commit: async (payload)=>({error?}),  // does the inserts + recompute
     back: ()=>{}
   }
   payload = { cleared, cash, tds, tdsPct, account, mode, date, note,
               settleTotal, settleLines, settleItem } */
async function form(opts){
  const m=$("main"); const item=opts.item; const dir=opts.dir;
  const inWord = dir==='in' ? 'received into' : 'paid from';
  const cashWord = dir==='in' ? 'in' : 'out';
  m.innerHTML=`<button class="btn sm" id="pfBack">← Back</button>
    <div class="card" style="margin-top:12px;max-width:560px">
      <h1>${esc(opts.title||(dir==='in'?'Collect payment':'Record payment'))}</h1>
      <p class="muted">${esc(item.party||'')} · ${esc(item.label||'')} · Balance <b>${money(item.balance)}</b></p>
      <div class="callout">Clear this ${dir==='in'?'receivable':'bill'} with any mix of <b>cash</b>, a <b>settlement</b>
        against an item owed the other way (no cash moves), and <b>TDS</b>. Nothing is pre-filled as cash — allocate each part explicitly.</div>

      <div class="field full" id="pf_settle"></div>

      <label style="font-size:12px;font-weight:700;display:block;margin:12px 0 4px">
        <input type="checkbox" id="pf_tdschk" style="width:auto"> ${dir==='in'?'Client deducted TDS':'We deducted TDS'}</label>
      <div class="row" id="pf_tdsrow" style="gap:6px;display:none">
        <input id="pf_tdspct" type="number" step="any" placeholder="TDS %" style="max-width:100px">
        <input id="pf_tdsamt" type="number" step="any" placeholder="TDS ₹" style="max-width:130px">
        <span class="muted" style="align-self:center;font-size:12px">defaults to %×balance — edit for a partial clear</span>
      </div>

      <label style="font-size:12px;font-weight:700;display:block;margin:12px 0 4px">Cash ${cashWord}
        <span class="hint" style="font-weight:400;color:var(--muted)">(money that actually moves through an account)</span></label>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <input id="pf_cash" type="number" step="any" placeholder="₹ amount" style="max-width:150px">
        <button class="btn sm" id="pf_fill" type="button">Fill remaining</button>
        <select id="pf_acct" style="max-width:230px"><option value="">— ${inWord} —</option></select>
        <select id="pf_mode" style="max-width:140px">${(opts.modes||["UPI","NEFT/RTGS","Cheque","Cash","Card","Other"]).map(x=>`<option>${esc(x)}</option>`).join("")}</select>
      </div>

      <div class="row" style="gap:6px;margin-top:12px;flex-wrap:wrap">
        <div><label style="font-size:11px;color:var(--muted);display:block">Date ${dir==='in'?'received':'paid'}</label>
          <input id="pf_date" type="date" value="${todayISO()}" style="max-width:170px"></div>
        <div style="flex:1;min-width:180px"><label style="font-size:11px;color:var(--muted);display:block">Note</label>
          <input id="pf_note" placeholder="optional" style="width:100%"></div>
      </div>

      <div class="callout" id="pf_tape" style="margin:12px 0 0"></div>
      <div class="row" style="margin-top:10px"><button class="btn green" id="pf_go">Record</button>
        <button class="btn" id="pf_cancel">Cancel</button></div>
      <div class="err" id="pf_err"></div>
    </div>`;
  $("pfBack").addEventListener("click",opts.back); $("pf_cancel").addEventListener("click",opts.back);

  // first-class "Settle against" block (opposite side)
  const settleB = window.OPS.settle.block("pf_settle",
    { type:item.type, id:item.id, label:item.label, side:item.side });

  // accounts to receive / pay from
  let accts = (opts.accounts && opts.accounts.length) ? opts.accounts : null;
  if(!accts){ const { data }=await sb().from("cash_accounts").select("id,name,kind").eq("is_active",true).order("kind"); accts=data||[]; }
  $("pf_acct").innerHTML=`<option value="">— ${inWord} —</option>`+
    accts.map(a=>`<option value="${a.id}">${esc(a.name)}${a.kind==='cash'?' (cash)':''}</option>`).join("");

  const tds=()=> $("pf_tdschk").checked ? num($("pf_tdsamt").value) : 0;
  const cashVal=()=> num($("pf_cash").value);
  const settleTot=()=> settleB.total();
  const cleared=()=> Math.round((cashVal()+tds()+settleTot())*100)/100;
  function tape(){
    const c=cleared(), bal=num(item.balance), un=Math.round((bal-c)*100)/100;
    $("pf_tape").innerHTML=`Clearing <b>${money(c)}</b> of ${money(bal)} = cash ${money(cashVal())}`
      + (tds()>0?` + TDS ${money(tds())}`:``)
      + (settleTot()>0?` + settled ${money(settleTot())}`:``) + `. `
      + (un>0.005 ? `<span class="muted">Unallocated ${money(un)}.</span>`
        : un<-0.005 ? `<b style="color:#a3322a">Over by ${money(-un)}.</b>`
        : `<b style="color:#3e6b20">Fully cleared.</b>`);
  }
  settleB.onChange(tape);
  $("pf_tdschk").addEventListener("change",()=>{ $("pf_tdsrow").style.display=$("pf_tdschk").checked?'flex':'none';
    if($("pf_tdschk").checked && num($("pf_tdspct").value) && !num($("pf_tdsamt").value))
      $("pf_tdsamt").value=Math.round(num(item.balance)*num($("pf_tdspct").value))/100; tape(); });
  $("pf_tdspct").addEventListener("input",()=>{ $("pf_tdsamt").value=Math.round(num(item.balance)*num($("pf_tdspct").value))/100; tape(); });
  $("pf_tdsamt").addEventListener("input",tape);
  $("pf_cash").addEventListener("input",tape);
  $("pf_fill").addEventListener("click",()=>{ const rem=Math.round((num(item.balance)-tds()-settleTot())*100)/100; $("pf_cash").value=rem>0?rem:0; tape(); });
  tape();

  $("pf_go").addEventListener("click",()=>window.OPS.once($("pf_go"),async()=>{
    const cash=cashVal(), t=tds(), st=settleTot(), c=cleared(), bal=num(item.balance);
    if(!(c>0)){ $("pf_err").textContent="Allocate an amount — cash, a settlement, or TDS."; return; }
    if(c>bal+0.01){ $("pf_err").textContent="That exceeds the balance of "+money(bal)+"."; return; }
    if(cash>0.005 && !$("pf_acct").value){ $("pf_err").textContent="Pick the account the cash "+(dir==='in'?'landed in':'went out from')+"."; return; }
    if(t<0){ $("pf_err").textContent="TDS cannot be negative."; return; }
    const payload={ cleared:c, cash, tds:t, tdsPct:$("pf_tdschk").checked?(num($("pf_tdspct").value)||null):null,
      account:$("pf_acct").value||null, mode:$("pf_mode").value, date:$("pf_date").value||todayISO(),
      note:$("pf_note").value||null, settleTotal:st, settleLines:settleB.lines,
      settleItem:{ type:item.type, id:item.id, label:item.label, side:item.side } };
    let r; try{ r=await opts.commit(payload); }catch(e){ $("pf_err").textContent=e.message||String(e); return; }
    if(r && r.error){ $("pf_err").textContent=r.error; return; }
    window.OPS.flashTop("Recorded ✓"); opts.back();
  }));
}

window.OPS.pay = { form };
})();
