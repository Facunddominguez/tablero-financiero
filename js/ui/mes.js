// "Cuánto invierto": cierre del mes en seis pasos cortos. El extracto se lee acá, en el navegador, y no sale del dispositivo.
import { h, poner, fmt, fechas, aNumero, suma } from '../util.js';
import { CATEGORIAS, NO_GASTO, categorizar, patronDe, desdeTabla, detectarColumnas, celdasDeCSV, desdeTexto, mesDe, resumenGastos } from '../extracto.js';
import { recomendarAporte, repartirAporte } from '../motor.js';
import { boton, campo, entrada, aviso, cargarScript, bajarVerificado, CDN } from './comun.js';

const PASOS = ['Extracto', 'Gastos', 'Ingreso', 'Dólar', 'Cuánto', 'En qué'];
let B = null; // borrador del cierre en curso (solo en memoria)

const mesAnterior = hoy => fechas.mes(fechas.sumarMeses(fechas.diaDelMes(hoy, 1), -1));
const nuevo = e => ({ paso: 1, mes: mesAnterior(e.hoy), movs: [], origen: '', avisos: [], tabla: null, columnas: null, manualArs: null, ingreso: e.datos.perfil.ingreso_mensual_usd, guardarIngreso: false, tc: null, externos: {}, elegido: null, reglas: [], nota: '' });
const reglasDe = e => [...(e.datos.reglas_gasto || []), ...B.reglas];
const gastoArs = () => B.manualArs != null ? B.manualArs : resumenGastos(B.movs).total;
const mepDelMes = e => e.mercado?.mep_mensual?.meses?.[B.mes] || null;

// ---------- lectura de archivos ----------
async function textoDePdf(buf) {
  await cargarScript(CDN.pdf);
  pdfjsLib.GlobalWorkerOptions.workerSrc = await bajarVerificado(CDN.pdfWorker);
  const doc = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const lineas = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const items = (await (await doc.getPage(i)).getTextContent()).items;
    const filas = new Map();
    for (const it of items) { const y = Math.round(it.transform[5] / 3) * 3; if (!filas.has(y)) filas.set(y, []); filas.get(y).push({ x: it.transform[4], s: it.str }); }
    for (const y of [...filas.keys()].sort((a, b) => b - a)) lineas.push(filas.get(y).sort((a, b) => a.x - b.x).map(t => t.s).join(' '));
  }
  return lineas.join('\n');
}

function cargar(e, { movimientos, avisos, columnas }, origen, tabla = null) {
  const reglas = reglasDe(e);
  B.movs = movimientos.map(x => ({ ...x, c: categorizar(x, reglas) }));
  B.avisos = avisos || []; B.origen = origen; B.tabla = tabla; B.columnas = columnas || null; B.manualArs = null;
  const m = mesDe(B.movs); if (m) B.mes = m;
  B.tc = null;
}

async function leerArchivo(e, archivo) {
  const nombre = archivo.name.toLowerCase(), anio = B.mes.slice(0, 4);
  if (nombre.endsWith('.pdf')) {
    let texto;
    try { texto = await textoDePdf(await archivo.arrayBuffer()); }
    catch (err) { throw new Error(/password/i.test(err?.name + err?.message) ? 'El PDF tiene contraseña. Abrilo, guardalo sin contraseña (Imprimir → Guardar como PDF) y probá de nuevo, o pegá los movimientos como texto.' : 'No pude leer ese PDF. Probá pegando los movimientos como texto.'); }
    return cargar(e, desdeTexto(texto, anio), 'PDF');
  }
  if (/\.(xlsx|xls)$/.test(nombre)) {
    await cargarScript(CDN.xlsx);
    const wb = XLSX.read(await archivo.arrayBuffer(), { cellDates: true });
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
    return cargar(e, desdeTabla(filas, detectarColumnas(filas), anio), 'Excel', filas);
  }
  const texto = await archivo.text();
  const filas = celdasDeCSV(texto);
  if (detectarColumnas(filas)) return cargar(e, desdeTabla(filas, detectarColumnas(filas), anio), 'CSV', filas);
  return cargar(e, desdeTexto(texto, anio), 'texto', filas.some(f => f.length > 2) ? filas : null);
}

