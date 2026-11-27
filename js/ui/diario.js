// Formularios del diario: anotar, editar y borrar predicciones y carteras fantasma, y cargar rotaciones.
import { h, fmt, fechas, aNumero } from '../util.js';
import { dialogo, campo, entrada, boton } from './comun.js';
import { eventosRotacion, contraReferencia, leerHistorialAllaria, REFERENCIAS, FORMATO_ALLARIA } from '../diario.js';

const texto = (placeholder, filas = 2, value = '') => h('textarea', { rows: filas, placeholder, value });
const acciones = (d, guardar) => h('div.acciones', boton('Cancelar', () => d().close(), 'fantasma'), h('button.boton.primario', { type: 'submit' }, guardar));
const tickers = f => [...new Set(f.value.toUpperCase().split(/[\s,;]+/).filter(Boolean))];

// Sin `existente` anota una nueva; con él, la edita. De una ya resuelta no se cambia la probabilidad
// (cambiarla después de saber qué pasó arruinaría el puntaje), pero sí el resultado.
export function nuevaPrediccion(ctx, ticker = '', existente = null) {
  const e = ctx.estado, x = existente, resuelta = typeof x?.cumplio === 'boolean';
  const fTexto = texto('Ej.: NVDA sube más que SMH en los próximos 6 meses', 2, x?.texto || '');
  const fProb = entrada({ inputmode: 'numeric', placeholder: '70', value: x ? fmt.num(x.probabilidad * 100) : '', disabled: resuelta });
  const fVence = entrada({ type: 'date', inputmode: null, value: x?.vence || fechas.sumarMeses(e.hoy, 3), min: x ? null : fechas.sumar(e.hoy, 1) });
  const fCambio = texto('Ej.: si dos trimestres seguidos caen las ventas', 2, x?.cambio || '');
  const fTicker = entrada({ inputmode: 'text', value: x ? x.ticker || '' : ticker, autocapitalize: 'characters', placeholder: 'Opcional' });
  const fResultado = resuelta ? h('select', [['si', 'Se cumplió'], ['no', 'No se cumplió'], ['abierta', 'Sin marcar (volver a preguntar)']].map(([v, t]) => h('option', { value: v, selected: v === (x.cumplio ? 'si' : 'no') }, t))) : null;
  const error = h('p.error', { role: 'alert' });
  const d = dialogo(x ? 'Editar la predicción' : 'Anotar una predicción', h('form.formulario', {
    onsubmit: async ev => {
      ev.preventDefault();
      const prob = resuelta ? x.probabilidad * 100 : aNumero(fProb.value), t = fTexto.value.trim(), cambio = fCambio.value.trim(), vence = fVence.value;
      if (!t || !cambio) { error.textContent = 'Escribí qué esperás y qué te haría cambiar de idea.'; return; }
      if (!(prob >= 1 && prob <= 99)) { error.textContent = 'La probabilidad va de 1 a 99: si estás 100% seguro, no es una predicción.'; return; }
      if (!vence || (vence !== x?.vence && !(vence > e.hoy))) { error.textContent = 'La fecha de vencimiento tiene que ser futura.'; return; }
      const activo = fTicker.value.trim().toUpperCase();
      if (!x) await ctx.registrar({ tipo: 'prediccion', fecha: e.hoy, texto: t, probabilidad: prob / 100, vence, cambio, ...(activo ? { ticker: activo } : {}) },
        { tipo: 'decision', fecha: e.hoy, texto: `Predicción (${fmt.num(prob)}%, vence ${fmt.fecha(vence)}): ${t}` });
      else await ctx.registrar({ tipo: 'prediccion_editar', ref: x.id, fecha: e.hoy, cambios: {
        texto: t, cambio, vence, ticker: activo, ...(resuelta ? { cumplio: { si: true, no: false, abierta: null }[fResultado.value] } : { probabilidad: prob / 100 }),
      } }, { tipo: 'decision', fecha: e.hoy, texto: `Editada la predicción: ${t}` });
      d.close();
    },
  },
    h('p.nota', 'Escribila de forma que en la fecha se pueda contestar sí o no. Cuando venza, aparece en Hoy para marcar qué pasó.'),
    campo('Qué esperás que pase', fTexto),
    h('div.fila-campos', campo('Probabilidad (%)', fProb, resuelta ? 'Ya se resolvió: no se cambia.' : null), campo('Vence', fVence), campo('Activo', fTicker)),
    campo('Qué te haría cambiar de idea', fCambio),
    fResultado ? campo('Resultado', fResultado) : null,
    error, acciones(() => d, 'Guardar')), { ancho: '32rem' });
  return d;
}

export async function borrarPrediccion(ctx, p) {
  if (!confirm(`¿Borrar la predicción "${p.texto}"? Sale del puntaje y no vuelve a aparecer.`)) return;
  await ctx.registrar({ tipo: 'prediccion_borrar', ref: p.id }, { tipo: 'decision', fecha: ctx.estado.hoy, texto: `Borrada la predicción: ${p.texto}` });
}

