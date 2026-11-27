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
  ['acciones', 'Acciones sueltas (ancladas a SPY)', [['prima_mercado', 'Prima de mercado (%)', 'pct']]],
  ['otros', 'Lo demás, retorno anual en dólares', [['on', 'Obligaciones negociables (%)', 'pct'], ['fci_usd', 'Fondos en dólares (%)', 'pct'], ['caja_usd', 'Dólares sin invertir (%)', 'pct'], ['pesos', 'Pesos (%)', 'pct']]],
  ['semaforo', 'Semáforo argentino', [
    ['riesgo_pais.amarillo', 'Riesgo país: amarillo desde', 'num'], ['riesgo_pais.rojo', 'Riesgo país: rojo desde', 'num'],
    ['canje.amarillo', 'Canje: amarillo desde (%)', 'pct'], ['canje.rojo', 'Canje: rojo desde (%)', 'pct'],
    ['brecha.amarillo', 'Brecha: amarillo desde (%)', 'pct'], ['brecha.rojo', 'Brecha: rojo desde (%)', 'pct'],
    ['adr.amarillo', 'Acciones contra SPY: amarillo (%)', 'pct'], ['adr.rojo', 'Acciones contra SPY: rojo (%)', 'pct'],
  ]],
  ['radar_directivos', 'Radar de directivos', [['umbral', 'Puntaje mínimo para seguir una compra como fantasma (0 a 100)', 'num']]],
  ['elecciones', 'Elección 2027', [['diferencia', 'Avisar si los mercados difieren (%)', 'pct']]],
  ['clima', 'Clima de mercado', [
    ['alto_rendimiento.atento', 'Bonos de riesgo: atento desde (puntos)', 'num'], ['alto_rendimiento.tenso', 'Bonos de riesgo: tenso desde (puntos)', 'num'],
    ['curva.atento', 'Curva: atento desde (puntos)', 'num'], ['curva.tenso', 'Curva: tenso desde (puntos)', 'num'],
    ['vix.atento', 'VIX: atento desde', 'num'], ['vix.tenso', 'VIX: tenso desde', 'num'],
    ['spy_promedio.atento', 'SPY contra su promedio: atento (%)', 'pct'], ['spy_promedio.tenso', 'SPY contra su promedio: tenso (%)', 'pct'],
    ['condiciones.atento', 'Condiciones financieras: atento desde', 'num'], ['condiciones.tenso', 'Condiciones financieras: tenso desde', 'num'],
  ]],
];
