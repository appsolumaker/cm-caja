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
// ══════════════════════════════════════════════════════════════

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
  const dev = N.porDevolver.length ? " · " + N.porDevolver.length + " por devolver" : "";
  if (!N.lista.length) return (S.turno ? "⚠️ ninguno apartado: los tickets salen provisionales" : "ninguno (se apartan al abrir el turno)") + dev;
  return N.lista.length + " apartado" + (N.lista.length === 1 ? "" : "s") + ": #" + N.lista[0] + (N.lista.length > 1 ? " al #" + N.lista[N.lista.length - 1] : "") + dev;
}

// Con internet: devuelve lo viejo (o todo, sin turno) y pide lo que falta. La llama sincronizar() cada minuto,
// después de cada venta, al abrir y al cerrar el turno.
let _numOcupado = false;
async function numerosAlDia(){
  if (!S.eq || !S.datos || _numOcupado || S.permisoMal || S.online === false || navigator.onLine === false) return;
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
