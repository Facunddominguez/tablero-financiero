// Pruebas públicas de la ronda 2 (sin datos privados). Corren junto con js/pruebas_publicas.js.
import { aplicarEventos, valuar } from './estado.js';
import { planificador } from './motor.js';
import { ventanaDelDia, textoVentana, precioJusto, paraVender, horaPrecios, frescuraPrecios, avisoPrecioJusto } from './precios.js';
import { compararFantasmas, puntajePredicciones } from './diario.js';
import { fusionar } from './sync.js';
import { ejemplo } from './ejemplo.js';

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

export function pruebasRonda2() {
  return [...etapa1()];
}
