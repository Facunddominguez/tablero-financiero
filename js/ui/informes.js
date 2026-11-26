// Pantalla Informes: cinco informes de una página, imprimibles (window.print + CSS de impresión).
import { h, fmt, fechas, suma, poner } from '../util.js';
import { costosAnuales, brechaAportes, rendimientoHist, rendimientoPorBloque, historiaCartera, resumenPeriodo, benchmarks } from '../finanzas.js';
import { NOMBRE_GRUPO } from '../estado.js';
import { riesgo } from '../riesgo.js';
import { puntajePredicciones, compararFantasmas, contraReferencia, HORIZONTES } from '../diario.js';
import { nuevaPrediccion, nuevaRotacion, borrarPrediccion, editarFantasma, borrarFantasma } from './diario.js';
import { tabla, chip, aviso, boton, NIVEL, cargarScript, CDN, coloresSeries, signoClase, parteRiesgo } from './comun.js';

const INFORMES = [['mensual', 'Mensual'], ['rendimiento', 'Rendimiento'], ['trimestral', 'Trimestral'], ['diario', 'Predicciones y fantasmas'], ['anual', 'Anual para el contador'], ['allaria', 'Contraste con Allaria']];
const dato = (etq, valor, sub) => h('div', h('p.dato-etq', etq), h('p.dato-valor', valor), sub ? h('p.dato-sub', sub) : null);
const color = (n, txt) => h('span.' + (signoClase(n) || 'plano'), txt);
const hoja = (titulo, sub, ...secciones) => h('article.informe', h('header.informe-cab', h('h1', titulo), h('p', sub)), secciones);
const sec = (titulo, ...c) => h('section', h('h2', titulo), c);
const tablaReglas = reglas => tabla([
  { titulo: 'Regla', celda: r => h('strong.num', r.id) }, { titulo: 'Política', celda: r => r.politica },
  { titulo: 'Valor', num: 1, celda: r => r.valor }, { titulo: 'Estado', celda: r => chip(NIVEL[r.nivel][0], NIVEL[r.nivel][1]) },
], reglas);

// ---------- Activos y efecto canje ----------
const EXPLICA_CANJE = 'El canje es la diferencia entre el dólar contado con liqui (CCL) y el dólar bolsa (MEP). Los CEDEARs siguen al primero: si el canje sube, valen más en dólares MEP aunque la acción no se mueva.';
// La línea que explica el canje, con cuánto se movió en el período si se sabe.
function notaCanje(canje) {
  const paso = canje ? ` En este período pasó de ${fmt.pct(canje.desde)} a ${fmt.pct(canje.hasta)}.` : '';
  return h('p.nota.nota-canje', `${EXPLICA_CANJE}${paso} «Activos» es el rendimiento con el canje quieto; sumado al «Efecto canje» da el total.`);
}
const hayCanje = R => !!R.filas?.some(f => f.activos != null);
const columnasCanje = pc => [
  { titulo: 'Activos', num: 1, celda: f => pc(f.activos) },
  { titulo: 'Efecto canje', num: 1, celda: f => pc(f.efecto_canje) },
];
// Tu cartera y los benchmarks, separando activos y canje (Mensual y Trimestral).
function seccionCanje(R, titulo) {
  if (!R.filas) return null;
  if (!hayCanje(R)) return sec(titulo, h('p.nota', 'Todavía no hay datos del canje: aparecen cuando se actualicen los precios.'));
  const pc = x => x == null ? '—' : color(x, fmt.pctSigno(x, 1));
  return sec(titulo,
    h('div.tabla-periodo', tabla([{ titulo: '', celda: f => h('strong', f.nombre) }, { titulo: 'Total', num: 1, celda: f => pc(f.rend) }, ...columnasCanje(pc)], R.filas)),
    notaCanje(R.canje));
}

// ---------- Riesgo ----------
// Peso contra riesgo por bloque, un mes malo y dos escenarios. Cartera de largo plazo, sin la emergencia.
function seccionRiesgo(e) {
  const r = riesgo(e);
  if (!r) return sec('Riesgo', h('p.nota', 'Todavía no hay historia de precios para medirlo.'));
  const { peor_cada_uno: peor, crisis } = r.escenarios;
  const caida = (nombre, x) => x == null ? null : `${nombre} ${fmt.pctSigno(x, 0)}`;
  const detalle = [...Object.entries(crisis.series).filter(([k]) => k !== 'MEP').map(([k, v]) => caida(k, v)), caida('el peso contra el dólar MEP', crisis.series.MEP)].filter(Boolean).join(', ');
  return sec('Riesgo',
    tabla([
      { titulo: 'Bloque', celda: b => h('strong', b.nombre) }, { titulo: 'Peso', num: 1, celda: b => fmt.pct(b.peso) },
      { titulo: '% del riesgo', num: 1, celda: b => parteRiesgo(b.riesgo) }, { titulo: 'USD', num: 1, celda: b => fmt.num(b.usd) },
    ], r.bloques, { pie: ['Total', fmt.pct(1, 0), fmt.pct(1, 0), fmt.num(r.valor)] }),
    h('div.resumen', { style: 'margin:1rem 0' },
      dato('Un mes malo', fmt.usd(r.mes_malo_usd), `${fmt.pct(r.mes_malo_pct)}: de cada ${Math.round(1 / r.percentil)} meses, uno sería así de malo o peor`),
      dato('Peor mes de cada activo, todos juntos', fmt.usd(peor.usd), `${fmt.pct(peor.pct)} de la cartera`),
      dato('Crisis argentina', fmt.usd(crisis.usd), `${fmt.pct(crisis.pct)} · ${detalle}`)),
    h('p.nota', 'Las cifras son pérdidas posibles, no pronósticos. "Un mes malo" supone que los meses se reparten como una campana. Si un bloque tiene más riesgo que peso, mueve la cartera más de lo que parece.'),
    h('ul.lista-simple.supuestos', r.supuestos.map(s => h('li', s))));
}

