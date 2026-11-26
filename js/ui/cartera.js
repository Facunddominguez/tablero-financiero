// Pantalla Cartera: anillo por bloque y tabla ordenable.
import { h, poner, fmt } from '../util.js';
import { porGrupo, NOMBRE_GRUPO } from '../estado.js';
import { accionesPorActivo, objetivoDe, proximosFlujos } from '../motor.js';
import { riesgo } from '../riesgo.js';
import { cargarScript, CDN, coloresSeries, signoClase, tabla, chip, parteRiesgo } from './comun.js';

let orden = { col: 'valor_usd', asc: false };
let grafico;

function anillo(e) {
  const grupos = porGrupo(e).filter(g => Math.abs(g.usd) >= 0.5);
  const lienzo = h('canvas', { role: 'img', 'aria-label': 'Distribución del patrimonio por bloque' });
  const centro = h('div.anillo-centro', h('span.anillo-etq', 'Largo plazo'), h('span.anillo-num', fmt.usd(e.lp_usd)));
  const marcas = grupos.map((g, i) => h('span.marca', { style: `background:var(--serie-${i + 1})` }));
  const leyenda = h('table.leyenda', h('tbody', grupos.map((g, i) => h('tr', { dataset: { i } },
    h('td', marcas[i], g.nombre), h('td.num', fmt.usd(g.usd)), h('td.num', fmt.pct(g.pct))))));
  cargarScript(CDN.chart).then(() => {
    if (!lienzo.isConnected) return;
    const c = coloresSeries();
    grafico?.destroy();
    grafico = new Chart(lienzo, {
      type: 'doughnut',
      data: { labels: grupos.map(g => g.nombre), datasets: [{ data: grupos.map(g => Math.max(0, g.usd)), backgroundColor: c.series.slice(0, grupos.length), borderColor: c.superficie, borderWidth: 2, borderRadius: 4, hoverOffset: 6 }] },
      options: {
        cutout: '68%', animation: false, responsive: true, maintainAspectRatio: true,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => ` ${fmt.usd(x.parsed)} · ${fmt.pct(x.parsed / e.total_usd)} del total` }, bodyFont: { family: c.num } } },
      },
    });
  }).catch(() => lienzo.replaceWith(h('p.nota', 'No se pudo cargar el gráfico; la tabla de al lado tiene los mismos datos.')));
  return h('section.anillo', h('div.anillo-grafico', lienzo, centro), leyenda);
}

export function vistaCartera(ctx) {
  const e = ctx.estado;
  const acciones = accionesPorActivo(e, ctx.plan.reglas);
  const r = riesgo(e);
  const filas = e.posiciones.map(p => {
    const objetivo = objetivoDe(e, p);
    return { ...p, objetivo, desvio: objetivo != null && p.pct_lp != null ? p.pct_lp - objetivo : null, accion: acciones[p.ticker], nombre_grupo: NOMBRE_GRUPO[p.grupo], pct_riesgo: p.grupo === 'emergencia' ? null : r?.posiciones[p.ticker]?.parte ?? null };
  });
  const cols = [
    { k: 'ticker', t: 'Activo', movil: 1, celda: f => h('div.activo', h('strong', f.ticker), h('small', f.descripcion)) },
    { k: 'nombre_grupo', t: 'Bloque', celda: f => f.nombre_grupo },
    { k: 'cantidad', t: 'Cantidad', num: 1, celda: f => fmt.cant(f.cantidad) },
    { k: 'valor_usd', t: 'Valor USD', num: 1, movil: 1, celda: f => fmt.num(f.valor_usd) },
    { k: 'pct_lp', t: '% LP', num: 1, movil: 1, celda: f => f.pct_lp == null ? '—' : fmt.pct(f.pct_lp) },
    { k: 'pct_riesgo', t: '% del riesgo', num: 1, movil: 1, celda: f => f.pct_riesgo == null ? '—' : parteRiesgo(f.pct_riesgo) },
    { k: 'objetivo', t: 'Objetivo', num: 1, celda: f => f.objetivo == null ? '—' : fmt.pct(f.objetivo) },
    { k: 'desvio', t: 'Desvío', num: 1, celda: f => f.desvio == null ? '—' : fmt.pp(f.desvio) },
    { k: 'pnl_usd', t: 'Resultado USD', num: 1, celda: f => f.pnl_usd == null ? '—' : h('span.' + (signoClase(f.pnl_usd) || 'plano'), fmt.signo(f.pnl_usd)) },
    { k: 'pnl_pct', t: 'Resultado %', num: 1, movil: 1, celda: f => f.pnl_pct == null ? '—' : h('span.' + (signoClase(f.pnl_pct) || 'plano'), fmt.pctSigno(f.pnl_pct)) },
    { k: 'accion', t: 'Acción vigente', celda: f => f.accion },
  ];
  // En el celular se ven solo las columnas marcadas `movil`; el resto aparece con "Ver todas las columnas".
  const sel = (tag, c) => tag + (c.num ? '.num' : '') + (c.movil ? '' : '.ancho');
  const cuerpo = h('tbody');
  const cab = h('tr');
  const pintar = () => {
    const s = orden.asc ? 1 : -1;
    const ord = filas.slice().sort((a, b) => {
      const x = a[orden.col], y = b[orden.col];
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y, 'es') : x - y) * s;
    });
    poner(cuerpo, ...ord.map(f => h('tr', cols.map(c => h(sel('td', c), c.celda(f))))));
    poner(cab, ...cols.map(c => h(sel('th', c), { 'aria-sort': orden.col === c.k ? (orden.asc ? 'ascending' : 'descending') : 'none' },
      h('button.orden', { type: 'button', onclick: () => { orden = { col: c.k, asc: orden.col === c.k ? !orden.asc : typeof filas[0][c.k] === 'string' }; pintar(); } },
        c.t, orden.col === c.k ? h('span.flecha', orden.asc ? ' ↑' : ' ↓') : null))));
  };
  pintar();
  const costo = filas.reduce((a, f) => a + (f.costo_usd || 0), 0), pnl = filas.reduce((a, f) => a + (f.pnl_usd || 0), 0);
  return h('div.vista.cartera',
    h('header.vista-cab', h('h1', 'Cartera'),
      h('p.nota', `Largo plazo ${fmt.usd(e.lp_usd)} · emergencia ${fmt.usd(e.emergencia_usd)} · caja ${fmt.usd(e.caja_usd, 2)}`)),
    anillo(e),
    tablaCartera(cab, cuerpo, cols, sel, {
      ticker: 'Total con caja', valor_usd: fmt.num(e.total_usd),
      pnl_usd: h('span.' + (signoClase(pnl) || 'plano'), fmt.signo(pnl)),
      pnl_pct: h('span.' + (signoClase(pnl) || 'plano'), fmt.pctSigno(costo ? pnl / costo : 0)),
    }),
    vencimientos(e),
    h('p.nota', h('button.enlace', { type: 'button', onclick: () => ctx.menu('fuentes') }, `Precios ${e.precios.origen === 'mercado' ? 'actualizados ' + fmt.hace(e.precios.generado) : 'del resumen del ' + fmt.fecha(e.precios.fecha_archivo)} · ver fuentes`)),
    h('p.nota', 'Resultado = valor de hoy menos el costo de cada lote, en dólares al MEP del día de compra y con gastos incluidos. % LP y objetivo son sobre la cartera de largo plazo; la emergencia queda afuera.'),
    r ? h('p.nota', '"% del riesgo" es cuánto de los altibajos de la cartera de largo plazo explica cada cosa, según cómo se movieron los precios. Comparalo con su peso. El detalle está en ', h('a', { href: '#informes/trimestral' }, 'Informes → Trimestral'), '.') : null);
}

