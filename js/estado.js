// Estado = datos base (descifrados) + registro de eventos locales + precios. Todo puro: no toca red ni DOM.
import { clon, suma, fechas } from './util.js';
import { costoLoteUSD, expuestoAlCanje, ADR_DE_LOCAL } from './finanzas.js';
import { claveFantasma, DIAS_ENTRE_SENALES } from './diario.js';
import { fundir } from './supuestos.js';
export { ADR_DE_LOCAL };

const GRUPO = { nucleo: 'nucleo', satelite: 'satelite', satelite_argentina: 'satelite', satelite_volatil: 'satelite', satelite_ypf: 'ypf', renta_fija_ars: 'renta_fija', emergencia: 'emergencia' };
export const NOMBRE_GRUPO = { nucleo: 'Núcleo', satelite: 'Satélites', ypf: 'YPF', renta_fija: 'Renta fija ARS', emergencia: 'Emergencia', caja: 'Caja' };
export const grupoDe = bloque => GRUPO[bloque] || 'satelite';

// ¿Tiene la forma de los datos del tablero (un respaldo sin cifrar)?
export const esRespaldoPlano = o => !!o && Array.isArray(o.posiciones) && Array.isArray(o.reglas) && !!o.meta && !!o.nucleo;


// Todos los tickers con los que puede aparecer algo que ya tenés: el propio, el subyacente del CEDEAR,
// el ADR de una acción local y, para el bloque YPF (acciones u ON), el ADR de YPF.
// Devuelve un Map: ticker con que aparece → ticker con que lo tenés (para decir "como PAMP").
export function tickersPropios(posiciones) {
  const m = new Map();
  for (const p of posiciones) {
    for (const t of [p.ticker, p.subyacente, p.ticker_subyacente_usa, ADR_DE_LOCAL[p.ticker]]) if (t && !m.has(t)) m.set(t, p.ticker);
    if ((p.grupo === 'ypf' || p.bloque === 'satelite_ypf') && !m.has('YPF')) m.set('YPF', p.ticker);
  }
  return m;
}

const arsDe = (c, mep) => c.cantidad * c.precio * (c.moneda === 'USD' ? mep : 1) + (c.gastos || 0);

function sumarCompra(d, c, fecha, mep, nota) {
  let pos = d.posiciones.find(p => p.ticker === c.ticker);
  if (!pos) {
    // una compra en la especie en dólares es el mismo activo: la posición se valúa en pesos
    const enUSD = c.moneda === 'USD' && !c.especie;
    pos = { ticker: c.ticker, descripcion: c.ticker, tipo: 'cedear', cantidad: 0, precio: c.especie ? c.precio * mep : c.precio, moneda_precio: enUSD ? 'USD' : 'ARS', bloque: 'satelite', ticker_subyacente_usa: c.ticker };
    d.posiciones.push(pos);
  }
  pos.cantidad += c.cantidad;
  d.lotes_costo.push({ ticker: c.ticker, cantidad: c.cantidad, fecha_compra: fecha, precio_compra: c.precio, moneda: c.moneda || 'ARS', gastos: c.gastos || 0, operacion: nota, mep_dia: mep });
}

