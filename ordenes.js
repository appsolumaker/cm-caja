"use strict";
// ══════════════════════════════════════════════════════════════
//  ÓRDENES EN LA CAJA (Etapa 2) — como 📋 Órdenes de Ventas
//  · 📋 Órdenes: las de los vendedores, las facturas en espera de cualquier caja y los pedidos de la tienda web
//    (en modo vendedor solo los pedidos web), más las facturas en espera guardadas en ESTE equipo.
//  · Cobrar una orden: la caja la toma (queda bloqueada para las demás) y se carga en la factura.
//    Al registrar la venta, la orden queda CONVERTIDA (también si se vendió sin internet: al subirse).
//  · 🗂️ En espera: en modo cajero y con internet va a la lista del sistema (la ve cualquier caja);
//    sin internet (o en modo vendedor) se guarda en este equipo y, en modo cajero, sube sola después.
//  · 📄 Cotización: se imprime en carta, sin número y sin registrar nada.
//  Sin internet no se traen órdenes nuevas, pero la que ya está en pantalla se cobra igual.
// ══════════════════════════════════════════════════════════════
const ORD_REFRESCO_MS = 90000;
const _ord = { lista: [], abiertas: 0, cerrar: null, timer: null, ocupado: false, error: "" };

const ordD = () => S.datos || {};
function ordModoCajero(){ return ordD().modoCajas === "cajero" || !ordD().trabajoVendedores; }
function ordConVend(){ const d = ordD(); return !!d.trabajoVendedores && d.modoCajas === "cajero"; }   // la factura tiene selector de vendedor
function ordEnLinea(){ return hayInternet() && sesionViva(); }
function ordEsperaServidor(){ return ordModoCajero() && ordEnLinea(); }
const ordDig = s => String(s == null ? "" : s).replace(/\D/g, "");
function ordIcono(origen){ return origen === "CAJA" ? "🗂️" : origen === "WEB" ? "🌐" : "📋"; }

// ── Arranque (lo llama listo() una vez) ──
async function ordIniciar(){
  S.esperas = (await kvGet("esperas")) || [];
  S.ordSoltar = (await kvGet("ordSoltar")) || [];
  pintarBotonOrdenes();
  setTimeout(contarOrdenes, 3000);
  setInterval(() => { if (!document.hidden && S.vista === "vender") contarOrdenes(); }, ORD_REFRESCO_MS);
}
async function api_ord(op, extra, ms){
  const r = await api("cj_ordenes", Object.assign({ op: op }, extra || {}), ms || 45000);
  return r || { ok: false, msg: "El sistema no respondió." };
}

// ── Botón 📋 Órdenes (arriba) y su contador ──
async function contarOrdenes(){
  if (!S.datos || !ordEnLinea() || _ord.ocupado) return;
  try {
    const r = await api_ord("buscar", { q: "" }, 30000);
    if (r && r.ok) { _ord.lista = r.ordenes || []; _ord.abiertas = _ord.lista.filter(o => o.estado === "ABIERTA").length; }
  } catch (e) {}
  pintarBotonOrdenes();
}
function pintarBotonOrdenes(){
  const b = $("btnOrdenes"); if (!b) return;
  b.classList.toggle("oculto", !S.datos);
  const n = _ord.abiertas + (S.esperas || []).length;
  $("contOrdenes").textContent = n > 0 ? String(n) : "";
  b.classList.toggle("hay", n > 0);
  const sin = !!S.datos && !ordEnLinea();
  b.classList.toggle("sinred", sin);
  b.title = sin ? "Sin internet: las órdenes del sistema no se pueden ver ahora (aparecen solas cuando vuelva)" : "Órdenes por cobrar y facturas en espera";
}

// ── Chip "Orden: OV-0001" de la factura ──
function pintarChipOrden(){
  const chip = $("chipOrden"); if (!chip) return;
  const o = F.orden;
  chip.classList.toggle("oculto", !o);
  if (o) {
    $("chipOrdenId").textContent = ordIcono(o.origen) + " " + o.id;
    chip.title = o.origen === "WEB" ? "Pedido de la tienda online: se cobra como Tienda online (sin vendedor)" : o.origen === "CAJA" ? "Factura en espera" : "Orden de " + (o.vendedor || "venta");
  }
  $("btnVendOrden").classList.toggle("oculto", !(o && o.origen === "VENDEDOR" && ordConVend()));
  const sel = $("selVend");
  if (sel) { const bloq = !!(o && o.origen !== "CAJA"); sel.disabled = bloq; sel.title = bloq ? "El vendedor viene de la orden " + o.id : ""; }
}
// Lo que la venta lleva de la orden (lo agrega pgGuardar)
function ordPago(){
  const o = F.orden; if (!o) return {};
  const x = { ordenId: o.id };
  if (o.origen === "WEB") Object.assign(x, { canal: "WEB", ventaDirecta: true, vendedorId: "", vendedorNombre: "", comision: 0 });
  return x;
}

