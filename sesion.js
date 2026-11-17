"use strict";
// ══════════════════════════════════════════════════════════════
//  ENTRAR · el equipo, el usuario y el pase (sistema ⇄ caja)
//  Dos llaves:
//   · EL EQUIPO: lo activa una vez un usuario con permiso de la caja y la clave maestra, aquí mismo.
//     Con su llave se suben las ventas, los cierres y se piden/devuelven números (aunque la sesión venza).
//   · EL USUARIO: usuario y clave del sistema, o el pase de un solo uso que manda el sistema al tocar
//     la tarjeta de la caja. Con la sesión se descargan los datos y se abre el sistema (🏠 Sistema).
//  Sin internet, la sesión que ya estaba abierta sigue sirviendo para vender. El cajero de cada turno
//  entra con su PIN (app.js).
// ══════════════════════════════════════════════════════════════
const espera = ms => new Promise(r => setTimeout(r, ms));

function sesionViva(){ return !!(S.ses && S.ses.token); }
function modsSesion(){
  const m = S.ses && S.ses.usuario && S.ses.usuario.modulos;
  return (Array.isArray(m) ? m : String(m || "").split(",")).map(x => String(x).trim()).filter(Boolean);
}
function puedeCaja(n){ const m = modsSesion(); return m.indexOf("todos") >= 0 || m.indexOf("ventas_" + n) >= 0; }
async function guardarSesion(r){
  S.ses = { token: r.token, usuario: r.usuario || {}, desde: Date.now() };
  S.recienEntro = Date.now();   // 5.0i: acaba de poner su contraseña (o vino con el pase): su turno no se la vuelve a pedir
  S.sesionMal = ""; S.noDirecta = false;
  await kvSet("sesion", S.ses);
}
async function borrarSesion(){ S.ses = null; await kvSet("sesion", null); }
// ── Entrada directa (Etapa 1D): un equipo activado no pide usuario y clave. Sin sesión (o vencida), pide una
//    con la llave del equipo: solo de esta caja, a nombre del último usuario que entró aquí. true si quedó adentro.
let _renovando = null;
function entrarDirecto(){
  if (!S.eq || S.online === false || navigator.onLine === false || S.noDirecta) return Promise.resolve(false);
  if (_renovando) return _renovando;
  _renovando = (async () => {
    try {
      const r = await api("cj_renovar", {}, 30000);
      if (r && r.ok && r.token) { await guardarSesion(r); pintarBanners(); return true; }
      if (r && r.codigo === "EQUIPO") { S.permisoMal = r.msg || "Este equipo no tiene permiso."; if (r.reemplazado) S.reemplazado = true; pintarBanners(); }
      else if (r && r.msg) S.avisoPase = r.msg;
    } catch (e) {}
    return false;
  })();
  const p = _renovando; p.then(() => { _renovando = null; });
  return p;
}
function sesionDirecta(){ return !!(S.ses && S.ses.usuario && S.ses.usuario.rol === "caja_equipo"); }
function ventaAMedias(){ return F.items.length > 0 || !!P || !!document.querySelector(".mfondo:not(.oculto)"); }

// ── Pantalla de entrar (la vista "activar") ──
function pantalla(o){
  document.body.classList.add("entrando");
  mostrarVista("activar");
  $("actIco").textContent = o.ico || "🧾";
  $("actTit").textContent = o.tit || (S.datos && S.datos.negocio) || "Caja";
  $("actTxt").innerHTML = o.html || "";
  $("actForm").innerHTML = o.form || "";
  $("actBtns").innerHTML = o.btns || "";
}
function pantallaCargando(txt){ pantalla({ ico: "🧾", html: '<p><span class="sp"></span>' + esc(txt) + "</p>" }); }

