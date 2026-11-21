// Cálculos financieros puros: costo de lotes, XIRR y benchmark simulado.
import { fechas, suma } from './util.js';

// Acciones argentinas que cotizan como ADR en EE.UU. con otro ticker. OpenInsider y la SEC usan el del ADR.
export const ADR_DE_LOCAL = {
  PAMP: 'PAM', YPFD: 'YPF', TGSU2: 'TGS', TECO2: 'TEO', CRES: 'CRESY', IRSA: 'IRS',
  GGAL: 'GGAL', BMA: 'BMA', BBAR: 'BBAR', SUPV: 'SUPV', CEPU: 'CEPU', EDN: 'EDN', LOMA: 'LOMA',
};


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

// Simula invertir cada aporte en una canasta fija (pesos {ticker: fracción}) sin rebalanceo. Cada aporte se compra
// al cierre del primer día hábil desde su fecha y cuenta desde ese día (un aporte de sábado entra el lunes).
// Devuelve una función valorEn(fecha) → USD, con .flujos: los aportes en la fecha en que entran; null si falta historia.
export function simularBenchmark(aportes, hist, pesos) {
  if (!hist?.fechas?.length) return null;
  const compras = [], flujos = [];
  for (const a of aportes) {
    let i = indice(hist, a.fecha, 'compra');
    if (i < 0) i = hist.fechas.length - 1;
    const entra = hist.fechas[i] > a.fecha ? hist.fechas[i] : a.fecha;
    flujos.push({ fecha: entra, usd: a.usd });
    for (const [t, w] of Object.entries(pesos)) {
      const serie = hist.series[t];
      if (!serie) return null;
      compras.push({ fecha: entra, t, unidades: a.usd * w / serie[i] });
    }
  }
  const valorEn = fecha => {
    const i = indice(hist, fecha, 'valuacion');
    if (i < 0) return 0;
    return suma(compras, c => c.fecha <= fecha ? c.unidades * hist.series[c.t][i] : 0);
  };
  valorEn.flujos = flujos;
  return valorEn;
}

// SPY y el núcleo simulados con unos flujos dados. [{ nombre, valorEn }].
export function benchmarks(estado, flujos) {
  const pn = estado.datos.nucleo.pesos_internos;
  return [['SPY', { SPY: 1 }], ['Núcleo ' + Object.values(pn).map(w => Math.round(w * 100)).join('/'), pn]]
    .map(([nombre, pesos]) => { const valorEn = simularBenchmark(flujos, estado.historico, pesos); return valorEn && { nombre, valorEn }; })
    .filter(Boolean);
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

// ---------- Historia de tu cartera ----------
// Antes del primer registro diario no hay valores guardados: se estiman con los lotes que tenés hoy, cada uno
// desde su fecha de compra, valuados con el precio histórico de su subyacente en EE.UU. (escalado para que hoy
// dé el valor real) o, si no hay serie (ON, FCI), en línea recta entre lo que costó y lo que vale hoy. Se suma
// la caja estimada: aportes, cupones, dividendos y resultados de ventas cargados, menos lo que costaron las compras
// (si una compra no tiene plata cargada que la cubra, se toma como aporte implícito).
// Devuelve { puntos: [{ f, v, rec }], indice, ganancia, flujos, cierre }:
//   indice/ganancia: factor y USD acumulados (los aportes no cuentan como ganancia);
//   flujos: aportes cargados en su fecha + implícitos (los mismos que se simulan en SPY y el núcleo);
//   cierre: lo estimado contra el primer registro diario, para avisar si no coinciden.
export function historiaCartera(estado) {
  const d = estado.datos, hoy = estado.hoy;
  const snaps = Object.entries(d.snapshots || {}).sort().map(([f, s]) => ({ f, v: s.t }));
  const primero = snaps.length ? snaps[0].f : hoy;
  const aportes = d.cashflows_externos_usd || [];
  // En los registros diarios un aporte aparece el día en que se cargó en la app si se cargó con fecha anterior.
  const momentos = new Map((d.eventos || []).filter(e => e.tipo === 'aporte' && e.ts).map(e => [e.id, e.ts]));
  const visibles = aportes.map(a => {
    const ts = a.evento && momentos.get(a.evento), cargado = ts ? fechas.deMomento(ts) : null;
    return { fecha: cargado && cargado > a.fecha ? cargado : a.fecha, usd: a.usd };
  });
  const rec = reconstruir(estado, primero);

  const puntos = [], indice = [], ganancia = [];
  let I = 1, G = 0;
  if (rec) {
    rec.puntos.forEach((p, k) => {
      if (k > 0) {
        const ant = rec.puntos[k - 1];
        if (ant.v > 0) { I *= (p.v - p.entra) / ant.v; G += p.v - ant.v - p.entra; }
      }
      if (p.f < primero) { puntos.push({ f: p.f, v: p.v, rec: true }); indice.push(I); ganancia.push(G); }
    });
  }
  // Registros diarios: Dietz modificado con los aportes, como curvaPorcentual.
  snaps.forEach((p, k) => {
    if (k > 0) {
      const ant = snaps[k - 1], largo = Math.max(1, fechas.dias(ant.f, p.f));
      const tramo = visibles.filter(a => a.fecha > ant.f && a.fecha <= p.f);
      const flujo = suma(tramo, a => a.usd), pond = suma(tramo, a => a.usd * fechas.dias(a.fecha, p.f) / largo);
      if (ant.v > 0 && ant.v + pond > 0) { I *= 1 + (p.v - ant.v - flujo) / (ant.v + pond); G += p.v - ant.v - flujo; }
    }
    puntos.push({ f: p.f, v: p.v, rec: false }); indice.push(I); ganancia.push(G);
  });
  const flujos = [...aportes.map(a => ({ fecha: a.fecha, usd: a.usd })), ...(rec ? rec.implicitos : [])]
    .sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0);
  const fin = rec?.puntos[rec.puntos.length - 1];
  const cierre = rec && snaps.length ? { fecha: primero, estimado: fin.v, registrado: snaps[0].v } : null;
  return { puntos, indice, ganancia, flujos, cierre };
}

