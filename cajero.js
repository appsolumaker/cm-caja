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
  // 3b) 1b/1c: lo contado no coincide con lo que dejó el turno anterior → se registra lo que pasó (PIN del Administrador)
  if (_turnoOk && FD.noCoincide) {
    const c = cajeroPorId(_turnoOk), pv = FD.prev, n = FD.noCoincide;
    if (!c || !pv) { FD.noCoincide = null; pintarTurno(); return; }
    const dif = (a, b) => { const d = r2(a - b); return Math.abs(d) < 0.005 ? "igual" : (d > 0 ? "sobra " : "falta ") + fmt(Math.abs(d)); };
    const tabla = '<table class="cie-tabla" style="text-align:left;margin:6px 0 10px;"><tr><td></td><td class="r">Bs</td><td class="r">$</td></tr>' +
      '<tr><td>Dejó ' + esc(pv.cajero || "el turno anterior") + (pv.cierre ? " (" + esc(fechaCorta(pv.cierre)) + " " + esc(horaDe(pv.cierre)) + ")" : "") + '</td><td class="r">' + fmt(pv.bs) + '</td><td class="r">' + fmt(pv.usd) + "</td></tr>" +
      '<tr><td>Contaste</td><td class="r">' + fmt(n.bs) + '</td><td class="r">' + fmt(n.usd) + "</td></tr>" +
      '<tr class="cie-res"><td><b>Diferencia</b></td><td class="r">' + dif(n.bs, pv.bs) + '</td><td class="r">' + dif(n.usd, pv.usd) + "</td></tr></table>";
    const grandes = fdGrandes();
    // Sin un efectivo con cuenta en el sistema no se puede registrar: queda como antes (explicar y abrir)
    if (grandes.some(z => !gvMetodos(z[0]).length)) {
      box.innerHTML = '<div class="pk-hola">⚠️ No coincide</div><div class="pk-sub">Lo que contaste no es lo que dejó el turno anterior en la gaveta.</div>' + tabla +
        '<div class="cie-arreglo" style="text-align:left;">No se puede registrar la diferencia porque en el sistema no hay un método de <b>efectivo</b> ligado a una cuenta (Configuración → métodos de pago).</div>' +
        '<label class="lbl" for="tFondoExpl" style="text-align:left;">¿Por qué no coincide? (obligatorio para abrir)</label>' +
        '<textarea class="inp" id="tFondoExpl" rows="2" maxlength="200" placeholder="Ej. el dueño sacó Bs 200 para pagar el agua"></textarea>' +
        '<div class="m-err" id="tFondoErr" style="text-align:left;"></div>' +
        '<div class="m-btns"><button type="button" class="btn" onclick="fondoVolverAContar()">← Volver a contar</button><button type="button" class="btn green" id="btnAbrirIgual" onclick="abrirTurno(this, true)">🔓 Abrir igual</button></div>';
      return;
    }
    const tipos = ((S.datos && S.datos.tiposEgreso) || []).filter(Boolean), lt = tipos.length ? tipos : ["Otros"];
    const bloque = (mon, d) => {
      const p = gvPlata(mon, d), a = FD.aj[mon] || {};
      if (d > 0) return '<div class="cie-mon" style="text-align:left;"><div class="cie-preg">🔺 Sobran <b>' + p + "</b>.</div>" +
        '<div class="cie-mots"><button type="button" class="cie-mot on">💰 Registrar sobrante de caja de ' + p + "<small>Se registra como ingreso extra «Sobrante de caja».</small></button></div></div>";
      return '<div class="cie-mon" style="text-align:left;"><div class="cie-preg">🔻 Faltan <b>' + p + "</b>. ¿Qué pasó?</div>" +
        '<div class="cie-mots"><button type="button" class="cie-mot' + (a.tipo === "gasto" ? " on" : "") + '" onclick="fdElegir(\'' + mon + '\', \'gasto\')">💸 Se pagó un gasto con el efectivo de la gaveta<small>Agua, hielo, un flete… Se registra en Egresos con su tipo.</small></button>' +
        (a.tipo === "gasto" ? '<div class="cie-arreglo"><label class="lbl" for="fdCat' + mon + '" style="margin-top:0;">Tipo de gasto</label><select class="inp" id="fdCat' + mon + '" onchange="FD.aj.' + mon + '.cat=this.value"><option value="">— Elige —</option>' +
          lt.map(t => '<option value="' + esc(t) + '"' + (a.cat === t ? " selected" : "") + ">" + esc(t) + "</option>").join("") + "</select>" +
          '<label class="lbl" for="fdDesc' + mon + '">¿Qué se pagó?</label><input class="inp" id="fdDesc' + mon + '" maxlength="120" placeholder="Ej. 2 botellones de agua" value="' + esc(a.desc || "") + '" oninput="FD.aj.' + mon + '.desc=this.value"></div>' : "") +
        '<button type="button" class="cie-mot' + (a.tipo === "faltante" ? " on" : "") + '" onclick="fdElegir(\'' + mon + '\', \'faltante\')">💱 Registrar faltante de caja de ' + p + "<small>Un billete que no aparece, un error en el cierre anterior… Se registra como gasto «Faltante de caja».</small></button></div></div>";
    };
    box.innerHTML = '<div class="pk-hola">⚠️ No coincide</div>' +
      '<div class="pk-sub">Lo que contaste no es lo que dejó el turno anterior en la gaveta. Para abrir, se registra lo que pasó (lo autoriza el <b>Administrador</b> con su PIN) y así las cuentas del negocio quedan como la gaveta.</div>' + tabla +
      grandes.map(z => bloque(z[0], z[1])).join("") +
      '<label class="lbl" for="tFondoNota" style="text-align:left;">¿Qué pasó? (opcional)</label>' +
      '<input class="inp" id="tFondoNota" maxlength="120" placeholder="Ej. el dueño sacó Bs 200 y no lo anotó" value="' + esc(FD.nota || "") + '" oninput="FD.nota=this.value">' +
      '<div class="m-err" id="tFondoErr" style="text-align:left;"></div>' +
      '<div class="m-btns"><button type="button" class="btn" onclick="fondoVolverAContar()">← Volver a contar</button><button type="button" class="btn green" id="btnAbrirIgual" onclick="abrirConAjuste(this)">⭐ Registrar y abrir</button></div>';
    return;
  }
  // 3) Ya puso su PIN: con cuánto efectivo arranca
  if (_turnoOk) {
    const c = cajeroPorId(_turnoOk);
    if (!c) { _turnoOk = null; pintarTurno(); return; }
    const vb = $("tFondoBs") ? $("tFondoBs").value : (FD.contado ? String(FD.contado.bs) : ""), vu = $("tFondoUsd") ? $("tFondoUsd").value : (FD.contado ? String(FD.contado.usd) : "");
    PK.c = null;
    box.innerHTML = '<div class="pk-hola">✅ ' + esc(c.nombre) + "</div>" +
      '<div class="pk-sub">' + (FD.prev ? "Cuenta el efectivo que hay en la gaveta y escríbelo. Si no hay, escribe 0." : "¿Con cuánto efectivo arranca la gaveta? Si no hay, déjalo vacío.") + "</div>" +
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
    pkPreparar("tp", c, c2 => { _turnoOk = c2.id; _turnoSel = null; FD.noCoincide = null; FD.contado = null; fondoPrevCargar(); pintarTurno(); setTimeout(() => { const i = $("tFondoBs"); if (i && window.innerWidth > 820) i.focus(); }, 30); }, previo);
    return;
  }
  // 1) ¿Quién está en la caja?
  PK.c = null;
  box.innerHTML = '<div class="pk-sub" style="margin-top:0;">¿Quién está en la caja? Toca tu nombre.</div><div class="cj-grid">' +
    l.map(c => '<button type="button" class="cj-btn' + (c.admin ? " adm" : "") + '"' + (c.pin ? "" : " disabled") + ' onclick="elegirCajero(' + c.id + ')">' + esc(c.nombre) +
      "<small>" + (!c.pin ? "Sin PIN" : c.admin ? "⭐ Administrador" : c.id === idCaja ? "Cajero de esta caja" : "&nbsp;") + "</small></button>").join("") + "</div>";
}
function elegirCajero(id){
  _turnoSel = id || null; _turnoOk = null; PK.c = null; FD.noCoincide = null; FD.contado = null;
  pintarTurno();
}
// ══ FONDO ENCADENADO (Tanda 1b, 3.2) ══
//  Al cerrar, la caja anota cuánto queda en la gaveta para el próximo turno. Al abrir, el cajero cuenta SIN VER ese
//  monto y la caja lo compara: si no coincide (más de Bs 1 o $0,50), no abre hasta que se registre lo que pasó (1c).
//  Lo que dejó: el último cierre de esta caja en el sistema (cualquier equipo, con internet) o el de este equipo, el
//  más nuevo de los dos. Sin ninguno (equipo nuevo, o cierres de antes de 3.2), abre libre como antes.
const FD = { prev: null, noCoincide: null, contado: null, pide: 0, aj: {}, nota: "" };   // aj (1c): { BS|USD: { tipo, cat, desc } }
// 1c: las monedas que no coinciden por más de Bs 1 o $0,50 → [[moneda, diferencia], …] (+ sobra · − falta)
function fdGrandes(){
  const pv = FD.prev, n = FD.noCoincide; if (!pv || !n) return [];
  return [["BS", r2(n.bs - pv.bs)], ["USD", r2(n.usd - pv.usd)]].filter(z => Math.abs(z[1]) > (z[0] === "BS" ? CIE_TOL.bs : CIE_TOL.usd) + 0.0001);
}
function fdElegir(mon, tipo){ FD.aj[mon] = Object.assign(FD.aj[mon] || {}, { tipo: tipo }); pintarTurno(); }
async function abrirConAjuste(btn){
  if (btn && btn.disabled) return;
  const err = t => { const e = $("tFondoErr"); if (e) e.innerHTML = t; };
  const grandes = fdGrandes(), lin = [];
  for (const [mon, d] of grandes) {
    const a = FD.aj[mon] = FD.aj[mon] || {}, p = gvPlata(mon, d);
    if (d > 0) { a.tipo = "sobrante"; lin.push("Sobrante de caja: <b>" + p + "</b>"); continue; }
    if (!a.tipo) { err("Elige qué pasó con los <b>" + p + "</b> que faltan."); return; }
    if (a.tipo === "gasto") {
      if (!a.cat) { err("Elige el tipo de gasto de los <b>" + p + "</b>."); return; }
      if (String(a.desc || "").trim().length < 3) { err("Escribe qué se pagó con los <b>" + p + "</b>."); return; }
      lin.push("Gasto (" + esc(a.cat) + "): <b>" + p + "</b> · " + esc(String(a.desc).trim()));
    } else lin.push("Faltante de caja: <b>" + p + "</b>");
  }
  err("");
  const adm = await gvPinAdmin("Autorizar y abrir el turno", lin.join("<br>"));
  if (!adm) return;
  await abrirTurno(btn, { autorizo: adm.nombre });
}
async function fondoPrevCargar(){
  const caja = Number(S.datos && S.datos.caja) || 0, loc = S.ultFondo && Number(S.ultFondo.caja) === caja ? S.ultFondo : null, pide = ++FD.pide;
  FD.prev = loc ? { bs: Number(loc.bs) || 0, usd: Number(loc.usd) || 0, cajero: loc.cajero || "", cierre: loc.cierre || "" } : null;
  if (!hayInternet()) return;
  let r = null;
  try { r = await api("cj_turno", { op: "fondo" }, 15000); } catch (e) { r = null; }
  if (pide !== FD.pide || !r || !r.ok || !r.hay) return;
  if (!FD.prev || String(r.cierre || "") > String(FD.prev.cierre || "")) FD.prev = { bs: Number(r.bs) || 0, usd: Number(r.usd) || 0, cajero: r.cajero || "", cierre: r.cierre || "" };
  if (_turnoOk && !FD.noCoincide && $("tFondoBs")) pintarTurno();   // cambia el texto de la pregunta (lo escrito se queda)
}
function fondoVolverAContar(){ FD.contado = FD.noCoincide; FD.noCoincide = null; FD.aj = {}; FD.nota = ""; pintarTurno(); setTimeout(() => { const i = $("tFondoBs"); if (i) { i.focus(); i.select(); } }, 30); }
// modo: nada = el botón 🔓 Abrir turno · true = abrir igual con explicación (sin efectivo con cuenta) ·
// { autorizo } (1c) = ya se eligió qué pasó con la diferencia y el Administrador puso su PIN
async function abrirTurno(btn, modo){
  if (btn && btn.disabled) return;
  const c = cajeroPorId(_turnoOk);
  if (!c) { _turnoOk = null; pintarTurno(); return; }
  const igual = modo === true, aj = modo && typeof modo === "object" ? modo : null;
  const fb = (igual || aj) && FD.noCoincide ? FD.noCoincide.bs : r2(Number($("tFondoBs").value) || 0), fu = (igual || aj) && FD.noCoincide ? FD.noCoincide.usd : r2(Number($("tFondoUsd").value) || 0);
  const pv = FD.prev;
  let expl = "";
  if (pv && !igual && !aj && (Math.abs(fb - pv.bs) > CIE_TOL.bs + 0.0001 || Math.abs(fu - pv.usd) > CIE_TOL.usd + 0.0001)) {   // 1b: no coincide con lo que dejó el turno anterior
    FD.noCoincide = { bs: fb, usd: fu }; FD.aj = {}; FD.nota = ""; pintarTurno(); return;
  }
  if (igual) {
    expl = String(($("tFondoExpl") || {}).value || "").trim();
    if (expl.length < 10) { const e = $("tFondoErr"); if (e) e.textContent = "Escribe por qué no coincide (por lo menos una frase corta). Queda anotado en el cierre de este turno."; return; }
  }
  // 1c: el turno arranca con lo que dejó el anterior y la diferencia se registra en el turno (gaveta.js): así «Debe haber»
  // y las cuentas del negocio quedan como lo contado. Los centavos (hasta Bs 1 o $0,50) van solos como redondeo.
  const movs = [], fondo = { BS: fb, USD: fu }, notas = [];
  if (pv && !igual) {
    const nota = String(FD.nota || "").replace(/\s+/g, " ").trim();
    [["BS", fb, pv.bs], ["USD", fu, pv.usd]].forEach(([mon, contado, dejo]) => {
      const d = r2(contado - dejo), l = gvMetodos(mon);
      if (Math.abs(d) < 0.005 || !l.length) return;
      const chico = Math.abs(d) <= (mon === "BS" ? CIE_TOL.bs : CIE_TOL.usd) + 0.0001;
      const a = chico ? { tipo: "redondeo" } : (d > 0 ? { tipo: "sobrante" } : (FD.aj[mon] || {}));
      if (!a.tipo) return;
      fondo[mon] = dejo;
      movs.push({ tipo: a.tipo, moneda: mon, metodo: l[0].metodo, monto: Math.abs(d), signo: d > 0 ? 1 : -1, cat: a.tipo === "gasto" ? a.cat : "",
                  desc: a.tipo === "gasto" ? String(a.desc || "").trim() : (chico ? "al abrir el turno" : (nota || "al abrir el turno")), autorizo: chico ? "" : (aj ? aj.autorizo : "") });
      if (!chico) notas.push((d > 0 ? "sobraban " : "faltaban ") + gvPlata(mon, d) + " (" + (a.tipo === "gasto" ? "gasto " + a.cat + ": " + String(a.desc || "").trim() : a.tipo === "faltante" ? "faltante de caja" : "sobrante de caja") + ", autorizó " + (aj ? aj.autorizo : "") + ")");
    });
    if (notas.length) expl = notas.join(" y ") + (nota ? ". " + nota : "");
  }
  btnOcupado(btn, "Abriendo…");
  const ahora = new Date();
  const t = { id: "T-" + (S.datos.equipo || "EQ") + "-" + ahoraTxt(ahora).replace(/\D/g, "").slice(0, 12) + "-" + uuid().slice(0, 4),
              cajeroId: c.id, cajeroNombre: c.nombre, apertura: ahoraTxt(ahora), aperturaMs: ahora.getTime(),   // 3.0: la hora exacta, para el efectivo movido desde el sistema
              fondoBs: r2(fondo.BS), fondoUsd: r2(fondo.USD), fondoContado: { bs: fb, usd: fu },
              fondoPrev: pv ? { bs: pv.bs, usd: pv.usd, cajero: pv.cajero, cierre: pv.cierre } : null, fondoExpl: expl };   // 1b
  try { await kvSet("turno", t); }
  catch (e) { btnLibre(btn); aviso({ icono: "❌", titulo: "No se abrió el turno", html: "El equipo no pudo guardar el turno (" + esc(e.message) + "). Vuelve a intentar." }); return; }
  S.turno = t; _turnoOk = null; _turnoSel = null; FD.noCoincide = null; FD.contado = null; FD.aj = {}; FD.nota = "";
  for (const m of movs) await gvRegistrar(m);   // 1c (gaveta.js): la diferencia queda registrada en este turno
  btnLibre(btn);
  desbloquear();
  toast("✅ Turno abierto: " + c.nombre);
  S.cierreAdmin = null;
  seguro(pintarCabecera);   // 2.9: aunque algo falle al pintar, la caja pasa a la facturación con la lista de productos
  seguro(() => irA("vender"));
  if (S.vista !== "vender") mostrarVista("vender");
  seguro(buscar); seguro(pintarFactura);
  try { numerosAlDia(); } catch (e) {}   // numeros.js: con internet, aparta los números de factura de este turno
  try { efectivoAlDia(true); } catch (e) {}   // 3.0: le avisa al sistema que este turno está abierto
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
  const enAdmin = !BQ.on && PK.c && PK.pre === "pa" && !!$("paTec");   // 3.3 (gaveta.js): el PIN del Administrador en una ventana
  if (!BQ.on && !enTurno && !enAdmin) return;
  if (BQ.on) { e.stopPropagation(); if (e.key !== "Tab") e.preventDefault(); }   // bloqueada: nada llega a la caja
  else if (!enAdmin) {
    if (document.querySelector(".mfondo:not(.oculto)")) return;
    const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || "")) return;
  }
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

