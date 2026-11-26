// Clima de mercado y la sugerencia opcional de usar excedente de la reserva en una caída. Puro e informativo:
// no genera tareas, no vende nada y no frena aportes.
import { fmt } from './util.js';
import { supuestos } from './supuestos.js';

export const LECTURAS = ['tranquilo', 'atento', 'tenso'];
export const RUEDAS_PROMEDIO = 200;
const leer = (v, u, haciaAbajo) => {
  if (v == null || !u) return null;
  const pasa = x => x != null && (haciaAbajo ? v <= x : v >= x);
  return pasa(u.tenso) ? 'tenso' : pasa(u.atento) ? 'atento' : 'tranquilo';
};

// SPY contra su promedio de las últimas 200 ruedas, en cada fecha que tenga historia suficiente.
export function spyContraPromedio(hist, ruedas = RUEDAS_PROMEDIO) {
  const s = hist?.series?.SPY;
  if (!s) return null;
  const pares = hist.fechas.map((f, i) => [f, s[i]]).filter(p => p[1] > 0);
  if (pares.length < ruedas) return null;
  const fechasOut = [], valores = [];
  let acumulado = 0;
  pares.forEach(([f, v], i) => {
    acumulado += v;
    if (i >= ruedas) acumulado -= pares[i - ruedas][1];
    if (i >= ruedas - 1) { fechasOut.push(f); valores.push(v / (acumulado / ruedas) - 1); }
  });
  return { fechas: fechasOut, valores, ultimo: { fecha: fechasOut.at(-1), valor: valores.at(-1) } };
}

const DEFINICIONES = [
  { id: 'alto_rendimiento', serie: 'BAMLH0A0HYM2', nombre: 'Sobretasa de bonos de alto riesgo', corto: 'bonos de riesgo', detalle: 'cuánto más pagan que los del Tesoro de EE.UU., en puntos', texto: v => fmt.num(v, 2) },
  { id: 'curva', serie: 'T10Y3M', nombre: 'Curva: 10 años contra 3 meses', corto: 'curva de tasas', detalle: 'tasas del Tesoro de EE.UU., en puntos; negativa es "invertida"', texto: v => fmt.num(v, 2), haciaAbajo: true },
  { id: 'vix', serie: 'VIXCLS', nombre: 'VIX', corto: 'VIX', detalle: 'cuánto se espera que se mueva Wall Street en 30 días', texto: v => fmt.num(v, 1) },
  { id: 'spy_promedio', serie: null, nombre: 'SPY contra su promedio de 200 días', corto: 'SPY', detalle: 'arriba o abajo de su promedio de las últimas 200 ruedas', texto: v => fmt.pctSigno(v, 1), haciaAbajo: true },
];

// { lectura (la peor) | null, indicadores: [{ id, nombre, corto, detalle, valor, texto, lectura, fecha, viejo, historia, umbrales }] }
export function climaMercado(e) {
  const u = supuestos(e).clima || {};
  const indicadores = DEFINICIONES.map(d => {
    const s = d.serie ? e.clima?.series?.[d.serie] : spyContraPromedio(e.historico);
    const valor = s?.ultimo?.valor ?? null;
    return {
      id: d.id, nombre: d.nombre, corto: d.corto, detalle: d.detalle, valor, texto: valor == null ? '—' : d.texto(valor),
      lectura: leer(valor, u[d.id], d.haciaAbajo), fecha: s?.ultimo?.fecha || null, viejo: !!(d.serie ? s?.stale : e.historico?.stale),
      historia: s?.fechas ? { fechas: s.fechas, valores: s.valores } : null, umbrales: u[d.id] || null, haciaAbajo: !!d.haciaAbajo, formato: d.texto,
    };
  });
  const con = indicadores.filter(i => i.lectura);
  return { lectura: con.length ? LECTURAS[Math.max(...con.map(i => LECTURAS.indexOf(i.lectura)))] : null, indicadores };
}

export const textoClima = c => !c.lectura ? 'Sin datos del clima de mercado.'
  : `Clima de mercado: ${c.indicadores.filter(i => i.lectura).map(i => `${i.corto} ${i.lectura} (${i.texto})`).join(' · ')}.`;

// ---------- caídas del núcleo ----------
// La canasta del núcleo (pesos objetivo) en dólares de EE.UU.: cuánto está hoy debajo de su máximo.
// { caida, desde: fecha del máximo, hasta } o null sin historia. Con precios de EE.UU. del momento, usa esos.
export function caidaNucleo(e) {
  const hist = e.historico, pesos = Object.entries(e.datos.nucleo.pesos_internos);
  if (!hist?.fechas?.length || pesos.some(([t]) => !hist.series[t])) return null;
  const puntos = hist.fechas.map((f, i) => [f, pesos.map(([t]) => hist.series[t][i])]).filter(p => p[1].every(v => v > 0));
  const usa = e.mercado?.implicito?.usa, vivos = usa && !usa.stale ? pesos.map(([t]) => usa.precios?.[t]?.[0]) : [];
  if (vivos.length && vivos.every(v => v > 0) && puntos.length && e.hoy > puntos.at(-1)[0]) puntos.push([e.hoy, vivos]);
  if (puntos.length < 20) return null;
  const base = puntos[0][1], valor = v => pesos.reduce((s, [, w], k) => s + w * v[k] / base[k], 0);
  let max = -Infinity, desde = null;
  for (const [f, v] of puntos) { const x = valor(v); if (x >= max) { max = x; desde = f; } }
  const [hasta, ultimo] = puntos.at(-1);
  return { caida: 1 - valor(ultimo) / max, desde, hasta };
}

// ---------- aporte extra (apagado por defecto) ----------
export const APORTE_EXTRA = { activo: false, caida: 0.15, parte: 0.5 };
export const ajustesAporteExtra = e => ({ ...APORTE_EXTRA, ...e.datos.aporte_extra });

// Sugerencia de usar parte de la reserva que sobra cuando el núcleo cayó fuerte. null si está apagado, si no hay
// excedente (según R1) o si la caída no llega. { usd, excedente, caida, desde, texto }
export function aporteExtra(e) {
  const c = ajustesAporteExtra(e);
  if (!c.activo) return null;
  const R1 = e.datos.reglas.find(r => r.id === 'R1') || {}, objetivo = e.datos.emergencia.objetivo_usd;
  const excedente = e.emergencia_usd - objetivo;
  const hay = excedente > 1 && (!R1.meses_exceso || e.meses_emergencia > R1.meses_exceso);
  const n = caidaNucleo(e);
  if (!hay || !n || !(n.caida >= c.caida - 1e-9)) return null;
  const usd = excedente * c.parte;
  return {
    usd, excedente, caida: n.caida, desde: n.desde,
    texto: `El núcleo está ${fmt.pct(n.caida)} debajo de su máximo del ${fmt.fecha(n.desde)}. La reserva tiene ${fmt.usd(excedente)} de más: podés sumar ${fmt.usd(usd)} (${fmt.pct(c.parte, 0)} del excedente) al núcleo. No vendas nada y seguí con tus aportes.`,
  };
}