// ══ LA LISTA DE ÓRDENES ══
function abrirOrdenes(){
  if (!S.datos) return;
  if (_ord.cerrar) return;
  if (!ordEnLinea() && !(S.esperas || []).length) {   // no es una falla: sin internet no hay cómo traer las órdenes
    aviso({ icono: "📡", titulo: "Sin internet", html: "Las órdenes están guardadas en el sistema, y sin internet <b>no se pueden ver ni tomar</b>. No es una falla de la caja.<br><br>Cuando vuelva el internet, toca <b>📋 Órdenes</b> otra vez y aparecen solas." +
      (F.orden ? "<br><br>La orden <b>" + esc(F.orden.id) + "</b> que tienes en pantalla se cobra normal: queda convertida cuando suba la venta." : "<br><br>Mientras tanto puedes seguir vendiendo normal.") });
    return;
  }
  modal({ titulo: "📋 Órdenes por cobrar", clase: "ordenes", ancho: true,
    html: '<div class="ord-busca"><input class="inp" id="ordBusca" type="text" placeholder="🔍 Nombre, cédula o número de orden" autocomplete="off">' +
      '<button type="button" class="btn-m gray" id="btnOrdRef" title="Actualizar">🔃</button></div><div id="ordLista" class="ord-lista"></div>',
    botones: [{ txt: "Cerrar", v: null }],
    nota: "Al cobrar, la orden queda tomada por esta caja hasta registrar la venta o soltarla.",
    foco: window.innerWidth > 820 ? "ordBusca" : "",
    alAbrir: (box, cerrar) => {
      _ord.cerrar = cerrar;
      $("ordBusca").addEventListener("input", () => { clearTimeout(_ord.timer); _ord.timer = setTimeout(buscarOrdenes, 400); });
      $("ordBusca").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(_ord.timer); buscarOrdenes(); } });
      $("btnOrdRef").addEventListener("click", () => buscarOrdenes());
    } }).then(() => { _ord.cerrar = null; clearTimeout(_ord.timer); });
  pintarOrdenes(ordEnLinea() ? "cargando" : "");
  if (ordEnLinea()) buscarOrdenes();
}
function cerrarOrdenes(){ if (_ord.cerrar) _ord.cerrar(null); }
async function buscarOrdenes(){
  const inp = $("ordBusca"); if (!inp) return;
  if (!ordEnLinea()) { pintarOrdenes(""); return; }
  const q = inp.value.trim(), b = $("btnOrdRef");
  btnOcupado(b, "…");
  let r = null;
  try { r = await api_ord("buscar", { q: q }); } catch (e) { r = { ok: false, red: !!e.red, msg: e.message }; }
  btnLibre(b, "🔃");
  if (!$("ordLista")) return;
  if (!r.ok) { _ord.error = r.red ? "sinred" : (r.msg || "No se pudieron cargar las órdenes."); pintarOrdenes(""); return; }
  _ord.error = "";
  const L = r.ordenes || [];
  if (!q) { _ord.lista = L; _ord.abiertas = L.filter(o => o.estado === "ABIERTA").length; pintarBotonOrdenes(); }
  pintarOrdenes("", L);
}
function pintarOrdenes(estado, lista){
  const cont = $("ordLista"); if (!cont) return;
  const q = norm(($("ordBusca") || {}).value || "");
  const btn = (cls, txt, fn) => '<button type="button" class="btn-m ' + cls + '" onclick="' + fn + '">' + txt + "</button>";
  // Las facturas en espera de ESTE equipo (sin internet, o en modo vendedor)
  const loc = (S.esperas || []).filter(e => !q || norm(e.ref + " " + (e.f.cliente || {}).nombre + " " + (e.f.cliente || {}).cedula + " " + (e.f.orden ? e.f.orden.id : "")).indexOf(q) >= 0);
  let h = "";
  if (loc.length) {
    h += '<div class="ord-sec">🗂️ En espera en este equipo</div>' + loc.map(e => {
      const c = e.f.cliente || {}, n = (e.f.items || []).length, t = ordTotalSnap(e.f);
      const quien = c.cedula ? esc(c.nombre) + ' <span class="ord-dim">' + esc(c.cedula) + "</span>" : "🏷️ " + esc(e.ref || "Sin referencia");
      return '<div class="ord-card"><div class="ord-fila"><b>' + esc(e.id) + "</b>" + '<span class="ord-est local">EN ESTE EQUIPO</span></div>' +
        '<div class="ord-quien">' + quien + "</div>" +
        '<div class="ord-info">' + horaDe(e.creada) + " · " + n + (n === 1 ? " producto" : " productos") + " · " + t.txt + (e.f.orden ? " · " + ordIcono(e.f.orden.origen) + " orden " + esc(e.f.orden.id) : "") +
        (ordModoCajero() ? " · sube a la lista del sistema cuando haya internet" : "") + "</div>" +
        '<div class="ord-acc">' + btn("rojo", "🗑️ Descartar", "ordDescartarLocal('" + e.id + "',this)") + btn("green", "🛒 Abrir", "ordAbrirLocal('" + e.id + "')") + "</div></div>";
    }).join("");
  }
  if (!ordEnLinea() || _ord.error === "sinred") {
    h += '<div class="ord-vacio">📡 <b>Sin internet</b>: las órdenes del sistema no se pueden ver ahora. No es una falla: cuando vuelva el internet, aparecen solas.' + (F.orden ? "<br>La orden <b>" + esc(F.orden.id) + "</b> que tienes en pantalla se cobra igual: queda convertida al subir la venta." : "") + "</div>";
  } else if (estado === "cargando") {
    h += '<div class="ord-vacio"><span class="sp"></span> Cargando órdenes…</div>';
  } else if (_ord.error) {
    h += '<div class="ord-vacio">❌ ' + esc(_ord.error) + "</div>";
  } else {
    const L = lista || [], mi = "Caja " + ordD().caja;
    if (!L.length) h += '<div class="ord-vacio">No hay órdenes por cobrar' + (q ? " con esa búsqueda" : "") + (ordModoCajero() ? "" : " (en modo vendedor aquí salen los pedidos de la tienda web)") + ".</div>";
    else h += (loc.length ? '<div class="ord-sec">📋 En el sistema</div>' : "") + L.map(o => {
      const n = (o.items || []).length, esp = o.origen === "CAJA";
      const origen = o.origen === "WEB" ? "🌐 Tienda online" + (o.refOrigen ? " · pedido #" + esc(o.refOrigen) : "") : esp ? "🗂️ En espera" + (o.vendedor ? " · 🧑‍💼 " + esc(o.vendedor) : "") : "🧑‍💼 " + esc(o.vendedor || "Sin vendedor");
      let est, acc;
      if (o.estado === "ABIERTA") {
        est = '<span class="ord-est abierta">' + (esp ? "EN ESPERA" : "ABIERTA") + "</span>";
        acc = (esp ? btn("rojo", "🗑️ Descartar", "ordDescartar('" + o.id + "',this)") : btn("rojo", "🚫 Anular 🔒", "ordAnular('" + o.id + "')")) + btn("green", "🛒 Cobrar", "ordTomar('" + o.id + "',this)");
      } else if (o.tomadaPor === mi) {
        est = '<span class="ord-est mia">EN ESTA CAJA</span>';
        acc = btn("gray", "↩️ Liberar", "ordLiberar('" + o.id + "',this)") + btn("green", "🛒 Cargar", "ordTomar('" + o.id + "',this)");
      } else {
        est = '<span class="ord-est otra">EN ' + esc((o.tomadaPor || "otra caja").toUpperCase()) + "</span>";
        acc = btn("rojo", "🚫 Anular 🔒", "ordAnular('" + o.id + "')") + btn("gray", "↩️ Liberar 🔒", "ordForzar('" + o.id + "')");
      }
      if (F.orden && F.orden.id === o.id) acc = '<span class="ord-dim">● En pantalla</span>';
      else if (ordCobradaAqui(o.id)) acc = '<span class="ord-dim">⏳ Ya se cobró en este equipo: queda convertida al subir la venta</span>';
      const quien = o.cedula ? esc(o.cliente) + ' <span class="ord-dim">' + esc(o.cedula) + "</span>" : "🏷️ " + esc(o.cliente || "Sin referencia");
      return '<div class="ord-card"><div class="ord-fila"><b>' + esc(o.id) + "</b>" + est + "</div>" +
        '<div class="ord-quien">' + quien + "</div>" +
        '<div class="ord-info">' + origen + " · " + esc(o.fecha) + " · " + n + (n === 1 ? " producto" : " productos") + " · $" + fmt(o.total) +
        (o.estado === "TOMADA" && o.tomadaEn ? " · tomada a las " + esc(o.tomadaEn) : "") + "</div>" +
        (o.notas ? '<div class="ord-nota">📝 ' + esc(o.notas) + "</div>" : "") +
        '<div class="ord-acc">' + acc + "</div></div>";
    }).join("");
  }
  cont.innerHTML = h;
}
// Una venta de este equipo que todavía no sube ya cobró esa orden
function ordCobradaAqui(id){ return (S.ventas || []).some(v => v.estado !== "subida" && v.pago && v.pago.ordenId === id); }
const ordDeLista = id => (_ord.lista || []).find(o => o.id === id) || null;

