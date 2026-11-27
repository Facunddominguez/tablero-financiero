// Pruebas públicas de la ronda 2 (sin datos privados). Corren junto con js/pruebas_publicas.js.
import { aplicarEventos, valuar } from './estado.js';
import { planificador, proyeccion } from './motor.js';
import { simular, modelo, raizCorrelacion, textoHito } from './simulacion.js';
import { supuestos } from './supuestos.js';
import { ventanaDelDia, textoVentana, precioJusto, paraVender, horaPrecios, frescuraPrecios, avisoPrecioJusto } from './precios.js';
import { compararFantasmas, puntajePredicciones } from './diario.js';
import { fusionar } from './sync.js';
import { ejemplo } from './ejemplo.js';
import { aNumero, fmt } from './util.js';
import { semaforoArgentina, textoSemaforo, eleccion, claveCandidato, reservaEnPesos } from './argentina.js';
import { riesgo, historiaRiesgo } from './riesgo.js';
import { climaMercado, textoClima, spyContraPromedio, caidaNucleo, aporteExtra, ajustesAporteExtra } from './clima.js';

export const cerca = (a, b, tol, que) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${que}: dio ${a}, esperado ≈ ${b}`); };
export const igual = (a, b, que) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${que}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
export const si = (ok, que) => { if (!ok) throw new Error(que); };
// Estado de ejemplo ya valuado, con un ajuste opcional sobre datos y archivos antes de valuar.
export function mundo({ hoy = '2026-11-30', ajustar, eventos = [] } = {}) {
  const x = ejemplo({ hoy });
  ajustar?.(x);
  return { ...x, e: valuar(aplicarEventos(x.datos, eventos), x.ext, hoy) };
}
const evento = (id, resto) => ({ id, ts: `2026-11-30T12:00:00.${String(id).padStart(3, '0')}Z`, ...resto });

function etapa1() {
  return [
    ['Ventana: un feriado argentino no tiene rueda y dice cuál es la próxima ventana', async () => {
      const cal = mundo({ hoy: '2026-12-08' }).e.feriados;
      const v = ventanaDelDia(cal, '2026-12-08');
      si(/no opera BYMA \(feriado argentino: Inmaculada/.test(v.cerrado), JSON.stringify(v));
      const t = textoVentana(cal, '2026-12-08');
      si(/Hoy no opera BYMA.*no compres.*Próxima ventana: miércoles 9 de diciembre, de 11:30 a 17:30/.test(t), t);
      si(/no vendas/.test(textoVentana(cal, '2026-12-08', { vender: true })), 'versión de venta');
      // Feriado en los dos mercados.
      si(/ni en BYMA/.test(ventanaDelDia(cal, '2026-12-25').cerrado), 'Navidad');
      // Un sábado antes del fin de semana largo: salta el puente (que sí tiene rueda) y no el feriado.
      si(/lunes 7 de diciembre/.test(textoVentana(cal, '2026-12-05')) && /no liquida/.test(textoVentana(cal, '2026-12-05')), textoVentana(cal, '2026-12-05'));
    }],

    ['Ventana: en un día puente BYMA opera sin liquidar, y las excepciones de BYMA mandan', async () => {
      const cal = mundo().e.feriados;
      const puente = ventanaDelDia(cal, '2026-12-07');
      si(!puente.cerrado && /Puente/.test(puente.sinLiquidacion), JSON.stringify(puente));
      const con = { ...cal, byma: { ...cal.byma, excepciones: { sin_rueda: { '2026-12-31': 'sin rueda por decisión de BYMA' }, sin_liquidacion: { '2026-12-24': 'Nochebuena' } } } };
      si(/sin rueda por decisión de BYMA/.test(ventanaDelDia(con, '2026-12-31').cerrado), 'fin de año');
      si(ventanaDelDia(con, '2026-12-24').sinLiquidacion === 'Nochebuena', 'Nochebuena');
      // Sin los feriados argentinos cargados avisa, y no inventa que son días normales en silencio.
      const sin = mundo({ ajustar: x => { delete x.ext.feriadosAr; } }).e.feriados;
      si(/no tengo cargados los feriados argentinos de 2026/.test(textoVentana(sin, '2026-11-30')), textoVentana(sin, '2026-11-30'));
      si(!/feriados argentinos/.test(textoVentana(cal, '2026-11-30')), 'con datos no avisa');
    }],

    ['Precio justo: no se calcula con precios tomados un día sin rueda en BYMA', async () => {
      const { e } = mundo({ hoy: '2026-12-08' });
      si(precioJusto(e, 'SPY') === null && /sin rueda en BYMA/.test(avisoPrecioJusto(e)), avisoPrecioJusto(e));
      si(precioJusto(mundo({ hoy: '2026-12-09' }).e, 'SPY') !== null, 'al otro día sí');
    }],

    ['Hora de los precios: va junto al precio justo y al límite, en las compras y en lo salteado', async () => {
      const { e } = mundo({ hoy: '2026-12-01' }); // precios a las 15:00 UTC = 12:00 de Argentina
      si(horaPrecios(e) === 'de las 12:00', horaPrecios(e));
      si(horaPrecios({ ...e, hoy: '2026-12-02' }) === 'del 01/12 a las 12:00', horaPrecios({ ...e, hoy: '2026-12-02' }));
      const paso = planificador(e, e.hoy).pasos.find(p => p.tipo === 'aporte');
      si(paso.usaPrecios, 'el paso usa precios');
      si(paso.como.filter(c => /^Comprá \d/.test(c)).every(c => /precio justo|no sale más cara/.test(c) && /precios de las 12:00/.test(c)), paso.como.join(' | '));
      si(paso.como.some(c => /Hoy salteá EFA.*precios de las 12:00/.test(c)), 'lo salteado también');
    }],

    ['Precios de más de una hora con la ventana abierta: sugiere actualizar antes de operar', async () => {
      const { e } = mundo(); // generado 30/11 15:00 UTC; ventana 11:30 a 17:30 de Argentina
      const con = iso => frescuraPrecios(e, iso);
      si(con('2026-11-30T15:30:00Z').sugerir === false && con('2026-11-30T15:30:00Z').abierta, 'media hora: no');
      const vieja = con('2026-11-30T16:30:00Z');
      si(vieja.sugerir && vieja.minutos === 90 && vieja.hora === 'de las 12:00', JSON.stringify(vieja));
      si(!con('2026-11-30T21:00:00Z').abierta && !con('2026-11-30T21:00:00Z').sugerir, 'con la ventana cerrada no');
      si(!con('2026-11-30T14:00:00Z').abierta, 'antes de abrir');
      si(!frescuraPrecios(mundo({ hoy: '2026-12-08' }).e, '2026-12-08T17:00:00Z').sugerir, 'feriado');
      e.datos.config.minutos_precio_viejo = 120;
      si(!con('2026-11-30T16:30:00Z').sugerir, 'el límite se edita en los datos');
      si(frescuraPrecios({ ...e, mercado: null }) === null, 'sin mercado no dice nada');
    }],

    ['Precio justo en ventas: límite desde el precio justo y aviso si está barato', async () => {
      const barato = mundo({ ajustar: x => { x.ext.mercado.cedears.precios.NVDA[0] = Math.round(150 * 1060 / 24 * 0.98); } }).e;
      const b = paraVender(barato, 'NVDA');
      si(b.barato && Math.abs(b.prima + 0.02) < 0.001, JSON.stringify(b));
      cerca(b.limite, b.justo_ars * 0.99, 1e-6, 'si está barato, desde el precio justo');
      const caro = mundo({ ajustar: x => { x.ext.mercado.cedears.precios.NVDA[0] = Math.round(150 * 1060 / 24 * 1.02); } }).e, c = paraVender(caro, 'NVDA');
      cerca(c.limite, c.precio_ars * 0.99, 1e-6, 'si está caro, desde el de pantalla');
      si(!c.barato && paraVender(caro, 'PAMP') === null, 'una acción local no tiene precio justo');
    }],

    ['El paso de venta por tope duro usa el precio justo, la ventana y avisa si hoy está barato', async () => {
      const paso = ajuste => {
        const { e } = mundo({ ajustar: x => { x.datos.posiciones.find(p => p.ticker === 'NVDA').cantidad = 120; x.ext.mercado.cedears.precios.NVDA[0] = Math.round(150 * 1060 / 24 * ajuste); } });
        return planificador(e, e.hoy).pasos.find(p => p.id.startsWith('duro-NVDA'));
      };
      const b = paso(0.98);
      si(b && b.usaPrecios && /Reducí NVDA: vendé/.test(b.titulo), JSON.stringify(b));
      si(b.como.some(c => /Vendé hoy de 11:30 a 17:30/.test(c)), b.como.join(' | '));
      si(b.como.some(c => /^Vendé \d+ NVDA · orden límite a \$\s[\d.]+ · plazo 24 hs \(precio justo .*2,0% barato; precios de las 12:00\)/.test(c)), b.como.join(' | '));
      si(b.como.some(c => /esperá a que se acomode/.test(c)), 'aviso de barato');
      si(!paso(1).como.some(c => /esperá/.test(c)), 'a precio justo no avisa');
    }],

    ['Ratio cambiado en BYMA: aviso en "Para saber" con el valor nuevo, sin cambiarlo solo', async () => {
      const cambios = { NVDA: [24, 48], MSFT: [30, 60] };
      const { e } = mundo({ ajustar: x => { x.ext.mercado.ratios_byma = { lista_fecha: '2026-11-27', cambios }; } });
      si(precioJusto(e, 'NVDA').revisar === true && precioJusto(e, 'NVDA').ratio === 24, 'sigue con el del tablero y lo marca');
      const avisos = planificador(e, e.hoy).pasos.filter(p => p.id.startsWith('ratio-'));
      igual(avisos.map(p => [p.id, p.informativo]), [['ratio-NVDA-48', true]], 'solo lo que usás, como aviso');
      si(/BYMA dice 48 y el tablero usa 24/.test(avisos[0].titulo) && /27\/11\/2026/.test(avisos[0].porque), JSON.stringify(avisos[0]));
    }],

    ['Predicciones: se editan y se borran, y al cambiar el vencimiento vuelve a preguntar', async () => {
      const { datos, ext } = ejemplo();
      const base = [
        evento(1, { tipo: 'prediccion', fecha: '2026-11-02', texto: 'KO sube', probabilidad: 0.7, vence: '2026-11-30', cambio: 'x', ticker: 'KO' }),
        evento(2, { tipo: 'paso', paso_id: 'prediccion-1', estado: 'descartado', titulo: '¿Se cumplió?', fecha: '2026-11-30' }),
      ];
      base[0].id = '1';
      const con = extra => aplicarEventos(datos, [...base, ...extra]);
      const pasos = (d, hoy) => planificador(valuar(d, ext, hoy), hoy).pasos.filter(p => p.tipo === 'prediccion');
      si(!pasos(con([]), '2026-12-02').length, 'descartado');
      const editada = con([evento(3, { tipo: 'prediccion_editar', ref: '1', fecha: '2026-11-30', cambios: { texto: 'KO sube más que SPY', probabilidad: 0.6, vence: '2026-12-01', ticker: '' } })]);
      const p = editada.predicciones[0];
      igual([p.texto, p.probabilidad, p.vence, p.cambio, 'ticker' in p], ['KO sube más que SPY', 0.6, '2026-12-01', 'x', false], 'editada');
      si(pasos(editada, '2026-12-02').length === 1, 'con vencimiento nuevo vuelve a preguntar');
      // Resuelta: se corrige el resultado o se la reabre.
      const resuelta = [evento(3, { tipo: 'prediccion_resultado', ref: '1', cumplio: true, fecha: '2026-11-30' })];
      const corregida = con([...resuelta, evento(4, { tipo: 'prediccion_editar', ref: '1', fecha: '2026-11-30', cambios: { cumplio: false } })]);
      si(corregida.predicciones[0].cumplio === false && puntajePredicciones(corregida.predicciones).resueltas === 1, 'corregida');
      const abierta = con([...resuelta, evento(4, { tipo: 'prediccion_editar', ref: '1', fecha: '2026-11-30', cambios: { cumplio: null } })]);
      si(!('cumplio' in abierta.predicciones[0]) && pasos(abierta, '2026-12-02').length === 1, 'reabierta');
      const borrada = con([evento(5, { tipo: 'prediccion_borrar', ref: '1', fecha: '2026-11-30' })]);
      si(!borrada.predicciones.length && !pasos(borrada, '2026-12-02').length, 'borrada');
      // Al sincronizar con un dispositivo que todavía no vio el borrado, sigue borrada.
      const unida = fusionar({ ...datos, eventos: base }, { ...datos, eventos: [...base, evento(5, { tipo: 'prediccion_borrar', ref: '1', fecha: '2026-11-30' })] });
      si(!aplicarEventos(unida).predicciones.length, 'la sincronización no la revive');
    }],

    ['Carteras fantasma: se editan, se les quita un ticker y se borran', async () => {
      const { datos, ext } = ejemplo();
      const alta = ['AAPL', 'KO', 'SPY'].map((ticker, i) => evento(10 + i, { tipo: 'fantasma', origen: 'allaria', ticker, fecha: '2026-06-01', grupo: 'Allaria P4' }));
      alta.push(evento(13, { tipo: 'fantasma', origen: 'radar', ticker: 'NVDA', fecha: '2026-07-01' }));
      const grupos = extra => compararFantasmas(valuar(aplicarEventos(datos, [...alta, ...extra]), ext, '2026-11-30')).grupos;
      const clave = grupos([]).find(g => g.origen === 'allaria').clave;
      const sinKo = grupos([evento(20, { tipo: 'fantasma_borrar', clave, ticker: 'KO' })]).find(g => g.origen === 'allaria');
      igual(sinKo.filas.map(f => f.ticker), ['AAPL', 'SPY'], 'quitar un ticker');
      const editada = grupos([evento(20, { tipo: 'fantasma_editar', clave, grupo: 'Allaria P4 bis', fecha: '2026-08-03', tickers: ['KO', 'NVDA', 'KO'] })]);
      const g = editada.find(x => x.origen === 'allaria');
      igual([g.nombre, g.fecha, g.filas.map(f => f.ticker)], ['Allaria P4 bis', '2026-08-03', ['KO', 'NVDA']], 'editada');
      si(editada.length === 2 && g.filas[0].hoy, 'se vuelve a medir desde la fecha nueva');
      igual(grupos([evento(20, { tipo: 'fantasma_borrar', clave })]).map(x => x.origen), ['radar'], 'borrada entera');
      const simple = grupos([]).find(x => x.origen === 'radar');
      const renombrada = grupos([evento(20, { tipo: 'fantasma_editar', clave: simple.clave, grupo: '', fecha: '2026-07-02', tickers: ['NVDA'] })]).find(x => x.origen === 'radar');
      igual([renombrada.nombre, renombrada.fecha], ['NVDA', '2026-07-02'], 'de un solo ticker');
    }],
  ];
}

// Sin volatilidad ni retornos: lo mismo que "si los precios no cambian".
const QUIETO = { escala_volatilidad: 0, retornos_etf: { SPY: 0, EFA: 0, EEM: 0, IWM: 0 }, acciones: { prima_mercado: 0 }, otros: { on: 0, fci_usd: 0, caja_usd: 0, pesos: 0 } };

function etapa3() {
  return [
    ['Los montos se leen como se escriben acá: un punto con tres cifras detrás separa miles', async () => {
      for (const [texto, numero] of [['1.200', 1200], ['30.000', 30000], ['1.234,56', 1234.56], ['12.345.678', 12345678], ['−1.500', -1500],['1234.5', 1234.5], ['1234,5', 1234.5], ['0.125', 0.125], ['1.0545', 1.0545], ['$ 5.395', 5395]]) {
        si(aNumero(texto) === numero, `${texto} → ${aNumero(texto)}`);
      }
      si(aNumero(fmt.num(1200)) === 1200 && aNumero(fmt.num(25836295.5, 2)) === 25836295.5, 'ida y vuelta con lo que muestra la app');
    }],

    ['Proyección con volatilidad cero: la mediana coincide con la proyección de hoy', async () => {
      for (const ingreso of [700, 1000, 1800]) {
        const { e } = mundo({ ajustar: x => { x.datos.supuestos = QUIETO; x.datos.perfil.ingreso_mensual_usd = ingreso; } });
        const sim = simular(e, { escenarios: 50 }), pr = proyeccion(e);
        for (const id of ['nucleo', 'satelites', 'ypf']) {
          const h = sim.hitos[id];
          si(pr[id] && h.m50 === pr[id].meses && h.f50 === pr[id].fecha, `${id} con ${ingreso}: ${h.m50} (${h.f50}) contra ${pr[id]?.meses} (${pr[id]?.fecha})`);
          si(h.m10 === h.m50 && h.m90 === h.m50 && h.en12 === (h.m50 <= 12 ? 1 : 0) && h.en24 === (h.m50 <= 24 ? 1 : 0), JSON.stringify(h));
        }
        for (const a of sim.anios) { cerca(a.p50, e.total_usd + pr.aporte * a.anios * 12, 0.01, `patrimonio a ${a.anios}`); cerca(a.p10, a.p90, 1e-6, 'sin dispersión'); cerca(a.aportado, a.p50, 0.01, 'aportado'); }
      }
    }],

    ['Proyección sin volatilidad: cada cosa crece a su retorno anual', async () => {
      const { e } = mundo({ ajustar: x => { x.datos.supuestos = { escala_volatilidad: 0 }; x.datos.perfil.ingreso_mensual_usd = 500; } });
      const sim = simular(e, { escenarios: 5 }), m = sim.modelo;
      si(sim.aporte === 0, 'sin aporte');
      const esperado = anios => m.items.reduce((s, x) => s + x.usd * Math.pow(1 + x.retorno, anios), 0);
      for (const a of sim.anios) cerca(a.p50, esperado(a.anios), 0.01, `a ${a.anios} años`);
    }],

    ['Proyección: con la semilla fija el resultado se repite, y con otra cambia', async () => {
      const una = () => simular(mundo().e, { escenarios: 200 });
      const a = una(), b = una();
      igual([a.hitos, a.abanico, a.anios], [b.hitos, b.abanico, b.anios], 'misma semilla');
      const c = simular(mundo().e, { escenarios: 200, semilla: 7 });
      si(JSON.stringify(c.anios) !== JSON.stringify(a.anios), 'otra semilla da otros caminos');
      const { e } = mundo();
      si(simular(e) === simular(e), 'dentro de la misma pantalla se calcula una vez');
    }],

    ['Proyección: percentiles y chances ordenados', async () => {
      const { e } = mundo({ ajustar: x => { x.datos.perfil.ingreso_mensual_usd = 700; } });
      const sim = simular(e, { escenarios: 500 });
      for (const h of Object.values(sim.hitos)) {
        si(h.en12 <= h.en24 + 1e-12, JSON.stringify(h));
        const m = [h.m10, h.m50, h.m90].map(v => v ?? Infinity);
        si(m[0] <= m[1] && m[1] <= m[2], JSON.stringify(h));
      }
      si(sim.hitos.tesis.m50 >= sim.hitos.nucleo.m50 && sim.hitos.tesis.m50 >= sim.hitos.satelites.m50, 'la tesis pide las dos cosas');
      for (const a of sim.anios) si(a.p10 < a.p50 && a.p50 < a.p90, JSON.stringify(a));
      si(sim.abanico.length === 61 && sim.abanico[0].p10 === sim.abanico[0].p90, 'arranca en el patrimonio de hoy');
      cerca(sim.abanico[0].p50, e.total_usd, 0.01, 'hoy');
    }],

    ['Proyección: la mediana y la dispersión de un solo ETF son las de su retorno y volatilidad', async () => {
      const { e } = mundo({ ajustar: x => {
        x.datos.posiciones = x.datos.posiciones.filter(p => p.ticker === 'SPY'); x.datos.lotes_costo = []; x.datos.caja = { ARS: 0, USD_MEP: 0 };
        x.datos.nucleo.pesos_internos = { SPY: 1 }; x.datos.perfil.ingreso_mensual_usd = 500;
      } });
      const sim = simular(e, { escenarios: 4000 }), s = sim.modelo.items.find(x => x.ticker === 'SPY'), uno = sim.anios[0];
      cerca(uno.p50 / (e.total_usd * 1.06), 1, 0.01, 'mediana: retorno compuesto');
      cerca(Math.log(uno.p90 / uno.p50), 1.2816 * s.vol, 0.1 * 1.2816 * s.vol, 'dispersión hacia arriba');
      cerca(Math.log(uno.p50 / uno.p10), 1.2816 * s.vol, 0.1 * 1.2816 * s.vol, 'dispersión hacia abajo');
      si(sim.modelo.factores[s.factor].origen === 'largo', 'los ETF usan la historia larga');
    }],

    ['Proyección: una acción con beta 1 y la volatilidad de SPY tiene la misma mediana que SPY', async () => {
      // Dos mundos iguales salvo dónde está la plata: todo en SPY o todo en una acción que se mueve exactamente igual.
      const conTodoEn = ticker => {
        const { e } = mundo({ ajustar: x => {
          x.datos.posiciones = x.datos.posiciones.filter(p => p.ticker === 'SPY' || p.ticker === 'NVDA');
          for (const p of x.datos.posiciones) p.cantidad = p.ticker === ticker ? 100 : 0;
          x.datos.lotes_costo = []; x.datos.caja = { ARS: 0, USD_MEP: 0 };
          x.datos.nucleo.pesos_internos = { SPY: 1 }; x.datos.perfil.ingreso_mensual_usd = 500; // sin aportes
          x.ext.historico.series.NVDA = x.ext.historico.series.SPY.slice();
          delete x.ext.largoPlazo; // así las dos volatilidades salen de la misma historia
        } });
        // el mismo horizonte en los dos: así cada camino usa los mismos números al azar (si no, la simulación
        // corta antes donde las reglas se cumplen antes)
        return { e, sim: simular(e, { escenarios: 1000, horizonte: 60 }) };
      };
      const spy = conTodoEn('SPY'), accion = conTodoEn('NVDA');
      const m = accion.sim.modelo, de = t => m.items.find(x => x.ticker === t);
      cerca(de('NVDA').beta, 1, 1e-9, 'beta'); cerca(de('NVDA').vol, de('SPY').vol, 1e-12, 'misma volatilidad');
      cerca(de('NVDA').retorno, 0.06 + de('SPY').vol ** 2 / 2, 1e-12, 'promedio: el de SPY compuesto más vol²/2');
      cerca(de('NVDA').deriva, de('SPY').deriva, 1e-12, 'misma mediana en el modelo');
      accion.sim.anios.forEach((a, i) => {
        const s = spy.sim.anios[i];
        for (const q of ['p10', 'p50', 'p90']) cerca(a[q] / accion.e.total_usd, s[q] / spy.e.total_usd, 1e-9, `${q} a ${a.anios} años`);
      });
      cerca(accion.sim.anios[0].p50 / accion.e.total_usd, 1.06, 0.02, 'y es el retorno compuesto de SPY');
    }],

    ['Proyección: acciones ancladas a SPY más (beta − 1) × prima; lo sin historia, con los supuestos de riesgo', async () => {
      const { e } = mundo({ ajustar: x => {
        const h = x.ext.historico.series;
        h.NVDA = h.SPY.map((v, i) => 150 * (v / h.SPY[0]) ** 2); // se mueve el doble que SPY
        delete h.PAM;
      } });
      const m = modelo(e), de = t => m.items.find(x => x.ticker === t), f = x => m.factores[x.factor];
      const promedioSpy = 0.06 + de('SPY').vol ** 2 / 2;
      cerca(de('NVDA').beta, 2, 1e-6, 'beta'); cerca(de('NVDA').retorno, promedioSpy + (2 - 1) * 0.04, 1e-6, 'retorno promedio');
      cerca(de('NVDA').deriva, Math.log(1 + de('NVDA').retorno - de('NVDA').vol ** 2 / 2), 1e-12, 'el promedio se corrige por volatilidad');
      si(de('PAMP').beta === 1 && f(de('PAMP')).origen === 'fija' && de('PAMP').vol === 0.35, JSON.stringify(de('PAMP')));
      cerca(de('PAMP').retorno, promedioSpy, 1e-12, 'sin historia se supone beta 1');
      cerca(de('PAMP').deriva, Math.log(1 + promedioSpy - 0.35 ** 2 / 2), 1e-12, 'más volatilidad, mediana más baja');
      si(de('PAMP').deriva < de('SPY').deriva, 'queda debajo de SPY');
      si(de('ON1').vol === 0.08 && de('FCID').vol === 0.03 && de('FCID').retorno === 0.04 && de('Caja en dólares').vol === 0, 'ON, fondos y caja');
      si(f(de('FCIP')).id === 'FCI:FCIP' && f(de('Caja en pesos')).id === 'MEP', 'el fondo en pesos con su cuotaparte; la caja, con el MEP');
      si(m.correlaciones[de('FCIP').factor][de('Caja en pesos').factor] > 0.9, 'se mueven casi juntos');
      cerca(m.correlaciones[de('NVDA').factor][de('SPY').factor], 1, 0.01, 'correlación diaria');
    }],

    ['Proyección: matrices de correlación incoherentes se corrigen sin perder el largo de cada una', async () => {
      const buena = [[1, 0.5, 0.2], [0.5, 1, 0.3], [0.2, 0.3, 1]], mala = [[1, 0.9, -0.9], [0.9, 1, 0.9], [-0.9, 0.9, 1]];
      for (const [C, exacta] of [[buena, true], [mala, false]]) {
        const A = raizCorrelacion(C), p = (i, j) => A[i].reduce((s, x, k) => s + x * A[j][k], 0);
        C.forEach((f, i) => { cerca(p(i, i), 1, 1e-9, 'diagonal'); if (exacta) f.forEach((v, j) => cerca(p(i, j), v, 1e-9, 'correlación')); });
        si(A.flat().every(Number.isFinite), 'sin números rotos');
      }
    }],

    ['Proyección: objetivos con fecha, contra el patrimonio o juntados aparte', async () => {
      const eventos = [
        evento(30, { tipo: 'objetivo', objetivo_id: 'a', nombre: 'Chico', monto_usd: 100, fecha: '2027-11-30' }),
        evento(31, { tipo: 'objetivo', objetivo_id: 'b', nombre: 'Imposible', monto_usd: 1e9, fecha: '2031-11-30' }),
        evento(32, { tipo: 'objetivo', objetivo_id: 'c', nombre: 'Medio', monto_usd: 1, fecha: '2029-11-30' }),
      ];
      eventos.push(evento(33, { tipo: 'objetivo', objetivo_id: 'c', nombre: 'Medio', monto_usd: 16345, fecha: '2027-11-30' }));
      const { e } = mundo({ eventos, ajustar: x => { x.datos.objetivos_externos = [{ nombre: 'Viaje', objetivo_usd: 1200, fecha: '2027-11-15', aporte_mensual_usd: 100 }, { nombre: 'Sin fecha', monto_usd: 5 }]; x.datos.perfil.ingreso_mensual_usd = 1100; } });
      const o = Object.fromEntries(simular(e, { escenarios: 400 }).objetivos.map(x => [x.nombre, x]));
      si(!o['Sin fecha'] && o.Chico.chance === 1 && o.Imposible.chance === 0, JSON.stringify(Object.keys(o)));
      si(o.Medio.monto_usd === 16345 && o.Medio.chance > 0 && o.Medio.chance < 1, JSON.stringify(o.Medio));
      si(o.Viaje.contra === 'aparte' && o.Viaje.llega === true && o.Viaje.proyectado === 1200, JSON.stringify(o.Viaje));
      const sin = mundo({ eventos: [...eventos, evento(40, { tipo: 'objetivo_borrar', ref: 'b' })] }).e;
      igual(sin.datos.objetivos.map(x => x.id), ['a', 'c'], 'borrar');
    }],

    ['Supuestos: se editan desde la app, mandan sobre el archivo y se pueden restaurar', async () => {
      const cambio = evento(50, { tipo: 'supuestos', cambios: { retornos_etf: { SPY: 0.02 } } });
      const con = mundo({ eventos: [cambio] }).e;
      si(supuestos(con).retornos_etf.SPY === 0.02 && supuestos(con).retornos_etf.EFA === 0.065 && supuestos(con).acciones.prima_mercado === 0.04, JSON.stringify(supuestos(con)));
      si(modelo(con).items.find(x => x.ticker === 'SPY').retorno === 0.02, 'la proyección lo usa');
      const accion = x => modelo(x).items.find(i => i.ticker === 'NVDA').retorno;
      cerca(accion(mundo().e) - accion(con), 0.04, 1e-12, 'las acciones se mueven con el supuesto de SPY');
      const vuelta = mundo({ eventos: [cambio, evento(51, { tipo: 'supuestos', restaurar: true })] }).e;
      si(supuestos(vuelta).retornos_etf.SPY === 0.06, 'restaurado');
      si(simular(mundo({ ajustar: x => { delete x.ext.supuestos; } }).e) === null, 'sin supuestos no se inventa nada');
    }],

    ['Proyección en palabras: rango, ya cumplida y fuera de alcance', async () => {
      si(textoHito({ cumplida: true }) === null, 'cumplida');
      const t = textoHito({ m10: 3, m50: 5, m90: 9, f10: '2027-02-01', f50: '2027-04-01', f90: '2027-08-01' });
      si(t === 'lo más probable abr 2027 (entre feb 2027 y ago 2027)', t);
      si(textoHito({ m10: 3, m50: 5, m90: null, f10: '2027-02-01', f50: '2027-04-01' }).endsWith('y más de 20 años)'), 'abierto');
      si(/casi seguro no antes de 20 años/.test(textoHito({ m10: null, m50: null, m90: null })), 'lejos');
    }],
  ];
}

function etapa4() {
  // Un mundo tranquilo, con acciones argentinas que se mueven igual que SPY.
  const calmo = (x, cambios = {}) => {
    const h = x.ext.historico.series;
    h.YPF = h.SPY.map(v => v / 10); h.PAM = h.SPY.map(v => v / 5);
    Object.assign(x.ext.mercado.fx, { mep: 1000, ccl: 1030, oficial: 960 }, cambios.fx);
    x.ext.argentina.riesgo_pais.ultimo.valor = cambios.riesgo ?? 650;
    if (cambios.adr) h.PAM = h.PAM.map((v, i) => i >= h.PAM.length - 5 ? v * (1 + cambios.adr) : v);
  };
  const sem = cambios => semaforoArgentina(mundo({ ajustar: x => calmo(x, cambios) }).e);
  return [
    ['Semáforo argentino: toma el peor de los cuatro y dice cuál lo puso así', async () => {
      const verde = sem();
      si(verde.color === 'verde' && !verde.por.length && !verde.sugerencia && /Argentina en verde/.test(textoSemaforo(verde)), JSON.stringify(verde.indicadores));
      igual(verde.indicadores.map(i => i.id), ['riesgo_pais', 'canje', 'brecha', 'adr'], 'los cuatro');
      cerca(verde.indicadores[1].valor, 0.03, 1e-9, 'canje'); cerca(verde.indicadores[2].valor, 1000 / 960 - 1, 1e-9, 'brecha'); cerca(verde.indicadores[3].valor, 0, 1e-9, 'contra SPY');
      const amarillo = sem({ fx: { oficial: 880 } });
      si(amarillo.color === 'amarillo' && amarillo.por.map(i => i.id).join() === 'brecha' && !amarillo.sugerencia && /lo pone así la brecha \(13,6%\)/.test(textoSemaforo(amarillo)), textoSemaforo(amarillo));
      const rojo = sem({ fx: { oficial: 880 }, riesgo: 1600 });
      si(rojo.color === 'rojo' && rojo.por.map(i => i.id).join() === 'riesgo_pais', textoSemaforo(rojo));
      si(/R6B/.test(rojo.sugerencia) && /parte en pesos de la reserva/.test(rojo.sugerencia) && /No hay que hacer nada automáticamente/.test(rojo.sugerencia), rojo.sugerencia);
      const dos = sem({ riesgo: 900, fx: { ccl: 1070 } });
      si(dos.color === 'amarillo' && /ponen así el riesgo país \(900\) y el canje/.test(textoSemaforo(dos)), textoSemaforo(dos));
      const adr = sem({ adr: -0.4 }); // PAM −40% y YPF igual a SPY: en promedio −20%
      si(adr.color === 'rojo' && adr.por[0].id === 'adr', JSON.stringify(adr.indicadores[3]));
      cerca(adr.indicadores[3].valor, -0.2, 1e-6, 'promedio de las dos');
    }],

    ['Semáforo: umbrales editables, no genera tareas ni toca reglas, y sin datos no inventa', async () => {
      const e = mundo({ ajustar: x => calmo(x), eventos: [evento(60, { tipo: 'supuestos', cambios: { semaforo: { riesgo_pais: { amarillo: 500, rojo: 600 } } } })] }).e;
      si(semaforoArgentina(e).color === 'rojo', 'tomó el umbral editado');
      const rojo = mundo({ ajustar: x => calmo(x, { riesgo: 3000 }) }).e, calmoE = mundo({ ajustar: x => calmo(x) }).e;
      const resumen = e => { const p = planificador(e, e.hoy); return [p.pasos.map(s => s.id), p.reglas.map(r => [r.id, r.nivel])]; };
      igual(resumen(rojo), resumen(calmoE), 'el semáforo no cambia pasos ni reglas');
      const sin = semaforoArgentina(mundo({ ajustar: x => { delete x.ext.argentina; delete x.ext.mercado.fx.oficial; delete x.ext.historico.series.YPF; delete x.ext.historico.series.PAM; delete x.ext.historico.series.MEP; x.ext.mercado = null; } }).e);
      si(sin.color === null && sin.sin_dato.length === 4 && /Sin datos/.test(textoSemaforo(sin)), JSON.stringify(sin));
    }],

    ['Elecciones: combina los mercados por volumen, avisa si difieren más de 10 puntos y cuenta los días', async () => {
      const r = eleccion(mundo().e), c = Object.fromEntries(r.candidatos.map(x => [x.nombre, x]));
      si(r.dias === 328 && r.fecha === '2027-10-24', String(r.dias));
      igual(r.candidatos.map(x => x.nombre), ['Candidata Uno', 'Candidato Dos', 'Candidato Tres'], 'por probabilidad');
      cerca(c['Candidata Uno'].combinada, (0.5 * 3000 + 0.38 * 9000) / 12000, 1e-12, 'ponderada por volumen');
      si(c['Candidata Uno'].difiere && !c['Candidato Dos'].difiere && r.difieren.length === 1, 'diferencia de 12 puntos');
      cerca(c['Candidato Dos'].combinada, 0.325, 1e-12, 'mismo candidato con apodo en un mercado');
      si(!c['Candidato Tres'].en.polymarket && c['Candidato Tres'].combinada === 0.1 && c['Candidato Tres'].diferencia === null, 'en uno solo');
      const uno = eleccion(mundo({ ajustar: x => { x.ext.argentina.elecciones.polymarket = { nombre: 'Polymarket', desactivado: true }; } }).e);
      si(uno.mercados.find(m => m.id === 'polymarket').desactivado && uno.candidatos[0].combinada === 0.5 && !uno.difieren.length, 'con un mercado apagado');
      si(eleccion(mundo({ ajustar: x => { delete x.ext.argentina; } }).e).candidatos.length === 0, 'sin datos');
      const sinVolumen = eleccion(mundo({ ajustar: x => { for (const m of ['kalshi', 'polymarket']) x.ext.argentina.elecciones[m].candidatos.forEach(v => { v.volumen = 0; }); } }).e);
      cerca(sinVolumen.candidatos.find(x => x.nombre === 'Candidata Uno').combinada, 0.44, 1e-12, 'sin volumen, promedio simple');
      for (const [a, b] of [['Cristina Fernández de Kirchner', 'Cristina Kirchner'], ['Eduardo "Wado" de Pedro', 'Eduardo de Pedro'], ['Horacio Rodríguez Larreta', 'Horacio Rodriguez Larreta']]) si(claveCandidato(a) === claveCandidato(b), `${a} / ${b}`);
      si(claveCandidato('Javier Milei') !== claveCandidato('Karina Milei'), 'no mezcla apellidos iguales');
    }],

    ['Reserva en pesos: cuánto tenía que subir el MEP, cuánto subió y qué rindió cada fondo', async () => {
      // MEP fijo hasta fines de septiembre y +10% en octubre; noviembre quieto.
      const { e } = mundo({ ajustar: x => {
        const h = x.ext.historico;
        h.series.MEP = h.fechas.map(f => f <= '2026-09-30' ? 1000 : 1100);
        x.ext.argentina.fondos.fechas = ['2026-08-31', '2026-09-30', '2026-10-30', '2026-11-27'];
        x.ext.argentina.fondos.series = { 'Fondo Pesos Ejemplo': [100, 102, 104.04, 106.1208], 'Fondo Dolar Ejemplo': [1, 1.004, 1.008016, 1.012048] };
      } });
      const r = reservaEnPesos(e), f = Object.fromEntries(r.filas.map(x => [x.mes, x]));
      igual([r.fondos_pesos, r.fondos_usd], [['FCIP'], ['FCID']], 'tus fondos');
      const sep = f['2026-09'], oct = f['2026-10'];
      cerca(sep.tasa, 0.3 * 30 / 365, 1e-12, 'tasa del mes'); cerca(sep.usd, 0.004, 1e-9, 'fondo en dólares');
      cerca(sep.necesaria, (1 + 0.3 * 30 / 365) / 1.004 - 1, 1e-9, 'cuánto tenía que subir');
      cerca(sep.mep, 0, 1e-12, 'no subió'); cerca(sep.pesos, 0.02, 1e-9, 'pesos'); si(sep.gano === 'pesos' && sep.usd_real, JSON.stringify(sep));
      cerca(oct.mep, 0.1, 1e-9, 'subió 10%'); cerca(oct.pesos_en_usd, (1 + oct.pesos) / 1.1 - 1, 1e-12, 'en dólares'); si(oct.gano === 'dólares', JSON.stringify(oct));
      si(r.filas.at(-1).mes === '2026-11' && r.filas.at(-1).parcial && r.filas.at(-1).hasta === '2026-11-27', JSON.stringify(r.filas.at(-1)));
      // Sin fondos propios usa la tasa y el supuesto del fondo en dólares.
      const sin = reservaEnPesos(mundo({ ajustar: x => { x.ext.argentina.fondos.series = {}; } }).e);
      si(sin.filas.length > 6 && sin.filas.every(x => x.pesos === null && !x.usd_real) && !sin.fondos_pesos.length, JSON.stringify(sin.filas[0]));
      si(reservaEnPesos(mundo({ ajustar: x => { delete x.ext.argentina.plazo_fijo; } }).e) === null, 'sin tasa no hay tabla');
    }],

    ['Riesgo: los fondos en pesos cuentan el interés que cobran', async () => {
      const enLP = x => { x.datos.posiciones.find(p => p.ticker === 'FCIP').bloque = 'renta_fija_ars'; };
      const con = riesgo(mundo({ ajustar: enLP }).e);
      si(con.posiciones.FCIP.serie === 'FCI:FCIP' && con.supuestos.some(s => /incluyen el interés/.test(s)), JSON.stringify(con.posiciones.FCIP));
      const sin = riesgo(mundo({ ajustar: x => { enLP(x); delete x.ext.argentina; } }).e);
      si(sin.posiciones.FCIP.serie === 'MEP', 'sin datos, como antes');
      si(con.escenarios.peor_cada_uno.usd < sin.escenarios.peor_cada_uno.usd, 'con interés, el peor mes pierde menos');
      cerca(con.posiciones.FCIP.vol_anual, sin.posiciones.FCIP.vol_anual, 0.01, 'la volatilidad la sigue poniendo el dólar');
      // Sin cuotapartes del fondo, el interés sale de la tasa de plazo fijo.
      const tasa = mundo({ ajustar: x => { enLP(x); x.ext.argentina.fondos.series = {}; } }).e;
      const r = riesgo(tasa), s = historiaRiesgo(tasa).series['FCI:FCIP'], mep = tasa.historico.series.MEP, n = mep.length - 1;
      si(r.posiciones.FCIP.serie === 'FCI:FCIP' && s[n] * mep[n] > s[0] * mep[0] * 1.2, 'acumula la tasa');
    }],
  ];
}

function etapa5() {
  // El núcleo sube parejo y al final cae `caida` desde su máximo; la reserva tiene `extra` USD de más.
  const escenario = ({ caida = 0.2, extra = 2000, activo = true, ajustes = {} } = {}) => mundo({
    eventos: activo == null ? [] : [evento(70, { tipo: 'aporte_extra', cambios: { activo, ...ajustes } })],
    ajustar: x => {
      const h = x.ext.historico.series, n = x.ext.historico.fechas.length;
      for (const t of ['SPY', 'EFA', 'EEM', 'IWM']) {
        h[t] = x.ext.historico.fechas.map((_, i) => i < n - 10 ? 100 + i / 10 : (100 + (n - 11) / 10) * (1 - caida));
        x.ext.mercado.implicito.usa.precios[t] = [h[t][n - 1], 0];
      }
      x.datos.emergencia.objetivo_usd = valuar(aplicarEventos(x.datos), x.ext, '2026-11-30').emergencia_usd - extra;
    },
  }).e;
  return [
    ['Clima de mercado: los cuatro indicadores, con su lectura en palabras y su historia', async () => {
      const { e } = mundo({ ajustar: x => { const s = x.ext.clima.series; s.BAMLH0A0HYM2.ultimo.valor = 4.5; s.T10Y3M.ultimo.valor = -0.1; s.VIXCLS.ultimo.valor = 15; } });
      const c = climaMercado(e), i = Object.fromEntries(c.indicadores.map(x => [x.id, x]));
      igual(c.indicadores.map(x => x.id), ['alto_rendimiento', 'curva', 'vix', 'spy_promedio'], 'los cuatro');
      igual([i.alto_rendimiento.lectura, i.curva.lectura, i.vix.lectura], ['atento', 'tenso', 'tranquilo'], 'lecturas');
      si(c.lectura === 'tenso' && /bonos de riesgo atento \(4,50\) · curva de tasas tenso \(−0,10\) · VIX tranquilo \(15,0\)/.test(textoClima(c)), textoClima(c));
      si(c.indicadores.every(x => x.historia.fechas.length > 10 && x.historia.fechas.length === x.historia.valores.length), 'historia');
      const s = e.historico.series.SPY, n = s.length, promedio = s.slice(n - 200).reduce((a, v) => a + v, 0) / 200;
      cerca(i.spy_promedio.valor, s[n - 1] / promedio - 1, 1e-12, 'SPY contra su promedio de 200 ruedas');
      si(spyContraPromedio({ fechas: e.historico.fechas.slice(0, 100), series: { SPY: s.slice(0, 100) } }) === null, 'con menos de 200 ruedas no hay promedio');
      const sin = climaMercado(mundo({ ajustar: x => { delete x.ext.clima; delete x.ext.historico.series.SPY; } }).e);
      si(sin.lectura === null && sin.indicadores.every(x => x.texto === '—') && /Sin datos/.test(textoClima(sin)), JSON.stringify(sin.indicadores[0]));
      const editado = mundo({ eventos: [evento(71, { tipo: 'supuestos', cambios: { clima: { vix: { atento: 10 } } } })] }).e;
      si(climaMercado(editado).indicadores[2].lectura === 'atento', 'umbrales editables');
    }],

    ['Caída del núcleo desde su máximo, con los precios del momento', async () => {
      const e = escenario({ caida: 0.2 });
      cerca(caidaNucleo(e).caida, 0.2, 1e-9, 'caída');
      const n = e.historico.fechas.length;
      si(caidaNucleo(e).desde === e.historico.fechas[n - 11], 'fecha del máximo: ' + caidaNucleo(e).desde);
      for (const t of ['SPY', 'EFA', 'EEM', 'IWM']) e.mercado.implicito.usa.precios[t] = [e.historico.series[t][n - 1] * 0.9, 0];
      cerca(caidaNucleo(e).caida, 1 - 0.8 * 0.9, 1e-9, 'con el precio de hoy');
    }],

    ['Aporte extra: apagado por defecto; prendido, solo con excedente y caída suficiente', async () => {
      si(aporteExtra(escenario({ activo: null })) === null && ajustesAporteExtra(escenario({ activo: null })).activo === false, 'apagado de fábrica');
      const a = aporteExtra(escenario());
      cerca(a.usd, 1000, 1e-6, 'la mitad del excedente'); cerca(a.caida, 0.2, 1e-9, 'caída');
      si(/podés sumar USD\s1\.000 \(50% del excedente\) al núcleo/.test(a.texto) && /No vendas nada y seguí con tus aportes/.test(a.texto), a.texto);
      si(aporteExtra(escenario({ caida: 0.1 })) === null, 'caída chica');
      si(aporteExtra(escenario({ extra: -500 })) === null, 'sin excedente');
      si(aporteExtra(escenario({ activo: false })) === null, 'apagado a mano');
      cerca(aporteExtra(escenario({ caida: 0.1, ajustes: { caida: 0.08, parte: 0.25 } })).usd, 500, 1e-6, 'ajustes propios');
      const conTope = escenario(); conTope.datos.reglas.find(r => r.id === 'R1').meses_exceso = 100;
      si(aporteExtra(conTope) === null, 'si R1 no lo considera exceso, no sugiere');
    }],

    ['Aporte extra y clima: nunca cambian los pasos de Hoy ni las reglas', async () => {
      const resumen = e => { const p = planificador(e, e.hoy); return [p.pasos.map(s => s.id + s.titulo), p.reglas.map(r => [r.id, r.nivel])]; };
      igual(resumen(escenario()), resumen(escenario({ activo: false })), 'iguales con el aviso prendido o apagado');
    }],
  ];
}

export function pruebasRonda2() {
  return [...etapa1(), ...etapa3(), ...etapa4(), ...etapa5()];
}
