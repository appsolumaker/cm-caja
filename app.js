"use strict";
// ══════════════════════════════════════════════════════════════
//  CAJA · ControlMaster — Etapa 0 (3-11-2026) · https://<cliente>.micontrolmaster.com/caja
//  Vende SIEMPRE como sin internet: la venta se guarda en este equipo, el ticket sale de una vez con un
//  número de factura apartado (numeros.js) y la venta sube sola al sistema en segundo plano
//  (cj_subir → la misma subida de la caja sin internet: una sola vez, con lo que se cobró).
//  Archivos: app.js (la caja) · api.js (habla con el sistema) · sesion.js (entrar, equipo, pase)
//            numeros.js (números apartados) · estilos.css · sw.js (abre sin internet)
//  Etapa 1A: tasaBin encendido (venta en Bs a BCV y Venta en Dólares), igual que Ventas.
//  Etapa 1B (2.2): la pantalla de Vender se ve como Ventas (lista, factura en tabla con TIPO por línea, precio
//  manual en la línea, Ajustes con el descuento, teléfono en 2 pestañas), la tasa se puede ocultar, y los
//  clientes se buscan y se crean desde la caja (sin internet quedan en el equipo y se crean al subir la venta).
//  Etapa 1C (2.3): con internet la clave es la de Ventas (precio manual, B8) revisada en el sistema; sin internet,
//  la clave sin internet. Existencias al día entre cajas (cada 2 min, solo si cambiaron; con Depósito, la tienda).
//  Línea en rojo y avisos cuando no alcanza la existencia (se puede vender igual).
//  Etapa 1D (2.4): entrada directa. Un equipo activado no pide usuario y clave: entra solo a la caja (sesión solo de
//  esa caja, del último usuario que entró en el equipo) y los cajeros solo eligen su nombre y ponen su PIN.
//  Etapa 4A (2.7): siempre hay un cajero (cajero.js): teclado grande con su PIN, la caja se bloquea al abrirla,
//  a los 10 minutos sin tocarla y con 🔒; para que entre otro, se cierra el turno (o lo cierra un administrador).
//  Tanda 1 (3.1): como Ventas — 🛍️ Cashea en el pago, 🎁 pagar con saldo a favor (con internet) y 📅 venta de otro
//  día (con su fecha y las tasas de ese día; su efectivo no cuenta en el cierre de hoy).
//  Tanda 1b (3.2): fondo encadenado (al cerrar se anota lo que queda en la gaveta; al abrir se cuenta sin verlo y se
//  compara), cierre en 5 pasos que no deja cerrar descuadrado sin motivo y explicación, 🔒 Cerrar turno arriba,
//  Cashea en amarillo y en Bs a la BCV, y la ventana de imprimir grande.
//  Tanda 1c (3.3): el turno NO se cierra si el efectivo no cuadra. Lo que falta o sobra se registra con el PIN del
//  Administrador (gaveta.js: gasto pagado con la gaveta, faltante o sobrante de caja) y los centavos solos (redondeo);
//  💸 Sacar efectivo durante el turno; el paso 4 dice claro lo que queda y lo que sale; Escape cierra el pago.
//  3.4: al ABRIR también tiene que cuadrar: si lo contado no es lo que dejó el turno anterior, se registra lo que pasó
//  (gasto, faltante o sobrante, con la contraseña de un administrador; los centavos solos) y el turno arranca con lo que dejó.
//  3.5: el PAGO EN PASOS — ① ¿incluye crédito? (no · sí, todo o una parte · Cashea) ② ¿cómo paga? (Bs · $ · mixto, y por
//  dónde) ③ ¿cuánto? (en efectivo: ¿con cuánto te pagó? y el vuelto) [el delivery] ④ revisar y registrar. Mismas cuentas.
//  3.6: ① ¿Cómo pagará el cliente? (De contado · Con crédito, total o parcial · Con Cashea) ② Bolívares · Dólares · Pago
//  mixto ③ el método (solo de esa moneda) ④ el monto («¿Con cuánto te pagó?» ya trae el total) ⑤ el vuelto, si sobra.
// ══════════════════════════════════════════════════════════════
const APP_VER = "4.4 · 9-11-2026";
const DB_NOMBRE = "cm_caja_web";
const TOL = 0.011;   // un centavo, como el servidor (> 0,01)

const $ = id => document.getElementById(id);
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
const r3 = v => Math.round((Number(v) || 0) * 1000) / 1000;
function fmt(v){ const n = Number(v); if (isNaN(n)) return "0,00"; try { return n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch (e) { return n.toFixed(2); } }
function fmtCant(v){ const n = Number(v); if (isNaN(n)) return "0"; if (n % 1 === 0) return String(Math.round(n)); return n.toLocaleString("es-VE", { minimumFractionDigits: 1, maximumFractionDigits: 3 }); }
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
function hoyTxt(d){ d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function ahoraTxt(d){ d = d || new Date(); return hoyTxt(d) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); }
function fechaCorta(f){ const p = String(f || "").slice(0, 10).split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : String(f || ""); }
function horaDe(txt){ return String(txt || "").slice(11, 16); }
function norm(s){ return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim(); }
function uuid(){
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
}

// ── Estado ──
const S = {
  eq: null,          // { token, equipo, caja, nombre, activado } — la llave de este equipo (sesion.js)
  ses: null,         // { token, usuario: { usuario, nombre, rol, modulos }, desde } — quién está usando la caja
  num: null,         // { lista, desde, porDevolver, usados, prov } — números de factura apartados (numeros.js)
  datos: null,       // lo que mandó el sistema (cj_datos) + descargadoEn
  tasas: null,       // { bcv, div, fecha, origen: "sistema" | "manual" }
  ventas: [],        // todas las ventas de este equipo
  movs: [],          // 3.3 (gaveta.js): gastos, faltantes, sobrantes y redondeos de la gaveta
  pref: { dosCopias: false, claro: true, tamTicket: "auto" },   // tema claro por defecto
  turno: null,       // { id, cajeroId, cajeroNombre, apertura, fondoBs, fondoUsd } — el turno abierto
  cierres: [],       // cierres de turno de este equipo (se suben al sistema: hoja CierresCaja)
  online: null,      // true / false / null (no se sabe)
  sincronizando: false,
  permisoMal: "",    // texto si el sistema dijo que este equipo no tiene permiso
  datosMal: "",      // texto si el sistema no pudo dar los datos
  tasaOkHoy: "",     // fecha en que el cajero confirmó la tasa vieja
  filtro: "hoy",
  vista: "vender"
};
const F = nuevaFactura();   // la venta que se está armando
function nuevaFactura(){ return { items: [], cliente: { cedula: "", nombre: "Genérico", direccion: "", telefono: "" }, tipoPrecio: 0, dolares: false, desc: { tipo: "ninguno", valor: 0 }, vend: "", claveOk: false, claveCon: "", seq: 0, avisoEx: {}, orden: null, dlv: { tipo: "delivery", monto: 0 }, fechaAnt: null }; }   // fechaAnt: { fecha, bcv, div } venta de otro día (Tanda 1)   // dolares: Venta en Dólares (TasaBin), se apaga en cada venta como en Ventas
let P = null;              // el pago abierto
let _ventaGuardada = null; // la que se acaba de guardar (para imprimir)

// ══ BASE DE DATOS DEL EQUIPO (IndexedDB) ══
let _db = null;
function dbAbrir(){
  return new Promise((ok, ko) => {
    const q = indexedDB.open(DB_NOMBRE, 1);
    q.onupgradeneeded = () => {
      const db = q.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("ventas")) db.createObjectStore("ventas", { keyPath: "id" });
    };
    q.onsuccess = () => { _db = q.result; ok(_db); };
    q.onerror = () => ko(q.error);
  });
}
function dbOp(store, modo, fn){
  return new Promise((ok, ko) => {
    let t, req;
    try { t = _db.transaction(store, modo); req = fn(t.objectStore(store)); }
    catch (e) { ko(e); return; }
    t.oncomplete = () => ok(req ? req.result : undefined);
    t.onerror = () => ko(t.error);
    t.onabort = () => ko(t.error || new Error("La base de datos del equipo canceló la operación."));
  });
}
const kvGet = k => dbOp("kv", "readonly", s => s.get(k));
const kvSet = (k, v) => dbOp("kv", "readwrite", s => s.put(v, k));
const ventaPut = v => dbOp("ventas", "readwrite", s => s.put(v));
const ventasTodas = () => dbOp("ventas", "readonly", s => s.getAll());
// El código interno, el número de factura (el apartado más bajo, numeros.js) y la venta, en UNA operación:
// si algo falla no queda ninguno. Sin números apartados el ticket sale PROVISIONAL (el sistema le da el número al subir).
function guardarVentaNueva(v){
  return new Promise((ok, ko) => {
    const t = _db.transaction(["kv", "ventas"], "readwrite");
    const kv = t.objectStore("kv"), vs = t.objectStore("ventas");
    const gn = kv.get("numeros"), g = kv.get("seq");   // en este orden: primero el número, después se guarda la venta
    let numeros = null;
    gn.onsuccess = () => {
      numeros = numNormal(gn.result);
      const n = numTomar(numeros);
      v.numeroTicket = n || 0; v.provisional = !n;
      kv.put(numeros, "numeros");
    };
    g.onsuccess = () => {
      const n = (Number(g.result) || 0) + 1;
      kv.put(n, "seq");
      v.numero = "C" + (S.datos.caja || 1) + "-" + (S.datos.equipo || "XXXX") + "-" + String(n).padStart(4, "0");
      vs.put(v);
    };
    t.oncomplete = () => { if (numeros) S.num = numeros; ok(v); };
    t.onerror = () => ko(t.error);
    t.onabort = () => ko(t.error || new Error("La venta no se pudo guardar en el equipo."));
  });
}

// ══ HABLAR CON EL SISTEMA ══
function ErrRed(msg){ const e = new Error(msg); e.red = true; return e; }
function marcarOnline(v){ if (S.online !== v) { S.online = v; pintarEstado(); } }

// Errores que no son de una venta: el equipo (dado de baja), la caja apagada y tasaBin.
// La sesión vencida (SESION) y el usuario sin permiso (USUARIO) los atiende sesion.js.
function revisarErrorSistema(r){
  if (r && r.codigo === "EQUIPO") { S.permisoMal = r.msg || "Este equipo no tiene permiso."; if (r.reemplazado) S.reemplazado = true; pintarBanners(); return true; }   // 4.1: otro equipo lo reemplazó
  if (r && (r.codigo === "TASABIN_ON" || r.codigo === "APAGADA")) { S.datosMal = r.msg; pintarBanners(); return true; }
  return false;
}

