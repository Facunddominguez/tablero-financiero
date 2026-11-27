// Pruebas públicas de la ronda 3 (sin datos privados). Corren junto con js/pruebas_publicas.js.
import { aplicarEventos } from './estado.js';
import { tickersASeguir, seguimiento, subyacenteUsa } from './seguimiento.js';
import { publicarSeguimiento } from './sync.js';
import { cerca, igual, si, mundo } from './pruebas_ronda2.js';
import { agendaProxima, calendarioPorVencer, comoLoSeguis, fechaCorta } from './calendario.js';
import { planificador } from './motor.js';

const evento = (id, resto) => ({ id: 'r3-' + id, ts: `2026-11-30T12:00:00.${String(id).padStart(3, '0')}Z`, ...resto });

// ---------- etapa 1 · qué seguir ----------
// GitHub simulado para un solo archivo: GET devuelve su contenido y PUT lo reemplaza.
function githubArchivo(inicial = null, { conflictos = 0 } = {}) {
  const g = { texto: inicial, puts: [], gets: 0 };
  const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const deB64 = s => new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
  g.fetch = async (url, op = {}) => {
    const r = (status, cuerpo) => ({ ok: status < 300, status, json: async () => cuerpo });
    if (op.method === 'PUT') {
      const body = JSON.parse(op.body);
      if (conflictos-- > 0) return r(409, {});
      g.puts.push(body); g.texto = deB64(body.content);
      return r(200, { content: { sha: 'nuevo' } });
    }
    g.gets++;
    return g.texto == null ? r(404, {}) : r(200, { content: b64(g.texto), sha: 'viejo' });
  };
  return g;
}

function etapa1() {
  return [
    ['Qué seguir: cartera, watchlist y fantasmas, con su tipo y su subyacente en EE.UU.', async () => {
      const { e } = mundo({ eventos: [evento(1, { tipo: 'fantasma', origen: 'radar', ticker: 'CTSO', fecha: '2026-11-20' }), evento(2, { tipo: 'fantasma', origen: 'allaria', ticker: 'AAPL', fecha: '2026-11-03', grupo: 'Allaria P3' })] });
      const l = tickersASeguir(e), por = Object.fromEntries(l.map(x => [x.t, x]));
      igual(por.SPY, { t: 'SPY', tipo: 'cedear', usa: 'SPY', en: ['cartera'] }, 'SPY');
      igual([por.PAMP.tipo, por.PAMP.usa], ['accion_ar', 'PAM'], 'acción local por su ADR');
      igual([por.ON1.tipo, por.ON1.usa], ['on', 'YPF'], 'la ON del bloque YPF se sigue por YPF');
      igual([por.FCID.tipo, por.FCID.usa], ['fci', null], 'un fondo no tiene subyacente');
      igual(por.AAPL.en, ['watchlist', 'fantasma'], 'junta las dos listas');
      igual(por.CTSO, { t: 'CTSO', tipo: 'usa', usa: 'CTSO', en: ['fantasma'] }, 'fantasma del radar sin CEDEAR');
      igual(l.map(x => x.t), [...l.map(x => x.t)].sort(), 'ordenado');
    }],
    ['Qué seguir: no lleva cantidades, montos ni fechas', async () => {
      const { e } = mundo();
      const s = seguimiento(e);
      for (const x of s.tickers) igual(Object.keys(x), ['t', 'tipo', 'usa', 'en'], 'solo esos campos');
      const texto = JSON.stringify(s.tickers);
      for (const p of e.datos.posiciones) si(!texto.includes(String(p.cantidad)), 'se filtró una cantidad de ' + p.ticker);
      si(!/\d{4}-\d{2}-\d{2}/.test(texto), 'se filtró una fecha');
      si(![...Object.values(s.tickers)].some(x => Object.values(x).some(v => typeof v === 'number')), 'hay un número');
    }],
    ['Qué seguir: usa el ticker de EE.UU. del archivo de ratios y respeta lo que no cotiza allá', async () => {
      const e = { ratios: { BRKB: { ratio: 22, usa: 'BRK.B' }, ADS: { ratio: 22, usa: null } } };
      igual([subyacenteUsa(e, 'BRKB', { tipo: 'cedear' }), subyacenteUsa(e, 'ADS', { tipo: 'cedear' }), subyacenteUsa(e, 'YPFD', {}), subyacenteUsa(e, 'XYZ', { tipo: 'on', grupo: 'renta_fija' })],
        ['BRK.B', null, 'YPF', null], 'mapeo');
    }],
    ['Qué seguir: se publica solo si cambió, con reintento si otro dispositivo escribió', async () => {
      const lista = seguimiento(mundo().e), gh = { repo: 'u/r', token: 't' };
      const vacio = githubArchivo();
      si(await publicarSeguimiento(gh, lista, vacio.fetch) === 'subido' && vacio.puts.length === 1 && !vacio.puts[0].sha, 'la primera vez crea el archivo');
      si(await publicarSeguimiento(gh, lista, vacio.fetch) === 'igual' && vacio.puts.length === 1, 'sin cambios no escribe');
      const otro = { ...lista, tickers: lista.tickers.slice(1) };
      si(await publicarSeguimiento(gh, otro, vacio.fetch) === 'subido' && vacio.puts[1].sha === 'viejo', 'con cambios reemplaza');
      const chocado = githubArchivo('{"tickers":[]}', { conflictos: 1 });
      si(await publicarSeguimiento(gh, lista, chocado.fetch) === 'subido' && chocado.gets === 2, 'reintenta tras el conflicto');
      JSON.parse(chocado.texto);
    }],
  ];
}

