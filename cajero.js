"use strict";
// ══════════════════════════════════════════════════════════════
//  CAJERO · Etapa 4A (5-11-2026): siempre hay un cajero en la caja
//   · Sin turno: «¿Quién está en la caja?» → toca su nombre → teclado grande con su PIN → con cuánto
//     efectivo arranca → turno abierto.
//   · Con turno: la caja se BLOQUEA al abrirla (o recargarla), a los 10 minutos sin tocarla y con 🔒.
//     Solo la abre el PIN del cajero del turno. Todo se revisa en el equipo: funciona sin internet.
//   · Para que entre otro cajero, primero se cierra el turno (contando la gaveta). Si el cajero se fue
//     sin cerrarlo, lo cierra el cajero Administrador con su PIN.
//   · PIN de 4 números (largo 4). Los de antes, de 4 a 6, siguen sirviendo: entran solos al acertar y
//     tienen la tecla ✓ por si el PIN es más corto que lo escrito.
// ══════════════════════════════════════════════════════════════
const BLOQ_MIN = 10;                         // minutos sin tocar la caja para que se bloquee
const PIN_INTENTOS = 5;                      // PIN equivocados seguidos antes de esperar un minuto
const _pinFallas = {};                       // id del cajero → { n, hasta }
let _turnoSel = null, _turnoOk = null;       // cajero elegido · cajero que ya puso bien su PIN (falta el fondo)
const BQ = { on: false, modo: "turno", motivo: "" };
let _ultimoToque = Date.now();
const PK = { c: null, pin: "", pre: "", alAcertar: null, ocupado: false };   // el teclado que está en pantalla

// ── Los cajeros (vienen en los datos de la caja) ──
function cajerosTurno(){
  const l = (S.datos && S.datos.cajeros) || [];
  const idCaja = Number(S.datos && S.datos.cajero && S.datos.cajero.id) || 0;
  return l.slice().sort((a, b) => (!!a.admin - !!b.admin) || (b.id === idCaja) - (a.id === idCaja) || String(a.nombre).localeCompare(String(b.nombre)));
}
function cajeroPorId(id){ return ((S.datos && S.datos.cajeros) || []).find(c => c.id === Number(id)) || null; }
function cajeroAdmin(){ return ((S.datos && S.datos.cajeros) || []).find(c => c.admin) || null; }
function largoPin(c){ return Number(c && c.pin && c.pin.largo) || 0; }   // 0 = PIN de antes (4 a 6 números)

// ── El teclado grande (como en Órdenes) ──
function htmlTeclado(pre, c){
  const viejo = !largoPin(c);
  const teclas = ["1", "2", "3", "4", "5", "6", "7", "8", "9", viejo ? "ok" : "", "0", "x"];
  return '<div class="pin-dots" id="' + pre + 'Dots"></div><div class="pk-err" id="' + pre + 'Err"></div>' +
    '<div class="teclado" id="' + pre + 'Tec">' + teclas.map(k => k ?
      '<button type="button" class="' + (k === "x" ? "t-x" : k === "ok" ? "t-ok" : "") + '" data-k="' + k + '" onclick="pkTecla(\'' + k + '\')">' + (k === "x" ? "⌫" : k === "ok" ? "✓" : k) + "</button>" : "<span></span>").join("") + "</div>";
}
function pkPreparar(pre, c, alAcertar, pinPrevio){
  PK.c = c; PK.pre = pre; PK.alAcertar = alAcertar; PK.ocupado = false; PK.pin = pinPrevio || "";
  pkDots();
}
function pkDots(){
  const box = $(PK.pre + "Dots"); if (!box || !PK.c) return;
  const n = Math.max(largoPin(PK.c) || 4, PK.pin.length);
  if (box.children.length !== n) box.innerHTML = "<span></span>".repeat(n);
  [...box.children].forEach((s, i) => s.classList.toggle("on", i < PK.pin.length));
}
function pkErr(t){ const e = $(PK.pre + "Err"); if (e) e.innerHTML = t || ""; }
async function pkTecla(k){
  if (!PK.c || PK.ocupado) return;
  const c = PK.c, f = _pinFallas[c.id] || { n: 0, hasta: 0 };
  if (Date.now() < f.hasta) { pkErr("⏳ Fueron " + PIN_INTENTOS + " PIN equivocados. Espera " + Math.ceil((f.hasta - Date.now()) / 1000) + " segundos y vuelve a intentar."); return; }
  const largo = largoPin(c), max = largo || 6;
  if (k === "x") { PK.pin = PK.pin.slice(0, -1); pkErr(""); pkDots(); return; }
  if (k === "ok") { if (PK.pin.length < 4) { pkErr("El PIN tiene por lo menos 4 números."); return; } }
  else { if (PK.pin.length >= max) return; PK.pin += k; pkErr(""); pkDots(); }
  if (PK.pin.length < (largo || 4)) return;
  PK.ocupado = true;
  let bien = false;
  try { bien = (await sha256hex(c.pin.salt + PK.pin)) === c.pin.hash; } catch (e) { bien = false; }
  PK.ocupado = false;
  if (PK.c !== c) return;   // mientras revisaba cambió la pantalla
  if (bien) {
    _pinFallas[c.id] = { n: 0, hasta: 0 };
    const fn = PK.alAcertar; PK.c = null; PK.pin = "";
    fn(c);
    return;
  }
  if (!largo && k !== "ok" && PK.pin.length < 6) return;   // PIN de antes (4 a 6): puede faltar un número
  f.n++;
  if (f.n >= PIN_INTENTOS) { f.hasta = Date.now() + 60000; f.n = 0; }
  _pinFallas[c.id] = f;
  PK.pin = ""; pkDots();
  const box = $(PK.pre + "Dots"); if (box) { box.classList.remove("mal"); void box.offsetWidth; box.classList.add("mal"); }
  const q = PIN_INTENTOS - f.n;
  pkErr(f.hasta > Date.now() ? "⏳ Fueron " + PIN_INTENTOS + " PIN equivocados: espera un minuto y vuelve a intentar."
    : "❌ Ese no es el PIN de <b>" + esc(c.nombre) + "</b>. " + (q === 1 ? "Te queda 1 intento" : "Te quedan " + q + " intentos") + " antes de esperar un minuto.");
}

