// Motor: reglas y planificador. Funciones puras que solo leen el estado (los umbrales salen de los datos).
import { fechas, fmt, suma } from './util.js';
import { costoEntradaLote, costosAnuales, brechaAportes } from './finanzas.js';

const PRIORIDAD = { emergencia: 1, regla: 2, aporte: 3, flujo: 4, datos: 5, trimestral: 6, pendiente: 7, anual: 8, aviso: 9, senal: 10 };

// ---------- Reglas ----------
// Devuelve una fila por regla: { id, politica, nivel: ok|alerta|violada|sin_datos|info, activa, valor, detalle, accion }
export function evaluarReglas(e) {
  const d = e.datos;
  const R = Object.fromEntries(d.reglas.map(r => [r.id, r]));
  const out = [];
  const fila = (id, nivel, valor, detalle, accion) => R[id] && out.push({
    id, politica: R[id].politica, nivel, activa: nivel === 'alerta' || nivel === 'violada', valor, detalle, accion: accion ?? R[id].accion ?? null,
  });
  const [nMin, nMax] = d.nucleo.rango_LP;

  // R1 · Emergencia, en escalones: bajo el mínimo, entre mínimo y objetivo, y posible exceso
  const em = d.emergencia, m = e.meses_emergencia, r1 = R.R1 || {};
  const baseR1 = `Cubre ${fmt.num(m, 1)} meses de gasto (mínimo ${em.meses_min}, objetivo ${em.meses_obj}).`;
  if (m < em.meses_min) fila('R1', 'violada', fmt.num(m, 1) + ' meses', baseR1);
  else if (e.emergencia_usd < em.objetivo_usd) fila('R1', 'alerta', fmt.num(m, 1) + ' meses', `${baseR1} Faltan ${fmt.usd(em.objetivo_usd - e.emergencia_usd)} para el objetivo de ${fmt.usd(em.objetivo_usd)}.`, r1.accion_bajo_objetivo);
  else if (r1.meses_exceso && m > r1.meses_exceso) fila('R1', 'info', fmt.num(m, 1) + ' meses', `${baseR1} Hay más reserva de la necesaria: ${fmt.usd(e.emergencia_usd - em.objetivo_usd)} por encima del objetivo.`, r1.accion_exceso);
  else fila('R1', 'ok', fmt.num(m, 1) + ' meses', baseR1);

  // R2 · Ahorro (promedio de los últimos 3 meses cargados)
  const meses = Object.entries(d.meses || {}).sort().slice(-3).map(([, m]) => m).filter(m => m.ingreso > 0);
  if (!meses.length) fila('R2', 'sin_datos', '—', 'Todavía no cerraste ningún mes (Aportar → ¿Cuánto invierto este mes?).');
  else {
    const tasa = suma(meses, m => (m.ingreso - m.gasto) / m.ingreso) / meses.length;
    fila('R2', tasa < d.perfil.piso_tasa_ahorro ? 'violada' : 'ok', fmt.pct(tasa, 0),
      `Ahorro promedio de ${meses.length} ${meses.length === 1 ? 'mes' : 'meses'}: ${fmt.pct(tasa, 0)} (meta ${fmt.pct(d.perfil.meta_tasa_ahorro, 0)}, piso ${fmt.pct(d.perfil.piso_tasa_ahorro, 0)}).`);
  }

  // R3 · Núcleo sobre LP
  const pr = proyeccion(e);
  fila('R3', e.nucleo_lp < nMin ? 'alerta' : 'ok', fmt.pct(e.nucleo_lp),
    `El núcleo es ${fmt.pct(e.nucleo_lp)} de la cartera de largo plazo (rango ${fmt.pct(nMin, 0)}–${fmt.pct(nMax, 0)}, objetivo ${fmt.pct(d.nucleo.peso_en_LP_objetivo, 0)}).${e.nucleo_lp < nMin && pr.nucleo ? ` ${pr.nucleo.texto}` : ''}`);

  // R3B-E · Pesos internos del núcleo
  const banda = d.nucleo.banda_interna_pp;
  const desvios = Object.entries(d.nucleo.pesos_internos).map(([t, obj]) => ({ t, dif: (e.pesos_nucleo[t] || 0) - obj }));
  const fuera = desvios.filter(x => Math.abs(x.dif) > banda);
  const bajos = fuera.filter(x => x.dif < 0).sort((a, b) => a.dif - b.dif);
  fila('R3B-E', fuera.length ? 'alerta' : 'ok', fuera.length ? fuera.map(x => `${x.t} ${fmt.pp(x.dif)}`).join(', ') : 'en banda',
    fuera.length ? `Fuera de la banda de ±${fmt.num(banda * 100, 0)} pp: ${fuera.map(x => `${x.t} (${fmt.pp(x.dif)})`).join(', ')}.` : `Los cuatro ETF están dentro de ±${fmt.num(banda * 100, 0)} pp de su peso.`,
    bajos.length ? `El próximo aporte va primero a ${bajos.map(x => x.t).join(' y ')} (no vender)` : undefined);

  // R4 / R4B · Tope por satélite
  const sat = e.posiciones.filter(p => p.grupo === 'satelite');
  for (const [id, lista] of [['R4', sat.filter(p => p.bloque !== 'satelite_volatil')], ['R4B', sat.filter(p => p.bloque === 'satelite_volatil')]]) {
    const r = R[id]; if (!r) continue;
    const duros = lista.filter(p => p.pct_lp > r.duro), alertas = lista.filter(p => p.pct_lp > r.alerta && p.pct_lp <= r.duro);
    const mayor = lista.slice().sort((a, b) => b.pct_lp - a.pct_lp)[0];
    const nombres = l => l.map(p => `${p.ticker} ${fmt.pct(p.pct_lp)}`).join(', ');
    if (duros.length) fila(id, 'violada', nombres(duros), `Supera el tope duro de ${fmt.pct(r.duro, 0)}: ${nombres(duros)}.`, 'Reducir hasta volver por debajo de la alerta');
    else if (alertas.length) fila(id, 'alerta', nombres(alertas), `En zona de alerta (${fmt.pct(r.alerta, 0)}–${fmt.pct(r.duro, 0)}): ${nombres(alertas)}.`,
      alertas.map(p => `${p.ticker}: ${d.objetivos_por_activo[p.ticker]?.accion || 'sin compras'}`).join('; '));
    else fila(id, 'ok', mayor ? `máx. ${mayor.ticker} ${fmt.pct(mayor.pct_lp)}` : '—', `Ninguno supera la alerta de ${fmt.pct(r.alerta, 0)}.`);
  }

  // R5 · Satélites totales (incluye YPF). Pasar el techo no dispara ventas: pide un plan de normalización con aportes.
  if (R.R5) {
    const sobreTecho = e.satelites_lp > R.R5.techo;
    fila('R5', e.satelites_lp > R.R5.alerta ? 'alerta' : 'ok', fmt.pct(e.satelites_lp),
      `Los satélites suman ${fmt.pct(e.satelites_lp)} de LP (YPF ${fmt.pct(e.ypf_lp)} + resto ${fmt.pct(e.satelites_lp - e.ypf_lp)}); objetivo ${fmt.pct(R.R5.objetivo, 0)}, techo ${fmt.pct(R.R5.techo, 0)}.${sobreTecho && pr.satelites ? ` ${pr.satelites.texto}` : ''}`,
      sobreTecho ? (R.R5.accion_techo || R.R5.accion) : undefined);
  }

  // R6 · YPF consolidada
  if (R.R6) fila('R6', e.ypf_lp > R.R6.objetivo ? 'alerta' : 'ok', fmt.pct(e.ypf_lp),
    `YPF consolidada es ${fmt.pct(e.ypf_lp)} de LP (objetivo ${fmt.pct(R.R6.objetivo, 0)}; exceso aceptado transitoriamente).`);

  // R6B · Argentina total, sobre el patrimonio invertible
  if (R.R6B) {
    const x = e.argentina_pct, r = R.R6B;
    fila('R6B', x > r.techo ? 'violada' : x > r.alerta ? 'alerta' : 'ok', fmt.pct(x),
      `El riesgo argentino (acciones, ON y renta fija en pesos) es ${fmt.pct(x)} del patrimonio invertible: objetivo ${fmt.pct(r.objetivo, 0)}, alerta ${fmt.pct(r.alerta, 0)}, techo ${fmt.pct(r.techo, 0)}.`);
  }

  // R7 · Nuevas tesis: bloqueadas con el núcleo bajo o con demasiadas tesis abiertas
  const maxTesis = R.R7?.max_tesis, nucleoBajo = e.nucleo_lp < nMin, muchas = maxTesis != null && e.tesis_activas > maxTesis;
  fila('R7', nucleoBajo || muchas ? 'alerta' : 'ok', nucleoBajo ? 'bloqueada' : muchas ? `${e.tesis_activas} tesis` : 'habilitada',
    `${nucleoBajo ? `Núcleo por debajo de ${fmt.pct(nMin, 0)}: no se abren tesis nuevas.` : 'Núcleo dentro del rango.'} Tesis activas: ${e.tesis_activas}${maxTesis != null ? ` (máximo ${maxTesis})` : ''}.`,
    nucleoBajo ? undefined : muchas ? R.R7.accion_tope : undefined);

  // R8 · Sin deuda: ni saldo deudor en la cuenta ni apalancamiento
  if (R.R8) {
    const ars = d.caja.ARS, deudaUsd = ars < 0 ? -ars / e.mep : 0, tol = R.R8.tolerancia_usd ?? 0;
    if (e.caja_usd < -tol) fila('R8', 'violada', fmt.usd(e.caja_usd, 2), `La cuenta tiene saldo deudor neto de ${fmt.usd(-e.caja_usd, 2)} (dato del ${fmt.fecha(e.fecha_resumen)}).`);
    else if (deudaUsd > tol) fila('R8', 'alerta', fmt.ars(ars), `Según el resumen del ${fmt.fecha(e.fecha_resumen)}, la cuenta en pesos está en ${fmt.ars(ars)} (≈ ${fmt.usd(deudaUsd, 2)}); hay dólares en cuenta que lo cubren, pero un saldo negativo puede generar intereses.`,
      'Si sigue negativo, cubrilo vendiendo dólares de la cuenta');
    else fila('R8', 'ok', 'sin deuda', 'Sin saldo deudor ni apalancamiento.');
  }

  // R9 · Datos conciliados: sin esto, el rendimiento no se puede leer
  if (R.R9) {
    const br = brechaAportes(e), estimados = d.cashflows_externos_usd.filter(a => a.fecha_estimada).length;
    if (br.relevante) fila('R9', 'alerta', `faltan ${fmt.usd(br.brecha)}`, `Lo que hoy tenés costó ${fmt.usd(br.costo)} y los aportes cargados suman ${fmt.usd(br.aportado)}: puede faltar algún aporte.`);
    else if (estimados) fila('R9', 'alerta', `${estimados} fecha estimada`, `Los aportes cierran contra el costo (${fmt.usd(br.aportado)} contra ${fmt.usd(br.costo)}), pero hay ${estimados} con fecha estimada.`, 'Confirmar la fecha exacta');
    else fila('R9', 'ok', 'conciliados', `Aportes cargados: ${fmt.usd(br.aportado)}, contra ${fmt.usd(br.costo)} de costo de lo que hay en cartera.`);
  }

  // C1 · Costo de entrada (compras del último año)
  if (R.C1) {
    const desde = fechas.sumar(e.hoy, -365);
    const costos = d.lotes_costo.filter(l => l.fecha_compra >= desde).map(l => ({ l, c: costoEntradaLote(l) })).filter(x => x.c != null);
    const peor = costos.sort((a, b) => b.c - a.c)[0];
    if (!peor) fila('C1', 'sin_datos', '—', 'Sin compras con gastos en los últimos 12 meses.');
    else fila('C1', peor.c > R.C1.max ? 'violada' : 'ok', fmt.pct(peor.c, 2), `Compra más cara del último año: ${peor.l.ticker} ${fmt.pct(peor.c, 2)} (máximo ${fmt.pct(R.C1.max, 2)}).`,
      'Revisar comisiones antes de la próxima compra');
  }
  // C2 · Ida y vuelta (solo aplica antes de vender)
  if (R.C2) fila('C2', 'info', `máx. ${fmt.pct(R.C2.max, 2)}`, `Se revisa antes de cualquier venta: ida y vuelta de hasta ${fmt.pct(R.C2.max, 2)} y ${R.C2.regla_extra}.`);
  // C3 · Costo anual
  if (R.C3) {
    const c = costosAnuales(e);
    fila('C3', c.pct > R.C3.auditoria ? 'violada' : c.pct > R.C3.alerta ? 'alerta' : 'ok', fmt.pct(c.pct, 2),
      `Gastos de operaciones de los últimos 12 meses: ${fmt.usd(c.usd, 0)} = ${fmt.pct(c.pct, 2)} del patrimonio medio (alerta ${fmt.pct(R.C3.alerta, 2)}).`, 'Auditar costos: comisiones, cantidad de operaciones y fondos');
  }
  return out;
}

