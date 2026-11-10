"use strict";
// ══════════════════════════════════════════════════════════════
//  API · la caja habla con el sistema SOLO desde aquí.
//  Hoy: POST a /caja/api (el Worker lo pasa al doPost del sistema del cliente, Apps Script).
//  Mañana (Supabase + Next.js) se cambia este archivo y el resto de la caja sigue igual.
//  Cada llamada lleva la llave del equipo (token) y la sesión del usuario (sesion), si las hay.
// ══════════════════════════════════════════════════════════════
const API_URL = new URL("api", location.href.split("#")[0].split("?")[0].replace(/[^/]*$/, "")).href;   // …/caja/api

async function api(accion, extra, ms){
  const cuerpo = Object.assign({ accion: accion }, extra || {});
  if (S.eq && S.eq.token && cuerpo.token == null) cuerpo.token = S.eq.token;
  if (S.ses && S.ses.token && cuerpo.sesion == null) cuerpo.sesion = S.ses.token;
  const t0 = Date.now();   // 4.4: para comparar la hora del equipo con la del sistema
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms || 60000);
  let r;
  try {
    r = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(cuerpo), signal: ctl.signal, cache: "no-store" });
  } catch (e) {
    clearTimeout(to);
    marcarOnline(false);
    throw ErrRed(e && e.name === "AbortError" ? "El sistema tardó demasiado en responder." : "No hay conexión con el sistema.");
  }
  clearTimeout(to);
  marcarOnline(true);
  const txt = await r.text();
  let res;
  try { res = JSON.parse(txt); }
  catch (e) { throw new Error("El sistema respondió algo que no se entiende (" + (r.status || "") + "). Avísale al administrador."); }
  if (res && res.srv) { try { relojRevisar(res.srv, t0, Date.now()); } catch (e) {} }   // 4.4 (app.js): ¿el reloj o la zona del equipo están mal?
  if (res && res.codigo === "RED") { marcarOnline(false); throw ErrRed(res.msg || "El sistema no respondió."); }
  if (res && res.codigo === "RESPUESTA") throw new Error(res.msg || "El sistema respondió algo que no se entiende.");   // se reintenta, no es culpa de la venta
  // La sesión del usuario venció o no tiene permiso para esta caja: lo atiende sesion.js (las ventas siguen subiendo)
  if (res && (res.codigo === "SESION" || res.codigo === "USUARIO") && accion !== "cj_login" && accion !== "cj_canje") sesionProblema(res);
  return res;
}
