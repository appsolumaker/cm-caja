"use strict";
// ══════════════════════════════════════════════════════════════
//  ÓRDENES · ControlMaster — la página de los vendedores (Etapa 3)
//  <cliente>.micontrolmaster.com/ordenes · habla con el sistema por /ordenes/api (acciones "cj_ov_…").
//  · La primera vez: usuario y clave del sistema, y el vendedor crea su PIN (4 números).
//    Después entra con el PIN (24 horas). La sesión del PIN solo sirve para esta página.
//  · La orden se arma aunque no haya señal: queda "⏳ Por enviar" y se manda sola cuando vuelva.
//    Cada orden lleva una llave (APP-…): si el teléfono la manda dos veces, el sistema no la repite.
//  · Mis órdenes: ABIERTA (se edita o anula) · TOMADA (en una caja) · FACTURADA · ANULADA.
// ══════════════════════════════════════════════════════════════
const OV_VER = "1.2 · 5-11-2026";
const $ = id => document.getElementById(id);
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
const r3 = v => Math.round((Number(v) || 0) * 1000) / 1000;
function fmt(v){ const n = Number(v); if (isNaN(n)) return "0,00"; try { return n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch (e) { return n.toFixed(2); } }
function fmtCant(v){ const n = Number(v); if (isNaN(n)) return "0"; return n % 1 === 0 ? String(Math.round(n)) : n.toLocaleString("es-VE", { maximumFractionDigits: 3 }); }
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const dig = s => String(s == null ? "" : s).replace(/\D/g, "");
const pad = n => String(n).padStart(2, "0");
function ahoraTxt(){ const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
function llave(){ const a = new Uint8Array(9); try { crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < 9; i++) a[i] = Math.floor(Math.random() * 256); } return "APP-" + Date.now().toString(36) + "-" + Array.from(a, b => b.toString(16).padStart(2, "0")).join(""); }

// ── Estado ──
const OV = { tel: "", ses: null, quien: null, d: null, pend: [], vista: "nueva", online: null, cat: "", enviando: false, sinInternet: false, pref: { claro: true } };
let O = nuevaOrden();   // la orden que se está armando (o editando)
function nuevaOrden(){ return { id: "", idLocal: "", cliente: null, vendedorId: 0, moneda: "bcv", items: [], dlv: { tipo: "delivery", monto: 0 }, notas: "", clave: "", seq: 0, reservaPropia: {}, editPend: "" }; }

// ── Guardado en el teléfono (IndexedDB) ──
let _db = null;
function dbAbrir(){ return new Promise((ok, mal) => { const r = indexedDB.open("cm_ordenes_web", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => { _db = r.result; ok(); }; r.onerror = () => mal(r.error); }); }
function kv(modo, fn){ return new Promise((ok, mal) => { const t = _db.transaction("kv", modo), s = t.objectStore("kv"), q = fn(s); t.oncomplete = () => ok(q && q.result); t.onerror = () => mal(t.error); }); }
const kvGet = k => kv("readonly", s => s.get(k));
const kvSet = (k, v) => kv("readwrite", s => s.put(v, k));
const kvDel = k => kv("readwrite", s => s.delete(k));

// ── Hablar con el sistema ──
const API = new URL("api", location.href.split("#")[0].split("?")[0].replace(/[^/]*$/, "")).href;
function ErrRed(m){ const e = new Error(m); e.red = true; return e; }
async function api(accion, extra, ms){
  const cuerpo = Object.assign({ accion: accion }, extra || {});
  if (OV.ses && OV.ses.token && cuerpo.sesion == null) cuerpo.sesion = OV.ses.token;
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), ms || 60000);
  let r;
  try { r = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(cuerpo), signal: ctl.signal, cache: "no-store" }); }
  catch (e) { clearTimeout(to); enLinea(false); throw ErrRed(e && e.name === "AbortError" ? "El sistema tardó demasiado en responder." : "No hay conexión con el sistema."); }
  clearTimeout(to); enLinea(true);
  let res; try { res = JSON.parse(await r.text()); } catch (e) { throw new Error("El sistema respondió algo que no se entiende."); }
  if (res && res.codigo === "RED") { enLinea(false); throw ErrRed(res.msg || "El sistema no respondió."); }
  if (res && res.codigo === "SESION" && accion !== "cj_ov_pin") sesionVencida();
  return res;
}
function enLinea(v){ if (OV.online !== v) { OV.online = v; pintarEstado(); } }
const hayRed = () => navigator.onLine !== false;              // se intenta siempre que el teléfono tenga red (si el sistema no responde, se reintenta después)
const conSenal = () => OV.online !== false && navigator.onLine !== false;   // lo que muestra la barra de arriba
const sesionOk = () => !!(OV.ses && OV.ses.token && OV.ses.expira > Date.now());

// ══ ARRANQUE ══
async function arrancar(){
  $("verTxt").textContent = "Órdenes · versión " + OV_VER;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  try { await dbAbrir(); } catch (e) { pantalla("vEntrar"); $("enTxt").textContent = "Este navegador no deja guardar datos (¿ventana de incógnito?). Ábrelo en una ventana normal."; return; }
  OV.tel = (await kvGet("tel")) || "";
  OV.quien = (await kvGet("quien")) || null;
  OV.ses = (await kvGet("ses")) || null;
  OV.d = (await kvGet("datos")) || null;
  OV.pend = (await kvGet("pend")) || [];
  OV.pref = Object.assign(OV.pref, (await kvGet("pref")) || {});
  const b = await kvGet("borrador"); if (b && b.items) O = Object.assign(nuevaOrden(), b);
  aplicarTema();
  armarTeclado("pnTec", teclaPinNuevo); armarTeclado("piTec", teclaPin);
  // Abierta desde el menú del sistema (tarjeta Órdenes): #pase=… → entra con ese mismo usuario
  const mp = location.hash.match(/pase=([A-Za-z0-9]+)/);
  if (mp) {
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
    let r = null;
    try { r = await api("cj_ov_canje", { pase: mp[1] }, 30000); } catch (e) { r = null; }
    if (r && r.ok) { registrarEventos(); await trasEntrar(r); return; }
    if (r && r.msg) await aviso({ icono: "🔒", titulo: "No se pudo entrar desde el sistema", html: esc(r.msg) });
  }
  registrarEventos();
  continuar();
}
function registrarEventos(){
  window.addEventListener("online", () => { enLinea(true); enviarPendientes(); });
  window.addEventListener("offline", () => enLinea(false));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) enviarPendientes(); });
  setInterval(() => enviarPendientes(), 60000);
  setInterval(() => { if (sesionOk() && hayRed()) actualizarDatos(false); }, 20 * 60000);
  document.addEventListener("wheel", e => { const t = e.target; if (t && t.type === "number" && document.activeElement === t) t.blur(); }, { passive: true });
}
// ¿Qué pantalla toca?
async function continuar(){
  if (sesionOk() && OV.d) { entrarApp(); actualizarDatos(false); enviarPendientes(); return; }
  if (sesionOk()) { const ok = await actualizarDatos(false); if (ok) { entrarApp(); enviarPendientes(); return; } }
  if (OV.tel && OV.quien) { mostrarPin(); return; }
  mostrarEntrar();
}
function pantalla(id){
  ["vEntrar", "vPinNuevo", "vPin"].forEach(x => $(x).classList.toggle("oculto", x !== id));
  const app = id === "app";
  ["tabs", "main", "barra", "pill", "btnMenu"].forEach(x => $(x).classList.toggle("oculto", !app));
  if (!app) $("bandas").innerHTML = "";
}
function mostrarEntrar(){
  pantalla("vEntrar");
  $("enOffline").classList.toggle("oculto", !(OV.d && OV.quien));
  setTimeout(() => $("enUsu").focus(), 50);
}
function mostrarPin(){
  pantalla("vPin"); _pin = "";
  $("piHola").textContent = "Hola, " + ((OV.quien && OV.quien.nombre) || "") + " 👋";
  $("piErr").textContent = ""; pintarDots("piDots", "");
  $("piOffline").classList.toggle("oculto", !(OV.d && !hayRed()));
}

