/* ============================================================================
   DroCon Cloud — Category P&L (profit by line of business)
   Revenue (invoices, by revenue category — same classifier as Receivables)
   minus DIRECT cost tagged to each category, with an Overheads pool for common
   /indivisible spend. Accrual, tax-inclusive, grouped by Indian FY (Apr–Mar).

     Category profit = Revenue(cat) − Direct cost(cat)
     Net profit      = Σ category profit − Overheads

   Cost is summed from the SOURCE documents (never the payable/cash rows), so
   nothing double-counts settlements:
     expenses · payables (supplier bills) · vendor_invoices (spray payouts) ·
     approved expense_claims · salary_runs (split by cost_split) · hr_incentives ·
     hr_bonuses.
   ============================================================================ */
(function(){
const { $, esc, money, num, fmtDate } = window.OPS.helpers;
const sb = ()=>window.OPS.sb;
const PC = window.OPS.profitCats;

// Indian FY (Apr 1 → Mar 31). Returns the FY start year, or null.
function fyStart(d){ if(!d) return null; const s=String(d); const dt=new Date(s.length===7?s+"-01":s);
  if(isNaN(dt)) return null; const y=dt.getFullYear(), m=dt.getMonth()+1; return m>=4?y:y-1; }
function fyLabel(s){ return "FY "+s+"–"+String((s+1)%100).padStart(2,"0"); }

const REV_CATS = PC.revenue;                 // [[key,label]...] incl. 'other'
const REV_KEYS = REV_CATS.map(c=>c[0]);
const label = k => PC.label(k);
const OPEN = new Set();                       // which category lines are drilled open

async function view(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Accounting</div><h1>Category P&amp;L</h1>
    <div class="callout">Profit by line of business. Revenue is from invoices (same categories as <b>Invoices &amp; Receivables → By revenue category</b>); direct cost is spend tagged to each category; <b>Overheads</b> is common/indivisible cost kept in the overall profit. Figures are <b>tax-inclusive</b> and grouped by financial year (Apr–Mar).</div>
    <div class="row" style="margin:8px 0;align-items:center;gap:10px">
      <label style="margin:0">Financial year</label>
      <select id="plFY" style="width:auto"><option>Loading…</option></select>
    </div>
    <div id="plHost" class="muted">Loading…</div>`;
  await load();
}

async function load(){
  const host=$("plHost");
  // NB: vendor spray payouts are NOT read from vendor_invoices — approving one
  // inserts a payables row (approve_vendor_invoice), so they already flow in via
  // `payables` below; reading both would double-count.
  const [inv,exp,pay,claims,sal,inc,bon]=await Promise.all([
    sb().from("documents").select("doc_date,totals,line_items,data").eq("doc_type","invoice"),
    sb().from("expenses").select("id,total,expense_date,cost_category,payee_text,note"),
    sb().from("payables").select("id,total,invoice_date,category,cost_category,vendor_invoice_no, vendor:vendor_id(firm_name,name)"),
    sb().from("expense_claims").select("id,total,status,claim_type,created_at,cost_category,employee_name"),
    sb().from("salary_runs").select("id,net_payable,period_month,cost_split, emp:employee_id(name)"),
    sb().from("hr_incentives").select("id,total,period_month,cost_category,pilot_name"),
    sb().from("hr_bonuses").select("id,amount,pay_month,created_at,cost_category,payee_name,title"),
  ]);
  const err=[inv,exp,pay,claims,sal,inc,bon].find(r=>r.error);
  if(err){ host.innerHTML='<div class="card">'+esc(err.error.message)+'</div>'; return; }

  // ---- bucket everything by FY ----
  // D[fy] = { rev:{cat:₹}, cost:{cat:₹}, src:{sourceName:{cat:₹}}, items:{cat:[...]} }
  const D={};
  const fy=s=>{ const k=fyStart(s); if(k==null) return null; (D[k]=D[k]||{rev:{},cost:{},src:{},items:{}}); return D[k]; };
  const addRev=(s,cat,amt)=>{ const b=fy(s); if(!b||!amt) return; b.rev[cat]=(b.rev[cat]||0)+amt; };
  // item (optional): {table,id,label,editable,current} — kept for the per-line drill-down
  const addCost=(s,cat,amt,source,item)=>{ const b=fy(s); if(!b||!amt) return;
    b.cost[cat]=(b.cost[cat]||0)+amt;
    (b.src[source]=b.src[source]||{}); b.src[source][cat]=(b.src[source][cat]||0)+amt;
    if(item){ (b.items[cat]=b.items[cat]||[]).push(Object.assign({amount:amt,source},item)); } };
  const costCat=c=> (c && PC.isValid(c)) ? c : "overheads";
  const vName=v=> v ? (v.firm_name||v.name||"") : "";

  // Revenue — invoices, whole-invoice category, gross (tax-incl, same as receivables)
  (inv.data||[]).forEach(r=>{ const gross=num((r.totals||{}).total); if(!gross) return;
    addRev(r.doc_date, PC.classifyInvoice(r), gross); });

  // Costs
  (exp.data||[]).forEach(r=>addCost(r.expense_date, costCat(r.cost_category), num(r.total), "Direct expenses",
    { table:"expenses", id:r.id, label:(r.payee_text||r.note||"Expense"), editable:true, current:r.cost_category }));
  // Supplier bills + vendor spray payouts (both live in `payables`). Manual bills
  // carry cost_category; vendor-acre payables don't, but their category text says
  // "Aerial spraying — vendor", so treat those as spray.
  (pay.data||[]).forEach(r=>{ let c=r.cost_category;
    if(!(c && PC.isValid(c))) c = /spray|aerial/i.test(r.category||"") ? "spray" : "overheads";
    const isVendorSpray=/spray|aerial/i.test(r.category||"") && !r.cost_category;
    addCost(r.invoice_date, c, num(r.total), isVendorSpray?"Vendor spray payouts":"Supplier bills",
      { table:"payables", id:r.id, label:((vName(r.vendor)||"Bill")+" "+(r.vendor_invoice_no||"")).trim(), editable:true, current:(r.cost_category||(isVendorSpray?"spray":"")) }); });
  (claims.data||[]).forEach(r=>{ if(!["approved","part_paid","paid"].includes(r.status)) return;
    if(r.claim_type==="advance") return;   // advances are loans, not a P&L cost
    addCost(r.created_at, costCat(r.cost_category), num(r.total), "Expense claims",
      { table:"expense_claims", id:r.id, label:(r.employee_name||"Claim"), editable:true, current:r.cost_category }); });
  (inc.data||[]).forEach(r=>addCost(r.period_month, costCat(r.cost_category||"spray"), num(r.total), "Pilot incentives",
    { table:"hr_incentives", id:r.id, label:((r.pilot_name||"Pilot")+" incentive"), editable:true, current:(r.cost_category||"spray") }));
  (bon.data||[]).forEach(r=>addCost(r.pay_month||r.created_at, costCat(r.cost_category), num(r.amount), "Bonuses",
    { table:"hr_bonuses", id:r.id, label:((r.payee_name||"")+" — "+(r.title||"bonus")), editable:true, current:r.cost_category }));
  // Salaries — split net_payable by cost_split %, remainder → overheads. Portions
  // aren't single-category, so they're shown read-only in the drill (edit the split).
  (sal.data||[]).forEach(r=>{ const net=num(r.net_payable); if(!net) return;
    const nm=(r.emp&&r.emp.name)||"Employee"; const lbl=nm+" · salary "+(r.period_month||"");
    const split=(r.cost_split && typeof r.cost_split==="object")?r.cost_split:{};
    let used=0; Object.keys(split).forEach(k=>{ const pct=num(split[k]); if(pct>0 && PC.isValid(k)){ used+=pct;
      addCost(r.period_month, k, net*pct/100, "Salaries", { table:"salary_runs", id:r.id, label:lbl+" ("+pct+"%)", editable:false }); } });
    const rem=Math.max(0,100-used); if(rem>0) addCost(r.period_month, "overheads", net*rem/100, "Salaries", { table:"salary_runs", id:r.id, label:lbl+" ("+rem+"% rem.)", editable:false }); });

  // ---- FY picker ----
  const fys=Object.keys(D).map(Number).sort((a,b)=>b-a);
  if(!fys.length){ host.innerHTML='<div class="card muted">No invoices or costs found yet.</div>'; return; }
  const now=new Date(); const curFY=(now.getMonth()+1>=4)?now.getFullYear():now.getFullYear()-1;
  const sel=$("plFY"); const chosen=(window.OPS._plFY!=null && D[window.OPS._plFY])?window.OPS._plFY:(D[curFY]?curFY:fys[0]);
  sel.innerHTML=fys.map(s=>`<option value="${s}"${s===chosen?' selected':''}>${fyLabel(s)}</option>`).join("");
  sel.onchange=()=>{ window.OPS._plFY=+sel.value; render(D[+sel.value]); };
  render(D[chosen]);
}

function render(b){
  const host=$("plHost");
  const rev=b.rev, cost=b.cost;
  const rows=REV_CATS.map(([k,l])=>{ const rv=rev[k]||0, cs=cost[k]||0, pr=rv-cs;
    return { k, l, rv, cs, pr, margin: rv>0?(pr/rv*100):null }; })
    .filter(r=> r.rv!==0 || r.cs!==0);   // hide empty categories
  const sumRev=rows.reduce((s,r)=>s+r.rv,0);
  const sumDirect=rows.reduce((s,r)=>s+r.cs,0);
  const gross=sumRev-sumDirect;
  // cost-only categories (Overheads, R&D) — below-the-line deductions
  const below=PC.costOnly.map(([k,l])=>({ k, l, cs: cost[k]||0 }));
  const sumBelow=below.reduce((s,x)=>s+x.cs,0);
  const net=gross-sumBelow;

  const prCell=v=>`<td class="num" style="color:${v<0?'#a3322a':'#137a2e'}"><b>${money(v)}</b></td>`;
  const mg=m=> m==null?'<span class="muted">—</span>':(Math.round(m*10)/10)+"%";

  // one category line + (when open) its drill-down of underlying cost records
  const catRow=(k,l,rv,cs,pr,margin,isBelow)=>{
    const items=(b.items[k]||[]).slice().sort((a,c)=>c.amount-a.amount);
    const open=items.length>0 && OPEN.has(k);
    const caret=items.length?`${open?'▾':'▸'} `:'';
    const nameCell=items.length
      ? `<td><a href="#" class="plToggle" data-k="${k}" style="text-decoration:none;color:inherit"><b>${caret}${esc(l)}</b></a></td>`
      : `<td><b>${esc(l)}</b></td>`;
    const main=`<tr>${nameCell}<td class="num">${isBelow?'<span class="muted">—</span>':money(rv)}</td><td class="num">${money(cs)}</td>${prCell(isBelow?-cs:pr)}<td class="num">${isBelow?'<span class="muted">—</span>':mg(margin)}</td></tr>`;
    if(!open) return main;
    const body=items.map(it=>`<tr><td style="padding-left:20px">${esc(it.label)}</td><td class="muted" style="font-size:12px">${esc(it.source)}</td><td class="num">${money(it.amount)}</td>
      <td>${it.editable?window.OPS.profitCatCell(it.table,it.id,it.current):'<span class="muted" style="font-size:12px">salary split · edit in Salary Records</span>'}</td></tr>`).join("");
    const drill=`<tr><td colspan="5" style="background:#fafbf8;padding:6px 10px">
      <div style="overflow:auto"><table style="width:100%"><thead><tr><th>Item</th><th>Source</th><th class="num">Amount</th><th>Category</th></tr></thead><tbody>${body}</tbody></table></div>
      <div class="muted" style="font-size:11px;margin-top:4px">Change a row's category to move that cost to another line. Salary portions follow each employee's profit-split.</div></td></tr>`;
    return main+drill;
  };

  const COLS=PC.cost;   // every cost category (revenue cats + Overheads + R&D)
  // cost-by-source breakdown (transparency)
  const sources=Object.keys(b.src).sort();
  const srcRows=sources.map(sname=>{ const row=b.src[sname]; const tot=Object.values(row).reduce((s,v)=>s+v,0);
    return `<tr><td>${esc(sname)}</td>${COLS.map(([k])=>`<td class="num">${row[k]?money(row[k]):'·'}</td>`).join("")}<td class="num"><b>${money(tot)}</b></td></tr>`; }).join("");

  host.innerHTML=`
    <div class="card" style="overflow:auto">
      <table>
        <thead><tr><th>Category</th><th class="num">Revenue</th><th class="num">Direct cost</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead>
        <tbody>
          ${rows.map(r=>catRow(r.k,r.l,r.rv,r.cs,r.pr,r.margin,false)).join("")}
        </tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--line)"><td><b>Gross profit (direct)</b></td><td class="num"><b>${money(sumRev)}</b></td><td class="num"><b>${money(sumDirect)}</b></td>${prCell(gross)}<td class="num">${mg(sumRev>0?gross/sumRev*100:null)}</td></tr>
          ${below.map(x=>catRow(x.k,x.l,0,x.cs,0,null,true)).join("")}
          <tr style="border-top:2px solid var(--line)"><td><b>Net profit</b></td><td class="num"><b>${money(sumRev)}</b></td><td class="num"><b>${money(sumDirect+sumBelow)}</b></td>${prCell(net)}<td class="num">${mg(sumRev>0?net/sumRev*100:null)}</td></tr>
        </tfoot>
      </table>
      <div class="muted" style="font-size:12px;margin-top:8px">Click a category to see the costs in it and re-assign any one. Overheads and R&amp;D are kept in the overall net profit but not attributed to any sales category.</div>
    </div>
    <h3 style="margin:16px 0 6px">Cost by source</h3>
    <div class="card" style="overflow:auto">
      <table>
        <thead><tr><th>Source</th>${COLS.map(([k,l])=>`<th class="num">${esc(k==="rnd"?"R&D":l.split(" ")[0])}</th>`).join("")}<th class="num">Total</th></tr></thead>
        <tbody>${srcRows||`<tr><td colspan="${COLS.length+2}" class="muted">No costs recorded for this year.</td></tr>`}</tbody>
      </table>
      <div class="muted" style="font-size:12px;margin-top:8px">Salaries are split per employee's profit-split; vendor payouts &amp; pilot incentives default to Agriculture Spraying.</div>
    </div>`;
  host.querySelectorAll(".plToggle").forEach(a=>a.addEventListener("click",e=>{
    e.preventDefault(); const k=a.getAttribute("data-k"); OPEN.has(k)?OPEN.delete(k):OPEN.add(k); render(b); }));
  window.OPS.wireProfitCatCells(host, ()=>load());   // re-assigning a cost reloads the report
}

window.OPS.routes.category_pl = view;
})();
