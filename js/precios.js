// Comprar al mejor precio: precio justo de cada CEDEAR, especie en dólares y ventana horaria. Todo puro.
import { fechas, fmt, suma } from './util.js';

export const PRIMA_MAXIMA = 0.01;       // un CEDEAR más de esto sobre su precio justo se saltea ese día
const TOLERANCIA_RATIO = 0.05;          // más diferencia entre el ratio oficial y el que surge de los precios: revisar
const PAPELES_LIQUIDOS = 30, MINIMO_PAPELES = 5;

export const primaMaxima = e => e.datos?.config?.prima_maxima ?? PRIMA_MAXIMA;
// Los precios sirven para decidir mientras sean de hoy o de ayer.
const recientes = e => !!e.mercado?.generado && fechas.dias(e.mercado.generado.slice(0, 10), e.hoy) <= 1;

// Mediana del dólar implícito (contado con liqui) de los papeles de más volumen. null si no hay datos de ahora.
export function referenciaImplicito(e) {
  const c = e.mercado?.implicito?.ccl;
  if (!c || c.stale || !recientes(e)) return null;
  const n = e.datos?.config?.papeles_liquidos || PAPELES_LIQUIDOS;
  const v = Object.values(c.papeles || {}).filter(([x, vol]) => x > 0 && vol > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(p => p[0]).sort((a, b) => a - b);
  if (v.length < MINIMO_PAPELES) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Si los precios se tomaron sin Wall Street abierto (o sin rueda en BYMA), el de EE.UU. y el del CEDEAR son de
// momentos distintos. Devuelve la explicación para mostrar (o '' si no hay nada que aclarar).
export function avisoPrecioJusto(e) {
  const m = e.mercado;
  if (!e.ratios || !m?.implicito) return '';
  const falta = wallStreet(m.generado, e.feriados) ? 'Wall Street abierto' : sinByma(m.generado, e.feriados) ? 'rueda en BYMA' : null;
  return falta ? `Los precios se tomaron sin ${falta}, así que no hay precio justo. Actualizalos dentro de la ventana para verlo.` : '';
}

// Precio justo en pesos de un CEDEAR = subyacente en EE.UU. × dólar de referencia ÷ ratio.
// prima = cuánto más caro (o barato, si es negativa) está contra ese precio.
// revisar = los precios no cierran con el ratio oficial: no usar el precio justo hasta revisarlo.
// Devuelve null si falta algún dato, está sin actualizar o no es del mismo momento (Wall Street cerrado).
export function precioJusto(e, ticker) {
  const info = e.ratios?.[ticker], m = e.mercado;
  if (!info || !(info.ratio > 0)) return null;
  const subyacente = 'usa' in info ? info.usa : ticker;
  const local = m?.cedears?.stale ? null : m?.cedears?.precios?.[ticker];
  const afuera = m?.implicito?.usa?.stale ? null : m?.implicito?.usa?.precios?.[subyacente];
  const ref = referenciaImplicito(e);
  if (!local?.[0] || !afuera?.[0] || !ref) return null;
  if (wallStreet(m.generado, e.feriados) || sinByma(m.generado, e.feriados) || (afuera[2] && afuera[2] !== m.generado.slice(0, 10))) return null;
  const precio = local[0], justo = afuera[0] * ref / info.ratio;
  return {
    ticker, subyacente, ratio: info.ratio, subyacente_usd: afuera[0], ccl_ref: ref, precio_ars: precio, justo_ars: justo,
    implicito: precio * info.ratio / afuera[0], prima: precio / justo - 1,
    // también si la lista de BYMA dice otro ratio: el del tablero no se cambia solo
    revisar: Math.abs(afuera[0] * ref / precio / info.ratio - 1) > TOLERANCIA_RATIO || !!m.ratios_byma?.cambios?.[ticker],
  };
}

// Precio límite sugerido: el precio justo (o el de pantalla, si está más barato) más el margen máximo aceptado.
export const precioLimite = (e, justo, precio) => Math.min(justo, precio) * (1 + primaMaxima(e));
// Para vender, al revés: el precio justo (o el de pantalla, si está más caro) menos el margen.
export const precioLimiteVenta = (e, justo, precio) => Math.max(justo, precio) * (1 - primaMaxima(e));
export const textoPrima = p => `${fmt.pct(Math.abs(p))} ${p >= 0 ? 'caro' : 'barato'}`;

// Precio justo para una venta, con la misma vara que en las compras. barato = está más del margen por debajo:
// conviene esperar. null si no hay precio justo.
export function paraVender(e, ticker) {
  const j = precioJusto(e, ticker);
  if (!j) return null;
  return {
    ...j, hora: horaPrecios(e),
    limite: j.revisar ? null : precioLimiteVenta(e, j.justo_ars, j.precio_ars),
    barato: !j.revisar && j.prima < -primaMaxima(e),
  };
}

// La especie en dólares (MEP) del mismo CEDEAR: ¿conviene pagarla con los dólares de la cuenta?
// Devuelve { especie, precio_usd, equivalente_ars, conviene } o null si no cotiza o los precios no son de ahora.
export function especieD(e, ticker) {
  const m = e.mercado, tabla = m?.cedears;
  if (!tabla || tabla.stale || !recientes(e)) return null;
  const pesos = tabla.precios?.[ticker]?.[0];
  if (!pesos) return null;
  const info = e.ratios?.[ticker];
  // "AM" + "D" es otra empresa (AMD): esa forma solo vale si no es el código de otro CEDEAR.
  const candidatas = [info?.d, ticker + '.D', e.ratios?.[ticker + 'D'] ? null : ticker + 'D'].filter(Boolean);
  for (const especie of candidatas) {
    const usd = tabla.precios[especie]?.[0];
    if (!usd) continue;
    const equivalente = usd * e.mep;
    if (Math.abs(equivalente / pesos - 1) > 0.1) continue; // no parece la misma especie
    return { especie, precio_usd: usd, equivalente_ars: equivalente, conviene: equivalente <= pesos * (1 + 1e-9) };
  }
  return null;
}

// Pasa a la especie en dólares las unidades que los dólares de la cuenta alcanzan a pagar, si no es más cara.
// Devuelve el mismo reparto con las compras separadas (las pagadas en dólares llevan moneda 'USD' y especie).
export function conDolares(e, rep, usdDisponible) {
  const c = e.datos.config.costo_entrada_estimado;
  let usd = Math.max(0, usdDisponible);
  const compras = [];
  for (const compra of rep.compras) {
    const d = especieD(e, compra.ticker);
    const n = d?.conviene ? Math.min(compra.cantidad, Math.floor(usd / (d.precio_usd * (1 + c)) + 1e-9)) : 0;
    if (n > 0) {
      usd -= n * d.precio_usd * (1 + c);
      const pesos = n * d.precio_usd * e.mep;
      compras.push({
        ...compra, cantidad: n, moneda: 'USD', especie: d.especie, precio: d.precio_usd, precio_pesos: compra.precio,
        limite: compra.justo_ars ? precioLimite(e, compra.justo_ars / e.mep, d.precio_usd) : null,
        monto_ars: pesos, monto_usd: n * d.precio_usd, gastos: Math.round(pesos * c * 100) / 100,
      });
    }
    const resto = compra.cantidad - n;
    if (resto > 0) compras.push(n ? { ...compra, cantidad: resto, monto_ars: resto * compra.precio, monto_usd: resto * compra.precio / e.mep, gastos: Math.round(resto * compra.precio * c * 100) / 100 } : compra);
  }
  const invertido = suma(compras, x => x.monto_usd);
  return { ...rep, compras, invertido_usd: invertido, costo_usd: invertido * c, sobrante_usd: rep.usd - invertido * (1 + c) };
}

// Los dólares MEP de la cuenta que se pueden usar para comprar (nunca más que la caja neta).
export const dolaresEnCaja = e => Math.max(0, Math.min(e.datos.caja.USD_MEP || 0, e.caja_usd));

// ---------- Ventana para comprar ----------
const NY = 'America/New_York', BA = 'America/Argentina/Buenos_Aires';
const formatos = {};
// Minutos que hay que sumarle a la hora UTC para tener la hora local de una zona, en una fecha dada.
function desfase(fecha, zona) {
  const f = formatos[zona] || (formatos[zona] = new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }));
  const p = Object.fromEntries(f.formatToParts(new Date(fecha + 'T12:00:00Z')).map(x => [x.type, x.value]));
  return (+p.hour) * 60 + (+p.minute) - 720;
}
const minutos = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const hora = min => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const diaSemana = f => new Date(f + 'T12:00:00Z').getUTCDay();

