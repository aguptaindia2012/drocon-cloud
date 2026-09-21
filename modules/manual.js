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
  {q:"How do I set up a new project / location?", a:"In Registers, add the Client → Vendor → Pilots → Crops, then create the Location (Registers → Locations) with its Farmer rate + bill-to and Client rate + bill-to. See Resources → Guides & training for the step-by-step deck.", kw:"new project location setup client vendor pilot crop register order"},
  {q:"Farmer rate vs Client rate — when to use which?", a:"Farmer rate = what the farmer pays → 0% GST Bill of Supply. Client rate = a client/sponsor subsidy → 18% GST Tax Invoice. Set the Client rate to 0 when there is no client-side component.", kw:"farmer client rate gst bill of supply tax invoice subsidy 0"},
  {q:"A rate changed mid-season — how do I update it?", a:"On the Location → Crop-specific rates, add a NEW row with a later Effective-from date. Older entries keep the old rate; don't edit old rows or clone the location.", kw:"rate change effective date crop specific new row history"},
  {q:"How do vendors and pilots report their own acres?", a:"Vendors add pilots and request logins (approve them under Review / Approvals → Pilot Logins). Pilots report acres, which go directly to DroCon — you verify and approve under Review / Approvals → Pilot Acres, posting them to the tracker. The vendor sees the status read-only (Awaiting approval → Approved).", kw:"vendor pilot portal report acres approve pilot logins acres self service verify"},
  {q:"Where do I set what we pay a vendor?", a:"Finance → Vendor Rates, per Vendor + Location + Crop, effective-dated. Vendors invoice their approved acres at these rates; approve under Review / Approvals → Vendor Invoices, which creates a Payable (pay via Accounting → Payables).", kw:"vendor rate payout finance vendor invoice payable approve"},
  {q:"How do pilots get the locations they can report on?", a:"A pilot can only report for locations they're assigned to (pilot ↔ location assignment). Assign them so their location appears in Report Acres.", kw:"pilot assign location report cannot see assignment"},
  {q:"Where are the step-by-step guides?", a:"Registers → Resources → Guides & training holds the internal Workflow Guide and the Vendor & Pilot Portal training deck to share with vendors.", kw:"guide training resources workflow deck ppt document"},
];
const FAQ_PARTNER = [
  {q:"How do I submit an invoice?", a:"Partner Portal → Submit Invoice. Add a line per acre sprayed (date, farmer, mobile, the rate you received, acres). The amount and commission fill in automatically. Click Submit invoice.", kw:"submit invoice file new acres sprayed"},
  {q:"How is my commission calculated?", a:"Enter the actual per-acre rate you received from the farmer; the matching slab on your rate card sets DroCon's commission and your net payable. You can override the % if your contract differs.", kw:"commission rate slab calculate net payable"},
  {q:"How do I track payment?", a:"Partner Portal → My Invoices shows each invoice's status: submitted, approved, paid or rejected, with any note from the DroCon team.", kw:"payment status track my invoices approved paid rejected"},
  {q:"Can I edit an invoice after submitting?", a:"Yes, while it is still 'submitted'. Once approved it is locked; contact the DroCon team for changes.", kw:"edit change invoice after submit locked"},
  {q:"Is my data safe?", a:"Yes — your login sees only your own invoices and rate card, never DroCon's internal data or other partners'. See Data & Privacy (🛡 in the header).", kw:"data privacy safe security farmer phone"},
  {q:"Who do I contact for help?", a:"Email info@droconbharat.com or enquiries@droconbharat.com, or call the numbers in the footer.", kw:"help contact email phone support"},
];

