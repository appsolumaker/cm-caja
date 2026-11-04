"use strict";
// ══════════════════════════════════════════════════════════════
//  CAJA · ControlMaster — Etapa 0 (3-11-2026) · https://<cliente>.micontrolmaster.com/caja
//  Vende SIEMPRE como sin internet: la venta se guarda en este equipo, el ticket sale de una vez con un
//  número de factura apartado (numeros.js) y la venta sube sola al sistema en segundo plano
//  (cj_subir → la misma subida de la caja sin internet: una sola vez, con lo que se cobró).
//  Archivos: app.js (la caja) · api.js (habla con el sistema) · sesion.js (entrar, equipo, pase)
//            numeros.js (números apartados) · estilos.css · sw.js (abre sin internet)
//  Por ahora solo tasaBin APAGADO (Etapa 1: encendido): los Bs a tasa BCV y los $ a tasa Divisas (H9).
// ══════════════════════════════════════════════════════════════
const APP_VER = "2.0.1 · 4-11-2026";
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
function nuevaFactura(){ return { items: [], cliente: { cedula: "", nombre: "Genérico", direccion: "", telefono: "" }, tipoPrecio: 0, desc: { tipo: "ninguno", valor: 0 }, vend: "", claveOk: false, seq: 0 }; }
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
  if (_listoYa) { sincronizar(); return; }
  _listoYa = true;
  setTimeout(async () => { const r = await sincronizar(); if (!(r && r.subidas)) actualizarDatos(null, true); }, 800);
  setInterval(() => sincronizar(), 60000);                     // cada minuto: lo que haya por subir y los números al día
  setInterval(() => { if (S.online !== false) actualizarDatos(null, true); }, 20 * 60000);
  window.addEventListener("online", () => { sincronizar(); revisarVersion(); });
  setTimeout(revisarVersion, 5000);
  setInterval(revisarVersion, 30 * 60000);
  window.addEventListener("offline", () => marcarOnline(false));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) sincronizar(); });
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
  S.datos = d; S.permisoMal = ""; S.datosMal = "";
  await kvSet("datos", d);
  S.tasas = { bcv: Number(d.tasa) || 0, div: Number(d.tasaDivisas) || 0, fecha: hoyTxt(), origen: "sistema" };
  await kvSet("tasas", S.tasas);
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
  const nv = (v === "turno" || v === "cierre") ? "vender" : v;
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("on", b.dataset.v === nv));
  $("nav").classList.toggle("oculto", v === "activar");
}
function irA(v){
  if (!S.datos) return;
  if (v === "vender" && !S.turno) { mostrarVista("turno"); pintarTurno(); return; }   // primero, abrir turno
  mostrarVista(v);
  if (v === "ventas") pintarVentas();
  if (v === "ajustes") pintarAjustes();
  if (v === "vender") setTimeout(() => { const b = $("busca"); if (b && window.innerWidth >= 900) b.focus(); }, 50);
}
function pintarTodo(){
  pintarCabecera(); pintarEstado(); pintarBanners();
  if (S.vista === "turno") pintarTurno();
  pintarSelectores(); buscar(); pintarFactura();
  if (S.vista === "ventas") pintarVentas();
  if (S.vista === "ajustes") pintarAjustes();
}
function pintarCabecera(){
  const d = S.datos;
  if (!d) return;
  $("pillTurno").classList.toggle("oculto", !S.turno);
  if (S.turno) $("turnoNom").textContent = S.turno.cajeroNombre + " · Cerrar turno";
  $("tTit").innerHTML = esc(d.negocio || "Mi negocio") + "<small>Caja " + esc(d.caja) + " · equipo " + esc(d.equipo || "") + (S.ses && S.ses.usuario ? " · " + esc(S.ses.usuario.nombre || S.ses.usuario.usuario) : "") + "</small>";
  const t = S.tasas || {};
  const vieja = t.fecha && t.fecha !== hoyTxt();
  $("tasaBar").innerHTML = "💱 BCV <b>Bs " + fmt(t.bcv) + "</b> · Divisas <b>Bs " + (t.div > 0 ? fmt(t.div) : "—") + "</b>" +
    (vieja ? ' · <span class="vieja">⚠️ tasa del ' + fechaCorta(t.fecha) + '</span>' : (t.origen === "manual" ? ' · <span class="vieja">puesta a mano</span>' : "")) +
    '<span class="flex1"></span><span>Datos del ' + fechaCorta(hoyTxt(new Date(d.descargadoEn))) + " " + pad(new Date(d.descargadoEn).getHours()) + ":" + pad(new Date(d.descargadoEn).getMinutes()) + "</span>";
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
  let t = S.online === true ? "Con internet" : S.online === false ? "Sin internet" : "Revisando…";
  if (S.online === true) p.classList.add("on"); else if (S.online === false) p.classList.add("off");
  if (S.sincronizando) t = "Subiendo…";
  if (c.mal) { p.classList.add("mal"); t += " · " + c.mal + " con problema"; }
  else if (c.por) { p.classList.add("pend"); t += " · " + c.por + " por subir"; }
  else if (S.ventas.length) t += " · todo subido";
  $("pillTxt").textContent = t;
}
function pintarBanners(){
  let h = "";
  if (S.permisoMal) h += '<div class="banner mal">⛔ ' + esc(S.permisoMal) + ' Puedes seguir vendiendo; las ventas quedan guardadas en este equipo. <a href="#" onclick="olvidarEquipo();return false;" style="color:inherit;font-weight:800;">Activar otra vez</a></div>';
  if (S.datosMal) h += '<div class="banner mal">⛔ ' + esc(S.datosMal) + "</div>";
  if (S.sesionMal) h += '<div class="banner av">🔐 ' + esc(S.sesionMal) + ' <a href="#" onclick="pedirEntrarOtraVez();return false;" style="color:inherit;font-weight:800;">Entrar</a></div>';
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
  const m = {}, desde = S.datos ? S.datos.descargadoEn : 0;
  S.ventas.forEach(v => {
    if (v.estado === "invalida") return;
    if (v.subidaEn && v.subidaEn <= desde) return;   // ya estaba en los datos descargados
    v.items.forEach(i => { if (i.tipo !== "servicio") m[i.codigo] = (m[i.codigo] || 0) + (Number(i.cantidad) || 0); });
  });
  return (_vendidoLocal = m);
}
function existenciaLocal(p){
  const enFactura = F.items.filter(i => i.tipo !== "servicio" && i.codigo === p.codigo).reduce((s, i) => s + (Number(i.cantidad) || 0), 0);
  return r3((Number(p.existencia) || 0) - (vendidoLocal()[p.codigo] || 0) - enFactura);
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
function resultados(q){
  const n = norm(q);
  const todos = cat();
  if (!n) return todos.slice(0, 40);
  const exactos = todos.filter(p => norm(p.codigo) === n || norm(p.codigoBarras) === n);
  const palabras = n.split(/\s+/);
  const resto = todos.filter(p => exactos.indexOf(p) < 0 && palabras.every(w =>
    norm(p.nombre).indexOf(w) >= 0 || norm(p.codigo).indexOf(w) >= 0 || norm(p.codigoBarras).indexOf(w) >= 0 || norm(p.marca).indexOf(w) >= 0));
  return exactos.concat(resto).slice(0, 40);
}
function buscar(){
  const box = $("listaProd");
  if (!S.datos) { box.innerHTML = ""; return; }
  const q = $("busca").value, lst = resultados(q), t = S.tasas || {};
  if (!norm(q) && window.innerWidth < 900) { box.innerHTML = '<div class="vacio">Escribe el nombre o el código, o pasa el lector de códigos.</div>'; box._lst = []; return; }
  if (!lst.length) { box.innerHTML = '<div class="vacio">No hay productos con «' + esc(q) + '».</div>'; box._lst = []; return; }
  box.innerHTML = lst.map((p, k) => {
    const pr = precioDe(p, F.tipoPrecio), conIva = pr.base * (1 + pr.iva / 100);
    let ex = "";
    if (p.tipo === "servicio") ex = '<span class="tag">SERVICIO</span>';
    else { const e = existenciaLocal(p); ex = '<span class="ex ' + (e <= 0 ? "cero" : e <= 5 ? "bajo" : "") + '">' + fmtCant(e) + "</span>"; }
    return '<div class="prod" data-k="' + k + '" onclick="clicProducto(this,' + k + ')" ondblclick="agregarDeLista(' + k + ')"><div style="min-width:0;"><div class="prod-nom">' + esc(p.nombre) + "</div>" +
      '<div class="prod-sub">' + esc(p.codigoBarras || p.codigo) + (p.marca ? " · " + esc(p.marca) : "") + " " + ex + "</div></div>" +
      '<div class="prod-pr"><b>Bs ' + fmt(conIva * (t.bcv || 0)) + "</b><span>$" + fmt(conIva) + "</span></div></div>";
  }).join("");
  box._lst = lst;
}
function buscarEnter(){
  const lst = $("listaProd")._lst || [], q = norm($("busca").value);
  if (!q) return;
  const ex = lst.filter(p => norm(p.codigo) === q || norm(p.codigoBarras) === q);
  if (ex.length === 1) { agregar(ex[0]); return; }
  if (lst.length === 1) { agregar(lst[0]); return; }
  if (!lst.length) aviso({ icono: "🔎", titulo: "No está en la lista", html: "No hay ningún producto con «" + esc($("busca").value) + "» en los datos de este equipo. Si es nuevo, toca <b>⚙️ → 🔄 Actualizar datos</b> (con internet)." });
}
function agregarDeLista(k){ const p = ($("listaProd")._lst || [])[k]; if (p) agregar(p); }
// Como en Ventas: un clic marca el producto y el doble clic lo agrega. En pantalla táctil, un toque lo agrega.
const ES_TACTIL = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
function clicProducto(el, k){
  if (ES_TACTIL) { agregarDeLista(k); return; }
  document.querySelectorAll("#listaProd .prod.sel").forEach(x => x.classList.remove("sel"));
  el.classList.add("sel");
}
async function agregar(p){
  if (p.tipo !== "servicio") {
    const e = existenciaLocal(p);
    if (e < 1) {
      const ok = await confirmar({ icono: "📦", titulo: "Sin existencia en este equipo", colorOk: "naranja", ok: "Vender igual",
        html: "Según los datos de este equipo, de <b>" + esc(p.nombre) + "</b> quedan <b>" + fmtCant(Math.max(0, e)) + "</b>." +
          "<br><br>Si lo tienes en la mano, véndelo: al subirse se registra igual y el sistema avisa que hay que revisar la existencia." });
      if (!ok) return;
    }
  }
  const pr = precioDe(p, F.tipoPrecio);
  const ya = F.items.find(i => i.codigo === p.codigo && i.tipo === p.tipo && !i.manual && i.tipoIdx === F.tipoPrecio);
  if (ya) ya.cantidad = r3((Number(ya.cantidad) || 0) + 1);
  else F.items.push({ key: ++F.seq, tipo: p.tipo, codigo: p.codigo, nombre: p.nombre, codigoBarras: p.codigoBarras || p.codigo,
    cantidad: 1, base: pr.base, iva: pr.iva, manual: false, tipoIdx: F.tipoPrecio });
  $("busca").value = "";
  buscar(); pintarFactura();
  toast("✅ " + p.nombre);
  if (window.innerWidth >= 900) $("busca").focus();
}

// ══ LA VENTA (factura) ══
function pintarSelectores(){
  const d = S.datos; if (!d) return;
  // Tipo de precio
  const tp = (d.tiposPrecios || []).map((n, i) => ({ n, i })).filter(o => o.i === 0 || (d.productos || []).some(p => p.precios && p.precios[o.i] && Number(p.precios[o.i].base) > 0));
  $("selTipoPrecio").innerHTML = tp.map(o => '<option value="' + o.i + '"' + (o.i === F.tipoPrecio ? " selected" : "") + ">💲 " + esc(o.n) + "</option>").join("");
  $("selTipoPrecio").classList.toggle("oculto", tp.length < 2);
  // Vendedor
  const sel = $("selVend"), badge = $("badgeVend");
  sel.classList.add("oculto"); badge.classList.add("oculto");
  if (d.trabajoVendedores && d.modoCajas === "cajero") {
    if (F.vend === "") F.vend = d.vendedorCajaId ? String(d.vendedorCajaId) : "directa";
    sel.innerHTML = '<option value="directa">🏪 Venta directa</option>' + (d.vendedores || []).map(v => '<option value="' + esc(v.id) + '">🧑‍💼 ' + esc(v.nombre) + "</option>").join("");
    sel.value = F.vend; if (sel.value !== F.vend) { F.vend = "directa"; sel.value = "directa"; }
    sel.classList.remove("oculto");
  } else if (d.trabajoVendedores && d.vendedor && d.vendedor.nombre) {
    badge.textContent = "🧑‍💼 " + d.vendedor.nombre; badge.classList.remove("oculto");
  } else if (d.cajero && d.cajero.nombre) {
    badge.textContent = "🧾 " + d.cajero.nombre; badge.classList.remove("oculto");
  }
}
function cambiarTipoPrecio(v){
  F.tipoPrecio = Number(v) || 0;
  const c = cat();
  F.items.forEach(i => { if (i.manual || i.tipo === "servicio") return; const p = c.find(x => x.codigo === i.codigo && x.tipo === i.tipo); if (!p) return; const pr = precioDe(p, F.tipoPrecio); i.base = pr.base; i.iva = pr.iva; i.tipoIdx = F.tipoPrecio; });
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
function pintarFactura(){
  const box = $("lineas"), t = S.tasas || {};
  _vendidoLocal = null;
  if (!F.items.length) box.innerHTML = '<div class="vacio">Busca un producto o pasa el lector de códigos.<br>Toca un producto para agregarlo.</div>';
  else box.innerHTML = F.items.map(i => {
    const conIva = i.base * (1 + i.iva / 100), tl = conIva * (Number(i.cantidad) || 0);
    return '<div class="linea"><div class="linea-nom">' + esc(i.nombre) + (i.manual ? '<span class="man">✏️ PRECIO MANUAL</span>' : "") + (i.tipo === "servicio" ? ' <span class="tag">SRV</span>' : "") + "</div>" +
      '<div class="linea-tot">Bs ' + fmt(tl * (t.bcv || 0)) + "<small>$" + fmt(tl) + "</small></div>" +
      '<div class="linea-ctrl"><input class="inp" type="number" inputmode="decimal" min="0" step="any" placeholder="Cant." value="' + (i.cantidad === "" ? "" : i.cantidad) + '" oninput="cambiarCant(' + i.key + ',this.value)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();$(\'busca\').focus();}">' +
      '<span class="pu">× $' + fmt(conIva) + (i.iva ? " (IVA " + fmt(i.iva).replace(",00", "") + "%)" : "") + "</span></div>" +
      '<div class="linea-acc"><button type="button" class="ico" title="Precio manual" onclick="precioManual(' + i.key + ')">✏️</button><button type="button" class="ico" title="Quitar" onclick="quitarLinea(' + i.key + ')">✕</button></div></div>';
  }).join("");
  pintarTotales();
}
function pintarTotales(){
  const t = S.tasas || {}, x = totales(F.items, F.desc), bcv = t.bcv || 0;
  let h = '<div><span>Subtotal</span><b>$' + fmt(x.sub) + "</b></div>";
  if (x.desc > 0) h += '<div><span>Descuento ' + (F.desc.tipo === "pct" ? fmt(F.desc.valor).replace(",00", "") + " %" : "") + ' <a href="#" onclick="quitarDescuento();return false;" style="color:var(--red);">quitar</a></span><b>− $' + fmt(x.desc) + "</b></div>";
  h += "<div><span>IVA</span><b>$" + fmt(x.ivaR) + "</b></div>";
  h += '<div class="grande"><span>Total</span><b>Bs ' + fmt(r2(x.total * bcv)) + "</b></div>";
  h += "<div><span>Total $ BCV</span><b>$" + fmt(x.total) + "</b></div>";
  $("totales").innerHTML = h;
  $("barraTot").innerHTML = "Bs " + fmt(r2(x.total * bcv)) + "<small>$" + fmt(x.total) + " BCV · " + F.items.length + " línea" + (F.items.length === 1 ? "" : "s") + "</small>";
  $("btnDesc").classList.toggle("on", x.desc > 0);
  $("cliNom").textContent = F.cliente.nombre + (F.cliente.cedula ? " · " + F.cliente.cedula : "");
  $("btnCliente").classList.toggle("on", !!F.cliente.cedula);
}
function cambiarCant(key, v){
  const i = F.items.find(x => x.key === key); if (!i) return;
  i.cantidad = v === "" ? "" : r3(v);
  // sin repintar las líneas (no se pierde el cursor)
  const t = S.tasas || {}, conIva = i.base * (1 + i.iva / 100), tl = conIva * (Number(i.cantidad) || 0);
  const fila = document.activeElement && document.activeElement.closest ? document.activeElement.closest(".linea") : null;
  if (fila) fila.querySelector(".linea-tot").innerHTML = "Bs " + fmt(tl * (t.bcv || 0)) + "<small>$" + fmt(tl) + "</small>";
  _vendidoLocal = null;
  pintarTotales();
}
function quitarLinea(key){ F.items = F.items.filter(x => x.key !== key); pintarFactura(); buscar(); }
async function limpiarVentaConfirmar(){
  if (!F.items.length && !F.cliente.cedula && F.desc.tipo === "ninguno") return;
  const ok = await confirmar({ icono: "🗑️", titulo: "Vaciar la venta", html: "Se quitan los productos, el cliente y el descuento de esta venta. No se guarda nada.", ok: "Sí, vaciar", colorOk: "red" });
  if (ok) limpiarVenta();
}
function limpiarVenta(){
  const tp = F.tipoPrecio;
  Object.assign(F, nuevaFactura()); F.tipoPrecio = tp;   // el vendedor vuelve al de la caja (como en Ventas)
  $("busca").value = "";
  pintarSelectores(); buscar(); pintarFactura();
  if (_verNueva && !_ventaGuardada) setTimeout(recargarSiSePuede, 300);
}

// ── Clave sin internet (descuento, precio manual, cambiar tasa) ──
async function sha256hex(t){
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
let _claveFallas = 0, _claveBloqHasta = 0;
async function pedirClave(titulo, texto){
  const c = S.datos && S.datos.claveSinInternet;
  if (!c || !c.salt || !c.hash) {
    await aviso({ icono: "🔒", titulo: "Falta la clave sin internet", html: "Para esto hace falta la <b>clave sin internet</b>, y este equipo no la tiene. Pídele al administrador que la ponga; el equipo la recibe la próxima vez que se actualice con internet." });
    return false;
  }
  return await modal({
    icono: "🔒", titulo: titulo,
    html: '<div class="m-txt">' + texto + '</div><input class="inp" id="mClave" type="password" placeholder="Clave sin internet" autocomplete="off" style="margin-top:10px;" onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.closest(\'.modal\').querySelector(\'[data-v=ok]\').click();}"><div class="m-err" id="mClaveErr"></div>',
    botones: [{ txt: "Cancelar", v: false }, { txt: "✅ Verificar", v: true, cls: "green", spin: "Verificando…" }],
    foco: "mClave",
    antes: async (v) => {
      if (!v) return true;
      const err = $("mClaveErr");
      if (Date.now() < _claveBloqHasta) { err.textContent = "Demasiados intentos. Espera un minuto."; return false; }
      const val = $("mClave").value;
      if (!val) { err.textContent = "Escribe la clave."; return false; }
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
}
async function precioManual(key){
  const i = F.items.find(x => x.key === key); if (!i) return;
  if (S.datos.pideClave && S.datos.pideClave.manual && !F.claveOk) {
    if (!await pedirClave("Precio manual", "Escribe la clave sin internet para cambiar el precio de <b>" + esc(i.nombre) + "</b>:")) return;
    F.claveOk = true;
  }
  const conIva = i.base * (1 + i.iva / 100), bcv = (S.tasas || {}).bcv || 0;
  const r = await modal({
    icono: "✏️", titulo: "Precio manual",
    html: '<div class="m-txt"><b>' + esc(i.nombre) + "</b><br><span style=\"color:var(--text-dim);font-size:13px;\">Hoy: $" + fmt(conIva) + " · Bs " + fmt(conIva * bcv) + (i.iva ? " (con IVA " + fmt(i.iva).replace(",00", "") + "%)" : "") + "</span></div>" +
      '<label class="lbl">Precio por unidad' + (i.iva ? " con IVA" : "") + '</label><div class="seg" style="margin-bottom:6px;"><button type="button" class="btn sm on" id="mpUsd" onclick="this.classList.add(\'on\');$(\'mpBs\').classList.remove(\'on\');$(\'mpVal\').placeholder=\'En $ BCV\'">En $</button><button type="button" class="btn sm" id="mpBs" onclick="this.classList.add(\'on\');$(\'mpUsd\').classList.remove(\'on\');$(\'mpVal\').placeholder=\'En Bs\'">En Bs</button></div>' +
      '<input class="inp" id="mpVal" type="number" inputmode="decimal" min="0" step="any" placeholder="En $ BCV"><div class="m-err" id="mpErr"></div>',
    botones: [{ txt: "Cancelar", v: false }, { txt: "✅ Aplicar", v: true, cls: "green" }],
    foco: "mpVal",
    antes: (v) => {
      if (!v) return true;
      const x = Number($("mpVal").value);
      if (!(x > 0)) { $("mpErr").textContent = "Escribe un precio mayor que cero."; return false; }
      let usd = $("mpBs").classList.contains("on") ? (bcv > 0 ? x / bcv : 0) : x;
      i.base = usd / (1 + i.iva / 100);
      i.manual = true; i.tipoIdx = -1;
      return true;
    }
  });
  if (r) pintarFactura();
}
async function abrirDescuento(){
  if (!F.items.length) { aviso({ icono: "🏷️", titulo: "La venta está vacía", html: "Agrega los productos primero y después el descuento." }); return; }
  if (S.datos.pideClave && S.datos.pideClave.descuento && !F.claveOk) {
    if (!await pedirClave("Descuento", "Escribe la clave sin internet para hacer un descuento:")) return;
    F.claveOk = true;
  }
  const x = totales(F.items, { tipo: "ninguno" });
  let tipo = F.desc.tipo === "monto" ? "monto" : "pct";
  const r = await modal({
    icono: "🏷️", titulo: "Descuento",
    html: '<div class="m-txt" style="color:var(--text-dim);font-size:13px;">Total sin descuento: $' + fmt(x.total) + "</div>" +
      '<div class="seg" style="margin-top:10px;"><button type="button" class="btn sm' + (tipo === "pct" ? " on" : "") + '" id="dPct" onclick="this.classList.add(\'on\');$(\'dMon\').classList.remove(\'on\');$(\'dVal\').placeholder=\'Porcentaje (%)\'">%</button><button type="button" class="btn sm' + (tipo === "monto" ? " on" : "") + '" id="dMon" onclick="this.classList.add(\'on\');$(\'dPct\').classList.remove(\'on\');$(\'dVal\').placeholder=\'Monto en $ BCV\'">$</button></div>' +
      '<input class="inp" id="dVal" type="number" inputmode="decimal" min="0" step="any" style="margin-top:8px;" placeholder="' + (tipo === "pct" ? "Porcentaje (%)" : "Monto en $ BCV") + '" value="' + (F.desc.valor > 0 ? F.desc.valor : "") + '"><div class="m-err" id="dErr"></div>',
    botones: [{ txt: "Cancelar", v: false }, { txt: "✅ Aplicar", v: true, cls: "green" }],
    foco: "dVal",
    antes: (v) => {
      if (!v) return true;
      const val = Number($("dVal").value) || 0, pct = $("dPct").classList.contains("on");
      if (!(val > 0)) { $("dErr").textContent = "Escribe el descuento."; return false; }
      if (pct && val > 100) { $("dErr").textContent = "El porcentaje no puede pasar de 100."; return false; }
      if (!pct && val > x.total + 0.001) { $("dErr").textContent = "El descuento no puede pasar del total ($" + fmt(x.total) + ")."; return false; }
      F.desc = { tipo: pct ? "pct" : "monto", valor: val };
      return true;
    }
  });
  if (r) pintarTotales();
}
function quitarDescuento(){ F.desc = { tipo: "ninguno", valor: 0 }; pintarTotales(); }

// ── Clientes ──
async function abrirClientes(){
  const lst = (S.datos.clientes || []);
  const pintar = q => {
    const n = norm(q);
    const f = lst.filter(c => !n || norm(c.nombre).indexOf(n) >= 0 || norm(c.cedula).indexOf(n) >= 0).slice(0, 60);
    $("mCliLista").innerHTML = '<div class="prod" data-ced=""><div class="prod-nom">👤 Genérico</div></div>' +
      f.map(c => '<div class="prod" data-ced="' + esc(c.cedula) + '"><div style="min-width:0;"><div class="prod-nom">' + esc(c.nombre) + '</div><div class="prod-sub">' + esc(c.cedula) + (c.telefono ? " · " + esc(c.telefono) : "") + "</div></div></div>").join("") +
      (f.length ? "" : '<div class="vacio">Ningún cliente con «' + esc(q) + '». Sin internet solo se pueden usar los clientes que ya existen.</div>');
  };
  const r = await modal({
    icono: "👤", titulo: "Cliente", ancho: true,
    html: '<input class="inp" id="mCliBusca" type="search" placeholder="Nombre o cédula" autocomplete="off"><div class="lista-prod" id="mCliLista" style="max-height:50vh;"></div>',
    botones: [{ txt: "Cerrar", v: null }],
    foco: "mCliBusca",
    alAbrir: (box, cerrar) => {
      pintar("");
      $("mCliBusca").addEventListener("input", e => pintar(e.target.value));
      $("mCliLista").addEventListener("click", e => {
        const d = e.target.closest("[data-ced]"); if (!d) return;
        const ced = d.dataset.ced;
        cerrar(ced === "" ? { cedula: "", nombre: "Genérico" } : lst.find(c => String(c.cedula) === ced));
      });
    }
  });
  if (r) {
    F.cliente = { cedula: r.cedula || "", nombre: r.nombre || "Genérico", direccion: r.direccion || "", telefono: r.telefono || "" };
    pintarTotales();
    if (P) { pgPintarMetodos(); pgActualizar(); }
  }
  return r;
}

// ══ COBRAR ══
function tasaUsd(){ const t = S.tasas || {}; return t.div > 0 ? t.div : t.bcv; }   // los $ en efectivo, a tasa Divisas
function metodos(){ return (S.datos.metodos || []); }
function metodoCredito(){ const m = metodos().find(x => x.tipo === "CRED"); return m ? m.metodo : ""; }
async function abrirPago(){
  if (!F.items.length) { aviso({ icono: "🧾", titulo: "La venta está vacía", html: "Agrega al menos un producto." }); return; }
  const malas = F.items.filter(i => !(Number(i.cantidad) > 0));
  if (malas.length) { aviso({ icono: "🔢", titulo: "Falta una cantidad", html: "La línea <b>" + esc(malas[0].nombre) + "</b> no tiene cantidad. Escríbela o quita la línea con ✕." }); return; }
  const t = S.tasas || {};
  if (!(t.bcv > 0)) { aviso({ icono: "💱", titulo: "Falta la tasa", html: "Este equipo no tiene tasa BCV. Actualiza los datos con internet, o ponla en ⚙️ → Cambiar tasa." }); return; }
  if (t.fecha !== hoyTxt() && S.tasaOkHoy !== hoyTxt()) {
    const r = await modal({ icono: "💱", titulo: "¿La tasa sigue igual?",
      html: '<div class="m-txt">La tasa de este equipo es del <b>' + fechaCorta(t.fecha) + "</b>: BCV <b>Bs " + fmt(t.bcv) + "</b> · Divisas <b>Bs " + (t.div > 0 ? fmt(t.div) : "—") + "</b>.<br><br>Si hoy es otra, cámbiala antes de cobrar (pide la clave sin internet).</div>",
      botones: [{ txt: "🔒 Cambiar tasa", v: "cambiar" }, { txt: "Sí, cobrar con esa", v: "ok", cls: "green" }] });
    if (r === "cambiar") { await cambiarTasa(null); return; }
    if (r !== "ok") return;
    S.tasaOkHoy = hoyTxt();
  }
  const tot = totales(F.items, F.desc).total;
  P = { lineas: [], cred: { on: false, monto: "", editado: false }, vt: { on: false, lineas: [] }, seq: 0, verMet: false, dias: 0, total: tot };
  $("pgTotal").textContent = "$" + fmt(tot) + " BCV";
  $("pgTotalBs").innerHTML = "Bs " + fmt(r2(tot * t.bcv)) + "<br><span style=\"font-size:11px;\">a tasa BCV " + fmt(t.bcv) + "</span>";
  $("pgHint").innerHTML = "Los <b>Bs</b> van a tasa BCV <b>Bs " + fmt(t.bcv) + "</b> · los <b>$</b> a tasa Divisas <b>Bs " + fmt(tasaUsd()) + "</b>" + (t.div > 0 ? "" : " (este negocio no tiene tasa Divisas: los $ van a la BCV)") + ".";
  $("pgRef").value = ""; $("pgObs").value = "";
  $("pgForm").classList.remove("oculto"); $("pgOk").classList.add("oculto");
  $("pgCerrar").disabled = false; btnLibre($("pgGuardar"));
  const pl = (S.datos.plazosCredito || []).filter(p => p.activo && p.dias > 0);
  $("selDias").innerHTML = pl.map(p => '<option value="' + p.dias + '">' + p.dias + " días</option>").join("") + '<option value="0">Sin plazo</option>';
  P.dias = pl.length ? pl[0].dias : 0; $("selDias").value = String(P.dias);
  pgPintarMetodos(); pgPintarLineas(); pgPintarVuelto(); pgActualizar();
  $("mPago").classList.remove("oculto");
}
function cerrarPago(){ $("mPago").classList.add("oculto"); P = null; }
// Cuánto cubre / vale cada línea (OFF: la unidad es el $ BCV; los $ valen a tasa Divisas, igual que el servidor)
function pgCubre(l){
  const v = Number(l.monto) || 0, bcv = S.tasas.bcv; if (!(v > 0)) return 0;
  return l.tipo === "BS" ? v / bcv : v * tasaUsd() / bcv;
}
function pgVale(l){
  const v = Number(l.monto) || 0, bcv = S.tasas.bcv; if (!(v > 0)) return 0;
  return l.tipo === "BS" ? v / bcv : r2(v * tasaUsd() / bcv);
}
function pgCredValor(){ return P.cred.on ? r2(Number(P.cred.monto) || 0) : 0; }
function pgEstado(){
  let cub = 0, vale = 0;
  P.lineas.forEach(l => { cub += pgCubre(l); vale += pgVale(l); });
  const cred = pgCredValor(), cubT = cub + cred, N = P.total;
  const pendX = N - cubT, pend = r2(pendX);
  let vtCub = 0, vtVale = 0;
  if (P.vt.on) P.vt.lineas.forEach(v => { vtCub += pgCubre(v); vtVale += pgVale(v); });
  const quedaX = -pendX - vtCub, queda = r2(quedaX);
  const dif = r2(vale + cred - vtVale - N);
  return { cub: r2(cub), cred, cubT: r2(cubT), pend, pendX, vtCub: r2(vtCub), vtVale: r2(vtVale), queda, quedaX, vale: r2(vale), dif, hay: P.lineas.length > 0 || P.cred.on };
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
function pgPintarLineas(){
  let h = "";
  P.lineas.forEach(l => {
    const cls = l.tipo === "BS" ? "bs" : "usd";
    h += '<div class="pl ' + cls + '"><div class="pl-cab"><span>' + esc(pguDesc(metodoDe(l.metodo) || { metodo: l.metodo, tipo: l.tipo })) + '</span><button type="button" class="ico" onclick="pgQuitar(' + l.id + ')">✕</button></div>' +
      '<div class="pl-cuerpo"><span class="mon">' + (l.tipo === "BS" ? "Bs" : "$") + '</span><input class="inp" type="number" inputmode="decimal" min="0" step="any" id="pgM_' + l.id + '" placeholder="' + (l.tipo === "BS" ? "Monto en Bs" : "Monto en $") + '" value="' + esc(l.monto) + '" oninput="pgMonto(' + l.id + ',this.value)"></div>' +
      '<div class="pl-eq" id="pgE_' + l.id + '"></div></div>';
  });
  if (P.cred.on) {
    h += '<div class="pl cred"><div class="pl-cab"><span>📝 Crédito · ' + esc(F.cliente.nombre) + '</span><button type="button" class="ico" onclick="pgCredito()">✕</button></div>' +
      '<div class="pl-cuerpo"><span class="mon">$</span><input class="inp" type="number" inputmode="decimal" min="0" step="any" id="pgCred" placeholder="Monto a crédito ($ BCV)" value="' + esc(P.cred.monto) + '" oninput="P.cred.monto=this.value;P.cred.editado=true;pgActualizar()">' +
      '<button type="button" class="btn sm" onclick="P.cred.editado=false;pgActualizar();$(\'pgCred\').value=P.cred.monto;">↺ Lo que falta</button></div><div class="pl-eq" id="pgE_cred"></div></div>';
  }
  $("pgLineas").innerHTML = h;
}
function pgPintarVuelto(){
  $("pgVuelto").classList.toggle("oculto", !P.vt.on);
  if (!P.vt.on) return;
  $("pgVtMetodos").innerHTML = P.vt.lineas.length >= 2 ? "" : pgFilasMetodos("pgVtAgregar", P.vt.lineas.map(v => v.metodo), false);
  $("pgVtLineas").innerHTML = P.vt.lineas.map((v, k) => '<div class="pl vt"><div class="pl-cab"><span>💸 ' + esc(pguDesc(metodoDe(v.metodo) || { metodo: v.metodo, tipo: v.tipo })) + '</span><button type="button" class="ico" onclick="pgVtQuitar(' + k + ')">✕</button></div>' +
    '<div class="pl-cuerpo"><span class="mon">' + (v.tipo === "BS" ? "Bs" : "$") + '</span><input class="inp" type="number" inputmode="decimal" min="0" step="any" id="pgVM_' + k + '" placeholder="Vuelto en ' + (v.tipo === "BS" ? "Bs" : "$") + '" value="' + esc(v.monto) + '" oninput="P.vt.lineas[' + k + '].monto=this.value;pgActualizar()"></div><div class="pl-eq" id="pgVE_' + k + '"></div></div>').join("");
}
function pgActualizar(){
  if (!P) return;
  const bcv = S.tasas.bcv;
  if (P.cred.on && !P.cred.editado) {
    let cub = 0; P.lineas.forEach(l => cub += pgCubre(l));
    const rest = r2(P.total - cub);
    P.cred.monto = rest > 0 ? rest.toFixed(2) : "";
    const inp = $("pgCred"); if (inp && document.activeElement !== inp) inp.value = P.cred.monto;
  }
  P.lineas.forEach(l => {
    const el = $("pgE_" + l.id); if (!el) return;
    if (!(Number(l.monto) > 0)) { el.innerHTML = ""; return; }
    el.innerHTML = l.tipo === "BS"
      ? "cubre <b>$" + fmt(pgCubre(l)) + " BCV</b> (Bs " + fmt(l.monto) + " ÷ " + fmt(bcv) + ")"
      : "cubre <b>$" + fmt(pgCubre(l)) + " BCV</b> (a tasa Divisas Bs " + fmt(tasaUsd()) + " = Bs " + fmt(r2(Number(l.monto) * tasaUsd())) + ")";
  });
  const ec = $("pgE_cred"); if (ec) { const c = pgCredValor(); ec.innerHTML = c > 0 ? "queda a deber <b>$" + fmt(c) + " BCV</b>" : ""; }
  P.vt.lineas.forEach((v, k) => { const el = $("pgVE_" + k); if (el) el.innerHTML = Number(v.monto) > 0 ? "devuelve <b>$" + fmt(pgCubre(v)) + " BCV</b>" + (v.tipo === "USD" ? " (a tasa Divisas Bs " + fmt(tasaUsd()) + ")" : "") : ""; });
  const st = pgEstado();
  // Balance
  const bs = v => " · Bs " + fmt(r2(v * bcv));
  let h = "";
  if (st.hay) {
    if (st.pend > TOL) h = '<div class="bal falta">⚠️ Falta $' + fmt(st.pend) + " BCV" + bs(st.pendX) + "</div>";
    else if (st.pend < -TOL && !P.vt.on) h = '<div class="bal sobra">💰 Sobran $' + fmt(-st.pend) + " BCV" + bs(-st.pendX) + '</div><div style="text-align:center;margin-top:8px;"><button type="button" class="btn" onclick="pgVueltoAbrir()">💸 Dar vuelto</button></div>';
    else if (P.vt.on && st.pend < -TOL) {
      if (Math.abs(st.queda) <= TOL) h = '<div class="bal ok">✅ Pago exacto con vuelto</div>';
      else if (st.queda > 0) h = '<div class="bal sobra">Faltan $' + fmt(st.queda) + " BCV por devolver" + bs(st.queda) + "</div>";
      else h = '<div class="bal falta">⚠️ El vuelto pasa de lo que sobra por $' + fmt(-st.queda) + " BCV</div>";
    } else h = '<div class="bal ok">✅ Pago exacto</div>';
    if (st.pend <= TOL && Math.abs(st.dif) > 0.01 && !(st.pend < -TOL && !P.vt.on)) {
      const favor = st.dif > 0;
      h += '<div class="dif ' + (favor ? "afavor" : "encontra") + '">💹 Diferencial ' + (favor ? "a favor" : "en contra") + ": <b>$" + fmt(Math.abs(st.dif)) + " BCV</b>. Lo recibido vale $" + fmt(r2(st.vale + st.cred - st.vtVale)) + " y la venta vale $" + fmt(P.total) + ".</div>";
    }
  }
  $("pgBal").innerHTML = h;
  $("pgVtSobra").textContent = st.pend < -TOL ? "Sobran $" + fmt(-st.pend) + " BCV · Bs " + fmt(r2(-st.pendX * bcv)) : "";
  const plegar = st.hay && st.pend <= TOL && !P.verMet;
  $("pgMetodos").classList.toggle("oculto", plegar);
  $("pgMas").classList.toggle("oculto", !plegar);
  const vm = $("pgVtMetodos"); if (vm && P.vt.on) vm.classList.toggle("oculto", P.vt.lineas.length >= 2 || (P.vt.lineas.length > 0 && Math.abs(st.queda) <= TOL));
  $("pgDias").classList.toggle("oculto", !(P.cred.on && $("selDias").options.length > 1));
}
function pgAutocompletar(l){
  let otros = 0; P.lineas.forEach(x => { if (x.id !== l.id) otros += pgCubre(x); });
  if (P.cred.on && P.cred.editado) otros += pgCredValor();
  const bcv = S.tasas.bcv, falta = r2(P.total - otros);
  let v = 0;
  if (l.tipo === "BS") v = r2(r2(P.total * bcv) - otros * bcv);   // en Bs exactos: suman el total del ticket
  else v = falta > 0 ? r2(falta * bcv / tasaUsd()) : 0;
  l.monto = v > 0.004 ? v.toFixed(2) : "";
  const inp = $("pgM_" + l.id); if (inp) inp.value = l.monto;
}
function pgAgregar(i){
  const m = metodos()[i]; if (!m) return;
  const ya = P.lineas.find(l => l.metodo === m.metodo);
  if (ya) { const inp = $("pgM_" + ya.id); if (inp) { inp.focus(); inp.select(); } return; }
  if (P.lineas.length >= 3) { aviso({ icono: "💳", titulo: "Máximo 3 métodos", html: "Una venta se puede cobrar con hasta 3 métodos de pago. Quita uno con ✕ para usar otro." }); return; }
  const l = { id: ++P.seq, metodo: m.metodo, tipo: m.tipo, monto: "" };
  P.lineas.push(l);
  pgPintarMetodos(); pgPintarLineas(); pgAutocompletar(l); pgActualizar();
  setTimeout(() => { const inp = $("pgM_" + l.id); if (inp) { inp.focus(); inp.select(); } }, 30);
}
function pgQuitar(id){ P.lineas = P.lineas.filter(l => l.id !== id); pgPintarMetodos(); pgPintarLineas(); pgActualizar(); }
function pgMonto(id, v){ const l = P.lineas.find(x => x.id === id); if (l) { l.monto = v; pgActualizar(); } }
async function pgCredito(){
  if (P.cred.on) { P.cred = { on: false, monto: "", editado: false }; }
  else {
    if (!F.cliente.cedula) {
      const r = await modal({ icono: "👤", titulo: "El crédito necesita un cliente", html: '<div class="m-txt">La venta a crédito queda como cuenta por cobrar a nombre del cliente. Esta venta está a nombre de <b>Genérico</b>.<br><br>Sin internet solo se pueden usar los clientes que ya existen en el sistema.</div>',
        botones: [{ txt: "Cancelar", v: false }, { txt: "👤 Elegir cliente", v: true, cls: "green" }] });
      if (!r) return;
      const c = await abrirClientes();
      if (!c || !F.cliente.cedula) return;
    }
    P.cred = { on: true, monto: "", editado: false };
  }
  pgPintarMetodos(); pgPintarLineas(); pgActualizar();
}
function pgVueltoAbrir(){ P.vt = { on: true, lineas: [] }; pgPintarVuelto(); pgActualizar(); }
function pgVueltoCerrar(){ P.vt = { on: false, lineas: [] }; pgPintarVuelto(); pgActualizar(); }
function pgVtAgregar(i){
  const m = metodos()[i]; if (!m || P.vt.lineas.length >= 2 || P.vt.lineas.some(v => v.metodo === m.metodo)) return;
  const v = { metodo: m.metodo, tipo: m.tipo, monto: "" };
  P.vt.lineas.push(v);
  const st = pgEstado(), resto = Math.max(0, st.quedaX), bcv = S.tasas.bcv;   // sin redondear: el vuelto en Bs sale exacto
  const x = v.tipo === "BS" ? r2(resto * bcv) : r2(resto * bcv / tasaUsd());
  v.monto = x > 0.004 ? x.toFixed(2) : "";
  pgPintarVuelto(); pgActualizar();
  const k = P.vt.lineas.length - 1;
  setTimeout(() => { const inp = $("pgVM_" + k); if (inp) { inp.focus(); inp.select(); } }, 30);
}
function pgVtQuitar(k){ P.vt.lineas.splice(k, 1); pgPintarVuelto(); pgActualizar(); }

async function pgConfirmar(){
  const bcv = S.tasas.bcv, tu = tasaUsd();
  const pagos = [];
  for (const l of P.lineas) {
    const v = r2(Number(l.monto) || 0);
    if (!(v > 0)) { aviso({ icono: "💳", titulo: "Falta un monto", html: "La línea <b>" + esc(l.metodo) + "</b> no tiene monto. Escribe cuánto entra por ahí, o quítala con ✕." }); return; }
    if (l.tipo === "BS") pagos.push({ metodo: l.metodo, monto: v, tipo: "BS" });
    else pagos.push({ metodo: l.metodo, monto: v, tipo: "USD", tasaDivisas: tu, equivBCV: r2(v * tu / bcv) });
  }
  if (P.cred.on) {
    const c = pgCredValor();
    if (!F.cliente.cedula) { aviso({ icono: "👤", titulo: "Falta el cliente", html: "El crédito necesita un cliente con cédula. Elige el cliente y vuelve a guardar." }); return; }
    if (!(c > 0)) { aviso({ icono: "📝", titulo: "Falta el monto del crédito", html: "Marcaste crédito pero el monto quedó vacío. Usa <b>↺ Lo que falta</b>, escríbelo, o quita el crédito con ✕." }); return; }
    pagos.push({ metodo: metodoCredito(), monto: c, tipo: "CRED" });
  }
  if (!pagos.length) { aviso({ icono: "🧾", titulo: "No hay forma de pago", html: "Toca el método con que paga el cliente (o <b>A crédito</b> si queda a deber)." }); return; }
  const vuelto = [];
  if (P.vt.on) {
    for (const v of P.vt.lineas) {
      const x = r2(Number(v.monto) || 0);
      if (!(x > 0)) { aviso({ icono: "💸", titulo: "Falta el monto del vuelto", html: "Elegiste <b>" + esc(v.metodo) + "</b> para el vuelto pero el monto quedó vacío. Escríbelo o quita esa línea." }); return; }
      const lv = { metodo: v.metodo, tipo: v.tipo, monto: x };
      if (v.tipo === "BS") lv.tasa = r2(bcv); else lv.equivBCV = r2(x * tu / bcv);
      vuelto.push(lv);
    }
    if (!vuelto.length) { aviso({ icono: "💸", titulo: "Falta de dónde sale el vuelto", html: "Abriste el vuelto pero no elegiste de qué método sale. Elígelo, o toca <b>Quitar vuelto</b>." }); return; }
  }
  const st = pgEstado();
  const bs = v => " (Bs " + fmt(r2(v * bcv)) + ")";
  if (st.pend > TOL) {
    if (!await confirmar({ icono: "⚠️", titulo: "Falta dinero", colorOk: "naranja", ok: "Sí, guardar", html: "El pago cubre $" + fmt(st.cubT) + " de $" + fmt(P.total) + ": <b>falta $" + fmt(st.pend) + " BCV</b>" + bs(st.pendX) + ".<br><br>Si la guardas así, esa diferencia queda como diferencial cambiario en contra. Si queda a deber, toca <b>A crédito</b>.<br><br>¿Guardar igualmente?" })) return;
  } else if (st.pend < -TOL && !P.vt.on) {
    const r = await modal({ icono: "💰", titulo: "Sobra dinero", html: '<div class="m-txt">El pago cubre $' + fmt(st.cubT) + ": <b>sobran $" + fmt(-st.pend) + " BCV</b>" + bs(-st.pendX) + ".<br><br>¿Le das vuelto al cliente, o queda como diferencial cambiario a favor ($" + fmt(st.dif) + ")?</div>",
      botones: [{ txt: "💸 Dar vuelto", v: "vuelto" }, { txt: "Queda como diferencial a favor", v: "ok", cls: "green" }] });
    if (r === "vuelto") { pgVueltoAbrir(); return; }
    if (r !== "ok") return;
  } else if (P.vt.on && st.queda < -TOL) {
    if (!await confirmar({ icono: "⚠️", titulo: "El vuelto pasa de lo que sobra", colorOk: "naranja", ok: "Sí, guardar", html: "Sobraban $" + fmt(-st.pend) + " y el vuelto devuelve $" + fmt(st.vtCub) + ": <b>$" + fmt(-st.queda) + " BCV de más</b>.<br><br>Esa diferencia queda como diferencial cambiario en contra. ¿Guardar igualmente?" })) return;
  } else if (P.vt.on && st.queda > TOL) {
    if (!await confirmar({ icono: "⚠️", titulo: "Falta vuelto por dar", colorOk: "naranja", ok: "Sí, guardar", html: "Sobraban $" + fmt(-st.pend) + " y el vuelto solo devuelve $" + fmt(st.vtCub) + ": quedan <b>$" + fmt(st.queda) + " BCV</b>" + bs(st.queda) + " que se registran como diferencial a favor. ¿Guardar igualmente?" })) return;
  } else if (st.dif < -0.01) {
    if (!await confirmar({ icono: "⚠️", titulo: "Diferencial en contra", colorOk: "naranja", ok: "Sí, guardar", html: "Lo recibido vale $" + fmt(r2(st.vale + st.cred - st.vtVale)) + " y la venta vale $" + fmt(P.total) + ": <b>$" + fmt(-st.dif) + " BCV en contra</b>. ¿Guardar igualmente?" })) return;
  }
  await pgGuardar(pagos, vuelto);
}
function vendedorDeLaVenta(){
  const d = S.datos;
  const cj = { cajeroNombre: S.turno ? S.turno.cajeroNombre : ((d.cajero && d.cajero.nombre) || ""), cajeroId: S.turno ? S.turno.cajeroId : 0 };   // el cajero del turno
  if (!d.trabajoVendedores) return Object.assign({ ventaDirecta: true, vendedorNombre: "", comision: 0 }, cj);
  if (d.modoCajas !== "cajero") return Object.assign({ vendedorNombre: (d.vendedor && d.vendedor.nombre) || "", comision: Number(d.vendedor && d.vendedor.comision) || 0 }, cj);
  const v = (d.vendedores || []).find(x => String(x.id) === String(F.vend));
  if (v) return Object.assign({ vendedorId: v.id, vendedorNombre: v.nombre, comision: Number(v.comision) || 0 }, cj);
  return Object.assign({ ventaDirecta: true, vendedorNombre: "", comision: 0 }, cj);
}
async function pgGuardar(pagos, vuelto){
  const btn = $("pgGuardar");
  btnOcupado(btn, "Guardando…"); $("pgCerrar").disabled = true;
  if (!S.turno) { btnLibre(btn); $("pgCerrar").disabled = false; cerrarPago(); irA("vender"); return; }
  const t = S.tasas, ahora = new Date();
  const v = {
    id: uuid(), numero: "", creada: ahoraTxt(ahora), fecha: hoyTxt(ahora),
    numeroTicket: 0, provisional: false, turno: S.turno.id,   // el número lo pone guardarVentaNueva (apartado o provisional)
    caja: S.datos.caja, equipo: S.datos.equipo,
    tasas: { bcv: t.bcv, div: tasaUsd() },
    items: F.items.map(i => ({ tipo: i.tipo, codigo: i.codigo, nombre: i.nombre, codigoBarras: i.codigoBarras, cantidad: Number(i.cantidad), precio: i.base, iva: i.iva, manual: !!i.manual })),
    pago: Object.assign({
      pagos: pagos, vuelto: vuelto,
      referencia: $("pgRef").value.trim(), observaciones: $("pgObs").value.trim(),
      clienteCedula: F.cliente.cedula || "", clienteNombre: F.cliente.nombre || "Genérico",
      clienteDireccion: F.cliente.direccion || "", clienteTelefono: F.cliente.telefono || "",
      descuentoTipo: F.desc.tipo, descuentoValor: Number(F.desc.valor) || 0,
      diasCredito: P.cred.on ? (Number(P.dias) || 0) : 0
    }, vendedorDeLaVenta()),
    total: P.total, totalBs: r2(P.total * t.bcv),
    estado: "por_subir", intentos: 0, msg: "", avisos: [], numeroFactura: "", subidaEn: 0
  };
  try { await guardarVentaNueva(v); }
  catch (e) {
    btnLibre(btn); $("pgCerrar").disabled = false;
    aviso({ icono: "❌", titulo: "La venta NO se guardó", html: "El equipo no pudo guardarla (" + esc(e.message) + "). No entregues el ticket: vuelve a tocar <b>Guardar venta</b>. Si sigue fallando, anótala en papel y avísale al administrador." });
    return;
  }
  S.ventas.push(v); _vendidoLocal = null;
  _ventaGuardada = v;
  btnLibre(btn); $("pgCerrar").disabled = false;
  $("pgForm").classList.add("oculto"); $("pgOk").classList.remove("oculto");
  $("pgOkNum").textContent = ((S.datos.impresion || {}).nombreDoc || "Nota de Entrega") + " N° " + nroTicket(v);
  $("pgOkTxt").innerHTML = "Total Bs " + fmt(v.totalBs) + " · $" + fmt(v.total) + " BCV<br>" + (S.online !== false ? "Se registra en el sistema en un momento." : "Se registra sola en el sistema cuando vuelva el internet.") +
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
  if (window.innerWidth >= 900) $("busca").focus();
}

// ══ TICKET (mismo formato que Ventas: generarTicket) ══
function htmlTicket(v){
  const d = S.datos || {}, cfg = Object.assign({ formato: "ticket80", moneda: "BS", mostrarEquiv: true, nombreDoc: "Nota de Entrega", pieLinea1: "***Gracias por su compra***", pieLinea2: "Puede solicitar su factura en caja." }, d.impresion || {});
  const enBS = cfg.moneda !== "USD", tasa = v.tasas.bcv || 1, conv = usd => enBS ? fmt(usd * tasa) : fmt(usd), sym = enBS ? "Bs." : "$";
  const fmtT = formatoTicket(), mostrarPU = fmtT !== "58";
  const nroT = v.numeroFactura || nroTicket(v);
  const its = v.items.map(i => ({ nombre: i.nombre, cantidad: i.cantidad, base: i.precio, iva: i.iva }));
  const x = totales(its, { tipo: v.pago.descuentoTipo, valor: v.pago.descuentoValor });
  const p = v.pago, esGen = !p.clienteCedula || p.clienteNombre === "Genérico";
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
  const equiv = cfg.mostrarEquiv && enBS ? '<tr><td>Total $ BCV:</td><td style="text-align:right;">$' + fmt(x.total) + "</td></tr>" : "";
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
    '<tr><td>IVA:</td><td style="text-align:right;">' + sym + " " + conv(x.ivaR) + '</td></tr><tr style="font-size:11px;font-weight:bold;"><td>Total:</td><td style="text-align:right;">' + sym + " " + conv(x.total) + "</td></tr>" + equiv + "</table>" +
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

// ══ TURNO: el cajero entra con su PIN y dice con cuánto efectivo arranca ══
let _turnoSel = null;
const _pinFallas = {};   // id del cajero → { n, hasta }
function cajerosTurno(){
  const l = (S.datos && S.datos.cajeros) || [];
  const idCaja = Number(S.datos && S.datos.cajero && S.datos.cajero.id) || 0;
  return l.slice().sort((a, b) => (b.id === idCaja) - (a.id === idCaja) || String(a.nombre).localeCompare(String(b.nombre)));
}
function pintarTurno(){
  const box = $("turnoCuerpo"); if (!box || !S.datos) return;
  const l = cajerosTurno(), idCaja = Number(S.datos.cajero && S.datos.cajero.id) || 0;
  if (!l.length || !l.some(c => c.pin)) {
    box.innerHTML = '<div class="m-txt" style="line-height:1.55;">' + (l.length ? "Ningún cajero tiene <b>PIN</b> todavía." : "No hay cajeros activos.") +
      '<br><br>En el sistema: <b>Configuración → Cajas y vendedores</b>' + (l.length ? ", toca <b>🔢 PIN</b> en cada cajero" : ", crea los cajeros y ponles su <b>🔢 PIN</b>") +
      '. Después, aquí con internet, toca <b>🔄 Actualizar datos</b>.</div><div style="margin-top:14px;"><button type="button" class="btn green" onclick="actualizarDatos(this)">🔄 Actualizar datos</button></div>';
    return;
  }
  box.innerHTML = '<div class="m-txt" style="color:var(--text-dim);font-size:13px;">¿Quién está en la caja?</div><div class="cj-grid">' +
    l.map(c => '<button type="button" class="cj-btn' + (_turnoSel === c.id ? " sel" : "") + '"' + (c.pin ? "" : " disabled") + ' onclick="elegirCajero(' + c.id + ')">' + esc(c.nombre) +
      "<small>" + (c.pin ? (c.id === idCaja ? "Cajero de esta caja" : "&nbsp;") : "Sin PIN") + "</small></button>").join("") + "</div>" +
    '<div id="turnoForm" class="' + (_turnoSel ? "" : "oculto") + '">' +
      '<label class="lbl" for="tPin">PIN de <span id="tPinNom"></span></label><input class="inp" id="tPin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="4 a 6 números">' +
      '<div class="cie-tit">Fondo de caja (efectivo con que arranca la gaveta)</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"><div><label class="lbl" for="tFondoBs" style="margin-top:0;">Efectivo Bs</label><input class="inp" id="tFondoBs" type="number" inputmode="decimal" min="0" step="any" placeholder="Bs (vacío = 0)"></div>' +
      '<div><label class="lbl" for="tFondoUsd" style="margin-top:0;">Efectivo $</label><input class="inp" id="tFondoUsd" type="number" inputmode="decimal" min="0" step="any" placeholder="$ (vacío = 0)"></div></div>' +
      '<div class="m-btns"><button type="button" class="btn green" id="btnAbrirTurno" onclick="abrirTurno(this)">🔓 Abrir turno</button></div>' +
    "</div>";
  if (_turnoSel) { const c = l.find(x => x.id === _turnoSel); $("tPinNom").textContent = c ? c.nombre : ""; }
  $("tPin") && $("tPin").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("tFondoBs").focus(); } });
}
function elegirCajero(id){
  _turnoSel = id; pintarTurno();
  setTimeout(() => { const i = $("tPin"); if (i) i.focus(); }, 30);
}
async function abrirTurno(btn){
  const c = cajerosTurno().find(x => x.id === _turnoSel);
  if (!c || !c.pin) return;
  const f = _pinFallas[c.id] || { n: 0, hasta: 0 };
  if (Date.now() < f.hasta) { aviso({ icono: "⏳", titulo: "Espera un momento", html: "Hubo 5 PIN equivocados para <b>" + esc(c.nombre) + "</b>. Espera un minuto y vuelve a intentar." }); return; }
  const pin = $("tPin").value.trim();
  if (!/^\d{4,6}$/.test(pin)) { aviso({ icono: "🔢", titulo: "Falta el PIN", html: "Escribe tu PIN de 4 a 6 números." }); return; }
  btnOcupado(btn, "Revisando…");
  const h = await sha256hex(c.pin.salt + pin);
  btnLibre(btn);
  if (h !== c.pin.hash) {
    f.n++; if (f.n >= 5) { f.hasta = Date.now() + 60000; f.n = 0; }
    _pinFallas[c.id] = f;
    $("tPin").value = "";
    aviso({ icono: "🔢", titulo: "PIN incorrecto", html: "Ese no es el PIN de <b>" + esc(c.nombre) + "</b>. Vuelve a intentar." + (f.hasta > Date.now() ? "<br><br>Fueron 5 intentos: espera un minuto." : "") });
    return;
  }
  _pinFallas[c.id] = { n: 0, hasta: 0 };
  const ahora = new Date();
  S.turno = { id: "T-" + (S.datos.equipo || "EQ") + "-" + ahoraTxt(ahora).replace(/\D/g, "").slice(0, 12) + "-" + uuid().slice(0, 4),
              cajeroId: c.id, cajeroNombre: c.nombre, apertura: ahoraTxt(ahora),
              fondoBs: r2(Number($("tFondoBs").value) || 0), fondoUsd: r2(Number($("tFondoUsd").value) || 0) };
  await kvSet("turno", S.turno);
  _turnoSel = null;
  toast("✅ Turno abierto: " + c.nombre);
  pintarCabecera();
  irA("vender");
  numerosAlDia();   // numeros.js: con internet, aparta los números de factura de este turno
}

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
    totalUsd += Number(v.total) || 0; totalBs += Number(v.totalBs) || 0;
    const sinDesc = totales(v.items.map(i => ({ cantidad: i.cantidad, base: i.precio, iva: i.iva })), { tipo: "ninguno" }).total;
    desc += Math.max(0, sinDesc - (Number(v.total) || 0));
    if (v.estado !== "subida") sinSubir++;
    (v.pago.pagos || []).forEach(p => { if (p.tipo === "CRED") credito += Number(p.monto) || 0; else sumar(p, Number(p.monto) || 0); });
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
    '<div class="m-btns"><button type="button" class="btn" onclick="irA(\'vender\')">Volver a vender</button><button type="button" class="btn naranja" id="btnCerrarTurno" onclick="cerrarTurno(this)">🔒 Cerrar turno</button></div>';
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
    obs: $("cObs").value.trim(), caja: S.datos.caja, equipo: S.datos.equipo, estado: "por_subir", msg: "" }, R);
  c.metodos = R.metodos.map(m => ({ metodo: m.metodo, tipo: m.tipo, desc: m.desc, neto: m.neto, efectivo: m.efectivo }));
  S.cierres.push(c);
  try { await kvSet("cierres", S.cierres); await kvSet("turno", null); }
  catch (e) { btnLibre(btn); S.cierres.pop(); aviso({ icono: "❌", titulo: "No se cerró el turno", html: "El equipo no pudo guardar el cierre (" + esc(e.message) + "). Vuelve a intentar." }); return; }
  S.turno = null;
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
  if (!cola.length) { await subirCierres(); await numerosAlDia(); if (manual) await actualizarDatos(null, true); return { subidas: 0 }; }
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
  if (!cortado) { await subirCierres(); await numerosAlDia(); }
  if (subidas && S.online) await actualizarDatos(null, true);   // existencias al día
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
  const sumBs = deHoy.reduce((s, v) => s + (Number(v.totalBs) || 0), 0), sumUsd = deHoy.reduce((s, v) => s + (Number(v.total) || 0), 0);
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
  deHoy.forEach(v => { const k = v.pago.cajeroNombre || "Sin cajero"; const x = porCj[k] = porCj[k] || { n: 0, bs: 0, usd: 0 }; x.n++; x.bs += Number(v.totalBs) || 0; x.usd += Number(v.total) || 0; });
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
    const items = v.items.map(i => "<tr><td>" + fmtCant(i.cantidad) + " × " + esc(i.nombre) + (i.manual ? " ✏️" : "") + '</td><td class="r">$' + fmt(i.precio * (1 + i.iva / 100) * i.cantidad) + "</td></tr>").join("");
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
      '<div class="m">Bs ' + fmt(v.totalBs) + '<div style="font-size:11px;color:var(--text-dim);font-weight:600;">$' + fmt(v.total) + "</div></div></div>" +
      '<div class="vt-det">' + msg + "<table>" + items + "</table><table>" + pagos + "</table>" +
      '<div style="font-size:12px;color:var(--text-dim);">Tasa BCV Bs ' + fmt(v.tasas.bcv) + (v.tasas.div ? " · Divisas Bs " + fmt(v.tasas.div) : "") + (p.descuentoTipo !== "ninguno" && p.descuentoValor ? " · descuento " + (p.descuentoTipo === "pct" ? fmt(p.descuentoValor) + " %" : "$" + fmt(p.descuentoValor)) : "") + (p.referencia ? " · Ref: " + esc(p.referencia) : "") + "</div>" +
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
    "<span>Productos</span><b>" + (d.productos || []).length + "</b><span>Clientes</span><b>" + (d.clientes || []).length + "</b>" +
    "<span>Clave sin internet</span><b>" + (d.claveSinInternet ? "✅ puesta" : "⚠️ no puesta") + "</b>" +
    "<span>Números de factura</span><b>" + numerosTexto() + "</b>";
  const u = (S.ses && S.ses.usuario) || {};
  $("infoSesion").innerHTML = "<span>Usuario</span><b>" + esc(u.nombre || u.usuario || "—") + (u.usuario ? " · " + esc(u.usuario) : "") + "</b>" +
    "<span>Desde</span><b>" + (S.ses && S.ses.desde ? fechaCorta(hoyTxt(new Date(S.ses.desde))) + " " + pad(new Date(S.ses.desde).getHours()) + ":" + pad(new Date(S.ses.desde).getMinutes()) : "—") + "</b>";
  $("infoTasas").innerHTML = "<span>BCV</span><b>Bs " + fmt(t.bcv) + "</b><span>Divisas ($ en efectivo)</span><b>" + (t.div > 0 ? "Bs " + fmt(t.div) : "—") + "</b><span>De</span><b>" + fechaCorta(t.fecha) + (t.origen === "manual" ? " (puesta a mano)" : " (del sistema)") + "</b>";
  $("chkDosCopias").checked = !!S.pref.dosCopias; $("chkClaro").checked = !!S.pref.claro; $("selTamTicket").value = S.pref.tamTicket || "auto";
}
async function guardarPref(){
  S.pref.dosCopias = $("chkDosCopias").checked; S.pref.claro = $("chkClaro").checked; S.pref.tamTicket = $("selTamTicket").value;
  aplicarTema();
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
  if (F.items.length || P || S.sincronizando || document.querySelector(".mfondo:not(#mPago)")) return false;
  try { sessionStorage.setItem("cm_caja_web_recargada", _verNueva); } catch (e) {}
  location.replace(location.pathname + "?v=" + encodeURIComponent(_verNueva));
  return true;
}
async function cambiarTasa(btn){
  if (!await pedirClave("Cambiar tasa", "La tasa cambia lo que se cobra en Bs. Escribe la clave sin internet:")) return;
  const t = S.tasas || {};
  const r = await modal({
    icono: "💱", titulo: "Tasas para cobrar sin internet",
    html: '<div class="m-txt" style="font-size:13px;color:var(--text-dim);">Ahora: BCV Bs ' + fmt(t.bcv) + " · Divisas Bs " + (t.div > 0 ? fmt(t.div) : "—") + ". Cuando vuelva el internet, el equipo toma las del sistema.</div>" +
      '<label class="lbl">Tasa BCV (Bs por $)</label><input class="inp" id="tBcv" type="number" inputmode="decimal" min="0" step="any" placeholder="Bs ' + fmt(t.bcv) + '">' +
      '<label class="lbl">Tasa Divisas — los $ en efectivo (Bs por $)</label><input class="inp" id="tDiv" type="number" inputmode="decimal" min="0" step="any" placeholder="' + (t.div > 0 ? "Bs " + fmt(t.div) : "Opcional") + '"><div class="m-err" id="tErr"></div>',
    botones: [{ txt: "Cancelar", v: false }, { txt: "✅ Guardar", v: true, cls: "green" }],
    foco: "tBcv",
    antes: (v) => {
      if (!v) return true;
      const b = $("tBcv").value === "" ? t.bcv : Number($("tBcv").value), dv = $("tDiv").value === "" ? t.div : Number($("tDiv").value);
      if (!(b > 0)) { $("tErr").textContent = "Escribe la tasa BCV."; return false; }
      if (t.bcv > 0 && (b > t.bcv * 1.5 || b < t.bcv * 0.6)) { $("tErr").textContent = "La tasa BCV cambia demasiado (más de 50 %). Revisa el número."; return false; }
      if (dv && dv < b * 0.9) { $("tErr").textContent = "La tasa Divisas no puede quedar por debajo de la BCV."; return false; }
      S.tasas = { bcv: b, div: dv || 0, fecha: hoyTxt(), origen: "manual" };
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
    fondo.innerHTML = '<div class="modal' + (o.ancho ? " ancho" : "") + '">' + (o.icono ? '<div class="m-ico">' + o.icono + "</div>" : "") +
      '<div class="m-tit">' + esc(o.titulo || "") + "</div>" + (o.html || "") +
      '<div class="m-btns">' + (o.botones || [{ txt: "Entendido", v: true, cls: "green" }]).map((b, k) =>
        '<button type="button" class="btn ' + (b.cls || "") + '" data-k="' + k + '"' + (b.v === true ? ' data-v="ok"' : "") + ">" + b.txt + "</button>").join("") + "</div></div>";
    document.body.appendChild(fondo);
    let hecho = false;
    const cerrar = v => { if (hecho) return; hecho = true; fondo.remove(); resolve(v); };
    const bots = o.botones || [{ txt: "Entendido", v: true, cls: "green" }];
    fondo.querySelectorAll(".m-btns .btn").forEach(el => el.addEventListener("click", async () => {
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
    if (o.alAbrir) o.alAbrir(fondo, cerrar);
    setTimeout(() => {   // si ya escribieron en otro campo del modal, no se les mueve el cursor
      if (fondo.contains(document.activeElement)) return;
      const f = o.foco ? $(o.foco) : fondo.querySelector('.m-btns .btn[data-v="ok"]') || fondo.querySelector(".m-btns .btn");
      if (f) f.focus();
    }, 40);
  });
}
function aviso(o){ return modal({ icono: o.icono || "ℹ️", titulo: o.titulo, html: '<div class="m-txt">' + (o.html || "") + "</div>", botones: [{ txt: "Entendido", v: true, cls: "green" }] }); }
function confirmar(o){
  return modal({ icono: o.icono || "❓", titulo: o.titulo, html: '<div class="m-txt">' + (o.html || "") + "</div>",
    botones: [{ txt: o.cancel || "Cancelar", v: false }, { txt: o.ok || "Aceptar", v: true, cls: o.colorOk || "green" }] });
}
let _toastT = null;
function toast(t){ const el = $("toast"); el.textContent = t; el.classList.add("on"); clearTimeout(_toastT); _toastT = setTimeout(() => el.classList.remove("on"), 1800); }
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
    const sel = document.querySelector("#listaProd .prod.sel");   // Enter con un producto marcado: lo agrega
    if (sel) { e.preventDefault(); agregarDeLista(Number(sel.dataset.k)); }
    return;
  }
  if (e.key.length === 1 && e.key !== " ") { e.preventDefault(); b.focus(); b.value += e.key; buscar(); }
});
// Ningún campo numérico cambia con la rueda del ratón
document.addEventListener("wheel", e => { const t = e.target; if (t && t.type === "number" && document.activeElement === t) t.blur(); }, { passive: true });
// Antes de cerrar la pestaña: aviso si hay una venta a medias
window.addEventListener("beforeunload", e => { if (F.items.length || P) { e.preventDefault(); e.returnValue = ""; } });