// Horario de BYMA vigente en una fecha: el último tramo que ya empezó.
function horarioByma(calendario, fecha) {
  const tramos = (calendario?.byma?.horarios || []).filter(h => h.desde <= fecha).sort((a, b) => a.desde < b.desde ? -1 : 1);
  return tramos.at(-1) || { apertura: '11:00', cierre: '17:00', confirmado: false };
}

// ¿Qué pasa en BYMA ese día? { sinRueda: motivo } si no se opera; { sinLiquidacion: motivo } si se opera pero no
// se liquida (días no laborables, según el calendario de BYMA); {} si es un día normal.
// Fuentes: feriados argentinos (ArgentinaDatos, `calendario.argentina`) y excepciones que publica BYMA.
export function diaByma(calendario, fecha) {
  const x = calendario?.byma?.excepciones, ar = calendario?.argentina?.feriados?.[fecha];
  if (x?.sin_rueda?.[fecha]) return { sinRueda: x.sin_rueda[fecha] };
  if (ar && ar.tipo !== 'puente') return { sinRueda: `feriado argentino: ${ar.nombre}` };
  const nota = x?.sin_liquidacion?.[fecha] || ar?.nombre;
  return nota ? { sinLiquidacion: nota } : {};
}

// Ventana de un día: Wall Street abierto y hasta media hora antes del cierre de BYMA (hora argentina).
// Devuelve { abre, cierra, media, sinDato, sinDatoAr, sinLiquidacion, confirmado } o { cerrado: motivo }.
export function ventanaDelDia(calendario, fecha) {
  const d = diaSemana(fecha);
  if (d === 0 || d === 6) return { cerrado: 'es fin de semana' };
  const feriado = calendario?.feriados?.[fecha], local = diaByma(calendario, fecha);
  if (feriado && local.sinRueda) return { cerrado: `no hay mercado en EE.UU. (${feriado}) ni en BYMA` };
  if (feriado) return { cerrado: `no hay mercado en EE.UU. (${feriado})` };
  if (local.sinRueda) return { cerrado: `no opera BYMA (${local.sinRueda})` };
  const media = calendario?.medias_ruedas?.[fecha];
  const diferencia = desfase(fecha, BA) - desfase(fecha, NY);
  const byma = horarioByma(calendario, fecha);
  const abre = Math.max(minutos('9:30') + diferencia, minutos(byma.apertura));
  const cierra = Math.min(minutos(media ? '13:00' : '16:00') + diferencia, minutos(byma.cierre) - 30);
  if (cierra <= abre) return { cerrado: 'Wall Street y BYMA no coinciden' };
  return {
    abre: hora(abre), cierra: hora(cierra), media: media || null, confirmado: byma.confirmado !== false,
    sinDato: !calendario?.anios?.includes(+fecha.slice(0, 4)),
    sinDatoAr: !calendario?.argentina?.anios?.includes(+fecha.slice(0, 4)),
    sinLiquidacion: local.sinLiquidacion || null,
  };
}

