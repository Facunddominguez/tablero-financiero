// Motor: reglas y planificador. Funciones puras que solo leen el estado (los umbrales salen de los datos).
import { fechas, fmt, suma } from './util.js';
import { costoEntradaLote, costosAnuales } from './finanzas.js';

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

  // R1 · Emergencia
  fila('R1', e.meses_emergencia < d.emergencia.meses_min ? 'violada' : 'ok', fmt.num(e.meses_emergencia, 1) + ' meses',
    `Cubre ${fmt.num(e.meses_emergencia, 1)} meses de gasto (mínimo ${d.emergencia.meses_min}, objetivo ${d.emergencia.meses_obj}).`);

  // R2 · Ahorro (promedio de los últimos 3 meses cargados)
  const meses = Object.entries(d.meses || {}).sort().slice(-3).map(([, m]) => m).filter(m => m.ingreso > 0);
  if (!meses.length) fila('R2', 'sin_datos', '—', 'Todavía no cargaste ningún mes (menú ⋯ → Cargar el mes).');
  else {
    const tasa = suma(meses, m => (m.ingreso - m.gasto) / m.ingreso) / meses.length;
    fila('R2', tasa < d.perfil.piso_tasa_ahorro ? 'violada' : 'ok', fmt.pct(tasa, 0),
      `Ahorro promedio de ${meses.length} ${meses.length === 1 ? 'mes' : 'meses'}: ${fmt.pct(tasa, 0)} (meta ${fmt.pct(d.perfil.meta_tasa_ahorro, 0)}, piso ${fmt.pct(d.perfil.piso_tasa_ahorro, 0)}).`);
  }

  // R3 · Núcleo sobre LP
  fila('R3', e.nucleo_lp < nMin ? 'alerta' : 'ok', fmt.pct(e.nucleo_lp),
    `El núcleo es ${fmt.pct(e.nucleo_lp)} de la cartera de largo plazo (rango ${fmt.pct(nMin, 0)}–${fmt.pct(nMax, 0)}, objetivo ${fmt.pct(d.nucleo.peso_en_LP_objetivo, 0)}).`);

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

  // R5 · Satélites totales (incluye YPF)
  if (R.R5) fila('R5', e.satelites_lp > R.R5.techo ? 'violada' : e.satelites_lp > R.R5.alerta ? 'alerta' : 'ok', fmt.pct(e.satelites_lp),
    `Los satélites suman ${fmt.pct(e.satelites_lp)} de LP (YPF ${fmt.pct(e.ypf_lp)} + resto ${fmt.pct(e.satelites_lp - e.ypf_lp)}); objetivo ${fmt.pct(R.R5.objetivo, 0)}, techo ${fmt.pct(R.R5.techo, 0)}.`);

  // R6 · YPF consolidada
  if (R.R6) fila('R6', e.ypf_lp > R.R6.objetivo ? 'alerta' : 'ok', fmt.pct(e.ypf_lp),
    `YPF consolidada es ${fmt.pct(e.ypf_lp)} de LP (objetivo ${fmt.pct(R.R6.objetivo, 0)}; exceso aceptado transitoriamente).`);

  // R7 · Nuevas tesis
  fila('R7', e.nucleo_lp < nMin ? 'alerta' : 'ok', e.nucleo_lp < nMin ? 'bloqueada' : 'habilitada',
    e.nucleo_lp < nMin ? `Núcleo por debajo de ${fmt.pct(nMin, 0)}: no se abren tesis nuevas. Tesis activas: ${sat.length}.` : `Núcleo dentro del rango. Tesis activas: ${sat.length}.`);

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

