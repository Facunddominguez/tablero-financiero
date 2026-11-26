// Mirar adelante con rangos: miles de caminos posibles, mes a mes, con los mismos aportes que usa la proyección
// de siempre. Puro y con semilla fija: los mismos datos dan siempre el mismo resultado.
//
// Cada mes cada cosa se mueve según su retorno esperado y su volatilidad, junto con las demás según su
// correlación; después entra el aporte al núcleo, primero a lo más atrasado. No se vende nada.
import { fechas, fmt, suma } from './util.js';
import { proyeccion } from './motor.js';
import { itemsDeRiesgo, medida, parametros, valores } from './riesgo.js';
import { supuestos } from './supuestos.js';

export const ESCENARIOS = 2000, SEMILLA = 20261126, HORIZONTE_MESES = 240, MESES_ABANICO = 60;
export const ANIOS_PATRIMONIO = [1, 3, 5];
const RUEDAS = 252, TOL = 1e-9;

// ---------- azar repetible ----------
function azar(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Normal estándar (Box-Muller, de a pares).
export function normales(semilla) {
  const u = azar(semilla);
  let guardada = null;
  return () => {
    if (guardada !== null) { const z = guardada; guardada = null; return z; }
    let a = u(); while (a <= 0) a = u();
    const r = Math.sqrt(-2 * Math.log(a)), t = 2 * Math.PI * u();
    guardada = r * Math.sin(t);
    return r * Math.cos(t);
  };
}

// ---------- series, volatilidades y correlaciones ----------
const logs = pares => new Map(pares.slice(1).map(([f, x], i) => [f, Math.log(x / pares[i][1])]));
// Rendimientos mensuales del histórico largo (solo los ETF de referencia). null si no hay.
function mensuales(largo, serie) {
  const s = largo?.series?.[serie];
  if (!s) return null;
  const pares = largo.fechas.map((f, i) => [f, s[i]]).filter(p => p[1] > 0);
  return pares.length > 24 ? logs(pares) : null;
}
// Covarianza sobre las fechas que las dos tienen: { xy, xx, yy, n }.
function momentos(x, y) {
  const pares = [];
  for (const [f, a] of x) if (y.has(f)) pares.push([a, y.get(f)]);
  const n = pares.length;
  if (n < 2) return null;
  const mx = suma(pares, p => p[0]) / n, my = suma(pares, p => p[1]) / n;
  return { n, xy: suma(pares, p => (p[0] - mx) * (p[1] - my)) / (n - 1), xx: suma(pares, p => (p[0] - mx) ** 2) / (n - 1), yy: suma(pares, p => (p[1] - my) ** 2) / (n - 1) };
}
const correlacion = (x, y) => { const m = x && y ? momentos(x, y) : null; return m && m.xx > 0 && m.yy > 0 ? m.xy / Math.sqrt(m.xx * m.yy) : 0; };

// Matriz A con A·Aᵀ = C, aunque C no sea del todo coherente (mezcla de historias): autovalores (Jacobi), se
// recortan los negativos y cada fila vuelve a tener largo 1.
export function raizCorrelacion(C) {
  const n = C.length, a = C.map(f => f.slice()), v = C.map((_, i) => C.map((__, j) => i === j ? 1 : 0));
  for (let barrido = 0; barrido < 60; barrido++) {
    let fuera = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) fuera += a[p][q] ** 2;
    if (fuera < 1e-20) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-14) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < n; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
      for (let k = 0; k < n; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
    }
  }
  return v.map(fila => {
    const r = fila.map((x, j) => x * Math.sqrt(Math.max(0, a[j][j])));
    const largo = Math.sqrt(suma(r, x => x * x));
    return largo > 0 ? r.map(x => x / largo) : r;
  });
}

