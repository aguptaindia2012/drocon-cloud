/* ============================================================================
   DroCon Cloud — interactive guided tour
   A role-aware "Take the tour" slideshow that steps through the tabs with short
   captions. Editable here (just add/adjust steps). Triggers:
     • first-ever login (no seen flag)
     • the 🧭 Tour button in the header (window.OPS.tour.run)
     • a gentle prompt when the build number changes
   Steps navigate the real screen behind a caption card so users see each tab.
   ============================================================================ */
(function(){
const { $, esc } = window.OPS.helpers;
const SEEN_KEY = "dcb_tour_build";

const TOURS = {
  internal: [
    {title:"Welcome to DroCon Bharat Operations Suite", body:"A 1-minute tour of your operations suite. Switch areas from the top bar; each screen has a short intro at the top. Reopen this anytime from <b>🧭 Tour</b> (top-right)."},
    {section:"trackers", title:"Daily Spray Entry", body:"Record each day's spraying — pick the date &amp; location, then each pilot's acres (grouped with subtotals). A pilot-day under 12 acres needs a short-day reason. Submit for approval."},
    {section:"reviews", title:"Review / Approvals", body:"Your action queue — approve daily entries, pilot acres, vendor invoices, client queries and more. The 🔔 badge shows what's pending."},
    {section:"trackers", title:"Acre Tracking", body:"The live dashboard: total / billed / unbilled acres, the 7-day grid by location &amp; pilot, idle pilots &amp; locations, and month / location drill-downs."},
    {section:"finance", title:"Finance", body:"Invoices, acre invoicing, vendor rates, expense management (incl. Supplier / Vendor invoices), advances and expense claims."},
    {section:"accounting", title:"Accounting", body:"Receivables, the cash-flow Position, day book, ledger, and GST / TDS reports."},
    {section:"hr", title:"HR", body:"Employees, attendance, salary, payslips, incentives, bonuses and final settlement."},
    {section:"resources", title:"Registers", body:"The master records everything selects from — Clients, Vendors, Pilots, Locations, Crops. Create client / vendor logins right from their record."},
    {section:"team", title:"Team &amp; Access", body:"Admins provision logins and grant per-tool access here — keep sensitive tools (salaries, payroll) to the right people."},
    {title:"You're set", body:"That's the tour. Explore freely — <b>Help &amp; FAQs</b> in each area has more, and you can reopen this from <b>🧭 Tour</b> any time."}
  ],
  vendor: [
    {title:"Welcome to your Vendor Portal", body:"Report acres through your pilots, bill DroCon, and track payments. Your tabs are along the top. Reopen this from <b>🧭 Tour</b> any time."},
    {tool:"vendor_dashboard", title:"Acre Dashboard", body:"Your pilots' approved acres — this-week grid by location &amp; pilot, location summary, month-wise — plus <b>unbilled acres</b>, <b>pending payment from DroCon</b>, and <b>amount due to DroCon</b>."},
    {tool:"vendor_pilots", title:"My Pilots", body:"Add your pilots and request their logins. DroCon approves the login and assigns each pilot to a location."},
    {tool:"vendor_my_rates", title:"My Rates", body:"Set your ₹/acre per location (and crop), effective-dated. Invoices bill at the rate in force. To change a rate, add a <b>new dated row</b> — don't edit old ones."},
    {tool:"vendor_acre_review", title:"Pilot Reports", body:"See what your pilots reported and its status — <b>Awaiting DroCon approval → Approved</b>. Verification is DroCon's step."},
    {tool:"vendor_invoice_new", title:"Invoice DroCon", body:"Pick a period; your approved, un-invoiced acres appear at your rates. Optionally net part against an advance. Generate → DroCon approves → it becomes a payable."},
    {tool:"vendor_invoices_mine", title:"My Invoices", body:"Track each invoice: submitted → approved, and the payment status (Unpaid → Paid) once DroCon pays."},
    {tool:"vendor_short_days", title:"Short-day Reasons", body:"For pilot-days under 12 acres, record the reason — it's shared with the client and helps manage under-supply."},
    {tool:"portal_help", title:"Help &amp; Training", body:"The full Training Guide and FAQs live here — always up to date. That's the tour!"}
  ],
  pilot: [
    {title:"Welcome, Pilot", body:"Report the acres you spray each day and raise any field issue. Reopen this from <b>🧭 Tour</b> any time."},
    {tool:"pilot_report", title:"Report Acres", body:"Pick the date and your assigned location, add a row per farmer (name, village, crop, medicine, acres, GPS). If the day totals under 15 acres, add a short-day reason. Submit."},
    {tool:"pilot_reports", title:"My Reports", body:"See your reports and status — <b>Awaiting DroCon approval → Approved</b>. You can edit or withdraw while a report is still awaiting."},
    {tool:"issue_report", title:"Field Issues", body:"Raise a problem from the field (drone, chemical, access, weather…) and track it to resolution on a shared thread."},
    {tool:"portal_help", title:"Help", body:"Guidance and FAQs live here. That's the tour!"}
  ],
  client: [
    {title:"Welcome to your Client Portal", body:"A live view of the acres sprayed for your locations — no more waiting for periodic sheets. Reopen this from <b>🧭 Tour</b> any time."},
    {tool:"client_dashboard", title:"Acre Dashboard", body:"Totals and value, the this-week grid by location &amp; pilot, a per-location summary, and an expandable acre report by month / location / pilot."},
    {tool:"client_entries", title:"Entries", body:"Every approved spray line — farmer, phone, crop, medicine, acres, and the farmer / client rate split. Filter by date or location; download to Excel if enabled."},
    {tool:"client_short_days", title:"Short-day Reasons", body:"See the recorded reason whenever a pilot sprayed under the daily minimum on your locations."},
    {tool:"client_issues", title:"My Queries", body:"Raise a query on any entry; DroCon reviews and resolves. You can add notes and close it once satisfied."},
    {tool:"portal_help", title:"Help", body:"FAQs and guidance live here. That's the tour!"}
  ],
  partner: [
    {title:"Welcome to your Partner Portal", body:"Submit your invoices and track their status. Reopen this from <b>🧭 Tour</b> any time."},
    {tool:"portal_submit", title:"Submit Invoice", body:"File your acres-sprayed (or consultancy) invoice — enter the per-acre rate you received; amount and commission fill in automatically."},
    {tool:"portal_mine", title:"My Invoices", body:"Track each invoice: submitted → approved → paid, with any note from the DroCon team."},
    {tool:"portal_help", title:"Help", body:"FAQs live here. That's the tour!"}
  ]
};

function stepsFor(){
  const p = window.OPS.profile || {};
  if(p.is_external){ return TOURS[p.party_type] || TOURS.partner; }
  return TOURS.internal;
}

function markSeen(){ try{ localStorage.setItem(SEEN_KEY, String(window.OPS.build||"")); }catch(e){} }

function run(){
  if(document.getElementById("tourCard")) return;          // already open
  const steps = stepsFor(); if(!steps || !steps.length) return;
  let i = 0;
  const card = document.createElement("div"); card.id="tourCard";
  card.style.cssText="position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:300;width:min(460px,94vw);background:#fff;border:1px solid var(--line,#e2e2e2);border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.28);padding:16px";
  document.body.appendChild(card);
  function go(s){ try{ if(s.section && window.OPS.openSection) window.OPS.openSection(s.section); else if(s.tool && window.OPS.openTool) window.OPS.openTool(s.tool); }catch(e){} }
  function render(){
    const s = steps[i]; go(s);
    const dots = steps.map((_,k)=>`<span style="width:7px;height:7px;border-radius:50%;background:${k===i?'var(--green,#599533)':'#d6d6d6'}"></span>`).join("");
    card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <b style="font-size:15px">${s.title}</b><button id="tourX" class="btn sm ghost" title="Close tour">✕</button></div>
      <div style="font-size:13px;line-height:1.6;color:#555;margin-top:6px">${s.body}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:12px">
        <div style="display:flex;gap:5px;align-items:center">${dots}</div>
        <span class="muted" style="font-size:11px;margin-left:4px">${i+1}/${steps.length}</span>
        <div style="flex:1"></div>
        ${i>0?'<button class="btn sm" id="tourBack">Back</button>':''}
        <button class="btn green sm" id="tourNext">${i===steps.length-1?'Finish':'Next →'}</button>
      </div>`;
    $("tourX").onclick = close;
    if($("tourBack")) $("tourBack").onclick = ()=>{ i--; render(); };
    $("tourNext").onclick = ()=>{ if(i>=steps.length-1) close(); else { i++; render(); } };
  }
  function close(){ card.remove(); markSeen(); }
  render();
}

// Gentle "we updated" prompt on a new build (doesn't force the full tour).
function updateBanner(){
  if(document.getElementById("tourBanner")) return;
  markSeen();   // once per build
  const b = document.createElement("div"); b.id="tourBanner";
  b.style.cssText="position:fixed;right:16px;bottom:16px;z-index:300;background:#233;color:#fff;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.3);padding:12px 14px;max-width:300px;font-size:13px";
  b.innerHTML=`<b>DCB OS updated</b> — build ${esc(String(window.OPS.build||""))}.<div style="margin-top:8px;display:flex;gap:8px"><button class="btn green sm" id="tbGo">Take the tour</button><button class="btn sm" id="tbX" style="color:#fff;border-color:#567">Dismiss</button></div>`;
  document.body.appendChild(b);
  $("tbGo").onclick=()=>{ b.remove(); run(); };
  $("tbX").onclick=()=>b.remove();
  setTimeout(()=>{ const el=document.getElementById("tourBanner"); if(el) el.remove(); }, 15000);
}

function maybeAuto(){
  let seen; try{ seen=localStorage.getItem(SEEN_KEY); }catch(e){}
  const cur = String(window.OPS.build||"");
  if(!seen){ setTimeout(run, 900); return; }          // first-ever login → full tour
  if(seen !== cur){ setTimeout(updateBanner, 1200); } // new build → gentle prompt
}

window.OPS.tour = { run, maybeAuto };
})();
