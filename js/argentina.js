// Argentina de un vistazo: semáforo, elección presidencial y reserva en pesos contra dólares. Todo puro e
// informativo: no genera tareas ni cambia ninguna regla.
import { fechas, fmt, suma } from './util.js';
import { supuestos } from './supuestos.js';
import { valorEn, cuotapartes } from './series.js';

// ---------- semáforo ----------
export const COLORES = ['verde', 'amarillo', 'rojo'];
const pintar = (v, u, haciaAbajo) => {
  if (v == null || !u) return null;
  const pasa = x => x != null && (haciaAbajo ? v <= x : v >= x);
  return pasa(u.rojo) ? 'rojo' : pasa(u.amarillo) ? 'amarillo' : 'verde';
};

// Cuánto hizo una serie en los últimos 30 días contra SPY: (1 + suyo) ÷ (1 + SPY) − 1.
function contraSpy(hist, serie, dias = 30) {
  const s = hist?.series?.[serie], spy = hist?.series?.SPY, f = hist?.fechas;
  if (!s || !spy || !f?.length) return null;
  let b = f.length - 1;
  while (b >= 0 && !(s[b] > 0 && spy[b] > 0)) b--;
  if (b < 0) return null;
  const corte = fechas.sumar(f[b], -dias);
  let a = b;
  while (a >= 0 && !(f[a] <= corte && s[a] > 0 && spy[a] > 0)) a--;
  return a < 0 ? null : { valor: (s[b] / s[a]) / (spy[b] / spy[a]) - 1, desde: f[a], hasta: f[b] };
}

// { color, por: [nombres], indicadores: [{ id, nombre, valor, texto, color, detalle, umbrales, viejo }], sugerencia }
// color null: no hay ningún dato.
export function semaforoArgentina(e) {
  const u = supuestos(e).semaforo || {}, rp = e.argentina?.riesgo_pais, fx = e.mercado?.fx;
  const canje = fx && e.mep > 0 && e.ccl > 0 ? e.ccl / e.mep - 1 : null;
  const brecha = fx?.oficial > 0 && e.mep > 0 ? e.mep / fx.oficial - 1 : null;
  const adr = ['YPF', 'PAM'].map(t => ({ t, x: contraSpy(e.historico, t) })).filter(a => a.x);
  const promedio = adr.length ? suma(adr, a => a.x.valor) / adr.length : null;
  const umbral = (x, f) => x ? `amarillo ${f(x.amarillo)} · rojo ${f(x.rojo)}` : 'sin umbral';
  const indicadores = [
    { id: 'riesgo_pais', nombre: 'Riesgo país', valor: rp?.ultimo?.valor ?? null, texto: rp?.ultimo ? fmt.num(rp.ultimo.valor) : '—', detalle: rp?.ultimo ? `al ${fmt.fecha(rp.ultimo.fecha)}` : 'sin dato', umbrales: umbral(u.riesgo_pais, x => `desde ${fmt.num(x)}`), viejo: !!rp?.stale },
    { id: 'canje', nombre: 'Canje', valor: canje, texto: fmt.pct(canje), detalle: 'contado con liqui contra MEP', umbrales: umbral(u.canje, x => `desde ${fmt.pct(x, 0)}`), viejo: !!fx?.stale },
    { id: 'brecha', nombre: 'Brecha', valor: brecha, texto: fmt.pct(brecha), detalle: 'dólar MEP contra el oficial', umbrales: umbral(u.brecha, x => `desde ${fmt.pct(x, 0)}`), viejo: !!fx?.stale },
    { id: 'adr', nombre: 'Acciones argentinas afuera', valor: promedio, texto: fmt.pctSigno(promedio), detalle: adr.length ? `${adr.map(a => `${a.t} ${fmt.pctSigno(a.x.valor)}`).join(' · ')} contra SPY en 30 días` : 'sin historia de precios', umbrales: umbral(u.adr, x => `desde ${fmt.pctSigno(x, 0)}`), viejo: !!e.historico?.stale, haciaAbajo: true },
  ].map(i => ({ ...i, color: pintar(i.valor, u[i.id], i.haciaAbajo) }));
  const conColor = indicadores.filter(i => i.color);
  const peor = conColor.length ? Math.max(...conColor.map(i => COLORES.indexOf(i.color))) : -1;
  const color = peor < 0 ? null : COLORES[peor];
  const por = peor > 0 ? conColor.filter(i => i.color === color) : [];
  const R6B = e.datos.reglas.find(r => r.id === 'R6B');
  const enPesos = suma(e.posiciones.filter(p => p.grupo === 'emergencia' && p.moneda !== 'USD'), p => p.valor_usd);
  const sugerencia = color === 'rojo'
    ? `Conviene revisar ${R6B ? `la regla R6B (riesgo argentino: hoy ${fmt.pct(e.argentina_pct)})` : 'cuánto riesgo argentino tenés'}${enPesos > 1 ? ` y la parte en pesos de la reserva (${fmt.usd(enPesos)})` : ''}. No hay que hacer nada automáticamente.`
    : null;
  return { color, por, indicadores, sin_dato: indicadores.filter(i => !i.color).map(i => i.nombre), sugerencia };
}

