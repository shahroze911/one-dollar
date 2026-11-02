/* Service worker: lets the till open and sell with no internet.
 * - app files (/_next/static, icons): cached the first time, then served from the device
 * - pages: network first; if the network is down (or slow) the last saved copy is used
 * - everything else (Supabase, API calls, other sites) is never touched
 */
const VERSION = "v1";
const PAGES = `pos-pages-${VERSION}`;
const STATIC = `pos-static-${VERSION}`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== PAGES && k !== STATIC) await caches.delete(k);
      await self.clients.claim();
    })()
  );
});

const FALLBACK = new Response(
  "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Offline</title>" +
    "<body style='font-family:system-ui;padding:2rem;text-align:center'><h2>No internet</h2>" +
    "<p>This page was not saved on this device yet. Open the till once while online, then it will work offline.</p>" +
    "<p><a href='/pos'>Try Checkout</a></p></body>",
  { headers: { "Content-Type": "text/html; charset=utf-8" } }
);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never cache Supabase or other sites
  if (url.searchParams.has("hb")) return; // the online/offline heartbeat must hit the network

  // hashed build files and icons never change for a given URL
  if (url.pathname.startsWith("/_next/static/") || /\.(png|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGES);
        const key = url.pathname;
        try {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 5000); // Wi-Fi with no internet hangs; don't wait forever
          const res = await fetch(req, { signal: ctl.signal });
          clearTimeout(timer);
          const isHtml = (res.headers.get("content-type") || "").includes("text/html");
          const toLogin = res.redirected && new URL(res.url).pathname.startsWith("/login");
          if (res.ok && isHtml && !toLogin && !key.startsWith("/login")) cache.put(key, res.clone());
          return res;
        } catch {
          return (await cache.match(key)) || (await cache.match("/pos")) || FALLBACK;
        }
      })()
    );
  }
});
