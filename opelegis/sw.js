/* OpeLegis no iPad — guarda o próprio app para abrir sem internet.
   Os dados (leis e anotações) ficam no IndexedDB, não aqui. */
var VERSAO = "opelegis-b0420eecc4";
var ARQS = ["./", "catalogo.js", "dock.css", "dock.js", "icon-180.png", "icon-192.png", "icon-512.png", "index.html", "ipad.css", "ipad.js", "lc-shared.js", "manifest.webmanifest", "notavoz.css", "notavoz.js", "shim.js", "tags.css", "tags.js", "vademecum.css", "vademecum.js", "vm-anno.js"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSAO).then(function (c) { return c.addAll(ARQS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSAO; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  /* app: rede primeiro (pega atualizações), cache se estiver sem internet */
  e.respondWith(fetch(e.request).then(function (r) {
    if (r && r.ok) { var cp = r.clone(); caches.open(VERSAO).then(function (c) { c.put(e.request, cp); }); }
    return r;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match("./"); });
  }));
});
