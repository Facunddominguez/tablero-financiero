// Diario: predicciones con su puntaje, carteras fantasma y satélites contra su referencia. Todo puro.
import { fechas, suma } from './util.js';
import { ADR_DE_LOCAL, serieDe } from './finanzas.js';

// ---------- predicciones ----------
export const RANGOS = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1]];

// Puntaje de Brier: promedio de (probabilidad − lo que pasó)². 0 es perfecto; decir siempre 50% da 0,25.
// Y por rango de probabilidad: cuántas eran, qué probabilidad les diste en promedio y cuántas se cumplieron.
export function puntajePredicciones(predicciones = []) {
  const resueltas = predicciones.filter(p => typeof p.cumplio === 'boolean');
  const promedio = (l, fn) => l.length ? suma(l, fn) / l.length : null;
  return {
    total: predicciones.length, resueltas: resueltas.length, pendientes: predicciones.length - resueltas.length,
    brier: promedio(resueltas, p => (p.probabilidad - (p.cumplio ? 1 : 0)) ** 2),
    rangos: RANGOS.map(([desde, hasta], i) => {
      const l = resueltas.filter(p => p.probabilidad >= desde && (p.probabilidad < hasta || i === RANGOS.length - 1));
      return { desde, hasta, cantidad: l.length, esperado: promedio(l, p => p.probabilidad), acierto: promedio(l, p => p.cumplio ? 1 : 0) };
    }),
  };
}

// ---------- series ----------
// Con qué serie del histórico se sigue un ticker: la propia, la del ADR o la del subyacente en EE.UU.
function candidatas(e, ticker) {
  const info = e.ratios?.[ticker];
  return [ticker, ADR_DE_LOCAL[ticker], info?.usa].filter(Boolean);
}
export const serieDeTicker = (e, ticker) => candidatas(e, ticker).find(t => serieDe(e.historico, t)?.some(v => v > 0)) || null;
// Lo que habría que sumar a historico_extra para poder seguirlo.
export const comoPedirlo = (e, ticker) => ADR_DE_LOCAL[ticker] || e.ratios?.[ticker]?.usa || ticker;

// Precio de una serie: 'compra' = primer cierre desde la fecha; si no, el último hasta la fecha.
function precioEn(hist, serie, fecha, modo) {
  const s = serieDe(hist, serie), f = hist.fechas;
  if (modo === 'compra') {
    for (let i = 0; i < f.length; i++) if (f[i] >= fecha && s[i] > 0) return { f: f[i], v: s[i] };
    return null;
  }
  for (let i = f.length - 1; i >= 0; i--) if (f[i] <= fecha && s[i] > 0) return { f: f[i], v: s[i] };
  return null;
}
// Rendimiento de una serie y de otra de referencia entre las mismas dos fechas (en dólares de EE.UU.).
function tramo(hist, serie, referencia, desde, hasta) {
  const a = precioEn(hist, serie, desde, 'compra');
  if (!a || hasta <= a.f) return null;
  const b = precioEn(hist, serie, hasta, 'valuacion');
  const ra = precioEn(hist, referencia, a.f, 'valuacion'), rb = precioEn(hist, referencia, hasta, 'valuacion');
  if (!b || !ra || !rb || b.f <= a.f) return null; // todavía no hay un cierre posterior al de entrada
  const rend = b.v / a.v - 1, ref = rb.v / ra.v - 1;
  return { rend, ref, dif: rend - ref };
}

// ---------- carteras fantasma ----------
export const HORIZONTES = [1, 3, 6, 12];
export const DIAS_ENTRE_SENALES = 90; // el radar anota como mucho una señal por empresa en este plazo
// Identifica una cartera fantasma (para agrupar, editar y borrar): origen, nombre o ticker, y fecha.
export const claveFantasma = f => `${f.origen}|${f.grupo || f.ticker}|${f.fecha}`;