// ══ ARRANQUE ══
window.addEventListener("load", arrancar);
window.addEventListener("hashchange", () => { if (/[#&]pase=/.test(location.hash)) location.reload(); });   // un pase nuevo con la caja ya abierta
async function arrancar(){
  try { window.name = "cm_caja"; } catch (e) {}   // el sistema la encuentra por este nombre y no abre otra
  $("verApp").textContent = "Caja · versión " + APP_VER;
  document.body.classList.add("entrando");
  // 2.7.1: la página (index.html) y sus archivos tienen que ser de la misma versión. Justo después de subir
  // a GitHub, el navegador puede traer uno viejo un rato: se recarga una vez y, si sigue mal, lo dice.
  const verPag = (document.querySelector('meta[name="cm-ver"]') || {}).content || "", faltaJs = typeof bloquear !== "function" || typeof efectivoAlDia !== "function" || typeof gvGasto !== "function";
  if (verPag !== APP_VER.split(" ")[0] || faltaJs) {
    let ya = ""; try { ya = sessionStorage.getItem("cm_recargo") || ""; } catch (e) {}
    if (!ya) { try { sessionStorage.setItem("cm_recargo", "1"); } catch (e) {} location.reload(); return; }
    pantalla({ ico: "⏳", tit: "Caja", html: "<p>La caja se está actualizando y el navegador trajo archivos de versiones distintas" + (faltaJs ? " (falta <b>cajero.js</b> o <b>gaveta.js</b>)" : "") + ". Espera un par de minutos y toca <b>Reintentar</b>.</p>" +
      '<p style="font-size:12px;color:var(--text-dim);">Página ' + esc(verPag || "anterior a la 2.7.1") + " · archivos " + esc(APP_VER) + "</p>",
      btns: '<button type="button" class="btn green" onclick="location.reload()">🔄 Reintentar</button>' });
    return;
  }
  try { sessionStorage.removeItem("cm_recargo"); } catch (e) {}
  let robar = false; try { robar = sessionStorage.getItem("cm_robar") === "1"; sessionStorage.removeItem("cm_robar"); } catch (e) {}
  if (!await candadoPestana(robar)) { pantallaOtraPestana(); return; }   // S2: una sola pestaña de la caja por equipo
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  try { await dbAbrir(); }
  catch (e) { pantalla({ ico: "⛔", tit: "Caja", html: "<p>Este navegador no deja guardar datos (¿ventana de incógnito?). La caja necesita guardar las ventas en el equipo: ábrela en una ventana normal.</p>" }); return; }
  S.eq = await kvGet("equipo") || null;
  if (S.eq && !S.eq.token) S.eq = null;   // nunca debería pasar
  S.ses = await kvGet("sesion") || null;
  S.num = numNormal(await kvGet("numeros"));
  S.datos = await kvGet("datos") || null;
  S.tasas = await kvGet("tasas") || null;
  S.pref = Object.assign(S.pref, await kvGet("pref") || {});
  S.turno = await kvGet("turno") || null;
  S.cierres = await kvGet("cierres") || [];
  S.movs = await kvGet("movs") || [];             // 3.3 (gaveta.js): lo registrado de la gaveta
  S.ultFondo = await kvGet("ultFondo") || null;   // Tanda 1b: lo que dejó en la gaveta el último cierre de este equipo
  S.clientesNuevos = await kvGet("clientesNuevos") || [];
  S.esperas = await kvGet("esperas") || [];       // Etapa 2: facturas en espera guardadas en este equipo (ordenes.js)
  S.ordSoltar = await kvGet("ordSoltar") || [];   // Etapa 2: órdenes soltadas sin internet (se liberan al volver)   // creados sin internet: se crean en el sistema al subir su venta
  S.ventas = (await ventasTodas()) || [];
  aplicarTema();
  await entrarConPase();     // sesion.js: si vino del sistema con un pase, ya entra con ese usuario
  continuarArranque();       // sesion.js: equipo → usuario → datos → vender
}
// ══ S2 (7-11-2026): UNA sola pestaña de la caja en este equipo ══
// Con dos pestañas abiertas las dos venderían con el mismo turno y los mismos números, y cada una contaría
// distinto. La primera se queda con el candado del navegador (Web Locks) mientras esté abierta; la segunda
// lo dice y no arranca. «Usar esta pestaña» se lo quita a la otra, que se recarga y queda avisando.
function candadoPestana(robar){
  if (!navigator.locks || !navigator.locks.request) return Promise.resolve(true);   // navegador viejo: como antes
  return new Promise(res => {
    navigator.locks.request("cm-caja-pestana", robar ? { steal: true } : { ifAvailable: true }, lock => {
      if (!lock) { res(false); return; }
      res(true);
      return new Promise(() => {});   // se queda con el candado mientras la pestaña esté abierta
    }).catch(() => { location.reload(); });   // otra pestaña tocó «Usar esta pestaña»: esta se recarga y queda avisando
  });
}
function pantallaOtraPestana(){
  pantalla({ ico: "🗂️", tit: "La caja ya está abierta", html: "<p>La caja ya está abierta en <b>otra pestaña</b> (o ventana) de este equipo. Sigue vendiendo en esa.</p>" +
    '<p style="font-size:13px;color:var(--text-dim);">Si no la encuentras o se quedó trabada, toca <b>Usar esta pestaña</b>: la otra se cierra sola. Lo que estaba a medio cobrar allá se pierde; las ventas ya guardadas no.</p>',
    btns: '<button type="button" class="btn green" id="btnEstaPestana" onclick="usarEstaPestana(this)">🗂️ Usar esta pestaña</button>' });
}
function usarEstaPestana(btn){
  btnOcupado(btn, "Abriendo…");
  try { sessionStorage.setItem("cm_robar", "1"); } catch (e) {}   // al recargar, esta pestaña le quita el candado a la otra
  location.reload();
}
// Equipo nuevo en este navegador (activado otra vez): se borran los datos y el contador, NO las ventas sin subir
async function borrarDatosDelEquipo(){
  await dbOp("kv", "readwrite", s => { s.delete("datos"); s.delete("tasas"); s.delete("numeros"); return s.delete("seq"); });
  S.datos = null; S.tasas = null; S.num = numNormal(null); _vendidoLocal = null;
}
let _listoYa = false;
function listo(){
  document.body.classList.remove("entrando");
  mostrarVista(S.vista === "activar" ? "vender" : S.vista);
  pintarTodo();
  // 2.9: lo PRIMERO es el cajero. Sin turno: «¿Quién está en la caja?» (antes de la facturación). Con turno: su PIN
  // al abrir la caja, y también después de activar el equipo o de entrar otra vez con usuario y clave.
  if (!S.turno && (S.vista === "vender" || !_listoYa)) { mostrarVista("turno"); seguro(pintarTurno); }
  if (S.turno && (!_listoYa || S.pedirPin)) bloquear();   // cajero.js
  S.pedirPin = false;
  if (_listoYa) { sincronizar(); return; }
  _listoYa = true;
  ordIniciar();   // ordenes.js: 📋 Órdenes y su contador
  setTimeout(async () => { const r = await sincronizar(); if (!(r && r.subidas)) actualizarDatos(null, true); }, 800);
  setInterval(() => sincronizar(), 60000);                     // cada minuto: lo que haya por subir y los números al día
  setInterval(() => { if (S.online !== false) actualizarDatos(null, true); }, 20 * 60000);
  setTimeout(existenciasAlDia, 15000);
  setInterval(existenciasAlDia, 2 * 60000);   // existencias al día entre cajas (solo si cambiaron)
  window.addEventListener("online", () => { sincronizar(); revisarVersion(); });
  setTimeout(revisarVersion, 5000);
  setInterval(revisarVersion, 30 * 60000);
  window.addEventListener("offline", () => marcarOnline(false));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { sincronizar(); setTimeout(existenciasAlDia, 1500); } });
}
async function primeraDescarga(btn){
  btnOcupado(btn, "Descargando…");
  try {
    await descargarDatos();
    btnLibre(btn);
    toast("✅ Datos descargados");
    continuarArranque();
  } catch (e) {
    btnLibre(btn);
    if (e.codigo === "SESION" || e.codigo === "USUARIO") return;   // sesion.js ya pidió entrar otra vez
    if (S.permisoMal || S.datosMal) {
      $("actTxt").innerHTML = "<p>⛔ " + esc(S.permisoMal || S.datosMal) + "</p>";
      if (e.codigo === "EQUIPO") $("actBtns").innerHTML = '<button type="button" class="btn green" onclick="olvidarEquipo()">🔌 Activar este equipo otra vez</button>';
      else $("actBtns").innerHTML = '<button type="button" class="btn green" id="btnPrimera" onclick="primeraDescarga(this)">🔄 Volver a intentar</button>';
      pintarBanners();
      return;
    }
    aviso({ icono: "📡", titulo: "No se pudieron descargar los datos", html: esc(e.message) + "<br><br>Revisa que este equipo tenga internet y vuelve a tocar <b>Descargar datos</b>." });
  }
}
async function descargarDatos(){
  const d = await api("cj_datos", {}, 90000);
  if (!d || !d.ok) {
    if (!revisarErrorSistema(d)) S.datosMal = "";
    const e = new Error((d && d.msg) || "El sistema no mandó los datos."); e.codigo = d && d.codigo;
    throw e;
  }
  d.descargadoEn = Date.now();
  _exiFirma = "";   // las existencias vienen en los datos: la próxima consulta trae todo de nuevo
  const antes = F.items.length ? { total: totales(F.items, F.desc).total, u: unidadU() } : null;
  S.datos = d; S.permisoMal = ""; S.datosMal = ""; S.reemplazado = false;
  await kvSet("datos", d);
  if ((S.clientesNuevos || []).length) {   // los clientes creados sin internet que el sistema ya tiene salen de la lista de este equipo
    const ya = new Set((d.clientes || []).map(c => cedNorm(c.cedula)));
    S.clientesNuevos = S.clientesNuevos.filter(c => !ya.has(cedNorm(c.cedula)));
    await kvSet("clientesNuevos", S.clientesNuevos);
  }
  // TasaBin encendido: div = tasa Divisas (H7). Apagado: div = Divisas de los $ en efectivo (H9).
  const on = d.binOn === true;
  S.tasas = { bcv: Number(d.tasa) || 0, div: on ? (Number(d.tasaBinance) || Number(d.tasa) || 0) : (Number(d.tasaDivisas) || 0),
              binOn: on, brecha: Number(d.brechaPct) || 0, fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(d.tasaFecha || "")) ? d.tasaFecha : hoyTxt(), origen: "sistema" };   // S2: el día en que el sistema actualizó la BCV
  if (!on) F.dolares = false;
  await kvSet("tasas", S.tasas);
  if (antes) {   // la factura en pantalla toma las tasas nuevas (los precios del sistema no cambian)
    repreciar();
    const ahora = totales(F.items, F.desc).total;
    if (antes.u === unidadU() && Math.abs(ahora - antes.total) >= 0.005)
      aviso({ icono: "💱", titulo: "Precios recalculados", html: "Llegaron tasas nuevas del sistema: " + textoTasas() + ".<br><br>Total de la venta en pantalla: <b>" + txtU(antes.total) + "</b> → <b>" + txtU(ahora) + "</b> (Bs " + fmt(r2(ahora * bsPorU())) + ")." +
        (F.items.some(i => i.manual) ? "<br><br>Las líneas con precio manual se pasaron con las tasas nuevas." : "") + "<br><br>Si ya le habías dicho el total al cliente, avísale del cambio." });
  }
}
// Las tasas del equipo en palabras
function textoTasas(){
  const t = S.tasas || {};
  if (t.binOn) return "BCV <b>Bs " + fmt(t.bcv) + "</b> · Divisas <b>Bs " + fmt(t.div) + "</b>" + (t.bcv > 0 && t.div > 0 ? " (brecha " + fmt((t.div / t.bcv - 1) * 100) + " %)" : "");
  return "BCV <b>Bs " + fmt(t.bcv) + "</b> · Divisas efectivo <b>Bs " + (t.div > 0 ? fmt(t.div) : "—") + "</b>";
}
async function actualizarDatos(btn, silencioso){
  if (!S.eq) return;
  if (silencioso && P) return;   // con el cobro abierto no se cambian tasas ni precios
  if (!sesionViva() && !(await entrarDirecto())) {   // 2.8.1: sin sesión, el equipo vuelve a entrar solo antes de actualizar
    if (!silencioso) aviso({ icono: "🔐", titulo: "No se pudieron actualizar los datos", html: "La sesión de este equipo venció y no pudo volver a entrar sola (¿hay internet?). Puedes seguir vendiendo con los datos que ya tiene el equipo." });
    return;
  }
  btnOcupado(btn, "Actualizando…");
  try {
    await descargarDatos();
    btnLibre(btn);
    if (!silencioso) toast("✅ Datos actualizados");
    pintarTodo();
  } catch (e) {
    btnLibre(btn);
    pintarBanners();
    if (e.codigo === "SESION" || e.codigo === "USUARIO") return;   // sesion.js ya lo atendió
    if (silencioso && !e.red && !S.permisoMal) { S.datosMal = "Los datos (tasas, precios y existencias) no se pudieron actualizar solos: " + e.message; pintarBanners(); }   // 2.8.1: que no falle callado
    if (!silencioso && !S.permisoMal) aviso({ icono: "📡", titulo: "No se pudieron actualizar los datos", html: esc(e.message) + (e.red ? "<br><br>Puedes seguir vendiendo con los datos que ya tiene el equipo." : "") });
  }
}

// ══ VISTAS Y PINTADO GENERAL ══
function mostrarVista(v){
  S.vista = v;
  ["activar", "vender", "ventas", "ajustes", "turno", "cierre"].forEach(x => $("v" + x.charAt(0).toUpperCase() + x.slice(1)).classList.toggle("on", x === v));
  document.body.classList.toggle("v-vender", v === "vender");
  $("btnIrVender").classList.toggle("oculto", !(v === "ventas" || v === "ajustes" || v === "cierre"));
  const nv = (v === "turno" || v === "cierre") ? "vender" : v;
  document.querySelectorAll("#menuVta .menu-vta-item[data-v]").forEach(b => b.classList.toggle("on", b.dataset.v === nv));
}
function irA(v){
  cerrarMenuVta();
  if (!S.datos) return;
  if (S.cierreAdmin && v !== "cierre") { cancelarCierreAdmin(); return; }   // cajero.js: el Administrador solo vino a cerrar el turno
  if (v === "vender" && !S.turno) { mostrarVista("turno"); pintarTurno(); return; }   // primero, abrir turno
  mostrarVista(v);
  if (v === "ventas") pintarVentas();
  if (v === "ajustes") pintarAjustes();
  if (v === "vender") setTimeout(() => { const b = $("busca"); if (b && window.innerWidth > 820) b.focus(); }, 50);
}
function pintarTodo(){   // 2.9: cada parte por separado: si una falla, las demás se pintan igual (y la falla se ve en la barra roja)
  [pintarCabecera, pintarEstado, pintarBanners].forEach(seguro);
  if (S.vista === "turno") seguro(pintarTurno);
  if (BQ.on && !PK.c) seguro(pintarBloqueo);   // cajero.js (sin teclado en pantalla: no se borra lo que se está escribiendo)
  [pintarCategorias, pintarSelectores, buscar, pintarFactura].forEach(seguro);
  if (S.vista === "ventas") seguro(pintarVentas);
  if (S.vista === "ajustes") seguro(pintarAjustes);
}
// 2.9: si algo falla en la pantalla, se dice en una barra roja (con el texto exacto, para mandárselo a Solumaker)
function seguro(fn){ try { return fn(); } catch (e) { mostrarFalla(e); } }
let _fallaVista = "";
function mostrarFalla(e){
  const msg = String((e && (e.message || e.reason && e.reason.message || e.reason)) || e || "").slice(0, 300);
  if (!msg || /ResizeObserver|Script error/i.test(msg) || msg === _fallaVista) return;
  _fallaVista = msg;
  try { console.error(e); } catch (x) {}
  let bar = $("barraFalla");
  if (!bar) { bar = document.createElement("div"); bar.id = "barraFalla"; bar.className = "barra-falla"; document.body.appendChild(bar); }
  bar.innerHTML = "⚠️ Algo falló en la caja: <b>" + esc(msg) + "</b> · versión " + esc(APP_VER) + ' <button type="button" onclick="location.reload()">🔄 Recargar</button> <button type="button" onclick="this.parentNode.remove()">✕</button>';
}
window.addEventListener("error", ev => mostrarFalla(ev.error || ev.message));
window.addEventListener("unhandledrejection", ev => { const r = ev.reason; if (r && (r.red || r.codigo)) return; mostrarFalla(r); });
// Barra de arriba, como en Ventas: cajero del turno, tasa (se puede ocultar) y el menú
function pintarCabecera(){
  const d = S.datos;
  if (!d) return;
  $("tbTit").textContent = "🛒 Punto de Venta · Caja " + d.caja;
  $("badgeCajero").classList.toggle("oculto", !S.turno);
  const bct = $("btnCierreTop"); if (bct) bct.classList.toggle("oculto", !S.turno);   // Tanda 1b: 🔒 Cerrar turno siempre a la vista
  if (S.turno) $("cajeroNombre").textContent = S.turno.cajeroNombre;
  $("menuCierre").classList.toggle("oculto", !S.turno);
  const ms = $("menuSacar"); if (ms) ms.classList.toggle("oculto", !S.turno);   // 3.3: 💸 Sacar efectivo
  $("btnBloquear").classList.add("oculto");   // 4.3: sin el candado arriba (sigue en ☰ Menú → Bloquear la caja)
  $("menuBloq").classList.toggle("oculto", !S.turno);
  const u = S.ses && S.ses.usuario;
  $("menuInfo").innerHTML = "<b>" + esc(d.negocio || "Mi negocio") + "</b><br>Caja " + esc(d.caja) + " · equipo " + esc(d.equipo || "") + (d.nombreEquipo ? " (" + esc(d.nombreEquipo) + ")" : "") +
    (u ? "<br>Usuario: " + esc(u.nombre || u.usuario) + (sesionDirecta() ? " (entrada directa)" : "") : "") + (S.turno ? "<br>Turno de " + esc(S.turno.cajeroNombre) + " desde las " + horaDe(S.turno.apertura) : "");
  pintarTasa();
}
function tasaVieja(){ const t = S.tasas || {}; return !!(t.fecha && t.fecha !== hoyTxt()); }
function pintarTasa(){
  const t = S.tasas || {}, oc = !!S.pref.tasaOculta;
  $("tasaDisplay").innerHTML = oc ? "••••••" : F.fechaAnt ? '<span class="vieja">📅 ' + fechaCorta(F.fechaAnt.fecha).slice(0, 5) + " · </span>Bs " + fmt(F.fechaAnt.bcv)   // Tanda 1: venta de otro día
    : (tasaVieja() ? '<span class="vieja">⚠️ ' + fechaCorta(t.fecha).slice(0, 5) + " · </span>" : "") + "Bs " + fmt(t.bcv);
  $("btnOcultarTasa").title = oc ? "Mostrar tasa" : "Ocultar tasa";
}
async function toggleTasaVisible(){
  S.pref.tasaOculta = !S.pref.tasaOculta;
  pintarTasa();
  const c = $("chkTasaOculta"); if (c) c.checked = !!S.pref.tasaOculta;
  try { await kvSet("pref", S.pref); } catch (e) {}
}
// Tocar la tasa: las tasas del equipo y, con la clave sin internet, cambiarlas
async function verTasas(){
  const t = S.tasas || {};
  const r = await modal({ icono: "💱", titulo: "Tasas para cobrar",
    html: '<div class="m-txt">' + textoTasas() + "<br><span style=\"color:var(--text-dim);font-size:13px;\">Del " + fechaCorta(t.fecha) + (t.origen === "manual" ? " · puesta a mano" : " · del sistema") +
      (tasaVieja() ? ' · <b style="color:var(--amber);">no es de hoy</b>' : "") + "</span><br><br>Con internet el equipo toma las tasas del sistema solo. Si hoy son otras y no hay internet, cámbialas con la clave sin internet.</div>",
    botones: [{ txt: "Cerrar", v: false }, { txt: "🔒 Cambiar tasa", v: true, cls: "green" }] });
  if (r) cambiarTasa(null);
}
// ── Menú ☰ (como en Ventas) ──
function abrirMenuVta(){
  const b = $("btnMenuVta"), m = $("menuVta");
  if (b && m) { const r = b.getBoundingClientRect(); m.style.top = Math.round(r.bottom + 6) + "px"; m.style.right = Math.max(6, Math.round(window.innerWidth - r.right)) + "px"; }
  $("menuVtaFondo").classList.add("visible"); m.classList.add("visible");
}
function cerrarMenuVta(){ $("menuVtaFondo").classList.remove("visible"); $("menuVta").classList.remove("visible"); }
function menuVtaAccion(a){
  cerrarMenuVta();
  if (a === "actualizar") { actualizarDatos(null, false); toast("🔄 Actualizando datos…"); return; }
  if (a === "cierre") { irCierre(); return; }
  if (a === "bloquear") { bloquear(); return; }
  if (a === "sacar") { gvGasto(); return; }   // 3.3 (gaveta.js)
  if (a === "facturas") { abrirFacturasAnt(); return; }   // 3.9 (tanda2.js)
  if (a === "servicio") { nuevoServicio(); return; }       // 3.9 (tanda2.js)
  irA(a);
}
function cuentas(){
  let por = 0, mal = 0;
  S.ventas.forEach(v => { if (v.estado === "por_subir") por++; else if (v.estado === "pendiente" || v.estado === "invalida") mal++; });
  S.cierres.forEach(c => { if (c.estado === "por_subir") por++; });
  (S.movs || []).forEach(m => { if (m.estado === "por_subir") por++; else if (m.estado === "rechazado") mal++; });   // 3.3: lo de la gaveta
  return { por, mal };
}
function pintarEstado(){
  const p = $("pillEstado"), c = cuentas();
  p.classList.remove("on", "off", "pend", "mal");
  let t = S.online === true ? "Con internet" : S.online === false ? "Sin internet" : "Revisando…", k = "";
  if (S.online === true) p.classList.add("on"); else if (S.online === false) p.classList.add("off");
  if (S.sincronizando) t = "Subiendo…";
  if (c.mal) { p.classList.add("mal"); t += " · " + c.mal + " con problema"; k = c.mal + "⚠️"; }
  else if (c.por) { p.classList.add("pend"); t += " · " + c.por + " por subir"; k = c.por + "⬆"; }
  else if (S.ventas.length) t += " · todo subido";
  $("pillTxt").textContent = t; $("pillCorto").textContent = k;
  pintarNumFactura();
  p.title = t + " — tocar para ver las ventas de este equipo";
  if (typeof pintarBotonOrdenes === "function") pintarBotonOrdenes();   // 📋 Órdenes marca cuando no hay internet
}
// 4.4 · El reloj y la zona horaria del equipo. Las ventas sin internet, los turnos y los cierres usan la hora del equipo:
// si está mal, se avisa arriba (no se tranca nada). El sistema manda su hora y la zona del país en cada respuesta.
const RELOJ_PAIS = { "America/Caracas": "Venezuela", "America/Bogota": "Colombia", "America/Mexico_City": "México" };
function relojRevisar(srv, t0, t1){
  if (!srv || !(Number(srv.ms) > 0)) return;
  const real = Number(srv.ms) + (t1 - t0) / 2, offEq = -new Date().getTimezoneOffset();
  const n = { horaMal: Math.abs(Date.now() - real) > 5 * 60000, zonaMal: typeof srv.off === "number" && srv.off !== offEq,
              tz: String(srv.tz || ""), offSrv: srv.off, offEq: offEq, real: real, visto: Date.now() };
  const cambio = !S.reloj || S.reloj.horaMal !== n.horaMal || S.reloj.zonaMal !== n.zonaMal;
  S.reloj = n;
  if (cambio) pintarBanners();
}
function relojTxt(){
  const r = S.reloj;
  if (!r || (!r.horaMal && !r.zonaMal)) return "";
  const pais = RELOJ_PAIS[r.tz] || "el negocio", utc = m => "UTC" + (m < 0 ? "−" : "+") + Math.abs(m / 60);
  let hReal = "";
  try { hReal = new Date(r.real + (Date.now() - r.visto)).toLocaleTimeString("es-VE", { timeZone: r.tz || undefined, hour: "numeric", minute: "2-digit" }); } catch (e) {}
  const hEq = new Date().toLocaleTimeString("es-VE", { hour: "numeric", minute: "2-digit" });
  if (r.zonaMal) return "🕒 Este equipo no está en la hora de " + pais + " (el equipo está en " + utc(r.offEq) + " y " + pais + " en " + utc(r.offSrv) + "). Corrige la <b>zona horaria</b> en la configuración del equipo: las ventas y los cierres usan su hora.";
  return "🕒 La hora de este equipo está mal: dice <b>" + esc(hEq) + "</b> y en " + pais + " son las <b>" + esc(hReal) + "</b>. Corrígela en la configuración del equipo: las ventas y los cierres usan su hora.";
}
function pintarBanners(){
  pintarNumFactura();
  let h = "";
  { const rl = relojTxt(); if (rl) h += '<div class="banner av">' + rl + "</div>"; }   // 4.4
  if (S.permisoMal) h += '<div class="banner mal">⛔ ' + esc(S.permisoMal) + (S.reemplazado ? " Las ventas guardadas se suben solas; cierra el turno." : ' Puedes seguir vendiendo; las ventas quedan guardadas en este equipo. <a href="#" onclick="olvidarEquipo();return false;" style="color:inherit;font-weight:800;">Activar otra vez</a>') + "</div>";
  if (S.datosMal) h += '<div class="banner mal">⛔ ' + esc(S.datosMal) + ' <a href="#" onclick="actualizarDatos(null,false);return false;" style="color:inherit;font-weight:800;">Reintentar</a></div>';
  if (S.sesionMal) h += '<div class="banner av">🔐 ' + esc(S.sesionMal) + ' <a href="#" onclick="pedirEntrarOtraVez();return false;" style="color:inherit;font-weight:800;">Entrar</a></div>';
  if (S.datos && tasaVieja() && S.tasaOkHoy !== hoyTxt()) h += '<div class="banner av">💱 ' + (S.tasas.origen === "sistema" && S.online !== false
      ? "El sistema todavía tiene la tasa BCV del <b>" + fechaCorta(S.tasas.fecha) + "</b>: no se ha actualizado hoy. Revísala antes de cobrar y avísale al administrador: "
      : "Las tasas de este equipo son del <b>" + fechaCorta(S.tasas.fecha) + "</b>. Con internet se actualizan solas; si no hay, revísalas antes de cobrar: ") +
    '<a href="#" onclick="verTasas();return false;" style="color:inherit;font-weight:800;">ver tasas</a>.</div>';
  if (S.turno && S.num && !S.num.lista.length && S.online === false) h += '<div class="banner av">🔢 Este equipo no tiene números de factura apartados: los tickets salen <b>provisionales</b> y el sistema les da su número al subirlos.</div>';
  if (_verNueva) h += '<div class="banner av">🔄 Hay una versión nueva de la caja. Se actualiza sola cuando termines esta venta.</div>';
  const c = cuentas();
  if (c.mal) h += '<div class="banner av">⚠️ ' + c.mal + ' venta' + (c.mal > 1 ? "s" : "") + ' no se pudo' + (c.mal > 1 ? "eron" : "") + ' registrar en el sistema. ' + (c.mal > 1 ? "Están guardadas" : "Está guardada") + ' en este equipo: revisa el motivo en <a href="#" onclick="irA(\'ventas\');filtrarVentas(\'mal\');return false;" style="color:inherit;font-weight:800;">Ventas → Con problema</a>.</div>';
  $("banners").innerHTML = h;
}

// ══ PRODUCTOS ══
let _vendidoLocal = null;   // código → cantidad vendida en este equipo que el sistema todavía no tenía al descargar
function vendidoLocal(){
  if (_vendidoLocal) return _vendidoLocal;
  const m = {}, desde = S.datos ? (S.datos.exiEn || S.datos.descargadoEn) : 0;   // exiEn: última vez que llegaron las existencias del sistema
  S.ventas.forEach(v => {
    if (v.estado === "invalida") return;
    if (v.subidaEn && v.subidaEn <= desde) return;   // ya estaba en las existencias que mandó el sistema
    v.items.forEach(i => { if (i.tipo !== "servicio") m[i.codigo] = (m[i.codigo] || 0) + (Number(i.cantidad) || 0); });
  });
  return (_vendidoLocal = m);
}
// Con el Depósito encendido, la caja vende de la TIENDA (como Ventas): tienda = existencia − depósito
const claveCod = v => { const t = String(v == null ? "" : v).trim(); if (!t) return ""; const n = Number(t); return isNaN(n) ? t.toLowerCase() : String(n); };
function enDeposito(p){ const d = S.datos && S.datos.deposito; return d ? Number(d[claveCod(p.codigo)]) || 0 : 0; }
// Lo que queda para vender sin contar la factura en pantalla
function disponible(p){ return r3((Number(p.existencia) || 0) - enDeposito(p) - (vendidoLocal()[p.codigo] || 0)); }
function enFactura(cod){ return F.items.filter(i => i.tipo !== "servicio" && String(i.codigo) === String(cod)).reduce((s, i) => s + (Number(i.cantidad) || 0), 0); }
function existenciaLocal(p){ return r3(disponible(p) - enFactura(p.codigo)); }
// ── Existencias al día entre cajas: con internet, cada 2 minutos, solo si cambiaron (la misma consulta de Ventas) ──
let _exiFirma = "", _exiOcupado = false;
async function existenciasAlDia(){
  if (!S.datos || !S.eq || _exiOcupado || !hayInternet() || document.hidden || S.vista === "activar") return;
  _exiOcupado = true;
  const t0 = Date.now();
  try {
    const r = await api("cj_existencias", { firma: _exiFirma }, 30000);
    if (r && r.ok) { _exiFirma = r.firma || ""; if (r.cambio) await aplicarExistencias(r, t0); }
  } catch (e) {}
  _exiOcupado = false;
}
async function aplicarExistencias(r, t0){
  const cods = r.codigos || [], ex = r.existencias || [], m = {};
  cods.forEach((c, k) => m[claveCod(c)] = Number(ex[k]) || 0);
  (S.datos.productos || []).forEach(p => { const k = claveCod(p.codigo); if (k in m) p.existencia = m[k]; });
  if (S.datos.deposito && Array.isArray(r.depositos)) { const d = {}; cods.forEach((c, k) => d[claveCod(c)] = Number(r.depositos[k]) || 0); S.datos.deposito = d; }
  S.datos.exiEn = t0; _vendidoLocal = null; _cat = null;
  try { await kvSet("datos", S.datos); } catch (e) {}
  const box = $("listaProd"), st = box ? box.scrollTop : 0;
  buscar(); if (box) box.scrollTop = st;
  marcarExistencias();
}
function precioDe(p, tipoIdx){
  const lst = p.precios || [];
  const x = lst[tipoIdx] && Number(lst[tipoIdx].base) > 0 ? lst[tipoIdx] : lst[0] || { base: 0, iva: 0 };
  return { base: Number(x.base) || 0, iva: Number(x.iva) || 0 };
}
function catalogo(){
  const d = S.datos || {};
  const prods = (d.productos || []).map(p => Object.assign({ tipo: "producto" }, p));
  const servs = (d.servicios || []).map(s => ({ tipo: "servicio", codigo: s.codigo, nombre: s.nombre, codigoBarras: "", precios: [{ base: s.base, iva: s.iva }] }));
  return prods.concat(servs);
}
let _cat = null, _catDe = 0;
function cat(){ if (!_cat || _catDe !== (S.datos && S.datos.descargadoEn)) { _cat = catalogo(); _catDe = S.datos && S.datos.descargadoEn; } return _cat; }
// Productos | Servicios (solo si el negocio tiene servicios), como en Ventas
function vtaVista(v){
  S.vtaVista = v === "servicios" ? "servicios" : "productos";
  $("segProd").classList.toggle("on", S.vtaVista === "productos"); $("segServ").classList.toggle("on", S.vtaVista === "servicios");
  $("selCat").classList.toggle("oculto", S.vtaVista === "servicios"); $("mvCats").classList.toggle("oculto", S.vtaVista === "servicios");
  buscar();
}
function pintarCategorias(){
  const d = S.datos || {}, sel = $("selCat"), act = sel.value;
  const cats = [...new Set((d.productos || []).map(p => String(p.categoria || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  sel.innerHTML = '<option value="">🏷️ Todas las categorías</option>' + cats.map(c => '<option value="' + esc(c) + '">' + esc(c) + "</option>").join("");
  sel.value = cats.indexOf(act) >= 0 ? act : "";
  $("mvCats").innerHTML = ['<button type="button" class="mv-cat" data-v="">Todas</button>'].concat(cats.map(c => '<button type="button" class="mv-cat" data-v="' + esc(c) + '">' + esc(c) + "</button>")).join("");
  $("mvCats").classList.toggle("mv-sin", cats.length < 1);
  $("mvCats").querySelectorAll(".mv-cat").forEach(b => b.onclick = () => { sel.value = b.dataset.v; buscar(); });
  $("vtaSeg").classList.toggle("oculto", !(d.servicios || []).length);
  if (!(d.servicios || []).length && S.vtaVista === "servicios") S.vtaVista = "productos";
}
function resultados(q){
  const n = norm(q), serv = S.vtaVista === "servicios", c = $("selCat").value;
  const todos = cat().filter(p => (p.tipo === "servicio") === serv && (serv || !c || String(p.categoria || "").trim() === c));
  if (!n) return todos;
  const exactos = todos.filter(p => norm(p.codigo) === n || norm(p.codigoBarras) === n || (p.codRepuesto && norm(p.codRepuesto) === n));
  const palabras = n.split(/\s+/);
  const resto = todos.filter(p => exactos.indexOf(p) < 0 && palabras.every(w =>
    norm(p.nombre).indexOf(w) >= 0 || norm(p.codigo).indexOf(w) >= 0 || norm(p.codigoBarras).indexOf(w) >= 0 || norm(p.marca).indexOf(w) >= 0 || norm(p.codRepuesto).indexOf(w) >= 0));
  return exactos.concat(resto);
}
// Precio en $ BCV de una base de los libros (con TasaBin: base en divisas × Divisas ÷ BCV), como la lista de Ventas
function baseBCV(libro){ const x = Number(libro) || 0; return binOn() && tBcv() > 0 && tDiv() > 0 ? x * tDiv() / tBcv() : x; }
// Semáforo de existencia con los niveles del producto (o los generales), como en Ventas
function semaforo(ex, p){
  const d = S.datos || {};
  const gB = Number(d.invNivelBajo) || 5, gA = Number(d.invNivelNormal) || 10;
  const bajo = Number(p.nivelBajo) > 0 ? Number(p.nivelBajo) : gB;
  let alto = Number(p.nivelAlto) > 0 ? Number(p.nivelAlto) : gA;
  if (alto <= bajo) alto = bajo + 1;
  if (ex <= 0) return "color:#7a8a9a;background:rgba(122,138,154,0.18);";
  if (ex <= bajo) return "color:var(--sk-low);background:var(--sk-low-bg);";
  if (ex < alto) return "color:var(--sk-mid);background:var(--sk-mid-bg);";
  return "color:var(--green);background:var(--green-dim);";
}
function cuantasEnFactura(cod){ let q = 0; F.items.forEach(i => { if (String(i.codigo) === String(cod)) q += Number(i.cantidad) || 0; }); return r3(q); }
const LISTA_MAX = 300, LISTA_MAX_TEL = 60;   // 2.9: en el teléfono con fotos, 60 a la vez (escribe para buscar el resto)
const listaMax = () => (window.innerWidth <= 820 && hayFotos()) ? LISTA_MAX_TEL : LISTA_MAX;
function buscar(){
  const box = $("listaProd");
  if (!S.datos) { box.innerHTML = ""; return; }
  const max = listaMax(), q = $("busca").value, todos = resultados(q), lst = todos.slice(0, max), on = binOn();
  $("vtaContador").textContent = todos.length > max ? "Mostrando " + max + " de " + todos.length + ": escribe para buscar" : "";
  const fotos = S.vtaVista !== "servicios" && hayFotos();   // 2.8: como Ventas, con «Mostrar fotos de productos en Ventas» (Configuración)
  const nsBtn = S.vtaVista === "servicios" ? '<button type="button" class="ns-btn" onclick="nuevoServicio($(\'busca\').value.trim())">🛠️ ＋ Nuevo servicio' + (norm(q) ? " «" + esc(q.trim()) + "»" : "") + "</button>" : "";   // 3.9 (tanda2.js)
  if (!lst.length) { box.innerHTML = nsBtn + '<div class="vacio">' + (norm(q) ? "No hay " + (S.vtaVista === "servicios" ? "servicios" : "productos") + " con «" + esc(q) + "»." : "No hay productos en los datos de este equipo.") + "</div>"; box._lst = []; return; }
  box.innerHTML = nsBtn + lst.map((p, k) => {
    const pr = precioDe(p, F.tipoPrecio), conIva = r2(r2(baseBCV(pr.base)) * (1 + pr.iva / 100)), div = on ? r2(pr.base * (1 + pr.iva / 100)) : 0;
    let info = "";
    if (p.tipo === "servicio") info = '<div style="margin-top:4px;"><span class="serv-tag">Servicio</span></div>';
    else {
      const ex = disponible(p);   // como Ventas: lo que hay (sin restar la factura en pantalla)
      info = (p.categoria ? '<div class="prod-barcode">🏷️ ' + esc(p.categoria) + "</div>" : "") + (p.marca ? '<div class="prod-barcode">Marca: ' + esc(p.marca) + "</div>" : "") +
        (S.datos.buscarRepuesto && p.codRepuesto ? '<div class="prod-barcode">Cód. Producto: ' + esc(p.codRepuesto) + "</div>" : "") +
        (p.codigoBarras && String(p.codigoBarras) !== String(p.codigo) ? '<div class="prod-barcode">Cód. de Barras: ' + esc(p.codigoBarras) + "</div>" : "") +
        '<div style="margin-top:4px;"><span class="prod-stock" style="' + semaforo(ex, p) + '">' + (ex <= 0 ? (enDeposito(p) > 0 ? "Tienda 0" : "Sin stock") : fmtCant(ex) + " uds") + "</span>" +
        (enDeposito(p) > 0 ? ' <span class="prod-barcode" style="display:inline;">📦 Depósito: ' + fmtCant(enDeposito(p)) + "</span>" : "") + "</div>";
    }
    const q2 = cuantasEnFactura(p.codigo);
    const cf = fotos && p.tipo !== "servicio";
    return '<div class="prod-item' + (cf ? " con-foto" : "") + '" data-k="' + k + '" onclick="clicProducto(this,' + k + ')" ondblclick="agregarDeLista(' + k + ')"><div class="prod-fila"' + (cf ? ' style="align-items:center;gap:10px;"' : "") + ">" +
      (cf ? fotoProd(p) : "") +
      '<div style="flex:1;min-width:0;"><div class="prod-cod">ID: ' + esc(p.codigo) + '</div><div class="prod-nom">' + esc(p.nombre) + "</div>" + info + "</div>" +
      '<div class="prod-pr"><div class="p1">$ ' + fmt(conIva) + " <small>BCV</small></div><div class=\"p2\">Bs " + fmt(r2(conIva * tBcv())) + "</div>" + (div > 0 ? '<div class="p3">$ ' + fmt(div) + " <small>div</small></div>" : "") + "</div>" +
      '<button type="button" class="mv-add" data-cod="' + esc(p.codigo) + '" title="Agregar a la factura" onclick="event.stopPropagation();agregarDeLista(' + k + ')" ondblclick="event.stopPropagation()">+' + (q2 > 0 ? '<span class="mv-q">' + fmtCant(q2) + "</span>" : "") + "</button>" +
      "</div></div>";
  }).join("");
  box._lst = lst;
  $("mvCats").querySelectorAll(".mv-cat").forEach(b => b.classList.toggle("on", b.dataset.v === $("selCat").value));
}
// 2.8 · Fotos como en Ventas (Configuración → «Mostrar fotos de productos en Ventas»): en la lista y una miniatura en la factura
function hayFotos(){ return !!(S.datos && S.datos.fotosVentas === true); }
let _fotoMapa = {}, _fotoDatos = null;
function fotoDeCodigo(c){
  if (_fotoDatos !== S.datos) { _fotoDatos = S.datos; _fotoMapa = {}; ((S.datos && S.datos.productos) || []).forEach(p => { if (p.imagen) _fotoMapa[String(p.codigo)] = p.imagen; }); }
  return _fotoMapa[String(c)] || "";
}
// Igual que Ventas (_SIN_FOTO_SVG, .vta-thumb y .vta-mini): recuadro «Sin foto» y la foto con fondo blanco, sin recortarla
const SIN_FOTO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5.2-5.2a1 1 0 0 0-1.4 0L5 20"/></svg>';
// 2.9: en la lista y en la factura va la foto CHICA (…-400.webp, la misma que sube Inventario junto a la grande): en el
// teléfono, 60 fotos grandes (…-900) ponían lenta la caja. Si la chica no está, se usa la que viene.
function fotoChica(u){ return String(u || "").replace(/-900\.webp(\?|#|$)/, "-400.webp$1"); }
function fotoFalla(img){ const g = img.getAttribute("data-g"); if (g && img.getAttribute("src") !== g) { img.setAttribute("src", g); return true; } return false; }
function fotoLista(img){ const b = img.parentNode; img.classList.add("ok"); if (b) { b.classList.remove("cargando"); b.classList.add("con-img"); } }
function sinFoto(img){ if (img && fotoFalla(img)) return; const b = img && img.parentNode; if (!b) return; b.onclick = null; b.removeAttribute("title"); b.classList.remove("cargando", "con-img"); b.classList.add("sin"); b.innerHTML = SIN_FOTO_SVG + "<small>Sin foto</small>"; }
function miniFoto(c, srv){
  if (srv) return '<span class="vta-mini vacio"></span>';   // servicios: sin foto, solo el espacio para alinear (como Ventas)
  const u = String(fotoDeCodigo(c) || "").replace(/"/g, "%22");
  return u ? '<span class="vta-mini"><img alt="" decoding="async" src="' + fotoChica(u) + '" data-g="' + u + '" onload="this.parentNode.classList.add(\'con-img\')" onerror="if(!fotoFalla(this))this.parentNode.innerHTML=SIN_FOTO_SVG"></span>'
           : '<span class="vta-mini">' + SIN_FOTO_SVG + "</span>";
}
// La foto del producto en la lista (la del catálogo). Sin foto, o si no carga: «Sin foto». Tocarla la muestra grande.
function fotoProd(p){
  const u = String((p && p.imagen) || "").trim().replace(/"/g, "%22");
  if (!u) return '<span class="vta-thumb sin">' + SIN_FOTO_SVG + "<small>Sin foto</small></span>";
  return '<span class="vta-thumb cargando" onclick="event.stopPropagation();verFoto(this)" ondblclick="event.stopPropagation()" title="Ver la foto">' +
    '<img alt="" loading="lazy" decoding="async" src="' + fotoChica(u) + '" data-g="' + u + '" onload="fotoLista(this)" onerror="sinFoto(this)"></span>';
}
function verFoto(el){
  const img = el && el.querySelector("img"); if (!img) return;
  const nom = (el.closest(".prod-item") || {}).querySelector ? el.closest(".prod-item").querySelector(".prod-nom").textContent : "";
  modal({ titulo: nom || "Foto", html: '<img class="foto-grande" alt="" src="' + (img.getAttribute("data-g") || img.getAttribute("src")).replace(/"/g, "%22") + '">', botones: [{ txt: "Cerrar", v: true, cls: "green" }] });
}
function limpiarBusqueda(){ $("busca").value = ""; buscar(); $("busca").focus(); }
function buscarEnter(){
  const q = norm($("busca").value);
  if (!q) return;
  const exacto = cat().filter(p => norm(p.codigo) === q || norm(p.codigoBarras) === q || (p.codRepuesto && norm(p.codRepuesto) === q));
  if (exacto.length === 1) { agregar(exacto[0]); return; }
  const lst = $("listaProd")._lst || [];
  if (lst.length === 1) { agregar(lst[0]); return; }
  if (!lst.length) aviso({ icono: "🔎", titulo: "No está en la lista", html: "No hay ningún producto con «" + esc($("busca").value) + "» en los datos de este equipo. Si es nuevo, toca <b>☰ Menú → 🔄 Actualizar datos</b> (con internet)." });
}
function agregarDeLista(k){ const p = ($("listaProd")._lst || [])[k]; if (p) agregar(p); }
// Como en Ventas: un clic marca el producto y el doble clic lo agrega. En pantalla táctil, un toque lo agrega.
const ES_TACTIL = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
function clicProducto(el, k){
  if (ES_TACTIL && window.innerWidth > 820) { agregarDeLista(k); return; }
  document.querySelectorAll("#listaProd .prod-item.highlight").forEach(x => x.classList.remove("highlight"));
  el.classList.add("highlight");
}
async function agregar(p){
  if (p.tipo !== "servicio") {
    const e = existenciaLocal(p);
    if (e < 1 && !F.avisoEx[String(p.codigo)]) {   // 3.9: se pregunta una sola vez por producto en cada venta
      const dep = enDeposito(p);
      const ok = await confirmar({ icono: "📦", titulo: "No hay existencia de este producto", colorOk: "naranja", ok: "Sí, venderlo igual", cancel: "No agregarlo",
        html: "<b>" + esc(p.nombre) + "</b><br>Según el sistema " + (e > 0 ? "queda <b>" + fmtCant(e) + "</b>" : "no queda <b>ninguno</b>") + (dep > 0 ? " en la tienda (hay " + fmtCant(dep) + " en el depósito)" : "") + "." +
          "<br><br><b>¿Lo tienes en la mano?</b> Véndelo: la venta se registra igual y en el sistema queda el aviso para revisar la existencia de ese producto." });
      if (!ok) return;
      F.avisoEx[String(p.codigo)] = true;
    }
  }
  const pr = precioDe(p, F.tipoPrecio);
  const ya = F.items.find(i => i.codigo === p.codigo && i.tipo === p.tipo && !i.manual && i.tipoIdx === F.tipoPrecio);
  if (ya) ya.cantidad = r3((Number(ya.cantidad) || 0) + 1);
  else F.items.push({ key: ++F.seq, tipo: p.tipo, codigo: p.codigo, nombre: p.nombre, codigoBarras: p.codigoBarras || p.codigo,
    cantidad: 1, libro: pr.base, base: basePantalla(pr.base), iva: pr.iva, manual: false, tipoIdx: F.tipoPrecio });   // libro: base del sistema (divisas con TasaBin) · base: en pantalla
  const habia = $("busca").value !== "";
  $("busca").value = "";
  if (habia) buscar(); else marcarEnFactura();   // 2.9: si la lista no cambia, solo el número del «+» (no se vuelven a cargar las fotos)
  pintarFactura();
  const n = String(p.nombre || ""); if (!(typeof ESC !== "undefined" && ESC.on)) toast("✅ " + (n.length > 34 ? n.slice(0, 33) + "…" : n) + "  ×" + fmtCant(cuantasEnFactura(p.codigo)));   // 3.9: con la cámara abierta lo dice la barra del escáner
  if (window.innerWidth > 820 && !(typeof ESC !== "undefined" && ESC.on)) $("busca").focus();
}

// ══ LA VENTA (factura) ══
function pintarNumFactura(){
  const el = $("numFactura"); if (!el) return;
  const N = S.num; el.value = N && N.lista && N.lista.length ? String(N.lista[0]) : (S.turno ? "Provisional" : "—");
}
function pintarSelectores(){
  const d = S.datos; if (!d) return;
  pintarNumFactura();
  $("fechaVenta").value = fechaCorta(F.fechaAnt ? F.fechaAnt.fecha : hoyTxt());   // Tanda 1: tocarla abre «Venta de otro día»
  $("fechaVenta").classList.toggle("otro-dia", !!F.fechaAnt);
  const bo = $("bannerOtroDia");
  if (bo) { bo.classList.toggle("oculto", !F.fechaAnt); bo.innerHTML = F.fechaAnt ? "📅 <b>Venta del " + fechaCorta(F.fechaAnt.fecha) + "</b> con las tasas de ese día: " + textoTasasFA() + ". Su efectivo no cuenta en el cierre de hoy. " +
    '<button type="button" class="btn sm" onclick="ponerFechaAnt(null)">↩️ Volver a hoy</button>' : ""; }
  pintarTasa();
  // Tipo de precio para lo que se agregue (los que tienen precio en algún producto)
  const tp = tiposConPrecio();
  $("selTipoPrecio").innerHTML = tp.map(o => '<option value="' + o.i + '"' + (o.i === F.tipoPrecio ? " selected" : "") + ">" + esc(o.n) + "</option>").join("");
  $("precioBar").classList.toggle("oculto", tp.length < 2);
  // Venta en Dólares (solo con TasaBin encendido)
  $("badgeDolares").classList.toggle("oculto", !binOn());
  $("chkDolares").checked = !!F.dolares;
  // Vendedor
  const sel = $("selVend"), badge = $("badgeVend");
  $("vendBar").classList.add("oculto"); badge.classList.add("oculto");
  if (d.trabajoVendedores) {   // 4.3: con la caja nueva el vendedor SIEMPRE se elige en la factura (ya no hay vendedor fijo por caja)
    if (F.vend === "") F.vend = "directa";
    sel.innerHTML = '<option value="directa">🏪 Venta directa (sin comisión)</option>' + (d.vendedores || []).map(v => '<option value="' + esc(v.id) + '">🧑‍💼 ' + esc(v.nombre) + "</option>").join("");
    if (F.orden && F.orden.origen === "VENDEDOR" && F.orden.vendedorId && !(d.vendedores || []).some(v => String(v.id) === String(F.orden.vendedorId)))   // vendedor de la orden que ya no está activo
      sel.innerHTML += '<option value="' + esc(F.orden.vendedorId) + '">🧑‍💼 ' + esc(F.orden.vendedor || "Vendedor de la orden") + "</option>";
    sel.value = F.vend; if (sel.value !== F.vend) { F.vend = "directa"; sel.value = "directa"; }
    $("vendBar").classList.remove("oculto");
  }
  // Descuento
  $("tipoDescuento").value = F.desc.tipo;
  const vd = $("valorDescuento");
  vd.disabled = F.desc.tipo === "ninguno";
  if (document.activeElement !== vd) vd.value = F.desc.valor > 0 ? F.desc.valor : "";
  $("lblDescVal").textContent = F.desc.tipo === "pct" ? "%" : F.desc.tipo === "monto" ? "$ " + unidadU() : "";
  $("tipoDelivery").value = F.dlv.tipo === "envio" ? "envio" : "delivery";
  const vdl = $("valorDelivery"); if (document.activeElement !== vdl) vdl.value = dlvMonto() > 0 ? dlvMonto() : "";
  pintarChipOrden();
}
function tiposConPrecio(){
  const d = S.datos || {};
  return (d.tiposPrecios || []).map((n, i) => ({ n, i })).filter(o => o.i === 0 || (d.productos || []).some(p => p.precios && p.precios[o.i] && Number(p.precios[o.i].base) > 0));
}
function cambiarTipoPrecio(v){
  F.tipoPrecio = Number(v) || 0;
  const c = cat();
  F.items.forEach(i => { if (i.manual || i.tipo === "servicio") return; const p = c.find(x => x.codigo === i.codigo && x.tipo === i.tipo); if (!p) return; const pr = precioDe(p, F.tipoPrecio); i.libro = pr.base; i.base = basePantalla(pr.base); i.iva = pr.iva; i.tipoIdx = F.tipoPrecio; });
  buscar(); pintarFactura();
}
// Total igual que el servidor (_vsiTotal_ / registrarVentaDesdeHTML): descuento prorrateado sobre base e IVA
function totales(items, desc){
  let sub = 0, iva = 0;
  (items || []).forEach(i => { const q = Number(i.cantidad) || 0, b = Number(i.base) || 0; sub += b * q; iva += b * ((Number(i.iva) || 0) / 100) * q; });
  const tot = sub + iva, d = desc || { tipo: "ninguno", valor: 0 };
  let f = 0;
  if (d.tipo === "pct") f = (Number(d.valor) || 0) / 100;
  else if (d.tipo === "monto") f = tot > 0 ? Math.min(Number(d.valor) || 0, tot) / tot : 0;
  f = Math.max(0, Math.min(1, f));
  const descB = Math.round(sub * f * 100) / 100, ivaR = Math.round(iva * (1 - f) * 100) / 100;
  return { sub: r2(sub), iva: r2(iva), desc: descB, ivaR: ivaR, total: Math.round((sub - descB + ivaR) * 100) / 100, f: f };
}
const totLinea = i => r2((Number(i.base) || 0) * (1 + (Number(i.iva) || 0) / 100) * (Number(i.cantidad) || 0));   // como Ventas: sin redondear el P.U.
// La factura en una tabla, como en Ventas: Cód · Nombre · Cant · P.U. ($ sin IVA) · IVA% · Total · Tipo · ✕
function pintarFactura(){
  _vendidoLocal = null;
  repreciar();
  const tps = tiposConPrecio(), c = cat();
  $("tablaFactura").innerHTML = !F.items.length ? '<tr class="fac-vacia"><td colspan="8"><span class="solo-pc">Busca un producto o pasa el lector de códigos. Doble clic en un producto para agregarlo.</span><span class="solo-movil">La factura está vacía. Agrega productos desde la pestaña 🛒 Productos.</span></td></tr>' : F.items.map(i => {
    const srv = i.tipo === "servicio", p = c.find(x => x.codigo === i.codigo && x.tipo === i.tipo);
    let opts = srv ? '<option value="0"' + (!i.manual ? " selected" : "") + ">Servicio</option>"
      : tps.filter(o => o.i === 0 || (p && p.precios && p.precios[o.i] && Number(p.precios[o.i].base) > 0)).map(o => '<option value="' + o.i + '"' + (!i.manual && i.tipoIdx === o.i ? " selected" : "") + ">" + esc(o.n) + "</option>").join("");
    opts += '<option value="manual"' + (i.manual ? " selected" : "") + ">Manual</option>";
    const cant = '<td><button type="button" class="mv-paso" onclick="pasoCant(' + i.key + ',-1)" title="Una menos">−</button><input type="number" min="0" step="any" id="q_' + i.key + '" placeholder="Cant." value="' + (i.cantidad === "" ? "" : i.cantidad) + '" oninput="cambiarCant(' + i.key + ',this.value)" onchange="revisarExistencia(' + i.key + ')" onkeydown="if(event.key===\'Enter\'){event.preventDefault();$(\'busca\').focus();}"><button type="button" class="mv-paso" onclick="pasoCant(' + i.key + ',1)" title="Una más">+</button></td>';
    const cod = '<td><span style="font-size:11px;">' + esc(i.codigoBarras || i.codigo) + "</span>" + (srv ? ' <span class="srv">SRV</span>' : "") + "</td>";
    const nom = '<td class="nom" title="' + esc(i.nombre) + '">' + (hayFotos() ? '<span class="vta-fcel">' + miniFoto(i.codigo, srv) + '<span class="vta-fnom">' + esc(i.nombre) + "</span></span>" : esc(i.nombre)) + (srv ? "" : '<span class="sin-ex oculto" id="sx_' + i.key + '"></span>') + "</td>";
    const fin = '<td><select onchange="cambiarTipoLinea(' + i.key + ',this)">' + opts + '</select></td><td><button type="button" class="btn-del" onclick="quitarLinea(' + i.key + ')" title="Quitar">✕</button></td>';
    if (i.manual) return '<tr data-key="' + i.key + '" data-cod="' + esc(i.codigo) + '">' + cod + nom + cant +
      '<td><input type="number" class="man" min="0" step="any" id="pu_' + i.key + '" value="' + r2(i.base).toFixed(2) + '" oninput="manualPU(' + i.key + ',this.value)"></td>' +
      '<td><input type="number" class="man" min="0" max="100" step="any" id="iv_' + i.key + '" value="' + (Number(i.iva) || 0) + '" style="width:55px;color:var(--sk-mid);" oninput="manualIVA(' + i.key + ',this.value)"></td>' +
      '<td><input type="number" class="man" step="any" id="tt_' + i.key + '" value="' + totLinea(i).toFixed(2) + '" style="width:80px;color:var(--green);font-weight:700;font-size:13px;" oninput="manualTot(' + i.key + ',this.value)"></td>' + fin + "</tr>";
    return '<tr data-key="' + i.key + '" data-cod="' + esc(i.codigo) + '">' + cod + nom + cant +
      '<td style="color:var(--green);font-weight:700;">$' + fmt(i.base) + '</td><td style="color:var(--text-dim);">' + fmtCant(i.iva) + "%</td>" +
      '<td style="font-weight:700;" id="tt_' + i.key + '">$' + fmt(totLinea(i)) + "</td>" + fin + "</tr>";
  }).join("");
  marcarExistencias();
  pintarTotales();
}
// ── Sin existencia: la línea se marca en rojo (se puede vender igual; el sistema avisa al registrarla) ──
function faltasExistencia(){
  const c = cat(), out = [], vistos = {};
  F.items.forEach(i => {
    if (i.tipo === "servicio" || vistos[i.codigo]) return;
    vistos[i.codigo] = 1;
    const p = c.find(x => x.tipo === "producto" && String(x.codigo) === String(i.codigo)); if (!p) return;
    const disp = disponible(p), pide = r3(enFactura(i.codigo));
    if (pide > disp + 0.0005) out.push({ codigo: String(i.codigo), nombre: i.nombre, pide, disp: Math.max(0, disp), dep: enDeposito(p) });
  });
  return out;
}
function marcarExistencias(){
  const f = {}; faltasExistencia().forEach(x => f[x.codigo] = x);
  F.items.forEach(i => {
    const sp = $("sx_" + i.key); if (!sp) return;
    const x = f[String(i.codigo)], tr = sp.closest("tr");
    sp.classList.toggle("oculto", !x);
    sp.textContent = x ? "⚠️ Sin existencia suficiente: " + (x.disp > 0 ? "quedan " + fmtCant(x.disp) : "no queda ninguno") + (x.dep > 0 ? " en tienda" : "") + " y van " + fmtCant(x.pide) : "";
    if (tr) tr.classList.toggle("sin-ex-tr", !!x);
  });
}
// Al terminar de escribir la cantidad: si pasa de lo que hay, se avisa una vez por producto
async function revisarExistencia(key){
  const i = itemDe(key); if (!i || i.tipo === "servicio") return;
  const x = faltasExistencia().find(y => y.codigo === String(i.codigo));
  if (!x || F.avisoEx[x.codigo]) return;
  F.avisoEx[x.codigo] = true;
  await aviso({ icono: "📦", titulo: "No hay suficiente existencia", colorOk: "naranja",
    html: "De <b>" + esc(x.nombre) + "</b> " + (x.disp > 0 ? "quedan <b>" + fmtCant(x.disp) + "</b>" : "no queda <b>ninguno</b>") + (x.dep > 0 ? " en la tienda (y " + fmtCant(x.dep) + " en el depósito)" : "") + " según los datos de este equipo, y en la factura van <b>" + fmtCant(x.pide) + "</b>." +
      "<br><br>Si lo tienes en la mano, puedes venderlo: la línea queda marcada en rojo y al registrarse el sistema avisa que hay que revisar el inventario." });
}
function pintarTotales(){
  const x = totales(F.items, F.desc), T = totalConDlv(), bs = T.bs;
  $("subTotal").textContent = fmt(x.sub);
  $("ivaTotal").textContent = fmt(x.ivaR);
  $("rowDesc").classList.toggle("oculto", !(x.desc > 0));
  $("descMonto").textContent = fmt(x.desc);
  $("totalUSD").textContent = fmt(T.total);
  $("rowDeliv").classList.toggle("oculto", !(T.dlv > 0));
  $("delivLbl").textContent = (F.dlv.tipo === "envio" ? "📦 " : "🛵 ") + dlvTxt();
  $("delivMonto").textContent = fmt(T.dlv);
  $("delivNota").textContent = binOn() ? " BCV" : "";
  $("totalU").textContent = binOn() ? (unidadU() === "div" ? "div" : "BCV") : "";
  $("totalBS").textContent = fmt(bs);
  // Teléfono: el total abajo y cuántos productos van
  const n = F.items.length;
  $("mvTotUSD").textContent = "$ " + fmt(T.total) + (binOn() ? " " + unidadU() : "");
  $("mvTotBS").textContent = "Bs " + fmt(bs);
  $("mvCnt").textContent = n ? String(n) : "";
  $("mvCntTxt").textContent = n ? (n === 1 ? "1 producto" : n + " productos") : "Factura vacía";
  document.querySelectorAll("#listaProd .mv-add").forEach(b => { const q = cuantasEnFactura(b.dataset.cod); b.innerHTML = "+" + (q > 0 ? '<span class="mv-q">' + fmtCant(q) + "</span>" : ""); });
  // Cliente
  $("nombreClienteDisplay").textContent = F.cliente.nombre + (F.cliente.cedula ? " · " + F.cliente.cedula : "");
  $("btnLimpiarCli").classList.toggle("oculto", !F.cliente.cedula);
  if (!n && document.body.classList.contains("mv-fac") && window.innerWidth <= 820 && _mvAntes > 0) mvTab("productos");
  _mvAntes = n;
}
let _mvAntes = 0;
const itemDe = key => F.items.find(x => x.key === key);
function cambiarCant(key, v){
  const i = itemDe(key); if (!i) return;
  i.cantidad = v === "" ? "" : r3(v);
  const t = $("tt_" + key);   // sin repintar la tabla (no se pierde el cursor)
  if (t) { if (t.tagName === "INPUT") t.value = totLinea(i).toFixed(2); else t.textContent = "$" + fmt(totLinea(i)); }
  marcarExistencias();
  pintarTotales();
}
function pasoCant(key, d){
  const i = itemDe(key); if (!i) return;
  const nv = r3((Number(i.cantidad) || 0) + d);
  if (nv <= 0) return;   // a cero no baja: para quitar el producto está la ✕
  const inp = $("q_" + key); if (inp) inp.value = nv;
  cambiarCant(key, nv);
  if (d > 0) revisarExistencia(key);
}
function quitarLinea(key){ F.items = F.items.filter(x => x.key !== key); pintarFactura(); marcarEnFactura(); }
// El numerito del «+» de cada producto de la lista (cuántos van en la factura), sin volver a pintar la lista
function marcarEnFactura(){
  const box = $("listaProd"); if (!box) return;
  box.querySelectorAll(".mv-add[data-cod]").forEach(b => {
    const q = cuantasEnFactura(b.dataset.cod), sp = b.querySelector(".mv-q");
    if (q > 0) { if (sp) sp.textContent = fmtCant(q); else b.insertAdjacentHTML("beforeend", '<span class="mv-q">' + fmtCant(q) + "</span>"); }
    else if (sp) sp.remove();
  });
}
// Tipo de precio de una línea (Detal, Mayor… o Manual), como el selector TIPO de Ventas
async function cambiarTipoLinea(key, sel){
  const i = itemDe(key); if (!i) return;
  const val = sel.value, antes = i.manual ? "manual" : String(i.tipoIdx >= 0 ? i.tipoIdx : 0);
  if (val === "manual") {
    if (S.datos.pideClave && S.datos.pideClave.manual && !await claveFactura("Precio manual", "para cambiar el precio de <b>" + esc(i.nombre) + "</b>")) { sel.value = antes; return; }
    // Con TasaBin y un solo producto se pregunta en qué moneda va el precio (como Ventas)
    if (binOn() && F.items.length === 1) {
      const enDiv = await elegirMonedaManual();
      if (enDiv === null) { sel.value = antes; return; }
      if (enDiv !== !!F.dolares) { cambiarMoneda(true); }
    }
    i.manual = true; i.tipoIdx = -1;
    pintarFactura();
    setTimeout(() => { const inp = $("pu_" + key); if (inp) { inp.focus(); inp.select(); } }, 60);
    return;
  }
  const ti = Number(val) || 0, p = cat().find(x => x.codigo === i.codigo && x.tipo === i.tipo);
  i.manual = false; i.tipoIdx = ti;
  if (p) { const pr = precioDe(p, ti); i.libro = pr.base; i.iva = pr.iva; }
  pintarFactura(); marcarEnFactura();
}
function elegirMonedaManual(){
  const act = F.dolares ? "div" : "bcv";
  return modal({ icono: "💱", titulo: "¿En qué moneda va el precio?",
    html: '<div class="m-txt" style="margin-bottom:12px;">Ahora la factura está en <b>' + (F.dolares ? "Divisas (Venta en Dólares)" : "$ BCV") + "</b>. Si eliges la otra moneda, se " + (F.dolares ? "desmarca" : "marca") + " <b>💵 Venta en Dólares</b> y el precio actual se convierte antes de que lo escribas.</div>" +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;"><button type="button" class="mm-op' + (act === "div" ? " on" : "") + '" data-m="div">💵 Divisas</button><button type="button" class="mm-op' + (act === "bcv" ? " on" : "") + '" data-m="bcv">🧾 $ BCV</button></div>',
    botones: [{ txt: "Cancelar", v: null }],
    alAbrir: (box, cerrar) => box.querySelectorAll(".mm-op").forEach(b => b.addEventListener("click", () => cerrar(b.dataset.m === "div"))) });
}
// Precio manual escrito en la línea (en la moneda de la pantalla; el P.U. va sin IVA, como en Ventas)
function manualPU(key, v){
  const i = itemDe(key); if (!i) return;
  i.base = Math.max(0, Number(v) || 0); i.libro = libroDePantalla(i.base);   // S2: nunca negativo
  const t = $("tt_" + key); if (t) t.value = totLinea(i).toFixed(2);
  pintarTotales();
}
function manualIVA(key, v){
  const i = itemDe(key); if (!i) return;
  i.iva = Math.max(0, Math.min(100, Number(v) || 0));
  const t = $("tt_" + key), q = Number(i.cantidad) || 0;
  if (S.datos.ivaEncima || !t) { if (t) t.value = totLinea(i).toFixed(2); }
  else {   // el total escrito se queda: cambia el precio sin IVA
    const tot = Number(t.value) || 0;
    i.base = q > 0 ? tot / q / (1 + i.iva / 100) : 0; i.libro = libroDePantalla(i.base);
    const pu = $("pu_" + key); if (pu) pu.value = r2(i.base).toFixed(2);
  }
  pintarTotales();
}
function manualTot(key, v){
  const i = itemDe(key); if (!i) return;
  const q = Number(i.cantidad) || 0, tot = Math.max(0, Number(v) || 0);   // S2: nunca negativo
  i.base = q > 0 ? tot / q / (1 + (Number(i.iva) || 0) / 100) : 0;   // sin redondear: el total escrito no se desvía
  i.libro = libroDePantalla(i.base);
  const pu = $("pu_" + key); if (pu) pu.value = r2(i.base).toFixed(2);
  pintarTotales();
}
async function limpiarVentaConfirmar(){
  if (F.orden) { soltarOrden(); return; }   // la orden vuelve a la lista (ordenes.js)
  if (!F.items.length && !F.cliente.cedula && F.desc.tipo === "ninguno" && !dlvMonto()) return;
  const ok = await confirmar({ icono: "🗑️", titulo: "Vaciar la venta", html: "Se quitan los productos, el cliente, el descuento y el delivery de esta venta. No se guarda nada.", ok: "Sí, vaciar", colorOk: "red" });
  if (ok) limpiarVenta();
}
function limpiarVenta(){
  const tp = F.tipoPrecio;
  Object.assign(F, nuevaFactura()); F.tipoPrecio = tp;   // el vendedor vuelve al de la caja (como en Ventas)
  $("busca").value = "";
  pintarSelectores(); buscar(); pintarFactura();
  if (_verNueva && !_ventaGuardada) setTimeout(recargarSiSePuede, 300);
}
// ── Teléfono: pestañas y ajustes plegados (como Ventas) ──
function mvTab(cual){
  const fac = cual === "factura";
  document.body.classList.toggle("mv-fac", fac);
  $("mvTabProd").classList.toggle("on", !fac); $("mvTabFac").classList.toggle("on", fac);
}
function mvToggleAjustes(){
  const on = !document.body.classList.contains("mv-aj");
  document.body.classList.toggle("mv-aj", on);
  $("mvAjFlecha").textContent = on ? "▾" : "▸";
}

// ── Clave sin internet (descuento, precio manual, cambiar tasa) ──
async function sha256hex(t){
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
let _claveFallas = 0, _claveBloqHasta = 0;
// Con internet: la clave de precio manual del sistema (Configuración B8, la misma de Ventas), revisada en el servidor
// (5 intentos fallidos → 5 minutos de espera, igual que Ventas). Sin internet: la clave sin internet de este equipo.
// Devuelve "sistema" · "sinInternet" (con cuál se autorizó) o false.
function hayInternet(){ return S.online !== false && navigator.onLine !== false; }
async function pedirClave(titulo, para){
  const c = S.datos && S.datos.claveSinInternet, tieneSin = !!(c && c.salt && c.hash);
  let modo = hayInternet() && sesionViva() ? "sistema" : "sinInternet";
  if (modo === "sinInternet" && !tieneSin) {
    await aviso({ icono: "🔒", titulo: "Falta la clave sin internet", html: "Sin internet, para esto hace falta la <b>clave sin internet</b>, y este equipo no la tiene.<br><br>Se pone en el sistema: <b>Configuración → Administración → Caja nueva → 🔑 Clave sin internet</b>. El equipo la recibe la próxima vez que se actualice con internet." });
    return false;
  }
  const que = () => modo === "sistema" ? "la <b>clave de precio manual</b> del sistema (la misma de Ventas)" : "la <b>clave sin internet</b>";
  const r = await modal({
    icono: "🔒", titulo: titulo,
    html: '<div class="m-txt">Escribe <span id="mClaveQue">' + que() + "</span> " + para + ':</div><input class="inp" id="mClave" type="password" placeholder="' + (modo === "sistema" ? "Clave de precio manual" : "Clave sin internet") + '" autocomplete="off" style="margin-top:10px;" onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.closest(\'.modal\').querySelector(\'[data-v=ok]\').click();}"><div class="m-err" id="mClaveErr"></div>',
    botones: [{ txt: "Cancelar", v: false }, { txt: "✅ Verificar", v: true, cls: "green", spin: "Verificando…" }],
    foco: "mClave",
    antes: async (v) => {
      if (!v) return true;
      const err = $("mClaveErr"), val = $("mClave").value;
      if (!val) { err.textContent = "Escribe la clave."; return false; }
      if (modo === "sistema") {
        let res = null;
        try { res = await api("cj_clave", { clave: val }, 25000); } catch (e) { if (!e.red) { err.textContent = e.message; return false; } }
        if (res && res.ok) return true;
        if (res && res.codigo !== "SESION" && res.codigo !== "USUARIO" && res.codigo !== "EQUIPO") { err.textContent = res.msg || "La clave no es correcta."; $("mClave").value = ""; $("mClave").focus(); return false; }
        // Sin conexión con el sistema (o sin sesión): se sigue con la clave sin internet
        if (!tieneSin) { err.innerHTML = "No hay conexión con el sistema y este equipo no tiene clave sin internet. Vuelve a intentar cuando haya internet."; return false; }
        modo = "sinInternet";
        $("mClaveQue").innerHTML = que(); $("mClave").placeholder = "Clave sin internet"; $("mClave").value = ""; $("mClave").focus();
        err.textContent = "No hay conexión con el sistema: escribe la clave sin internet.";
        return false;
      }
      if (Date.now() < _claveBloqHasta) { err.textContent = "Demasiados intentos. Espera un minuto."; return false; }
      const h = await sha256hex(c.salt + val);
      if (h !== c.hash) {
        _claveFallas++;
        if (_claveFallas >= 5) { _claveBloqHasta = Date.now() + 60000; _claveFallas = 0; }
        err.textContent = "Clave incorrecta."; $("mClave").value = ""; $("mClave").focus(); return false;
      }
      _claveFallas = 0;
      return true;
    }
  });
  return r ? modo : false;
}
// La clave autoriza toda la factura en pantalla (como el permiso de Ventas)
async function claveFactura(titulo, para){
  if (F.claveOk) return true;
  const r = await pedirClave(titulo, para);
  if (!r) return false;
  F.claveOk = true; F.claveCon = r;
  return true;
}
// ── Descuento (en Ajustes, como en Ventas): Ninguno · Porcentaje · Monto ──
async function cambiarTipoDesc(sel){
  const v = sel.value;
  if (v !== "ninguno" && S.datos.pideClave && S.datos.pideClave.descuento && !await claveFactura("Descuento", "para hacer un descuento")) { sel.value = F.desc.tipo; return; }
  F.desc = { tipo: v, valor: v === F.desc.tipo ? F.desc.valor : 0 };
  pintarSelectores(); pintarTotales();
  if (v !== "ninguno") setTimeout(() => $("valorDescuento").focus(), 30);
}
function cambiarValorDesc(val){ F.desc.valor = Math.max(0, Number(val) || 0); pintarTotales(); }
function quitarDescuento(){ F.desc = { tipo: "ninguno", valor: 0 }; pintarSelectores(); pintarTotales(); }
// ══ VENTA DE OTRO DÍA (Tanda 1, 3.1) — como Ventas (TasasVenta.gs) ══
//  Para registrar una venta que se olvidó: va con su fecha y las tasas de ESE día (así no queda diferencial cambiario).
//  Se toca la fecha de la factura. Pide la misma clave que «Cambiar tasa» si Configuración la pide (N4). Con internet trae
//  las tasas que guardó el sistema ese día y avisa de las cuentas ya conciliadas; sin internet se escriben a mano.
//  Hasta FA_DIAS_MAX días atrás (el sistema no sube ventas más viejas). Su efectivo NO cuenta en el cierre de hoy.
const FA_DIAS_MAX = 60;
function diaMenos(n){ const d = new Date(); d.setDate(d.getDate() - n); return hoyTxt(d); }
function textoTasasFA(fa){
  fa = fa || F.fechaAnt; if (!fa) return "";
  if (binOn()) return "BCV <b>Bs " + fmt(fa.bcv) + "</b> · Divisas <b>Bs " + fmt(fa.div) + "</b>" + (fa.bcv > 0 && fa.div > 0 ? " (brecha " + fmt((fa.div / fa.bcv - 1) * 100) + " %)" : "");
  return "BCV <b>Bs " + fmt(fa.bcv) + "</b>" + (fa.div > 0 ? " · Divisas efectivo <b>Bs " + fmt(fa.div) + "</b>" : "");
}
async function abrirFechaVenta(){
  if (!S.datos || P || !puedeVender()) return;
  if (F.fechaAnt) {
    const r = await modal({ icono: "📅", titulo: "Venta de otro día", html: '<div class="m-txt">Esta venta lleva fecha del <b>' + fechaCorta(F.fechaAnt.fecha) + "</b> con las tasas de ese día: " + textoTasasFA() + ".</div>",
      botones: [{ txt: "Cancelar", v: false }, { txt: "↩️ Volver a hoy", v: "hoy" }, { txt: "✏️ Cambiar día o tasas", v: "cambiar", cls: "green" }] });
    if (r === "hoy") { ponerFechaAnt(null); return; }
    if (r !== "cambiar") return;
  } else if (S.datos.pideClave && S.datos.pideClave.tasa && !await claveFactura("Venta de otro día", "para registrar una venta con la fecha y las tasas de otro día")) return;
  const on = binOn(), hoy = hoyTxt(), min = diaMenos(FA_DIAS_MAX), ayer = diaMenos(1), ya = F.fechaAnt;
  let res = null;
  const r = await modal({
    icono: "📅", titulo: "Venta de otro día", clase: "fa-modal",
    html: '<div class="m-txt" style="font-size:13px;color:var(--text-dim);">Para una venta que se olvidó registrar. Se cobra completa con las tasas de ese día (precios, pago, vuelto, crédito y delivery); las tasas de hoy no se tocan. <b>Su efectivo no cuenta en el cierre de hoy.</b></div>' +
      '<div class="cs-preg"><span class="paso-n">1</span><span>¿De qué día es la venta?</span></div>' +
      '<input class="inp" id="faFecha" type="date" min="' + min + '" max="' + ayer + '" value="' + (ya ? ya.fecha : "") + '">' +
      '<div class="act-nota">Del ' + fechaCorta(min) + " hasta ayer.</div>" +
      '<div id="faTasas"' + (ya ? "" : ' class="oculto"') + '><div class="cs-preg"><span class="paso-n">2</span><span>Tasas de ese día</span></div>' +
        '<div class="act-nota" id="faEstado"></div>' +
        '<label class="lbl" for="faBcv">Tasa BCV de ese día (Bs por $1 BCV)</label><input class="inp" id="faBcv" type="number" inputmode="decimal" min="0" step="any" placeholder="Ej. 900,00" value="' + (ya ? ya.bcv : "") + '">' +
        (on ? '<label class="lbl" for="faBre">% de brecha cambiaria de ese día</label><input class="inp" id="faBre" type="number" inputmode="decimal" min="0" step="any" placeholder="Ej. 11,11">' +
              '<label class="lbl" for="faDiv">o la tasa Divisas de ese día (Bs por $1 en divisas), sin brecha</label><input class="inp" id="faDiv" type="number" inputmode="decimal" min="0" step="any" placeholder="Ej. 1000,00" value="' + (ya ? ya.div : "") + '">'
            : '<label class="lbl" for="faDiv">Tasa Divisas de ese día — los $ en efectivo (opcional)</label><input class="inp" id="faDiv" type="number" inputmode="decimal" min="0" step="any" placeholder="Opcional" value="' + (ya && ya.div ? ya.div : "") + '">') +
        '<div class="act-nota" id="faHint"></div><div class="banner av oculto" id="faConc" style="margin:10px 0 0;"></div></div>' +
      '<div class="m-err" id="faErr"></div>',
    botones: [{ txt: "Cancelar", v: false }, { txt: "✅ Usar esa fecha", v: true, cls: "green" }],
    foco: "faFecha",
    alAbrir: () => {
      const val = () => {
        const b = Number($("faBcv").value) || 0;
        if (!on) return { bcv: b, div: Number($("faDiv").value) || 0 };
        const pct = Number($("faBre").value) || 0, inp = $("faDiv");
        if (pct > 0) { const d = b > 0 ? r2(b * (1 + pct / 100)) : 0; inp.value = d > 0 ? d.toFixed(2) : ""; inp.disabled = true; return { bcv: b, div: d }; }
        inp.disabled = false; return { bcv: b, div: Number(inp.value) || 0 };
      };
      const hint = () => {
        const v = val();
        $("faHint").innerHTML = on && v.bcv > 0 && v.div > 0 ? "$1 BCV = <b>Bs " + fmt(v.bcv) + "</b> · $1 en divisas = <b>Bs " + fmt(v.div) + "</b> (brecha " + fmt((v.div / v.bcv - 1) * 100) + " %)" : "";
      };
      ["faBcv", "faBre", "faDiv"].forEach(id => { const e = $(id); if (e) e.addEventListener("input", hint); });
      let pide = 0;
      $("faFecha").addEventListener("change", async () => {
        const f = $("faFecha").value, est = $("faEstado"), conc = $("faConc");
        $("faErr").textContent = "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return;
        $("faTasas").classList.remove("oculto");
        ["faBcv", "faBre", "faDiv"].forEach(id => { const e = $(id); if (e) { e.value = ""; e.disabled = false; } });   // las de otro día no sirven
        conc.classList.add("oculto"); conc.innerHTML = "";
        const brHoy = on && Number((S.tasas || {}).brecha) > 0 ? Number(S.tasas.brecha) : 0;
        const ponerBrecha = () => { if (brHoy > 0 && !$("faBre").value && !$("faDiv").value) { $("faBre").value = String(r2(brHoy)); return true; } return false; };
        if (!hayInternet() || !sesionViva()) {
          est.innerHTML = "📡 Sin internet: escribe las tasas de ese día." + (ponerBrecha() ? " (Se puso tu % de brecha de hoy: revísalo.)" : "");
          hint(); return;
        }
        const yo = ++pide;
        est.textContent = "⏳ Buscando las tasas que guardó el sistema ese día…";
        let t = null;
        try { t = await api("cj_tasas_fecha", { fecha: f }, 20000); } catch (e) { t = null; }
        if (yo !== pide || $("faFecha").value !== f) return;
        if (!t || !t.ok) { est.innerHTML = "No pude buscar las tasas guardadas de ese día: escríbelas." + (ponerBrecha() ? " (Se puso tu % de brecha de hoy: revísalo.)" : ""); hint(); return; }
        const poner = (id, v) => { const e = $(id); if (e && !e.value && Number(v) > 0) e.value = String(r2(v)); };
        poner("faBcv", t.bcv);
        let br = false;
        if (on) { if (Number(t.div) > 0) poner("faDiv", t.div); else br = ponerBrecha(); }
        else poner("faDiv", t.divOff);
        est.innerHTML = t.encontrada ? "✅ Se llenaron con las tasas que guardó el sistema ese día. Revísalas." : "El sistema no tiene tasas guardadas de ese día: escríbelas." + (br ? " (Se puso tu % de brecha de hoy: revísalo.)" : "");
        if (t.conciliadas && t.conciliadas.length) {
          conc.innerHTML = "⚠️ Estas cuentas ya están conciliadas con el banco a esa fecha: <b>" + t.conciliadas.map(c => esc(c.cuenta) + " (hasta el " + esc(c.hasta) + ")").join(", ") + "</b>. No podrás cobrar esta venta con un método que entre a ellas.";
          conc.classList.remove("oculto");
        }
        hint();
      });
      if (ya) hint();
    },
    antes: (v) => {
      if (!v) return true;
      const err = $("faErr"), f = $("faFecha").value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) { err.textContent = "Elige el día de la venta."; return false; }
      if (f >= hoy) { err.textContent = "Para una venta de hoy no hace falta: cierra esta ventana. Una venta no puede llevar una fecha que todavía no llega."; return false; }
      if (f < min) { err.textContent = "El sistema no registra ventas de hace más de " + FA_DIAS_MAX + " días. Avísale al administrador."; return false; }
      const b = Number($("faBcv").value) || 0;
      if (!(b > 0)) { err.textContent = "Escribe la tasa BCV de ese día."; return false; }
      const bHoy = Number((S.tasas || {}).bcv) || 0;
      if (bHoy > 0 && (b > bHoy * 1.5 || b < bHoy * 0.3)) { err.textContent = "Esa tasa BCV (Bs " + fmt(b) + ") está muy lejos de la de hoy (Bs " + fmt(bHoy) + "). Revisa el número."; return false; }
      let d;
      if (on) {
        const pct = Number($("faBre").value) || 0;
        d = pct > 0 ? r2(b * (1 + pct / 100)) : Number($("faDiv").value) || 0;
        if (!(d > 0)) { err.textContent = "Escribe el % de brecha de ese día, o la tasa Divisas."; return false; }
        if (d < b) { err.textContent = "La tasa Divisas no puede quedar por debajo de la BCV."; return false; }
      } else {
        d = Number($("faDiv").value) || 0;
        if (d && d < b * 0.9) { err.textContent = "La tasa Divisas no puede quedar por debajo de la BCV."; return false; }
      }
      res = { fecha: f, bcv: b, div: d || 0 };
      return true;
    }
  });
  if (r && res) ponerFechaAnt(res);
}
// Pone (o quita, con null) la fecha de otro día: la factura en pantalla se recalcula con esas tasas
function ponerFechaAnt(fa){
  const antes = F.items.length ? totales(F.items, F.desc).total : null;
  F.fechaAnt = fa ? { fecha: fa.fecha, bcv: Number(fa.bcv) || 0, div: Number(fa.div) || 0 } : null;
  repreciar(); pintarSelectores(); buscar(); pintarFactura();
  const ahora = F.items.length ? totales(F.items, F.desc).total : null;
  if (antes != null && Math.abs(ahora - antes) >= 0.005)
    aviso({ icono: "💱", titulo: "Precios recalculados", html: (fa ? "La venta lleva fecha del <b>" + fechaCorta(fa.fecha) + "</b>: se usan las tasas de ese día." : "La venta vuelve a la fecha de hoy: se usan las tasas de hoy.") +
      "<br><br>Total: <b>" + txtU(antes) + "</b> → <b>" + txtU(ahora) + "</b> (Bs " + fmt(r2(ahora * bsPorU())) + ")." });
  else toast(fa ? "📅 Venta del " + fechaCorta(fa.fecha) + " con sus tasas" : "📅 La venta vuelve a hoy");
}
// ── Delivery / envío (Etapa 2B), como en Ventas: se escribe en $ BCV (es para el motorizado o la agencia) ──
//  En pantalla y en el ticket va SIEMPRE por su monto ($2), también en Venta en Dólares; sus Bs, a tasa BCV.
//  En los libros (el servidor) vale su monto en $ BCV pasado a divisas con TasaBin ($2 BCV = $1,80 div con 11,1 % de brecha).
function dlvMonto(){ return r2(Math.max(0, Number(F.dlv && F.dlv.monto) || 0)); }
function dlvLibro(m){ m = r2(Math.max(0, Number(m) || 0)); return binOn() && tBcv() > 0 && tDiv() > 0 && Math.abs(tDiv() - tBcv()) > 0.000001 ? r2(m * tBcv() / tDiv()) : m; }
function dlvTxt(t){ return (t || (F.dlv && F.dlv.tipo)) === "envio" ? "Envío" : "Delivery"; }
function cambiarDelivery(v){ F.dlv.monto = Math.max(0, Number(v) || 0); pintarTotales(); }
function cambiarTipoDelivery(v){ F.dlv.tipo = v === "envio" ? "envio" : "delivery"; pintarTotales(); }
// Total de la factura en pantalla con el delivery, y sus Bs (los productos a la tasa de la venta, el delivery a BCV)
function totalConDlv(){ const x = totales(F.items, F.desc), d = dlvMonto(); return { prod: x.total, dlv: d, total: r2(x.total + d), bs: r2(x.total * bsPorU() + d * tBcv()) }; }

// ── Clientes (como el modal de Ventas: buscar, elegir o crearlo ahí mismo) ──
const cedNorm = c => String(c == null ? "" : c).trim().replace(/\.0$/, "").toUpperCase();
// Los del sistema + los creados en este equipo que el sistema todavía no tiene
function clientesTodos(){
  const sis = (S.datos && S.datos.clientes) || [], ya = new Set(sis.map(c => cedNorm(c.cedula)));
  return sis.concat((S.clientesNuevos || []).filter(c => !ya.has(cedNorm(c.cedula))).map(c => Object.assign({ local: true }, c)));
}
function clienteDe(ced){ const k = cedNorm(ced); return k ? clientesTodos().find(c => cedNorm(c.cedula) === k) || null : null; }
function limpiarCliente(){ F.cliente = { cedula: "", nombre: "Genérico", direccion: "", telefono: "" }; pintarTotales(); }
function ponerCliente(c){
  F.cliente = c ? { cedula: String(c.cedula || ""), nombre: c.nombre || "Genérico", direccion: c.direccion || "", telefono: c.telefono || "", nuevo: !!c.local } : { cedula: "", nombre: "Genérico", direccion: "", telefono: "" };
  pintarTotales();
  if (P) { pgPintarMetodos(); pgPintarLineas(); pgActualizar(); }
}
// Un cliente que llegó del sistema (buscado o creado con internet) queda en los datos del equipo
async function guardarClienteSistema(c){
  if (!S.datos || !c) return;
  const k = cedNorm(c.cedula), l = S.datos.clientes || (S.datos.clientes = []);
  const i = l.findIndex(x => cedNorm(x.cedula) === k);
  const x = { cedula: String(c.cedula), nombre: c.nombre, direccion: c.direccion || "", telefono: c.telefono || "" };
  if (i >= 0) l[i] = x; else l.push(x);
  S.clientesNuevos = (S.clientesNuevos || []).filter(y => cedNorm(y.cedula) !== k);
  try { await kvSet("datos", S.datos); await kvSet("clientesNuevos", S.clientesNuevos); } catch (e) {}
}
// Elegir el cliente. modo "registrar": viene de ✅ Registrar Venta (al elegir sigue al pago)
async function abrirClientes(modo){
  let sel = -1, lista = [], remotos = [], tRem = null, qRem = "", remListo = "", elegido;   // elegido: undefined = cerró sin elegir · null = Genérico
  const pintar = () => {
    const q = $("cliBusca").value, n = norm(q), l = clientesTodos();
    lista = (!n ? l.slice(-80).reverse() : l.filter(c => norm(c.nombre).indexOf(n) >= 0 || norm(c.cedula).indexOf(n) >= 0).slice(0, 80));
    remotos.forEach(r => { if (!lista.some(c => cedNorm(c.cedula) === cedNorm(r.cedula)) && (norm(r.nombre).indexOf(n) >= 0 || norm(r.cedula).indexOf(n) >= 0)) lista.push(Object.assign({ remoto: true }, r)); });
    sel = lista.length ? Math.min(Math.max(sel, 0), lista.length - 1) : -1;
    $("cliTabla").innerHTML = lista.length ? lista.map((c, k) => '<tr data-k="' + k + '"' + (k === sel ? ' class="sel"' : "") + "><td>" + esc(c.cedula) + "</td><td>" + esc(c.nombre) +
      (c.remoto ? '<span class="cli-sist">del sistema</span>' : c.local ? '<span class="cli-loc">nuevo · por subir</span>' : "") + "</td><td>" + esc(c.direccion || "") + "</td><td>" + esc(c.telefono || "") + "</td></tr>").join("")
      : '<tr><td colspan="4" class="vacio" style="cursor:default;">' + (n ? "Ningún cliente con «" + esc(q) + "» en este equipo." + (remListo === n ? " Tampoco está en el sistema." : S.online !== false && navigator.onLine !== false && n.length >= 3 ? " Buscando en el sistema…" : "") : "Todavía no hay clientes en este equipo.") + "</td></tr>";
    // "No existe… créalo aquí" (con lo que se escribió ya puesto), como en Ventas
    const card = $("cliCrear");
    if (card.dataset.mano !== "1") {
      const ver = !!n && !lista.length;
      card.classList.toggle("oculto", !ver);
      if (ver) {
        const esCed = /\d{4,}/.test(q) && !/[a-zñáéíóú]{3,}/i.test(q);
        $("cliCrearTxt").innerHTML = "No existe un cliente con <b>" + esc(q.trim()) + "</b>. Créalo aquí:";
        $("qcCed").value = esCed ? q.trim() : ""; $("qcNom").value = esCed ? "" : q.trim();
      }
    }
    // Con internet: si en el equipo no está, se busca en el sistema (por si lo crearon después de descargar)
    clearTimeout(tRem);
    if (n.length >= 3 && !lista.length && S.online !== false && navigator.onLine !== false && qRem !== n) {
      tRem = setTimeout(async () => {
        qRem = n;
        try {
          const r = await api("cj_cliente", { op: "buscar", q: q.trim() }, 20000);
          if (r && r.ok && Array.isArray(r.clientes)) remotos = r.clientes;
        } catch (e) {}
        remListo = n;
        if ($("cliBusca") && norm($("cliBusca").value) === n) pintar();
      }, 500);
    }
  };
  const v = await modal({
    titulo: "👥 Clientes", clase: "clientes",
    html: '<div class="cli-barra"><button type="button" class="cli-gen" id="cliGen">🧾 Genérico (Sin cliente)</button>' +
      '<input class="cli-busca" id="cliBusca" type="search" placeholder="🔍 Cédula o nombre..." autocomplete="off">' +
      '<button type="button" class="cli-mas" id="cliMas" title="Crear cliente nuevo">➕</button></div>' +
      '<div class="form-section oculto" id="cliCrear" style="border-color:var(--border-g);"><div id="cliCrearTxt" style="font-size:13px;font-weight:700;margin-bottom:8px;">Cliente nuevo:</div>' +
      '<div class="form-grid fg2"><div class="fg"><label>Cédula *</label><input id="qcCed" placeholder="Ej: V-12345678" maxlength="20"></div><div class="fg"><label>Nombre *</label><input id="qcNom" placeholder="Nombre y apellido" maxlength="80"></div>' +
      '<div class="fg"><label>Teléfono</label><input id="qcTel" placeholder="Opcional" maxlength="30"></div><div class="fg"><label>Dirección</label><input id="qcDir" placeholder="Opcional" maxlength="120"></div></div>' +
      '<div class="m-err" id="qcErr"></div><div style="display:flex;justify-content:flex-end;gap:8px;"><button type="button" class="btn-m gray" id="qcCancel">Cancelar</button><button type="button" class="btn-m green" id="qcGuardar">💾 Guardar y continuar</button></div></div>' +
      '<div style="max-height:46vh;overflow:auto;border-radius:6px;"><table class="modal-table"><thead><tr><th>Cédula</th><th>Nombre</th><th>Dirección</th><th>Teléfono</th></tr></thead><tbody id="cliTabla"></tbody></table></div>',
    nota: ES_TACTIL ? "Toca un cliente para elegirlo" : "Doble clic para seleccionar",
    botones: [{ txt: "✅ Seleccionar", v: "sel", cls: "green" }],
    foco: "cliBusca",
    antes: (b) => { if (b !== "sel") return true; if (!lista[sel]) { toast("Elige un cliente de la lista"); return false; } return true; },
    alAbrir: (box, cerrar) => {
      const elegir = c => { elegido = c; cerrar("listo"); };
      pintar();
      $("cliBusca").addEventListener("input", () => { sel = 0; pintar(); });
      $("cliBusca").addEventListener("keydown", e => {
        const marcar = () => { $("cliTabla").querySelectorAll("tr[data-k]").forEach(x => x.classList.toggle("sel", Number(x.dataset.k) === sel)); const t = $("cliTabla").querySelector("tr.sel"); if (t) t.scrollIntoView({ block: "nearest" }); };
        if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, lista.length - 1); marcar(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); marcar(); }
        else if (e.key === "Enter") { e.preventDefault(); if (lista[sel]) elegir(lista[sel]); else if (!$("cliCrear").classList.contains("oculto")) ($("qcCed").value ? $("qcNom") : $("qcCed")).focus(); }
      });
      $("cliTabla").addEventListener("click", e => {
        const tr = e.target.closest("tr[data-k]"); if (!tr) return;
        sel = Number(tr.dataset.k);
        if (ES_TACTIL) { elegir(lista[sel]); return; }
        $("cliTabla").querySelectorAll("tr.sel").forEach(x => x.classList.remove("sel")); tr.classList.add("sel");   // sin repintar: el doble clic sigue funcionando
      });
      $("cliTabla").addEventListener("dblclick", e => { const tr = e.target.closest("tr[data-k]"); if (tr) elegir(lista[Number(tr.dataset.k)]); });
      $("cliGen").addEventListener("click", () => elegir(null));
      $("cliMas").addEventListener("click", () => {
        const card = $("cliCrear"); card.dataset.mano = "1"; card.classList.remove("oculto");
        $("cliCrearTxt").textContent = "Cliente nuevo:"; ["qcCed", "qcNom", "qcTel", "qcDir"].forEach(id => $(id).value = ""); $("qcErr").textContent = "";
        $("qcCed").focus();
      });
      $("qcCancel").addEventListener("click", () => { const card = $("cliCrear"); card.dataset.mano = ""; card.classList.add("oculto"); $("cliBusca").focus(); });
      ["qcCed", "qcNom", "qcTel", "qcDir"].forEach(id => $(id).addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("qcGuardar").click(); } }));
      $("qcGuardar").addEventListener("click", async () => {
        const c = await crearCliente($("qcGuardar"));
        if (c) { toast(c.local ? "✅ Cliente creado en este equipo (se sube con la venta)" : "✅ Cliente creado"); elegir(c); }
      });
    }
  });
  clearTimeout(tRem);
  if (v === "sel") elegido = lista[sel];
  if (elegido === undefined) return null;
  if (elegido && elegido.remoto) { await guardarClienteSistema(elegido); elegido = clienteDe(elegido.cedula) || elegido; }
  ponerCliente(elegido);
  if (modo === "registrar") setTimeout(() => abrirPago(), 30);
  return F.cliente;
}
// Crea el cliente: con internet en el sistema (la misma función de Ventas); sin internet, en el equipo
// (se crea en el sistema justo antes de registrar la venta que lo use).
async function crearCliente(btn){
  const err = $("qcErr");
  const c = { cedula: $("qcCed").value.trim(), nombre: $("qcNom").value.trim().replace(/\s+/g, " "), telefono: $("qcTel").value.trim(), direccion: $("qcDir").value.trim() };
  if (!c.cedula || !c.nombre) { err.textContent = "Para crear el cliente hacen falta la cédula y el nombre. El teléfono y la dirección son opcionales."; return null; }
  if (/[^A-Za-z0-9.\-\s]/.test(c.cedula)) { err.textContent = "La cédula solo puede llevar letras, números, puntos y guiones."; return null; }
  const ya = clienteDe(c.cedula);
  if (ya) { err.textContent = ""; await aviso({ icono: "👤", titulo: "Ese cliente ya existe", html: "La cédula <b>" + esc(c.cedula) + "</b> ya es de <b>" + esc(ya.nombre) + "</b>. Se eligió ese cliente." }); return ya; }
  err.textContent = "";
  btnOcupado(btn, "Guardando…");
  try {
    if (S.online === false || navigator.onLine === false) throw ErrRed("sin internet");
    const r = await api("cj_cliente", { op: "crear", cliente: c }, 30000);
    btnLibre(btn);
    if (r && r.ok && r.cliente) {
      await guardarClienteSistema(r.cliente);
      if (r.existia) await aviso({ icono: "👤", titulo: "Ese cliente ya existía", html: "En el sistema la cédula <b>" + esc(r.cliente.cedula) + "</b> ya es de <b>" + esc(r.cliente.nombre) + "</b>. Se eligió ese cliente." });
      return clienteDe(r.cliente.cedula) || r.cliente;
    }
    if (r && (r.codigo === "SESION" || r.codigo === "USUARIO" || r.codigo === "EQUIPO")) throw ErrRed(r.msg || "sin permiso");
    err.textContent = (r && r.msg) || "El sistema no pudo crear el cliente.";
    return null;
  } catch (e) {
    btnLibre(btn);
    if (!e.red) { err.textContent = e.message; return null; }
    // Sin internet (o sin sesión): queda en este equipo y se crea en el sistema al subir la venta
    const l = { cedula: c.cedula, nombre: c.nombre, telefono: c.telefono, direccion: c.direccion, creado: ahoraTxt() };
    S.clientesNuevos = (S.clientesNuevos || []).filter(x => cedNorm(x.cedula) !== cedNorm(c.cedula)).concat([l]);
    try { await kvSet("clientesNuevos", S.clientesNuevos); } catch (x) {}
    return Object.assign({ local: true }, l);
  }
}
// ✅ Registrar Venta, como en Ventas: si la factura está en Genérico, primero "¿A quién le vendes?"
// S2: solo se vende con la caja abierta por el cajero del turno (el Administrador que vino a cerrar el turno de otro no vende)
function puedeVender(){
  if (S.reemplazado) {   // 4.1 · un solo equipo por caja: otro equipo ya es esta caja
    try { cerrarPago(); } catch (e) {}
    aviso({ icono: "🧾", titulo: "Este equipo ya no es la caja", html: esc(S.permisoMal || "Otro equipo reemplazó a este.") + "<br><br>Las ventas que tenga guardadas se suben solas con internet. Cierra el turno en <b>☰ Menú → Cerrar turno</b>." });
    return false;
  }
  if (S.cierreAdmin || (typeof BQ !== "undefined" && BQ.on)) {
    try { cerrarPago(); } catch (e) {}
    aviso({ icono: "🔒", titulo: "No se puede vender ahora", html: S.cierreAdmin && S.turno
      ? "Un <b>administrador</b> (" + esc((S.cierreAdmin && S.cierreAdmin.nombre) || "") + ") entró solo para cerrar el turno de <b>" + esc(S.turno.cajeroNombre) + "</b>. Para vender, cierra ese turno y abre uno a tu nombre."
      : "La caja está bloqueada: el cajero del turno tiene que escribir su contraseña." });
    return false;
  }
  return true;
}
async function registrarVenta(){
  if (!puedeVender()) return;
  if (!F.items.length) { aviso({ icono: "🧾", titulo: "La venta está vacía", html: "Agrega al menos un producto." }); return; }
  const faltas = faltasExistencia();
  if (faltas.length && !await confirmar({ icono: "📦", titulo: "Hay productos sin existencia suficiente", colorOk: "naranja", ok: "Sí, vender igual",
    html: "Según los datos de este equipo no alcanza la existencia de:<ul style=\"margin:8px 0 8px 18px;line-height:1.6;\">" +
      faltas.map(x => "<li><b>" + esc(x.nombre) + "</b>: van " + fmtCant(x.pide) + ", " + (x.disp > 0 ? "quedan " + fmtCant(x.disp) : "no queda ninguno") + (x.dep > 0 ? " en tienda" : "") + "</li>").join("") +
      "</ul>Si los tienes en la mano, véndelos: la venta se registra igual y el sistema avisa que hay que revisar el inventario." })) return;
  if (!F.cliente.cedula) {
    const r = await modal({ icono: "", titulo: "🧾 ¿A quién le vendes?", centrado: true,
      html: '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;padding:6px 0;">' +
        '<button type="button" class="cli-op" data-o="gen"><span class="co-ico">🧾</span><span><span class="co-tit">Genérico</span><span class="co-sub">Sin datos del cliente</span></span></button>' +
        '<button type="button" class="cli-op prim" data-o="cli"><span class="co-ico">👤</span><span><span class="co-tit">Cliente</span><span class="co-sub">Buscarlo o registrarlo</span></span></button></div>',
      botones: [],
      alAbrir: (box, cerrar) => { box.querySelectorAll(".cli-op").forEach(b => b.addEventListener("click", () => cerrar(b.dataset.o))); setTimeout(() => { const p = box.querySelector(".cli-op.prim"); if (p) p.focus(); }, 50); } });
    if (r === "cli") { abrirClientes("registrar"); return; }
    if (r !== "gen") return;
  }
  abrirPago();
}

// ══ MONEDA DE LA VENTA (igual que Ventas) ══
//  · TasaBin APAGADO ("off"): todo en $ BCV; los $ en efectivo valen a tasa Divisas efectivo (H9).
//  · TasaBin ENCENDIDO: los precios del sistema están en $ divisas (la base, la "unidad de los libros").
//      venta en Bs a BCV ("bcv"): en pantalla $ BCV = divisas × Divisas ÷ BCV; los Bs a tasa BCV.
//      Venta en Dólares ("div"): en pantalla $ divisas; los $ a la par y los Bs a tasa Divisas.
//  El servidor recibe cada línea en la unidad de los libros (como Ventas) y cobra con las mismas reglas.
function binOn(){ return !!(S.tasas && S.tasas.binOn); }
// Tanda 1: con una venta de OTRO DÍA (📅), toda la pantalla usa las tasas de ese día (precios, pago, vuelto, crédito,
// delivery), como Ventas. Las tasas del equipo (S.tasas) no se tocan.
function tasasVenta(){ const t = S.tasas || {}; return F.fechaAnt ? Object.assign({}, t, { bcv: F.fechaAnt.bcv, div: F.fechaAnt.div }) : t; }
function tBcv(){ return Number(tasasVenta().bcv) || 0; }
function tDiv(){ const t = tasasVenta(); return Number(t.div) > 0 ? Number(t.div) : tBcv(); }   // ON: tasa Divisas (H7)
function tDivOff(){ const t = tasasVenta(); return !binOn() && Number(t.div) > 0 ? Number(t.div) : 0; }   // OFF: Divisas de los $ en efectivo (H9)
function tasaUsd(){ return binOn() ? tDiv() : (tDivOff() || tBcv()); }
function modoVenta(){ return !binOn() ? "off" : (F.dolares ? "div" : "bcv"); }
function unidadU(){ return modoVenta() === "div" ? "div" : "BCV"; }   // unidad de la pantalla
function unidadL(){ return modoVenta() === "off" ? "BCV" : "div"; }   // unidad de los libros
function bsPorU(){ return modoVenta() === "div" ? tDiv() : tBcv(); }  // Bs que vale $1 de la pantalla
function factorCxC(){ return (tBcv() > 0 && tDiv() > 0) ? Math.round(tBcv() / tDiv() * 1e6) / 1e6 : 1; }
const txtU = v => "$" + fmt(v) + " " + unidadU();
const txtL = v => "$" + fmt(v) + " " + unidadL();
// Base de una línea en la pantalla, a partir de su base en los libros (la que manda el sistema)
function basePantalla(libro, manual){
  const x = Number(libro) || 0;
  if (modoVenta() !== "bcv" || !(tBcv() > 0) || !(tDiv() > 0)) return manual ? x : r2(x);
  return manual ? x * tDiv() / tBcv() : r2(x * tDiv() / tBcv());
}
// Base en los libros de lo que el cajero ve en pantalla (precio manual)
function libroDePantalla(base){
  const x = Number(base) || 0;
  return (modoVenta() === "bcv" && tBcv() > 0 && tDiv() > 0) ? x * tBcv() / tDiv() : x;
}
// Las líneas de la factura con las tasas y la moneda de ahora (la base en los libros no cambia)
function repreciar(){ F.items.forEach(i => { i.base = basePantalla(i.libro, i.manual); }); }
// Venta en Dólares (solo con TasaBin encendido): toda la factura cambia de moneda, como en Ventas
function cambiarMoneda(){
  if (!binOn()) return;
  F.dolares = !F.dolares;
  repreciar(); pintarSelectores(); buscar(); pintarFactura();
  if (F.desc.tipo === "monto") { F.desc = { tipo: "ninguno", valor: 0 }; pintarTotales(); aviso({ icono: "🏷️", titulo: "Se quitó el descuento", html: "El descuento era un monto en $ " + (F.dolares ? "BCV" : "divisas") + ". Si sigue, vuelve a ponerlo en " + (F.dolares ? "$ divisas" : "$ BCV") + "." }); }
  toast(F.dolares ? "💵 Venta en Dólares" : "🧾 Venta en Bs a tasa BCV");
}
// Total en los libros, igual que lo suma el servidor (registrarVentaDesdeHTML)
function valorLibro(items, desc){
  let sub = 0, iva = 0;
  (items || []).forEach(i => { const q = Number(i.cantidad) || 0, p = Number(i.libro) || 0; sub += p * q; iva += p * ((Number(i.iva) || 0) / 100) * q; });
  const f = totales(items, desc).f;
  return r2(sub - Math.round(sub * f * 100) / 100 + Math.round(iva * (1 - f) * 100) / 100);
}
// Descuento por monto en la unidad del servidor: el MISMO factor de la pantalla aplicado a los libros (como Ventas)
function descuentoServidor(items, desc){
  const v = Number(desc && desc.valor) || 0;
  if (!desc || desc.tipo !== "monto" || !(v > 0)) return v;
  const x = totales(items, { tipo: "ninguno" }), tp = x.total;
  if (!(tp > 0)) return v;
  let tl = 0;
  (items || []).forEach(i => { tl += (Number(i.libro) || 0) * (1 + (Number(i.iva) || 0) / 100) * (Number(i.cantidad) || 0); });
  return Math.min(v, tp) / tp * tl;
}

// ══ COBRAR ══
function metodos(){ return (S.datos.metodos || []); }
function metodoCredito(){ const m = metodos().find(x => x.tipo === "CRED"); return m ? m.metodo : ""; }
async function abrirPago(){
  if (!puedeVender()) return;
  if (!F.items.length) { aviso({ icono: "🧾", titulo: "La venta está vacía", html: "Agrega al menos un producto." }); return; }
  const malas = F.items.filter(i => !(Number(i.cantidad) > 0));
  if (malas.length) { aviso({ icono: "🔢", titulo: "Falta una cantidad", html: "La línea <b>" + esc(malas[0].nombre) + "</b> no tiene cantidad. Escríbela o quita la línea con ✕." }); return; }
  const t = tasasVenta();   // Tanda 1: con venta de otro día, las de ese día
  if (!(t.bcv > 0)) { aviso({ icono: "💱", titulo: "Falta la tasa", html: "Este equipo no tiene tasa BCV. Actualiza los datos con internet, o ponla en ⚙️ → Cambiar tasa." }); return; }
  if (binOn() && !(Number(t.div) > 0)) { aviso({ icono: "💱", titulo: "Falta la tasa Divisas", html: "Este negocio trabaja con TasaBin y el equipo no tiene la tasa Divisas. Actualiza los datos con internet, o ponla en ⚙️ → Cambiar tasa." }); return; }
  if (!F.fechaAnt && t.fecha !== hoyTxt() && S.tasaOkHoy !== hoyTxt()) {
    const r = await modal({ icono: "💱", titulo: "¿La tasa sigue igual?",
      html: '<div class="m-txt">' + (t.origen === "sistema" && S.online !== false ? "<b>El sistema todavía no ha actualizado la tasa BCV de hoy</b>: tiene la del <b>" + fechaCorta(t.fecha) + "</b>" : "Las tasas de este equipo son del <b>" + fechaCorta(t.fecha) + "</b>") + ": " + textoTasas() +
        ".<br><br>Si hoy son otras, cámbialas antes de cobrar (pide la clave)" + (t.origen === "sistema" && S.online !== false ? " y avísale al administrador" : "") + ".</div>",
      botones: [{ txt: "🔒 Cambiar tasa", v: "cambiar" }, { txt: "Sí, cobrar con esas", v: "ok", cls: "green" }] });
    if (r === "cambiar") { await cambiarTasa(null); return; }
    if (r !== "ok") return;
    S.tasaOkHoy = hoyTxt();
  }
  repreciar();
  const T = totalConDlv(), m = modoVenta(), aparte = m === "div" && T.dlv > 0;   // Venta en Dólares con delivery: se cobra en dos pasos
  const tot = aparte ? T.prod : T.total;
  P = { modo: m, lineas: [], cred: { on: false, monto: "", editado: false }, vt: { on: false, lineas: [] }, seq: 0, verMet: false, dias: 0, total: tot, desbloq: false,
        dlvMonto: T.dlv, dlv: { on: aparte, monto: T.dlv, tipo: F.dlv.tipo, modo: "", metodo: "" },
        cs: { on: false, pct: 0, inicial: "", orden: "" }, saf: { disp: 0, on: false, monto: "", ced: "", pide: 0 },   // Tanda 1: Cashea y saldo a favor
        paso: "1", tipo: "", credTodo: null, como: "", listo: null, sinVuelto: false, verOtros: false };   // 3.5: el pago en pasos
  if (aparte) {
    $("pgTotal").innerHTML = '<div class="tp-filas"><div class="tp-fila"><span>🛒 Productos</span><span>$' + fmt(T.prod) + ' <small>div</small></span></div>' +
      '<div class="tp-fila"><span>' + (F.dlv.tipo === "envio" ? "📦 " : "🛵 ") + dlvTxt() + '</span><span>$' + fmt(T.dlv) + " <small>(o Bs " + fmt(r2(T.dlv * tBcv())) + ")</small></span></div></div>";
    $("pgTotalBs").textContent = "";
  } else {
    $("pgTotal").innerHTML = "$ " + fmt(tot) + "<small>" + unidadU() + "</small>";
    $("pgTotalBs").textContent = "Bs " + fmt(r2(tot * bsPorU())) + (T.dlv > 0 ? " · incluye " + dlvTxt().toLowerCase() + " $" + fmt(T.dlv) : "");
  }
  $("pgPaso1").classList.toggle("oculto", !aparte); $("pgPaso1M").textContent = "$" + fmt(T.prod);
  $("pgHint").innerHTML = m === "div"
    ? "💵 <b>Venta en Dólares</b>: los $ van a la par · los Bs a tasa Divisas <b>Bs " + fmt(tDiv()) + "</b>."
    : "Venta en <b>$ BCV</b>: los Bs van a tasa BCV <b>Bs " + fmt(tBcv()) + "</b> · los $ a la tasa que elijas en cada línea" +
      (m === "off" && !tDivOff() ? " (este negocio no tiene tasa Divisas: los $ valen a la BCV)" : "") + "." +
    (F.fechaAnt ? "<br>📅 <b>Venta del " + fechaCorta(F.fechaAnt.fecha) + "</b>, con las tasas de ese día." : "");
  $("pgRef").value = ""; $("pgObs").value = "";
  $("pgForm").classList.remove("oculto"); $("pgOk").classList.add("oculto");
  $("pgPie").classList.remove("oculto"); $("pgPieOk").classList.add("oculto"); $("pgX").classList.remove("oculto"); $("pgTit").textContent = "💳 Pago del cliente";
  $("pgCerrar").disabled = false; btnLibre($("pgGuardar"));
  const pl = (S.datos.plazosCredito || []).filter(p => p.activo && p.dias > 0);
  $("selDias").innerHTML = pl.map(p => '<option value="' + p.dias + '">' + p.dias + " días</option>").join("") + '<option value="0">Sin plazo</option>';
  P.dias = pl.length ? pl[0].dias : 0; $("selDias").value = String(P.dias);
  pgPintarExtras(); pgPintarMetodos(); pgPintarLineas(); pgPintarVuelto(); pgActualizar();
  pgWzPintar();   // 3.5
  $("mPago").classList.remove("oculto");
  setTimeout(() => { const b = document.querySelector("#pgP1 .pw-op"); if (b && P && P.paso === "1") b.focus(); }, 40);
  pgSafCargar();   // Tanda 1: ¿el cliente tiene saldo a favor? (con internet)
}
function cerrarPago(){ $("mPago").classList.add("oculto"); P = null; if (window.innerWidth > 820) setTimeout(() => { if (!document.querySelector(".mfondo:not(.oculto)")) $("busca").focus(); }, 30); }   // no le quita el cursor a otro modal
// ── Cuánto cubre (en la pantalla) y cuánto vale (en los libros) cada línea: las mismas cuentas de Ventas ──
function pgTasaLinea(l){   // Bs por $ a la que se aceptan los dólares de la línea (solo $, y no en Venta en Dólares)
  if (l.tipo !== "USD" || P.modo === "div") return 0;
  if (l.tasaModo === "otra") return Number(l.tasaOtra) || 0;
  if (l.tasaModo === "bcv") return tBcv();
  return P.modo === "off" ? (tDivOff() || tBcv()) : tDiv();
}
function pgCubre(l){
  const v = Number(l.monto) || 0; if (!(v > 0)) return 0;
  if (l.tipo === "BS") return v / bsPorU();
  if (P.modo === "div") return v;
  return tBcv() > 0 ? v * pgTasaLinea(l) / tBcv() : 0;
}
function pgVale(l){
  const v = Number(l.monto) || 0; if (!(v > 0)) return 0;
  if (l.tipo === "BS") return P.modo === "off" ? v / tBcv() : v / tDiv();
  if (P.modo === "off") { const t = tDivOff() || pgTasaLinea(l); return tBcv() > 0 ? r2(v * t / tBcv()) : 0; }   // igual que el servidor (equivBCV)
  return v;
}
function pgTasaVueltoUSD(){
  const l = P.lineas.find(x => x.tipo === "USD" && pgTasaLinea(x) > 0);
  if (l) return pgTasaLinea(l);
  return P.modo === "off" ? (tDivOff() || tBcv()) : tDiv();
}
function pgCubreVt(v){
  const x = Number(v.monto) || 0; if (!(x > 0)) return 0;
  if (v.tipo === "BS") return x / bsPorU();
  if (P.modo === "div") return x;
  return tBcv() > 0 ? x * pgTasaVueltoUSD() / tBcv() : 0;
}
function pgValeVt(v){
  const x = Number(v.monto) || 0; if (!(x > 0)) return 0;
  if (v.tipo === "BS") return P.modo === "off" ? x / tBcv() : x / tDiv();
  if (P.modo === "off") { const t = tDivOff() || pgTasaVueltoUSD(); return tBcv() > 0 ? r2(x * t / tBcv()) : 0; }
  return x;
}
function pgCredValor(){ return P.cred.on ? r2(Number(P.cred.monto) || 0) : 0; }
function pgEstado(){
  let cub = 0, vale = 0;
  P.lineas.forEach(l => { cub += pgCubre(l); vale += pgVale(l); });
  const sp = pgSafPant(); if (sp > 0) { cub += sp; vale += pgSafDiv(); }   // Tanda 1: lo que paga el saldo a favor (en divisas, como el servidor)
  const cred = pgCredValor(), credVale = P.modo === "bcv" ? r2(cred * factorCxC()) : cred;
  const cubT = cub + cred, N = P.total;
  const pendX = N - cubT, pend = r2(pendX);   // > 0 falta · < 0 sobra
  let vtCub = 0, vtVale = 0;
  if (P.vt.on) P.vt.lineas.forEach(v => { vtCub += pgCubreVt(v); vtVale += pgValeVt(v); });
  const quedaX = -pendX - vtCub, queda = r2(quedaX);
  const valorVenta = r2(valorLibro(F.items, F.desc) + (P.dlv.on ? 0 : dlvLibro(P.dlvMonto)));   // en dos pasos, el paso 1 es solo de los productos
  const dif = r2(vale + credVale - vtVale - valorVenta);
  return { cub: r2(cub), cred, credVale, cubT: r2(cubT), pend, pendX, vtCub: r2(vtCub), vtVale: r2(vtVale), queda, quedaX, vale: r2(vale), valorVenta, dif, hay: P.lineas.length > 0 || P.cred.on || sp > 0 };
}
// ── Métodos de pago como en Ventas (mismo agrupado y mismas etiquetas) ──
const PGU_GRUPOS = {
  BS: [["pagomovil", "📱", "Pago Móvil"], ["punto", "💳", "Punto de venta"], ["biopago", "👆", "Biopago"], ["transferencia", "🏦", "Transferencia"], ["efectivo", "💵", "Efectivo Bs"], ["otro", "▫️", "Otros"]],
  USD: [["efectivo", "💵", "Efectivo $"], ["zelle", "🌐", "Zelle"], ["binance", "🪙", "Binance"], ["paypal", "🅿️", "PayPal"], ["transferencia", "🏦", "Transferencia"], ["otro", "▫️", "Otros"]]
};
function pguNorm(s){ return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim(); }
function pguTipoAuto(nombre, moneda){
  const n = pguNorm(nombre);
  if (moneda === "USD") {
    if (/zelle/.test(n)) return "zelle";
    if (/binance|usdt|cripto|crypto/.test(n)) return "binance";
    if (/paypal/.test(n)) return "paypal";
    if (/efectivo|cash|caja|billete/.test(n)) return "efectivo";
    if (/transf|wire|ach/.test(n)) return "transferencia";
    if (/divisa|dolar/.test(n)) return "efectivo";
    return "otro";
  }
  if (/pago ?movil|p\.? ?movil|\bpm\b/.test(n)) return "pagomovil";
  if (/biopago/.test(n)) return "biopago";
  if (/punto|\bpos\b|tarjeta|debito/.test(n)) return "punto";
  if (/transf/.test(n)) return "transferencia";
  if (/efectivo|cash|caja|billete/.test(n)) return "efectivo";
  return "otro";
}
function pguTipoDe(m){
  const t = String((S.datos.tiposMetodo || {})[m.metodo] || "").toLowerCase();
  return (PGU_GRUPOS[m.tipo] || []).some(g => g[0] === t) ? t : pguTipoAuto(m.metodo, m.tipo);
}
function pguGrupo(m){ return (PGU_GRUPOS[m.tipo] || []).find(g => g[0] === pguTipoDe(m)) || ["otro", "▫️", "Otros"]; }
function pguCuentaNombre(m){ const id = String((S.datos.mapeo || {})[m.metodo] || "").trim(); return id ? String((S.datos.nombresCuentas || {})[id] || "") : ""; }
// Botón = nombre de la cuenta. Si dos métodos del mismo tipo van a la misma cuenta, o no se sabe la cuenta: el nombre del método.
function pguEtiqueta(m){
  const cta = pguCuentaNombre(m); if (!cta) return m.metodo;
  const t = pguTipoDe(m), id = (S.datos.mapeo || {})[m.metodo];
  const rep = metodos().filter(x => x.tipo === m.tipo && pguTipoDe(x) === t && (S.datos.mapeo || {})[x.metodo] === id).length > 1;
  return rep ? m.metodo : cta;
}
function pguDesc(m){
  if (!m) return "";
  const g = pguGrupo(m), e = pguEtiqueta(m);
  return g[1] + " " + (pguNorm(e) === pguNorm(g[2]) || pguNorm(e).indexOf(pguNorm(g[2])) === 0 ? e : g[2] + " · " + e);
}
function metodoDe(nombre){ return metodos().find(x => x.metodo === nombre) || null; }
function pgFilasMetodos(fn, usados, conCredito, soloMon){
  const cols = [];
  [["BS", "bs", "💙 En bolívares"], ["USD", "usd", "💚 En dólares"]].forEach(([mon, cls, tit]) => {
    if (soloMon && soloMon !== mon) return;   // 3.5: el paso ② muestra solo la moneda elegida
    const ms = metodos().map((m, i) => ({ m, i })).filter(o => o.m.tipo === mon);
    if (!ms.length) return;
    let h = '<div class="pgu-col"><div class="pgu-mon-tit ' + cls + '">' + tit + "</div>";
    PGU_GRUPOS[mon].forEach(g => {
      const del = ms.filter(o => pguTipoDe(o.m) === g[0]); if (!del.length) return;
      h += '<div class="pgu-fila"><span class="pgu-grp">' + g[1] + " " + g[2] + '</span><div class="pgu-chips">' + del.map(o => {
        const ok = o.m.conCuenta, us = usados.indexOf(o.m.metodo) >= 0;
        return '<button type="button" class="pgu-chip ' + cls + (us ? " usado" : "") + '"' + (ok ? "" : " disabled") + ' title="' + esc(o.m.metodo + (ok ? "" : " — sin cuenta asociada")) + '" onclick="' + fn + "(" + o.i + ')">' + esc(pguEtiqueta(o.m)) + (ok ? "" : " (sin cuenta)") + "</button>";
      }).join("") + "</div></div>";
    });
    cols.push(h + "</div>");
  });
  let html = '<div class="pgu-cols' + (cols.length < 2 ? " una" : "") + '">' + cols.join("") + "</div>";
  if (conCredito && metodoCredito() && !(P && P.cs.on)) html += '<div class="pgu-mon-tit otros">Otros</div><div class="pgu-fila linea1"><span class="pgu-grp">📝 A crédito</span><div class="pgu-chips"><button type="button" class="pgu-chip cred' + (P.cred.on ? " on" : "") + '" onclick="pgCredito()">' + (P.cred.on ? "✓ Crédito" : "Crédito") + "</button></div></div>";
  return html;
}
function pgPintarMetodos(){ $("pgMetodos").innerHTML = pgFilasMetodos("pgAgregar", P.lineas.map(l => l.metodo), true); }
// Tasa de los $ de una línea (no en Venta en Dólares): BCV · Divisas · Otra (con clave, si Configuración la pide)
function pgTasasHTML(l){
  if (l.tipo !== "USD" || P.modo === "div") return "";
  const td = P.modo === "off" ? tDivOff() : tDiv();
  const chip = (modo, txt, dis) => '<button type="button" class="off-chip' + (l.tasaModo === modo ? " on" : "") + '"' + (dis ? " disabled" : "") + ' onclick="pgElegirTasa(' + l.id + ",'" + modo + "')\">" + txt + "</button>";
  return '<div class="pl-tasas"><span class="pl-tlbl">Tasa:</span>' + chip("bcv", "BCV " + fmt(tBcv())) + chip("div", "Divisas " + (td > 0 ? fmt(td) : "—"), !(td > 0)) +
    chip("otra", (S.datos.pideClave && S.datos.pideClave.tasa && !P.desbloq && !F.claveOk ? "🔒 " : "") + "Otra") +
    (l.tasaModo === "otra" ? '<input type="number" inputmode="decimal" min="0" step="any" id="pgT_' + l.id + '" placeholder="Bs por $" value="' + (Number(l.tasaOtra) > 0 ? l.tasaOtra : "") + '" oninput="pgTasaOtra(' + l.id + ',this.value)">' : "") + "</div>";
}
function pgPintarLineas(){
  let h = "";
  const resto = pgResto();
  P.lineas.forEach(l => {
    const cls = l.tipo === "BS" ? "bs" : "usd", mon = l.tipo === "BS" ? "Bs" : "$";
    const cab = '<div class="pl-cab"><span>' + esc(pguDesc(metodoDe(l.metodo) || { metodo: l.metodo, tipo: l.tipo })) + '</span><button type="button" class="pgu-x" onclick="pgQuitar(' + l.id + ')" title="Quitar">✕</button></div>';
    if (l === resto && pgEsEf(l)) {   // 3.5: efectivo por lo que falta: se cobra exacto y se pregunta con cuánto pagó (para el vuelto)
      h += '<div class="pl ' + cls + ' pl-ef">' + cab + '<div class="pl-cobra">Cobra <b id="pgX_' + l.id + '">' + (l.tipo === "BS" ? "Bs " : "$") + fmt(l.exacto || 0) + "</b></div>" +
        '<label class="pl-lbl" for="pgR_' + l.id + '">¿Con cuánto te pagó?</label><div class="pl-cuerpo"><span class="mon">' + mon + '</span><input type="number" inputmode="decimal" min="0" step="any" id="pgR_' + l.id + '" placeholder="Vacío = exacto" value="' + esc(pgRecibidoVal(l)) + '" oninput="pgRecibido(' + l.id + ',this.value)">' +
        pgTasasHTML(l) + '</div><div class="pl-eq" id="pgE_' + l.id + '"></div></div>';
      return;
    }
    const ph = P.tipo === "credito" ? "¿Cuánto paga ahora en " + mon + "?" : (l === resto ? "Monto en " + mon : "¿Cuánto paga en " + mon + "?");
    h += '<div class="pl ' + cls + '">' + cab +
      '<div class="pl-cuerpo"><span class="mon">' + mon + '</span><input type="number" inputmode="decimal" min="0" step="any" id="pgM_' + l.id + '" placeholder="' + ph + '" value="' + esc(l.monto) + '" oninput="pgMonto(' + l.id + ',this.value)">' +
      pgTasasHTML(l) + '</div><div class="pl-eq" id="pgE_' + l.id + '"></div></div>';
  });
  if (P.cred.on && P.cred.cashea) {   // Tanda 1: lo que financia Cashea (sale del inicial; no se escribe)
    h += '<div class="pl cred cs"><div class="pl-cab"><span>🛍️ Cashea financia · ' + esc(F.cliente.nombre) + '</span></div><div class="pl-cuerpo"><b class="cs-fin">Bs ' + fmt(r2(pgCredValor() * tBcv())) + '</b> <span class="cs-fin-u">$' + fmt(pgCredValor()) + ' a la BCV</span></div><div class="pl-eq" id="pgE_cred"></div></div>';   // 1b: en Bs a la BCV
  } else if (P.cred.on) {
    h += '<div class="pl cred"><div class="pl-cab"><span>📝 Queda a deber · ' + esc(F.cliente.nombre) + '</span></div>' +
      '<div class="pl-cuerpo"><span class="mon">$</span><input type="number" inputmode="decimal" min="0" step="any" id="pgCred" placeholder="Monto a crédito ($ ' + unidadU() + ')" value="' + esc(P.cred.monto) + '" oninput="P.cred.monto=this.value;P.cred.editado=true;pgActualizar()">' +
      '<button type="button" class="btn-m gray" onclick="P.cred.editado=false;pgActualizar();$(\'pgCred\').value=P.cred.monto;">↺ Lo que falta</button></div><div class="pl-eq" id="pgE_cred"></div></div>';
  }
  $("pgLineas").innerHTML = h;
}
function pgPintarVuelto(){
  $("pgVuelto").classList.toggle("oculto", !P.vt.on);
  if (!P.vt.on) return;
  $("pgVtMetodos").innerHTML = P.vt.lineas.length >= 2 ? "" : pgFilasMetodos("pgVtAgregar", P.vt.lineas.map(v => v.metodo), false);
  $("pgVtLineas").innerHTML = P.vt.lineas.map((v, k) => '<div class="pl vt"><div class="pl-cab"><span>💸 ' + esc(pguDesc(metodoDe(v.metodo) || { metodo: v.metodo, tipo: v.tipo })) + '</span><button type="button" class="pgu-x" onclick="pgVtQuitar(' + k + ')" title="Quitar">✕</button></div>' +
    '<div class="pl-cuerpo"><span class="mon">' + (v.tipo === "BS" ? "Bs" : "$") + '</span><input type="number" inputmode="decimal" min="0" step="any" id="pgVM_' + k + '" placeholder="Vuelto en ' + (v.tipo === "BS" ? "Bs" : "$") + '" value="' + esc(v.monto) + '" oninput="P.vt.lineas[' + k + '].monto=this.value;pgActualizar()"></div><div class="pl-eq" id="pgVE_' + k + '"></div></div>').join("");
}
function pgActualizar(){
  if (!P) return;
  const m = P.modo;
  if (P.cred.on && !P.cred.editado) {
    let cub = pgSafPant(); P.lineas.forEach(l => cub += pgCubre(l));
    const rest = r2(P.total - cub);
    P.cred.monto = rest > 0 ? rest.toFixed(2) : "";
    const inp = $("pgCred"); if (inp && document.activeElement !== inp) inp.value = P.cred.monto;
  }
  P.lineas.forEach(l => {
    const el = $("pgE_" + l.id); if (!el) return;
    if (!(Number(l.monto) > 0)) { el.innerHTML = ""; return; }
    let t = "cubre <b>" + txtU(pgCubre(l)) + "</b>";
    if (m !== "div" && l.tipo === "BS") t += " (Bs " + fmt(l.monto) + " ÷ " + fmt(tBcv()) + ")";
    if (m === "div" && l.tipo === "BS") t += " (Bs " + fmt(l.monto) + " ÷ " + fmt(tDiv()) + ")";
    if (l.tipo === "USD" && m !== "div") t += " (a Bs " + fmt(pgTasaLinea(l)) + ")";
    if (m === "bcv") t += " · vale <b>" + txtL(pgVale(l)) + "</b>";
    else if (m === "off" && l.tipo === "USD") t += " · vale <b>" + txtL(pgVale(l)) + "</b>" + (tDivOff() > 0 ? " (a Divisas Bs " + fmt(tDivOff()) + ")" : "");
    el.innerHTML = t;
  });
  const ec = $("pgE_cred");
  if (ec) { const c = pgCredValor(), q = P.cred.cashea ? "a nombre de Cashea: " : "queda a deber "; ec.innerHTML = c > 0 ? (m === "bcv" ? q + "<b>" + txtU(c) + "</b>, fijo en BCV · hoy vale <b>$" + fmt(r2(c * factorCxC())) + " div</b>" : q + "<b>" + txtU(c) + "</b>") : ""; }
  P.vt.lineas.forEach((v, k) => { const el = $("pgVE_" + k); if (el) el.innerHTML = Number(v.monto) > 0 ? "devuelve <b>" + txtU(pgCubreVt(v)) + "</b>" + (m !== "div" ? " · vale " + txtL(pgValeVt(v)) : "") : ""; });
  const st = pgEstado();
  const bs = v => " · Bs " + fmt(r2(v * bsPorU()));
  let h = "";
  if (st.hay) {
    if (st.pend > TOL) h = '<div class="bal falta">⚠️ Falta ' + txtU(st.pend) + bs(st.pendX) + "</div>";
    else if (st.pend < -TOL && !P.vt.on) h = '<div class="bal sobra">💰 Sobran ' + txtU(-st.pend) + bs(-st.pendX) + "</div>" + (P.sinVuelto   // 3.6: el vuelto va en su propio paso
        ? '<div class="pw-sinvt">No se da vuelto: queda como diferencial a favor.</div>'
        : '<div class="pw-sinvt">Toca <b>Siguiente →</b> para elegir en qué le das el vuelto.</div>');
    else if (P.vt.on && st.pend < -TOL) {
      if (Math.abs(st.queda) <= TOL) h = '<div class="bal ok">✅ Pago exacto con vuelto</div>';
      else if (st.queda > 0) h = '<div class="bal sobra">Faltan ' + txtU(st.queda) + " por devolver" + bs(st.queda) + "</div>";
      else h = '<div class="bal falta">⚠️ El vuelto pasa de lo que sobra por ' + txtU(-st.queda) + "</div>";
    } else h = '<div class="bal ok">' + (P.dlv.on ? "✅ Productos pagados: " + txtU(P.total) : "✅ Pago exacto: cubierto " + txtU(P.total) + " de " + txtU(P.total)) + "</div>";
    if (st.pend <= TOL && Math.abs(st.dif) > 0.01 && !(st.pend < -TOL && !P.vt.on)) {
      const favor = st.dif > 0;
      h += '<div class="dif ' + (favor ? "afavor" : "encontra") + '">💹 Diferencial ' + (favor ? "a favor" : "en contra") + ": <b>" + txtL(Math.abs(st.dif)) + "</b>. Lo recibido vale " + txtL(r2(st.vale + st.credVale - st.vtVale)) + " y la venta vale " + txtL(st.valorVenta) + "." + pgMotivoDif() + "</div>";
    }
  }
  $("pgBal").innerHTML = h;
  $("pgVtSobra").textContent = st.pend < -TOL ? "Sobran " + txtU(-st.pend) + " · Bs " + fmt(r2(-st.pendX * bsPorU())) : "";
  const plegar = st.hay && st.pend <= TOL && !P.verMet;
  $("pgMetodos").classList.toggle("oculto", plegar);
  $("pgMas").classList.toggle("oculto", !plegar);
  const vm = $("pgVtMetodos"); if (vm && P.vt.on) vm.classList.toggle("oculto", P.vt.lineas.length >= 2 || (P.vt.lineas.length > 0 && Math.abs(st.queda) <= TOL));
  $("pgDias").classList.toggle("oculto", !(((P.cred.on && !P.cred.cashea) || P.dlv.modo === "cred") && $("selDias").options.length > 1));
  pgDlvPintar();
  const todo = $("pgTodo");
  if (!P.dlv.on) todo.innerHTML = "";
  else {
    const uno = st.hay && st.pend <= TOL, dos = !!pgDlvListo();
    todo.innerHTML = uno && dos ? '<div class="pg-todo ok">✅ Todo pagado. Toca <b>Registrar</b>.</div>'
      : '<div class="pg-todo falta">Falta: ' + [uno ? "" : "① los productos", dos ? "" : "② el " + dlvTxt(P.dlv.tipo).toLowerCase()].filter(Boolean).join(" y ") + "</div>";
  }
  $("pgLineasTit").classList.toggle("oculto", !(P.lineas.length || P.cred.on));
  pgExtrasTxt();
}
function pgMotivoDif(){
  const lu = P.lineas.filter(l => l.tipo === "USD" && Number(l.monto) > 0);
  if (P.modo === "bcv") {
    if (lu.some(l => l.tasaModo === "bcv")) return " Cobraste dólares a tasa BCV: cada $1 cubrió $1 BCV y vale $1 div.";
    if (lu.some(l => l.tasaModo === "otra")) return " Aceptaste dólares a una tasa distinta de la Divisas.";
    if (P.vt.on) return " El vuelto se dio por un valor distinto de lo que sobraba.";
  }
  if (P.modo === "off" && lu.length && tDivOff() > 0) return " Los $ en efectivo valen a tasa Divisas (Bs " + fmt(tDivOff()) + "), no a la tasa con que se cobraron.";
  return "";
}
function pgAutocompletar(l){
  let otros = 0; P.lineas.forEach(x => { if (x.id !== l.id) otros += pgCubre(x); });
  if (P.cred.on && P.cred.editado) otros += pgCredValor();
  otros += pgSafPant();   // Tanda 1
  const N = P.total, falta = Math.max(0, r2(N - otros));
  let v = 0;
  if (l.tipo === "BS") v = P.modo === "div" ? r2(falta * tDiv()) : r2(r2(N * tBcv()) - otros * tBcv());   // en Bs exactos: suman el total del ticket
  else v = P.modo === "div" ? r2(falta) : (pgTasaLinea(l) > 0 ? r2(falta * tBcv() / pgTasaLinea(l)) : 0);
  l.monto = v > 0.004 ? v.toFixed(2) : "";
  const inp = $("pgM_" + l.id); if (inp) inp.value = l.monto;
}
function pgAgregar(i){
  const m = metodos()[i]; if (!m) return;
  const ya = P.lineas.find(l => l.metodo === m.metodo);
  if (ya) { const inp = $("pgM_" + ya.id); if (inp) { inp.focus(); inp.select(); } return; }
  if (P.lineas.length >= 3) { aviso({ icono: "💳", titulo: "Máximo 3 métodos", html: "Una venta se puede cobrar con hasta 3 métodos de pago. Quita uno con ✕ para usar otro." }); return; }
  const l = { id: ++P.seq, metodo: m.metodo, tipo: m.tipo, monto: "", tasaModo: P.modo === "off" ? (tDivOff() > 0 ? "div" : "bcv") : "div", tasaOtra: "" };
  P.lineas.push(l);
  if (P.tipo === "credito") l.monto = ""; else pgWzSync();   // 3.5: con crédito se escribe lo que paga ahora; si no, va lo que falta
  pgPintarMetodos(); pgPintarLineas(); pgActualizar();
  setTimeout(() => { const inp = $("pgM_" + l.id); if (inp) { inp.focus(); inp.select(); } }, 30);
}
function pgQuitar(id){ P.lineas = P.lineas.filter(l => l.id !== id); P.listo = null; pgWzSync(); pgPintarMetodos(); pgPintarLineas(); pgVtAjustar(); pgActualizar(); }
function pgMonto(id, v){ const l = P.lineas.find(x => x.id === id); if (l) { l.monto = v; P.listo = null; if (l === pgResto()) l.recibido = v; else pgWzSync(); pgVtAjustar(); pgActualizar(); if (P.paso) pgWzBarra(); } }
async function pgElegirTasa(id, modo){
  const l = P.lineas.find(x => x.id === id); if (!l) return;
  if (modo === "otra" && S.datos.pideClave && S.datos.pideClave.tasa && !P.desbloq) {
    if (!await claveFactura("Otra tasa de cobro", "para cobrar los dólares a otra tasa")) return;
  }
  if (modo === "otra") P.desbloq = true;
  l.tasaModo = modo;
  pgPintarLineas();
  if (modo === "otra") setTimeout(() => { const t = $("pgT_" + id); if (t) t.focus(); }, 30);
  else pgWzSync();
  pgVtAjustar(); pgActualizar();
}
function pgTasaOtra(id, val){
  const l = P.lineas.find(x => x.id === id); if (!l) return;
  l.tasaOtra = val;
  if (Number(val) > 0) pgWzSync();
  pgVtAjustar(); pgActualizar();
}
// El crédito necesita un cliente con cédula: si la venta está en Genérico, se elige (o se crea) antes
async function pgClienteParaCredito(){
  if (F.cliente.cedula) return true;
  const r = await modal({ icono: "👤", titulo: "El crédito necesita un cliente", html: '<div class="m-txt">La venta a crédito queda como cuenta por cobrar a nombre del cliente. Esta venta está a nombre de <b>Genérico</b>.<br><br>Sin internet solo se pueden usar los clientes que ya existen en el sistema.</div>',
    botones: [{ txt: "Cancelar", v: false }, { txt: "👤 Elegir cliente", v: true, cls: "green" }] });
  if (!r) return false;
  const ant = F.cliente.cedula, c = await abrirClientes();
  if (P && F.cliente.cedula !== ant) pgSafCargar();   // Tanda 1: el saldo a favor es del cliente nuevo
  return !!(c && F.cliente.cedula);
}
async function pgCredito(){
  if (P.cred.on) { P.cred = { on: false, monto: "", editado: false }; }
  else {
    if (!await pgClienteParaCredito()) return;
    P.cred = { on: true, monto: "", editado: false };
  }
  pgPintarMetodos(); pgPintarLineas(); pgActualizar();
}
// ══ COBRO EN DOS PASOS: Venta en Dólares con delivery (Etapa 2B) ══
//  Paso 1: los productos, con el cobro de siempre. Paso 2: el delivery, sin escribir montos:
//   💵 en dólares por su monto ($2: lo que pasa de su valor queda como ingreso extra, como en Ventas)
//   🇻🇪 en bolívares a tasa BCV (Bs 80) · 📝 a crédito por lo que vale ($2 BCV = $1,80 div), junto con lo que quede a deber.
function pgDlvMetodos(tipo){ return metodos().map((m, i) => ({ m, i })).filter(o => o.m.tipo === tipo && o.m.conCuenta); }
function pgDlvListo(){
  const d = P && P.dlv; if (!d || !d.on) return "";
  if (d.modo === "cred") return "a crédito ($" + fmt(dlvLibro(d.monto)) + ")";
  if ((d.modo === "usd" || d.modo === "bs") && d.metodo) return pguDesc(metodoDe(d.metodo) || { metodo: d.metodo, tipo: d.modo === "usd" ? "USD" : "BS" }) + " " + (d.modo === "usd" ? "$" + fmt(d.monto) : "Bs " + fmt(r2(d.monto * tBcv())));
  return "";
}
function pgDlvPintar(){
  const box = $("pgDlv");
  if (!P || !P.dlv.on) { box.classList.add("oculto"); box.innerHTML = ""; return; }
  const d = P.dlv, bs = r2(d.monto * tBcv()), nom = dlvTxt(d.tipo), lst = pgDlvListo();
  const op = (k, t, b, sub) => '<button type="button" class="dlv-op' + (d.modo === k ? " on" : "") + '" data-dlv="' + k + '" onclick="pgDlvModo(\'' + k + '\')">' + t + "<b>" + b + "</b>" + (sub ? "<small>" + sub + "</small>" : "") + "</button>";
  let h = '<div class="dlv-paso"><div class="paso-tit"><span><span class="paso-n">2</span>¿Cómo paga el ' + nom.toUpperCase() + "?</span><b>" + (d.tipo === "envio" ? "📦" : "🛵") + '</b></div><div class="dlv-ops">' +
    (pgDlvMetodos("USD").length ? op("usd", "💵 En dólares", "$" + fmt(d.monto)) : "") +
    (pgDlvMetodos("BS").length ? op("bs", "🇻🇪 En bolívares", "Bs " + fmt(bs)) : "") +
    (metodoCredito() ? op("cred", "📝 A crédito", "$" + fmt(dlvLibro(d.monto)), "se suma a lo que queda a deber") : "") + "</div>";
  if (d.modo === "usd" || d.modo === "bs") {
    const L = pgDlvMetodos(d.modo === "usd" ? "USD" : "BS");
    h += '<div class="dlv-donde">¿Por dónde paga los ' + (d.modo === "usd" ? "$" + fmt(d.monto) : "Bs " + fmt(bs)) + '?</div><div class="pgu-chips">' +
      L.map(o => '<button type="button" class="pgu-chip ' + (d.modo === "usd" ? "usd" : "bs") + (d.metodo === o.m.metodo ? " sel" : "") + '" onclick="pgDlvMetodo(' + o.i + ')">' + esc(pguDesc(o.m)) + "</button>").join("") + "</div>";
  }
  h += lst ? '<div class="dlv-ok">✅ ' + esc(nom) + " pagado: " + esc(lst) + "</div>" : '<div class="dlv-falta">👆 Elige cómo paga el ' + nom.toLowerCase() + ".</div>";
  box.innerHTML = h + "</div>";
  box.classList.remove("oculto");
}
async function pgDlvModo(k){
  const d = P && P.dlv; if (!d) return;
  if (k === "cred" && !await pgClienteParaCredito()) return;
  if (!P) return;
  d.modo = k; d.metodo = "";
  if (k !== "cred") { const L = pgDlvMetodos(k === "usd" ? "USD" : "BS"); if (L.length === 1) d.metodo = L[0].m.metodo; }
  pgActualizar();
}
function pgDlvMetodo(i){ const m = metodos()[i]; if (!m || !P) return; P.dlv.metodo = m.metodo; pgActualizar(); }
function pgVueltoAbrir(){ P.vt = { on: true, lineas: [] }; pgPintarVuelto(); pgActualizar(); }
function pgVueltoCerrar(){ P.vt = { on: false, lineas: [] }; P.listo = null; pgPintarVuelto(); pgActualizar(); if (P.paso === "V") pgWzPintar(); }
function pgVtAgregar(i){
  const m = metodos()[i]; if (!m || P.vt.lineas.length >= 2 || P.vt.lineas.some(v => v.metodo === m.metodo)) return;
  const v = { metodo: m.metodo, tipo: m.tipo, monto: "" };
  P.vt.lineas.push(v);
  const st = pgEstado(), resto = Math.max(0, st.quedaX);   // sin redondear: el vuelto en Bs sale exacto
  const x = v.tipo === "BS" ? r2(resto * bsPorU()) : (P.modo === "div" ? r2(resto) : r2(resto * tBcv() / pgTasaVueltoUSD()));
  v.monto = x > 0.004 ? x.toFixed(2) : "";
  pgPintarVuelto(); pgActualizar();
  const k = P.vt.lineas.length - 1;
  setTimeout(() => { const inp = $("pgVM_" + k); if (inp) { inp.focus(); inp.select(); } }, 30);
}
function pgVtQuitar(k){ P.vt.lineas.splice(k, 1); pgPintarVuelto(); pgActualizar(); }

// ══ PAGO EN PASOS (3.5, 8-11-2026) — «que hasta un niño lo entienda» ══
//  ① ¿La venta incluye crédito?  No, paga todo ahora · Sí, queda a deber (todo, o una parte ahora) · Con Cashea (el inicial)
//  ② ¿Cómo paga?  💙 Bs · 💚 $ · 🔀 Pago mixto (Bs y $), y por dónde (los métodos de esa moneda)
//  ③ ¿Cuánto?  Lo que falta va solo en el último método. En efectivo: «¿Con cuánto te pagó?» y el vuelto, ahí mismo.
//  [Delivery]  Venta en Dólares con delivery: cómo paga el delivery (como antes, paso aparte)
//  ④ Revisar y registrar.  Las cuentas, tasas, revisiones y lo que se guarda son los mismos de siempre (pgConfirmar).
function pgEsEf(l){ return !!l && esEfectivo({ metodo: l.metodo, tipo: l.tipo }); }
// El método que se lleva «lo que falta» (el último). Con crédito no hay: lo que no se paga queda a deber.
function pgResto(){ return (!P || P.tipo === "credito") ? null : (P.lineas[P.lineas.length - 1] || null); }
function pgWzSync(){
  const r = pgResto(); if (!r) return;
  pgAutocompletar(r);
  r.exacto = Number(r.monto) || 0;
  if (Number(r.recibido) > 0) r.monto = String(r2(Number(r.recibido)));   // lo que escribió el cajero manda (efectivo o no)
  const x = $("pgX_" + r.id); if (x) x.textContent = (r.tipo === "BS" ? "Bs " : "$") + fmt(r.exacto);
  const ri = $("pgR_" + r.id); if (ri && document.activeElement !== ri) ri.value = pgRecibidoVal(r);   // 3.6: trae el total (se puede cambiar)
}
// 3.6: «¿Con cuánto te pagó?» trae el total de una vez; si lo cambia, queda lo que escribió
function pgRecibidoVal(l){ return l.recibido !== "" && l.recibido != null ? String(l.recibido) : ((Number(l.exacto) || 0) > 0 ? (Number(l.exacto)).toFixed(2) : ""); }
function pgRecibido(id, v){
  const l = P && P.lineas.find(x => x.id === id); if (!l) return;
  l.recibido = v; P.listo = null;
  pgWzSync(); pgVtAjustar(); pgActualizar(); pgWzBarra();
}
// Si cambia lo que sobra y el vuelto es de un solo método, el vuelto se ajusta solo
function pgVtAjustar(){
  if (!P || !P.vt.on || P.vt.lineas.length !== 1) return;
  const st = pgEstado(), sobra = -st.pendX;
  if (!(sobra > TOL)) { pgVueltoCerrar(); return; }
  const v = P.vt.lineas[0];
  const x = v.tipo === "BS" ? r2(sobra * bsPorU()) : (P.modo === "div" ? r2(sobra) : r2(sobra * tBcv() / pgTasaVueltoUSD()));
  v.monto = x > 0.004 ? x.toFixed(2) : "";
  const inp = $("pgVM_0"); if (inp && document.activeElement !== inp) inp.value = v.monto;
}
function pgVtDirecto(i){ if (!P) return; P.vt = { on: true, lineas: [] }; P.sinVuelto = false; P.listo = null; pgVtAgregar(i); pgWzPintar(); }
function pgWzSinVuelto(si){ if (!P) return; P.sinVuelto = si; P.listo = null; if (si && P.vt.on) pgVueltoCerrar(); pgActualizar(); pgWzPintar(); }
// Lo que se paga ahora (sin lo que paga el saldo a favor ni lo que financia Cashea), en la unidad de la venta
function pgPorPagarAhora(){ return P ? r2(P.total - pgSafPant() - (P.cred.on && P.cred.cashea ? pgCredValor() : 0)) : 0; }
function pgUsdDe(x){ return P.modo === "div" ? r2(x) : r2(x * tBcv() / ((P.modo === "off" ? (tDivOff() || tBcv()) : tDiv()) || tBcv())); }
function pgNadaAhora(){ return !!P && ((P.tipo === "credito" && P.credTodo === true) || (P.tipo !== "credito" && !!P.tipo && pgPorPagarAhora() <= TOL)); }
function pgWzPasos(){
  const salta = pgNadaAhora();
  const l = [["1", "Pago"], ["2", "Moneda"], ["M", "Método"], ["3", "Monto"]];
  if (!salta && (P.vt.on || P.sinVuelto || pgHaySobra())) l.push(["V", "Vuelto"]);   // 3.6: solo si sobra
  if (P.dlv.on) l.push(["D", P.dlv.tipo === "envio" ? "Envío" : "Delivery"]);
  l.push(["4", "Revisar"]);
  return l.map(x => ({ k: x[0], lbl: x[1], salta: salta && (x[0] === "2" || x[0] === "M" || x[0] === "3") }));
}
function pgHaySobra(){ return !!P && P.lineas.length > 0 && pgEstado().pend < -TOL; }
function pgIr(k){
  if (!P) return;
  P.paso = k; if (k !== "4") P.listo = null; P.verOtros = false;
  if (k === "3" || k === "V") { pgWzSync(); pgPintarLineas(); pgVtAjustar(); pgPintarVuelto(); pgActualizar(); }
  pgWzPintar();
  setTimeout(() => {
    if (!P || P.paso !== k) return;
    let f = null;
    if (k === "3") f = [...document.querySelectorAll("#pgLineas input")].find(i => !i.value) || document.querySelector("#pgLineas input");
    else if (k === "4") f = $("pgGuardar");
    else if (k === "1" || k === "2") f = document.querySelector("#pgS" + k + " .pw-op.on") || document.querySelector("#pgS" + k + " .pw-op:not([disabled])");
    else if (k === "M" || k === "V") f = document.querySelector("#pgS" + k + " .pgu-chip:not([disabled])") || $("pgSig");
    else f = $("pgSig");
    if (f && (window.innerWidth > 820 || f.tagName === "BUTTON")) f.focus();
  }, 40);
}
function pgWzCard(on, fn, ico, tit, sub, dis){
  return '<button type="button" class="pw-op' + (on ? " on" : "") + (ico ? "" : " sin-ico") + '"' + (dis ? " disabled" : "") + ' onclick="' + fn + '">' + (ico ? '<span class="pw-ico">' + ico + "</span>" : "") + "<span class=\"pw-t\"><b>" + tit + "</b>" + (sub ? "<small>" + sub + "</small>" : "") + "</span></button>";
}
function pgDiasHTML(id){
  const pl = (S.datos.plazosCredito || []).filter(p => p.activo && p.dias > 0);
  if (!pl.length) { P.dias = 0; return ""; }
  return '<div class="pw-dias"><label for="' + id + '">📅 Días de crédito</label><select class="inp" id="' + id + '" onchange="P.dias=Number(this.value)||0;P.listo=null">' +
    pl.map(p => '<option value="' + p.dias + '"' + (Number(P.dias) === p.dias ? " selected" : "") + ">" + p.dias + " días</option>").join("") + '<option value="0"' + (Number(P.dias) === 0 ? " selected" : "") + ">Sin plazo</option></select></div>";
}
// La barra de pasos (también al escribir: el paso «Vuelto» aparece si sobra)
function pgWzBarra(){
  if (!P || !$("pgPasos")) return -1;
  const k = P.paso, pasos = pgWzPasos().filter(x => !x.salta), idx = pasos.findIndex(x => x.k === k);
  $("pgPasos").innerHTML = pasos.map((x, i) => '<div class="paso ' + (i === idx ? "activo" : i < idx ? "hecho" : "") + '"' + (i < idx ? ' onclick="pgIr(\'' + x.k + '\')"' : "") + "><b>" + (i < idx ? "✓" : i + 1) + '</b><span class="lbl">' + x.lbl + "</span></div>").join("");
  return idx;
}
function pgWzPintar(){
  if (!P) return;
  const k = P.paso, idx = pgWzBarra();
  ["1", "2", "M", "3", "V", "D", "4"].forEach(s => $("pgS" + s).classList.toggle("oculto", s !== k));
  $("pgHint").classList.toggle("oculto", !(k === "2" || k === "M" || k === "3"));
  // ① ¿La venta incluye crédito?
  if (k === "1") {
    const div = P.modo === "div";
    let h = '<div class="pw-preg">¿Cómo pagará el cliente?</div><div class="pw-ops">' +
      pgWzCard(P.tipo === "contado", "pgWzTipo('contado')", "✅", "De contado", "Paga todo ahora") +
      (metodoCredito() ? pgWzCard(P.tipo === "credito", "pgWzTipo('credito')", "📝", "Con crédito", "Total o parcial") : "") +
      (pgCsPuede() && !P.dlv.on ? pgWzCard(P.tipo === "cashea", "pgWzTipo('cashea')", '<span class="cs-marca">Cashea</span>', "Con Cashea", div ? "Va a precio BCV: quita 💵 Venta en Dólares para usarlo" : "Paga un inicial y Cashea el resto", div) : "") + "</div>";
    if (P.tipo === "credito") {
      const resto = r2(P.total - pgSafPant());
      h += pgDiasHTML("pgDiasSel") + '<div class="pw-preg pw-sub">¿Crédito total o parcial?</div><div class="pw-ops dos">' +
        pgWzCard(P.credTodo === true, "pgWzCredTodo(true)", "", "Crédito total", "Queda a deber " + txtU(resto)) +
        pgWzCard(P.credTodo === false, "pgWzCredTodo(false)", "", "Crédito parcial", "Paga una parte ahora y el resto queda a deber") + "</div>";
    }
    $("pgP1").innerHTML = h;
  }
  // ② ¿Cómo paga?
  if (k === "2") {
    const ahora = pgPorPagarAhora(), parte = P.tipo === "credito", hayBs = metodos().some(m => m.tipo === "BS"), hayUsd = metodos().some(m => m.tipo === "USD");
    let h = '<div class="pw-preg">' + (P.tipo === "cashea" ? "¿En qué moneda paga el inicial?" : parte ? "¿En qué moneda paga la parte de contado?" : "¿En qué moneda paga?") + "</div>" +
      (!P.cs.on && P.saf.disp > 0.004 && !P.saf.on ? '<div class="pw-aviso">🎁 ' + esc(F.cliente.nombre) + " tiene <b>" + txtU(pgSafDispPant()) + '</b> a favor. Para usarlo, toca <button type="button" class="lnk" onclick="pgIr(\'1\')">← el primer paso</button>.</div>' : "") +
      '<div class="pw-ops tres">' +
      (hayBs ? pgWzCard(P.como === "BS", "pgWzComo('BS')", "", "Bolívares", parte ? "" : "Bs " + fmt(r2(ahora * bsPorU()))) : "") +
      (hayUsd ? pgWzCard(P.como === "USD", "pgWzComo('USD')", "", "Dólares", parte ? "" : "$" + fmt(pgUsdDe(ahora))) : "") +
      (hayBs && hayUsd ? pgWzCard(P.como === "MIX", "pgWzComo('MIX')", "", "Pago mixto", "Una parte en Bs y otra en $") : "") + "</div>";
    $("pgP2").innerHTML = h;
  }
  // ③ El método (3.6: pantalla aparte, solo de la moneda elegida)
  if (k === "M") {
    const mon = P.como === "BS" ? "Bolívares" : P.como === "USD" ? "Dólares" : "";
    $("pgPM").innerHTML = '<div class="pw-preg">' + (P.como === "MIX" ? "Toca un método en <b>Bs</b> y uno en <b>$</b>" : "¿Por dónde paga en " + mon + "?") + "</div>" +
      pgFilasMetodos("pgWzMetodo", P.lineas.map(l => l.metodo), false, P.como === "MIX" ? null : P.como);
  }
  // ③ ¿Cuánto?
  if (k === "3") {
    const mix = P.lineas.some(l => l.tipo === "BS") && P.lineas.some(l => l.tipo === "USD");
    $("pgP3").innerHTML = '<div class="pw-preg">' + (P.tipo === "credito" ? "¿Cuánto paga ahora?" : mix ? "¿Cuánto paga en " + (P.lineas[0].tipo === "USD" ? "$" : "Bs") + "? Lo demás se calcula solo." : "¿Cuánto paga?") + "</div>" +
      (P.tipo === "credito" ? '<div class="cie-ayuda" style="text-align:center;">Lo que no pague ahora queda a deber.</div>' : "");
    $("pgOtrosBox").innerHTML = P.lineas.length >= 3 ? "" : (P.verOtros
      ? '<div class="pw-preg pw-sub">Toca el otro método</div>' + pgFilasMetodos("pgWzOtro", P.lineas.map(l => l.metodo), false, P.como === "MIX" ? null : P.como) + '<div style="text-align:center;"><button type="button" class="lnk" onclick="P.verOtros=false;pgWzPintar()">Cancelar</button></div>'
      : '<div style="text-align:center;margin:6px 0;"><button type="button" class="pgu-mas" onclick="P.verOtros=true;pgWzPintar()">＋ Paga con otro método también</button></div>');
  }
  // El vuelto (3.6: pantalla aparte)
  if (k === "V") {
    const st = pgEstado(), sobraX = -st.pendX;
    $("pgPV").innerHTML = '<div class="pw-preg">💸 Sobran ' + (sobraX > 0 ? txtU(-st.pend) + " · Bs " + fmt(r2(sobraX * bsPorU())) : "") + "</div>" +
      (P.sinVuelto ? '<div class="pw-sinvt" style="font-size:15px;">No le das vuelto: queda como diferencial a favor del negocio.<br><button type="button" class="lnk" onclick="pgWzSinVuelto(false)">Mejor sí le doy vuelto</button></div>'
        : P.vt.on ? "" : '<div class="pw-preg pw-sub">¿En qué le das el vuelto?</div>' + pgFilasMetodos("pgVtDirecto", [], false) +
          '<div style="text-align:center;margin-top:8px;"><button type="button" class="lnk" onclick="pgWzSinVuelto(true)">No le doy vuelto (queda a favor del negocio)</button></div>');
  }
  // Delivery: los días si queda a deber y no los eligió en el paso ①
  if (k === "D") $("pgDiasDlv").innerHTML = P.dlv.modo === "cred" && P.tipo !== "credito" ? pgDiasHTML("pgDiasSelD") : "";
  // ④ Revisar
  if (k === "4") $("pgResumen").innerHTML = pgResumenHTML();
  // Pie: Cancelar/Atrás · Siguiente o Registrar
  $("pgCerrar").textContent = idx <= 0 ? "Cancelar" : "← Atrás";
  $("pgSig").classList.toggle("oculto", k === "4");
  $("pgGuardar").classList.toggle("oculto", k !== "4");
}
async function pgWzTipo(t){
  if (!P) return;
  P.listo = null;
  if (t !== "cashea" && P.cs.on) { P.cs = { on: false, pct: 0, inicial: "", orden: "" }; pgCsSync(); pgPintarExtras(); }
  const nuevo = () => { P.lineas = []; P.vt = { on: false, lineas: [] }; P.como = ""; P.sinVuelto = false; P.credTodo = null; };
  if (t === "contado") {
    P.cred = { on: false, monto: "", editado: false }; P.tipo = "contado"; nuevo();
    pgActualizar(); pgWzPintar(); pgSiguiente(); return;
  }
  if (t === "credito") {
    if (!await pgClienteParaCredito()) { if (P) pgWzPintar(); return; }
    if (!P) return;
    P.cred = { on: true, monto: "", editado: false }; P.tipo = "credito"; nuevo();
    pgActualizar(); pgWzPintar(); return;
  }
  if (t === "cashea") {
    if (P.modo === "div") return;
    await pgCashea(true);
    if (!P) return;
    if (P.cs.on) { P.tipo = "cashea"; nuevo(); }
    pgWzPintar();
  }
}
function pgWzCredTodo(todo){
  if (!P) return;
  P.credTodo = todo; P.listo = null; P.lineas = []; P.vt = { on: false, lineas: [] }; P.como = "";
  P.cred = { on: true, monto: "", editado: false };
  pgActualizar(); pgWzPintar(); pgSiguiente();
}
function pgWzComo(c){
  if (!P) return;
  P.como = c; P.lineas = []; P.vt = { on: false, lineas: [] }; P.sinVuelto = false; P.listo = null;
  pgActualizar(); pgIr("M");
  // Un solo método en esa moneda: se elige solo
  const con = mon => metodos().map((m, i) => ({ m, i })).filter(o => o.m.tipo === mon && o.m.conCuenta);
  if (c !== "MIX") { const l = con(c); if (l.length === 1) pgWzMetodo(l[0].i); }
  else { const b = con("BS"), u = con("USD"); if (b.length === 1 && u.length === 1) { pgWzMetodo(u[0].i); pgWzMetodo(b[0].i); } }
}
function pgWzMetodo(i){
  const m = metodos()[i]; if (!P || !m || !m.conCuenta) return;
  P.vt = { on: false, lineas: [] }; P.sinVuelto = false; P.listo = null;
  if (P.como === "MIX") {
    P.lineas = P.lineas.filter(l => l.tipo !== m.tipo);
    pgAgregar(i);
    const us = P.lineas.find(l => l.tipo === "USD"), bs = P.lineas.find(l => l.tipo === "BS");
    if (!(us && bs)) { pgWzPintar(); return; }   // falta el de la otra moneda
    P.lineas = [us, bs];   // primero lo que da en $; los Bs se calculan solos
    us.monto = ""; us.recibido = ""; bs.recibido = "";
    pgIr("3"); return;
  }
  P.lineas = [];
  pgAgregar(i);
  pgIr("3");
}
function pgWzOtro(i){
  if (!P) return;
  const r = pgResto();
  if (r && P.lineas.length < 3 && !P.lineas.some(l => l.metodo === (metodos()[i] || {}).metodo)) { r.monto = ""; r.recibido = ""; }   // el que tenía todo pasa a escribirse
  pgAgregar(i);
  P.verOtros = false; P.listo = null;
  pgWzSync(); pgPintarLineas(); pgVtAjustar(); pgActualizar(); pgWzPintar();
}
async function pgSiguiente(){
  if (!P) return;
  const k = P.paso;
  if (k === "1") {
    if (!P.tipo) { aviso({ icono: "👆", titulo: "Elige una opción", html: "¿Cómo pagará el cliente? Toca <b>De contado</b>" + (metodoCredito() ? ", <b>Con crédito</b>" : "") + (pgCsPuede() && !P.dlv.on ? " o <b>Con Cashea</b>" : "") + "." }); return; }
    if (P.tipo === "credito" && P.credTodo === null) { aviso({ icono: "📝", titulo: "¿Crédito total o parcial?", html: "Toca <b>Crédito total</b> o <b>Crédito parcial</b>." }); return; }
    if (P.tipo === "cashea") {
      const ini = pgCsIni();
      if (!(ini > 0)) { aviso({ icono: "🛍️", titulo: "Falta el inicial", html: "Toca el porcentaje (" + CASHEA_PCTS.join(", ") + " %) o escribe el inicial que indica la app de Cashea." }); return; }
      if (ini >= P.total - 0.009) { aviso({ icono: "🛍️", titulo: "Revisa el inicial", html: "Con un inicial de " + txtU(ini) + " no queda nada para que Cashea financie (total " + txtU(P.total) + "). Si el cliente paga todo, toca <b>De contado</b>." }); return; }
    }
    const sp = pgSafProblema(); if (sp) { aviso({ icono: "🎁", titulo: "Revisa el saldo a favor", html: esc(sp) }); return; }
    if (pgNadaAhora()) { P.lineas = []; P.vt = { on: false, lineas: [] }; pgActualizar(); return pgDespuesDe3(); }
    pgIr("2"); return;
  }
  if (k === "2") {
    if (!P.como) { aviso({ icono: "👆", titulo: "¿En qué moneda paga?", html: "Toca <b>Bolívares</b>, <b>Dólares</b> o <b>Pago mixto</b>." }); return; }
    pgIr("M"); return;
  }
  if (k === "M") {
    if (!P.lineas.length) { aviso({ icono: "👆", titulo: "¿Por dónde paga?", html: "Toca el método con que paga el cliente." }); return; }
    if (P.como === "MIX" && !(P.lineas.some(l => l.tipo === "BS") && P.lineas.some(l => l.tipo === "USD"))) { aviso({ icono: "🔀", titulo: "Falta un método", html: "En el pago mixto toca un método en <b>Bs</b> y uno en <b>$</b>." }); return; }
    pgIr("3"); return;
  }
  if (k === "3") {
    if (!P.lineas.length && P.tipo !== "credito") { aviso({ icono: "👆", titulo: "No hay forma de pago", html: "Vuelve atrás y toca cómo paga el cliente." }); return; }
    if (pgHaySobra()) { pgIr("V"); return; }   // 3.6: sobra → el vuelto en su pantalla
    P.vt = { on: false, lineas: [] }; P.sinVuelto = false;
    return pgDespuesDe3();
  }
  if (k === "V") {
    if (!P.vt.on && !P.sinVuelto) { aviso({ icono: "💸", titulo: "¿En qué le das el vuelto?", html: "Toca el método con que le das el vuelto, o <b>No le doy vuelto</b>." }); return; }
    return pgDespuesDe3();
  }
  if (k === "D") return pgA4();
}
function pgDespuesDe3(){ if (P.dlv.on) { pgIr("D"); return; } return pgA4(); }
async function pgA4(){ const b = $("pgSig"); btnOcupado(b, "Revisando…"); let ok = false; try { ok = await pgConfirmar(true); } finally { btnLibre(b); } if (ok && P) pgIr("4"); }
function pgAtras(){
  if (!P) { cerrarPago(); return; }
  if ($("pgCerrar").disabled) return;
  const l = pgWzPasos().filter(x => !x.salta), i = l.findIndex(x => x.k === P.paso);
  if (i <= 0) { cerrarPago(); return; }
  pgIr(l[i - 1].k);
}
async function pgRegistrar(){
  if (!P) return;
  if (!P.listo) { if (!await pgConfirmar(true)) return; }
  await pgGuardar(P.listo.pagos, P.listo.vuelto);
}
// ④ Lo que se va a registrar, en grande
function pgResumenHTML(){
  const L = P.listo || { pagos: [], vuelto: [] }, st = pgEstado();
  const fila = (a, b, cls) => "<tr" + (cls ? ' class="' + cls + '"' : "") + "><td>" + a + '</td><td class="r">' + b + "</td></tr>";
  const desc = p => esc(pguDesc(metodoDe(p.metodo) || { metodo: p.metodo, tipo: p.tipo }));
  let h = '<div class="pw-preg">Revisa y toca ✅ Registrar</div><table class="cie-tabla pw-res">' +
    fila("👤 Cliente", "<b>" + esc(F.cliente.nombre || "Genérico") + "</b>" + (F.cliente.cedula ? " · " + esc(F.cliente.cedula) : "")) +
    fila("🧾 Total", "<b>" + txtU(r2(P.total + (P.dlv.on ? P.dlvMonto : 0))) + "</b> · Bs " + fmt(P.dlv.on ? r2(P.total * bsPorU() + P.dlvMonto * tBcv()) : r2(P.total * bsPorU())));
  L.pagos.forEach(p => {
    if (p.tipo === "CRED") h += p.etiqueta === "Cashea" ? fila("🛍️ Cashea financia", "Bs " + fmt(r2(p.monto * tBcv()))) : fila("📝 Queda a deber" + (Number(P.dias) > 0 ? " (" + P.dias + " días)" : ""), "<b>" + txtU(p.monto) + "</b>", "pw-cred");
    else if (p.tipo === "SAF") h += fila("🎁 Saldo a favor", txtU(p.monto));
    else {
      const l = P.lineas.find(x => x.metodo === p.metodo), rec = l && pgEsEf(l) && Number(l.recibido) > 0;
      h += fila(desc(p) + (rec ? ' <span class="cie-sis">(pagó con)</span>' : ""), "<b>" + (p.tipo === "BS" ? "Bs " : "$") + fmt(p.monto) + "</b>");
    }
  });
  L.vuelto.forEach(v => { h += fila("💸 Vuelto · " + desc(v), "<b>− " + (v.tipo === "BS" ? "Bs " : "$") + fmt(v.monto) + "</b>", "pw-vt"); });
  h += "</table>";
  if (Math.abs(st.dif) > 0.01) h += '<div class="dif ' + (st.dif > 0 ? "afavor" : "encontra") + '">💹 Diferencial ' + (st.dif > 0 ? "a favor" : "en contra") + ": <b>" + txtL(Math.abs(st.dif)) + "</b>." + pgMotivoDif() + "</div>";
  return h;
}
// Teclado: Enter sigue (o registra); en una lista de botones, Enter toca el botón
document.addEventListener("keydown", e => {
  if (e.key !== "Enter" || !P || e.ctrlKey || e.altKey || e.metaKey) return;
  const mp = $("mPago"); if (!mp || mp.classList.contains("oculto") || $("pgPie").classList.contains("oculto")) return;
  if (document.querySelector(".mfondo:not(.oculto):not(#mPago)")) return;
  const t = e.target, tag = (t && t.tagName) || "";
  if (tag === "TEXTAREA" || tag === "BUTTON" || tag === "SELECT") return;
  if ($("pgCerrar").disabled) return;
  e.preventDefault();
  if (P.paso === "4") pgRegistrar(); else pgSiguiente();
});

// ══ CASHEA (Tanda 1, 3.1) — como Ventas ══
//  El cliente paga el INICIAL con los métodos de siempre. Lo que financia Cashea va como el crédito del pago (pago CRED con
//  etiqueta «Cashea», el ticket lo dice así) y el sistema lo pone a nombre del cliente especial Cashea (Cashea.gs).
//  Solo en venta a $ BCV, con el cliente final y su cédula. No se combina con el saldo a favor. Sin internet también:
//  la venta se sube cuando vuelva, como todas. Aparece si el negocio tiene Cashea encendido (Configuración N8).
const CASHEA_PCTS = [40, 50, 60];   // % de inicial que ofrece la app (los mismos de Ventas)
function pgCsPuede(){ return !!(S.datos && S.datos.usaCashea === true && metodoCredito()); }
function pgCsIni(){ return P && P.cs.on ? r2(Number(P.cs.inicial) || 0) : 0; }
function pgCsFin(){ return P && P.cs.on ? r2(Math.max(0, P.total - pgCsIni())) : 0; }
// Lo financiado va como el crédito del pago (fijo: no se escribe). Sin un inicial que deje algo por financiar, no hay crédito.
function pgCsSync(){
  const ini = pgCsIni();
  P.cred = (P.cs.on && ini > 0 && ini < P.total - 0.009) ? { on: true, monto: pgCsFin().toFixed(2), editado: true, cashea: true } : { on: false, monto: "", editado: false };
}
async function pgCashea(on){
  if (!P) return;
  if (on) {
    if (P.modo === "div") { pgPintarExtras(); return; }
    if (!F.cliente.cedula || F.cliente.nombre === "Genérico") {
      const r = await modal({ icono: "🛍️", titulo: "Falta el cliente final", html: '<div class="m-txt">Una venta Cashea tiene que quedar a nombre del cliente que compra, con su cédula. Esta venta está a nombre de <b>Genérico</b>.<br><br>Búscalo o regístralo y sigues con el pago.</div>',
        botones: [{ txt: "Cancelar", v: false }, { txt: "👤 Elegir cliente", v: true, cls: "green" }] });
      if (!P) return;
      if (!r) { pgPintarExtras(); return; }
      const c = await abrirClientes();
      if (!P) return;
      if (!(c && F.cliente.cedula)) { pgPintarExtras(); return; }
      pgSafCargar();   // el cliente cambió: su saldo a favor (se ve si quitan Cashea)
    }
    pgSafApagar();
    P.cs = { on: true, pct: 0, inicial: "", orden: "" };
  } else P.cs = { on: false, pct: 0, inicial: "", orden: "" };
  pgCsSync(); pgPintarExtras(); pgPintarMetodos(); pgPintarLineas(); pgActualizar();
  if (on) setTimeout(() => { const b = document.querySelector("#pgExtras .cs-pct"); if (b && window.innerWidth > 820) b.focus(); }, 30);
}
function pgCsPct(p){
  if (!P || !P.cs.on) return;
  P.cs.pct = p; P.cs.inicial = r2(P.total * p / 100).toFixed(2);
  const i = $("pgCsIni"); if (i) i.value = P.cs.inicial;
  pgCsCambio();
}
function pgCsMonto(v){ if (!P || !P.cs.on) return; P.cs.pct = 0; P.cs.inicial = v; pgCsCambio(); }
// Cambió el inicial: cambia lo financiado y, si hay UN solo método, se ajusta a lo que falta (como Ventas)
function pgCsCambio(){
  pgCsSync(); { const r = pgResto(); if (r) r.recibido = ""; } pgWzSync(); pgPintarMetodos(); pgPintarLineas();   // cambió lo que se paga ahora: vuelve al total
  pgActualizar();
}

// ══ SALDO A FAVOR (Tanda 1, 3.1) — como Ventas, solo con internet ══
//  Al abrir el pago se le pregunta al sistema si el cliente tiene saldo a favor (SaldoFavor.gs). Esa parte de la venta
//  queda pagada sin que entre dinero a ninguna cuenta. El saldo vive en divisas; en pantalla va en la unidad de la venta
//  (venta en Bs a BCV con TasaBin: $ BCV). El sistema lo vuelve a revisar al registrar (dos cajas no gastan el mismo saldo).
function pgSafFactor(){ return (binOn() && P && P.modo === "bcv" && tBcv() > 0 && tDiv() > 0) ? tDiv() / tBcv() : 1; }
function pgSafDispPant(){ return P ? r2(P.saf.disp * pgSafFactor()) : 0; }
function pgSafPant(){ return P && P.saf.on ? r2(Number(P.saf.monto) || 0) : 0; }
function pgSafDiv(){   // lo usado, en divisas del sistema (lo que se descuenta del saldo)
  const pant = pgSafPant(); if (!(pant > 0)) return 0;
  const d = Math.abs(pant - pgSafDispPant()) < 0.005 ? P.saf.disp : r2(pant / pgSafFactor());
  return r2(Math.min(d, P.saf.disp));
}
function pgSafApagar(){ if (P) { P.saf.on = false; P.saf.monto = ""; } }
async function pgSafCargar(){
  if (!P) return;
  const ced = String(F.cliente.cedula || "").trim(), pide = (Number(P.saf.pide) || 0) + 1;
  P.saf = { disp: 0, on: false, monto: "", ced: "", pide: pide };
  pgPintarExtras(); pgActualizar();
  if (!ced || F.cliente.nombre === "Genérico" || F.cliente.nuevo || !hayInternet() || !sesionViva()) return;   // sin internet no se ofrece
  let r = null;
  try { r = await api("cj_saf", { cedula: ced }, 20000); } catch (e) { r = null; }
  if (!P || P.saf.pide !== pide || String(F.cliente.cedula || "").trim() !== ced) return;   // ya se cerró el pago o cambió el cliente
  const d = r && r.ok ? Number(r.disponible) || 0 : 0;
  if (d <= 0.004) return;
  P.saf.disp = d; P.saf.ced = ced;
  pgPintarExtras();
}
function pgSaf(on){
  if (!P) return;
  if (on && P.cs.on) { pgPintarExtras(); return; }
  if (on) { P.saf.on = true; P.saf.monto = r2(Math.min(pgSafDispPant(), P.total)).toFixed(2); }
  else pgSafApagar();
  pgPintarExtras(); pgSafCambio();
}
function pgSafMonto(v){ if (!P) return; P.saf.monto = v; pgSafCambio(); }
function pgSafTodo(){ if (!P) return; P.saf.monto = r2(Math.min(pgSafDispPant(), P.total)).toFixed(2); const i = $("pgSafM"); if (i) i.value = P.saf.monto; pgSafCambio(); }
function pgSafCambio(){ P.listo = null; const r = pgResto(); if (r) r.recibido = ""; pgWzSync(); pgPintarLineas(); pgActualizar(); }
function pgSafProblema(){
  if (!P || !P.saf.on) return "";
  const m = pgSafPant();
  if (!(m > 0)) return "Escribe cuánto del saldo a favor se usa, o desmarca «Usar saldo a favor».";
  if (m > pgSafDispPant() + 0.009) return "El cliente tiene " + txtU(pgSafDispPant()) + " a favor: no se pueden usar " + txtU(m) + ".";
  if (m > P.total + 0.009) return "La venta es de " + txtU(P.total) + ": el saldo a favor no puede pasar del total.";
  if (String(F.cliente.cedula || "").trim() !== P.saf.ced) return "Cambiaste el cliente. Cierra el pago y vuelve a abrirlo para ver el saldo a favor del cliente nuevo.";
  return "";
}
// Cashea y saldo a favor, arriba de los métodos de pago (se pintan al abrir y al marcar; los textos, en cada cambio)
function pgPintarExtras(){
  const box = $("pgExtras"); if (!box || !P) return;
  let h = "", hs = "";
  if (pgCsPuede() && !P.dlv.on && P.cs.on) {   // 3.5: se elige en el paso ① (la tarjeta «Con Cashea»)
    h += '<div class="cs-box on"><div class="cs-check"><span class="cs-marca">Cashea</span><span class="cs-txt">Venta con Cashea</span></div>';
    {
      h += '<div class="cs-preg"><span class="paso-n">1</span><span>¿Cuánto paga de inicial? <small>Lo dice la app de Cashea.</small></span></div>' +
        '<div class="cs-pcts">' + CASHEA_PCTS.map(p => '<button type="button" class="cs-pct' + (P.cs.pct === p ? " on" : "") + '" data-p="' + p + '" onclick="pgCsPct(' + p + ')">' + p + " %</button>").join("") +
        '<input type="number" inputmode="decimal" min="0" step="any" class="cs-inp" id="pgCsIni" placeholder="Otro monto ($ ' + unidadU() + ')" value="' + esc(P.cs.inicial) + '" oninput="pgCsMonto(this.value)"></div>' +
        '<input type="text" class="cs-inp cs-orden" id="pgCsOrden" maxlength="40" placeholder="N° de orden Cashea (opcional)" value="' + esc(P.cs.orden) + '" oninput="P.cs.orden=this.value" autocomplete="off">' +
        '<div class="cs-res" id="pgCsRes"></div>';
    }
    h += "</div>";
  }
  if (!P.cs.on && P.saf.disp > 0.004) {
    hs += '<div class="saf-box' + (P.saf.on ? " on" : "") + '"><label class="cs-check"><input type="checkbox" id="pgSafChk"' + (P.saf.on ? " checked" : "") + ' onchange="pgSaf(this.checked)"><span class="cs-txt">🎁 Usar saldo a favor</span></label>' +
      '<span class="saf-disp">' + esc(F.cliente.nombre) + " tiene <b>" + txtU(pgSafDispPant()) + "</b> a favor" + (pgSafFactor() !== 1 ? " ($" + fmt(P.saf.disp) + " div)" : "") + "</span>";
    if (P.saf.on) hs += '<div class="saf-fila"><span class="mon">$</span><input type="number" inputmode="decimal" min="0" step="any" class="cs-inp" id="pgSafM" placeholder="Cuánto se usa ($ ' + unidadU() + ')" value="' + esc(P.saf.monto) + '" oninput="pgSafMonto(this.value)">' +
      '<button type="button" class="btn-m gray" onclick="pgSafTodo()">Todo lo que se pueda</button></div><div class="cs-res" id="pgSafRes"></div>';
    hs += "</div>";
  }
  box.innerHTML = h;
  const sb = $("pgSafBox"); if (sb) sb.innerHTML = hs;
  pgExtrasTxt();
  if (P.paso === "2") pgWzPintar();   // el aviso del saldo a favor en el paso ②
}
function pgExtrasTxt(){
  if (!P) return;
  const r = $("pgCsRes");
  if (r) {
    const ini = pgCsIni(), N = P.total;
    r.innerHTML = !(ini > 0) ? '<span class="cs-falta">👆 Toca el porcentaje o escribe el inicial que indica la app de Cashea.</span>'
      : ini >= N - 0.009 ? '<span class="cs-mal">⚠️ Con ese inicial no queda nada para que Cashea financie (total ' + txtU(N) + "). Revisa el monto.</span>"
      : "Total " + txtU(N) + " · inicial " + txtU(ini) + " (" + (P.cs.pct > 0 ? P.cs.pct : fmt(ini / N * 100)) + " %) · <b>Cashea financia Bs " + fmt(r2(pgCsFin() * tBcv())) + "</b> ($" + fmt(pgCsFin()) + " a la BCV)";
    const pg = $("pgCsPaga");
    if (pg) pg.innerHTML = ini > 0 && ini < N - 0.009 ? "¿Con qué paga el cliente el inicial de <b>" + txtU(ini) + " · Bs " + fmt(r2(ini * bsPorU())) + "</b>?" : "¿Con qué paga el cliente el inicial?";
    document.querySelectorAll("#pgExtras .cs-pct").forEach(b => b.classList.toggle("on", Number(b.dataset.p) === P.cs.pct));
  }
  const s = $("pgSafRes");
  if (s) {
    const p = pgSafProblema(), resta = r2(Math.max(0, P.total - pgSafPant()));
    s.innerHTML = p ? '<span class="cs-mal">⚠️ ' + esc(p) + "</span>"
      : "Total " + txtU(P.total) + " − saldo a favor " + txtU(pgSafPant()) + " = <b>" + txtU(resta) + "</b> por cobrar" + (resta <= 0.009 ? " (no hace falta otro método)" : "") +
        ". Le quedan " + txtU(r2(Math.max(0, pgSafDispPant() - pgSafPant()))) + " a favor.";
  }
}

// revisar (3.5): hace todas las revisiones (y las preguntas) sin guardar; deja listo lo que se registra en P.listo
async function pgConfirmar(revisar){
  const m = P.modo;
  if (P.cs.on) {   // Tanda 1: Cashea (las mismas revisiones de Ventas)
    const ini = pgCsIni(), N = P.total;
    if (!F.cliente.cedula || F.cliente.nombre === "Genérico") { aviso({ icono: "👤", titulo: "Falta el cliente final", html: "La venta Cashea tiene que quedar a nombre del cliente que compra, con su cédula. Desmarca Cashea y vuelve a marcarlo para elegirlo." }); return; }
    if (!(ini > 0)) { aviso({ icono: "🛍️", titulo: "Falta el inicial", html: "Elige el porcentaje (" + CASHEA_PCTS.join(", ") + " %) o escribe el monto exacto del inicial que indica la app de Cashea." }); return; }
    if (ini > N + 0.009) { aviso({ icono: "🛍️", titulo: "El inicial es mayor que el total", html: "Escribiste un inicial de <b>" + txtU(ini) + "</b>, pero la factura completa es de <b>" + txtU(N) + "</b>. Revisa el monto." }); return; }
    if (ini >= N - 0.009) { aviso({ icono: "🛍️", titulo: "El inicial cubre toda la factura", html: "Con un inicial de " + txtU(ini) + " no queda nada para que Cashea financie (total " + txtU(N) + ").<br><br>Revisa el monto, o desmarca Cashea si el cliente paga todo." }); return; }
  }
  if (P.saf.on) { const sp = pgSafProblema(); if (sp) { aviso({ icono: "🎁", titulo: "Revisa el saldo a favor", html: esc(sp) }); return; } }
  if (P.dlv.on && !pgDlvListo()) {
    aviso({ icono: P.dlv.tipo === "envio" ? "📦" : "🛵", titulo: "Falta el " + dlvTxt(P.dlv.tipo).toLowerCase(), html: "En el paso <b>②</b> elige cómo paga el cliente el " + dlvTxt(P.dlv.tipo).toLowerCase() + ": en dólares, en bolívares" + (metodoCredito() ? " o a crédito" : "") + (P.dlv.modo && P.dlv.modo !== "cred" ? ", y por dónde lo paga" : "") + "." });
    return;
  }
  const pagos = [];
  for (const l of P.lineas) {
    const v = r2(Number(l.monto) || 0), d = pguDesc(metodoDe(l.metodo) || { metodo: l.metodo, tipo: l.tipo });
    if (!(v > 0)) { aviso({ icono: "💳", titulo: "Falta un monto", html: "La línea <b>" + esc(d) + "</b> no tiene monto. Escribe cuánto entra por ahí, o quítala con ✕." }); return; }
    if (l.tipo === "BS") { pagos.push({ metodo: l.metodo, monto: v, tipo: "BS" }); continue; }
    if (m === "div") { pagos.push({ metodo: l.metodo, monto: v, tipo: "USD" }); continue; }
    const t = pgTasaLinea(l);
    if (!(t > 0)) { aviso({ icono: "💱", titulo: "Falta la tasa", html: "La línea <b>" + esc(d) + "</b> cobra dólares y no tiene tasa. Elige BCV o Divisas, o escribe la otra tasa." }); return; }
    const tVal = m === "off" ? (tDivOff() || t) : t;   // OFF: al servidor los $ van a lo que valen (Divisas efectivo)
    pagos.push({ metodo: l.metodo, monto: v, tipo: "USD", tasaDivisas: tVal, equivBCV: r2(v * tVal / tBcv()) });
  }
  if (P.cred.on) {
    const c = pgCredValor();
    if (!F.cliente.cedula) { aviso({ icono: "👤", titulo: "Falta el cliente", html: "El crédito necesita un cliente con cédula. Elige el cliente y vuelve a guardar." }); return; }
    if (!(c > 0)) { aviso({ icono: "📝", titulo: "Falta el monto del crédito", html: "Marcaste crédito pero el monto quedó vacío. Usa <b>↺ Lo que falta</b>, escríbelo, o quita el crédito con ✕." }); return; }
    pagos.push(P.cred.cashea ? { metodo: metodoCredito(), monto: c, tipo: "CRED", etiqueta: "Cashea" } : { metodo: metodoCredito(), monto: c, tipo: "CRED" });   // Tanda 1: el ticket dice «Cashea»
  }
  if (P.dlv.on) {   // paso ②: el delivery se suma a lo que ya se cobró por ese medio (o al crédito)
    const d = P.dlv;
    if (d.modo === "cred") {
      if (!F.cliente.cedula) { aviso({ icono: "👤", titulo: "Falta el cliente", html: "El crédito necesita un cliente con cédula. Elige el cliente y vuelve a guardar." }); return; }
      const v = dlvLibro(d.monto), c = pagos.find(x => x.tipo === "CRED");
      if (c) c.monto = r2(c.monto + v); else pagos.push({ metodo: metodoCredito(), monto: v, tipo: "CRED" });
    } else {
      const tipo = d.modo === "usd" ? "USD" : "BS", monto = d.modo === "usd" ? r2(d.monto) : r2(d.monto * tBcv());
      const ya = pagos.find(x => x.metodo === d.metodo && x.tipo === tipo);
      if (ya) ya.monto = r2(ya.monto + monto); else pagos.push({ metodo: d.metodo, monto: monto, tipo: tipo });
    }
  }
  if (pgSafPant() > 0) pagos.push({ metodo: "Saldo a favor", monto: pgSafPant(), tipo: "SAF", montoDiv: pgSafDiv() });   // Tanda 1 (SaldoFavor.gs)
  if (!pagos.length) { aviso({ icono: "🧾", titulo: "No hay forma de pago", html: "Toca el método con que paga el cliente (o <b>A crédito</b> si queda a deber)." }); return; }
  const vuelto = [];
  if (P.vt.on) {
    for (const v of P.vt.lineas) {
      const x = r2(Number(v.monto) || 0);
      if (!(x > 0)) { aviso({ icono: "💸", titulo: "Falta el monto del vuelto", html: "Elegiste <b>" + esc(v.metodo) + "</b> para el vuelto pero el monto quedó vacío. Escríbelo o quita esa línea." }); return; }
      const lv = { metodo: v.metodo, tipo: v.tipo, monto: x };
      if (v.tipo === "BS") lv.tasa = r2(bsPorU());
      else if (m === "off") lv.equivBCV = r2(pgValeVt(v));
      vuelto.push(lv);
    }
    if (!vuelto.length) { aviso({ icono: "💸", titulo: "Falta de dónde sale el vuelto", html: "Abriste el vuelto pero no elegiste de qué método sale. Elígelo, o toca <b>Quitar vuelto</b>." }); return; }
  }
  const st = pgEstado();
  const bs = v => " (Bs " + fmt(r2(v * bsPorU())) + ")";
  if (st.pend > TOL) {
    if (!await confirmar({ icono: "⚠️", titulo: "Falta dinero", colorOk: "naranja", ok: "Sí, guardar", html: "El pago cubre " + txtU(st.cubT) + " de " + txtU(P.total) + ": <b>falta " + txtU(st.pend) + "</b>" + bs(st.pendX) + ".<br><br>Si la guardas así, esa diferencia queda como diferencial cambiario en contra. Si queda a deber, vuelve al primer paso y elige <b>Con crédito</b>.<br><br>¿Seguir igualmente?" })) return;
  } else if (st.pend < -TOL && !P.vt.on && !P.sinVuelto) {   // 3.6: si ya dijo «No le doy vuelto», no pregunta otra vez
    const r = await modal({ icono: "💰", titulo: "Sobra dinero", html: '<div class="m-txt">El pago cubre ' + txtU(st.cubT) + ": <b>sobran " + txtU(-st.pend) + "</b>" + bs(-st.pendX) + ".<br><br>¿Le das vuelto al cliente, o queda como diferencial cambiario a favor (" + txtL(st.dif) + ")?</div>",
      botones: [{ txt: "💸 Dar vuelto", v: "vuelto" }, { txt: "Queda como diferencial a favor", v: "ok", cls: "green" }] });
    if (r === "vuelto") { P.sinVuelto = false; pgIr("V"); return; }
    if (r !== "ok") return;
  } else if (P.vt.on && st.queda < -TOL) {
    if (!await confirmar({ icono: "⚠️", titulo: "El vuelto pasa de lo que sobra", colorOk: "naranja", ok: "Sí, guardar", html: "Sobraban " + txtU(-st.pend) + " y el vuelto devuelve " + txtU(st.vtCub) + ": <b>" + txtU(-st.queda) + " de más</b>.<br><br>Esa diferencia queda como diferencial cambiario en contra. ¿Guardar igualmente?" })) return;
  } else if (P.vt.on && st.queda > TOL) {
    if (!await confirmar({ icono: "⚠️", titulo: "Falta vuelto por dar", colorOk: "naranja", ok: "Sí, guardar", html: "Sobraban " + txtU(-st.pend) + " y el vuelto solo devuelve " + txtU(st.vtCub) + ": quedan <b>" + txtU(st.queda) + "</b>" + bs(st.queda) + " que se registran como diferencial a favor. ¿Guardar igualmente?" })) return;
  } else if (st.dif < -0.01) {
    if (!await confirmar({ icono: "⚠️", titulo: "Diferencial en contra", colorOk: "naranja", ok: "Sí, guardar", html: "Lo recibido vale " + txtL(r2(st.vale + st.credVale - st.vtVale)) + " y la venta vale " + txtL(st.valorVenta) + ": <b>" + txtL(-st.dif) + " en contra</b>." + pgMotivoDif() + "<br><br>¿Guardar igualmente?" })) return;
  }
  if (revisar) { P.listo = { pagos: pagos, vuelto: vuelto }; return true; }
  await pgGuardar(pagos, vuelto);
}
function vendedorDeLaVenta(){
  const d = S.datos;
  const cj = { cajeroNombre: S.turno ? S.turno.cajeroNombre : ((d.cajero && d.cajero.nombre) || ""), cajeroId: S.turno ? S.turno.cajeroId : 0 };   // el cajero del turno
  if (F.orden && F.orden.origen === "WEB") return Object.assign({ ventaDirecta: true, vendedorNombre: "", comision: 0, canal: "WEB" }, cj);   // pedido web: Tienda online
  if (!d.trabajoVendedores) return Object.assign({ ventaDirecta: true, vendedorNombre: "", comision: 0 }, cj);
  const v = (d.vendedores || []).find(x => String(x.id) === String(F.vend));
  if (v) return Object.assign({ vendedorId: v.id, vendedorNombre: v.nombre, comision: Number(v.comision) || 0 }, cj);
  if (F.orden && F.orden.vendedorId && String(F.orden.vendedorId) === String(F.vend)) return Object.assign({ vendedorId: F.orden.vendedorId, vendedorNombre: F.orden.vendedor, comision: 0 }, cj);
  return Object.assign({ ventaDirecta: true, vendedorNombre: "", comision: 0 }, cj);
}
async function pgGuardar(pagos, vuelto){
  const btn = $("pgGuardar");
  if (!puedeVender()) return;
  btnOcupado(btn, "Guardando…"); $("pgCerrar").disabled = true;
  if (!S.turno) { btnLibre(btn); $("pgCerrar").disabled = false; cerrarPago(); irA("vender"); return; }
  const tb = tBcv(), ahora = new Date(), m = P.modo, dl = r2(P.dlvMonto || 0);   // Tanda 1: con venta de otro día, las tasas de ese día
  const totPant = r2(P.total + (P.dlv.on ? dl : 0));                                     // lo que dice la factura (con el delivery por su monto)
  const totBs = P.dlv.on ? r2(P.total * bsPorU() + dl * tBcv()) : r2(P.total * bsPorU());   // el delivery, siempre a BCV
  const v = {
    id: uuid(), numero: "", creada: ahoraTxt(ahora), fecha: F.fechaAnt ? F.fechaAnt.fecha : hoyTxt(ahora), fechaAnt: !!F.fechaAnt,   // Tanda 1: venta de otro día
    numeroTicket: 0, provisional: false, turno: S.turno.id,   // el número lo pone guardarVentaNueva (apartado o provisional)
    caja: S.datos.caja, equipo: S.datos.equipo,
    // tasas con que se cobró: div = Divisas (TasaBin encendido) o Divisas de los $ en efectivo (apagado)
    tasas: { bcv: tb, div: binOn() ? tDiv() : tDivOff(), binOn: binOn() },
    modo: m, unidad: m === "div" ? "div" : "BCV",   // venta en $ BCV o Venta en Dólares
    // precio = base en los libros (lo que recibe el sistema) · pu = base en pantalla (el ticket)
    items: F.items.map(i => ({ tipo: i.tipo, codigo: i.codigo, nombre: i.nombre, codigoBarras: i.codigoBarras, cantidad: Number(i.cantidad), precio: i.libro, pu: i.base, iva: i.iva, manual: !!i.manual })),
    pago: Object.assign({
      pagos: pagos, vuelto: vuelto,
      referencia: $("pgRef").value.trim(), observaciones: $("pgObs").value.trim(),
      clienteCedula: F.cliente.cedula || "", clienteNombre: F.cliente.nombre || "Genérico",
      clienteDireccion: F.cliente.direccion || "", clienteTelefono: F.cliente.telefono || "",
      clienteNuevo: !!(F.cliente.cedula && F.cliente.nuevo),
      claveCon: F.claveOk ? F.claveCon : (F.claveCon === "orden" ? "orden" : ""),   // "orden": el precio manual o el descuento venían en la orden   // con qué clave se autorizó lo que la pide: "sistema" (la de Ventas) o "sinInternet"   // creado sin internet: el sistema lo crea antes de registrar la venta
      descuentoTipo: F.desc.tipo, descuentoValor: Number(F.desc.valor) || 0, descuentoValorServ: descuentoServidor(F.items, F.desc),
      diasCredito: ((P.cred.on && !P.cred.cashea) || P.dlv.modo === "cred") ? (Number(P.dias) || 0) : 0,
      cashea: P.cs.on ? { orden: String(P.cs.orden || "").trim().slice(0, 40), inicial: pgCsIni(), financiado: pgCsFin() } : null,   // Tanda 1 (Cashea.gs)
      fechaAnterior: F.fechaAnt ? true : undefined,   // Tanda 1: venta de otro día (el sistema la revisa contra las tasas guardadas de ese día)
      delivery: dl, deliveryBCV: dl, deliveryConcepto: P.dlv.tipo === "envio" ? "envio" : "delivery",   // Etapa 2B: como Ventas (al fondo de delivery entran los $ BCV)
      objetivoVenta: m === "off" ? "" : (m === "div" ? "DIVISAS" : "BCV"), totalPantallaUSD: totPant
    }, vendedorDeLaVenta(), ordPago()),   // ordPago: la orden que se cobra (queda CONVERTIDA al subir), ordenes.js
    total: totPant, totalBs: totBs, totalBcv: m === "div" ? (tb > 0 ? r2(totBs / tb) : 0) : totPant,
    estado: "por_subir", intentos: 0, msg: "", avisos: [], numeroFactura: "", subidaEn: 0
  };
  try { await guardarVentaNueva(v); }
  catch (e) {
    btnLibre(btn); $("pgCerrar").disabled = false;
    aviso({ icono: "❌", titulo: "La venta NO se guardó", html: "El equipo no pudo guardarla (" + esc(e.message) + "). No entregues el ticket: vuelve a tocar <b>✅ Registrar</b>. Si sigue fallando, anótala en papel y avísale al administrador." });
    return;
  }
  S.ventas.push(v); _vendidoLocal = null;
  _ventaGuardada = v;
  btnLibre(btn); $("pgCerrar").disabled = false;
  $("pgForm").classList.add("oculto"); $("pgOk").classList.remove("oculto");
  $("pgPie").classList.add("oculto"); $("pgPieOk").classList.remove("oculto"); $("pgX").classList.add("oculto"); $("pgTit").textContent = "✅ Venta guardada";
  setTimeout(() => { const b = $("pgImprimir"); if (b) b.focus(); }, 40);
  $("pgOkNum").textContent = ((S.datos.impresion || {}).nombreDoc || "Nota de Entrega") + " N° " + nroTicket(v);
  $("pgOkTxt").innerHTML = "Total Bs " + fmt(v.totalBs) + " · $" + fmt(v.total) + " " + v.unidad + "<br>" + (S.online !== false ? "Se registra en el sistema en un momento." : "Se registra sola en el sistema cuando vuelva el internet.") +
    (v.provisional ? "<br>🔢 Número <b>provisional</b>: el sistema le da su número al subirla." : "") +
    (v.fechaAnt ? "<br>📅 Venta del <b>" + fechaCorta(v.fecha) + "</b> (de otro día): no cuenta en el cierre de hoy." : "");
  limpiarVenta();
  pintarEstado(); pintarBanners();
}
function pgTerminar(imprimir){
  const v = _ventaGuardada; _ventaGuardada = null;
  cerrarPago();
  if (imprimir && v) imprimirTicket(v);
  toast("✅ Venta guardada");
  sincronizar();
  if (_verNueva) setTimeout(recargarSiSePuede, 4000);   // después de mandar el ticket a la impresora
  if (window.innerWidth > 820) $("busca").focus();
}

// ══ TICKET (mismo formato que Ventas: generarTicket) ══
function htmlTicket(v){
  const d = S.datos || {}, cfg = Object.assign({ formato: "ticket80", moneda: "BS", mostrarEquiv: true, nombreDoc: "Nota de Entrega", pieLinea1: "***Gracias por su compra***", pieLinea2: "Puede solicitar su factura en caja." }, d.impresion || {});
  // Como Ventas: los Bs del ticket SIEMPRE a tasa BCV, aunque sea Venta en Dólares (solo cambia la etiqueta «Total $»)
  const enDiv = v.unidad === "div", tasa = Number(v.tasas && v.tasas.bcv) || 1;
  const enBS = cfg.moneda !== "USD", conv = usd => enBS ? fmt(usd * tasa) : fmt(usd), sym = enBS ? "Bs." : "$";
  const fmtT = formatoTicket(), mostrarPU = fmtT !== "58";
  const nroT = v.numeroFactura || nroTicket(v);
  const its = v.items.map(i => ({ nombre: i.nombre, cantidad: i.cantidad, base: i.pu != null ? i.pu : i.precio, iva: i.iva }));
  const x = totales(its, { tipo: v.pago.descuentoTipo, valor: v.pago.descuentoValor });
  const p = v.pago, esGen = !p.clienteCedula || p.clienteNombre === "Genérico";
  const dl = r2(Number(p.delivery) || 0), totT = r2(x.total + dl);   // delivery por su monto; sus Bs a BCV como todo el ticket
  const dlvF = dl > 0 ? "<tr><td>" + (p.deliveryConcepto === "envio" ? "Envío" : "Delivery") + ':</td><td style="text-align:right;">+ ' + sym + " " + conv(dl) + "</td></tr>" : "";
  const filasProds = its.map(it => {
    const pu = it.base * (1 + it.iva / 100), tl = pu * it.cantidad;
    return mostrarPU
      ? '<tr><td style="padding:2px 0;vertical-align:top;width:40%;line-height:1.5;">' + esc(it.nombre) + '</td><td style="padding:2px 0;text-align:center;width:14%;vertical-align:top;white-space:nowrap;">' + fmtCant(it.cantidad) + '</td><td style="padding:2px 0;text-align:right;width:23%;vertical-align:top;white-space:nowrap;">' + sym + " " + conv(pu) + '</td><td style="padding:2px 0;text-align:right;width:23%;vertical-align:top;white-space:nowrap;">' + sym + " " + conv(tl) + "</td></tr>"
      : '<tr><td style="padding:2px 0;vertical-align:top;width:48%;line-height:1.5;">' + esc(it.nombre) + '</td><td style="padding:2px 0;text-align:center;width:19.2%;vertical-align:top;white-space:nowrap;">' + fmtCant(it.cantidad) + '</td><td style="padding:2px 0;text-align:right;width:32.8%;vertical-align:top;white-space:nowrap;">' + sym + " " + conv(tl) + "</td></tr>";
  }).join("");
  const pagosOrd = (p.pagos || []).filter(q => q.tipo !== "CRED").concat((p.pagos || []).filter(q => q.tipo === "CRED"));
  const soloMet = m => String(m || "").split(" · ")[0];   // 3.8: «Pago Móvil · BDV» → el ticket dice solo «Pago Móvil» (la cuenta queda registrada igual)
  const filasPago = pagosOrd.map(q => {
    let f = '<tr style="' + (q.tipo === "CRED" ? "font-style:italic;" : "") + '"><td style="padding:1px 0;">' + esc(q.etiqueta || soloMet(q.metodo)) + '</td><td style="text-align:right;padding:1px 0;">' +
    (q.etiqueta === "Cashea" ? "Bs. " + fmt(r2(q.monto * (Number(v.tasas && v.tasas.bcv) || 0))) : (q.tipo === "BS" ? "Bs." : "$") + " " + fmt(q.monto)) + "</td></tr>";   // 1b: Cashea en Bs a la BCV
    if (q.tipo === "CRED" && Number(p.diasCredito) > 0) {
      const venc = vencimiento(v.fecha, p.diasCredito);
      f += '<tr><td colspan="2" style="padding:0 0 1px 6px;font-style:italic;">Días de crédito: ' + p.diasCredito + "</td></tr>";
      if (venc) f += '<tr><td colspan="2" style="padding:0 0 2px 6px;font-style:italic;">Fecha de Vencimiento: ' + venc + "</td></tr>";
    }
    return f;
  }).join("") + (p.vuelto || []).map(q => '<tr><td style="padding:1px 0;">Vuelto (' + esc(soloMet(q.metodo)) + ')</td><td style="text-align:right;padding:1px 0;">- ' + (q.tipo === "BS" ? "Bs." : "$") + " " + fmt(q.monto) + "</td></tr>").join("");
  // Persona del comprobante (Configuración → Impresión)
  let modo = cfg.personaComprobante || "vendedor";
  if (!d.trabajoVendedores && !String(p.vendedorNombre || "").trim()) modo = "cajero";
  const per = [];
  if ((modo === "cajero" || modo === "ambos") && p.cajeroNombre) per.push("Cajero: " + esc(p.cajeroNombre));
  if ((modo === "vendedor" || modo === "ambos") && p.vendedorNombre) per.push("Vendedor: " + esc(p.vendedorNombre));
  const logo = (cfg.imprimirLogo !== false && String(cfg.logo || "").indexOf("data:image") === 0)
    ? '<div style="text-align:center;padding-top:6px;"><img data-cm-logo="1" src="' + cfg.logo + '" alt="" style="max-width:' + (cfg.formato === "ticket58" ? "34mm" : "46mm") + ";max-height:" + (cfg.formato === "ticket58" ? "16mm" : "20mm") + ';object-fit:contain;filter:grayscale(100%);"></div>' : "";
  const equiv = cfg.mostrarEquiv && enBS ? '<tr><td>' + (enDiv ? "Total $:" : "Total $ BCV:") + '</td><td style="text-align:right;">$' + fmt(totT) + "</td></tr>" : "";
  const desc = x.desc > 0 ? '<tr><td>Descuento:</td><td style="text-align:right;">- ' + sym + " " + conv(x.desc) + "</td></tr>" : "";
  const formaPago = cfg.mostrarFormaPago !== false ? '<hr class="sep"><div style="font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Forma de pago</div><table style="margin-bottom:5px;">' + filasPago + "</table>" : "";
  const obs = p.observaciones ? '<div style="border-top:1px dashed #ccc;padding:5px 0;font-size:9px;"><strong>Obs:</strong> ' + esc(p.observaciones) + "</div>" : "";
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + esc(nroT) + "</title>" + estiloPapel(fmtT) + "</head><body>" +
    logo + '<div style="text-align:center;padding:8px 0 5px;"><div style="font-size:13px;font-weight:bold;">' + esc(d.negocio || "MI NEGOCIO") + "</div><div>RIF: " + esc(cfg.rif || "J-00000000") + "</div>" + (cfg.direccion ? "<div>" + esc(cfg.direccion) + "</div>" : "") + "<div>Teléfono: " + esc(cfg.telefono || "") + "</div></div>" +
    '<hr class="sep"><table style="margin-bottom:5px;font-size:10px;font-weight:bold;"><tr><td></td><td style="text-align:right;">' + per.join("<br>") + "</td></tr>" +
    "<tr><td>" + (esGen ? "" : esc(p.clienteNombre)) + '</td><td style="text-align:right;">' + esc(cfg.nombreDoc) + " N°: " + esc(nroT) + "</td></tr>" +
    "<tr><td>" + (esGen ? "" : esc(p.clienteCedula)) + '</td><td style="text-align:right;">Fecha: ' + esc(v.fecha) + "</td></tr>" +
    "<tr><td>" + (esGen ? "" : esc(p.clienteTelefono)) + '</td><td style="text-align:right;">Hora: ' + esc(String(v.creada).slice(11, 19)) + "</td></tr></table>" +
    '<hr class="sep"><table style="margin-bottom:5px;"><thead>' + (mostrarPU
      ? '<tr style="font-size:11px;font-weight:bold;border-bottom:2px solid #000;"><th style="text-align:left;width:40%;padding:4px 0;">PRODUCTO</th><th style="text-align:center;width:14%;padding:4px 0;">CANT.</th><th style="text-align:right;width:23%;padding:4px 0;">P.U.</th><th style="text-align:right;width:23%;padding:4px 0;">TOTAL</th></tr>'
      : '<tr style="font-size:12px;font-weight:bold;border-bottom:2px solid #000;"><th style="text-align:left;width:48%;padding:4px 0;">PRODUCTO</th><th style="text-align:center;width:19.2%;padding:4px 0;">CANT.</th><th style="text-align:right;width:32.8%;padding:4px 0;">TOTAL</th></tr>') +
    "</thead><tbody>" + filasProds + "</tbody></table>" +
    '<hr class="sep"><table style="margin-bottom:3px;"><tr><td>Subtotal:</td><td style="text-align:right;">' + sym + " " + conv(x.sub) + "</td></tr>" + desc +
    '<tr><td>IVA:</td><td style="text-align:right;">' + sym + " " + conv(x.ivaR) + "</td></tr>" + dlvF + '<tr style="font-size:11px;font-weight:bold;"><td>Total:</td><td style="text-align:right;">' + sym + " " + conv(totT) + "</td></tr>" + equiv + "</table>" +
    formaPago + obs +
    '<hr class="sep"><div style="text-align:center;padding:6px 0;"><div>' + esc(cfg.pieLinea1 || "") + '</div><div style="margin-top:2px;">' + esc(cfg.pieLinea2 || "") + "</div></div></body></html>";
}
function vencimiento(fecha, dias){
  const p = String(fecha || "").split("-"), n = Number(dias) || 0;
  if (n <= 0 || p.length !== 3) return "";
  const f = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);
  f.setDate(f.getDate() + n);
  return hoyTxt(f);
}
function imprimirTicket(v){
  let html = htmlTicket(v);
  if (S.pref.dosCopias) html = html.replace(/<body>([\s\S]*)<\/body>/, (m, b) => "<body>" + b + '<div style="page-break-before:always;"></div>' + b + "</body>");
  const w = window.open("", "_blank", "left=0,top=0,width=" + (screen.availWidth || 1200) + ",height=" + (screen.availHeight || 800));   // 1b: grande, para ver bien el ticket
  if (w) {
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => { try { w.print(); } catch (e) {} }, 500);
    setTimeout(() => { try { w.close(); } catch (e) {} }, 2500);
    return;
  }
  // Sin ventanas emergentes: se imprime desde un marco escondido
  let fr = $("frImprimir");
  if (!fr) { fr = document.createElement("iframe"); fr.id = "frImprimir"; fr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;"; document.body.appendChild(fr); }
  fr.onload = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) {} };
  fr.srcdoc = html;
}

// ══ NÚMERO DEL TICKET ══
// El número de factura apartado (numeros.js) o, si no había, "PROV C1-XXXX-0001" (el sistema le da el número al subir).
function nroTicket(v){ return v.numeroTicket ? String(v.numeroTicket) : "PROV " + v.numero; }

// ══ TAMAÑO DEL PAPEL ══
function formatoTicket(){
  const t = S.pref.tamTicket || "auto";
  if (t === "80" || t === "58" || t === "carta") return t;
  const f = ((S.datos || {}).impresion || {}).formato;
  return f === "ticket58" ? "58" : f === "carta" ? "carta" : "80";
}
function estiloPapel(fmt){
  const base = "*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Segoe UI',Calibri,Arial,sans-serif;color:#000;background:white;-webkit-print-color-adjust:exact;line-height:1.4;word-break:break-word;font-weight:bold;}table{width:100%;border-collapse:collapse;}.sep{border:none;border-top:2px solid #000;width:100%;margin:5px 0;display:block;}";
  if (fmt === "carta") return "<style>" + base + "body{font-size:12px;width:180mm;max-width:100%;margin:0 auto;padding:6mm 0;}@media print{@page{size:letter;margin:12mm;}body{padding:0;}}</style>";
  const a = fmt === "58" ? "58mm" : "80mm";
  return "<style>" + base + "body{font-size:10px;width:" + a + ";}@media print{@page{margin:0;size:" + a + " auto;}body{width:" + a + ";margin:0;padding:0 3mm 0 0;}}</style>";
}
function imprimirHTML(html){
  const w = window.open("", "_blank", "left=0,top=0,width=" + (screen.availWidth || 1200) + ",height=" + (screen.availHeight || 800));   // 1b: grande, para ver bien el ticket
  if (w) {
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => { try { w.print(); } catch (e) {} }, 500);
    setTimeout(() => { try { w.close(); } catch (e) {} }, 2500);
    return;
  }
  let fr = $("frImprimir");
  if (!fr) { fr = document.createElement("iframe"); fr.id = "frImprimir"; fr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;"; document.body.appendChild(fr); }
  fr.onload = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) {} };
  fr.srcdoc = html;
}

// ══ TURNO: el cajero entra con su PIN (cajero.js) ══

// ══ CIERRE DE TURNO ══
function esEfectivo(p){ const m = metodoDe(p.metodo) || { metodo: p.metodo, tipo: p.tipo }; return pguTipoDe(m) === "efectivo"; }
function resumenTurno(t){
  const todas = S.ventas.filter(v => v.turno === t.id && v.estado !== "invalida");
  const vs = todas.filter(v => !v.fechaAnt), otras = todas.filter(v => v.fechaAnt);   // Tanda 1: las ventas de otro día no cuentan en la gaveta de hoy
  const met = {};
  let totalUsd = 0, totalBs = 0, credito = 0, desc = 0, sinSubir = 0, cashea = 0, casheaBs = 0, saf = 0;
  const sumar = (p, m) => {
    const k = p.metodo + "|" + p.tipo;
    const x = met[k] = met[k] || { metodo: p.metodo, tipo: p.tipo, neto: 0, desc: pguDesc(metodoDe(p.metodo) || { metodo: p.metodo, tipo: p.tipo }), efectivo: esEfectivo(p) };
    x.neto = r2(x.neto + m);
  };
  vs.forEach(v => {
    // Todo en $ BCV: una Venta en Dólares (TasaBin) se pasa con sus tasas (divisas × Divisas ÷ BCV)
    const fx = (v.unidad === "div" && v.tasas && v.tasas.bcv > 0) ? (Number(v.tasas.div) || 0) / v.tasas.bcv : 1;
    totalUsd += v.totalBcv != null ? Number(v.totalBcv) || 0 : Number(v.total) || 0; totalBs += Number(v.totalBs) || 0;
    const sinDesc = totales(v.items.map(i => ({ cantidad: i.cantidad, base: i.pu != null ? i.pu : i.precio, iva: i.iva })), { tipo: "ninguno" }).total;
    desc += Math.max(0, sinDesc - ((Number(v.total) || 0) - (Number(v.pago.delivery) || 0))) * fx;   // sin el delivery
    if (v.estado !== "subida") sinSubir++;
    (v.pago.pagos || []).forEach(p => {
      const x = (Number(p.monto) || 0) * fx;
      if (p.tipo === "CRED") { credito += x; if (p.etiqueta === "Cashea") { cashea += x; casheaBs += (Number(p.monto) || 0) * (Number(v.tasas && v.tasas.bcv) || 0); } }   // Tanda 1: Cashea va dentro del crédito (aparte para mostrarlo)
      else if (p.tipo === "SAF") saf += x;                                               // Tanda 1: saldo a favor (no entra dinero)
      else sumar(p, Number(p.monto) || 0);
    });
    (v.pago.vuelto || []).forEach(p => sumar(p, -(Number(p.monto) || 0)));
  });
  const metodos = Object.values(met).sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "BS" ? -1 : 1) || a.desc.localeCompare(b.desc));
  const efBs = metodos.filter(m => m.efectivo && m.tipo === "BS").reduce((s, m) => s + m.neto, 0);
  const efUsd = metodos.filter(m => m.efectivo && m.tipo === "USD").reduce((s, m) => s + m.neto, 0);
  const bcvDe = v => v.totalBcv != null ? Number(v.totalBcv) || 0 : Number(v.total) || 0;
  const otroDia = { n: otras.length, totalBs: r2(otras.reduce((s, v) => s + (Number(v.totalBs) || 0), 0)), totalUsd: r2(otras.reduce((s, v) => s + bcvDe(v), 0)),
    lista: otras.map(v => ({ nro: v.numeroFactura ? "#" + v.numeroFactura : (v.numeroTicket ? "#" + v.numeroTicket : "PROV " + v.numero), fecha: v.fecha, totalBs: r2(Number(v.totalBs) || 0) })) };
  sinSubir += otras.filter(v => v.estado !== "subida").length;
  const gv = gvSuma(t.id);   // 3.3 (gaveta.js): gastos, faltantes, sobrantes y redondeos registrados en este turno
  return { ventas: vs.length, totalUsd: r2(totalUsd), totalBs: r2(totalBs), credito: r2(credito), cashea: r2(cashea), casheaBs: r2(casheaBs), saf: r2(saf), otroDia: otroDia, descuentos: r2(desc), sinSubir,
           metodos, efBsVentas: r2(efBs), efUsdVentas: r2(efUsd),
           gaveta: gvParaCierre(t.id), gavetaBs: gv.bs, gavetaUsd: gv.usd,
           efBsEsperado: r2((Number(t.fondoBs) || 0) + efBs + gv.bs), efUsdEsperado: r2((Number(t.fondoUsd) || 0) + efUsd + gv.usd) };
}
// 3.0 (Tanda 3a): el cierre va en pasos, como el módulo de Cambios. 1 y 2: contar el efectivo (sin ver cuánto
// debería haber, para que el conteo sea el real) · 3: revisar, con lo que se movió desde el sistema con el
// efectivo de esta caja (abonos, pagos a proveedores, compras, gastos, inversiones) · 4: cerrar e imprimir.
const CIE = { paso: 1, bs: "", usd: "", obs: "", sis: null, cargando: false, tid: "", qBs: "", qUsd: "", hora: "" };
// 1b/1c: hasta Bs 1 o $0,50 de diferencia es redondeo (se registra solo al cerrar). Más que eso, el turno no se cierra
// hasta que cuadre: lo que falta o sobra se registra (gaveta.js) o se vuelve a contar.
const CIE_TOL = { bs: 1, usd: 0.5 };
function cieDescuadre(x){ return x.dBs != null && x.dUsd != null && (Math.abs(x.dBs) > CIE_TOL.bs + 0.0001 || Math.abs(x.dUsd) > CIE_TOL.usd + 0.0001); }
function cieQueda(){ return { bs: CIE.qBs === "" ? null : r2(Number(CIE.qBs)), usd: CIE.qUsd === "" ? null : r2(Number(CIE.qUsd)) }; }
function cieQuedaProblema(){
  const x = cierreCalc(), q = cieQueda();
  if (q.bs == null || q.usd == null) return "Escribe cuánto efectivo queda en la gaveta en <b>Bs</b> y en <b>$</b> para el próximo turno. Si no queda nada, escribe <b>0</b>.";
  if (q.bs < 0 || q.usd < 0) return "Lo que queda no puede ser negativo.";
  if (q.bs > x.bs + 0.004) return "No puede quedar más de lo que contaste: contaste <b>Bs " + fmt(x.bs) + "</b>.";
  if (q.usd > x.usd + 0.004) return "No puede quedar más de lo que contaste: contaste <b>$" + fmt(x.usd) + "</b>.";
  return "";
}
function cieQuedaTxt(){
  const el = $("cQRes"); if (!el) return;
  const x = cierreCalc(), q = cieQueda(), p = (q.bs != null && q.usd != null) ? cieQuedaProblema() : "";
  el.innerHTML = p ? '<span class="dif-mal">⚠️ ' + p + "</span>" :
    (q.bs != null && q.usd != null ? '<div class="cie-queda"><div class="q-si">🟢 <span>Queda en la gaveta para el próximo turno:</span><b>Bs ' + fmt(q.bs) + " · $" + fmt(q.usd) + "</b></div>" +
      '<div class="q-sale">📤 <span>Sale de la gaveta (se le entrega al dueño o al encargado):</span><b>Bs ' + fmt(r2(x.bs - q.bs)) + " · $" + fmt(r2(x.usd - q.usd)) + "</b></div></div>" : "");   // 1c: más claro (lo contado ya está arriba)
}
const CIE_PASOS = [["1", "Efectivo Bs"], ["2", "Efectivo $"], ["3", "Revisar"], ["4", "Lo que queda"], ["5", "Cerrar"]];
function irCierre(){
  if (!S.turno) return;
  if (F.items.length || P) { aviso({ icono: "🧾", titulo: "Hay una venta a medias", html: "Termina la venta (o vacíala con 🗑️) antes de cerrar el turno." }); return; }
  if (CIE.tid !== S.turno.id) Object.assign(CIE, { paso: 1, bs: "", usd: "", obs: "", qBs: "", qUsd: "", hora: "", tid: S.turno.id });
  else if (CIE.paso > 3) CIE.paso = 3;   // 1b: volvió a cerrar (p. ej. registró la venta que faltaba): lo contado se queda y se revisa otra vez
  CIE.sis = null;
  mostrarVista("cierre"); pintarCierre();
  cierreTraerSistema();
}
// 4.2 · Lo que ya está registrado en el sistema con el efectivo durante este turno, sin decir de qué caja
async function cieSinCaja(){
  const t = S.turno;
  if (!t) return;
  const r = await sinCajaElegir({ desde: t.aperturaMs || msDeTexto(t.apertura), modo: "turno", turnoId: t.id,
    ayuda: "Esto se registró en el sistema con el efectivo durante este turno, sin decir de qué caja. Marca lo que salió (o entró) de <b>esta gaveta</b>: el cierre lo suma." });
  if (r) await cierreTraerSistema();
}
async function cierreTraerSistema(){
  CIE.cargando = true; pintarCierre();
  let r = null;
  try { r = await efectivoAlDia(true, true); } catch (e) { r = null; }   // cajero.js
  CIE.sis = r && r.ok ? { ok: true, movs: r.movs || [], bs: r2(r.bs), usd: r2(r.usd) } : { ok: false, movs: [], bs: 0, usd: 0 };
  CIE.cargando = false;
  if (S.vista === "cierre") pintarCierre();
}
function difHTML(d){
  if (Math.abs(d) < 0.005) return '<span class="dif-ok">✅ Cuadra</span>';
  return d > 0 ? '<span class="dif-sob">Sobra ' + fmt(d) + "</span>" : '<span class="dif-mal">Falta ' + fmt(-d) + "</span>";
}
// Lo movido desde el sistema, por tipo (Abonos de clientes, Pagos a proveedores…), en Bs y en $
function cierreSisGrupos(sis){
  const g = {};
  ((sis && sis.movs) || []).forEach(m => {
    const k = m.etiqueta || m.origen;
    const x = g[k] = g[k] || { etq: k, bs: 0, usd: 0 };
    if (m.moneda === "BS") x.bs = r2(x.bs + m.monto); else x.usd = r2(x.usd + m.monto);
  });
  return Object.values(g);
}
function cierreCalc(){
  const t = S.turno, R = resumenTurno(t), sis = CIE.sis || { ok: false, movs: [], bs: 0, usd: 0 };
  const espBs = r2(R.efBsEsperado + (sis.bs || 0)), espUsd = r2(R.efUsdEsperado + (sis.usd || 0));
  const bs = CIE.bs === "" ? null : r2(Number(CIE.bs)), usd = CIE.usd === "" ? null : r2(Number(CIE.usd));
  return { t, R, sis, espBs, espUsd, bs, usd, dBs: bs == null ? null : r2(bs - espBs), dUsd: usd == null ? null : r2(usd - espUsd) };
}
function cierrePaso(n){
  n = Number(n);
  if (n > CIE.paso + 1) return;
  if (n >= 2 && CIE.bs === "") { CIE.paso = 1; pintarCierre(); avisoConteo("Bs"); return; }
  if (n >= 3 && CIE.usd === "") { CIE.paso = 2; pintarCierre(); avisoConteo("$"); return; }
  if (n >= 3 && !CIE.hora) CIE.hora = horaDe(ahoraTxt());
  if (n >= 4 && cieDescuadre(cierreCalc())) {   // 1c: descuadrada no se cierra: se registra lo que pasó o se vuelve a contar
    CIE.paso = 3; pintarCierre();
    aviso({ icono: "⚠️", titulo: "La caja no cuadra", html: "No se puede cerrar el turno hasta que cuadre. Abajo de <b>Resultado</b> elige qué pasó y regístralo (lo autoriza un <b>administrador</b> con su contraseña), o vuelve a contar." });
    return;
  }
  if (n >= 5) { const p = cieQuedaProblema(); if (p) { CIE.paso = 4; pintarCierre(); aviso({ icono: "💵", titulo: "Revisa lo que queda en la gaveta", html: p }); return; } }
  CIE.paso = n; pintarCierre();
}
function avisoConteo(m){ aviso({ icono: "💵", titulo: "Falta el conteo en " + m, html: "Cuenta el efectivo en <b>" + m + "</b> que hay en la gaveta y escríbelo. Si no hay, escribe <b>0</b>." }); }
function cierreGuardarCampo(id, k){ const el = $(id); if (el) CIE[k] = el.value; }
function pintarCierre(){
  const box = $("cierreCard"); if (!box || !S.turno) return;
  const x = cierreCalc(), t = x.t, R = x.R;
  const barra = '<div class="pasos">' + CIE_PASOS.map(p => {
    const n = Number(p[0]), cls = n === CIE.paso ? "activo" : (n < CIE.paso ? "hecho" : "");
    return '<div class="paso ' + cls + '" onclick="cierrePaso(' + n + ')"><b>' + (n < CIE.paso ? "✓" : p[0]) + '</b><span class="lbl">' + p[1] + "</span></div>";
  }).join("") + "</div>";
  const cab = '<div class="card-tit">🔒 Cerrar turno</div>' +
    (S.cierreAdmin ? '<div class="banner av" style="margin:0 0 10px;">⭐ Lo cierra <b>' + esc(S.cierreAdmin.nombre) + "</b> porque " + esc(t.cajeroNombre) + " no está. Queda anotado en el cierre.</div>" : "") +
    '<div class="m-txt"><b>' + esc(t.cajeroNombre) + "</b> · desde " + fechaCorta(t.apertura) + " " + horaDe(t.apertura) + "</div>" + barra;
  const volver = S.cierreAdmin ? '<button type="button" class="btn" onclick="cancelarCierreAdmin()">Cancelar</button>' : '<button type="button" class="btn" onclick="irA(\'vender\')">Volver a vender</button>';
  const atras = '<button type="button" class="btn" onclick="cierrePaso(' + (CIE.paso - 1) + ')">← Atrás</button>';
  let cuerpo = "";
  if (CIE.paso === 1 || CIE.paso === 2) {
    const bs = CIE.paso === 1, id = bs ? "cBs" : "cUsd", k = bs ? "bs" : "usd", m = bs ? "Bs" : "$";
    cuerpo = '<div class="cie-paso"><div class="cie-preg">' + (bs ? "💵 ¿Cuánto efectivo en <b>Bs</b> hay en la gaveta?" : "💵 ¿Cuánto efectivo en <b>dólares ($)</b> hay en la gaveta?") + "</div>" +
      '<div class="cie-ayuda">Cuenta todos los billetes' + (bs ? "" : " en dólares") + ", también los del fondo con que abriste. Si no hay, escribe 0.</div>" +
      '<input class="inp cie-num" id="' + id + '" type="number" inputmode="decimal" min="0" step="any" placeholder="' + m + ' contados" value="' + esc(CIE[k]) + '" oninput="cierreGuardarCampo(\'' + id + "','" + k + '\')" onkeydown="if(event.key===\'Enter\'){event.preventDefault();cierrePaso(' + (CIE.paso + 1) + ');}">' +
      "</div>" +
      '<div class="m-btns">' + (bs ? volver : atras) + '<button type="button" class="btn green" onclick="cierrePaso(' + (CIE.paso + 1) + ')">Siguiente →</button></div>';
  } else if (CIE.paso === 3) {
    const filasMet = R.metodos.map(m => "<tr><td>" + esc(m.desc) + '</td><td class="r">' + (m.tipo === "BS" ? "Bs " : "$") + fmt(m.neto) + "</td></tr>").join("") +
      (r2(R.credito - (R.cashea || 0)) > 0.004 ? '<tr><td>📝 A crédito (no entra a caja)</td><td class="r">$' + fmt(r2(R.credito - (R.cashea || 0))) + "</td></tr>" : "") +
      (R.cashea ? '<tr><td>🛍️ Cashea paga después (no entra a caja)</td><td class="r">Bs ' + fmt(R.casheaBs) + "</td></tr>" : "") +
      (R.saf ? '<tr><td>🎁 Saldo a favor (no entra a caja)</td><td class="r">$' + fmt(R.saf) + "</td></tr>" : "");
    const od = R.otroDia || { n: 0, lista: [] };   // Tanda 1: ventas de otro día hechas en este turno
    const filasOd = od.n ? '<div class="cie-tit">📅 Ventas de otro día (no cuentan en la gaveta)</div><table class="cie-tabla">' + od.lista.map(o => "<tr><td>" + esc(o.nro) + " · del " + fechaCorta(o.fecha) + '</td><td class="r">Bs ' + fmt(o.totalBs) + "</td></tr>").join("") +
      '</table><div class="cie-ayuda" style="margin-top:4px;">Se registran con su fecha y las tasas de ese día. Su dinero no se pide en la gaveta de hoy.</div>' : "";
    const sg = cierreSisGrupos(x.sis);
    const sgn = v => (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v));
    const filasSis = sg.map(g => "<tr><td>" + (g.bs + g.usd >= 0 ? "+ " : "− ") + esc(g.etq) + ' <span class="cie-sis">(del sistema)</span></td><td class="r">' + (g.bs ? sgn(g.bs) : "—") + '</td><td class="r">' + (g.usd ? sgn(g.usd) : "—") + "</td></tr>").join("");
    const fila = (a, b, c, cls) => '<tr' + (cls ? ' class="' + cls + '"' : "") + "><td>" + a + '</td><td class="r">' + b + '</td><td class="r">' + c + "</td></tr>";
    const filasGv = (R.gaveta || []).map(m => fila((m.signo < 0 ? "− " : "+ ") + esc(gvEtiqueta(m)) + ' <span class="cie-sis">(' + esc(m.hora) + ")</span>",
      m.moneda === "BS" ? sgn(m.signo * m.monto) : "—", m.moneda === "USD" ? sgn(m.signo * m.monto) : "—")).join("");   // 1c (gaveta.js)
    cuerpo = (CIE.cargando ? '<div class="banner" style="margin:0 0 10px;background:var(--bg3);">⏳ Revisando en el sistema si se movió efectivo de esta caja…</div>' : "") +
      (!CIE.cargando && x.sis && !x.sis.ok ? '<div class="banner av" style="margin:0 0 10px;">📡 Sin internet no pude revisar si desde el sistema se movió efectivo de esta caja (abonos, pagos a proveedores, compras, gastos). Si cuadra, puedes cerrar igual: cuando el cierre llegue al sistema, se le suma lo que falte y se te avisa.</div>' : "") +
      (R.sinSubir ? '<div class="banner av" style="margin:0 0 10px;">⏳ ' + R.sinSubir + " venta" + (R.sinSubir > 1 ? "s" : "") + " de este turno todavía no " + (R.sinSubir > 1 ? "están" : "está") + " en el sistema. Puedes cerrar igual: se suben solas cuando haya internet.</div>" : "") +
      (CIE.hora ? '<div class="cie-ayuda" style="margin:0 0 6px;">Con lo que contaste a las ' + esc(CIE.hora) + '. Si entró o salió efectivo después, vuelve a contar en el paso 1.</div>' : "") +
      '<div class="cie-tit">Efectivo en la gaveta</div>' +
      '<table class="cie-tabla"><tr><td></td><td class="r">Bs</td><td class="r">$</td></tr>' +
      fila("Fondo inicial", fmt(t.fondoBs), fmt(t.fondoUsd)) +
      fila("+ Efectivo de las ventas (menos vuelto)", fmt(R.efBsVentas), fmt(R.efUsdVentas)) + filasSis + filasGv +
      fila("<b>= Debe haber</b>", "<b>" + fmt(x.espBs) + "</b>", "<b>" + fmt(x.espUsd) + "</b>") +
      fila("Contaste", fmt(x.bs), fmt(x.usd)) +
      fila("<b>Resultado</b>", difHTML(x.dBs), difHTML(x.dUsd), "cie-res") + "</table>" + cieBloqueDescuadre(x) +
      (x.sis && x.sis.movs.length ? '<div class="cie-tit">Movido desde el sistema</div><div class="cie-movs">' + x.sis.movs.map(m =>
        "<div><b>" + (m.monto >= 0 ? "+" : "−") + (m.moneda === "BS" ? "Bs " : "$") + fmt(Math.abs(m.monto)) + "</b> · " + esc(m.etiqueta) + (m.usuario ? " · " + esc(m.usuario) : "") + (m.hora ? " · " + esc(m.hora) : "") +
        (m.detalle ? '<div class="cie-sis">' + esc(m.detalle) + "</div>" : "") + "</div>").join("") + "</div>" : "") +
      '<div class="res" style="margin-top:12px;"><div><span>Ventas</span><b>' + R.ventas + '</b></div><div><span>Total</span><b>Bs ' + fmt(R.totalBs) + '</b><span style="text-transform:none;">$' + fmt(R.totalUsd) + " BCV</span></div>" +
      (R.descuentos ? '<div><span>Descuentos</span><b>$' + fmt(R.descuentos) + "</b></div>" : "") + "</div>" +
      '<div class="cie-tit">Por método (cobrado menos vuelto)</div><table class="cie-tabla">' + (filasMet || '<tr><td colspan="2" style="color:var(--text-dim);">Sin ventas en este turno.</td></tr>') + "</table>" + filasOd +
      '<div class="m-btns">' + atras + '<button type="button" class="btn green" onclick="cierrePaso(4)">Siguiente →</button></div>';
  } else if (CIE.paso === 4) {   // 1b: lo que queda en la gaveta para el próximo turno (su fondo)
    cuerpo = '<div class="cie-paso"><div class="cie-preg">💵 ¿Cuánto efectivo <u>DEJAS en la gaveta</u> para el próximo turno?</div>' +
      '<div class="cie-ayuda">Contaste <b>Bs ' + fmt(x.bs) + "</b> y <b>$" + fmt(x.usd) + "</b>. Escribe lo que <b>se queda</b> en la gaveta (el fondo con que abre el que sigue: lo va a contar al abrir). Lo demás sale de la gaveta y se le entrega al dueño o al encargado. Si no queda nada, escribe 0.</div>" +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:left;"><div><label class="lbl" for="cQBs" style="margin-top:0;">Se queda en la gaveta (Bs)</label>' +
      '<input class="inp cie-num" id="cQBs" type="number" inputmode="decimal" min="0" step="any" placeholder="Bs que se quedan" value="' + esc(CIE.qBs) + '" oninput="cierreGuardarCampo(\'cQBs\',\'qBs\');cieQuedaTxt()" onkeydown="if(event.key===\'Enter\'){event.preventDefault();$(\'cQUsd\').focus();}"></div>' +
      '<div><label class="lbl" for="cQUsd" style="margin-top:0;">Se queda en la gaveta ($)</label>' +
      '<input class="inp cie-num" id="cQUsd" type="number" inputmode="decimal" min="0" step="any" placeholder="$ que se quedan" value="' + esc(CIE.qUsd) + '" oninput="cierreGuardarCampo(\'cQUsd\',\'qUsd\');cieQuedaTxt()" onkeydown="if(event.key===\'Enter\'){event.preventDefault();cierrePaso(5);}"></div></div>' +
      '<div class="cie-res" id="cQRes" style="margin-top:10px;"></div></div>' +
      '<div class="m-btns">' + atras + '<button type="button" class="btn green" onclick="cierrePaso(5)">Siguiente →</button></div>';
  } else {
    const q = cieQueda(), cent = [["BS", x.dBs], ["USD", x.dUsd]].filter(z => z[1] != null && Math.abs(z[1]) >= 0.005);
    cuerpo = '<div class="cie-paso"><div class="cie-preg">✅ El efectivo cuadra.</div>' +
      (cent.length ? '<div class="cie-ayuda">🪙 Diferencia de centavos (' + cent.map(z => (z[1] > 0 ? "sobra " : "falta ") + gvPlata(z[0], z[1])).join(" · ") + "): al cerrar se registra sola como <b>Redondeo de caja</b>.</div>" : "") +
      '<div class="cie-ayuda">Se cierra el turno de <b>' + esc(t.cajeroNombre) + "</b> con " + R.ventas + " venta" + (R.ventas === 1 ? "" : "s") + " por Bs " + fmt(R.totalBs) + ".</div>" +
      '<table class="cie-tabla" style="margin-top:8px;">' +
      '<tr><td>🟢 Queda en la gaveta para el próximo turno</td><td class="r"><b>Bs ' + fmt(q.bs) + " · $" + fmt(q.usd) + "</b></td></tr>" +
      '<tr><td>📤 Sale de la gaveta (al dueño o al encargado)</td><td class="r"><b>Bs ' + fmt(r2(x.bs - q.bs)) + " · $" + fmt(r2(x.usd - q.usd)) + "</b></td></tr></table>" +
      '<label class="lbl" for="cObs">Observación (opcional)</label><input class="inp" id="cObs" maxlength="200" placeholder="Ej. el dueño se llevó lo entregado al banco" value="' + esc(CIE.obs) + '" oninput="cierreGuardarCampo(\'cObs\',\'obs\')"></div>' +
      '<div class="m-btns">' + atras + '<button type="button" class="btn naranja" id="btnCerrarTurno" onclick="cerrarTurno(this)">🔒 Cerrar turno</button></div>';
  }
  box.innerHTML = cab + cuerpo;
  if (CIE.paso === 4) cieQuedaTxt();
  if (CIE.paso <= 2 || CIE.paso === 4) setTimeout(() => { const i = $(CIE.paso === 1 ? "cBs" : CIE.paso === 2 ? "cUsd" : "cQBs"); if (i && !i.value && window.innerWidth > 820) i.focus(); }, 30);
}
// Paso 3 (1c): si no cuadra, por cada moneda qué pasó y cómo registrarlo. Sin que cuadre no se pasa al paso 4.
function cieBloqueDescuadre(x){
  if (x.dBs == null || x.dUsd == null) return "";
  if (!cieDescuadre(x)) {
    const cent = [["BS", x.dBs], ["USD", x.dUsd]].filter(z => Math.abs(z[1]) >= 0.005);
    return cent.length ? '<div class="cie-ayuda" style="margin-top:8px;">🪙 Diferencia de centavos (' + cent.map(z => (z[1] > 0 ? "sobra " : "falta ") + gvPlata(z[0], z[1])).join(" · ") +
      "): al cerrar se registra sola como <b>Redondeo de caja</b>.</div>" : "";
  }
  const caja = (S.datos && S.datos.caja) || "";
  const bloque = (mon, d) => {
    const tol = mon === "BS" ? CIE_TOL.bs : CIE_TOL.usd;
    if (Math.abs(d) <= tol + 0.0001) return "";
    const p = gvPlata(mon, d), m = Math.abs(d);
    if (d < 0) return '<div class="cie-mon"><div class="cie-preg">🔻 Faltan <b>' + p + "</b> en la gaveta. ¿Qué pasó?</div>" +
      '<div class="cie-mots">' +
      '<button type="button" class="cie-mot" onclick="gvGasto({ moneda: \'' + mon + "', monto: " + m + ' })">💸 Se pagó un gasto con el efectivo de la gaveta<small>Agua, hielo, un flete… Se registra en Egresos con su tipo.</small></button>' +
      '<button type="button" class="cie-mot" onclick="gvAjuste(\'faltante\', \'' + mon + "', " + m + ')">💱 Registrar faltante de caja de ' + p + "<small>Un vuelto de más, un billete que no aparece… Se registra como gasto «Faltante de caja».</small></button></div></div>";
    return '<div class="cie-mon"><div class="cie-preg">🔺 Sobran <b>' + p + "</b> en la gaveta. ¿Qué pasó?</div>" +
      '<div class="cie-mots">' +
      '<button type="button" class="cie-mot" onclick="irA(\'vender\')">🧾 Falta registrar una venta<small>Cóbrala como siempre y vuelve a 🔒 Cerrar turno: lo contado se guarda y la venta entra en este turno.</small></button>' +
      '<button type="button" class="cie-mot" onclick="gvAjuste(\'sobrante\', \'' + mon + "', " + m + ')">💰 Registrar sobrante de caja de ' + p + "<small>Se registra como ingreso extra «Sobrante de caja».</small></button></div></div>";
  };
  const sinSis = x.sis && !x.sis.ok && !CIE.cargando;
  return '<div class="cie-desc"><div class="cie-preg">⚠️ La caja no cuadra. No se puede cerrar el turno hasta que cuadre.</div>' +
    '<div class="cie-ayuda">Registra lo que pasó (lo autoriza un <b>administrador</b> con su contraseña) para que las cuentas del negocio queden como la gaveta, o vuelve a contar.</div>' +
    (sinSis ? '<div class="cie-arreglo">📡 Sin internet no pude revisar si desde el sistema se movió efectivo de esta caja. Si alguien registró un pago o un gasto desde el sistema eligiendo la <b>Caja ' + esc(caja) + "</b>, espera el internet y toca <b>🔄 Revisar otra vez</b> antes de registrar un faltante.</div>" : "") +
    bloque("BS", x.dBs) + bloque("USD", x.dUsd) +
    '<div class="cie-arreglo">¿Se pagó o se cobró algo desde el <b>sistema</b> (Egresos, Proveedores, Compras, Clientes, Finanzas) con el efectivo de esta caja?' +
    '<div class="cie-mots" style="margin-top:8px;"><button type="button" class="cie-mot" onclick="cieSinCaja()">📋 Ya está registrado en el sistema<small>Si no dijeron de qué caja salió, elígelo aquí (lo autoriza un administrador) y el cierre lo suma.</small></button></div>' +
    '<div class="cie-ayuda" style="margin:8px 0 0;">Si todavía no está registrado: que lo registren eligiendo <b>Caja ' + esc(caja) + "</b> en <b>¿De qué caja salió?</b> y toca <b>🔄 Revisar otra vez</b>.</div></div>" +
    '<div class="m-btns" style="justify-content:flex-start;margin-top:4px;"><button type="button" class="btn sm" onclick="cierrePaso(1)">🔢 Contar otra vez</button>' +
    '<button type="button" class="btn sm" onclick="cierreTraerSistema()"' + (CIE.cargando ? " disabled" : "") + ">🔄 Revisar otra vez</button></div></div>";
}
async function cerrarTurno(btn){
  if (btn && btn.disabled) return;
  if (CIE.bs === "" || CIE.usd === "") { cierrePaso(CIE.bs === "" ? 1 : 2); return; }
  if (CIE.cargando) { aviso({ icono: "⏳", titulo: "Un momento", html: "Todavía estoy revisando en el sistema si se movió efectivo de esta caja. Espera unos segundos y vuelve a tocar <b>Cerrar turno</b>." }); return; }
  if (cieDescuadre(cierreCalc())) { cierrePaso(4); return; }   // 1c: lo manda al paso 3 con el aviso
  if (cieQuedaProblema()) { cierrePaso(5); return; }
  btnOcupado(btn, "Cerrando…");
  const red = await gvRedondeo(cierreCalc());   // 1c (gaveta.js): los centavos que no cuadran, como «Redondeo de caja»
  if (!red) { btnLibre(btn); return; }
  const x = cierreCalc(), t = x.t, R = x.R, sis = x.sis, q = cieQueda();
  const c = Object.assign({}, R, { id: t.id, cajeroId: t.cajeroId, cajeroNombre: t.cajeroNombre, apertura: t.apertura, aperturaMs: t.aperturaMs || 0, cierre: ahoraTxt(), cierreMs: Date.now(),
    fondoBs: t.fondoBs, fondoUsd: t.fondoUsd, efBsContado: x.bs, efUsdContado: x.usd, efBsEsperado: x.espBs, efUsdEsperado: x.espUsd, efBsDif: x.dBs, efUsdDif: x.dUsd,
    sistemaOk: !!sis.ok, sistemaBs: r2(sis.bs || 0), sistemaUsd: r2(sis.usd || 0), sistemaGrupos: cierreSisGrupos(sis),
    obs: [S.cierreAdmin ? "Lo cerró " + S.cierreAdmin.nombre + " (" + t.cajeroNombre + " no estaba)." : "",
          t.fondoExpl ? "Al abrir, el fondo no coincidía: " + t.fondoExpl + "." : "",
          String(CIE.obs || "").trim()].filter(Boolean).join(" "),
    cerradoPor: S.cierreAdmin ? S.cierreAdmin.nombre : t.cajeroNombre,
    queda: { bs: q.bs, usd: q.usd }, entregado: { bs: r2(x.bs - q.bs), usd: r2(x.usd - q.usd) },   // 1b: fondo encadenado
    fondoPrev: t.fondoPrev || null, fondoExpl: t.fondoExpl || "",
    caja: S.datos.caja, equipo: S.datos.equipo, estado: "por_subir", msg: "" });
  c.metodos = R.metodos.map(m => ({ metodo: m.metodo, tipo: m.tipo, desc: m.desc, neto: m.neto, efectivo: m.efectivo }));
  S.cierres.push(c);
  const uf = { caja: S.datos.caja, bs: q.bs, usd: q.usd, cajero: c.cajeroNombre, cierre: c.cierre, cierreMs: c.cierreMs, turno: t.id };   // 4.2: con la hora real (ms)
  try { await kvSet("cierres", S.cierres); await kvSet("turno", null); await kvSet("ultFondo", uf); S.ultFondo = uf; CIE.tid = ""; }
  catch (e) { btnLibre(btn); S.cierres.pop(); aviso({ icono: "❌", titulo: "No se cerró el turno", html: "El equipo no pudo guardar el cierre (" + esc(e.message) + "). Vuelve a intentar." }); return; }
  S.turno = null; S.cierreAdmin = null;
  btnLibre(btn);
  pintarCabecera(); pintarEstado();
  numerosAlDia();   // numeros.js: sin turno, los números apartados que no se usaron vuelven al sistema
  const r = await modal({ icono: "✅", titulo: "Turno cerrado", html: '<div class="m-txt">Cierre de <b>' + esc(c.cajeroNombre) + "</b> guardado." + (S.online ? " Se sube al sistema en un momento." : " Se sube solo al sistema cuando haya internet.") + "</div>",
    botones: [{ txt: "Sin imprimir", v: false }, { txt: "🖨️ Imprimir cierre", v: true, cls: "green" }] });
  if (r) imprimirHTML(htmlCierre(c));
  sincronizar();
  irA("vender");
}
function htmlCierre(c){
  const d = S.datos || {}, cfg = d.impresion || {}, fmtT = formatoTicket();
  const fila = (a, b) => "<tr><td>" + a + '</td><td style="text-align:right;">' + b + "</td></tr>";
  const dif = x => Math.abs(x) < 0.005 ? "CUADRA" : (x > 0 ? "SOBRA " : "FALTA ") + fmt(Math.abs(x));
  const sgn = v => (v >= 0 ? "+" : "-") + fmt(Math.abs(v));
  const sis = (c.sistemaGrupos || []), sisBs = sis.filter(g => g.bs), sisUsd = sis.filter(g => g.usd);
  const gvBs = (c.gaveta || []).filter(m => m.moneda === "BS"), gvUsd = (c.gaveta || []).filter(m => m.moneda === "USD");   // 1c
  const gvTxt = m => ({ gasto: "Gasto " + (m.cat || ""), faltante: "Faltante", sobrante: "Sobrante", redondeo: "Redondeo" }[m.tipo] || m.tipo) + (m.autorizo ? " (aut. " + m.autorizo + ")" : "");
  const sinSis = c.sistemaOk === false ? '<tr><td colspan="2">(Sin internet al cerrar: falta lo movido desde el sistema)</td></tr>' : "";
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Cierre ' + esc(c.cajeroNombre) + "</title>" + estiloPapel(fmtT) + "</head><body>" +
    '<div style="text-align:center;padding:8px 0 5px;"><div style="font-size:13px;">' + esc(d.negocio || "") + "</div><div>CIERRE DE CAJA</div><div>Caja " + esc(c.caja || d.caja) + " · equipo " + esc(c.equipo || d.equipo) + "</div></div>" +
    '<hr class="sep"><table>' + fila("Cajero:", esc(c.cajeroNombre)) + fila("Apertura:", esc(c.apertura)) + fila("Cierre:", esc(c.cierre)) + fila("Ventas:", c.ventas) +
    fila("Total:", "Bs " + fmt(c.totalBs)) + fila("Total $ BCV:", "$" + fmt(c.totalUsd)) + (c.descuentos ? fila("Descuentos:", "$" + fmt(c.descuentos)) : "") + "</table>" +
    '<hr class="sep"><div style="font-size:9px;text-transform:uppercase;margin-bottom:3px;">Por método (menos vuelto)</div><table>' +
    (c.metodos || []).map(m => fila(esc(String(m.desc || m.metodo).replace(/^[^\wÁÉÍÓÚÑáéíóúñ]+\s*/, "")), (m.tipo === "BS" ? "Bs " : "$") + fmt(m.neto))).join("") + (r2(c.credito - (c.cashea || 0)) > 0.004 ? fila("A crédito:", "$" + fmt(r2(c.credito - (c.cashea || 0)))) : "") +
    (c.cashea ? fila("Cashea:", "Bs " + fmt(c.casheaBs != null ? c.casheaBs : c.cashea)) : "") + (c.saf ? fila("Saldo a favor:", "$" + fmt(c.saf)) : "") + "</table>" +
    (c.otroDia && c.otroDia.n ? '<hr class="sep"><div style="font-size:9px;text-transform:uppercase;margin-bottom:3px;">Ventas de otro día (no van en la gaveta)</div><table>' +
      c.otroDia.lista.map(o => fila(esc(o.nro) + " del " + fechaCorta(o.fecha), "Bs " + fmt(o.totalBs))).join("") + "</table>" : "") +
    '<hr class="sep"><div style="font-size:9px;text-transform:uppercase;margin-bottom:3px;">Efectivo Bs</div><table>' +
    fila("Fondo:", fmt(c.fondoBs)) + fila("Ventas:", fmt(c.efBsVentas)) + sisBs.map(g => fila(esc(g.etq) + ":", sgn(g.bs))).join("") + gvBs.map(m => fila(esc(gvTxt(m)) + ":", sgn(m.signo * m.monto))).join("") + sinSis +
    fila("Debe haber:", fmt(c.efBsEsperado)) + fila("Contado:", fmt(c.efBsContado)) + fila("Resultado:", dif(c.efBsDif)) +
    (c.queda ? fila("Queda en gaveta:", fmt(c.queda.bs)) + fila("Sale (entregado):", fmt(c.entregado.bs)) : "") + "</table>" +
    '<hr class="sep"><div style="font-size:9px;text-transform:uppercase;margin-bottom:3px;">Efectivo $</div><table>' +
    fila("Fondo:", fmt(c.fondoUsd)) + fila("Ventas:", fmt(c.efUsdVentas)) + sisUsd.map(g => fila(esc(g.etq) + ":", sgn(g.usd))).join("") + gvUsd.map(m => fila(esc(gvTxt(m)) + ":", sgn(m.signo * m.monto))).join("") + sinSis +
    fila("Debe haber:", fmt(c.efUsdEsperado)) + fila("Contado:", fmt(c.efUsdContado)) + fila("Resultado:", dif(c.efUsdDif)) +
    (c.queda ? fila("Queda en gaveta:", fmt(c.queda.usd)) + fila("Sale (entregado):", fmt(c.entregado.usd)) : "") + "</table>" +
    (c.sinSubir ? '<hr class="sep"><div>Ventas sin subir al cerrar: ' + c.sinSubir + "</div>" : "") +
    (c.obs ? '<hr class="sep"><div>Obs: ' + esc(c.obs) + "</div>" : "") +
    '<div style="margin-top:28px;border-top:1px solid #000;text-align:center;padding-top:3px;">Firma del cajero</div>' +
    '<div style="text-align:center;margin-top:8px;font-size:9px;">Impreso ' + esc(ahoraTxt()) + "</div></body></html>";
}

