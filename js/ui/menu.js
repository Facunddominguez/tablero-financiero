// Menú "⋯": sincronizar, importar el Excel de Balanz, cargar el mes, cobros y ventas, decisiones, configuración y respaldo.
import { h, fmt, fechas, aNumero, suma } from '../util.js';
import { db } from '../db.js';
import { dialogo, campo, entrada, boton, aviso, cargarScript, CDN } from './comun.js';

const descargar = (nombre, texto, tipo = 'application/json') => {
  const a = h('a', { href: URL.createObjectURL(new Blob([texto], { type: tipo })), download: nombre });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};

// ---------- Sincronizar ----------
function repoPorDefecto() {
  const m = location.hostname.match(/^(.+)\.github\.io$/);
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return m && repo ? `${m[1]}/${repo}` : '';
}
async function subirAGitHub(sobre, { token, repo }) {
  const url = `https://api.github.com/repos/${repo}/contents/data/cartera.enc.json`;
  const cab = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const actual = await fetch(url, { headers: cab, cache: 'no-store' });
  if (!actual.ok) throw new Error(actual.status === 401 ? 'GitHub rechazó el token (vencido o mal copiado).' : `GitHub respondió ${actual.status} al leer el archivo.`);
  const { sha } = await actual.json();
  const r = await fetch(url, { method: 'PUT', headers: cab, body: JSON.stringify({ message: 'datos: sincronización desde la app', content: btoa(JSON.stringify(sobre)), sha, branch: 'main' }) });
  if (!r.ok) throw new Error(r.status === 403 || r.status === 404 ? 'El token no tiene permiso de escritura sobre este repositorio.' : `GitHub respondió ${r.status} al guardar.`);
}
function sincronizar(ctx) {
  const estado = h('p.nota', { role: 'status' });
  const cuerpo = h('div.formulario');
  const d = dialogo('Sincronizar', cuerpo, { ancho: '30rem' });
  (async () => {
    const gh = await db.leer('github').catch(() => null);
    const n = ctx.pendientes;
    cuerpo.append(
      h('p', n ? `Hay ${n} ${n === 1 ? 'cambio guardado' : 'cambios guardados'} solo en este dispositivo.` : 'No hay cambios nuevos en este dispositivo. Igual podés generar el archivo.'),
      gh?.token
        ? [h('p.nota', `Se guarda cifrado directo en ${gh.repo}. En un par de minutos lo ves desde cualquier dispositivo.`),
          h('div.acciones', boton('Guardar en GitHub', async ev => {
            ev.target.disabled = true; estado.textContent = 'Cifrando y subiendo…';
            try { const datos = ctx.completo(); const sobre = await ctx.cifrarDatos(datos); await subirAGitHub(sobre, gh); await ctx.confirmarSincronizado(datos, sobre); estado.textContent = 'Listo: quedó guardado.'; }
            catch (err) { estado.textContent = err.message; ev.target.disabled = false; }
          }, 'primario'))]
        : [h('p.nota', 'Se descarga el archivo cartera.enc.json ya cifrado. Después abrí Claude Code en la carpeta del tablero y decile: "Commiteá el cartera.enc.json que está en Descargas".'),
          h('div.acciones', boton('Descargar cartera.enc.json', async () => { descargar('cartera.enc.json', JSON.stringify(await ctx.cifrarDatos(ctx.completo()))); estado.textContent = 'Descargado. Los cambios siguen guardados acá hasta que el archivo nuevo esté publicado.'; }, 'primario')),
          h('p.nota', 'Para no depender de eso: en Configuración podés pegar un token de GitHub y sincronizar con un solo clic.')],
      estado);
  })();
  return d;
}

