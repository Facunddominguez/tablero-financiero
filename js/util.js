// Fechas (siempre 'AAAA-MM-DD', sin zonas horarias), formato es-AR y un ayudante mínimo de DOM.

const DIA = 86400000;
const aUTC = s => { const [a, m, d] = s.slice(0, 10).split('-').map(Number); return Date.UTC(a, m - 1, d); };
const deUTC = t => new Date(t).toISOString().slice(0, 10);

export const fechas = {
  hoy() { const d = new Date(); return deUTC(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); },
  dias: (desde, hasta) => Math.round((aUTC(hasta) - aUTC(desde)) / DIA),
  sumar: (f, n) => deUTC(aUTC(f) + n * DIA),
  mes: f => f.slice(0, 7),
  anio: f => +f.slice(0, 4),
  nMes: f => +f.slice(5, 7),
  nDia: f => +f.slice(8, 10),
  // día N del mes de f (acotado al largo del mes)
  diaDelMes(f, n) {
    const a = +f.slice(0, 4), m = +f.slice(5, 7);
    const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
    return deUTC(Date.UTC(a, m - 1, Math.min(n, ultimo)));
  },
  sumarMeses(f, n) {
    const a = +f.slice(0, 4), m = +f.slice(5, 7), d = +f.slice(8, 10);
    const base = new Date(Date.UTC(a, m - 1 + n, 1));
    const ultimo = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
    return deUTC(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), Math.min(d, ultimo)));
  },
};

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nf = (min, max) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: 'always' });
const cache = {};
const N = (min, max) => cache[min + '_' + max] || (cache[min + '_' + max] = nf(min, max));
const ok = n => typeof n === 'number' && isFinite(n);

export const fmt = {
  num: (n, dec = 0) => ok(n) ? N(dec, dec).format(n).replace('-', '−') : '—',
  usd: (n, dec = 0) => ok(n) ? 'USD ' + fmt.num(n, dec) : '—',
  ars: (n, dec = 0) => ok(n) ? '$ ' + fmt.num(n, dec) : '—',
  cant: n => ok(n) ? N(0, Number.isInteger(n) ? 0 : 2).format(n) : '—',
  pct: (x, dec = 1) => ok(x) ? fmt.num(x * 100, dec) + '%' : '—',
  signo: (n, dec = 0) => ok(n) ? (n > 0 ? '+' : '') + fmt.num(n, dec) : '—',
  usdSigno: (n, dec = 0) => ok(n) ? (n > 0 ? '+' : n < 0 ? '−' : '') + 'USD ' + fmt.num(Math.abs(n), dec) : '—',
  pctSigno: (x, dec = 1) => ok(x) ? (x > 0 ? '+' : '') + fmt.num(x * 100, dec) + '%' : '—',
  pp: (x, dec = 1) => ok(x) ? (x > 0 ? '+' : '') + fmt.num(x * 100, dec) + ' pp' : '—',
  fecha: f => f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '—',
  fechaLarga: f => f ? `${+f.slice(8, 10)} de ${MESES[+f.slice(5, 7) - 1]}` : '—',
  mes: f => f ? `${MESES[+f.slice(5, 7) - 1]} de ${f.slice(0, 4)}` : '—',
  hace(iso, ahora = Date.now()) {
    if (!iso) return 'sin fecha';
    const min = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60000));
    if (min < 2) return 'recién';
    if (min < 90) return `hace ${min} min`;
    const hs = Math.round(min / 60);
    if (hs < 36) return `hace ${hs} h`;
    return `hace ${Math.round(hs / 24)} días`;
  },
};

// Acepta "1.234,56", "1234.56" o "1234,56".
export function aNumero(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/[^\d.,\-]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  return Number(s);
}

// h('div.clase', {onclick}, hijo, 'texto', [hijos]) → nodo. Nunca interpreta HTML: los datos externos entran como texto.
export function h(sel, ...resto) {
  const [tag, ...clases] = sel.split('.');
  const el = document.createElement(tag || 'div');
  if (clases.length) el.className = clases.join(' ');
  for (const r of resto.flat(Infinity)) {
    if (r == null || r === false) continue;
    if (r instanceof Node) el.append(r);
    else if (typeof r === 'object') {
      for (const [k, v] of Object.entries(r)) {
        if (v == null || v === false) continue;
        if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'open' || k === 'selected') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    } else el.append(String(r));
  }
  return el;
}

export const suma = (arr, fn = x => x) => arr.reduce((a, x) => a + (fn(x) || 0), 0);
export const clon = o => JSON.parse(JSON.stringify(o));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