// ---------- pasos ----------
function pasoExtracto(ctx, pintar) {
  const e = ctx.estado;
  const estado = h('p.nota', { role: 'status' });
  const archivo = h('input', {
    type: 'file', accept: '.csv,.txt,.xls,.xlsx,.pdf',
    onchange: async () => {
      if (!archivo.files[0]) return;
      estado.textContent = 'Leyendo en este dispositivo…';
      try { await leerArchivo(e, archivo.files[0]); pintar(); }
      catch (err) { estado.textContent = err.message || 'No pude leer el archivo.'; }
    },
  });
  const pegado = h('textarea', { rows: 5, placeholder: 'Pegá acá los movimientos copiados del home banking o del PDF' });
  const fManual = entrada({ placeholder: 'Gasto total del mes, en pesos' });
  const r = resumenGastos(B.movs);
  const cols = B.columnas?.col, titulos = B.columnas?.titulos || [];
  const selector = (rol, etq) => h('label.campo', h('span.campo-etq', etq), h('select', {
    onchange: ev => { const v = ev.target.value; const col = { ...B.columnas.col }; if (v === '') delete col[rol]; else col[rol] = Number(v); cargar(e, desdeTabla(B.tabla, { ...B.columnas, col }, B.mes.slice(0, 4)), B.origen, B.tabla); pintar(); },
  }, h('option', { value: '' }, '—'), titulos.map((t, i) => h('option', { value: i, selected: cols[rol] === i }, t || `Columna ${i + 1}`))));

  return [
    h('p', `Cargá el extracto de ${fmt.mes(B.mes + '-01')} de tu banco: el archivo se lee acá mismo y no se sube a ningún lado.`),
    campo('Archivo del extracto (PDF, Excel o CSV)', archivo),
    estado,
    B.movs.length ? h('div.caja',
      h('p', h('strong', `${B.movs.length} movimientos`), ` de ${fmt.mes(B.mes + '-01')} (${B.origen}): gastos por ${fmt.ars(r.total)} e ingresos por ${fmt.ars(r.ingresos)}.`),
      B.avisos.map(a => aviso(a, 'alerta')),
      h('div.tabla-caja', h('table.tabla.compacta', h('tbody', B.movs.slice(0, 4).map(x => h('tr', h('td.num', fmt.fecha(x.f).slice(0, 5)), h('td', x.d), h('td.num', fmt.num(x.m, 2))))))),
      h('p.nota', 'Si los primeros renglones se ven bien, seguí. Los vas a poder revisar uno por uno.'),
      cols ? h('details.otra-forma', h('summary', 'Las columnas no coinciden'), h('div.fila-campos', selector('fecha', 'Fecha'), selector('desc', 'Concepto'), selector('importe', 'Importe'), selector('debito', 'Débito'), selector('credito', 'Crédito'), selector('saldo', 'Saldo'))) : null)
      : B.manualArs != null ? h('div.caja', h('p', `Gasto del mes cargado a mano: ${fmt.ars(B.manualArs)}.`)) : null,
    h('details.otra-forma', h('summary', 'No tengo el archivo: pego el texto'), pegado,
      boton('Leer lo pegado', () => { const res = desdeTexto(pegado.value, B.mes.slice(0, 4)); if (!res.movimientos.length) { estado.textContent = 'No encontré renglones con fecha e importe en lo que pegaste.'; return; } cargar(e, res, 'texto pegado'); pintar(); }, 'chico')),
    h('details.otra-forma', h('summary', 'Prefiero cargar solo el total'), h('div.fila-nota', fManual,
      boton('Usar', () => { const v = aNumero(fManual.value); if (v > 0) { B.movs = []; B.manualArs = v; B.origen = 'a mano'; pintar(); } }, 'chico'))),
  ];
}

