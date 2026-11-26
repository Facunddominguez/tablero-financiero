// Formularios del diario: anotar predicciones, marcar si se cumplieron, seguir fantasmas y cargar rotaciones.
import { h, fmt, fechas, aNumero } from '../util.js';
import { dialogo, campo, entrada, boton } from './comun.js';
import { eventosRotacion, serieDeTicker, comoPedirlo } from '../diario.js';

const texto = (placeholder, filas = 2) => h('textarea', { rows: filas, placeholder });
const acciones = (d, guardar) => h('div.acciones', boton('Cancelar', () => d().close(), 'fantasma'), h('button.boton.primario', { type: 'submit' }, guardar));

export function nuevaPrediccion(ctx, ticker = '') {
  const e = ctx.estado;
  const fTexto = texto('Ej.: NVDA sube más que SMH en los próximos 6 meses');
  const fProb = entrada({ inputmode: 'numeric', placeholder: '70' });
  const fVence = entrada({ type: 'date', inputmode: null, value: fechas.sumarMeses(e.hoy, 3), min: fechas.sumar(e.hoy, 1) });
  const fCambio = texto('Ej.: si dos trimestres seguidos caen las ventas');
  const fTicker = entrada({ inputmode: 'text', value: ticker, autocapitalize: 'characters', placeholder: 'Opcional' });
  const error = h('p.error', { role: 'alert' });
  const d = dialogo('Anotar una predicción', h('form.formulario', {
    onsubmit: async ev => {
      ev.preventDefault();
      const prob = aNumero(fProb.value), t = fTexto.value.trim(), cambio = fCambio.value.trim();
      if (!t || !cambio) { error.textContent = 'Escribí qué esperás y qué te haría cambiar de idea.'; return; }
      if (!(prob >= 1 && prob <= 99)) { error.textContent = 'La probabilidad va de 1 a 99: si estás 100% seguro, no es una predicción.'; return; }
      if (!(fVence.value > e.hoy)) { error.textContent = 'La fecha de vencimiento tiene que ser futura.'; return; }
      const activo = fTicker.value.trim().toUpperCase();
      await ctx.registrar({ tipo: 'prediccion', fecha: e.hoy, texto: t, probabilidad: prob / 100, vence: fVence.value, cambio, ...(activo ? { ticker: activo } : {}) },
        { tipo: 'decision', fecha: e.hoy, texto: `Predicción (${fmt.num(prob)}%, vence ${fmt.fecha(fVence.value)}): ${t}` });
      d.close();
    },
  },
    h('p.nota', 'Escribila de forma que en la fecha se pueda contestar sí o no. Cuando venza, aparece en Hoy para marcar qué pasó.'),
    campo('Qué esperás que pase', fTexto),
    h('div.fila-campos', campo('Probabilidad (%)', fProb), campo('Vence', fVence), campo('Activo', fTicker)),
    campo('Qué te haría cambiar de idea', fCambio),
    error, acciones(() => d, 'Guardar')), { ancho: '32rem' });
  return d;
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
    await ctx.registrar({ tipo: 'fantasma', origen, ticker, fecha: e.hoy }, { tipo: 'decision', fecha: e.hoy, texto: `Fantasma: ${ticker} (${origen})${serieDeTicker(e, ticker) ? '' : `; sumá ${comoPedirlo(e, ticker)} a historico_extra`}` });
  } }, 'Seguir como fantasma');
}

export function nuevaRotacion(ctx) {
  const e = ctx.estado, a = e.datos.cartera_modelo_allaria;
  const n = Number(String(a?.rotacion || '').replace(/\D/g, ''));
  const fNombre = entrada({ inputmode: 'text', value: n ? `P${n + 1}` : '' });
  const fFecha = entrada({ type: 'date', inputmode: null, value: e.hoy, max: e.hoy });
  const fEntra = entrada({ inputmode: 'text', autocapitalize: 'characters', placeholder: 'Ej.: KO, PEP' });
  const fSale = entrada({ inputmode: 'text', autocapitalize: 'characters', placeholder: 'Ej.: AAPL' });
  const error = h('p.error', { role: 'alert' });
  const lista = f => [...new Set(f.value.toUpperCase().split(/[\s,;]+/).filter(Boolean))];
  const d = dialogo('Cargar una rotación de Allaria', h('form.formulario', {
    onsubmit: async ev => {
      ev.preventDefault();
      const entra = lista(fEntra), sale = lista(fSale), rotacion = fNombre.value.trim();
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