// ---------- Diario ----------
// "+12,0%" arriba y, abajo, cuánto hizo la referencia y la diferencia.
const contra = (x, nombre) => x == null ? '—' : [color(x.rend, fmt.pctSigno(x.rend, 1)),
  h('span.desglose', h('span', `${nombre} ${fmt.pctSigno(x.ref, 1)}`), h('span', `diferencia ${fmt.pp(x.dif)}`))];
const pedirSeries = faltan => faltan.length ? aviso(`Sin historia de precios: ${faltan.join(', ')}. Para compararlos, sumalos a historico_extra en tools/mercado_config.json.`, 'alerta') : null;

// Cada satélite contra su referencia (Trimestral).
function seccionReferencias(e) {
  const { filas, faltan } = contraReferencia(e);
  if (!filas.length) return null;
  return sec('Satélites contra su referencia',
    tabla([
      { titulo: 'Activo', celda: f => [h('strong.num', f.ticker), h('small.desglose', `contra ${f.referencia}`)] },
      { titulo: '3 meses', num: 1, celda: f => contra(f.tres, f.referencia) },
      { titulo: '12 meses', num: 1, celda: f => contra(f.doce, f.referencia) },
      { titulo: 'Desde tu compra', num: 1, celda: f => [contra(f.compra, f.referencia), f.desde ? h('span.desglose', fmt.fecha(f.desde)) : null] },
    ], filas),
    pedirSeries(faltan),
    h('p.nota', { style: 'margin-top:.6rem' }, 'Precios en dólares de EE.UU. con dividendos, sin el canje (afecta igual a los dos). Las referencias se cambian en los datos.'));
}

const ORIGEN = { allaria: 'Allaria', radar: 'Radar', watchlist: 'Watchlist' };
function diario(ctx) {
  const e = ctx.estado, d = e.datos, p = puntajePredicciones(d.predicciones);
  const orden = (a, b) => a.vence < b.vence ? -1 : a.vence > b.vence ? 1 : 0;
  const abiertas = (d.predicciones || []).filter(x => typeof x.cumplio !== 'boolean').sort(orden);
  const cerradas = (d.predicciones || []).filter(x => typeof x.cumplio === 'boolean').sort(orden).reverse();
  const fantasmas = compararFantasmas(e);
  const enlace = (txt, fn) => h('button.enlace.accion-fila', { type: 'button', onclick: fn }, txt);
  const columnas = [
    { titulo: 'Predicción', celda: x => [x.ticker && !x.texto.includes(x.ticker) ? h('strong.num', x.ticker + ' ') : null, x.texto, h('small.desglose', `cambiaría de idea si: ${x.cambio}`),
      h('span.acciones-fila.no-imprimir', enlace('Editar', () => nuevaPrediccion(ctx, '', x)), enlace('Borrar', () => borrarPrediccion(ctx, x)))] },
    { titulo: 'Prob.', num: 1, celda: x => fmt.pct(x.probabilidad, 0) },
    { titulo: 'Vence', num: 1, celda: x => [fmt.fecha(x.vence), typeof x.cumplio !== 'boolean' && x.vence <= e.hoy ? h('div', chip('Falta marcarla', 'alerta')) : null] },
  ];
  return hoja('Predicciones y fantasmas', `al ${fmt.fecha(e.hoy)}`,
    sec('Qué tan bien predecís',
      p.resueltas ? [
        h('div.resumen',
          dato('Puntaje de Brier', fmt.num(p.brier, 3), '0 es perfecto; decir siempre 50% da 0,250'),
          dato('Resueltas', fmt.num(p.resueltas), `${p.pendientes} ${p.pendientes === 1 ? 'abierta' : 'abiertas'}`)),
        tabla([
          { titulo: 'Cuando dijiste', celda: r => `${fmt.num(r.desde * 100)} a ${fmt.num(r.hasta * 100)}%` },
          { titulo: 'Cuántas', num: 1, celda: r => fmt.num(r.cantidad) },
          { titulo: 'En promedio', num: 1, celda: r => r.esperado == null ? '—' : fmt.pct(r.esperado, 0) },
          { titulo: 'Se cumplieron', num: 1, celda: r => r.acierto == null ? '—' : fmt.pct(r.acierto, 0) },
        ], p.rangos),
        h('p.nota', { style: 'margin-top:.6rem' }, 'Estás bien calibrado cuando "Se cumplieron" se parece a "En promedio". Con pocas predicciones, todavía dice poco.'),
      ] : h('p.nota', 'Todavía no venció ninguna predicción.'),
      h('div.acciones.izq.no-imprimir', { style: 'margin-top:.75rem' }, boton('Anotar una predicción', () => nuevaPrediccion(ctx), 'chico'))),
    abiertas.length ? sec('Abiertas', tabla(columnas, abiertas)) : null,
    cerradas.length ? sec('Resueltas', tabla([...columnas, { titulo: 'Resultado', celda: x => chip(x.cumplio ? 'Se cumplió' : 'No se cumplió', x.cumplio ? 'ok' : 'mal') }], cerradas)) : null,
    sec('Carteras fantasma',
      h('p.nota', 'Lo que anotaste sin comprar, contra SPY desde esa fecha. Se anota desde Radar o al cargar una rotación de Allaria.'),
      pedirSeries(fantasmas.faltan),
      fantasmas.grupos.map(g => h('div.fantasma-grupo',
        h('h3', `${g.nombre} · ${ORIGEN[g.origen] || g.origen} · desde el ${fmt.fecha(g.fecha)}`),
        h('p.acciones-fila.no-imprimir', enlace('Editar', () => editarFantasma(ctx, g)), enlace('Borrar', () => borrarFantasma(ctx, g))),
        tabla([
          { titulo: 'Ticker', celda: f => [h('strong.num', f.ticker), g.filas.length > 1 && g.filas.includes(f) ?h('span.acciones-fila.no-imprimir', enlace('Quitar', () => borrarFantasma(ctx, g, f.ticker))) : null] },
          ...HORIZONTES.map(n => ({ titulo: `${n} ${n === 1 ? 'mes' : 'meses'}`, num: 1, celda: f => contra(f.plazos[n], 'SPY') })),
          { titulo: 'Hasta hoy', num: 1, celda: f => contra(f.hoy, 'SPY') },
        ], g.promedio ? [...g.filas, { ticker: 'Promedio', ...g.promedio }] : g.filas))),
      fantasmas.grupos.length ? null : h('p.nota', 'Todavía no hay ninguna.')));
}

