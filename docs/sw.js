// Service Worker: hält die App offline verfügbar. Nur eigene Dateien werden
// zwischengespeichert, nie Antworten von Microsoft (Token, OneDrive-Inhalte).
// Neue Fassung: STAND hochzählen. Dann lädt der Browser alle Dateien in einen
// neuen Cache und wirft den alten weg; es gibt keine gemischten Stände.
const STAND = "hanna-0.4.0";
const DATEIEN = ["./", "index.html", "style.css", "app.js", "format.js", "speicher.js", "anmeldung.js",
  "abgleich.js", "konfig.js", "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(STAND)
    .then((c) => c.addAll(DATEIEN.map((d) => new Request(d, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== STAND).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.includes("/graph/")) return;
  // Nur aus dem Cache dieses Stands; die Rückkehr von der Anmeldung (?code=…)
  // bekommt index.html, den Code liest die App aus der Adresse.
  e.respondWith((async () => {
    const c = await caches.open(STAND);
    const treffer = await c.match(e.request, { ignoreSearch: true })
      || (e.request.mode === "navigate" ? await c.match("index.html") : null);
    if (treffer) return treffer;
    try { return await fetch(e.request); } catch { return Response.error(); }
  })());
});