// Fecha y minutos del día en Argentina de un momento ISO (o Date). null si no es un momento válido.
function enArgentina(momento) {
  const t = new Date(momento);
  if (Number.isNaN(t.getTime())) return null;
  const local = new Date(t.getTime() + desfase(t.toISOString().slice(0, 10), BA) * 60000);
  return { fecha: local.toISOString().slice(0, 10), min: local.getUTCHours() * 60 + local.getUTCMinutes() };
}
// Si los precios se tomaron un día sin rueda en BYMA, el motivo; si no, null.
export function sinByma(generado, calendario) {
  const a = generado ? enArgentina(generado) : null;
  return a ? diaByma(calendario, a.fecha).sinRueda || null : null;
}

// De cuándo son los precios, en hora argentina: "de las 14:40" (si son de hoy) o "del 25/11 a las 14:40".
export function horaPrecios(e) {
  const a = e.mercado?.generado ? enArgentina(e.mercado.generado) : null;
  if (!a) return null;
  const hm = `${Math.floor(a.min / 60)}:${String(a.min % 60).padStart(2, '0')}`;
  return a.fecha === e.hoy ? `de las ${hm}` : `del ${a.fecha.slice(8, 10)}/${a.fecha.slice(5, 7)} a las ${hm}`;
}

export const MINUTOS_PRECIO_VIEJO = 60;
// Antes de operar: cuántos minutos tienen los precios, si la ventana está abierta ahora y si conviene actualizarlos.
export function frescuraPrecios(e, ahora = new Date()) {
  const generado = e.mercado?.generado, a = enArgentina(ahora);
  if (!generado || !a) return null;
  const minutosViejos = Math.max(0, Math.round((new Date(ahora).getTime() - new Date(generado).getTime()) / 60000));
  const v = ventanaDelDia(e.feriados, a.fecha);
  const abierta = !v.cerrado && a.min >= minutos(v.abre) && a.min <= minutos(v.cierra);
  const limite = e.datos?.config?.minutos_precio_viejo ?? MINUTOS_PRECIO_VIEJO;
  return { minutos: minutosViejos, abierta, sugerir: abierta && minutosViejos > limite, hora: horaPrecios(e) };
}