// ══ TOMAR / CARGAR UNA ORDEN ══
async function ordTomar(id, btn){
  if (F.orden && F.orden.id === id) { cerrarOrdenes(); return; }
  if (ordCobradaAqui(id)) { aviso({ icono: "⏳", titulo: "Ya se cobró aquí", html: "La orden <b>" + esc(id) + "</b> ya se cobró en este equipo y la venta está por subir. Al subirse, la orden queda convertida." }); return; }
  if (!ordEnLinea()) { aviso({ icono: "📡", titulo: "Sin internet", html: "Para tomar una orden hace falta internet (así ninguna otra caja la cobra al mismo tiempo)." }); return; }
  // La factura que está en pantalla primero se guarda en espera
  if (F.items.length || F.orden) {
    if (ordEsperaServidor() && F.items.length) {
      const ok = await confirmar({ icono: "🗂️", titulo: "Tienes una factura en pantalla", ok: "Poner en espera y cargar",
        html: "Para cargar la orden <b>" + esc(id) + "</b>, la factura que tienes en pantalla pasa a la lista como <b>🗂️ en espera</b>" +
          (F.orden ? " (con tus cambios guardados en la orden <b>" + esc(F.orden.id) + "</b>)" : "") + ".<br><br>Desde <b>📋 Órdenes</b> la puedes volver a abrir en cualquier caja." });
      if (!ok) return;
      const g = await ordGuardarEsperaServidor({ ref: "" });
      if (g === "red") { await ordGuardarEsperaLocal("", true); return; }
      if (g !== true) return;
    } else if (F.items.length) {
      await ordGuardarEsperaLocal("");
    } else if (F.orden) {
      await ordSoltarActual(true);
    }
  }
  btnOcupado(btn, "Tomando…");
  let r = null;
  try { r = await api_ord("tomar", { id: id }); } catch (e) { r = { ok: false, msg: e.message }; }
  btnLibre(btn);
  if (!r.ok) { await aviso({ icono: "⚠️", titulo: "No se pudo tomar la orden", html: esc(r.msg || "") }); buscarOrdenes(); return; }
  S.ordSoltar = (S.ordSoltar || []).filter(x => x !== id); kvSet("ordSoltar", S.ordSoltar).catch(() => {});
  cerrarOrdenes();
  contarOrdenes();
  await ordCargar(r.orden);
}
// Una línea de la orden → una línea de la factura. congelada: espera de la caja (precios como estaban).
function ordLinea(it, cobroDef, congelada){
  const cant = r3(it.cantidad); if (!(cant > 0)) return { falta: false, linea: null };
  const tipo = it.tipo === "servicio" ? "servicio" : "producto";
  const p = cat().find(x => x.tipo === tipo && String(x.codigo) === String(it.codigo));
  if (!p) return { falta: it.nombre || it.codigo };
  const cobro = it.cobro === "divisas" ? "divisas" : it.cobro === "bcv" ? "bcv" : cobroDef;
  const manual = it.manual === true || Number(it.tipoIdx) === -1;
  const l = { key: ++F.seq, tipo: tipo, codigo: p.codigo, nombre: p.nombre, codigoBarras: p.codigoBarras || p.codigo, cantidad: cant, manual: manual, tipoIdx: 0 };
  if (manual) {
    const iva = it.iva !== undefined && it.iva !== "" ? Number(it.iva) || 0 : precioDe(p, 0).iva;
    let pr = Number(it.precio) || 0;
    if (!(pr > 0) && Number(it.precioManual) > 0) pr = Number(it.precioManual) / (1 + iva / 100);   // módulo de órdenes: precio con IVA
    // en los libros: con TasaBin, un precio en $ BCV se pasa a divisas con las tasas de hoy
    l.libro = (binOn() && cobro === "bcv" && tBcv() > 0 && tDiv() > 0) ? pr * tBcv() / tDiv() : pr;
    l.iva = iva; l.tipoIdx = -1; l.deOrden = true;
  } else {
    const ti = Math.max(0, Math.min(2, Number(it.tipoIdx) || 0)), pr = precioDe(p, ti);
    l.tipoIdx = ti; l.iva = pr.iva;
    l.libro = congelada && Number(it.precioBin) > 0 ? Number(it.precioBin) : pr.base;
    if (congelada && it.iva !== undefined && it.iva !== "") l.iva = Number(it.iva) || 0;
  }
  return { linea: l };
}
async function ordCargar(o){
  const esp = o.origen === "CAJA", web = o.origen === "WEB", ex = o.extra || {};
  const tp = F.tipoPrecio;
  Object.assign(F, nuevaFactura()); F.tipoPrecio = tp;
  F.dolares = binOn() && (ex.ventaDolares !== undefined ? ex.ventaDolares === true : o.moneda === "divisas");
  const cobroDef = F.dolares ? "divisas" : "bcv", faltan = [], manuales = [];
  (o.items || []).forEach(it => {
    const x = ordLinea(it, cobroDef, esp);
    if (x.falta) faltan.push(x.falta);
    else if (x.linea) { F.items.push(x.linea); if (x.linea.manual && !esp) manuales.push(x.linea.nombre); }
  });
  // Cliente: se busca por cédula (solo los números); si no está registrado, se crea en el sistema al subir la venta
  let cliNuevo = false;
  if (o.cedula) {
    const c = clientesTodos().find(x => ordDig(x.cedula) && ordDig(x.cedula) === ordDig(o.cedula));
    if (c) F.cliente = Object.assign({}, c);
    else { F.cliente = { cedula: String(o.cedula).trim(), nombre: o.cliente || "Cliente", direccion: "", telefono: o.telefono || "", nuevo: true }; cliNuevo = true; }
  }
  // Descuento (espera de la caja): ya se autorizó al ponerla
  if (ex.descTipo === "pct" || ex.descTipo === "monto") F.desc = { tipo: ex.descTipo, valor: Math.max(0, Number(ex.descValor) || 0) };
  // Delivery o envío de la orden ($ BCV), como en Ventas
  if (Number(ex.delivery) > 0) F.dlv = { tipo: ex.tipoDelivery === "envio" ? "envio" : "delivery", monto: r2(Number(ex.delivery)) };
  // Vendedor: el de la orden (bloqueado); en las esperas, el que se eligió
  if (ordConVend()) {
    if (esp) { const vs = String(ex.vendSel || (o.vendedorId ? "v:" + o.vendedorId : "directa")); F.vend = vs.indexOf("v:") === 0 ? vs.slice(2) : "directa"; }
    else F.vend = !web && o.vendedorId ? String(o.vendedorId) : "directa";
  }
  F.orden = { id: o.id, origen: o.origen || "", vendedorId: Number(o.vendedorId) || 0, vendedor: o.vendedor || "", refOrigen: o.refOrigen || "" };
  if (manuales.length || F.desc.tipo !== "ninguno") F.claveCon = "orden";
  $("busca").value = "";
  pintarSelectores(); buscar(); pintarFactura();
  if (window.innerWidth <= 820) mvTab("factura");
  // Avisos, como en Ventas
  const av = [];
  if (web) av.push("🌐 Pedido de la tienda online" + (o.refOrigen ? " <b>#" + esc(o.refOrigen) + "</b>" : "") + ": se cobra como <b>Tienda online</b>" + (ordD().trabajoVendedores ? ", sin vendedor y sin comisión." : "."));
  if (manuales.length) av.push("Trae <b>precio manual</b> puesto por el vendedor en: " + manuales.map(esc).join(", ") + ". Revísalo antes de cobrar.");
  if (faltan.length) av.push("<b>No se cargaron</b> porque no están en los datos de este equipo (ya no existen, están deshabilitados o faltan por actualizar): " + faltan.map(esc).join(", ") + ".");
  if (!esp && dlvMonto() > 0) av.push((F.dlv.tipo === "envio" ? "📦 Trae <b>envío</b>" : "🛵 Trae <b>delivery</b>") + " de <b>$" + fmt(dlvMonto()) + " BCV</b>: ya está en la factura.");
  if (web && Number(o.total) > 0 && F.items.length) {
    const hoy = totales(F.items, { tipo: "ninguno" }).total;
    if (Math.abs(hoy - Number(o.total)) > 0.01 * (F.items.length + 1))
      av.push("⚠️ En la tienda el cliente vio un total de <b>$" + fmt(o.total) + "</b>; con los precios de hoy suma <b>" + txtU(hoy) + "</b>" + (faltan.length ? " (sin los productos que no se cargaron)" : "") + ". Confírmale el monto antes de cobrar.");
  }
  // El cliente que no está en este equipo se busca en el sistema (para tomar la orden ya hubo internet)
  if (cliNuevo && ordEnLinea()) {
    try {
      const rc = await api("cj_cliente", { op: "buscar", q: String(o.cedula) }, 20000);
      const c = rc && rc.ok ? (rc.clientes || []).find(x => ordDig(x.cedula) && ordDig(x.cedula) === ordDig(o.cedula)) : null;
      if (c) { await guardarClienteSistema(c); F.cliente = Object.assign({}, clienteDe(c.cedula) || c); delete F.cliente.nuevo; cliNuevo = false; pintarTotales(); }
    } catch (e) {}
  }
  if (o.notas) av.push("📝 Nota de la orden: " + esc(o.notas));
  const tit = (esp ? "Factura en espera " : web ? "Pedido web " : "Orden ") + o.id + " cargada";
  if (av.length) await aviso({ icono: ordIcono(o.origen), titulo: tit, html: av.join("<br><br>") });
  else toast(ordIcono(o.origen) + " " + tit);
  if (cliNuevo) await ordCrearCliente(o);
}
// El cliente de la orden no existe en el sistema: se ofrece crearlo con sus datos ya puestos (como Ventas)
async function ordCrearCliente(o){
  const c = F.cliente, enLinea = ordEnLinea();
  let creado = null;
  const r = await modal({ icono: "👤", titulo: "Cliente nuevo",
    html: '<div class="m-txt"><b>' + esc(c.nombre) + "</b> (" + esc(c.cedula) + ") no está registrado en Clientes." + (enLinea ? " ¿Lo creas ahora? Revisa sus datos:" : " Se crea en el sistema al registrar la venta.") + "</div>" +
      (enLinea ? '<div class="form-grid" style="margin-top:10px;"><div class="fg"><label>Cédula / RIF</label><input class="inp" id="ocCed" value="' + esc(c.cedula) + '" readonly style="opacity:0.7;"></div>' +
        '<div class="fg"><label>Nombre</label><input class="inp" id="ocNom" value="' + esc(c.nombre) + '" placeholder="Nombre y apellido"></div>' +
        '<div class="fg"><label>Teléfono</label><input class="inp" id="ocTel" value="' + esc(c.telefono || "") + '" placeholder="Opcional"></div>' +
        '<div class="fg"><label>Dirección</label><input class="inp" id="ocDir" value="' + esc(c.direccion || "") + '" placeholder="Opcional"></div></div><div class="m-err" id="ocErr"></div>' : ""),
    botones: enLinea ? [{ txt: "Ahora no", v: false }, { txt: "👤 Crear cliente", v: true, cls: "green", spin: "Creando…" }] : [{ txt: "Entendido", v: false, cls: "green" }],
    antes: async v => {
      if (!v) return true;
      const err = $("ocErr"), d = { cedula: c.cedula, nombre: $("ocNom").value.trim().replace(/\s+/g, " "), telefono: $("ocTel").value.trim(), direccion: $("ocDir").value.trim() };
      if (!d.nombre) { err.textContent = "Escribe el nombre del cliente."; return false; }
      let x = null;
      try { x = await api("cj_cliente", { op: "crear", cliente: d }, 30000); } catch (e) { err.textContent = e.red ? "No hay conexión con el sistema. Toca «Ahora no»: el cliente se crea al registrar la venta." : e.message; return false; }
      if (!x || !x.ok || !x.cliente) { err.textContent = (x && x.msg) || "El sistema no pudo crear el cliente."; return false; }
      creado = x; return true;
    } });
  if (!r || !creado) return;
  await guardarClienteSistema(creado.cliente);
  F.cliente = Object.assign({}, clienteDe(creado.cliente.cedula) || creado.cliente); delete F.cliente.nuevo;
  pintarTotales();
  if (creado.existia) aviso({ icono: "👤", titulo: "Ese cliente ya existía", html: "En el sistema la cédula <b>" + esc(creado.cliente.cedula) + "</b> ya es de <b>" + esc(creado.cliente.nombre) + "</b>. Se eligió ese cliente." });
  else toast("✅ Cliente creado");
}

