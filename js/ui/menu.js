// Menú "⋯": sincronizar, importar el Excel de Balanz, movimientos, decisiones, fuentes, configuración, seguridad y respaldo.
import { h, poner, fmt, aNumero } from '../util.js';
import { fortaleza, generarFrase, bloqueo } from '../seguridad.js';
import { enlacePermiso } from '../sync.js';
import { dialogo, campo, entrada, boton, aviso, chip, cargarScript, CDN } from './comun.js';

const descargar = (nombre, texto, tipo = 'application/json') => {
  const a = h('a', { href: URL.createObjectURL(new Blob([texto], { type: tipo })), download: nombre });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};

// ---------- Sincronizar ----------
// Guía para dar permiso de guardado en GitHub, sin salir de la app más que para generar el permiso.
function guiaPermiso(ctx, alTerminar) {
  const sugerido = ctx.repoSugerido;
  const fRepo = entrada({ inputmode: 'text', value: sugerido, placeholder: 'usuario/repositorio' });
  const fToken = h('input', { type: 'password', autocomplete: 'off', placeholder: 'github_pat_…', 'aria-label': 'Permiso generado en GitHub' });
  const estado = h('p.nota', { role: 'status' });
  const btn = h('button.boton.primario', { type: 'submit' }, 'Probar y activar');
  return h('form.formulario', {
    onsubmit: async ev => {
      ev.preventDefault();
      const token = fToken.value.trim(), repo = fRepo.value.trim();
      if (!/^(github_pat_|ghp_)\w{20,}$/.test(token)) { estado.textContent = 'Eso no parece un permiso de GitHub: tiene que empezar con github_pat_.'; return; }
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { estado.textContent = 'Completá el repositorio como usuario/repositorio.'; return; }
      btn.disabled = true; estado.textContent = 'Probando: leo los datos de GitHub y los vuelvo a guardar…';
      try { await ctx.guardarPermiso(repo, token); fToken.value = ''; alTerminar(); }
      catch (err) { estado.textContent = `No funcionó: ${err.message} No se guardó nada; podés corregir y probar de nuevo.`; btn.disabled = false; }
    },
  },
    h('ol.guia',
      h('li', h('p', 'Abrí GitHub: el permiso ya viene armado.'), h('a.boton.chico', { href: enlacePermiso(), target: '_blank', rel: 'noopener noreferrer' }, 'Abrir GitHub ↗')),
      h('li', h('p', 'En "Repository access" elegí "Only select repositories" y marcá ', h('code', sugerido.split('/')[1] || 'el repositorio del tablero'), '. No cambies nada más.')),
      h('li', h('p', 'Bajá hasta el final, tocá "Generate token" y copiá el texto que empieza con ', h('code', 'github_pat_'), '.')),
      h('li', h('p', 'Pegalo acá:'), fToken, sugerido ? null : campo('Repositorio', fRepo))),
    estado, h('div.acciones', btn),
    h('p.nota', 'Queda guardado cifrado y solo en este dispositivo. Solo sirve para ese repositorio y vence al año; cuando venza, el tablero te avisa.'));
}

