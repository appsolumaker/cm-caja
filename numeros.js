"use strict";
// ══════════════════════════════════════════════════════════════
//  NÚMEROS DE FACTURA APARTADOS
//  El sistema le aparta a este equipo unos números (Configuración: 10 por caja) para imprimir cada ticket
//  con su número de una vez, con o sin internet, sin chocar con otra caja.
//   · Con el turno abierto y la mitad o menos: pide hasta completar (con internet).
//   · Los que llevan más de X minutos sin usarse (Configuración: 30) se devuelven: otra caja (o Ventas)
//     los usa primero y así no quedan huecos.
//   · Al cerrar el turno se devuelven todos.
//   · Un número que se va a devolver sale de la lista ANTES de llamar al sistema (porDevolver): ninguna
//     venta lo usa aunque la llamada se corte. Se insiste hasta que el sistema lo confirme.
//   · Sin números (sin internet y se acabaron): el ticket sale PROVISIONAL y el sistema le da el número al subirla.
//  kv "numeros" = { lista: [n…], desde: { n: ms }, porDevolver: [n…], usados: [n…] }
//
//  5.0 (14-11-2026) · EL NÚMERO SE PIDE AL REGISTRAR
//  Con el sistema nuevo (sus datos dicen cajaWeb.numeros = "pedir") no se apartan números: al tocar Registrar la caja le
//  pide al sistema el número de ESA venta (cj_numero) y espera hasta 7 segundos con una barra. Si no llega, la venta se
//  queda en pantalla y se reintenta con el MISMO código de venta (el sistema devuelve el mismo número: no se gasta otro).
//  No se vende sin número. Los números que el equipo tuviera apartados de antes se OLVIDAN (no se devuelven, para que
//  el sistema no los vuelva a dar): NUMEROS_aplicar del contenedor los anota como NO USADOS.
//  Con un sistema viejo (sin "pedir") todo sigue como antes, con los números apartados.
// ══════════════════════════════════════════════════════════════
const NUM_ESPERA_MS = 7000;
function numPedir(){ return !!(S.datos && S.datos.cajaWeb && S.datos.cajaWeb.numeros === "pedir"); }

function numNormal(o){
  o = o || {};
  const nums = a => (Array.isArray(a) ? a : []).map(Number).filter(n => n > 0);
  return { lista: nums(o.lista).sort((a, b) => a - b), desde: Object.assign({}, o.desde || {}),
           porDevolver: nums(o.porDevolver), usados: nums(o.usados).slice(-300) };
}
// Dentro de la transacción de guardarVentaNueva (app.js): toma el más bajo. 0 = no hay (ticket provisional).
function numTomar(N){
  if (!N.lista.length) return 0;
  const n = N.lista.shift();
  delete N.desde[n];
  N.usados.push(n);
  if (N.usados.length > 300) N.usados = N.usados.slice(-300);
  return n;
}
// Cambio de kv "numeros" en una transacción (lee lo último guardado: una venta pudo tomar uno mientras tanto)
function numCambiar(fn){
  return new Promise((ok, ko) => {
    const t = _db.transaction("kv", "readwrite"), kv = t.objectStore("kv");
    let N = null;
    const g = kv.get("numeros");
    g.onsuccess = () => { N = numNormal(g.result); fn(N); kv.put(N, "numeros"); };
    t.oncomplete = () => { S.num = N; ok(N); };
    t.onerror = () => ko(t.error);
    t.onabort = () => ko(t.error || new Error("No se pudieron guardar los números de factura."));
  });
}
function numerosTexto(){
  const N = S.num || numNormal(null);
  if (numPedir()) return "el sistema le da el número a cada venta al registrarla";
  const dev = N.porDevolver.length ? " · " + N.porDevolver.length + " por devolver" : "";
  if (!N.lista.length) return (S.turno ? "⚠️ ninguno apartado: los tickets salen provisionales" : "ninguno (se apartan al abrir el turno)") + dev;
  return N.lista.length + " apartado" + (N.lista.length === 1 ? "" : "s") + ": #" + N.lista[0] + (N.lista.length > 1 ? " al #" + N.lista[N.lista.length - 1] : "") + dev;
}