// Aplica los eventos (ordenados por momento) sobre una copia de los datos base.
export function aplicarEventos(base, eventosLocales = []) {
  const d = clon(base);
  d.pasos = d.pasos || {}; d.meses = d.meses || {}; d.decisiones = d.decisiones || [];
  d.cobros = d.cobros || []; d.realizados = d.realizados || []; d.snapshots = d.snapshots || {};
  d.predicciones = d.predicciones || []; d.fantasmas = d.fantasmas || [];
  d.senales_radar = d.senales_radar || {}; // empresa → cuándo se anotó sola su última señal
  const vistos = new Set();
  const todos = [...(base.eventos || []), ...eventosLocales]
    .filter(e => !vistos.has(e.id) && vistos.add(e.id))
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  d.eventos = todos;

  for (const e of todos) {
    switch (e.tipo) {
      case 'aporte': { // plata nueva desde afuera, con sus compras
        d.cashflows_externos_usd.push({ fecha: e.fecha, usd: e.usd, evento: e.id });
        let ars = e.usd * e.mep;
        for (const c of e.compras || []) { sumarCompra(d, c, e.fecha, e.mep, 'Registrado en la app'); ars -= arsDe(c, e.mep); }
        d.caja.ARS += ars;
        break;
      }
      case 'aporte_historico': d.cashflows_externos_usd.push({ fecha: e.fecha, usd: e.usd, evento: e.id }); break; // aporte viejo que faltaba: no mueve la caja
      case 'compra': // con plata que ya estaba en caja
        for (const c of e.compras || []) {
          sumarCompra(d, c, e.fecha, e.mep, 'Registrado en la app (desde caja)');
          if (c.moneda === 'USD') d.caja.USD_MEP -= arsDe(c, e.mep) / e.mep; // se pagó con los dólares de la cuenta
          else d.caja.ARS -= arsDe(c, e.mep);
        }
        break;
      case 'cobro': // cupón, dividendo o amortización
        d.caja.USD_MEP += e.usd;
        d.cobros.push({ fecha: e.fecha, ticker: e.ticker, clase: e.clase, usd: e.usd, ref: e.ref });
        if (e.clase === 'amortizacion') {
          d.posiciones = d.posiciones.filter(p => p.ticker !== e.ticker);
          d.lotes_costo = d.lotes_costo.filter(l => l.ticker !== e.ticker);
        }
        break;
      case 'venta': { // FIFO sobre los lotes
        let falta = e.cantidad, costo = 0;
        for (const l of d.lotes_costo.filter(l => l.ticker === e.ticker).sort((a, b) => a.fecha_compra < b.fecha_compra ? -1 : 1)) {
          if (falta <= 0) break;
          const usa = Math.min(falta, l.cantidad);
          costo += costoLoteUSD(l) * usa / l.cantidad;
          l.gastos = (l.gastos || 0) * (1 - usa / l.cantidad);
          l.cantidad -= usa; falta -= usa;
        }
        d.lotes_costo = d.lotes_costo.filter(l => l.cantidad > 1e-9);
        const pos = d.posiciones.find(p => p.ticker === e.ticker);
        if (pos) { pos.cantidad -= e.cantidad; if (pos.cantidad <= 1e-9) d.posiciones = d.posiciones.filter(p => p !== pos); }
        const netoArs = e.cantidad * e.precio - (e.gastos || 0);
        d.caja.ARS += netoArs;
        d.realizados.push({ fecha: e.fecha, ticker: e.ticker, cantidad: e.cantidad, costo_usd: costo, neto_usd: netoArs / e.mep, resultado_usd: netoArs / e.mep - costo, gastos_usd: (e.gastos || 0) / e.mep });
        break;
      }
      case 'mes': { // cierre de un mes: resumen para las reglas + detalle de gastos
        const { id, ts, tipo, mes, ...resto } = e;
        d.meses[mes] = resto;
        break;
      }
      case 'reglas_gasto': { // lo que aprendió de tus correcciones al categorizar
        d.reglas_gasto = (d.reglas_gasto || []).filter(r => !e.reglas.some(n => n.patron === r.patron)).concat(e.reglas);
        break;
      }
      case 'paso':
        d.pasos[e.paso_id] = { estado: e.estado, hasta: e.hasta, fecha: e.fecha };
        d.decisiones.push({ fecha: e.fecha, texto: `${{ hecho: 'Hecho', pospuesto: 'Pospuesto', descartado: 'Descartado' }[e.estado]}: ${e.titulo}${e.nota ? ' — ' + e.nota : ''}` });
        break;
      case 'decision': d.decisiones.push({ fecha: e.fecha, texto: e.texto }); break;
      case 'prediccion': { // qué esperás que pase, con qué probabilidad y hasta cuándo
        const { tipo, ts, ...p } = e;
        d.predicciones.push(p);
        break;
      }
      case 'prediccion_resultado': {
        const p = d.predicciones.find(x => x.id === e.ref);
        if (p) { p.cumplio = !!e.cumplio; p.resuelta = e.fecha; }
        break;
      }
      case 'prediccion_editar': { // cumplio: null deja la predicción abierta de nuevo
        const p = d.predicciones.find(x => x.id === e.ref);
        if (!p) break;
        const c = e.cambios || {};
        if (c.vence && c.vence !== p.vence || c.cumplio === null) delete d.pasos[`prediccion-${p.id}`]; // vuelve a preguntar
        for (const k of ['texto', 'probabilidad', 'vence', 'cambio']) if (c[k] != null && c[k] !== '') p[k] = c[k];
        if ('ticker' in c) { if (c.ticker) p.ticker = c.ticker; else delete p.ticker; }
        if (c.cumplio === null) { delete p.cumplio; delete p.resuelta; }
        else if (typeof c.cumplio === 'boolean') { p.cumplio = c.cumplio; p.resuelta = p.resuelta || e.fecha; }
        break;
      }
      case 'prediccion_borrar':
        d.predicciones = d.predicciones.filter(x => x.id !== e.ref);
        delete d.pasos[`prediccion-${e.ref}`];
        break;
      case 'fantasma': // algo que no compraste, para ver después cómo le fue contra SPY
        if (e.senal) { // anotada sola por el radar: si otro dispositivo ya la anotó, no se repite; borrarla no la trae de vuelta
          const previa = d.senales_radar[e.ticker];
          if (previa && Math.abs(fechas.dias(previa, e.fecha)) < DIAS_ENTRE_SENALES) break;
          d.senales_radar[e.ticker] = e.fecha;
        }
        if (!d.fantasmas.some(f => f.origen === e.origen && f.ticker === e.ticker && f.fecha === e.fecha && f.grupo === e.grupo)) d.fantasmas.push({ origen: e.origen, ticker: e.ticker, fecha: e.fecha, grupo: e.grupo });
        break;
      case 'fantasma_borrar': // toda la cartera (por su clave) o un solo ticker
        d.fantasmas = d.fantasmas.filter(f => claveFantasma(f) !== e.clave || (e.ticker && f.ticker !== e.ticker));
        break;
      case 'fantasma_editar': { // nombre, fecha y tickers de una cartera fantasma
        const i = d.fantasmas.findIndex(f => claveFantasma(f) === e.clave);
        if (i < 0) break;
        const { origen } = d.fantasmas[i];
        const nuevos = [...new Set(e.tickers)].map(ticker => ({ origen, ticker, fecha: e.fecha, grupo: e.grupo || undefined }));
        const resto = d.fantasmas.filter(f => claveFantasma(f) !== e.clave);
        d.fantasmas = [...resto.slice(0, i), ...nuevos, ...resto.slice(i)];
        break;
      }
      case 'rotacion_allaria': {
        const a = d.cartera_modelo_allaria = d.cartera_modelo_allaria || { activos: [] };
        const activos = (a.activos || []).filter(x => !e.sale.includes(x.ticker));
        for (const t of e.entra) if (!activos.some(x => x.ticker === t)) activos.push({ ticker: t, desde: e.fecha });
        a.activos = activos;
        a.ultimos_cambios = [{ fecha: e.fecha, entra: e.entra.join(', ') || '—', sale: e.sale.join(', ') || '—' }, ...(a.ultimos_cambios || [])];
        a.rotaciones = [...(a.rotaciones || []), { rotacion: e.rotacion, fecha: e.fecha }];
        a.rotacion = e.rotacion; a.fecha = e.fecha;
        break;
      }
      case 'supuestos': // lo que cambiaste de data/supuestos.json; restaurar: volver a los originales
        d.supuestos = e.restaurar ? {} : fundir(d.supuestos || {}, e.cambios || {});
        break;
      case 'objetivo': { // una meta de patrimonio con fecha (un evento nuevo con el mismo objetivo la reemplaza)
        const o = { id: e.objetivo_id, nombre: e.nombre, monto_usd: e.monto_usd, fecha: e.fecha };
        d.objetivos = [...(d.objetivos || []).filter(x => x.id !== o.id), o];
        break;
      }
      case 'objetivo_borrar': d.objetivos = (d.objetivos || []).filter(x => x.id !== e.ref); break;
      case 'aporte_extra': d.aporte_extra = { ...d.aporte_extra, ...e.cambios }; break;
      case 'config': Object.assign(d.config, e.cambios); break;
      case 'perfil': Object.assign(d.perfil, e.cambios); break;
      case 'fecha_aporte': { // se busca por monto y fecha original; el índice queda como respaldo para eventos viejos
        const a = (e.usd != null && d.cashflows_externos_usd.find(x => x.usd === e.usd && x.fecha === e.fecha_original)) || d.cashflows_externos_usd[e.indice];
        if (a) { a.fecha = e.fecha; delete a.fecha_estimada; delete a.nota; }
        break;
      }
      case 'importar_lotes': {
        d.lotes_costo = e.lotes;
        const cant = {};
        for (const l of e.lotes) cant[l.ticker] = (cant[l.ticker] || 0) + l.cantidad;
        for (const p of d.posiciones) p.cantidad = cant[p.ticker] || 0;
        for (const t of Object.keys(cant)) if (!d.posiciones.some(p => p.ticker === t)) {
          const l = e.lotes.find(x => x.ticker === t);
          d.posiciones.push({ ticker: t, descripcion: t, tipo: 'cedear', cantidad: cant[t], precio: l.moneda === 'USD' ? l.precio_compra * l.mep_dia : l.precio_compra, moneda_precio: 'ARS', bloque: 'satelite', ticker_subyacente_usa: t });
        }
        d.posiciones = d.posiciones.filter(p => p.cantidad > 1e-9);
        d.meta.fecha_resumen = e.fecha;
        break;
      }
    }
  }
  d.cashflows_externos_usd.sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0);
  return d;
}

