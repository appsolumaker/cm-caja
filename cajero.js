"use strict";
// ══════════════════════════════════════════════════════════════
//  CAJERO · Acceso único (caja 4.0, 8-11-2026): el cajero entra con su USUARIO Y CONTRASEÑA del sistema
//   · Sin turno: «¿Quién está en la caja?» (los usuarios con permiso de esta caja) → toca su nombre → su
//     contraseña → con cuánto efectivo arranca → turno abierto.
//   · Con turno: la caja se BLOQUEA al abrirla (o recargarla), a los 10 minutos sin tocarla y con 🔒.
//     La abre la contraseña del cajero del turno.
//   · La contraseña la revisa el sistema cuando hay internet (con su límite de intentos: cj_cajero). Sin
//     internet, el equipo la compara con la huella que le mandó el sistema (nunca guarda la contraseña).
//   · Para que entre otro cajero, primero se cierra el turno. Si el cajero se fue sin cerrarlo, lo cierra un
//     administrador (usuario con todos los permisos) con su contraseña. También autoriza lo de la gaveta.
// ══════════════════════════════════════════════════════════════
const BLOQ_MIN = 10;                         // minutos sin tocar la caja para que se bloquee
const PIN_INTENTOS = 5;                      // sin internet: contraseñas equivocadas seguidas antes de esperar un minuto
const _pinFallas = {};                       // usuario → { n, hasta }
let _turnoSel = null, _turnoOk = null;       // cajero elegido · cajero que ya puso bien su contraseña (falta el fondo)
const BQ = { on: false, modo: "turno", motivo: "" };
let _ultimoToque = Date.now();
const PK = { c: null, pre: "", alAcertar: null, ocupado: false, lista: null };   // la contraseña que se está pidiendo en pantalla

// ── Los cajeros: los usuarios con permiso de esta caja (vienen en los datos de la caja) ──
function cajerosTodos(){ return (S.datos && S.datos.cajeros) || []; }
function cajerosTurno(){ return cajerosTodos().slice().sort((a, b) => (!!a.admin - !!b.admin) || String(a.nombre).localeCompare(String(b.nombre))); }
function cajeroPorId(id){ return id == null || id === "" ? null : cajerosTodos().find(c => String(c.id) === String(id)) || null; }
function cajerosAdmin(){ return cajerosTodos().filter(c => c.admin); }
function cajeroAdmin(){ return cajerosAdmin()[0] || null; }