// ── Soltar la orden de la factura (vuelve a quedar disponible para cualquier caja) ──
async function soltarOrden(){
  const o = F.orden; if (!o) return;
  const ok = await confirmar({ icono: "↩️", titulo: "Soltar la orden " + o.id, ok: "Soltar orden", colorOk: "red",
    html: "La orden <b>" + esc(o.id) + "</b> vuelve a quedar disponible para cualquier caja y la factura en pantalla se limpia.<br><br>La orden no se borra: se puede volver a tomar desde <b>📋 Órdenes</b>" +
      (ordModoCajero() ? ", tal como estaba antes de cargarla. <b>Lo que cambiaste en pantalla no se guarda</b>: para guardarlo usa <b>🗂️ En espera</b>." : ".") });
  if (!ok) return;
  await ordSoltarActual(false);
}
async function ordSoltarActual(callado){
  const o = F.orden; if (!o) return;
  let r = null;
  if (ordEnLinea()) { try { r = await api_ord("liberar", { id: o.id }); } catch (e) { r = null; } }
  if (r && !r.ok) { await aviso({ icono: "❌", titulo: "No se pudo soltar la orden", html: esc(r.msg || "") }); return; }
  if (!r) {   // sin internet: se suelta sola cuando vuelva
    S.ordSoltar = (S.ordSoltar || []).concat([o.id]); await kvSet("ordSoltar", S.ordSoltar).catch(() => {});
  }
  F.orden = null;
  limpiarVenta();
  contarOrdenes();
  if (!callado) toast(r ? "↩️ Orden " + o.id + " liberada" : "↩️ La orden " + o.id + " se libera cuando vuelva el internet");
}
async function ordLiberar(id, btn){
  btnOcupado(btn, "…");
  let r = null;
  try { r = await api_ord("liberar", { id: id }); } catch (e) { r = { ok: false, msg: e.message }; }
  btnLibre(btn);
  if (!r.ok) { aviso({ icono: "❌", titulo: "No se pudo liberar la orden", html: esc(r.msg || "") }); return; }
  ordDesligar(id);
  toast("↩️ Orden " + id + " liberada");
  buscarOrdenes();
}
// Si la orden estaba en pantalla o en una espera de este equipo, deja de estar ligada a ella
function ordDesligar(id){
  if (F.orden && F.orden.id === id) { F.orden = null; pintarChipOrden(); }
  let cambio = false;
  (S.esperas || []).forEach(e => { if (e.f.orden && e.f.orden.id === id) { e.f.orden = null; cambio = true; } });
  if (cambio) kvSet("esperas", S.esperas).catch(() => {});
}