// ══ SIN TURNO: ¿quién está en la caja? → PIN → fondo → turno abierto ══
function pintarTurno(){
  const box = $("turnoCuerpo"); if (!box || !S.datos) return;
  const l = cajerosTurno(), idCaja = Number(S.datos.cajero && S.datos.cajero.id) || 0;
  if (!l.some(c => c.pin)) {
    PK.c = null;
    box.innerHTML = '<div class="m-txt" style="line-height:1.55;">' + (l.length ? "Ningún cajero tiene <b>PIN</b> todavía." : "No hay cajeros activos.") +
      '<br><br>En el sistema: <b>Configuración → Cajas y vendedores</b>' + (l.length ? ", toca <b>🔢 PIN</b> en cada cajero (también en el <b>Administrador</b>)" : ", crea los cajeros y ponles su <b>🔢 PIN</b>") +
      '. Después, aquí con internet, toca <b>🔄 Actualizar datos</b>.</div><div style="margin-top:14px;"><button type="button" class="btn green" onclick="actualizarDatos(this)">🔄 Actualizar datos</button></div>';
    return;
  }
  // 3) Ya puso su PIN: con cuánto efectivo arranca
  if (_turnoOk) {
    const c = cajeroPorId(_turnoOk);
    if (!c) { _turnoOk = null; pintarTurno(); return; }
    const vb = $("tFondoBs") ? $("tFondoBs").value : "", vu = $("tFondoUsd") ? $("tFondoUsd").value : "";
    PK.c = null;
    box.innerHTML = '<div class="pk-hola">✅ ' + esc(c.nombre) + "</div>" +
      '<div class="pk-sub">¿Con cuánto efectivo arranca la gaveta? Si no hay, déjalo vacío.</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:left;"><div><label class="lbl" for="tFondoBs" style="margin-top:0;">Efectivo Bs</label><input class="inp" id="tFondoBs" type="number" inputmode="decimal" min="0" step="any" placeholder="Bs (vacío = 0)"></div>' +
      '<div><label class="lbl" for="tFondoUsd" style="margin-top:0;">Efectivo $</label><input class="inp" id="tFondoUsd" type="number" inputmode="decimal" min="0" step="any" placeholder="$ (vacío = 0)"></div></div>' +
      '<div class="m-btns"><button type="button" class="btn" onclick="elegirCajero(null)">← Cancelar</button><button type="button" class="btn green" id="btnAbrirTurno" onclick="abrirTurno(this)">🔓 Abrir turno</button></div>';
    $("tFondoBs").value = vb; $("tFondoUsd").value = vu;
    $("tFondoBs").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("tFondoUsd").focus(); } });
    $("tFondoUsd").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); abrirTurno($("btnAbrirTurno")); } });
    return;
  }
  // 2) Tocó su nombre: el teclado
  if (_turnoSel) {
    const c = cajeroPorId(_turnoSel);
    if (!c || !c.pin) { _turnoSel = null; pintarTurno(); return; }
    const previo = (PK.pre === "tp" && PK.c && PK.c.id === c.id) ? PK.pin : "";
    box.innerHTML = '<div class="pk-hola">Hola, ' + esc(c.nombre) + " 👋</div>" +
      '<div class="pk-sub">Escribe tu PIN.</div>' + htmlTeclado("tp", c) +
      '<div class="pk-links"><button type="button" class="btn" onclick="elegirCajero(null)">← No soy ' + esc(c.nombre) + "</button></div>";
    pkPreparar("tp", c, c2 => { _turnoOk = c2.id; _turnoSel = null; pintarTurno(); setTimeout(() => { const i = $("tFondoBs"); if (i && window.innerWidth > 820) i.focus(); }, 30); }, previo);
    return;
  }
  // 1) ¿Quién está en la caja?
  PK.c = null;
  box.innerHTML = '<div class="pk-sub" style="margin-top:0;">¿Quién está en la caja? Toca tu nombre.</div><div class="cj-grid">' +
    l.map(c => '<button type="button" class="cj-btn' + (c.admin ? " adm" : "") + '"' + (c.pin ? "" : " disabled") + ' onclick="elegirCajero(' + c.id + ')">' + esc(c.nombre) +
      "<small>" + (!c.pin ? "Sin PIN" : c.admin ? "⭐ Administrador" : c.id === idCaja ? "Cajero de esta caja" : "&nbsp;") + "</small></button>").join("") + "</div>";
}
function elegirCajero(id){
  _turnoSel = id || null; _turnoOk = null; PK.c = null;
  pintarTurno();
}
async function abrirTurno(btn){
  if (btn && btn.disabled) return;
  const c = cajeroPorId(_turnoOk);
  if (!c) { _turnoOk = null; pintarTurno(); return; }
  btnOcupado(btn, "Abriendo…");
  const ahora = new Date();
  const t = { id: "T-" + (S.datos.equipo || "EQ") + "-" + ahoraTxt(ahora).replace(/\D/g, "").slice(0, 12) + "-" + uuid().slice(0, 4),
              cajeroId: c.id, cajeroNombre: c.nombre, apertura: ahoraTxt(ahora),
              fondoBs: r2(Number($("tFondoBs").value) || 0), fondoUsd: r2(Number($("tFondoUsd").value) || 0) };
  try { await kvSet("turno", t); }
  catch (e) { btnLibre(btn); aviso({ icono: "❌", titulo: "No se abrió el turno", html: "El equipo no pudo guardar el turno (" + esc(e.message) + "). Vuelve a intentar." }); return; }
  S.turno = t; _turnoOk = null; _turnoSel = null;
  btnLibre(btn);
  desbloquear();
  toast("✅ Turno abierto: " + c.nombre);
  pintarCabecera();
  irA("vender");
  numerosAlDia();   // numeros.js: con internet, aparta los números de factura de este turno
}

