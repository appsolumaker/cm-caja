// Caja · ControlMaster — service worker
// Guarda la página en el equipo para que abra sin internet.
// Con internet trae la versión nueva (y la guarda); sin internet usa la guardada.
// Las llamadas al sistema (/caja/api, POST) no pasan por aquí.
const CACHE = "cm-caja-web-v19";
const BASE = new URL("./", self.location).pathname;   // /caja/
const ARCHIVOS = ["./", "./index.html", "./estilos.css", "./app.js", "./api.js", "./sesion.js", "./numeros.js", "./ordenes.js", "./cajero.js", "./gaveta.js", "./tanda2.js", "./zxing.min.js"];   // 3.9: zxing.min.js = el lector de códigos para iPhone (también sin internet)

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.indexOf("cm-caja-web-") === 0 && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin || u.pathname.indexOf(BASE) !== 0 || u.pathname === BASE + "api") return;
  if (u.searchParams.has("chk")) return;   // la revisión de versión va directo a la red y no se guarda
  e.respondWith(primeroRed(r));
});

// La llave de la caché, sin "?v=…" (así no se acumulan copias de cada versión)
function llave(r) { const u = new URL(r.url); u.search = ""; return u.href; }

function primeroRed(r) {
  return new Promise(resolve => {
    let listo = false;
    const desdeCache = () => caches.match(llave(r))
      .then(c => c || (r.mode === "navigate" ? caches.match(new URL("./index.html", self.location).href) : null))
      .then(c => c || (r.mode === "navigate" ? caches.match(new URL("./", self.location).href) : null));
    // Sin respuesta en 4 s (internet malo): se usa la guardada y la nueva se guarda cuando llegue
    const t = setTimeout(() => { desdeCache().then(c => { if (c && !listo) { listo = true; resolve(c); } }); }, 4000);
    fetch(r.url, { cache: "no-cache", credentials: "same-origin" }).then(res => {   // no-cache: siempre pregunta a GitHub si hay versión nueva
      if (res && res.ok && res.type === "basic") {
        const copia = res.clone();
        caches.open(CACHE).then(c => c.put(llave(r), copia));
      }
      if (!listo) { listo = true; clearTimeout(t); resolve(res); }
    }).catch(() => {
      clearTimeout(t);
      desdeCache().then(c => { if (!listo) { listo = true; resolve(c || new Response("Sin internet y la página no está guardada en este equipo.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })); } });
    });
  });
}
