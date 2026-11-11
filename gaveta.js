"use strict";
// ══════════════════════════════════════════════════════════════
//  GAVETA · Tanda 1c (caja 3.3, 8-11-2026): todo el efectivo que entra o sale de la gaveta queda registrado
//   · El turno NO se cierra si el efectivo no cuadra. Lo que falta o sobra lo autoriza un administrador con su contraseña:
//       falta → 💸 fue un gasto pagado con la gaveta (Egresos, con su tipo)  ·  💱 faltante de caja (Egresos)
//       sobra → 🧾 falta registrar una venta (se cobra como siempre)          ·  💰 sobrante de caja (Ingresos extra)
//   · Los centavos (hasta Bs 1 o $0,50) se registran solos al cerrar, como «Redondeo de caja».
//   · Durante el turno: ☰ Menú → 💸 Sacar efectivo (un gasto pagado con la gaveta: agua, hielo, un flete…).
//   · Solo efectivo de la gaveta (Bs y $). Un Pago Móvil o una transferencia se registran en el sistema (Egresos).
//   · Cada registro se guarda primero en el equipo (cuenta en el turno aunque no haya internet) y se sube una
//     sola vez al sistema (cj_turno op "mov", MovCaja.gs): la cuenta de efectivo y los reportes quedan al día.
// ══════════════════════════════════════════════════════════════
const GV_TIPOS = {
  gasto:    { ico: "💸", txt: "Gasto pagado con el efectivo de la caja" },
  faltante: { ico: "💱", txt: "Faltante de caja" },
  sobrante: { ico: "💰", txt: "Sobrante de caja" },
  redondeo: { ico: "🪙", txt: "Redondeo de caja" }
};
const GV = { mon: "BS", sube: false };
function gvSimbolo(mon){ return mon === "BS" ? "Bs " : "$"; }
function gvPlata(mon, v){ return gvSimbolo(mon) + fmt(Math.abs(v)); }

// ── Lo registrado en un turno ──
function gvMovsTurno(tid){ return (S.movs || []).filter(m => m.turno === tid); }
function gvSuma(tid){
  let bs = 0, usd = 0;
  gvMovsTurno(tid).forEach(m => { const v = (Number(m.signo) || 0) * (Number(m.monto) || 0); if (m.moneda === "BS") bs += v; else usd += v; });
  return { bs: r2(bs), usd: r2(usd) };
}
function gvEtiqueta(m){
  const t = GV_TIPOS[m.tipo] || { ico: "•", txt: m.tipo };
  return t.ico + " " + (m.tipo === "gasto" ? "Gasto" + (m.cat ? " (" + m.cat + ")" : "") + (m.desc ? ": " + m.desc : "") : t.txt + (m.desc ? ": " + m.desc : ""));
}
// Para el cierre (va dentro del JSON del cierre)
function gvParaCierre(tid){ return gvMovsTurno(tid).map(m => ({ tipo: m.tipo, moneda: m.moneda, monto: m.monto, signo: m.signo, cat: m.cat || "", desc: m.desc || "", autorizo: m.autorizo || "", hora: horaDe(m.creada) })); }

// ── Los métodos de efectivo de la gaveta (con cuenta en el sistema) ──
function gvMetodos(mon){ return metodos().filter(m => m.tipo === mon && m.conCuenta !== false && esEfectivo({ metodo: m.metodo, tipo: m.tipo })); }
function gvSinMetodo(mon){
  return aviso({ icono: "⚠️", titulo: "No hay efectivo en " + (mon === "BS" ? "Bs" : "$"),
    html: "En el sistema no hay un método de pago de <b>efectivo en " + (mon === "BS" ? "Bs" : "dólares") + "</b> ligado a una cuenta. El administrador lo arregla en <b>Configuración → métodos de pago</b> y aquí, con internet, se toca <b>🔄 Actualizar datos</b>." });
}