// ══ CON TURNO: la caja bloqueada ══
function bloquear(motivo){
  if (!S.turno || !S.datos) return;
  BQ.on = true; BQ.modo = "turno"; BQ.motivo = motivo || "";
  S.cierreAdmin = null;
  try { cerrarMenuVta(); } catch (e) {}
  try { const a = document.activeElement; if (a && a.blur && a !== document.body) a.blur(); } catch (e) {}
  pintarBloqueo();
  $("bloqueo").classList.remove("oculto");
  document.body.classList.add("bloqueada");
}
function desbloquear(){
  BQ.on = false; BQ.motivo = ""; PK.c = null;
  $("bloqueo").classList.add("oculto");
  document.body.classList.remove("bloqueada");
  _ultimoToque = Date.now();
}
function bloqModo(m){ BQ.modo = m; BQ.motivo = ""; pintarBloqueo(); }
function textoSinAdmin(){
  return "Para eso, el administrador le pone su PIN al cajero <b>Administrador</b> en el sistema (<b>Configuración → Cajas y vendedores → 🔢 PIN</b>) y aquí, con internet, se toca <b>🔄 Actualizar datos</b>.";
}
function pintarBloqueo(){
  const box = $("bloqCuerpo"), t = S.turno;
  if (!box || !t) return;
  const c = cajeroPorId(t.cajeroId), adm = cajeroAdmin();
  const admOk = !!(adm && adm.pin && (!c || adm.id !== c.id));
  const btnAct = '<button type="button" class="btn" onclick="actualizarDatos(this)">🔄 Actualizar datos</button>';
  if (BQ.modo === "admin" && admOk) {
    box.innerHTML = '<div class="bq-ico">⭐</div><div class="pk-hola">' + esc(adm.nombre) + "</div>" +
      '<div class="pk-sub">Escribe tu PIN para cerrar el turno de <b>' + esc(t.cajeroNombre) + "</b>.</div>" + htmlTeclado("bq", adm) +
      '<div class="pk-links"><button type="button" class="btn" onclick="bloqModo(\'turno\')">← Volver</button></div>';
    pkPreparar("bq", adm, a => {
      desbloquear();
      S.cierreAdmin = { id: a.id, nombre: a.nombre };
      mostrarVista("cierre"); pintarCierre();
    });
    return;
  }
  if (BQ.modo === "otro" || !c || !c.pin) {
    PK.c = null;
    const esAdm = !!(c && c.admin), sinPin = !c || !c.pin;
    box.innerHTML = '<div class="bq-ico">👥</div><div class="pk-hola">' + (sinPin ? "Caja bloqueada" : "Va a entrar otro cajero") + "</div>" +
      '<div class="pk-sub bq-txt">' +
      (sinPin ? "El turno abierto es de <b>" + esc(t.cajeroNombre) + "</b>, pero ese cajero ya no tiene PIN en este equipo, así que hay que cerrar su turno.<br><br>"
              : "El turno de <b>" + esc(t.cajeroNombre) + "</b> sigue abierto. Para que entre otro cajero, primero se <b>cierra ese turno</b> contando el efectivo de la gaveta.<br><br>" +
                "• Si <b>" + esc(t.cajeroNombre) + "</b> está aquí: que escriba su PIN y cierre su turno en <b>☰ Menú → Cerrar turno</b>.<br>") +
      (esAdm ? "" : "• Si " + (sinPin ? "no está" : "ya se fue") + ": lo cierra el <b>Administrador</b> con su PIN.") +
      (!esAdm && !admOk ? "<br><br>" + textoSinAdmin() : "") + "</div>" +
      '<div class="pk-links">' + (!esAdm && admOk ? '<button type="button" class="btn green" onclick="bloqModo(\'admin\')">⭐ Lo cierra el Administrador</button>' : "") +
      (!esAdm && !admOk ? btnAct : "") +
      (sinPin ? "" : '<button type="button" class="btn" onclick="bloqModo(\'turno\')">← Volver</button>') + "</div>";
    return;
  }
  const previo = (PK.pre === "bq" && PK.c && PK.c.id === c.id) ? PK.pin : "";
  box.innerHTML = '<div class="bq-ico">🔒</div><div class="pk-hola">Hola, ' + esc(c.nombre) + " 👋</div>" +
    '<div class="pk-sub">' + (BQ.motivo ? esc(BQ.motivo) + "<br>" : "") + "Escribe tu PIN para seguir vendiendo.</div>" + htmlTeclado("bq", c) +
    '<div class="pk-links"><button type="button" class="lnk" onclick="bloqModo(\'otro\')">👥 Va a entrar otro cajero</button></div>';
  pkPreparar("bq", c, () => { desbloquear(); toast("👋 Hola, " + c.nombre); }, previo);
}
// El administrador abrió el cierre del turno de otro: no puede vender en ese turno
function cancelarCierreAdmin(){ S.cierreAdmin = null; bloquear(); }

