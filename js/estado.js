// Estado = datos base (descifrados) + registro de eventos locales + precios. Todo puro: no toca red ni DOM.
import { clon, suma, fechas } from './util.js';
import { costoLoteUSD } from './finanzas.js';

const GRUPO = { nucleo: 'nucleo', satelite: 'satelite', satelite_argentina: 'satelite', satelite_volatil: 'satelite', satelite_ypf: 'ypf', renta_fija_ars: 'renta_fija', emergencia: 'emergencia' };
export const NOMBRE_GRUPO = { nucleo: 'Núcleo', satelite: 'Satélites', ypf: 'YPF', renta_fija: 'Renta fija ARS', emergencia: 'Emergencia', caja: 'Caja' };
export const grupoDe = bloque => GRUPO[bloque] || 'satelite';

const arsDe = (c, mep) => c.cantidad * c.precio * (c.moneda === 'USD' ? mep : 1) + (c.gastos || 0);

function sumarCompra(d, c, fecha, mep, nota) {
  let pos = d.posiciones.find(p => p.ticker === c.ticker);
  if (!pos) {
    pos = { ticker: c.ticker, descripcion: c.ticker, tipo: 'cedear', cantidad: 0, precio: c.precio, moneda_precio: c.moneda || 'ARS', bloque: 'satelite', ticker_subyacente_usa: c.ticker };
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
        for (const c of e.compras || []) { sumarCompra(d, c, e.fecha, e.mep, 'Registrado en la app (desde caja)'); d.caja.ARS -= arsDe(c, e.mep); }
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
      case 'mes': d.meses[e.mes] = { ingreso: e.ingreso, gasto: e.gasto, vacaciones: e.vacaciones, auto: e.auto, aporte: e.aporte }; break;
      case 'paso':
        d.pasos[e.paso_id] = { estado: e.estado, hasta: e.hasta, fecha: e.fecha };
        d.decisiones.push({ fecha: e.fecha, texto: `${{ hecho: 'Hecho', pospuesto: 'Pospuesto', descartado: 'Descartado' }[e.estado]}: ${e.titulo}${e.nota ? ' — ' + e.nota : ''}` });
        break;
      case 'decision': d.decisiones.push({ fecha: e.fecha, texto: e.texto }); break;
      case 'config': Object.assign(d.config, e.cambios); break;
      case 'fecha_aporte': {
        const a = d.cashflows_externos_usd[e.indice];
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

// Valúa todo en USD MEP. ext = { mercado, calendario, insiders, historico } (cualquiera puede faltar).
export function valuar(datos, ext = {}, hoy = fechas.hoy()) {
  const m = ext.mercado || null;
  const mep = m?.fx?.mep || datos.meta.tc_snapshot.mep;
  const ccl = m?.fx?.ccl || datos.meta.tc_snapshot.cable_usd;
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
  const var_dia_usd = suma(posiciones, p => p.var_dia_usd);
  const viejos = m ? ['fx', 'cedears', 'acciones', 'ons', 'fci'].filter(k => m[k]?.stale) : [];

  return {
    hoy, datos, mep, ccl, posiciones, caja_usd, total_usd, total_ars: total_usd * mep,
    emergencia_usd, lp_usd, nucleo_usd, ypf_usd, satelites_usd, renta_fija_usd: de('renta_fija'),
    nucleo_lp: nucleo_usd / lp_usd, ypf_lp: ypf_usd / lp_usd, satelites_lp: satelites_usd / lp_usd,
    meses_emergencia: emergencia_usd / datos.perfil.gasto_habitual_mensual_usd,
    pesos_nucleo, var_dia_usd, var_dia_pct: total_usd - var_dia_usd ? var_dia_usd / (total_usd - var_dia_usd) : 0,
    precios: { origen: m ? 'mercado' : 'archivo', generado: m?.generado || null, fecha_archivo: datos.meta.fecha_snapshot, viejos, fecha_fci: m?.fci?.fecha || null },
    fecha_resumen: datos.meta.fecha_resumen || datos.meta.fecha_snapshot,
    mercado: m, calendario: ext.calendario || { flujos: [] }, insiders: ext.insiders || { filas: [] }, historico: ext.historico || null,
  };
}

// Valores del día para guardar como snapshot (un punto por día en que se abre la app).
export const snapshotDe = e => ({ t: Math.round(e.total_usd * 100) / 100, lp: Math.round(e.lp_usd * 100) / 100, n: Math.round(e.nucleo_usd * 100) / 100, mep: e.mep });

// Totales por grupo para el anillo de Cartera.
export function porGrupo(e) {
  const g = {};
  for (const p of e.posiciones) g[p.grupo] = (g[p.grupo] || 0) + p.valor_usd;
  g.caja = e.caja_usd;
  return ['nucleo', 'satelite', 'ypf', 'renta_fija', 'emergencia', 'caja'].map(k => ({ clave: k, nombre: NOMBRE_GRUPO[k], usd: g[k] || 0, pct: (g[k] || 0) / e.total_usd }));
}