function pasoGastos(ctx, pintar) {
  if (B.manualArs != null) return [h('p', `Cargaste el total a mano: ${fmt.ars(B.manualArs)}. No hay movimientos para revisar.`)];
  const r = resumenGastos(B.movs);
  const fila = x => {
    const sel = h('select', {
      'aria-label': 'Categoría', onchange: () => {
        x.c = sel.value;
        const patron = patronDe(x.d);
        let otros = 0;
        if (patron) {
          B.reglas = B.reglas.filter(y => y.patron !== patron).concat({ patron, categoria: x.c });
          for (const y of B.movs) if (y !== x && y.m < 0 && patronDe(y.d) === patron && y.c !== x.c) { y.c = x.c; otros++; }
        }
        B.nota = otros ? `Listo. También cambié ${otros} ${otros === 1 ? 'movimiento parecido' : 'movimientos parecidos'}, y lo voy a recordar para los próximos meses.` : patron ? 'Listo. Lo voy a recordar para los próximos meses.' : '';
        pintar();
      },
    }, [...CATEGORIAS, NO_GASTO].map(c => h('option', { value: c, selected: c === x.c }, c)));
    const monto = entrada({ value: fmt.num(-x.m, 2), 'aria-label': 'Importe', onchange: () => { const v = aNumero(monto.value); if (v >= 0) { x.m = -v; pintar(); } } });
    return h('li' + (x.c === NO_GASTO ? '.excluido' : ''), h('div.gasto-desc', h('span', x.d), h('small', fmt.fecha(x.f))), sel, monto);
  };
  const gastos = B.movs.filter(x => x.m < 0).sort((a, b) => a.m - b.m), ingresos = B.movs.filter(x => x.m > 0);
  return [
    h('p.total-paso', h('span', 'Gastaste'), h('strong', fmt.ars(r.total))),
    h('ul.chips', r.porCategoria.map(([c, v]) => h('li', h('span', c), h('strong', fmt.ars(v))))),
    h('p.nota', 'Corregí la categoría de lo que esté mal y poné "No es gasto" a lo que no cuenta: pases entre tus cuentas, plata que mandaste a invertir, el pago de la tarjeta si ya está detallada. Podés ajustar el importe.'),
    B.nota ? h('p.aviso', { role: 'status' }, B.nota) : null,
    h('ul.gastos', gastos.map(fila)),
    ingresos.length ? h('details.otra-forma', h('summary', `${ingresos.length} ingresos por ${fmt.ars(suma(ingresos, x => x.m))} (no se cuentan como gasto)`),
      h('ul.lista-simple', ingresos.map(x => h('li', `${fmt.fecha(x.f)} · ${x.d} · ${fmt.ars(x.m, 2)}`)))) : null,
  ];
}

function pasoIngreso(ctx) {
  const p = ctx.estado.datos.perfil;
  const f = entrada({ value: fmt.num(B.ingreso), oninput: () => { const v = aNumero(f.value); if (v > 0) B.ingreso = v; } });
  return [
    h('p', 'El sobrante es tu ingreso menos lo que gastaste.'),
    campo(`Ingreso de ${fmt.mes(B.mes + '-01')}, en dólares`, f, `Tu referencia es ${fmt.usd(p.ingreso_mensual_usd)} por mes. Cambialo si este mes fue distinto.`),
    h('label.casilla', h('input', { type: 'checkbox', checked: B.guardarIngreso || undefined, onchange: ev => { B.guardarIngreso = ev.target.checked; } }), h('span', 'Usar este ingreso como referencia de acá en adelante')),
  ];
}

function pasoDolar(ctx) {
  const e = ctx.estado, delMes = mepDelMes(e);
  if (B.tc == null) B.tc = Math.round((delMes || e.mep) * 100) / 100;
  const salida = h('div.resumen');
  const f = entrada({ value: fmt.num(B.tc, 2), oninput: () => { const v = aNumero(f.value); if (v > 0) { B.tc = v; calc(); } } });
  const dato = (etq, valor, sub) => h('div', h('p.dato-etq', etq), h('p.dato-valor', valor), sub ? h('p.dato-sub', sub) : null);
  const calc = () => { const g = gastoArs() / B.tc; poner(salida, dato('Gastaste', fmt.usd(g), fmt.ars(gastoArs())), dato('Ingreso', fmt.usd(B.ingreso)), dato('Sobrante', fmt.usd(B.ingreso - g))); };
  calc();
  const usar = v => { B.tc = v; f.value = fmt.num(v, 2); calc(); };
  return [
    h('p', 'Tus gastos están en pesos. Para compararlos con el ingreso hay que pasarlos a dólares.'),
    campo('Tipo de cambio (pesos por dólar)', f),
    h('div.acciones.izq',
      delMes ? boton(`MEP promedio de ${fmt.mes(B.mes + '-01').split(' de ')[0]}: ${fmt.num(delMes, 2)}`, () => usar(delMes), 'chico') : null,
      boton(`MEP de hoy: ${fmt.num(e.mep, 2)}`, () => usar(Math.round(e.mep * 100) / 100), 'chico')),
    h('p.nota', delMes ? 'Sugerido: el promedio del mes del extracto, porque gastaste a lo largo de todo el mes. Fuente: argentinadatos.com.' : 'No tengo el promedio de ese mes: uso el MEP de hoy. Fuente: dolarapi.com.'),
    salida,
  ];
}

