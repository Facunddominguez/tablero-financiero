// Pantalla Informes: cinco informes de una página, imprimibles (window.print + CSS de impresión).
import { h, fmt, fechas, suma } from '../util.js';
import { rendimiento, costosAnuales, brechaAportes, rendimientoHist } from '../finanzas.js';
import { NOMBRE_GRUPO } from '../estado.js';
import { tabla, chip, aviso, boton, NIVEL, cargarScript, CDN, coloresSeries, signoClase } from './comun.js';

const INFORMES = [['mensual', 'Mensual'], ['rendimiento', 'Rendimiento'], ['trimestral', 'Trimestral'], ['anual', 'Anual para el contador'], ['allaria', 'Contraste con Allaria']];
const dato = (etq, valor, sub) => h('div', h('p.dato-etq', etq), h('p.dato-valor', valor), sub ? h('p.dato-sub', sub) : null);
const color = (n, txt) => h('span.' + (signoClase(n) || 'plano'), txt);
const hoja = (titulo, sub, ...secciones) => h('article.informe', h('header.informe-cab', h('h1', titulo), h('p', sub)), secciones);
const sec = (titulo, ...c) => h('section', h('h2', titulo), c);
const tablaReglas = reglas => tabla([
  { titulo: 'Regla', celda: r => h('strong.num', r.id) }, { titulo: 'Política', celda: r => r.politica },
  { titulo: 'Valor', num: 1, celda: r => r.valor }, { titulo: 'Estado', celda: r => chip(NIVEL[r.nivel][0], NIVEL[r.nivel][1]) },
], reglas);

// Rendimiento de la canasta núcleo (pesos fijos) entre dos fechas.
function rendNucleo(e, desde, hasta) {
  const partes = Object.entries(e.datos.nucleo.pesos_internos).map(([t, w]) => [w, rendimientoHist(e.historico, t, desde, hasta)]);
  return partes.some(([, r]) => r == null) ? null : suma(partes, ([w, r]) => w * r);
}

// ---------- Mensual ----------
function mensual(ctx) {
  const e = ctx.estado, d = e.datos, mes = fechas.mes(e.hoy), inicio = mes + '-01';
  const snaps = Object.entries(d.snapshots).sort();
  const base = snaps.filter(([f]) => f < inicio).pop() || snaps[0];
  const [f0, s0] = base || [e.hoy, { t: e.total_usd }];
  const aportes = d.cashflows_externos_usd.filter(a => a.fecha > f0 && a.fecha <= e.hoy);
  const aportado = suma(aportes, a => a.usd);
  const rend = s0.t ? (e.total_usd - s0.t - aportado) / (s0.t + aportado / 2) : null;
  const spy = rendimientoHist(e.historico, 'SPY', f0, e.hoy);
  const m = d.meses?.[mes];
  const hechos = (d.decisiones || []).filter(x => fechas.mes(x.fecha) === mes);
  const tareas = ctx.plan.pasos.filter(p => !p.informativo);
  return hoja('Informe mensual', `${fmt.mes(e.hoy)} · al ${fmt.fecha(e.hoy)}`,
    h('section', h('div.resumen',
      dato('Patrimonio', fmt.usd(e.total_usd), `${fmt.ars(e.total_ars)}`),
      dato(`Desde el ${fmt.fecha(f0)}`, color(rend, fmt.pctSigno(rend, 2)), `SPY en USD: ${spy == null ? 'sin datos' : fmt.pctSigno(spy, 2)}`),
      dato('Aportes del período', fmt.usd(aportado), aportes.length ? aportes.map(a => fmt.fecha(a.fecha)).join(', ') : 'ninguno'),
      dato('Tasa de ahorro', m ? fmt.pct((m.ingreso - m.gasto) / m.ingreso, 0) : '—', m ? `meta ${fmt.pct(d.perfil.meta_tasa_ahorro, 0)}` : 'mes sin cargar')),
      h('p.nota', `El rendimiento descuenta los aportes del período. ${f0 >= inicio ? 'Todavía no hay un registro anterior al inicio del mes: se mide desde el primer dato guardado.' : ''}`)),
    sec('Cumplimiento de reglas', tablaReglas(ctx.plan.reglas)),
    sec('Qué se hizo', hechos.length ? h('ul.lista-simple', hechos.map(x => h('li', `${fmt.fecha(x.fecha)} · ${x.texto}`))) : h('p.nota', 'Nada registrado este mes.')),
    sec('Qué sigue', tareas.length ? h('ul.lista-simple', tareas.map(p => h('li', p.titulo))) : h('p', `Todo en orden. Próxima acción: ${fmt.fecha(ctx.plan.proxima.fecha)}, ${ctx.plan.proxima.texto}.`)));
}