// ── Lo autoriza un administrador con su contraseña (todo lo de la gaveta) ──
// Devuelve el administrador si acertó, o null si cerró la ventana.
async function gvPinAdmin(titulo, texto){
  const admins = cajerosAdmin(), adm = admins[0];
  if (!adm) { await aviso({ icono: "⭐", titulo: "Hace falta un administrador", html: "Esto lo autoriza un <b>administrador</b> con su contraseña, y esta caja todavía no tiene. " + textoSinAdmin() }); return null; }
  const prev = { c: PK.c, pre: PK.pre, alAcertar: PK.alAcertar, lista: PK.lista };   // si estaba pidiendo otra contraseña en pantalla
  const r = await modal({ icono: "⭐", titulo: titulo, centrado: true,
    html: '<div class="m-txt" style="text-align:center;margin-bottom:6px;">' + texto + "<br>" + (admins.length > 1 ? "Lo autoriza un <b>administrador</b> con su contraseña." : "Lo autoriza <b>" + esc(adm.nombre) + "</b> con su contraseña.") + "</div>" + htmlTeclado("pa", adm, admins),
    botones: [{ txt: "Cancelar", v: null }],
    alAbrir: (fondo, cerrar) => pkPreparar("pa", adm, a => cerrar(a), "", admins) });
  if (PK.pre === "pa") { PK.c = prev.c; PK.pre = prev.pre; PK.alAcertar = prev.alAcertar; PK.lista = prev.lista; PK.ocupado = false; }
  return r || null;
}

// ── Guardar en el equipo y subir ──
async function gvRegistrar(o){
  const t = S.turno;
  if (!t) return null;
  const m = Object.assign({ id: "CJM-" + uuid(), turno: t.id, caja: S.datos.caja, cajero: t.cajeroNombre, creada: ahoraTxt(), fecha: hoyTxt(),
                            cat: "", desc: "", autorizo: "", estado: "por_subir", msg: "" }, o);
  m.monto = r2(m.monto);
  S.movs.push(m);
  try { await kvSet("movs", S.movs); }
  catch (e) {
    S.movs.pop();
    await aviso({ icono: "❌", titulo: "No se registró", html: "El equipo no pudo guardarlo (" + esc(e.message) + "). Vuelve a intentar." });
    return null;
  }
  pintarEstado();
  if (S.vista === "ventas") pintarVentas();
  gvSubir();
  return m;
}
function gvParaSubir(m){ return { id: m.id, tipo: m.tipo, moneda: m.moneda, metodo: m.metodo, monto: m.monto, signo: m.signo, cat: m.cat, desc: m.desc, fecha: m.fecha, autorizo: m.autorizo, cajero: m.cajero }; }
async function gvSubir(){
  if (GV.sube || !S.eq || !S.datos || S.online === false) return;
  const cola = (S.movs || []).filter(m => m.estado === "por_subir");
  if (!cola.length) return;
  GV.sube = true;
  let cambio = false;
  try {
    for (const m of cola) {
      let r;
      try { r = await api("cj_turno", { op: "mov", turno: { id: m.turno, cajeroNombre: m.cajero, mov: gvParaSubir(m) } }, 60000); }
      catch (e) { m.msg = e.message; cambio = true; break; }   // sin conexión: no cuenta como falla
      cambio = true;
      if (r && r.codigo === "EQUIPO") { m.msg = r.msg || ""; break; }
      if (r && r.ok) { m.estado = "subido"; m.msg = ""; m.fallas = 0; }
      else if (r && r.estado === "invalida") { m.estado = "rechazado"; m.msg = r.msg || "El sistema no lo aceptó."; }
      else { m.msg = (r && r.msg) || "No se pudo subir."; m.fallas = (Number(m.fallas) || 0) + 1; continue; }   // 4.5: cuenta la falla y sigue con lo demás
    }
  } finally {
    GV.sube = false;
    // Los subidos de turnos ya cerrados se guardan 30 días (el cierre impreso ya los tiene)
    const hace = new Date(Date.now() - 30 * 864e5), lim = hoyTxt(hace);
    S.movs = S.movs.filter(m => m.estado !== "subido" || (S.turno && m.turno === S.turno.id) || String(m.fecha) >= lim);
    if (cambio) { try { await kvSet("movs", S.movs); } catch (e) {} }
    pintarEstado();
    if (S.vista === "ventas") pintarVentas();
  }
}