function sincronizar(ctx) {
  const cuerpo = h('div.formulario');
  const d = dialogo('Sincronizar', cuerpo, { ancho: '32rem' });
  const pintarD = (mensaje) => {
    const s = ctx.sync, p = ctx.permiso;
    poner(cuerpo,
      h('p.linea-sync.' + s.clase, { dataset: { sync: '1' } }, s.texto),
      mensaje ? h('p.nota', { role: 'status' }, mensaje) : null,
      p ? [
        h('p', `Cada cambio se sube solo, cifrado, a ${p.repo}. En tus otros dispositivos aparece al abrir el tablero.`),
        h('div.acciones.izq',
          boton('Sincronizar ahora', async ev => {
            ev.target.disabled = true;
            try { const r = await ctx.sincronizarAhora(); pintarD(r ? `Listo. Subí ${r.enviados} ${r.enviados === 1 ? 'cambio' : 'cambios'} y recibí ${r.recibidos}.` : 'Ya había una sincronización en curso.'); }
            catch (err) { pintarD(err.codigo === 'token' || err.codigo === 'permiso' ? 'Hay que renovar el permiso: quitalo y activalo de nuevo.' : 'Tus cambios siguen guardados acá. Probá de nuevo en un rato.'); }
          }, 'primario'),
          boton('Quitar el permiso de este dispositivo', async () => { await ctx.borrarPermiso(); pintarD('Permiso quitado. Este dispositivo ya no sube cambios.'); }, 'fantasma')),
      ] : [
        h('p', 'Lo que registrás queda guardado en este dispositivo. Para verlo también en el celular o en otra computadora, este dispositivo necesita permiso para guardar en GitHub. Se hace una sola vez y lleva dos minutos.'),
        guiaPermiso(ctx, () => pintarD('Listo: la sincronización quedó activada. Desde ahora cada cambio se sube solo.')),
        h('details.otra-forma', h('summary', 'Otra forma: bajar una copia cifrada'),
          h('p.nota', 'Descarga cartera.enc.json con todos tus cambios, ya cifrado. Sirve como copia de seguridad; para que otros dispositivos lo vean hay que reemplazar a mano el archivo de la carpeta data del repositorio.'),
          boton('Descargar copia cifrada', async () => descargar('cartera.enc.json', JSON.stringify(await ctx.cifrarDatos(ctx.completo()))), 'chico')),
      ]);
  };
  pintarD();
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
      poner(salida, h('p.nota', 'Leyendo…'));
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
        poner(salida, 
          h('p', `${lotes.length} lotes de ${Object.keys(despues).length} activos. ${cambios.length ? `Cambian ${cambios.length}:` : 'Las cantidades coinciden con lo que ya había.'}`),
          cambios.length ? h('div.tabla-caja', h('table.tabla.compacta', h('thead', h('tr', h('th', 'Activo'), h('th.num', 'Antes'), h('th.num', 'Después'), h('th.num', 'Diferencia'))),
            h('tbody', cambios.map(t => h('tr', h('td', h('strong', t), !(t in antes) ? ' (nuevo)' : !(t in despues) ? ' (ya no está)' : ''), h('td.num', fmt.cant(antes[t] || 0)), h('td.num', fmt.cant(despues[t] || 0)), h('td.num', fmt.signo((despues[t] || 0) - (antes[t] || 0), 2))))))) : null,
          errores.length ? aviso(`Se saltearon ${errores.length} filas: ${errores.slice(0, 3).join('; ')}${errores.length > 3 ? '…' : ''}`, 'alerta') : null,
          h('p.nota', 'Al confirmar se reemplazan todos los lotes y las cantidades. La caja no cambia.'),
          h('div.acciones', boton('Cancelar', () => d.close(), 'fantasma'), boton('Confirmar y reemplazar', async () => {
            await ctx.registrar({ tipo: 'importar_lotes', fecha: e.hoy, lotes }, { tipo: 'decision', fecha: e.hoy, texto: `Importado el Excel de Balanz: ${lotes.length} lotes, ${cambios.length} activos con cambios` });
            d.close();
          }, 'primario')));
      } catch (err) { poner(salida, aviso(err.message, 'mal')); }
    },
  });
  const d = dialogo('Importar el Excel de Balanz', h('div.formulario',
    h('ol.pasos-ayuda', h('li', 'En Balanz web: Reportes → Resultados por lotes.'), h('li', 'Descargalo en Excel.'), h('li', 'Elegilo acá abajo. Vas a ver las diferencias antes de confirmar.')),
    campo('Archivo "resultados por lotes"', archivo), salida), { ancho: '36rem' });
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
  const e = ctx.estado, p = e.datos.perfil;
  const fDia = entrada({ value: String(e.datos.config.dia_cobro), inputmode: 'numeric' });
  const fIngreso = entrada({ value: fmt.num(p.ingreso_mensual_usd) }), fGasto = entrada({ value: fmt.num(p.gasto_habitual_mensual_usd) });
  const temaActual = document.documentElement.dataset.tema || '';
  const fTema = h('select', { onchange: () => ctx.aplicarTema(fTema.value || null) }, [['', 'Según el dispositivo'], ['claro', 'Claro'], ['oscuro', 'Oscuro']].map(([v, t]) => h('option', { value: v, selected: v === temaActual }, t)));
  const d = dialogo('Configuración', h('div.formulario',
    h('form.bloque', {
      onsubmit: async ev => {
        ev.preventDefault();
        const n = Math.round(aNumero(fDia.value)), ing = aNumero(fIngreso.value), gas = aNumero(fGasto.value);
        if (!(n >= 1 && n <= 31) || !(ing > 0) || !(gas >= 0)) return;
        const ev2 = [];
        if (n !== e.datos.config.dia_cobro) ev2.push({ tipo: 'config', cambios: { dia_cobro: n }, fecha: e.hoy });
        if (ing !== p.ingreso_mensual_usd || gas !== p.gasto_habitual_mensual_usd) ev2.push({ tipo: 'perfil', cambios: { ingreso_mensual_usd: ing, gasto_habitual_mensual_usd: gas }, fecha: e.hoy });
        if (ev2.length) await ctx.registrar(...ev2);
        d.close();
      },
    },
      h('h3', 'Tu mes'),
      h('div.fila-campos', campo('Ingreso mensual (USD)', fIngreso), campo('Gasto habitual (USD)', fGasto), campo('Día de cobro', fDia)),
      h('small', 'El ingreso y el gasto son la referencia para calcular cuánto invertir; desde el día de cobro aparece el paso "Aportá".'),
      h('div.acciones.izq', h('button.boton', { type: 'submit' }, 'Guardar'))),
    h('div.bloque', h('h3', 'Apariencia'), fTema)), { ancho: '32rem' });
  return d;
}

