// Series sueltas como [[fecha, valor]] ordenadas. Puro.
import { fechas } from './util.js';

// Cuotapartes de un fondo (argentina.json) como [[fecha, valor en la moneda del fondo]].
export function cuotapartes(e, nombre) {
  const f = e.argentina?.fondos, s = f?.series?.[nombre];
  return s ? f.fechas.map((d, i) => [d, s[i]]).filter(p => p[1] > 0) : [];
}

// Valor en una fecha: entre dos datos, a crecimiento constante; después del último, el último si es de hasta `margen`
// días; antes del primero, null.
export function valorEn(serie, fecha, margen = 7) {
  if (!serie?.length || fecha < serie[0][0]) return null;
  let lo = 0, hi = serie.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (serie[m][0] <= fecha) lo = m; else hi = m - 1; }
  const [f0, v0] = serie[lo], sig = serie[lo + 1];
  if (f0 === fecha) return v0;
  if (!sig) return fechas.dias(f0, fecha) <= margen ? v0 : null;
  return v0 * Math.pow(sig[1] / v0, fechas.dias(f0, fecha) / fechas.dias(f0, sig[0]));
}