function pasoCuanto(ctx) {
  const e = ctx.estado;
  const gasto = gastoArs() / B.tc;
  const externos = () => suma(Object.values(B.externos));
  const zona = h('div');
  const dibujar = () => {
    const r = recomendarAporte(e, { ingreso: B.ingreso, gasto, externos: externos() });
    if (B.elegido == null || B.elegido > r.maximo) B.elegido = Math.round(r.sugerido);
    const fElegido = entrada({ value: fmt.num(B.elegido), 'aria-label': 'Monto a invertir', oninput: () => { const v = aNumero(fElegido.value); if (v >= 0) { B.elegido = v; barra.value = Math.min(v, r.maximo); fuera.hidden = v <= r.maximo + 0.5; } } });
    const barra = h('input', { type: 'range', min: 0, max: Math.max(1, Math.floor(r.maximo)), step: 10, value: Math.min(B.elegido, r.maximo), 'aria-label': 'Monto a invertir', oninput: () => { B.elegido = Number(barra.value); fElegido.value = fmt.num(B.elegido); fuera.hidden = true; } });
    const fuera = aviso('Es más que el sobrante de este mes: la diferencia saldría de tus ahorros.', 'alerta'); fuera.hidden = B.elegido <= r.maximo + 0.5;
    poner(zona,
      h('p.total-paso', h('span', 'Sobrante del mes'), h('strong', fmt.usd(r.sobrante))),
      r.maximo > 0 ? h('p.recomendado', 'Te recomiendo invertir entre ', h('strong', fmt.usd(r.minimo)), ' y ', h('strong', fmt.usd(r.maximo)), '.') : null,
      h('ul.lista-simple', r.motivos.map(m => h('li', m))),
      r.maximo > 0 ? [h('div.calc-monto', h('label.campo', h('span.campo-etq', 'Cuánto invertís (USD)'), fElegido)), barra, fuera] : null);
    if (r.maximo <= 0) B.elegido = 0;
  };
  dibujar();
  const objetivos = e.datos.objetivos_externos || [];
  return [
    objetivos.length ? h('details.otra-forma', { open: externos() > 0 || undefined }, h('summary', `¿Separás algo para ${objetivos.map(o => o.nombre.toLowerCase()).join(' o ')}?`),
      h('div.fila-campos', objetivos.map(o => { const f = entrada({ value: fmt.num(B.externos[o.nombre] || 0), oninput: () => { B.externos[o.nombre] = Math.max(0, aNumero(f.value) || 0); B.elegido = null; dibujar(); } }); return campo(`${o.nombre} (USD)`, f); }))) : null,
    zona,
  ];
}

function pasoEnQue(ctx) {
  const e = ctx.estado;
  if (!(B.elegido > 0)) return [h('p', 'Este mes no hay aporte. Guardá el mes igual: queda el registro de lo que gastaste y la tasa de ahorro.')];
  const r = repartirAporte(e, B.elegido);
  return [
    h('p', `Con ${fmt.usd(B.elegido)}, esto es lo que conviene comprar para acercar la cartera a su distribución objetivo:`),
    r.compras.length ? h('div.tabla-caja', h('table.tabla',
      h('thead', h('tr', h('th', 'Comprá'), h('th.num', 'Unidades'), h('th.num', 'Precio $'), h('th.num', 'USD'))),
      h('tbody', r.compras.map(c => h('tr', h('td', h('strong.num', c.ticker)), h('td.num', fmt.cant(c.cantidad)), h('td.num', fmt.num(c.precio)), h('td.num', fmt.num(c.monto_usd, 2))))),
      h('tfoot', h('tr', h('td', { colspan: 3 }, 'Total'), h('td.num', fmt.num(r.invertido_usd, 2))))))
      : aviso('Con ese monto no alcanza para una unidad de ningún ETF del núcleo: queda en caja hasta el próximo aporte.', 'alerta'),
    h('p.nota', `Va todo al núcleo, primero a lo que está más lejos de su peso. Costo estimado ${fmt.usd(r.costo_usd, 2)}; sobran ${fmt.usd(r.sobrante_usd, 2)}. Precios ${e.precios.origen === 'mercado' ? 'actualizados ' + fmt.hace(e.precios.generado) : 'del último resumen'} (data912.com).`),
    h('p.nota', 'Al guardar, en Hoy te queda el paso "Aportá" con estas compras para marcar cuando las hagas.'),
  ];
}

