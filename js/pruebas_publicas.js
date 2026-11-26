// Pruebas que no necesitan tus datos: corren en cada PR (GitHub Actions) y también dentro de tests.html.
// Devuelve [nombre, fn] como las asincrónicas de js/pruebas.js.
import { tickersPropios, esRespaldoPlano, snapshotDe, aplicarEventos, valuar } from './estado.js';
import { precioJusto, referenciaImplicito, especieD, conDolares, ventanaDelDia, textoVentana } from './precios.js';
import { repartirAporte, planificador, movimientosFuertes } from './motor.js';
import { volatilidadReciente } from './finanzas.js';
import { ejemplo } from './ejemplo.js';
import { riesgo, inversaNormal } from './riesgo.js';
import { puntajePredicciones, compararFantasmas, contraReferencia, eventosRotacion } from './diario.js';
import { proximaAccion } from './motor.js';
import { fusionar } from './sync.js';
import { deflactor, rendimiento, xirr, curvaPorcentual, inicioDelPeriodo, historiaCartera, resumenPeriodo, benchmarks, rendimientoPorBloque, canjeDe } from './finanzas.js';
import { proximosFlujos } from './motor.js';
import { derivarClave, cifrar, descifrar, esSobreCifrado } from './cripto.js';

const cerca = (a, b, tol, que) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${que}: dio ${a}, esperado ≈ ${b}`); };

// Cartera mínima para el canje: un CEDEAR de SPY comprado el primer día, sin movimiento del subyacente.
// canjes = [CCL/MEP el 1/1, CCL/MEP hoy]. Con registros diarios de los dos días si `registros`.
function carteraConCanje(canjes, { precios = [100, 100], registros = false } = {}) {
  const [c0, c1] = canjes, v0 = 10, v1 = 10 * precios[1] / precios[0] * c1 / c0;
  const hist = { fechas: ['2025-01-02', '2026-03-02'], series: { SPY: precios, MEP: [1000, 1000], CCL: [1000 * c0, 1000 * c1] } };
  return {
    hoy: '2026-03-02', historico: hist, total_usd: v1, mep: 1000, ccl: 1000 * c1,
    posiciones: [{ ticker: 'SPY', tipo: 'cedear', grupo: 'nucleo', subyacente: 'SPY', cantidad: 1, valor_usd: v1 }],
    datos: {
      lotes_costo: [{ ticker: 'SPY', cantidad: 1, fecha_compra: '2025-01-02', precio_compra: v0, moneda: 'USD', mep_dia: 1 }],
      cashflows_externos_usd: [{ fecha: '2025-01-02', usd: v0 }],
      snapshots: registros ? { '2025-01-02': { t: v0, x: v0, mep: 1000, ccl: 1000 * c0 }, '2026-03-02': { t: v1, x: v1, mep: 1000, ccl: 1000 * c1 } } : { '2026-03-02': { t: v1 } },
      nucleo: { pesos_internos: { SPY: 1 } },
    },
  };
}
const periodoTodo = e => { const h = historiaCartera(e); return resumenPeriodo(e, h, benchmarks(e, h.flujos), 'todo'); };

// Estado mínimo para el reparto: dos ETF del núcleo con el mismo peso objetivo y precios sintéticos.
// primas = cuánto más caro que su precio justo está cada CEDEAR (null: sin datos de precio justo).
function estadoReparto({ primas = { AAA: 0, BBB: 0 }, cantidades = { AAA: 10, BBB: 10 }, hoy = '2026-11-30', viejo = false, usdD = null, cajaUSD = 0 } = {}) {
  const precio = t => Math.round(10000 * (1 + (primas?.[t] ?? 0)));
  const cedears = { AAA: [precio('AAA'), 0], BBB: [precio('BBB'), 0] };
  if (usdD) for (const [t, v] of Object.entries(usdD)) cedears[t] = [v, 0];
  const papeles = Object.fromEntries(['P1', 'P2', 'P3', 'P4', 'P5'].map((t, i) => [t, [1000, 100 - i]]));
  return {
    hoy, mep: 1000, ccl: 1000, caja_usd: cajaUSD,
    ratios: { AAA: { ratio: 10 }, BBB: { ratio: 10 } },
    mercado: primas && { generado: `${viejo ? '2026-11-20' : hoy}T15:00:00Z`, cedears: { precios: cedears }, implicito: { usa: { precios: { AAA: [100, 0], BBB: [100, 0] } }, ccl: { papeles } } },
    posiciones: ['AAA', 'BBB'].map(t => ({ ticker: t, cantidad: cantidades[t], precio_ars: precio(t) })),
    datos: { config: { costo_entrada_estimado: 0 }, caja: { USD_MEP: cajaUSD }, nucleo: { pesos_internos: { AAA: 0.5, BBB: 0.5 }, banda_interna_pp: 0.03 }, reglas: [] },
  };
}
const unidades = r => Object.fromEntries(r.compras.map(c => [c.especie || c.ticker, c.cantidad]));
const igual = (a, b, que) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${que}: ${JSON.stringify(a)}`); };

// Dos activos con volatilidad diaria a y b y correlación exacta rho: dos patrones ortogonales de media cero.
function carteraDosActivos(a, b, rho, n = 400) {
  const A = [100], B = [50], fs = ['2025-01-01'];
  for (let i = 0; i < n; i++) {
    const p = i % 2 ? -1 : 1, q = i % 4 < 2 ? 1 : -1;
    A.push(A[i] * (1 + a * p)); B.push(B[i] * (1 + b * (rho * p + Math.sqrt(1 - rho * rho) * q)));
    fs.push(new Date(Date.UTC(2025, 0, 2 + i)).toISOString().slice(0, 10));
  }
  const pos = (ticker, usd) => ({ ticker, tipo: 'cedear', grupo: ticker === 'AAA' ? 'nucleo' : 'satelite', subyacente: ticker, moneda: 'ARS', valor_usd: usd });
  return {
    hoy: fs.at(-1), mep: 1000, lp_usd: 1000, caja_usd: 0,
    historico: { fechas: fs, series: { AAA: A, BBB: B } },
    posiciones: [pos('AAA', 600), pos('BBB', 400)],
    datos: { posiciones: [{ ticker: 'AAA' }, { ticker: 'BBB' }], caja: { ARS: 0 }, riesgo: { ventana_dias: n } },
  };
}

// Cartera de ejemplo con un movimiento del día elegido y series que siempre se mueven lo mismo.
function carteraConMovimiento(movimientos, { amplitud = { SPY: 0.01, NVDA: 0.01, PAM: 0.02, MEP: 0.002 }, hoy = '2026-11-30', usa = -3, generado } = {}) {
  const { datos, ext } = ejemplo({ hoy });
  datos.alertas = { critico: { dia: { nucleo: 0.05, satelite: 0.1, on: 0.04, mep: 0.05 } }, aviso: { dia: { nucleo: 0.03, satelite: 0.06, on: 0.02, mep: 0.03, watchlist: 0.08 } } };
  const h = ext.historico;
  for (const [t, a] of Object.entries(amplitud)) h.series[t] = h.fechas.map((_, i) => 100 * (i % 2 ? 1 + a : 1));
  for (const [t, pct] of Object.entries(movimientos)) {
    const tabla = ['PAMP'].includes(t) ? ext.mercado.acciones : t === 'ON1' ? ext.mercado.ons : ext.mercado.cedears;
    tabla.precios[t][1] = pct;
  }
  ext.mercado.cedears.precios = { ...ext.mercado.cedears.precios };
  for (const t of Object.keys(ext.mercado.cedears.precios)) if (!(t in movimientos)) ext.mercado.cedears.precios[t] = [ext.mercado.cedears.precios[t][0], 0];
  ext.mercado.acciones.precios.PAMP[1] = movimientos.PAMP ?? 0; ext.mercado.ons.precios.ON1[1] = movimientos.ON1 ?? 0;
  ext.mercado.fx.mep_prev = ext.mercado.fx.mep;
  ext.mercado.implicito.usa.precios.NVDA = [150, usa];
  if (generado) ext.mercado.generado = generado;
  return valuar(aplicarEventos(datos), ext, hoy);
}