// Puntos diarios (días hábiles de la serie histórica) desde el primer aporte o compra hasta `hasta` inclusive.
// Cada punto: { f, v: tenencias + caja en USD, entra: lo que entró en el tramo y no es ganancia }.
// "entra" = aportes del tramo + aportes implícitos + (valor estimado − costo) de lo comprado en el tramo,
// así la diferencia entre el precio estimado y el que pagaste no se cuenta como ganancia ni pérdida.
// Cupones, dividendos y resultados de ventas suman a la caja como ganancia (las amortizaciones no: devuelven capital).
function reconstruir(estado, hasta) {
  const d = estado.datos, hist = estado.historico, hoy = estado.hoy;
  if (!hist?.fechas?.length) return null;
  const lotes = (d.lotes_costo || []).filter(l => l.fecha_compra && l.fecha_compra < hasta && l.cantidad > 0);
  const aportes = (d.cashflows_externos_usd || []).filter(a => a.fecha < hasta);
  const ganados = [
    ...(d.cobros || []).filter(c => c.fecha < hasta && c.clase !== 'amortizacion').map(c => ({ fecha: c.fecha, usd: c.usd || 0 })),
    ...(d.realizados || []).filter(x => x.fecha < hasta).map(x => ({ fecha: x.fecha, usd: x.resultado_usd || 0 })),
  ];
  if (!lotes.length && !aportes.length) return null;
  const iHoy = indice(hist, hoy, 'valuacion');
  const precios = lotes.map(l => precioLote(estado, l, iHoy));
  const costos = lotes.map(l => costoLoteUSD(l));
  const desde = [...lotes.map(l => l.fecha_compra), ...aportes.map(a => a.fecha)].sort()[0];
  const dias = hist.fechas.filter(f => f >= desde && f < hasta).concat([hasta]);
  const out = [], implicitos = [];
  let previa = null, implicito = 0;
  for (const f of dias) {
    let tenencia = 0, costoAcum = 0, ajuste = 0;
    lotes.forEach((l, k) => {
      if (l.fecha_compra > f) return;
      costoAcum += costos[k];
      const valor = precios[k] ? l.cantidad * precios[k](f) : costos[k];
      tenencia += valor;
      if (previa === null || l.fecha_compra > previa) ajuste += valor - costos[k];
    });
    const aportado = suma(aportes.filter(a => a.fecha <= f), a => a.usd);
    const ganado = suma(ganados.filter(g => g.fecha <= f), g => g.usd);
    const tramo = suma(aportes.filter(a => a.fecha <= f && (previa === null || a.fecha > previa)), a => a.usd);
    const nuevoImplicito = Math.max(implicito, costoAcum - aportado - ganado);
    const entraImplicito = nuevoImplicito - implicito;
    if (entraImplicito > 1e-9) implicitos.push({ fecha: f, usd: entraImplicito, implicito: true });
    implicito = nuevoImplicito;
    const caja = aportado + ganado - costoAcum + implicito;
    out.push({ f, v: tenencia + caja, entra: tramo + entraImplicito + ajuste });
    previa = f;
  }
  return { puntos: out, implicitos };
}

