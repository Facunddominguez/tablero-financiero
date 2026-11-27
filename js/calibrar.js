// Propuesta de umbrales para el semáforo y el clima, sacada de la historia guardada: "atento" (o amarillo) en el
// percentil de atención y "tenso" (o rojo) en el de alarma, del lado malo de cada indicador. Solo propone: los
// valores se revisan y se guardan a mano en ⋯ → Supuestos. Puro.
import { fechas, fmt } from './util.js';
import { spyContraPromedio } from './clima.js';
import { supuestos } from './supuestos.js';

export const PERCENTILES = { atencion: 0.75, alarma: 0.9 };
export const MINIMO_DATOS = 100;

// Cuantil con interpolación lineal.
export function percentil(valores, q) {
  const v = valores.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = (v.length - 1) * Math.min(1, Math.max(0, q)), a = Math.floor(i);
  return v[a] + (v[Math.min(a + 1, v.length - 1)] - v[a]) * (i - a);
}

const serie = (fs, vs) => ({ fechas: fs, valores: vs });
// Canje de cada día: contado con liqui contra MEP.
function canje(hist) {
  const { MEP: mep, CCL: ccl } = hist?.series || {};
  if (!mep || !ccl) return null;
  const pares = hist.fechas.map((f, i) => [f, ccl[i] > 0 && mep[i] > 0 ? ccl[i] / mep[i] - 1 : null]).filter(p => p[1] != null);
  return serie(pares.map(p => p[0]), pares.map(p => p[1]));
}
// YPF y PAM contra SPY en los 30 días previos a cada fecha (promedio).
function adr(hist, dias = 30) {
  const spy = hist?.series?.SPY, mias = ['YPF', 'PAM'].map(t => hist?.series?.[t]).filter(Boolean);
  if (!spy || !mias.length) return null;
  const f = hist.fechas, fs = [], vs = [];
  let a = 0;
  for (let b = 0; b < f.length; b++) {
    const corte = fechas.sumar(f[b], -dias);
    while (a + 1 < f.length && f[a + 1] <= corte) a++;
    if (!(f[a] <= corte && spy[a] > 0 && spy[b] > 0)) continue;
    const x = mias.filter(s => s[a] > 0 && s[b] > 0).map(s => (s[b] / s[a]) / (spy[b] / spy[a]) - 1);
    if (x.length) { fs.push(f[b]); vs.push(x.reduce((p, q) => p + q, 0) / x.length); }
  }
  return serie(fs, vs);
}

const punto = x => fmt.num(x, 2);
// [grupo, clave, nombre, nombres de los dos niveles, hacia abajo, paso de redondeo, historia, formato]
const INDICADORES = [
  ['semaforo', 'riesgo_pais', 'Riesgo país', ['amarillo', 'rojo'], false, 10, e => e.argentina?.riesgo_pais, x => fmt.num(x)],
  ['semaforo', 'canje', 'Canje', ['amarillo', 'rojo'], false, 0.005, e => canje(e.historico), x => fmt.pct(x)],
  ['semaforo', 'brecha', 'Brecha', ['amarillo', 'rojo'], false, 0.01, () => null, x => fmt.pct(x)],
  ['semaforo', 'adr', 'Acciones contra SPY', ['amarillo', 'rojo'], true, 0.005, e => adr(e.historico), x => fmt.pctSigno(x)],
  ['clima', 'alto_rendimiento', 'Bonos de alto riesgo', ['atento', 'tenso'], false, 0.05, e => e.clima?.series?.BAMLH0A0HYM2, punto],
  ['clima', 'curva', 'Curva de tasas', ['atento', 'tenso'], true, 0.05, e => e.clima?.series?.T10Y3M, punto],
  ['clima', 'vix', 'VIX', ['atento', 'tenso'], false, 0.5, e => e.clima?.series?.VIXCLS, x => fmt.num(x, 1)],
  ['clima', 'spy_promedio', 'SPY contra su promedio', ['atento', 'tenso'], true, 0.005, e => spyContraPromedio(e.historico), x => fmt.pctSigno(x)],
  ['clima', 'condiciones', 'Condiciones financieras', ['atento', 'tenso'], false, 0.05, e => e.clima?.series?.NFCI, punto],
];

const redondear = (x, paso) => Math.round(Math.round(x / paso) * paso * 1e6) / 1e6;

// [{ grupo, clave, nombre, niveles, actual: [a, b], propuesto: [a, b] | null, datos, desde, hasta, motivo, formato }]
export function proponerUmbrales(e, { atencion = PERCENTILES.atencion, alarma = PERCENTILES.alarma } = {}) {
  const s = supuestos(e);
  return INDICADORES.map(([grupo, clave, nombre, niveles, abajo, paso, historia, formato]) => {
    const h = historia(e), valores = (h?.valores || []).filter(Number.isFinite);
    const base = { grupo, clave, nombre, niveles, formato, actual: niveles.map(n => s[grupo]?.[clave]?.[n] ?? null), datos: valores.length, desde: h?.fechas?.[0] || null, hasta: h?.fechas?.at(-1) || null };
    if (valores.length < MINIMO_DATOS) return { ...base, propuesto: null, motivo: h ? `poca historia (${valores.length} datos)` : 'sin historia guardada' };
    const [a, b] = [atencion, alarma].map(q => redondear(percentil(valores, abajo ? 1 - q : q), paso));
    // el segundo nivel siempre queda más lejos que el primero, aunque el redondeo los junte
    return { ...base, propuesto: [a, abajo ? Math.min(b, redondear(a - paso, paso)) : Math.max(b, redondear(a + paso, paso))], motivo: null };
  });
}