// ---------- Rendimiento ----------
function graficoEvolucion(e, r) {
  const puntos = Object.entries(e.datos.snapshots).sort().map(([f, s]) => ({ f, v: s.t }));
  if (puntos.length < 3) return h('p.nota', `La evolución se dibuja con un punto por cada día que abrís el tablero. Por ahora hay ${puntos.length}; a partir del tercero aparece el gráfico.`);
  const nombres = ['Tu cartera', ...r.benchmarks.map(b => b.nombre)];
  const lienzo = h('canvas', { role: 'img', 'aria-label': 'Evolución del patrimonio contra los benchmarks' });
  cargarScript(CDN.chart).then(() => {
    if (!lienzo.isConnected) return;
    const c = coloresSeries();
    const series = [puntos.map(p => p.v), ...r.benchmarks.map(b => puntos.map(p => r.valorEn[b.nombre](p.f)))];
    new Chart(lienzo, {
      type: 'line',
      data: { labels: puntos.map(p => fmt.fecha(p.f).slice(0, 5)), datasets: series.map((data, i) => ({ label: nombres[i], data, borderColor: c.series[i], backgroundColor: c.series[i], borderWidth: 2, pointRadius: puntos.length > 40 ? 0 : 2.5, pointHoverRadius: 5, tension: 0 })) },
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
  return [h('div.leyenda-linea', nombres.map((n, i) => h('span', h('i', { style: `background:var(--serie-${i + 1})` }), n))), h('div.grafico', lienzo)];
}
function rendimientoInforme(ctx) {
  const e = ctx.estado, r = rendimiento(e), c = costosAnuales(e), br = brechaAportes(e);
  const C3 = e.datos.reglas.find(x => x.id === 'C3');
  const filas = [r.cartera, ...r.benchmarks];
  const dif = r.benchmarks[0] && r.cartera.xirr != null ? r.cartera.xirr - r.benchmarks[0].xirr : null;
  return hoja('Rendimiento', `en USD MEP · al ${fmt.fecha(e.hoy)}`,
    br.relevante ? aviso(`Ojo: lo que hoy tenés costó ${fmt.usd(br.costo)} y los aportes cargados suman ${fmt.usd(br.aportado)}. Si falta cargar algún aporte, el rendimiento anual de tu cartera está inflado. Revisalo antes de sacar conclusiones.`, 'alerta') : null,
    sec('Con los mismos aportes, en las mismas fechas',
      tabla([
        { titulo: '', celda: f => h('strong', f.nombre) }, { titulo: 'Aportado', num: 1, celda: f => fmt.num(f.aportado) }, { titulo: 'Valor hoy', num: 1, celda: f => fmt.num(f.valor) },
        { titulo: 'Ganancia', num: 1, celda: f => color(f.ganancia, fmt.signo(f.ganancia)) }, { titulo: 'Anual (XIRR)', num: 1, celda: f => f.xirr == null ? '—' : color(f.xirr, fmt.pctSigno(f.xirr)) },
      ], filas),
      r.benchmarks.length ? h('p.nota', { style: 'margin-top:.6rem' }, `${dif == null || br.relevante ? '' : `${dif >= 0 ? 'Vas' : 'Venís'} ${fmt.pp(Math.abs(dif)).replace('+', '')} ${dif >= 0 ? 'por encima' : 'por debajo'} de SPY por año. `}Los benchmarks simulan comprar el ETF en USD el día de cada aporte, con dividendos reinvertidos y sin costos.`)
        : h('p.nota', 'Todavía no hay precios históricos para simular los benchmarks.')),
    sec('Evolución', graficoEvolucion(e, r)),
    sec('Costos (regla C3)', h('div.resumen',
      dato('Últimos 12 meses', fmt.usd(c.usd, 2), 'comisiones y gastos de operaciones'),
      dato('Sobre patrimonio medio', fmt.pct(c.pct, 2), C3 ? `alerta ${fmt.pct(C3.alerta, 2)} · auditoría ${fmt.pct(C3.auditoria, 2)}` : ''),
      dato('Patrimonio medio', fmt.usd(c.patrimonio_medio))),
      h('p.nota', 'No incluye los honorarios de administración de los fondos comunes, que ya vienen descontados del valor de la cuotaparte.')),
    sec('Aportes externos', tabla([
      { titulo: 'Fecha', celda: a => [fmt.fecha(a.fecha), a.fecha_estimada ? chip('estimada', 'alerta') : null] }, { titulo: 'USD', num: 1, celda: a => fmt.num(a.usd, 2) },
    ], e.datos.cashflows_externos_usd, { pie: ['Total', fmt.num(r.aportado, 2)] })));
}

// ---------- Trimestral ----------
function trimestral(ctx) {
  const e = ctx.estado, d = e.datos, r = rendimiento(e), c = costosAnuales(e), R = Object.fromEntries(ctx.plan.reglas.map(x => [x.id, x]));
  const br = brechaAportes(e);
  const spy = r.benchmarks[0];
  const sat = e.posiciones.filter(p => p.grupo === 'satelite' || p.grupo === 'ypf');
  const fuera = sat.filter(p => { const b = d.objetivos_por_activo[p.ticker]?.banda; return b && (p.pct_lp < b[0] || p.pct_lp > b[1]); });
  const item = (bien, titulo, detalle) => h('li', h('span.' + (bien ? 'sube' : 'baja'), bien ? '✓' : '!'), h('div', h('strong', titulo), h('small', detalle)));
  const t = Math.ceil(fechas.nMes(e.hoy) / 3);
  return hoja('Revisión trimestral', `T${t} ${fechas.anio(e.hoy)} · al ${fmt.fecha(e.hoy)}`,
    sec('Checklist', h('ul.checklist',
      item(spy && r.cartera.xirr >= spy.xirr, 'Benchmark', spy ? `Tu cartera rinde ${fmt.pctSigno(r.cartera.xirr)} anual y SPY, con los mismos aportes, ${fmt.pctSigno(spy.xirr)}.${br.relevante ? ' Ojo: puede faltar cargar aportes, y eso infla tu número.' : ''}` : 'Sin datos de benchmark todavía.'),
      item(!R.C3?.activa, 'Costos', `${fmt.pct(c.pct, 2)} del patrimonio medio en los últimos 12 meses (${fmt.usd(c.usd, 2)}).`),
      item(!fuera.length && R.R5?.nivel === 'ok', 'Satélites', `${fuera.length ? `Fuera de su banda: ${fuera.map(p => `${p.ticker} ${fmt.pct(p.pct_lp)}`).join(', ')}. ` : 'Todos dentro de su banda. '}En total son ${fmt.pct(e.satelites_lp)} de largo plazo${R.R5 && R.R5.nivel !== 'ok' ? ` (regla R5 ${NIVEL[R.R5.nivel][0].toLowerCase()}: los aportes van solo al núcleo)` : ''}.`),
      item(true, 'Watchlist', `${(d.watchlist || []).length} nombres en seguimiento. ${R.R7?.activa ? 'Bloqueada por la regla R7: solo observación.' : 'Habilitada: máximo inicial por nombre según la tabla.'}`))),
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
    sec(`Aportes de ${anio}`, h('p', aportes.length ? `${aportes.length} aportes por ${fmt.usd(suma(aportes, a => a.usd), 2)}: ${aportes.map(a => `${fmt.fecha(a.fecha)} (${fmt.num(a.usd, 2)})`).join(', ')}.` : 'Sin aportes en el año.')),
    h('p.descargo', 'Información de soporte, no es asesoramiento impositivo. Los valores en pesos usan el dólar MEP indicado arriba; para Bienes Personales corresponde la valuación oficial al 31/12.'));
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
      h('p.nota', 'Allaria no publica ponderaciones: es una referencia. Tus reglas (R7, R4 y R4B) mandan.')),
    sec('Cómo rindieron sus rotaciones', per.length ? [tabla([
      { titulo: 'Período', celda: ([k]) => h('strong.num', k) }, { titulo: 'Rendimiento', num: 1, celda: ([, r]) => color(r, fmt.pctSigno(r, 2)) },
    ], per, { pie: ['Acumulado', color(acum, fmt.pctSigno(acum, 2))] }),
    h('p.nota', { style: 'margin-top:.6rem' }, `${per.filter(([, r]) => r > 0).length} de ${per.length} períodos positivos. ${nucleo == null ? '' : `Como referencia, tu núcleo ${Object.values(d.nucleo.pesos_internos).map(w => Math.round(w * 100)).join('/')} rindió ${fmt.pctSigno(nucleo, 1)} en USD desde el ${fmt.fecha(desde)} (la posición más antigua de su cartera actual). `}Las fechas de cada rotación no están cargadas, así que la comparación período por período no es exacta.`)] : h('p.nota', 'Sin rendimientos cargados.')),
    sec('Qué cambió', (a.ultimos_cambios || []).length ? h('ul.lista-simple', a.ultimos_cambios.map(c => h('li', `${fmt.fecha(c.fecha)} · entra ${lista(c.entra)}; sale ${lista(c.sale)}`))) : h('p.nota', 'Sin cambios cargados.')),
    sec('Cartera modelo vigente', tabla([
      { titulo: 'Ticker', celda: x => h('strong.num', x.ticker) }, { titulo: 'Desde', celda: x => fmt.fecha(x.desde) },
      { titulo: 'En tu cartera', celda: x => mios.has(x.ticker) ? `${fmt.usd(mios.get(x.ticker).valor_usd)} · ${fmt.pct(mios.get(x.ticker).pct_lp)} de LP` : watch.has(x.ticker) ? 'En watchlist' : '—' },
    ], a.activos)));
}

const FN = { mensual, rendimiento: rendimientoInforme, trimestral, anual, allaria };

export function vistaInformes(ctx, sub) {
  const id = FN[sub] ? sub : 'mensual';
  return h('div.vista.informes',
    h('header.vista-cab', h('h1', 'Informes')),
    h('nav.selector', { 'aria-label': 'Informes' }, INFORMES.map(([k, n]) => h('a', { href: '#informes/' + k, 'aria-current': k === id ? 'page' : null }, n))),
    h('div.barra-informe', boton('Imprimir o guardar como PDF', () => window.print(), 'chico')),
    FN[id](ctx));
}