// ── Con la clave maestra: liberar una orden de OTRA caja, anular, cambiar el vendedor ──
function ordClaveMaestra(titulo, html, op, extra){
  return modal({ icono: "🔒", titulo: titulo,
    html: '<div class="m-txt">' + html + '</div><input class="inp" id="ordClave" type="password" placeholder="Clave maestra" autocomplete="off" style="margin-top:10px;" onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.closest(\'.modal\').querySelector(\'[data-v=ok]\').click();}"><div class="m-err" id="ordClaveErr"></div>',
    botones: [{ txt: "Cancelar", v: false }, { txt: "Confirmar", v: true, cls: "red", spin: "Verificando…" }],
    foco: "ordClave",
    antes: async v => {
      if (!v) return true;
      const err = $("ordClaveErr"), clave = $("ordClave").value;
      if (!clave) { err.textContent = "Escribe la clave maestra."; return false; }
      let r = null;
      try { r = await api_ord(op, Object.assign({ clave: clave }, extra)); } catch (e) { err.textContent = e.message; return false; }
      if (r && r.codigo === "CLAVE") { err.textContent = "Clave maestra incorrecta. Intenta de nuevo."; $("ordClave").value = ""; $("ordClave").focus(); return false; }
      _ord.ultima = r;
      return true;
    } }).then(v => v ? _ord.ultima : null);
}
async function ordForzar(id){
  const o = ordDeLista(id) || {};
  const r = await ordClaveMaestra("↩️ Liberar " + id, "La orden la tiene la <b>" + esc(o.tomadaPor || "otra caja") + "</b>" + (o.tomadaEn ? " desde las " + esc(o.tomadaEn) : "") +
    ". Si la liberas, esa caja ya no podrá cobrarla hasta volver a tomarla.<br><br>Escribe la <b>clave maestra</b>:", "forzar", { id: id });
  ordTrasClave(r, id, "↩️ Orden " + id + " liberada");
}
async function ordAnular(id){
  const r = await ordClaveMaestra("🚫 Anular " + id, "La orden <b>" + esc(id) + "</b> queda anulada y ya no se podrá cobrar. <b>No se puede deshacer.</b><br><br>Escribe la <b>clave maestra</b>:", "anular", { id: id });
  ordTrasClave(r, id, "🚫 Orden " + id + " anulada");
}
function ordTrasClave(r, id, txt){
  if (!r) return;
  if (!r.ok) { aviso({ icono: "❌", titulo: "No se pudo completar", html: esc(r.msg || "") }); buscarOrdenes(); return; }
  if (F.orden && F.orden.id === id) { F.orden = null; pintarChipOrden(); }
  ordDesligar(id);
  toast(txt);
  buscarOrdenes(); contarOrdenes();
}
async function cambiarVendOrden(){
  const o = F.orden; if (!o || o.origen !== "VENDEDOR") return;
  if (!ordEnLinea()) { aviso({ icono: "📡", titulo: "Sin internet", html: "El vendedor de una orden se cambia con internet (queda anotado en la orden)." }); return; }
  const vs = ordD().vendedores || [];
  const actual = o.vendedorId ? "v:" + o.vendedorId : "directa";
  const opts = vs.map(v => '<option value="v:' + esc(v.id) + '"' + ("v:" + v.id === actual ? " selected" : "") + ">🧑‍💼 " + esc(v.nombre) + "</option>").join("") +
    '<option value="directa"' + (actual === "directa" ? " selected" : "") + ">🏪 Venta directa (sin comisión)</option>";
  let nuevo = "";
  const r = await modal({ icono: "🔒", titulo: "Vendedor de " + o.id,
    html: '<div class="m-txt">La orden <b>' + esc(o.id) + "</b> es de <b>" + esc(o.vendedor || "Venta directa") + "</b>. La comisión de esta venta será del vendedor que elijas; el cambio queda anotado en la orden.</div>" +
      '<select class="inp" id="ordVendSel" style="margin-top:10px;">' + opts + '</select><input class="inp" id="ordVendClave" type="password" placeholder="Clave maestra" autocomplete="off" style="margin-top:8px;"><div class="m-err" id="ordVendErr"></div>',
    botones: [{ txt: "Cancelar", v: false }, { txt: "Cambiar vendedor", v: true, cls: "green", spin: "Verificando…" }],
    foco: "ordVendSel",
    antes: async v => {
      if (!v) return true;
      const err = $("ordVendErr"), clave = $("ordVendClave").value; nuevo = $("ordVendSel").value;
      if (nuevo === actual) { err.textContent = "Es el mismo vendedor que ya tiene la orden."; return false; }
      if (!clave) { err.textContent = "Escribe la clave maestra."; return false; }
      let x = null;
      try { x = await api_ord("vendedor", { id: o.id, clave: clave, vendSel: nuevo }); } catch (e) { err.textContent = e.message; return false; }
      if (x && x.codigo === "CLAVE") { err.textContent = "Clave maestra incorrecta. Intenta de nuevo."; $("ordVendClave").value = ""; return false; }
      _ord.ultima = x; return true;
    } });
  if (!r) return;
  const x = _ord.ultima;
  if (!x || !x.ok) { aviso({ icono: "❌", titulo: "No se pudo cambiar el vendedor", html: esc((x && x.msg) || "") }); return; }
  if (F.orden && F.orden.id === o.id) {
    F.orden.vendedorId = Number(x.vendedorId) || 0; F.orden.vendedor = x.vendedor || "";
    F.vend = F.orden.vendedorId ? String(F.orden.vendedorId) : "directa";
    pintarSelectores();
  }
  toast("👤 Vendedor de " + o.id + ": " + (x.vendedor || "Venta directa"));
}
async function ordDescartar(id, btn){
  const o = ordDeLista(id) || {};
  const ok = await confirmar({ icono: "🗑️", titulo: "Descartar " + id, ok: "Sí, descartar", colorOk: "red",
    html: "La factura en espera <b>" + esc(o.cliente || id) + "</b> ($" + fmt(o.total || 0) + ") sale de la lista y ya no se podrá cobrar. No se puede deshacer." });
  if (!ok) return;
  btnOcupado(btn, "…");
  let r = null;
  try { r = await api_ord("descartar", { id: id }); } catch (e) { r = { ok: false, msg: e.message }; }
  btnLibre(btn);
  if (!r.ok) { aviso({ icono: "❌", titulo: "No se pudo descartar", html: esc(r.msg || "") }); buscarOrdenes(); return; }
  toast("🗑️ " + id + " descartada");
  buscarOrdenes(); contarOrdenes();
}