// ══ 💸 SACAR EFECTIVO: un gasto pagado con la gaveta ══
// o = { moneda, monto } cuando viene del cierre (lo que falta)
async function gvGasto(o){
  o = o || {};
  if (!S.turno) { aviso({ icono: "🔒", titulo: "No hay turno abierto", html: "Para sacar efectivo de la caja tiene que haber un turno abierto." }); return; }
  if (BQ.on) return;
  GV.mon = o.moneda === "USD" ? "USD" : "BS";
  if (!gvMetodos("BS").length && !gvMetodos("USD").length) { gvSinMetodo(GV.mon); return; }
  const tipos = ((S.datos && S.datos.tiposEgreso) || []).filter(Boolean);
  const listaTipos = tipos.length ? tipos : ["Otros"];
  const html = '<div class="m-txt" style="margin-bottom:8px;">Para lo que se paga <b>en efectivo con el dinero de la caja</b> (agua, hielo, un flete…). Un Pago Móvil o una transferencia se registran en el sistema (Egresos).</div>' +
    '<label class="lbl" style="margin-top:0;">¿En qué moneda salió?</label>' +
    '<div class="gv-mon"><button type="button" class="cie-mot" id="gvMonBS" onclick="gvMoneda(\'BS\')">💵 Bs</button><button type="button" class="cie-mot" id="gvMonUSD" onclick="gvMoneda(\'USD\')">💵 Dólares ($)</button></div>' +
    '<div id="gvMetBox"></div>' +
    '<label class="lbl" for="gvMonto">¿Cuánto salió?</label><input class="inp cie-num" id="gvMonto" type="number" inputmode="decimal" min="0" step="any" placeholder="Monto">' +
    '<div class="cie-ayuda" id="gvHay" style="margin:4px 0 0;"></div>' +
    '<label class="lbl" for="gvTipo">Tipo de gasto</label><select class="inp" id="gvTipo"><option value="">— Elige —</option>' + listaTipos.map(t => '<option value="' + esc(t) + '">' + esc(t) + "</option>").join("") + "</select>" +
    '<label class="lbl" for="gvDesc">¿Qué se pagó?</label><input class="inp" id="gvDesc" maxlength="120" placeholder="Ej. 2 botellones de agua">' +
    '<div class="m-err" id="gvErr"></div>';
  let datos = null;
  const r = await modal({ icono: "💸", titulo: "Sacar efectivo de la caja", html: html, foco: "gvMonto",
    botones: [{ txt: "Cancelar", v: false }, { txt: "Siguiente: lo autoriza un administrador →", v: true, cls: "green" }],
    alAbrir: fondo => {
      gvMoneda(GV.mon);
      if (o.monto) $("gvMonto").value = String(r2(o.monto));
      ["gvMonto", "gvDesc"].forEach(id => $(id).addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const b = fondo.querySelector('.mf .btn-m[data-v="ok"]'); if (b) b.click(); } }));
    },
    antes: v => {
      if (!v) return true;
      const err = t => { $("gvErr").innerHTML = t; return false; };
      const mon = GV.mon, metodo = $("gvMet") ? $("gvMet").value : ((gvMetodos(mon)[0] || {}).metodo || "");
      const monto = r2(Number($("gvMonto").value) || 0), tipo = $("gvTipo").value, desc = $("gvDesc").value.replace(/\s+/g, " ").trim();
      if (!metodo) return err("No hay un método de efectivo en " + (mon === "BS" ? "Bs" : "$") + " ligado a una cuenta en el sistema.");
      if (!(monto > 0)) return err("Escribe cuánto salió.");
      if (!tipo) return err("Elige el tipo de gasto.");
      if (desc.length < 3) return err("Escribe qué se pagó.");
      datos = { mon, metodo, monto, tipo, desc };
      return true;
    } });
  if (!r || !datos) return;
  const adm = await gvPinAdmin("Autorizar el gasto", "Sale de la caja <b>" + gvPlata(datos.mon, datos.monto) + "</b><br>" + esc(datos.tipo) + ": " + esc(datos.desc));
  if (!adm) return;
  const m = await gvRegistrar({ tipo: "gasto", moneda: datos.mon, metodo: datos.metodo, monto: datos.monto, signo: -1, cat: datos.tipo, desc: datos.desc, autorizo: adm.nombre });
  if (!m) return;
  toast("✅ Gasto registrado: " + gvPlata(m.moneda, m.monto));
  if (S.vista === "cierre") pintarCierre();
}
function gvMoneda(mon){
  GV.mon = mon;
  ["BS", "USD"].forEach(k => { const b = $("gvMon" + k); if (b) b.classList.toggle("on", k === mon); });
  const l = gvMetodos(mon), box = $("gvMetBox");
  if (box) box.innerHTML = !l.length ? '<div class="m-err" style="margin-top:6px;">No hay efectivo en ' + (mon === "BS" ? "Bs" : "$") + " ligado a una cuenta en el sistema.</div>"
    : l.length === 1 ? "" : '<label class="lbl" for="gvMet">¿De qué efectivo?</label><select class="inp" id="gvMet">' + l.map(m => '<option value="' + esc(m.metodo) + '">' + esc(m.metodo) + "</option>").join("") + "</select>";
  const hay = $("gvHay");
  if (hay && S.turno) { const R = resumenTurno(S.turno), sis = (CIE.sis && CIE.tid === S.turno.id && CIE.sis.ok) ? CIE.sis : { bs: 0, usd: 0 };
    const v = mon === "BS" ? r2(R.efBsEsperado + (sis.bs || 0)) : r2(R.efUsdEsperado + (sis.usd || 0));
    hay.textContent = "Según lo registrado, en la caja debería haber " + gvSimbolo(mon) + fmt(v) + "."; }
}

