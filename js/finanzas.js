// Cálculos financieros puros: costo de lotes, XIRR y benchmark simulado.
import { fechas, suma } from './util.js';

// Costo de un lote en USD al MEP del día de compra, gastos incluidos (los gastos siempre vienen en ARS).
export function costoLoteUSD(l) {
  const bruto = l.cantidad * l.precio_compra;
  const gastos = l.gastos || 0;
  return l.moneda === 'USD' ? bruto + gastos / l.mep_dia : (bruto + gastos) / l.mep_dia;
}

// Costo de entrada de un lote como fracción del monto operado (para C1). null si no hubo gastos.
export function costoEntradaLote(l) {
  const bruto = l.cantidad * l.precio_compra;
  if (!l.gastos || !bruto) return null;
  return (l.gastos / (l.moneda === 'USD' ? l.mep_dia : 1)) / bruto;
}

// XIRR: flujos [{fecha, monto}] con aportes negativos y el valor final positivo. Devuelve tasa anual o null.
export function xirr(flujos) {
  if (flujos.length < 2 || !flujos.some(f => f.monto > 0) || !flujos.some(f => f.monto < 0)) return null;
  const t0 = flujos.reduce((m, f) => f.fecha < m ? f.fecha : m, flujos[0].fecha);
  const pts = flujos.map(f => ({ a: fechas.dias(t0, f.fecha) / 365, m: f.monto }));
  const van = r => suma(pts, p => p.m / Math.pow(1 + r, p.a));
  let lo = -0.99, hi = 10;
  if (van(lo) * van(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (van(lo) * van(mid) <= 0) hi = mid; else lo = mid;
    if (hi - lo < 1e-9) break;
  }
  return (lo + hi) / 2;
}

// Índice del primer día hábil >= fecha (compras) o del último <= fecha (valuación). -1 si no hay.
function indice(hist, fecha, modo) {
  const f = hist.fechas;
  let lo = 0, hi = f.length - 1, r = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (modo === 'compra') { if (f[mid] >= fecha) { r = mid; hi = mid - 1; } else lo = mid + 1; }
    else { if (f[mid] <= fecha) { r = mid; lo = mid + 1; } else hi = mid - 1; }
  }
  return r;
}

// Simula invertir cada aporte, en su fecha, en una canasta fija (pesos {ticker: fracción}) sin rebalanceo.
// Devuelve una función valorEn(fecha) → USD, o null si falta historia.
export function simularBenchmark(aportes, hist, pesos) {
  if (!hist?.fechas?.length) return null;
  const compras = [];
  for (const a of aportes) {
    let i = indice(hist, a.fecha, 'compra');
    if (i < 0) i = hist.fechas.length - 1;
    for (const [t, w] of Object.entries(pesos)) {
      const serie = hist.series[t];
      if (!serie) return null;
      compras.push({ fecha: a.fecha, t, unidades: a.usd * w / serie[i] });
    }
  }
  return fecha => {
    const i = indice(hist, fecha, 'valuacion');
    if (i < 0) return 0;
    return suma(compras, c => c.fecha <= fecha ? c.unidades * hist.series[c.t][i] : 0);
  };
}

// Rendimiento de un ticker del histórico entre dos fechas (cierre ajustado). null si no hay datos.
export function rendimientoHist(hist, ticker, desde, hasta) {
  if (!hist?.fechas?.length || !hist.series[ticker]) return null;
  const a = indice(hist, desde, 'valuacion'), b = indice(hist, hasta, 'valuacion');
  if (a < 0 || b < 0 || a === b) return null;
  return hist.series[ticker][b] / hist.series[ticker][a] - 1;
}

// Resumen de rendimiento: XIRR de la cartera y de los benchmarks con los mismos aportes en las mismas fechas.
export function rendimiento(estado) {
  const aportes = estado.datos.cashflows_externos_usd;
  const hoy = estado.hoy;
  const flujos = aportes.map(a => ({ fecha: a.fecha, monto: -a.usd }));
  const aportado = suma(aportes, a => a.usd);
  const fila = (nombre, valor) => ({
    nombre, valor, aportado, ganancia: valor - aportado,
    xirr: xirr([...flujos, { fecha: hoy, monto: valor }]),
  });
  const out = { aportado, cartera: fila('Tu cartera', estado.total_usd), benchmarks: [], valorEn: {} };
  const hist = estado.historico;
  const canastas = [['SPY', { SPY: 1 }], ['Núcleo ' + Object.values(estado.datos.nucleo.pesos_internos).map(w => Math.round(w * 100)).join('/'), estado.datos.nucleo.pesos_internos]];
  for (const [nombre, pesos] of canastas) {
    const sim = simularBenchmark(aportes, hist, pesos);
    if (!sim) continue;
    out.benchmarks.push(fila(nombre, sim(hoy)));
    out.valorEn[nombre] = sim;
  }
  return out;
}

// Costos explícitos (gastos de compra y venta) de los últimos 12 meses sobre el patrimonio medio (regla C3).
export function costosAnuales(estado) {
  const desde = fechas.sumar(estado.hoy, -365);
  const compras = suma(estado.datos.lotes_costo, l => l.fecha_compra >= desde ? (l.gastos || 0) / l.mep_dia : 0);
  const ventas = suma(estado.datos.realizados || [], v => v.fecha >= desde ? v.gastos_usd || 0 : 0);
  const snaps = Object.entries(estado.datos.snapshots || {}).filter(([f]) => f >= desde).map(([, s]) => s.t);
  const medio = snaps.length ? (suma(snaps) + estado.total_usd) / (snaps.length + 1) : estado.total_usd;
  return { usd: compras + ventas, patrimonio_medio: medio, pct: medio ? (compras + ventas) / medio : 0 };
}

// Control de consistencia: lo que costaron los lotes actuales no debería superar lo aportado más lo ganado y cobrado.
// Si lo supera, probablemente falte cargar algún aporte externo (y el XIRR queda inflado).
export function brechaAportes(estado) {
  const d = estado.datos;
  const costo = suma(d.lotes_costo, costoLoteUSD);
  const aportado = suma(d.cashflows_externos_usd, a => a.usd);
  const brecha = costo - aportado - suma(d.realizados || [], r => r.resultado_usd) - suma(d.cobros || [], c => c.usd);
  return { costo, aportado, brecha, relevante: brecha > aportado * 0.05 };
}