// Monto del aporte del mes: lo cargado para el mes, o ingreso − gasto − lo que va a objetivos externos.
export function aporteDelMes(e, mes) {
  const d = e.datos, m = d.meses?.[mes];
  if (m && m.aporte > 0) return m.aporte;
  const externos = m ? (m.vacaciones || 0) + (m.auto || 0) : suma(d.objetivos_externos || [], o => o.aporte_mensual_usd || 0);
  const ingreso = m?.ingreso ?? d.perfil.ingreso_mensual_usd, gasto = m?.gasto ?? d.perfil.gasto_habitual_mensual_usd;
  return Math.max(0, ingreso - gasto - externos);
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

  // 5 · Emergencia por debajo del objetivo: se repone antes de invertir
  const faltaEmergencia = Math.max(0, d.emergencia.objetivo_usd - e.emergencia_usd);
  if (faltaEmergencia > 1) {
    const v = d.emergencia.vehiculos[0];
    agregar({
      id: `emergencia-${mes}`, tipo: 'emergencia', titulo: `Reponé ${fmt.usd(faltaEmergencia)} en el fondo de emergencia`,
      porque: `La reserva tiene ${fmt.usd(e.emergencia_usd)} y el objetivo es ${fmt.usd(d.emergencia.objetivo_usd)} (${fmt.num(e.meses_emergencia, 1)} meses de gasto). ${R.R1?.activa ? 'Regla R1: satélites suspendidos hasta reponer.' : 'Se repone antes de invertir.'}`,
      como: [`En Balanz: Fondos → ${v} → Suscribir ${fmt.usd(faltaEmergencia)}`, 'Cuando esté hecho, marcá Hecho y cargá el monto real'],
      accion: { tipo: 'suscripcion', ticker: v, usd: faltaEmergencia },
    });
  }

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
    const paraNucleo = Math.max(0, monto - faltaEmergencia);
    if (paraNucleo >= 1) {
      const rep = repartirAporte(e, paraNucleo);
      const motivos = [`Ahorro de ${fmt.mes(hoy).split(' de ')[0]}: ${fmt.usd(monto)}${faltaEmergencia > 1 ? ` (primero ${fmt.usd(Math.min(monto, faltaEmergencia))} a emergencia)` : ''}.`];
      if (R.R3?.activa) motivos.push(`Regla R3: el núcleo es ${fmt.pct(e.nucleo_lp)} de LP (mínimo ${fmt.pct(d.nucleo.rango_LP[0], 0)}), así que todo va al núcleo.`);
      else motivos.push('Las reglas habilitan solo el núcleo para los aportes.');
      if (R['R3B-E']?.activa) motivos.push(`Regla R3B-E: ${R['R3B-E'].accion}.`);
      agregar({
        id: `aporte-${mes}`, tipo: 'aporte', titulo: `Aportá ${fmt.usd(paraNucleo)}`, porque: motivos.join(' '),
        como: [`Transferí ${fmt.usd(paraNucleo)} a Balanz (≈ ${fmt.ars(paraNucleo * e.mep)})`, ...textoCompras(rep.compras),
          `Costo estimado ${fmt.usd(rep.costo_usd, 2)} (${fmt.pct(rep.costo_pct, 2)}) · sobran ≈ ${fmt.usd(rep.sobrante_usd, 2)} en caja`],
        accion: { tipo: 'aporte', usd: paraNucleo, compras: rep.compras },
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
      accion: { tipo: 'fecha_aporte', indice: i, fecha: a.fecha },
    });
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
  for (const c of d.cartera_modelo_allaria?.ultimos_cambios || []) {
    if (fechas.dias(c.fecha, hoy) > 45 || c.fecha > hoy) continue;
    for (const [verbo, lista] of [['sumó', [c.entra].flat()], ['sacó', [c.sale].flat()]]) for (const t of lista) {
      if (!t || !donde(t)) continue;
      agregar({
        id: `allaria-${c.fecha}-${t}`, tipo: 'senal', informativo: true, etiqueta, titulo: `Allaria ${verbo} ${t} ${verbo === 'sumó' ? 'a' : 'de'} su cartera modelo`,
        porque: `Cambio del ${fmt.fecha(c.fecha)}; ${donde(t)}. ${soloObs ? 'Regla R7 activa: no se abren tesis nuevas, es solo para saberlo.' : 'Es una referencia, no una orden.'}`,
      });
    }
  }
  const porTicker = {};
  for (const f of e.insiders.filas || []) if (donde(f.ticker) && fechas.dias(f.fecha, hoy) <= 10) (porTicker[f.ticker] = porTicker[f.ticker] || []).push(f);
  for (const [t, filas] of Object.entries(porTicker)) {
    const f = filas.sort((a, b) => b.monto - a.monto)[0];
    agregar({
      id: `insider-${t}-${f.fecha}`, tipo: 'senal', informativo: true, etiqueta, titulo: `Compras de directivos en ${t}`,
      porque: `${f.insiders} directivos compraron por ${fmt.usd(f.monto)} el ${fmt.fecha(f.fecha)}; ${donde(t)}. ${soloObs ? 'Regla R7 activa: es solo para saberlo.' : 'Es una referencia, no una orden.'}`,
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
