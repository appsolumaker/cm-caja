"use strict";
// ══════════════════════════════════════════════════════════════
//  TANDA 2 · caja 3.9 (8-11-2026)
//   · 📷 Escanear con la cámara del teléfono o la tablet: lee el código de barras y lo agrega a la factura.
//     Se pueden leer varios seguidos sin cerrar la cámara. Usa el lector del navegador (Android) o ZXing
//     (iPhone), guardado en el equipo: también funciona sin internet.
//   · 🔎 Facturas anteriores del sistema (con internet): buscar por número, cliente, cédula o fecha y reimprimir.
//     Si Configuración pide clave para reimprimir, es la de precio manual (la misma de Ventas).
//   · Cada venta ya subida deja en el sistema su copia para reimprimir (desde la caja, Ventas o Historial).
//   · 🛠️ Nuevo servicio (con internet y la clave maestra): queda en el sistema y entra a la factura.
//   · 4.9: ✏️ Editar servicio (nombre, precio e IVA; el costo no se toca) y, con TasaBin, cómo queda guardado el precio.
// ══════════════════════════════════════════════════════════════

// ══ 📷 ESCÁNER ══
const ESC = { on: false, stream: null, track: null, det: null, t: null, zx: null, cv: null, ctx: null, motor: "",
              last: "", lastSeen: 0, ocupado: false, n: 0, torch: false, errN: 0, audio: null, fbT: null };