// ══ 🗂️ EN ESPERA ══
// La factura en pantalla, sin funciones ni la lista de precios (para guardarla o subirla)
function ordFoto(){
  return JSON.parse(JSON.stringify({ items: F.items, cliente: F.cliente, tipoPrecio: F.tipoPrecio, dolares: !!F.dolares, desc: F.desc, vend: F.vend,
    claveOk: F.claveOk, claveCon: F.claveCon, orden: F.orden || null, avisoEx: F.avisoEx, dlv: F.dlv }));
}
// Precio en pantalla de una línea guardada (con la moneda que tenía esa factura)
function ordBasePara(libro, manual, dolares){
  const x = Number(libro) || 0, conv = binOn() && !dolares && tBcv() > 0 && tDiv() > 0;
  const b = conv ? x * tDiv() / tBcv() : x;
  return manual ? b : r2(b);
}
function ordTotalSnap(f){
  const its = (f.items || []).map(i => Object.assign({}, i, { base: ordBasePara(i.libro, i.manual, f.dolares) }));
  const dl = r2(Math.max(0, Number(f.dlv && f.dlv.monto) || 0));
  const t = r2(totales(its, f.desc).total + dl), u = !binOn() ? "" : f.dolares ? " div" : " BCV";   // con el delivery por su monto, como Ventas
  return { total: t, its: its, txt: "$" + fmt(t) + u };
}
// Lo que viaja al sistema (formato de las facturas en espera de Ventas)
function ordDatosEspera(f, id, ref){
  const T = ordTotalSnap(f), cobro = binOn() && f.dolares ? "divisas" : "bcv";
  let vendSel = "directa";
  if (ordConVend() && f.vend && f.vend !== "directa") vendSel = "v:" + f.vend;
  else if (f.orden && f.orden.origen === "WEB") vendSel = "web";
  return {
    id: id || "", referencia: ref || "",
    cliente: { cedula: (f.cliente || {}).cedula || "", nombre: (f.cliente || {}).nombre || "Genérico", telefono: (f.cliente || {}).telefono || "" },
    vendSel: vendSel,
    items: T.its.map(i => ({ tipo: i.tipo, codigo: i.codigo, nombre: i.nombre, codigoBarras: i.codigoBarras || i.codigo, cantidad: Number(i.cantidad) || 0,
      tipoIdx: i.manual ? -1 : (Number(i.tipoIdx) || 0), manual: !!i.manual, manualTipo: cobro, cobro: cobro, iva: Number(i.iva) || 0,
      precio: i.base, precioBase: i.base, precioBin: i.libro })),
    extra: { descTipo: f.desc && f.desc.tipo || "ninguno", descValor: f.desc && f.desc.valor > 0 ? String(f.desc.valor) : "", delivery: f.dlv && Number(f.dlv.monto) > 0 ? String(r2(f.dlv.monto)) : "", tipoDelivery: f.dlv && f.dlv.tipo === "envio" ? "envio" : "delivery", ventaDolares: !!f.dolares, vendSel: vendSel },
    totalRef: T.total
  };
}
async function ponerEnEspera(){
  if (!F.items.length) {
    aviso({ icono: "🗂️", titulo: "Factura vacía", html: "La factura en pantalla no tiene productos, así que no hay nada que poner en espera." +
      (F.orden ? "<br><br>Si lo que quieres es devolver la orden <b>" + esc(F.orden.id) + "</b> a la lista, usa la ✕ del recuadro <b>Orden</b>." : "") });
    return;
  }
  // Sin cliente y sin orden: una referencia corta (opcional) para reconocerla
  let ref = "";
  if (!F.cliente.cedula && !F.orden) {
    const r = await modal({ icono: "", titulo: "🗂️ Poner en espera",
      html: '<div class="m-txt">La factura no tiene cliente. Escribe una referencia corta para reconocerla en <b>📋 Órdenes</b>' + (ordEsperaServidor() ? " desde cualquier caja" : "") + ".</div>" +
        '<input class="inp" id="ordRef" type="text" maxlength="60" placeholder="Ej: señor de camisa azul" autocomplete="off" style="margin-top:10px;" onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.closest(\'.modal\').querySelector(\'[data-v=ok]\').click();}">' +
        '<div class="ord-dim" style="margin-top:6px;">Es opcional: si lo dejas vacío se guarda con el número de caja y la hora.</div>',
      botones: [{ txt: "Cancelar", v: false }, { txt: "🗂️ Poner en espera", v: true, cls: "green" }], foco: "ordRef",
      antes: async v => { if (v) ref = $("ordRef").value.trim(); return true; } });
    if (!r) return;
  }
  if (ordEsperaServidor()) {
    const b = $("btnEspera"); btnOcupado(b, "Guardando…");
    const ok = await ordGuardarEsperaServidor({ ref: ref });
    btnLibre(b);
    if (ok === "red") await ordGuardarEsperaLocal(ref, true);
    return;
  }
  await ordGuardarEsperaLocal(ref, ordModoCajero());   // modo cajero sin internet: avisa en un mini modal que quedó en este equipo
}
// Devuelve true si quedó en la lista del sistema; "red" si no hubo conexión; false si no se pudo
async function ordGuardarEsperaServidor(op){
  const f = ordFoto();
  let datos = ordDatosEspera(f, op.sinOrden ? "" : (f.orden ? f.orden.id : ""), op.ref);
  let r = null;
  try { r = await api_ord("espera", { datos: datos }, 60000); } catch (e) { if (e.red) return "red"; r = { ok: false, msg: e.message }; }
  if (r && r.codigo === "NO_TOMADA") {
    const ok = await confirmar({ icono: "⚠️", titulo: "La orden ya no está en esta caja", ok: "Guardar como espera nueva",
      html: esc(r.msg) + "<br><br>Lo que tienes en pantalla <b>no se ha perdido</b>. ¿Lo guardo en la lista como una factura en espera nueva, sin la orden?" });
    if (!ok) return false;
    return ordGuardarEsperaServidor(Object.assign({}, op, { sinOrden: true }));
  }
  if (!r || !r.ok) { await aviso({ icono: "❌", titulo: "No se pudo poner en espera", html: esc((r && r.msg) || "") + "<br><br>La factura sigue en pantalla, no se perdió nada." }); return false; }
  F.orden = null;
  limpiarVenta();
  contarOrdenes();
  toast("🗂️ En espera como " + r.id);
  return true;
}
async function ordGuardarEsperaLocal(ref, sinRed){
  const e = { id: "E-" + Date.now().toString(36).slice(-5).toUpperCase(), creada: ahoraTxt(), ref: ref || (F.cliente.cedula ? "" : "Caja " + ordD().caja + " · " + ahoraTxt().slice(11, 16)), f: ordFoto() };
  S.esperas = (S.esperas || []).concat([e]);
  try { await kvSet("esperas", S.esperas); }
  catch (x) { S.esperas = S.esperas.filter(y => y !== e); aviso({ icono: "❌", titulo: "No se pudo guardar", html: "El equipo no pudo guardar la factura en espera (" + esc(x.message) + "). Sigue en pantalla." }); return false; }
  F.orden = null;
  limpiarVenta();
  pintarBotonOrdenes();
  if (sinRed) aviso({ icono: "🗂️", titulo: "En espera en este equipo", html: "No hay internet: la factura quedó guardada <b>en este equipo</b> (" + esc(e.id) + "). Mientras tanto solo esta caja la ve en <b>📋 Órdenes</b>.<br><br>Cuando vuelva el internet pasa sola a la lista del sistema, donde la ve cualquier caja." });
  else toast("🗂️ En espera en este equipo (" + e.id + ")");
  return true;
}
async function ordAbrirLocal(id){
  const e = (S.esperas || []).find(x => x.id === id); if (!e) return;
  if (F.items.length) await ordGuardarEsperaLocal("", false);   // la que está en pantalla pasa a espera (en este equipo)
  else if (F.orden) await ordSoltarActual(true);
  S.esperas = (S.esperas || []).filter(x => x.id !== id);
  await kvSet("esperas", S.esperas).catch(() => {});
  const tp = F.tipoPrecio;
  Object.assign(F, nuevaFactura(), e.f);
  if (e.f.tipoPrecio == null) F.tipoPrecio = tp;
  if (!binOn()) F.dolares = false;
  F.seq = F.items.reduce((m, i) => Math.max(m, Number(i.key) || 0), 0);
  cerrarOrdenes();
  $("busca").value = "";
  pintarSelectores(); buscar(); pintarFactura(); pintarBotonOrdenes();
  if (window.innerWidth <= 820) mvTab("factura");
  toast("🗂️ " + id + " en pantalla");
}
async function ordDescartarLocal(id, btn){
  const e = (S.esperas || []).find(x => x.id === id); if (!e) return;
  const ok = await confirmar({ icono: "🗑️", titulo: "Descartar " + id, ok: "Sí, descartar", colorOk: "red",
    html: "La factura en espera <b>" + esc((e.f.cliente && e.f.cliente.cedula ? e.f.cliente.nombre : e.ref) || id) + "</b> (" + ordTotalSnap(e.f).txt + ") se borra de este equipo. No se puede deshacer." +
      (e.f.orden ? "<br><br>La orden <b>" + esc(e.f.orden.id) + "</b> vuelve a quedar disponible para cualquier caja." : "") });
  if (!ok) return;
  S.esperas = (S.esperas || []).filter(x => x.id !== id);
  await kvSet("esperas", S.esperas).catch(() => {});
  if (e.f.orden) {
    let r = null;
    if (ordEnLinea()) { try { r = await api_ord("liberar", { id: e.f.orden.id }); } catch (x) { r = null; } }
    if (!r) { S.ordSoltar = (S.ordSoltar || []).concat([e.f.orden.id]); await kvSet("ordSoltar", S.ordSoltar).catch(() => {}); }
  }
  pintarBotonOrdenes();
  toast("🗑️ " + id + " descartada");
  if ($("ordLista")) buscarOrdenes();
}