// ── Teclado físico (PC): los números, ⌫ y Enter van al teclado de la pantalla ──
document.addEventListener("keydown", e => {
  if (document.body.classList.contains("entrando")) return;
  const enTurno = !BQ.on && S.vista === "turno" && PK.c && PK.pre === "tp";
  if (!BQ.on && !enTurno) return;
  if (!BQ.on) {
    if (document.querySelector(".mfondo:not(.oculto)")) return;
    const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || "")) return;
  } else { e.stopPropagation(); if (e.key !== "Tab") e.preventDefault(); }   // bloqueada: nada llega a la caja
  if (!PK.c || e.ctrlKey || e.altKey || e.metaKey) return;
  if (/^\d$/.test(e.key)) { e.preventDefault(); pkTecla(e.key); }
  else if (e.key === "Backspace") { e.preventDefault(); pkTecla("x"); }
  else if (e.key === "Enter" && !largoPin(PK.c)) { e.preventDefault(); pkTecla("ok"); }
}, true);

// ── 10 minutos sin tocar la caja: se bloquea ──
["pointerdown", "keydown", "touchstart", "wheel"].forEach(ev => document.addEventListener(ev, () => { if (!BQ.on) _ultimoToque = Date.now(); }, { passive: true, capture: true }));
function revisarInactividad(){
  if (BQ.on || !S.turno || !S.datos || document.body.classList.contains("entrando")) return;
  if (Date.now() - _ultimoToque >= BLOQ_MIN * 60000) bloquear("La caja se bloqueó porque no se usó en " + BLOQ_MIN + " minutos.");
}
setInterval(revisarInactividad, 15000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) revisarInactividad(); });
