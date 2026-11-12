// Piezas de interfaz compartidas: diálogos, campos, medidores y el registro de compras.
import { h, fmt, fechas, aNumero, suma } from '../util.js';

export function dialogo(titulo, cuerpo, { ancho } = {}) {
  const d = h('dialog.dialogo', ancho ? { style: `max-width:${ancho}` } : null,
    h('header.dialogo-cab', h('h2', titulo), h('button.icono', { type: 'button', 'aria-label': 'Cerrar', onclick: () => d.close() }, '×')),
    h('div.dialogo-cuerpo', cuerpo));
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', ev => { if (ev.target === d) d.close(); });
  document.body.append(d);
  d.showModal();
  return d;
}

export const campo = (etiqueta, control, ayuda) => h('label.campo', h('span.campo-etq', etiqueta), control, ayuda ? h('small', ayuda) : null);
export const entrada = (attrs = {}) => h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', ...attrs });
export const boton = (texto, onclick, clase = '') => h('button.boton' + (clase ? '.' + clase : ''), { type: 'button', onclick }, texto);
export const chip = (texto, clase = '') => h('span.chip' + (clase ? '.' + clase : ''), texto);
export const NIVEL = { ok: ['En orden', 'ok'], alerta: ['Activa', 'alerta'], violada: ['Incumplida', 'mal'], sin_datos: ['Sin datos', 'neutro'], info: ['Informativa', 'neutro'] };

export function aviso(texto, clase = '') { return h('p.aviso' + (clase ? '.' + clase : ''), texto); }

// Medidor horizontal: valor contra un objetivo, con un rango aceptable opcional. Todo en fracción de `max`.
export function medidor({ valor, objetivo, rango, max, estado }) {
  const pc = x => Math.max(0, Math.min(100, x / max * 100)) + '%';
  return h('div.medidor', { role: 'img', 'aria-label': `valor ${fmt.num(valor, 1)}, objetivo ${fmt.num(objetivo, 1)}` },
    rango ? h('span.medidor-rango', { style: `left:${pc(rango[0])};width:calc(${pc(rango[1])} - ${pc(rango[0])})` }) : null,
    h('span.medidor-valor.' + (estado || 'ok'), { style: `width:${pc(valor)}` }),
    h('span.medidor-obj', { style: `left:${pc(objetivo)}` }));
}

export function tabla(columnas, filas, { clase = '', pie } = {}) {
  return h('div.tabla-caja', h('table.tabla' + (clase ? '.' + clase : ''),
    h('thead', h('tr', columnas.map(c => h('th' + (c.num ? '.num' : ''), c.titulo)))),
    h('tbody', filas.map(f => h('tr', columnas.map(c => h('td' + (c.num ? '.num' : '') + (c.clase ? '.' + c.clase : ''), c.celda(f)))))),
    pie ? h('tfoot', h('tr', pie.map((p, i) => h('td' + (columnas[i]?.num ? '.num' : ''), p)))) : null));
}

export const signoClase = n => n > 0 ? 'sube' : n < 0 ? 'baja' : '';

