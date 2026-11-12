// ══════════════════════════════════════════════════════════════
//  Caja · ControlMaster — LAS TASAS (4.9 · 12-11-2026)
//  · La tasa BCV ya no se escribe a mano: 🔄 la trae del BCV (con su fecha valor) y queda en el sistema.
//  · Fin de semana / feriado: si el BCV ya publicó la tasa de un día que no llega, la caja pregunta con
//    cuál se cobra hoy. Lo que se elige vale para todo el negocio (las demás cajas ya no preguntan).
//  · % de brecha / Divisas (TasaBin encendido) y Divisas de los $ en efectivo (apagado): se guardan en el
//    sistema, con la clave de las tasas si el sistema la pide.
//  · Las tasas llegan a todas las cajas cada 2 minutos (con la consulta de existencias).
//  Servidor: cj_tasas (contenedor A12) → CajaTasas.gs (biblioteca).
// ══════════════════════════════════════════════════════════════

const DIAS_SEM = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
function fechaDia(iso){   // "2026-11-14" → "viernes 14/11"
  const p = String(iso || "").split("-");
  if (p.length !== 3) return String(iso || "");
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12);
  return DIAS_SEM[d.getDay()] + " " + p[2] + "/" + p[1];
}
function esFinDeSemana(){ const g = new Date().getDay(); return g === 0 || g === 6; }
function tasaEspera(){ const e = S.datos && S.datos.tasaEspera; return e && Number(e.tasa) > 0 && e.fechaValor > hoyTxt() ? e : null; }
function hayQuePreguntarTasa(){ const e = tasaEspera(); return !!(e && e.preguntar && tasaVieja()); }

// Las tasas que mandó el sistema («ver» de cj_tasas) entran a la caja. Si cambian y hay una factura en pantalla,
// se recalcula y se avisa (como cuando llegan los datos). Con el pago abierto se esperan a la próxima vuelta.
async function tomarTasas(tv, opc){
  opc = opc || {};
  if (!tv || !(Number(tv.tasa) > 0) || !S.datos) return false;
  if (P && !opc.forzar) return false;
  const d = S.datos, on = tv.binOn === true;
  d.tasa = Number(tv.tasa) || 0; d.tasaBinance = Number(tv.tasaBinance) || 0; d.tasaDivisas = Number(tv.tasaDivisas) || 0;
  d.binOn = on; d.brechaPct = Number(tv.brechaPct) || 0; d.tasaFecha = tv.tasaFecha || ""; d.tasaEspera = tv.espera || null;
  try { await kvSet("datos", d); } catch (e) {}
  const nueva = { bcv: d.tasa, div: on ? (d.tasaBinance || d.tasa) : d.tasaDivisas, binOn: on, brecha: d.brechaPct,
                  fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(tv.tasaFecha || "")) ? tv.tasaFecha : hoyTxt(), origen: "sistema" };
  const t = S.tasas || {};
  const cambio = t.bcv !== nueva.bcv || t.div !== nueva.div || t.binOn !== nueva.binOn || t.fecha !== nueva.fecha || t.origen !== "sistema";
  if (cambio) {
    const tot0 = F.items.length ? totales(F.items, F.desc).total : 0;
    const antes = F.items.length ? { total: tot0, u: unidadU(), bs: r2(tot0 * bsPorU()) } : null;
    S.tasas = nueva;
    if (!on) F.dolares = false;
    try { await kvSet("tasas", S.tasas); } catch (e) {}
    repreciar();
    if (antes && !opc.silencio && !opc.forzar) {   // lo cambió otra caja o el sistema (si lo cambió el cajero aquí, ya lo sabe)
      const ahora = totales(F.items, F.desc).total, bsAhora = r2(ahora * bsPorU());
      if (antes.u === unidadU() && (Math.abs(ahora - antes.total) >= 0.005 || Math.abs(bsAhora - antes.bs) >= 0.005))
        aviso({ icono: "💱", titulo: "Precios recalculados", html: "Cambiaron las tasas del sistema: " + textoTasas() + ".<br><br>Total de la venta en pantalla: <b>Bs " + fmt(antes.bs) + "</b> → <b>Bs " + fmt(bsAhora) + "</b>" +
          (Math.abs(ahora - antes.total) >= 0.005 ? " (" + txtU(antes.total) + " → " + txtU(ahora) + ")" : "") + ".<br><br>Si ya le habías dicho el total al cliente, avísale del cambio." });
    }
    try { pintarCabecera(); pintarAjustes(); buscar(); pintarFactura(); } catch (e) {}
  }
  pintarBanners();
  if (!opc.sinPreguntar) setTimeout(revisarTasaEspera, 300);
  return cambio;
}

