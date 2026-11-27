// Radar de directivos: compras con puntaje (calculado por el Action), cuáles son accionables para vos y cuáles
// pasan a ser carteras fantasma. Puro e informativo: nunca genera órdenes ni tareas.
import { fechas } from './util.js';
import { tickersPropios } from './estado.js';
import { supuestos } from './supuestos.js';
import { DIAS_ENTRE_SENALES } from './diario.js';

export const VENTANA_DIAS = 30;
export const NOMBRE_RUTINA = { oportunista: 'oportunista', rutinaria: 'rutinaria', sin_historia: 'sin historia de 3 años' };
export const NOMBRE_PARTE = { oportunista: 'No es de rutina', cargo: 'Cargo', tenencia: 'Cuánto sube su tenencia', tamano: 'Monto contra el tamaño', caida: 'Caída previa', cantidad: 'Cuántos compran' };

export const umbralRadar = e => supuestos(e).radar_directivos?.umbral ?? e.directivos?.umbral ?? 60;

// Subyacentes de EE.UU. que tienen CEDEAR.
const conCedear = e => new Set(Object.entries(e.ratios || {}).map(([t, i]) => ('usa' in i ? i.usa : t)).filter(Boolean));

// Las compras de los últimos 30 días, con lo que sabe el tablero ahora: { accionables, otras }, por puntaje.
export function comprasPuntuadas(e, hoy = e.hoy) {
  const mios = tickersPropios(e.posiciones), cedears = conCedear(e), desde = fechas.sumar(hoy, -VENTANA_DIAS);
  const lista = (e.directivos?.compras || []).filter(x => x.fecha >= desde).map(x => {
    const propio = mios.get(x.t) || null, cedear = cedears.has(x.t);
    return { ...x, propio, cedear, accionable: !!propio || cedear };
  }).sort((a, b) => b.puntaje - a.puntaje || (a.fecha < b.fecha ? 1 : -1) || a.t.localeCompare(b.t));
  return { accionables: lista.filter(x => x.accionable), otras: lista.filter(x => !x.accionable) };
}

// Ventas de 3 o más directivos de la misma empresa en la ventana.
export const ventasDestacadas = (e, hoy = e.hoy) => (e.directivos?.ventas || []).filter(v => v.destacar && v.hasta >= fechas.sumar(hoy, -VENTANA_DIAS));

// Una señal por empresa: su mejor compra accionable que llega al umbral.
export function senalesRadar(e, hoy = e.hoy) {
  const umbral = umbralRadar(e), por = new Map();
  for (const x of comprasPuntuadas(e, hoy).accionables) if (x.puntaje >= umbral && !por.has(x.t)) por.set(x.t, x);
  return [...por.values()];
}

// Eventos para seguir como fantasma las señales que el tablero ve por primera vez (una por empresa cada 90 días).
export function eventosSenales(e, hoy = e.hoy) {
  const vistas = e.datos.senales_radar || {};
  return senalesRadar(e, hoy).filter(x => !vistas[x.t] || Math.abs(fechas.dias(vistas[x.t], hoy)) >= DIAS_ENTRE_SENALES)
    .map(x => ({ tipo: 'fantasma', origen: 'radar', ticker: x.t, fecha: hoy, senal: x.id, puntaje: x.puntaje }));
}