// ---------- etapa 2 · calendario ----------
function etapa2() {
  return [
    ['Calendario: balances y ex dividendo solo de lo que seguís, con el movimiento de las opciones', async () => {
      const { e } = mundo();
      const l = agendaProxima(e, 14);
      const nvda = l.find(x => x.tipo === 'balance' && x.ticker === 'NVDA');
      si(nvda && nvda.fecha === '2026-12-09' && /±7,5%/.test(nvda.detalle) && /en cartera/.test(nvda.titulo), JSON.stringify(nvda));
      si(l.some(x => x.tipo === 'ex_dividendo' && x.ticker === 'SPY' && x.fecha === '2026-12-03'), 'ex dividendo de SPY');
      si(!l.some(x => x.ticker === 'ZZZ'), 'lo que no seguís no entra');
      si(!l.some(x => x.ticker === 'PAM'), 'un balance a 40 días no entra en 14');
      si(agendaProxima(e, 90).some(x => x.ticker === 'PAM' && /PAM · PAMP \(en cartera\)/.test(x.titulo)), 'PAMP se sigue por su ADR');
    }],
    ['Calendario: eventos fijos, feriados y cupón, en orden y sin repetir lo pasado', async () => {
      const { e } = mundo();
      const l = agendaProxima(e, 90);
      si(l.some(x => x.grupo === 'fed' && x.fecha === '2026-12-09'), 'Fed');
      si(l.some(x => x.tipo === 'feriado' && x.fecha === '2026-12-07' && /sin liquidar/.test(x.titulo)), 'puente argentino');
      si(l.some(x => x.tipo === 'feriado' && x.fecha === '2026-12-08' && x.titulo === 'Sin rueda en BYMA'), 'feriado argentino');
      si(l.some(x => x.tipo === 'feriado' && x.fecha === '2026-12-25' && x.titulo === 'Feriado en EE.UU.'), 'feriado de EE.UU.');
      si(l.some(x => x.tipo === 'cupon' && x.fecha === '2027-01-14' && x.ticker === 'ON1'), 'cupón de la ON');
      si(!l.some(x => x.tipo === 'eleccion' || x.grupo === 'msci'), 'las elecciones y MSCI quedan fuera de los 90 días');
      si(l.every(x => (x.hasta || x.fecha) >= e.hoy), 'nada pasado');
      igual(l.map(x => x.orden), [...l.map(x => x.orden)].sort(), 'ordenado');
    }],
    ['Calendario: un mes sin día confirmado entra cuando se superpone, y avisa si faltan fechas', async () => {
      const { e } = mundo({ hoy: '2027-05-25' });
      const m = agendaProxima(e, 14).find(x => x.grupo === 'msci');
      si(m && fechaCorta(m) === 'junio de 2027', JSON.stringify(m));
      si(agendaProxima(mundo({ hoy: '2027-06-20' }).e, 14).some(x => x.grupo === 'msci' && x.orden === '2027-06-20'), 'dentro del mes se ordena como de hoy');
      igual(calendarioPorVencer(mundo().e).map(x => x.hasta), ['2027-01-27'], 'a la Fed de ejemplo le quedan menos de 90 días');
    }],
    ['Calendario: es informativo, no agrega pasos ni toca reglas', async () => {
      const con = mundo().e, sin = mundo({ ajustar: x => { delete x.ext.agenda; delete x.ext.eventosFijos; } }).e;
      igual(planificador(con, con.hoy), planificador(sin, sin.hoy), 'mismo plan');
      si(agendaProxima(sin, 14).every(x => x.tipo === 'feriado' || x.tipo === 'cupon'), 'sin archivos quedan feriados y cupones');
      si(comoLoSeguis('XYZ') === 'XYZ', 'sin dato');
    }],
  ];
}

export function pruebasRonda3() {
  return [...etapa1(), ...etapa2()];
}