// Tabla con el pie alineado columna por columna (así se puede ocultar cualquiera) y el botón para ver todo en el celular.
function tablaCartera(cab, cuerpo, cols, sel, pie) {
  const tbl = h('table.tabla.cartera-tabla', h('thead', cab), cuerpo,
    h('tfoot', h('tr', cols.map(c => h(sel('td', c), pie[c.k] ?? '')))));
  const alternar = h('button.enlace', { type: 'button', 'aria-pressed': 'false', onclick: () => {
    const todas = tbl.classList.toggle('completa');
    alternar.setAttribute('aria-pressed', String(todas));
    alternar.textContent = todas ? 'Ver menos columnas' : 'Ver todas las columnas';
  } }, 'Ver todas las columnas');
  return [h('div.tabla-caja', tbl), h('p.nota.solo-movil', alternar)];
}

// Próximos cupones y vencimientos de lo que tenés (sale de data/calendario.json).
function vencimientos(e) {
  const flujos = proximosFlujos(e);
  if (!flujos.length) return null;
  const NOMBRE = { cupon: 'Cupón', dividendo: 'Dividendo', amortizacion: 'Devolución de capital' };
  const total = flujos.reduce((a, f) => a + f.usd, 0);
  const columnas = [
    { titulo: 'Fecha', celda: f => h('span.num', fmt.fecha(f.fecha)) },
    { titulo: 'Activo', celda: f => [h('strong', f.ticker), ' ', NOMBRE[f.tipo] || f.tipo] },
    { titulo: 'USD aprox.', num: 1, celda: f => fmt.num(f.usd, 2) },
    { titulo: '', celda: f => f.vencido ? chip('Falta registrarlo', 'alerta') : null },
  ];
  // Siempre los vencidos sin registrar y los próximos cuatro; el resto, plegado.
  const corte = flujos.filter(f => f.vencido).length + 4;
  const resto = flujos.slice(corte);
  return h('section.vencimientos',
    h('h2.sub', 'Próximos cobros y vencimientos'),
    tabla(columnas, flujos.slice(0, corte)),
    resto.length ? h('details.otra-forma', h('summary', `Ver los ${resto.length} siguientes (total de todo: USD ${fmt.num(total, 2)})`), tabla(columnas, resto)) : null,
    h('p.nota', { style: 'margin-top:.6rem' }, 'Con la cantidad que tenés hoy. Si la fecha no es hábil, se paga el día hábil siguiente.'));
}
