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

// Precio justo en pesos de un CEDEAR = subyacente en EE.UU. × dólar de referencia ÷ ratio.
// prima = cuánto más caro (o barato, si es negativa) está contra ese precio.
// revisar = los precios no cierran con el ratio oficial: no usar el precio justo hasta revisarlo.
// Devuelve null si falta algún dato o está sin actualizar.
export function precioJusto(e, ticker) {
  const info = e.ratios?.[ticker], m = e.mercado;
  if (!info || !(info.ratio > 0)) return null;
  const subyacente = 'usa' in info ? info.usa : ticker;
  const local = m?.cedears?.stale ? null : m?.cedears?.precios?.[ticker];
  const afuera = m?.implicito?.usa?.stale ? null : m?.implicito?.usa?.precios?.[subyacente];
  const ref = referenciaImplicito(e);
  if (!local?.[0] || !afuera?.[0] || !ref) return null;
  const precio = local[0], justo = afuera[0] * ref / info.ratio;
  return {
    ticker, subyacente, ratio: info.ratio, subyacente_usd: afuera[0], ccl_ref: ref, precio_ars: precio, justo_ars: justo,
    implicito: precio * info.ratio / afuera[0], prima: precio / justo - 1,
    revisar: Math.abs(afuera[0] * ref / precio / info.ratio - 1) > TOLERANCIA_RATIO,
  };
}

// Precio límite sugerido: el precio justo (o el de pantalla, si está más barato) más el margen máximo aceptado.
export const precioLimite = (e, justo, precio) => Math.min(justo, precio) * (1 + primaMaxima(e));

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

// Ventana de un día: Wall Street abierto y hasta media hora antes del cierre de BYMA (hora argentina).
// Devuelve { abre, cierra, media, sinDato, confirmado } o { cerrado: motivo }.
export function ventanaDelDia(calendario, fecha) {
  const d = diaSemana(fecha);
  if (d === 0 || d === 6) return { cerrado: 'es fin de semana' };
  const feriado = calendario?.feriados?.[fecha];
  if (feriado) return { cerrado: `no hay mercado en EE.UU. (${feriado})` };
  const media = calendario?.medias_ruedas?.[fecha];
  const diferencia = desfase(fecha, BA) - desfase(fecha, NY);
  const byma = horarioByma(calendario, fecha);
  const abre = Math.max(minutos('9:30') + diferencia, minutos(byma.apertura));
  const cierra = Math.min(minutos(media ? '13:00' : '16:00') + diferencia, minutos(byma.cierre) - 30);
  if (cierra <= abre) return { cerrado: 'Wall Street y BYMA no coinciden' };
  return {
    abre: hora(abre), cierra: hora(cierra), media: media || null, confirmado: byma.confirmado !== false,
    sinDato: !calendario?.anios?.includes(+fecha.slice(0, 4)),
  };
}

// La frase que acompaña a los pasos de compra: cuándo conviene operar, a partir de `hoy`.
export function textoVentana(calendario, hoy) {
  const v = ventanaDelDia(calendario, hoy);
  const detalle = x => `de ${x.abre} a ${x.cierra} (hora argentina)${x.media ? `: es media rueda en EE.UU. (${x.media})` : ''}`;
  const avisos = x => [
    x.sinDato ? ` Ojo: no tengo cargados los feriados de EE.UU. de ${hoy.slice(0, 4)}.` : '',
    x.confirmado ? '' : ' El horario de BYMA para esa fecha falta confirmarlo.',
  ].join('');
  if (!v.cerrado) return `Comprá hoy ${detalle(v)}, con Wall Street abierto y hasta media hora antes del cierre de BYMA.${avisos(v)}`;
  for (let i = 1; i <= 10; i++) {
    const f = fechas.sumar(hoy, i), w = ventanaDelDia(calendario, f);
    if (!w.cerrado) return `Hoy ${v.cerrado}: no compres. Próxima ventana: ${DIAS[diaSemana(f)]} ${fmt.fechaLarga(f)}, ${detalle(w)}.${avisos(w)}`;
  }
  return `Hoy ${v.cerrado}: no compres.`;
}
