// Informes → Proyección: cuándo se cumplen las reglas, cuánto podría valer el patrimonio y los objetivos con fecha.
import { h, fmt, fechas, aNumero, uid } from '../util.js';
import { simular, textoHito } from '../simulacion.js';
import { supuestos, EDITABLES } from '../supuestos.js';
import { dialogo, campo, entrada, boton, tabla, aviso, chip, cargarScript, CDN, coloresSeries } from './comun.js';

const sec = (titulo, ...c) => h('section', h('h2', titulo), c);
const mes = f => f ? fmt.mesCorto(f) : '—';

function tablaHitos(sim) {
  const filas = Object.values(sim.hitos);
  const lejos = `más de ${Math.round(sim.horizonte / 12)} años`;
  const fecha = (x, k) => x.cumplida ? '—' : x[k] ? mes(x[k]) : lejos;
  return [
    h('div.tabla-periodo.tabla-hitos', tabla([
      { titulo: 'Meta', celda: x => [h('strong.num', x.regla), h('span.desglose', x.meta), x.cumplida ? h('div', chip('Ya se cumple', 'ok')) : null] },
      { titulo: '1 de 10', num: 1, celda: x => fecha(x, 'f10') },
      { titulo: 'La mitad', num: 1, celda: x => fecha(x, 'f50') },
      { titulo: '9 de 10', num: 1, celda: x => fecha(x, 'f90') },
      { titulo: 'Chance en 12 y 24 meses', num: 1, celda: x => x.cumplida ? '—' : `${fmt.pct(x.en12, 0)} · ${fmt.pct(x.en24, 0)}` },
    ], filas)),
    h('p.nota', { style: 'margin-top:.6rem' }, `Sin vender nada, solo con aportes de ${fmt.usd(sim.aporte)} por mes al núcleo. Las tres fechas dicen para cuándo ya se logró en 1, en la mitad y en 9 de cada 10 caminos; la última columna, la chance de lograrlo (al menos una vez) antes de cada plazo.`),
  ];
}

function abanico(sim) {
  const lienzo = h('canvas', { role: 'img', 'aria-label': 'Patrimonio a cinco años: escenario del medio y franja entre el 10 y el 90 por ciento' });
  cargarScript(CDN.chart).then(() => {
    if (!lienzo.isConnected) return;
    const c = coloresSeries(), banda = c.series[0] + '2e';
    const linea = (label, data, extra) => ({ label, data, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0, ...extra });
    new Chart(lienzo, {
      type: 'line',
      data: { labels: sim.abanico.map(p => `${p.fecha.slice(5, 7)}/${p.fecha.slice(2, 4)}`), datasets: [
        linea('9 de cada 10 quedan abajo', sim.abanico.map(p => p.p90), { borderWidth: 0, backgroundColor: banda, borderColor: banda, fill: '+1' }),
        linea('1 de cada 10 queda abajo', sim.abanico.map(p => p.p10), { borderWidth: 0, backgroundColor: banda, borderColor: banda, fill: false }),
        linea('El del medio', sim.abanico.map(p => p.p50), { borderColor: c.series[0], backgroundColor: c.series[0] }),
        linea('Si los precios no cambian', sim.abanico.map(p => p.aportado), { borderColor: c.tinta2, backgroundColor: c.tinta2, borderDash: [5, 4], borderWidth: 1.5 }),
      ] },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => ` ${x.dataset.label}: ${fmt.usd(x.parsed.y)}` }, bodyFont: { family: c.num } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: c.tinta2, maxTicksLimit: 6, font: { family: c.num, size: 11 } }, border: { color: c.linea } },
          y: { grid: { color: c.linea }, ticks: { color: c.tinta2, font: { family: c.num, size: 11 }, callback: v => fmt.num(v) }, border: { display: false } },
        },
      },
    });
  }).catch(() => {});
  return [
    h('div.leyenda-linea',
      h('span', h('i', { style: 'background:var(--serie-1)' }), 'El del medio'),
      h('span', h('i.franja'), '8 de cada 10 caminos'),
      h('span', h('i.punteada'), 'Si los precios no cambian')),
    h('div.grafico', lienzo),
  ];
}

