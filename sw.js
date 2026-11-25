/*
 * sw.js — Service worker de Canasta Llena de Pokemones.
 * Precarga TODO lo local (canasta-v2) y sirve cache-first: tras la
 * primera carga, la app no necesita red para nada.
 */
var CACHE = 'canasta-v2';
var RECURSOS = [
 "./",
 "index.html",
 "estilo.css",
 "canasta.js",
 "juego.js",
 "datos-cartas.json",
 "manifest.webmanifest",
 "assets/banner.jpg",
 "assets/icon-192.png",
 "assets/icon-512.png",
 "assets/icon-maskable.png",
 "assets/cartas/10C.png",
 "assets/cartas/10D.png",
 "assets/cartas/10H.png",
 "assets/cartas/10S.png",
 "assets/cartas/2C.png",
 "assets/cartas/2D.png",
 "assets/cartas/2H.png",
 "assets/cartas/2S.png",
 "assets/cartas/3C.png",
 "assets/cartas/3D.png",
 "assets/cartas/3H.png",
 "assets/cartas/3S.png",
 "assets/cartas/4C.png",
 "assets/cartas/4D.png",
 "assets/cartas/4H.png",
 "assets/cartas/4S.png",
 "assets/cartas/5C.png",
 "assets/cartas/5D.png",
 "assets/cartas/5H.png",
 "assets/cartas/5S.png",
 "assets/cartas/6C.png",
 "assets/cartas/6D.png",
 "assets/cartas/6H.png",
 "assets/cartas/6S.png",
 "assets/cartas/7C.png",
 "assets/cartas/7D.png",
 "assets/cartas/7H.png",
 "assets/cartas/7S.png",
 "assets/cartas/8C.png",
 "assets/cartas/8D.png",
 "assets/cartas/8H.png",
 "assets/cartas/8S.png",
 "assets/cartas/9C.png",
 "assets/cartas/9D.png",
 "assets/cartas/9H.png",
 "assets/cartas/9S.png",
 "assets/cartas/AC.png",
 "assets/cartas/AD.png",
 "assets/cartas/AH.png",
 "assets/cartas/AS.png",
 "assets/cartas/JC.png",
 "assets/cartas/JD.png",
 "assets/cartas/JH.png",
 "assets/cartas/JOKER.png",
 "assets/cartas/JS.png",
 "assets/cartas/KC.png",
 "assets/cartas/KD.png",
 "assets/cartas/KH.png",
 "assets/cartas/KS.png",
 "assets/cartas/QC.png",
 "assets/cartas/QD.png",
 "assets/cartas/QH.png",
 "assets/cartas/QS.png"
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(RECURSOS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (claves) {
      return Promise.all(claves.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(function (r) {
      return r || fetch(e.request);
    })
  );
});