// ¿Hubo rueda en EE.UU. hasta el momento de los precios (`generado`, ISO)? null si sí; si no, el motivo.
export function wallStreet(generado, calendario) {
  if (!generado) return null;
  const t = new Date(generado), utc = t.getUTCHours() * 60 + t.getUTCMinutes();
  const dif = desfase(generado.slice(0, 10), NY), min = utc + dif;
  const fecha = new Date(t.getTime() + dif * 60000).toISOString().slice(0, 10);
  if ([0, 6].includes(diaSemana(fecha)) || calendario?.feriados?.[fecha]) return 'Wall Street no operó';
  return min < minutos('9:30') ? 'Wall Street todavía no abrió' : null;
}

// Por qué se movió un CEDEAR hoy: cuánto fue el subyacente en EE.UU. y cuánto el dólar implícito contra el MEP.
// diaUsd = movimiento del día en dólares MEP. '' si no hay precios de EE.UU. del momento.
export function porQueSeMovio(e, ticker, diaUsd) {
  const info = e.ratios?.[ticker], subyacente = info && 'usa' in info ? info.usa : ticker;
  const usa = e.mercado?.implicito?.usa, fila = usa?.stale ? null : usa?.precios?.[subyacente];
  if (!fila) return '';
  const generado = e.mercado.generado;
  const cerrado = wallStreet(generado, e.feriados) || (fila[2] && fila[2] !== generado?.slice(0, 10) ? 'Wall Street no operó' : null);
  if (cerrado) return `${cerrado}: todo el movimiento vino del dólar implícito contra el MEP.`;
  const afuera = (fila[1] || 0) / 100;
  return `En EE.UU. ${subyacente} se movió ${fmt.pctSigno(afuera)} y el dólar implícito contra el MEP puso ${fmt.pctSigno((1 + diaUsd) / (1 + afuera) - 1)}.`;
}

// La frase que acompaña a los pasos de compra (o de venta): cuándo conviene operar, a partir de `hoy`.
export function textoVentana(calendario, hoy, { vender = false } = {}) {
  const v = ventanaDelDia(calendario, hoy), [hacer, noHagas] = vender ? ['Vendé', 'no vendas'] : ['Comprá', 'no compres'];
  const detalle = x => `de ${x.abre} a ${x.cierra} (hora argentina)${x.media ? `: es media rueda en EE.UU. (${x.media})` : ''}`;
  const avisos = (x, fecha) => [
    x.sinLiquidacion ? ` Ese día BYMA opera pero no liquida (${x.sinLiquidacion}): se acredita más tarde.` : '',
    x.sinDato ? ` Ojo: no tengo cargados los feriados de EE.UU. de ${fecha.slice(0, 4)}.` : '',
    x.sinDatoAr ? ` Ojo: no tengo cargados los feriados argentinos de ${fecha.slice(0, 4)}.` : '',
    x.confirmado ? '' : ' El horario de BYMA para esa fecha falta confirmarlo.',
  ].join('');
  if (!v.cerrado) return `${hacer} hoy ${detalle(v)}, con Wall Street abierto y hasta media hora antes del cierre de BYMA.${avisos(v, hoy)}`;
  for (let i = 1; i <= 15; i++) {
    const f = fechas.sumar(hoy, i), w = ventanaDelDia(calendario, f);
    if (!w.cerrado) return `Hoy ${v.cerrado}: ${noHagas}. Próxima ventana: ${DIAS[diaSemana(f)]} ${fmt.fechaLarga(f)}, ${detalle(w)}.${avisos(w, f)}`;
  }
  return `Hoy ${v.cerrado}: ${noHagas}.`;
}