// ---------- Importar Excel de Balanz ----------
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function fechaExcel(v) {
  if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10);
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  return m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
export function lotesDesdeFilas(filas) {
  const lotes = [], errores = [];
  filas.forEach((f, i) => {
    const c = Object.fromEntries(Object.entries(f).map(([k, v]) => [norm(k), v]));
    const ticker = String(c.ticker ?? '').trim().toUpperCase();
    if (!ticker) return;
    const moneda = /usd|u\$s|dolar|d[oó]lar/i.test(String(c.moneda ?? '')) ? 'USD' : 'ARS';
    const l = { ticker, cantidad: aNumero(c.cantidad), fecha_compra: fechaExcel(c.fecha), precio_compra: aNumero(c.preciocompra), moneda, gastos: aNumero(c.gastos) || 0, operacion: c.operacion ? String(c.operacion) : 'Excel de Balanz', mep_dia: aNumero(c.dolarmep) };
    if (!(l.cantidad > 0) || !l.fecha_compra || !(l.precio_compra >= 0) || !(l.mep_dia > 0)) errores.push(`Fila ${i + 2} (${ticker}): faltan datos`);
    else lotes.push(l);
  });
  return { lotes, errores };
}
function importarExcel(ctx) {
  const e = ctx.estado;
  const salida = h('div');
  const archivo = h('input', {
    type: 'file', accept: '.xlsx,.xls',
    onchange: async () => {
      const f = archivo.files[0]; if (!f) return;
      salida.replaceChildren(h('p.nota', 'Leyendo…'));
      try {
        await cargarScript(CDN.xlsx);
        const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
        const hoja = wb.Sheets.resultados_por_lotes_finales || wb.Sheets[wb.SheetNames.find(n => norm(n).includes('lotes')) || wb.SheetNames[0]];
        const { lotes, errores } = lotesDesdeFilas(XLSX.utils.sheet_to_json(hoja, { defval: null }));
        if (!lotes.length) throw new Error('No encontré lotes. La hoja tiene que tener las columnas Cantidad, Ticker, Fecha, Precio Compra, Moneda, Gastos y DolarMEP.');
        const antes = Object.fromEntries(e.posiciones.map(p => [p.ticker, p.cantidad])), despues = {};
        for (const l of lotes) despues[l.ticker] = (despues[l.ticker] || 0) + l.cantidad;
        const tickers = [...new Set([...Object.keys(antes), ...Object.keys(despues)])].sort();
        const cambios = tickers.filter(t => Math.abs((antes[t] || 0) - (despues[t] || 0)) > 0.005);
        salida.replaceChildren(
          h('p', `${lotes.length} lotes de ${Object.keys(despues).length} activos. ${cambios.length ? `Cambian ${cambios.length}:` : 'Las cantidades coinciden con lo que ya había.'}`),
          cambios.length ? h('div.tabla-caja', h('table.tabla.compacta', h('thead', h('tr', h('th', 'Activo'), h('th.num', 'Antes'), h('th.num', 'Después'), h('th.num', 'Diferencia'))),
            h('tbody', cambios.map(t => h('tr', h('td', h('strong', t), !(t in antes) ? ' (nuevo)' : !(t in despues) ? ' (ya no está)' : ''), h('td.num', fmt.cant(antes[t] || 0)), h('td.num', fmt.cant(despues[t] || 0)), h('td.num', fmt.signo((despues[t] || 0) - (antes[t] || 0), 2))))))) : null,
          errores.length ? aviso(`Se saltearon ${errores.length} filas: ${errores.slice(0, 3).join('; ')}${errores.length > 3 ? '…' : ''}`, 'alerta') : null,
          h('p.nota', 'Al confirmar se reemplazan todos los lotes y las cantidades. La caja no cambia.'),
          h('div.acciones', boton('Cancelar', () => d.close(), 'fantasma'), boton('Confirmar y reemplazar', async () => {
            await ctx.registrar({ tipo: 'importar_lotes', fecha: e.hoy, lotes }, { tipo: 'decision', fecha: e.hoy, texto: `Importado el Excel de Balanz: ${lotes.length} lotes, ${cambios.length} activos con cambios` });
            d.close();
          }, 'primario')));
      } catch (err) { salida.replaceChildren(aviso(err.message, 'mal')); }
    },
  });
  const d = dialogo('Importar el Excel de Balanz', h('div.formulario',
    h('ol.pasos-ayuda', h('li', 'En Balanz web: Reportes → Resultados por lotes.'), h('li', 'Descargalo en Excel.'), h('li', 'Elegilo acá abajo. Vas a ver las diferencias antes de confirmar.')),
    campo('Archivo "resultados por lotes"', archivo), salida), { ancho: '36rem' });
  return d;
}

