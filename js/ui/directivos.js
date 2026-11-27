// Radar de directivos en pantalla: compras con puntaje, accionables aparte del resto, y ventas en grupo.
import { h, fmt } from '../util.js';
import { tabla, chip, aviso } from './comun.js';
import { botonFantasma } from './diario.js';
import { comprasPuntuadas, ventasDestacadas, umbralRadar, NOMBRE_RUTINA, NOMBRE_PARTE } from '../directivos.js';

const externo = (url, texto) => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, texto);

// El puntaje y, al tocarlo, cuánto aportó cada parte.
function puntaje(x, umbral) {
  return h('details.puntaje',
    h('summary', h('strong.num' + (x.puntaje >= umbral ? '.alto' : ''), fmt.num(x.puntaje))),
    h('ul', Object.entries(x.partes || {}).map(([k, v]) => h('li', `${NOMBRE_PARTE[k] || k}: ${v == null ? 'sin dato' : fmt.pct(v, 0)}`))));
}

// Tres columnas para que entre en el celular: el puntaje primero, que es lo que ordena.
function tablaCompras(ctx, filas, umbral) {
  return tabla([
    { titulo: 'Puntaje', celda: x => puntaje(x, umbral) },
    { titulo: 'Empresa', celda: x => [h('strong.num', x.t), h('span.empresa', x.empresa),
      h('span.marcas', x.propio ? chip(x.propio === x.t ? 'En tu cartera' : `En tu cartera (${x.propio})`, 'acento') : null, x.cedear ? chip('Hay CEDEAR', 'ok') : null, x.puntaje >= umbral && x.accionable ? chip('Señal', 'alerta') : null),
      botonFantasma(ctx, 'radar', x.t)] },
    { titulo: 'Compra', celda: x => [h('span.num', x.monto == null ? 'USD —' : fmt.usd(x.monto)),
      h('small.desglose', `${x.dueno} · ${x.cargo}`),
      h('small.desglose', [NOMBRE_RUTINA[x.rutina] || 'historia sin mirar', x.aumento == null ? '' : `tenencia ${x.aumento >= 1 ? 'nueva o duplicada' : '+' + fmt.pct(x.aumento, 0)}`, x.plan ? 'plan prefijado' : ''].filter(Boolean).join(' · ')),
      h('small.desglose', externo(x.url, `${fmt.fecha(x.fecha)} ↗`))] },
  ], filas, { clase: 'compacta.directivos-tabla' });
}

export function seccionDirectivos(ctx) {
  const e = ctx.estado, d = e.directivos;
  if (!d || (d.aviso && !(d.compras || []).length)) return d?.aviso ? h('section', h('h2', 'Compras de directivos con puntaje'), aviso(`${d.aviso}: sin eso no se pueden leer los formularios de la SEC.`, 'alerta')) : null;
  const { accionables, otras } = comprasPuntuadas(e), ventas = ventasDestacadas(e), umbral = umbralRadar(e);
  return h('section.directivos',
    h('h2', 'Compras de directivos con puntaje · últimos 30 días'),
    d.stale ? aviso('La última lectura de la SEC falló: se muestra el dato anterior.', 'alerta') : null,
    accionables.length ? tablaCompras(ctx, accionables, umbral) : h('p.nota', 'No hay compras de directivos en lo que seguís ni en empresas con CEDEAR.'),
    otras.length ? h('details.otra-forma', h('summary', `Sin CEDEAR, para mirar aparte (${otras.length})`), tablaCompras(ctx, otras, umbral)) : null,
    ventas.length ? [h('h3', 'Ventas de 3 o más directivos'),
      h('ul.lista-simple', ventas.map(v => h('li', h('strong.num', v.t + ' '), `${v.vendedores} directivos vendieron${v.monto ? ` por ${fmt.usd(v.monto)}` : ''} entre el ${fmt.fecha(v.desde)} y el ${fmt.fecha(v.hasta)}. `, externo(v.url, 'Ver un formulario ↗'))))] : null,
    h('p.nota', { style: 'margin-top:.75rem' },
      `Solo compras y ventas en el mercado, de los formularios 4 de la SEC. El puntaje (0 a 100) pondera si la compra no es de rutina, el cargo, cuánto sube su tenencia, el monto contra el tamaño de la empresa, la caída previa y cuántos compran: los pesos son criterio propio, a calibrar. Desde ${fmt.num(umbral)} puntos, lo accionable se sigue solo como cartera fantasma.${d.pendientes ? ` Quedan ${fmt.num(d.pendientes)} lecturas para la próxima actualización.` : ''}`));
}
