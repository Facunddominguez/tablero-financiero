// Pruebas del motor. Corren en el navegador (tests.html) y en Node (tools/pruebas_node.mjs).
// Los valores de control salen de los datos cifrados (control_arranque): acá no hay cifras personales.
import { aplicarEventos, valuar } from './estado.js';
import { evaluarReglas, planificador, repartirAporte } from './motor.js';
import { xirr, costoLoteUSD, rendimiento } from './finanzas.js';
import { clon, fechas, fmt, aNumero } from './util.js';
import { evaluarReglas as _er, recomendarAporte, aporteDelMes } from './motor.js';
import { desdeTabla, desdeTexto, celdasDeCSV, categorizar, patronDe, aNumeroBanco, fechaDe, resumenGastos, NO_GASTO } from './extracto.js';
import { fusionar, sincronizar, ErrorSync } from './sync.js';
import { fortaleza, generarFrase } from './seguridad.js';

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
  // ----- cierre del mes -----
  prueba('Extracto en tabla con débito, crédito y saldo', () => {
    const filas = [['Movimientos de cuenta'], ['Fecha', 'Concepto', 'Débito', 'Crédito', 'Saldo'],
      ['01/10/2026', 'ACREDITACION DE HABERES', '', '1.500.000,00', '1.600.000,00'], ['03/10/2026', 'COMPRA TARJETA COTO 123', '45.300,50', '', '1.554.699,50'],
      ['05/10/2026', 'UBER *TRIP', '8.200,00', '', '1.546.499,50'], ['', 'renglón vacío', '', '', '']];
    const r = desdeTabla(filas);
    if (r.movimientos.length !== 3) throw new Error('movimientos: ' + r.movimientos.length);
    if (r.movimientos[0].m !== 1500000 || r.movimientos[1].m !== -45300.5 || r.movimientos[1].f !== '2026-10-03') throw new Error(JSON.stringify(r.movimientos.slice(0, 2)));
  });
  prueba('Extracto con una sola columna de importe: el signo sale del saldo', () => {
    const csv = 'Fecha;Descripcion;Importe;Saldo\n02/10/26;SALDO INICIAL X;10,00;1.000,00\n03/10/26;CARREFOUR;200,00;800,00\n04/10/26;TRANSFERENCIA RECIBIDA;500,00;1.300,00\n05/10/26;NETFLIX;50,00;1.250,00';
    const r = desdeTabla(celdasDeCSV(csv));
    const m = Object.fromEntries(r.movimientos.map(x => [x.d, x.m]));
    if (m.CARREFOUR !== -200 || m['TRANSFERENCIA RECIBIDA'] !== 500 || m.NETFLIX !== -50) throw new Error(JSON.stringify(m));
  });
  prueba('Extracto como texto (pegado o de un PDF)', () => {
    const t = 'RESUMEN DE CUENTA\nFECHA CONCEPTO DEBITO CREDITO SALDO\nSALDO ANTERIOR 100.000,00\n01/10 HABERES EMPRESA SA 900.000,00 1.000.000,00\n02/10 PAGO SERVICIOS EDENOR 25.000,00 975.000,00\n   REF 0001234\n07/10 FARMACITY 12.500,00 962.500,00\nTOTAL 37.500,00';
    const r = desdeTexto(t, '2026');
    if (r.movimientos.length !== 3) throw new Error('movimientos: ' + JSON.stringify(r.movimientos));
    if (r.movimientos[0].m !== 900000 || r.movimientos[1].m !== -25000 || r.movimientos[2].m !== -12500 || r.movimientos[2].f !== '2026-10-07') throw new Error(JSON.stringify(r.movimientos));
  });
  prueba('Números y fechas de banco', () => {
    const n = [['1.234,56', 1234.56], ['-1.234,56', -1234.56], ['1.234,56-', -1234.56], ['(1.234,56)', -1234.56], ['$ 45.300', 45300], ['1234.5', 1234.5], [77, 77]];
    for (const [a, b] of n) if (aNumeroBanco(a) !== b) throw new Error(`${a} → ${aNumeroBanco(a)}`);
    if (fechaDe('5/3/26') !== '2026-03-05' || fechaDe('05/03', '2026') !== '2026-03-05' || fechaDe('2026-03-05') !== '2026-03-05' || fechaDe('99/99') !== null) throw new Error('fechas');
  });
  prueba('Categorías: reglas generales y lo aprendido de una corrección', () => {
    if (categorizar({ d: 'COMPRA COTO SUC 12', m: -1 }) !== 'Supermercado') throw new Error('COTO');
    if (categorizar({ d: 'HABERES', m: 10 }) !== 'Ingreso') throw new Error('ingreso');
    if (categorizar({ d: 'TRANSF A BALANZ', m: -1 }) !== NO_GASTO) throw new Error('inversión');
    const patron = patronDe('COMPRA TARJETA KIOSCO PEPE 0042');
    if (patron !== 'kiosco pepe') throw new Error('patrón: ' + patron);
    if (categorizar({ d: 'KIOSCO PEPE 0099', m: -1 }, [{ patron, categoria: 'Comida y delivery' }]) !== 'Comida y delivery') throw new Error('no aprendió');
    const r = resumenGastos([{ m: -100, c: 'Supermercado' }, { m: -50, c: NO_GASTO }, { m: 500, c: 'Ingreso' }]);
    if (r.total !== 100 || r.ingresos !== 500) throw new Error('resumen');
  });
  prueba('Recomendación: rango entre el piso de ahorro y todo el sobrante', () => {
    const p = base.perfil, ingreso = p.ingreso_mensual_usd;
    const r = recomendarAporte(e0, { ingreso, gasto: ingreso * 0.5 });
    cerca(r.sobrante, ingreso * 0.5, 1e-9, 'sobrante'); cerca(r.maximo, ingreso * 0.5, 1e-9, 'máximo'); cerca(r.minimo, p.piso_tasa_ahorro * ingreso, 1e-9, 'mínimo');
    const mal = recomendarAporte(e0, { ingreso, gasto: ingreso * 1.2 });
    if (mal.maximo !== 0 || mal.sugerido !== 0 || !mal.motivos.length) throw new Error('con déficit debería dar 0');
  });
  prueba('Cerrar el mes fija el aporte del mes siguiente y alimenta la regla de ahorro', () => {
    const ev = [{ id: 'm', ts: '2026-11-02T10:00:00Z', tipo: 'mes', mes: '2026-10', fecha: '2026-11-02', origen: 'cierre', ingreso: 1000, gasto: 450, aporte: 333, movimientos: [] }];
    const e = valuar(aplicarEventos(limpio, ev), {}, '2026-11-02');
    if (aporteDelMes(e, '2026-11') !== 333) throw new Error('aporte: ' + aporteDelMes(e, '2026-11'));
    const paso = planificador(e, '2026-11-02').pasos.find(p => p.tipo === 'aporte');
    if (!paso || Math.abs(paso.accion.usd - 333) > 1e-9 || paso.accion.extra) throw new Error('el paso Aportá no usa lo decidido');
    if (_er(e).find(r => r.id === 'R2').nivel !== 'ok') throw new Error('R2 no tomó el mes cargado');
  });

  // ----- seguridad -----
  prueba('Fortaleza de la clave: rechaza frases cortas y acepta las largas', () => {
    if (fortaleza('hola1234').acepta) throw new Error('aceptó una clave corta');
    if (fortaleza('casa perro mesa').acepta) throw new Error('aceptó tres palabras');
    if (!fortaleza('lluvia tornillo mandarina puente violeta sombra').acepta) throw new Error('rechazó seis palabras');
    const g = generarFrase();
    if (!/^([a-z]{4}-){5}[a-z]{4}$/.test(g) || !fortaleza(g).acepta || g === generarFrase()) throw new Error('generador: ' + g);
  });

  // ----- sincronización -----
  prueba('Fusionar: une eventos por id y no pierde los de ningún lado', () => {
    const remoto = { meta: {}, x: 'remoto', eventos: [{ id: 'a' }, { id: 'b' }], snapshots: { '2026-01-01': 1 } };
    const local = { meta: {}, x: 'local', eventos: [{ id: 'b' }, { id: 'c' }], snapshots: { '2026-01-02': 2 } };
    const f = fusionar(remoto, local);
    if (f.eventos.map(e => e.id).join() !== 'a,b,c' || f.x !== 'remoto' || Object.keys(f.snapshots).length !== 2 || !f.meta.sincronizado) throw new Error(JSON.stringify(f));
    if (fusionar(remoto, local, { localManda: true }).x !== 'local') throw new Error('respaldo importado debería mandar');
  });
  if (ext.asincronicas) ext.asincronicas.push(['Sincronizar: reintenta ante un conflicto y sube la unión', async () => {
    const b64 = o => btoa(JSON.stringify(o));
    let archivo = { eventos: [{ id: 'a' }], snapshots: {}, meta: {} }, sha = 's1', puts = 0;
    const falso = async (url, o = {}) => {
      if (!o.method) return { ok: true, status: 200, json: async () => ({ content: b64({ ct: archivo }), sha }) };
      const cuerpo = JSON.parse(o.body); puts++;
      if (puts === 1) { archivo = { eventos: [{ id: 'a' }, { id: 'z' }], snapshots: {}, meta: {} }; sha = 's2'; return { ok: false, status: 409 }; } // otro dispositivo se adelantó
      if (cuerpo.sha !== sha) return { ok: false, status: 409 };
      archivo = JSON.parse(atob(cuerpo.content)).ct; sha = 's3';
      return { ok: true, status: 200, json: async () => ({ content: { sha } }) };
    };
    const r = await sincronizar({ gh: { repo: 'u/r', token: 't' }, local: { eventos: [{ id: 'a' }, { id: 'c' }], snapshots: {}, meta: {} }, abrir: async s => s.ct, cerrar: async d => ({ ct: d }) }, falso);
    if (archivo.eventos.map(e => e.id).sort().join() !== 'a,c,z') throw new Error('quedó: ' + archivo.eventos.map(e => e.id).join());
    if (r.enviados !== 1 || r.recibidos !== 1 || puts !== 2) throw new Error(JSON.stringify({ enviados: r.enviados, recibidos: r.recibidos, puts }));
  }], ['Sincronizar: si falla, avisa y no toca lo local', async () => {
    const local = { eventos: [{ id: 'c' }], snapshots: {}, meta: {} };
    const sinRed = async () => { throw new TypeError('fetch failed'); };
    try { await sincronizar({ gh: { repo: 'u/r', token: 't' }, local, abrir: async s => s, cerrar: async d => d }, sinRed); throw new Error('no falló'); }
    catch (err) { if (!(err instanceof ErrorSync) || err.codigo !== 'red') throw err; }
    const sinPermiso = async (url, o = {}) => o.method ? { ok: false, status: 403 } : { ok: true, status: 200, json: async () => ({ content: btoa(JSON.stringify({ eventos: [], meta: {} })), sha: 'x' }) };
    try { await sincronizar({ gh: { repo: 'u/r', token: 't' }, local, abrir: async s => s, cerrar: async d => d }, sinPermiso); throw new Error('no falló'); }
    catch (err) { if (err.codigo !== 'permiso') throw err; }
    if (local.eventos.length !== 1) throw new Error('tocó lo local');
  }]);

  if (ext.historico?.fechas?.length) prueba('Benchmark simulado con los mismos aportes', () => {
    const r = rendimiento(valuar(aplicarEventos(limpio), { historico: ext.historico }, fechaBase));
    if (r.benchmarks.length !== 2 || r.benchmarks.some(b => !(b.valor > 0))) throw new Error('benchmark sin valor');
  });
  return res;
}
