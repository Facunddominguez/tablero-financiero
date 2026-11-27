// Menú "⋯": sincronizar, importar el Excel de Balanz, movimientos, decisiones, fuentes, configuración, seguridad y respaldo.
import { h, poner, fmt, aNumero } from '../util.js';
import { fortaleza, generarFrase, bloqueo } from '../seguridad.js';
import { enlacePermiso, enlacePermisoCron, LISTA_PERMISOS, urlDisparo, cuerpoDisparo, WORKFLOW_RESUMEN } from '../sync.js';
import { dialogo, campo, entrada, boton, aviso, chip, cargarScript, CDN, botonPrecios, notaPrecios } from './comun.js';
import { paraVender, textoPrima, textoVentana, avisoPrecioJusto } from '../precios.js';
import { esSobreCifrado } from '../cripto.js';
import { esRespaldoPlano } from '../estado.js';
import { nuevaPrediccion } from './diario.js';
import { supuestos, EDITABLES } from '../supuestos.js';
import { proponerUmbrales, PERCENTILES } from '../calibrar.js';
import { ajustesAporteExtra } from '../clima.js';

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
      try { const aviso = await ctx.guardarPermiso(repo, token); fToken.value = ''; alTerminar(aviso); }
      catch (err) { estado.textContent = `No funcionó: ${err.message} No se guardó nada; podés corregir y probar de nuevo.`; btn.disabled = false; }
    },
  },
    h('ol.guia',
      h('li', h('p', 'Abrí GitHub: el permiso ya viene armado.'), h('a.boton.chico', { href: enlacePermiso(), target: '_blank', rel: 'noopener noreferrer' }, 'Abrir GitHub ↗')),
      h('li', h('p', 'En "Repository access" elegí "Only select repositories" y marcá ', h('code', sugerido.split('/')[1] || 'el repositorio del tablero'), '. Los permisos ya vienen marcados ("Contents" y "Actions": Read and write); no cambies nada más.')),
      h('li', h('p', 'Bajá hasta el final, tocá "Generate token" y copiá el texto que empieza con ', h('code', 'github_pat_'), '.')),
      h('li', h('p', 'Pegalo acá:'), fToken, sugerido ? null : campo('Repositorio', fRepo))),
    estado, h('div.acciones', btn),
    h('p.nota', 'Queda guardado cifrado y solo en este dispositivo. Solo sirve para ese repositorio y vence al año; cuando venza, el tablero te avisa. "Actions" sirve para pedir precios nuevos desde el tablero.'));
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
        h('p.nota', 'Con este permiso también podés pedir precios nuevos (en Hoy, "Actualizar ahora"). Si al pedirlos dice que falta "Actions", ', h('a', { href: LISTA_PERMISOS, target: '_blank', rel: 'noopener noreferrer' }, 'editá el permiso en GitHub ↗'), ' y sumale "Actions: Read and write". No hace falta volver a pegarlo.'),
        h('div.acciones.izq',
          boton('Sincronizar ahora', async ev => {
            ev.target.disabled = true;
            try { const r = await ctx.sincronizarAhora(); pintarD(r ? `Listo. Subí ${r.enviados} ${r.enviados === 1 ? 'cambio' : 'cambios'} y recibí ${r.recibidos}.` : 'Ya había una sincronización en curso.'); }
            catch (err) { pintarD(err.codigo === 'token' || err.codigo === 'permiso' ? 'Hay que renovar el permiso: quitalo y activalo de nuevo.' : 'Tus cambios siguen guardados acá. Probá de nuevo en un rato.'); }
          }, 'primario'),
          boton('Cambiar el permiso', async () => { await ctx.borrarPermiso(); pintarD('Pegá el permiso nuevo. Mientras tanto, tus cambios quedan guardados en este dispositivo.'); }),
          boton('Quitar el permiso de este dispositivo', async () => { await ctx.borrarPermiso(); pintarD('Permiso quitado. Este dispositivo ya no sube cambios.'); }, 'fantasma')),
      ] : [
        h('p', 'Lo que registrás queda guardado en este dispositivo. Para verlo también en el celular o en otra computadora, este dispositivo necesita permiso para guardar en GitHub. Se hace una sola vez y lleva dos minutos.'),
        guiaPermiso(ctx, aviso => pintarD('Listo: la sincronización quedó activada. Desde ahora cada cambio se sube solo.' + (aviso ? ' ' + aviso : ' También podés pedir precios nuevos.'))),
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
    const l = { ticker, cantidad: aNumero(c.cantidad), fecha_compra: fechaExcel(c.fecha), precio_compra: aNumero(c.preciocompra ?? c.preciodecompra), moneda, gastos: aNumero(c.gastos) || 0, operacion: c.operacion ? String(c.operacion) : 'Excel de Balanz', mep_dia: aNumero(c.dolarmep) };
    if (!(l.cantidad > 0) || !l.fecha_compra || !(l.precio_compra >= 0) || !(l.mep_dia > 0)) errores.push(`Fila ${i + 2} (${ticker}): faltan datos`);
    else lotes.push(l);
  });
  return { lotes, errores };
}
function importarExcel(ctx) {
  const e = ctx.estado;
  const salida = h('div');
  const archivo = h('input', {
    type: 'file', accept: '.xlsx,.xls,.csv',
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
    h('ol.pasos-ayuda', h('li', 'En Balanz web, descargá el reporte de resultados por lotes (Excel o CSV).'), h('li', 'Tiene que traer las columnas Cantidad, Ticker, Fecha, Precio de compra, Moneda, Gastos y Dolar MEP.'), h('li', 'Elegilo acá abajo. Vas a ver las diferencias antes de confirmar.')),
    campo('Archivo de resultados por lotes (.xlsx o .csv)', archivo), salida), { ancho: '36rem' });
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
  const justo = h('div.nota-precios');
  const venta = h('div', justo, h('div.fila-campos', campo('Cantidad', fCant), campo('Precio $ por unidad', fPrecio)), h('div.fila-campos', campo('Gastos $', fGastos), campo('Dólar MEP', fMep)),
    h('p.nota', 'Antes de vender: la ida y vuelta no debería costar más de lo que fija la regla C2.'));
  const error = h('p.error', { role: 'alert' });
  // El precio justo de lo elegido, con la misma vara que en las compras.
  const pintarJusto = () => {
    const e = ctx.estado, p = e.posiciones.find(x => x.ticker === fTicker.value);
    const j = p ? paraVender(e, p.ticker) : null;
    poner(justo, !p ? null : j ? [
      j.revisar ? aviso(`Revisá el ratio de ${p.ticker}: los precios no cierran y no hay precio justo.`, 'alerta')
        : h('p.nota', `${textoVentana(e.feriados, e.hoy, { vender: true })} Precio justo de ${p.ticker}: ${fmt.ars(j.justo_ars)}; en pantalla ${fmt.ars(j.precio_ars)} (${textoPrima(j.prima)}). Límite sugerido para vender: ${fmt.ars(j.limite)}.`),
      j.barato ? aviso(`Hoy ${p.ticker} está ${textoPrima(j.prima)} contra su precio justo: conviene esperar antes de vender.`, 'alerta') : null,
      notaPrecios(ctx, pintarJusto),
    ] : h('p.nota', `${textoVentana(e.feriados, e.hoy, { vender: true })} ${p.tipo === 'cedear' ? avisoPrecioJusto(e) || `Sin precio justo para ${p.ticker}.` : 'El precio justo es solo para CEDEARs.'}`));
  };
  const ver = () => { const t = fTipo.value; venta.hidden = t !== 'venta'; cUsd.hidden = t === 'venta'; cTicker.hidden = t === 'aporte_historico'; if (t === 'venta') pintarJusto(); };
  fTipo.addEventListener('change', ver); fTicker.addEventListener('change', ver); ver();
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
// Aviso opcional (apagado de fábrica): usar parte de la reserva que sobra cuando el núcleo cae fuerte.
function formularioAporteExtra(ctx, cerrar) {
  const e = ctx.estado, c = ajustesAporteExtra(e);
  const fActivo = h('input', { type: 'checkbox', checked: c.activo });
  const fCaida = entrada({ value: fmt.num(c.caida * 100, 0) }), fParte = entrada({ value: fmt.num(c.parte * 100, 0) });
  const error = h('p.error', { role: 'alert' });
  return h('form.bloque', {
    onsubmit: async ev => {
      ev.preventDefault();
      const caida = aNumero(fCaida.value) / 100, parte = aNumero(fParte.value) / 100;
      if (!(caida > 0 && caida < 1) || !(parte > 0 && parte <= 1)) { error.textContent = 'La caída va de 1 a 99% y la parte, de 1 a 100%.'; return; }
      const cambios = { activo: fActivo.checked, caida, parte };
      if (cambios.activo !== c.activo || caida !== c.caida || parte !== c.parte) await ctx.registrar({ tipo: 'aporte_extra', fecha: e.hoy, cambios },
        { tipo: 'decision', fecha: e.hoy, texto: cambios.activo ? `Aviso de aporte extra activado: caída de ${fmt.pct(caida, 0)}, ${fmt.pct(parte, 0)} del excedente` : 'Aviso de aporte extra apagado' });
      cerrar();
    },
  },
    h('h3', 'Aporte extra en una caída'),
    h('label.casilla', fActivo, h('span', 'Avisarme en "Para saber"'), h('small', 'Si la reserva tiene excedente (regla R1) y el núcleo cae desde su máximo. Nunca sugiere vender ni frenar aportes.')),
    h('div.fila-campos', campo('Caída desde el máximo (%)', fCaida), campo('Parte del excedente (%)', fParte)),
    error, h('div.acciones.izq', h('button.boton', { type: 'submit' }, 'Guardar')));
}

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
    formularioAporteExtra(ctx, () => d.close()),
    h('div.bloque', h('h3', 'Apariencia'), fTema)), { ancho: '32rem' });
  return d;
}