// ---------- Cargar el mes ----------
function cargarMes(ctx) {
  const e = ctx.estado, p = e.datos.perfil;
  const fMes = entrada({ type: 'month', inputmode: null, value: fechas.mes(e.hoy), max: fechas.mes(e.hoy) });
  const previo = () => e.datos.meses?.[fMes.value] || {};
  const f = {
    ingreso: entrada({ value: fmt.num(previo().ingreso ?? p.ingreso_mensual_usd) }), gasto: entrada({ value: fmt.num(previo().gasto ?? p.gasto_habitual_mensual_usd) }),
    vacaciones: entrada({ value: fmt.num(previo().vacaciones ?? 0) }), auto: entrada({ value: fmt.num(previo().auto ?? 0) }), aporte: entrada({ value: fmt.num(previo().aporte ?? 0) }),
  };
  const resumen = h('p.nota');
  const calc = () => {
    const v = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, aNumero(el.value) || 0]));
    resumen.textContent = v.ingreso > 0 ? `Tasa de ahorro: ${fmt.pct((v.ingreso - v.gasto) / v.ingreso, 0)} (meta ${fmt.pct(p.meta_tasa_ahorro, 0)}). Queda para aportar: ${fmt.usd(Math.max(0, v.ingreso - v.gasto - v.vacaciones - v.auto))}.` : '';
    return v;
  };
  Object.values(f).forEach(el => el.addEventListener('input', calc)); calc();
  const d = dialogo('Cargar el mes', h('form.formulario', {
    onsubmit: async ev => { ev.preventDefault(); const v = calc(); if (!(v.ingreso > 0)) return; await ctx.registrar({ tipo: 'mes', mes: fMes.value, fecha: e.hoy, ...v }); d.close(); },
  },
    h('p.nota', 'Todo en dólares. Con esto se calcula tu tasa de ahorro (regla R2) y el monto del aporte.'),
    campo('Mes', fMes),
    h('div.fila-campos', campo('Ingreso', f.ingreso), campo('Gasto', f.gasto)),
    h('div.fila-campos', campo('Ahorro vacaciones', f.vacaciones), campo('Ahorro auto', f.auto)),
    campo('Aporte a la cartera', f.aporte, 'Dejalo en 0 para que lo calcule: ingreso − gasto − ahorros.'),
    resumen, h('div.acciones', boton('Cancelar', () => d.close(), 'fantasma'), h('button.boton.primario', { type: 'submit' }, 'Guardar'))), { ancho: '28rem' });
  return d;
}

// ---------- Registrar cobro, venta o aporte histórico ----------
function registrarMovimiento(ctx, inicial = 'dividendo') {
  const e = ctx.estado;
  const fTipo = h('select', ['dividendo', 'cupon', 'venta', 'aporte_historico'].map(t => h('option', { value: t, selected: t === inicial }, { dividendo: 'Cobré un dividendo', cupon: 'Cobré un cupón', venta: 'Vendí', aporte_historico: 'Falta cargar un aporte viejo' }[t])));
  const fTicker = h('select', e.posiciones.map(p => h('option', { value: p.ticker }, p.ticker)));
  const fFecha = entrada({ type: 'date', inputmode: null, value: e.hoy, max: e.hoy });
  const fUsd = entrada({ placeholder: '0,00' }), fCant = entrada({ inputmode: 'numeric' }), fPrecio = entrada(), fGastos = entrada({ value: '0' }), fMep = entrada({ value: fmt.num(e.mep, 2) });
  const cTicker = campo('Activo', fTicker), cUsd = campo('Monto (USD)', fUsd);
  const venta = h('div', h('div.fila-campos', campo('Cantidad', fCant), campo('Precio $ por unidad', fPrecio)), h('div.fila-campos', campo('Gastos $', fGastos), campo('Dólar MEP', fMep)),
    h('p.nota', 'Antes de vender: la ida y vuelta no debería costar más de lo que fija la regla C2.'));
  const error = h('p.error', { role: 'alert' });
  const ver = () => { const t = fTipo.value; venta.hidden = t !== 'venta'; cUsd.hidden = t === 'venta'; cTicker.hidden = t === 'aporte_historico'; };
  fTipo.addEventListener('change', ver); ver();
  const d = dialogo('Registrar un movimiento', h('form.formulario', {
    onsubmit: async ev => {
      ev.preventDefault();
      const t = fTipo.value, fecha = fFecha.value;
      let evento, texto;
      if (t === 'venta') {
        const cantidad = aNumero(fCant.value), precio = aNumero(fPrecio.value), mep = aNumero(fMep.value);
        const pos = e.posiciones.find(p => p.ticker === fTicker.value);
        if (!(cantidad > 0) || !(precio > 0) || !(mep > 0)) { error.textContent = 'Completá cantidad, precio y MEP.'; return; }
        if (cantidad > pos.cantidad + 1e-9) { error.textContent = `Tenés ${fmt.cant(pos.cantidad)} ${pos.ticker}: no podés vender ${fmt.cant(cantidad)}.`; return; }
        evento = { tipo: 'venta', fecha, ticker: pos.ticker, cantidad, precio, gastos: aNumero(fGastos.value) || 0, mep };
        texto = `Venta de ${fmt.cant(cantidad)} ${pos.ticker} a ${fmt.ars(precio)}`;
      } else {
        const usd = aNumero(fUsd.value);
        if (!(usd > 0)) { error.textContent = 'Completá el monto en dólares.'; return; }
        evento = t === 'aporte_historico' ? { tipo: 'aporte_historico', fecha, usd } : { tipo: 'cobro', fecha, ticker: fTicker.value, clase: t, usd };
        texto = t === 'aporte_historico' ? `Aporte histórico cargado: ${fmt.usd(usd, 2)} del ${fmt.fecha(fecha)}` : `Cobro de ${t === 'cupon' ? 'cupón' : 'dividendo'} de ${fTicker.value}: ${fmt.usd(usd, 2)}`;
      }
      await ctx.registrar(evento, { tipo: 'decision', fecha: e.hoy, texto });
      d.close();
    },
  }, campo('Qué pasó', fTipo), h('div.fila-campos', cTicker, campo('Fecha', fFecha)), cUsd, venta, error,
    h('div.acciones', boton('Cancelar', () => d.close(), 'fantasma'), h('button.boton.primario', { type: 'submit' }, 'Registrar'))), { ancho: '30rem' });
  return d;
}