// Rendimiento de la canasta núcleo (pesos fijos) entre dos fechas.
function rendNucleo(e, desde, hasta) {
  const partes = Object.entries(e.datos.nucleo.pesos_internos).map(([t, w]) => [w, rendimientoHist(e.historico, t, desde, hasta)]);
  return partes.some(([, r]) => r == null) ? null : suma(partes, ([w, r]) => w * r);
}

// ---------- Mensual ----------
function mensual(ctx) {
  const e = ctx.estado, d = e.datos, mes = fechas.mes(e.hoy), inicio = mes + '-01';
  // Mismos números que Informes → Rendimiento → "Este mes".
  const { historia, bench } = datosRendimiento(e);
  const R = resumenPeriodo(e, historia, bench, 'mes');
  const f0 = R.f0 || e.hoy;
  const rend = R.filas ? R.filas[0].rend : null, spy = R.filas?.[1]?.rend ?? null;
  const aportes = d.cashflows_externos_usd.filter(a => a.fecha > f0 && a.fecha <= e.hoy);
  const aportado = suma(aportes, a => a.usd);
  const m = d.meses?.[mes];
  const hechos = (d.decisiones || []).filter(x => fechas.mes(x.fecha) === mes);
  const tareas = ctx.plan.pasos.filter(p => !p.informativo);
  return hoja('Informe mensual', `${fmt.mes(e.hoy)} · al ${fmt.fecha(e.hoy)}`,
    h('section', h('div.resumen',
      dato('Patrimonio', fmt.usd(e.total_usd), `${fmt.ars(e.total_ars)}`),
      dato(`Desde el ${fmt.fecha(f0)}`, color(rend, fmt.pctSigno(rend, 1)), `SPY con los mismos aportes: ${spy == null ? 'sin datos' : fmt.pctSigno(spy, 1)}`),
      dato('Aportes del período', fmt.usd(aportado), aportes.length ? aportes.map(a => fmt.fecha(a.fecha)).join(', ') : 'ninguno'),
      dato('Tasa de ahorro', m ? fmt.pct((m.ingreso - m.gasto) / m.ingreso, 0) : '—', m ? `meta ${fmt.pct(d.perfil.meta_tasa_ahorro, 0)}` : 'mes sin cargar')),
      h('p.nota', `En USD, sin descontar inflación. Los aportes no cuentan como ganancia; es el mismo número que Rendimiento → "Este mes". ${f0 >= inicio ? 'Todavía no hay un dato anterior al inicio del mes: se mide desde el primero.' : ''}`)),
    seccionCanje(R, `Activos y efecto canje, desde el ${fmt.fecha(f0)}`),
    sec('Cumplimiento de reglas', tablaReglas(ctx.plan.reglas)),
    sec('Qué se hizo', hechos.length ? h('ul.lista-simple', hechos.map(x => h('li', `${fmt.fecha(x.fecha)} · ${x.texto}`))) : h('p.nota', 'Nada registrado este mes.')),
    sec('Qué sigue', tareas.length ? h('ul.lista-simple', tareas.map(p => h('li', p.titulo))) : h('p', `Todo en orden. Próxima acción: ${fmt.fecha(ctx.plan.proxima.fecha)}, ${ctx.plan.proxima.texto}.`)));
}

// ---------- Rendimiento ----------
// ---------- Período: este mes, este año o desde el inicio ----------
const PERIODOS = [['mes', 'Este mes'], ['anio', 'Este año'], ['todo', 'Desde el inicio']];

// Historia de la cartera y benchmarks con la misma plata: una sola vez por pantalla (los botones solo recortan).
function datosRendimiento(e) {
  const historia = historiaCartera(e);
  return { historia, bench: benchmarks(e, historia.flujos) };
}

function bloquePeriodo(e) {
  let per = 'todo';
  const { historia, bench } = datosRendimiento(e);
  const caja = h('div');
  const botones = PERIODOS.map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(k === per), onclick: () => {
    per = k;
    botones.forEach((b, i) => b.setAttribute('aria-pressed', String(PERIODOS[i][0] === per)));
    poner(caja, contenidoPeriodo(e, historia, bench, per));
  } }, t));
  poner(caja, contenidoPeriodo(e, historia, bench, per));
  return [h('div.conmutador.chico', { role: 'group', 'aria-label': 'Período' }, botones), caja];
}