// ---------- Supuestos ----------
// Los números que no salen de ningún dato (retornos esperados, umbrales): se cambian acá y se guardan en tus datos.
function editarSupuestos(ctx) {
  const e = ctx.estado, s = supuestos(e);
  const mostrar = (v, f) => f === 'pct' ? fmt.num(v * 100, Math.abs(v * 100 - Math.round(v * 100)) < 1e-9 ? 0 : 2) : fmt.num(v, Number.isInteger(v) ? 0 : 2);
  const filas = [];
  const bloques = EDITABLES.filter(([g]) => s[g]).map(([g, titulo, campos]) => h('div.bloque', h('h3', titulo),
    h('div.fila-campos', campos.map(([k, etq, f]) => {
      const actual = k.split('.').reduce((o, p) => o?.[p], s[g]);
      const input = entrada({ value: actual == null ? '' : mostrar(actual, f) });
      filas.push({ g, k, f, input, actual });
      return campo(etq, input);
    })),
    s[g].fuente ? h('small', `${s[g].fuente} (${fmt.fecha(s[g].fecha)})`) : null));
  const error = h('p.error', { role: 'alert' });
  // Completa los campos con la propuesta; no guarda nada hasta que toques "Guardar".
  const usar = lista => {
    for (const r of lista) r.niveles.forEach((nivel, i) => {
      const x = filas.find(x => x.g === r.grupo && x.k === `${r.clave}.${nivel}`);
      if (x) { x.input.value = mostrar(r.propuesto[i], x.f); x.input.classList.add('propuesto'); }
    });
  };
  const d = dialogo('Supuestos', h('form.formulario', {
    onsubmit: async ev => {
      ev.preventDefault();
      const cambios = {};
      for (const x of filas) {
        const n = aNumero(x.input.value);
        if (!Number.isFinite(n)) { error.textContent = 'Hay un campo vacío o que no es un número.'; return; }
        const v = x.f === 'pct' ? n / 100 : n;
        if (x.actual != null && Math.abs(v - x.actual) < 1e-12) continue;
        const ruta = x.k.split('.');
        let o = cambios[x.g] = cambios[x.g] || {};
        for (const p of ruta.slice(0, -1)) o = o[p] = o[p] || {};
        o[ruta.at(-1)] = v;
        // lo editado queda marcado como tuyo, con la fecha de hoy
        Object.assign(cambios[x.g], { fuente: `Editado por vos. Original: ${(e.supuestos?.[x.g]?.fuente) || 'sin fuente'}`, fecha: e.hoy });
      }
      if (Object.keys(cambios).length) await ctx.registrar({ tipo: 'supuestos', fecha: e.hoy, cambios }, { tipo: 'decision', fecha: e.hoy, texto: `Cambiados los supuestos: ${Object.keys(cambios).join(', ')}` });
      d.close();
    },
  },
    h('p.nota', 'Son supuestos, no pronósticos: cambian las proyecciones y los colores del semáforo y del clima. Las reglas no cambian.'),
    panelUmbrales(e, usar),
    bloques, error,
    h('div.acciones', e.datos.supuestos && Object.keys(e.datos.supuestos).length ? boton('Volver a los originales', async () => {
      await ctx.registrar({ tipo: 'supuestos', fecha: e.hoy, restaurar: true }, { tipo: 'decision', fecha: e.hoy, texto: 'Supuestos vueltos a los originales' });
      d.close();
    }, 'fantasma') : null, boton('Cancelar', () => d.close(), 'fantasma'), h('button.boton.primario', { type: 'submit' }, 'Guardar'))), { ancho: '36rem' });
  return d;
}