// ---------- con qué se simula cada cosa ----------
// { items: [{ ticker, grupo, usd, factor, retorno, tipoRetorno, vol, beta }], factores, A } o null sin supuestos.
export function modelo(e) {
  const s = supuestos(e);
  if (!s.retornos_etf || !s.acciones || !s.otros) return null;
  const par = parametros(e), hist = e.historico, largo = e.largo_plazo, escala = s.escala_volatilidad ?? 1;
  const base = itemsDeRiesgo(e, { conEmergencia: true });
  // los ETF del núcleo que todavía no tenés también reciben aportes
  for (const t of Object.keys(e.datos.nucleo.pesos_internos)) if (!base.some(x => x.ticker === t)) {
    const p = { ticker: t, tipo: 'cedear', subyacente: t };
    base.push({ ...p, grupo: 'nucleo', moneda: 'ARS', usd: 0, ...medida(p, hist, par) });
  }
  const diarias = new Map();
  const diaria = serie => {
    if (!diarias.has(serie)) { const v = hist?.fechas?.length ? valores(hist, serie, par.ventana_dias) : []; diarias.set(serie, v.length > 20 ? logs(v) : null); }
    return diarias.get(serie);
  };
  const factores = [];
  const factorDe = x => {
    const id = x.serie || `fija:${x.ticker}`;
    let i = factores.findIndex(f => f.id === id);
    if (i < 0) {
      const larga = x.serie ? mensuales(largo, x.serie) : null, corta = x.serie ? diaria(x.serie) : null;
      let vol, origen;
      if (larga) { const m = momentos(larga, larga); vol = Math.sqrt(m.xx * 12); origen = 'largo'; }
      else if (corta) { const m = momentos(corta, corta); vol = Math.sqrt(m.xx * RUEDAS); origen = 'diario'; }
      else { vol = x.fija ? par.vol_fija[x.fija] : x.serie ? par.vol_fija.sin_serie : 0; origen = 'fija'; }
      i = factores.push({ id, serie: x.serie || null, larga, corta, vol, origen }) - 1;
    }
    return i;
  };
  const spy = diaria('SPY');
  const items = base.map(x => {
    const f = factorDe(x), vol = factores[f].vol * escala;
    let retorno, tipoRetorno = 'compuesto', beta = null;
    if (x.tipo === 'cedear' && s.retornos_etf[x.ticker] != null) retorno = s.retornos_etf[x.ticker];
    else if (x.tipo === 'cedear' || x.tipo === 'accion_ar') {
      const mia = x.serie ? diaria(x.serie) : null, m = mia && spy ? momentos(mia, spy) : null;
      beta = m && m.yy > 0 ? m.xy / m.yy : 1;
      retorno = s.acciones.tasa_libre + beta * s.acciones.prima_mercado;
      tipoRetorno = 'promedio'; // el promedio de los caminos; el del medio queda más abajo cuanto más se mueve
    } else if (x.tipo === 'on') retorno = s.otros.on;
    else if (x.tipo === 'fci' && x.moneda === 'USD') retorno = s.otros.fci_usd;
    else if (x.tipo === 'caja' && x.moneda === 'USD') retorno = s.otros.caja_usd;
    else retorno = s.otros.pesos;
    const deriva = Math.log(1 + retorno) - (tipoRetorno === 'promedio' ? vol * vol / 2 : 0);
    return { ticker: x.ticker, grupo: x.grupo, usd: x.usd, factor: f, retorno, tipoRetorno, vol, deriva, beta };
  });
  const C = factores.map((a, i) => factores.map((b, j) => i === j ? 1
    : a.larga && b.larga ? correlacion(a.larga, b.larga) : a.corta && b.corta ? correlacion(a.corta, b.corta) : 0));
  return { items, factores, correlaciones: C, A: raizCorrelacion(C), supuestos: s };
}

// ---------- objetivos con fecha ----------
const mesesHasta = (hoy, f) => (fechas.anio(f) - fechas.anio(hoy)) * 12 + (fechas.nMes(f) - fechas.nMes(hoy));
// Los que cargaste desde la app (contra el patrimonio) y los externos que tengan monto y fecha (se juntan aparte).
export function objetivosConFecha(e) {
  const propios = (e.datos.objetivos || []).map(o => ({ id: o.id, nombre: o.nombre, monto_usd: o.monto_usd, fecha: o.fecha, contra: 'patrimonio' }));
  const externos = (e.datos.objetivos_externos || []).map(o => ({
    nombre: o.nombre, monto_usd: o.monto_usd ?? o.objetivo_usd ?? o.meta_usd, fecha: o.fecha || o.fecha_objetivo, contra: 'aparte',
    aporte: o.aporte_mensual_usd || 0, juntado: o.acumulado_usd ?? o.ahorrado_usd ?? 0,
  })).filter(o => o.monto_usd > 0 && o.fecha);
  return [...propios, ...externos].sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0);
}

// ---------- simulación ----------
const cuantil = (ordenados, q) => ordenados[Math.max(0, Math.min(ordenados.length - 1, Math.ceil(q * ordenados.length - TOL) - 1))];

