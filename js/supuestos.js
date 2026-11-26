// Supuestos numéricos: el archivo público data/supuestos.json (con fuente y fecha) y, encima, lo que cambiaste
// desde la app (queda en tus datos cifrados). Puro.
const objeto = x => !!x && typeof x === 'object' && !Array.isArray(x);

// Copia de `base` con `cambios` encima, grupo por grupo.
export function fundir(base, cambios) {
  if (!objeto(cambios)) return base;
  const out = { ...(objeto(base) ? base : {}) };
  for (const [k, v] of Object.entries(cambios)) out[k] = objeto(v) ? fundir(out[k], v) : v;
  return out;
}

export const supuestos = e => fundir(e.supuestos || {}, e.datos?.supuestos || {});

// Qué se puede editar en ⋯ → Supuestos: [grupo, título, [[clave, etiqueta, formato]]]. formato: 'pct' o 'num'.
export const EDITABLES = [
  ['retornos_etf', 'Retorno anual esperado de los ETF', [['SPY', 'SPY (%)', 'pct'], ['EFA', 'EFA (%)', 'pct'], ['EEM', 'EEM (%)', 'pct'], ['IWM', 'IWM (%)', 'pct']]],
  ['acciones', 'Acciones sueltas', [['tasa_libre', 'Tasa libre de riesgo (%)', 'pct'], ['prima_mercado', 'Prima de mercado (%)', 'pct']]],
  ['otros', 'Lo demás, retorno anual en dólares', [['on', 'Obligaciones negociables (%)', 'pct'], ['fci_usd', 'Fondos en dólares (%)', 'pct'], ['caja_usd', 'Dólares sin invertir (%)', 'pct'], ['pesos', 'Pesos (%)', 'pct']]],
];
