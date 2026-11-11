// Pruebas del motor. Corren en el navegador (tests.html) y en Node (tools/pruebas_node.mjs).
// Los valores de control salen de los datos cifrados (control_arranque): acá no hay cifras personales.
import { aplicarEventos, valuar } from './estado.js';
import { evaluarReglas, planificador, repartirAporte } from './motor.js';
import { xirr, costoLoteUSD, rendimiento } from './finanzas.js';
import { clon, fechas, fmt, aNumero } from './util.js';

export function correrPruebas(base, ext = {}) {
  const res = [];
  const prueba = (nombre, fn) => {
    try { const r = fn(); res.push({ nombre, ok: true, detalle: typeof r === 'string' ? r : '' }); }
    catch (err) { res.push({ nombre, ok: false, detalle: String(err.message || err) }); }
  };
  const cerca = (a, b, tol, que) => { if (Math.abs(a - b) > tol) throw new Error(`${que}: dio ${a.toFixed(4)}, esperado ≈ ${b}`); };
  const limpio = clon(base); limpio.eventos = []; // estado de arranque, sin eventos
  const control = base.control_arranque;
  const fechaBase = base.meta.fecha_snapshot;
  const e0 = valuar(aplicarEventos(limpio), {}, fechaBase);
  const nucleo = new Set(Object.keys(base.nucleo.pesos_internos));

  prueba('Total de arranque ≈ control', () => cerca(e0.total_usd, control.total_usd, 5, 'total USD'));
  prueba('Total en ARS ≈ informado por Balanz', () => cerca(e0.total_ars / base.meta.total_ars_informado, 1, 0.0005, 'total ARS / informado'));
  prueba('Núcleo sobre LP ≈ control', () => cerca(e0.nucleo_lp, control.nucleo_lp, 0.002, 'núcleo/LP'));
  prueba('YPF consolidada ≈ control', () => cerca(e0.ypf_lp, control.ypf_lp, 0.005, 'YPF/LP'));
  prueba('LP = total − emergencia', () => cerca(e0.lp_usd, e0.total_usd - e0.emergencia_usd, 0.01, 'LP'));
  prueba('Las cantidades de los lotes coinciden con las posiciones', () => {
    for (const p of limpio.posiciones) {
      const s = limpio.lotes_costo.filter(l => l.ticker === p.ticker).reduce((a, l) => a + l.cantidad, 0);
      if (Math.abs(s - p.cantidad) > 0.01) throw new Error(`${p.ticker}: lotes ${s} vs posición ${p.cantidad}`);
    }
  });

  const reglas = evaluarReglas(e0), R = Object.fromEntries(reglas.map(r => [r.id, r]));
  prueba('R3 activa (núcleo bajo el mínimo)', () => { if (!R.R3.activa) throw new Error('R3 no está activa'); });
  prueba('R7 activa (tesis nuevas bloqueadas)', () => { if (!R.R7.activa) throw new Error('R7 no está activa'); });
  prueba('R1 en orden (emergencia cubierta)', () => { if (R.R1.nivel !== 'ok') throw new Error('R1: ' + R.R1.nivel); });
  prueba('Todas las reglas de los datos se evalúan', () => {
    const faltan = base.reglas.map(r => r.id).filter(id => !R[id]);
    if (faltan.length) throw new Error('sin evaluar: ' + faltan.join(', '));
  });

  prueba('Planificador al 01/12: incluye Aportar con compras solo del núcleo', () => {
    const e = valuar(aplicarEventos(limpio), {}, '2026-12-01');
    const paso = planificador(e, '2026-12-01').pasos.find(p => p.tipo === 'aporte');
    if (!paso) throw new Error('no apareció el paso Aportar');
    if (!paso.accion.compras.length) throw new Error('el paso no trae compras');
    const mal = paso.accion.compras.filter(c => !nucleo.has(c.ticker) || !Number.isInteger(c.cantidad));
    if (mal.length) throw new Error('compras fuera del núcleo o fraccionadas: ' + mal.map(c => c.ticker).join(', '));
  });
  const ahorro = base.perfil.ingreso_mensual_usd - base.perfil.gasto_habitual_mensual_usd;
  prueba('Un aporte del ahorro mensual compra solo núcleo, en unidades enteras y sin pasarse', () => {
    const r = repartirAporte(e0, ahorro);
    if (!r.compras.length) throw new Error('no compró nada');
    if (r.compras.some(c => !nucleo.has(c.ticker) || !Number.isInteger(c.cantidad) || c.cantidad <= 0)) throw new Error('compra inválida');
    if (r.invertido_usd + r.costo_usd > ahorro + 0.01) throw new Error('gasta más de lo aportado');
    if (r.sobrante_usd < -0.01 || r.sobrante_usd > 35) throw new Error('sobrante raro: ' + r.sobrante_usd.toFixed(2));
    cerca(r.invertido_usd + r.costo_usd + r.sobrante_usd, ahorro, 0.01, 'invertido + costo + sobrante');
  });
  prueba('El aporte acerca los pesos del núcleo a su objetivo', () => {
    const r = repartirAporte(e0, ahorro);
    const dist = p => Object.entries(r.objetivo).reduce((a, [t, o]) => a + Math.abs((p[t] || 0) - o), 0);
    if (dist(r.pesos_despues) > dist(r.pesos_antes) + 1e-9) throw new Error('los pesos se alejan del objetivo');
  });
  prueba('Con datos de hace 40 días aparece "Subí el Excel"', () => {
    const hoy = fechas.sumar(fechaBase, 40);
    const p = planificador(valuar(aplicarEventos(limpio), {}, hoy), hoy).pasos;
    if (!p.some(x => x.tipo === 'datos' && /Excel/.test(x.titulo))) throw new Error('no apareció');
  });
  prueba('Con datos de hace 20 días NO aparece "Subí el Excel"', () => {
    const hoy = fechas.sumar(fechaBase, 20);
    if (planificador(valuar(aplicarEventos(limpio), {}, hoy), hoy).pasos.some(x => x.tipo === 'datos')) throw new Error('apareció antes de tiempo');
  });
  prueba('El aporte con fecha estimada aparece como pendiente', () => {
    if (!planificador(e0, fechaBase).pasos.some(p => p.tipo === 'pendiente')) throw new Error('no apareció');
  });
  prueba('El planificador nunca propone compras fuera del núcleo', () => {
    for (const hoy of ['2026-11-10', '2026-12-01', '2027-01-14', '2027-01-20', '2027-04-02', '2027-07-15']) {
      for (const p of planificador(valuar(aplicarEventos(limpio), {}, hoy), hoy).pasos)
        for (const c of p.accion?.compras || []) if (!nucleo.has(c.ticker)) throw new Error(`${hoy}: ${p.titulo} → ${c.ticker}`);
    }
  });
  prueba('El cupón de la ON se avisa antes y se pide registrar después', () => {
    const cal = ext.calendario; if (!cal?.flujos?.length) return 'sin calendario cargado: se omite';
    const f = cal.flujos[0];
    const antes = fechas.sumar(f.fecha, -3), despues = fechas.sumar(f.fecha, 2);
    if (!planificador(valuar(aplicarEventos(limpio), { calendario: cal }, antes), antes).pasos.some(p => p.tipo === 'aviso')) throw new Error('sin aviso previo');
    if (!planificador(valuar(aplicarEventos(limpio), { calendario: cal }, despues), despues).pasos.some(p => p.tipo === 'flujo')) throw new Error('sin paso de cobro');
  });
  prueba('Registrar el aporte lo saca de la lista y actualiza posiciones y aportes', () => {
    const hoy = '2026-12-01';
    const e = valuar(aplicarEventos(limpio), {}, hoy);
    const paso = planificador(e, hoy).pasos.find(p => p.tipo === 'aporte');
    const ev = [{ id: 'a', ts: hoy + 'T12:00:00Z', tipo: 'aporte', fecha: hoy, usd: paso.accion.usd, mep: e.mep, compras: paso.accion.compras.map(c => ({ ticker: c.ticker, cantidad: c.cantidad, precio: c.precio, gastos: c.gastos })) }];
    const e2 = valuar(aplicarEventos(limpio, ev), {}, hoy);
    if (planificador(e2, hoy).pasos.some(p => p.tipo === 'aporte')) throw new Error('el paso sigue apareciendo');
    cerca(e2.total_usd - e.total_usd, paso.accion.usd - paso.accion.compras.reduce((a, c) => a + c.gastos, 0) / e.mep, 0.5, 'suba del patrimonio');
    if (e2.datos.cashflows_externos_usd.length !== e.datos.cashflows_externos_usd.length + 1) throw new Error('no se registró el aporte externo');
    if (e2.nucleo_lp <= e.nucleo_lp) throw new Error('el núcleo no subió');
  });
  prueba('Una venta descuenta lotes por FIFO y registra el resultado', () => {
    const p = limpio.posiciones.find(x => limpio.lotes_costo.filter(l => l.ticker === x.ticker).length > 1 && x.tipo === 'cedear');
    const ev = [{ id: 'v', ts: '2026-11-20T12:00:00Z', tipo: 'venta', fecha: '2026-11-20', ticker: p.ticker, cantidad: 1, precio: p.precio, gastos: 0, mep: e0.mep }];
    const d2 = aplicarEventos(limpio, ev);
    if (d2.posiciones.find(x => x.ticker === p.ticker).cantidad !== p.cantidad - 1) throw new Error('cantidad mal');
    if (d2.realizados.length !== 1) throw new Error('sin resultado realizado');
  });
  prueba('Costo de un lote en USD al MEP de la compra', () => {
    cerca(costoLoteUSD({ cantidad: 10, precio_compra: 1000, moneda: 'ARS', gastos: 100, mep_dia: 1000 }), 10.1, 1e-9, 'lote ARS');
    cerca(costoLoteUSD({ cantidad: 10, precio_compra: 2, moneda: 'USD', gastos: 1000, mep_dia: 1000 }), 21, 1e-9, 'lote USD');
  });
  prueba('XIRR: 100 que se vuelven 110 en un año = 10%', () => cerca(xirr([{ fecha: '2025-01-01', monto: -100 }, { fecha: '2026-01-01', monto: 110 }]), 0.10, 1e-4, 'xirr'));
  prueba('XIRR de la cartera se puede calcular', () => { const r = rendimiento(e0).cartera.xirr; if (r == null || !isFinite(r)) throw new Error('sin resultado'); return `XIRR calculado`; });
  prueba('Formato es-AR', () => {
    if (fmt.num(1234.56, 2) !== '1.234,56') throw new Error(fmt.num(1234.56, 2));
    if (fmt.num(98765) !== '98.765') throw new Error(fmt.num(98765));
    if (aNumero('1.234,56') !== 1234.56 || aNumero('1234.5') !== 1234.5) throw new Error('aNumero');
  });
  if (ext.historico?.fechas?.length) prueba('Benchmark simulado con los mismos aportes', () => {
    const r = rendimiento(valuar(aplicarEventos(limpio), { historico: ext.historico }, fechaBase));
    if (r.benchmarks.length !== 2 || r.benchmarks.some(b => !(b.valor > 0))) throw new Error('benchmark sin valor');
  });
  return res;
}