// Precio unitario en USD de un lote en cualquier fecha posterior a su compra.
function precioLote(estado, l, iHoy) {
  const p = estado.posiciones.find(x => x.ticker === l.ticker);
  if (!p || !(p.cantidad > 0) || !(p.valor_usd > 0)) return null;
  const hoyUnit = p.valor_usd / p.cantidad, hist = estado.historico;
  const conSerie = p.tipo !== 'on' && p.tipo !== 'fci';
  const t = conSerie ? [p.ticker_subyacente_usa, p.subyacente, ADR_DE_LOCAL[p.ticker], p.ticker].find(x => x && hist.series[x]) : null;
  if (t && iHoy >= 0) {
    const s = hist.series[t];
    let j = iHoy; while (j >= 0 && s[j] == null) j--;
    if (j >= 0) {
      const factor = hoyUnit / s[j];
      return f => {
        let i = indice(hist, f, 'valuacion'); while (i > 0 && s[i] == null) i--;
        return i >= 0 && s[i] != null ? s[i] * factor : hoyUnit;
      };
    }
  }
  // Sin serie: línea recta entre lo que costó y lo que vale hoy.
  const costoUnit = costoLoteUSD(l) / l.cantidad, total = Math.max(1, fechas.dias(l.fecha_compra, estado.hoy));
  return f => costoUnit + (hoyUnit - costoUnit) * Math.min(1, Math.max(0, fechas.dias(l.fecha_compra, f) / total));
}

// Todo lo de un período (mes, año o desde el inicio) para tu cartera y los benchmarks, con una sola vara:
// rendimiento por tiempo (los aportes no cuentan como ganancia), en USD sin ajustar por inflación.
// bench: benchmarks(estado, historia.flujos), así SPY y el núcleo simulan exactamente la misma plata que entró.
// Devuelve { puntos, k, nombres, usd, pct, filas: [{ nombre, rend, anual, real, ganancia }], aportado, implicito, inflacion, dias, f0 }.
export function resumenPeriodo(estado, historia, bench, per) {
  const todos = historia.puntos;
  const k = inicioDelPeriodo(todos.map(p => p.f), estado.hoy, per);
  const puntos = todos.slice(k);
  if (puntos.length < 2) return { puntos, k };
  const f0 = puntos[0].f, fin = puntos[puntos.length - 1].f, dias = fechas.dias(f0, fin);
  const nombres = ['Tu cartera', ...bench.map(b => b.nombre)];
  const usd = [puntos.map(p => p.v), ...bench.map(b => puntos.map(p => b.valorEn(p.f)))];
  const base = historia.indice[k];
  const pct = [
    historia.indice.slice(k).map(x => x / base - 1),
    ...bench.map((b, i) => curvaPorcentual(puntos.map((p, j) => ({ f: p.f, v: usd[i + 1][j] })), b.valorEn.flujos)),
  ];
  const enTramo = a => a.fecha > f0 && a.fecha <= fin;
  // Inflación de EE.UU. del período: IPC del último mes publicado contra el del mes en que arranca.
  // Si todavía no hay un mes publicado posterior al del inicio, no se puede medir.
  const def = deflactor(estado.mercado?.cpi_usa?.meses);
  const inflacion = def && def.ultimo > f0.slice(0, 7) ? { valor: def.factor(f0) - 1, desde: f0.slice(0, 7), hasta: def.ultimo } : null;
  const filas = nombres.map((nombre, i) => {
    const rend = pct[i][pct[i].length - 1];
    const ganancia = i === 0
      ? historia.ganancia[historia.ganancia.length - 1] - historia.ganancia[k]
      : usd[i][usd[i].length - 1] - usd[i][0] - suma(bench[i - 1].valorEn.flujos.filter(enTramo), a => a.usd);
    return {
      nombre, rend, ganancia,
      anual: dias >= 365 ? Math.pow(1 + rend, 365 / dias) - 1 : null,
      real: inflacion ? (1 + rend) / (1 + inflacion.valor) - 1 : null,
    };
  });
  // Aportes: en "desde el inicio" van todos (también el primero); en el mes o el año, los que entraron en el período.
  const delPeriodo = historia.flujos.filter(a => (per === 'todo' || a.fecha > f0) && a.fecha <= fin);
  return {
    puntos, k, nombres, usd, pct, filas, inflacion, dias, f0,
    aportado: suma(delPeriodo, a => a.usd), implicito: suma(delPeriodo.filter(a => a.implicito), a => a.usd),
  };
}

// Índice del primer punto de un período: el último anterior al inicio (así el primer día cuenta) o el primero.
export function inicioDelPeriodo(fechasPuntos, hoy, per) {
  if (per === 'todo' || !fechasPuntos.length) return 0;
  const inicio = per === 'mes' ? hoy.slice(0, 7) + '-01' : hoy.slice(0, 4) + '-01-01';
  let k = 0;
  fechasPuntos.forEach((f, i) => { if (f < inicio) k = i; });
  return fechasPuntos[k] < inicio ? k : 0;
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
