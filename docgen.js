/* ============================================================================
   DroCon Cloud — document engine (Word .docx + JSON)
   Generalised from the Agreement Studio export. Produces branded Invoice,
   Quotation, Credit Note and Purchase Order documents. The DroCon letterhead
   sits in the Word section header, so it repeats automatically on every page.
   Exposes: OPS.docgen.generateWord(doc), OPS.docgen.downloadJson(doc),
            OPS.docgen.amountInWords(n), OPS.docgen.DCB
   ============================================================================ */
(function(){
const DCB = {
  legalName:"DroCon Bharat Private Limited", short:"DroCon Bharat",
  cin:"U01611UP2025PTC230828", gstin:"09AALCD9671N1ZO", udyam:"UDYAM-UP-56-0133434",
  address:"315/7 Thapar Nagar, Meerut Cantt, Meerut – 250001, Uttar Pradesh, India",
  shortAddress:"315/7 Thapar Nagar, Meerut (U.P.) – 250001",
  stateName:"Uttar Pradesh", stateCode:"09",
  mobile:"+91 73026 27122", altMobile:"+91 90843 81822",
  email:"info@droconbharat.com", web:"www.droconbharat.com",
  director:"Abhishek Gupta", bank:{ name:"", account:"", ifsc:"", branch:"" }
};
const DCB_LOGO = (window.DCB_LOGO_DATAURL) || ""; // set below

/* ---------- amount in words (Indian system, rupees + paise) ---------- */
function amountInWords(amount){
  amount = Math.round((Number(amount)||0)*100)/100;
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees)*100);
  const a=["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const b=["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  function two(n){ return n<20 ? a[n] : b[Math.floor(n/10)] + (n%10? " "+a[n%10] : ""); }
  function three(n){ return (n>=100 ? a[Math.floor(n/100)]+" Hundred"+(n%100?" ":"") : "") + (n%100? two(n%100):""); }
  function inWords(n){
    if(n===0) return "Zero";
    let str="";
    const crore=Math.floor(n/10000000); n%=10000000;
    const lakh=Math.floor(n/100000); n%=100000;
    const thousand=Math.floor(n/1000); n%=1000;
    const hundred=n;
    if(crore) str+=inWords(crore)+" Crore ";
    if(lakh) str+=two(lakh)+" Lakh ";
    if(thousand) str+=two(thousand)+" Thousand ";
    if(hundred) str+=three(hundred);
    return str.trim();
  }
  let out = "INR " + inWords(rupees) + " Rupees";
  if(paise>0) out += " and " + two(paise) + " Paise";
  return out + " Only";
}

/* ---------- helpers ---------- */
function b64ToBytes(dataUrl){
  const b64=dataUrl.split(",")[1]; const bin=atob(b64); const len=bin.length; const bytes=new Uint8Array(len);
  for(let i=0;i<len;i++) bytes[i]=bin.charCodeAt(i); return bytes;
}
const safe = s => (s==null?"":String(s));
const inr = n => "₹"+(Number(n||0)).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});

/* Compute totals from items. item: {desc,hsn,gst,qty,rate,per,disc} */
function computeTotals(items){
  let sub=0, gstTotal=0; const gstBuckets={};
  (items||[]).forEach(it=>{
    const qty=Number(it.qty)||0, rate=Number(it.rate)||0, disc=Number(it.disc)||0, gst=Number(it.gst)||0;
    const line = qty*rate*(1-disc/100);
    const g = line*gst/100;
    sub+=line; gstTotal+=g;
    gstBuckets[gst]=(gstBuckets[gst]||0)+g;
  });
  return { sub, gstTotal, total: sub+gstTotal, gstBuckets };
}