/* Vendor & Pilot portal FAQs (acre reporting + invoicing) */
const FAQ_VENDORPILOT = [
  {q:"(Vendor) How do I add a pilot and give them a login?", a:"My Pilots → add the pilot (name, mobile, RPC, UIN) → click Request login and enter the pilot's email. DroCon approves it, then the pilot opens the app, chooses Create account and signs up with that exact email.", kw:"vendor add pilot login request approve invite create account"},
  {q:"(Pilot) How do I report the acres I sprayed?", a:"Report Acres → pick the date and your location (only locations DroCon assigned to you appear) → add a row per farmer (name, contact, village, crop, medicine, acres, GPS) → Submit. It goes to your vendor for review.", kw:"pilot report acres daily submit farmer village crop"},
  {q:"(Pilot) A location is not in my list — why?", a:"You can only report for locations DroCon has assigned to you. Ask the DroCon team to assign you to that location.", kw:"location missing assigned cannot see report"},
  {q:"(Vendor) Do I review my pilots' acres?", a:"No — a pilot's report now goes directly to DroCon for verification and approval. Under Pilot Reports you see the status (Awaiting DroCon approval → Approved). Once approved, the acres show on your Acre Dashboard and can be invoiced.", kw:"vendor acre review pilot reports status awaiting approved verification"},
  {q:"(Vendor) How do I set up my pilots?", a:"My Pilots → add each pilot (name, mobile, RPC, UIN) → Request login and enter their email. DroCon approves the login, then the pilot signs up with that exact email. DroCon assigns each pilot to a location — you can't self-assign locations; that keeps the data clean.", kw:"vendor setup pilot add request login rpc uin assign location"},
  {q:"(Vendor) How do I set my rates?", a:"My Rates → choose a location (and optionally a crop), enter your ₹/acre and an effective-from date → Add rate. Your invoices bill at the rate in force on each spray's date. To change a rate mid-season, add a NEW row with a later effective date — don't edit or delete old rows, or past sprays lose their rate. DroCon can view and, per your agreement, adjust these.", kw:"vendor rate rates set my rates per acre location crop effective"},
  {q:"(Vendor) How do I invoice DroCon?", a:"Invoice DroCon → pick a period → your approved, not-yet-invoiced acres appear at YOUR rates → tick the rows → optionally adjust part against an open advance → Generate. It goes to DroCon for approval; once approved it becomes a Supplier Invoice (payable). Track payment under My Invoices.", kw:"vendor invoice generate advance adjust approve payable payment"},
  {q:"(Vendor) What should I NOT do?", a:"Don't enter acres yourself — pilots report them and DroCon approves; that approved data flows to you. Don't try to assign pilots to locations (DroCon does that). Don't edit/delete an old rate row to change a price — add a new effective-dated row instead. Don't invoice the same acres twice — billed acres drop off the invoice list automatically. Don't share your login password in the messenger.", kw:"vendor what not to do rules mistakes acres assign rate password"},
  {q:"(Vendor) When do I get paid?", a:"Once DroCon approves your invoice it becomes a payable and is paid per your terms. Track it in My DroCon Invoices and the Vendor Report.", kw:"payment paid vendor invoice payable status track"},
  {q:"Why isn't my acre invoiceable yet?", a:"An acre becomes invoiceable only after DroCon approves the report (following your review). Check the status under My Reports / Acre Review.", kw:"acre not invoiceable pending approve status"},
  {q:"How do I report a field problem?", a:"Field Issues → Raise an issue (category, severity, details). You, your vendor and DroCon can discuss it on the thread until it's resolved.", kw:"field issue problem raise drone chemical access thread resolve"},
  {q:"Is my data safe?", a:"Yes — your login sees only your own pilots, acres and invoices, never DroCon's internal data or other vendors'. See Data & Privacy (🛡 in the header).", kw:"data privacy safe security own only"},
  {q:"Who do I contact for help?", a:"Your DroCon coordinator, or email info@droconbharat.com / call the numbers in the footer.", kw:"help contact email phone support"},
];

