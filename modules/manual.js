/* ============================================================================
   DroCon Cloud — User Manual + searchable FAQs (internal & partner)
   The section/tab guide is generated from the live SECTIONS/TOOLS registry, so it
   stays in sync automatically whenever tabs are added, renamed or removed. The
   login URL is read from the current location, so it is always correct.
   ============================================================================ */
(function(){
const { $, esc } = window.OPS.helpers;
const appURL = ()=> location.origin + location.pathname.replace(/[^/]*$/,"");

/* one-line help per tool key (used to annotate the auto-generated guide) */
const TOOL_HELP = {
  daily_entry:"Log a day's sprays once; on approval it posts to both the Farmer & Acre dashboards.",
  entries:"The raw, editable row-level data (Farmer sprays / Acre entries) before it rolls up into the dashboards. Correct individual rows here.",
  locations:"Deployment areas with an optional default ₹/acre, used by the Daily Spray Entry form.",
  reviews:"Your approval queue — daily spray submissions plus any documents/clients/vendors/BOM/agreements awaiting you. The 🔔 badge shows the pending count.",
  receivables:"Invoice ageing and receivables dashboard.",
  acre:"Acre tracking dashboard (summary only).",
  farmer:"Farmer tracking dashboard (summary + snapshot).",
  agreement_dashboard:"Agreement pipeline dashboard.",
  bd_dashboard:"Ongoing sales / business development dashboard.",
  resources:"Shared policies and documents (drive links you can open / share).",
  manual:"This user manual.",
  faqs:"Frequently asked questions — searchable.",
  partners:"The home of all contracted Authorized Partners — onboard and list every partner here, with their signed-agreement link.",
  ap_rates:"Per-partner commission rate cards (with a Standard fallback card). Drives the commission on partner invoices.",
  partner_invoices:"Review/approve/pay invoices submitted by partners & consultants, and create their portal logins (Partner Logins / Invites).",
  agreements:"All agreements; open one to view, edit or download.",
  new:"Create a new agreement from a template.",
  templates:"Shared clause templates that become the team standard.",
  orders:"Pool of potential orders + follow-up queue.",
  quotation:"Build a quotation (Word + JSON).",
  bom:"Drone BOM / quotation calculator.",
  purchase_order:"Raise a purchase order to a vendor.",
  invoice:"Create a tax invoice (Word + JSON).",
  credit_note:"Create a credit note against an invoice.",
  clients:"Client master.",
  vendors:"Vendor master.",
  inventory:"Stock levels; record Purchased/Sold quantities and Save changes.",
  catalogues:"Service & spare catalogues.",
  hr_salary:"Monthly salary calculator.",
  hr_employees:"Employee master.",
  consultants:"Consultant records (their portal invoicing is under Business Development → Partner Invoices).",
  hr_records:"Salary run records.",
  hr_payslips:"Generate & approve payslips.",
  team:"Grant per-tool access, capabilities and roles to staff.",
  audit:"Full audit log of actions.",
  access_log:"Who opened sensitive records.",
};

function quickStart(){
  return `<div class="callout"><b>Login URL:</b> <a href="${esc(appURL())}" target="_blank" rel="noopener">${esc(appURL())}</a> — bookmark this, or install the app (browser menu → Install). Sign in with your work email; partners use the invite-only login emailed to them.</div>`;
}

/* ---- auto-generated section/tab guide from the live registry ---- */
function sectionGuide(){
  const O=window.OPS; const out=[];
  (O.SECTIONS||[]).forEach(s=>{
    if(s.key==="portal") return; // internal manual omits the external portal
    const tools=(O.TOOLS||[]).filter(t=>t.section===s.key && O.canSee(t));
    if(!tools.length) return;
    out.push(`<h3 style="margin-top:16px">${esc(s.label)}</h3><ul style="font-size:13px;line-height:1.7">`+
      tools.map(t=>`<li><b>${esc(t.label)}</b> — ${esc(TOOL_HELP[t.key]||"")}</li>`).join("")+`</ul>`);
  });
  return out.join("");
}

function internalManual(){
  const m=$("main"); const admin=window.OPS.isAdmin();
  m.innerHTML=`<div class="eyebrow">Resources</div><h1>User Manual</h1>
    ${quickStart()}
    <div class="card">
      <h3>What this tool is</h3>
      <p style="font-size:13px;line-height:1.6">DroCon Cloud is DroCon Bharat's internal operations suite — daily spraying capture, approvals, dashboards, billing, HR, business development and partner management. Access is per-tab: an admin grants you exactly the tabs and capabilities you need under <b>Team &amp; Access</b>.</p>
      <h3 style="margin-top:14px">Key workflows</h3>
      <ul style="font-size:13px;line-height:1.7">
        <li><b>Daily spraying:</b> Daily Spray Entry → add a row per spray (pilot, farmer, acres, rates), assign a reviewer, <b>Submit for approval</b>. The reviewer approves it in <b>Review / Approvals</b>, which posts the rows to the Farmer &amp; Acre dashboards. Edit raw rows later under <b>Daily Spray Entry → Entries</b>.</li>
        <li><b>Approvals:</b> anything needing your sign-off appears in <b>Review / Approvals</b> (watch the 🔔 count). Editing an already-approved invoice sends it back for re-approval.</li>
        <li><b>Billing:</b> Finance → Invoice / Credit Note; documents download as Word (letterhead on every page) + a re-loadable JSON.</li>
        <li><b>Partners:</b> onboard them in <b>Business Development → Authorized Partners</b>; set their rate card in <b>Authorized Partner Rates</b>; create their login and approve their invoices in <b>Partner Invoices</b>.</li>
        <li><b>Inventory:</b> enter Purchased/Sold quantities against spares and click <b>Save changes</b>.</li>
      </ul>
      <h3 style="margin-top:14px">Your tabs (live)</h3>
      <p class="muted">Generated from what you can currently access — it updates automatically as the tool changes.</p>
      ${sectionGuide()}
      ${admin?'<div class="callout warn" style="margin-top:14px"><b>Admin:</b> grant access and capabilities (View contacts, Export, Delete) per person in <b>Team &amp; Access</b>. Keep Row-Level Security ON in Supabase. Deletions and sensitive-record views are audited.</div>':''}
      <p class="muted" style="margin-top:14px">Need help? Email <a href="mailto:info@droconbharat.com">info@droconbharat.com</a>. This manual reflects the current version of the tool.</p>
    </div>`;
}
window.OPS.routes.manual = internalManual;

/* ---- FAQs (searchable) ---- */
const FAQ_INTERNAL = [
  {q:"How do I log a day's spraying?", a:"Open Daily Spray Entry, add one row per spray (pilot, farmer, acres, client/farmer rate), pick a reviewer and Submit for approval. It posts to the dashboards once approved.", kw:"daily spray entry log add new"},
  {q:"Why don't my entries show in the Acre/Farmer dashboard yet?", a:"Daily entries must be approved first. The reviewer approves them under Review / Approvals; approval posts the rows to both dashboards.", kw:"dashboard missing not showing approve post reconcile"},
  {q:"How do I correct or delete a spray/acre row?", a:"Daily Spray Entry → Entries. Toggle Farmer sprays / Acre entries, search, click a row to edit or delete it.", kw:"edit correct delete row entries raw"},
  {q:"Where do I manage locations?", a:"Daily Spray Entry → Locations. Add a deployment area with an optional default ₹/acre.", kw:"location deployment area add"},
  {q:"What is the 🔔 number on Review / Approvals?", a:"The count of items awaiting your review (daily submissions, documents, clients, vendors, BOM, agreements). It clears as you action them.", kw:"bell badge count approval pending review"},
  {q:"How do I onboard an Authorized Partner?", a:"Business Development → Authorized Partners → + New. Add their details and signed-agreement link. Set their rate card under Authorized Partner Rates.", kw:"partner onboard add authorized list home"},
  {q:"How do I give a partner or consultant a login?", a:"Business Development → Partner Invoices → Partner Logins / Invites. Add their email + type; they self-register with that exact email and land only in the Partner Portal.", kw:"partner login invite external account portal consultant"},
  {q:"How does partner commission work?", a:"The partner enters the actual per-acre rate received from the farmer on each invoice line; the matching slab on their rate card (or the Standard card) sets the commission split. It is overridable.", kw:"commission rate card slab partner invoice"},
  {q:"How do I adjust inventory in bulk?", a:"Finance → Inventory. Enter Purchased (+) and/or Sold (−) quantities on any spares, then click Save changes.", kw:"inventory stock add subtract purchased sold save"},
  {q:"How do documents download?", a:"As a Word .docx with the DroCon letterhead on every page, plus a re-loadable JSON. Use the buttons on each builder.", kw:"word docx json download letterhead invoice quotation"},
  {q:"Who can see salaries / phone numbers?", a:"Salaries, bank details and farmer phone numbers are restricted to admins or staff granted access. Phones are masked unless you hold the View contacts capability.", kw:"salary phone bank sensitive mask view contacts privacy"},
  {q:"How do I get access to a tab I can't see?", a:"Ask an admin to grant it in Team & Access. Access is per-tab.", kw:"access permission tab cannot see grant team"},
  {q:"Where is the login URL?", a:"At the top of the User Manual, and it's the address you're on now — bookmark it or install the app from your browser menu.", kw:"url link login install pwa bookmark"},
];
const FAQ_PARTNER = [
  {q:"How do I submit an invoice?", a:"Partner Portal → Submit Invoice. Add a line per acre sprayed (date, farmer, mobile, the rate you received, acres). The amount and commission fill in automatically. Click Submit invoice.", kw:"submit invoice file new acres sprayed"},
  {q:"How is my commission calculated?", a:"Enter the actual per-acre rate you received from the farmer; the matching slab on your rate card sets DroCon's commission and your net payable. You can override the % if your contract differs.", kw:"commission rate slab calculate net payable"},
  {q:"How do I track payment?", a:"Partner Portal → My Invoices shows each invoice's status: submitted, approved, paid or rejected, with any note from the DroCon team.", kw:"payment status track my invoices approved paid rejected"},
  {q:"Can I edit an invoice after submitting?", a:"Yes, while it is still 'submitted'. Once approved it is locked; contact the DroCon team for changes.", kw:"edit change invoice after submit locked"},
  {q:"Is my data safe?", a:"Yes — your login sees only your own invoices and rate card, never DroCon's internal data or other partners'. See Data & Privacy (🛡 in the header).", kw:"data privacy safe security farmer phone"},
  {q:"Who do I contact for help?", a:"Email info@droconbharat.com or enquiries@droconbharat.com, or call the numbers in the footer.", kw:"help contact email phone support"},
];

function renderFAQ(host, list, title){
  host.innerHTML=`<div class="row" style="margin:6px 0"><input id="faqQ" placeholder="Search ${esc(title)} by keyword…" style="max-width:340px"></div>
    <div id="faqList"></div>`;
  function draw(q){
    q=(q||"").toLowerCase().trim();
    const rows=!q?list:list.filter(f=>(f.q+" "+f.a+" "+(f.kw||"")).toLowerCase().includes(q));
    $("faqList").innerHTML = rows.length? rows.map(f=>`<div class="card" style="margin-bottom:8px"><b>${esc(f.q)}</b><p style="font-size:13px;line-height:1.6;margin:6px 0 0">${esc(f.a)}</p></div>`).join("")
      : '<div class="card muted">No matching questions. Try another keyword.</div>';
  }
  draw(""); $("faqQ").addEventListener("input",e=>draw(e.target.value));
}

function internalFAQs(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Resources</div><h1>FAQs</h1>${quickStart()}<div id="faqHost"></div>`;
  renderFAQ($("faqHost"), FAQ_INTERNAL, "FAQs");
}
window.OPS.routes.faqs = internalFAQs;

/* ---- Partner portal: combined SOP + FAQs ---- */
function partnerHelp(){
  const m=$("main");
  m.innerHTML=`<div class="eyebrow">Partner Portal</div><h1>Help &amp; FAQs</h1>
    <div class="callout"><b>Portal URL:</b> <a href="${esc(appURL())}" target="_blank" rel="noopener">${esc(appURL())}</a> — bookmark it or install the app from your browser menu.</div>
    <div class="card">
      <h3>How the portal works</h3>
      <ul style="font-size:13px;line-height:1.7">
        <li><b>Submit Invoice</b> — file your acres-sprayed (or consultancy) invoice. Enter the actual per-acre rate you received from the farmer; the amount and commission fill in automatically.</li>
        <li><b>My Invoices</b> — track each invoice's status (submitted → approved → paid, or rejected with a note).</li>
        <li><b>Data &amp; Privacy</b> (🛡 top-right) — how your data and the farmer data you enter are protected.</li>
      </ul>
      <p class="muted">Questions? Email <a href="mailto:info@droconbharat.com">info@droconbharat.com</a> or call the numbers in the footer.</p>
    </div>
    <h3 style="margin-top:16px">FAQs</h3><div id="faqHost"></div>`;
  renderFAQ($("faqHost"), FAQ_PARTNER, "partner FAQs");
}
window.OPS.routes.portal_help = partnerHelp;
})();