// ---------- Seguridad ----------
function seguridad(ctx) {
  const min = bloqueo.minutos();
  const fMin = h('select', { onchange: () => bloqueo.fijarMinutos(Number(fMin.value)) }, [[5, '5 minutos'], [15, '15 minutos'], [60, '1 hora'], [0, 'Nunca']].map(([v, t]) => h('option', { value: v, selected: v === min }, t)));
  const fClave = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'Clave nueva: 5 o 6 palabras sin relación' });
  const fRepite = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'Escribila de nuevo' });
  const barra = h('div.fuerza', h('span')), detalle = h('p.nota'), estado = h('p.nota', { role: 'status' });
  const medir = () => { const f = fortaleza(fClave.value); barra.dataset.nivel = f.nivel; detalle.textContent = fClave.value ? `${f.texto}.${f.falta ? ' ' + f.falta : ''}` : ''; return f; };
  fClave.addEventListener('input', medir);
  const n = ctx.pendientes;
  const d = dialogo('Seguridad', h('div.formulario',
    h('div.bloque', h('h3', 'Bloqueo'),
      campo('Bloquear si no se usa durante', fMin, 'Al bloquearse hay que escribir la clave otra vez, aunque el dispositivo la recuerde.'),
      h('div.acciones.izq', boton('Bloquear ahora', () => { d.close(); ctx.bloquear(); }))),
    h('form.bloque', {
      onsubmit: async ev => {
        ev.preventDefault();
        const f = medir();
        if (!f.acepta) { estado.textContent = f.falta || 'La clave es demasiado fácil de adivinar.'; return; }
        if (fClave.value !== fRepite.value) { estado.textContent = 'Las dos veces no coinciden.'; return; }
        estado.textContent = 'Cifrando todo de nuevo y subiendo…';
        try { await ctx.cambiarClave(fClave.value); fClave.value = fRepite.value = ''; medir(); estado.textContent = 'Clave cambiada. En tus otros dispositivos te la va a pedir la próxima vez.'; }
        catch (err) { estado.textContent = `${err.message} La clave anterior sigue vigente.`; }
      },
    },
      h('h3', 'Cambiar la clave'),
      h('small', 'De esta frase depende todo: el archivo cifrado es público y cualquiera puede probar claves contra él. Anotala en un lugar seguro; si la perdés, los datos no se pueden recuperar.'),
      fClave, barra, detalle, fRepite,
      h('div.acciones.izq', h('button.boton', { type: 'submit' }, 'Cambiar la clave'), boton('Proponeme una', () => { fClave.value = generarFrase(); fRepite.value = ''; medir(); fRepite.focus(); }, 'fantasma')),
      ctx.permiso ? null : h('small', 'Para cambiarla primero hay que activar la sincronización (⋯ → Sincronizar).'), estado),
    h('div.bloque', h('h3', 'Este dispositivo'),
      h('small', `Borra de acá la clave recordada, el permiso de GitHub y los cambios guardados localmente.${n ? ` Ojo: hay ${n} ${n === 1 ? 'cambio' : 'cambios'} sin sincronizar que se perderían.` : ''}`),
      h('div.acciones.izq', boton('Olvidar este dispositivo', () => { if (confirm(n ? `Se van a perder ${n} cambios sin sincronizar. ¿Borrar todo de este dispositivo igual?` : '¿Borrar de este dispositivo la clave, el permiso y los datos locales?')) ctx.olvidarDispositivo(); })))), { ancho: '32rem' });
  return d;
}