// Proyección sin ventas: cuántos meses de aportes al núcleo hacen falta para volver a los rangos, con precios quietos.
export function proyeccion(e, hoy = e.hoy) {
  const d = e.datos, aporte = Math.max(0, d.perfil.ingreso_mensual_usd - d.perfil.gasto_habitual_mensual_usd);
  const nMin = d.nucleo.rango_LP[0], R5 = d.reglas.find(r => r.id === 'R5');
  const armar = (meses, meta) => {
    if (!(aporte > 0) || !isFinite(meses) || meses <= 0) return null;
    const n = Math.ceil(meses), fecha = fechas.sumarMeses(fechas.diaDelMes(hoy, 1), n);
    return { meses: n, fecha, aporte, texto: `Con aportes de ${fmt.usd(aporte)} por mes al núcleo, ${meta} en unos ${n} ${n === 1 ? 'mes' : 'meses'} (${fmt.mes(fecha)}), si los precios no cambian.` };
  };
  return {
    aporte,
    nucleo: e.nucleo_lp < nMin ? armar((nMin * e.lp_usd - e.nucleo_usd) / (aporte * (1 - nMin)), `llega al ${fmt.pct(nMin, 0)}`) : null,
    satelites: R5 && e.satelites_lp > R5.techo ? armar((e.satelites_usd / R5.techo - e.lp_usd) / aporte, `los satélites bajan del ${fmt.pct(R5.techo, 0)}`) : null,
  };
}