// Propuesta de umbrales con la historia guardada: dos percentiles editables y qué daría cada uno.
function panelUmbrales(e, usar) {
  const fAtencion = entrada({ inputmode: 'numeric', value: fmt.num(PERCENTILES.atencion * 100) }), fAlarma = entrada({ inputmode: 'numeric', value: fmt.num(PERCENTILES.alarma * 100) });
  const salida = h('div.propuesta');
  const calcular = () => {
    const a = aNumero(fAtencion.value) / 100, b = aNumero(fAlarma.value) / 100;
    if (!(a >= 0.5 && a < b && b < 1)) { poner(salida, h('p.error', 'El primer percentil va de 50 a 98 y el segundo tiene que ser mayor.')); return; }
    const lista = proponerUmbrales(e, { atencion: a, alarma: b }), con = lista.filter(r => r.propuesto);
    const par = (r, v) => v.map((x, i) => `${r.niveles[i]} ${x == null ? '—' : r.formato(x)}`).join(' · ');
    poner(salida,
      h('div.tabla-caja', h('table.tabla.compacta',
        h('thead', h('tr', h('th', 'Indicador'), h('th', 'Hoy'), h('th', 'Propuesta'))),
        h('tbody', lista.map(r => h('tr', h('td', h('strong', r.nombre), h('small.desglose', r.datos && r.desde ? `${fmt.num(r.datos)} datos desde el ${fmt.fecha(r.desde)}` : '')),
          h('td', par(r, r.actual)), h('td', r.propuesto ? par(r, r.propuesto) : r.motivo)))))),
      con.length ? h('div.acciones.izq', boton('Completar los campos con la propuesta', ev => { usar(con); ev.target.textContent = 'Completados: revisalos y tocá Guardar'; }, 'chico')) : null);
  };
  return h('details.otra-forma', h('summary', 'Proponer umbrales del semáforo y del clima con la historia'),
    h('p.nota', 'El primer nivel queda en el valor que la historia superó (del lado malo) pocas veces; el segundo, en uno todavía más raro. 75 y 90 quiere decir una de cada cuatro y una de cada diez veces.'),
    h('div.fila-campos', campo('Percentil del primer nivel', fAtencion), campo('Percentil del segundo', fAlarma)),
    h('div.acciones.izq', boton('Calcular', calcular, 'chico')), salida);
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
// Riesgo país, tasas, fondos, indicadores de EE.UU., historia larga y mercados de predicción.
function filasContexto(e) {
  const a = e.argentina || {}, c = e.clima?.series || {}, l = e.largo_plazo, el = a.elecciones || {};
  const fred = Object.values(c), poly = el.polymarket;
  return [
    ['Riesgo país', 'argentinadatos.com', a.riesgo_pais?.ultimo?.fecha, a.riesgo_pais?.stale],
    ['Tasa de plazo fijo (30 días)', 'argentinadatos.com (datos del BCRA)', a.plazo_fijo?.ultimo?.fecha, a.plazo_fijo?.stale],
    ['Historia de cuotapartes de fondos', 'argentinadatos.com (datos de CAFCI)', a.fondos?.fechas?.at(-1), a.fondos?.stale],
    ['Bonos de alto rendimiento, curva, VIX y condiciones financieras', 'FRED, Reserva Federal de St. Louis', fred.map(s => s.ultimo?.fecha).filter(Boolean).sort()[0], fred.some(s => s.stale)],
    ['ETF: cierres mensuales desde 2005', 'Yahoo Finance (vía yfinance)', l?.actualizado, l?.stale],
    ['Elección 2027: Kalshi', 'API pública de Kalshi (solo lectura)', el.kalshi?.actualizado, el.kalshi?.stale],
    ['Elección 2027: Polymarket', poly?.desactivado ? 'Apagado: está bloqueado en Argentina por orden judicial' : 'API gamma de Polymarket (solo lectura, desde GitHub)', poly?.actualizado, poly?.stale, poly?.desactivado ? '—' : null],
  ];
}
// Con qué se clasificó en la última corrida.
function quienClasifica(e) {
  const c = e.ia_uso?.corridas?.at(-1);
  const modelos = Object.entries(c?.modelos || {}).filter(([, m]) => m.ok).map(([n]) => n);
  return modelos.length ? modelos.join(', ') : 'Filtro por reglas (ítems del 8-K y palabras clave)';
}
// Noticias de lo que seguís: SEC, Google News y por qué no hay hechos relevantes de BYMA.
function filasSenales(e) {
  const f = e.noticias?.fuentes || {};
  return [
    ['Presentaciones a la SEC de lo que seguís', f.sec?.aviso || 'SEC EDGAR (data.sec.gov)', f.sec?.actualizado, f.sec?.stale],
    ['Noticias de lo que seguís', 'Google News (RSS), en español e inglés', f.google?.actualizado, f.google?.stale],
    ['Clasificación de las noticias', quienClasifica(e), e.ia_uso?.corridas?.at(-1)?.fecha, !!e.ia_uso?.corridas?.at(-1)?.sin_ia],
    ['Formularios 4 de directivos', e.directivos?.aviso || 'SEC EDGAR; precio y tamaño de Yahoo Finance', e.directivos?.actualizado, e.directivos?.stale],
    ['Resumen del sábado', e.resumen ? `Redactado por ${e.resumen.por}` : 'Corre los sábados a las 12:00', e.resumen?.generado, false],
    ['Hechos relevantes de BYMA y CNV', f.byma?.nota || 'Sin acceso público estable: se usan los 6-K de la SEC', null, false, 'sin fuente'],
  ];
}

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
    ['Precios de EE.UU. del momento', 'data912.com y Yahoo Finance', m.implicito?.usa?.actualizado, m.implicito?.usa?.stale],
    ['Dólar implícito de cada CEDEAR', m.implicito?.ccl?.fuente === 'calculado' ? 'Calculado con precios de data912 y ratios de BYMA' : 'data912.com', m.implicito?.ccl?.actualizado, m.implicito?.ccl?.stale],
    ['Dólar MEP y contado con liqui de cada día', 'argentinadatos.com', e.historico?.canje?.actualizado, e.historico?.canje?.stale],
    ['Ratios de CEDEARs', 'BYMA, lista oficial', e.ratios_fecha],
    ['Control de cambios de ratios', m.ratios_byma?.lista_fecha ? `Lista de BYMA del ${fmt.fecha(m.ratios_byma.lista_fecha)}` : 'Lista de BYMA', m.ratios_byma?.actualizado, m.ratios_byma?.stale],
    ['Feriados de EE.UU. y horario de BYMA', 'NYSE y BYMA', e.feriados?.consultado],
    ['Feriados argentinos', 'argentinadatos.com y calendario de BYMA', e.feriados?.argentina?.actualizado, e.feriados?.argentina?.stale],
    ['Dólar MEP promedio por mes', 'argentinadatos.com', m.mep_mensual?.actualizado, m.mep_mensual?.stale],
    ['Inflación de EE.UU. (IPC mensual)', 'FRED, Reserva Federal de St. Louis (serie CPIAUCSL)', m.cpi_usa?.actualizado, m.cpi_usa?.stale],
    ['Compras de directivos', 'OpenInsider (formularios 4 de la SEC)', e.insiders?.actualizado, e.insiders?.stale],
    ['Balances, dividendos y opciones de lo que seguís', 'Yahoo Finance (vía yfinance)', e.agenda?.actualizado, e.agenda?.stale],
    ['Fed, inflación, MSCI y elecciones', 'data/eventos.json, con la fuente de cada uno', e.eventos_fijos?.consultado],
    ...filasContexto(e),
    ...filasSenales(e),
    ['Cupones y amortización de la ON', 'Suplemento de prospecto del emisor', null, false, 'fijo'],
    ['Cantidades, lotes y caja', `Resumen de ${d.meta.broker || 'tu broker'}`, e.fecha_resumen],
    ['Aportes', 'Cargados a mano', ultimoAporte?.fecha],
  ];
  const dlg = dialogo('De dónde sale cada dato', h('div.formulario',
    !e.mercado ? aviso('No se pudieron cargar los precios en vivo: se están usando los del último resumen.', 'alerta') : null,
    ctx.errorSeguimiento ? aviso(`No se pudo publicar la lista de qué seguir: ${ctx.errorSeguimiento}`, 'alerta') : null,
    h('div.tabla-caja', h('table.tabla.compacta', h('thead', h('tr', h('th', 'Dato'), h('th', 'Fuente'), h('th', 'Fecha del dato'))),
      h('tbody', filas.map(([dato, fuente, fecha, viejo, fijo]) => h('tr', h('td', dato), h('td', fuente), h('td', fijo || cuando(fecha), viejo ? chip('sin actualizar', 'alerta') : null)))))),
    h('p.nota', 'Los precios se actualizan solos tres veces por día hábil (alrededor de las 11:40, 14:40 y 17:40 de Argentina). Si una fuente falla, se conserva el último dato y se marca "sin actualizar".'),
    h('div.bloque', h('h3', 'Actualizar ahora'),
      ctx.permiso
        ? h('div.fuentes-accion', botonPrecios(ctx, () => { if (dlg.open) { dlg.close(); fuentes(ctx); } }), h('small', 'Lo pide a GitHub y en alrededor de un minuto aparecen los precios de este momento.'))
        : h('small', 'Para pedir precios desde acá, primero activá la sincronización (⋯ → Sincronizar).')),
    guiaCron(ctx)), { ancho: '40rem' });
  return dlg;
}