async function guardar(ctx) {
  const e = ctx.estado, gasto = gastoArs() / B.tc, r = resumenGastos(B.movs);
  const eventos = [{
    tipo: 'mes', mes: B.mes, fecha: e.hoy, origen: 'cierre', fuente: B.origen,
    ingreso: B.ingreso, gasto: Math.round(gasto * 100) / 100, gasto_ars: Math.round(gastoArs() * 100) / 100, tc: B.tc,
    externos: { ...B.externos }, vacaciones: 0, auto: 0, aporte: B.elegido || 0,
    categorias: Object.fromEntries(r.porCategoria.map(([c, v]) => [c, Math.round(v * 100) / 100])),
    movimientos: B.movs.map(({ f, d, m, c }) => ({ f, d, m, c })),
  }];
  if (B.reglas.length) eventos.push({ tipo: 'reglas_gasto', fecha: e.hoy, reglas: B.reglas });
  if (B.guardarIngreso && B.ingreso !== e.datos.perfil.ingreso_mensual_usd) eventos.push({ tipo: 'perfil', fecha: e.hoy, cambios: { ingreso_mensual_usd: B.ingreso } });
  eventos.push({ tipo: 'decision', fecha: e.hoy, texto: `Cierre de ${fmt.mes(B.mes + '-01')}: gasto ${fmt.usd(gasto)}, ingreso ${fmt.usd(B.ingreso)}, a invertir ${fmt.usd(B.elegido || 0)}` });
  await ctx.registrar(...eventos);
  B = null;
  ctx.ir('#hoy');
}

export function vistaMes(ctx) {
  const e = ctx.estado;
  if (!B) B = nuevo(e);
  const raiz = h('div.vista.mes');
  const puedeSeguir = () => B.paso === 1 ? (B.movs.length > 0 || B.manualArs != null) : B.paso === 3 ? B.ingreso > 0 : B.paso === 4 ? B.tc > 0 : true;
  const pintar = () => {
    const cuerpo = [pasoExtracto, pasoGastos, pasoIngreso, pasoDolar, pasoCuanto, pasoEnQue][B.paso - 1](ctx, pintar);
    poner(raiz,
      h('header.vista-cab', h('h1', 'Cuánto invierto'),
        h('ol.pasos-mes', { 'aria-label': 'Pasos' }, PASOS.map((t, i) => h('li' + (i + 1 === B.paso ? '.actual' : i + 1 < B.paso ? '.hecho' : ''), { 'aria-current': i + 1 === B.paso ? 'step' : null }, h('span', i + 1), t)))),
      h('section.paso-mes', h('h2', `Paso ${B.paso} de ${PASOS.length}`), cuerpo),
      h('div.acciones.nav-mes',
        B.paso > 1 ? boton('Atrás', () => { B.paso--; B.nota = ''; pintar(); window.scrollTo(0, 0); }, 'fantasma') : h('a.boton.fantasma', { href: '#aportar', onclick: () => { B = null; } }, 'Cancelar'),
        B.paso < PASOS.length
          ? boton('Seguir', () => { if (!puedeSeguir()) return; B.paso++; B.nota = ''; pintar(); window.scrollTo(0, 0); }, 'primario' + (puedeSeguir() ? '' : '.apagado'))
          : boton('Guardar el mes', () => guardar(ctx), 'primario')));
  };
  pintar();
  return raiz;
}

// Tarjeta de entrada, para la pantalla Aportar.
export function entradaMes(ctx) {
  const e = ctx.estado, mes = mesAnterior(e.hoy), c = e.datos.meses?.[mes];
  const cerrado = c && c.origen === 'cierre';
  return h('a.tarjeta-mes', { href: '#aportar/mes', onclick: () => { B = null; } },
    h('span.tarjeta-titulo', cerrado ? `Ya cerraste ${fmt.mes(mes + '-01').split(' de ')[0]}` : '¿Cuánto invierto este mes?'),
    h('span.tarjeta-sub', cerrado ? `Gastaste ${fmt.usd(c.gasto)} y elegiste invertir ${fmt.usd(c.aporte)}. Tocá para rehacerlo.` : `Cargá el extracto de ${fmt.mes(mes + '-01').split(' de ')[0]} y te lo calculo con tus gastos reales, paso a paso.`),
    h('span.tarjeta-flecha', { 'aria-hidden': 'true' }, '→'));
}
