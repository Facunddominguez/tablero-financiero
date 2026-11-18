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
// Factor para llevar dólares de un mes a dólares del último mes con IPC de EE.UU. publicado.
// meses = { 'AAAA-MM': índice }. Si el mes no está, usa el anterior más cercano; si es posterior al último, 1.
export function deflactor(meses) {
  const claves = Object.keys(meses || {}).filter(k => meses[k] > 0).sort();
  if (claves.length < 2) return null;
  const ultimo = claves[claves.length - 1], base = meses[ultimo];
  const factor = fecha => {
    const m = fecha.slice(0, 7);
    if (m >= ultimo) return 1;
    let k = null;
    for (const c of claves) { if (c <= m) k = c; else break; }
    return base / meses[k ?? claves[0]];
  };
  return { factor, ultimo };
}

export function rendimiento(estado) {
  const aportes = estado.datos.cashflows_externos_usd;
  const hoy = estado.hoy;
  const flujos = aportes.map(a => ({ fecha: a.fecha, monto: -a.usd }));
  const aportado = suma(aportes, a => a.usd);
  // Rendimiento real: cada aporte se pasa a dólares de hoy con el IPC de EE.UU. y se recalcula la tasa.
  const def = deflactor(estado.mercado?.cpi_usa?.meses);
  const flujosReales = def ? aportes.map(a => ({ fecha: a.fecha, monto: -a.usd * def.factor(a.fecha) })) : null;
  const fila = (nombre, valor) => ({
    nombre, valor, aportado, ganancia: valor - aportado,
    xirr: xirr([...flujos, { fecha: hoy, monto: valor }]),
    xirr_real: flujosReales ? xirr([...flujosReales, { fecha: hoy, monto: valor }]) : null,
  });
  const primero = aportes[0]?.fecha;
  const out = {
    aportado, cartera: fila('Tu cartera', estado.total_usd), benchmarks: [], valorEn: {},
    inflacion: def && primero ? { hasta: def.ultimo, desde: primero.slice(0, 7), acumulada: def.factor(primero) - 1 } : null,
  };
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

// Rendimiento acumulado "por tiempo" (TWR): encadena la variación entre cada par de fechas
// descontando los aportes que entraron en el medio, así un aporte no se confunde con ganancia.
// Dentro de cada tramo pondera el aporte por los días que estuvo invertido (Dietz modificado):
// con un punto por día casi no importa; sirve cuando pasan varios días sin abrir el tablero.
// puntos: [{ f, v }] ordenados; aportes: [{ fecha, usd }]. Devuelve el % acumulado en cada fecha (0 en la primera).
export function curvaPorcentual(puntos, aportes) {
  const out = [];
  let indice = 1;
  puntos.forEach((p, i) => {
    if (i > 0) {
      const ant = puntos[i - 1], largo = Math.max(1, fechas.dias(ant.f, p.f));
      const tramo = aportes.filter(a => a.fecha > ant.f && a.fecha <= p.f);
      const flujo = suma(tramo, a => a.usd);
      const ponderado = suma(tramo, a => a.usd * fechas.dias(a.fecha, p.f) / largo);
      const capital = ant.v + ponderado;
      if (ant.v > 0 && capital > 0 && p.v != null) indice *= 1 + (p.v - ant.v - flujo) / capital;
    }
    out.push(indice - 1);
  });
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

// Rendimiento de lo que hoy hay en cartera, por bloque, medido desde la compra de cada lote (no incluye lo ya vendido).
// Cada fila se compara con haber puesto esa misma plata, en esas mismas fechas, en el núcleo y en SPY.
export function rendimientoPorBloque(estado) {
  const d = estado.datos, hoy = estado.hoy, hist = estado.historico;
  const grupoDeTicker = Object.fromEntries(estado.posiciones.map(p => [p.ticker, p.grupo]));
  const fila = (nombre, grupos) => {
    const pos = estado.posiciones.filter(p => grupos.includes(p.grupo));
    const lotes = d.lotes_costo.filter(l => grupos.includes(grupoDeTicker[l.ticker]));
    const aportes = lotes.map(l => ({ fecha: l.fecha_compra, usd: costoLoteUSD(l) })).filter(a => a.usd > 0);
    const costo = suma(aportes, a => a.usd), valor = suma(pos, p => p.valor_usd);
    if (!(costo > 0)) return null;
    const flujos = aportes.map(a => ({ fecha: a.fecha, monto: -a.usd }));
    const contra = pesos => { const sim = simularBenchmark(aportes, hist, pesos); return sim ? xirr([...flujos, { fecha: hoy, monto: sim(hoy) }]) : null; };
    const meses = suma(aportes, a => a.usd * fechas.dias(a.fecha, hoy)) / costo / 30.44; // antigüedad media, ponderada por costo
    return { nombre, costo, valor, ganancia: valor - costo, meses, reciente: meses < 3, xirr: xirr([...flujos, { fecha: hoy, monto: valor }]), xirr_nucleo: contra(d.nucleo.pesos_internos), xirr_spy: contra({ SPY: 1 }) };
  };
  return [fila('Largo plazo (todo)', ['nucleo', 'satelite', 'ypf', 'renta_fija']), fila('Núcleo', ['nucleo']), fila('Satélites', ['satelite']), fila('YPF', ['ypf']), fila('Renta fija en pesos', ['renta_fija'])].filter(Boolean);
}