// ── Arranque: equipo → usuario → datos → vender ──
// Vino del sistema con #pase=…: se canjea por una sesión del mismo usuario (sirve una vez y por un minuto)
async function entrarConPase(){
  const m = String(location.hash || "").match(/[#&]pase=([A-Za-z0-9]{20,80})/);
  if (!m) return;
  history.replaceState(null, "", location.pathname + location.search);   // es una llave: se quita de la barra
  pantallaCargando("Entrando…");
  try {
    const r = await api("cj_canje", { pase: m[1] }, 30000);
    if (r && r.ok && r.token) {
      if (S.ses && S.ses.token && S.ses.token !== r.token) api("cj_salir", { sesion: S.ses.token }, 15000).catch(() => {});   // la sesión anterior se cierra
      await guardarSesion(r);
      S.paseCaja = Number(r.caja) || 0;
    } else S.avisoPase = (r && r.msg) || "";
  } catch (e) { S.avisoPase = "No se pudo usar el pase del sistema (" + e.message + ")."; }
}
async function continuarArranque(){
  if (await arranqueSistema()) return;   // 5.0i · Tanda 3B-1: con el sistema nuevo, se entra a una caja sin activar el equipo
  // 1) El equipo
  if (!S.eq) {
    if (navigator.onLine === false) {
      pantalla({ ico: "📡", html: "<p>Este equipo todavía no está activado para la caja. La primera vez necesita <b>internet</b>.</p>",
        btns: '<button type="button" class="btn green" onclick="location.reload()">🔄 Reintentar</button>' });
      return;
    }
    if (!sesionViva()) {
      pantallaLogin((S.avisoPase ? esc(S.avisoPase) + "<br><br>" : "") + "Este equipo todavía no está activado para la caja. Entra con tu usuario para activarlo (hace falta la <b>clave maestra</b>).");
      S.avisoPase = "";
      return;
    }
    pantallaActivar();
    return;
  }
  // 2) El usuario: un equipo activado entra directo (los cajeros solo eligen su nombre y ponen su PIN)
  if (!sesionViva()) {
    pantallaCargando("Entrando…");
    if (await entrarDirecto()) { continuarArranque(); return; }
    pantallaLogin(S.avisoPase ? esc(S.avisoPase) : ""); S.avisoPase = ""; return;
  }
  // 3) Los datos de la caja
  if (!S.datos) {
    pantalla({ ico: "⬇️", html: "<p>Ahora hay que descargar los productos, los clientes y las tasas de la <b>Caja " + esc(S.eq.caja) + "</b>. Necesita <b>internet</b> esta vez.</p>",
      btns: '<button type="button" class="btn green" id="btnPrimera" onclick="primeraDescarga(this)">⬇️ Descargar datos</button>' });
    primeraDescarga($("btnPrimera"));
    return;
  }
  const yaEstaba = _listoYa;
  listo();
  if (yaEstaba) actualizarDatos(null, true);
  if (S.paseCaja && Number(S.paseCaja) !== Number(S.eq.caja)) {
    aviso({ icono: "🧾", titulo: "Este equipo es de la Caja " + S.eq.caja, html: "Tocaste la <b>Caja " + S.paseCaja + "</b> en el sistema, pero este equipo está activado para la <b>Caja " + esc(S.eq.caja) + "</b>: aquí se vende como Caja " + esc(S.eq.caja) + "." });
  }
  S.paseCaja = 0;
}

// ══ CAJA 5.0 · TANDA 3B-1 (14-11-2026): entrar a una caja SIN activar el equipo ══
//  Si el sistema dice acceso «sistema» (cj_ping), no hay clave maestra: al entrar con el usuario (el pase de la tarjeta
//  del Index, o usuario y contraseña) el sistema le da a este equipo la llave de ESA caja (una por caja: el
//  administrador puede vender en varias). Con un sistema viejo, o con un equipo activado de antes que tiene un turno
//  abierto, todo sigue como siempre.
//  El turno: si la caja ya tiene un turno abierto del MISMO cajero (en otro equipo), este equipo lo sigue («adoptar»)
//  y el otro deja de vender. Si es de otro cajero y entra el administrador, vende en ese turno como administrador.
async function dispId(){
  let d = await kvGet("disp");
  if (!d) { d = uuid().replace(/-/g, "").slice(0, 16); await kvSet("disp", d); }
  return d;
}
function nombreDisp(){
  const ua = navigator.userAgent || "";
  return /android/i.test(ua) ? "Teléfono Android" : /iphone|ipad/i.test(ua) ? "iPhone o iPad" : /windows/i.test(ua) ? "PC Windows" : /mac/i.test(ua) ? "Mac" : "Equipo";
}
async function accesoSistema(){
  if (S.acceso === "sistema" || S.acceso === "viejo") return S.acceso === "sistema";
  const guardado = await kvGet("acceso");
  const preguntar = async () => {
    try { const r = await api("cj_ping", {}, 20000); if (r && r.ok) { const a = r.acceso === "sistema" ? "sistema" : "viejo"; await kvSet("acceso", a); return a; } } catch (e) {}
    return "";
  };
  if (guardado) { S.acceso = guardado; if (navigator.onLine !== false) preguntar(); }   // lo de la vez pasada; se revisa por detrás para la próxima
  else S.acceso = (navigator.onLine !== false ? await preguntar() : "") || "";
  return S.acceso === "sistema";
}
function esAdminSes(){ const u = S.ses && S.ses.usuario; return !!u && (String(u.rol || "").toLowerCase() === "admin" || modsSesion().indexOf("todos") >= 0); }
function usuarioSes(){ const u = S.ses && S.ses.usuario; return u ? String(u.usuario || "") : ""; }
function hayPendientes(){ return (S.ventas || []).some(v => v.estado === "por_subir") || (S.cierres || []).some(c => !c.subido); }
// true si se encargó del arranque (mostró una pantalla); false para seguir con el arranque de siempre
async function arranqueSistema(){
  if (!(await accesoSistema())) return false;
  if (S.eq && !S.eq.auto && S.turno) return false;   // equipo activado de antes con su turno abierto: sigue así hasta cerrarlo
  if (!sesionViva()) {
    if (S.eq && S.eq.auto) return false;   // la llave de esta caja vuelve a entrar sola (o pide usuario)
    pantallaLogin((S.avisoPase ? esc(S.avisoPase) + "<br><br>" : "") + "Entra con tu usuario y contraseña del sistema.");
    S.avisoPase = "";
    return true;
  }
  if (sesionDirecta()) return false;   // sesión renovada con la llave: solo de esta caja
  const quiere = Number(S.paseCaja) || (S.eq && S.eq.auto ? Number(S.eq.caja) : 0);
  if (!quiere) { pantallaElegirCaja(); return true; }
  if (S.entroCaja === quiere && S.eq && S.eq.auto && Number(S.eq.caja) === quiere) { S.paseCaja = 0; return false; }   // ya entró en esta carga de la página
  if (navigator.onLine === false) return !(S.eq && S.eq.auto && Number(S.eq.caja) === quiere) ? (pantalla({ ico: "📡", html: "<p>Para entrar a la <b>Caja " + quiere + "</b> la primera vez hace falta <b>internet</b>.</p>", btns: '<button type="button" class="btn green" onclick="location.reload()">🔄 Reintentar</button>' }), true) : false;
  // Cambiar de caja con un turno abierto o ventas sin subir: no (se mezclarían)
  if (S.eq && Number(S.eq.caja) !== quiere && (S.turno || hayPendientes())) {
    S.paseCaja = 0;
    aviso({ icono: "🧾", titulo: "Este equipo está en la Caja " + esc(S.eq.caja), html: S.turno ? "Aquí está abierto el turno de <b>" + esc(S.turno.cajeroNombre) + "</b> en la Caja " + esc(S.eq.caja) + ". Para entrar a la Caja " + quiere + " en este equipo, primero cierra ese turno." : "Este equipo tiene ventas de la Caja " + esc(S.eq.caja) + " sin subir. Cuando suban (con internet), podrás entrar a la Caja " + quiere + "." });
    return false;
  }
  pantallaCargando("Entrando a la Caja " + quiere + "…");
  const llaves = (await kvGet("llaves")) || {};
  let r = null;
  try { r = await api("cj_entrar_caja", { caja: quiere, disp: await dispId(), nombreDisp: nombreDisp(), token: llaves[quiere] || (S.eq && S.eq.auto && Number(S.eq.caja) === quiere ? S.eq.token : "") }, 30000); }
  catch (e) {
    if (S.eq && S.eq.auto && Number(S.eq.caja) === quiere) return false;   // sin conexión: sigue con lo que tenía
    pantalla({ ico: "📡", html: "<p>No se pudo entrar a la Caja " + quiere + ": " + esc(e.message) + "</p>", btns: '<button type="button" class="btn green" onclick="location.reload()">🔄 Reintentar</button>' });
    return true;
  }
  S.paseCaja = 0;
  if (!r || !r.ok) {
    if (r && r.codigo === "SESION") return true;   // ya pidió entrar otra vez
    pantalla({ ico: "🧾", html: "<p>" + esc((r && r.msg) || "El sistema no respondió.") + "</p>",
      btns: '<button type="button" class="btn" onclick="irSistema(this)">🏠 Volver al inicio</button>' });
    return true;
  }
  const cambia = !S.eq || Number(S.eq.caja) !== Number(r.caja);
  const token = r.token || llaves[r.caja] || (S.eq && S.eq.token) || "";
  llaves[r.caja] = token;
  await kvSet("llaves", llaves);
  S.eq = { token: token, equipo: r.equipo, caja: r.caja, nombre: r.nombre, auto: true, activado: ahoraTxt() };
  await kvSet("equipo", S.eq);
  if (cambia) await borrarDatosDelEquipo();   // los datos de la otra caja (las ventas sin subir no: no hay)
  S.permisoMal = ""; S.reemplazado = false;
  S.entroCaja = Number(r.caja);
  await turnoDelSistema(r);
  return false;   // sigue: datos → vender (o abrir turno)
}
// Lo que dice el sistema del turno de esta caja → el turno de este equipo
async function turnoDelSistema(r){
  const t = r.turno, yo = usuarioSes().toLowerCase();
  const loc = S.turno;
  if (loc && loc.invitado && (!t || t.id !== loc.id)) { S.turno = null; await kvSet("turno", null); }   // el turno donde vendía como administrador ya se cerró
  else if (loc && (!t || t.id !== loc.id) && !(S.ventas || []).some(v => v.turno === loc.id && v.estado === "por_subir")) {   // 5.0l: se cerró en otro equipo
    S.turno = null; await kvSet("turno", null);
    aviso({ icono: "🔒", titulo: "Tu turno ya se cerró", html: "El turno de <b>" + esc(loc.cajeroNombre) + "</b> que estaba abierto en este equipo se cerró desde otro equipo (por ejemplo, el administrador). Para vender, abre un turno nuevo." });
  }
  if (!t) return;
  const u0 = (S.ses && S.ses.usuario) || {}, nomT = String(t.cajeroNombre || "").trim().toLowerCase();
  const mio = yo && (String(t.cajeroId || "").toLowerCase() === yo ||   // 5.0m: un turno viejo sin usuario anotado: por el nombre
    (!t.cajeroId && nomT && (nomT === yo || nomT === String(u0.nombre || "").trim().toLowerCase())));
  if (mio && (!S.turno || S.turno.id === t.id) && t.equipo !== r.equipo) {   // el mismo cajero: sigue su turno en este equipo
    let a = null;
    try { a = await api("cj_turno", { op: "adoptar", id: t.id }, 30000); } catch (e) { a = null; }
    if (!(a && a.ok && a.turno) && !(a && a.codigo === "CERRADO")) a = { ok: true, turno: t };   // 5.0p: es su turno: sigue en él aunque el sistema no lo haya anotado (los dos equipos venden)
    if (a && a.ok && a.turno) {
      const x = a.turno;
      S.turno = Object.assign({}, S.turno || {}, { id: x.id, cajeroId: x.cajeroId, cajeroNombre: x.cajeroNombre, apertura: x.apertura, aperturaMs: x.aperturaMs,
        fondoBs: x.fondoBs, fondoUsd: x.fondoUsd, avisado: true, adoptado: !S.turno || !!S.turno.invitado });
      delete S.turno.invitado; delete S.turno.de; delete S.turno.cierraAdmin;   // 5.0m: es su turno (no vende como invitado)
      S.turnoOtro = "";
      await kvSet("turno", S.turno);
      toast("✅ Estás en tu turno de la Caja " + r.caja);
    } else if (a && a.msg) aviso({ icono: "🔒", titulo: "Ese turno ya se cerró", html: esc(a.msg) + " Para vender, abre un turno nuevo." });
    return;
  }
  if (mio && S.turno && S.turno.id === t.id) return;   // ya era de este equipo
  if (!mio && r.admin && !S.turno) {   // el administrador vende en el turno de otro cajero
    const u = S.ses.usuario || {};
    S.turno = { id: t.id, cajeroId: String(u.usuario || ""), cajeroNombre: String(u.nombre || u.usuario || "") + " (administrador)", apertura: t.apertura, aperturaMs: t.aperturaMs,
                fondoBs: 0, fondoUsd: 0, avisado: true, invitado: true, de: t.cajeroNombre };
    await kvSet("turno", S.turno);
    aviso({ icono: "⭐", titulo: "Vendes en la caja de " + esc(t.cajeroNombre), html: "La <b>Caja " + esc(r.caja) + "</b> tiene abierto el turno de <b>" + esc(t.cajeroNombre) + "</b>. Lo que vendas aquí queda como venta del <b>administrador</b>, pero el dinero es de esta caja y entra en el cierre de ese turno." });
  }
}
// Sin pase (se abrió la caja directo): ¿a qué caja entra?
function pantallaElegirCaja(){
  const l = esAdminSes() ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5].filter(puedeCaja);
  if (l.length === 1) { S.paseCaja = l[0]; continuarArranque(); return; }
  if (!l.length) { pantalla({ ico: "🔒", html: "<p>Tu usuario no tiene ninguna caja. El administrador te la asigna en <b>Configuración → Usuarios</b>.</p>", btns: '<button type="button" class="btn" onclick="cerrarSesion(this)">🚪 Entrar con otro usuario</button>' }); return; }
  pantalla({ ico: "🧾", html: "<p>¿A qué caja entras?</p>",
    btns: '<div class="ac-cajas">' + l.map(n => '<button type="button" class="btn green" onclick="S.paseCaja=' + n + ';continuarArranque()">Caja ' + n + "</button>").join(" ") + "</div>" });
}

// ── Usuario y clave ──
function pantallaLogin(motivo){
  pantalla({ ico: "🔐",
    html: (motivo ? "<p>" + motivo + "</p>" : "") + "<p>Entra con tu usuario y tu clave del sistema.</p>",
    form: '<label class="lbl" for="lgUsu">Usuario</label><input class="inp" id="lgUsu" autocomplete="username" autocapitalize="off" placeholder="Tu usuario">' +
          '<label class="lbl" for="lgCla">Clave</label><input class="inp" id="lgCla" type="password" autocomplete="current-password" placeholder="Tu clave">',
    btns: '<button type="button" class="btn green block" id="btnEntrar" onclick="entrar(this)">Entrar →</button>' });
  $("lgUsu").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("lgCla").focus(); } });
  $("lgCla").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); entrar($("btnEntrar")); } });
  setTimeout(() => { const i = $("lgUsu"); if (i) i.focus(); }, 60);
}
async function entrar(btn){
  if (btn && btn.disabled) return;
  const u = $("lgUsu").value.trim(), c = $("lgCla").value;
  if (!u || !c) { aviso({ icono: "🔐", titulo: "Faltan datos", html: "Escribe tu usuario y tu clave." }); return; }
  btnOcupado(btn, "Entrando…");
  let r;
  try { r = await api("cj_login", { usuario: u, clave: c }, 30000); }
  catch (e) { btnLibre(btn); aviso({ icono: "📡", titulo: "No se pudo entrar", html: esc(e.message) + (e.red ? "<br><br>Para entrar hace falta internet." : "") }); return; }
  if (!r || !r.ok) { btnLibre(btn); aviso({ icono: "🔐", titulo: "No se pudo entrar", html: esc((r && r.msg) || "El sistema no respondió.") }); return; }
  if (S.ses && S.ses.token) api("cj_salir", { sesion: S.ses.token }, 15000).catch(() => {});
  await guardarSesion(r);
  btnLibre(btn);
  toast("✅ Hola, " + (r.usuario.nombre || r.usuario.usuario));
  S.datosMal = ""; S.permisoMal = ""; S.pedirPin = true;   // 2.9: con un turno abierto, el cajero pone su PIN
  continuarArranque();
}

