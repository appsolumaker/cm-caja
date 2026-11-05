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
//  a los 10 minutos sin tocarla y con 🔒; para que entre otro, se cierra el turno (o lo cierra el Administrador).
// ══════════════════════════════════════════════════════════════
const APP_VER = "2.7.1 · 5-11-2026";
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
function nuevaFactura(){ return { items: [], cliente: { cedula: "", nombre: "Genérico", direccion: "", telefono: "" }, tipoPrecio: 0, dolares: false, desc: { tipo: "ninguno", valor: 0 }, vend: "", claveOk: false, claveCon: "", seq: 0, avisoEx: {}, orden: null, dlv: { tipo: "delivery", monto: 0 } }; }   // dolares: Venta en Dólares (TasaBin), se apaga en cada venta como en Ventas
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
  if (r && r.codigo === "EQUIPO") { S.permisoMal = r.msg || "Este equipo no tiene permiso."; pintarBanners(); return true; }
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
  const verPag = (document.querySelector('meta[name="cm-ver"]') || {}).content || "", faltaJs = typeof bloquear !== "function";
  if (verPag !== APP_VER.split(" ")[0] || faltaJs) {
    let ya = ""; try { ya = sessionStorage.getItem("cm_recargo") || ""; } catch (e) {}
    if (!ya) { try { sessionStorage.setItem("cm_recargo", "1"); } catch (e) {} location.reload(); return; }
    pantalla({ ico: "⏳", tit: "Caja", html: "<p>La caja se está actualizando y el navegador trajo archivos de versiones distintas" + (faltaJs ? " (falta <b>cajero.js</b>)" : "") + ". Espera un par de minutos y toca <b>Reintentar</b>.</p>" +
      '<p style="font-size:12px;color:var(--text-dim);">Página ' + esc(verPag || "anterior a la 2.7.1") + " · archivos " + esc(APP_VER) + "</p>",
      btns: '<button type="button" class="btn green" onclick="location.reload()">🔄 Reintentar</button>' });
    return;
  }
  try { sessionStorage.removeItem("cm_recargo"); } catch (e) {}
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
  S.clientesNuevos = await kvGet("clientesNuevos") || [];
  S.esperas = await kvGet("esperas") || [];       // Etapa 2: facturas en espera guardadas en este equipo (ordenes.js)
  S.ordSoltar = await kvGet("ordSoltar") || [];   // Etapa 2: órdenes soltadas sin internet (se liberan al volver)   // creados sin internet: se crean en el sistema al subir su venta
  S.ventas = (await ventasTodas()) || [];
  aplicarTema();
  await entrarConPase();     // sesion.js: si vino del sistema con un pase, ya entra con ese usuario
  continuarArranque();       // sesion.js: equipo → usuario → datos → vender
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
  if (S.vista === "vender" && !S.turno) { mostrarVista("turno"); pintarTurno(); }
  if (!_listoYa && S.turno) bloquear();   // cajero.js: al abrir la caja con un turno abierto, entra con el PIN del cajero
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
  S.datos = d; S.permisoMal = ""; S.datosMal = "";
  await kvSet("datos", d);
  if ((S.clientesNuevos || []).length) {   // los clientes creados sin internet que el sistema ya tiene salen de la lista de este equipo
    const ya = new Set((d.clientes || []).map(c => cedNorm(c.cedula)));
    S.clientesNuevos = S.clientesNuevos.filter(c => !ya.has(cedNorm(c.cedula)));
    await kvSet("clientesNuevos", S.clientesNuevos);
  }
  // TasaBin encendido: div = tasa Divisas (H7). Apagado: div = Divisas de los $ en efectivo (H9).
  const on = d.binOn === true;
  S.tasas = { bcv: Number(d.tasa) || 0, div: on ? (Number(d.tasaBinance) || Number(d.tasa) || 0) : (Number(d.tasaDivisas) || 0),
              binOn: on, brecha: Number(d.brechaPct) || 0, fecha: hoyTxt(), origen: "sistema" };
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
  if (!S.eq || !sesionViva()) return;
  if (silencioso && P) return;   // con el cobro abierto no se cambian tasas ni precios
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
function pintarTodo(){
  pintarCabecera(); pintarEstado(); pintarBanners();
  if (S.vista === "turno") pintarTurno();
  if (BQ.on && !PK.c) pintarBloqueo();   // cajero.js (sin teclado en pantalla: no se borra lo que se está escribiendo)
  pintarCategorias(); pintarSelectores(); buscar(); pintarFactura();
  if (S.vista === "ventas") pintarVentas();
  if (S.vista === "ajustes") pintarAjustes();
}
// Barra de arriba, como en Ventas: cajero del turno, tasa (se puede ocultar) y el menú
function pintarCabecera(){
  const d = S.datos;
  if (!d) return;
  $("tbTit").textContent = "🛒 Punto de Venta · Caja " + d.caja;
  $("badgeCajero").classList.toggle("oculto", !S.turno);
  if (S.turno) $("cajeroNombre").textContent = S.turno.cajeroNombre;
  $("menuCierre").classList.toggle("oculto", !S.turno);
  $("btnBloquear").classList.toggle("oculto", !S.turno);
  $("menuBloq").classList.toggle("oculto", !S.turno);
  const u = S.ses && S.ses.usuario;
  $("menuInfo").innerHTML = "<b>" + esc(d.negocio || "Mi negocio") + "</b><br>Caja " + esc(d.caja) + " · equipo " + esc(d.equipo || "") + (d.nombreEquipo ? " (" + esc(d.nombreEquipo) + ")" : "") +
    (u ? "<br>Usuario: " + esc(u.nombre || u.usuario) + (sesionDirecta() ? " (entrada directa)" : "") : "") + (S.turno ? "<br>Turno de " + esc(S.turno.cajeroNombre) + " desde las " + horaDe(S.turno.apertura) : "");
  pintarTasa();
}
function tasaVieja(){ const t = S.tasas || {}; return !!(t.fecha && t.fecha !== hoyTxt()); }
function pintarTasa(){
  const t = S.tasas || {}, oc = !!S.pref.tasaOculta;
  $("tasaDisplay").innerHTML = oc ? "••••••" : (tasaVieja() ? '<span class="vieja">⚠️ ' + fechaCorta(t.fecha).slice(0, 5) + " · </span>" : "") + "Bs " + fmt(t.bcv);
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
  irA(a);
}
function cuentas(){
  let por = 0, mal = 0;
  S.ventas.forEach(v => { if (v.estado === "por_subir") por++; else if (v.estado === "pendiente" || v.estado === "invalida") mal++; });
  S.cierres.forEach(c => { if (c.estado === "por_subir") por++; });
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
function pintarBanners(){
  pintarNumFactura();
  let h = "";
  if (S.permisoMal) h += '<div class="banner mal">⛔ ' + esc(S.permisoMal) + ' Puedes seguir vendiendo; las ventas quedan guardadas en este equipo. <a href="#" onclick="olvidarEquipo();return false;" style="color:inherit;font-weight:800;">Activar otra vez</a></div>';
  if (S.datosMal) h += '<div class="banner mal">⛔ ' + esc(S.datosMal) + "</div>";
  if (S.sesionMal) h += '<div class="banner av">🔐 ' + esc(S.sesionMal) + ' <a href="#" onclick="pedirEntrarOtraVez();return false;" style="color:inherit;font-weight:800;">Entrar</a></div>';
  if (S.datos && tasaVieja() && S.tasaOkHoy !== hoyTxt()) h += '<div class="banner av">💱 Las tasas de este equipo son del <b>' + fechaCorta(S.tasas.fecha) + '</b>. Con internet se actualizan solas; si no hay, revísalas antes de cobrar: <a href="#" onclick="verTasas();return false;" style="color:inherit;font-weight:800;">ver tasas</a>.</div>';
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
const LISTA_MAX = 300;
function buscar(){
  const box = $("listaProd");
  if (!S.datos) { box.innerHTML = ""; return; }
  const q = $("busca").value, todos = resultados(q), lst = todos.slice(0, LISTA_MAX), on = binOn();
  $("vtaContador").textContent = todos.length > LISTA_MAX ? "Mostrando " + LISTA_MAX + " de " + todos.length + ": escribe para buscar" : "";
  if (!lst.length) { box.innerHTML = '<div class="vacio">' + (norm(q) ? "No hay " + (S.vtaVista === "servicios" ? "servicios" : "productos") + " con «" + esc(q) + "»." : "No hay productos en los datos de este equipo.") + "</div>"; box._lst = []; return; }
  box.innerHTML = lst.map((p, k) => {
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
    return '<div class="prod-item" data-k="' + k + '" onclick="clicProducto(this,' + k + ')" ondblclick="agregarDeLista(' + k + ')"><div class="prod-fila">' +
      '<div style="flex:1;min-width:0;"><div class="prod-cod">ID: ' + esc(p.codigo) + '</div><div class="prod-nom">' + esc(p.nombre) + "</div>" + info + "</div>" +
      '<div class="prod-pr"><div class="p1">$ ' + fmt(conIva) + " <small>BCV</small></div><div class=\"p2\">Bs " + fmt(r2(conIva * tBcv())) + "</div>" + (div > 0 ? '<div class="p3">$ ' + fmt(div) + " <small>div</small></div>" : "") + "</div>" +
      '<button type="button" class="mv-add" data-cod="' + esc(p.codigo) + '" title="Agregar a la factura" onclick="event.stopPropagation();agregarDeLista(' + k + ')" ondblclick="event.stopPropagation()">+' + (q2 > 0 ? '<span class="mv-q">' + fmtCant(q2) + "</span>" : "") + "</button>" +
      "</div></div>";
  }).join("");
  box._lst = lst;
  $("mvCats").querySelectorAll(".mv-cat").forEach(b => b.classList.toggle("on", b.dataset.v === $("selCat").value));
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
    if (e < 1) {
      const ok = await confirmar({ icono: "📦", titulo: "Sin existencia en este equipo", colorOk: "naranja", ok: "Vender igual",
        html: "Según los datos de este equipo, de <b>" + esc(p.nombre) + "</b> quedan <b>" + fmtCant(Math.max(0, e)) + "</b>." +
          "<br><br>Si lo tienes en la mano, véndelo: al subirse se registra igual y el sistema avisa que hay que revisar la existencia." });
      if (!ok) return;
      F.avisoEx[String(p.codigo)] = true;
    }
  }
  const pr = precioDe(p, F.tipoPrecio);
  const ya = F.items.find(i => i.codigo === p.codigo && i.tipo === p.tipo && !i.manual && i.tipoIdx === F.tipoPrecio);
  if (ya) ya.cantidad = r3((Number(ya.cantidad) || 0) + 1);
  else F.items.push({ key: ++F.seq, tipo: p.tipo, codigo: p.codigo, nombre: p.nombre, codigoBarras: p.codigoBarras || p.codigo,
    cantidad: 1, libro: pr.base, base: basePantalla(pr.base), iva: pr.iva, manual: false, tipoIdx: F.tipoPrecio });   // libro: base del sistema (divisas con TasaBin) · base: en pantalla
  $("busca").value = "";
  buscar(); pintarFactura();
  const n = String(p.nombre || ""); toast("✅ " + (n.length > 34 ? n.slice(0, 33) + "…" : n) + "  ×" + fmtCant(cuantasEnFactura(p.codigo)));
  if (window.innerWidth > 820) $("busca").focus();
}

// ══ LA VENTA (factura) ══
function pintarNumFactura(){
  const el = $("numFactura"); if (!el) return;
  const N = S.num; el.value = N && N.lista && N.lista.length ? String(N.lista[0]) : (S.turno ? "Provisional" : "—");
}
function pintarSelectores(){
  const d = S.datos; if (!d) return;
  pintarNumFactura();
  $("fechaVenta").value = fechaCorta(hoyTxt());
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
  if (d.trabajoVendedores && d.modoCajas === "cajero") {
    if (F.vend === "") F.vend = d.vendedorCajaId ? String(d.vendedorCajaId) : "directa";
    sel.innerHTML = '<option value="directa">🏪 Venta directa (sin comisión)</option>' + (d.vendedores || []).map(v => '<option value="' + esc(v.id) + '">🧑‍💼 ' + esc(v.nombre) + "</option>").join("");
    if (F.orden && F.orden.origen === "VENDEDOR" && F.orden.vendedorId && !(d.vendedores || []).some(v => String(v.id) === String(F.orden.vendedorId)))   // vendedor de la orden que ya no está activo
      sel.innerHTML += '<option value="' + esc(F.orden.vendedorId) + '">🧑‍💼 ' + esc(F.orden.vendedor || "Vendedor de la orden") + "</option>";
    sel.value = F.vend; if (sel.value !== F.vend) { F.vend = "directa"; sel.value = "directa"; }
    $("vendBar").classList.remove("oculto");
  } else if (d.trabajoVendedores && d.vendedor && d.vendedor.nombre) {
    badge.innerHTML = "<label>Vendedor:</label><b>🧑‍💼 " + esc(d.vendedor.nombre) + "</b>"; badge.classList.remove("oculto");
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
    const nom = '<td class="nom" title="' + esc(i.nombre) + '">' + esc(i.nombre) + (srv ? "" : '<span class="sin-ex oculto" id="sx_' + i.key + '"></span>') + "</td>";
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
function quitarLinea(key){ F.items = F.items.filter(x => x.key !== key); pintarFactura(); buscar(); }
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
  pintarFactura(); buscar();
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
  i.base = Number(v) || 0; i.libro = libroDePantalla(i.base);
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
  const q = Number(i.cantidad) || 0, tot = Number(v) || 0;
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
async function registrarVenta(){
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
function tBcv(){ return Number((S.tasas || {}).bcv) || 0; }
function tDiv(){ const t = S.tasas || {}; return Number(t.div) > 0 ? Number(t.div) : tBcv(); }   // ON: tasa Divisas (H7)
function tDivOff(){ const t = S.tasas || {}; return !binOn() && Number(t.div) > 0 ? Number(t.div) : 0; }   // OFF: Divisas de los $ en efectivo (H9)
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
  if (!F.items.length) { aviso({ icono: "🧾", titulo: "La venta está vacía", html: "Agrega al menos un producto." }); return; }
  const malas = F.items.filter(i => !(Number(i.cantidad) > 0));
  if (malas.length) { aviso({ icono: "🔢", titulo: "Falta una cantidad", html: "La línea <b>" + esc(malas[0].nombre) + "</b> no tiene cantidad. Escríbela o quita la línea con ✕." }); return; }
  const t = S.tasas || {};
  if (!(t.bcv > 0)) { aviso({ icono: "💱", titulo: "Falta la tasa", html: "Este equipo no tiene tasa BCV. Actualiza los datos con internet, o ponla en ⚙️ → Cambiar tasa." }); return; }
  if (binOn() && !(Number(t.div) > 0)) { aviso({ icono: "💱", titulo: "Falta la tasa Divisas", html: "Este negocio trabaja con TasaBin y el equipo no tiene la tasa Divisas. Actualiza los datos con internet, o ponla en ⚙️ → Cambiar tasa." }); return; }
  if (t.fecha !== hoyTxt() && S.tasaOkHoy !== hoyTxt()) {
    const r = await modal({ icono: "💱", titulo: "¿La tasa sigue igual?",
      html: '<div class="m-txt">Las tasas de este equipo son del <b>' + fechaCorta(t.fecha) + "</b>: " + textoTasas() + ".<br><br>Si hoy son otras, cámbialas antes de cobrar (pide la clave sin internet).</div>",
      botones: [{ txt: "🔒 Cambiar tasa", v: "cambiar" }, { txt: "Sí, cobrar con esas", v: "ok", cls: "green" }] });
    if (r === "cambiar") { await cambiarTasa(null); return; }
    if (r !== "ok") return;
    S.tasaOkHoy = hoyTxt();
  }
  repreciar();
  const T = totalConDlv(), m = modoVenta(), aparte = m === "div" && T.dlv > 0;   // Venta en Dólares con delivery: se cobra en dos pasos
  const tot = aparte ? T.prod : T.total;
  P = { modo: m, lineas: [], cred: { on: false, monto: "", editado: false }, vt: { on: false, lineas: [] }, seq: 0, verMet: false, dias: 0, total: tot, desbloq: false,
        dlvMonto: T.dlv, dlv: { on: aparte, monto: T.dlv, tipo: F.dlv.tipo, modo: "", metodo: "" } };
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
      (m === "off" && !tDivOff() ? " (este negocio no tiene tasa Divisas: los $ valen a la BCV)" : "") + ".";
  $("pgRef").value = ""; $("pgObs").value = "";
  $("pgForm").classList.remove("oculto"); $("pgOk").classList.add("oculto");
  $("pgPie").classList.remove("oculto"); $("pgPieOk").classList.add("oculto"); $("pgX").classList.remove("oculto"); $("pgTit").textContent = "💳 Pago del cliente";
  $("pgCerrar").disabled = false; btnLibre($("pgGuardar"));
  const pl = (S.datos.plazosCredito || []).filter(p => p.activo && p.dias > 0);
  $("selDias").innerHTML = pl.map(p => '<option value="' + p.dias + '">' + p.dias + " días</option>").join("") + '<option value="0">Sin plazo</option>';
  P.dias = pl.length ? pl[0].dias : 0; $("selDias").value = String(P.dias);
  pgPintarMetodos(); pgPintarLineas(); pgPintarVuelto(); pgActualizar();
  $("mPago").classList.remove("oculto");
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
  const cred = pgCredValor(), credVale = P.modo === "bcv" ? r2(cred * factorCxC()) : cred;
  const cubT = cub + cred, N = P.total;
  const pendX = N - cubT, pend = r2(pendX);   // > 0 falta · < 0 sobra
  let vtCub = 0, vtVale = 0;
  if (P.vt.on) P.vt.lineas.forEach(v => { vtCub += pgCubreVt(v); vtVale += pgValeVt(v); });
  const quedaX = -pendX - vtCub, queda = r2(quedaX);
  const valorVenta = r2(valorLibro(F.items, F.desc) + (P.dlv.on ? 0 : dlvLibro(P.dlvMonto)));   // en dos pasos, el paso 1 es solo de los productos
  const dif = r2(vale + credVale - vtVale - valorVenta);
  return { cub: r2(cub), cred, credVale, cubT: r2(cubT), pend, pendX, vtCub: r2(vtCub), vtVale: r2(vtVale), queda, quedaX, vale: r2(vale), valorVenta, dif, hay: P.lineas.length > 0 || P.cred.on };
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
function pgFilasMetodos(fn, usados, conCredito){
  const cols = [];
  [["BS", "bs", "💙 En bolívares"], ["USD", "usd", "💚 En dólares"]].forEach(([mon, cls, tit]) => {
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
  if (conCredito && metodoCredito()) html += '<div class="pgu-mon-tit otros">Otros</div><div class="pgu-fila linea1"><span class="pgu-grp">📝 A crédito</span><div class="pgu-chips"><button type="button" class="pgu-chip cred' + (P.cred.on ? " on" : "") + '" onclick="pgCredito()">' + (P.cred.on ? "✓ Crédito" : "Crédito") + "</button></div></div>";
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
  P.lineas.forEach(l => {
    const cls = l.tipo === "BS" ? "bs" : "usd";
    h += '<div class="pl ' + cls + '"><div class="pl-cab"><span>' + esc(pguDesc(metodoDe(l.metodo) || { metodo: l.metodo, tipo: l.tipo })) + '</span><button type="button" class="pgu-x" onclick="pgQuitar(' + l.id + ')" title="Quitar">✕</button></div>' +
      '<div class="pl-cuerpo"><span class="mon">' + (l.tipo === "BS" ? "Bs" : "$") + '</span><input type="number" inputmode="decimal" min="0" step="any" id="pgM_' + l.id + '" placeholder="' + (l.tipo === "BS" ? "Monto en Bs" : "Monto en $") + '" value="' + esc(l.monto) + '" oninput="pgMonto(' + l.id + ',this.value)">' +
      pgTasasHTML(l) + '</div><div class="pl-eq" id="pgE_' + l.id + '"></div></div>';
  });
  if (P.cred.on) {
    h += '<div class="pl cred"><div class="pl-cab"><span>📝 Crédito · ' + esc(F.cliente.nombre) + '</span><button type="button" class="pgu-x" onclick="pgCredito()" title="Quitar el crédito">✕</button></div>' +
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
    let cub = 0; P.lineas.forEach(l => cub += pgCubre(l));
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
  if (ec) { const c = pgCredValor(); ec.innerHTML = c > 0 ? (m === "bcv" ? "queda a deber <b>" + txtU(c) + "</b>, fijo en BCV · hoy vale <b>$" + fmt(r2(c * factorCxC())) + " div</b>" : "queda a deber <b>" + txtU(c) + "</b>") : ""; }
  P.vt.lineas.forEach((v, k) => { const el = $("pgVE_" + k); if (el) el.innerHTML = Number(v.monto) > 0 ? "devuelve <b>" + txtU(pgCubreVt(v)) + "</b>" + (m !== "div" ? " · vale " + txtL(pgValeVt(v)) : "") : ""; });
  const st = pgEstado();
  const bs = v => " · Bs " + fmt(r2(v * bsPorU()));
  let h = "";
  if (st.hay) {
    if (st.pend > TOL) h = '<div class="bal falta">⚠️ Falta ' + txtU(st.pend) + bs(st.pendX) + "</div>";
    else if (st.pend < -TOL && !P.vt.on) h = '<div class="bal sobra">💰 Sobran ' + txtU(-st.pend) + bs(-st.pendX) + '</div><div style="text-align:center;margin-top:8px;"><button type="button" class="pgu-mas" onclick="pgVueltoAbrir()">💸 Dar vuelto</button></div>';
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
  $("pgDias").classList.toggle("oculto", !((P.cred.on || P.dlv.modo === "cred") && $("selDias").options.length > 1));
  pgDlvPintar();
  const todo = $("pgTodo");
  if (!P.dlv.on) todo.innerHTML = "";
  else {
    const uno = st.hay && st.pend <= TOL, dos = !!pgDlvListo();
    todo.innerHTML = uno && dos ? '<div class="pg-todo ok">✅ Todo pagado. Toca <b>Registrar</b>.</div>'
      : '<div class="pg-todo falta">Falta: ' + [uno ? "" : "① los productos", dos ? "" : "② el " + dlvTxt(P.dlv.tipo).toLowerCase()].filter(Boolean).join(" y ") + "</div>";
  }
  $("pgLineasTit").classList.toggle("oculto", !(P.lineas.length || P.cred.on));
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
  pgPintarMetodos(); pgPintarLineas(); pgAutocompletar(l); pgActualizar();
  setTimeout(() => { const inp = $("pgM_" + l.id); if (inp) { inp.focus(); inp.select(); } }, 30);
}
function pgQuitar(id){ P.lineas = P.lineas.filter(l => l.id !== id); pgPintarMetodos(); pgPintarLineas(); pgActualizar(); }
function pgMonto(id, v){ const l = P.lineas.find(x => x.id === id); if (l) { l.monto = v; pgActualizar(); } }
async function pgElegirTasa(id, modo){
  const l = P.lineas.find(x => x.id === id); if (!l) return;
  if (modo === "otra" && S.datos.pideClave && S.datos.pideClave.tasa && !P.desbloq) {
    if (!await claveFactura("Otra tasa de cobro", "para cobrar los dólares a otra tasa")) return;
  }
  if (modo === "otra") P.desbloq = true;
  l.tasaModo = modo;
  pgPintarLineas();
  if (modo === "otra") setTimeout(() => { const t = $("pgT_" + id); if (t) t.focus(); }, 30);
  else pgAutocompletar(l);
  pgActualizar();
}
function pgTasaOtra(id, val){
  const l = P.lineas.find(x => x.id === id); if (!l) return;
  l.tasaOtra = val;
  if (Number(val) > 0) pgAutocompletar(l);
  pgActualizar();
}
// El crédito necesita un cliente con cédula: si la venta está en Genérico, se elige (o se crea) antes
async function pgClienteParaCredito(){
  if (F.cliente.cedula) return true;
  const r = await modal({ icono: "👤", titulo: "El crédito necesita un cliente", html: '<div class="m-txt">La venta a crédito queda como cuenta por cobrar a nombre del cliente. Esta venta está a nombre de <b>Genérico</b>.<br><br>Sin internet solo se pueden usar los clientes que ya existen en el sistema.</div>',
    botones: [{ txt: "Cancelar", v: false }, { txt: "👤 Elegir cliente", v: true, cls: "green" }] });
  if (!r) return false;
  const c = await abrirClientes();
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
function pgVueltoCerrar(){ P.vt = { on: false, lineas: [] }; pgPintarVuelto(); pgActualizar(); }
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

async function pgConfirmar(){
  const m = P.modo;
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
    pagos.push({ metodo: metodoCredito(), monto: c, tipo: "CRED" });
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
    if (!await confirmar({ icono: "⚠️", titulo: "Falta dinero", colorOk: "naranja", ok: "Sí, guardar", html: "El pago cubre " + txtU(st.cubT) + " de " + txtU(P.total) + ": <b>falta " + txtU(st.pend) + "</b>" + bs(st.pendX) + ".<br><br>Si la guardas así, esa diferencia queda como diferencial cambiario en contra. Si queda a deber, toca <b>A crédito</b>.<br><br>¿Guardar igualmente?" })) return;
  } else if (st.pend < -TOL && !P.vt.on) {
    const r = await modal({ icono: "💰", titulo: "Sobra dinero", html: '<div class="m-txt">El pago cubre ' + txtU(st.cubT) + ": <b>sobran " + txtU(-st.pend) + "</b>" + bs(-st.pendX) + ".<br><br>¿Le das vuelto al cliente, o queda como diferencial cambiario a favor (" + txtL(st.dif) + ")?</div>",
      botones: [{ txt: "💸 Dar vuelto", v: "vuelto" }, { txt: "Queda como diferencial a favor", v: "ok", cls: "green" }] });
    if (r === "vuelto") { pgVueltoAbrir(); return; }
    if (r !== "ok") return;
  } else if (P.vt.on && st.queda < -TOL) {
    if (!await confirmar({ icono: "⚠️", titulo: "El vuelto pasa de lo que sobra", colorOk: "naranja", ok: "Sí, guardar", html: "Sobraban " + txtU(-st.pend) + " y el vuelto devuelve " + txtU(st.vtCub) + ": <b>" + txtU(-st.queda) + " de más</b>.<br><br>Esa diferencia queda como diferencial cambiario en contra. ¿Guardar igualmente?" })) return;
  } else if (P.vt.on && st.queda > TOL) {
    if (!await confirmar({ icono: "⚠️", titulo: "Falta vuelto por dar", colorOk: "naranja", ok: "Sí, guardar", html: "Sobraban " + txtU(-st.pend) + " y el vuelto solo devuelve " + txtU(st.vtCub) + ": quedan <b>" + txtU(st.queda) + "</b>" + bs(st.queda) + " que se registran como diferencial a favor. ¿Guardar igualmente?" })) return;
  } else if (st.dif < -0.01) {
    if (!await confirmar({ icono: "⚠️", titulo: "Diferencial en contra", colorOk: "naranja", ok: "Sí, guardar", html: "Lo recibido vale " + txtL(r2(st.vale + st.credVale - st.vtVale)) + " y la venta vale " + txtL(st.valorVenta) + ": <b>" + txtL(-st.dif) + " en contra</b>." + pgMotivoDif() + "<br><br>¿Guardar igualmente?" })) return;
  }
  await pgGuardar(pagos, vuelto);
}
function vendedorDeLaVenta(){
  const d = S.datos;
  const cj = { cajeroNombre: S.turno ? S.turno.cajeroNombre : ((d.cajero && d.cajero.nombre) || ""), cajeroId: S.turno ? S.turno.cajeroId : 0 };   // el cajero del turno
  if (F.orden && F.orden.origen === "WEB") return Object.assign({ ventaDirecta: true, vendedorNombre: "", comision: 0, canal: "WEB" }, cj);   // pedido web: Tienda online
  if (!d.trabajoVendedores) return Object.assign({ ventaDirecta: true, vendedorNombre: "", comision: 0 }, cj);
  if (d.modoCajas !== "cajero") return Object.assign({ vendedorNombre: (d.vendedor && d.vendedor.nombre) || "", comision: Number(d.vendedor && d.vendedor.comision) || 0 }, cj);
  const v = (d.vendedores || []).find(x => String(x.id) === String(F.vend));
  if (v) return Object.assign({ vendedorId: v.id, vendedorNombre: v.nombre, comision: Number(v.comision) || 0 }, cj);
  if (F.orden && F.orden.vendedorId && String(F.orden.vendedorId) === String(F.vend)) return Object.assign({ vendedorId: F.orden.vendedorId, vendedorNombre: F.orden.vendedor, comision: 0 }, cj);
  return Object.assign({ ventaDirecta: true, vendedorNombre: "", comision: 0 }, cj);
}
async function pgGuardar(pagos, vuelto){
  const btn = $("pgGuardar");
  btnOcupado(btn, "Guardando…"); $("pgCerrar").disabled = true;
  if (!S.turno) { btnLibre(btn); $("pgCerrar").disabled = false; cerrarPago(); irA("vender"); return; }
  const t = S.tasas, ahora = new Date(), m = P.modo, dl = r2(P.dlvMonto || 0);
  const totPant = r2(P.total + (P.dlv.on ? dl : 0));                                     // lo que dice la factura (con el delivery por su monto)
  const totBs = P.dlv.on ? r2(P.total * bsPorU() + dl * tBcv()) : r2(P.total * bsPorU());   // el delivery, siempre a BCV
  const v = {
    id: uuid(), numero: "", creada: ahoraTxt(ahora), fecha: hoyTxt(ahora),
    numeroTicket: 0, provisional: false, turno: S.turno.id,   // el número lo pone guardarVentaNueva (apartado o provisional)
    caja: S.datos.caja, equipo: S.datos.equipo,
    // tasas con que se cobró: div = Divisas (TasaBin encendido) o Divisas de los $ en efectivo (apagado)
    tasas: { bcv: t.bcv, div: binOn() ? tDiv() : tDivOff(), binOn: binOn() },
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
      diasCredito: (P.cred.on || P.dlv.modo === "cred") ? (Number(P.dias) || 0) : 0,
      delivery: dl, deliveryBCV: dl, deliveryConcepto: P.dlv.tipo === "envio" ? "envio" : "delivery",   // Etapa 2B: como Ventas (al fondo de delivery entran los $ BCV)
      objetivoVenta: m === "off" ? "" : (m === "div" ? "DIVISAS" : "BCV"), totalPantallaUSD: totPant
    }, vendedorDeLaVenta(), ordPago()),   // ordPago: la orden que se cobra (queda CONVERTIDA al subir), ordenes.js
    total: totPant, totalBs: totBs, totalBcv: m === "div" ? (t.bcv > 0 ? r2(totBs / t.bcv) : 0) : totPant,
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
    (v.provisional ? "<br>🔢 Número <b>provisional</b>: el sistema le da su número al subirla." : "");
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
  const filasPago = pagosOrd.map(q => {
    let f = '<tr style="' + (q.tipo === "CRED" ? "font-style:italic;" : "") + '"><td style="padding:1px 0;">' + esc(q.metodo) + '</td><td style="text-align:right;padding:1px 0;">' + (q.tipo === "BS" ? "Bs." : "$") + " " + fmt(q.monto) + "</td></tr>";
    if (q.tipo === "CRED" && Number(p.diasCredito) > 0) {
      const venc = vencimiento(v.fecha, p.diasCredito);
      f += '<tr><td colspan="2" style="padding:0 0 1px 6px;font-style:italic;">Días de crédito: ' + p.diasCredito + "</td></tr>";
      if (venc) f += '<tr><td colspan="2" style="padding:0 0 2px 6px;font-style:italic;">Fecha de Vencimiento: ' + venc + "</td></tr>";
    }
    return f;
  }).join("") + (p.vuelto || []).map(q => '<tr><td style="padding:1px 0;">Vuelto (' + esc(q.metodo) + ')</td><td style="text-align:right;padding:1px 0;">- ' + (q.tipo === "BS" ? "Bs." : "$") + " " + fmt(q.monto) + "</td></tr>").join("");
  // Persona del comprobante (Configuración → Impresión)
  let modo = cfg.personaComprobante || "vendedor";
  if (!d.trabajoVendedores && !String(p.vendedorNombre || "").trim()) modo = "cajero";
  const per = [];
  if ((modo === "cajero" || modo === "ambos") && p.cajeroNombre) per.push("Cajero: " + esc(p.cajeroNombre));
  if ((modo === "vendedor" || modo === "ambos") && p.vendedorNombre) per.push("Vendedor: " + esc(p.vendedorNombre));
  const logo = (cfg.imprimirLogo !== false && String(cfg.logo || "").indexOf("data:image") === 0)
    ? '<div style="text-align:center;padding-top:6px;"><img src="' + cfg.logo + '" alt="" style="max-width:' + (cfg.formato === "ticket58" ? "34mm" : "46mm") + ";max-height:" + (cfg.formato === "ticket58" ? "16mm" : "20mm") + ';object-fit:contain;filter:grayscale(100%);"></div>' : "";
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
  const w = window.open("", "_blank", "width=420,height=700");
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
  const w = window.open("", "_blank", "width=420,height=700");
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
  const vs = S.ventas.filter(v => v.turno === t.id && v.estado !== "invalida");
  const met = {};
  let totalUsd = 0, totalBs = 0, credito = 0, desc = 0, sinSubir = 0;
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
    (v.pago.pagos || []).forEach(p => { if (p.tipo === "CRED") credito += (Number(p.monto) || 0) * fx; else sumar(p, Number(p.monto) || 0); });
    (v.pago.vuelto || []).forEach(p => sumar(p, -(Number(p.monto) || 0)));
  });
  const metodos = Object.values(met).sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "BS" ? -1 : 1) || a.desc.localeCompare(b.desc));
  const efBs = metodos.filter(m => m.efectivo && m.tipo === "BS").reduce((s, m) => s + m.neto, 0);
  const efUsd = metodos.filter(m => m.efectivo && m.tipo === "USD").reduce((s, m) => s + m.neto, 0);
  return { ventas: vs.length, totalUsd: r2(totalUsd), totalBs: r2(totalBs), credito: r2(credito), descuentos: r2(desc), sinSubir,
           metodos, efBsVentas: r2(efBs), efUsdVentas: r2(efUsd),
           efBsEsperado: r2((Number(t.fondoBs) || 0) + efBs), efUsdEsperado: r2((Number(t.fondoUsd) || 0) + efUsd) };
}
function irCierre(){
  if (!S.turno) return;
  if (F.items.length || P) { aviso({ icono: "🧾", titulo: "Hay una venta a medias", html: "Termina la venta (o vacíala con 🗑️) antes de cerrar el turno." }); return; }
  mostrarVista("cierre"); pintarCierre();
}
function difHTML(d){
  if (Math.abs(d) < 0.005) return '<span class="dif-ok">✅ Cuadra</span>';
  return d > 0 ? '<span class="dif-sob">Sobra ' + fmt(d) + "</span>" : '<span class="dif-mal">Falta ' + fmt(-d) + "</span>";
}
function pintarCierre(){
  const t = S.turno, R = resumenTurno(t);
  const filasMet = R.metodos.map(m => "<tr><td>" + esc(m.desc) + '</td><td class="r">' + (m.tipo === "BS" ? "Bs " : "$") + fmt(m.neto) + "</td></tr>").join("") +
    (R.credito ? '<tr><td>📝 A crédito (no entra a caja)</td><td class="r">$' + fmt(R.credito) + "</td></tr>" : "");
  $("cierreCard").innerHTML =
    '<div class="card-tit">🔒 Cerrar turno</div>' +
    (S.cierreAdmin ? '<div class="banner av" style="margin:0 0 10px;">⭐ Lo cierra <b>' + esc(S.cierreAdmin.nombre) + "</b> porque " + esc(t.cajeroNombre) + " no está. Queda anotado en el cierre.</div>" : "") +
    '<div class="m-txt"><b>' + esc(t.cajeroNombre) + "</b> · desde " + fechaCorta(t.apertura) + " " + horaDe(t.apertura) + "</div>" +
    '<div class="res" style="margin-top:10px;"><div><span>Ventas</span><b>' + R.ventas + '</b></div><div><span>Total</span><b>Bs ' + fmt(R.totalBs) + '</b><span style="text-transform:none;">$' + fmt(R.totalUsd) + " BCV</span></div>" +
    (R.descuentos ? '<div><span>Descuentos</span><b>$' + fmt(R.descuentos) + "</b></div>" : "") + "</div>" +
    (R.sinSubir ? '<div class="banner av" style="margin:0 0 10px;">⏳ ' + R.sinSubir + " venta" + (R.sinSubir > 1 ? "s" : "") + " de este turno todavía no " + (R.sinSubir > 1 ? "están" : "está") + " en el sistema. Puedes cerrar igual: se suben solas cuando haya internet.</div>" : "") +
    '<div class="cie-tit">Por método (cobrado menos vuelto)</div><table class="cie-tabla">' + (filasMet || '<tr><td colspan="2" style="color:var(--text-dim);">Sin ventas en este turno.</td></tr>') + "</table>" +
    '<div class="cie-tit">Efectivo en la gaveta</div>' +
    '<table class="cie-tabla"><tr><td></td><td class="r">Bs</td><td class="r">$</td></tr>' +
    '<tr><td>Fondo inicial</td><td class="r">' + fmt(t.fondoBs) + '</td><td class="r">' + fmt(t.fondoUsd) + "</td></tr>" +
    '<tr><td>+ Efectivo del turno (menos vuelto)</td><td class="r">' + fmt(R.efBsVentas) + '</td><td class="r">' + fmt(R.efUsdVentas) + "</td></tr>" +
    '<tr><td><b>= Debe haber</b></td><td class="r">' + fmt(R.efBsEsperado) + '</td><td class="r">' + fmt(R.efUsdEsperado) + "</td></tr></table>" +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">' +
      '<div><label class="lbl" for="cBs">Contado Bs</label><input class="inp" id="cBs" type="number" inputmode="decimal" min="0" step="any" placeholder="Cuenta el efectivo en Bs" oninput="pintarDifCierre()"><div id="cBsDif" style="font-size:13px;font-weight:800;margin-top:4px;"></div></div>' +
      '<div><label class="lbl" for="cUsd">Contado $</label><input class="inp" id="cUsd" type="number" inputmode="decimal" min="0" step="any" placeholder="Cuenta el efectivo en $" oninput="pintarDifCierre()"><div id="cUsdDif" style="font-size:13px;font-weight:800;margin-top:4px;"></div></div>' +
    "</div>" +
    '<label class="lbl" for="cObs">Observación (opcional)</label><input class="inp" id="cObs" maxlength="200" placeholder="Ej. se pagó al proveedor de pan desde la gaveta">' +
    '<div class="m-btns">' + (S.cierreAdmin ? '<button type="button" class="btn" onclick="cancelarCierreAdmin()">Cancelar</button>' : '<button type="button" class="btn" onclick="irA(\'vender\')">Volver a vender</button>') + '<button type="button" class="btn naranja" id="btnCerrarTurno" onclick="cerrarTurno(this)">🔒 Cerrar turno</button></div>';
  $("cierreCard")._R = R;
}
function pintarDifCierre(){
  const R = $("cierreCard")._R; if (!R) return;
  const b = $("cBs").value, u = $("cUsd").value;
  $("cBsDif").innerHTML = b === "" ? "" : difHTML(r2(Number(b) - R.efBsEsperado));
  $("cUsdDif").innerHTML = u === "" ? "" : difHTML(r2(Number(u) - R.efUsdEsperado));
}
async function cerrarTurno(btn){
  const t = S.turno, R = resumenTurno(t);
  const b = $("cBs").value, u = $("cUsd").value;
  if (b === "" || u === "") { aviso({ icono: "💵", titulo: "Falta el conteo", html: "Cuenta el efectivo de la gaveta y escribe cuánto hay en <b>Bs</b> y en <b>$</b> (si no hay, escribe 0)." }); return; }
  const dBs = r2(Number(b) - R.efBsEsperado), dUsd = r2(Number(u) - R.efUsdEsperado);
  const txtDif = (Math.abs(dBs) >= 0.005 || Math.abs(dUsd) >= 0.005)
    ? "<br><br>⚠️ El efectivo no cuadra: Bs " + (dBs >= 0 ? "+" : "") + fmt(dBs) + " · $" + (dUsd >= 0 ? "+" : "") + fmt(dUsd) + ". Queda anotado en el cierre." : "<br><br>✅ El efectivo cuadra.";
  if (!await confirmar({ icono: "🔒", titulo: "Cerrar el turno de " + t.cajeroNombre, ok: "Sí, cerrar turno", colorOk: "naranja", html: "Se cierra el turno con " + R.ventas + " venta" + (R.ventas === 1 ? "" : "s") + " por Bs " + fmt(R.totalBs) + "." + txtDif })) return;
  btnOcupado(btn, "Cerrando…");
  const c = Object.assign({ id: t.id, cajeroId: t.cajeroId, cajeroNombre: t.cajeroNombre, apertura: t.apertura, cierre: ahoraTxt(),
    fondoBs: t.fondoBs, fondoUsd: t.fondoUsd, efBsContado: r2(Number(b)), efUsdContado: r2(Number(u)), efBsDif: dBs, efUsdDif: dUsd,
    obs: ((S.cierreAdmin ? "Lo cerró " + S.cierreAdmin.nombre + " (" + t.cajeroNombre + " no estaba). " : "") + $("cObs").value.trim()).trim(), cerradoPor: S.cierreAdmin ? S.cierreAdmin.nombre : t.cajeroNombre,
    caja: S.datos.caja, equipo: S.datos.equipo, estado: "por_subir", msg: "" }, R);
  c.metodos = R.metodos.map(m => ({ metodo: m.metodo, tipo: m.tipo, desc: m.desc, neto: m.neto, efectivo: m.efectivo }));
  S.cierres.push(c);
  try { await kvSet("cierres", S.cierres); await kvSet("turno", null); }
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
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Cierre ' + esc(c.cajeroNombre) + "</title>" + estiloPapel(fmtT) + "</head><body>" +
    '<div style="text-align:center;padding:8px 0 5px;"><div style="font-size:13px;">' + esc(d.negocio || "") + "</div><div>CIERRE DE CAJA</div><div>Caja " + esc(c.caja || d.caja) + " · equipo " + esc(c.equipo || d.equipo) + "</div></div>" +
    '<hr class="sep"><table>' + fila("Cajero:", esc(c.cajeroNombre)) + fila("Apertura:", esc(c.apertura)) + fila("Cierre:", esc(c.cierre)) + fila("Ventas:", c.ventas) +
    fila("Total:", "Bs " + fmt(c.totalBs)) + fila("Total $ BCV:", "$" + fmt(c.totalUsd)) + (c.descuentos ? fila("Descuentos:", "$" + fmt(c.descuentos)) : "") + "</table>" +
    '<hr class="sep"><div style="font-size:9px;text-transform:uppercase;margin-bottom:3px;">Por método (menos vuelto)</div><table>' +
    (c.metodos || []).map(m => fila(esc(String(m.desc || m.metodo).replace(/^[^\wÁÉÍÓÚÑáéíóúñ]+\s*/, "")), (m.tipo === "BS" ? "Bs " : "$") + fmt(m.neto))).join("") + (c.credito ? fila("A crédito:", "$" + fmt(c.credito)) : "") + "</table>" +
    '<hr class="sep"><div style="font-size:9px;text-transform:uppercase;margin-bottom:3px;">Efectivo Bs</div><table>' +
    fila("Fondo:", fmt(c.fondoBs)) + fila("Del turno:", fmt(c.efBsVentas)) + fila("Debe haber:", fmt(c.efBsEsperado)) + fila("Contado:", fmt(c.efBsContado)) + fila("Resultado:", dif(c.efBsDif)) + "</table>" +
    '<hr class="sep"><div style="font-size:9px;text-transform:uppercase;margin-bottom:3px;">Efectivo $</div><table>' +
    fila("Fondo:", fmt(c.fondoUsd)) + fila("Del turno:", fmt(c.efUsdVentas)) + fila("Debe haber:", fmt(c.efUsdEsperado)) + fila("Contado:", fmt(c.efUsdContado)) + fila("Resultado:", dif(c.efUsdDif)) + "</table>" +
    (c.sinSubir ? '<hr class="sep"><div>Ventas sin subir al cerrar: ' + c.sinSubir + "</div>" : "") +
    (c.obs ? '<hr class="sep"><div>Obs: ' + esc(c.obs) + "</div>" : "") +
    '<div style="margin-top:28px;border-top:1px solid #000;text-align:center;padding-top:3px;">Firma del cajero</div>' +
    '<div style="text-align:center;margin-top:8px;font-size:9px;">Impreso ' + esc(ahoraTxt()) + "</div></body></html>";
}

// ══ SUBIR LAS VENTAS AL SISTEMA ══
function datosParaSubir(v){
  return { id: v.id, numero: v.numero, creada: v.creada, fecha: v.fecha, tasas: v.tasas, items: v.items, pago: v.pago,
           numeroFactura: v.numeroTicket || 0, turno: v.turno || "" };
}
async function sincronizar(manual){
  if (!S.eq || !S.datos || S.sincronizando) return { subidas: 0 };
  if (S.permisoMal && !manual) return { subidas: 0 };
  // De la más vieja a la más nueva (y a igual hora, por número de ticket)
  const cola = S.ventas.filter(v => v.estado === "por_subir").sort((a, b) => String(a.creada).localeCompare(String(b.creada)) || (Number(a.numeroTicket) || 0) - (Number(b.numeroTicket) || 0));
  if (!cola.length) { await subirCierres(); await numerosAlDia(); await ordAlDia(); if (manual) await actualizarDatos(null, true); return { subidas: 0 }; }
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
      if (r && r.ok) {
        v.estado = "subida"; v.numeroFactura = String(r.numero || ""); v.avisos = r.avisos || []; v.msg = ""; v.subidaEn = Date.now();
        subidas++;
      } else if (r && r.estado === "procesando") {
        v.msg = r.msg || "Se está subiendo desde otro lado.";
        await ventaPut(v); cortado = ""; break;   // se espera: las que siguen no se adelantan
      } else if (r && r.estado === "invalida") {
        v.estado = "invalida"; v.msg = r.msg || "El sistema rechazó la venta.";
      } else if (r && r.reintentar) {
        v.msg = r.msg || "El sistema estaba ocupado.";
        await ventaPut(v); break;                 // se vuelve a intentar en orden, empezando por esta
      } else {
        v.estado = "pendiente"; v.msg = (r && r.msg) || "El sistema no la pudo registrar.";
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
  if (!cortado) { await subirCierres(); await numerosAlDia(); await ordAlDia(); }
  if (subidas && S.online) { await actualizarDatos(null, true); contarOrdenes(); }   // existencias al día (y las órdenes que se convirtieron)
  return { subidas, cortado };
}
async function subirCierres(){
  for (const c of S.cierres.filter(x => x.estado === "por_subir")) {
    let r;
    try { r = await api("cj_cierre", { cierre: c }, 60000); } catch (e) { return; }
    if (r && r.ok) { c.estado = "subido"; c.msg = ""; } else { c.msg = (r && r.msg) || "No se pudo subir."; if (r && r.codigo === "EQUIPO") return; }
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
async function reintentar(id, btn){
  const v = S.ventas.find(x => x.id === id); if (!v) return;
  v.estado = "por_subir"; v.msg = "";
  await ventaPut(v);
  await subirAhora(btn);
}

// ══ VENTAS DEL EQUIPO ══
function filtrarVentas(f){ S.filtro = f; document.querySelectorAll("#filtros button").forEach(b => b.classList.toggle("on", b.dataset.f === f)); pintarVentas(); }
function estadoHTML(v){
  if (v.estado === "subida") return (v.avisos && v.avisos.length) ? '<span class="est av">⚠️ En el sistema #' + esc(v.numeroFactura) + " · con avisos</span>" : '<span class="est sub">✅ En el sistema #' + esc(v.numeroFactura) + "</span>";
  if (v.estado === "por_subir") return '<span class="est por">⏳ Por subir</span>';
  return '<span class="est mal">❌ No se registró</span>';
}
function pintarVentas(){
  const hoy = hoyTxt();
  const deHoy = S.ventas.filter(v => v.fecha === hoy);
  const bcvDe = v => v.totalBcv != null ? Number(v.totalBcv) || 0 : Number(v.total) || 0;   // en $ BCV (una Venta en Dólares, pasada con sus tasas)
  const sumBs = deHoy.reduce((s, v) => s + (Number(v.totalBs) || 0), 0), sumUsd = deHoy.reduce((s, v) => s + bcvDe(v), 0);
  const c = cuentas();
  // Por método (hoy): lo cobrado menos el vuelto
  const porMet = {};
  deHoy.forEach(v => {
    (v.pago.pagos || []).forEach(p => { const k = p.metodo + "|" + p.tipo; porMet[k] = (porMet[k] || 0) + (Number(p.monto) || 0); });
    (v.pago.vuelto || []).forEach(p => { const k = p.metodo + "|" + p.tipo; porMet[k] = (porMet[k] || 0) - (Number(p.monto) || 0); });
  });
  let h = '<div><span>Ventas de hoy</span><b>' + deHoy.length + "</b></div>" +
    '<div><span>Total hoy</span><b>Bs ' + fmt(sumBs) + '</b><span style="text-transform:none;">$' + fmt(sumUsd) + " BCV</span></div>" +
    '<div><span>Por subir</span><b style="color:var(--blue);">' + c.por + "</b></div>" +
    '<div><span>Con problema</span><b style="color:' + (c.mal ? "var(--red)" : "inherit") + ';">' + c.mal + "</b></div>";
  const mets = Object.keys(porMet);
  if (mets.length) h += '<div style="grid-column:1/-1;"><span>Hoy por método (menos el vuelto)</span>' + mets.map(k => { const [m, t] = k.split("|"); return '<div class="met"><span style="text-transform:none;font-weight:600;color:var(--text);font-size:13px;">' + esc(m) + "</span><b>" + (t === "BS" ? "Bs " : "$") + fmt(porMet[k]) + "</b></div>"; }).join("") + "</div>";
  $("resumen").innerHTML = h;
  // Por cajero (hoy)
  const porCj = {};
  deHoy.forEach(v => { const k = v.pago.cajeroNombre || "Sin cajero"; const x = porCj[k] = porCj[k] || { n: 0, bs: 0, usd: 0 }; x.n++; x.bs += Number(v.totalBs) || 0; x.usd += bcvDe(v); });
  const cjs = Object.keys(porCj);
  $("porCajero").innerHTML = cjs.length ? '<div class="card" style="margin-bottom:10px;"><div class="card-tit">🧾 Hoy por cajero</div><table class="cie-tabla">' +
    cjs.map(k => "<tr><td><b>" + esc(k) + "</b> · " + porCj[k].n + " venta" + (porCj[k].n === 1 ? "" : "s") + '</td><td class="r">Bs ' + fmt(porCj[k].bs) + ' <span style="color:var(--text-dim);font-weight:600;">· $' + fmt(porCj[k].usd) + "</span></td></tr>").join("") + "</table></div>" : "";
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
  if (S.filtro === "hoy") lst = lst.filter(v => v.fecha === hoy);
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
    if ((v.estado === "pendiente" || v.estado === "invalida") && v.msg) msg = '<div class="vt-msg mal"><b>Por qué no se registró:</b><br>' + esc(v.msg) + "<br><br>La venta sigue guardada en este equipo. Cuando el administrador lo corrija en el sistema, toca <b>Reintentar</b>.</div>";
    if (v.estado === "por_subir" && v.msg) msg = '<div class="vt-msg av">Último intento: ' + esc(v.msg) + "</div>";
    const nroL = v.numeroFactura ? "#" + v.numeroFactura : (v.numeroTicket ? "#" + v.numeroTicket : "PROV " + v.numero);
    if (v.numeroFactura && String(v.numeroTicket || "") !== String(v.numeroFactura)) msg = '<div class="vt-msg av">⚠️ El ticket salió ' + (v.numeroTicket ? "con el #" + esc(v.numeroTicket) : "provisional") + " y quedó registrada con el <b>#" + esc(v.numeroFactura) + "</b>. Reimprímelo si el cliente lo necesita.</div>" + msg;
    return '<div class="vt-item" id="vt_' + v.id + '"><div class="vt-cab" onclick="this.parentNode.classList.toggle(\'abierto\')"><div style="min-width:0;"><div class="n">' + esc(nroL) + " · " + fechaCorta(v.fecha) + " " + horaDe(v.creada) + (v.pago.cajeroNombre ? ' <span style="color:var(--text-dim);font-weight:600;">· ' + esc(v.pago.cajeroNombre) + "</span>" : "") + "</div>" +
      '<div class="s">' + esc(p.clienteNombre || "Genérico") + (p.clienteCedula ? " · " + esc(p.clienteCedula) : "") + "</div>" + estadoHTML(v) + "</div>" +
      '<div class="m">Bs ' + fmt(v.totalBs) + '<div style="font-size:11px;color:var(--text-dim);font-weight:600;">$' + fmt(v.total) + (v.unidad === "div" ? " div" : "") + "</div></div></div>" +
      '<div class="vt-det">' + msg + "<table>" + items + "</table><table>" + pagos + "</table>" +
      '<div style="font-size:12px;color:var(--text-dim);">' + (v.unidad === "div" ? "💵 Venta en Dólares · " : "") + 'Tasa BCV Bs ' + fmt(v.tasas.bcv) + (v.tasas.div ? " · Divisas Bs " + fmt(v.tasas.div) : "") + (p.descuentoTipo !== "ninguno" && p.descuentoValor ? " · descuento " + (p.descuentoTipo === "pct" ? fmt(p.descuentoValor) + " %" : "$" + fmt(p.descuentoValor)) : "") + (p.referencia ? " · Ref: " + esc(p.referencia) : "") + (p.ordenId ? " · " + (p.canal === "WEB" ? "🌐 pedido web " : "📋 orden ") + esc(p.ordenId) : "") + "</div>" +
      '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;"><button type="button" class="btn sm" onclick="imprimirPorId(\'' + v.id + '\')">🖨️ Reimprimir</button>' +
      ((v.estado === "pendiente" || v.estado === "invalida") ? '<button type="button" class="btn sm green" onclick="reintentar(\'' + v.id + '\',this)">🔁 Reintentar</button>' : "") + "</div></div></div>";
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
    "<span>Entrada</span><b>" + (sesionDirecta() ? "directa: este equipo entra solo a la caja (solo esta caja; para el sistema se pide usuario y clave)" : "con usuario y clave") + "</b>" +
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
    const r = await fetch("./app.js?v=" + Date.now(), { cache: "no-store" });
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