export const textoSemaforo = s => !s.color ? 'Sin datos para el semáforo argentino.'
  : `Argentina en ${s.color}${s.por.length ? `: lo ${s.por.length > 1 ? 'ponen' : 'pone'} así ${s.por.map(i => `${i.nombre.toLowerCase()} (${i.texto})`).join(' y ')}.` : ': nada pasa sus umbrales.'}`;

// ---------- elección presidencial ----------
export const FECHA_ELECCION = '2027-10-24';
// El mismo candidato en dos mercados: primer nombre y último apellido, sin acentos ni apodos.
export function claveCandidato(nombre) {
  const t = String(nombre).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/["'“”‘’][^"'“”‘’]*["'“”‘’]/g, ' ').replace(/\([^)]*\)/g, ' ').split(/[^a-z]+/).filter(Boolean);
  return t.length > 1 ? `${t[0]} ${t.at(-1)}` : t[0] || '';
}

// Probabilidad de cada candidato combinando los mercados de dinero real, ponderada por volumen.
// { fecha, dias, mercados: [{ id, nombre, url, activo, viejo, desactivado }], candidatos: [{ nombre, combinada, en: {id: {prob, volumen}}, diferencia, difiere }], difieren }
export function eleccion(e) {
  const d = e.argentina?.elecciones;
  const fecha = d?.fecha || FECHA_ELECCION, tope = supuestos(e).elecciones?.diferencia ?? 0.1;
  const mercados = ['kalshi', 'polymarket'].map(id => {
    const m = d?.[id];
    return { id, nombre: m?.nombre || (id === 'kalshi' ? 'Kalshi' : 'Polymarket'), url: m?.url || null, activo: !!m?.candidatos?.length, desactivado: !!m?.desactivado, viejo: !!m?.stale, actualizado: m?.actualizado || null, unidad: m?.volumen_unidad || null, candidatos: m?.candidatos || [] };
  });
  const por = new Map();
  for (const m of mercados) for (const c of m.candidatos) {
    const k = claveCandidato(c.nombre);
    if (!por.has(k)) por.set(k, { nombre: c.nombre, en: {} });
    por.get(k).en[m.id] = { prob: c.prob, volumen: c.volumen || 0 };
  }
  const candidatos = [...por.values()].map(c => {
    const v = Object.values(c.en), volumen = suma(v, x => x.volumen);
    const combinada = volumen > 0 ? suma(v, x => x.prob * x.volumen) / volumen : suma(v, x => x.prob) / v.length;
    const diferencia = v.length > 1 ? Math.max(...v.map(x => x.prob)) - Math.min(...v.map(x => x.prob)) : null;
    return { ...c, combinada, volumen, diferencia, difiere: diferencia != null && diferencia > tope + 1e-9 };
  }).sort((a, b) => b.combinada - a.combinada || a.nombre.localeCompare(b.nombre));
  return { fecha, dias: fechas.dias(e.hoy, fecha), mercados, candidatos, difieren: candidatos.filter(c => c.difiere), tope };
}