// ── Activar este equipo (una vez, con la clave maestra) ──
// 3.9: en dos pasos. 1) ¿Qué caja es este equipo? (tarjetas grandes; cada una dice si está libre o qué equipo
// la usa) · 2) nombre del equipo y clave maestra. Con permiso de una sola caja, el paso 1 no sale.
const AC = { cajas: [], caja: 0, uso: null, reemplaza: null };
function pantallaActivar(){
  const cajas = [1, 2, 3, 4, 5].filter(puedeCaja);
  const u = (S.ses && S.ses.usuario) || {};
  if (!cajas.length) {
    pantalla({ ico: "⛔", html: "<p><b>" + esc(u.nombre || u.usuario) + "</b> no tiene permiso para ninguna caja. Entra con otro usuario.</p>",
      btns: '<button type="button" class="btn green" onclick="pedirEntrarOtraVez()">🔐 Entrar con otro usuario</button>' });
    return;
  }
  AC.cajas = cajas; AC.uso = null; AC.reemplaza = null;
  AC.caja = cajas.indexOf(Number(S.paseCaja)) >= 0 ? Number(S.paseCaja) : 0;
  if (cajas.length === 1) { AC.caja = cajas[0]; acPaso2(); return; }
  acPaso1();
  acCargarUso();
}
// Qué equipos usan cada caja (con internet). Si no llega, las tarjetas salen sin esa información.
async function acCargarUso(){
  let r = null;
  try { r = await api("cj_cajas_uso", {}, 20000); } catch (e) { r = null; }
  AC.uso = {};
  if (r && r.ok && Array.isArray(r.cajas)) r.cajas.forEach(c => { AC.uso[Number(c.caja)] = (c.equipos || []).filter(e => e && e.nombre); });
  else AC.uso = false;   // el sistema no lo dijo (versión anterior o sin conexión)
  if ($("acTarjetas")) acPaso1();
}
function acUsoDe(n){ return AC.uso && AC.uso[n] ? AC.uso[n] : []; }
function acCuando(iso){
  const t = new Date(String(iso || "")).getTime();
  if (!(t > 0)) return "";
  const d = new Date(t), hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const dias = Math.round((hoy.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 864e5);
  return dias <= 0 ? "hoy" : dias === 1 ? "ayer" : "hace " + dias + " días";
}
function acSugerida(){
  if (AC.caja) return AC.caja;
  if (!AC.uso) return 0;
  const libre = AC.cajas.find(n => !acUsoDe(n).length);
  return libre || 0;
}
function acPaso1(){
  const sug = acSugerida();
  const tarjeta = n => {
    const eqs = acUsoDe(n);
    let sub;
    if (AC.uso === null) sub = '<span class="sp" style="width:10px;height:10px;"></span> Revisando…';
    else if (AC.uso === false) sub = "";
    else if (!eqs.length) sub = "✅ Libre";
    else sub = "Ya la usa «" + esc(eqs[0].nombre) + "»" + (acCuando(eqs[0].ultimoUso) ? " · último uso " + acCuando(eqs[0].ultimoUso) : "") + (eqs.length > 1 ? " y " + (eqs.length - 1) + " más" : "");
    return '<button type="button" class="pw-op ac-caja' + (n === sug ? " on" : "") + (eqs.length ? " ocupada" : "") + '" onclick="acElegir(' + n + ')">' +
      '<span class="pw-ico">🧾</span><span class="pw-t"><b>Caja ' + n + (n === sug ? ' <span class="ac-sug">Sugerida</span>' : "") + "</b>" + (sub ? "<small>" + sub + "</small>" : "") + "</span></button>";
  };
  pantalla({ ico: "🔌",
    html: "<p>Este equipo todavía no está activado para la caja. Se hace <b>una sola vez</b>: después vende aunque se vaya el internet.</p>" +
          '<div class="pw-preg ac-preg"><span class="ac-paso">Paso 1 de 2</span>¿Qué caja es este equipo?</div>',
    form: '<div class="pw-ops ac-ops" id="acTarjetas">' + AC.cajas.map(tarjeta).join("") + "</div>" +
          '<div class="act-nota ac-nota">' + (AC.uso && AC.cajas.some(n => acUsoDe(n).length)
            ? "¿Este equipo <b>reemplaza a otro</b> (se dañó o ya no se usa)? Toca la caja del otro.<br>¿Es un equipo <b>más</b>, que cobra al mismo tiempo? Toca una caja <b>libre</b>: así cada uno cuadra su propia caja."
            : "¿Cobran en <b>un solo equipo</b>? Toca <b>Caja " + AC.cajas[0] + "</b>.<br>¿Cobran en <b>varios a la vez</b> (dos computadoras, un teléfono…)? Cada equipo es una caja distinta: así cada uno cuadra su propia caja.") + "</div>",
    btns: '<div style="margin-top:4px;"><button type="button" class="btn sm" onclick="pedirEntrarOtraVez()">Entrar con otro usuario</button></div>' });
}
async function acElegir(n){
  const eqs = acUsoDe(n);
  AC.reemplaza = null;
  if (eqs.length) {
    const nom = esc(eqs[0].nombre), uso = acCuando(eqs[0].ultimoUso);
    const r = await modal({ icono: "🧾", titulo: "La Caja " + n + " ya tiene un equipo", centrado: true,
      html: '<div class="m-txt">La <b>Caja ' + n + "</b> ya la usa <b>«" + nom + "»</b>" + (uso ? " (último uso " + uso + ")" : "") + (eqs.length > 1 ? " y " + (eqs.length - 1) + " equipo(s) más" : "") + ".<br><br>" +
        "• Si <b>este equipo la reemplaza</b> (el otro se dañó o ya no se usa), sigue: <b>«" + nom + "»</b> queda dado de baja solo y ya no podrá abrir la Caja " + n + ". Si tenía ventas sin subir, todavía las puede subir.<br>" +
        "• Si <b>cobran los dos a la vez</b>, elige otra caja: cada caja trabaja en un solo equipo.</div>",
      botones: [{ txt: "Elegir otra caja", v: false }, { txt: "Sí, este la reemplaza", v: true, cls: "naranja" }] });
    if (!r) return;
    AC.reemplaza = eqs[0].nombre;
  }
  AC.caja = n;
  acPaso2();
}
function acPaso2(){
  const n = AC.caja, u = (S.ses && S.ses.usuario) || {}, varias = AC.cajas.length > 1;
  pantalla({ ico: "🔌",
    html: (varias ? "" : "<p>Este equipo todavía no está activado para la caja. Se hace <b>una sola vez</b>: después vende aunque se vaya el internet.</p>") +
          '<div class="pw-preg ac-preg">' + (varias ? '<span class="ac-paso">Paso 2 de 2</span>' : "") + "Este equipo será la <b>Caja " + n + "</b></div>",
    form: '<input type="hidden" id="acCaja" value="' + n + '">' +
          '<label class="lbl" for="acNom">Nombre del equipo</label><input class="inp" id="acNom" maxlength="40" placeholder="Ej. PC de la caja ' + n + ', Celular de María">' +
          '<label class="lbl" for="acMae">Clave maestra</label><input class="inp" id="acMae" type="password" autocomplete="off" placeholder="La del administrador">' +
          '<div class="act-nota">Lo activa <b>' + esc(u.nombre || u.usuario) + "</b>. Después de activarlo, cada cajero entra tocando su nombre y poniendo su contraseña del sistema (en <b>Configuración → Usuarios</b> se le da el permiso de la <b>Caja ' + n + '</b>). Si después hay que quitarle el permiso al equipo: Configuración → Administración → Caja nueva.</div>",
    btns: '<button type="button" class="btn green block" id="btnActivar" onclick="activarEquipo(this)">✅ Activar este equipo</button>' +
          '<div style="margin-top:8px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">' +
          (varias ? '<button type="button" class="btn sm" id="btnAcVolver" onclick="acPaso1()">← Cambiar de caja</button>' : "") +
          '<button type="button" class="btn sm" onclick="pedirEntrarOtraVez()">Entrar con otro usuario</button></div>' });
  $("acNom").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("acMae").focus(); } });
  $("acMae").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); activarEquipo($("btnActivar")); } });
  setTimeout(() => { const i = $("acNom"); if (i) i.focus(); }, 60);
}
async function activarEquipo(btn){
  if (btn && btn.disabled) return;
  const caja = Number($("acCaja").value) || 0, nombre = $("acNom").value.trim(), mae = $("acMae").value;
  if (!nombre) { aviso({ icono: "🖥️", titulo: "Falta el nombre", html: "Ponle un nombre al equipo para reconocerlo después, por ejemplo <b>PC de la caja 1</b> o <b>Celular de María</b>." }); return; }
  if (!mae) { aviso({ icono: "🔐", titulo: "Falta la clave maestra", html: "Escribe la <b>clave maestra</b> para activar el equipo." }); return; }
  btnOcupado(btn, "Activando…");
  let r;
  try { r = await api("cj_activar", { caja: caja, nombre: nombre, claveMaestra: mae }, 30000); }
  catch (e) { btnLibre(btn); aviso({ icono: "📡", titulo: "No se activó", html: esc(e.message) }); return; }
  if (!r || !r.ok) { btnLibre(btn); if (r && r.codigo === "SESION") return; aviso({ icono: "⛔", titulo: "No se activó", html: esc((r && r.msg) || "El sistema no respondió.") }); return; }
  const cambiaCaja = S.datos && Number(S.datos.caja) !== Number(r.caja);
  S.eq = { token: r.token, equipo: r.equipo, caja: r.caja, nombre: r.nombre, activado: ahoraTxt() };
  await kvSet("equipo", S.eq);
  await borrarDatosDelEquipo();   // datos y números del equipo anterior (si lo hubo); las ventas sin subir se quedan
  if (cambiaCaja && S.turno) aviso({ icono: "🧾", titulo: "Hay un turno abierto de otra caja", html: "Ciérralo cuando puedas: las ventas nuevas quedan como de la Caja " + r.caja + "." });
  S.permisoMal = ""; S.datosMal = ""; S.reemplazado = false;
  btnLibre(btn);
  toast("✅ Equipo activado: " + r.equipo);
  AC.reemplaza = null;
  if (r.reemplazados && r.reemplazados.length)   // 4.1 · un solo equipo por caja: el sistema dio de baja al otro
    aviso({ icono: "🧾", titulo: "Este equipo reemplazó a otro", html: "Este equipo ya es la <b>Caja " + esc(r.caja) + "</b>. <b>«" + r.reemplazados.map(esc).join("», «") + "»</b> quedó dado de baja: ya no puede abrir la Caja " + esc(r.caja) + "." });
  S.pedirPin = true;   // 2.9: después de activar, lo primero es el cajero (o el PIN del turno abierto)
  continuarArranque();
}
// El sistema dijo que este equipo ya no tiene permiso (dado de baja o activado en otro lado): activarlo de nuevo
async function olvidarEquipo(){
  if (ventaAMedias()) { aviso({ icono: "🧾", titulo: "Hay una venta a medias", html: "Termina la venta (o vacíala con 🗑️) antes de activar el equipo otra vez." }); return; }
  if (!await confirmar({ icono: "🔌", titulo: "Activar este equipo otra vez", ok: "Sí, activar", html: "Hace falta un usuario con permiso de la caja y la <b>clave maestra</b>. Las ventas guardadas en este equipo no se borran: se suben con el permiso nuevo." })) return;
  S.eq = null; S.permisoMal = ""; S.reemplazado = false;
  await kvSet("equipo", null);
  pintarBanners();
  continuarArranque();
}