// ══ 3.0 (Tanda 3a): EFECTIVO DE LA GAVETA MOVIDO DESDE EL SISTEMA ══
// · Con internet, la caja le avisa al sistema que su turno está abierto (al abrirlo, o cuando vuelve el internet).
//   Así Clientes, Proveedores, Compras y Egresos ofrecen «Caja N · turno de …» cuando el pago es en efectivo.
// · Cada 5 minutos (y al cerrar) pregunta qué se movió desde el sistema con el efectivo de esta caja y, si hay
//   algo nuevo, se lo muestra al cajero. El cierre del turno lo suma (o lo resta) en «Debe haber».
const EFS = { at: 0, ocupado: false };
function turnoParaSistema(t){ return { id: t.id, cajeroId: t.cajeroId, cajeroNombre: t.cajeroNombre, apertura: t.apertura, aperturaMs: t.aperturaMs || 0, fondoBs: t.fondoBs, fondoUsd: t.fondoUsd }; }
function efsClave(m){ return [m.ref, m.moneda, m.monto, m.origen].join("|"); }
// forzar: aunque no hayan pasado 5 minutos · silencioso: sin el aviso al cajero (el cierre ya los muestra)
// Devuelve la respuesta del sistema ({ ok, movs, bs, usd }) o null si no se pudo preguntar.
async function efectivoAlDia(forzar, silencioso){
  const t = S.turno;
  if (!t || !S.eq || !S.datos || S.online === false) return null;
  if (EFS.ocupado) { if (!forzar) return null; for (let i = 0; i < 40 && EFS.ocupado; i++) await new Promise(r => setTimeout(r, 250)); }
  if (!forzar && t.avisado && Date.now() - EFS.at < 5 * 60000) return null;
  EFS.ocupado = true;
  let r = null;
  try { r = await api("cj_turno", { op: "movs", id: t.id, turno: turnoParaSistema(t) }, 30000); }
  catch (e) { r = null; }
  finally { EFS.ocupado = false; }
  if (!r || !r.ok || !S.turno || S.turno.id !== t.id) return r && r.ok ? r : null;
  EFS.at = Date.now();
  let cambio = false;
  if (!t.avisado && r.estado === "ABIERTO") { t.avisado = true; cambio = true; }
  const vistos = Array.isArray(t.vistos) ? t.vistos : [];
  const nuevos = (r.movs || []).filter(m => vistos.indexOf(efsClave(m)) < 0);
  if (nuevos.length && (silencioso || !BQ.on)) {
    t.vistos = vistos.concat(nuevos.map(efsClave)).slice(-200); cambio = true;
    if (!silencioso) {
      const lin = nuevos.map(m => "<div style=\"padding:6px 0;border-bottom:1px dashed var(--border);\"><b>" + (m.monto >= 0 ? "Entraron " : "Salieron ") + (m.moneda === "BS" ? "Bs " : "$") + fmt(Math.abs(m.monto)) + "</b> · " + esc(m.etiqueta) +
        (m.usuario ? "<br><span style=\"color:var(--text-dim);font-size:12px;\">Lo registró " + esc(m.usuario) + (m.hora ? " · " + esc(m.hora) : "") + "</span>" : "") +
        (m.detalle ? "<br><span style=\"color:var(--text-dim);font-size:12px;\">" + esc(m.detalle) + "</span>" : "") + "</div>").join("");
      aviso({ icono: "💵", titulo: nuevos.length === 1 ? "Se movió efectivo de esta caja" : "Se movió efectivo de esta caja (" + nuevos.length + ")",
        html: "Desde el sistema se registró con el efectivo de esta gaveta:" + lin + "<br>Al cerrar el turno, el cierre ya lo toma en cuenta en <b>Debe haber</b>." });
    }
  }
  if (cambio) { try { await kvSet("turno", t); } catch (e) {} }
  return r;
}