// Acción vigente por activo, para la tabla de Cartera.
export function accionesPorActivo(e, reglas = evaluarReglas(e)) {
  const R = Object.fromEntries(reglas.map(r => [r.id, r]));
  const d = e.datos, out = {};
  for (const p of e.posiciones) {
    if (p.grupo === 'nucleo') out[p.ticker] = R.R3?.activa ? 'Recibe los aportes' : 'Aportar según pesos';
    else if (p.grupo === 'ypf') out[p.ticker] = R.R6?.activa ? 'Cero compras; cupones y dividendos al núcleo' : 'Mantener';
    else if (p.grupo === 'emergencia') out[p.ticker] = e.emergencia_usd < d.emergencia.objetivo_usd ? 'Reponer' : 'Reserva: no tocar';
    else out[p.ticker] = d.objetivos_por_activo[p.ticker]?.accion || 'Mantener';
  }
  return out;
}

// Objetivo (% de LP) por activo, para la tabla de Cartera.
export function objetivoDe(e, p) {
  const d = e.datos;
  if (p.grupo === 'nucleo') return d.nucleo.peso_en_LP_objetivo * (d.nucleo.pesos_internos[p.ticker] || 0);
  if (p.grupo === 'emergencia') return null;
  return d.objetivos_por_activo[p.ticker]?.objetivo ?? null;
}