// ══ SUBIR LAS VENTAS AL SISTEMA ══
function datosParaSubir(v){
  return { id: v.id, numero: v.numero, creada: v.creada, fecha: v.fecha, tasas: v.tasas, items: v.items, pago: v.pago,
           numeroFactura: v.numeroTicket || 0, turno: v.turno || "", caja: Number(v.caja) || 0 };   // S2: la caja donde se vendió
}
async function sincronizar(manual){
  if (!S.eq || !S.datos || S.sincronizando) return { subidas: 0 };
  if (S.permisoMal && !manual && !S.reemplazado) return { subidas: 0 };   // 4.1: el equipo reemplazado sí sube lo que vendió
  // De la más vieja a la más nueva (y a igual hora, por número de ticket)
  const cola = S.ventas.filter(v => v.estado === "por_subir").sort((a, b) => String(a.creada).localeCompare(String(b.creada)) || (Number(a.numeroTicket) || 0) - (Number(b.numeroTicket) || 0));
  if (!cola.length) { await subirCierres(); await numerosAlDia(); await ordAlDia(); await efectivoAlDia(); await copiasAlDia(); if (manual) await actualizarDatos(null, true); return { subidas: 0 }; }
  S.sincronizando = true; pintarEstado();
  let subidas = 0, cortado = "";
  try {
    for (const v of cola) {
      let r;
      v.intentos = (v.intentos || 0) + 1; v.ultimoIntento = ahoraTxt();
      try { r = await api("cj_subir", { venta: datosParaSubir(v) }, 120000); }
      catch (e) { v.msg = e.message; await ventaPut(v); cortado = e.message; break; }
      if (r && r.codigo === "EQUIPO") { revisarErrorSistema(r); v.msg = r.msg; await ventaPut(v); cortado = r.msg; break; }
      S.permisoMal = "";
      if (!(r && r.reintentar)) v.temporales = 0;
      if (r && r.ok) {
        v.estado = "subida"; v.numeroFactura = String(r.numero || ""); v.avisos = r.avisos || []; v.msg = ""; v.subidaEn = Date.now(); v.revisar = false;
        subidas++;
      } else if (r && r.estado === "procesando") {
        v.msg = r.msg || "Se está subiendo desde otro lado.";
        await ventaPut(v); cortado = ""; break;   // se espera: las que siguen no se adelantan
      } else if (r && r.estado === "invalida") {
        v.estado = "invalida"; v.msg = r.msg || "El sistema rechazó la venta.";
      } else if (r && r.reintentar) {
        v.msg = r.msg || "El sistema estaba ocupado."; v.temporales = (v.temporales || 0) + 1;
        await ventaPut(v);
        if (v.temporales < 3) break;              // se vuelve a intentar en orden, empezando por esta
        pintarEstado(); continue;                 // S2: falló 3 veces seguidas: queda por subir, pero ya no tranca a las que siguen
      } else {
        v.estado = "pendiente"; v.msg = (r && r.msg) || "El sistema no la pudo registrar.";
        v.revisar = !!(r && (r.codigo === "REVISAR" || r.codigo === "CLAVE"));   // S2: algo no cuadra → 🔑 Subir igual
      }
      await ventaPut(v);
      _vendidoLocal = null;
      pintarEstado();
    }
  } finally {
    S.sincronizando = false;
    pintarEstado(); pintarBanners();
    if (S.vista === "ventas") pintarVentas();
  }
  if (!cortado) { await subirCierres(); await numerosAlDia(); await ordAlDia(); await efectivoAlDia(); await copiasAlDia(); }   // 3.0: cajero.js · 3.9: copias para reimprimir (tanda2.js)
  if (subidas && S.online) { await actualizarDatos(null, true); contarOrdenes(); }   // existencias al día (y las órdenes que se convirtieron)
  return { subidas, cortado };
}
async function subirCierres(){
  try { await gvSubir(); } catch (e) {}   // 3.3 (gaveta.js): primero lo de la gaveta
  for (const c of S.cierres.filter(x => x.estado === "por_subir")) {
    let r;
    try { r = await api("cj_cierre", { cierre: c }, 60000); } catch (e) { return; }
    if (r && r.ok) {
      c.estado = "subido"; c.msg = "";
      if (r.sistema && r.sistema.cambio) {   // 3.0: el sistema le sumó al cierre efectivo movido desde el sistema que la caja no alcanzó a ver
        c.sistemaFinal = { bs: r2(r.sistema.bs), usd: r2(r.sistema.usd), difBs: r2(r.sistema.difBs), difUsd: r2(r.sistema.difUsd) };
        const falta = (v, m) => Math.abs(v) < 0.005 ? "" : (v > 0 ? "+" : "−") + (m === "BS" ? "Bs " : "$") + fmt(Math.abs(v));
        const extraBs = r2(c.sistemaFinal.bs - (c.sistemaBs || 0)), extraUsd = r2(c.sistemaFinal.usd - (c.sistemaUsd || 0));
        await kvSet("cierres", S.cierres);
        aviso({ icono: "💵", titulo: "El sistema completó un cierre", html: "Al cierre del turno de <b>" + esc(c.cajeroNombre) + "</b> (" + esc(fechaCorta(c.apertura)) + " " + esc(horaDe(c.apertura)) + ") le faltaba efectivo movido desde el sistema: " +
          [falta(extraBs, "BS"), falta(extraUsd, "USD")].filter(Boolean).join(" y ") + " (abonos, pagos a proveedores, compras o gastos de esta caja).<br><br>" +
          "Con eso el resultado real es:<br>• Bs: " + difHTML(c.sistemaFinal.difBs) + "<br>• $: " + difHTML(c.sistemaFinal.difUsd) + "<br><br>Queda anotado en el sistema." });
      }
    } else { c.msg = (r && r.msg) || "No se pudo subir."; if (r && r.codigo === "EQUIPO") return; }
    await kvSet("cierres", S.cierres);
  }
}
async function subirAhora(btn){
  btnOcupado(btn, "Subiendo…");
  const r = await sincronizar(true);
  btnLibre(btn);
  const c = cuentas();
  if (r && r.cortado) aviso({ icono: "📡", titulo: "No se pudo subir", html: esc(r.cortado) + "<br><br>Las ventas siguen guardadas en este equipo y se suben solas cuando haya conexión." });
  else if (r && r.subidas) toast("✅ " + r.subidas + " venta" + (r.subidas > 1 ? "s subidas" : " subida"));
  else if (!c.por && !c.mal) toast("✅ Todo está subido");
  pintarVentas();
}
// S2: el sistema no la registró porque algo no cuadra (tasa, total, precio o caja). Si está bien así, el
// administrador la sube igual con la clave de precio manual del sistema (la de Ventas) y queda el aviso.
async function subirIgual(id, btn){
  const v = S.ventas.find(x => x.id === id); if (!v) return;
  if (!hayInternet()) { aviso({ icono: "📡", titulo: "Hace falta internet", html: "Para subirla igual, el sistema tiene que revisar la clave: conéctate a internet y vuelve a intentar." }); return; }
  let res = null;
  const ok = await modal({
    icono: "🔑", titulo: "Subir igual esta venta",
    html: '<div class="m-txt">' + esc(v.msg || "El sistema no la registró porque algo no cuadra.") + "<br><br>Si está bien así, escribe la <b>clave de precio manual</b> del sistema (la misma de Ventas): se registra tal como se cobró y queda el aviso.</div>" +
      '<input class="inp" id="mClaveS" type="password" placeholder="Clave de precio manual" autocomplete="off" style="margin-top:10px;" onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.closest(\'.modal\').querySelector(\'[data-v=ok]\').click();}"><div class="m-err" id="mClaveSErr"></div>',
    botones: [{ txt: "Cancelar", v: false }, { txt: "🔑 Subir igual", v: true, cls: "green", spin: "Subiendo…" }],
    foco: "mClaveS",
    antes: async (x) => {
      if (!x) return true;
      const err = $("mClaveSErr"), val = $("mClaveS").value;
      if (!val) { err.textContent = "Escribe la clave."; return false; }
      try { res = await api("cj_subir", { venta: datosParaSubir(v), aprobar: val }, 120000); }
      catch (e) { err.textContent = e.message; return false; }
      if (res && res.codigo === "CLAVE") { err.textContent = res.msg || "La clave no es correcta."; $("mClaveS").value = ""; $("mClaveS").focus(); res = null; return false; }
      if (res && res.codigo === "EQUIPO") { err.textContent = res.msg; return false; }
      return true;
    }
  });
  if (!ok || !res) return;
  v.intentos = (v.intentos || 0) + 1; v.ultimoIntento = ahoraTxt();
  if (res.ok) { v.estado = "subida"; v.numeroFactura = String(res.numero || ""); v.avisos = res.avisos || []; v.msg = ""; v.subidaEn = Date.now(); v.revisar = false; toast("✅ Venta subida: #" + v.numeroFactura); }
  else if (res.reintentar || res.estado === "procesando") { v.estado = "por_subir"; v.msg = res.msg || ""; v.revisar = false; }
  else { v.estado = "pendiente"; v.msg = res.msg || "El sistema no la pudo registrar."; v.revisar = res.codigo === "REVISAR"; }
  await ventaPut(v); _vendidoLocal = null;
  pintarEstado(); pintarBanners(); pintarVentas();
  if (!res.ok) aviso({ icono: "⚠️", titulo: "No se registró", html: esc(v.msg) });
}
async function reintentar(id, btn){
  const v = S.ventas.find(x => x.id === id); if (!v) return;
  v.estado = "por_subir"; v.msg = "";
  await ventaPut(v);
  await subirAhora(btn);
}