export function marcarPrediccion(ctx, paso) {
  const e = ctx.estado, p = e.datos.predicciones.find(x => x.id === paso.accion.ref);
  const marcar = async cumplio => {
    await ctx.registrar({ tipo: 'prediccion_resultado', ref: paso.accion.ref, cumplio, fecha: e.hoy },
      { tipo: 'paso', paso_id: paso.id, estado: 'hecho', titulo: paso.titulo, fecha: e.hoy, nota: cumplio ? 'se cumplió' : 'no se cumplió' });
    d.close();
  };
  const d = dialogo('¿Se cumplió?', h('div.formulario',
    h('p', p?.texto || paso.titulo), p ? h('p.nota', `Le habías dado ${fmt.pct(p.probabilidad, 0)}.`) : null,
    h('div.acciones', boton('No se cumplió', () => marcar(false)), boton('Se cumplió', () => marcar(true), 'primario'))), { ancho: '26rem' });
  return d;
}

// Botón para seguir como fantasma algo del Radar o de la watchlist.
export function botonFantasma(ctx, origen, ticker) {
  const e = ctx.estado, ya = (e.datos.fantasmas || []).filter(f => f.ticker === ticker && f.origen === origen).map(f => f.fecha).sort().at(-1);
  if (ya) return h('small.desglose', `fantasma desde el ${fmt.fecha(ya)}`);
  return h('button.enlace.fantasma-seguir', { type: 'button', title: 'Anotalo sin comprar: después se compara con SPY', onclick: async () => {
    await ctx.registrar({ tipo: 'fantasma', origen, ticker, fecha: e.hoy }, { tipo: 'decision', fecha: e.hoy, texto: `Fantasma: ${ticker} (${origen})` });
  } }, 'Seguir como fantasma');
}

// Cambiar el nombre, la fecha o los tickers de una cartera fantasma (grupo de compararFantasmas).
export function editarFantasma(ctx, g) {
  const e = ctx.estado;
  const fNombre = entrada({ inputmode: 'text', value: g.grupo || '', placeholder: 'Opcional: nombre de la cartera' });
  const fFecha = entrada({ type: 'date', inputmode: null, value: g.fecha, max: e.hoy });
  const fTickers = entrada({ inputmode: 'text', autocapitalize: 'characters', value: g.filas.map(f => f.ticker).join(', ') });
  const error = h('p.error', { role: 'alert' });
  const d = dialogo('Editar la cartera fantasma', h('form.formulario', {
    onsubmit: async ev => {
      ev.preventDefault();
      const lista = tickers(fTickers), nombre = fNombre.value.trim();
      if (!fFecha.value || !lista.length) { error.textContent = 'Completá la fecha y al menos un ticker. Para sacarla entera, usá Borrar.'; return; }
      await ctx.registrar({ tipo: 'fantasma_editar', clave: g.clave, grupo: nombre || (lista.length > 1 ? g.nombre : ''), fecha: fFecha.value, tickers: lista },
        { tipo: 'decision', fecha: e.hoy, texto: `Editada la cartera fantasma ${nombre || g.nombre}: ${lista.join(', ')} desde el ${fmt.fecha(fFecha.value)}` });
      d.close();
    },
  },
    h('div.fila-campos', campo('Nombre', fNombre), campo('Desde', fFecha)),
    campo('Tickers', fTickers, 'Separados por comas.'), error, acciones(() => d, 'Guardar')), { ancho: '30rem' });
  return d;
}

// Borra una cartera fantasma entera, o un solo ticker de ella.
export async function borrarFantasma(ctx, g, ticker = null) {
  const que = ticker ? `${ticker} de la cartera fantasma "${g.nombre}"` : `la cartera fantasma "${g.nombre}"`;
  if (!confirm(`¿Quitar ${que}? Deja de compararse; tus datos reales no cambian.`)) return;
  await ctx.registrar({ tipo: 'fantasma_borrar', clave: g.clave, ...(ticker ? { ticker } : {}) }, { tipo: 'decision', fecha: ctx.estado.hoy, texto: `Quitado ${que}` });
}

// Pegar el historial completo de rotaciones (JSON). Queda en tus datos cifrados y reemplaza al anterior.
export function importarHistorial(ctx) {
  const e = ctx.estado, previo = e.datos.cartera_modelo_allaria?.historial;
  const fTexto = texto(FORMATO_ALLARIA, 10);
  const estado = h('p.nota', { role: 'status' }), error = h('p.error', { role: 'alert' });
  const d = dialogo('Historial de rotaciones de Allaria', h('form.formulario', {
    onsubmit: async ev => {
      ev.preventDefault();
      error.textContent = '';
      let x;
      try { x = leerHistorialAllaria(fTexto.value, e.hoy); } catch (err) { error.textContent = err.message; estado.textContent = ''; return; }
      await ctx.registrar({ tipo: 'historial_allaria', fecha: e.hoy, ...x },
        { tipo: 'decision', fecha: e.hoy, texto: `Cargado el historial de Allaria: ${x.rotaciones.length} rotaciones (${x.rotaciones[0].id} a ${x.rotaciones.at(-1).id})` });
      d.close();
    },
  },
    h('p.nota', 'Pegá el JSON. "rendimiento" es lo que rindió el período que empieza en esa fecha, como fracción: −0.0871 es −8,71%. En la última puede faltar.'),
    h('pre.formato', FORMATO_ALLARIA),
    campo('JSON', fTexto),
    previo ? h('p.nota', `Ya hay uno cargado el ${fmt.fecha(previo.cargado)} (${previo.rotaciones.length} rotaciones): el nuevo lo reemplaza.`) : null,
    estado, error, acciones(() => d, 'Guardar')), { ancho: '36rem' });
  return d;
}