// ---------- Registro de decisiones ----------
function decisiones(ctx) {
  const e = ctx.estado;
  const nota = entrada({ inputmode: 'text', placeholder: 'Anotá una decisión y por qué la tomaste' });
  const lista = (e.datos.decisiones || []).slice().reverse();
  const d = dialogo('Registro de decisiones', h('div.formulario',
    h('form.fila-nota', { onsubmit: async ev => { ev.preventDefault(); if (!nota.value.trim()) return; await ctx.registrar({ tipo: 'decision', fecha: e.hoy, texto: nota.value.trim() }); d.close(); decisiones(ctx); } },
      nota, h('button.boton.primario', { type: 'submit' }, 'Anotar')),
    lista.length ? h('ul.decisiones', lista.map(x => h('li', h('time', fmt.fecha(x.fecha)), h('span', x.texto)))) : h('p.nota', 'Todavía no hay nada anotado. Cada paso que marques como hecho, pospuesto o descartado queda acá.')), { ancho: '36rem' });
  return d;
}

// ---------- Configuración ----------
function configuracion(ctx) {
  const e = ctx.estado;
  const fDia = entrada({ value: String(e.datos.config.dia_cobro), inputmode: 'numeric' });
  const temaActual = document.documentElement.dataset.tema || '';
  const fTema = h('select', { onchange: () => ctx.aplicarTema(fTema.value || null) }, [['', 'Según el dispositivo'], ['claro', 'Claro'], ['oscuro', 'Oscuro']].map(([v, t]) => h('option', { value: v, selected: v === temaActual }, t)));
  const fToken = h('input', { type: 'password', autocomplete: 'off', placeholder: 'github_pat_…' }), fRepo = entrada({ inputmode: 'text', value: repoPorDefecto(), placeholder: 'usuario/repositorio' });
  const estadoGh = h('p.nota', { role: 'status' });
  const fClave = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Clave nueva (mínimo 12 caracteres)' });
  const estadoClave = h('p.nota', { role: 'status' });
  db.leer('github').then(g => { if (g?.token) { estadoGh.textContent = `Hay un token guardado para ${g.repo}.`; fRepo.value = g.repo; } }).catch(() => {});
  const d = dialogo('Configuración', h('div.formulario',
    h('form.bloque', { onsubmit: async ev => { ev.preventDefault(); const n = Math.round(aNumero(fDia.value)); if (n >= 1 && n <= 31) { await ctx.registrar({ tipo: 'config', cambios: { dia_cobro: n }, fecha: e.hoy }); d.close(); } } },
      h('h3', 'Día de cobro'), h('div.fila-nota', fDia, h('button.boton', { type: 'submit' }, 'Guardar')), h('small', 'Desde ese día de cada mes aparece el paso "Aportá".')),
    h('div.bloque', h('h3', 'Apariencia'), fTema),
    h('div.bloque', h('h3', 'Clave'),
      h('div.acciones.izq', boton('Olvidar la clave en este dispositivo', () => ctx.olvidarClave())),
      h('form.fila-nota', { onsubmit: async ev => { ev.preventDefault(); if (fClave.value.length < 12) { estadoClave.textContent = 'Usá al menos 12 caracteres.'; return; } await ctx.cambiarClave(fClave.value); fClave.value = ''; estadoClave.textContent = 'Clave cambiada en este dispositivo. Ahora sincronizá para que el archivo publicado use la nueva.'; } },
        fClave, h('button.boton', { type: 'submit' }, 'Cambiar')), estadoClave),
    h('form.bloque', { onsubmit: async ev => { ev.preventDefault(); if (!fToken.value.trim() || !/^[\w.-]+\/[\w.-]+$/.test(fRepo.value.trim())) { estadoGh.textContent = 'Completá el token y el repositorio (usuario/repositorio).'; return; } await db.guardar('github', { token: fToken.value.trim(), repo: fRepo.value.trim() }); fToken.value = ''; estadoGh.textContent = 'Guardado solo en este dispositivo. Sincronizar ahora sube directo a GitHub.'; } },
      h('h3', 'Sincronizar con un clic (opcional)'),
      h('small', 'Pegá un token de GitHub "fine-grained" con acceso solo a este repositorio y permiso Contents: Read and write. Queda guardado únicamente en este dispositivo.'),
      campo('Repositorio', fRepo), campo('Token', fToken),
      h('div.acciones.izq', h('button.boton', { type: 'submit' }, 'Guardar token'), boton('Borrar token', async () => { await db.borrar('github'); estadoGh.textContent = 'Token borrado de este dispositivo.'; }, 'fantasma')), estadoGh)), { ancho: '32rem' });
  return d;
}