// ── Usuario y clave ──
async function entrarUsuario(){
  const u = $("enUsu").value.trim(), c = $("enCla").value, b = $("btnEntrar");
  if (!u || !c) { aviso({ icono: "👤", titulo: "Faltan datos", html: "Escribe tu usuario y tu clave." }); return; }
  btnOcupado(b, "Entrando…");
  let r;
  try { r = await api("cj_ov_login", { usuario: u, clave: c }, 45000); }
  catch (e) { btnLibre(b); aviso({ icono: "📡", titulo: "Sin conexión", html: esc(e.message) + "<br><br>Para entrar la primera vez hace falta internet." + (OV.d && OV.quien ? " Puedes tocar <b>📝 Seguir sin internet</b> y armar órdenes: se envían cuando vuelva." : "") }); return; }
  btnLibre(b);
  if (!r || !r.ok) { aviso({ icono: "🔒", titulo: "No se pudo entrar", html: esc((r && r.msg) || "Usuario o clave incorrectos.") }); return; }
  $("enCla").value = "";
  await trasEntrar(r);
}
// Entró con usuario y clave, o con el pase del menú del sistema (tarjeta Órdenes)
async function trasEntrar(r){
  if (OV.quien && OV.quien.usuario && String(OV.quien.usuario).toLowerCase() !== String(r.usuario.usuario).toLowerCase()) {
    // Otro usuario en este teléfono: lo del anterior no se mezcla con lo suyo
    if (OV.pend.length && !await confirmar({ icono: "⚠️", titulo: "Otro usuario", colorOk: "red", ok: "Borrarlas y seguir",
      html: "En este teléfono hay <b>" + OV.pend.length + "</b> orden(es) por enviar de <b>" + esc(OV.quien.nombre) + "</b>. Si entras con otro usuario se borran.<br><br>Para no perderlas, que entre " + esc(OV.quien.nombre) + " y las envíe primero." })) {
      try { await api("cj_ov_salir", { sesion: r.token }, 15000); } catch (e) {}
      if (OV.tel && OV.quien) mostrarPin(); else mostrarEntrar();
      return;
    }
    OV.pend = []; OV.d = null; OV.tel = ""; O = nuevaOrden();
    await kvSet("pend", []); await kvDel("datos"); await kvDel("tel"); await kvDel("borrador");
  }
  OV.ses = { token: r.token, expira: Date.now() + 12 * 3600e3 - 60000 }; await kvSet("ses", OV.ses);
  OV.quien = { usuario: r.usuario.usuario, nombre: (r.vendedor && r.vendedor.nombre) || r.usuario.nombre || r.usuario.usuario }; await kvSet("quien", OV.quien);
  if (r.conPin && !OV.tel) { _pinA = ""; _pin = ""; pantalla("vPinNuevo"); $("pnTit").textContent = "Crea tu PIN"; $("pnTxt").textContent = "4 números que solo tú sepas. Desde ahora entras en este teléfono solo con el PIN."; pintarDots("pnDots", ""); $("pnErr").textContent = ""; return; }
  if (!r.conPin) { OV.tel = ""; await kvDel("tel"); }   // admin sin vendedor: entra con usuario y clave cada vez
  if (await actualizarDatos(true)) { entrarApp(); enviarPendientes(); }
}

// ── PIN (teclado grande) ──
let _pin = "", _pinA = "";
function armarTeclado(id, fn){
  $(id).innerHTML = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map(k => k ? '<button type="button" class="' + (k === "⌫" ? "t-x" : "") + '" data-k="' + k + '">' + k + "</button>" : "<span></span>").join("");
  $(id).querySelectorAll("button").forEach(bt => bt.addEventListener("click", () => fn(bt.dataset.k)));
}
function pintarDots(id, v){ $(id).querySelectorAll("span").forEach((s, i) => s.classList.toggle("on", i < v.length)); }
async function teclaPinNuevo(k){
  if (k === "⌫") _pin = _pin.slice(0, -1); else if (_pin.length < 4) _pin += k;
  pintarDots("pnDots", _pin); $("pnErr").textContent = "";
  if (_pin.length < 4) return;
  if (!_pinA) { _pinA = _pin; _pin = ""; setTimeout(() => { pintarDots("pnDots", ""); $("pnTit").textContent = "Repite tu PIN"; $("pnTxt").textContent = "Escríbelo otra vez para confirmarlo."; }, 180); return; }
  if (_pin !== _pinA) { _pinA = ""; _pin = ""; pintarDots("pnDots", ""); $("pnTit").textContent = "Crea tu PIN"; $("pnErr").textContent = "No coinciden. Escríbelo de nuevo."; return; }
  let r;
  try { r = await api("cj_ov_pin", { pin: _pin, tel: OV.tel }, 30000); }
  catch (e) { _pin = ""; _pinA = ""; pintarDots("pnDots", ""); $("pnErr").textContent = e.message + " Vuelve a intentar."; return; }
  if (!r || !r.ok) { _pin = ""; _pinA = ""; pintarDots("pnDots", ""); $("pnTit").textContent = "Crea tu PIN"; $("pnErr").textContent = (r && r.msg) || "No se pudo crear el PIN."; if (r && r.codigo === "SESION") mostrarEntrar(); return; }
  OV.tel = r.tel; await kvSet("tel", OV.tel);
  OV.quien = { usuario: OV.quien.usuario, nombre: (r.vendedor && r.vendedor.nombre) || r.nombre }; await kvSet("quien", OV.quien);
  _pin = ""; _pinA = "";
  toast("✅ PIN creado");
  if (await actualizarDatos(true)) { entrarApp(); enviarPendientes(); }
}
let _pinOcupado = false;
async function teclaPin(k){
  if (_pinOcupado) return;
  if (k === "⌫") _pin = _pin.slice(0, -1); else if (_pin.length < 4) _pin += k;
  pintarDots("piDots", _pin); $("piErr").textContent = "";
  if (_pin.length < 4) return;
  _pinOcupado = true; $("piErr").innerHTML = '<span class="sp"></span>Entrando…';
  let r;
  try { r = await api("cj_ov_entrar", { tel: OV.tel, pin: _pin }, 30000); }
  catch (e) {
    _pinOcupado = false; _pin = ""; pintarDots("piDots", "");
    $("piErr").textContent = "No hay conexión con el sistema." + (OV.d ? " Puedes seguir sin internet: las órdenes se envían cuando vuelva." : "");
    $("piOffline").classList.toggle("oculto", !OV.d);
    return;
  }
  _pinOcupado = false; _pin = ""; pintarDots("piDots", "");
  if (!r || !r.ok) {
    if (r && r.codigo === "TEL") { OV.tel = ""; await kvDel("tel"); await aviso({ icono: "🔒", titulo: "Entra con tu usuario y clave", html: esc(r.msg) }); mostrarEntrar(); return; }
    $("piErr").textContent = (r && r.msg) || "No se pudo entrar.";
    return;
  }
  OV.ses = { token: r.token, expira: Date.now() + (Number(r.horas) || 24) * 3600e3 - 60000 }; await kvSet("ses", OV.ses);
  OV.sinInternet = false;
  if (OV._volver) { const f = OV._volver; OV._volver = null; entrarApp(); f(); return; }
  if (await actualizarDatos(!OV.d)) { entrarApp(); enviarPendientes(); }
}
async function olvidePin(){
  const ok = await confirmar({ icono: "🔢", titulo: "Olvidé mi PIN", ok: "Entrar con usuario y clave", html: "Entra con tu usuario y clave del sistema y crea un PIN nuevo. Las órdenes que tengas guardadas en este teléfono no se pierden." });
  if (!ok) return;
  try { if (hayRed()) await api("cj_ov_salir", { tel: OV.tel, olvidar: true }, 15000); } catch (e) {}
  OV.tel = ""; await kvDel("tel");
  mostrarEntrar();
}
function seguirSinInternet(){ OV.sinInternet = true; entrarApp(); }
// La sesión venció mientras se trabajaba: el PIN (o usuario y clave) otra vez, sin perder nada
function sesionVencida(){
  OV.ses = null; kvDel("ses").catch(() => {});
  pintarEstado();
}
async function pedirEntrada(luego){
  if (OV.tel && OV.quien) { OV._volver = luego || null; mostrarPin(); }
  else mostrarEntrar();
}
async function salir(){
  const ok = await confirmar({ icono: "🚪", titulo: "Salir", ok: "Salir", html: "La próxima vez entras con tu PIN." + (OV.pend.length ? "<br><br>Tienes <b>" + OV.pend.length + "</b> orden(es) por enviar: quedan guardadas en el teléfono y se envían cuando vuelvas a entrar." : "") });
  if (!ok) return;
  try { if (hayRed() && OV.ses) await api("cj_ov_salir", { sesion: OV.ses.token }, 15000); } catch (e) {}
  OV.ses = null; await kvDel("ses");
  if (OV.tel) mostrarPin(); else mostrarEntrar();
}

