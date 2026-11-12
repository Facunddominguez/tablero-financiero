// Pantalla Cartera: anillo por bloque y tabla ordenable.
import { h, poner, fmt } from '../util.js';
import { porGrupo, NOMBRE_GRUPO } from '../estado.js';
import { accionesPorActivo, objetivoDe } from '../motor.js';
import { cargarScript, CDN, coloresSeries, signoClase } from './comun.js';

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
  const filas = e.posiciones.map(p => {
    const objetivo = objetivoDe(e, p);
    return { ...p, objetivo, desvio: objetivo != null && p.pct_lp != null ? p.pct_lp - objetivo : null, accion: acciones[p.ticker], nombre_grupo: NOMBRE_GRUPO[p.grupo] };
  });
  const cols = [
    { k: 'ticker', t: 'Activo', celda: f => h('div.activo', h('strong', f.ticker), h('small', f.descripcion)) },
    { k: 'nombre_grupo', t: 'Bloque', celda: f => f.nombre_grupo },
    { k: 'cantidad', t: 'Cantidad', num: 1, celda: f => fmt.cant(f.cantidad) },
    { k: 'valor_usd', t: 'Valor USD', num: 1, celda: f => fmt.num(f.valor_usd) },
    { k: 'pct_lp', t: '% LP', num: 1, celda: f => f.pct_lp == null ? '—' : fmt.pct(f.pct_lp) },
    { k: 'objetivo', t: 'Objetivo', num: 1, celda: f => f.objetivo == null ? '—' : fmt.pct(f.objetivo) },
    { k: 'desvio', t: 'Desvío', num: 1, celda: f => f.desvio == null ? '—' : fmt.pp(f.desvio) },
    { k: 'pnl_usd', t: 'Resultado USD', num: 1, celda: f => f.pnl_usd == null ? '—' : h('span.' + (signoClase(f.pnl_usd) || 'plano'), fmt.signo(f.pnl_usd)) },
    { k: 'pnl_pct', t: 'Resultado %', num: 1, celda: f => f.pnl_pct == null ? '—' : h('span.' + (signoClase(f.pnl_pct) || 'plano'), fmt.pctSigno(f.pnl_pct)) },
    { k: 'accion', t: 'Acción vigente', celda: f => f.accion },
  ];
  const cuerpo = h('tbody');
  const cab = h('tr');
  const pintar = () => {
    const s = orden.asc ? 1 : -1;
    const ord = filas.slice().sort((a, b) => {
      const x = a[orden.col], y = b[orden.col];
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y, 'es') : x - y) * s;
    });
    poner(cuerpo, ...ord.map(f => h('tr', cols.map(c => h('td' + (c.num ? '.num' : ''), c.celda(f))))));
    poner(cab, ...cols.map(c => h('th' + (c.num ? '.num' : ''), { 'aria-sort': orden.col === c.k ? (orden.asc ? 'ascending' : 'descending') : 'none' },
      h('button.orden', { type: 'button', onclick: () => { orden = { col: c.k, asc: orden.col === c.k ? !orden.asc : typeof filas[0][c.k] === 'string' }; pintar(); } },
        c.t, orden.col === c.k ? h('span.flecha', orden.asc ? ' ↑' : ' ↓') : null))));
  };
  pintar();
  const costo = filas.reduce((a, f) => a + (f.costo_usd || 0), 0), pnl = filas.reduce((a, f) => a + (f.pnl_usd || 0), 0);
  return h('div.vista.cartera',
    h('header.vista-cab', h('h1', 'Cartera'),
      h('p.nota', `Largo plazo ${fmt.usd(e.lp_usd)} · emergencia ${fmt.usd(e.emergencia_usd)} · caja ${fmt.usd(e.caja_usd, 2)}`)),
    anillo(e),
    h('div.tabla-caja', h('table.tabla.cartera-tabla', h('thead', cab), cuerpo,
      h('tfoot', h('tr', h('td', { colspan: 3 }, 'Total con caja'), h('td.num', fmt.num(e.total_usd)), h('td', { colspan: 3 }),
        h('td.num', h('span.' + (signoClase(pnl) || 'plano'), fmt.signo(pnl))), h('td.num', h('span.' + (signoClase(pnl) || 'plano'), fmt.pctSigno(costo ? pnl / costo : 0))), h('td'))))),
    h('p.nota', h('button.enlace', { type: 'button', onclick: () => ctx.menu('fuentes') }, `Precios ${e.precios.origen === 'mercado' ? 'actualizados ' + fmt.hace(e.precios.generado) : 'del resumen del ' + fmt.fecha(e.precios.fecha_archivo)} · ver fuentes`)),
    h('p.nota', 'Resultado = valor de hoy menos el costo de cada lote, en dólares al MEP del día de compra y con gastos incluidos. % LP y objetivo son sobre la cartera de largo plazo; la emergencia queda afuera.'));
}
