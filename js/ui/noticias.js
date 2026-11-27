// Noticias en pantalla: las materiales por empresa (Radar) y el aviso de la clasificación (Para saber).
import { h, fmt } from '../util.js';
import { chip } from './comun.js';
import { noticiasMateriales, avisoIA, usoIA, porReglas, NOMBRE_MATERIALIDAD } from '../noticias.js';

const A_LA_VISTA = 3;

export function enlaceFuente(x) {
  return h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer', title: x.titulo }, `${x.medio || x.fuente} ↗`);
}

function noticia(x) {
  return h('li.noticia',
    h('p.noticia-linea', chip(NOMBRE_MATERIALIDAD[x.materialidad], x.materialidad >= 3 ? 'alerta' : 'acento'), ' ', x.linea || x.titulo),
    h('p.noticia-meta', `${fmt.fecha(x.fecha.slice(0, 10))} · ${x.categoria} · `, enlaceFuente(x), porReglas(x) ? [' · ', h('span', { title: 'Clasificada sin IA, con ítems del 8-K y palabras clave' }, 'por reglas')] : null));
}

export function seccionNoticias(e) {
  const grupos = noticiasMateriales(e), uso = usoIA(e);
  const total = e.noticias?.items?.length || 0;
  const reglas = grupos.some(g => g.items.some(porReglas));
  return h('section.noticias',
    h('h2', 'Noticias importantes · últimos 30 días'),
    !e.noticias ? h('p.nota', 'Todavía no hay noticias: aparecen cuando la app publica qué seguir (al sincronizar) y corre la actualización.')
      : grupos.length ? grupos.map(g => h('div.noticias-grupo',
        h('h3', g.nombre),
        h('ul', g.items.slice(0, A_LA_VISTA).map(noticia)),
        g.items.length > A_LA_VISTA ? h('details.otra-forma', h('summary', `Ver ${g.items.length - A_LA_VISTA} más`), h('ul', g.items.slice(A_LA_VISTA).map(noticia))) : null))
        : h('p.nota', 'No hay noticias relevantes de lo que seguís.'),
    e.noticias ? h('p.nota', `Solo las de materialidad 2 o más, de ${fmt.num(total)} guardadas. Fuentes: SEC EDGAR y Google News.${reglas ? ' «Por reglas» quiere decir que no las leyó una IA.' : ''}${uso.costo_usd > 0 ? ` Costo de la IA en 30 días: USD ${fmt.num(uso.costo_usd, 3)}.` : ''}`) : null);
}

// Una línea en "Para saber" si la última corrida terminó sin ningún modelo de IA.
export function lineaIA(e) {
  const a = avisoIA(e);
  return a ? h('li.linea-contexto', h('span.punto.alerta', { 'aria-hidden': 'true' }), h('span', a.texto)) : null;
}