// ── La sesión venció o el usuario no tiene permiso para esta caja (lo avisa api.js) ──
async function sesionProblema(res){
  // La sesión venció: el equipo vuelve a entrar solo (sin molestar al cajero). Si no se puede, como antes.
  if (res && res.codigo === "SESION" && S.eq && S.ses) {
    S.ses.token = "";   // la vieja ya no sirve
    if (await entrarDirecto()) { setTimeout(() => { if (S.datos) actualizarDatos(null, true); }, 800); return; }
  }
  S.sesionMal = res.msg || "Tu sesión venció.";
  if (S.vista !== "activar" && ventaAMedias()) { pintarBanners(); return; }   // primero se termina la venta
  pedirEntrarOtraVez();
}
async function pedirEntrarOtraVez(){
  const msg = S.sesionMal;
  S.sesionMal = "";
  if (S.ses) await borrarSesion();
  pintarBanners();
  pantallaLogin(msg ? esc(msg) : "");
}
async function cerrarSesion(btn){
  if (S.online === false || navigator.onLine === false) {
    aviso({ icono: "📡", titulo: "Sin internet", html: "Para volver a entrar hace falta internet: si cierras la sesión ahora, nadie podrá vender en esta caja hasta que vuelva la conexión. Ciérrala cuando haya internet." });
    return;
  }
  if (ventaAMedias()) { aviso({ icono: "🧾", titulo: "Hay una venta a medias", html: "Termina la venta (o vacíala con 🗑️) antes de cerrar la sesión." }); return; }
  if (!await confirmar({ icono: "🚪", titulo: "Entrar con otro usuario", ok: "Sí, salir", colorOk: "naranja",
    html: "Se sale de esta sesión y la caja pide usuario y contraseña. El usuario que entre queda como el de este equipo: la próxima vez la caja entra directo con él." + (S.turno ? "<br><br>El turno de <b>" + esc(S.turno.cajeroNombre) + "</b> sigue abierto." : "") })) return;
  btnOcupado(btn, "Cerrando…");
  try { await api("cj_salir", {}, 15000); } catch (e) {}
  btnLibre(btn);
  await borrarSesion();
  S.noDirecta = true;   // hasta que alguien entre: no vuelve a entrar sola
  pantallaLogin("Entra con tu usuario y clave.");
}

