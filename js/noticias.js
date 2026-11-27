// Noticias materiales de lo que seguís y avisos de la clasificación. Puro e informativo.
import { fechas, fmt } from './util.js';
import { seguidosPorSubyacente, comoLoSeguis } from './calendario.js';

export const MINIMO_MATERIAL = 2;
export const NOMBRE_MATERIALIDAD = ['Ruido', 'Informativa', 'Relevante', 'Muy importante'];
const PRIORIDAD = { cartera: 0, watchlist: 1, fantasma: 2 };

// ¿La clasificó un modelo o el filtro por reglas?
export const porReglas = x => !x.por || x.por.proveedor === 'reglas';

// Noticias de materialidad `minimo` o más de los últimos `dias` días, agrupadas por empresa:
// [{ ticker, nombre, en, items }] — primero lo que tenés en cartera y, dentro de cada lista, lo más nuevo.
export function noticiasMateriales(e, { minimo = MINIMO_MATERIAL, dias = 30, hoy = e.hoy } = {}) {
  const seguidos = seguidosPorSubyacente(e), desde = fechas.sumar(hoy, -dias), grupos = new Map();
  for (const x of e.noticias?.items || []) {
    const s = seguidos.get(x.t);
    if (!s || !(x.materialidad >= minimo) || x.fecha.slice(0, 10) < desde) continue;
    if (!grupos.has(x.t)) grupos.set(x.t, { ticker: x.t, nombre: comoLoSeguis(x.t, s), en: s.en, items: [] });
    grupos.get(x.t).items.push(x);
  }
  const lista = [...grupos.values()];
  for (const g of lista) g.items.sort((a, b) => b.materialidad - a.materialidad || (a.fecha < b.fecha ? 1 : -1));
  const rango = g => Math.min(...g.en.map(x => PRIORIDAD[x] ?? 3), 3), ultima = g => g.items.map(x => x.fecha).sort().at(-1);
  return lista.sort((a, b) => rango(a) - rango(b) || (ultima(a) < ultima(b) ? 1 : ultima(a) > ultima(b) ? -1 : a.ticker.localeCompare(b.ticker)));
}

const MOTIVOS = {
  429: 'límite de uso', 500: 'error del servicio', 503: 'servicio sobrecargado', tiempo: 'tiempo agotado', json: 'respuesta que no se pudo leer',
  inexistente: 'el modelo no existe', red: 'sin conexión', rechazo: 'el modelo se negó', 401: 'clave rechazada', 403: 'clave sin permiso', sin_sdk: 'falta la biblioteca',
};

// La última corrida del Action: null si anduvo; si terminó sin ningún modelo de IA, el motivo en palabras.
export function avisoIA(e) {
  const c = e.ia_uso?.corridas?.filter(x => x.tarea !== 'resumen').at(-1);
  if (!c?.sin_ia) return null;
  const errores = [...new Set(Object.values(c.modelos || {}).flatMap(m => Object.keys(m.errores || {})))];
  const motivo = [...(c.avisos || []), errores.map(x => MOTIVOS[x] || `error ${x}`).join(', ')].filter(Boolean).join('; ') || 'no respondió ningún modelo';
  return { fecha: c.fecha, texto: `Las noticias del ${fmt.fecha(c.fecha.slice(0, 10))} se clasificaron sin IA, con el filtro por reglas. Motivo: ${motivo}.` };
}

// Uso de la API en los últimos `dias` días: corridas, noticias clasificadas y costo anotado.
export function usoIA(e, dias = 30, hoy = e.hoy) {
  const desde = fechas.sumar(hoy, -dias), corridas = (e.ia_uso?.corridas || []).filter(c => c.fecha.slice(0, 10) >= desde);
  const modelos = {};
  for (const c of corridas) for (const [n, m] of Object.entries(c.modelos || {})) {
    const x = modelos[n] = modelos[n] || { modelo: n, pedidos: 0, ok: 0, errores: 0, tokens_entrada: 0, tokens_salida: 0, costo_usd: 0 };
    x.pedidos += m.pedidos; x.ok += m.ok; x.errores += Object.values(m.errores || {}).reduce((a, b) => a + b, 0);
    x.tokens_entrada += m.tokens_entrada; x.tokens_salida += m.tokens_salida; x.costo_usd += m.costo_usd || 0;
  }
  return { corridas: corridas.length, clasificadas: corridas.reduce((a, c) => a + (c.con_ia || 0), 0), costo_usd: corridas.reduce((a, c) => a + (c.costo_usd || 0), 0), modelos: Object.values(modelos) };
}
