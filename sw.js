/* Binder MTG – service worker: keeps the app shell available offline.
   API calls (Scryfall, Anthropic) always go to the network. */
const CACHE = "binder-mtg-v1";
const SHELL = ["./", "index.html", "css/style.css", "js/util.js", "js/scryfall.js", "js/names.js", "js/collection.js", "js/catalog.js", "js/scanner.js", "js/deckengine.js", "js/claude.js", "js/app.js", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // network first, cache fallback – updates arrive immediately when online
  e.respondWith(fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; }).catch(() => caches.match(e.request)));
});