// ══ VENTAS DEL EQUIPO ══
function diaDe(v){ return String(v.creada || v.fecha || "").slice(0, 10); }   // el día en que se hizo la venta en el equipo
function filtrarVentas(f){ S.filtro = f; document.querySelectorAll("#filtros button").forEach(b => b.classList.toggle("on", b.dataset.f === f)); pintarVentas(); }
function estadoHTML(v){
  if (v.estado === "subida") return (v.avisos && v.avisos.length) ? '<span class="est av">⚠️ En el sistema #' + esc(v.numeroFactura) + " · con avisos</span>" : '<span class="est sub">✅ En el sistema #' + esc(v.numeroFactura) + "</span>";
  if (v.estado === "por_subir") return '<span class="est por">⏳ Por subir</span>';
  return '<span class="est mal">❌ No se registró</span>';
}
function pintarVentas(){
  const hoy = hoyTxt();
  const deHoy = S.ventas.filter(v => diaDe(v) === hoy);   // Tanda 1: lo hecho hoy en este equipo (también las ventas de otro día)
  const bcvDe = v => v.totalBcv != null ? Number(v.totalBcv) || 0 : Number(v.total) || 0;   // en $ BCV (una Venta en Dólares, pasada con sus tasas)
  const sumBs = deHoy.reduce((s, v) => s + (Number(v.totalBs) || 0), 0), sumUsd = deHoy.reduce((s, v) => s + bcvDe(v), 0);
  const c = cuentas();
  // Por método (hoy): lo cobrado menos el vuelto
  const porMet = {};
  deHoy.forEach(v => {
    (v.pago.pagos || []).forEach(p => { const k = p.metodo + "|" + p.tipo; porMet[k] = (porMet[k] || 0) + (Number(p.monto) || 0); });
    (v.pago.vuelto || []).forEach(p => { const k = p.metodo + "|" + p.tipo; porMet[k] = (porMet[k] || 0) - (Number(p.monto) || 0); });
  });
  const tu = S.turno;   // 1b: con cuánto abrió el turno y quién
  const fi = tu ? (tu.fondoContado || { bs: tu.fondoBs, usd: tu.fondoUsd }) : null;   // 3.6: lo que había en la gaveta al abrir
  // 3.7: tarjetas con ícono y color
  const tj = (cls, ico, lbl, val, sub) => '<div class="rc ' + cls + '"><div class="rc-ico">' + ico + '</div><div class="rc-tx"><span class="rc-lbl">' + lbl + "</span>" + val + (sub ? '<span class="rc-sub">' + sub + "</span>" : "") + "</div></div>";
  let h = (tu ? tj("rc-verde", "👤", "Turno abierto", "<b>" + esc(tu.cajeroNombre) + "</b>", "desde las " + horaDe(tu.apertura)) +
      tj("rc-verde rc-fondo", "💵", "Fondo inicial de la caja", '<b>Bs ' + fmt(fi.bs) + '</b><b class="rc-b2">$' + fmt(fi.usd) + "</b>") : "") +
    tj("rc-morado", "🧾", "Ventas de hoy", "<b>" + deHoy.length + "</b>", deHoy.length === 1 ? "venta" : "ventas") +
    tj("rc-ambar", "💰", "Total de hoy", "<b>Bs " + fmt(sumBs) + "</b>", "$" + fmt(sumUsd) + " BCV") +
    tj(c.por ? "rc-azul" : "rc-gris", c.por ? "⏳" : "☁️", "Por subir", "<b>" + c.por + "</b>", c.por ? "se suben solas con internet" : "todo está en el sistema") +
    tj(c.mal ? "rc-rojo" : "rc-gris", c.mal ? "⚠️" : "✅", "Con problema", "<b>" + c.mal + "</b>", c.mal ? "revísalas abajo" : "ninguna");
  const mets = Object.keys(porMet);
  if (mets.length) h += '<div class="rc-mets"><div class="rc-mets-tit">💳 Hoy por método <small>(lo cobrado menos el vuelto)</small></div><div class="rc-mets-l">' +
    mets.map(k => { const [m, t] = k.split("|"); return '<div class="rc-met ' + (t === "BS" ? "bs" : t === "USD" ? "usd" : "otro") + '"><span>' + esc(m) + "</span><b>" + (t === "BS" ? "Bs " : "$") + fmt(porMet[k]) + "</b></div>"; }).join("") + "</div></div>";
  $("resumen").innerHTML = h;
  // Por cajero (hoy)
  const porCj = {};
  deHoy.forEach(v => { const k = v.pago.cajeroNombre || "Sin cajero"; const x = porCj[k] = porCj[k] || { n: 0, bs: 0, usd: 0 }; x.n++; x.bs += Number(v.totalBs) || 0; x.usd += bcvDe(v); });
  const cjs = Object.keys(porCj);
  $("porCajero").innerHTML = gvHTMLVentas() + (cjs.length ? '<div class="card" style="margin-bottom:10px;"><div class="card-tit">🧾 Hoy por cajero</div><table class="cie-tabla">' +
    cjs.map(k => "<tr><td><b>" + esc(k) + "</b> · " + porCj[k].n + " venta" + (porCj[k].n === 1 ? "" : "s") + '</td><td class="r">Bs ' + fmt(porCj[k].bs) + ' <span style="color:var(--text-dim);font-weight:600;">· $' + fmt(porCj[k].usd) + "</span></td></tr>").join("") + "</table></div>" : "");   // 3.3: antes, lo de la gaveta del turno abierto
  // Turnos
  const tl = S.cierres.slice().reverse().slice(0, 20);
  let th = "";
  if (S.turno) { const R = resumenTurno(S.turno); th += '<tr><td>🟢 <b>' + esc(S.turno.cajeroNombre) + "</b> · abierto desde " + fechaCorta(S.turno.apertura) + " " + horaDe(S.turno.apertura) + " · " + R.ventas + ' ventas</td><td class="r">Bs ' + fmt(R.totalBs) + "</td></tr>"; }
  tl.forEach((c, k) => {
    const dif = (Math.abs(c.efBsDif) < 0.005 && Math.abs(c.efUsdDif) < 0.005) ? '<span class="dif-ok">cuadra</span>' : '<span class="dif-mal">dif. Bs ' + fmt(c.efBsDif) + " · $" + fmt(c.efUsdDif) + "</span>";
    th += "<tr><td>🔒 <b>" + esc(c.cajeroNombre) + "</b> · " + fechaCorta(c.apertura) + " " + horaDe(c.apertura) + "–" + horaDe(c.cierre) + " · " + c.ventas + " ventas · " + dif +
      (c.estado === "subido" ? "" : ' · <span style="color:var(--blue);">⏳ por subir</span>') + '</td><td class="r">Bs ' + fmt(c.totalBs) +
      ' <button type="button" class="btn sm" onclick="imprimirCierreN(' + (S.cierres.length - 1 - k) + ')">🖨️</button></td></tr>';
  });
  $("turnosLista").innerHTML = th ? '<div class="card" style="margin-bottom:10px;"><div class="card-tit">🔒 Turnos</div><table class="cie-tabla">' + th + "</table></div>" : "";
  $("btnSubir").classList.toggle("oculto", !c.por && !c.mal);
  let lst = S.ventas.slice().sort((a, b) => String(b.creada).localeCompare(String(a.creada)));
  if (S.filtro === "hoy") lst = lst.filter(v => diaDe(v) === hoy);
  else if (S.filtro === "por") lst = lst.filter(v => v.estado === "por_subir");
  else if (S.filtro === "mal") lst = lst.filter(v => v.estado === "pendiente" || v.estado === "invalida");
  else if (S.filtro === "av") lst = lst.filter(v => v.estado === "subida" && v.avisos && v.avisos.length);
  if (!lst.length) { $("listaVentas").innerHTML = '<div class="vacio">No hay ventas aquí.</div>'; return; }
  $("listaVentas").innerHTML = lst.slice(0, 300).map(v => {
    const p = v.pago;
    const items = v.items.map(i => "<tr><td>" + fmtCant(i.cantidad) + " × " + esc(i.nombre) + (i.manual ? " ✏️" : "") + '</td><td class="r">$' + fmt((i.pu != null ? i.pu : i.precio) * (1 + i.iva / 100) * i.cantidad) + "</td></tr>").join("") +
      (Number(p.delivery) > 0 ? "<tr><td>" + (p.deliveryConcepto === "envio" ? "📦 Envío" : "🛵 Delivery") + '</td><td class="r">$' + fmt(p.delivery) + " BCV</td></tr>" : "");
    const pagos = (p.pagos || []).map(q => "<tr><td>" + esc(q.metodo) + '</td><td class="r">' + (q.tipo === "BS" ? "Bs " : "$") + fmt(q.monto) + "</td></tr>").join("") +
      (p.vuelto || []).map(q => "<tr><td>Vuelto (" + esc(q.metodo) + ')</td><td class="r">− ' + (q.tipo === "BS" ? "Bs " : "$") + fmt(q.monto) + "</td></tr>").join("");
    let msg = "";
    if (v.estado === "subida" && v.avisos && v.avisos.length) msg = '<div class="vt-msg av"><b>Avisos del sistema:</b><br>' + v.avisos.map(esc).join("<br>") + "</div>";
    if ((v.estado === "pendiente" || v.estado === "invalida") && v.msg) msg = '<div class="vt-msg mal"><b>Por qué no se registró:</b><br>' + esc(v.msg) + "<br><br>La venta sigue guardada en este equipo. " +
      (v.revisar ? "Si está bien así, el administrador toca <b>🔑 Subir igual</b> y escribe la clave de precio manual." : "Cuando el administrador lo corrija en el sistema, toca <b>Reintentar</b>.") + "</div>";
    if (v.estado === "por_subir" && v.msg) msg = '<div class="vt-msg av">Último intento: ' + esc(v.msg) + "</div>";
    const nroL = v.numeroFactura ? "#" + v.numeroFactura : (v.numeroTicket ? "#" + v.numeroTicket : "PROV " + v.numero);
    if (v.numeroFactura && String(v.numeroTicket || "") !== String(v.numeroFactura)) msg = '<div class="vt-msg av">⚠️ El ticket salió ' + (v.numeroTicket ? "con el #" + esc(v.numeroTicket) : "provisional") + " y quedó registrada con el <b>#" + esc(v.numeroFactura) + "</b>. Reimprímelo si el cliente lo necesita.</div>" + msg;
    return '<div class="vt-item" id="vt_' + v.id + '"><div class="vt-cab" onclick="this.parentNode.classList.toggle(\'abierto\')"><div style="min-width:0;"><div class="n">' + esc(nroL) + " · " + fechaCorta(v.fecha) + " " + horaDe(v.creada) + (v.fechaAnt ? ' <span class="otro-dia-tag">📅 de otro día</span>' : "") + (v.pago.cajeroNombre ? ' <span style="color:var(--text-dim);font-weight:600;">· ' + esc(v.pago.cajeroNombre) + "</span>" : "") + "</div>" +
      '<div class="s">' + esc(p.clienteNombre || "Genérico") + (p.clienteCedula ? " · " + esc(p.clienteCedula) : "") + "</div>" + estadoHTML(v) + "</div>" +
      '<div class="m">Bs ' + fmt(v.totalBs) + '<div style="font-size:11px;color:var(--text-dim);font-weight:600;">$' + fmt(v.total) + (v.unidad === "div" ? " div" : "") + "</div></div></div>" +
      '<div class="vt-det">' + msg + "<table>" + items + "</table><table>" + pagos + "</table>" +
      '<div style="font-size:12px;color:var(--text-dim);">' + (v.unidad === "div" ? "💵 Venta en Dólares · " : "") + 'Tasa BCV Bs ' + fmt(v.tasas.bcv) + (v.tasas.div ? " · Divisas Bs " + fmt(v.tasas.div) : "") + (p.descuentoTipo !== "ninguno" && p.descuentoValor ? " · descuento " + (p.descuentoTipo === "pct" ? fmt(p.descuentoValor) + " %" : "$" + fmt(p.descuentoValor)) : "") + (p.referencia ? " · Ref: " + esc(p.referencia) : "") + (p.ordenId ? " · " + (p.canal === "WEB" ? "🌐 pedido web " : "📋 orden ") + esc(p.ordenId) : "") + "</div>" +
      '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;"><button type="button" class="btn sm" onclick="imprimirPorId(\'' + v.id + '\')">🖨️ Reimprimir</button>' +
      ((v.estado === "pendiente" || v.estado === "invalida") ? '<button type="button" class="btn sm green" onclick="reintentar(\'' + v.id + '\',this)">🔁 Reintentar</button>' : "") +
      (v.estado === "pendiente" && v.revisar ? '<button type="button" class="btn sm naranja" onclick="subirIgual(\'' + v.id + '\',this)">🔑 Subir igual</button>' : "") + "</div></div></div>";
  }).join("");
}
function imprimirCierreN(i){ const c = S.cierres[i]; if (c) imprimirHTML(htmlCierre(c)); }
function imprimirPorId(id){ const v = S.ventas.find(x => x.id === id); if (v) imprimirTicket(v); }
function descargarRespaldo(){
  const d = S.datos || {};
  const obj = { tipo: "ControlMaster · Caja · respaldo", negocio: d.negocio, caja: d.caja, equipo: d.equipo, generado: ahoraTxt(), ventas: S.ventas, cierres: S.cierres };
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "caja-" + (d.equipo || "equipo") + "-" + ahoraTxt().replace(/[: ]/g, "-") + ".json";
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast("💾 Respaldo descargado");
}

