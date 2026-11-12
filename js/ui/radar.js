// Pantalla Radar: compras de insiders, watchlist y cartera modelo de referencia.
import { h, fmt } from '../util.js';
import { tabla, chip, aviso } from './comun.js';

export function vistaRadar(ctx) {
  const e = ctx.estado, d = e.datos;
  const cedears = e.mercado?.cedears?.precios || {};
  const watch = new Set((d.watchlist || []).map(w => w.ticker));
  const mios = new Set(e.posiciones.map(p => p.subyacente || p.ticker));
  const marcas = t => h('span.marcas',
    mios.has(t) ? chip('En tu cartera', 'acento') : null, cedears[t] ? chip('Hay CEDEAR', 'ok') : null,
    watch.has(t) ? chip('En watchlist', 'acento') : null);
  const ins = e.insiders || { filas: [] };
  const filas = (ins.filas || []).slice().sort((a, b) => b.monto - a.monto);

  return h('div.vista.radar',
    h('header.vista-cab', h('h1', 'Radar'), h('p.nota', 'Lo que conviene tener a la vista: qué compran los directivos y tu lista de seguimiento.')),
    ctx.plan.solo_observacion ? aviso('Nuevas tesis bloqueadas por regla R7: solo observación.', 'alerta.fijo') : null,

    h('section',
      h('h2', 'Compras de directivos · últimos 7 días'),
      filas.length ? tabla([
        { titulo: 'Ticker', celda: f => [h('strong.num', f.ticker), h('span.empresa', f.empresa)] },
        { titulo: 'Insiders', num: 1, celda: f => fmt.num(f.insiders) },
        { titulo: 'Monto USD', num: 1, celda: f => fmt.num(f.monto) },
        { titulo: 'Δ tenencia', num: 1, celda: f => f.delta_tenencia || '—' },
        { titulo: 'Fecha', num: 1, celda: f => fmt.fecha(f.fecha) },
        { titulo: '', celda: f => marcas(f.ticker) },
      ], filas) : h('p.nota', 'No hay compras en grupo que cumplan el filtro esta semana.'),
      h('p.nota', { style: 'margin-top:.75rem' },
        `Fuente: OpenInsider (3 o más directivos comprando, por más de USD 400 mil). ${ins.actualizado ? 'Actualizado ' + fmt.hace(ins.actualizado) + '.' : ''}${ins.stale ? ' El último intento falló: se muestra el dato anterior.' : ''} `,
        ins.url ? h('a', { href: ins.url, target: '_blank', rel: 'noopener noreferrer' }, 'Ver el filtro original') : null)),

    h('section',
      h('h2', 'Watchlist'),
      tabla([
        { titulo: 'Ticker', celda: w => h('strong.num', w.ticker) }, { titulo: 'Tema', celda: w => w.tema }, { titulo: 'Prioridad', celda: w => w.prioridad },
        { titulo: 'Máx. inicial', num: 1, celda: w => fmt.pct(w.max_inicial, 0) },
        { titulo: 'CEDEAR', num: 1, celda: w => cedears[w.ticker] ? fmt.ars(cedears[w.ticker][0]) : '—' },
        { titulo: '', celda: w => h('span.marcas', w.solapamiento ? chip('Solapa: ' + w.solapamiento, 'alerta') : null) },
      ], d.watchlist || []),
      h('p.nota', { style: 'margin-top:.75rem' }, 'El máximo inicial es el tope de la primera compra, en % de la cartera de largo plazo, para cuando la regla R7 lo permita.')),

    d.cartera_modelo_allaria ? h('section',
      h('h2', `Cartera modelo de referencia · Allaria ${d.cartera_modelo_allaria.rotacion}, ${fmt.fecha(d.cartera_modelo_allaria.fecha)}`),
      h('ul.allaria-lista', d.cartera_modelo_allaria.activos.map(a => h('li' + (mios.has(a.ticker) ? '.tengo' : ''), a.ticker,
        mios.has(a.ticker) ? h('small', 'en cartera') : watch.has(a.ticker) ? h('small', 'watchlist') : null))),
      h('p.nota', h('a', { href: '#informes/allaria' }, 'Ver el contraste completo con tu cartera →'))) : null);
}