// ---------- Aporte ----------
// Reparte `usd` en unidades enteras entre los activos habilitados (el núcleo), priorizando el más subponderado.
export function repartirAporte(e, usd) {
  const d = e.datos, c = d.config.costo_entrada_estimado, banda = d.nucleo.banda_interna_pp;
  const activos = Object.entries(d.nucleo.pesos_internos).map(([t, obj]) => {
    const p = e.posiciones.find(x => x.ticker === t);
    return { t, obj, precio: p ? p.precio_ars : null, cant0: p ? p.cantidad : 0, cant: 0 };
  }).filter(a => a.precio > 0);
  const valor = a => (a.cant0 + a.cant) * a.precio;
  const pesos = () => { const tot = suma(activos, valor); return Object.fromEntries(activos.map(a => [a.t, tot ? valor(a) / tot : 0])); };
  const antes = pesos();
  let ars = Math.max(0, usd) * e.mep;
  for (let i = 0; i < 100000; i++) {
    const tot = suma(activos, valor);
    const cand = activos.filter(a => a.precio * (1 + c) <= ars)
      .map(a => ({ a, deficit: a.obj - (tot ? valor(a) / tot : 0) }))
      .filter(x => x.deficit > -banda) // nunca empujar a un ETF fuera de su banda por arriba
      .sort((x, y) => y.deficit - x.deficit);
    if (!cand.length) break;
    cand[0].a.cant++;
    ars -= cand[0].a.precio * (1 + c);
  }
  const compras = activos.filter(a => a.cant > 0).map(a => ({
    ticker: a.t, cantidad: a.cant, precio: a.precio, monto_ars: a.cant * a.precio, monto_usd: a.cant * a.precio / e.mep, gastos: Math.round(a.cant * a.precio * c * 100) / 100,
  }));
  const invertido = suma(compras, x => x.monto_usd);
  const C1 = d.reglas.find(r => r.id === 'C1');
  return {
    usd, compras, invertido_usd: invertido, costo_usd: invertido * c, costo_pct: c, supera_c1: C1 ? c > C1.max : false,
    sobrante_usd: ars / e.mep, pesos_antes: antes, pesos_despues: pesos(), objetivo: d.nucleo.pesos_internos,
    habilitados: activos.map(a => a.t),
  };
}

const textoCompras = (compras) => compras.map(c => `Comprá ${fmt.cant(c.cantidad)} ${c.ticker} · orden límite a ≈ ${fmt.ars(c.precio)} · plazo 24 hs`);

// Cierre del mes anterior (extracto cargado y monto elegido), si existe.
export function cierreDe(e, mes) {
  const c = e.datos.meses?.[fechas.mes(fechas.sumarMeses(mes + '-01', -1))];
  return c && c.origen === 'cierre' ? c : null;
}

// Monto del aporte del mes: lo decidido al cerrar el mes anterior; si no, lo cargado para el mes;
// si no, una estimación: ingreso − gasto habitual − lo que va a objetivos externos.
export function aporteDelMes(e, mes) {
  const d = e.datos, m = d.meses?.[mes], cierre = cierreDe(e, mes);
  if (cierre) return Math.max(0, cierre.aporte || 0);
  if (m && m.aporte > 0) return m.aporte;
  const externos = m ? (m.vacaciones || 0) + (m.auto || 0) : suma(d.objetivos_externos || [], o => o.aporte_mensual_usd || 0);
  const ingreso = m?.ingreso ?? d.perfil.ingreso_mensual_usd, gasto = m?.gasto ?? d.perfil.gasto_habitual_mensual_usd;
  return Math.max(0, ingreso - gasto - externos);
}