// ---------- reserva en pesos contra dólares ----------
const finDeMes = mes => fechas.sumar(fechas.sumarMeses(mes + '-01', 1), -1);
// Rendimiento de varios fondos entre dos fechas, ponderado por lo que tenés en cada uno. null si falta alguno.
function rendimientoFondos(fondos, desde, hasta) {
  const total = suma(fondos, x => x.peso);
  if (!fondos.length || !(total > 0)) return null;
  let r = 0;
  for (const x of fondos) {
    const a = valorEn(x.serie, desde), b = valorEn(x.serie, hasta);
    if (a == null || b == null) return null;
    r += x.peso / total * (b / a - 1);
  }
  return r;
}

// Mes a mes: cuánto tenía que subir el dólar MEP para que el fondo en dólares rindiera más que los pesos a la tasa
// de plazo fijo, cuánto subió, y cuánto rindieron en dólares tus fondos en pesos.
// { filas: [{ mes, parcial, hasta, tasa, usd, necesaria, mep, pesos, pesos_en_usd, gano }], fondos_pesos, fondos_usd, usd_supuesto }
export function reservaEnPesos(e, cuantos = 12) {
  const pf = e.argentina?.plazo_fijo, hist = e.historico;
  const mep = hist?.series?.MEP ? hist.fechas.map((d, i) => [d, hist.series.MEP[i]]).filter(p => p[1] > 0) : [];
  if (!pf?.fechas?.length || !mep.length) return null;
  const tasas = pf.fechas.map((d, i) => [d, pf.valores[i]]);
  const mios = moneda => e.datos.posiciones.map((p, i) => ({ p, v: e.posiciones[i]?.valor_usd || 0 }))
    .filter(x => x.p.tipo === 'fci' && (x.p.moneda_precio === 'USD') === (moneda === 'USD'))
    .map(x => ({ nombre: x.p.fci_nombre, ticker: x.p.ticker, peso: x.v, serie: cuotapartes(e, x.p.fci_nombre) })).filter(x => x.serie.length > 1);
  const enPesos = mios('ARS'), enDolares = mios('USD'), supuestoUsd = supuestos(e).otros?.fci_usd ?? 0;
  const ultimoMep = mep.at(-1)[0], actual = ultimoMep.slice(0, 7);
  const meses = Array.from({ length: cuantos + 1 }, (_, i) => fechas.sumarMeses(actual + '-01', i - cuantos).slice(0, 7));
  const filas = meses.map(mes => {
    const desde = finDeMes(fechas.sumarMeses(mes + '-01', -1).slice(0, 7));
    const parcial = mes === actual && ultimoMep < finDeMes(mes);
    // el mes en curso llega hasta el último dato que tengan los fondos y el MEP
    const topes = [ultimoMep, ...[...enPesos, ...enDolares].map(x => x.serie.at(-1)[0])].sort();
    const hasta = parcial ? topes[0] : finDeMes(mes);
    if (hasta <= desde) return null;
    const a = valorEn(mep, desde), b = valorEn(mep, hasta);
    const tna = [...tasas].reverse().find(t => t[0] <= desde)?.[1];
    if (a == null || b == null || tna == null) return null;
    const dias = fechas.dias(desde, hasta), tasa = tna * dias / 365, sube = b / a - 1;
    const usdFondo = rendimientoFondos(enDolares, desde, hasta);
    const usd = usdFondo ?? Math.pow(1 + supuestoUsd, dias / 365) - 1;
    const pesos = rendimientoFondos(enPesos, desde, hasta);
    const pesosEnUsd = pesos == null ? null : (1 + pesos) / (1 + sube) - 1;
    const contra = pesosEnUsd ?? (1 + tasa) / (1 + sube) - 1;
    return { mes, parcial, hasta, tasa, usd, usd_real: usdFondo != null, necesaria: (1 + tasa) / (1 + usd) - 1, mep: sube, pesos, pesos_en_usd: pesosEnUsd, gano: contra > usd ? 'pesos' : 'dólares' };
  }).filter(Boolean);
  return { filas, fondos_pesos: enPesos.map(x => x.ticker), fondos_usd: enDolares.map(x => x.ticker), usd_supuesto: supuestoUsd };
}