// ══ AJUSTES ══
function pintarAjustes(){
  const d = S.datos || {}, t = S.tasas || {};
  $("infoEquipo").innerHTML = "<span>Negocio</span><b>" + esc(d.negocio) + "</b><span>Caja</span><b>" + esc(d.caja) + "</b><span>Equipo</span><b>" + esc(d.equipo) + (d.nombreEquipo ? " · " + esc(d.nombreEquipo) : "") + "</b>" +
    "<span>Datos del sistema</span><b>" + (d.descargadoEn ? fechaCorta(hoyTxt(new Date(d.descargadoEn))) + " " + pad(new Date(d.descargadoEn).getHours()) + ":" + pad(new Date(d.descargadoEn).getMinutes()) : "—") + "</b>" +
    "<span>Productos</span><b>" + (d.productos || []).length + "</b><span>Clientes</span><b>" + (d.clientes || []).length + ((S.clientesNuevos || []).length ? " · " + S.clientesNuevos.length + " creado(s) aquí, por subir" : "") + "</b>" +
    "<span>Clave sin internet</span><b>" + (d.claveSinInternet ? "✅ puesta" : "⚠️ no puesta (en el sistema: Configuración → Administración → Caja nueva → 🔑 Clave sin internet)") + "</b>" +
    "<span>Existencias</span><b>" + (d.exiEn ? "al día a las " + pad(new Date(d.exiEn).getHours()) + ":" + pad(new Date(d.exiEn).getMinutes()) : "las de los datos") + (d.deposito ? " · con Depósito: se vende lo de la tienda" : "") + "</b>" +
    "<span>Números de factura</span><b>" + numerosTexto() + "</b>";
  const u = (S.ses && S.ses.usuario) || {};
  $("infoSesion").innerHTML = "<span>Usuario</span><b>" + esc(u.nombre || u.usuario || "—") + (u.usuario ? " · " + esc(u.usuario) : "") + "</b>" +
    "<span>Entrada</span><b>" + (sesionDirecta() ? "directa: este equipo entra solo a la caja (solo esta caja; para el sistema se pide usuario y contraseña)" : "con usuario y contraseña") + "</b>" +
    "<span>Desde</span><b>" + (S.ses && S.ses.desde ? fechaCorta(hoyTxt(new Date(S.ses.desde))) + " " + pad(new Date(S.ses.desde).getHours()) + ":" + pad(new Date(S.ses.desde).getMinutes()) : "—") + "</b>";
  $("infoTasas").innerHTML = "<span>BCV</span><b>Bs " + fmt(t.bcv) + "</b><span>" + (t.binOn ? "Divisas (TasaBin)" : "Divisas ($ en efectivo)") + "</span><b>" + (t.div > 0 ? "Bs " + fmt(t.div) + (t.binOn && t.bcv > 0 ? " · brecha " + fmt((t.div / t.bcv - 1) * 100) + " %" : "") : "—") + "</b>" +
    "<span>TasaBin</span><b>" + (t.binOn ? "encendido (precios en divisas · se puede vender en Bs o en Dólares)" : "apagado") + "</b><span>De</span><b>" + fechaCorta(t.fecha) + (t.origen === "manual" ? " (puesta a mano)" : " (del sistema)") + "</b>";
  $("chkDosCopias").checked = !!S.pref.dosCopias; $("chkClaro").checked = !!S.pref.claro; $("selTamTicket").value = S.pref.tamTicket || "auto"; $("chkTasaOculta").checked = !!S.pref.tasaOculta;
}
async function guardarPref(){
  S.pref.dosCopias = $("chkDosCopias").checked; S.pref.claro = $("chkClaro").checked; S.pref.tamTicket = $("selTamTicket").value; S.pref.tasaOculta = $("chkTasaOculta").checked;
  aplicarTema(); pintarTasa();
  try { await kvSet("pref", S.pref); toast("✅ Cambios guardados"); } catch (e) {}
}
function aplicarTema(){
  document.body.classList.toggle("light", !!S.pref.claro);
  const b = $("btnTema"); if (b) b.textContent = S.pref.claro ? "🌙" : "☀️";
  const c = $("chkClaro"); if (c) c.checked = !!S.pref.claro;
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = S.pref.claro ? "#eef1f5" : "#07090d";
}
async function cambiarTema(){
  S.pref.claro = !S.pref.claro;
  aplicarTema();
  try { await kvSet("pref", S.pref); } catch (e) {}
}