// ══ Ver las tasas (el 💱 de arriba y ⚙️ → Tasas) ══
async function verTasas(){
  const t = S.tasas || {}, e = tasaEspera(), on = !!t.binOn;
  const html = '<div class="m-txt">' + textoTasas() + '<br><span style="color:var(--text-dim);font-size:13px;">BCV del ' + esc(fechaDia(t.fecha)) +
      (tasaVieja() ? ' · <b style="color:var(--amber);">no es de hoy</b>' : "") + "</span>" +
      (e ? '<br><br>💱 El BCV ya publicó la del <b>' + esc(fechaDia(e.fechaValor)) + "</b>: Bs " + fmt(e.tasa) + "." : "") +
      '<br><br><span style="font-size:13px;color:var(--text-dim);">La tasa BCV la trae el sistema del BCV: no se escribe a mano. ' +
      (on ? "El % de brecha" : "La tasa Divisas de los $ en efectivo") + " sí se puede cambiar" + (S.datos && S.datos.pideClave && S.datos.pideClave.tasa ? " (con la clave)" : "") + ".</span></div>";
  const r = await modal({ icono: "💱", titulo: "Tasas para cobrar", html: html, ancho: false,
    botones: [{ txt: "Cerrar", v: false }, { txt: on ? "% Cambiar brecha" : "💵 Cambiar Divisas", v: "div" }, { txt: "🔄 Actualizar tasa BCV", v: "bcv", cls: "green" }] });
  if (r === "bcv") return actualizarTasaBCV(null);
  if (r === "div") return cambiarDivisas();
}
async function cambiarTasa(btn){ return verTasas(); }   // ⚙️ → Tasas (antes «Cambiar tasa»)

function puedeHablarConSistema(que){
  if (!hayInternet() || !sesionViva()) {
    aviso({ icono: "📡", titulo: "Hace falta internet", html: que + " se hace en el sistema: hace falta <b>internet</b>. Mientras tanto la caja sigue con las tasas que tiene: " + textoTasas() + "." });
    return false;
  }
  return true;
}

// ══ 🔄 Actualizar tasa BCV (sin clave: solo trae la tasa oficial) ══
let _bcvOcupado = false;
async function actualizarTasaBCV(btn){
  if (_bcvOcupado || !puedeHablarConSistema("Traer la tasa del BCV")) return;
  _bcvOcupado = true;
  if (btn) btnOcupado(btn, "Buscando…");
  let r = null, err = null;
  try { r = await api("cj_tasas", { op: "bcv" }, 60000); } catch (e) { err = e; }
  _bcvOcupado = false;
  if (btn) btnLibre(btn);
  if (err) return aviso({ icono: "📡", titulo: "No se pudo traer la tasa", html: esc(err.message) + (err.red ? " Revisa la conexión y vuelve a intentar." : "") + "<br><br>La caja sigue con las tasas que tenía: " + textoTasas() + "." });
  if (r && r.codigo === "FUTURA") { await tomarTasas(r, { sinPreguntar: true }); return elegirTasa("boton"); }
  if (!r || !r.ok) {
    if (r && r.tasa > 0) await tomarTasas(r, { sinPreguntar: true });
    return aviso({ icono: "🏦", titulo: "No se pudo traer la tasa del BCV", html: esc((r && r.msg) || "El sistema no respondió.") });
  }
  const antes = Number(r.tasaAntes) || 0;
  await tomarTasas(r, { forzar: true });
  toast(antes > 0 && Math.abs(antes - r.tasa) < 0.00005 ? "✅ La tasa BCV ya estaba al día" : "✅ Tasa BCV actualizada");
}