export function pruebasPublicas() {
  return [
    ['Predicciones: puntaje de Brier y acierto por rango de probabilidad', async () => {
      const p = (probabilidad, cumplio) => ({ probabilidad, cumplio });
      const r = puntajePredicciones([p(0.9, true), p(0.9, false), p(0.3, false), p(1, true), p(0.5)]);
      cerca(r.brier, (0.01 + 0.81 + 0.09 + 0) / 4, 1e-12, 'Brier');
      if (r.resueltas !== 4 || r.pendientes !== 1) throw new Error(JSON.stringify(r));
      const alto = r.rangos.at(-1);
      if (alto.cantidad !== 3) throw new Error('el 100% va en el último rango');
      cerca(alto.acierto, 2 / 3, 1e-12, 'acierto alto'); cerca(alto.esperado, 2.8 / 3, 1e-12, 'esperado alto');
      if (r.rangos[1].cantidad !== 1 || r.rangos[1].acierto !== 0 || r.rangos[0].acierto !== null) throw new Error(JSON.stringify(r.rangos));
      if (puntajePredicciones([]).brier !== null) throw new Error('sin predicciones no hay puntaje');
    }],

    ['Predicciones: al vencer aparece el paso en Hoy y al marcarla deja de aparecer', async () => {
      const { datos, ext } = ejemplo();
      const nueva = { id: 'p1', ts: '2026-11-02T10:00:00Z', tipo: 'prediccion', fecha: '2026-11-02', texto: 'KO sube más que SPY', probabilidad: 0.7, vence: '2026-11-30', cambio: 'si recorta el dividendo', ticker: 'KO' };
      const pasos = (ev, hoy) => planificador(valuar(aplicarEventos(datos, ev), ext, hoy), hoy).pasos;
      const sinDiario = pasos([], '2026-11-30').map(p => p.id);
      const antes = pasos([nueva], '2026-11-29');
      if (antes.some(p => p.tipo === 'prediccion')) throw new Error('apareció antes de vencer');
      const prox = proximaAccion(valuar(aplicarEventos(datos, [{ ...nueva, vence: '2026-11-30' }]), ext, '2026-11-29'));
      if (prox.fecha !== '2026-11-30') throw new Error(JSON.stringify(prox));
      const al = pasos([nueva], '2026-11-30'), paso = al.find(p => p.tipo === 'prediccion');
      if (!paso || paso.accion.ref !== 'p1' || !/70%/.test(paso.porque) || !/recorta el dividendo/.test(paso.como.join())) throw new Error(JSON.stringify(paso));
      igual(al.filter(p => p.tipo !== 'prediccion').map(p => p.id), sinDiario, 'es lo único nuevo');
      const marcada = [nueva, { id: 'r', ts: '2026-11-30T12:00:00Z', tipo: 'prediccion_resultado', ref: 'p1', cumplio: true, fecha: '2026-11-30' }];
      if (pasos(marcada, '2026-12-05').some(p => p.tipo === 'prediccion')) throw new Error('sigue apareciendo');
      if (puntajePredicciones(aplicarEventos(datos, marcada).predicciones).resueltas !== 1) throw new Error('no quedó resuelta');
      // Se sincroniza como cualquier otro cambio.
      const unida = fusionar({ ...datos, eventos: [nueva] }, { ...datos, eventos: marcada });
      if (aplicarEventos(unida).predicciones[0].cumplio !== true) throw new Error('la sincronización perdió el resultado');
    }],

    ['Fantasmas: contra SPY a 1, 3, 6 y 12 meses, solo lo que ya pasó, y avisa qué falta pedir', async () => {
      const fs = ['2026-01-02', '2026-02-02', '2026-04-02', '2026-07-02', '2026-08-03'];
      const e = { hoy: '2026-08-04', ratios: { BRKB: { ratio: 22, usa: 'BRK.B' } }, historico: { fechas: fs, series: { SPY: [100, 110, 110, 120, 125], KO: [50, 60, 45, 66, 70], MEP: [1, 1, 1, 1, 1] } },
        datos: { fantasmas: [{ origen: 'watchlist', ticker: 'KO', fecha: '2026-01-02' }, { origen: 'allaria', ticker: 'KO', fecha: '2026-01-02', grupo: 'Allaria P9' }, { origen: 'allaria', ticker: 'BRKB', fecha: '2026-01-02', grupo: 'Allaria P9' }, { origen: 'allaria', ticker: 'SPY', fecha: '2026-01-02', grupo: 'Allaria P9' }] } };
      const r = compararFantasmas(e);
      igual(r.faltan, ['BRK.B'], 'avisa con el ticker que hay que sumar');
      const w = r.grupos.find(g => g.origen === 'watchlist').filas[0];
      cerca(w.plazos[1].rend, 0.2, 1e-12, 'KO a 1 mes'); cerca(w.plazos[1].ref, 0.1, 1e-12, 'SPY a 1 mes'); cerca(w.plazos[1].dif, 0.1, 1e-12, 'diferencia');
      cerca(w.plazos[3].rend, -0.1, 1e-12, 'a 3 meses'); cerca(w.plazos[6].rend, 66 / 50 - 1, 1e-12, 'a 6 meses');
      if (w.plazos[12] !== null) throw new Error('12 meses todavía no pasó');
      cerca(w.hoy.rend, 0.4, 1e-12, 'hasta hoy');
      const a = r.grupos.find(g => g.origen === 'allaria');
      cerca(a.promedio.plazos[1].rend, (0.2 + 0.1) / 2, 1e-12, 'cartera con el mismo peso (sin el que no tiene precios)');
      if (a.promedio.plazos[1].cantidad !== 2) throw new Error('cantidad');
      // Entre dos fechas sin un cierre posterior al de entrada no hay resultado.
      e.datos.fantasmas = [{ origen: 'radar', ticker: 'KO', fecha: '2026-01-01' }];
      const hueco = compararFantasmas(e).grupos[0].filas[0];
      if (hueco.plazos[1] !== null || !hueco.plazos[3]) throw new Error(JSON.stringify(hueco.plazos));
    }],

    ['Satélites contra su referencia, configurable en los datos', async () => {
      const { datos, ext } = ejemplo();
      const e = valuar(aplicarEventos(datos), ext, '2026-11-30'), r = contraReferencia(e);
      const f = Object.fromEntries(r.filas.map(x => [x.ticker, x]));
      if (f.NVDA.referencia !== 'SMH' || f.PAMP.referencia !== 'ARGT' || f.PAMP.serie !== 'PAM') throw new Error(JSON.stringify(r.filas.map(x => [x.ticker, x.serie, x.referencia])));
      if (f.ON1 || f.SPY || r.faltan.length) throw new Error('solo las acciones satélite: ' + JSON.stringify(r.faltan));
      const s = ext.historico.series, i = ext.historico.fechas.indexOf('2026-05-04'), n = ext.historico.fechas.length - 1;
      cerca(f.NVDA.compra.rend, s.NVDA[n] / s.NVDA[i] - 1, 1e-12, 'desde la compra'); cerca(f.NVDA.compra.ref, s.SMH[n] / s.SMH[i] - 1, 1e-12, 'la referencia');
      if (!f.NVDA.tres || !f.NVDA.doce) throw new Error('faltan los 3 y 12 meses');
      datos.referencias = { NVDA: 'QQQ' };
      const x = contraReferencia(valuar(aplicarEventos(datos), ext, '2026-11-30'));
      if (x.filas.find(v => v.ticker === 'NVDA').referencia !== 'QQQ' || !x.faltan.includes('QQQ')) throw new Error('no tomó la referencia de los datos');
    }],

    ['Una rotación nueva de Allaria guarda la fecha, actualiza la cartera modelo y entra como fantasma', async () => {
      const { datos, ext } = ejemplo();
      const ev = eventosRotacion(datos, { fecha: '2026-11-20', rotacion: 'P4', entra: ['MSFT'], sale: ['KO'] }, '2026-11-30').map((x, i) => ({ id: 'r' + i, ts: `2026-11-30T10:00:0${i}Z`, ...x }));
      const d = aplicarEventos(datos, ev), a = d.cartera_modelo_allaria;
      igual(a.activos.map(x => x.ticker), ['AAPL', 'SPY', 'MSFT'], 'cartera nueva');
      if (a.rotacion !== 'P4' || a.fecha !== '2026-11-20' || a.rotaciones.at(-1).fecha !== '2026-11-20' || a.ultimos_cambios[0].entra !== 'MSFT') throw new Error(JSON.stringify(a));
      igual(d.fantasmas.map(f => [f.origen, f.ticker, f.fecha]), [['allaria', 'AAPL', '2026-11-20'], ['allaria', 'SPY', '2026-11-20'], ['allaria', 'MSFT', '2026-11-20']], 'fantasmas');
      if (planificador(valuar(d, ext, '2026-11-30'), '2026-11-30').pasos.some(p => /allaria|fantasma/i.test(p.id + p.titulo))) throw new Error('no tiene que crear tareas');
    }],

    ['Avisos de precio: el umbral es un múltiplo de lo que cada activo suele moverse', async () => {
      // Con ±1% por día: satélite avisa en 2,5% y es crítico en 4%; el núcleo, ×1,25.
      const e = carteraConMovimiento({ SPY: -4.5, NVDA: -4.5, PAMP: -4.5, ON1: -4.5 });
      cerca(volatilidadReciente(e.historico, 'SPY', e.hoy), (1.01 - 1 + (1 - 1 / 1.01)) / 2, 2e-4, 'volatilidad');
      const m = Object.fromEntries(movimientosFuertes(e).map(x => [x.ticker, x]));
      if (m.SPY.nivel !== 'aviso' || m.NVDA.nivel !== 'critico') throw new Error(JSON.stringify([m.SPY, m.NVDA]));
      if (m.PAMP) throw new Error('PAMP se mueve ±2% por día: 4,5% no llega a 2,5 veces');
      if (m.ON1.propio || m.ON1.umbral !== 0.04 || m.ON1.nivel !== 'critico') throw new Error('la ON usa el umbral fijo: ' + JSON.stringify(m.ON1));
      cerca(m.SPY.umbral / m.NVDA.umbral, 2.5 * 1.25 / 4, 0.01, 'multiplicador del núcleo');
      // Editable en los datos.
      e.datos.alertas.volatilidad = { critico: 10, grupo: { nucleo: 3 }, tope: 0 };
      const x = Object.fromEntries(movimientosFuertes(e).map(v => [v.ticker, v]));
      if (x.SPY || x.NVDA.nivel !== 'aviso') throw new Error('no tomó los parámetros editados');
    }],

    ['Avisos de precio: después de saltos grandes el umbral no pasa de 1,5 veces el fijo', async () => {
      // Con ±5% por día, 4 veces serían 20% (25% en el núcleo): quedan en 7,5% el núcleo y 15% los satélites.
      const volatil = { SPY: 0.05, NVDA: 0.05, PAM: 0.05, MEP: 0.002 };
      const e = carteraConMovimiento({ SPY: -8, NVDA: -16, PAMP: -10 }, { amplitud: volatil });
      const m = Object.fromEntries(movimientosFuertes(e).map(x => [x.ticker, x]));
      cerca(m.SPY.umbral, 0.075, 1e-12, 'núcleo'); cerca(m.NVDA.umbral, 0.15, 1e-12, 'satélite');
      if (m.SPY.nivel !== 'critico' || m.NVDA.nivel !== 'critico' || !m.SPY.topeado) throw new Error(JSON.stringify([m.SPY, m.NVDA]));
      // El aviso tiene su propio máximo (1,5 × 6%): −10% no llega a crítico pero sí a aviso.
      if (m.PAMP.nivel !== 'aviso') throw new Error(JSON.stringify(m.PAMP)); cerca(m.PAMP.umbral, 0.09, 1e-12, 'aviso');
      const paso = planificador(e, e.hoy).pasos.find(p => p.id === `precio-SPY-${e.hoy}`);
      if (!/Pasa el máximo de tu umbral \(±7,5%\)/.test(paso.porque)) throw new Error(paso.porque);
    }],

    ['Avisos de precio: un CEDEAR explica cuánto fue EE.UU. y cuánto el dólar implícito', async () => {
      const paso = e => planificador(e, e.hoy).pasos.find(p => p.id === `precio-NVDA-${e.hoy}`);
      const p = paso(carteraConMovimiento({ NVDA: -4.5 }));
      if (!p.informativo || p.accion || !/En EE.UU. NVDA se movió −3,0% y el dólar implícito contra el MEP puso −1,5%/.test(p.porque)) throw new Error(p.porque);
      const feriado = paso(carteraConMovimiento({ NVDA: -4.5 }, { generado: '2026-11-26T18:00:00Z', hoy: '2026-11-26' }));
      if (!/Wall Street no operó/.test(feriado.porque)) throw new Error(feriado.porque);
      if (!/todavía no abrió/.test(paso(carteraConMovimiento({ NVDA: -4.5 }, { generado: '2026-11-30T14:20:00Z' })).porque)) throw new Error('antes de abrir');
      const pasos = planificador(carteraConMovimiento({ ON1: -4.5 }), '2026-11-30').pasos.find(x => x.id.startsWith('precio-ON1'));
      if (/EE\.UU/.test(pasos.porque)) throw new Error('una ON no es un CEDEAR');
    }],

    ['Riesgo: dos activos con correlación conocida dan el resultado analítico', async () => {
      for (const rho of [-0.5, 0, 0.3, 1]) {
        const a = 0.01, b = 0.03, w1 = 0.6, w2 = 0.4, n = 400, r = riesgo(carteraDosActivos(a, b, rho, n));
        const base = w1 * w1 * a * a + w2 * w2 * b * b + 2 * rho * w1 * w2 * a * b; // varianza diaria (sin el n/(n−1) muestral)
        cerca(r.correlaciones.AAA.BBB, rho, 1e-9, 'correlación');
        cerca(r.sigma_mes, Math.sqrt(base * n / (n - 1) * 21), 1e-9, `volatilidad del mes con rho ${rho}`);
        cerca(r.posiciones.AAA.parte, w1 * (w1 * a * a + w2 * rho * a * b) / base, 1e-9, 'aporte de AAA');
        cerca(r.posiciones.BBB.parte, w2 * (w2 * b * b + w1 * rho * a * b) / base, 1e-9, 'aporte de BBB');
        cerca(r.bloques.reduce((s, x) => s + x.riesgo, 0), 1, 1e-9, 'los bloques suman 100%');
        cerca(r.mes_malo_usd, 1.6448536269514722 * r.sigma_mes * 1000, 1e-5, 'mes malo, percentil 5');
      }
      cerca(inversaNormal(0.05), -1.6448536269514722, 1e-8, 'percentil 5'); cerca(inversaNormal(0.01), -2.3263478740408408, 1e-8, 'percentil 1');
    }],

    ['Riesgo: cada cosa se mide con su serie, lo sin serie con supuestos, y los parámetros se editan en los datos', async () => {
      const { datos, ext } = ejemplo();
      const e = valuar(aplicarEventos(datos), ext, '2026-11-30'), r = riesgo(e);
      const de = t => r.posiciones[t];
      if (de('SPY').serie !== 'SPY' || de('PAMP').serie !== 'PAM' || de('Caja en pesos').serie !== 'MEP') throw new Error('mapa de series');
      if (de('ON1').supuesto !== 'on' || de('ON1').serie !== null) throw new Error('la ON usa volatilidad fija');
      cerca(de('ON1').vol_anual, 0.08, 1e-9, 'vol de la ON');
      if (r.posiciones.FCIP || r.posiciones.FCID) throw new Error('la emergencia queda afuera');
      cerca(r.valor, e.lp_usd, 0.01, 'cartera de largo plazo');
      cerca(r.bloques.reduce((s, x) => s + x.peso, 0), 1, 1e-9, 'pesos'); cerca(r.bloques.reduce((s, x) => s + x.riesgo, 0), 1, 1e-9, 'riesgo');
      const { peor_cada_uno: p, crisis: c } = r.escenarios;
      if (!(p.usd > r.mes_malo_usd * 0.5) || !(c.usd > 0) || !(c.usd < p.usd) || !(c.series.YPF < 0 && c.series.PAM < 0 && c.series.MEP < 0)) throw new Error(JSON.stringify(r.escenarios));
      // Editado en los datos: otra volatilidad para la ON, PAMP forzado a la serie de YPF y un activo sin historia.
      const otro = ejemplo();
      otro.datos.riesgo = { vol_fija: { on: 0.2 }, series: { PAMP: 'YPF' } };
      delete otro.ext.historico.series.NVDA;
      const s = riesgo(valuar(aplicarEventos(otro.datos), otro.ext, '2026-11-30'));
      cerca(s.posiciones.ON1.vol_anual, 0.2, 1e-9, 'vol editada');
      if (s.posiciones.PAMP.serie !== 'YPF' || s.posiciones.NVDA.supuesto !== 'sin_serie' || s.sin_serie.join() !== 'NVDA') throw new Error(JSON.stringify(s.sin_serie));
      if (!s.supuestos.some(x => /NVDA/.test(x) && /historico_extra/.test(x))) throw new Error('falta avisar qué sumar');
      if (riesgo(valuar(aplicarEventos(datos), { ...ext, historico: null }, '2026-11-30')) !== null) throw new Error('sin histórico no hay riesgo');
    }],

    ['Precio justo: subyacente × dólar implícito de referencia ÷ ratio', async () => {
      const e = estadoReparto({ primas: { AAA: 0.02, BBB: 0 } });
      // un papel de poco volumen no entra en la mediana
      e.datos.config.papeles_liquidos = 5; e.mercado.implicito.ccl.papeles.RARO = [5000, 1];
      cerca(referenciaImplicito(e), 1000, 1e-9, 'mediana');
      const j = precioJusto(e, 'AAA');
      cerca(j.justo_ars, 100 * 1000 / 10, 1e-9, 'precio justo'); cerca(j.prima, 0.02, 1e-9, 'prima'); cerca(j.implicito, 1020, 1e-9, 'dólar implícito');
      if (j.revisar) throw new Error('2% no es para revisar');
      if (!precioJusto(estadoReparto({ primas: { AAA: 0.2, BBB: 0 } }), 'AAA').revisar) throw new Error('20% hay que revisar el ratio');
      if (precioJusto(e, 'CCC') !== null) throw new Error('sin ratio no hay precio justo');
      if (precioJusto(estadoReparto({ viejo: true }), 'AAA') !== null) throw new Error('con precios de hace días no se calcula');
      const stale = estadoReparto(); stale.mercado.implicito.usa.stale = true;
      if (precioJusto(stale, 'AAA') !== null) throw new Error('con precios sin actualizar no se calcula');
    }],

    ['Precio justo: solo con precios tomados con Wall Street abierto', async () => {
      const con = (generado, extra = {}) => { const e = estadoReparto({ hoy: generado.slice(0, 10), primas: { AAA: 0.03, BBB: 0 }, cantidades: { AAA: 5, BBB: 5 } }); e.mercado.generado = generado; return Object.assign(e, extra); };
      if (!precioJusto(con('2026-11-30T14:31:00Z'), 'AAA')) throw new Error('abierto: tiene que haber precio justo');
      for (const [g, que] of [['2026-11-30T14:20:00Z', 'antes de abrir'], ['2026-11-28T15:00:00Z', 'sábado']]) {
        if (precioJusto(con(g), 'AAA') !== null) throw new Error(que);
        const r = repartirAporte(con(g), 40);
        if (r.salteados.length || r.compras.some(c => c.limite !== null)) throw new Error(`${que}: no hay que saltear ni poner límite`);
      }
      if (precioJusto(con('2026-11-26T15:00:00Z', { feriados: { feriados: { '2026-11-26': 'x' } } }), 'AAA') !== null) throw new Error('feriado');
      const ayer = con('2026-11-30T15:00:00Z'); ayer.mercado.implicito.usa.precios.AAA = [100, 0, '2026-11-27'];
      if (precioJusto(ayer, 'AAA') !== null || !precioJusto(ayer, 'BBB')) throw new Error('precio de EE.UU. de otro día');
      const { datos, ext } = ejemplo({ hoy: '2026-12-01' });
      ext.mercado.generado = '2026-12-01T14:20:00Z';
      const paso = planificador(valuar(aplicarEventos(datos), ext, '2026-12-01'), '2026-12-01').pasos.find(p => p.tipo === 'aporte');
      if (!paso.como.some(c => /no hay precio justo/.test(c)) || paso.como.some(c => /salteá/.test(c))) throw new Error(paso.como.join(' | '));
    }],

    ['Reparto: a igual déficit va primero el de menor prima', async () => {
      const uno = primas => unidades(repartirAporte(estadoReparto({ primas, cantidades: { AAA: 10, BBB: 10 } }), 10.2));
      // los dos pesan igual en pesos solo si valen lo mismo: se ajustan las cantidades para igualar el déficit
      const e = estadoReparto({ primas: { AAA: 0.008, BBB: -0.008 } });
      e.posiciones[0].cantidad = 10000 / e.posiciones[0].precio_ars; e.posiciones[1].cantidad = 10000 / e.posiciones[1].precio_ars;
      igual(unidades(repartirAporte(e, 10.1)), { BBB: 1 }, 'el barato');
      igual(uno({ AAA: 0, BBB: 0 }), { AAA: 1 }, 'sin diferencia, como siempre');
    }],

    ['Reparto: un ETF más de 1% caro se saltea ese día, con el motivo y sin cambiar la banda', async () => {
      const r = repartirAporte(estadoReparto({ primas: { AAA: 0.015, BBB: 0 }, cantidades: { AAA: 5, BBB: 5 } }), 40);
      // BBB sigue limitado por su banda: recibe una unidad y el resto queda sin invertir
      igual(unidades(r), { BBB: 1 }, 'no compra el caro ni empuja al otro fuera de banda');
      if (r.salteados.length !== 1 || r.salteados[0].ticker !== 'AAA' || !/1,5% caro/.test(r.salteados[0].motivo)) throw new Error(JSON.stringify(r.salteados));
      cerca(r.sobrante_usd + r.invertido_usd, 40, 1e-9, 'lo que no se invierte sobra');
      const justo = repartirAporte(estadoReparto({ primas: { AAA: 0.0099, BBB: 0 }, cantidades: { AAA: 5, BBB: 10 } }), 40);
      if (!justo.compras.some(c => c.ticker === 'AAA') || justo.salteados.length) throw new Error('0,99% no se saltea');
    }],

    ['Reparto: el límite sale del precio justo y sin datos todo queda como antes', async () => {
      const r = repartirAporte(estadoReparto({ primas: { AAA: 0.005, BBB: -0.01 }, cantidades: { AAA: 5, BBB: 5 } }), 50);
      const a = r.compras.find(c => c.ticker === 'AAA'), b = r.compras.find(c => c.ticker === 'BBB');
      cerca(a.limite, 10000 * 1.01, 1e-6, 'precio justo + 1%'); cerca(b.limite, 9900 * 1.01, 1e-6, 'si está barato, desde el precio de pantalla');
      const sin = repartirAporte(estadoReparto({ primas: null, cantidades: { AAA: 5, BBB: 10 } }), 70);
      igual(unidades(sin), { AAA: 6, BBB: 1 }, 'primero lo más lejos de su peso');
      if (sin.compras.some(c => c.limite !== null || c.prima !== null) || sin.salteados.length) throw new Error('sin datos no hay límite ni salteos');
    }],

    ['Dólares en caja: sugiere la especie D solo si no es más cara', async () => {
      const barata = estadoReparto({ usdD: { AAAD: 9.9, BBBD: 10.1 }, cantidades: { AAA: 5, BBB: 5 }, cajaUSD: 100 });
      if (!especieD(barata, 'AAA').conviene || especieD(barata, 'BBB').conviene) throw new Error('comparación mal');
      const r = conDolares(barata, repartirAporte(barata, 60), 25);
      igual(unidades(r), { AAAD: 2, AAA: 1, BBB: 3 }, 'paga en dólares lo que alcanza');
      const d = r.compras.find(c => c.especie === 'AAAD');
      if (d.moneda !== 'USD' || d.precio !== 9.9 || d.ticker !== 'AAA') throw new Error(JSON.stringify(d));
      cerca(d.limite, 9.9 * 1.01, 1e-9, 'límite en dólares');
      // "AM" + "D" es otra empresa
      const am = { hoy: '2026-11-30', mep: 1000, ratios: { AM: { ratio: 1 }, AMD: { ratio: 1 } }, datos: { config: {} }, mercado: { generado: '2026-11-30T15:00:00Z', cedears: { precios: { AM: [10000, 0], AMD: [9.9, 0] } } } };
      if (especieD(am, 'AM') !== null) throw new Error('confundió AMD con AM en dólares');
      am.ratios.AM.d = 'AM.D'; am.mercado.cedears.precios['AM.D'] = [9.9, 0];
      if (especieD(am, 'AM').especie !== 'AM.D') throw new Error('no usó la especie indicada');
    }],

    ['Comprar en dólares descuenta los dólares de la cuenta y suma al mismo activo', async () => {
      const { datos, ext } = ejemplo();
      const antes = valuar(aplicarEventos(datos), ext, '2026-11-30');
      const ev = [{ id: 'c', ts: '2026-11-30T15:00:00Z', tipo: 'compra', fecha: '2026-11-30', mep: 1000, compras: [{ ticker: 'SPY', especie: 'SPYD', moneda: 'USD', cantidad: 5, precio: 10, gastos: 340 }] }];
      const d = aplicarEventos(datos, ev);
      cerca(d.caja.USD_MEP, 120 - 50 - 0.34, 1e-9, 'dólares'); cerca(d.caja.ARS, datos.caja.ARS, 1e-9, 'pesos intactos');
      if (d.posiciones.find(p => p.ticker === 'SPY').cantidad !== 155 || d.posiciones.some(p => p.ticker === 'SPYD')) throw new Error('tiene que sumar a SPY');
      cerca(valuar(d, ext, '2026-11-30').total_usd, antes.total_usd - 50.34 + 5 * ext.mercado.cedears.precios.SPY[0] / 1000, 0.01, 'patrimonio');
    }],

    ['Reinvertir: si hoy todo está caro, el paso avisa y marcarlo vale solo por ese día', async () => {
      const caro = ejemplo({ hoy: '2026-12-01' });
      for (const t of ['SPY', 'EFA', 'EEM', 'IWM']) caro.ext.mercado.cedears.precios[t][0] = Math.round(caro.ext.mercado.cedears.precios[t][0] * 1.03);
      const hecho = [{ id: 'x', ts: '2026-12-01T12:00:00Z', tipo: 'paso', paso_id: 'reinvertir-espera-2026-12-01', estado: 'hecho', titulo: 'x', fecha: '2026-12-01' }];
      const paso = (datos, ext, hoy, ev = []) => planificador(valuar(aplicarEventos(datos, ev), ext, hoy), hoy).pasos.find(p => p.id.startsWith('reinvertir'));
      const p = paso(caro.datos, caro.ext, '2026-12-01');
      if (!p || !/hoy conviene esperar/.test(p.titulo) || p.accion || !p.como.some(c => /Hoy salteá/.test(c))) throw new Error(JSON.stringify(p));
      if (paso(caro.datos, caro.ext, '2026-12-01', hecho)) throw new Error('hoy ya no debería estar');
      const otro = ejemplo({ hoy: '2026-12-02' });
      if (paso(otro.datos, otro.ext, '2026-12-02', hecho)?.id !== 'reinvertir-2026-12') throw new Error('al otro día vuelve con las compras');
    }],

    ['Ventana para comprar: Wall Street abierto y hasta media hora antes del cierre de BYMA', async () => {
      const cal = ejemplo().ext.feriados;
      igual([ventanaDelDia(cal, '2026-11-30').abre, ventanaDelDia(cal, '2026-11-30').cierra], ['11:30', '17:30'], 'invierno en EE.UU.');
      const media = ventanaDelDia(cal, '2026-11-27');
      igual([media.abre, media.cierra, media.media], ['11:30', '15:00', 'día después de Acción de Gracias'], 'media rueda');
      const verano = ventanaDelDia(cal, '2027-03-22');
      igual([verano.abre, verano.cierra, verano.confirmado], ['10:30', '16:30', false], 'verano en EE.UU.');
      if (!ventanaDelDia(cal, '2026-11-26').cerrado || !ventanaDelDia(cal, '2026-11-28').cerrado) throw new Error('feriado y sábado');
      const t = textoVentana(cal, '2026-11-26');
      if (!/Acción de Gracias/.test(t) || !/viernes 27 de noviembre, de 11:30 a 15:00/.test(t) || !/media rueda/.test(t)) throw new Error(t);
      if (!/de 11:30 a 17:30/.test(textoVentana(cal, '2026-11-30'))) throw new Error(textoVentana(cal, '2026-11-30'));
      if (!/no tengo cargados los feriados de EE.UU. de 2028/.test(textoVentana(cal, '2028-03-01'))) throw new Error(textoVentana(cal, '2028-03-01'));
    }],

    ['Los pasos "Aportá" y "Reinvertí" dicen la ventana, el límite y lo salteado; no aparece ninguna tarea nueva', async () => {
      const { datos, ext } = ejemplo({ hoy: '2026-12-01' });
      const plan = planificador(valuar(aplicarEventos(datos), ext, '2026-12-01'), '2026-12-01');
      for (const tipo of ['aporte', 'flujo']) {
        const paso = plan.pasos.find(p => p.tipo === tipo);
        if (!paso) throw new Error('falta el paso ' + tipo);
        const texto = paso.como.join(' | ');
        if (!/Comprá hoy de 11:30 a 17:30/.test(texto)) throw new Error(`${tipo} sin ventana: ${texto}`);
        if (!/precio justo/.test(texto) || !/Hoy salteá EFA/.test(texto)) throw new Error(`${tipo} sin precio justo: ${texto}`);
        if (paso.accion.compras.some(c => c.ticker === 'EFA')) throw new Error('compra el caro');
      }
      const reinv = plan.pasos.find(p => p.id.startsWith('reinvertir'));
      if (!reinv.accion.compras.some(c => c.moneda === 'USD' && c.especie === 'EEMD')) throw new Error('no sugirió EEMD: ' + reinv.como.join(' | '));
      const sin = planificador(valuar(aplicarEventos(datos), { ...ext, mercado: null, ratios: null }, '2026-12-01'), '2026-12-01');
      if (!sin.pasos.some(p => p.tipo === 'aporte' && p.accion.compras.length)) throw new Error('sin datos de data912 el paso tiene que seguir andando');
    }],

    ['Canje: usa CCL ÷ MEP del día y, si falta, el último anterior', async () => {
      const c = canjeDe({ hoy: '2026-01-09', datos: { snapshots: { '2026-01-07': { t: 1, mep: 100, ccl: 108 } } },
        historico: { fechas: ['2026-01-02', '2026-01-05', '2026-01-06'], series: { MEP: [100, null, 100], CCL: [102, 103, 105] } } });
      cerca(c('2026-01-02'), 1.02, 1e-12, 'ese día'); cerca(c('2026-01-05'), 1.02, 1e-12, 'falta el MEP: el anterior');
      cerca(c('2026-01-06'), 1.05, 1e-12, 'ese día'); cerca(c('2026-01-08'), 1.08, 1e-12, 'el registro de la app');
      cerca(c('2025-12-01'), 1.02, 1e-12, 'antes del primer dato');
      if (canjeDe({ hoy: '2026-01-09', datos: {}, historico: { fechas: ['2026-01-02'], series: {} } }) !== null) throw new Error('sin datos debería ser null');
    }],

    ['Canje constante: todo coincide con el cálculo sin canje', async () => {
      for (const registros of [false, true]) {
        const con = carteraConCanje([1.04, 1.04], { precios: [100, 121], registros });
        const sin = { ...con, historico: { fechas: con.historico.fechas, series: { SPY: con.historico.series.SPY } }, mep: undefined,
          datos: { ...con.datos, snapshots: Object.fromEntries(Object.entries(con.datos.snapshots).map(([f, s]) => [f, { t: s.t }])) } };
        const a = periodoTodo(con), b = periodoTodo(sin);
        a.filas.forEach((f, i) => {
          cerca(f.rend, b.filas[i].rend, 1e-9, `${f.nombre}: total`);
          cerca(f.activos, f.rend, 1e-9, `${f.nombre}: activos`); cerca(f.efecto_canje, 0, 1e-9, `${f.nombre}: canje`);
          if (b.filas[i].activos !== null) throw new Error('sin datos del canje no hay desglose');
        });
        a.usd[1].forEach((v, i) => cerca(v, b.usd[1][i], 1e-9, 'valor de SPY'));
        const x = rendimientoPorBloque(con)[0], y = rendimientoPorBloque(sin)[0];
        cerca(x.xirr_spy, y.xirr_spy, 1e-6, 'por bloque, SPY'); cerca(x.xirr_spy_activos, x.xirr_spy, 1e-6, 'activos'); cerca(x.xirr_activos, x.xirr, 1e-6, 'activos propios');
      }
    }],

    ['Canje de 2% a 5%: la diferencia es exactamente ese cambio', async () => {
      const cambio = 1.05 / 1.02 - 1;
      for (const registros of [false, true]) {
        // Sin movimiento del subyacente: todo el resultado es canje.
        const quieto = periodoTodo(carteraConCanje([1.02, 1.05], { registros }));
        for (const f of quieto.filas) { cerca(f.rend, cambio, 1e-9, `${f.nombre}: total`); cerca(f.activos, 0, 1e-9, `${f.nombre}: activos`); cerca(f.efecto_canje, cambio, 1e-9, `${f.nombre}: canje`); }
        cerca(quieto.canje.desde, 0.02, 1e-9, 'desde'); cerca(quieto.canje.hasta, 0.05, 1e-9, 'hasta');
        // Con el subyacente 10% arriba, el canje se multiplica sobre ese resultado.
        const sube = periodoTodo(carteraConCanje([1.02, 1.05], { precios: [100, 110], registros }));
        for (const f of sube.filas) {
          cerca(f.activos, 0.10, 1e-9, `${f.nombre}: activos`); cerca((1 + f.rend) / (1 + f.activos) - 1, cambio, 1e-9, `${f.nombre}: la diferencia`);
          cerca(f.activos + f.efecto_canje, f.rend, 1e-12, `${f.nombre}: suman el total`);
        }
        const b = rendimientoPorBloque(carteraConCanje([1.02, 1.05], { registros }))[0], dias = 424;
        for (const k of ['xirr', 'xirr_spy', 'xirr_nucleo']) { cerca(b[k + '_activos'], 0, 1e-6, `${k} activos`); cerca(b[k], Math.pow(1.05 / 1.02, 365 / dias) - 1, 1e-6, k); }
      }
    }],

    ['Canje: lo que no es CEDEAR ni acción local no se mueve con él', async () => {
      const e = carteraConCanje([1.02, 1.05], { registros: true });
      e.posiciones[0].tipo = 'on';
      e.total_usd = 10; e.posiciones[0].valor_usd = 10;
      e.datos.snapshots = { '2025-01-02': { t: 10, x: 0, mep: 1000, ccl: 1020 }, '2026-03-02': { t: 10, x: 0, mep: 1000, ccl: 1050 } };
      const [yo, spy] = periodoTodo(e).filas;
      cerca(yo.efecto_canje, 0, 1e-12, 'tu cartera'); cerca(spy.efecto_canje, 1.05 / 1.02 - 1, 1e-9, 'SPY con CEDEARs');
    }],

    ['Radar: una acción local se reconoce por su ADR (PAMP → PAM) y el bloque YPF por YPF', async () => {
      const m = tickersPropios([
        { ticker: 'PAMP', subyacente: 'PAMP', grupo: 'satelite' },
        { ticker: 'YM43O', grupo: 'ypf', bloque: 'satelite_ypf' },
        { ticker: 'SPY', subyacente: 'SPY', grupo: 'nucleo' },
      ]);
      if (m.get('PAM') !== 'PAMP') throw new Error('PAM no apunta a PAMP');
      if (m.get('YPF') !== 'YM43O') throw new Error('YPF no apunta a la ON');
      if (m.get('SPY') !== 'SPY' || m.has('GGAL')) throw new Error('marca de más o de menos');
    }],

    ['Inflación: el deflactor lleva cada mes a dólares del último IPC', async () => {
      const d = deflactor({ '2025-01': 100, '2025-06': 102, '2026-01': 103 });
      cerca(d.factor('2025-01-15'), 1.03, 1e-9, 'enero 2025');
      cerca(d.factor('2025-03-10'), 1.03, 1e-9, 'mes sin dato usa el anterior');
      cerca(d.factor('2026-05-01'), 1, 1e-9, 'posterior al último dato');
      if (deflactor({ '2025-01': 100 }) !== null) throw new Error('con un solo mes no debería deflactar');
    }],

    ['Rendimiento real: 100 → 110 en un año con 3% de inflación ≈ 6,8% real', async () => {
      const estado = {
        hoy: '2026-01-01', total_usd: 110,
        datos: { cashflows_externos_usd: [{ fecha: '2025-01-01', usd: 100 }], nucleo: { pesos_internos: { SPY: 1 } } },
        mercado: { cpi_usa: { meses: { '2025-01': 100, '2026-01': 103 } } }, historico: null,
      };
      const r = rendimiento(estado);
      cerca(r.cartera.xirr, 0.1, 0.001, 'nominal');
      cerca(r.cartera.xirr_real, 1.10 / 1.03 - 1, 0.001, 'real');
      cerca(r.inflacion.acumulada, 0.03, 1e-9, 'inflación acumulada');
      const sin = rendimiento({ ...estado, mercado: null });
      if (sin.cartera.xirr_real !== null || sin.inflacion !== null) throw new Error('sin IPC debería quedar vacío');
      cerca(xirr([{ fecha: '2025-01-01', monto: -100 }, { fecha: '2026-01-01', monto: 110 }]), 0.1, 0.001, 'xirr');
    }],

    ['Evolución en %: un aporte no cuenta como ganancia', async () => {
      // 100 → 110 (+10%) → aporta 50 y queda en 176: ganó 16 sobre 110 (+14,5%). Acumulado ≈ 26%, no 76%.
      const diario = [{ f: '2026-01-01', v: 100 }, { f: '2026-01-02', v: 110 }, { f: '2026-01-03', v: 176 }];
      const c = curvaPorcentual(diario, [{ fecha: '2026-01-03', usd: 50 }, { fecha: '2025-12-01', usd: 100 }]);
      cerca(c[0], 0, 1e-12, 'arranca en 0');
      cerca(c[1], 0.10, 1e-12, 'primer tramo');
      cerca(c[2], 1.1 * (1 + 16 / 110) - 1, 1e-9, 'acumulado con aporte el último día');
      // Varios días sin abrir: el aporte del principio del tramo se cuenta como invertido casi todo el tramo.
      const hueco = [{ f: '2026-01-01', v: 100 }, { f: '2026-01-31', v: 165 }];
      const h = curvaPorcentual(hueco, [{ fecha: '2026-01-01', usd: 0 }, { fecha: '2026-01-02', usd: 50 }]);
      cerca(h[1], 15 / (100 + 50 * 29 / 30), 1e-9, 'Dietz modificado');
    }],

    ['Período: el mes y el año arrancan en el último dato anterior; sin datos previos, en el primero', async () => {
      const fs = ['2025-12-20', '2026-01-10', '2026-10-31', '2026-11-05', '2026-11-18'];
      if (inicioDelPeriodo(fs, '2026-11-18', 'mes') !== 2) throw new Error('mes');
      if (inicioDelPeriodo(fs, '2026-11-18', 'anio') !== 0) throw new Error('año');
      if (inicioDelPeriodo(fs, '2026-11-18', 'todo') !== 0) throw new Error('todo');
      if (inicioDelPeriodo(['2026-11-05', '2026-11-06'], '2026-11-18', 'mes') !== 0) throw new Error('sin dato previo');
    }],

    ['Historia: antes de los registros diarios se reconstruye con los lotes y precios históricos', async () => {
      // SPY: 100 → 110 → 121 (+10% por día hábil). Un lote de 2 CEDEAR comprado el 1/1 y otro de 1 el 2/1.
      // Hoy (4/1) cada CEDEAR vale 13,31 USD (serie 133,1 → factor 0,1). Registros diarios desde el 3/1.
      const e = {
        hoy: '2026-01-04',
        historico: { fechas: ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'], series: { SPY: [100, 110, 121, 133.1] } },
        posiciones: [{ ticker: 'SPY', tipo: 'cedear', subyacente: 'SPY', cantidad: 3, valor_usd: 3 * 13.31 }],
        datos: {
          lotes_costo: [
            { ticker: 'SPY', cantidad: 2, fecha_compra: '2026-01-01', precio_compra: 10, moneda: 'USD', mep_dia: 1 },
            { ticker: 'SPY', cantidad: 1, fecha_compra: '2026-01-02', precio_compra: 11, moneda: 'USD', mep_dia: 1 },
          ],
          cashflows_externos_usd: [{ fecha: '2026-01-01', usd: 20 }, { fecha: '2026-01-02', usd: 11 }],
          snapshots: { '2026-01-03': { t: 3 * 12.1 + 5 }, '2026-01-04': { t: 3 * 13.31 + 5 } }, // con 5 USD de caja
        },
      };
      const h = historiaCartera(e);
      if (h.puntos.map(p => p.f).join() !== '2026-01-01,2026-01-02,2026-01-03,2026-01-04') throw new Error(h.puntos.map(p => p.f).join());
      if (!h.puntos[0].rec || !h.puntos[1].rec || h.puntos[2].rec) throw new Error('marcas de reconstrucción');
      cerca(h.puntos[0].v, 20, 1e-9, 'valor reconstruido 1/1');
      cerca(h.puntos[1].v, 33, 1e-9, 'valor reconstruido 2/1 (con la segunda compra)');
      // +10% cada día: la compra del 2/1 y el salto por la caja al empezar los registros no cuentan como ganancia.
      cerca(h.indice[1], 1.1, 1e-9, 'índice 2/1');
      cerca(h.indice[2], 1.21, 1e-9, 'índice 3/1');
      cerca(h.indice[3], 1.21 * (3 * 13.31 + 5) / (3 * 12.1 + 5), 1e-9, 'índice 4/1');
      cerca(h.ganancia[2], 2 + 3.3, 1e-9, 'ganancia hasta el 3/1');
    }],

    ['Historia: la caja estimada entra en el valor y una compra sin aporte cargado cuenta como aporte', async () => {
      const hist = { fechas: ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'], series: { SPY: [100, 100, 110, 110] } };
      const pos = [{ ticker: 'SPY', tipo: 'cedear', subyacente: 'SPY', cantidad: 2, valor_usd: 2 * 11 }];
      // Aporta 30 el 1/1 y compra 1 (10 USD) ese día y otra el 2/1: quedan 10 de caja. SPY sube 10% el 3/1.
      const a = historiaCartera({ hoy: '2026-01-04', historico: hist, posiciones: pos, datos: {
        lotes_costo: [{ ticker: 'SPY', cantidad: 1, fecha_compra: '2026-01-01', precio_compra: 10, moneda: 'USD', mep_dia: 1 },
          { ticker: 'SPY', cantidad: 1, fecha_compra: '2026-01-02', precio_compra: 10, moneda: 'USD', mep_dia: 1 }],
        cashflows_externos_usd: [{ fecha: '2026-01-01', usd: 30 }], snapshots: { '2026-01-04': { t: 32 } } } });
      cerca(a.puntos[0].v, 30, 1e-9, 'valor 1/1 con la caja');
      cerca(a.puntos[2].v, 32, 1e-9, 'valor 3/1');
      cerca(a.indice[2], 32 / 30, 1e-9, 'la caja diluye la suba');
      // Sin aportes cargados: cada compra es un aporte implícito y la caja nunca queda negativa.
      const b = historiaCartera({ hoy: '2026-01-04', historico: hist, posiciones: pos, datos: {
        lotes_costo: [{ ticker: 'SPY', cantidad: 1, fecha_compra: '2026-01-01', precio_compra: 10, moneda: 'USD', mep_dia: 1 },
          { ticker: 'SPY', cantidad: 1, fecha_compra: '2026-01-02', precio_compra: 10, moneda: 'USD', mep_dia: 1 }],
        cashflows_externos_usd: [], snapshots: { '2026-01-04': { t: 22 } } } });
      cerca(b.puntos[1].v, 20, 1e-9, 'valor 2/1 sin caja negativa');
      cerca(b.indice[2], 1.1, 1e-9, 'solo la suba de SPY');
      cerca(b.ganancia[2], 2, 1e-9, 'ganancia 2 USD');
    }],

    ['Período: tarjetas, tabla y gráficos salen del mismo cálculo', async () => {
      const hist = { fechas: ['2025-01-02', '2025-07-01', '2026-01-02', '2026-03-02'], series: { SPY: [100, 105, 110, 121] } };
      const e = {
        hoy: '2026-03-02', historico: hist, mercado: { cpi_usa: { meses: { '2025-01': 100, '2026-01': 103 } } },
        posiciones: [{ ticker: 'SPY', tipo: 'cedear', subyacente: 'SPY', cantidad: 1, valor_usd: 12.1 }],
        datos: { lotes_costo: [{ ticker: 'SPY', cantidad: 1, fecha_compra: '2025-01-02', precio_compra: 10, moneda: 'USD', mep_dia: 1 }],
          cashflows_externos_usd: [{ fecha: '2025-01-02', usd: 10 }], snapshots: { '2026-03-02': { t: 12.1 } },
          nucleo: { pesos_internos: { SPY: 1 } } },
      };
      const hc = historiaCartera(e), b = benchmarks(e, hc.flujos);
      const t = resumenPeriodo(e, hc, b, 'todo');
      cerca(t.filas[0].rend, 0.21, 1e-9, 'cartera desde el inicio');
      cerca(t.filas[0].rend, t.pct[0][t.pct[0].length - 1], 1e-12, 'tabla = gráfico');
      cerca(t.filas[0].ganancia, 2.1, 1e-9, 'ganancia');
      cerca(t.filas[0].anual, Math.pow(1.21, 365 / 424) - 1, 1e-9, 'por año');
      cerca(t.inflacion.valor, 0.03, 1e-9, 'inflación del período');
      cerca(t.filas[0].real, 1.21 / 1.03 - 1, 1e-9, 'sin inflación');
      // "Este año" arranca en el último dato de 2025 (acá, el 1/7/2025).
      const y = resumenPeriodo(e, hc, b, 'anio');
      if (y.f0 !== '2025-07-01') throw new Error('inicio del año: ' + y.f0);
      cerca(y.filas[0].rend, 121 / 105 - 1, 1e-9, 'cartera en el año');
      if (y.filas[0].anual !== null) throw new Error('menos de un año no se anualiza');
      // Este mes: el IPC de marzo todavía no salió → sin dato de inflación.
      if (resumenPeriodo(e, hc, b, 'mes').inflacion !== null) throw new Error('mes sin IPC publicado');
    }],

    ['Rendimiento: un aporte cargado días después cuenta el día en que aparece en los registros', async () => {
      // 1000 → aporte de 500 con fecha 10/11 cargado el 12/11: el registro del 10 y el 11 no lo tienen. Sin cambio de precios.
      const e = {
        hoy: '2026-11-12', historico: { fechas: ['2026-11-09'], series: { SPY: [100] } }, posiciones: [],
        datos: {
          lotes_costo: [], cashflows_externos_usd: [{ fecha: '2026-11-10', usd: 500, evento: 'a1' }],
          eventos: [{ id: 'a1', tipo: 'aporte', fecha: '2026-11-10', ts: '2026-11-12T15:00:00.000Z', usd: 500 }],
          snapshots: { '2026-11-09': { t: 1000 }, '2026-11-10': { t: 1000 }, '2026-11-11': { t: 1000 }, '2026-11-12': { t: 1500 } },
        },
      };
      const h = historiaCartera(e);
      cerca(h.indice[h.indice.length - 1], 1, 1e-12, 'sin cambio de precios el rendimiento es 0');
      cerca(h.ganancia[h.ganancia.length - 1], 0, 1e-9, 'ni ganancia');
    }],

    ['Benchmarks: un aporte de fin de semana entra el lunes y no distorsiona el %', async () => {
      const hist = { fechas: ['2026-01-02', '2026-01-05', '2026-01-06'], series: { SPY: [100, 110, 121] } };
      const sim = benchmarks({ historico: hist, datos: { nucleo: { pesos_internos: { SPY: 1 } } } },
        [{ fecha: '2026-01-02', usd: 100 }, { fecha: '2026-01-03', usd: 100 }])[0].valorEn;
      if (sim.flujos[1].fecha !== '2026-01-05') throw new Error('el aporte del sábado debería entrar el lunes');
      cerca(sim('2026-01-03'), 100, 1e-9, 'el sábado todavía no está invertido');
      const pts = ['2026-01-02', '2026-01-03', '2026-01-05', '2026-01-06'].map(f => ({ f, v: sim(f) }));
      cerca(curvaPorcentual(pts, sim.flujos).at(-1), 0.21, 1e-9, 'SPY con aportes rinde lo mismo que SPY');
    }],

    ['Historia: cupones y resultados de ventas anteriores suman a la caja estimada; amortizaciones no', async () => {
      const hist = { fechas: ['2026-01-01', '2026-01-02', '2026-01-05'], series: { SPY: [100, 100, 100] } };
      const e = { hoy: '2026-01-05', historico: hist, posiciones: [{ ticker: 'SPY', tipo: 'cedear', subyacente: 'SPY', cantidad: 1, valor_usd: 10 }],
        datos: { lotes_costo: [{ ticker: 'SPY', cantidad: 1, fecha_compra: '2026-01-01', precio_compra: 10, moneda: 'USD', mep_dia: 1 }],
          cashflows_externos_usd: [{ fecha: '2026-01-01', usd: 10 }],
          cobros: [{ fecha: '2026-01-02', usd: 2, clase: 'cupon' }, { fecha: '2026-01-02', usd: 50, clase: 'amortizacion' }],
          realizados: [{ fecha: '2026-01-02', resultado_usd: 1 }],
          snapshots: { '2026-01-05': { t: 13 } } } };
      const h = historiaCartera(e);
      cerca(h.puntos[1].v, 13, 1e-9, 'caja con cupón y resultado');
      cerca(h.indice[1], 1.3, 1e-9, 'cupón y venta son ganancia');
      if (Math.abs(h.cierre.registrado - h.cierre.estimado) > 1e-9) throw new Error('el cierre debería coincidir');
      if (h.flujos.some(f => f.implicito)) throw new Error('no hay aportes implícitos');
    }],

    ['Historia: se escala con el precio del resumen base, así lo estimado empalma con el primer registro', async () => {
      // El CEDEAR hoy vale 12 por unidad, pero el día del resumen (5/1) valía 10,5 con el subyacente en 100 (otra brecha).
      const hist = { fechas: ['2026-01-02', '2026-01-05', '2026-01-06'], series: { SPY: [100, 100, 110] } };
      const e = { hoy: '2026-01-06', historico: hist, posiciones: [{ ticker: 'SPY', tipo: 'cedear', subyacente: 'SPY', cantidad: 10, valor_usd: 120 }],
        datos: { meta: { fecha_snapshot: '2026-01-05', tc_snapshot: { mep: 1000 } },
          posiciones: [{ ticker: 'SPY', precio: 10500, moneda_precio: 'ARS' }],
          lotes_costo: [{ ticker: 'SPY', cantidad: 10, fecha_compra: '2026-01-02', precio_compra: 10.5, moneda: 'USD', mep_dia: 1 }],
          cashflows_externos_usd: [{ fecha: '2026-01-02', usd: 105 }], snapshots: { '2026-01-05': { t: 105 }, '2026-01-06': { t: 120 } } } };
      const h = historiaCartera(e);
      cerca(h.cierre.estimado, h.cierre.registrado, 1e-9, 'empalme exacto');
      cerca(h.puntos[0].v, 105, 1e-9, 'valor estimado con el precio del resumen');
    }],

    ['Historia: un dividendo en acciones (lote de costo cero) no es aporte y no hace saltar el valor', async () => {
      // 10 YPFD comprados a 30 USD c/u; el 4/8 entran 90 de regalo (10 a 1). El ADR no cambia de precio.
      const hist = { fechas: ['2026-08-03', '2026-08-04', '2026-08-05'], series: { YPF: [30, 30, 30] } };
      const e = { hoy: '2026-08-05', historico: hist, posiciones: [{ ticker: 'YPFD', tipo: 'accion_ar', cantidad: 100, valor_usd: 300 }],
        datos: { lotes_costo: [
          { ticker: 'YPFD', cantidad: 10, fecha_compra: '2026-08-03', precio_compra: 30, moneda: 'USD', mep_dia: 1 },
          { ticker: 'YPFD', cantidad: 90, fecha_compra: '2026-08-04', precio_compra: 0, moneda: 'USD', mep_dia: 1 }],
          cashflows_externos_usd: [{ fecha: '2026-08-03', usd: 300 }], snapshots: { '2026-08-05': { t: 300 } } } };
      const h = historiaCartera(e);
      cerca(h.puntos[0].v, 300, 1e-9, 'antes del dividendo: 10 acciones viejas = 100 de hoy');
      cerca(h.puntos[1].v, 300, 1e-9, 'después, igual');
      cerca(h.indice[1], 1, 1e-12, 'sin ganancia ni pérdida inventada');
      if (h.flujos.some(f => f.implicito)) throw new Error('no es un aporte');
    }],

    ['Vencimientos: lista lo próximo y lo vencido sin registrar, no lo ya cobrado', async () => {
      const e = {
        hoy: '2027-03-01',
        posiciones: [{ ticker: 'ON1', cantidad: 1000 }],
        datos: { cobros: [{ ref: 'ON1-2027-01-14-cupon' }] },
        calendario: { flujos: [
          { ticker: 'ON1', fecha: '2026-07-14', tipo: 'cupon', por_vn: 0.02 },
          { ticker: 'ON1', fecha: '2027-01-14', tipo: 'cupon', por_vn: 0.04 },
          { ticker: 'ON1', fecha: '2027-07-14', tipo: 'cupon', por_vn: 0.03 },
          { ticker: 'OTRA', fecha: '2027-07-14', tipo: 'cupon', por_vn: 1 },
        ] },
      };
      const f = proximosFlujos(e);
      if (f.length !== 2) throw new Error(`esperaba 2, hay ${f.length}`);
      if (!f[0].vencido || f[0].fecha !== '2026-07-14') throw new Error('falta el vencido sin registrar');
      cerca(f[1].usd, 30, 1e-9, 'monto del próximo');
    }],

    ['El registro diario guarda también el contado con liqui', async () => {
      const s = snapshotDe({ total_usd: 100.004, lp_usd: 80, nucleo_usd: 40, mep: 1000, ccl: 1050 });
      if (s.mep !== 1000 || s.ccl !== 1050 || s.t !== 100) throw new Error(JSON.stringify(s));
    }],

    ['Respaldo cifrado: ida y vuelta, y se distingue del respaldo sin cifrar', async () => {
      const datos = { posiciones: [], reglas: [], meta: { x: 1 }, nucleo: {} };
      const salt = btoa('sal-de-prueba-16b');
      const clave = await derivarClave('una frase de prueba bastante larga', salt, 1000);
      const sobre = await cifrar(datos, clave, salt, 1000);
      if (!esSobreCifrado(sobre) || esRespaldoPlano(sobre)) throw new Error('el sobre no se reconoce');
      if (!esRespaldoPlano(datos) || esSobreCifrado(datos)) throw new Error('el plano no se reconoce');
      const vuelta = await descifrar(sobre, clave);
      if (JSON.stringify(vuelta) !== JSON.stringify(datos)) throw new Error('no volvió igual');
      const otra = await derivarClave('otra frase distinta y también larga', salt, 1000);
      let abrio = true;
      try { await descifrar(sobre, otra); } catch { abrio = false; }
      if (abrio) throw new Error('abrió con otra clave');
    }],
  ];
}