// ── Datos del sistema ──
async function actualizarDatos(conAviso){
  if (!sesionOk()) return false;
  let r;
  try { r = await api("cj_ov_datos", {}, 90000); }
  catch (e) { if (conAviso) aviso({ icono: "📡", titulo: "No se pudieron traer los datos", html: esc(e.message) + (OV.d ? "<br><br>Puedes seguir con los datos que ya tiene el teléfono." : "") }); return !!OV.d; }
  if (!r || !r.ok) {
    if (r && r.codigo === "SESION") { if (conAviso) pedirEntrada(); return false; }
    await aviso({ icono: "⛔", titulo: "No se pudieron traer los datos", html: esc((r && r.msg) || "") });
    if (r && (r.codigo === "SIN_VINCULO" || r.codigo === "VENDEDOR_INACTIVO" || r.codigo === "USUARIO")) { OV.ses = null; await kvDel("ses"); mostrarEntrar(); }
    return false;
  }
  r.descargadoEn = Date.now();
  OV.d = r; await kvSet("datos", r);
  if (conAviso === true && OV.vista) toast("✅ Datos al día");
  if (!$("main").classList.contains("oculto")) pintarTodo();
  return true;
}

// ══ LA APP ══
function entrarApp(){
  pantalla("app");
  if (!OV.d) { mostrarEntrar(); return; }
  if (OV.pref.claro !== false) document.body.classList.add("light");
  if (!O.idLocal) O.idLocal = llave();
  pintarTodo();
  irA(OV.vista || "nueva");
}
function pintarTodo(){ pintarCabecera(); pintarNueva(); pintarMis(); pintarEstado(); }
function pintarCabecera(){
  const d = OV.d || {};
  $("tbTit").textContent = "📋 " + (d.negocio || "Órdenes");
  $("menuInfo").innerHTML = "<b>" + esc(d.negocio || "") + "</b><br>" + esc((OV.quien && OV.quien.nombre) || "") + (d.vendedor ? " · vendedor" : d.puedeElegirVendedor ? " · administrador" : "") +
    "<br>Datos del " + (d.descargadoEn ? new Date(d.descargadoEn).toLocaleString("es-VE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—") + " · versión " + OV_VER;
}
function irA(v){
  OV.vista = v;
  $("vNueva").classList.toggle("on", v === "nueva"); $("vMis").classList.toggle("on", v === "mis");
  $("tabNueva").classList.toggle("on", v === "nueva"); $("tabMis").classList.toggle("on", v === "mis");
  $("barra").classList.toggle("oculto", v !== "nueva" || $("main").classList.contains("oculto"));
  if (v === "mis") { pintarMis(); if (sesionOk() && hayRed()) refrescarLista(null); }
  $("main").scrollTop = 0;
}
function pintarEstado(){
  const p = $("pill"); if (!p) return;
  const n = OV.pend.length, mal = OV.pend.filter(x => x.estado === "error").length;
  p.classList.remove("on", "off", "pend");
  const sen = conSenal();
  p.classList.add(sen ? "on" : "off");
  if (n) p.classList.add("pend");
  $("pillTxt").textContent = (sen ? "" : "Sin señal") + (n ? (sen ? "" : " · ") + (OV.enviando ? "📤 " : "⏳ ") + n : (sen ? "Al día" : ""));
  $("cntPend").textContent = n ? String(n) : "";
  // Avisos arriba
  let h = "";
  if (n && !sesionOk() && OV.tel) h += '<div class="banda amb">⏳ Tienes ' + n + " orden(es) por enviar. " + (hayRed() ? 'Escribe tu PIN para enviarlas.<button type="button" class="btn-m green" onclick="pedirEntrada(enviarPendientes)">🔢 PIN</button>' : "Se envían cuando vuelva la señal.") + "</div>";
  if (mal) h += '<div class="banda amb">⚠️ ' + mal + " orden(es) no se pudieron enviar: revísalas en 📋 Mis órdenes.</div>";
  if (!$("main").classList.contains("oculto")) $("bandas").innerHTML = h;
}

// ── Menú y tema ──
function abrirMenu(){ $("menuFondo").classList.add("visible"); $("menu").classList.add("visible"); }
function cerrarMenu(){ $("menuFondo").classList.remove("visible"); $("menu").classList.remove("visible"); }
function aplicarTema(){ document.body.classList.toggle("light", OV.pref.claro !== false); const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = OV.pref.claro !== false ? "#eef1f5" : "#07090d"; }
async function cambiarTema(){ OV.pref.claro = !(OV.pref.claro !== false); aplicarTema(); try { await kvSet("pref", OV.pref); } catch (e) {} }

// ══ PRECIOS (como Ventas) ══
//  En los datos, la base de cada precio está en los libros: divisas con TasaBin, $ BCV sin TasaBin.
//  Orden en Bs (BCV) con TasaBin: base × Divisas ÷ BCV. Orden en dólares: la base tal cual.
const binOn = () => !!(OV.d && OV.d.binOn);
function bcvRate(){ return Number(OV.d && OV.d.tasa) || 0; }
function divRate(){ return Number(OV.d && OV.d.tasaDivisas) || bcvRate(); }
function enPantalla(base){ const b = Number(base) || 0; return binOn() && O.moneda === "bcv" && bcvRate() > 0 ? r2(b * divRate() / bcvRate()) : r2(b); }
const uTxt = () => !binOn() ? "" : O.moneda === "divisas" ? " div" : " BCV";
function prodDe(cod){ return ((OV.d && OV.d.productos) || []).find(p => String(p.codigo) === String(cod)) || null; }
function precioLista(p, ti){ const l = p.precios || []; const x = l[ti] && l[ti].base > 0 ? l[ti] : l[0] || { base: 0, iva: 0 }; return { base: Number(x.base) || 0, iva: Number(x.iva) || 0 }; }
// Precio unitario CON IVA de una línea, en la moneda de la orden
function puLinea(l){
  if (l.manual) return r2(l.pFinal);
  const p = prodDe(l.codigo); if (!p) return 0;
  const x = precioLista(p, l.tipoIdx);
  return r2(enPantalla(x.base) * (1 + x.iva / 100));
}
function ivaLinea(l){ if (l.manual && l.iva != null) return Number(l.iva) || 0; const p = prodDe(l.codigo); return p ? precioLista(p, l.manual ? 0 : l.tipoIdx).iva : 0; }
function totales(){
  let prod = 0; O.items.forEach(l => { prod += puLinea(l) * (Number(l.cantidad) || 0); });
  prod = r2(prod);
  const dl = r2(O.dlv.monto), tot = r2(prod + dl);
  const bs = O.moneda === "divisas" && binOn() ? r2(prod * divRate() + dl * bcvRate()) : r2(tot * bcvRate());   // el delivery siempre a BCV
  return { prod, dl, tot, bs };
}
// Existencia disponible para órdenes = existencia − lo reservado por otras órdenes (+ lo de esta, si se edita) − lo que ya va en esta
function disponible(cod){
  const p = prodDe(cod); if (!p) return 0;
  const res = (OV.d.reservas || {})[cod] || 0, propia = O.reservaPropia[cod] || 0;
  return r3(p.stock - res + propia);
}
const enOrden = cod => r3(O.items.filter(l => String(l.codigo) === String(cod)).reduce((s, l) => s + (Number(l.cantidad) || 0), 0));

// ══ NUEVA ORDEN ══
function pintarNueva(){
  const d = OV.d || {};
  // Edición
  $("editBanda").classList.toggle("oculto", !(O.id || O.editPend));
  $("editTxt").textContent = O.id ? "✏️ Editando la orden " + O.id : O.editPend ? "✏️ Corrigiendo una orden por enviar" : "";
  $("tabNuevaTxt").textContent = O.id || O.editPend ? "Editando" : "Nueva orden";
  $("btnEnviar").textContent = O.id || O.editPend ? "💾 Guardar cambios" : "✅ Enviar orden";
  pintarCliente();
  // Vendedor (admin sin vínculo)
  $("vendBlq").classList.toggle("oculto", !d.puedeElegirVendedor);
  if (d.puedeElegirVendedor) {
    if (!O.vendedorId && (d.vendedores || []).length) O.vendedorId = d.vendedores[0].id;
    $("selVend").innerHTML = (d.vendedores || []).map(v => '<option value="' + v.id + '"' + (v.id === O.vendedorId ? " selected" : "") + ">" + esc(v.nombre) + "</option>").join("");
  }
  // Moneda (TasaBin)
  $("monBlq").classList.toggle("oculto", !binOn());
  document.querySelectorAll(".mon-op").forEach(b => b.classList.toggle("on", b.dataset.m === O.moneda));
  // Categorías
  const cats = [...new Set((d.productos || []).map(p => p.categoria).filter(Boolean))].sort();
  $("cats").innerHTML = cats.length > 1 ? ['<button type="button" class="cat' + (!OV.cat ? " on" : "") + '" data-c="">Todas</button>'].concat(cats.map(c => '<button type="button" class="cat' + (OV.cat === c ? " on" : "") + '" data-c="' + esc(c) + '">' + esc(c) + "</button>")).join("") : "";
  $("cats").querySelectorAll(".cat").forEach(b => b.addEventListener("click", () => { OV.cat = b.dataset.c; pintarNueva(); }));
  $("selDl").value = O.dlv.tipo === "envio" ? "envio" : "delivery";
  if (document.activeElement !== $("valDl")) $("valDl").value = O.dlv.monto > 0 ? O.dlv.monto : "";
  if (document.activeElement !== $("notas")) $("notas").value = O.notas || "";
  buscar(); pintarLineas(); pintarTotal();
}
function pintarCliente(){
  const c = O.cliente;
  $("cliBox").innerHTML = c ? '<div class="cli-card"><div style="flex:1;min-width:0;"><div class="c-nom">' + esc(c.nombre) + '</div><div class="c-sub">' + esc(c.cedula) + (c.telefono ? " · " + esc(c.telefono) : "") + (c.nuevo ? " · nuevo" : "") +
    '</div></div><button type="button" class="btn-m gray" onclick="elegirCliente()">Cambiar</button></div>' : '<button type="button" class="btn-grande" onclick="elegirCliente()">👤 Elegir cliente</button>';
}
// La lista de productos (ordenada por nombre), de 40 en 40 con «Ver más». Con foto si el producto la tiene.
const LISTA_PASO = 40;
let _lista = { de: 0, prods: [] }, _filtro = "", _lim = LISTA_PASO;
function productosOrdenados(){
  const d = OV.d || {};
  if (_lista.de !== d.descargadoEn) _lista = { de: d.descargadoEn, prods: (d.productos || []).slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es")) };
  return _lista.prods;
}
function fotoHTML(p, cls){
  const u = String((p && p.imagen) || "").trim().replace(/"/g, "%22");
  return '<span class="' + cls + '">' + (u ? '<img alt="" loading="lazy" decoding="async" src="' + u + '" onerror="this.parentNode.innerHTML=\'📦\'">' : "📦") + "</span>";
}
function verMas(){ _lim += LISTA_PASO; buscar(true); }
function buscar(seguir){
  const q = norm($("busca").value);
  const f = q + "|" + OV.cat;
  if (!seguir && f !== _filtro) { _filtro = f; _lim = LISTA_PASO; }
  const pal = q.split(/\s+/).filter(Boolean);
  const T = productosOrdenados().filter(p => (!OV.cat || p.categoria === OV.cat) && (!pal.length || pal.every(w => norm(p.nombre + " " + p.marca + " " + p.codigo + " " + p.codigoBarras).indexOf(w) >= 0)));
  const L = T.slice(0, _lim);
  if (!L.length) { $("res").innerHTML = '<div class="vacio">' + (q ? "No hay productos con «" + esc($("busca").value) + "»." : "No hay productos en esta categoría.") + "</div>"; return; }
  $("res").innerHTML = L.map((p, k) => {
    const x = precioLista(p, 0), pu = r2(enPantalla(x.base) * (1 + x.iva / 100)), q2 = enOrden(p.codigo), disp = r3(disponible(p.codigo) - q2);
    const cls = disp <= 0 ? "no" : disp <= 3 ? "poco" : "";
    return '<div class="res-item">' + fotoHTML(p, "r-img") + '<div class="r-info"><div class="r-nom">' + esc(p.nombre) + '</div><div class="r-sub">' + esc([p.marca, p.codigo].filter(Boolean).join(" · ")) + '</div><span class="quedan ' + cls + '">' + (disp > 0 ? "quedan " + fmtCant(disp) : "no queda") + "</span></div>" +
      '<div class="r-pre">$' + fmt(pu) + "<small>" + esc(uTxt().trim()) + '</small></div><button type="button" class="btn-mas" data-k="' + k + '">+' + (q2 > 0 ? '<span class="q">' + fmtCant(q2) + "</span>" : "") + "</button></div>";
  }).join("") + (T.length > L.length ? '<button type="button" class="btn block" style="margin-top:4px;" onclick="verMas()">Ver más productos (' + (T.length - L.length) + ")</button>" : "");
  $("res").querySelectorAll(".btn-mas").forEach(b => b.addEventListener("click", () => agregar(L[Number(b.dataset.k)])));
}
function agregar(p){
  const ya = O.items.find(l => String(l.codigo) === String(p.codigo) && !l.manual && l.tipoIdx === 0);
  if (ya) ya.cantidad = r3((Number(ya.cantidad) || 0) + 1);
  else O.items.push({ key: ++O.seq, codigo: p.codigo, nombre: p.nombre, cantidad: 1, tipoIdx: 0, manual: false, pFinal: 0, iva: null });
  const n = String(p.nombre); toast("✅ " + (n.length > 30 ? n.slice(0, 29) + "…" : n) + " ×" + fmtCant(enOrden(p.codigo)));
  buscar(true); pintarLineas(); pintarTotal(); guardarBorrador();
}
function pintarLineas(){
  const d = OV.d || {}, tps = (d.tiposPrecios || []);
  $("btnVaciar").classList.toggle("oculto", !O.items.length && !O.cliente);
  if (!O.items.length) { $("lineas").innerHTML = '<div class="vacio">La orden está vacía. Agrega productos con el botón <b>+</b>.</div>'; return; }
  $("lineas").innerHTML = O.items.map(l => {
    const p = prodDe(l.codigo);
    const opts = tps.map((n, i) => ({ n, i })).filter(o => o.i === 0 || (p && p.precios[o.i] && p.precios[o.i].base > 0)).map(o => '<option value="' + o.i + '"' + (!l.manual && l.tipoIdx === o.i ? " selected" : "") + ">" + esc(o.n) + "</option>").join("") +
      '<option value="manual"' + (l.manual ? " selected" : "") + ">Manual</option>";
    const falta = p && enOrden(l.codigo) > disponible(l.codigo) + 0.0005;
    const pu = puLinea(l), tot = r2(pu * (Number(l.cantidad) || 0));
    return '<div class="lin' + (falta || !p ? " falta" : "") + '" id="ln_' + l.key + '"><div class="lin-cab">' + fotoHTML(p, "l-img") + '<span class="l-nom">' + esc(l.nombre) + '</span><button type="button" class="btn-cli-x" onclick="quitar(' + l.key + ')">✕</button></div>' +
      '<div class="lin-fila"><div class="paso"><button type="button" onclick="paso(' + l.key + ',-1)">−</button><input type="number" inputmode="decimal" min="0" step="any" id="q_' + l.key + '" value="' + (l.cantidad === "" ? "" : l.cantidad) + '" placeholder="Cant." oninput="cant(' + l.key + ',this.value)"><button type="button" onclick="paso(' + l.key + ',1)">+</button></div>' +
      '<select onchange="tipoLinea(' + l.key + ',this)">' + opts + "</select>" +
      (l.manual ? '<input class="man" type="number" inputmode="decimal" min="0" step="any" id="pm_' + l.key + '" placeholder="Precio c/IVA" value="' + (l.pFinal > 0 ? l.pFinal : "") + '" oninput="precioMan(' + l.key + ',this.value)">' : '<span class="l-pu">$' + fmt(pu) + " c/u</span>") +
      '<span class="l-tot" id="t_' + l.key + '">$' + fmt(tot) + "</span></div>" +
      (!p ? '<div class="l-aviso">⚠️ Este producto ya no está en los datos del teléfono (puede que lo hayan quitado): quítalo de la orden.</div>' : '<div class="l-aviso" id="la_' + l.key + '">' + (falta ? avisoFalta(l.codigo) : "") + "</div>") + "</div>";
  }).join("");
}
const itemDe = k => O.items.find(l => l.key === k);
function avisoFalta(cod){ return "⚠️ No alcanza: quedan " + fmtCant(Math.max(0, disponible(cod))) + " y la orden pide " + fmtCant(enOrden(cod)) + "."; }
// Marca en rojo las líneas sin existencia suficiente (sin repintar: no se pierde el cursor)
function marcarFaltas(){
  O.items.forEach(l => {
    const el = $("ln_" + l.key), av = $("la_" + l.key); if (!el || !av) return;
    const falta = enOrden(l.codigo) > disponible(l.codigo) + 0.0005;
    el.classList.toggle("falta", falta); av.textContent = falta ? avisoFalta(l.codigo) : "";
  });
}
function quitar(k){ O.items = O.items.filter(l => l.key !== k); buscar(); pintarLineas(); pintarTotal(); guardarBorrador(); }
function paso(k, dlt){ const l = itemDe(k); if (!l) return; const v = r3((Number(l.cantidad) || 0) + dlt); if (v <= 0) return; l.cantidad = v; buscar(); pintarLineas(); pintarTotal(); guardarBorrador(); }
function cant(k, v){ const l = itemDe(k); if (!l) return; l.cantidad = v === "" ? "" : r3(v); const t = $("t_" + k); if (t) t.textContent = "$" + fmt(r2(puLinea(l) * (Number(l.cantidad) || 0))); marcarFaltas(); pintarTotal(); guardarBorrador(); }
function precioMan(k, v){ const l = itemDe(k); if (!l) return; l.pFinal = Math.max(0, Number(v) || 0); const t = $("t_" + k); if (t) t.textContent = "$" + fmt(r2(puLinea(l) * (Number(l.cantidad) || 0))); pintarTotal(); guardarBorrador(); }
async function tipoLinea(k, sel){
  const l = itemDe(k); if (!l) return;
  const antes = l.manual ? "manual" : String(l.tipoIdx);
  if (sel.value === "manual") {
    if (OV.d.pideClave && !O.clave) {
      const c = await pedirClave();
      if (!c) { sel.value = antes; return; }
      O.clave = c;
    }
    l.manual = true; l.iva = ivaLinea(Object.assign({}, l, { manual: false })); l.pFinal = puLinea(Object.assign({}, l, { manual: false }));
    pintarLineas(); pintarTotal(); guardarBorrador();
    setTimeout(() => { const i = $("pm_" + k); if (i) { i.focus(); i.select(); } }, 50);
    return;
  }
  l.manual = false; l.tipoIdx = Number(sel.value) || 0; l.pFinal = 0;
  pintarLineas(); pintarTotal(); guardarBorrador();
}
// La clave de precio manual: con internet se revisa en el sistema; sin internet se revisa al enviar la orden
function pedirClave(){
  let val = "";
  return modal({ icono: "🔒", titulo: "Precio manual",
    html: '<div class="m-txt">Escribe la <b>clave de precio manual</b> (la misma de Ventas).' + (hayRed() ? "" : " Sin señal se revisa cuando se envíe la orden.") + '</div><input class="inp" id="mClave" type="password" placeholder="Clave de precio manual" autocomplete="off" style="margin-top:10px;" onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.closest(\'.modal\').querySelector(\'[data-v=ok]\').click();}"><div class="m-err" id="mClaveErr"></div>',
    botones: [{ txt: "Cancelar", v: false }, { txt: "✅ Verificar", v: true, cls: "green", spin: "Verificando…" }], foco: "mClave",
    antes: async v => {
      if (!v) return true;
      const e = $("mClaveErr"); val = $("mClave").value;
      if (!val) { e.textContent = "Escribe la clave."; return false; }
      if (!hayRed() || !sesionOk()) return true;
      let r; try { r = await api("cj_ov_clave", { clave: val }, 20000); } catch (x) { return true; }   // sin conexión: se revisa al enviar
      if (r && r.ok) return true;
      e.textContent = (r && r.msg) || "La clave no es correcta."; $("mClave").value = ""; $("mClave").focus(); return false;
    } }).then(ok => ok ? val : "");
}
function cambiarMoneda(m){ if (O.moneda === m) return; O.moneda = m; O.items.forEach(l => { if (l.manual) { /* el precio manual se queda como lo escribió */ } }); pintarNueva(); guardarBorrador(); toast(m === "divisas" ? "💵 Orden en dólares" : "🧾 Orden en Bs (BCV)"); }
function pintarTotal(){
  const t = totales(), n = O.items.length;
  $("btTot").textContent = "$" + fmt(t.tot) + uTxt();
  $("btSub").textContent = n ? "Bs " + fmt(t.bs) + " · " + n + (n === 1 ? " producto" : " productos") + (t.dl > 0 ? " · con " + (O.dlv.tipo === "envio" ? "envío" : "delivery") : "") : "Orden vacía";
}
let _borT = null;
function guardarBorrador(){ clearTimeout(_borT); _borT = setTimeout(() => { kvSet("borrador", O).catch(() => {}); }, 300); }
async function vaciarConfirmar(){
  const ok = await confirmar({ icono: "🗑️", titulo: O.id ? "Dejar de editar" : "Vaciar la orden", ok: O.id ? "Sí, salir" : "Sí, vaciar", colorOk: "red", html: O.id ? "Los cambios que no guardaste se pierden. La orden " + esc(O.id) + " queda como estaba." : "Se quitan el cliente, los productos, el delivery y las notas. No se envía nada." });
  if (ok) limpiarOrden();
}
function cancelarEdicion(){ vaciarConfirmar(); }
function limpiarOrden(){ const m = O.moneda; O = nuevaOrden(); O.moneda = m; O.idLocal = llave(); $("busca").value = ""; kvDel("borrador").catch(() => {}); pintarNueva(); }

// ── Cliente: buscar entre los del teléfono, o uno nuevo (se crea en el sistema al llegar la orden) ──
function elegirCliente(){
  const L = (OV.d && OV.d.clientes) || [];
  let elegido = null;
  return modal({ titulo: "👤 Cliente", clase: "ancho",
    html: '<input class="inp" id="clBusca" type="search" placeholder="🔍 Nombre o cédula" autocomplete="off"><div class="cli-lista" id="clLista" style="margin-top:8px;"></div>' +
      '<div id="clNuevo" class="oculto" style="margin-top:10px;"><div class="m-txt" style="margin-bottom:8px;">Cliente nuevo: se crea en el sistema cuando llegue la orden.</div>' +
      '<div class="fg"><label>Cédula / RIF</label><input class="inp" id="ncCed" placeholder="Ej: V12345678"></div><div class="fg" style="margin-top:8px;"><label>Nombre</label><input class="inp" id="ncNom" placeholder="Nombre y apellido"></div>' +
      '<div class="fg" style="margin-top:8px;"><label>Teléfono</label><input class="inp" id="ncTel" placeholder="Opcional" inputmode="tel"></div><div class="m-err" id="ncErr"></div></div>',
    botones: [{ txt: "Cancelar", v: null }, { txt: "➕ Cliente nuevo", v: "nuevo", cls: "green" }], foco: "clBusca",
    antes: async v => {
      if (v !== "nuevo") return true;
      const box = $("clNuevo");
      if (box.classList.contains("oculto")) { box.classList.remove("oculto"); const q = $("clBusca").value.trim(), esCed = /^[VEJGPvejgp]?[-.\s]?\d[\d.\s-]*$/.test(q); if (esCed) $("ncCed").value = q; else $("ncNom").value = q; setTimeout(() => $(esCed ? "ncNom" : "ncCed").focus(), 30); return false; }
      const c = { cedula: $("ncCed").value.trim(), nombre: $("ncNom").value.trim().replace(/\s+/g, " "), telefono: $("ncTel").value.trim() };
      if (!c.cedula || !c.nombre) { $("ncErr").textContent = "Escribe la cédula y el nombre."; return false; }
      if (/[^A-Za-z0-9.\-\s]/.test(c.cedula)) { $("ncErr").textContent = "La cédula solo puede llevar letras, números, puntos y guiones."; return false; }
      const ya = L.find(x => dig(x.cedula) && dig(x.cedula) === dig(c.cedula));
      elegido = ya ? Object.assign({}, ya) : Object.assign({ nuevo: true }, c);
      return true;
    },
    alAbrir: (box, cerrar) => {
      const pintar = () => {
        const q = norm($("clBusca").value), dq = dig($("clBusca").value);
        const r = (!q ? L.slice(-40).reverse() : L.filter(c => norm(c.nombre).indexOf(q) >= 0 || (dq.length >= 3 && dig(c.cedula).indexOf(dq) >= 0))).slice(0, 50);
        $("clLista").innerHTML = r.length ? r.map((c, k) => '<div class="cl" data-k="' + k + '"><b>' + esc(c.nombre) + "</b><span>" + esc(c.cedula) + "</span></div>").join("") : '<div class="vacio">No hay clientes con «' + esc($("clBusca").value) + "». Toca <b>➕ Cliente nuevo</b>.</div>";
        $("clLista").querySelectorAll(".cl").forEach(el => el.addEventListener("click", () => { elegido = Object.assign({}, r[Number(el.dataset.k)]); cerrar("ok"); }));
      };
      $("clBusca").addEventListener("input", pintar); pintar();
    } }).then(() => { if (elegido) { O.cliente = elegido; pintarCliente(); guardarBorrador(); } });
}

// ══ ENVIAR ══
function datosDeOrden(){
  const iv = l => ivaLinea(l);
  return {
    id: O.id || "", idLocal: O.id ? "" : O.idLocal, cliente: { cedula: O.cliente.cedula, nombre: O.cliente.nombre, telefono: O.cliente.telefono || "" },
    vendedorId: OV.d.puedeElegirVendedor ? O.vendedorId : 0, moneda: binOn() ? O.moneda : "bcv", notas: String(O.notas || "").trim(),
    items: O.items.map(l => {
      const i = iv(l);
      if (l.manual) {
        const pr = (Number(l.pFinal) || 0) / (1 + i / 100);   // sin IVA, en la moneda de la orden
        const libro = binOn() && O.moneda === "bcv" && divRate() > 0 ? pr * bcvRate() / divRate() : pr;
        return { tipo: "producto", codigo: l.codigo, nombre: l.nombre, cantidad: Number(l.cantidad), tipoIdx: -1, cobro: O.moneda, manual: true, manualTipo: O.moneda, precio: pr, precioBase: pr, precioBin: libro, iva: i };
      }
      const p = prodDe(l.codigo), x = precioLista(p, l.tipoIdx), pant = enPantalla(x.base);
      return { tipo: "producto", codigo: l.codigo, nombre: l.nombre, cantidad: Number(l.cantidad), tipoIdx: l.tipoIdx, cobro: O.moneda, manual: false, manualTipo: "", precio: pant, precioBase: pant, precioBin: x.base, iva: x.iva };
    }),
    totalRef: totales().tot, clavePrecio: O.items.some(l => l.manual) ? O.clave : "",
    delivery: r2(O.dlv.monto), tipoDelivery: O.dlv.tipo === "envio" ? "envio" : "delivery"
  };
}
async function enviarOrden(){
  if (!O.cliente) { aviso({ icono: "👤", titulo: "Falta el cliente", html: "Elige el cliente de la orden (o crea uno nuevo). Con eso la caja la encuentra." }); return; }
  if (!O.items.length) { aviso({ icono: "🛒", titulo: "La orden está vacía", html: "Agrega al menos un producto." }); return; }
  const malC = O.items.find(l => !(Number(l.cantidad) > 0)); if (malC) { aviso({ icono: "🔢", titulo: "Falta una cantidad", html: "<b>" + esc(malC.nombre) + "</b> no tiene cantidad." }); return; }
  const malP = O.items.find(l => l.manual && !(Number(l.pFinal) > 0)); if (malP) { aviso({ icono: "✏️", titulo: "Falta el precio", html: "<b>" + esc(malP.nombre) + "</b> tiene precio manual y está vacío." }); return; }
  if (OV.d.pideClave && O.items.some(l => l.manual) && !O.clave) {   // orden que se edita (o se corrige) con precio manual: la clave otra vez
    const c = await pedirClave(); if (!c) return;
    O.clave = c;
  }
  const noEx = O.items.find(l => !prodDe(l.codigo)); if (noEx) { aviso({ icono: "📦", titulo: "Producto que ya no está", html: "<b>" + esc(noEx.nombre) + "</b> ya no está en los datos del teléfono. Quítalo de la orden." }); return; }
  const faltan = [...new Set(O.items.map(l => l.codigo))].filter(c => enOrden(c) > disponible(c) + 0.0005).map(c => prodDe(c));
  if (faltan.length && !await confirmar({ icono: "📦", titulo: "No alcanza la existencia", colorOk: "naranja", ok: "Enviar igual",
    html: "Según los datos del teléfono no alcanza para:<ul style=\"margin:8px 0 8px 18px;line-height:1.6;\">" + faltan.map(p => "<li><b>" + esc(p.nombre) + "</b>: pides " + fmtCant(enOrden(p.codigo)) + ", quedan " + fmtCant(Math.max(0, disponible(p.codigo))) + "</li>").join("") +
      "</ul>El sistema revisa la existencia al recibirla: si de verdad no alcanza, no la acepta y te dice qué ajustar." })) return;
  const e = { idLocal: O.id ? "EDIT-" + O.id : O.idLocal, id: O.id || "", datos: datosDeOrden(), creada: ahoraTxt(), estado: "pend", msg: "",
    resumen: { cliente: O.cliente.nombre, cedula: O.cliente.cedula, n: O.items.length, total: totales().tot, u: uTxt().trim(), dl: r2(O.dlv.monto) }, orden: JSON.parse(JSON.stringify(O)) };
  OV.pend = OV.pend.filter(x => x.idLocal !== e.idLocal && x.idLocal !== O.editPend).concat([e]);
  try { await kvSet("pend", OV.pend); }
  catch (x) { aviso({ icono: "❌", titulo: "No se pudo guardar", html: "El teléfono no pudo guardar la orden (" + esc(x.message) + "). Sigue en pantalla: vuelve a intentar." }); return; }
  // La orden pasa a la cola y la pantalla queda lista para la siguiente: se envía por detrás (sin esperar)
  limpiarOrden(); pintarEstado();
  if (!hayRed()) { toast("⏳ Sin señal: la orden queda en cola y se envía sola"); return; }
  if (!sesionOk()) { toast("⏳ Orden en cola"); pedirEntrada(enviarPendientes); return; }
  toast("📤 Orden en cola: se está enviando");
  enviarPendientes();
}
// Manda una orden guardada. Devuelve "ok" · "red" · "sesion" · "error"
async function enviarUna(e){
  let r;
  try { r = await api("cj_ov_guardar", { datos: e.datos }, 90000); }
  catch (x) { if (x.red) return "red"; e.estado = "error"; e.msg = x.message; await kvSet("pend", OV.pend); pintarEstado(); return "error"; }
  if (r && r.codigo === "SESION") return "sesion";
  if (r && r.ok) {
    e.idServidor = r.id;
    OV.pend = OV.pend.filter(x => x !== e); await kvSet("pend", OV.pend);
    if (r.ordenes) { OV.d.ordenes = r.ordenes; OV.d.reservas = r.reservas || OV.d.reservas; await kvSet("datos", OV.d); }
    pintarEstado(); pintarMis();
    if (!$("main").classList.contains("oculto")) buscar();
    return "ok";
  }
  if (r && r.reintentar) return "red";
  e.estado = "error"; e.codigo = (r && r.codigo) || ""; e.msg = (r && r.msg) || "El sistema no aceptó la orden.";
  if (r && r.reservas && OV.d) { OV.d.reservas = r.reservas; await kvSet("datos", OV.d); }
  await kvSet("pend", OV.pend); pintarEstado(); pintarMis();
  return "error";
}
function mostrarError(e){
  return modal({ icono: "⚠️", titulo: "La orden no se envió", html: '<div class="m-txt">' + esc(e.msg) + (e.codigo === "CLAVE_PRECIO" ? "<br><br>Corrígela y vuelve a escribir la clave de precio manual." : "") + "<br><br>Quedó guardada en el teléfono: corrígela y vuelve a enviarla.</div>",
    botones: [{ txt: "Después", v: false }, { txt: "✏️ Corregir", v: true, cls: "green" }] }).then(v => { if (v) corregirPend(e.idLocal); });
}
// Manda la cola, de la más vieja a la más nueva. Si mientras tanto entran más órdenes, también las manda.
async function enviarPendientes(){
  if (OV.enviando || !OV.pend.length || !hayRed()) { pintarEstado(); return; }
  if (!sesionOk()) { pintarEstado(); return; }
  OV.enviando = true; pintarEstado();
  const enviadas = [], malas = [];
  let corte = "";
  try {
    for (;;) {
      const e = OV.pend.find(x => x.estado !== "error" && !x._intentada);
      if (!e) break;
      e._intentada = true;
      const r = await enviarUna(e);
      if (r === "ok") enviadas.push(e);
      else if (r === "error") malas.push(e);
      else { corte = r; break; }
    }
  } finally {
    OV.pend.forEach(x => { delete x._intentada; });
    OV.enviando = false; pintarEstado();
  }
  if (enviadas.length) toast("✅ " + (enviadas.length === 1 ? (enviadas[0].id ? "Cambios guardados en " + enviadas[0].id : "Orden " + (enviadas[0].idServidor || "") + " enviada") : enviadas.length + " órdenes enviadas"));
  if (corte === "sesion") pedirEntrada(enviarPendientes);
  for (const e of malas) await mostrarError(e);
}

// ══ MIS ÓRDENES ══
const ESTADO_TXT = { ABIERTA: "ABIERTA", TOMADA: "EN CAJA", FACTURADA: "FACTURADA", CONVERTIDA: "FACTURADA", ANULADA: "ANULADA" };
function pintarMis(){
  const L = ((OV.d && OV.d.ordenes) || []).map(o => Object.assign({}, o, { estado: o.estado === "CONVERTIDA" ? "FACTURADA" : o.estado }));
  let h = "";
  OV.pend.slice().reverse().forEach(e => {
    const r = e.resumen || {}, err = e.estado === "error";
    h += '<div class="ord-card"><div class="ord-fila"><b>' + (e.id ? "✏️ " + esc(e.id) : "Orden nueva") + '</b><span class="ord-est ' + (err ? "est-ERROR" : "est-PEND") + '">' + (err ? "NO SE ENVIÓ" : "⏳ POR ENVIAR") + "</span></div>" +
      '<div class="ord-quien">' + esc(r.cliente) + ' <span style="color:var(--text-dim);font-weight:400;">' + esc(r.cedula) + "</span></div>" +
      '<div class="ord-info">' + esc(e.creada) + " · " + r.n + (r.n === 1 ? " producto" : " productos") + " · $" + fmt(r.total) + (r.u ? " " + esc(r.u) : "") + (r.dl > 0 ? " · con delivery" : "") + "</div>" +
      (err ? '<div class="ord-msg">' + esc(e.msg) + "</div>" : "") +
      '<div class="ord-acc"><button type="button" class="btn-m rojo" onclick="borrarPend(\'' + esc(e.idLocal) + '\')">🗑️ Borrar</button><button type="button" class="btn-m gray" onclick="corregirPend(\'' + esc(e.idLocal) + '\')">✏️ Editar</button>' +
      (err ? '<button type="button" class="btn-m green" onclick="reintentarPend(\'' + esc(e.idLocal) + '\',this)">🔁 Enviar otra vez</button>' : "") + "</div></div>";
  });
  if (!L.length && !OV.pend.length) h += '<div class="vacio">No tienes órdenes en los últimos 7 días.</div>';
  L.forEach(o => {
    const n = (o.items || []).length, ex = o.extra || {}, dl = Number(ex.delivery) || 0;
    const extra = o.estado === "TOMADA" ? " · en la " + esc(o.tomadaPor || "caja") : o.estado === "FACTURADA" && o.factura ? " · factura #" + esc(o.factura) : "";
    const acc = o.estado === "ABIERTA" ? '<div class="ord-acc"><button type="button" class="btn-m rojo" onclick="anularOrden(\'' + esc(o.id) + '\',this)">🚫 Anular</button><button type="button" class="btn-m gray" onclick="editarOrden(\'' + esc(o.id) + '\')">✏️ Editar</button></div>' : "";
    h += '<div class="ord-card"><div class="ord-fila"><b>' + esc(o.id) + '</b><span class="ord-est est-' + esc(o.estado) + '">' + esc(ESTADO_TXT[o.estado] || o.estado) + "</span></div>" +
      '<div class="ord-quien">' + esc(o.cliente) + ' <span style="color:var(--text-dim);font-weight:400;">' + esc(o.cedula) + "</span></div>" +
      '<div class="ord-info">' + esc(o.fecha) + " · " + n + (n === 1 ? " producto" : " productos") + " · $" + fmt(o.total) + (dl > 0 ? " · " + (ex.tipoDelivery === "envio" ? "envío" : "delivery") + " $" + fmt(dl) : "") +
      (o.vendedor && OV.d && OV.d.puedeElegirVendedor ? " · " + esc(o.vendedor) : "") + extra + "</div>" +
      (o.notas ? '<div class="ord-info" style="margin-top:3px;">📝 ' + esc(o.notas) + "</div>" : "") + acc + "</div>";
  });
  $("listaMis").innerHTML = h;
}
async function refrescarLista(b){
  if (!sesionOk()) { if (b) pedirEntrada(() => refrescarLista(null)); return; }
  if (b) btnOcupado(b, "…");
  let r; try { r = await api("cj_ov_listar", {}, 45000); } catch (e) { r = null; if (b) aviso({ icono: "📡", titulo: "Sin conexión", html: "No se pudo traer la lista. Lo que ves es lo último que tenía el teléfono." }); }
  if (b) btnLibre(b, "🔃 Actualizar");
  if (r && r.codigo === "SESION") { if (b) pedirEntrada(() => { irA("mis"); refrescarLista(null); }); return; }
  if (r && r.ok) { OV.d.ordenes = r.ordenes || []; if (r.reservas) OV.d.reservas = r.reservas; await kvSet("datos", OV.d); pintarMis(); }
}
async function anularOrden(id, b){
  if (!hayRed() || !sesionOk()) { aviso({ icono: "📡", titulo: "Hace falta internet", html: "Para anular una orden hace falta señal (así la caja no la cobra)." }); return; }
  const ok = await confirmar({ icono: "🚫", titulo: "Anular " + id, ok: "Sí, anular", colorOk: "red", html: "La orden <b>" + esc(id) + "</b> queda anulada y la caja ya no la podrá cobrar. No se puede deshacer." });
  if (!ok) return;
  btnOcupado(b, "…");
  let r; try { r = await api("cj_ov_anular", { id: id }, 45000); } catch (e) { r = { ok: false, msg: e.message }; }
  btnLibre(b);
  if (r && r.codigo === "SESION") { pedirEntrada(() => irA("mis")); return; }
  if (!r || !r.ok) { aviso({ icono: "❌", titulo: "No se pudo anular", html: esc((r && r.msg) || "") }); refrescarLista(null); return; }
  if (r.ordenes) { OV.d.ordenes = r.ordenes; OV.d.reservas = r.reservas || OV.d.reservas; await kvSet("datos", OV.d); }
  pintarMis(); toast("🚫 Orden " + id + " anulada");
}
// Una orden del sistema (formato de Ventas o el corto del módulo viejo) → la pantalla
function cargarOrden(o, editPend){
  const items = [], faltan = [];
  O = nuevaOrden(); O.idLocal = llave();
  O.moneda = binOn() && o.moneda === "divisas" ? "divisas" : "bcv";
  (o.items || []).forEach(it => {
    const p = prodDe(it.codigo); if (!p) { faltan.push(it.nombre || it.codigo); return; }
    const man = it.manual === true || Number(it.tipoIdx) === -1;
    const l = { key: ++O.seq, codigo: p.codigo, nombre: p.nombre, cantidad: Number(it.cantidad) || 0, tipoIdx: man ? 0 : Math.max(0, Math.min(2, Number(it.tipoIdx) || 0)), manual: man, pFinal: 0, iva: null };
    if (man) { const iva = it.iva !== undefined && it.iva !== "" ? Number(it.iva) || 0 : precioLista(p, 0).iva; l.iva = iva; l.pFinal = Number(it.precio) > 0 ? r2(Number(it.precio) * (1 + iva / 100)) : r2(it.precioManual); }
    items.push(l);
    if (!editPend) O.reservaPropia[p.codigo] = r3((O.reservaPropia[p.codigo] || 0) + l.cantidad);
  });
  O.items = items;
  O.cliente = { cedula: o.cedula, nombre: o.cliente, telefono: o.telefono || "" };
  O.vendedorId = Number(o.vendedorId) || 0;
  const ex = o.extra || {};
  O.dlv = { tipo: ex.tipoDelivery === "envio" ? "envio" : "delivery", monto: Number(ex.delivery) || 0 };
  O.notas = o.notas || "";
  return faltan;
}
function editarOrden(id){
  const o = ((OV.d && OV.d.ordenes) || []).find(x => x.id === id); if (!o) return;
  const faltan = cargarOrden(o, false);
  O.id = o.id;
  if (O.items.some(l => l.manual)) O.clave = "";   // al guardar, si sigue con precio manual, se pide la clave
  guardarBorrador(); irA("nueva"); pintarNueva();
  if (faltan.length) aviso({ icono: "📦", titulo: "Productos que ya no están", html: "No se cargaron porque ya no están en los datos: " + faltan.map(esc).join(", ") + "." });
}
async function corregirPend(idLocal){
  const e = OV.pend.find(x => x.idLocal === idLocal); if (!e) return;
  if (O.items.length && !await confirmar({ icono: "🧾", titulo: "Tienes una orden en pantalla", ok: "Reemplazarla", html: "La orden que estás armando se pierde si abres esta. ¿Seguir?" })) return;
  O = Object.assign(nuevaOrden(), e.orden || {});
  O.editPend = e.idLocal;
  if (e.codigo === "CLAVE_PRECIO") O.clave = "";
  guardarBorrador(); irA("nueva"); pintarNueva();
}
async function borrarPend(idLocal){
  const ok = await confirmar({ icono: "🗑️", titulo: "Borrar la orden", ok: "Sí, borrar", colorOk: "red", html: "Esta orden no ha llegado al sistema. Si la borras, se pierde." });
  if (!ok) return;
  OV.pend = OV.pend.filter(x => x.idLocal !== idLocal); await kvSet("pend", OV.pend); pintarEstado(); pintarMis();
}
async function reintentarPend(idLocal, b){
  const e = OV.pend.find(x => x.idLocal === idLocal); if (!e) return;
  if (!hayRed()) { aviso({ icono: "📡", titulo: "Sin señal", html: "Se envía sola cuando vuelva la señal." }); return; }
  if (!sesionOk()) { pedirEntrada(() => reintentarPend(idLocal, null)); return; }
  e.estado = "pend"; e.msg = "";
  if (b) btnOcupado(b, "Enviando…");
  const r = await enviarUna(e);
  if (b) btnLibre(b);
  if (r === "ok") toast("✅ Orden enviada"); else if (r === "error") mostrarError(e);
}

// ══ PIEZAS (las mismas de la caja) ══
function modal(o){
  return new Promise(resolve => {
    const fondo = document.createElement("div");
    fondo.className = "mfondo";
    const bots = o.botones || [{ txt: "Entendido", v: true, cls: "green" }];
    const clsBtn = c => "btn-m " + ({ green: "green", naranja: "naranja", red: "rojo", rojo: "rojo" }[c] || "gray");
    fondo.innerHTML = '<div class="modal' + (o.clase ? " " + o.clase : "") + '"><div class="mh"><h3>' + esc(o.titulo || "") + '</h3><button type="button" class="btn-m gray m-x" style="padding:6px 12px;" title="Cerrar">✕</button></div>' +
      '<div class="mb">' + (o.icono ? '<div class="m-ico">' + o.icono + "</div>" : "") + (o.html || "") + "</div>" +
      (bots.length ? '<div class="mf">' + bots.map((b, k) => '<button type="button" class="' + clsBtn(b.cls) + '" data-k="' + k + '"' + (b.v === true ? ' data-v="ok"' : "") + ">" + b.txt + "</button>").join("") + "</div>" : "") + "</div>";
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
    setTimeout(() => { if (fondo.contains(document.activeElement)) return; const f = o.foco ? $(o.foco) : fondo.querySelector('.mf .btn-m[data-v="ok"]') || fondo.querySelector(".mf .btn-m:last-child"); if (f) f.focus(); }, 40);
  });
}
function aviso(o){ return modal({ icono: o.icono || "ℹ️", titulo: o.titulo, html: '<div class="m-txt">' + (o.html || "") + "</div>", botones: [{ txt: "Entendido", v: true, cls: o.colorOk || "green" }] }); }
function confirmar(o){ return modal({ icono: o.icono || "❓", titulo: o.titulo, html: '<div class="m-txt">' + (o.html || "") + "</div>", botones: [{ txt: o.cancel || "Cancelar", v: false }, { txt: o.ok || "Aceptar", v: true, cls: o.colorOk || "green" }] }); }
let _toastT = null;
function toast(t){ const el = $("toast"); el.textContent = t; el.classList.remove("on"); void el.offsetWidth; el.classList.add("on"); clearTimeout(_toastT); _toastT = setTimeout(() => el.classList.remove("on"), 2500); }
function btnOcupado(b, txt){ if (!b) return; if (b._txt == null) b._txt = b.innerHTML; b.disabled = true; b.innerHTML = '<span class="sp"></span>' + esc(txt || "Procesando…"); }
function btnLibre(b, txt){ if (!b) return; b.disabled = false; if (txt != null) b.innerHTML = txt; else if (b._txt != null) b.innerHTML = b._txt; b._txt = null; }

arrancar();