function contenidoPeriodo(e, historia, bench, per) {
  const R = resumenPeriodo(e, historia, bench, per);
  const { puntos } = R;
  if (puntos.length < 2) return h('p.nota', { style: 'margin-top:1rem' }, 'Todavía no hay datos de este período.');
  // Si los datos empiezan dentro del período, el mes o el año muestran lo mismo que "Desde el inicio": avisarlo.
  const separa = per === 'mes' ? fechas.sumarMeses(e.hoy.slice(0, 7) + '-01', 1) : `${+e.hoy.slice(0, 4) + 1}-01-01`;
  const nombrePer = PERIODOS.find(([x]) => x === per)?.[1];
  const avisoIgual = per !== 'todo' && R.k === 0 ? h('p.nota.periodo-igual', `Tus datos empiezan el ${fmt.fecha(R.f0)}, así que por ahora "${nombrePer}" muestra lo mismo que "Desde el inicio". Se van a diferenciar desde el ${fmt.fecha(separa)}.`) : null;
  const pc = x => x == null ? '—' : color(x, fmt.pctSigno(x, 1));
  const [cartera, ...otros] = R.filas;
  const spy = otros[0];
  const dif = spy ? cartera.rend - spy.rend : null;
  // Hasta qué punto del período la línea de tu cartera es estimada (va punteada).
  const ultimoRec = puntos.reduce((m, p, i) => p.rec ? i : m, -1);
  const pctGraf = R.pct.map(serie => serie.map(x => x * 100));
  return [
    avisoIgual,
    h('div.resumen',
      dato('Tu cartera', pc(cartera.rend), `${fmt.signo(cartera.ganancia)} USD de ganancia`),
      ...otros.map(b => dato(b.nombre, pc(b.rend), `${fmt.signo(b.ganancia)} USD con los mismos aportes`)),
      dato('Aportes', fmt.usd(R.aportado), [per === 'todo' ? `desde el ${fmt.fecha(R.f0)}` : `del ${fmt.fecha(R.f0)} a hoy`, R.implicito > 0.5 ? `; ${fmt.usd(R.implicito)} estimados por compras sin aporte cargado` : ''])),
    sec(`Detalle ${per === 'todo' ? 'desde el inicio' : `desde el ${fmt.fecha(R.f0)}`}`,
      // La tabla solo aparece si suma algo a las tarjetas: activos y canje, la tasa por año (un año o más) o sin inflación.
      R.dias >= 365 || R.inflacion || hayCanje(R) ? h('div.tabla-periodo', tabla([
        { titulo: '', celda: f => h('strong', f.nombre) },
        { titulo: 'En dólares', num: 1, celda: f => pc(f.rend) },
        ...(hayCanje(R) ? columnasCanje(pc) : []),
        ...(R.dias >= 365 ? [{ titulo: 'Por año', num: 1, celda: f => pc(f.anual) }] : []),
        ...(R.inflacion ? [{ titulo: 'Descontando inflación', num: 1, celda: f => pc(f.real) }] : []),
      ], R.filas)) : null,
      hayCanje(R) ? notaCanje(R.canje) : h('p.nota', { style: 'margin-top:.6rem' }, 'Todavía no hay datos del canje: aparecen cuando se actualicen los precios.'),
      h('p.nota', { style: 'margin-top:.6rem' }, [
        dif == null ? '' : `${dif >= 0 ? 'Le ganaste' : 'Quedaste'} ${fmt.num(Math.abs(dif) * 100, 1)} puntos ${dif >= 0 ? 'a' : 'debajo de'} SPY en el período. `,
        R.inflacion
          ? `Las tarjetas, los gráficos y la columna "En dólares" no descuentan la inflación. La columna "Descontando inflación" sí: le resta la inflación de EE.UU. del período (${fmt.pctSigno(R.inflacion.valor, 1)}, según el IPC hasta ${fmt.mes(R.inflacion.hasta)}). `
          : 'En dólares MEP, sin descontar inflación: el IPC de EE.UU. de este período todavía no se publicó. ',
        'Los aportes no cuentan como ganancia; SPY y el núcleo simulan comprar CEDEARs con cada aporte, ese mismo día.',
      ])),
    sec('Evolución en USD', puntos.length < 3
      ? h('p.nota', `El gráfico aparece a partir del tercer día con datos en el período (hay ${puntos.length}).`)
      : graficoLineas(puntos, R.nombres, R.usd, { aria: 'Evolución del patrimonio contra los benchmarks', y: v => fmt.num(v), tip: v => fmt.usd(v), punteadoHasta: ultimoRec })),
    puntos.length < 3 ? null : sec('Evolución en %',
      graficoLineas(puntos, R.nombres, pctGraf, { aria: 'Rendimiento acumulado en % contra los benchmarks', y: v => fmt.num(v, 0) + '%', tip: v => fmt.pctSigno(v / 100, 1), cero: true, punteadoHasta: ultimoRec })),
  ];
}