/* Client portal FAQs (live acre view + queries) */
const FAQ_CLIENT = [
  {q:"What does the Acre Dashboard show?", a:"A live view of the acres sprayed on your assigned locations. It has your total/farmer/client value tiles, a 'this week' grid of acres by location and pilot, and an expandable acre report you can drill down By Location, By Date or By Pilot.", kw:"dashboard acres live weekly location pilot report drill"},
  {q:"When does new data appear?", a:"As soon as the DroCon Bharat team approves a day's work in our system, it shows here — replacing the periodic Excel sheets with a live view.", kw:"live update approve daily fresh when appear"},
  {q:"What's in the Entries page?", a:"Every approved spray line for your locations: date, location, farmer, phone, village, crop, medicine, pilot, acres, and the billing split — Farmer rate/amount, Client rate/amount and the Total. Filter by date range, location or search a farmer/village.", kw:"entries columns farmer phone rate crop medicine filter search"},
  {q:"Farmer rate vs Client rate — what's the difference?", a:"The Farmer rate is what the farmer pays per acre; the Client rate is your (client/sponsor) component per acre. Each amount = acres × the matching rate, and Total = Farmer + Client.", kw:"farmer client rate split amount total billing"},
  {q:"Can I download the data to Excel?", a:"Downloads are enabled for your account only after an NDA is signed. Once enabled, an ⬇ Excel button appears on the Entries page. Contact DroCon Bharat if you need it.", kw:"download excel export nda enable restricted"},
  {q:"Something looks wrong on an entry — how do I flag it?", a:"On the Entries page, click 'Raise query' on that line. Add a subject and details. The DroCon team discusses and resolves it; you can add notes and close the query yourself once you're satisfied. Track it under My Queries.", kw:"raise query issue dispute escalate flag wrong close resolve"},
  {q:"Is my data private?", a:"Yes — your login sees only the locations assigned to you, and only approved data. You never see DroCon's internal records or any other client's data. This is enforced by the database, not just the screen.", kw:"privacy data safe security assigned locations only"},
  {q:"Who do I contact for help?", a:"Email info@droconbharat.com or call the numbers in the footer.", kw:"help contact email phone support"},
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

/* ---- Partner portal: combined SOP + FAQs (party-aware) ---- */
function partnerHelp(){
  const m=$("main");
  const party=(window.OPS.profile&&window.OPS.profile.party_type)||"";
  const isClient = party==="client";
  const isVP = party==="vendor" || party==="pilot";
  if(isClient){
    m.innerHTML=`<div class="eyebrow">Client Portal</div><h1>Help &amp; FAQs</h1>
      <div class="callout"><b>Portal URL:</b> <a href="${esc(appURL())}" target="_blank" rel="noopener">${esc(appURL())}</a> — bookmark it or install the app from your browser menu.</div>
      <div class="card"><h3>How your portal works</h3>
        <ul style="font-size:13px;line-height:1.7">
          <li><b>Acre Dashboard</b> — live totals for your assigned locations, a this-week grid by location &amp; pilot, and an expandable acre report (By Location / Date / Pilot) with the farmer/client value split.</li>
          <li><b>Entries</b> — every approved spray line with farmer, phone, crop, medicine, acres and the Farmer/Client rate split. Filter by date, location or search. Download to Excel once enabled.</li>
          <li><b>My Queries</b> — raise a query on any entry; DroCon reviews and resolves; you can add notes and close it.</li>
          <li><b>Data &amp; Privacy</b> (🛡 top-right) — you see only your assigned locations' approved data.</li>
        </ul>
        <p class="muted">Data appears here once DroCon Bharat approves each day's work.</p>
      </div>
      <h3 style="margin-top:16px">FAQs</h3><div id="faqHost"></div>`;
    renderFAQ($("faqHost"), FAQ_CLIENT, "client FAQs");
    return;
  }
  const guide = isVP ? `<details open class="card"><summary style="cursor:pointer;font-weight:700;font-size:16px">📘 Vendor &amp; Pilot Portal — Training Guide <span class="muted" style="font-weight:400;font-size:12px">(living guide — always up to date)</span></summary>
    <div style="font-size:13px;line-height:1.7;margin-top:10px">
      <h3 style="margin:6px 0">Three roles, one flow</h3>
      <ul><li><b>DroCon</b> — creates your login, approves pilot logins, <b>assigns pilots to locations</b>, approves acres &amp; invoices, and pays. Can view/adjust your rates per the agreement.</li>
        <li><b>Vendor (you)</b> — add pilots &amp; request logins, <b>set your rates</b>, review the acres your pilots report, and invoice DroCon.</li>
        <li><b>Pilot</b> — log in and report the acres sprayed each day; raise any field issue.</li></ul>
      <h3 style="margin:12px 0 6px">From login to payment</h3>
      <ol><li><b>Get logins</b> — DroCon invites you; you add pilots &amp; request logins; DroCon approves; pilots sign up with that exact email.</li>
        <li><b>DroCon assigns</b> pilots to locations (you can't self-assign — it keeps data clean).</li>
        <li><b>You set your rates</b> — My Rates → ₹/acre per location/crop, effective-dated.</li>
        <li><b>Pilots report acres</b> — date, location, farmer, village, crop, medicine, acres, GPS.</li>
        <li><b>DroCon verifies &amp; approves</b> — the pilot's report goes straight to DroCon; they check and approve (or send back). Approved acres post to the tracker and become billable. You see the status go from <b>Awaiting approval</b> to <b>Approved</b> under Pilot Reports.</li>
        <li><b>You invoice</b> — approved acres bill at your rates (optionally net against an advance) → DroCon approves → Supplier Invoice (payable) → payment.</li></ol>
      <h3 style="margin:12px 0 6px">Set up each pilot (once)</h3>
      <ol><li>My Pilots → add the pilot (name, mobile, RPC, UIN).</li><li>Request login → enter their email.</li><li>DroCon approves the login.</li><li>Pilot opens the app → Create account with that exact email.</li><li>DroCon assigns them to a location.</li></ol>
      <h3 style="margin:12px 0 6px">Every working day (pilot)</h3>
      <ol><li>Report Acres → pick date &amp; location (only assigned locations show).</li><li>Add a row per farmer: name, contact, village, crop, medicine, acres, GPS.</li><li>If the day totals under 15 acres, add a short-day reason.</li><li>Submit → it goes to the vendor for review.</li></ol>
      <h3 style="margin:12px 0 6px">Review &amp; approval</h3>
      <p>The pilot's report goes <b>straight to DroCon</b> (Pilot Acres) for verification — they check and approve, or send it back to the pilot to fix. Under <b>Pilot Reports</b> you see the status move from <b>Awaiting DroCon approval</b> to <b>Approved</b>. Approved acres are the acreage of record and become billable.</p>
      <h3 style="margin:12px 0 6px">Your rates (My Rates)</h3>
      <p>Set ₹/acre per location (optionally per crop), with an effective-from date. Invoices bill at the rate in force on each spray's date. To change a rate mid-season, add a <b>new</b> effective-dated row — never edit/delete an old one. DroCon can view and adjust per the agreement.</p>
      <h3 style="margin:12px 0 6px">Invoicing DroCon</h3>
      <ol><li>Invoice DroCon → pick a period; your approved, un-invoiced acres appear at your rates.</li><li>Tick rows; optionally net part against an open advance (acres still count as billed).</li><li>Generate → Print/PDF or Excel (unbranded — use your letterhead).</li><li>DroCon approves → it becomes a Supplier Invoice (payable); track Paid status in My Invoices.</li></ol>
      <h3 style="margin:12px 0 6px">Acre Dashboard</h3>
      <p>Your live position: this-week grid by location &amp; pilot, location summary, month-wise, plus tiles for unbilled acres, pending payment from DroCon, and amount due to DroCon.</p>
      <h3 style="margin:12px 0 6px">Field issues</h3>
      <p>Pilots raise issues (drone, chemical, access, farmer, weather, payment, other) with severity &amp; details. You and DroCon discuss on a shared thread: Open → In review → Resolved → Closed.</p>
      <h3 style="margin:12px 0 6px">Where DroCon steps in</h3>
      <ul><li>Create your vendor login</li><li>Approve each pilot login</li><li>Assign pilots to locations</li><li>Approve pilot acre reports (makes acres billable)</li><li>Approve your invoices (triggers payment)</li></ul>
      <h3 style="margin:12px 0 6px">What NOT to do</h3>
      <ul><li>Don't enter acres yourself — pilots report, DroCon approves.</li><li>Don't try to assign pilots to locations — DroCon does that.</li><li>Don't edit/delete an old rate row — add a new effective-dated one.</li><li>Don't double-invoice — billed acres drop off the list automatically.</li><li>Don't share your password in the messenger.</li></ul>
      <p class="muted" style="margin-top:10px"><b>Golden rule:</b> report daily, review promptly, keep your rates current — approvals and payment follow.</p>
    </div></details>` : "";
  const how = isVP ? `<div class="card"><h3>How the portal works</h3>
      <ul style="font-size:13px;line-height:1.7">
        <li><b>Vendors — Acre Dashboard</b>: your pilots' approved acres (weekly by location &amp; pilot, month-wise), plus your billing position — unbilled acres, pending payment from DroCon, and amount due to DroCon.</li>
        <li><b>Vendors — My Pilots</b>: add pilots and request their logins (DroCon approves &amp; assigns them to locations).</li>
        <li><b>Vendors — My Rates</b>: set your own ₹/acre per location/crop, effective-dated. DroCon can view/adjust per the agreement.</li>
        <li><b>Pilots — Report Acres</b>: log each day's acres for your assigned location; your vendor reviews and DroCon approves.</li>
        <li><b>Vendors — Pilot Reports</b>: see your pilots' reported acres and their status (Awaiting DroCon approval → Approved). Verification is DroCon's step.</li>
        <li><b>Vendors — Invoice DroCon &amp; My Invoices</b>: invoice approved acres at YOUR rates (optionally net against an advance); track approval &amp; payment status.</li>
        <li><b>Field Issues / Short-day Reasons</b>: raise field problems and record reasons for low-acre days.</li>
        <li><b>Data &amp; Privacy</b> (🛡 top-right) — how your data is protected.</li>
      </ul>
      <p class="muted">You set your rates (My Rates); DroCon approves acres &amp; invoices, then pays.</p>
    </div>` : `<div class="card">
      <h3>How the portal works</h3>
      <ul style="font-size:13px;line-height:1.7">
        <li><b>Submit Invoice</b> — file your acres-sprayed (or consultancy) invoice. Enter the actual per-acre rate you received from the farmer; the amount and commission fill in automatically.</li>
        <li><b>My Invoices</b> — track each invoice's status (submitted → approved → paid, or rejected with a note).</li>
        <li><b>Data &amp; Privacy</b> (🛡 top-right) — how your data and the farmer data you enter are protected.</li>
      </ul>
      <p class="muted">Questions? Email <a href="mailto:info@droconbharat.com">info@droconbharat.com</a> or call the numbers in the footer.</p>
    </div>`;
  m.innerHTML=`<div class="eyebrow">Partner Portal</div><h1>Help &amp; FAQs</h1>
    <div class="callout"><b>Portal URL:</b> <a href="${esc(appURL())}" target="_blank" rel="noopener">${esc(appURL())}</a> — bookmark it or install the app from your browser menu.</div>
    ${guide}${how}
    <h3 style="margin-top:16px">FAQs</h3><div id="faqHost"></div>`;
  renderFAQ($("faqHost"), isVP?FAQ_VENDORPILOT:FAQ_PARTNER, isVP?"vendor & pilot FAQs":"partner FAQs");
}
window.OPS.routes.portal_help = partnerHelp;
})();