const ESC_AUSENTE_MS = 1500, ESC_DET_MS = 110, ESC_ZX_MS = 150, ESC_ZX_ANCHO = 1280;
function escHayCamara(){ return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
function escHTML(){
  return '<div class="esc-top"><b>📷 Escanear productos</b><span class="sep"></span><button type="button" class="esc-x" onclick="cerrarEscaner()" title="Cerrar">✕</button></div>' +
    '<div class="esc-stage"><video id="escVideo" autoplay playsinline muted></video>' +
    '<div class="esc-frame"><div class="esc-box"><i></i></div></div><div class="esc-laser"></div>' +
    '<button type="button" class="esc-torch" id="escTorch" onclick="escLinterna()" title="Linterna">🔦</button>' +
    '<div class="esc-hint">Pon el código dentro del recuadro, a unos 20 cm, y espera a que enfoque</div>' +
    '<div class="esc-ov" id="escOv"><h3 id="escOvTit">📷 Escáner</h3><p id="escOvTxt"></p><button type="button" class="btn green" id="escOvBtn" onclick="escIniciar()">Iniciar cámara</button></div></div>' +
    '<div class="esc-fb" id="escFb">Listo para escanear</div>' +
    '<div class="esc-bot"><button type="button" class="btn green block" id="escFin" onclick="cerrarEscaner()">✓ Listo</button></div>';
}
function abrirEscaner(){
  if (typeof puedeVender === "function" && !puedeVender()) return;
  let f = $("escFondo");
  if (!f) { f = document.createElement("div"); f.id = "escFondo"; f.className = "esc-fondo"; f.innerHTML = escHTML(); document.body.appendChild(f); }
  f.classList.add("on");
  ESC.n = 0; escBtnFin();
  if (!escHayCamara()) { escOverlay("Cámara no disponible", "Este navegador no deja usar la cámara. En iPhone abre la caja en Safari (no dentro de WhatsApp, Instagram u otra app).", "Reintentar"); return; }
  escIniciar();
}
function cerrarEscaner(){
  escParar();
  const f = $("escFondo"); if (f) f.classList.remove("on");
  if (ESC.n) {
    toast("🧾 " + (ESC.n === 1 ? "Se agregó 1 producto" : "Se agregaron " + ESC.n + " productos") + " con la cámara");
    if (window.innerWidth <= 820 && typeof mvTab === "function") mvTab("factura");
  }
}
function escOverlay(tit, txt, btn){
  $("escOvTit").textContent = tit; $("escOvTxt").textContent = txt || "";
  const b = $("escOvBtn"); if (btn) { b.textContent = btn; b.style.display = ""; } else b.style.display = "none";
  $("escOv").style.display = "flex";
}
function escFb(txt, cls){
  const f = $("escFb"); if (!f) return;
  f.textContent = txt; f.className = "esc-fb" + (cls ? " " + cls : "");
  clearTimeout(ESC.fbT);
  if (cls) ESC.fbT = setTimeout(() => { if ($("escFb")) escFb("Listo para escanear"); }, 2400);
}
function escBtnFin(){ const b = $("escFin"); if (b) b.textContent = ESC.n ? "✓ Listo (" + ESC.n + (ESC.n === 1 ? " agregado)" : " agregados)") : "✓ Listo"; }
function escBip(bien){
  try {
    ESC.audio = ESC.audio || new (window.AudioContext || window.webkitAudioContext)();
    if (ESC.audio.state === "suspended") ESC.audio.resume();
    const a = ESC.audio, o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination); o.type = "sine"; o.frequency.value = bien ? 880 : 210;
    g.gain.setValueAtTime(0.0001, a.currentTime); g.gain.exponentialRampToValueAtTime(0.28, a.currentTime + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.18);
    o.start(); o.stop(a.currentTime + 0.19);
  } catch (e) {}
  try { if (navigator.vibrate) navigator.vibrate(bien ? 40 : [80, 60, 80]); } catch (e) {}
}
async function escIniciar(){
  if (ESC.on) return;
  $("escOv").style.display = "none"; escFb("Iniciando cámara…");
  escBip(true);   // en iPhone el sonido se habilita con este toque
  try {
    ESC.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
  } catch (err) {
    escParar();
    let msg = "No se pudo usar la cámara.";
    if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) msg = "No hay permiso para usar la cámara. En iPhone: Ajustes → Safari → Cámara → Permitir. En Android: toca el candado de la barra de direcciones → Permisos → Cámara.";
    else if (err && err.name === "NotFoundError") msg = "Este equipo no tiene cámara.";
    else if (err && err.name === "NotReadableError") msg = "Otra aplicación está usando la cámara. Ciérrala y toca Reintentar.";
    escOverlay("No se pudo abrir la cámara", msg, "Reintentar");
    escFb("La cámara no está activa", "err");
    return;
  }
  const v = $("escVideo");
  v.setAttribute("playsinline", ""); v.muted = true; v.srcObject = ESC.stream;
  try { await v.play(); } catch (e) {}
  ESC.track = ESC.stream.getVideoTracks()[0];
  try { const c = ESC.track.getCapabilities ? ESC.track.getCapabilities() : {}; if (c.focusMode && c.focusMode.includes("continuous")) await ESC.track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch (e) {}
  try { const c = ESC.track.getCapabilities ? ESC.track.getCapabilities() : {}; $("escTorch").style.display = c && c.torch ? "flex" : "none"; } catch (e) {}
  ESC.on = true; ESC.errN = 0; ESC.last = "";
  ESC.det = await escDetector();
  if (ESC.det) { ESC.motor = "nativo"; escLoopNativo(); }
  else if (!await escIniciarZx()) return;
  escFb("Listo para escanear");
}
async function escDetector(){
  if (!("BarcodeDetector" in window)) return null;
  try {
    const sop = await window.BarcodeDetector.getSupportedFormats();
    if (!sop || !sop.length) return null;
    const want = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"].filter(f => sop.includes(f));
    return new window.BarcodeDetector(want.length ? { formats: want } : undefined);
  } catch (e) { return null; }
}
async function escLoopNativo(){
  if (!ESC.on || !ESC.det) return;
  const v = $("escVideo");
  if (v && v.readyState >= 2 && v.videoWidth > 0) {
    try { const f = await ESC.det.detect(v); ESC.errN = 0; if (f && f.length) escCodigo(f[0].rawValue); }
    catch (e) { if (++ESC.errN >= 5) { ESC.det = null; escIniciarZx(); return; } }   // el lector del navegador falla seguido: se pasa a ZXing
  }
  if (ESC.on && ESC.det) ESC.t = setTimeout(escLoopNativo, ESC_DET_MS);
}
// ZXing (iPhone / Safari): se carga una sola vez desde este equipo (zxing.min.js, guardado para usar sin internet)
function escCargarZx(){
  if (typeof ZXing !== "undefined") return Promise.resolve(true);
  return new Promise(ok => {
    const s = document.createElement("script"); s.src = "zxing.min.js?v=0.21.3";
    s.onload = () => ok(typeof ZXing !== "undefined"); s.onerror = () => ok(false);
    document.head.appendChild(s);
  });
}
async function escIniciarZx(){
  if (!await escCargarZx()) {
    escParar(); escOverlay("No se pudo cargar el lector", "Este equipo no tiene guardado el lector de códigos. Conéctate a internet una vez, abre la caja y vuelve a intentar.", "Reintentar");
    return false;
  }
  if (!ESC.on) return false;
  const h = new Map();
  h.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E,
    ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.ITF, ZXing.BarcodeFormat.QR_CODE]);
  h.set(ZXing.DecodeHintType.TRY_HARDER, true);
  ESC.zx = new ZXing.MultiFormatReader(); ESC.zx.setHints(h);
  ESC.cv = document.createElement("canvas");
  try { ESC.ctx = ESC.cv.getContext("2d", { willReadFrequently: true }); } catch (e) { ESC.ctx = null; }
  if (!ESC.ctx) ESC.ctx = ESC.cv.getContext("2d");
  ESC.motor = "ZXing";
  escLoopZx();
  return true;
}
function escLoopZx(){
  if (!ESC.on || !ESC.zx) return;
  const v = $("escVideo"), vw = v ? v.videoWidth : 0, vh = v ? v.videoHeight : 0;
  if (v && v.readyState >= 2 && vw > 0 && vh > 0) {
    try {
      const cw = Math.round(vw * 0.9), ch = Math.round(Math.min(vh, cw * 0.75)), sx = Math.round((vw - cw) / 2), sy = Math.round((vh - ch) / 2);
      const k = Math.min(1, ESC_ZX_ANCHO / cw), dw = Math.round(cw * k), dh = Math.round(ch * k);
      if (ESC.cv.width !== dw || ESC.cv.height !== dh) { ESC.cv.width = dw; ESC.cv.height = dh; }
      ESC.ctx.drawImage(v, sx, sy, cw, ch, 0, 0, dw, dh);
      const r = ESC.zx.decodeWithState(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(ESC.cv))));
      if (r) escCodigo(r.getText());
    } catch (e) { /* «no encontrado» es lo normal en la mayoría de los cuadros */ }
  }
  ESC.t = setTimeout(escLoopZx, ESC_ZX_MS);
}
function escParar(){
  ESC.on = false; clearTimeout(ESC.t);
  ESC.zx = null; ESC.det = null; ESC.motor = "";
  if (ESC.stream) { try { ESC.stream.getTracks().forEach(t => t.stop()); } catch (e) {} ESC.stream = null; }
  try { const v = $("escVideo"); if (v) v.srcObject = null; } catch (e) {}
  ESC.track = null; ESC.torch = false; ESC.last = "";
  const b = $("escTorch"); if (b) { b.classList.remove("on"); b.style.display = "none"; }
}
function escLinterna(){
  if (!ESC.track) return;
  ESC.torch = !ESC.torch;
  ESC.track.applyConstraints({ advanced: [{ torch: ESC.torch }] }).then(() => $("escTorch").classList.toggle("on", ESC.torch)).catch(() => { ESC.torch = !ESC.torch; });
}
// Un código leído. El mismo código vuelve a contar solo si salió del recuadro un momento (si no, se sumaría solo).
function escCodigo(code){
  code = String(code || "").trim(); if (!code || ESC.ocupado) return;
  const ahora = Date.now();
  if (code === ESC.last && ahora - ESC.lastSeen < ESC_AUSENTE_MS) { ESC.lastSeen = ahora; return; }
  ESC.last = code; ESC.lastSeen = ahora;
  escAgregarCodigo(code);
}
// Busca el código como el buscador con Enter (código, código de barras o código de repuesto) y lo agrega.
// Devuelve { ok, nombre, cant } (lo usan también las pruebas)
async function escAgregarCodigo(code){
  const q = norm(code);
  const p = cat().find(x => norm(x.codigo) === q || (x.codigoBarras && norm(x.codigoBarras) === q) || (x.codRepuesto && norm(x.codRepuesto) === q));
  if (!p) {
    escBip(false);
    escFb("❌ No está en la lista: " + code + ". Si es nuevo, actualiza los datos (☰ Menú → 🔄 Actualizar datos).", "err");
    return { ok: false };
  }
  ESC.ocupado = true;
  try {
    const antes = cuantasEnFactura(p.codigo);
    await agregar(p);   // si no hay existencia, pregunta (encima de la cámara) y la lectura espera
    const cant = cuantasEnFactura(p.codigo);
    if (cant > antes) {
      ESC.n++; escBtnFin(); escBip(true);
      const nom = String(p.nombre || ""); escFb("➕ " + (nom.length > 40 ? nom.slice(0, 39) + "…" : nom) + (cant > 1 ? "  (van " + fmtCant(cant) + ")" : ""), "ok");
      return { ok: true, nombre: p.nombre, cant };
    }
    escFb("No se agregó «" + p.nombre + "».", "err");
    return { ok: false, nombre: p.nombre };
  } finally {
    ESC.ocupado = false;
    ESC.lastSeen = Date.now();   // después de un aviso, el mismo código frente a la cámara no vuelve a contar enseguida
  }
}
window.addEventListener("pagehide", escParar);
document.addEventListener("visibilitychange", () => {   // iPhone corta la cámara si la caja pasa a segundo plano
  if (document.visibilityState !== "visible" || !ESC.on) return;
  if (!ESC.track || ESC.track.readyState === "ended") { escParar(); escOverlay("📷 Cámara en pausa", "La cámara se detuvo al salir de la caja. Toca para seguir escaneando.", "Seguir escaneando"); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("escFondo") && $("escFondo").classList.contains("on") && !document.querySelector(".mfondo:not(.oculto)")) cerrarEscaner(); });