// ══ FALTANTE O SOBRANTE DE CAJA (desde el cierre) ══
async function gvAjuste(tipo, mon, monto){
  if (!S.turno || BQ.on) return;
  monto = r2(Math.abs(monto));
  const l = gvMetodos(mon);
  if (!l.length) { gvSinMetodo(mon); return; }
  const falta = tipo === "faltante", sim = gvSimbolo(mon);
  const html = '<div class="m-txt">' + (falta
      ? "En la caja hay <b>" + sim + fmt(monto) + " menos</b> de lo que debería. Se registra como <b>gasto</b> («Faltante de caja») y sale de la cuenta del efectivo, para que las cuentas del negocio queden igual a lo que hay en la caja."
      : "En la caja hay <b>" + sim + fmt(monto) + " más</b> de lo que debería. Se registra como <b>ingreso extra</b> («Sobrante de caja») y entra a la cuenta del efectivo, para que las cuentas del negocio queden igual a lo que hay en la caja.") + "</div>" +
    (l.length > 1 ? '<label class="lbl" for="gvMet">¿De qué efectivo?</label><select class="inp" id="gvMet">' + l.map(m => '<option value="' + esc(m.metodo) + '">' + esc(m.metodo) + "</option>").join("") + "</select>" : "") +
    '<label class="lbl" for="gvNota">¿Qué pasó? (opcional)</label><input class="inp" id="gvNota" maxlength="120" placeholder="' + (falta ? "Ej. le di Bs 50 de más de vuelto a un cliente" : "Ej. un cliente pagó y no se registró") + '">';
  let met = l[0].metodo, nota = "";
  const r = await modal({ icono: falta ? "💱" : "💰", titulo: (falta ? "Faltante de caja: " : "Sobrante de caja: ") + sim + fmt(monto), html: html, foco: "gvNota",
    botones: [{ txt: "Cancelar", v: false }, { txt: "Siguiente: lo autoriza un administrador →", v: true, cls: "green" }],
    antes: v => { if (v) { met = $("gvMet") ? $("gvMet").value : met; nota = $("gvNota").value.replace(/\s+/g, " ").trim(); } return true; } });
  if (!r) return;
  const adm = await gvPinAdmin(falta ? "Autorizar el faltante" : "Autorizar el sobrante", (falta ? "Faltante" : "Sobrante") + " de caja: <b>" + sim + fmt(monto) + "</b>" + (nota ? "<br>" + esc(nota) : ""));
  if (!adm) return;
  const m = await gvRegistrar({ tipo: tipo, moneda: mon, metodo: met, monto: monto, signo: falta ? -1 : 1, desc: nota, autorizo: adm.nombre });
  if (!m) return;
  toast("✅ " + (falta ? "Faltante" : "Sobrante") + " registrado: " + sim + fmt(monto));
  if (S.vista === "cierre") pintarCierre();
}