// ══ ¿Con cuál tasa se cobra hoy? (fin de semana, feriado o el BCV ya publicó la de mañana) ══
// motivo: "auto" (al abrir / al llegar las tasas) · "boton" (🔄) · "cobrar" (antes de cobrar)
let _eligiendo = false;
async function elegirTasa(motivo){
  const e = tasaEspera();
  if (!e || _eligiendo) return null;
  if (!hayInternet() || !sesionViva()) return null;
  _eligiendo = true;
  const t = S.tasas || {}, on = !!t.binOn, vieja = tasaVieja();
  const conDiv = (bcv, div) => "Bs " + fmt(bcv) + (on && div > 0 ? '<br><small>Divisas Bs ' + fmt(div) + "</small>" : "");
  const divEsp = Number(e.divisas) > 0 ? Number(e.divisas) : (on && t.bcv > 0 && t.div > 0 ? r2(Number(e.tasa) * t.div / t.bcv) : 0);
  const cab = vieja
    ? (esFinDeSemana() ? "Hoy es <b>" + DIAS_SEM[new Date().getDay()] + "</b>: el BCV no publica tasa los fines de semana." : "El sistema no tiene la tasa de <b>hoy</b> y el BCV ya publicó la del <b>" + esc(fechaDia(e.fechaValor)) + "</b>.")
    : "El BCV ya publicó la tasa del <b>" + esc(fechaDia(e.fechaValor)) + "</b>. La de hoy sigue valiendo hasta mañana.";
  const r = await modal({ icono: "💱", titulo: "¿Con cuál tasa cobras hoy?", centrado: true,
    html: '<div class="m-txt">' + cab + "<br><br>Elige con cuál se cobra <b>hoy</b> en todas las cajas.</div>" +
      '<div class="tasa-ops">' +
        '<button type="button" class="tasa-op" data-v="mantener"><span class="to-t">Seguir con la del ' + esc(fechaDia(t.fecha)) + "</span><span class=\"to-v\">" + conDiv(t.bcv, t.div) + "</span></button>" +
        '<button type="button" class="tasa-op nueva" data-v="usar"><span class="to-t">Usar la del ' + esc(fechaDia(e.fechaValor)) + "</span><span class=\"to-v\">" + conDiv(e.tasa, divEsp) + "</span></button>" +
      "</div><div class=\"m-err\" id=\"toErr\"></div>",
    botones: [],
    alAbrir: (fondo, cerrar) => {
      fondo.querySelectorAll(".tasa-op").forEach(b => b.addEventListener("click", async () => {
        const dec = b.dataset.v;
        if (dec === "mantener" && !vieja) { cerrar("mantener"); return; }   // la de hoy ya está guardada: no hay nada que anotar
        fondo.querySelectorAll(".tasa-op").forEach(x => x.disabled = true);
        btnOcupado(b, "Guardando…");
        let res = null;
        try { res = await api("cj_tasas", { op: "espera", decision: dec }, 45000); }
        catch (ex) { $("toErr").textContent = ex.message + (ex.red ? " Revisa la conexión y vuelve a intentar." : ""); }
        btnLibre(b);
        fondo.querySelectorAll(".tasa-op").forEach(x => x.disabled = false);
        if (res && (res.ok || res.codigo === "SIN_ESPERA")) { await tomarTasas(res, { forzar: true, sinPreguntar: true }); cerrar(res.ok ? dec : "ya"); return; }
        if (res && !res.ok) $("toErr").textContent = res.msg || "El sistema no respondió.";
      }));
    } });
  _eligiendo = false;
  if (r === "usar") toast("✅ Hoy se cobra con la del " + fechaDia(e.fechaValor));
  else if (r === "mantener" && vieja) toast("✅ Hoy se cobra con la del " + fechaDia(t.fecha));
  else if (r === "ya") aviso({ icono: "💱", titulo: "Ya eligieron la tasa", html: "Otra caja ya eligió la tasa de hoy (o el sistema la guardó). La caja tomó las tasas de ahora: " + textoTasas() + "." });
  pintarBanners();
  return r;
}
// Al abrir la caja y cada vez que llegan tasas: si hay que elegir, se pregunta (una vez por día y tasa en este equipo)
let _esperaPreguntada = "";
function revisarTasaEspera(){
  if (!hayQuePreguntarTasa() || !hayInternet() || !sesionViva()) return;
  const e = tasaEspera(), k = hoyTxt() + "|" + e.fechaValor;
  if (_esperaPreguntada === k) return;
  if (P || _eligiendo || document.querySelector(".mfondo:not(.oculto)") || S.vista === "activar") { setTimeout(revisarTasaEspera, 4000); return; }
  _esperaPreguntada = k;
  elegirTasa("auto");
}

