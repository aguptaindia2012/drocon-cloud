/* DroCon Bharat Agreement Studio — Cloud service worker.
   Caches the app shell so it installs and launches like an app.
   IMPORTANT: never caches your Supabase API responses (those stay live). */
const VERSION = "dcb-cloud-v72";
const SHELL = [
  "./", "./index.html", "./studio.html", "./manifest.webmanifest",
  "./app.js", "./logo.js", "./docgen.js", "./modules/report.js", "./agreement.js", "./config.js",
  "./modules/geo.js", "./modules/_shared.js", "./modules/access.js", "./modules/approvals.js", "./modules/clients.js", "./modules/vendors.js",
  "./modules/catalogues.js", "./modules/inventory.js", "./modules/bom.js",
  "./modules/billing.js", "./modules/acre_billing.js", "./modules/receivables.js", "./modules/payments.js",
  "./modules/farmer.js", "./modules/acre.js", "./modules/daily.js", "./modules/locations.js", "./modules/entries.js",
  "./modules/orders.js", "./modules/pilots.js", "./modules/pilots_master.js", "./modules/vendor_report.js", "./modules/farmer_bulk.js", "./modules/dashboards.js", "./modules/resources.js",
  "./modules/hr.js", "./modules/portal.js", "./modules/manual.js",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/icon-maskable-512.png", "./icons/apple-touch-icon-180.png"
];
// static CDN libraries are safe to cache; the live DB host is NOT.
const CACHE_HOSTS = ["cdn.jsdelivr.net","cdnjs.cloudflare.com","fonts.googleapis.com","fonts.gstatic.com"];

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL).catch(()=>{})).then(()=>self.skipWaiting()));
});
self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch", e=>{
  const req=e.request; if(req.method!=="GET") return;
  const url=new URL(req.url);

  // never intercept Supabase (auth/data/storage) — always go to network
  if(url.hostname.endsWith("supabase.co")) return;

  // app navigations (incl. the Studio iframe): network-first, fall back to the right cached shell
  if(req.mode==="navigate"){
    e.respondWith((async()=>{
      try{ return await fetch(req); }
      catch(_){
        const isStudio = new URL(req.url).pathname.indexOf("studio.html")>=0;
        return (await caches.match(isStudio?"./studio.html":"./index.html")) || Response.error();
      }
    })());
    return;
  }
  // CDN libs/fonts: cache-first
  if(CACHE_HOSTS.includes(url.hostname)){
    e.respondWith(caches.open(VERSION).then(async c=>{ const hit=await c.match(req);
      const net=fetch(req).then(r=>{ if(r&&(r.ok||r.type==="opaque")) c.put(req,r.clone()); return r; }).catch(()=>hit);
      return hit||net; })); return;
  }
  // App CODE (js/css/html): NETWORK-FIRST so a new deploy applies on the very
  // first reload. Falls back to cache when offline, so the PWA still launches.
  // (Cache-first here was why updates seemed to "not change anything" until a
  // second hard reload.)
  if(url.origin===self.location.origin && /\.(js|css|html)$/i.test(url.pathname)){
    e.respondWith((async()=>{
      try{
        const r = await fetch(req);
        if(r && r.ok){ const cp=r.clone(); caches.open(VERSION).then(c=>c.put(req,cp)); }
        return r;
      }catch(_){
        return (await caches.match(req)) || new Response("Offline", {status:503, statusText:"Offline"});
      }
    })());
    return;
  }
  // other same-origin assets (icons, images, manifest): cache-first
  if(url.origin===self.location.origin){
    e.respondWith((async()=>{
      const cached = await caches.match(req);
      if(cached) return cached;
      try{
        const r = await fetch(req);
        if(r && r.ok){ const cp=r.clone(); caches.open(VERSION).then(c=>c.put(req,cp)); }
        return r;
      }catch(_){
        return cached || new Response("Offline", {status:503, statusText:"Offline"});
      }
    })());
  }
});