// ---------- Fuentes y fechas ----------
function fuentes(ctx) {
  const e = ctx.estado, m = e.mercado || {}, d = e.datos;
  const cuando = iso => !iso ? '—' : iso.length > 10 ? `${fmt.fecha(iso.slice(0, 10))} · ${fmt.hace(iso)}` : fmt.fecha(iso);
  const ultimoAporte = d.cashflows_externos_usd[d.cashflows_externos_usd.length - 1];
  const filas = [
    ['Dólar MEP y CCL', 'dolarapi.com', m.fx?.fecha || m.fx?.actualizado, m.fx?.stale],
    ['CEDEARs', 'data912.com', m.cedears?.actualizado, m.cedears?.stale],
    ['Acciones argentinas', 'data912.com', m.acciones?.actualizado, m.acciones?.stale],
    ['Obligaciones negociables', 'data912.com', m.ons?.actualizado, m.ons?.stale],
    ['Cuotapartes de fondos', 'argentinadatos.com (datos de CAFCI)', m.fci?.fecha, m.fci?.stale],
    ['ETF en dólares e histórico', 'Yahoo Finance (vía yfinance)', m.usd?.actualizado, m.usd?.stale],
    ['Dólar MEP promedio por mes', 'argentinadatos.com', m.mep_mensual?.actualizado, m.mep_mensual?.stale],
    ['Compras de directivos', 'OpenInsider (formularios 4 de la SEC)', e.insiders?.actualizado, e.insiders?.stale],
    ['Cupones y amortización de la ON', 'Suplemento de prospecto del emisor', null, false, 'fijo'],
    ['Cantidades, lotes y caja', `Resumen de ${d.meta.broker || 'tu broker'}`, e.fecha_resumen],
    ['Aportes', 'Cargados a mano', ultimoAporte?.fecha],
    ['Cartera modelo de referencia', 'Allaria (cargada a mano)', d.cartera_modelo_allaria?.fecha],
  ];
  return dialogo('De dónde sale cada dato', h('div.formulario',
    !e.mercado ? aviso('No se pudieron cargar los precios en vivo: se están usando los del último resumen.', 'alerta') : null,
    h('div.tabla-caja', h('table.tabla.compacta', h('thead', h('tr', h('th', 'Dato'), h('th', 'Fuente'), h('th', 'Fecha del dato'))),
      h('tbody', filas.map(([dato, fuente, fecha, viejo, fijo]) => h('tr', h('td', dato), h('td', fuente), h('td', fijo || cuando(fecha), viejo ? chip('sin actualizar', 'alerta') : null)))))),
    h('p.nota', 'Los precios se actualizan solos tres veces por día hábil (11:30, 14:30 y 17:30). Si una fuente falla, se conserva el último dato y se marca "sin actualizar".')), { ancho: '40rem' });
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
  sincronizar: ['Sincronizar', 'Ver tus cambios en otros dispositivos', sincronizar],
  importar: ['Importar el Excel de Balanz', 'Actualiza lotes y cantidades', importarExcel],
  movimiento: ['Registrar un movimiento', 'Dividendo, cupón, venta o un aporte viejo', registrarMovimiento],
  decisiones: ['Registro de decisiones', 'Qué hiciste y por qué', decisiones],
  fuentes: ['Fuentes y fechas', 'De dónde sale cada dato y de cuándo es', fuentes],
  configuracion: ['Configuración', 'Ingreso, día de cobro, apariencia', configuracion],
  seguridad: ['Seguridad', 'Bloqueo, clave y este dispositivo', seguridad],
  respaldo: ['Respaldo', 'Exportar o importar los datos', respaldo],
};

export function abrirMenu(ctx, seccion, arg) {
  if (seccion && SECCIONES[seccion]) return SECCIONES[seccion][2](ctx, arg);
  const s = ctx.sync;
  const d = dialogo('Más', h('ul.menu', Object.entries(SECCIONES).map(([k, [titulo, sub, fn]]) => h('li',
    h('button', { type: 'button', onclick: () => { d.close(); fn(ctx); } }, h('span.menu-titulo', titulo),
      k === 'sincronizar' ? h('span.linea-sync.' + s.clase, { dataset: { sync: '1' } }, s.texto) : h('span.menu-sub', sub))))), { ancho: '26rem' });
  return d;
}