// ══ % de brecha / Divisas (TasaBin encendido) · Divisas de los $ en efectivo (apagado) ══
async function cambiarDivisas(){
  if (!puedeHablarConSistema("Cambiar las tasas")) return;
  const t = S.tasas || {}, on = !!t.binOn, pide = !!(S.datos && S.datos.pideClave && S.datos.pideClave.tasa);
  const brechaHoy = on && t.bcv > 0 && t.div > 0 ? r2((t.div / t.bcv - 1) * 100) : 0;
  const r = await modal({ icono: on ? "%" : "💵", titulo: on ? "Cambiar la brecha" : "Cambiar la tasa Divisas",
    html: '<div class="m-txt" style="font-size:13px;color:var(--text-dim);">BCV de hoy: <b>Bs ' + fmt(t.bcv) + "</b> (la trae el sistema del BCV). Lo que cambies aquí queda en el sistema para todas las cajas.</div>" +
      (on
        ? '<label class="lbl" for="tBre">% de brecha cambiaria (ahora ' + fmt(brechaHoy) + ' %)</label><input class="inp" id="tBre" type="number" inputmode="decimal" min="0" step="any" placeholder="% de brecha">' +
          '<label class="lbl" for="tDiv">O la tasa Divisas directa, sin brecha (ahora Bs ' + fmt(t.div) + ')</label><input class="inp" id="tDiv" type="number" inputmode="decimal" min="0" step="any" placeholder="Tasa Divisas en Bs">' +
          '<div class="act-nota" id="tHint"></div>'
        : '<label class="lbl" for="tDiv">Tasa Divisas — los $ en efectivo (ahora ' + (t.div > 0 ? "Bs " + fmt(t.div) : "sin tasa") + ')</label><input class="inp" id="tDiv" type="number" inputmode="decimal" min="0" step="any" placeholder="Tasa Divisas en Bs">') +
      (pide ? '<label class="lbl" for="tCla">Clave de las tasas</label><input class="inp" id="tCla" type="password" autocomplete="off" placeholder="La clave de cambiar la tasa">' : "") +
      '<div class="m-err" id="tErr"></div>',
    botones: [{ txt: "Cancelar", v: false }, { txt: "✅ Guardar", v: true, cls: "green", spin: "Guardando…" }],
    foco: on ? "tBre" : "tDiv",
    alAbrir: () => {
      if (!on) return;
      const calc = () => {
        const pct = $("tBre").value === "" ? null : Number($("tBre").value);
        $("tDiv").disabled = pct !== null && pct > 0;
        $("tHint").innerHTML = pct !== null && pct > 0 && t.bcv > 0 ? "Divisas = BCV × " + fmt(1 + pct / 100) + " = <b>Bs " + fmt(r2(t.bcv * (1 + pct / 100))) + "</b>"
          : (Number($("tDiv").value) > 0 && t.bcv > 0 ? "Brecha: <b>" + fmt(r2((Number($("tDiv").value) / t.bcv - 1) * 100)) + " %</b>" : "");
      };
      ["tBre", "tDiv"].forEach(id => $(id).addEventListener("input", calc));
    },
    antes: async v => {
      if (!v) return true;
      const err = $("tErr"); err.textContent = "";
      const datos = { op: "divisas", clave: pide ? $("tCla").value : "" };
      let dv;
      if (on) {
        const pct = $("tBre").value === "" ? null : Number($("tBre").value);
        if (pct !== null && pct > 0) { datos.brecha = pct; dv = r2(t.bcv * (1 + pct / 100)); }
        else { dv = Number($("tDiv").value) || 0; datos.brecha = 0; datos.div = dv; }
        if (!(dv > 0)) { err.textContent = "Escribe el % de brecha o la tasa Divisas."; $("tBre").focus(); return false; }
      } else {
        dv = Number($("tDiv").value) || 0; datos.divOff = dv;
        if (!(dv > 0)) { err.textContent = "Escribe la tasa Divisas."; $("tDiv").focus(); return false; }
      }
      if (t.bcv > 0 && dv < t.bcv * 0.9) { err.textContent = "La tasa Divisas (Bs " + fmt(dv) + ") no puede quedar por debajo de la BCV (Bs " + fmt(t.bcv) + ")."; return false; }
      if (pide && !datos.clave) { err.textContent = "Escribe la clave."; $("tCla").focus(); return false; }
      let res = null;
      try { res = await api("cj_tasas", datos, 45000); }
      catch (ex) { err.textContent = ex.message + (ex.red ? " Revisa la conexión y vuelve a intentar." : ""); return false; }
      if (res && res.ok) { await tomarTasas(res, { forzar: true, sinPreguntar: true }); return true; }
      err.textContent = (res && res.msg) || "El sistema no respondió.";
      if (res && res.codigo === "CLAVE" && $("tCla")) { $("tCla").value = ""; $("tCla").focus(); }
      return false;
    } });
  if (r) toast("✅ Cambios guardados");
}