function fileBase(doc){
  const t={quotation:"Quotation",invoice:"Invoice",credit_note:"CreditNote",purchase_order:"PurchaseOrder"}[doc.doc_type]||"Document";
  const party=(doc.party&&(doc.party.firmName||doc.party.name)||"").replace(/[\\\/:*?"<>|]+/g,"").replace(/\s+/g,"_");
  const numSafe=(doc.number||"").replace(/[\\\/:*?"<>|]+/g,"-");
  return `DroCon_${t}_${numSafe}${party?("_"+party):""}`;
}

/* ---------- JSON (retrievable draft) ---------- */
function downloadJson(doc){
  const blob=new Blob([JSON.stringify(doc,null,2)],{type:"application/json"});
  window.OPS.saveBlob(blob, fileBase(doc)+".json","application/json",".json");
}

/* ============================================================================
   WORD (.docx)
   ============================================================================ */
function generateWord(doc){
  if(typeof docx==="undefined"){ alert("Word library not loaded. Check your connection and retry."); return; }
  const D=docx;
  const GREEN="599533", ORANGE="F48A1C", BLUE="0A6496", CHAR="282828", GREY="F5F5F5", LINE="CFD8C9";
  const border={style:D.BorderStyle.SINGLE,size:1,color:LINE};
  const noBorder={style:D.BorderStyle.NONE,size:0,color:"FFFFFF"};
  const totals = doc.totals || computeTotals(doc.items);

  function run(text,opts){ opts=opts||{}; return new D.TextRun({text:safe(text),bold:opts.bold,italics:opts.italics,color:opts.color||CHAR,size:opts.size||18,break:opts.break}); }
  function para(children,opts){ opts=opts||{}; return new D.Paragraph({children:Array.isArray(children)?children:[children],alignment:opts.align,spacing:opts.spacing||{after:20}}); }
  function cell(children,opts){ opts=opts||{};
    return new D.TableCell({
      width:opts.w?{size:opts.w,type:D.WidthType.DXA}:undefined,
      columnSpan:opts.span||1, verticalAlign:D.VerticalAlign.TOP,
      borders:opts.noBorder?{top:noBorder,bottom:noBorder,left:noBorder,right:noBorder}:{top:border,bottom:border,left:border,right:border},
      shading:opts.fill?{fill:opts.fill,type:D.ShadingType.CLEAR}:undefined,
      margins:{top:50,bottom:50,left:80,right:80},
      children:(Array.isArray(children)?children:[children]).map(c=> typeof c==="string"? para(run(c,opts)) : c )
    });
  }
  function kv(label,value){ return [ new D.Paragraph({children:[run(label,{bold:true,size:17}), run(" "+safe(value),{size:17})], spacing:{after:10}}) ]; }

  // ---- Title ----
  const title = doc.title || ({quotation:"Quotation",invoice:"Tax/Cash Credit Invoice",credit_note:"Credit Note",purchase_order:"Purchase Order"}[doc.doc_type]);
  const children=[];
  children.push(new D.Paragraph({alignment:D.AlignmentType.CENTER, spacing:{after:120},
    children:[run(title,{bold:true,color:GREEN,size:30})]}));

  // ---- Top block: seller (left) | document meta (right) ----
  const sellerCell = cell([
    para(run(DCB.legalName,{bold:true,size:19,color:GREEN})),
    para(run(DCB.address,{size:16})),
    para(run("GSTIN: "+DCB.gstin,{size:16})),
    para(run("State: "+DCB.stateName+", Code: "+DCB.stateCode,{size:16})),
    para(run("Email: "+DCB.email+"  ·  "+DCB.mobile,{size:16})),
  ],{w:5400});
  const refRows=[];
  const numberLabel = doc.doc_type==="quotation"?"Quotation No.":(doc.doc_type==="purchase_order"?"PO Number":(doc.doc_type==="credit_note"?"Credit Note No.":"Invoice No."));
  refRows.push([numberLabel, doc.number||""]);
  refRows.push(["Dated", window.OPS.helpers.fmtDate(doc.doc_date)]);
  (doc.refs||[]).forEach(r=> refRows.push([r.k, r.v]));
  const metaCell = cell(refRows.map(r=> new D.Paragraph({children:[run(r[0]+": ",{bold:true,size:17}),run(r[1],{size:17})],spacing:{after:10}})),{w:4200});
  children.push(new D.Table({width:{size:9600,type:D.WidthType.DXA},columnWidths:[5400,4200],
    rows:[ new D.TableRow({children:[sellerCell,metaCell]}) ]}));
  children.push(new D.Paragraph({text:"",spacing:{after:60}}));

  // ---- Party block (buyer or supplier) ----
  const p=doc.party||{};
  const partyTitle = doc.doc_type==="purchase_order" ? "Supplier / Vendor Details" : "Buyer Details";
  const partyLines=[
    new D.Paragraph({children:[run(partyTitle,{bold:true,size:18,color:BLUE})],spacing:{after:10}}),
  ];
  if(p.firmName) partyLines.push(...kv("Firm/Name:", p.firmName));
  if(p.name && p.name!==p.firmName) partyLines.push(...kv("Contact:", p.name));
  if(p.address) partyLines.push(...kv("Address:", [p.address,p.city,p.state,p.pincode].filter(Boolean).join(", ")));
  if(p.mobile) partyLines.push(...kv("Mobile:", p.mobile));
  if(p.gstin) partyLines.push(...kv("GSTIN/UIN:", p.gstin));
  if(p.stateName||p.state) partyLines.push(...kv("State:", (p.stateName||p.state)+(p.stateCode?(", Code: "+p.stateCode):"")));
  if(p.email) partyLines.push(...kv("Email:", p.email));
  children.push(new D.Table({width:{size:9600,type:D.WidthType.DXA},columnWidths:[9600],
    rows:[ new D.TableRow({children:[ cell(partyLines,{w:9600,fill:"FBFDF8"}) ]}) ]}));
  children.push(new D.Paragraph({text:"",spacing:{after:80}}));

  // ---- Line items table ----
  const heads = ["S.No.","Description","HSN/SAC","GST%","Qty","Rate","Per","Disc%","Amount"];
  const colW   = [520, 3200, 900, 620, 620, 1100, 700, 640, 1300];
  const headRow=new D.TableRow({tableHeader:true,children:heads.map((h,i)=>cell(h,{w:colW[i],bold:true,color:"FFFFFF",fill:GREEN,size:17}))});
  const itemRows=(doc.items||[]).map((it,idx)=>{
    const qty=Number(it.qty)||0, rate=Number(it.rate)||0, disc=Number(it.disc)||0;
    const amount=qty*rate*(1-disc/100);
    const descParas=[ new D.Paragraph({children:[run(it.desc,{size:17})],spacing:{after:0}}) ];
    if(it.sub) descParas.push(new D.Paragraph({children:[run(it.sub,{size:15,italics:true,color:"6a6a6a"})],spacing:{after:0}}));
    return new D.TableRow({children:[
      cell(String(idx+1),{w:colW[0],size:17}),
      cell(descParas,{w:colW[1]}),
      cell(safe(it.hsn),{w:colW[2],size:17}),
      cell((it.gst!=null?it.gst+"%":""),{w:colW[3],size:17}),
      cell(qty?String(qty):"",{w:colW[4],size:17}),
      cell(rate?inr(rate):"",{w:colW[5],size:17}),
      cell(safe(it.per),{w:colW[6],size:17}),
      cell(disc?disc+"%":"",{w:colW[7],size:17}),
      cell(inr(amount),{w:colW[8],size:17}),
    ]});
  });
  // totals rows
  const totalQty = (doc.items||[]).reduce((s,it)=>s+(Number(it.qty)||0),0);
  function totalRow(label,val,opts){ opts=opts||{};
    return new D.TableRow({children:[
      cell("",{w:colW[0],noBorder:true}),
      cell([new D.Paragraph({alignment:D.AlignmentType.RIGHT,children:[run(label,{bold:true,size:17,color:opts.color})]})],{w:colW[1]+colW[2]+colW[3]+colW[4]+colW[5]+colW[6]+colW[7],span:7,fill:opts.fill}),
      cell([new D.Paragraph({alignment:D.AlignmentType.RIGHT,children:[run(val,{bold:true,size:17,color:opts.color})]})],{w:colW[8],fill:opts.fill}),
    ]});
  }
  const allRows=[headRow,...itemRows];
  allRows.push(totalRow("Sub Total", inr(totals.sub)));
  Object.keys(totals.gstBuckets||{}).filter(g=>Number(g)>0 && totals.gstBuckets[g]>0).forEach(g=>{
    allRows.push(totalRow("GST @ "+g+"%", inr(totals.gstBuckets[g])));
  });
  allRows.push(totalRow("Grand Total"+(totalQty?(" (Qty "+totalQty+")"):""), inr(totals.total), {fill:"EEF5E9",color:GREEN}));
  children.push(new D.Table({width:{size:9600,type:D.WidthType.DXA},columnWidths:colW,rows:allRows}));

  // ---- Amount in words ----
  children.push(new D.Paragraph({spacing:{before:100,after:40},children:[
    run((doc.doc_type==="quotation"?"Amount Payable (in words): ":"Amount Chargeable (in words): "),{bold:true,size:17}),
    run(amountInWords(totals.total),{italics:true,size:17})
  ]}));

  // ---- Terms ----
  const terms=doc.terms||{};
  const termBlocks=[];
  if(terms.paymentTerms) termBlocks.push(["Terms of Payment", terms.paymentTerms]);
  if(terms.deliveryTerms) termBlocks.push(["Terms of Delivery", terms.deliveryTerms]);
  if(Array.isArray(terms.poTerms) && terms.poTerms.length) termBlocks.push(["Terms & Conditions", terms.poTerms]);
  if(terms.notes) termBlocks.push(["Notes", terms.notes]);
  termBlocks.forEach(tb=>{
    children.push(new D.Paragraph({spacing:{before:120,after:30},children:[run(tb[0],{bold:true,size:18,color:BLUE})]}));
    if(Array.isArray(tb[1])){
      tb[1].forEach(line=> children.push(new D.Paragraph({children:[run(line,{size:16})],numbering:{reference:"dcb-num",level:0},spacing:{after:20}})));
    } else {
      children.push(new D.Paragraph({children:[run(tb[1],{size:16})],spacing:{after:20}}));
    }
  });

  // ---- Signature / system-approval ----
  // Quotation & Purchase Order, once approved in the system, are valid without a
  // physical signature. Invoice & Credit Note are always signed after printing.
  const sysApprovable = (doc.doc_type==="quotation" || doc.doc_type==="purchase_order");
  if(sysApprovable && doc.systemApproved){
    children.push(new D.Paragraph({spacing:{before:240,after:30},border:{top:{style:D.BorderStyle.SINGLE,size:4,color:GREEN,space:4}},
      children:[run("✓ System-approved",{bold:true,color:GREEN,size:18})]}));
    children.push(new D.Paragraph({spacing:{after:20},children:[run("This "+(doc.doc_type==="quotation"?"quotation":"purchase order")+" was reviewed and approved in DroCon Cloud. It is electronically authorised and "+"does not require a physical signature.",{italics:true,size:16})]}));
    children.push(new D.Paragraph({alignment:D.AlignmentType.RIGHT,children:[run("For "+DCB.legalName+" — system-approved",{bold:true,size:16,color:GREEN})]}));
  } else {
    children.push(new D.Paragraph({spacing:{before:240},alignment:D.AlignmentType.RIGHT,children:[run("For "+DCB.legalName,{bold:true,size:18})]}));
    children.push(new D.Paragraph({spacing:{before:340},alignment:D.AlignmentType.RIGHT,children:[run("Authorised Signatory",{size:17})]}));
  }

  // ---- Document ----
  const headerChildren = DCB_LOGO ? [ new D.Paragraph({alignment:D.AlignmentType.RIGHT,children:[
      new D.ImageRun({type:"png",data:b64ToBytes(DCB_LOGO),transformation:{width:124,height:61}})]}) ]
    : [ new D.Paragraph({alignment:D.AlignmentType.RIGHT,children:[run(DCB.legalName,{bold:true,color:GREEN,size:20})]}) ];

  const docx_doc=new D.Document({
    numbering:{config:[{reference:"dcb-num",levels:[{level:0,format:D.LevelFormat.DECIMAL,text:"%1.",alignment:D.AlignmentType.LEFT,style:{paragraph:{indent:{left:420,hanging:260}}}}]}]},
    styles:{default:{document:{run:{font:"Lato",size:18,color:CHAR}}}},
    sections:[{
      properties:{page:{size:{width:12240,height:15840},margin:{top:1180,bottom:1100,left:900,right:900,header:520,footer:430}}},
      headers:{default:new D.Header({children:headerChildren})},
      footers:{default:new D.Footer({children:[
        new D.Paragraph({alignment:D.AlignmentType.CENTER,border:{top:{style:D.BorderStyle.SINGLE,size:6,color:ORANGE,space:4}},
          children:[run(DCB.legalName+", "+DCB.shortAddress+"  ·  "+DCB.mobile+"  ·  "+DCB.email,{color:ORANGE,size:13,bold:true})]}),
        new D.Paragraph({spacing:{before:30},border:{bottom:{style:D.BorderStyle.SINGLE,size:16,color:GREEN,space:1}},children:[run("",{size:2})]})
      ]})},
      children
    }]
  });
  D.Packer.toBlob(docx_doc).then(blob=>{
    window.OPS.saveBlob(blob, fileBase(doc)+".docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document",".docx");
  }).catch(e=>{ alert("Word error: "+e); });
}

/* ============================================================================
   WORD REPORT (dashboards) — title + sections (heading / chart image / table),
   DroCon letterhead repeating on every page.
   opts = { title, subtitle?, sections:[{heading?, note?, image?(pngDataUrl), imgW?, imgH?, table?:{headers,rows}}] }
   ============================================================================ */
function generateReport(opts){
  if(typeof docx==="undefined"){ alert("Word library not loaded."); return; }
  const D=docx;
  const GREEN="599533", ORANGE="F48A1C", BLUE="0A6496", CHAR="282828", GREY="F5F5F5", LINE="CFD8C9";
  const border={style:D.BorderStyle.SINGLE,size:1,color:LINE};
  function run(t,o){ o=o||{}; return new D.TextRun({text:safe(t),bold:o.bold,italics:o.italics,color:o.color||CHAR,size:o.size||18}); }
  function cell(t,o){ o=o||{}; return new D.TableCell({ width:o.w?{size:o.w,type:D.WidthType.DXA}:undefined,
    borders:{top:border,bottom:border,left:border,right:border}, shading:o.fill?{fill:o.fill,type:D.ShadingType.CLEAR}:undefined,
    margins:{top:50,bottom:50,left:80,right:80}, children:[new D.Paragraph({children:[run(t,o)]})] }); }
  function dataTable(headers, rows){ const w=Math.floor(9360/headers.length);
    const head=new D.TableRow({tableHeader:true,children:headers.map(h=>cell(h,{bold:true,color:"FFFFFF",fill:GREEN,w,size:17}))});
    const body=rows.map((r,ri)=>new D.TableRow({children:r.map(c=>cell(c==null?"":String(c),{w,fill:ri%2?GREY:undefined,size:17}))}));
    return new D.Table({width:{size:9360,type:D.WidthType.DXA},columnWidths:headers.map(()=>w),rows:[head,...body]}); }
  const children=[];
  children.push(new D.Paragraph({alignment:D.AlignmentType.CENTER,spacing:{after:opts.subtitle?20:140},children:[run(opts.title||"Report",{bold:true,color:GREEN,size:30})]}));
  if(opts.subtitle) children.push(new D.Paragraph({alignment:D.AlignmentType.CENTER,spacing:{after:140},children:[run(opts.subtitle,{italics:true,color:BLUE,size:19})]}));
  children.push(new D.Paragraph({alignment:D.AlignmentType.RIGHT,spacing:{after:120},children:[run("Generated "+new Date().toLocaleString(),{size:15,color:"7a8071"})]}));
  (opts.sections||[]).forEach(s=>{
    if(s.heading) children.push(new D.Paragraph({spacing:{before:200,after:60},border:{bottom:{style:D.BorderStyle.SINGLE,size:4,color:"D9E8CC",space:2}},children:[run(s.heading,{bold:true,color:GREEN,size:24})]}));
    if(s.note) children.push(new D.Paragraph({spacing:{after:60},children:[run(s.note,{size:17,color:"7a8071"})]}));
    if(s.image){ try{ children.push(new D.Paragraph({spacing:{after:80},children:[new D.ImageRun({type:"png",data:b64ToBytes(s.image),transformation:{width:s.imgW||520,height:s.imgH||240}})]})); }catch(e){} }
    if(s.table && s.table.rows && s.table.rows.length) children.push(dataTable(s.table.headers, s.table.rows));
  });
  const headerChildren = DCB_LOGO ? [ new D.Paragraph({alignment:D.AlignmentType.RIGHT,children:[new D.ImageRun({type:"png",data:b64ToBytes(DCB_LOGO),transformation:{width:124,height:61}})]}) ]
    : [ new D.Paragraph({alignment:D.AlignmentType.RIGHT,children:[run(DCB.legalName,{bold:true,color:GREEN,size:20})]}) ];
  const doc=new D.Document({ styles:{default:{document:{run:{font:"Lato",size:18,color:CHAR}}}},
    sections:[{ properties:{page:{size:{width:12240,height:15840},margin:{top:1180,bottom:1100,left:900,right:900,header:520,footer:430}}},
      headers:{default:new D.Header({children:headerChildren})},
      footers:{default:new D.Footer({children:[
        new D.Paragraph({alignment:D.AlignmentType.CENTER,border:{top:{style:D.BorderStyle.SINGLE,size:6,color:ORANGE,space:4}},children:[run(DCB.legalName+", "+DCB.shortAddress+"  ·  "+DCB.mobile,{color:ORANGE,size:13,bold:true})]}),
        new D.Paragraph({spacing:{before:30},border:{bottom:{style:D.BorderStyle.SINGLE,size:16,color:GREEN,space:1}},children:[run("",{size:2})]})
      ]})}, children }]
  });
  const fname=(opts.title||"Report").replace(/[\\\/:*?"<>|]+/g,"").replace(/\s+/g,"_")+"_"+new Date().toISOString().slice(0,10);
  D.Packer.toBlob(doc).then(blob=>{ window.OPS.saveBlob(blob, fname+".docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document",".docx"); })
    .catch(e=>alert("Report error: "+e));
}

window.OPS.docgen = { generateWord, generateReport, downloadJson, amountInWords, computeTotals, DCB, fileBase };
})();
