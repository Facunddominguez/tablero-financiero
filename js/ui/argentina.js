// Argentina en pantalla: la línea del semáforo en Hoy y, en el Trimestral, semáforo, reserva en pesos y elecciones.
import { h, fmt } from '../util.js';
import { semaforoArgentina, textoSemaforo, eleccion, reservaEnPesos } from '../argentina.js';
import { tabla, chip, aviso } from './comun.js';

export const CHIP_COLOR = { verde: 'ok', amarillo: 'alerta', rojo: 'mal' };
const nombreColor = c => c ? c[0].toUpperCase() + c.slice(1) : 'Sin dato';
const sec = (titulo, ...c) => h('section', h('h2', titulo), c);

// Una línea de "Para saber": un punto de color (siempre con su nombre), el texto y a dónde ir.
export function linea({ color, texto, destino, extra }) {
  return h('li.linea-contexto',
    h('span.punto.' + (color ? CHIP_COLOR[color] || color : 'neutro'), { 'aria-hidden': 'true' }),
    h('div', h('p', texto, destino ? [' ', h('a', { href: destino }, 'Ver →')] : null), extra ? h('p.nota', extra) : null));
}

export function lineaSemaforo(e) {
  if (!e.argentina && !e.mercado) return null;
  const s = semaforoArgentina(e);
  return s.color ? linea({ color: s.color, texto: textoSemaforo(s), destino: '#informes/trimestral', extra: s.sugerencia }) : null;
}

function seccionSemaforo(e) {
  const s = semaforoArgentina(e);
  return sec('Semáforo argentino',
    s.color ? h('p', chip(nombreColor(s.color), CHIP_COLOR[s.color]), ' ', textoSemaforo(s)) : h('p.nota', textoSemaforo(s)),
    s.sugerencia ? aviso(s.sugerencia, 'alerta') : null,
    h('div.tabla-periodo.tabla-hitos', tabla([
      { titulo: 'Indicador', celda: i => [h('strong', i.nombre), h('span.desglose', i.detalle)] },
      { titulo: 'Hoy', num: 1, celda: i => i.texto },
      { titulo: 'Umbrales', celda: i => h('span.desglose', i.umbrales.split(' · ').map(t => h('span', t))) },
      { titulo: 'Color', celda: i => [chip(nombreColor(i.color), CHIP_COLOR[i.color] || 'neutro'), i.viejo ? h('span.desglose', 'sin actualizar') : null] },
    ], s.indicadores)),
    h('p.nota', { style: 'margin-top:.6rem' }, 'El semáforo toma el peor de los cuatro. Es informativo: no cambia reglas ni pasos. Los umbrales son supuestos y se cambian en ⋯ → Supuestos.'));
}

