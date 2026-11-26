// Riesgo por bloque: cuánto se mueve cada cosa y cómo se mueven juntas, según el histórico. Puro.
import { suma } from './util.js';
import { ADR_DE_LOCAL, serieDe } from './finanzas.js';
import { NOMBRE_GRUPO } from './estado.js';

// Todo editable desde los datos (clave "riesgo"). Las volatilidades son anuales.
export const PARAMETROS = {
  vol_fija: { fci_usd: 0.03, on: 0.08, sin_serie: 0.35 }, // supuestos: lo que no tiene serie diaria
  series: {},                  // ticker → serie del histórico, para forzar una distinta
  percentil: 0.05,             // "mes malo": 1 de cada 20
  dias_mes: 21,
  ventana_dias: 504,           // unos dos años de ruedas
  sigmas_peor_mes: 2.33,       // peor mes de lo que no tiene serie, en veces su volatilidad mensual
  crisis: ['YPF', 'PAM', 'MEP'],
};
export const parametros = e => {
  const p = e.datos.riesgo || {};
  return { ...PARAMETROS, ...p, vol_fija: { ...PARAMETROS.vol_fija, ...p.vol_fija }, series: { ...p.series } };
};

// Valor inverso de la normal estándar (aproximación de Acklam; error menor a 1e-9 en la zona que se usa).
export function inversaNormal(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const cola = q => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < 0.02425) return cola(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -cola(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Valores de una serie en la ventana, como [fecha, valor en dólares]. "MEP" es el valor en dólares de un peso.
export function valores(hist, serie, ventana) {
  const s = serie === 'MEP' ? hist.series.MEP : serieDe(hist, serie);
  if (!s) return [];
  const out = [];
  for (let i = Math.max(0, hist.fechas.length - ventana - 1); i < hist.fechas.length; i++) {
    if (s[i] > 0) out.push([hist.fechas[i], serie === 'MEP' ? 1 / s[i] : s[i]]);
  }
  return out;
}
export const rendimientos = v => new Map(v.slice(1).map(([f, x], i) => [f, x / v[i][1] - 1]));

// Covarianza muestral diaria sobre las fechas que las dos series tienen.
export function covarianza(x, y) {
  const pares = [];
  for (const [f, a] of x) if (y.has(f)) pares.push([a, y.get(f)]);
  if (pares.length < 2) return 0;
  const mx = suma(pares, p => p[0]) / pares.length, my = suma(pares, p => p[1]) / pares.length;
  return suma(pares, p => (p[0] - mx) * (p[1] - my)) / (pares.length - 1);
}

// Peor mes calendario de una serie (cierre de un mes contra el del anterior).
function peorMes(v) {
  const cierres = new Map(v.map(([f, x]) => [f.slice(0, 7), x]));
  const c = [...cierres.values()];
  return c.length < 2 ? null : Math.min(...c.slice(1).map((x, i) => x / c[i] - 1));
}

// Una serie sirve si tiene al menos un mes de precios.
const conHistoria = (hist, t) => (t === 'MEP' ? hist?.series?.MEP : serieDe(hist, t))?.filter(v => v > 0).length > 20;
const enPesos = hist => conHistoria(hist, 'MEP') ? { serie: 'MEP' } : { fija: 'sin_serie' };

// Con qué se mide cada cosa: { serie } del histórico, o { fija } = clave de vol_fija.
export function medida(p, hist, par) {
  const forzada = par.series[p.ticker];
  if (forzada && conHistoria(hist, forzada)) return { serie: forzada };
  if (p.tipo === 'on') return { fija: 'on' };
  if (p.tipo === 'fci' && p.moneda === 'USD') return { fija: 'fci_usd' };
  if (p.tipo === 'cedear' || p.tipo === 'accion_ar') {
    const t = [p.subyacente, ADR_DE_LOCAL[p.ticker], p.ticker].find(x => x !== 'MEP' && conHistoria(hist, x));
    return t ? { serie: t } : { fija: 'sin_serie' };
  }
  return enPesos(hist); // todo lo demás en pesos
}

// Cada cosa de la cartera (y la caja) con lo que la mide: { ticker, grupo, tipo, moneda, usd, argentino, serie | fija }.
// La emergencia solo entra si se pide.
export function itemsDeRiesgo(e, { conEmergencia = false } = {}) {
  const hist = e.historico, par = parametros(e), base = new Map(e.datos.posiciones.map(p => [p.ticker, p]));
  const items = e.posiciones.filter(p => conEmergencia || p.grupo !== 'emergencia').map(p => ({
    ticker: p.ticker, grupo: p.grupo, tipo: p.tipo, moneda: p.moneda, usd: p.valor_usd,
    argentino: !!base.get(p.ticker)?.riesgo_ar || p.tipo === 'accion_ar' || p.grupo === 'ypf',
    ...medida(p, hist, par),
  }));
  // La caja: los pesos se mueven con el MEP; los dólares no tienen riesgo.
  const pesos = (e.datos.caja?.ARS || 0) / e.mep;
  if (pesos) items.push({ ticker: 'Caja en pesos', grupo: 'caja', tipo: 'caja', moneda: 'ARS', usd: pesos, argentino: true, ...enPesos(hist) });
  const dolares = e.caja_usd - pesos;
  if (Math.abs(dolares) > 0.005) items.push({ ticker: 'Caja en dólares', grupo: 'caja', tipo: 'caja', moneda: 'USD', usd: dolares, argentino: false, fija: null });
  return items;
}

// Riesgo de la cartera de largo plazo (todo menos la emergencia, con la caja). null si no hay histórico.
// { valor, sigma_mes, mes_malo_usd, mes_malo_pct, posiciones, bloques, escenarios, correlaciones, sin_serie, supuestos }
export function riesgo(e) {
  const hist = e.historico;
  if (!hist?.fechas?.length || !(e.lp_usd > 0)) return null;
  const par = parametros(e), items = itemsDeRiesgo(e);

  const V = suma(items, x => x.usd);
  if (!(V > 0)) return null;
  const usadas = [...new Set([...items.map(x => x.serie), ...par.crisis].filter(Boolean))];
  const vals = new Map(usadas.map(s => [s, valores(hist, s, par.ventana_dias)]));
  const rend = new Map([...vals].map(([s, v]) => [s, rendimientos(v)]));
  const cov = new Map();
  const covS = (a, b) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!cov.has(k)) cov.set(k, covarianza(rend.get(a), rend.get(b)));
    return cov.get(k);
  };
  const anual = 12 * par.dias_mes; // días de mercado por año
  const varFija = x => x.fija ? par.vol_fija[x.fija] ** 2 / anual : 0;
  // Matriz diaria: entre series, la del histórico; lo de volatilidad fija se supone sin relación con el resto.
  const sigma = (i, j) => items[i].serie && items[j].serie ? covS(items[i].serie, items[j].serie) : i === j ? varFija(items[i]) : 0;
  const w = items.map(x => x.usd / V), indices = items.map((_, i) => i);
  const marginal = indices.map(i => suma(indices, j => sigma(i, j) * w[j]));
  const varianza = suma(indices, i => w[i] * marginal[i]);
  const sigmaMes = Math.sqrt(Math.max(0, varianza) * par.dias_mes);
  const z = -inversaNormal(par.percentil);

  const posiciones = Object.fromEntries(items.map((x, i) => [x.ticker, {
    serie: x.serie || null, supuesto: x.fija || null, usd: x.usd, peso: w[i], parte: varianza > 0 ? w[i] * marginal[i] / varianza : 0,
    vol_anual: Math.sqrt(Math.max(0, sigma(i, i)) * anual),
  }]));
  const bloques = ['nucleo', 'satelite', 'ypf', 'renta_fija', 'caja'].map(g => {
    const de = items.filter(x => x.grupo === g);
    return de.length ? { clave: g, nombre: NOMBRE_GRUPO[g], usd: suma(de, x => x.usd), peso: suma(de, x => x.usd) / V, riesgo: suma(de, x => posiciones[x.ticker].parte) } : null;
  }).filter(Boolean);

  // ---------- escenarios ----------
  const peor = new Map([...vals].map(([s, v]) => [s, peorMes(v)]));
  const peorFija = x => x.fija ? -par.sigmas_peor_mes * par.vol_fija[x.fija] / Math.sqrt(12) : 0;
  const propio = x => x.serie ? Math.min(0, peor.get(x.serie) ?? 0) : peorFija(x);
  const acciones = par.crisis.filter(s => s !== 'MEP' && peor.get(s) != null);
  const promedioCrisis = acciones.length ? suma(acciones, s => peor.get(s)) / acciones.length : 0;
  // Crisis argentina: lo que está en la lista cae como su peor mes; el resto de lo argentino, parecido; lo de afuera, nada.
  const enCrisis = x => {
    if (x.serie && par.crisis.includes(x.serie)) return Math.min(0, peor.get(x.serie) ?? 0);
    if (!x.argentino || (!x.serie && !x.fija)) return 0;
    if (x.tipo === 'cedear' || x.tipo === 'accion_ar') return Math.min(0, promedioCrisis);
    return x.serie ? propio(x) : peorFija(x);
  };
  const escenario = fn => { const usd = -suma(items, x => x.usd * fn(x)); return { usd, pct: usd / V }; };

  const series = [...new Set(items.map(x => x.serie).filter(Boolean))];
  const correlaciones = Object.fromEntries(series.map(a => [a, Object.fromEntries(series.map(b => {
    const d = Math.sqrt(covS(a, a) * covS(b, b));
    return [b, d > 0 ? covS(a, b) / d : null];
  }))]));
  const sinSerie = items.filter(x => x.fija === 'sin_serie').map(x => x.ticker);
  const pct = v => `${Math.round(v * 1000) / 10}`.replace('.', ',') + '%';
  const supuestos = [
    items.some(x => x.fija === 'fci_usd') ? `Los fondos en dólares se miden con una volatilidad fija de ${pct(par.vol_fija.fci_usd)} por año.` : null,
    items.some(x => x.fija === 'on') ? `Las obligaciones negociables, con una fija de ${pct(par.vol_fija.on)} por año.` : null,
    items.some(x => x.serie === 'MEP') ? 'Lo que está en pesos se mueve con el dólar MEP (sin contar el interés que cobra).' : null,
    sinSerie.length ? `Sin historia de precios: ${sinSerie.join(', ')}. Se les supone ${pct(par.vol_fija.sin_serie)} por año; para medirlos, sumalos a historico_extra en tools/mercado_config.json.` : null,
    'Lo que tiene volatilidad fija se supone sin relación con el resto.',
  ].filter(Boolean);

  return {
    valor: V, sigma_mes: sigmaMes, percentil: par.percentil, mes_malo_pct: z * sigmaMes, mes_malo_usd: z * sigmaMes * V,
    posiciones, bloques, correlaciones, sin_serie: sinSerie, supuestos,
    escenarios: {
      peor_cada_uno: escenario(propio),
      crisis: { ...escenario(enCrisis), series: Object.fromEntries(par.crisis.map(s => [s, peor.get(s) ?? null])) },
    },
  };
}