// Cada fantasma contra SPY desde su fecha. Devuelve { grupos: [{ nombre, origen, fecha, filas, promedio }], faltan: [tickers a pedir] }.
// En cada fila y en el promedio: plazos {1,3,6,12} (null si todavía no pasó) y hoy.
export function compararFantasmas(e) {
  const hist = e.historico, ultimo = hist?.fechas?.at(-1);
  const faltan = new Set(), grupos = new Map();
  for (const f of e.datos.fantasmas || []) {
    const serie = hist?.fechas?.length ? serieDeTicker(e, f.ticker) : null;
    if (!serie) faltan.add(comoPedirlo(e, f.ticker));
    const medir = hasta => serie && serieDe(hist, 'SPY') ? tramo(hist, serie, 'SPY', f.fecha, hasta) : null;
    const fila = {
      ticker: f.ticker, fecha: f.fecha, serie,
      plazos: Object.fromEntries(HORIZONTES.map(n => { const hasta = fechas.sumarMeses(f.fecha, n); return [n, ultimo && hasta <= ultimo ? medir(hasta) : null]; })),
      hoy: ultimo ? medir(ultimo) : null,
    };
    const clave = claveFantasma(f);
    if (!grupos.has(clave)) grupos.set(clave, { clave, nombre: f.grupo || f.ticker, grupo: f.grupo || null, origen: f.origen, fecha: f.fecha, filas: [] });
    grupos.get(clave).filas.push(fila);
  }
  // Cartera con varios papeles: todos con el mismo peso.
  const promediar = l => { const v = l.filter(Boolean); return v.length ? { rend: suma(v, x => x.rend) / v.length, ref: suma(v, x => x.ref) / v.length, dif: suma(v, x => x.dif) / v.length, cantidad: v.length } : null; };
  const lista = [...grupos.values()].sort((a, b) => a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0);
  for (const g of lista) g.promedio = g.filas.length > 1 ? { plazos: Object.fromEntries(HORIZONTES.map(n => [n, promediar(g.filas.map(x => x.plazos[n]))])), hoy: promediar(g.filas.map(x => x.hoy)) } : null;
  return { grupos: lista, faltan: [...faltan].sort() };
}

// ---------- satélites contra su referencia ----------
// Se puede cambiar en los datos (clave "referencias": { ticker: serie }). Sin referencia propia, SPY.
export const REFERENCIAS = { NVDA: 'SMH', MELI: 'EEM', YPF: 'ARGT', YPFD: 'ARGT', PAM: 'ARGT', PAMP: 'ARGT', GOOGL: 'SPY', TSLA: 'SPY' };

// Cada satélite (acción o CEDEAR) contra su referencia: últimos 3 y 12 meses y desde tu primera compra.
// { filas: [{ ticker, serie, referencia, tres, doce, compra, desde }], faltan: [series a pedir] }
export function contraReferencia(e) {
  const hist = e.historico, ultimo = hist?.fechas?.at(-1), mapa = { ...REFERENCIAS, ...e.datos.referencias };
  const faltan = new Set();
  const filas = e.posiciones.filter(p => (p.grupo === 'satelite' || p.grupo === 'ypf') && (p.tipo === 'cedear' || p.tipo === 'accion_ar')).map(p => {
    const serie = ultimo ? serieDeTicker(e, p.subyacente || p.ticker) || serieDeTicker(e, p.ticker) : null;
    const referencia = mapa[p.ticker] || mapa[serie] || 'SPY';
    if (!serie) faltan.add(comoPedirlo(e, p.ticker));
    if (!serieDe(hist, referencia)?.some(v => v > 0)) faltan.add(referencia);
    const medir = desde => serie && serieDe(hist, referencia) && desde >= hist.fechas[0] ? tramo(hist, serie, referencia, desde, ultimo) : null;
    const desde = e.datos.lotes_costo.filter(l => l.ticker === p.ticker).map(l => l.fecha_compra).sort()[0] || null;
    return {
      ticker: p.ticker, serie, referencia, desde,
      tres: ultimo ? medir(fechas.sumarMeses(ultimo, -3)) : null,
      doce: ultimo ? medir(fechas.sumarMeses(ultimo, -12)) : null,
      compra: desde && ultimo ? medir(desde) : null,
    };
  });
  return { filas, faltan: [...faltan].sort() };
}

// ---------- rotaciones de Allaria ----------
// Los eventos que se guardan al cargar una rotación nueva: la rotación y la cartera resultante como fantasma.
export function eventosRotacion(datos, { fecha, rotacion, entra = [], sale = [] }, hoy) {
  const actuales = (datos.cartera_modelo_allaria?.activos || []).map(a => a.ticker);
  const nuevos = [...actuales.filter(t => !sale.includes(t)), ...entra.filter(t => !actuales.includes(t))];
  const lista = l => l.length ? l.join(', ') : 'nada';
  return [
    { tipo: 'rotacion_allaria', fecha, rotacion, entra, sale },
    ...nuevos.map(ticker => ({ tipo: 'fantasma', origen: 'allaria', ticker, fecha, grupo: `Allaria ${rotacion}` })),
    { tipo: 'decision', fecha: hoy, texto: `Rotación ${rotacion} de Allaria: entra ${lista(entra)}; sale ${lista(sale)}` },
  ];
}