// Diálogo para registrar compras ejecutadas (un aporte nuevo o una reinversión desde caja).
// Prellenado con lo sugerido; el usuario corrige cantidad, precio y gastos reales.
export function dialogoCompras(ctx, { titulo, compras, usd, externo, paso }) {
  const e = ctx.estado;
  const fFecha = entrada({ type: 'date', inputmode: null, value: e.hoy, max: e.hoy });
  const fUsd = entrada({ value: fmt.num(usd, 2) });
  const fMep = entrada({ value: fmt.num(e.mep, 2) });
  const filas = compras.map(c => ({
    ticker: c.ticker,
    cant: entrada({ value: String(c.cantidad), inputmode: 'numeric' }),
    precio: entrada({ value: fmt.num(c.precio, 2) }),
    gastos: entrada({ value: fmt.num(c.gastos, 2) }),
  }));
  const error = h('p.error', { role: 'alert' });
  const form = h('form.formulario', {
    onsubmit: async ev => {
      ev.preventDefault();
      const mep = aNumero(fMep.value), monto = aNumero(fUsd.value);
      const lista = filas.map(f => ({ ticker: f.ticker, cantidad: aNumero(f.cant.value), precio: aNumero(f.precio.value), gastos: aNumero(f.gastos.value) || 0 })).filter(c => c.cantidad > 0);
      if (!(mep > 0) || (externo && !(monto > 0)) || lista.some(c => !(c.precio > 0))) { error.textContent = 'Revisá los números: hay algún campo vacío o en cero.'; return; }
      const gastado = suma(lista, c => c.cantidad * c.precio + c.gastos) / mep;
      if (externo && gastado > monto * 1.02) { error.textContent = `Las compras suman ${fmt.usd(gastado, 2)} y el aporte es de ${fmt.usd(monto, 2)}. Corregí el monto aportado.`; return; }
      const ev1 = externo
        ? { tipo: 'aporte', fecha: fFecha.value, usd: monto, mep, compras: lista }
        : { tipo: 'compra', fecha: fFecha.value, mep, compras: lista };
      const extra = paso ? [{ tipo: 'paso', paso_id: paso.id, estado: 'hecho', titulo: paso.titulo, fecha: e.hoy }] : [{ tipo: 'decision', fecha: e.hoy, texto: `${externo ? 'Aporte' : 'Compra desde caja'} de ${fmt.usd(externo ? monto : gastado, 2)}: ${lista.map(c => `${c.cantidad} ${c.ticker}`).join(', ')}` }];
      await ctx.registrar(ev1, ...extra);
      d.close();
    },
  },
    h('p.nota', 'Cargá lo que realmente se ejecutó. Los precios son por unidad, en pesos; los gastos son comisión más derechos e IVA.'),
    h('div.fila-campos', campo('Fecha', fFecha), externo ? campo('Aportaste (USD)', fUsd) : null, campo('Dólar MEP', fMep)),
    h('div.tabla-caja', h('table.tabla.compacta',
      h('thead', h('tr', h('th', 'Activo'), h('th.num', 'Cantidad'), h('th.num', 'Precio $'), h('th.num', 'Gastos $'))),
      h('tbody', filas.map(f => h('tr', h('td', h('strong', f.ticker)), h('td.num', f.cant), h('td.num', f.precio), h('td.num', f.gastos)))))),
    error,
    h('div.acciones', boton('Cancelar', () => d.close(), 'fantasma'), h('button.boton.primario', { type: 'submit' }, 'Registrar')));
  const d = dialogo(titulo, form, { ancho: '34rem' });
  return d;
}

// Bibliotecas externas: se bajan, se comprueba su huella (SHA-384) y recién entonces se ejecutan.
// Si el archivo del CDN cambiara, aunque sea un byte, no se carga.
export const CDN = {
  chart: ['https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js', 'bs/nf9FbdNouRbMiFcrcZfLXYPKiPaGVGplVbv7dLGECccEXDW+S3zjqSKR5ZEaD'],
  xlsx: ['https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', 'EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT'],
  pdf: ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', '/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e'],
  pdfWorker: ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js', 'SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2'],
};
const verificados = {};
// Devuelve una URL local (blob:) con el contenido ya verificado.
export function bajarVerificado([url, huella]) {
  return verificados[url] || (verificados[url] = (async () => {
    const r = await fetch(url, { credentials: 'omit' });
    if (!r.ok) throw new Error('No se pudo bajar ' + url);
    const buf = await r.arrayBuffer();
    const dig = new Uint8Array(await crypto.subtle.digest('SHA-384', buf));
    let bin = ''; for (const b of dig) bin += String.fromCharCode(b);
    if (btoa(bin) !== huella) throw new Error('La biblioteca descargada no coincide con la versión verificada: no se ejecuta.');
    return URL.createObjectURL(new Blob([buf], { type: 'text/javascript' }));
  })().catch(err => { delete verificados[url]; throw err; }));
}
const cargados = {};
export function cargarScript(lib) {
  return cargados[lib[0]] || (cargados[lib[0]] = bajarVerificado(lib).then(src => new Promise((ok, mal) => {
    const s = h('script', { src });
    s.onload = ok; s.onerror = () => mal(new Error('No se pudo ejecutar ' + lib[0]));
    document.head.append(s);
  })).catch(err => { delete cargados[lib[0]]; throw err; }));
}

// Colores de series leídos de las variables CSS (cambian con el tema).
export function coloresSeries() {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  return { series: [1, 2, 3, 4, 5, 6].map(i => v('--serie-' + i)), tinta: v('--tinta'), tinta2: v('--tinta-2'), linea: v('--linea'), superficie: v('--superficie'), num: v('--f-num') };
}

export const proximaFecha = f => `${fmt.fechaLarga(f)}${fechas.anio(f) !== fechas.anio(fechas.hoy()) ? ' de ' + fechas.anio(f) : ''}`;