// ── La contraseña (en lugar del teclado de números) ──
// lista: si hay varios que pueden autorizar (administradores), se elige quién
function htmlTeclado(pre, c, lista){
  const varios = lista && lista.length > 1;
  return (varios ? '<select class="inp ck-quien" id="' + pre + 'Quien">' + lista.map(x => '<option value="' + esc(x.id) + '"' + (c && String(x.id) === String(c.id) ? " selected" : "") + ">" + esc(x.nombre) + "</option>").join("") + "</select>" : "") +
    '<div class="ck-fila"><input class="inp ck-inp" id="' + pre + 'Clave" type="password" autocomplete="current-password" placeholder="Contraseña" maxlength="80">' +
    '<button type="button" class="btn green ck-ok" id="' + pre + 'Ok">Entrar</button></div><div class="pk-err" id="' + pre + 'Err"></div>';
}
function pkPreparar(pre, c, alAcertar, _previo, lista){
  PK.c = c; PK.pre = pre; PK.alAcertar = alAcertar; PK.ocupado = false; PK.lista = lista || null;
  const inp = $(pre + "Clave"), btn = $(pre + "Ok"), sel = $(pre + "Quien");
  if (inp) inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); pkEntrar(); } });
  if (btn) btn.addEventListener("click", () => pkEntrar());
  if (sel) sel.addEventListener("change", () => { PK.c = (PK.lista || []).find(x => String(x.id) === sel.value) || PK.c; pkErr(""); if (inp) inp.focus(); });
  setTimeout(() => { const i = $(pre + "Clave"); if (i && PK.pre === pre) i.focus(); }, 60);
}
function pkErr(t){ const e = $(PK.pre + "Err"); if (e) e.innerHTML = t || ""; }
async function pkEntrar(){
  const pre = PK.pre, inp = $(pre + "Clave"), btn = $(pre + "Ok"), c = PK.c;
  if (!inp || !c || PK.ocupado) return;
  const clave = inp.value;
  if (!clave) { pkErr("Escribe tu contraseña."); inp.focus(); return; }
  PK.ocupado = true; btnOcupado(btn, "Revisando…");
  let res;
  try { res = await ckVerificar(c, clave); } catch (e) { res = { ok: false, msg: esc(e.message) }; }
  PK.ocupado = false;
  if ($(pre + "Ok")) btnLibre(btn, "Entrar");
  if (PK.c !== c || PK.pre !== pre) return;   // mientras revisaba cambió la pantalla
  if (res.ok) {
    const fn = PK.alAcertar; PK.c = null; inp.value = "";
    fn(res.c || c);
    return;
  }
  inp.value = ""; inp.focus();
  const f = inp.closest(".ck-fila"); if (f) { f.classList.remove("mal"); void f.offsetWidth; f.classList.add("mal"); }
  pkErr(res.msg || "Contraseña incorrecta.");
}
// Con internet la revisa el sistema (y trae la huella al día); sin internet, la huella guardada en el equipo
async function ckVerificar(c, clave){
  const usr = c.usuario || c.id;
  if (hayInternet() && S.eq) {
    let r = null;
    try { r = await api("cj_cajero", { usuario: usr, clave: clave }, 25000); } catch (e) { r = null; }
    if (r && r.ok && r.cajero) {
      const nuevo = Object.assign({}, c, r.cajero);
      const l = cajerosTodos(), k = l.findIndex(x => String(x.id) === String(c.id));
      if (k >= 0) { l[k] = nuevo; try { await kvSet("datos", S.datos); } catch (e) {} }
      _pinFallas[usr] = { n: 0, hasta: 0 };
      return { ok: true, c: nuevo };
    }
    if (r && (r.codigo === "SIN_PERMISO" || r.codigo === "NO_EXISTE")) {   // le quitaron el permiso (o el usuario): sale de la lista de este equipo
      S.datos.cajeros = cajerosTodos().filter(x => String(x.id) !== String(c.id));
      try { await kvSet("datos", S.datos); } catch (e) {}
      return { ok: false, msg: "⛔ " + esc(r.msg) };
    }
    if (r && (r.codigo === "CLAVE" || r.codigo === "BLOQUEADO" || r.codigo === "TEMPORAL")) return { ok: false, msg: "❌ " + esc(r.msg) };
    // sin respuesta del sistema (o un sistema sin actualizar): se revisa en el equipo
  }
  const f = _pinFallas[usr] || { n: 0, hasta: 0 };
  if (Date.now() < f.hasta) return { ok: false, msg: "⏳ Fueron " + PIN_INTENTOS + " contraseñas equivocadas. Espera " + Math.ceil((f.hasta - Date.now()) / 1000) + " segundos y vuelve a intentar." };
  const hu = c.huella;
  if (!hu || !hu.salt || !hu.hash) return { ok: false, msg: "📡 Sin internet no se puede revisar la contraseña de <b>" + esc(c.nombre) + "</b>: todavía no ha entrado con internet en esta caja (o le cambiaron la contraseña). Conéctate a internet y vuelve a intentar." };
  let h = "";
  try { h = await huellaDe(hu.salt, hu.n, clave); } catch (e) { h = ""; }
  if (h === hu.hash) { _pinFallas[usr] = { n: 0, hasta: 0 }; return { ok: true, c: c }; }
  f.n++;
  if (f.n >= PIN_INTENTOS) { f.hasta = Date.now() + 60000; f.n = 0; }
  _pinFallas[usr] = f;
  const q = PIN_INTENTOS - f.n;
  return { ok: false, msg: f.hasta > Date.now() ? "⏳ Fueron " + PIN_INTENTOS + " contraseñas equivocadas: espera un minuto y vuelve a intentar."
    : "❌ Esa no es la contraseña de <b>" + esc(c.nombre) + "</b>. " + (q === 1 ? "Te queda 1 intento" : "Te quedan " + q + " intentos") + " antes de esperar un minuto." };
}
// La misma huella que guarda el sistema (AccesoUnico.gs): sha256(sal + contraseña) y luego n−1 vueltas más
async function huellaDe(salt, n, clave){
  let h = await sha256hex(String(salt) + String(clave));
  for (let i = 1; i < (Number(n) || 1000); i++) h = await sha256hex(h);
  return h;
}