function tablaPatrimonio(e, sim) {
  return tabla([
    { titulo: 'Dentro de', celda: a => [h('strong', `${a.anios} ${a.anios === 1 ? 'año' : 'años'}`), h('span.desglose', mes(a.fecha))] },
    { titulo: 'Mal (1 de 10)', num: 1, celda: a => fmt.num(a.p10) },
    { titulo: 'Del medio', num: 1, celda: a => fmt.num(a.p50) },
    { titulo: 'Bien (9 de 10)', num: 1, celda: a => fmt.num(a.p90) },
    { titulo: 'Sin cambios de precio', num: 1, celda: a => fmt.num(a.aportado) },
  ], sim.anios);
}

// ---------- objetivos con fecha ----------
export function dialogoObjetivo(ctx, o = null) {
  const e = ctx.estado;
  const fNombre = entrada({ inputmode: 'text', value: o?.nombre || '', placeholder: 'Ej.: Anticipo de un departamento' });
  const fMonto = entrada({ value: o ? fmt.num(o.monto_usd) : '', placeholder: '30.000' });
  const fFecha = entrada({ type: 'date', inputmode: null, value: o?.fecha || fechas.sumarMeses(e.hoy, 36), min: fechas.sumar(e.hoy, 1) });
  const error = h('p.error', { role: 'alert' });
  const d = dialogo(o ? 'Editar el objetivo' : 'Nuevo objetivo con fecha', h('form.formulario', {
    onsubmit: async ev => {
      ev.preventDefault();
      const monto = aNumero(fMonto.value), nombre = fNombre.value.trim();
      if (!nombre || !(monto > 0) || !(fFecha.value > e.hoy)) { error.textContent = 'Completá el nombre, un monto y una fecha futura.'; return; }
      await ctx.registrar({ tipo: 'objetivo', objetivo_id: o?.id || uid(), nombre, monto_usd: monto, fecha: fFecha.value },
        { tipo: 'decision', fecha: e.hoy, texto: `Objetivo ${nombre}: ${fmt.usd(monto)} para ${fmt.mes(fFecha.value)}` });
      d.close();
    },
  },
    h('p.nota', 'Se mide contra tu patrimonio total (cartera y reserva), con los mismos aportes de la proyección.'),
    campo('Nombre', fNombre), h('div.fila-campos', campo('Patrimonio que querés tener (USD)', fMonto), campo('Para cuándo', fFecha)), error,
    h('div.acciones', boton('Cancelar', () => d.close(), 'fantasma'), h('button.boton.primario', { type: 'submit' }, 'Guardar'))), { ancho: '30rem' });
  return d;
}

function seccionObjetivos(ctx, sim) {
  const enlace = (t, fn) => h('button.enlace.accion-fila', { type: 'button', onclick: fn }, t);
  const resultado = o => o.vencido ? chip('Ya pasó la fecha', 'neutro')
    : o.contra === 'aparte' ? [chip(o.llega ? 'Llegás' : 'No alcanza', o.llega ? 'ok' : 'alerta'),
      h('span.desglose', h('span', o.llega ? `juntás ${fmt.usd(o.proyectado)}` : `juntás ${fmt.usd(o.proyectado)}; hacen falta ${fmt.usd(o.por_mes)} por mes`))]
      : o.fuera ? '—' : [h('strong.num', fmt.pct(o.chance, 0)), h('span.desglose', h('span', `el del medio: ${fmt.usd(o.p50)}`))];
  return sec('Objetivos con fecha',
    sim.objetivos.length ? tabla([
      { titulo: 'Objetivo', celda: o => [h('strong', o.nombre), h('span.desglose', o.contra === 'aparte' ? 'se junta aparte' : 'contra tu patrimonio'),
        o.contra === 'patrimonio' ? h('span.acciones-fila.no-imprimir', enlace('Editar', () => dialogoObjetivo(ctx, o)), enlace('Borrar', async () => {
          if (confirm(`¿Borrar el objetivo "${o.nombre}"?`)) await ctx.registrar({ tipo: 'objetivo_borrar', ref: o.id }, { tipo: 'decision', fecha: ctx.estado.hoy, texto: `Borrado el objetivo ${o.nombre}` });
        })) : null] },
      { titulo: 'Monto', num: 1, celda: o => fmt.num(o.monto_usd) },
      { titulo: 'Fecha', num: 1, celda: o => mes(o.fecha) },
      { titulo: 'Chance', num: 1, celda: resultado },
    ], sim.objetivos) : h('p.nota', 'Todavía no hay ninguno. Cargá un monto y una fecha para ver la chance de llegar.'),
    h('div.acciones.izq.no-imprimir', { style: 'margin-top:.75rem' }, boton('Agregar un objetivo', () => dialogoObjetivo(ctx), 'chico')));
}