// Parte del ahorro del mes que va a la reserva: todo si está bajo el mínimo; una fracción si está entre el mínimo y el objetivo.
export function paraEmergencia(e, ahorro) {
  const d = e.datos, falta = Math.max(0, d.emergencia.objetivo_usd - e.emergencia_usd);
  if (falta <= 1 || ahorro <= 0) return 0;
  const R1 = d.reglas.find(r => r.id === 'R1') || {};
  const fraccion = e.meses_emergencia < d.emergencia.meses_min ? 1 : (R1.pct_ahorro_bajo_objetivo ?? 1);
  return Math.min(falta, ahorro * fraccion);
}

// Cuánto invertir con el sobrante real del mes. Devuelve un rango y por qué; el monto final lo elige la persona.
export function recomendarAporte(e, { ingreso, gasto, externos = 0 }) {
  const d = e.datos, p = d.perfil;
  const sobrante = ingreso - gasto - externos;
  const tasa = ingreso > 0 ? (ingreso - gasto) / ingreso : 0;
  const disponible = Math.max(0, sobrante);
  const faltaEmergencia = Math.max(0, d.emergencia.objetivo_usd - e.emergencia_usd);
  const aEmergencia = paraEmergencia(e, disponible);
  const maximo = disponible - aEmergencia;
  const minimo = Math.min(maximo, Math.max(0, p.piso_tasa_ahorro * ingreso - aEmergencia));
  const motivos = [];
  if (sobrante <= 0) motivos.push(`Este mes el gasto (${fmt.usd(gasto)}) ${externos ? 'más lo que separaste ' : ''}se llevó todo el ingreso: no queda sobrante para invertir.`);
  else {
    motivos.push(`Ahorraste ${fmt.pct(tasa, 0)} del ingreso (meta ${fmt.pct(p.meta_tasa_ahorro, 0)}, piso ${fmt.pct(p.piso_tasa_ahorro, 0)}).`);
    if (aEmergencia > 0) motivos.push(`Primero van ${fmt.usd(aEmergencia)} al fondo de emergencia, que está ${fmt.usd(faltaEmergencia)} por debajo de su objetivo${e.meses_emergencia < d.emergencia.meses_min ? ' y bajo el mínimo: va todo el ahorro' : ': va una parte del ahorro, el resto se invierte'}.`);
    else motivos.push(`El fondo de emergencia está completo (${fmt.num(e.meses_emergencia, 1)} meses de gasto), así que todo el sobrante puede ir a la cartera.`);
    if (tasa < p.piso_tasa_ahorro) motivos.push(`Ojo: quedaste por debajo del piso de ahorro. Antes de invertir más, conviene revisar el gasto (regla R2).`);
    else if (minimo < maximo) motivos.push(`Como mínimo, ${fmt.usd(minimo)}: es el piso de ahorro. Lo que no inviertas queda en el banco.`);
  }
  return { sobrante, tasa, disponible, a_emergencia: aEmergencia, minimo, maximo, sugerido: maximo, motivos };
}