// ══ SIN TURNO: ¿quién está en la caja? → contraseña → fondo → turno abierto ══
function pintarTurno(){
  const box = $("turnoCuerpo"); if (!box || !S.datos) return;
  const l = cajerosTurno();
  if (!l.length) {
    PK.c = null;
    box.innerHTML = '<div class="m-txt" style="line-height:1.55;">Nadie tiene permiso de la <b>Caja ' + esc(S.datos.caja) + "</b> todavía." +
      '<br><br>En el sistema: <b>Configuración → Usuarios</b>, a cada cajero dale su usuario y contraseña y el permiso de la <b>Caja ' + esc(S.datos.caja) + "</b>" +
      '. Después, aquí con internet, toca <b>🔄 Actualizar datos</b>.</div><div style="margin-top:14px;"><button type="button" class="btn green" onclick="actualizarDatos(this)">🔄 Actualizar datos</button></div>';
    return;
  }
  // 3c) 4.2 · contó más efectivo del que tiene el sistema (lo libre para esta caja): no abre hasta decir de dónde salió
  if (_turnoOk && FD.sc) {
    const sc = FD.sc, inf = sc.info || {}, mons = ["BS", "USD"].filter(m => Number(sc.faltan[m]) > 0);
    const linea = m => {
      const sal = (inf.saldo || {})[m] || 0, otr = (inf.enOtras || {})[m] || 0, lib = (inf.libre || {})[m] || 0, k = m === "BS" ? "bs" : "usd";
      return '<div class="cie-mon" style="text-align:left;"><div class="cie-preg">🔺 Hay <b>' + gvPlata(m, sc.faltan[m]) + "</b> que el sistema no tiene. ¿De dónde salieron?</div>" +
        '<div class="cie-ayuda" style="margin:0 0 6px;">En el sistema, el efectivo en ' + (m === "BS" ? "Bs" : "$") + " es <b>" + gvPlata(m, sal) + "</b>" +
        (otr > 0 ? " y <b>" + gvPlata(m, otr) + "</b> están en otras cajas" : "") + ": para esta caja quedan <b>" + gvPlata(m, Math.max(0, lib)) + "</b> y contaste <b>" + gvPlata(m, sc.contado[k]) + "</b>.</div>" +
        fdOrigenHTML("sc", m, sc.faltan[m]) + "</div>";
    };
    const otras = (inf.detalle || []).map(x => "Caja " + x.caja + (x.abierta ? " (abierta" + (x.cajero ? ", " + esc(x.cajero) : "") + ")" : " (cerrada, lo que dejó)") + ": " +
      [x.bs ? gvPlata("BS", x.bs) : "", x.usd ? gvPlata("USD", x.usd) : ""].filter(Boolean).join(" · ")).filter(x => !/: $/.test(x));
    box.innerHTML = '<div class="pk-hola">⚠️ Hay más efectivo del que tiene el sistema</div>' +
      '<div class="pk-sub">Todo el efectivo de la gaveta tiene que estar en las cuentas de efectivo del sistema. Di de dónde salió lo de más (lo autoriza un <b>administrador</b> con su contraseña) y el turno abre. O vuelve a contar.</div>' +
      mons.map(linea).join("") +
      (otras.length ? '<div class="cie-ayuda" style="text-align:left;">💵 En las otras cajas: ' + otras.join(" · ") + "</div>" : "") +
      '<div class="m-err" id="tFondoErr" style="text-align:left;"></div>' +
      '<div class="m-btns"><button type="button" class="btn" onclick="fondoVolverAContar()">← Volver a contar</button><button type="button" class="btn green" id="btnAbrirSc" onclick="abrirConOrigen(this)">⭐ Registrar y abrir</button></div>';
    return;
  }
  // 3b) 1b/1c: lo contado no coincide con lo que dejó el turno anterior → se registra lo que pasó (lo autoriza un administrador)
  if (_turnoOk && FD.noCoincide) {
    const c = cajeroPorId(_turnoOk), pv = FD.prev, n = FD.noCoincide;
    if (!c || !pv) { FD.noCoincide = null; pintarTurno(); return; }
    const dif = (a, b) => { const d = r2(a - b); return Math.abs(d) < 0.005 ? "igual" : (d > 0 ? "sobra " : "falta ") + fmt(Math.abs(d)); };
    const ent = pv.entre && pv.entre.n ? pv.entre : null, qd = ent && pv.queda ? pv.queda : { bs: pv.bs, usd: pv.usd };
    const sg = v => (v < 0 ? "− " : "+ ") + fmt(Math.abs(v));
    const tabla = '<table class="cie-tabla" style="text-align:left;margin:6px 0 10px;"><tr><td></td><td class="r">Bs</td><td class="r">$</td></tr>' +
      '<tr><td>Dejó ' + esc(pv.cajero || "el turno anterior") + (pv.cierre ? " (" + esc(fechaCorta(pv.cierre)) + " " + esc(horaDe(pv.cierre)) + ")" : "") + '</td><td class="r">' + fmt(qd.bs) + '</td><td class="r">' + fmt(qd.usd) + "</td></tr>" +
      (ent ? '<tr><td>Ya registrado en el sistema</td><td class="r">' + sg(ent.bs) + '</td><td class="r">' + sg(ent.usd) + "</td></tr>" +
             '<tr><td><b>Debe haber</b></td><td class="r">' + fmt(pv.bs) + '</td><td class="r">' + fmt(pv.usd) + "</td></tr>" : "") +
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
      if (d > 0) return '<div class="cie-mon" style="text-align:left;"><div class="cie-preg">🔺 Sobran <b>' + p + "</b>. ¿De dónde salieron?</div>" + fdOrigenHTML("aj", mon, d) + "</div>";
      return '<div class="cie-mon" style="text-align:left;"><div class="cie-preg">🔻 Faltan <b>' + p + "</b>. ¿Qué pasó?</div>" +
        '<div class="cie-mots"><button type="button" class="cie-mot" onclick="fdSinCaja()">📋 Salió para algo que ya está registrado en el sistema<small>Un gasto, un pago a un proveedor, un depósito al banco… registrado sin decir de qué caja. Elígelo y «Debe haber» baja.</small></button>' +
        '<button type="button" class="cie-mot' + (a.tipo === "gasto" ? " on" : "") + '" onclick="fdElegir(\'' + mon + '\', \'gasto\')">💸 Se pagó un gasto con el efectivo de la gaveta<small>Agua, hielo, un flete… que NO está registrado. Se registra en Egresos con su tipo.</small></button>' +
        (a.tipo === "gasto" ? '<div class="cie-arreglo"><label class="lbl" for="fdCat' + mon + '" style="margin-top:0;">Tipo de gasto</label><select class="inp" id="fdCat' + mon + '" onchange="FD.aj.' + mon + '.cat=this.value"><option value="">— Elige —</option>' +
          lt.map(t => '<option value="' + esc(t) + '"' + (a.cat === t ? " selected" : "") + ">" + esc(t) + "</option>").join("") + "</select>" +
          '<label class="lbl" for="fdDesc' + mon + '">¿Qué se pagó?</label><input class="inp" id="fdDesc' + mon + '" maxlength="120" placeholder="Ej. 2 botellones de agua" value="' + esc(a.desc || "") + '" oninput="FD.aj.' + mon + '.desc=this.value"></div>' : "") +
        '<button type="button" class="cie-mot' + (a.tipo === "faltante" ? " on" : "") + '" onclick="fdElegir(\'' + mon + '\', \'faltante\')">💱 Registrar faltante de caja de ' + p + "<small>Un billete que no aparece, un error en el cierre anterior… Se registra como gasto «Faltante de caja».</small></button></div></div>";
    };
    box.innerHTML = '<div class="pk-hola">⚠️ No coincide</div>' +
      '<div class="pk-sub">Lo que contaste no es lo que dejó el turno anterior en la gaveta. Para abrir, se registra lo que pasó (lo autoriza un <b>administrador</b> con su contraseña) y así las cuentas del negocio quedan como la gaveta.</div>' + tabla +
      grandes.map(z => bloque(z[0], z[1])).join("") +
      '<label class="lbl" for="tFondoNota" style="text-align:left;">¿Qué pasó? (opcional)</label>' +
      '<input class="inp" id="tFondoNota" maxlength="120" placeholder="Ej. el dueño sacó Bs 200 y no lo anotó" value="' + esc(FD.nota || "") + '" oninput="FD.nota=this.value">' +
      '<div class="m-err" id="tFondoErr" style="text-align:left;"></div>' +
      '<div class="m-btns"><button type="button" class="btn" onclick="fondoVolverAContar()">← Volver a contar</button><button type="button" class="btn green" id="btnAbrirIgual" onclick="abrirConAjuste(this)">⭐ Registrar y abrir</button></div>';
    return;
  }
  // 3) Ya puso su contraseña: con cuánto efectivo arranca
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
    if (!c) { _turnoSel = null; pintarTurno(); return; }
    if (PK.pre === "tp" && PK.c && PK.c.id === c.id && $("tpClave")) return;   // ya está pidiendo su contraseña: no se borra lo escrito
    box.innerHTML = '<div class="pk-hola">Hola, ' + esc(c.nombre) + " 👋</div>" +
      '<div class="pk-sub">Escribe tu contraseña (la misma con la que entras al sistema).</div>' + htmlTeclado("tp", c) +
      '<div class="pk-links"><button type="button" class="btn" onclick="elegirCajero(null)">← No soy ' + esc(c.nombre) + "</button></div>";
    pkPreparar("tp", c, c2 => { _turnoOk = c2.id; _turnoSel = null; FD.noCoincide = null; FD.contado = null; fondoPrevCargar(); pintarTurno(); setTimeout(() => { const i = $("tFondoBs"); if (i && window.innerWidth > 820) i.focus(); }, 30); });
    return;
  }
  // 1) ¿Quién está en la caja?
  PK.c = null;
  box.innerHTML = '<div class="pk-sub" style="margin-top:0;">¿Quién está en la caja? Toca tu nombre.</div><div class="cj-grid">' +
    l.map(c => '<button type="button" class="cj-btn' + (c.admin ? " adm" : "") + '" data-id="' + esc(c.id) + '" onclick="elegirCajero(this.dataset.id)">' + esc(c.nombre) +
      "<small>" + (c.admin ? "⭐ Administrador" : "&nbsp;") + "</small></button>").join("") + "</div>";
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
const FD = { prev: null, noCoincide: null, contado: null, pide: 0, aj: {}, nota: "", cuentas: [], sc: null, sis: [], ult: null };   // aj (1c): { BS|USD: { tipo, cat, desc, cuentaId, montoOrigen, oid } } · sc (4.2): más efectivo del que tiene el sistema · sis: lo que salió para algo ya registrado
// 1c: las monedas que no coinciden por más de Bs 1 o $0,50 → [[moneda, diferencia], …] (+ sobra · − falta)
function fdGrandes(){
  const pv = FD.prev, n = FD.noCoincide; if (!pv || !n) return [];
  return [["BS", r2(n.bs - pv.bs)], ["USD", r2(n.usd - pv.usd)]].filter(z => Math.abs(z[1]) > (z[0] === "BS" ? CIE_TOL.bs : CIE_TOL.usd) + 0.0001);
}
function fdElegir(mon, tipo){ FD.aj[mon] = Object.assign(FD.aj[mon] || {}, { tipo: tipo }); pintarTurno(); }
// ── 4.2 · De dónde salió el efectivo de más: 🔄 de otra cuenta del negocio · 💼 lo puso el dueño · 💰 sobrante de caja ──
// ns: "aj" (sobra frente a lo que dejó el turno anterior) · "sc" (hay más de lo que tiene el sistema). Se registra en el
// sistema ANTES de abrir el turno, con su código CJF-… (si se manda dos veces, no se registra dos veces).
function fdAj(ns, mon){ const box = ns === "sc" ? (FD.sc.aj = FD.sc.aj || {}) : FD.aj; return box[mon] = box[mon] || {}; }
function fdOrigenHTML(ns, mon, monto){
  const a = fdAj(ns, mon), p = gvPlata(mon, monto), id = ns + mon, ctas = FD.cuentas || [];
  const sel = ctas.find(c => c.id === a.cuentaId), otraMon = sel && sel.moneda !== mon, sm = m => m === "BS" ? "Bs" : "$";
  const card = (tipo, ico, tit, sub) => '<button type="button" class="cie-mot' + (a.tipo === tipo ? " on" : "") + '" onclick="fdOrigen(\'' + ns + "','" + mon + "','" + tipo + '\')">' + ico + " " + tit + "<small>" + sub + "</small></button>";
  return '<div class="cie-mots">' +
    card("traslado", "🔄", "Vino de otra cuenta del negocio", "Se sacó del banco, de Zelle, de Binance… o se cambió. Se registra como traslado: no es ingreso.") +
    (a.tipo === "traslado" ? '<div class="cie-arreglo">' + (ctas.length
      ? '<label class="lbl" for="fdCta' + id + '" style="margin-top:0;">¿De qué cuenta salieron los ' + p + "?</label>" +
        '<select class="inp" id="fdCta' + id + '" onchange="fdOrigenCta(\'' + ns + "','" + mon + '\', this.value)"><option value="">— Elige —</option>' +
        ctas.map(c => '<option value="' + esc(c.id) + '"' + (a.cuentaId === c.id ? " selected" : "") + ">" + esc(c.nombre) + " (" + sm(c.moneda) + ")</option>").join("") + "</select>" +
        (otraMon ? '<label class="lbl" for="fdOtro' + id + '">¿Cuántos ' + sm(sel.moneda) + " salieron de " + esc(sel.nombre) + "?</label>" +
          '<input class="inp" id="fdOtro' + id + '" type="number" inputmode="decimal" min="0" step="any" placeholder="' + sm(sel.moneda) + ' que salieron" value="' + esc(a.montoOrigen || "") + '" oninput="fdAj(\'' + ns + "','" + mon + '\').montoOrigen=this.value">' +
          '<div class="cie-ayuda" style="margin:4px 0 0;">Se registra como ' + (mon === "USD" ? "compra" : "venta") + " de divisas.</div>" : "")
      : "En el sistema no hay otras cuentas para elegir. Elige otra opción.") + "</div>" : "") +
    card("aporte", "💼", "Lo puso el dueño", "Se registra como aporte de capital del dueño: no es ingreso ni venta.") +
    card("sobrante", "💰", "Sobrante de caja", "No se sabe de dónde salió. Se registra como ingreso extra «Sobrante de caja».") + "</div>";
}
function fdOrigen(ns, mon, tipo){ fdAj(ns, mon).tipo = tipo; pintarTurno(); }
function fdOrigenCta(ns, mon, id){ const a = fdAj(ns, mon); a.cuentaId = id; a.montoOrigen = ""; pintarTurno(); }
// Lo elegido, listo para el sistema: { o, txt } o { err }
function fdOrigenListo(ns, mon, monto){
  const a = fdAj(ns, mon), p = gvPlata(mon, monto);
  if (!a.tipo) return { err: "Elige de dónde salieron los <b>" + p + "</b> de más." };
  const o = { id: a.oid || (a.oid = "CJF-" + uuid()), tipo: a.tipo, moneda: mon, monto: r2(Math.abs(monto)) };
  if (a.tipo === "traslado") {
    const c = (FD.cuentas || []).find(x => x.id === a.cuentaId);
    if (!c) return { err: "Elige de qué cuenta salieron los <b>" + p + "</b>." };
    o.cuentaId = c.id;
    if (c.moneda !== mon) {
      const v = r2(Number(a.montoOrigen) || 0);
      if (!(v > 0)) return { err: "Escribe cuántos " + (c.moneda === "BS" ? "Bs" : "$") + " salieron de " + esc(c.nombre) + "." };
      o.montoOrigen = v;
    }
    return { o: o, txt: "Vino de " + esc(c.nombre) + ": <b>" + p + "</b>" + (o.montoOrigen ? " (salieron " + gvPlata(c.moneda, o.montoOrigen) + ")" : ""), nota: "vino de " + c.nombre };
  }
  return { o: o, txt: (a.tipo === "aporte" ? "Lo puso el dueño" : "Sobrante de caja") + ": <b>" + p + "</b>", nota: a.tipo === "aporte" ? "lo puso el dueño" : "sobrante de caja" };
}
// 4.2: el último cierre se elige por la HORA REAL del cierre (ms), no por el texto (la hoja podía tenerlo como fecha)
function msDeTexto(txt){
  const m = String(txt || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0)).getTime() : 0;
}
async function fondoPrevCargar(){
  const caja = Number(S.datos && S.datos.caja) || 0, loc = S.ultFondo && Number(S.ultFondo.caja) === caja ? S.ultFondo : null, pide = ++FD.pide;
  FD.prev = loc ? { bs: Number(loc.bs) || 0, usd: Number(loc.usd) || 0, cajero: loc.cajero || "", cierre: loc.cierre || "", cierreMs: Number(loc.cierreMs) || msDeTexto(loc.cierre) } : null;
  if (!hayInternet()) return;
  let r = null;
  try { r = await api("cj_turno", { op: "fondo", v: 2 }, 15000); } catch (e) { r = null; }
  if (pide !== FD.pide || !r || !r.ok) return;
  if (Array.isArray(r.cuentas)) FD.cuentas = r.cuentas;
  if (!r.hay) return;
  const ms = Number(r.cierreMs) || msDeTexto(r.cierre);
  if (!FD.prev || ms >= (FD.prev.cierreMs || 0))   // el del sistema manda: trae lo que salió entre turnos para algo ya registrado
    FD.prev = { bs: Number(r.bs) || 0, usd: Number(r.usd) || 0, cajero: r.cajero || "", cierre: r.cierre || "", cierreMs: ms, queda: r.queda || null, entre: r.entre || null };
  if (_turnoOk && !FD.noCoincide && !FD.sc && $("tFondoBs")) pintarTurno();   // cambia el texto de la pregunta (lo escrito se queda)
}
function fondoVolverAContar(){ FD.contado = FD.noCoincide || (FD.ult && FD.ult.contado) || FD.contado; FD.noCoincide = null; FD.aj = {}; FD.nota = ""; FD.sc = null; FD.ult = null; pintarTurno(); setTimeout(() => { const i = $("tFondoBs"); if (i) { i.focus(); i.select(); } }, 30); }
// Falta al abrir: salió para algo que ya está registrado en el sistema (sin caja). El sistema lo descuenta de lo que dejó.
async function fdSinCaja(){
  const pv = FD.prev;
  if (!pv) return;
  const desde = pv.cierreMs || msDeTexto(pv.cierre) || Date.now() - 864e5;
  const r = await sinCajaElegir({ desde: desde, modo: "antes",
    ayuda: "Esto se registró en el sistema con el efectivo desde que se cerró el turno anterior" + (pv.cierre ? " (" + esc(fechaCorta(pv.cierre)) + " " + esc(horaDe(pv.cierre)) + ")" : "") +
           ", sin decir de qué caja. Marca lo que salió (o entró) de <b>esta gaveta</b> antes de abrir." });
  if (!r) return;
  const contado = FD.noCoincide;
  await fondoPrevCargar();   // el sistema ya descuenta lo elegido de lo que dejó
  FD.noCoincide = null; FD.aj = {};
  FD.ult = { modo: undefined, contado: contado };
  await abrirTurno($("btnAbrirIgual"));   // vuelve a comparar: si ya coincide, abre; si no, dice lo que falta
}
async function abrirConAjuste(btn){
  if (btn && btn.disabled) return;
  const err = t => { const e = $("tFondoErr"); if (e) e.innerHTML = t; };
  const grandes = fdGrandes(), lin = [];
  for (const [mon, d] of grandes) {
    const a = FD.aj[mon] = FD.aj[mon] || {}, p = gvPlata(mon, d);
    if (d > 0) { const x = fdOrigenListo("aj", mon, d); if (x.err) { err(x.err); return; } lin.push(x.txt); continue; }
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
// 4.2 · «Hay más efectivo del que tiene el sistema»: lo elegido para cada moneda, lo autoriza un administrador y vuelve a abrir
async function abrirConOrigen(btn){
  if (btn && btn.disabled || !FD.sc) return;
  const err = t => { const e = $("tFondoErr"); if (e) e.innerHTML = t; };
  const lin = [], listo = [];
  for (const m of ["BS", "USD"]) {
    const f = Number(FD.sc.faltan[m]) || 0;
    if (!(f > 0)) continue;
    const x = fdOrigenListo("sc", m, f);
    if (x.err) { err(x.err); return; }
    lin.push(x.txt); listo.push(x);
  }
  err("");
  const adm = await gvPinAdmin("Autorizar y abrir el turno", lin.join("<br>"));
  if (!adm) return;
  FD.sc.listo = listo; FD.sc.autorizo = adm.nombre;
  await abrirTurno(btn, FD.ult ? FD.ult.modo : undefined);
}
// modo: nada = el botón 🔓 Abrir turno · true = abrir igual con explicación (sin efectivo con cuenta) ·
// { autorizo } (1c) = ya se eligió qué pasó con la diferencia y un administrador puso su contraseña
async function abrirTurno(btn, modo){
  if (btn && btn.disabled) return;
  const c = cajeroPorId(_turnoOk);
  if (!c) { _turnoOk = null; pintarTurno(); return; }
  const igual = modo === true, aj = modo && typeof modo === "object" ? modo : null;
  const leido = $("tFondoBs") ? { bs: r2(Number($("tFondoBs").value) || 0), usd: r2(Number($("tFondoUsd").value) || 0) } : (FD.ult && FD.ult.contado) || { bs: 0, usd: 0 };   // 4.2: al volver de otra pantalla, lo que contó
  const fb = (igual || aj) && FD.noCoincide ? FD.noCoincide.bs : leido.bs, fu = (igual || aj) && FD.noCoincide ? FD.noCoincide.usd : leido.usd;
  const pv = FD.prev;
  let expl = "";
  if (pv && !igual && !aj && (Math.abs(fb - pv.bs) > CIE_TOL.bs + 0.0001 || Math.abs(fu - pv.usd) > CIE_TOL.usd + 0.0001)) {   // 1b: no coincide con lo que dejó el turno anterior
    FD.noCoincide = { bs: fb, usd: fu }; FD.aj = {}; FD.nota = ""; FD.sc = null; pintarTurno(); return;
  }
  if (igual) {
    expl = String(($("tFondoExpl") || {}).value || "").trim();
    if (expl.length < 10) { const e = $("tFondoErr"); if (e) e.textContent = "Escribe por qué no coincide (por lo menos una frase corta). Queda anotado en el cierre de este turno."; return; }
  }
  // 1c: el turno arranca con lo que dejó el anterior y la diferencia se registra en el turno (gaveta.js): así «Debe haber»
  // y las cuentas del negocio quedan como lo contado. Los centavos (hasta Bs 1 o $0,50) van solos como redondeo.
  // 4.2: lo que SOBRA ya no es «sobrante» solo: se dice de dónde salió y se registra antes de abrir (el fondo es lo contado).
  const movs = [], fondo = { BS: fb, USD: fu }, notas = [], origen = [];
  if (pv && !igual) {
    const nota = String(FD.nota || "").replace(/\s+/g, " ").trim();
    [["BS", fb, pv.bs], ["USD", fu, pv.usd]].forEach(([mon, contado, dejo]) => {
      const d = r2(contado - dejo), l = gvMetodos(mon);
      if (Math.abs(d) < 0.005 || !l.length) return;
      const chico = Math.abs(d) <= (mon === "BS" ? CIE_TOL.bs : CIE_TOL.usd) + 0.0001;
      if (!chico && d > 0) {
        const x = fdOrigenListo("aj", mon, d);
        if (x.o) { origen.push(x.o); notas.push("sobraban " + gvPlata(mon, d) + " (" + x.nota + ", autorizó " + (aj ? aj.autorizo : "") + ")"); }
        return;
      }
      const a = chico ? { tipo: "redondeo" } : (FD.aj[mon] || {});
      if (!a.tipo) return;
      fondo[mon] = dejo;
      movs.push({ tipo: a.tipo, moneda: mon, metodo: l[0].metodo, monto: Math.abs(d), signo: d > 0 ? 1 : -1, cat: a.tipo === "gasto" ? a.cat : "",
                  desc: a.tipo === "gasto" ? String(a.desc || "").trim() : (chico ? "al abrir el turno" : (nota || "al abrir el turno")), autorizo: chico ? "" : (aj ? aj.autorizo : "") });
      if (!chico) notas.push("faltaban " + gvPlata(mon, d) + " (" + (a.tipo === "gasto" ? "gasto " + a.cat + ": " + String(a.desc || "").trim() : "faltante de caja") + ", autorizó " + (aj ? aj.autorizo : "") + ")");
    });
    if (pv.entre && pv.entre.n) notas.push("salió para algo ya registrado en el sistema: " + [pv.entre.bs ? gvPlata("BS", pv.entre.bs) : "", pv.entre.usd ? gvPlata("USD", pv.entre.usd) : ""].filter(Boolean).join(" y "));
    if (notas.length) expl = notas.join(" y ") + (nota ? ". " + nota : "");
  }
  let autorizo = aj ? aj.autorizo : "";
  if (FD.sc && FD.sc.listo) {   // 4.2: había más de lo que tiene el sistema
    FD.sc.listo.forEach(x => origen.push(x.o));
    autorizo = autorizo || FD.sc.autorizo;
    expl = (expl ? expl + ". " : "") + "Había más efectivo del que tenía el sistema: " + FD.sc.listo.map(x => x.nota + " " + gvPlata(x.o.moneda, x.o.monto)).join(" y ") + " (autorizó " + FD.sc.autorizo + ")";
  }
  btnOcupado(btn, "Abriendo…");
  const ahora = new Date();
  const t = { id: "T-" + (S.datos.equipo || "EQ") + "-" + ahoraTxt(ahora).replace(/\D/g, "").slice(0, 12) + "-" + uuid().slice(0, 4),
              cajeroId: c.id, cajeroNombre: c.nombre, apertura: ahoraTxt(ahora), aperturaMs: ahora.getTime(),   // 3.0: la hora exacta, para el efectivo movido desde el sistema
              fondoBs: r2(fondo.BS), fondoUsd: r2(fondo.USD), fondoContado: { bs: fb, usd: fu },
              fondoPrev: pv ? { bs: pv.bs, usd: pv.usd, cajero: pv.cajero, cierre: pv.cierre } : null, fondoExpl: expl };   // 1b
  FD.ult = { modo: modo, contado: { bs: fb, usd: fu } };
  // 4.1 · Un turno por caja: se abre SOLO con internet. El sistema revisa que esta caja no esté abierta en otro equipo
  // y deja el turno anotado de una vez. 4.2: y que lo contado no pase del efectivo que tiene el sistema.
  let rA = null;
  if (hayInternet()) { try { rA = await api("cj_turno", { op: "abrir", v: 2, turno: Object.assign(turnoParaSistema(t), { fondoContado: t.fondoContado }), origen: origen, autorizo: autorizo }, 60000); } catch (e) { rA = null; } }
  if (!rA) {
    btnLibre(btn);
    aviso({ icono: "📡", titulo: "Hace falta internet para abrir el turno", html: "Para abrir el turno, la caja tiene que revisar en el sistema que la <b>Caja " + esc(S.datos.caja) + "</b> no esté abierta en otro equipo.<br><br>Conéctate a internet y vuelve a tocar <b>Abrir turno</b>. Después de abierto, la caja vende con o sin internet." });
    return;
  }
  if (rA.ok === false && /no reconocida/i.test(String(rA.msg || ""))) { /* el sistema todavía no tiene esta versión: abre como antes */ }
  else if (rA.ok === false) { btnLibre(btn); aviso({ icono: "❌", titulo: "No se abrió el turno", html: esc(rA.msg || "El sistema no respondió.") }); return; }
  else if (rA.libre === false) { btnLibre(btn); aviso({ icono: "🔒", titulo: "La Caja " + esc(S.datos.caja) + " ya está abierta", html: esc(rA.msg) }); return; }
  else if (rA.sinCubrir) {   // 4.2: contó más efectivo del que tiene el sistema → decir de dónde salió
    btnLibre(btn);
    FD.sc = { faltan: rA.sinCubrir, info: rA.info || {}, contado: { bs: fb, usd: fu }, aj: (FD.sc && FD.sc.aj) || {} };
    pintarTurno();
    return;
  }
  try { await kvSet("turno", t); }
  catch (e) { btnLibre(btn); aviso({ icono: "❌", titulo: "No se abrió el turno", html: "El equipo no pudo guardar el turno (" + esc(e.message) + "). Vuelve a intentar." }); return; }
  S.turno = t; _turnoOk = null; _turnoSel = null; FD.noCoincide = null; FD.contado = null; FD.aj = {}; FD.nota = ""; FD.sc = null; FD.ult = null;
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
  S.cierreAdmin = null; PK.c = null;
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
function bloqModo(m){ BQ.modo = m; BQ.motivo = ""; PK.c = null; pintarBloqueo(); }
function textoSinAdmin(){
  return "Para eso hace falta un <b>administrador</b> (un usuario con todos los permisos) con permiso de esta caja. Se arregla en el sistema, <b>Configuración → Usuarios</b>, y aquí, con internet, se toca <b>🔄 Actualizar datos</b>.";
}
function pintarBloqueo(){
  const box = $("bloqCuerpo"), t = S.turno;
  if (!box || !t) return;
  const c = cajeroPorId(t.cajeroId), admins = cajerosAdmin().filter(a => !c || a.id !== c.id), adm = admins[0] || null;
  const admOk = !!adm;
  const btnAct = '<button type="button" class="btn" onclick="actualizarDatos(this)">🔄 Actualizar datos</button>';
  if (BQ.modo === "admin" && admOk) {
    if (PK.pre === "bq" && PK.c && PK.c.admin && $("bqClave")) return;   // ya está pidiendo la contraseña
    box.innerHTML = '<div class="bq-ico">⭐</div><div class="pk-hola">' + (admins.length > 1 ? "Administrador" : esc(adm.nombre)) + "</div>" +
      '<div class="pk-sub">' + (admins.length > 1 ? "Elige quién eres y escribe tu contraseña" : "Escribe tu contraseña") + ' para cerrar el turno de <b>' + esc(t.cajeroNombre) + "</b>.</div>" + htmlTeclado("bq", adm, admins) +
      '<div class="pk-links"><button type="button" class="btn" onclick="bloqModo(\'turno\')">← Volver</button></div>';
    pkPreparar("bq", adm, a => {
      desbloquear();
      S.cierreAdmin = { id: a.id, nombre: a.nombre };
      mostrarVista("cierre"); pintarCierre();
    }, "", admins);
    return;
  }
  if (BQ.modo === "otro" || !c) {
    PK.c = null;
    const esAdm = !!(c && c.admin), sinPin = !c;
    box.innerHTML = '<div class="bq-ico">👥</div><div class="pk-hola">' + (sinPin ? "Caja bloqueada" : "Va a entrar otro cajero") + "</div>" +
      '<div class="pk-sub bq-txt">' +
      (sinPin ? "El turno abierto es de <b>" + esc(t.cajeroNombre) + "</b>, pero ese usuario ya no tiene permiso de esta caja (o se borró), así que hay que cerrar su turno.<br><br>"
              : "El turno de <b>" + esc(t.cajeroNombre) + "</b> sigue abierto. Para que entre otro cajero, primero se <b>cierra ese turno</b> contando el efectivo de la gaveta.<br><br>" +
                "• Si <b>" + esc(t.cajeroNombre) + "</b> está aquí: que escriba su contraseña y cierre su turno en <b>☰ Menú → Cerrar turno</b>.<br>") +
      (esAdm ? "" : "• Si " + (sinPin ? "no está" : "ya se fue") + ": lo cierra un <b>administrador</b> con su contraseña.") +
      (!esAdm && !admOk ? "<br><br>" + textoSinAdmin() : "") + "</div>" +
      '<div class="pk-links">' + (!esAdm && admOk ? '<button type="button" class="btn green" onclick="bloqModo(\'admin\')">⭐ Lo cierra un administrador</button>' : "") +
      (!esAdm && !admOk ? btnAct : "") +
      (sinPin ? "" : '<button type="button" class="btn" onclick="bloqModo(\'turno\')">← Volver</button>') + "</div>";
    return;
  }
  if (PK.pre === "bq" && PK.c && PK.c.id === c.id && $("bqClave")) return;   // ya está pidiendo la contraseña: no se borra lo escrito
  box.innerHTML = '<div class="bq-ico">🔒</div><div class="pk-hola">Hola, ' + esc(c.nombre) + " 👋</div>" +
    '<div class="pk-sub">' + (BQ.motivo ? esc(BQ.motivo) + "<br>" : "") + "Escribe tu contraseña para seguir vendiendo.</div>" + htmlTeclado("bq", c) +
    '<div class="pk-links"><button type="button" class="lnk" onclick="bloqModo(\'otro\')">👥 Va a entrar otro cajero</button></div>';
  pkPreparar("bq", c, () => { desbloquear(); toast("👋 Hola, " + c.nombre); });
}
// El administrador abrió el cierre del turno de otro: no puede vender en ese turno
function cancelarCierreAdmin(){ S.cierreAdmin = null; bloquear(); }

// ── Caja bloqueada: ninguna tecla llega a la venta (solo a la contraseña del bloqueo o a un mini modal encima) ──
document.addEventListener("keydown", e => {
  if (!BQ.on || document.body.classList.contains("entrando")) return;
  const t = e.target;
  if (t && t.closest && (t.closest("#bloqueo") || t.closest(".mfondo"))) return;
  e.stopPropagation(); if (e.key !== "Tab") e.preventDefault();
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