// Con qué se compara cada satélite. Vacío vuelve a la predeterminada.
export function editarReferencias(ctx) {
  const e = ctx.estado, propias = e.datos.referencias || {};
  const disponibles = Object.keys(e.historico?.series || {}).filter(t => t !== 'MEP' && t !== 'CCL').sort();
  const lista = h('datalist', { id: 'series-referencia' }, disponibles.map(t => h('option', { value: t })));
  const filas = contraReferencia(e).filas.map(f => {
    const predeterminada = REFERENCIAS[f.ticker] || REFERENCIAS[f.serie] || 'SPY';
    return { t: f.ticker, input: entrada({ inputmode: 'text', autocapitalize: 'characters', list: 'series-referencia', value: propias[f.ticker] || '', placeholder: predeterminada }), predeterminada };
  });
  const error = h('p.error', { role: 'alert' });
  const d = dialogo('Referencia de cada satélite', h('form.formulario', {
    onsubmit: async ev => {
      ev.preventDefault();
      const cambios = {};
      for (const f of filas) {
        const v = f.input.value.trim().toUpperCase();
        if (v && !/^[A-Z0-9.]{1,12}$/.test(v)) { error.textContent = `"${v}" no parece un ticker de EE.UU.`; return; }
        const nuevo = v === f.predeterminada ? '' : v;
        if (nuevo !== (propias[f.t] || '')) cambios[f.t] = nuevo;
      }
      if (Object.keys(cambios).length) await ctx.registrar({ tipo: 'referencias', fecha: e.hoy, cambios },
        { tipo: 'decision', fecha: e.hoy, texto: `Referencias: ${Object.entries(cambios).map(([t, x]) => `${t} contra ${x || 'la predeterminada'}`).join(', ')}` });
      d.close();
    },
  },
    h('p.nota', 'Escribí el ticker de EE.UU. (un ETF, por ejemplo). Vacío usa la predeterminada. Si todavía no hay historia de ese ticker, se pide en la próxima actualización de precios.'),
    lista, filas.length ? filas.map(f => campo(f.t, f.input)) : h('p.nota', 'No hay satélites.'),
    error, acciones(() => d, 'Guardar')), { ancho: '28rem' });
  return d;
}

export function nuevaRotacion(ctx) {
  const e = ctx.estado, a = e.datos.cartera_modelo_allaria;
  const n = Number(String(a?.rotacion || '').replace(/\D/g, ''));
  const fNombre = entrada({ inputmode: 'text', value: n ? `P${n + 1}` : '' });
  const fFecha = entrada({ type: 'date', inputmode: null, value: e.hoy, max: e.hoy });
  const fEntra = entrada({ inputmode: 'text', autocapitalize: 'characters', placeholder: 'Ej.: KO, PEP' });
  const fSale = entrada({ inputmode: 'text', autocapitalize: 'characters', placeholder: 'Ej.: AAPL' });
  const error = h('p.error', { role: 'alert' });
  const d = dialogo('Cargar una rotación de Allaria', h('form.formulario', {
    onsubmit: async ev => {
      ev.preventDefault();
      const entra = tickers(fEntra), sale = tickers(fSale), rotacion = fNombre.value.trim();
      const actuales = new Set((a?.activos || []).map(x => x.ticker));
      const falta = sale.filter(t => !actuales.has(t));
      if (!rotacion || !fFecha.value || (!entra.length && !sale.length)) { error.textContent = 'Completá el nombre, la fecha y qué entra o sale.'; return; }
      if (falta.length) { error.textContent = `${falta.join(', ')} no está en la cartera modelo vigente.`; return; }
      await ctx.registrar(...eventosRotacion(e.datos, { fecha: fFecha.value, rotacion, entra, sale }, e.hoy));
      d.close();
    },
  },
    h('p.nota', 'La cartera modelo queda actualizada y entra como cartera fantasma desde esa fecha: no compra nada, solo se compara con SPY.'),
    h('div.fila-campos', campo('Rotación', fNombre), campo('Fecha', fFecha)),
    campo('Entran', fEntra), campo('Salen', fSale), error, acciones(() => d, 'Guardar')), { ancho: '30rem' });
  return d;
}
