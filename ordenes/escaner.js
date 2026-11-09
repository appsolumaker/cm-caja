"use strict";
// ══════════════════════════════════════════════════════════════
//  ÓRDENES 1.9 · 📷 Escanear con la cámara del teléfono o la tablet (el mismo lector de la caja 3.9)
//  Lee el código de barras y agrega el producto (o el servicio, por su código) a la orden. Varios seguidos.
//  Usa el lector del navegador (Android) o ZXing (iPhone), guardado en el teléfono: también sin internet.
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
  let f = $("escFondo");
  if (!f) { f = document.createElement("div"); f.id = "escFondo"; f.className = "esc-fondo"; f.innerHTML = escHTML(); document.body.appendChild(f); }
  f.classList.add("on");
  ESC.n = 0; escBtnFin();
  if (!escHayCamara()) { escOverlay("Cámara no disponible", "Este navegador no deja usar la cámara. En iPhone abre las órdenes en Safari (no dentro de WhatsApp, Instagram u otra app).", "Reintentar"); return; }
  escIniciar();
}
function cerrarEscaner(){
  escParar();
  const f = $("escFondo"); if (f) f.classList.remove("on");
  if (ESC.n) toast("🧾 " + (ESC.n === 1 ? "Se agregó 1 producto" : "Se agregaron " + ESC.n + " productos") + " a la orden con la cámara");
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
    escParar(); escOverlay("No se pudo cargar el lector", "Este equipo no tiene guardado el lector de códigos. Conéctate a internet una vez, abre las órdenes y vuelve a intentar.", "Reintentar");
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
// Busca el código (código, código de barras) entre los productos y los servicios de la página y lo agrega a la orden.
// Devuelve { ok, nombre, cant } (lo usan también las pruebas)
function escAgregarCodigo(code){
  const q = norm(code), d = OV.d || {};
  let p = (d.productos || []).find(x => norm(x.codigo) === q || (x.codigoBarras && norm(x.codigoBarras) === q));
  if (!p) { const s = (d.servicios || []).find(x => norm(x.codigo) === q); if (s) p = Object.assign({ tipo: "servicio" }, s); }
  if (!p) {
    escBip(false);
    escFb("❌ No está en la lista: " + code + ". Si es nuevo, actualiza los datos (☰ → Actualizar).", "err");
    return { ok: false };
  }
  const sv = p.tipo === "servicio";
  agregar(p);
  const cant = enOrden(p.codigo, sv);
  ESC.n++; escBtnFin(); escBip(true);
  const nom = String(p.nombre || ""), corto = nom.length > 36 ? nom.slice(0, 35) + "…" : nom;
  const disp = sv ? Infinity : disponible(p.codigo);
  if (cant > disp + 0.0005) escFb("⚠️ " + corto + " (van " + fmtCant(cant) + ", quedan " + fmtCant(Math.max(0, disp)) + ")", "warn");
  else escFb("➕ " + corto + (cant > 1 ? "  (van " + fmtCant(cant) + ")" : ""), "ok");
  return { ok: true, nombre: p.nombre, cant: cant };
}
window.addEventListener("pagehide", escParar);
document.addEventListener("visibilitychange", () => {   // iPhone corta la cámara si la caja pasa a segundo plano
  if (document.visibilityState !== "visible" || !ESC.on) return;
  if (!ESC.track || ESC.track.readyState === "ended") { escParar(); escOverlay("📷 Cámara en pausa", "La cámara se detuvo al salir de la página. Toca para seguir escaneando.", "Seguir escaneando"); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("escFondo") && $("escFondo").classList.contains("on") && !document.querySelector(".mfondo")) cerrarEscaner(); });

