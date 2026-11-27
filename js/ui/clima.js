// Clima de mercado en pantalla: la línea de "Para saber" y, en el Trimestral, cada indicador con su historia.
import { h, fmt } from '../util.js';
import { climaMercado, textoClima, aporteExtra, caidaNucleo, ajustesAporteExtra } from '../clima.js';
import { linea } from './argentina.js';
import { chip, boton, cargarScript, CDN, coloresSeries } from './comun.js';

const CHIP = { tranquilo: 'ok', atento: 'alerta', tenso: 'mal' };
const nombre = l => l ? l[0].toUpperCase() + l.slice(1) : 'Sin dato';

export function lineaClima(e) {
  const c = climaMercado(e);
  return c.lectura ? linea({ color: CHIP[c.lectura], texto: textoClima(c), destino: '#informes/trimestral' }) : null;
}
export function lineaAporteExtra(e) {
  const a = aporteExtra(e);
  return a ? linea({ color: 'acento', texto: a.texto, destino: '#aportar', extra: 'Es una sugerencia que activaste vos en Configuración: no es un paso pendiente.' }) : null;
}

// Un gráfico chico por indicador, con sus dos umbrales como líneas punteadas.
function grafico(i) {
  if (!i.historia || i.historia.fechas.length < 3) return h('p.nota', 'Todavía no hay historia.');
  const lienzo = h('canvas', { role: 'img', 'aria-label': `Historia de ${i.nombre}` });
  const { fechas: fs, valores } = i.historia;
  cargarScript(CDN.chart).then(() => {
    if (!lienzo.isConnected) return;
    const c = coloresSeries(), cs = getComputedStyle(document.documentElement);
    const umbral = (clave, variable) => i.umbrales?.[clave] == null ? null : {
      label: `${clave} desde ${i.formato(i.umbrales[clave])}`, data: fs.map(() => i.umbrales[clave]), borderColor: cs.getPropertyValue(variable).trim(), borderWidth: 1, borderDash: [4, 4], pointRadius: 0, pointHoverRadius: 0,
    };
    new Chart(lienzo, {
      type: 'line',
      data: { labels: fs.map(f => `${f.slice(5, 7)}/${f.slice(2, 4)}`), datasets: [{ label: i.nombre, data: valores, borderColor: c.series[0], backgroundColor: c.series[0], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4, tension: 0 }, umbral('atento', '--alerta'), umbral('tenso', '--mal')].filter(Boolean) },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: x => fmt.fecha(fs[x[0].dataIndex]), label: x => x.datasetIndex ? ` ${x.dataset.label}` : ` ${i.formato(x.parsed.y)}` }, bodyFont: { family: c.num } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: c.tinta2, maxTicksLimit: 5, font: { family: c.num, size: 10 } }, border: { color: c.linea } },
          y: { grid: { color: c.linea }, ticks: { color: c.tinta2, maxTicksLimit: 5, font: { family: c.num, size: 10 }, callback: v => i.id === 'spy_promedio' ? fmt.num(v * 100, 0) + '%' : fmt.num(v, Number.isInteger(v) ? 0 : 1) }, border: { display: false } },
        },
      },
    });
  }).catch(() => {});
  return h('div.grafico.chico', lienzo);
}

export function seccionClima(ctx) {
  const e = ctx.estado, c = climaMercado(e), n = caidaNucleo(e), ax = ajustesAporteExtra(e);
  return h('section', h('h2', 'Clima de mercado'),
    h('div.clima-grilla', c.indicadores.map(i => h('figure.clima-item',
      h('figcaption',
        h('p', h('strong', i.nombre), ' ', chip(nombre(i.lectura), CHIP[i.lectura] || 'neutro')),
        h('p.clima-valor', i.texto, h('span.desglose', `${i.fecha ? `al ${fmt.fecha(i.fecha)}` : 'sin dato'}${i.viejo ? ' · sin actualizar' : ''}`)),
        h('p.nota', `${i.detalle[0].toUpperCase()}${i.detalle.slice(1)}.${i.umbrales ? ` Atento desde ${i.formato(i.umbrales.atento)}; tenso desde ${i.formato(i.umbrales.tenso)}.` : ''}`)),
      grafico(i)))),
    n ? h('p.nota', `El núcleo (en dólares de EE.UU.) está ${fmt.pct(n.caida)} debajo de su máximo del ${fmt.fecha(n.desde)}. ${ax.activo ? `El aviso de aporte extra está activado: aparece desde una caída de ${fmt.pct(ax.caida, 0)} si la reserva tiene excedente.` : 'El aviso de aporte extra está apagado.'}`) : null,
    h('p.nota', 'Es contexto: no cambia reglas ni pasos. Las lecturas salen de umbrales que son supuestos (⋯ → Supuestos). Fuentes: FRED (Reserva Federal de St. Louis) y Yahoo Finance.'),
    h('div.acciones.izq.no-imprimir', { style: 'margin-top:.6rem' }, boton('Configurar el aporte extra', () => ctx.menu('configuracion'), 'chico')));
}