// Guía para que un servicio externo lance la actualización a horario (GitHub atrasa o saltea sus propias corridas programadas).
const copiable = texto => h('div.copiable', h('code', texto), boton('Copiar', ev => {
  navigator.clipboard?.writeText(texto).then(() => { ev.target.textContent = 'Copiado'; setTimeout(() => { ev.target.textContent = 'Copiar'; }, 1500); }).catch(() => {});
}, 'chico'));
function guiaCron(ctx) {
  const repo = ctx.repoSugerido || 'usuario/repositorio';
  return h('details.otra-forma', h('summary', 'Que se actualicen solos a horario, sin falta'),
    h('p.nota', 'GitHub atrasa o saltea a veces sus corridas programadas. Un servicio gratuito de tareas programadas (cron-job.org) puede lanzarlas a horario. Si llegan las dos, la segunda se saltea sola. Se configura una sola vez:'),
    h('ol.guia',
      h('li', h('p', 'Creá un permiso solo para esto (únicamente puede lanzar la actualización; no ve ni toca tus datos). Elegí "Only select repositories" → ', h('code', repo.split('/')[1]), ', "Generate token" y copiá el texto.'),
        h('a.boton.chico', { href: enlacePermisoCron(), target: '_blank', rel: 'noopener noreferrer' }, 'Abrir GitHub ↗')),
      h('li', h('p', 'Entrá a ', h('a', { href: 'https://console.cron-job.org/jobs/create', target: '_blank', rel: 'noopener noreferrer' }, 'cron-job.org ↗'), ' (cuenta gratis) → "Create cronjob". En URL pegá:'), copiable(urlDisparo(repo))),
      h('li', h('p', 'Horario: "Custom". Días: lunes a viernes. Horas: 11, 14 y 17. Minuto: 40 (después de que abre Wall Street, para tener precio justo). Zona horaria: ', h('code', 'America/Argentina/Buenos_Aires'), '.')),
      h('li', h('p', 'En "Advanced": método ', h('code', 'POST'), ' y estos encabezados (en Authorization va el permiso del paso 1):'),
        copiable('Accept: application/vnd.github+json'), copiable('X-GitHub-Api-Version: 2022-11-28'), copiable('Content-Type: application/json'), h('p', h('code', 'Authorization: Bearer github_pat_…'))),
      h('li', h('p', 'Cuerpo (Request body):'), copiable(cuerpoDisparo('cron'))),
      h('li', h('p', 'Guardá y tocá "Test run": tiene que responder ', h('code', '204'), '. En un minuto esta tabla muestra la hora nueva.'))),
    h('p.nota', 'Para el resumen del sábado, creá una segunda tarea igual (mismo permiso y encabezados), los sábados a las 12:00, con esta URL y el mismo cuerpo:'),
    copiable(urlDisparo(repo, WORKFLOW_RESUMEN)),
    h('p.nota', 'El permiso queda guardado en cron-job.org. Si alguien lo obtuviera, lo único que podría hacer es lanzar estas tareas del tablero. Vence al año: cuando falle, generá otro y reemplazalo ahí.'));
}