// Reglas que se miden: cada una con su condición sobre (núcleo, satélites, YPF, largo plazo).
function metas(e) {
  const d = e.datos, nMin = d.nucleo.rango_LP[0], R5 = d.reglas.find(r => r.id === 'R5'), R6 = d.reglas.find(r => r.id === 'R6');
  const techo = R5?.techo, ypf = R6?.objetivo;
  return [
    { id: 'nucleo', regla: 'R3', meta: `Núcleo en su rango (desde ${fmt.pct(nMin, 0)})`, ok: (n, s, y, lp) => n >= nMin * lp - TOL },
    techo != null && { id: 'satelites', regla: 'R5', meta: `Satélites bajo el techo (${fmt.pct(techo, 0)})`, ok: (n, s, y, lp) => s <= techo * lp + TOL },
    ypf != null && { id: 'ypf', regla: 'R6', meta: `YPF en su objetivo (${fmt.pct(ypf, 0)})`, ok: (n, s, y, lp) => y <= ypf * lp + TOL },
    { id: 'tesis', regla: 'R7', meta: 'Lugar para una tesis nueva (núcleo en rango y satélites bajo el techo)', ok: (n, s, y, lp) => n >= nMin * lp - TOL && (techo == null || s <= techo * lp + TOL) },
  ].filter(Boolean);
}

const memo = new WeakMap();
// { aporte, escenarios, hitos: { nucleo, satelites, ypf, tesis }, abanico: [{ mes, fecha, p10, p50, p90, aportado }],
//   anios: [{ anios, ... }], objetivos, modelo } o null si faltan supuestos o no hay cartera.
export function simular(e, { escenarios = ESCENARIOS, semilla = SEMILLA, horizonte = HORIZONTE_MESES } = {}) {
  const defecto = escenarios === ESCENARIOS && semilla === SEMILLA && horizonte === HORIZONTE_MESES;
  if (defecto && memo.has(e)) return memo.get(e);
  const r = correr(e, escenarios, semilla, horizonte);
  if (defecto) memo.set(e, r);
  return r;
}