// ---------- Planificador ----------
// Devuelve { pasos, vigentes, proxima, reglas }. `pasos` ya viene ordenado por prioridad y sin lo hecho, descartado o pospuesto.
export function planificador(e, hoy = e.hoy) {
  const d = e.datos, cfg = d.config, reglas = evaluarReglas(e);
  const R = Object.fromEntries(reglas.map(r => [r.id, r]));
  const mes = fechas.mes(hoy), anio = fechas.anio(hoy), nMes = fechas.nMes(hoy);
  const soloObs = !!R.R7?.activa;
  const pasos = [];
  const agregar = p => {
    const s = d.pasos?.[p.id];
    if (s && (s.estado === 'hecho' || s.estado === 'descartado')) return;
    if (s && s.estado === 'pospuesto' && s.hasta > hoy) return;
    pasos.push({ prioridad: PRIORIDAD[p.tipo] || 9, como: [], ...p });
  };

  // 5 · Emergencia por debajo del objetivo: se repone con el ahorro del mes (todo si está bajo el mínimo; una parte si no)
  const faltaEmergencia = Math.max(0, d.emergencia.objetivo_usd - e.emergencia_usd);
  const ahorroMes = aporteDelMes(e, mes);
  const aReserva = paraEmergencia(e, ahorroMes);
  if (faltaEmergencia > 1) {
    const v = d.emergencia.vehiculos[0], monto = aReserva > 0 ? aReserva : faltaEmergencia;
    agregar({
      id: `emergencia-${mes}`, tipo: 'emergencia', titulo: `Sumá ${fmt.usd(monto)} al fondo de emergencia`,
      porque: `La reserva tiene ${fmt.usd(e.emergencia_usd)} y el objetivo es ${fmt.usd(d.emergencia.objetivo_usd)} (${fmt.num(e.meses_emergencia, 1)} meses de gasto). ${R.R1?.nivel === 'violada' ? 'Regla R1: está bajo el mínimo, así que va todo el ahorro y los satélites quedan suspendidos.' : `Regla R1: ${R.R1?.accion || 'se repone antes de invertir'}.`}`,
      como: [`En Balanz: Fondos → ${v} → Suscribir ${fmt.usd(monto)}`, 'Cuando esté hecho, marcá Hecho y cargá el monto real'],
      accion: { tipo: 'suscripcion', ticker: v, usd: monto },
    });
  }
  if (R.R1?.nivel === 'info') agregar({
    id: `reserva-exceso-${anio}-T${Math.ceil(nMes / 3)}`, tipo: 'pendiente', titulo: `Decidí qué hacer con ${fmt.usd(e.emergencia_usd - d.emergencia.objetivo_usd)} de reserva de más`,
    porque: `Regla R1: ${R.R1.detalle}`, como: ['Si no tiene un destino con fecha (viaje, compra), puede pasar a la cartera de largo plazo', 'No rescates nada sin decidir antes a dónde va'],
  });

  // 2 · Reglas que piden algo concreto ahora (las permanentes van en `vigentes`)
  if (R.R2?.nivel === 'violada') agregar({ id: `r2-${mes}`, tipo: 'regla', titulo: 'Revisá el gasto del mes', porque: `Regla R2: ${R.R2.detalle}`, como: ['Mirá los tres gastos más grandes del mes y decidí cuál recortar', 'Mientras tanto, nada de compras de satélites'] });
  for (const id of ['R4', 'R4B']) if (R[id]?.nivel === 'violada') {
    const r = d.reglas.find(x => x.id === id);
    for (const p of e.posiciones.filter(p => p.grupo === 'satelite' && (id === 'R4B') === (p.bloque === 'satelite_volatil') && p.pct_lp > r.duro)) {
      const vender = Math.ceil((p.valor_usd - r.alerta * e.lp_usd) / (p.precio_ars / e.mep));
      agregar({
        id: `duro-${p.ticker}-${mes}`, tipo: 'regla', titulo: `Reducí ${p.ticker}: vendé ${fmt.cant(vender)} unidades`,
        porque: `Regla ${id}: ${p.ticker} pesa ${fmt.pct(p.pct_lp)} de LP y el tope duro es ${fmt.pct(r.duro, 0)}. Es la única regla que pide vender.`,
        como: [`Vendé ${fmt.cant(vender)} ${p.ticker} · orden límite a ≈ ${fmt.ars(p.precio_ars)} · plazo 24 hs`, 'Con lo que entre, comprá núcleo (aparece como paso cuando registres la venta)', 'Registrá la venta en ⋯ → Registrar cobro o venta'],
      });
    }
  }
  if (R.C1?.nivel === 'violada') agregar({ id: `c1-${mes}`, tipo: 'regla', titulo: 'Revisá las comisiones de compra', porque: `Regla C1: ${R.C1.detalle}`, como: ['Compará la comisión del último boleto con el tarifario de Balanz', 'Evitá órdenes chicas: el mínimo por operación sube el costo'] });
  if (R.C3?.activa) agregar({ id: `c3-${anio}-T${Math.ceil(nMes / 3)}`, tipo: 'regla', titulo: 'Auditá los costos del año', porque: `Regla C3: ${R.C3.detalle}`, como: ['Abrí Informes → Rendimiento y mirá el costo acumulado', 'Reducí la cantidad de operaciones o juntá compras'] });

  // 1 · Aporte mensual
  const cobro = fechas.diaDelMes(hoy, cfg.dia_cobro);
  const yaAporto = d.cashflows_externos_usd.some(a => fechas.mes(a.fecha) === mes);
  if (hoy >= cobro && !yaAporto) {
    const monto = aporteDelMes(e, mes);
    const paraNucleo = Math.max(0, monto - aReserva);
    if (paraNucleo >= 1) {
      const rep = repartirAporte(e, paraNucleo);
      const cierre = cierreDe(e, mes), mesPrevio = fmt.mes(fechas.sumarMeses(mes + '-01', -1)).split(' de ')[0];
      const motivos = [cierre
        ? `Al cerrar ${mesPrevio} gastaste ${fmt.usd(cierre.gasto)} de ${fmt.usd(cierre.ingreso)} y elegiste invertir ${fmt.usd(monto)}.`
        : `Es una estimación con tu gasto habitual (${fmt.usd(d.perfil.ingreso_mensual_usd)} − ${fmt.usd(d.perfil.gasto_habitual_mensual_usd)})${aReserva > 0 ? `; ${fmt.usd(aReserva)} van a emergencia` : ''}. Con el extracto de ${mesPrevio} sale el número real.`];
      if (R.R3?.activa) motivos.push(`Regla R3: el núcleo es ${fmt.pct(e.nucleo_lp)} de LP (mínimo ${fmt.pct(d.nucleo.rango_LP[0], 0)}), así que todo va al núcleo.`);
      else motivos.push('Las reglas habilitan solo el núcleo para los aportes.');
      if (R['R3B-E']?.activa) motivos.push(`Regla R3B-E: ${R['R3B-E'].accion}.`);
      agregar({
        id: `aporte-${mes}`, tipo: 'aporte', titulo: `Aportá ${fmt.usd(paraNucleo)}`, porque: motivos.join(' '),
        como: [`Transferí ${fmt.usd(paraNucleo)} a Balanz (≈ ${fmt.ars(paraNucleo * e.mep)})`, ...textoCompras(rep.compras),
          `Costo estimado ${fmt.usd(rep.costo_usd, 2)} (${fmt.pct(rep.costo_pct, 2)}) · sobran ≈ ${fmt.usd(rep.sobrante_usd, 2)} en caja`],
        accion: { tipo: 'aporte', usd: paraNucleo, compras: rep.compras, extra: cierre ? null : { destino: '#aportar/mes', etiqueta: 'Calcular con el extracto' } },
      });
    }
  }

  // 4 · Flujos: aviso previo, registro del cobro y reinversión de la caja
  for (const f of e.calendario.flujos || []) {
    const p = e.posiciones.find(x => x.ticker === f.ticker);
    if (!p || !p.cantidad) continue;
    const usd = f.por_vn * p.cantidad;
    const que = { cupon: 'el cupón', dividendo: 'el dividendo', amortizacion: 'la devolución de capital' }[f.tipo] || 'el pago';
    const ref = `${f.ticker}-${f.fecha}-${f.tipo}`;
    const cobrado = (d.cobros || []).some(c => c.ref === ref);
    if (hoy >= f.fecha && !cobrado && fechas.dias(f.fecha, hoy) <= 120) agregar({
      id: `cobro-${ref}`, tipo: 'flujo', titulo: `Registrá ${que} de ${f.ticker}: ≈ ${fmt.usd(usd, 2)}`,
      porque: `${f.detalle}. Se pagó el ${fmt.fecha(f.fecha)}${R.R6 ? '; por la regla R6 va al núcleo' : ''}.`,
      como: ['Fijate en Balanz → Movimientos que se haya acreditado', 'Marcá Hecho y cargá el monto que te llegó: después te digo qué comprar'],
      accion: { tipo: 'cobro', ticker: f.ticker, clase: f.tipo, usd, ref, fecha: f.fecha },
    });
    else if (hoy < f.fecha && fechas.dias(hoy, f.fecha) <= cfg.dias_aviso_flujo) agregar({
      id: `aviso-${ref}`, tipo: 'aviso', informativo: true, titulo: `El ${fmt.fechaLarga(f.fecha)} cobrás ${que} de ${f.ticker}: ≈ ${fmt.usd(usd, 2)}`,
      porque: `${f.detalle}. Cuando se acredite, va al núcleo.`, como: ['No hay que hacer nada todavía'],
    });
  }
  if (e.caja_usd >= cfg.caja_minima_reinversion_usd) {
    const rep = repartirAporte(e, e.caja_usd);
    if (rep.compras.length) agregar({
      id: `reinvertir-${mes}`, tipo: 'flujo', titulo: `Reinvertí ${fmt.usd(rep.invertido_usd)} de caja en el núcleo`,
      porque: `Hay ${fmt.usd(e.caja_usd, 2)} sin invertir en la cuenta (cupones, dividendos o sobrantes). Cupones y dividendos van al núcleo.`,
      como: textoCompras(rep.compras), accion: { tipo: 'compra', usd: e.caja_usd, compras: rep.compras },
    });
  }

  // 6 · Datos viejos
  const antig = fechas.dias(e.fecha_resumen, hoy);
  if (antig > cfg.dias_resumen_viejo) agregar({
    id: `excel-${e.fecha_resumen}`, tipo: 'datos', titulo: 'Subí el Excel de lotes de Balanz',
    porque: `El último resumen cargado es del ${fmt.fecha(e.fecha_resumen)} (hace ${antig} días). Sin eso, cantidades y costos pueden estar desactualizados.`,
    como: ['En Balanz web: Reportes → Resultados por lotes', 'Elegí la fecha de hoy y descargá en Excel', 'Acá: menú ⋯ → Importar Excel de Balanz y elegí el archivo'],
    accion: { tipo: 'importar' },
  });

  // 7 · Revisión trimestral
  if ([1, 4, 7, 10].includes(nMes)) agregar({
    id: `trimestral-${anio}-T${Math.ceil(nMes / 3)}`, tipo: 'trimestral', titulo: 'Hacé la revisión trimestral',
    porque: 'Enero, abril, julio y octubre: diez minutos para ver si el plan sigue funcionando.',
    como: ['Benchmark: ¿vas igual o mejor que SPY?', 'Costos: ¿debajo de la alerta de C3?', 'Satélites: ¿alguno fuera de su banda?', 'Watchlist: ¿sigue teniendo sentido cada nombre?'],
    accion: { tipo: 'ir', destino: '#informes/trimestral', etiqueta: 'Abrir el informe' },
  });

  // 8 · Pendientes de datos
  d.cashflows_externos_usd.forEach((a, i) => {
    if (a.fecha_estimada) agregar({
      id: `fecha-aporte-${a.usd}-${i}`, tipo: 'pendiente', titulo: `Confirmá la fecha del aporte de ${fmt.usd(a.usd)}`,
      porque: `Está cargado con fecha estimada (${fmt.fecha(a.fecha)}). La fecha exacta cambia el cálculo del rendimiento anual.`,
      como: ['Buscá la transferencia en el home banking o en Balanz → Movimientos', 'Marcá Hecho y cargá la fecha'],
      accion: { tipo: 'fecha_aporte', indice: i, fecha: a.fecha, usd: a.usd },
    });
  });

  const br = brechaAportes(e);
  if (br.relevante) agregar({
    id: 'revisar-aportes', tipo: 'pendiente', titulo: 'Revisá si falta cargar algún aporte',
    porque: `Lo que hoy tenés costó ${fmt.usd(br.costo)} y los aportes cargados suman ${fmt.usd(br.aportado)}: hay ${fmt.usd(br.brecha)} sin explicar. Puede faltar algún aporte, o parte se compró con ganancias de ventas anteriores. Si faltan aportes, el rendimiento anual que muestra Informes está inflado.`,
    como: ['Mirá en Balanz → Movimientos los ingresos de dinero (transferencias desde el banco)', 'Compará con la lista de aportes de Informes → Rendimiento', 'Cargá cada aporte que falte; si está todo bien, descartá este paso'],
    accion: { tipo: 'menu', seccion: 'movimiento', arg: 'aporte_historico', etiqueta: 'Cargar un aporte' },
  });

  // 10 · Fin de año
  if (nMes === 12 || nMes === 1) {
    const ej = nMes === 12 ? anio : anio - 1;
    agregar({
      id: `anual-${ej}`, tipo: 'anual', titulo: `Generá el informe ${ej} para Bienes Personales y Ganancias`,
      porque: 'Fin de año: tu contador necesita las tenencias al 31/12, los resultados realizados y lo cobrado.',
      como: ['Abrí Informes → Anual para el contador', nMes === 12 ? 'Volvé a generarlo después del 31/12 para tener la valuación de cierre' : 'Imprimilo o guardalo como PDF y mandáselo'],
      accion: { tipo: 'ir', destino: '#informes/anual', etiqueta: 'Abrir el informe' },
    });
  }

  // 9 · Señales externas (solo informativas)
  const propios = new Set(e.posiciones.map(p => p.subyacente || p.ticker)), watch = new Set((d.watchlist || []).map(w => w.ticker));
  const donde = t => propios.has(t) ? 'lo tenés en cartera' : watch.has(t) ? 'está en tu watchlist' : null;
  const etiqueta = soloObs ? 'Solo observación' : 'Informativo';
  const porTicker = {};
  for (const f of e.insiders.filas || []) if (donde(f.ticker) && fechas.dias(f.fecha, hoy) <= 10) (porTicker[f.ticker] = porTicker[f.ticker] || []).push(f);
  for (const [t, filas] of Object.entries(porTicker)) {
    const f = filas.sort((a, b) => b.monto - a.monto)[0];
    agregar({
      id: `insider-${t}-${f.fecha}`, tipo: 'senal', informativo: true, etiqueta, titulo: `Compras de directivos en ${t}`,
      porque: `${f.insiders} directivos compraron por ${fmt.usd(f.monto)} el ${fmt.fecha(f.fecha)}; ${donde(t)}. Fuente: OpenInsider.${soloObs ? ' Regla R7 activa: no se abren tesis nuevas.' : ''}`,
    });
  }

  pasos.sort((a, b) => a.prioridad - b.prioridad);
  return { pasos, reglas, vigentes: reglas.filter(r => r.activa), proxima: proximaAccion(e, hoy), solo_observacion: soloObs };
}