// Con internet: devuelve lo viejo (o todo, sin turno) y pide lo que falta. La llama sincronizar() cada minuto,
// después de cada venta, al abrir y al cerrar el turno.
let _numOcupado = false;
async function numerosAlDia(){
  if (!S.eq || !S.datos || _numOcupado || S.permisoMal) return;
  // 5.0: con el sistema nuevo no se apartan ni se devuelven números. Si el equipo tenía apartados de antes, los OLVIDA (no se
  // devuelven: así el sistema nunca vuelve a dar un número viejo). En el sistema quedan como apartados hasta que el dueño
  // corre NUMEROS_aplicar, que los anota como NO USADOS con su motivo.
  if (numPedir()) {
    const N = S.num || numNormal(null);
    if (N.lista.length || N.porDevolver.length) { _numOcupado = true; try { await numCambiar(x => { x.lista = []; x.desde = {}; x.porDevolver = []; }); } catch (e) {} finally { _numOcupado = false; } pintarNumFactura(); }
    return;
  }
  if (S.online === false || navigator.onLine === false) return;
  const cw = S.datos.cajaWeb || {}, cuantos = Number(cw.apartar) || 10, minutos = Number(cw.minutos) || 30;
  const N0 = S.num || numNormal(null), ahora = Date.now();
  const viejos = !S.turno ? N0.lista.slice() : N0.lista.filter(n => ahora - (Number(N0.desde[n]) || 0) > minutos * 60000);
  const quedan = N0.lista.length - viejos.length;
  const pedir = (S.turno && quedan <= Math.floor(cuantos / 2)) ? cuantos - quedan : 0;
  if (!viejos.length && !N0.porDevolver.length && !pedir) return;
  _numOcupado = true;
  try {
    let N = N0;
    if (viejos.length) N = await numCambiar(x => {
      x.lista = x.lista.filter(n => viejos.indexOf(n) < 0);
      viejos.forEach(n => { delete x.desde[n]; if (x.porDevolver.indexOf(n) < 0) x.porDevolver.push(n); });
    });
    const devolver = N.porDevolver.slice();
    let r;
    try { r = await api("cj_numeros", { pedir: pedir, devolver: devolver }, 45000); } catch (e) { return; }
    if (!r || !r.ok) { if (r) revisarErrorSistema(r); return; }
    await numCambiar(x => {
      x.porDevolver = x.porDevolver.filter(n => devolver.indexOf(n) < 0);
      const fuera = new Set(x.usados.concat(x.porDevolver));
      const lista = (r.lista || []).map(Number).filter(n => n > 0 && !fuera.has(n)).sort((a, b) => a - b);
      const t = Date.now();
      lista.forEach(n => { if (!x.desde[n]) x.desde[n] = t; });
      Object.keys(x.desde).forEach(k => { if (lista.indexOf(Number(k)) < 0) delete x.desde[k]; });
      x.lista = lista;
    });
    if (r.apartar && S.datos.cajaWeb) { S.datos.cajaWeb.apartar = r.apartar; S.datos.cajaWeb.minutos = r.minutos; }
    pintarBanners();
    if (S.vista === "ajustes") pintarAjustes();
  } catch (e) {
    // la base de datos del equipo falló: se intenta en la próxima vuelta
  } finally { _numOcupado = false; }
}


// ══ 5.0: la barra mientras se pide el número ══
// { texto(t), cerrar() } · un mini modal sin botones (no se puede cerrar a medias: la venta está esperando su número)
function barraProgreso(txt){
  const f = document.createElement("div");
  f.className = "mfondo";
  f.innerHTML = '<div class="modal centrado barra-num"><div class="mb"><div class="bn-txt"></div><div class="bn-barra"><i></i></div></div></div>';
  document.body.appendChild(f);
  const t = f.querySelector(".bn-txt");
  t.textContent = txt;
  return { texto: x => { t.textContent = x; }, cerrar: () => f.remove() };
}

// Pide el número de la venta v (con su código: al reintentar el sistema devuelve el mismo).
// → { numero, barra } (la barra queda abierta: la cierra quien llama) · si no llega, lanza el error (la barra ya se cerró)
// 5.0h: la barra dice solo «Registrando la venta…» de principio a fin.
async function pedirNumeroVenta(v){
  const b = barraProgreso("Registrando la venta…");
  try {
    const r = await api("cj_numero", { ventaId: v.id, turno: v.turno || "", cajero: (v.pago && v.pago.cajeroNombre) || "", invitado: !!(S.turno && S.turno.invitado) }, NUM_ESPERA_MS);
    if (r && r.codigo === "TURNO_OTRO") { S.turnoOtro = r.msg || "Tu turno siguió en otro equipo."; try { pintarBanners(); } catch (e) {} }   // 5.0i: este equipo ya no vende
    if (r && r.codigo === "TURNO_CERRADO") { S.turnoOtro = r.msg || "Este turno ya se cerró en otro equipo."; try { pintarBanners(); } catch (e) {} }   // 5.0l: lo cerró el administrador
    if (r && r.ok && Number(r.numero) > 0) { return { numero: Number(r.numero), barra: b }; }
    if (r) revisarErrorSistema(r);
    throw new Error((r && r.msg) || "El sistema no dio el número de la factura.");
  } catch (e) { b.cerrar(); throw e; }
}
