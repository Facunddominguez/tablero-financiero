// Qué seguir: la lista pública de tickers que usa el Action para buscar noticias, fechas y formularios de la SEC.
// Va en data/seguimiento.json, que es público: solo tickers, tipo, subyacente en EE.UU. y de qué lista salen.
// Nunca cantidades, montos, precios ni fechas de compra. Puro.
import { ADR_DE_LOCAL } from './finanzas.js';

export const NOTA_SEGUIMIENTO = 'Lo escribe la app al sincronizar. Solo tickers: sin cantidades ni montos.';
const TIPOS_SIN_MERCADO = ['fci'];

// Ticker con el que se lo busca en EE.UU. (null si no cotiza allá o no se sabe).
export function subyacenteUsa(e, ticker, { tipo, grupo, subyacente } = {}) {
  if (TIPOS_SIN_MERCADO.includes(tipo)) return null;
  // Una obligación negociable se sigue por su emisor: el bloque YPF, por el ADR de YPF.
  if (tipo === 'on') return grupo === 'ypf' ? 'YPF' : ADR_DE_LOCAL[subyacente] || null;
  if (tipo === 'accion_ar') return ADR_DE_LOCAL[ticker] || ADR_DE_LOCAL[subyacente] || null;
  if (ADR_DE_LOCAL[ticker]) return ADR_DE_LOCAL[ticker];
  const info = e.ratios?.[ticker];
  if (info && 'usa' in info) return info.usa;
  const base = subyacente || ticker;
  return ADR_DE_LOCAL[base] || base || null;
}

const ORDEN = ['cartera', 'watchlist', 'fantasma'];
const limpio = t => String(t || '').trim().toUpperCase();

// [{ t, tipo, usa, en: ['cartera', 'watchlist', 'fantasma'] }], ordenado por ticker.
export function tickersASeguir(e) {
  const mapa = new Map();
  const sumar = (ticker, de, datos = {}) => {
    const t = limpio(ticker);
    if (!/^[A-Z0-9.]{1,12}$/.test(t)) return;
    let x = mapa.get(t);
    if (!x) {
      const tipo = datos.tipo || (ADR_DE_LOCAL[t] && ADR_DE_LOCAL[t] !== t ? 'accion_ar' : e.ratios?.[t] ? 'cedear' : 'usa');
      mapa.set(t, x = { t, tipo, usa: subyacenteUsa(e, t, { ...datos, tipo: datos.tipo || (tipo === 'accion_ar' ? tipo : undefined) }), en: new Set() });
    }
    x.en.add(de);
  };
  for (const p of e.posiciones) if (p.cantidad > 0) sumar(p.ticker, 'cartera', { tipo: p.tipo, grupo: p.grupo, subyacente: p.subyacente });
  for (const w of e.datos.watchlist || []) sumar(w.ticker, 'watchlist');
  for (const f of e.datos.fantasmas || []) sumar(f.ticker, 'fantasma');
  return [...mapa.values()].map(x => ({ t: x.t, tipo: x.tipo, usa: x.usa || null, en: ORDEN.filter(o => x.en.has(o)) }))
    .sort((a, b) => a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
}

// Series que hace falta tener en el histórico aunque no se sigan: las referencias que elegiste para tus satélites.
export function seriesDeReferencia(e, tickers = tickersASeguir(e)) {
  const seguidas = new Set(tickers.map(x => x.usa));
  return [...new Set(Object.values(e.datos.referencias || {}).map(limpio))].filter(t => /^[A-Z0-9.]{1,12}$/.test(t) && !seguidas.has(t)).sort();
}

export function seguimiento(e) {
  const tickers = tickersASeguir(e);
  return { nota: NOTA_SEGUIMIENTO, tickers, series: seriesDeReferencia(e, tickers) };
}