function graficoLineas(puntos, nombres, series, op) {
  const lienzo = h('canvas', { role: 'img', 'aria-label': op.aria });
  cargarScript(CDN.chart).then(() => {
    if (!lienzo.isConnected) return;
    const c = coloresSeries();
    new Chart(lienzo, {
      type: 'line',
      data: { labels: puntos.map(p => `${p.f.slice(8, 10)}/${p.f.slice(5, 7)}/${p.f.slice(2, 4)}`), datasets: series.map((data, i) => ({ label: nombres[i], data, borderColor: c.series[i], backgroundColor: c.series[i], borderWidth: 2, pointRadius: puntos.length > 40 ? 0 : 2.5, pointHoverRadius: 5, tension: 0, ...(i === 0 && op.punteadoHasta >= 0 ? { segment: { borderDash: g => g.p1DataIndex <= op.punteadoHasta ? [5, 4] : undefined } } : {}) })) },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => ` ${x.dataset.label}: ${op.tip(x.parsed.y)}` }, bodyFont: { family: c.num } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: c.tinta2, maxTicksLimit: 6, font: { family: c.num, size: 11 } }, border: { color: c.linea } },
          y: { grid: { color: op.cero ? (g => g.tick.value === 0 ? c.tinta2 : c.linea) : c.linea }, ticks: { color: c.tinta2, font: { family: c.num, size: 11 }, callback: op.y }, border: { display: false } },
        },
      },
    });
  }).catch(() => {});
  return [h('div.leyenda-linea', nombres.map((n, i) => h('span', h('i', { style: `background:var(--serie-${i + 1})` }), n)),
    op.punteadoHasta >= 0 ? h('span', h('i.punteada'), 'estimado') : null), h('div.grafico', lienzo)];
}
// Aviso cuando la historia estimada no cierra con el primer valor real: qué pasa, qué hacer y qué afecta.
function avisoCierre(ctx, cierre, desfase) {
  const f = fmt.fecha(cierre.fecha), dif = fmt.usd(Math.abs(desfase));
  const falta = desfase > 0;
  return h('div.aviso.alerta.aviso-cierre',
    h('strong', falta ? `Falta cargar plata en tu historia: ${dif}` : `Hay plata de más en tu historia: ${dif}`),
    h('p', falta
      ? `El ${f} tu cuenta valía ${fmt.usd(cierre.registrado)}. Con los aportes y compras que cargaste, debería haber valido ${fmt.usd(cierre.estimado)}. Esos ${dif} entraron a tu cuenta antes del ${f} y el tablero no sabe cuándo.`
      : `El ${f} tu cuenta valía ${fmt.usd(cierre.registrado)}, pero con lo que cargaste debería haber valido ${fmt.usd(cierre.estimado)}.`),
    h('p', h('strong', 'Qué hacer: '), falta
      ? 'en Balanz, buscá los depósitos (pesos o dólares) anteriores a esa fecha que no estén en tu lista de aportes, y cargá cada uno con su fecha y monto. Si sumando todo falta poco, puede ser la ganancia de alguna venta vieja.'
      : 'revisá en tu lista de aportes si alguno está repetido o con un monto mayor al real.'),
    h('div.acciones.izq',
      falta ? boton('Cargar un aporte viejo', () => ctx.menu('movimiento', 'aporte_historico'), 'chico.primario') : null,
      boton('Ver mis aportes cargados', () => { location.hash = 'informes/anual'; }, 'chico.fantasma')),
    h('p.nota', `Mientras tanto: tu patrimonio de hoy y "Este mes" están bien. "Este año" y "Desde el inicio" son aproximados.`));
}

function rendimientoInforme(ctx) {
  const e = ctx.estado, c = costosAnuales(e), br = brechaAportes(e);
  const C3 = e.datos.reglas.find(x => x.id === 'C3');
  const cierre = historiaCartera(e).cierre;
  const desfase = cierre ? cierre.registrado - cierre.estimado : 0;
  return hoja('Rendimiento', `en USD MEP · al ${fmt.fecha(e.hoy)}`,
    br.relevante ? aviso(`Ojo: lo que hoy tenés costó ${fmt.usd(br.costo)} y los aportes cargados suman ${fmt.usd(br.aportado)}. Si falta cargar algún aporte, lo anterior a tus registros diarios es menos preciso. Revisalo en Anual para el contador.`, 'alerta') : null,
    cierre && Math.abs(desfase) > Math.max(50, 0.05 * cierre.registrado) ? avisoCierre(ctx, cierre, desfase) : null,
    bloquePeriodo(e),
    sec('Por bloque, desde cada compra (tasa anual)', (() => {
      const filas = rendimientoPorBloque(e), pc = x => x == null ? '—' : color(x, fmt.pctSigno(x));
      // Cada tasa anual, y debajo cuánto es de los activos y cuánto del canje.
      const tasa = (f, k) => f.reciente || f[k] == null ? '—' : [pc(f[k]), f[k + '_activos'] == null ? null : h('span.desglose',
        h('span', `activos ${fmt.pctSigno(f[k + '_activos'])}`), h('span', `canje ${fmt.pctSigno(f[k] - f[k + '_activos'])}`))];
      return [tabla([
        { titulo: '', celda: f => h('strong', f.nombre) }, { titulo: 'Costó', num: 1, celda: f => fmt.num(f.costo) }, { titulo: 'Vale', num: 1, celda: f => fmt.num(f.valor) },
        { titulo: 'Ganancia', num: 1, celda: f => color(f.ganancia, fmt.signo(f.ganancia)) }, { titulo: 'Antigüedad', num: 1, celda: f => `${fmt.num(f.meses, 0)} m` },
        { titulo: 'Anual', num: 1, celda: f => tasa(f, 'xirr') }, { titulo: 'En el núcleo', num: 1, celda: f => tasa(f, 'xirr_nucleo') }, { titulo: 'En SPY', num: 1, celda: f => tasa(f, 'xirr_spy') },
      ], filas),
      h('p.nota', { style: 'margin-top:.6rem' }, 'Este cuadro no sigue el período de arriba: mide lo que hoy tenés desde la compra de cada lote (no cuenta lo ya vendido), como tasa anual, y lo compara con haber puesto esa misma plata, esos mismos días, en el núcleo o en SPY con CEDEARs. Deja afuera el fondo de emergencia, que no está para rendir. Con menos de tres meses de antigüedad media no se muestra la tasa anual: todavía no dice nada.'),
      filas.some(f => f.xirr_activos != null) ? notaCanje(null) : null];
    })()),
    sec('Costos (regla C3)', h('div.resumen',
      dato('Últimos 12 meses', fmt.usd(c.usd, 2), 'comisiones y gastos de operaciones'),
      dato('Sobre patrimonio medio', fmt.pct(c.pct, 2), C3 ? `alerta ${fmt.pct(C3.alerta, 2)} · auditoría ${fmt.pct(C3.auditoria, 2)}` : ''),
      dato('Patrimonio medio', fmt.usd(c.patrimonio_medio))),
      h('p.nota', 'No incluye los honorarios de administración de los fondos comunes, que ya vienen descontados del valor de la cuotaparte.')));
}