// ══ 🔎 FACTURAS ANTERIORES DEL SISTEMA ══
const FA = { filas: [], pag: 0, hayMas: false, pideClave: true, texto: "", desde: "", hasta: "" };
function faFecha(iso){ const p = String(iso || "").split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : "—"; }
function faAhora(){ const d = new Date(); return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
async function abrirFacturasAnt(){
  if (!hayInternet() || !sesionViva()) { await aviso({ icono: "📡", titulo: "Hace falta internet", html: "Las facturas anteriores están en el sistema: para buscarlas hace falta <b>internet</b>.<br><br>Las ventas de <b>este equipo</b> se pueden reimprimir sin internet en <b>☰ Menú → 🧾 Ventas de este equipo</b>." }); return; }
  FA.filas = []; FA.pag = 0; FA.hayMas = false; FA.texto = ""; FA.desde = ""; FA.hasta = "";
  modal({ titulo: "🔎 Facturas anteriores", ancho: true, clase: "fa-modal",
    html: '<div class="fa-buscar"><input class="inp" id="faTexto" placeholder="N° de factura, cliente o cédula" autocomplete="off" onkeydown="if(event.key===\'Enter\'){event.preventDefault();faBuscar(0);}">' +
      '<div class="fa-fechas"><label>Desde<input class="inp" type="date" id="faDesde"></label><label>Hasta<input class="inp" type="date" id="faHasta"></label></div>' +
      '<button type="button" class="btn green" id="faBtn" onclick="faBuscar(0)">🔎 Buscar</button></div>' +
      '<div class="fa-lista" id="faLista"></div><div class="fa-pag" id="faPag"></div>',
    botones: [{ txt: "Cerrar", v: null }], foco: "faTexto" });
  faBuscar(0);
}
async function faBuscar(pag){
  const t = $("faTexto"), d = $("faDesde"), h = $("faHasta"); if (!t) return;
  if (d.value && h.value && d.value > h.value) { aviso({ icono: "📅", titulo: "Revisa las fechas", html: "La fecha <b>Desde</b> es después de la fecha <b>Hasta</b>: en ese rango no puede haber facturas. Corrige una de las dos." }); return; }
  FA.texto = t.value.trim(); FA.desde = d.value; FA.hasta = h.value;
  const b = $("faBtn"); btnOcupado(b, "Buscando…");
  $("faLista").innerHTML = '<div class="fa-vacio"><span class="sp"></span> Buscando facturas…</div>'; $("faPag").innerHTML = "";
  let r = null;
  try { r = await api("cj_fact_buscar", { filtros: { texto: FA.texto, desde: FA.desde, hasta: FA.hasta, pagina: Math.max(0, Number(pag) || 0) } }, 60000); }
  catch (e) { r = { ok: false, msg: e.message, red: true }; }
  if (!$("faLista")) return;
  btnLibre(b);
  if (!r || !r.ok) {
    $("faLista").innerHTML = '<div class="fa-vacio">No se pudo buscar.</div>';
    aviso({ icono: "❌", titulo: "No se pudo buscar", html: esc((r && r.msg) || "El sistema no respondió.") + (r && r.red ? "<br><br>Revisa la conexión a internet y vuelve a buscar." : "") });
    return;
  }
  FA.filas = r.filas || []; FA.pag = r.pagina || 0; FA.hayMas = r.hayMas === true; FA.pideClave = r.pideClave !== false;
  faPintar();
}
function faPintar(){
  const L = $("faLista"); if (!L) return;
  if (!FA.filas.length) {
    L.innerHTML = '<div class="fa-vacio">' + (FA.texto || FA.desde || FA.hasta ? "No hay facturas con esa búsqueda." : "Todavía no hay facturas guardadas para reimprimir.") + "</div>";
  } else {
    L.innerHTML = FA.filas.map((f, i) => {
      const uni = f.unidad === "DIVISAS" ? " <small>divisas</small>" : (f.unidad === "BCV" ? " <small>BCV</small>" : "");
      const cli = f.cliente && f.cliente !== "Genérico" ? esc(f.cliente) + (f.cedula ? ' <small>' + esc(f.cedula) + "</small>" : "") : '<span class="fa-dim">Genérico</span>';
      return '<button type="button" class="fa-fila" onclick="faReimprimir(' + i + ')">' +
        '<span class="fa-n"><b>#' + esc(f.nro) + "</b>" + (f.anulada ? '<span class="fa-anul">ANULADA</span>' : "") + '<small>' + faFecha(f.fecha) + (f.hora ? " · " + esc(f.hora) : "") + "</small></span>" +
        '<span class="fa-cli">' + cli + (f.caja ? '<small>Caja ' + esc(f.caja) + (f.cajero ? " · " + esc(f.cajero) : "") + "</small>" : "") + "</span>" +
        '<span class="fa-tot">$' + fmt(f.total) + uni + "</span><span class=\"fa-imp\">🖨️</span></button>";
    }).join("");
  }
  $("faPag").innerHTML = (FA.pag > 0 || FA.hayMas)
    ? '<button type="button" class="btn sm" ' + (FA.pag > 0 ? "" : "disabled") + ' onclick="faBuscar(' + (FA.pag - 1) + ')">← Más nuevas</button><span>Página ' + (FA.pag + 1) + '</span><button type="button" class="btn sm" ' + (FA.hayMas ? "" : "disabled") + ' onclick="faBuscar(' + (FA.pag + 1) + ')">Más viejas →</button>' : "";
}
async function faReimprimir(i){
  const f = FA.filas[i]; if (!f) return;
  let html = "";
  const formato = { ticket58: "Ticket 58 mm", ticket80: "Ticket 80 mm", carta: "Tamaño carta" }[f.formato] || "";
  const ok = await modal({ icono: "🖨️", titulo: "Reimprimir la factura #" + f.nro,
    html: '<div class="m-txt"><b>Cliente:</b> ' + esc(f.cliente || "Genérico") + (f.cedula ? " · " + esc(f.cedula) : "") + "<br><b>Fecha:</b> " + faFecha(f.fecha) + " " + esc(f.hora || "") + (f.caja ? " · Caja " + esc(f.caja) : "") +
      "<br><b>Total:</b> $" + fmt(f.total) + (f.unidad === "DIVISAS" ? " (divisas)" : "") + (formato ? " · " + formato : "") +
      (f.anulada ? '<div class="fa-aviso-anul">Esta venta está ANULADA: sale con la marca «VENTA ANULADA».</div>' : "") +
      '<div class="fa-nota">Sale igual que el original, con la línea «REIMPRESIÓN» y la fecha y hora de hoy.</div></div>' +
      '<div id="faClaveBox"' + (FA.pideClave ? "" : ' style="display:none;"') + '><label class="lbl" for="faClave">Clave de precio manual (la misma de cambiar la tasa)</label><input class="inp" id="faClave" type="password" autocomplete="off" placeholder="Clave" onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.closest(\'.modal\').querySelector(\'[data-v=ok]\').click();}"></div>' +
      '<label class="switch" style="margin-top:8px;"><input type="checkbox" id="faDos"> Imprimir 2 copias</label><div class="m-err" id="faErr"></div>',
    botones: [{ txt: "Cancelar", v: false }, { txt: "🖨️ Reimprimir", v: true, cls: "green", spin: "Preparando…" }],
    foco: FA.pideClave ? "faClave" : null,
    antes: async v => {
      if (!v) return true;
      const err = $("faErr"), cl = $("faClave") ? $("faClave").value : "";
      err.textContent = "";
      if (FA.pideClave && !cl) { err.textContent = "Escribe la clave para reimprimir."; return false; }
      let r = null;
      try { r = await api("cj_fact_ver", { nro: f.nro, clave: cl, copias: $("faDos").checked ? 2 : 1, cuando: faAhora() }, 60000); }
      catch (e) { err.textContent = e.message + (e.red ? " Revisa la conexión y vuelve a intentar." : ""); return false; }
      if (r && r.ok && r.html) { html = r.html; return true; }
      if (r && r.codigo === "CLAVE") {
        FA.pideClave = true; $("faClaveBox").style.display = "";
        err.textContent = r.msg || "La clave no es correcta."; if ($("faClave")) { $("faClave").value = ""; $("faClave").focus(); }
        return false;
      }
      err.textContent = (r && r.msg) || "El sistema no respondió.";
      return false;
    } });
  if (!ok || !html) return;
  imprimirHTML(html);
  toast("🖨️ Factura #" + f.nro + " enviada a imprimir");
}

// ══ COPIA PARA REIMPRIMIR: cada venta ya subida deja su copia en el sistema ══
// Se manda una sola vez (si el sistema ya la tiene, no la repite). Hasta 15 por vuelta, de las últimas 2 semanas.
function metaCopia(v){
  const p = v.pago || {}, gen = !p.clienteCedula || p.clienteNombre === "Genérico";
  const fm = formatoTicket();
  return { nro: String(v.numeroFactura), fecha: v.fecha, hora: horaDe(v.creada), cliente: gen ? "Genérico" : String(p.clienteNombre || ""), cedula: gen ? "" : String(p.clienteCedula || ""),
           total: r2(Number(v.total) || 0), unidad: String(p.objetivoVenta || ""), cajero: String(p.cajeroNombre || ""), formato: fm === "58" ? "ticket58" : fm === "carta" ? "carta" : "ticket80" };
}
let _copiasSubiendo = false;
async function copiasAlDia(){
  if (_copiasSubiendo || !S.eq || !S.datos || S.online === false || !sesionViva()) return 0;
  const desde = Date.now() - 14 * 864e5;
  const cola = S.ventas.filter(v => v.estado === "subida" && v.numeroFactura && !v.copia && Number(v.subidaEn) > desde).slice(0, 15);
  if (!cola.length) return 0;
  _copiasSubiendo = true;
  let n = 0;
  try {
    for (const v of cola) {
      let r;
      try { r = await api("cj_copia", { html: htmlTicket(v), meta: metaCopia(v) }, 45000); }
      catch (e) { break; }   // sin conexión: la próxima vez
      if (r && (r.codigo === "SESION" || r.codigo === "USUARIO" || r.codigo === "EQUIPO")) break;
      if (r && r.ok) { v.copia = "ok"; n++; }
      else if (r && r.final) v.copia = "no: " + String(r.msg || "").slice(0, 120);
      else { v.copiaIntentos = (Number(v.copiaIntentos) || 0) + 1; if (v.copiaIntentos >= 5) v.copia = "no: " + String((r && r.msg) || "el sistema no la guardó").slice(0, 120); }
      try { await ventaPut(v); } catch (e) {}
      if (!(r && r.ok) && !v.copia) break;
    }
  } finally { _copiasSubiendo = false; }
  return n;
}

// ══ 🛠️ NUEVO SERVICIO (con internet y la clave maestra) ══
function ivaComun(){
  const c = {};
  ((S.datos && S.datos.productos) || []).forEach(p => { const i = Number(((p.precios || [])[0] || {}).iva) || 0; c[i] = (c[i] || 0) + 1; });
  let mejor = 16, n = -1; Object.keys(c).forEach(k => { if (c[k] > n) { n = c[k]; mejor = Number(k); } });
  return mejor;
}
async function nuevoServicio(nombreIni){
  if (typeof puedeVender === "function" && !puedeVender()) return;
  if (!hayInternet() || !sesionViva()) { await aviso({ icono: "📡", titulo: "Hace falta internet", html: "El servicio nuevo se guarda en el sistema: para crearlo hace falta <b>internet</b>." }); return; }
  const iva0 = ivaComun(), ivas = [0, 8, 16].concat([iva0]).filter((x, i, a) => a.indexOf(x) === i).sort((a, b) => a - b);
  let creado = null;
  const r = await modal({ icono: "🛠️", titulo: "Nuevo servicio",
    html: '<div class="m-txt">Para cobrar un trabajo que no está en la lista. Queda guardado en el sistema (Inventario → Servicios) y entra a esta factura.</div>' +
      '<label class="lbl" for="nsNom">Nombre del servicio</label><input class="inp" id="nsNom" maxlength="80" placeholder="Nombre del servicio" value="' + esc(nombreIni || "") + '">' +
      '<div class="ns-fila"><div><label class="lbl" for="nsPre">Precio con IVA ($ ' + esc(unidadU()) + ')</label><input class="inp" id="nsPre" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Precio con IVA" oninput="nsCalc()"></div>' +
      '<div><label class="lbl" for="nsIva">IVA</label><select class="inp" id="nsIva" onchange="nsCalc()">' + ivas.map(x => '<option value="' + x + '"' + (x === iva0 ? " selected" : "") + ">" + x + " %</option>").join("") + "</select></div></div>" +
      '<div class="ns-calc" id="nsCalc"></div>' +
      '<label class="lbl" for="nsMae">Clave maestra</label><input class="inp" id="nsMae" type="password" autocomplete="off" placeholder="La del administrador" onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.closest(\'.modal\').querySelector(\'[data-v=ok]\').click();}">' +
      '<div class="m-err" id="nsErr"></div>',
    botones: [{ txt: "Cancelar", v: false }, { txt: "✅ Crear y agregar", v: true, cls: "green", spin: "Creando…" }],
    foco: nombreIni ? "nsPre" : "nsNom",
    antes: async v => {
      if (!v) return true;
      const err = $("nsErr"), nom = $("nsNom").value.replace(/\s+/g, " ").trim(), pre = Number($("nsPre").value) || 0, iva = Number($("nsIva").value) || 0, mae = $("nsMae").value;
      err.textContent = "";
      if (!nom) { err.textContent = "Escribe el nombre del servicio."; $("nsNom").focus(); return false; }
      if (!(pre > 0)) { err.textContent = "Escribe el precio (mayor que 0)."; $("nsPre").focus(); return false; }
      if (!mae) { err.textContent = "Escribe la clave maestra."; $("nsMae").focus(); return false; }
      const base = libroDePantalla(pre / (1 + iva / 100));   // el sistema guarda el precio sin IVA, en la unidad de sus libros
      let res = null;
      try { res = await api("cj_servicio", { servicio: { nombre: nom, precioBase: Math.round(base * 10000) / 10000, iva: iva, clave: mae } }, 45000); }
      catch (e) { err.textContent = e.message + (e.red ? " Revisa la conexión y vuelve a intentar." : ""); return false; }
      if (res && res.ok && res.servicio) { creado = res; return true; }
      err.textContent = (res && res.msg) || "El sistema no respondió.";
      if (res && res.codigo === "CLAVE") { $("nsMae").value = ""; $("nsMae").focus(); }
      return false;
    } });
  if (!r || !creado) return;
  const s = creado.servicio;
  const d = S.datos;
  d.servicios = (d.servicios || []).filter(x => String(x.codigo) !== String(s.codigo)).concat([{ codigo: s.codigo, nombre: s.nombre, base: Number(s.base) || 0, iva: Number(s.iva) || 0 }]);
  _cat = null;
  try { await kvSet("datos", d); } catch (e) {}
  pintarCategorias(); buscar();
  const p = cat().find(x => x.tipo === "servicio" && String(x.codigo) === String(s.codigo));
  if (p) await agregar(p);
  if (creado.repetido) aviso({ icono: "🛠️", titulo: "Ese servicio ya existía", html: "Ya había un servicio llamado <b>«" + esc(s.nombre) + "»</b>: se agregó ese a la factura, con su precio de <b>" + txtU(r2(basePantalla(s.base) * (1 + (Number(s.iva) || 0) / 100))) + "</b>.<br><br>Si el precio cambió, se corrige en el sistema: <b>Inventario → Servicios</b>." });
}
function nsCalc(){
  const pre = Number($("nsPre").value) || 0, iva = Number($("nsIva").value) || 0, el = $("nsCalc");
  if (!el) return;
  if (!(pre > 0)) { el.innerHTML = ""; return; }
  let h = "Sin IVA: " + txtU(r2(pre / (1 + iva / 100))) + (bsPorU() > 0 ? " · En Bs: Bs " + fmt(r2(pre * bsPorU())) : "");
  if (binOn() && tBcv() > 0 && tDiv() > 0) {   // 4.9: con TasaBin el precio se guarda en divisas: se dice cómo queda en cada tipo de venta
    const lib = libroDePantalla(pre);
    h += '<div class="ns-guarda">Se guarda como <b>$' + fmt(r2(lib)) + " en divisas</b>. En una venta en Bs: <b>$" + fmt(r2(lib * tDiv() / tBcv())) + " BCV</b> (Bs " + fmt(r2(lib * tDiv())) +
      "). En Venta en Dólares: <b>$" + fmt(r2(lib)) + "</b>.</div>";
  }
  el.innerHTML = h;
}

// ══ ✏️ EDITAR UN SERVICIO (4.9 · con internet y la clave maestra) ══
// Cambia el nombre, el precio y el IVA en el sistema (el costo no se toca). Las líneas de la factura en pantalla
// con ese servicio toman el precio nuevo, salvo las que están en precio manual.
async function editarServicio(cod){
  const s = ((S.datos && S.datos.servicios) || []).find(x => String(x.codigo) === String(cod));
  if (!s) { aviso({ icono: "🛠️", titulo: "No encontré el servicio", html: "Toca ☰ → Actualizar datos y vuelve a intentar." }); return; }
  if (!hayInternet() || !sesionViva()) { await aviso({ icono: "📡", titulo: "Hace falta internet", html: "El servicio se cambia en el sistema: para cambiarlo hace falta <b>internet</b>." }); return; }
  const iva0 = Number(s.iva) || 0, ivas = [0, 8, 16].concat([iva0, ivaComun()]).filter((x, i, a) => a.indexOf(x) === i).sort((a, b) => a - b);
  const preHoy = r2(r2(basePantalla(s.base)) * (1 + iva0 / 100));
  let hecho = null;
  const r = await modal({ icono: "✏️", titulo: "Editar servicio",
    html: '<div class="m-txt">Cambia el servicio <b>' + esc(s.nombre) + "</b> (" + esc(s.codigo) + ") en el sistema, para todas las cajas.</div>" +
      '<label class="lbl" for="nsNom">Nombre del servicio</label><input class="inp" id="nsNom" maxlength="80" placeholder="Nombre del servicio" value="' + esc(s.nombre) + '">' +
      '<div class="ns-fila"><div><label class="lbl" for="nsPre">Precio con IVA ($ ' + esc(unidadU()) + ')</label><input class="inp" id="nsPre" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Precio con IVA" value="' + (preHoy > 0 ? preHoy : "") + '" oninput="nsCalc()"></div>' +
      '<div><label class="lbl" for="nsIva">IVA</label><select class="inp" id="nsIva" onchange="nsCalc()">' + ivas.map(x => '<option value="' + x + '"' + (x === iva0 ? " selected" : "") + ">" + x + " %</option>").join("") + "</select></div></div>" +
      '<div class="ns-calc" id="nsCalc"></div>' +
      '<label class="lbl" for="nsMae">Clave maestra</label><input class="inp" id="nsMae" type="password" autocomplete="off" placeholder="La del administrador" onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.closest(\'.modal\').querySelector(\'[data-v=ok]\').click();}">' +
      '<div class="m-err" id="nsErr"></div>',
    botones: [{ txt: "Cancelar", v: false }, { txt: "✅ Guardar", v: true, cls: "green", spin: "Guardando…" }],
    foco: "nsPre",
    alAbrir: () => nsCalc(),
    antes: async v => {
      if (!v) return true;
      const err = $("nsErr"), nom = $("nsNom").value.replace(/\s+/g, " ").trim(), pre = Number($("nsPre").value) || 0, iva = Number($("nsIva").value) || 0, mae = $("nsMae").value;
      err.textContent = "";
      if (!nom) { err.textContent = "Escribe el nombre del servicio."; $("nsNom").focus(); return false; }
      if (!(pre > 0)) { err.textContent = "Escribe el precio (mayor que 0)."; $("nsPre").focus(); return false; }
      if (!mae) { err.textContent = "Escribe la clave maestra."; $("nsMae").focus(); return false; }
      const base = libroDePantalla(pre / (1 + iva / 100));   // el sistema guarda el precio sin IVA, en la unidad de sus libros
      let res = null;
      try { res = await api("cj_servicio_editar", { servicio: { codigo: s.codigo, nombre: nom, precioBase: Math.round(base * 10000) / 10000, iva: iva, clave: mae } }, 45000); }
      catch (e) { err.textContent = e.message + (e.red ? " Revisa la conexión y vuelve a intentar." : ""); return false; }
      if (res && res.ok && res.servicio) { hecho = res.servicio; return true; }
      err.textContent = (res && res.msg) || "El sistema no respondió.";
      if (res && res.codigo === "CLAVE") { $("nsMae").value = ""; $("nsMae").focus(); }
      if (res && res.codigo === "REPETIDO") $("nsNom").focus();
      return false;
    } });
  if (!r || !hecho) return;
  s.nombre = hecho.nombre; s.base = Number(hecho.base) || 0; s.iva = Number(hecho.iva) || 0;
  _cat = null;
  try { await kvSet("datos", S.datos); } catch (e) {}
  let n = 0;
  F.items.forEach(i => {
    if (i.tipo !== "servicio" || String(i.codigo) !== String(s.codigo)) return;
    i.nombre = s.nombre;
    if (!i.manual) { i.libro = s.base; i.base = basePantalla(s.base); i.iva = s.iva; n++; }
  });
  buscar(); pintarFactura();
  toast(n ? "✅ Cambios guardados · la factura tomó el precio nuevo" : "✅ Cambios guardados");
}