// ---------- Respaldo en JSON plano ----------
function respaldo(ctx) {
  const estado = h('p.nota', { role: 'status' });
  const archivo = h('input', {
    type: 'file', accept: '.json,application/json',
    onchange: async () => {
      try {
        const obj = JSON.parse(await archivo.files[0].text());
        if (!Array.isArray(obj.posiciones) || !Array.isArray(obj.reglas) || !obj.meta || !obj.nucleo) throw new Error('Ese archivo no parece un respaldo del tablero.');
        if (!confirm('Esto reemplaza todos los datos de este dispositivo por los del respaldo. ¿Seguimos?')) return;
        await ctx.importarPlano(obj); d.close();
      } catch (err) { estado.textContent = err.message; }
    },
  });
  const d = dialogo('Respaldo', h('div.formulario',
    h('div.bloque', h('h3', 'Exportar'), aviso('El respaldo va sin cifrar: cualquiera que abra el archivo ve tus datos. Guardalo en un lugar privado.', 'alerta'),
      h('div.acciones.izq', boton('Descargar respaldo .json', () => descargar(`tablero-respaldo-${ctx.estado.hoy}.json`, JSON.stringify(ctx.completo(), null, 1))))),
    h('div.bloque', h('h3', 'Importar'), campo('Archivo de respaldo', archivo), estado)), { ancho: '30rem' });
  return d;
}

const SECCIONES = {
  sincronizar: ['Sincronizar', 'Guardar los cambios para verlos en otros dispositivos', sincronizar],
  importar: ['Importar el Excel de Balanz', 'Actualiza lotes y cantidades', importarExcel],
  mes: ['Cargar el mes', 'Ingreso, gasto y ahorros', cargarMes],
  movimiento: ['Registrar un movimiento', 'Dividendo, cupón, venta o un aporte viejo', registrarMovimiento],
  decisiones: ['Registro de decisiones', 'Qué hiciste y por qué', decisiones],
  configuracion: ['Configuración', 'Día de cobro, apariencia, clave', configuracion],
  respaldo: ['Respaldo', 'Exportar o importar los datos en JSON', respaldo],
};

export function abrirMenu(ctx, seccion, arg) {
  if (seccion && SECCIONES[seccion]) return SECCIONES[seccion][2](ctx, arg);
  const n = ctx.pendientes;
  const d = dialogo('Más', h('ul.menu', Object.entries(SECCIONES).map(([k, [titulo, sub, fn]]) => h('li',
    h('button', { type: 'button', onclick: () => { d.close(); fn(ctx); } }, h('span.menu-titulo', titulo, k === 'sincronizar' && n ? h('span.chip.alerta', `${n} sin sincronizar`) : null), h('span.menu-sub', sub))))), { ancho: '26rem' });
  return d;
}