// ══ VERSIÓN NUEVA DE LA PÁGINA ══
// Con internet revisa si en GitHub hay una versión nueva (al abrir, al volver el internet y cada 30 min).
// Si la hay, se recarga sola cuando no hay una venta a medias; si la hay, espera a que se termine.
let _verNueva = "";
async function revisarVersion(){
  if (navigator.onLine === false) return;
  try {
    const r = await fetch("./app.js?chk=" + Date.now(), { cache: "no-store" });   // «chk»: el SW no lo guarda (si no, sin internet quedaría el app.js nuevo con la página vieja)
    if (!r.ok) return;
    const m = (await r.text()).match(/const APP_VER = "([^"]+)"/);
    if (!m || m[1] === APP_VER) return;
    let ya = ""; try { ya = sessionStorage.getItem("cm_caja_web_recargada") || ""; } catch (e) {}
    if (ya === m[1]) return;   // ya se recargó por esta versión (el servidor todavía da la anterior): no insistir
    _verNueva = m[1];
    if (!recargarSiSePuede()) pintarBanners();
  } catch (e) {}
}
function recargarSiSePuede(){
  if (!_verNueva) return false;
  if (F.items.length || F.orden || P || S.sincronizando || document.querySelector(".mfondo:not(#mPago)")) return false;
  try { sessionStorage.setItem("cm_caja_web_recargada", _verNueva); } catch (e) {}
  location.replace(location.pathname + "?v=" + encodeURIComponent(_verNueva));
  return true;
}
async function cambiarTasa(btn){
  if (!await pedirClave("Cambiar tasa", "para cambiar la tasa (cambia lo que se cobra en Bs)")) return;
  const t = S.tasas || {}, on = !!t.binOn;
  const brechaHoy = on && t.bcv > 0 && t.div > 0 ? r2((t.div / t.bcv - 1) * 100) : 0;
  const r = await modal({
    icono: "💱", titulo: "Tasas para cobrar",
    html: '<div class="m-txt" style="font-size:13px;color:var(--text-dim);">Ahora: ' + textoTasas() + ". Cuando haya internet, el equipo toma las del sistema.</div>" +
      '<label class="lbl">Tasa BCV (Bs por $)</label><input class="inp" id="tBcv" type="number" inputmode="decimal" min="0" step="any" placeholder="Bs ' + fmt(t.bcv) + '">' +
      (on
        ? '<label class="lbl">% de brecha cambiaria</label><input class="inp" id="tBre" type="number" inputmode="decimal" min="0" step="any" placeholder="' + (brechaHoy > 0 ? fmt(brechaHoy) + " %" : "Ej. 11,11") + '">' +
          '<label class="lbl">Tasa Divisas (Bs por $) — o escríbela directo, sin brecha</label><input class="inp" id="tDiv" type="number" inputmode="decimal" min="0" step="any" placeholder="Bs ' + fmt(t.div) + '"><div class="act-nota" id="tHint"></div>'
        : '<label class="lbl">Tasa Divisas — los $ en efectivo (Bs por $)</label><input class="inp" id="tDiv" type="number" inputmode="decimal" min="0" step="any" placeholder="' + (t.div > 0 ? "Bs " + fmt(t.div) : "Opcional") + '">') +
      '<div class="m-err" id="tErr"></div>',
    botones: [{ txt: "Cancelar", v: false }, { txt: "✅ Guardar", v: true, cls: "green" }],
    foco: "tBcv",
    alAbrir: () => {
      if (!on) return;
      const calc = () => {   // con % de brecha, la Divisas se calcula (BCV × (1 + %))
        const b = $("tBcv").value === "" ? t.bcv : Number($("tBcv").value), pct = Number($("tBre").value) || 0;
        $("tDiv").disabled = pct > 0;
        $("tHint").innerHTML = pct > 0 && b > 0 ? "Divisas = BCV × " + fmt(1 + pct / 100) + " = <b>Bs " + fmt(r2(b * (1 + pct / 100))) + "</b>" : "";
      };
      ["tBcv", "tBre"].forEach(id => $(id).addEventListener("input", calc));
    },
    antes: (v) => {
      if (!v) return true;
      const b = $("tBcv").value === "" ? t.bcv : Number($("tBcv").value);
      if (!(b > 0)) { $("tErr").textContent = "Escribe la tasa BCV."; return false; }
      if (t.bcv > 0 && (b > t.bcv * 1.5 || b < t.bcv * 0.6)) { $("tErr").textContent = "La tasa BCV cambia demasiado (más de 50 %). Revisa el número."; return false; }
      let dv;
      if (on) {
        const pct = Number($("tBre").value) || 0;
        dv = pct > 0 ? r2(b * (1 + pct / 100)) : ($("tDiv").value === "" ? (brechaHoy > 0 ? r2(b * (1 + brechaHoy / 100)) : t.div) : Number($("tDiv").value));
        if (!(dv > 0)) { $("tErr").textContent = "Escribe el % de brecha o la tasa Divisas."; return false; }
      } else dv = $("tDiv").value === "" ? t.div : Number($("tDiv").value);
      if (dv && dv < b * 0.9) { $("tErr").textContent = "La tasa Divisas no puede quedar por debajo de la BCV."; return false; }
      S.tasas = Object.assign({}, t, { bcv: b, div: dv || 0, fecha: hoyTxt(), origen: "manual" });
      return true;
    }
  });
  if (!r) return;
  await kvSet("tasas", S.tasas);
  S.tasaOkHoy = hoyTxt();
  toast("✅ Cambios guardados");
  pintarCabecera(); pintarAjustes(); buscar(); pintarFactura();
}