// La próxima fecha en la que va a aparecer algo para hacer.
export function proximaAccion(e, hoy = e.hoy) {
  const d = e.datos, cfg = d.config, cand = [];
  const cobroEste = fechas.diaDelMes(hoy, cfg.dia_cobro);
  const cobro = cobroEste > hoy ? cobroEste : fechas.diaDelMes(fechas.sumarMeses(fechas.diaDelMes(hoy, 1), 1), cfg.dia_cobro);
  cand.push({ fecha: cobro, texto: `aporte de ${fmt.mes(cobro).split(' de ')[0]}` });
  for (const f of e.calendario.flujos || []) {
    if (f.fecha > hoy && e.posiciones.some(p => p.ticker === f.ticker)) { cand.push({ fecha: f.fecha, texto: `${f.tipo === 'cupon' ? 'cupón' : f.tipo} de ${f.ticker}` }); break; }
  }
  const vence = fechas.sumar(e.fecha_resumen, cfg.dias_resumen_viejo + 1);
  if (vence > hoy) cand.push({ fecha: vence, texto: 'subir el Excel de Balanz' });
  for (let i = 1; i <= 12; i++) {
    const f = fechas.sumarMeses(fechas.diaDelMes(hoy, 1), i);
    if ([1, 4, 7, 10].includes(fechas.nMes(f))) { cand.push({ fecha: f, texto: 'revisión trimestral' }); break; }
  }
  return cand.sort((a, b) => a.fecha < b.fecha ? -1 : 1)[0];
}