// ══ 4.2 · YA ESTÁ REGISTRADO EN EL SISTEMA (sin decir de qué caja) ══
// Muestra los movimientos de las cuentas de efectivo registrados en el sistema desde «desde» sin caja; el cajero marca los
// de esta gaveta y un administrador lo autoriza. o = { desde (ms), modo: "turno" | "antes", turnoId, ayuda }
// Devuelve { n, bs, usd } si quedó anotado en el sistema, o null.
async function sinCajaElegir(o){
  if (!hayInternet()) { await aviso({ icono: "📡", titulo: "Hace falta internet", html: "Para ver lo que está registrado en el sistema hace falta internet. Conéctate y vuelve a intentar." }); return null; }
  let lista = null, elegidos = [];
  const r = await modal({ icono: "📋", titulo: "Ya está registrado en el sistema", ancho: true,
    html: '<div class="m-txt" style="margin-bottom:8px;">' + (o.ayuda || "") + '</div><div id="scLista"><div class="cie-ayuda" style="text-align:center;padding:14px;"><span class="sp"></span> Buscando en el sistema…</div></div><div class="m-err" id="scErr"></div>',
    botones: [{ txt: "Cancelar", v: false }, { txt: "Siguiente: lo autoriza un administrador →", v: true, cls: "green" }],
    alAbrir: async () => {
      try { lista = await api("cj_turno", { op: "sincaja", desde: o.desde }, 30000); } catch (e) { lista = { ok: false, msg: e.message }; }
      const box = $("scLista");
      if (!box) return;
      if (!lista || !lista.ok) { box.innerHTML = '<div class="m-err">No se pudo buscar en el sistema: ' + esc((lista && lista.msg) || "no respondió") + ". Vuelve a intentar.</div>"; return; }
      if (!(lista.movs || []).length) { box.innerHTML = '<div class="cie-arreglo">No hay nada registrado con el efectivo sin decir de qué caja. Si alguien lo pagó desde el sistema y todavía no lo registró, que lo registre eligiendo <b>Caja ' + esc(S.datos.caja) + "</b> en <b>¿De qué caja salió?</b>.</div>"; return; }
      box.innerHTML = lista.movs.map((m, i) => '<label class="sc-it"><input type="checkbox" data-i="' + i + '"><span><b>' + (m.monto < 0 ? "Salieron " : "Entraron ") + gvPlata(m.moneda, m.monto) + "</b> · " + esc(m.etiqueta) +
        "<small>" + esc(m.hora) + " · " + esc(m.detalle) + "</small></span></label>").join("");
    },
    antes: v => {
      if (!v) return true;
      const err = t => { const e = $("scErr"); if (e) e.innerHTML = t; return false; };
      if (!lista) return err("Todavía estoy buscando en el sistema. Espera un momento.");
      if (!lista.ok || !(lista.movs || []).length) return err("No hay nada para elegir.");
      elegidos = [...document.querySelectorAll("#scLista input[type=checkbox]:checked")].map(x => lista.movs[Number(x.dataset.i)]).filter(Boolean);
      if (!elegidos.length) return err("Marca lo que salió (o entró) de esta caja.");
      return true;
    } });
  if (!r || !elegidos.length) return null;
  const adm = await gvPinAdmin("Autorizar", elegidos.map(m => (m.monto < 0 ? "Salieron " : "Entraron ") + "<b>" + gvPlata(m.moneda, m.monto) + "</b> · " + esc(m.detalle)).join("<br>"));
  if (!adm) return null;
  let a = null;
  try { a = await api("cj_turno", { op: "asignar", desde: o.desde, claves: elegidos.map(m => m.clave), modo: o.modo, turnoId: o.turnoId || "", autorizo: adm.nombre }, 30000); }
  catch (e) { a = { ok: false, msg: e.message }; }
  if (!a || !a.ok) { await aviso({ icono: "❌", titulo: "No se anotó", html: esc((a && a.msg) || "El sistema no respondió.") + " Vuelve a intentar." }); return null; }
  toast("✅ Anotado: " + a.n + (a.n === 1 ? " movimiento" : " movimientos"));
  return a;
}