// ---------- supuestos a la vista ----------
function seccionSupuestos(ctx, sim) {
  const s = supuestos(ctx.estado), m = sim.modelo;
  const grupos = EDITABLES.filter(([g]) => s[g] && ['retornos_etf', 'acciones', 'otros'].includes(g));
  const origen = { largo: 'meses desde 2005', diario: 'últimos 2 años', fija: 'supuesto' };
  return sec('Supuestos (no son pronósticos)',
    h('ul.lista-simple.supuestos', grupos.map(([g, titulo, campos]) => h('li',
      h('strong', titulo + ': '), campos.map(([k, etq]) => `${etq.replace(' (%)', '')} ${fmt.pct(s[g][k])}`).join(' · '),
      h('small', { style: 'display:block' }, `${s[g].fuente} (${fmt.fecha(s[g].fecha)})`)))),
    h('details.otra-forma', h('summary', 'Qué se le supone a cada cosa que tenés'),
      tabla([
        { titulo: '', celda: x => h('strong.num', x.ticker) },
        { titulo: 'Retorno anual', num: 1, celda: x => [fmt.pct(x.retorno), x.tipoRetorno === 'promedio' ? h('span.desglose', `beta ${fmt.num(x.beta, 2)}`) : null] },
        { titulo: 'Volatilidad anual', num: 1, celda: x => [fmt.pct(x.vol), h('span.desglose', origen[m.factores[x.factor].origen])] },
      ], m.items.filter(x => x.usd !== 0 || x.grupo === 'nucleo'))),
    h('p.nota', { style: 'margin-top:.6rem' }, 'En las acciones sueltas el retorno es el promedio de todos los caminos y sale del de SPY según su beta: con beta 1 y la volatilidad de SPY, el camino del medio es el de SPY; cuanto más se mueven, más abajo queda.Las volatilidades y cómo se mueven juntas salen de la historia; lo que no tiene historia se supone sin relación con el resto. Los cupones no se simulan aparte. Los montos son en dólares, sin descontar inflación.'),
    h('div.acciones.izq.no-imprimir', { style: 'margin-top:.6rem' }, boton('Cambiar los supuestos', () => ctx.menu('supuestos'), 'chico')));
}

export function informeProyeccion(ctx) {
  const e = ctx.estado, sim = simular(e);
  const cab = (sub, ...c) => h('article.informe', h('header.informe-cab', h('h1', 'Proyección'), h('p', sub)), c);
  if (!sim) return cab('', aviso('Faltan los supuestos (data/supuestos.json): recargá la página.', 'alerta'));
  const proximo = textoHito(sim.hitos.nucleo, sim.horizonte);
  return cab(`${fmt.num(sim.escenarios)} caminos posibles · al ${fmt.fecha(e.hoy)}`,
    h('section', h('p', proximo ? `El núcleo vuelve a su rango: ${proximo}.` : 'El núcleo ya está en su rango.'),
      h('p.nota', 'Cada camino reparte los retornos de otra manera. Sirve para ver cuánto puede variar el resultado, no para saber cuál va a pasar.')),
    sec('Cuándo se cumplen las reglas', tablaHitos(sim)),
    sec('Patrimonio en los próximos 5 años (USD)', abanico(sim), h('div.tabla-periodo', tablaPatrimonio(e, sim))),
    seccionObjetivos(ctx, sim),
    seccionSupuestos(ctx, sim));
}