// ---------- Trimestral ----------
function trimestral(ctx) {
  const e = ctx.estado, d = e.datos, c = costosAnuales(e), R = Object.fromEntries(ctx.plan.reglas.map(x => [x.id, x]));
  // Mismos números que Informes → Rendimiento → "Desde el inicio".
  const { historia, bench } = datosRendimiento(e);
  const T = resumenPeriodo(e, historia, bench, 'todo');
  const br = brechaAportes(e);
  const [yo, spy] = T.filas || [];
  const tasa = f => f.anual ?? f.rend, cual = T.dias >= 365 ? 'por año' : `en total desde el ${fmt.fecha(T.f0)}`;
  const sat = e.posiciones.filter(p => p.grupo === 'satelite' || p.grupo === 'ypf');
  const fuera = sat.filter(p => { const b = d.objetivos_por_activo[p.ticker]?.banda; return b && (p.pct_lp < b[0] || p.pct_lp > b[1]); });
  const item = (bien, titulo, detalle) => h('li', h('span.' + (bien ? 'sube' : 'baja'), bien ? '✓' : '!'), h('div', h('strong', titulo), h('small', detalle)));
  const t = Math.ceil(fechas.nMes(e.hoy) / 3);
  return hoja('Revisión trimestral', `T${t} ${fechas.anio(e.hoy)} · al ${fmt.fecha(e.hoy)}`,
    sec('Checklist', h('ul.checklist',
      item(spy && yo.rend >= spy.rend, 'Benchmark', spy ? `Desde el inicio, tu cartera rinde ${fmt.pctSigno(tasa(yo))} ${cual} y SPY, con los mismos aportes, ${fmt.pctSigno(tasa(spy))}.${br.relevante ? ' Ojo: puede faltar cargar aportes.' : ''}` : 'Sin datos de benchmark todavía.'),
      item(!R.C3?.activa, 'Costos', `${fmt.pct(c.pct, 2)} del patrimonio medio en los últimos 12 meses (${fmt.usd(c.usd, 2)}).`),
      item(!fuera.length && R.R5?.nivel === 'ok', 'Satélites', `${fuera.length ? `Fuera de su banda: ${fuera.map(p => `${p.ticker} ${fmt.pct(p.pct_lp)}`).join(', ')}. ` : 'Todos dentro de su banda. '}En total son ${fmt.pct(e.satelites_lp)} de largo plazo${R.R5 && R.R5.nivel !== 'ok' ? ` (regla R5 ${NIVEL[R.R5.nivel][0].toLowerCase()}: los aportes van solo al núcleo)` : ''}.`),
      item(true, 'Watchlist', `${(d.watchlist || []).length} nombres en seguimiento. ${R.R7?.activa ? 'Bloqueada por la regla R7: solo observación.' : 'Habilitada: máximo inicial por nombre según la tabla.'}`))),
    seccionCanje(T, 'Activos y efecto canje, desde el inicio'),
    seccionRiesgo(e),
    seccionReferencias(e),
    sec('Satélites contra su banda', tabla([
      { titulo: 'Activo', celda: p => h('strong.num', p.ticker) }, { titulo: '% LP', num: 1, celda: p => fmt.pct(p.pct_lp) },
      { titulo: 'Banda', num: 1, celda: p => { const b = d.objetivos_por_activo[p.ticker]?.banda; return b ? `${fmt.pct(b[0], 0)}–${fmt.pct(b[1], 1)}` : '—'; } },
      { titulo: 'Resultado', num: 1, celda: p => p.pnl_pct == null ? '—' : color(p.pnl_pct, fmt.pctSigno(p.pnl_pct)) },
      { titulo: 'Acción', celda: p => d.objetivos_por_activo[p.ticker]?.accion || (p.grupo === 'ypf' ? 'Regla R6' : '—') },
    ], sat.slice().sort((a, b) => b.pct_lp - a.pct_lp))),
    sec('Todas las reglas', tablaReglas(ctx.plan.reglas)),
    sec('Watchlist', tabla([
      { titulo: 'Ticker', celda: w => h('strong.num', w.ticker) }, { titulo: 'Tema', celda: w => w.tema }, { titulo: 'Prioridad', celda: w => w.prioridad },
      { titulo: 'Máx. inicial', num: 1, celda: w => fmt.pct(w.max_inicial, 0) },
    ], d.watchlist || [])));
}