// ══ REDONDEO: al cerrar, los centavos que no cuadran (hasta Bs 1 o $0,50) se registran solos ══
async function gvRedondeo(x){
  const hechos = [];
  for (const [mon, d] of [["BS", x.dBs], ["USD", x.dUsd]]) {
    if (d == null || Math.abs(d) < 0.005) continue;
    const l = gvMetodos(mon);
    if (!l.length) continue;   // sin efectivo con cuenta: queda la diferencia de centavos en el cierre
    const m = await gvRegistrar({ tipo: "redondeo", moneda: mon, metodo: l[0].metodo, monto: Math.abs(d), signo: d > 0 ? 1 : -1, desc: "", autorizo: "" });
    if (!m) return null;
    hechos.push(m);
  }
  return hechos;
}

// ══ Lo de la gaveta en «Ventas de este equipo» (turno abierto) ══
function gvHTMLVentas(){
  if (!S.turno) return "";
  const l = gvMovsTurno(S.turno.id);
  const est = m => m.estado === "subido" ? '<span class="dif-ok">✓ en el sistema</span>' : m.estado === "rechazado" ? '<span class="dif-mal">❌ ' + esc(m.msg || "no se registró") + "</span>" : '<span style="color:' + (trabado(m, "mov") ? "var(--red)" : "var(--blue)") + ';">⏳ por subir' + (m.msg ? " · " + esc(m.msg) : "") + "</span>";
  return '<div class="card" style="margin-bottom:10px;"><div class="card-tit">💵 Efectivo sacado o ajustado en este turno</div>' +
    (l.length ? '<table class="cie-tabla">' + l.map(m => "<tr><td>" + esc(gvEtiqueta(m)) + '<div class="cie-sis">' + esc(horaDe(m.creada)) + (m.autorizo ? " · autorizó " + esc(m.autorizo) : "") + " · " + est(m) + '</div></td><td class="r">' +
      (m.signo < 0 ? "− " : "+ ") + gvPlata(m.moneda, m.monto) + "</td></tr>").join("") + "</table>" : '<div class="cie-ayuda" style="margin:0 0 8px;">Nada todavía.</div>') +
    '<button type="button" class="btn sm" onclick="gvGasto()">💸 Sacar efectivo (gasto)</button></div>';
}

// ── Escape cierra el pago (si no hay otra ventana encima ni se está guardando) ──
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || BQ.on) return;
  const mp = $("mPago");
  if (!mp || mp.classList.contains("oculto")) return;
  if (document.querySelector(".mfondo:not(.oculto):not(#mPago)")) return;
  if ($("pgCerrar") && $("pgCerrar").disabled) return;
  e.preventDefault();
  if (!$("pgPieOk").classList.contains("oculto")) pgTerminar(false); else cerrarPago();
});
