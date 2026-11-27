// Calendario: balances y ex dividendo de lo que seguís, eventos fijos, feriados y cupones. Todo puro e informativo:
// no genera tareas ni toca las reglas.
import { fechas, fmt } from './util.js';
import { diaByma } from './precios.js';
import { proximosFlujos } from './motor.js';
import { tickersASeguir } from './seguimiento.js';

export const DIAS_HOY = 14, DIAS_INFORME = 90;
export const TIPOS = { balance: 'Balance', ex_dividendo: 'Ex dividendo', macro: 'Economía', eleccion: 'Elecciones', feriado: 'Feriado', cupon: 'Bono' };
const NOMBRE_LISTA = { cartera: 'en cartera', watchlist: 'watchlist', fantasma: 'fantasma' };

// Subyacente de EE.UU. → { tickers: con qué lo seguís, en: ['cartera', …] }.
export function seguidosPorSubyacente(e) {
  const m = new Map();
  // Sin los datos privados (resumen del sábado) la lista llega ya armada desde data/seguimiento.json.
  for (const x of e.lista_seguimiento || tickersASeguir(e)) {
    if (!x.usa) continue;
    const y = m.get(x.usa) || { tickers: [], en: [] };
    y.tickers.push(x.t);
    for (const l of x.en) if (!y.en.includes(l)) y.en.push(l);
    m.set(x.usa, y);
  }
  return m;
}

// "NVDA (en cartera)" o "PAM · PAMP (en cartera)".
export function comoLoSeguis(usa, s) {
  if (!s) return usa;
  const otros = s.tickers.filter(t => t !== usa);
  const lista = ['cartera', 'watchlist', 'fantasma'].find(l => s.en.includes(l));
  return `${usa}${otros.length ? ' · ' + otros.join(', ') : ''}${lista ? ` (${NOMBRE_LISTA[lista]})` : ''}`;
}

const ultimoDia = mes => fechas.sumar(fechas.sumarMeses(mes + '-01', 1), -1);

function deEmpresas(e) {
  const seguidos = seguidosPorSubyacente(e), out = [];
  for (const [usa, x] of Object.entries(e.agenda?.empresas || {})) {
    const s = seguidos.get(usa);
    if (!s) continue;
    const quien = comoLoSeguis(usa, s), base = { ticker: usa, en: s.en, fuente: e.agenda.fuente || 'Yahoo Finance', viejo: !!x.stale };
    if (x.balance) {
      const o = x.opciones?.balance === x.balance ? x.opciones : null;
      out.push({ ...base, fecha: x.balance, tipo: 'balance', titulo: `Balance de ${quien}`,
        movimiento: o?.movimiento ?? null,
        detalle: o ? `Las opciones descuentan un movimiento de ±${fmt.pct(o.movimiento)} (vencimiento ${fmt.fecha(o.vencimiento)}).` : '' });
    }
    if (x.ex_dividendo) out.push({ ...base, fecha: x.ex_dividendo, tipo: 'ex_dividendo', titulo: `Ex dividendo de ${quien}`, detalle: 'Desde ese día cotiza sin ese dividendo.' });
  }
  return out;
}

function fijos(e) {
  const out = [];
  for (const g of e.eventos_fijos?.grupos || []) {
    for (const x of g.eventos || []) {
      const base = { tipo: g.id === 'elecciones' ? 'eleccion' : 'macro', titulo: x.titulo || g.titulo, detalle: x.detalle || '', fuente: g.fuente, url: g.url, grupo: g.id };
      if (x.fecha) out.push({ ...base, fecha: x.fecha });
      else if (x.mes) out.push({ ...base, fecha: x.mes + '-01', hasta: ultimoDia(x.mes), sinDia: x.mes });
    }
  }
  return out;
}

function feriados(e, desde, hasta) {
  const cal = e.feriados, out = [], frase = t => t.charAt(0).toUpperCase() + t.slice(1);
  if (!cal) return out;
  for (let f = desde; f <= hasta; f = fechas.sumar(f, 1)) {
    const dia = new Date(f + 'T12:00:00Z').getUTCDay();
    if (dia === 0 || dia === 6) continue;
    const base = { fecha: f, tipo: 'feriado' };
    if (cal.feriados?.[f]) out.push({ ...base, titulo: 'Feriado en EE.UU.', detalle: frase(`${cal.feriados[f]}: no hay mercado allá.`), fuente: 'NYSE' });
    if (cal.medias_ruedas?.[f]) out.push({ ...base, titulo: 'Media rueda en EE.UU.', detalle: frase(`${cal.medias_ruedas[f]}.`), fuente: 'NYSE' });
    const ar = diaByma(cal, f);
    if (ar.sinRueda) out.push({ ...base, titulo: 'Sin rueda en BYMA', detalle: frase(`${ar.sinRueda}.`), fuente: 'BYMA y ArgentinaDatos' });
    else if (ar.sinLiquidacion) out.push({ ...base, titulo: 'BYMA opera sin liquidar', detalle: frase(`${ar.sinLiquidacion}.`), fuente: 'BYMA y ArgentinaDatos' });
  }
  return out;
}

function cupones(e, hoy) {
  return proximosFlujos(e, hoy).filter(f => f.fecha >= hoy && !f.cobrado).map(f => ({
    fecha: f.fecha, tipo: 'cupon', ticker: f.ticker,
    titulo: `${f.tipo === 'amortizacion' ? 'Devolución de capital' : f.tipo === 'cupon' ? 'Cupón' : 'Pago'} de ${f.ticker}: ≈ ${fmt.usd(f.usd, 2)}`,
    detalle: f.detalle || '', fuente: 'Prospecto de la emisión',
  }));
}

const ORDEN = ['eleccion', 'cupon', 'balance', 'ex_dividendo', 'macro', 'feriado'];

// Eventos de hoy a `dias` días, en orden. Los de un mes sin día confirmado entran si el mes se superpone.
export function agendaProxima(e, dias = DIAS_INFORME, hoy = e.hoy) {
  const hasta = fechas.sumar(hoy, dias);
  const todos = [...deEmpresas(e), ...fijos(e), ...feriados(e, hoy, hasta), ...cupones(e, hoy)];
  return todos.filter(x => x.fecha <= hasta && (x.hasta || x.fecha) >= hoy)
    .map(x => ({ ...x, orden: x.fecha < hoy ? hoy : x.fecha }))
    .sort((a, b) => a.orden < b.orden ? -1 : a.orden > b.orden ? 1 : ORDEN.indexOf(a.tipo) - ORDEN.indexOf(b.tipo) || a.titulo.localeCompare(b.titulo));
}

// Grupos de eventos fijos a los que les quedan menos de `dias` días cargados: avisa que hay que sumar fechas.
export function calendarioPorVencer(e, dias = DIAS_INFORME, hoy = e.hoy) {
  const limite = fechas.sumar(hoy, dias);
  return (e.eventos_fijos?.grupos || []).filter(g => g.id !== 'elecciones' && g.id !== 'msci')
    .map(g => ({ titulo: g.titulo, hasta: g.eventos.map(x => x.fecha || '').sort().at(-1) }))
    .filter(g => g.hasta && g.hasta < limite);
}

// "mar 01/12" (o "junio 2027" si no hay día).
const DIA_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const fechaCorta = x => x.sinDia ? fmt.mes(x.sinDia + '-01') : `${DIA_CORTO[new Date(x.fecha + 'T12:00:00Z').getUTCDay()]} ${x.fecha.slice(8, 10)}/${x.fecha.slice(5, 7)}`;