// ---------- Anual para el contador ----------
const tablaAportes = lista => {
  const orden = lista.slice().sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0);
  return tabla([
    { titulo: 'Fecha', celda: a => [fmt.fecha(a.fecha), a.fecha_estimada ? chip('estimada', 'alerta') : null] },
    { titulo: 'USD', num: 1, celda: a => fmt.num(a.usd, 2) },
  ], orden, { pie: ['Total', fmt.num(suma(orden, a => a.usd), 2)] });
};
function anual(ctx) {
  const e = ctx.estado, d = e.datos;
  const anio = fechas.nMes(e.hoy) === 1 ? fechas.anio(e.hoy) - 1 : fechas.anio(e.hoy);
  const del = f => fechas.anio(f) === anio;
  const cierre = `${anio}-12-31`, definitivo = e.hoy > cierre;
  const realizados = (d.realizados || []).filter(x => del(x.fecha)), cobros = (d.cobros || []).filter(x => del(x.fecha)), aportes = d.cashflows_externos_usd.filter(a => del(a.fecha));
  const compras = d.lotes_costo.filter(l => del(l.fecha_compra) && l.precio_compra > 0);
  const tipo = { cedear: 'CEDEAR', accion_ar: 'Acción', on: 'Obligación negociable', fci: 'Fondo común' };
  return hoja(`Informe ${anio} para el contador`, `valuación al ${fmt.fecha(e.hoy)} · MEP ${fmt.num(e.mep, 2)}`,
    definitivo ? null : aviso(`Esta es una valuación preliminar con precios de hoy. La definitiva es la del ${fmt.fecha(cierre)}: volvé a generar el informe ese día o el primer día hábil de enero.`),
    sec('Tenencias valuadas', tabla([
      { titulo: 'Especie', celda: p => h('div.activo', h('strong', p.ticker), h('small', p.descripcion)) }, { titulo: 'Tipo', celda: p => tipo[p.tipo] || p.tipo },
      { titulo: 'Cantidad', num: 1, celda: p => fmt.cant(p.cantidad) }, { titulo: 'Precio', num: 1, celda: p => `${p.moneda === 'USD' ? 'USD' : '$'} ${fmt.num(p.precio, p.precio < 100 ? 4 : 2)}` },
      { titulo: 'Valor $', num: 1, celda: p => fmt.num(p.valor_usd * e.mep) }, { titulo: 'Valor USD', num: 1, celda: p => fmt.num(p.valor_usd, 2) },
    ], e.posiciones.slice().sort((a, b) => a.ticker.localeCompare(b.ticker)), { pie: ['Total con caja', '', '', '', fmt.num(e.total_ars), fmt.num(e.total_usd, 2)] }),
      h('p.nota', { style: 'margin-top:.5rem' }, `Caja: $ ${fmt.num(d.caja.ARS, 2)} · USD ${fmt.num(d.caja.USD_MEP + (d.caja.USD_cable || 0), 2)}.`)),
    sec(`Resultados realizados en ${anio}`, realizados.length ? tabla([
      { titulo: 'Fecha', celda: x => fmt.fecha(x.fecha) }, { titulo: 'Especie', celda: x => x.ticker }, { titulo: 'Cantidad', num: 1, celda: x => fmt.cant(x.cantidad) },
      { titulo: 'Costo USD', num: 1, celda: x => fmt.num(x.costo_usd, 2) }, { titulo: 'Neto USD', num: 1, celda: x => fmt.num(x.neto_usd, 2) }, { titulo: 'Resultado USD', num: 1, celda: x => fmt.signo(x.resultado_usd, 2) },
    ], realizados, { pie: ['Total', '', '', '', '', fmt.signo(suma(realizados, x => x.resultado_usd), 2)] }) : h('p.nota', 'No hay ventas registradas en el año.')),
    sec(`Dividendos y cupones cobrados en ${anio}`, cobros.length ? tabla([
      { titulo: 'Fecha', celda: x => fmt.fecha(x.fecha) }, { titulo: 'Especie', celda: x => x.ticker }, { titulo: 'Concepto', celda: x => ({ cupon: 'Cupón', dividendo: 'Dividendo', amortizacion: 'Amortización' }[x.clase] || x.clase) }, { titulo: 'USD', num: 1, celda: x => fmt.num(x.usd, 2) },
    ], cobros, { pie: ['Total', '', '', fmt.num(suma(cobros, x => x.usd), 2)] }) : h('p.nota', 'No hay cobros registrados en el año. Los dividendos pagados en acciones figuran como lotes de costo cero.')),
    sec(`Compras de ${anio}`, compras.length ? tabla([
      { titulo: 'Fecha', celda: l => fmt.fecha(l.fecha_compra) }, { titulo: 'Especie', celda: l => l.ticker }, { titulo: 'Cantidad', num: 1, celda: l => fmt.cant(l.cantidad) },
      { titulo: 'Precio', num: 1, celda: l => `${l.moneda === 'USD' ? 'USD' : '$'} ${fmt.num(l.precio_compra, l.precio_compra < 100 ? 4 : 2)}` }, { titulo: 'Gastos $', num: 1, celda: l => fmt.num(l.gastos || 0, 2) }, { titulo: 'MEP del día', num: 1, celda: l => fmt.num(l.mep_dia, 2) },
    ], compras.slice().sort((a, b) => a.fecha_compra < b.fecha_compra ? -1 : 1)) : h('p.nota', 'Sin compras en el año.')),
    sec(`Aportes externos de ${anio}`, aportes.length ? tablaAportes(aportes) : h('p.nota', 'Sin aportes en el año.')),
    d.cashflows_externos_usd.length > aportes.length ? sec('Todos los aportes externos', h('details.otra-forma',
      h('summary', `Ver los ${d.cashflows_externos_usd.length} desde el ${fmt.fecha(d.cashflows_externos_usd.map(a => a.fecha).sort()[0])}`),
      tablaAportes(d.cashflows_externos_usd))) : null,
    h('p.descargo', 'Los valores en pesos usan el dólar MEP indicado arriba; para Bienes Personales corresponde la valuación oficial al 31/12.'));
}

