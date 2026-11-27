// "Desde la última vez": el resumen del sábado en Hoy, hasta que lo marcás leído. Informativo.
import { h, fmt, fechas } from '../util.js';
import { boton } from './comun.js';

export const DIAS_VIGENTE = 14;

// El resumen publicado, si es reciente y todavía no lo marcaste leído.
export function resumenSinLeer(e) {
  const r = e.resumen;
  if (!r?.id || !r.secciones || fechas.dias(r.id, e.hoy) > DIAS_VIGENTE) return null;
  return !e.datos.resumen_leido || r.id > e.datos.resumen_leido ? r : null;
}

const lista = l => h('ul.lista-simple', (l || []).map(x => h('li', x)));

export function seccionResumen(ctx) {
  const r = resumenSinLeer(ctx.estado);
  if (!r) return null;
  const s = r.secciones;
  return h('section.resumen-semana', { 'aria-label': 'Desde la última vez' },
    h('h2.sub', 'Desde la última vez'),
    h('p.nota', `Resumen del sábado ${fmt.fecha(r.id)}.`),
    h('h3', 'Tu cartera'), lista(s.cartera),
    h('h3', 'Señales explícitas'), lista(s.senales),
    h('p.resumen-contexto', s.contexto),
    (r.avisos || []).map(a => h('p.nota', a)),
    h('p.nota', r.por === 'plantilla' ? 'Armado con plantillas, sin IA, a partir de los datos públicos del tablero.' : `Redactado por ${r.por} con los datos públicos del tablero; los números se controlan contra esos datos.`),
    h('div.acciones.izq', boton('Marcar como leído', () => ctx.registrar({ tipo: 'resumen_leido', resumen: r.id, fecha: ctx.estado.hoy }), 'chico')));
}