function precioDeMercado(p, m) {
  if (!m) return null;
  if (p.tipo === 'fci') {
    const v = m.fci?.precios?.[p.fci_nombre];
    return v ? { precio: v, variacion: 0, viejo: !!m.fci.stale } : null;
  }
  const tabla = { cedear: m.cedears, accion_ar: m.acciones, on: m.ons }[p.tipo];
  const v = tabla?.precios?.[p.ticker];
  return v ? { precio: v[0], variacion: v[1] || 0, viejo: !!tabla.stale } : null;
}

// Valúa todo en USD MEP. ext = { mercado, calendario, insiders, historico, ratios, feriados, agenda, … } (cualquiera puede faltar).
export function valuar(datos, ext = {}, hoy = fechas.hoy()) {
  const m = ext.mercado || null;
  const mep = m?.fx?.mep || datos.meta.tc_snapshot.mep;
  const ccl = m?.fx?.ccl || datos.meta.tc_snapshot.cable_usd;
  const cambioMep = m?.fx?.mep_prev ? m.fx.mep / m.fx.mep_prev - 1 : 0;
  const allaria = new Set((datos.cartera_modelo_allaria?.activos || []).map(a => a.ticker));

  const posiciones = datos.posiciones.map(p => {
    const pm = precioDeMercado(p, m);
    const precio = pm ? pm.precio : p.precio;
    const enUSD = p.moneda_precio === 'USD';
    const valor_usd = p.cantidad * precio / (enUSD ? 1 : mep);
    const variacion = pm ? pm.variacion : 0;
    const lotes = datos.lotes_costo.filter(l => l.ticker === p.ticker);
    const costo_usd = suma(lotes, costoLoteUSD);
    return {
      ticker: p.ticker, descripcion: p.descripcion, tipo: p.tipo, bloque: p.bloque, grupo: grupoDe(p.bloque),
      subyacente: p.ticker_subyacente_usa, cantidad: p.cantidad, precio, moneda: p.moneda_precio,
      precio_ars: enUSD ? precio * mep : precio, valor_usd,
      var_dia_usd: valor_usd - valor_usd / (1 + variacion / 100), var_dia_pct: variacion / 100,
      // movimiento del día medido en dólares: se descuenta lo que se movió el MEP (los fondos no tienen variación diaria)
      dia_usd_pct: pm && p.tipo !== 'fci' ? (1 + variacion / 100) / (1 + cambioMep) - 1 : 0,
      costo_usd, pnl_usd: lotes.length ? valor_usd - costo_usd : null, pnl_pct: costo_usd > 0 ? valor_usd / costo_usd - 1 : null,
      precio_de_mercado: !!pm, en_allaria: allaria.has(p.subyacente || p.ticker_subyacente_usa || p.ticker),
    };
  });

  const caja_usd = datos.caja.ARS / mep + datos.caja.USD_MEP + (datos.caja.USD_cable || 0) * ccl / mep;
  const de = g => suma(posiciones.filter(p => p.grupo === g), p => p.valor_usd);
  const total_usd = suma(posiciones, p => p.valor_usd) + caja_usd;
  const emergencia_usd = de('emergencia');
  const lp_usd = total_usd - emergencia_usd;
  const nucleo_usd = de('nucleo'), ypf_usd = de('ypf');
  const satelites_usd = de('satelite') + ypf_usd;
  for (const p of posiciones) p.pct_lp = p.grupo === 'emergencia' ? null : p.valor_usd / lp_usd;

  const pesos_nucleo = {};
  for (const t of Object.keys(datos.nucleo.pesos_internos)) {
    const p = posiciones.find(x => x.ticker === t);
    pesos_nucleo[t] = nucleo_usd ? (p ? p.valor_usd : 0) / nucleo_usd : 0;
  }
  // Gasto de referencia: el promedio real de los últimos tres cierres de mes; si todavía no hay tres, el habitual.
  const cierres = Object.entries(datos.meses || {}).filter(([, m]) => m.origen === 'cierre' && m.gasto > 0).sort().slice(-3).map(([, m]) => m.gasto);
  const gasto_ref = cierres.length >= 3 ? suma(cierres) / cierres.length : datos.perfil.gasto_habitual_mensual_usd;
  const argentina_usd = suma(datos.posiciones.map((p, i) => p.riesgo_ar ? posiciones[i].valor_usd : 0));
  const invertible_usd = total_usd - datos.emergencia.meses_min * datos.perfil.gasto_habitual_mensual_usd;
  const var_dia_usd = suma(posiciones, p => p.var_dia_usd);
  const viejos = m ? ['fx', 'cedears', 'acciones', 'ons', 'fci'].filter(k => m[k]?.stale) : [];

  return {
    hoy, datos, mep, ccl, posiciones, caja_usd, total_usd, total_ars: total_usd * mep,
    emergencia_usd, lp_usd, nucleo_usd, ypf_usd, satelites_usd, renta_fija_usd: de('renta_fija'),
    nucleo_lp: nucleo_usd / lp_usd, ypf_lp: ypf_usd / lp_usd, satelites_lp: satelites_usd / lp_usd,
    meses_emergencia: emergencia_usd / gasto_ref, gasto_ref,
    // Riesgo argentino sobre el patrimonio invertible (total menos la emergencia mínima)
    argentina_usd, invertible_usd, argentina_pct: invertible_usd > 0 ? argentina_usd / invertible_usd : 0,
    cambio_mep: cambioMep,
    tesis_activas: posiciones.filter(p => p.grupo === 'satelite').length + (posiciones.some(p => p.grupo === 'ypf' && p.tipo !== 'on') ? 1 : 0),
    pesos_nucleo, var_dia_usd, var_dia_pct: total_usd - var_dia_usd ? var_dia_usd / (total_usd - var_dia_usd) : 0,
    precios: { origen: m ? 'mercado' : 'archivo', generado: m?.generado || null, fecha_archivo: datos.meta.fecha_snapshot, viejos, fecha_fci: m?.fci?.fecha || null },
    fecha_resumen: datos.meta.fecha_resumen || datos.meta.fecha_snapshot,
    mercado: m, calendario: ext.calendario || { flujos: [] }, insiders: ext.insiders || { filas: [] }, historico: ext.historico || null,
    ratios: ext.ratios?.ratios || null, ratios_fecha: ext.ratios?.fecha || null,
    argentina: ext.argentina || null, clima: ext.clima || null, largo_plazo: ext.largoPlazo || null, supuestos: ext.supuestos || null,
    // balances y dividendos de lo que seguís, y eventos con fecha fija
    agenda: ext.agenda || null, eventos_fijos: ext.eventosFijos || null,
    // noticias de lo que seguís (SEC y Google News), con su clasificación
    noticias: ext.noticias || null, ia_uso: ext.iaUso || null, directivos: ext.directivos || null,
    // calendario de mercado: EE.UU. y BYMA, más los feriados argentinos que guarda el Action
    feriados: ext.feriados || ext.feriadosAr ? { ...ext.feriados, argentina: ext.feriadosAr || null } : null,
  };
}

// Valores del día para guardar como snapshot (un punto por día en que se abre la app).
// x = lo que está en CEDEARs y acciones locales (lo que se mueve con el canje).
export const snapshotDe = e => {
  const r = v => Math.round(v * 100) / 100;
  return { t: r(e.total_usd), lp: r(e.lp_usd), n: r(e.nucleo_usd), x: r(suma((e.posiciones || []).filter(expuestoAlCanje), p => p.valor_usd)), mep: e.mep, ccl: e.ccl };
};

// Totales por grupo para el anillo de Cartera.
export function porGrupo(e) {
  const g = {};
  for (const p of e.posiciones) g[p.grupo] = (g[p.grupo] || 0) + p.valor_usd;
  g.caja = e.caja_usd;
  return ['nucleo', 'satelite', 'ypf', 'renta_fija', 'emergencia', 'caja'].map(k => ({ clave: k, nombre: NOMBRE_GRUPO[k], usd: g[k] || 0, pct: (g[k] || 0) / e.total_usd }));
}