function seccionReserva(e) {
  const r = reservaEnPesos(e);
  if (!r?.filas.length) return sec('Reserva en pesos contra dólares', h('p.nota', 'Todavía no hay datos: aparecen cuando se actualicen el dólar MEP, la tasa de plazo fijo y las cuotapartes.'));
  const hayPesos = r.filas.some(f => f.pesos != null), pc = x => x == null ? '—' : fmt.pctSigno(x, 1);
  const filas = r.filas.slice().reverse();
  return sec('Reserva en pesos contra dólares',
    h('p', `Cada mes: cuánto tenía que subir el dólar MEP para que ${r.fondos_usd.length ? `tu fondo en dólares (${r.fondos_usd.join(', ')})` : `un fondo en dólares al ${fmt.pct(r.usd_supuesto)} anual`} rindiera más que los pesos a la tasa de plazo fijo, y cuánto subió.`),
    h('div.tabla-periodo.tabla-hitos', tabla([
      { titulo: 'Mes', celda: f => [h('strong', fmt.mesCorto(f.hasta)), f.parcial ? h('span.desglose', `hasta el ${fmt.fecha(f.hasta)}`) : null] },
      { titulo: 'Tenía que subir', num: 1, celda: f => [pc(f.necesaria), h('span.desglose', h('span', `tasa ${fmt.pct(f.tasa)}`), h('span', `US$ ${pc(f.usd)}${f.usd_real ? '' : '*'}`))] },
      { titulo: 'MEP subió', num: 1, celda: f => pc(f.mep) },
      hayPesos ? { titulo: 'Tus pesos', num: 1, celda: f => f.pesos == null ? '—' : [pc(f.pesos), h('span.desglose', h('span', `US$ ${pc(f.pesos_en_usd)}`))] } : null,
      { titulo: 'Rindió más', celda: f => f.gano === 'pesos' ? chip('Pesos', 'acento') : chip('Dólares', 'neutro') },
    ].filter(Boolean), filas)),
    h('p.nota', { style: 'margin-top:.6rem' }, `"US$" es cuánto fue en dólares. ${r.filas.some(f => !f.usd_real) ? `Con * no hay cuotapartes del fondo en dólares: se usa el supuesto. ` : ''}${hayPesos ? `"Tus pesos" es lo que rindió ${r.fondos_pesos.join(', ')} en pesos; "Rindió más" compara eso, pasado a dólares, contra el fondo en dólares.` : 'No tenés fondos en pesos con historia: "Rindió más" compara la tasa de plazo fijo.'} La tasa es la que había al empezar cada mes. Entre dos valores conocidos, la cuotaparte se estima pareja. Es lo que ya pasó, no lo que va a pasar.`));
}

function seccionElecciones(e) {
  const el = eleccion(e);
  const activos = el.mercados.filter(m => m.activo);
  const pc = x => x == null ? '—' : fmt.pct(x, 0);
  return sec('Elecciones presidenciales 2027',
    h('p', el.dias > 0 ? `Faltan ${fmt.num(el.dias)} días para el ${fmt.fecha(el.fecha)}.` : `La elección fue el ${fmt.fecha(el.fecha)}.`),
    activos.length ? [
      el.difieren.length ? aviso(`Los mercados difieren más de ${fmt.num(el.tope * 100, 0)} puntos en ${el.difieren.map(c => c.nombre).join(', ')}.`) : null,
      h('div.tabla-periodo.tabla-hitos', tabla([
        { titulo: 'Candidato', celda: c => [h('strong', c.nombre), c.difiere ? h('span.desglose', `difieren ${fmt.num(c.diferencia * 100, 0)} puntos`) : null] },
        { titulo: 'Combinada', num: 1, celda: c => h('strong.num', pc(c.combinada)) },
        ...activos.map(m => ({ titulo: m.nombre, num: 1, celda: c => c.en[m.id] ? [pc(c.en[m.id].prob), h('span.desglose', `vol. ${fmt.num(c.en[m.id].volumen)}`)] : '—' })),
      ], el.candidatos)),
    ] : h('p.nota', 'Todavía no hay datos de los mercados: aparecen cuando se actualicen los precios.'),
    h('ul.lista-simple.supuestos', el.mercados.map(m => h('li',
      m.desactivado ? `${m.nombre}: apagado. Está bloqueado en Argentina por orden judicial.`
        : m.activo ? [h('a', { href: m.url, target: '_blank', rel: 'noopener noreferrer' }, m.nombre), `: volumen en ${m.unidad || 'su unidad'}${m.actualizado ? `, al ${fmt.fecha(m.actualizado.slice(0, 10))}` : ''}${m.viejo ? ' (sin actualizar)' : ''}.`]
          : `${m.nombre}: sin datos.`))),
    h('p.nota', { style: 'margin-top:.6rem' }, `El tablero solo lee las probabilidades de mercados donde se juega dinero real: no apuesta, no opera y no recomienda a nadie. "Combinada" pondera cada mercado por su volumen${activos.length < 2 ? ' (hoy hay uno solo)' : ''}. Son precios de contratos, no encuestas, y no tienen por qué sumar 100%.`));
}

export const seccionesArgentina = e => [seccionSemaforo(e), seccionReserva(e), seccionElecciones(e)];