// ══ CON INTERNET (lo llama sincronizar): órdenes por soltar y esperas de este equipo a la lista del sistema ══
async function ordAlDia(){
  if (!ordEnLinea() || !S.datos) return;
  // 1) Órdenes que se soltaron sin internet
  for (const id of (S.ordSoltar || []).slice()) {
    let r;
    try { r = await api_ord("liberar", { id: id }, 30000); } catch (e) { return; }
    if (r && (r.ok || /no se encontr/i.test(r.msg || ""))) { S.ordSoltar = S.ordSoltar.filter(x => x !== id); await kvSet("ordSoltar", S.ordSoltar).catch(() => {}); }
    else return;
  }
  // 2) Esperas de este equipo → lista del sistema (solo modo cajero)
  if (!ordModoCajero() || !(S.esperas || []).length) return;
  let subidas = 0;
  for (const e of S.esperas.slice()) {
    let datos = ordDatosEspera(e.f, e.f.orden ? e.f.orden.id : "", e.ref), r;
    try {
      r = await api_ord("espera", { datos: datos }, 60000);
      if (r && r.codigo === "NO_TOMADA" && datos.id) { datos.id = ""; r = await api_ord("espera", { datos: datos }, 60000); }
    } catch (x) { break; }
    if (!r || !r.ok) break;
    S.esperas = S.esperas.filter(x => x.id !== e.id); await kvSet("esperas", S.esperas).catch(() => {});
    subidas++;
  }
  if (subidas) { toast("🗂️ " + subidas + (subidas === 1 ? " factura en espera pasó" : " facturas en espera pasaron") + " a 📋 Órdenes"); contarOrdenes(); }
  pintarBotonOrdenes();
}

