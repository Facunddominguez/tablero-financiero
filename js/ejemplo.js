// Cartera INVENTADA para las pruebas públicas y para probar la app sin datos reales. Ningún número es de nadie.
// Devuelve { datos, ext }: los datos base (lo que iría cifrado) y los archivos de mercado de ese mismo día.
export function ejemplo({ hoy = '2026-11-30' } = {}) {
  const MEP = 1000, CCL = 1050;
  const pos = (ticker, bloque, cantidad, precio, extra = {}) => ({ ticker, descripcion: `${ticker} de ejemplo`, tipo: 'cedear', cantidad, precio, moneda_precio: 'ARS', bloque, ticker_subyacente_usa: ticker, ...extra });
  const lote = (ticker, cantidad, fecha_compra, precio_compra, mep_dia = 900) => ({ ticker, cantidad, fecha_compra, precio_compra, moneda: 'ARS', gastos: Math.round(cantidad * precio_compra * 0.006), mep_dia });
  const posiciones = [
    pos('SPY', 'nucleo', 150, 12000),
    pos('EFA', 'nucleo', 100, 6000),
    pos('EEM', 'nucleo', 25, 12000),
    pos('IWM', 'nucleo', 10, 28000),
    pos('NVDA', 'satelite_volatil', 50, 6500, { riesgo_ar: false }),
    { ticker: 'PAMP', descripcion: 'Acción local de ejemplo', tipo: 'accion_ar', cantidad: 100, precio: 4000, moneda_precio: 'ARS', bloque: 'satelite_argentina', ticker_subyacente_usa: 'PAMP', riesgo_ar: true },
    { ticker: 'ON1', descripcion: 'Obligación negociable de ejemplo', tipo: 'on', cantidad: 500, precio: 1030, moneda_precio: 'ARS', bloque: 'satelite_ypf', ticker_subyacente_usa: null, riesgo_ar: true },
    { ticker: 'FCIP', descripcion: 'Fondo en pesos de ejemplo', tipo: 'fci', cantidad: 1500000, precio: 1.2, moneda_precio: 'ARS', bloque: 'emergencia', ticker_subyacente_usa: null, riesgo_ar: true, fci_nombre: 'Fondo Pesos Ejemplo' },
    { ticker: 'FCID', descripcion: 'Fondo en dólares de ejemplo', tipo: 'fci', cantidad: 2500, precio: 1.1, moneda_precio: 'USD', bloque: 'emergencia', ticker_subyacente_usa: null, fci_nombre: 'Fondo Dolar Ejemplo' },
  ];
  const lotes = [
    lote('SPY', 150, '2026-03-02', 10000), lote('EFA', 100, '2026-03-02', 5200), lote('EEM', 25, '2026-04-06', 10000), lote('IWM', 10, '2026-04-06', 25000),
    lote('NVDA', 50, '2026-05-04', 5000, 950), lote('PAMP', 100, '2026-06-01', 3500, 950), lote('ON1', 500, '2026-06-01', 950, 950),
    lote('FCIP', 1500000, '2026-03-02', 1, 900), { ticker: 'FCID', cantidad: 2500, fecha_compra: '2026-03-02', precio_compra: 1.05, moneda: 'USD', gastos: 0, mep_dia: 900 },
  ];
  const regla = (id, politica, extra = {}) => ({ id, politica, accion: 'Seguir la política', ...extra });
  const datos = {
    meta: { fecha_snapshot: '2026-11-02', fecha_resumen: '2026-11-02', broker: 'Broker de ejemplo', tc_snapshot: { mep: MEP, cable_usd: CCL }, total_ars_informado: 0 },
    config: { dia_cobro: 1, costo_entrada_estimado: 0.0068, caja_minima_reinversion_usd: 50, dias_aviso_flujo: 7, dias_resumen_viejo: 35 },
    perfil: { ingreso_mensual_usd: 1000, gasto_habitual_mensual_usd: 500, piso_tasa_ahorro: 0.3, meta_tasa_ahorro: 0.5 },
    posiciones, lotes_costo: lotes, caja: { ARS: 5000, USD_MEP: 120, USD_cable: 0 },
    nucleo: { pesos_internos: { SPY: 0.5, EFA: 0.3, EEM: 0.1, IWM: 0.1 }, banda_interna_pp: 0.03, rango_LP: [0.7, 0.85], peso_en_LP_objetivo: 0.75 },
    emergencia: { meses_min: 6, meses_obj: 9, objetivo_usd: 4500, vehiculos: ['FCID'] },
    reglas: [
      regla('R1', 'Fondo de emergencia'), regla('R2', 'Ahorro mínimo'), regla('R3', 'Núcleo en rango'), regla('R3B-E', 'Banda interna del núcleo'),
      regla('R4', 'Tope por satélite', { alerta: 0.1, duro: 0.15 }), regla('R4B', 'Tope por satélite volátil', { alerta: 0.06, duro: 0.1 }),
      regla('R5', 'Satélites en total', { objetivo: 0.2, alerta: 0.22, techo: 0.25 }), regla('R6', 'Bloque YPF', { objetivo: 0.1, maximo_aceptado: 0.2 }),
      regla('R6B', 'Riesgo argentino', { objetivo: 0.2, alerta: 0.25, techo: 0.3 }),
      regla('R7', 'Tesis nuevas', { max_tesis: 5 }), regla('C1', 'Costo de entrada', { max: 0.0075 }), regla('C3', 'Costo anual', { alerta: 0.01, auditoria: 0.015 }),
    ],
    objetivos_por_activo: { NVDA: { objetivo: 0.05, banda: [0.03, 0.07] }, PAMP: { objetivo: 0.03 } }, objetivos_externos: [],
    cashflows_externos_usd: [{ fecha: '2026-03-02', usd: 7000 }, { fecha: '2026-04-06', usd: 600 }, { fecha: '2026-05-04', usd: 300 }, { fecha: '2026-06-01', usd: 1000 }],
    watchlist: [{ ticker: 'AAPL', tema: 'Ejemplo', prioridad: 'media', max_inicial: 0.03 }, { ticker: 'KO', tema: 'Ejemplo', prioridad: 'baja', max_inicial: 0.02 }],
    cartera_modelo_allaria: { rotacion: 'P3', fecha: '2026-11-03', activos: [{ ticker: 'AAPL', desde: '2026-06-01' }, { ticker: 'KO', desde: '2026-09-01' }, { ticker: 'SPY', desde: '2026-06-01' }], ultimos_cambios: [{ fecha: '2026-11-03', entra: 'KO', sale: 'PEP' }], rendimiento_por_periodo: { P1: 0.021, P2: -0.008 } },
    config_ejemplo: true,
  };

  // ---------- mercado ----------
  // Histórico diario (lunes a viernes) con subidas y bajadas repetibles, sin azar.
  const fechasHist = [];
  for (let t = Date.UTC(2025, 10, 3); ; t += 86400000) {
    const f = new Date(t).toISOString().slice(0, 10);
    if (f >= hoy) break;
    if (![0, 6].includes(new Date(t).getUTCDay())) fechasHist.push(f);
  }
  const usa = { SPY: 600, EFA: 90, EEM: 50, IWM: 250, NVDA: 150, PAM: 60, YPF: 32, SMH: 400, ARGT: 65, AAPL: 220, KO: 70 };
  const amplitud = { SPY: 0.008, EFA: 0.007, EEM: 0.01, IWM: 0.012, NVDA: 0.028, PAM: 0.025, YPF: 0.027, SMH: 0.02, ARGT: 0.016, AAPL: 0.015, KO: 0.008 };
  const series = {};
  Object.keys(usa).forEach((t, k) => {
    const s = [], n = fechasHist.length;
    let v = 1;
    for (let i = 0; i < n; i++) { v *= 1 + amplitud[t] * (0.7 * Math.sin(i * 0.9 + k) + 0.5 * Math.sin(i * 0.21 + 2 * k) + 0.3 * Math.sin(i * 2.3)) + 0.0004; s.push(v); }
    series[t] = s.map(x => Math.round(x / s[n - 1] * usa[t] * 10000) / 10000);
  });
  series.MEP = fechasHist.map((_, i) => Math.round(MEP * (0.82 + 0.18 * i / fechasHist.length + 0.012 * Math.sin(i * 0.33))));
  series.CCL = series.MEP.map((m, i) => Math.round(m * (1.03 + 0.02 * Math.sin(i * 0.07))));
  const historico = { fechas: fechasHist, series, canje: { stale: false, actualizado: `${hoy}T15:00:00Z` } };

  // CEDEARs en pesos: subyacente × contado con liqui implícito ÷ ratio, con una prima por papel.
  const ratios = { SPY: 60, EFA: 18, EEM: 5, IWM: 10, NVDA: 24, AAPL: 20, KO: 5 };
  const prima = { SPY: 0.002, EFA: 0.018, EEM: -0.004, IWM: 0.001, NVDA: 0, AAPL: 0, KO: 0 };
  const IMPL = 1060, cedears = {}, papeles = {};
  Object.keys(ratios).forEach((t, i) => {
    const ars = Math.round(usa[t] * IMPL * (1 + prima[t]) / ratios[t]);
    cedears[t] = [ars, [0.4, -0.2, 0.9, -0.5, 2.1, 0.3, -0.1][i]];
    cedears[t + 'D'] = [Math.round(ars / MEP * (t === 'SPY' || t === 'EEM' ? 0.996 : 1.006) * 100) / 100, 0.1];
    papeles[t] = [Math.round(IMPL * (1 + prima[t]) * 100) / 100, 1000000 - i * 1000];
  });
  for (const t of ['MSFT', 'GOOGL', 'AMZN', 'META', 'XOM']) papeles[t] = [IMPL, 500000];
  const sec = o => ({ ...o, stale: false, actualizado: `${hoy}T15:00:00Z` });
  const mercado = {
    generado: `${hoy}T15:00:00Z`,
    fx: sec({ mep: MEP, ccl: CCL, oficial: 960, mep_prev: MEP * 0.998, fecha: `${hoy}T14:00:00Z`, dia: hoy }),
    cedears: sec({ precios: cedears }),
    acciones: sec({ precios: { PAMP: [4100, 1.2] } }),
    ons: sec({ precios: { ON1: [1035, 0.2] } }),
    fci: sec({ precios: { 'Fondo Pesos Ejemplo': 1.21, 'Fondo Dolar Ejemplo': 1.101 }, fecha: hoy }),
    implicito: { usa: sec({ precios: Object.fromEntries(Object.entries(usa).map(([t, v]) => [t, [v, 0.3]])) }), ccl: sec({ papeles, mediana: IMPL, fuente: 'calculado' }), revisar_ratios: {} },
    usd: sec({ precios: {} }),
    cpi_usa: sec({ meses: { '2025-11': 320, '2026-03': 323, '2026-06': 325, '2026-10': 328 } }),
  };
  // Historia larga (mensual, 2019 en adelante) y supuestos inventados para las proyecciones.
  const meses = [];
  for (let a = 2019, m = 1; `${a}-${String(m).padStart(2, '0')}` < hoy.slice(0, 7); m === 12 ? (a++, m = 1) : m++) meses.push(`${a}-${String(m).padStart(2, '0')}`);
  const largoPlazo = {
    fechas: meses, hasta: meses.at(-1),
    series: Object.fromEntries(['SPY', 'EFA', 'EEM', 'IWM'].map((t, k) => {
      let v = 100;
      return [t, meses.map((_, i) => Math.round((v *= 1 + 0.007 + (0.03 + 0.004 * k) * Math.sin(i * 1.7) + 0.015 * Math.sin(i * 0.4 + k)) * 100) / 100)];
    })),
  };
  const supuestos = {
    retornos_etf: { fuente: 'Ejemplo', fecha: '2026-09-30', SPY: 0.06, EFA: 0.065, EEM: 0.05, IWM: 0.06 },
    acciones: { fuente: 'Ejemplo', fecha: '2026-09-30', prima_mercado: 0.04 },
    otros: { fuente: 'Ejemplo', fecha: '2026-09-30', on: 0.05, fci_usd: 0.04, caja_usd: 0, pesos: 0 },
    semaforo: { fuente: 'Ejemplo', fecha: '2026-11-26', riesgo_pais: { amarillo: 800, rojo: 1500 }, canje: { amarillo: 0.05, rojo: 0.1 }, brecha: { amarillo: 0.1, rojo: 0.3 }, adr: { amarillo: -0.07, rojo: -0.15 } },
    elecciones: { fuente: 'Ejemplo', fecha: '2026-11-26', diferencia: 0.1 },
    clima: { fuente: 'Ejemplo', fecha: '2026-11-26', alto_rendimiento: { atento: 4, tenso: 6 }, curva: { atento: 0.25, tenso: 0 }, vix: { atento: 20, tenso: 30 }, spy_promedio: { atento: 0, tenso: -0.05 } },
  };
  const semanas = fechasHist.filter((_, i) => i % 5 === 4);
  const fred = (base, amplitud) => sec({ fechas: semanas, valores: semanas.map((_, i) => Math.round((base + amplitud * Math.sin(i * 0.4)) * 100) / 100), ultimo: { fecha: fechasHist.at(-1), valor: base } });
  const clima = { series: { BAMLH0A0HYM2: fred(3.5, 0.5), T10Y3M: fred(0.6, 0.3), VIXCLS: fred(16, 4), NFCI: fred(-0.4, 0.1) } };
  // Riesgo país, tasa de plazo fijo, cuotapartes de fin de mes y mercados de la elección: todo inventado.
  const finesDeMes = meses.slice(-24).map(m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10)).concat(fechasHist.at(-1)).filter((f, i, a) => !i || f > a[i - 1]);
  const dias = f => (Date.parse(f) - Date.parse(finesDeMes[0])) / 86400000;
  const argentina = {
    generado: `${hoy}T15:00:00Z`,
    riesgo_pais: sec({ fechas: [fechasHist.at(-2), fechasHist.at(-1)], valores: [620, 650], ultimo: { fecha: fechasHist.at(-1), valor: 650 } }),
    plazo_fijo: sec({ fechas: [finesDeMes[0], fechasHist.at(-1)], valores: [0.3, 0.3], ultimo: { fecha: fechasHist.at(-1), valor: 0.3 } }),
    fondos: sec({
      fechas: finesDeMes,
      series: {
        'Fondo Pesos Ejemplo': finesDeMes.map(f => Math.round(Math.pow(1.32, dias(f) / 365) * 1e6) / 1e6),
        'Fondo Dolar Ejemplo': finesDeMes.map(f => Math.round(Math.pow(1.05, dias(f) / 365) * 1e6) / 1e6),
      },
    }),
    elecciones: {
      fecha: '2027-10-24',
      kalshi: sec({ nombre: 'Kalshi', url: 'https://kalshi.com/', volumen_unidad: 'contratos de USD 1', candidatos: [{ nombre: 'Candidata Uno', prob: 0.5, volumen: 3000 }, { nombre: 'Candidato Dos', prob: 0.3, volumen: 1000 }, { nombre: 'Candidato Tres', prob: 0.1, volumen: 500 }] }),
      polymarket: sec({ nombre: 'Polymarket', url: 'https://polymarket.com/', volumen_unidad: 'USD operados', candidatos: [{ nombre: 'Candidata Uno', prob: 0.38, volumen: 9000 }, { nombre: 'Candidato "Apodo" Dos', prob: 0.35, volumen: 1000 }] }),
    },
  };
  const ext = {
    mercado, historico, largoPlazo, supuestos, argentina, clima,
    ratios: { fecha: '2026-11-19', ratios: Object.fromEntries(Object.entries(ratios).map(([t, r]) => [t, { ratio: r }])) },
    feriados: {
      anios: [2026, 2027], feriados: { '2026-11-26': 'Acción de Gracias', '2026-12-25': 'Navidad' }, medias_ruedas: { '2026-11-27': 'día después de Acción de Gracias', '2026-12-24': 'Nochebuena' },
      byma: { horarios: [{ desde: '2026-11-02', apertura: '10:30', cierre: '18:00' }, { desde: '2027-03-14', apertura: '10:30', cierre: '17:00', confirmado: false }] },
    },
    feriadosAr: { anios: [2026, 2027], feriados: { '2026-12-07': { nombre: 'Puente turístico no laborable', tipo: 'puente' }, '2026-12-08': { nombre: 'Inmaculada Concepción de María', tipo: 'inamovible' }, '2026-12-25': { nombre: 'Navidad', tipo: 'inamovible' } } },
    calendario: { flujos: [{ ticker: 'ON1', fecha: '2027-01-14', tipo: 'cupon', moneda: 'USD', por_vn: 0.04, detalle: 'Cupón de ejemplo' }] },
    insiders: { filas: [] },
  };
  return { datos, ext };
}