// ---------- Respaldo (cifrado por defecto; en claro solo a pedido) ----------

function respaldo(ctx) {
  const estado = h('p.nota', { role: 'status' });
  const frase = h('input', { type: 'password', autocomplete: 'off', placeholder: 'La clave con la que se cifró ese respaldo' });
  const campoFrase = campo('Clave del respaldo', frase, 'Ese respaldo se cifró con otra clave (una anterior). Escribila y volvé a elegir el archivo.');
  campoFrase.hidden = true;
  const archivo = h('input', {
    type: 'file', accept: '.json,application/json',
    onchange: async () => {
      estado.textContent = '';
      try {
        let obj = JSON.parse(await archivo.files[0].text());
        if (esSobreCifrado(obj)) {
          const abierto = await ctx.abrirRespaldo(obj, frase.value);
          if (abierto === null) { campoFrase.hidden = false; estado.textContent = frase.value ? 'Esa clave no abre el respaldo.' : 'Falta la clave de ese respaldo.'; archivo.value = ''; return; }
          obj = abierto;
        }
        if (!esRespaldoPlano(obj)) throw new Error('Ese archivo no parece un respaldo del tablero.');
        if (!confirm('Esto reemplaza todos los datos de este dispositivo por los del respaldo. ¿Seguimos?')) return;
        await ctx.importarPlano(obj); d.close();
      } catch (err) { estado.textContent = err.message; archivo.value = ''; }
    },
  });
  const d = dialogo('Respaldo', h('div.formulario',
    h('div.bloque', h('h3', 'Exportar'),
      h('p.nota', 'Baja todo (datos, movimientos y valores diarios) cifrado con tu clave: sin la clave no se puede leer. Se vuelve a abrir desde acá o con tools/cripto.py.'),
      h('div.acciones.izq', boton('Descargar respaldo cifrado', async () => descargar(`tablero-respaldo-${ctx.estado.hoy}.enc.json`, JSON.stringify(await ctx.cifrarDatos(ctx.completo()))))),
      h('details.otra-forma', h('summary', 'Bajar sin cifrar'),
        aviso('El archivo queda legible: cualquiera que lo abra ve tus datos. Sirve para revisarlo o editarlo a mano.', 'alerta'),
        h('div.acciones.izq', boton('Descargar respaldo sin cifrar', () => descargar(`tablero-respaldo-${ctx.estado.hoy}.json`, JSON.stringify(ctx.completo(), null, 1)), 'chico')))),
    h('div.bloque', h('h3', 'Importar'), h('p.nota', 'Acepta el respaldo cifrado o el que está sin cifrar.'), campoFrase, campo('Archivo de respaldo', archivo), estado)), { ancho: '30rem' });
  return d;
}

const SECCIONES = {
  sincronizar: ['Sincronizar', 'Ver tus cambios en otros dispositivos', sincronizar],
  importar: ['Importar el Excel de Balanz', 'Actualiza lotes y cantidades', importarExcel],
  movimiento: ['Registrar un movimiento', 'Dividendo, cupón, venta o un aporte viejo', registrarMovimiento],
  decisiones: ['Registro de decisiones', 'Qué hiciste y por qué', decisiones],
  prediccion: ['Anotar una predicción', 'Qué esperás, con qué probabilidad y hasta cuándo', nuevaPrediccion],
  fuentes: ['Fuentes y fechas', 'De dónde sale cada dato y de cuándo es', fuentes],
  configuracion: ['Configuración', 'Ingreso, día de cobro, apariencia', configuracion],
  supuestos: ['Supuestos', 'Retornos esperados y umbrales, con su fuente', editarSupuestos],
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
