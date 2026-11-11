// Pantalla Aportar: calculadora de reparto en unidades enteras.
import { h, poner, fmt, fechas, aNumero } from '../util.js';
import { repartirAporte, aporteDelMes } from '../motor.js';
import { dialogoCompras, boton, aviso } from './comun.js';

let moneda = 'USD', texto = null, deCaja = false;

export function vistaAportar(ctx) {
  const e = ctx.estado, d = e.datos;
  if (texto == null) texto = fmt.num(aporteDelMes(e, fechas.mes(e.hoy)));
  const fMonto = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: texto, 'aria-label': 'Monto a aportar' });
  const salida = h('div');
  const bMoneda = m => h('button', { type: 'button', 'aria-pressed': String(moneda === m), onclick: () => { moneda = m; pintar(); poner(conm, bMoneda('USD'), bMoneda('ARS')); } }, m === 'USD' ? 'USD' : '$');
  const conm = h('div.conmutador', { role: 'group', 'aria-label': 'Moneda' }, bMoneda('USD'), bMoneda('ARS'));
  const activas = ctx.plan.reglas.filter(r => r.activa && ['R3', 'R5', 'R7'].includes(r.id)).map(r => r.id);

  function pintar() {
    texto = fMonto.value;
    const monto = aNumero(fMonto.value);
    if (!(monto > 0)) { poner(salida, h('p.nota', 'Escribí un monto para ver qué comprar.')); return; }
    const usd = moneda === 'USD' ? monto : monto / e.mep;
    const r = repartirAporte(e, usd);
    if (!r.compras.length) { poner(salida, aviso(`Con ${fmt.usd(usd, 2)} no alcanza para una unidad de ningún ETF del núcleo. Queda en caja hasta el próximo aporte.`, 'alerta')); return; }
    const dato = (etq, valor, sub) => h('div', h('p.dato-etq', etq), h('p.dato-valor', valor), sub ? h('p.dato-sub', sub) : null);
    poner(salida, 
      h('div.tabla-caja', h('table.tabla',
        h('thead', h('tr', h('th', 'Comprá'), h('th.num', 'Unidades'), h('th.num', 'Precio $'), h('th.num', 'Monto $'), h('th.num', 'USD'))),
        h('tbody', r.compras.map(c => h('tr', h('td', h('strong.num', c.ticker)), h('td.num', fmt.cant(c.cantidad)), h('td.num', fmt.num(c.precio)), h('td.num', fmt.num(c.monto_ars)), h('td.num', fmt.num(c.monto_usd, 2))))),
        h('tfoot', h('tr', h('td', { colspan: 3 }, 'Total'), h('td.num', fmt.num(r.compras.reduce((a, c) => a + c.monto_ars, 0))), h('td.num', fmt.num(r.invertido_usd, 2)))))),
      h('div.resumen',
        dato('Invertís', fmt.usd(r.invertido_usd, 2), moneda === 'ARS' ? `de ${fmt.ars(monto)}` : `≈ ${fmt.ars(usd * e.mep)}`),
        dato('Costo estimado', fmt.usd(r.costo_usd, 2), `${fmt.pct(r.costo_pct, 2)} del monto`),
        dato('Sobra', fmt.usd(r.sobrante_usd, 2), 'queda en caja')),
      r.supera_c1 ? aviso(`El costo estimado supera el máximo de la regla C1 (${fmt.pct(d.reglas.find(x => x.id === 'C1').max, 2)}). Revisá las comisiones antes de operar.`, 'alerta') : null,
      h('h2', 'Pesos dentro del núcleo'),
      h('div.pesos', Object.entries(r.objetivo).map(([t, obj]) => {
        const max = Math.max(...Object.values(r.objetivo)) * 1.25, pc = x => Math.min(100, x / max * 100) + '%';
        return h('div.peso', h('strong', t),
          h('div.peso-barras', h('span', { style: `width:${pc(r.pesos_antes[t])}` }), h('span.despues', { style: `width:${pc(r.pesos_despues[t])}` }), h('i', { style: `left:${pc(obj)}`, title: `objetivo ${fmt.pct(obj, 0)}` })),
          h('span.peso-txt', `${fmt.pct(r.pesos_antes[t])} → ${fmt.pct(r.pesos_despues[t])} · obj. ${fmt.pct(obj, 0)}`));
      })),
      h('label.casilla', h('input', { type: 'checkbox', checked: deCaja, onchange: ev => { deCaja = ev.target.checked; } }), h('span', 'Es plata que ya estaba en la cuenta'), h('small', 'Marcalo si reinvertís un cupón o dividendo: no cuenta como aporte nuevo.')),
      h('div.acciones.izq', { style: 'margin-top:1.25rem' }, boton('Registrar como ejecutado', () => dialogoCompras(ctx, { titulo: deCaja ? 'Registrar la compra' : 'Registrar el aporte', compras: r.compras, usd, externo: !deCaja }), 'primario')));
  }
  fMonto.addEventListener('input', pintar);
  pintar();
  return h('div.vista.aportar',
    h('header.vista-cab', h('h1', 'Aportar'),
      h('p.nota', activas.length ? `Hoy las reglas (${activas.join(', ')}) habilitan solo el núcleo. Se compra primero lo que está más lejos de su peso.` : 'Los aportes van al núcleo, primero a lo que está más lejos de su peso.')),
    h('div.calc-monto', h('label.campo', h('span.campo-etq', 'Cuánto vas a aportar'), fMonto), conm),
    salida,
    h('p.nota', { style: 'margin-top:2rem' }, `Precios ${e.precios.origen === 'mercado' ? 'actualizados ' + fmt.hace(e.precios.generado) : 'del resumen del ' + fmt.fecha(e.precios.fecha_archivo)} · MEP ${fmt.num(e.mep, 2)}. Usá órdenes límite: el precio puede moverse.`));
}