// ── 🏠 Sistema: vuelve a la pestaña del sistema, o la abre con un pase de un solo uso ──
async function irSistema(btn){
  if (btn && btn.disabled) return;
  if (S.online === false || navigator.onLine === false) {
    aviso({ icono: "📡", titulo: "Sin internet", html: "El sistema necesita internet. La caja sigue funcionando aquí: puedes seguir vendiendo." });
    return;
  }
  if (!sesionViva()) { aviso({ icono: "🔐", titulo: "Primero entra", html: "Entra con tu usuario y clave para abrir el sistema." }); return; }
  irSistemaAqui(btn); return;   // 5.0j: vuelve a la pestaña del sistema (lo de abajo quedó de antes)
  // 1) Si el sistema abrió esta caja y sigue abierto, se vuelve a esa pestaña
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.focus();
      await espera(350);
      if (document.visibilityState === "hidden") return;
    }
  } catch (e) {}
  // 2) Si no, se abre (o se reusa) la pestaña del sistema
  let w = null;
  try { w = window.open("", "cm_sistema"); } catch (e) { w = null; }
  if (!w) { aviso({ icono: "🪟", titulo: "El navegador bloqueó la ventana", html: "Permite las ventanas emergentes de esta página y vuelve a tocar <b>🏠 Sistema</b>." }); return; }
  let nueva = true;
  try { nueva = !w.location.href || w.location.href === "about:blank"; } catch (e) { nueva = false; }   // otra dirección = el sistema ya está ahí
  if (!nueva) { try { w.focus(); } catch (e) {} return; }
  try { w.document.title = "Sistema"; w.document.body.innerHTML = '<p style="font-family:sans-serif;padding:24px;color:#555;">Abriendo el sistema…</p>'; } catch (e) {}
  btnOcupado(btn, "Abriendo…");
  let r = null;
  try { r = await api("cj_pase", {}, 30000); } catch (e) { r = { ok: false, msg: e.message }; }
  btnLibre(btn);
  if (r && r.codigo === "SOLO_CAJA" && r.url) { try { w.location.href = r.url; w.focus(); } catch (e) { location.href = r.url; } return; }   // entrada directa: el sistema pide usuario y clave
  if (!r || !r.ok) {
    try { w.close(); } catch (e) {}
    if (r && r.codigo === "SESION") return;   // ya pidió entrar otra vez
    aviso({ icono: "🏠", titulo: "No se abrió el sistema", html: esc((r && r.msg) || "El sistema no respondió.") });
    return;
  }
  try { w.location.href = r.url; w.focus(); } catch (e) { location.href = r.url; }
}