// ══ 📄 COTIZACIÓN (carta, como Ventas: sin número y sin registrar nada) ══
function imprimirCotizacion(){
  if (!F.items.length) { aviso({ icono: "📄", titulo: "Factura vacía", html: "Agrega productos para hacer la cotización." }); return; }
  imprimirHTML(htmlCotizacion());
}
function htmlCotizacion(){
  const d = ordD(), cfg0 = d.impresion || {};
  const mon = cfg0.cotizacionMoneda || "BS";
  const cfg = Object.assign({ pieLinea1: "***Gracias por su compra***", pieLinea2: "Puede solicitar su factura en caja." }, cfg0, { moneda: mon, mostrarEquiv: mon === "BS" && cfg0.cotizacionMostrarEquiv === true });
  const enBS = cfg.moneda !== "USD", tasa = tBcv() || 1, conv = u => enBS ? fmt(u * tasa) : fmt(u), sym = enBS ? "Bs." : "$";   // Bs siempre a tasa BCV
  const x = totales(F.items, F.desc), c = F.cliente, esGen = !c.cedula || c.nombre === "Genérico", dl = dlvMonto(), totC = r2(x.total + dl);
  const td = "padding:7px 4px;border-right:1px solid #000;border-top:1px solid #000;font-size:11px;";
  let filas = 0;
  const prods = F.items.map((i, k) => { const n = String(i.nombre || ""); filas += n.length > 90 ? 3 : n.length > 45 ? 2 : 1;
    return '<tr><td style="' + td + 'text-align:center;">' + (k + 1) + '</td><td style="' + td + 'text-align:center;">' + esc(i.codigoBarras || i.codigo) + '</td><td style="' + td + 'word-break:break-word;line-height:1.4;">' + esc(n) + '</td><td style="' + td + 'text-align:center;">' + fmtCant(i.cantidad) +
      '</td><td style="' + td + 'text-align:right;white-space:nowrap;">' + sym + " " + conv(i.base) + '</td><td style="' + td + 'text-align:center;">' + fmtCant(i.iva) + '%</td><td style="padding:7px 4px;text-align:right;border-top:1px solid #000;font-size:11px;font-weight:bold;white-space:nowrap;">' + sym + " " + conv(totLinea(i)) + "</td></tr>"; }).join("");
  const vacia = '<tr><td style="' + td + '">&nbsp;</td><td style="' + td + '"></td><td style="' + td + '"></td><td style="' + td + '"></td><td style="' + td + '"></td><td style="' + td + '"></td><td style="border-top:1px solid #000;"></td></tr>';
  const vacias = Array(Math.max(0, 21 - filas)).fill(vacia).join("");
  const v = vendedorDeLaVenta();
  let modo = cfg.personaComprobante || "vendedor";
  if (!d.trabajoVendedores && !String(v.vendedorNombre || "").trim()) modo = "cajero";
  const per = [];
  if ((modo === "cajero" || modo === "ambos") && v.cajeroNombre) per.push("Cajero: " + esc(v.cajeroNombre));
  if ((modo === "vendedor" || modo === "ambos") && v.vendedorNombre) per.push("Vendedor: " + esc(v.vendedorNombre));
  const logo = (cfg.imprimirLogo !== false && String(cfg.logo || "").indexOf("data:image") === 0) ? '<img src="' + cfg.logo + '" alt="" style="max-width:60mm;max-height:22mm;object-fit:contain;margin-bottom:4px;">' : "";
  const fila = (t, val, extra) => '<tr><td style="padding:5px 6px;border-bottom:1px solid #000;font-size:11px;' + (extra || "") + '">' + t + '</td><td style="padding:5px 6px;text-align:right;border-bottom:1px solid #000;font-size:11px;white-space:nowrap;' + (extra || "") + '">' + val + "</td></tr>";
  const cli = esGen ? "" : '<div style="font-size:13px;min-height:18px;"><b>Nombre:</b> ' + esc(c.nombre) + '</div><div style="font-size:13px;min-height:18px;"><b>Cédula/RIF:</b> ' + esc(c.cedula) + "</div>" +
    (c.telefono ? '<div style="font-size:13px;min-height:18px;"><b>Teléfono:</b> ' + esc(c.telefono) + "</div>" : "") + (c.direccion ? '<div style="font-size:13px;min-height:18px;"><b>Dirección:</b> ' + esc(c.direccion) + "</div>" : "");
  const th = "padding:5px 4px;text-align:center;font-size:11px;border-right:1px solid #000;font-weight:bold;";
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Cotización</title><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:11px;color:#000;background:white;padding:8px 12px;}table{border-collapse:collapse;}@media print{@page{size:letter portrait;margin:6mm;}}</style></head><body>' +
    '<table style="width:100%;margin-bottom:4px;"><tr><td style="width:60%;vertical-align:top;">' + logo + '<div style="font-size:26px;font-weight:bold;">' + esc(d.negocio || "") + "</div>" +
    (cfg.rif ? '<div style="font-size:13px;margin-top:2px;">RIF: ' + esc(cfg.rif) + "</div>" : "") + (cfg.direccion ? '<div style="font-size:13px;">Dirección: ' + esc(cfg.direccion) + "</div>" : "") + (cfg.telefono ? '<div style="font-size:13px;">Teléfono: ' + esc(cfg.telefono) + "</div>" : "") +
    '</td><td style="width:40%;vertical-align:top;text-align:right;"><div style="font-size:16px;font-weight:bold;">Cotización</div><div style="font-size:13px;margin-top:2px;">FECHA: ' + esc(hoyTxt()) + '</div><div style="font-size:13px;">' + per.join("<br>") + "</div></td></tr></table>" +
    '<div style="min-height:16px;"></div><div style="margin-bottom:6px;">' + cli + "</div>" +
    '<table style="width:100%;border:1px solid #000;table-layout:fixed;"><colgroup><col style="width:5%"><col style="width:12%"><col style="width:37%"><col style="width:7%"><col style="width:13%"><col style="width:6%"><col style="width:20%"></colgroup>' +
    '<thead><tr style="border-bottom:2px solid #000;"><th style="' + th + '">N°</th><th style="' + th + '">CÓDIGO</th><th style="' + th + '">DESCRIPCIÓN</th><th style="' + th + '">CANT.</th><th style="' + th + '">PRECIO BASE</th><th style="' + th + '">IVA</th><th style="padding:5px 4px;text-align:center;font-size:11px;font-weight:bold;">TOTAL</th></tr></thead>' +
    "<tbody>" + prods + vacias + "</tbody></table>" +
    '<table style="width:100%;border:1px solid #000;border-top:none;"><tr><td style="width:55%;border-right:1px solid #000;padding:5px 6px;vertical-align:top;font-size:11px;"><b>OBSERVACIONES:</b></td><td style="width:45%;padding:0;vertical-align:top;"><table style="width:100%;">' +
    fila("Subtotal:", sym + " " + conv(x.sub)) + (x.desc > 0 ? fila("Descuento:", "- " + sym + " " + conv(x.desc)) : "") + fila("IVA:", sym + " " + conv(x.ivaR)) + (dl > 0 ? fila(dlvTxt() + ":", "+ " + sym + " " + conv(dl)) : "") +
    '<tr><td style="padding:5px 6px;font-size:11px;font-weight:bold;">Total:</td><td style="padding:5px 6px;text-align:right;font-size:11px;font-weight:bold;white-space:nowrap;">' + sym + " " + conv(totC) + "</td></tr>" +
    (cfg.mostrarEquiv && enBS ? '<tr><td style="padding:5px 6px;border-top:1px solid #000;color:#555;font-size:11px;">' + (modoVenta() === "div" ? "Total $" : "Total $ BCV") + ':</td><td style="padding:5px 6px;text-align:right;border-top:1px solid #000;color:#555;font-size:11px;white-space:nowrap;">$' + fmt(totC) + "</td></tr>" : "") +
    "</table></td></tr></table>" +
    '<div style="min-height:16px;"></div><div style="text-align:center;font-size:11px;color:#555;">' + esc(cfg.pieLinea1 || "") + '</div><div style="text-align:center;margin-top:3px;font-size:11px;color:#555;">' + esc(cfg.pieLinea2 || "") + "</div></body></html>";
}