// ---------- Contraste con Allaria ----------
function allaria(ctx) {
  const e = ctx.estado, d = e.datos, a = d.cartera_modelo_allaria;
  if (!a) return hoja('Contraste con Allaria', '', h('p.nota', 'No hay cartera modelo cargada.'));
  const mios = new Map(e.posiciones.map(p => [p.subyacente || p.ticker, p])), watch = new Set((d.watchlist || []).map(w => w.ticker));
  const comunes = a.activos.filter(x => mios.has(x.ticker)), enWatch = a.activos.filter(x => watch.has(x.ticker));
  const per = Object.entries(a.rendimiento_por_periodo || {});
  const acum = per.reduce((ac, [, r]) => ac * (1 + r), 1) - 1;
  const desde = a.activos.map(x => x.desde).sort()[0];
  const nucleo = rendNucleo(e, desde, e.hoy);
  const lista = v => [v].flat().join(', ');
  return hoja('Contraste con Allaria', `cartera modelo de CEDEARs · rotación ${a.rotacion} del ${fmt.fecha(a.fecha)}`,
    sec('Qué se solapa con lo tuyo',
      h('ul.allaria-lista', a.activos.map(x => h('li' + (mios.has(x.ticker) ? '.tengo' : ''), x.ticker, mios.has(x.ticker) ? h('small', 'en cartera') : watch.has(x.ticker) ? h('small', 'watchlist') : null))),
      h('p', `De los ${a.activos.length} nombres de Allaria tenés ${comunes.length}${comunes.length ? ` (${comunes.map(x => `${x.ticker}, ${fmt.pct(mios.get(x.ticker).pct_lp)} de LP`).join('; ')})` : ''} y ${enWatch.length} ${enWatch.length === 1 ? 'está' : 'están'} en tu watchlist${enWatch.length ? ` (${enWatch.map(x => x.ticker).join(', ')})` : ''}.`),
      h('p.nota', `Allaria no publica ponderaciones. Datos cargados a mano el ${fmt.fecha(a.fecha)}.`),
      h('div.acciones.izq.no-imprimir', { style: 'margin-top:.75rem' }, boton('Cargar una rotación nueva', () => nuevaRotacion(ctx), 'chico'), h('a.boton.chico.fantasma', { href: '#informes/diario' }, 'Ver cómo le va contra SPY'))),
    sec('Cómo rindieron sus rotaciones', per.length ? [tabla([
      { titulo: 'Período', celda: ([k]) => h('strong.num', k) }, { titulo: 'Rendimiento', num: 1, celda: ([, r]) => color(r, fmt.pctSigno(r, 2)) },
    ], per, { pie: ['Acumulado', color(acum, fmt.pctSigno(acum, 2))] }),
    h('p.nota', { style: 'margin-top:.6rem' }, `${per.filter(([, r]) => r > 0).length} de ${per.length} períodos positivos. ${nucleo == null ? '' : `Como referencia, tu núcleo ${Object.values(d.nucleo.pesos_internos).map(w => Math.round(w * 100)).join('/')} rindió ${fmt.pctSigno(nucleo, 1)} en USD desde el ${fmt.fecha(desde)} (la posición más antigua de su cartera actual). `}${a.rotaciones?.length ? `Fechas cargadas: ${a.rotaciones.map(r => `${r.rotacion} el ${fmt.fecha(r.fecha)}`).join(', ')}. Las anteriores no están, así que para esos períodos la comparación no es exacta.` : 'Las fechas de cada rotación no están cargadas, así que la comparación período por período no es exacta.'}`)] : h('p.nota', 'Sin rendimientos cargados.')),
    sec('Qué cambió', (a.ultimos_cambios || []).length ? h('ul.lista-simple', a.ultimos_cambios.map(c => h('li', `${fmt.fecha(c.fecha)} · entra ${lista(c.entra)}; sale ${lista(c.sale)}`))) : h('p.nota', 'Sin cambios cargados.')),
    sec('Cartera modelo vigente', tabla([
      { titulo: 'Ticker', celda: x => h('strong.num', x.ticker) }, { titulo: 'Desde', celda: x => fmt.fecha(x.desde) },
      { titulo: 'En tu cartera', celda: x => mios.has(x.ticker) ? `${fmt.usd(mios.get(x.ticker).valor_usd)} · ${fmt.pct(mios.get(x.ticker).pct_lp)} de LP` : watch.has(x.ticker) ? 'En watchlist' : '—' },
    ], a.activos)));
}

const FN = { mensual, rendimiento: rendimientoInforme, trimestral, diario, anual, allaria };

export function vistaInformes(ctx, sub) {
  const id = FN[sub] ? sub : 'mensual';
  return h('div.vista.informes',
    h('header.vista-cab', h('h1', 'Informes')),
    h('nav.selector', { 'aria-label': 'Informes' }, INFORMES.map(([k, n]) => h('a', { href: '#informes/' + k, 'aria-current': k === id ? 'page' : null }, n))),
    h('div.barra-informe', boton('Imprimir o guardar como PDF', () => window.print(), 'chico')),
    FN[id](ctx));
}