// 5.0j · 🏠 Sistema: primero sube lo pendiente. Después vuelve a la pestaña del sistema:
//  1) si el navegador deja pasar a ella, pasa (la caja sigue abierta);
//  2) si no, y el sistema abrió esta caja, la caja se cierra y el navegador vuelve solo a la pestaña del sistema;
//  3) si la caja no la abrió el sistema (se abrió directo), el sistema se abre aquí mismo con un pase (sin pedir login).
async function irSistemaAqui(btn){
  if (ventaAMedias()) { aviso({ icono: "🧾", titulo: "Hay una venta a medias", html: "Termina la venta (o vacíala con 🗑️) antes de volver al inicio." }); return; }
  let n = (S.ventas || []).filter(v => v.estado === "por_subir").length;
  if (n && S.online !== false && navigator.onLine !== false) {   // 5.0k: solo si hay algo por subir (sin actualizar datos: eso es lo que tardaba)
    btnOcupado(btn, "Subiendo…");
    try { await sincronizar(false); } catch (e) {}
    n = (S.ventas || []).filter(v => v.estado === "por_subir").length;
    btnLibre(btn);
  }
  if (n && !await confirmar({ icono: "📤", titulo: n === 1 ? "Falta subir 1 venta" : "Faltan subir " + n + " ventas", ok: "Volver al inicio igual", colorOk: "naranja",
      html: "Todavía no suben al sistema. Quedan guardadas en este equipo y se suben solas la próxima vez que abras la caja con internet." })) return;
  let op = null;
  try { op = window.opener && !window.opener.closed ? window.opener : null; } catch (e) { op = null; }
  if (op) {
    try { op.focus(); } catch (e) {}
    await espera(350);
    if (document.visibilityState === "hidden") return;   // pasó a la pestaña del sistema
    try { window.close(); } catch (e) {}
    await espera(300);   // si el navegador la cerró, aquí termina
  }
  btnOcupado(btn, "Abriendo…");
  let r = null;
  try { r = await api("cj_pase", {}, 30000); } catch (e) { r = { ok: false, msg: e.message }; }
  if (r && (r.ok || r.codigo === "SOLO_CAJA") && r.url) { location.href = r.url; return; }
  btnLibre(btn);
  if (r && r.codigo === "SESION") return;
  aviso({ icono: "🏠", titulo: "No se abrió el sistema", html: esc((r && r.msg) || "El sistema no respondió.") });
}
