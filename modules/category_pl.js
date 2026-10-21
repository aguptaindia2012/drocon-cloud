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
    sb().from("expenses").select("total,expense_date,cost_category"),
    sb().from("payables").select("total,invoice_date,category,cost_category"),
    sb().from("expense_claims").select("total,status,claim_type,created_at,cost_category"),
    sb().from("salary_runs").select("net_payable,period_month,cost_split"),
    sb().from("hr_incentives").select("total,period_month,cost_category"),
    sb().from("hr_bonuses").select("amount,pay_month,created_at,cost_category"),
  ]);
  const err=[inv,exp,pay,claims,sal,inc,bon].find(r=>r.error);
  if(err){ host.innerHTML='<div class="card">'+esc(err.error.message)+'</div>'; return; }

  // ---- bucket everything by FY ----
  // data[fy] = { rev:{cat:₹}, cost:{cat:₹}, src:{sourceName:{cat:₹}} }
  const D={};
  const fy=s=>{ const k=fyStart(s); if(k==null) return null; (D[k]=D[k]||{rev:{},cost:{},src:{}}); return D[k]; };
  const addRev=(s,cat,amt)=>{ const b=fy(s); if(!b||!amt) return; b.rev[cat]=(b.rev[cat]||0)+amt; };
  const addCost=(s,cat,amt,source)=>{ const b=fy(s); if(!b||!amt) return;
    b.cost[cat]=(b.cost[cat]||0)+amt;
    (b.src[source]=b.src[source]||{}); b.src[source][cat]=(b.src[source][cat]||0)+amt; };
  const costCat=c=> (c && PC.isValid(c)) ? c : "overheads";

  // Revenue — invoices, whole-invoice category, gross (tax-incl, same as receivables)
  (inv.data||[]).forEach(r=>{ const gross=num((r.totals||{}).total); if(!gross) return;
    addRev(r.doc_date, PC.classifyInvoice(r), gross); });

  // Costs
  (exp.data||[]).forEach(r=>addCost(r.expense_date, costCat(r.cost_category), num(r.total), "Direct expenses"));
  // Supplier bills + vendor spray payouts (both live in `payables`). Manual bills
  // carry cost_category; vendor-acre payables don't, but their category text says
  // "Aerial spraying — vendor", so treat those as spray.
  (pay.data||[]).forEach(r=>{ let c=r.cost_category;
    if(!(c && PC.isValid(c))) c = /spray|aerial/i.test(r.category||"") ? "spray" : "overheads";
    const isVendorSpray=/spray|aerial/i.test(r.category||"") && !r.cost_category;
    addCost(r.invoice_date, c, num(r.total), isVendorSpray?"Vendor spray payouts":"Supplier bills"); });
  (claims.data||[]).forEach(r=>{ if(!["approved","part_paid","paid"].includes(r.status)) return;
    if(r.claim_type==="advance") return;   // advances are loans, not a P&L cost
    addCost(r.created_at, costCat(r.cost_category), num(r.total), "Expense claims"); });
  (inc.data||[]).forEach(r=>addCost(r.period_month, costCat(r.cost_category||"spray"), num(r.total), "Pilot incentives"));
  (bon.data||[]).forEach(r=>addCost(r.pay_month||r.created_at, costCat(r.cost_category), num(r.amount), "Bonuses"));
  // Salaries — split net_payable by cost_split %, remainder → overheads
  (sal.data||[]).forEach(r=>{ const net=num(r.net_payable); if(!net) return;
    const split=(r.cost_split && typeof r.cost_split==="object")?r.cost_split:{};
    let used=0; Object.keys(split).forEach(k=>{ const pct=num(split[k]); if(pct>0 && PC.isValid(k)){ used+=pct;
      addCost(r.period_month, k, net*pct/100, "Salaries"); } });
    const rem=Math.max(0,100-used); if(rem>0) addCost(r.period_month, "overheads", net*rem/100, "Salaries"); });

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
          ${rows.map(r=>`<tr><td><b>${esc(r.l)}</b></td><td class="num">${money(r.rv)}</td><td class="num">${money(r.cs)}</td>${prCell(r.pr)}<td class="num">${mg(r.margin)}</td></tr>`).join("")}
        </tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--line)"><td><b>Gross profit (direct)</b></td><td class="num"><b>${money(sumRev)}</b></td><td class="num"><b>${money(sumDirect)}</b></td>${prCell(gross)}<td class="num">${mg(sumRev>0?gross/sumRev*100:null)}</td></tr>
          ${below.map(x=>`<tr><td>${esc(x.l)}</td><td class="num muted">—</td><td class="num">${money(x.cs)}</td>${prCell(-x.cs)}<td class="num muted">—</td></tr>`).join("")}
          <tr style="border-top:2px solid var(--line)"><td><b>Net profit</b></td><td class="num"><b>${money(sumRev)}</b></td><td class="num"><b>${money(sumDirect+sumBelow)}</b></td>${prCell(net)}<td class="num">${mg(sumRev>0?net/sumRev*100:null)}</td></tr>
        </tfoot>
      </table>
      <div class="muted" style="font-size:12px;margin-top:8px">Overheads and R&amp;D are kept in the overall net profit but not attributed to any sales category. Untagged costs count as Overheads.</div>
    </div>
    <h3 style="margin:16px 0 6px">Cost by source</h3>
    <div class="card" style="overflow:auto">
      <table>
        <thead><tr><th>Source</th>${COLS.map(([k,l])=>`<th class="num">${esc(k==="rnd"?"R&D":l.split(" ")[0])}</th>`).join("")}<th class="num">Total</th></tr></thead>
        <tbody>${srcRows||`<tr><td colspan="${COLS.length+2}" class="muted">No costs recorded for this year.</td></tr>`}</tbody>
      </table>
      <div class="muted" style="font-size:12px;margin-top:8px">Salaries are split per employee's profit-split; vendor payouts &amp; pilot incentives default to Agriculture Spraying.</div>
    </div>`;
}

window.OPS.routes.category_pl = view;
})();