function correr(e, N, semilla, H) {
  const m = e.lp_usd > 0 ? modelo(e) : null;
  if (!m) return null;
  const aporte = proyeccion(e).aporte, pesos = e.datos.nucleo.pesos_internos;
  const { items, A } = m, nI = items.length, nF = m.factores.length;
  const mensual = Float64Array.from(items, x => x.deriva / 12), desvio = Float64Array.from(items, x => x.vol / Math.sqrt(12));
  const grupo = items.map(x => x.grupo), factor = items.map(x => x.factor);
  const nucleoI = items.map((x, i) => x.grupo === 'nucleo' && pesos[x.ticker] != null ? i : -1).filter(i => i >= 0);
  const reglas = metas(e);

  const objetivos = objetivosConFecha(e).map(o => ({ ...o, meses: mesesHasta(e.hoy, o.fecha) }));
  const enCartera = objetivos.filter(o => o.contra === 'patrimonio' && o.meses >= 0 && o.meses <= H);
  const puntos = [...new Set([...Array.from({ length: Math.min(H, MESES_ABANICO) + 1 }, (_, k) => k), ...enCartera.map(o => o.meses)])].sort((a, b) => a - b);
  const columna = new Int32Array(H + 1).fill(-1);
  puntos.forEach((k, i) => { columna[k] = i; });
  const ultimo = puntos.at(-1);
  const totales = puntos.map(() => new Float64Array(N));
  const primera = reglas.map(() => new Float64Array(N).fill(Infinity));

  const z = new Float64Array(nF), y = new Float64Array(nF), v = new Float64Array(nI), deficit = new Float64Array(nI);
  const normal = normales(semilla);
  const medir = () => {
    let n = 0, s = 0, ypf = 0, lp = 0, total = 0;
    for (let i = 0; i < nI; i++) {
      const x = v[i], g = grupo[i];
      total += x;
      if (g === 'emergencia') continue;
      lp += x;
      if (g === 'nucleo') n += x; else if (g === 'satelite') s += x; else if (g === 'ypf') { ypf += x; s += x; }
    }
    return { n, s, ypf, lp, total };
  };

  for (let c = 0; c < N; c++) {
    for (let i = 0; i < nI; i++) v[i] = items[i].usd;
    let faltan = reglas.length;
    for (let k = 0; k <= H; k++) {
      if (k > 0) {
        for (let f = 0; f < nF; f++) z[f] = normal();
        for (let f = 0; f < nF; f++) { let a = 0; const fila = A[f]; for (let j = 0; j < nF; j++) a += fila[j] * z[j]; y[f] = a; }
        for (let i = 0; i < nI; i++) v[i] *= Math.exp(mensual[i] + desvio[i] * y[factor[i]]);
        // el aporte va al núcleo, primero a lo más lejos de su peso
        let enNucleo = aporte;
        for (const i of nucleoI) enNucleo += v[i];
        let total = 0;
        for (const i of nucleoI) { deficit[i] = Math.max(0, pesos[items[i].ticker] * enNucleo - v[i]); total += deficit[i]; }
        for (const i of nucleoI) v[i] += total > 0 ? aporte * deficit[i] / total : aporte * pesos[items[i].ticker];
      }
      const t = medir();
      for (let r = 0; r < reglas.length; r++) if (primera[r][c] === Infinity && reglas[r].ok(t.n, t.s, t.ypf, t.lp)) { primera[r][c] = k; faltan--; }
      if (columna[k] >= 0) totales[columna[k]][c] = t.total;
      if (!faltan && k >= ultimo) break;
    }
  }

  const fechaDe = k => k == null ? null : fechas.sumarMeses(fechas.diaDelMes(e.hoy, 1), k);
  const hitos = Object.fromEntries(reglas.map((regla, r) => {
    const t = Float64Array.from(primera[r]).sort();
    const q = x => { const k = cuantil(t, x); return isFinite(k) ? k : null; };
    const antes = meses => t.filter(k => k <= meses).length / N;
    const [m10, m50, m90] = [q(0.1), q(0.5), q(0.9)];
    return [regla.id, {
      regla: regla.regla, meta: regla.meta, cumplida: primera[r].every(k => k === 0),
      m10, m50, m90, f10: fechaDe(m10), f50: fechaDe(m50), f90: fechaDe(m90), en12: antes(12), en24: antes(24),
    }];
  }));

  const hoyTotal = e.total_usd;
  const resumen = k => {
    const s = Float64Array.from(totales[columna[k]]).sort();
    return { mes: k, fecha: fechaDe(k), p10: cuantil(s, 0.1), p50: cuantil(s, 0.5), p90: cuantil(s, 0.9), aportado: hoyTotal + aporte * k };
  };
  const abanico = puntos.filter(k => k <= MESES_ABANICO).map(resumen);

  return {
    aporte, escenarios: N, horizonte: H, hitos, abanico,
    anios: ANIOS_PATRIMONIO.filter(a => a * 12 <= Math.min(H, MESES_ABANICO)).map(a => ({ anios: a, ...resumen(a * 12) })),
    objetivos: objetivos.map(o => {
      if (o.meses < 0) return { ...o, vencido: true };
      if (o.contra === 'aparte') { // se junta fuera de la cartera: en dólares y sin riesgo
        const proyectado = o.juntado + o.aporte * o.meses;
        return { ...o, proyectado, llega: proyectado >= o.monto_usd - TOL, por_mes: o.meses > 0 ? Math.max(0, o.monto_usd - o.juntado) / o.meses : Math.max(0, o.monto_usd - o.juntado) };
      }
      if (o.meses > H) return { ...o, fuera: true };
      const s = totales[columna[o.meses]];
      return { ...o, chance: s.filter(x => x >= o.monto_usd - TOL).length / N, p50: resumen(o.meses).p50 };
    }),
    modelo: m,
  };
}

// ---------- en palabras ----------
const anios = meses => Math.round(meses / 12);
// Rango de fechas de una meta, en una frase corta. null si ya está cumplida.
export function textoHito(h, H = HORIZONTE_MESES) {
  if (!h || h.cumplida) return null;
  const lejos = `más de ${anios(H)} años`;
  if (h.m50 == null) return h.m10 == null ? `con los aportes de hoy, casi seguro no antes de ${anios(H)} años` : `con los aportes de hoy, menos de la mitad de las veces en ${anios(H)} años (1 de cada 10, antes de ${fmt.mesCorto(h.f10)})`;
  if (h.m10 === h.m90) return `lo más probable, ${fmt.mesCorto(h.f50)}`;
  return `lo más probable ${fmt.mesCorto(h.f50)} (entre ${fmt.mesCorto(h.f10)} y ${h.f90 ? fmt.mesCorto(h.f90) : lejos})`;
}
