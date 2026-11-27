// Pruebas públicas de la ronda 3 (sin datos privados). Corren junto con js/pruebas_publicas.js.
import { aplicarEventos } from './estado.js';
import { tickersASeguir, seguimiento, subyacenteUsa } from './seguimiento.js';
import { publicarSeguimiento } from './sync.js';
import { cerca, igual, si, mundo } from './pruebas_ronda2.js';

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

export function pruebasRonda3() {
  return [...etapa1()];
}