// ══ MODALES, TOAST Y BOTONES ══
function modal(o){
  return new Promise(resolve => {
    const fondo = document.createElement("div");
    fondo.className = "mfondo";
    const bots = o.botones || [{ txt: "Entendido", v: true, cls: "green" }];
    const clsBtn = c => "btn-m " + ({ green: "green", naranja: "naranja", red: "rojo", rojo: "rojo" }[c] || "gray");
    fondo.innerHTML = '<div class="modal' + (o.ancho ? " ancho" : "") + (o.clase ? " " + o.clase : "") + (o.centrado ? " centrado" : "") + '">' +
      '<div class="mh"><h3>' + esc(o.titulo || "") + '</h3><button type="button" class="btn-m gray m-x" style="padding:6px 12px;" title="Cerrar">✕</button></div>' +
      '<div class="mb">' + (o.icono ? '<div class="m-ico">' + o.icono + "</div>" : "") + (o.html || "") + "</div>" +
      (bots.length || o.nota ? '<div class="mf">' + (o.nota ? '<span class="mf-nota">' + esc(o.nota) + "</span>" : "") + bots.map((b, k) =>
        '<button type="button" class="' + clsBtn(b.cls) + '" data-k="' + k + '"' + (b.v === true ? ' data-v="ok"' : "") + ">" + b.txt + "</button>").join("") + "</div>" : "") + "</div>";
    document.body.appendChild(fondo);
    let hecho = false;
    const cerrar = v => { if (hecho) return; hecho = true; fondo.remove(); resolve(v); };
    fondo.querySelector(".m-x").addEventListener("click", () => cerrar(null));
    fondo.querySelectorAll(".mf .btn-m[data-k]").forEach(el => el.addEventListener("click", async () => {
      const b = bots[Number(el.dataset.k)];
      if (o.antes) {
        const txt = el.innerHTML;
        if (b.spin) btnOcupado(el, b.spin);
        let seguir = false;
        try { seguir = await o.antes(b.v); } catch (e) { seguir = false; }
        if (b.spin) btnLibre(el, txt);
        if (!seguir) return;
      }
      cerrar(b.v);
    }));
    fondo.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); cerrar(null); } });
    if (o.alAbrir) o.alAbrir(fondo, cerrar);
    setTimeout(() => {   // si ya escribieron en otro campo del modal, no se les mueve el cursor
      if (fondo.contains(document.activeElement)) return;
      const f = o.foco ? $(o.foco) : fondo.querySelector('.mf .btn-m[data-v="ok"]') || fondo.querySelector(".mf .btn-m:last-child");
      if (f) f.focus();
    }, 40);
  });
}
function aviso(o){ return modal({ icono: o.icono || "ℹ️", titulo: o.titulo, html: '<div class="m-txt">' + (o.html || "") + "</div>", botones: [{ txt: "Entendido", v: true, cls: o.colorOk || "green" }] }); }
function confirmar(o){
  return modal({ icono: o.icono || "❓", titulo: o.titulo, html: '<div class="m-txt">' + (o.html || "") + "</div>",
    botones: [{ txt: o.cancel || "Cancelar", v: false }, { txt: o.ok || "Aceptar", v: true, cls: o.colorOk || "green" }] });
}
let _toastT = null;
function toast(t){ const el = $("toast"); el.textContent = t; el.classList.remove("on"); void el.offsetWidth; el.classList.add("on"); clearTimeout(_toastT); _toastT = setTimeout(() => el.classList.remove("on"), 2500); }
function btnOcupado(b, txt){ if (!b) return; if (b._txt == null) b._txt = b.innerHTML; b.disabled = true; b.innerHTML = '<span class="sp"></span>' + esc(txt || "Procesando…"); }
function btnLibre(b, txt){ if (!b) return; b.disabled = false; if (txt != null) b.innerHTML = txt; else if (b._txt != null) b.innerHTML = b._txt; b._txt = null; }
// Lector de códigos en la PC: el lector "escribe" el código y da Enter. Si el cursor no está en ningún campo
// (por ejemplo, después de tocar un botón), lo que llega va al buscador y el Enter agrega el producto.
document.addEventListener("keydown", e => {
  if (S.vista !== "vender" || !S.datos || e.ctrlKey || e.altKey || e.metaKey) return;
  if (document.querySelector(".mfondo:not(.oculto)")) return;
  const t = e.target, tag = (t && t.tagName) || "";
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
  const b = $("busca");
  if (e.key === "Enter") {
    if (b.value.trim()) { e.preventDefault(); buscarEnter(); return; }
    const sel = document.querySelector("#listaProd .prod-item.highlight");   // Enter con un producto marcado: lo agrega
    if (sel) { e.preventDefault(); agregarDeLista(Number(sel.dataset.k)); }
    return;
  }
  if (e.key.length === 1 && e.key !== " ") { e.preventDefault(); b.focus(); b.value += e.key; buscar(); }
});
// Ningún campo numérico cambia con la rueda del ratón
document.addEventListener("wheel", e => { const t = e.target; if (t && t.type === "number" && document.activeElement === t) t.blur(); }, { passive: true });
// Antes de cerrar la pestaña: aviso si hay una venta a medias
window.addEventListener("beforeunload", e => { if (F.items.length || P) { e.preventDefault(); e.returnValue = ""; } });
