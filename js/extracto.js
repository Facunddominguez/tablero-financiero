// Extracto bancario: lectura (tabla, CSV o texto) y categorización de gastos. Todo corre en el navegador:
// el archivo nunca se sube a ningún lado y lo que se guarda va dentro de los datos cifrados.
import { suma } from './util.js';

export const CATEGORIAS = ['Supermercado', 'Comida y delivery', 'Transporte', 'Servicios', 'Vivienda', 'Salud', 'Suscripciones', 'Ocio', 'Compras', 'Impuestos y comisiones', 'Efectivo', 'Transferencias', 'Otros'];
export const NO_GASTO = 'No es gasto'; // pases entre cuentas propias, inversiones, pago de la tarjeta ya detallada, compra de dólares
export const INGRESO = 'Ingreso';

const sinAcentos = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Reglas generales de arranque. Las que aprende de tus correcciones tienen prioridad.
const BASE = [
  [/\b(coto|carrefour|jumbo|disco|vea|changomas|chango mas|la anonima|supermerc\w*|autoservicio|verduler\w*|carnicer\w*|almacen|dia tienda|maxiconsumo)\b/, 'Supermercado'],
  [/\b(pedidosya|pedidos ya|rappi|mcdonald|burger|mostaza|starbucks|cafe|restaur\w*|parrilla|pizz\w*|helad\w*|panader\w*|bar)\b/, 'Comida y delivery'],
  [/\b(uber|cabify|didi|sube|peaje|autopista|estacionamiento\w*|shell|axion|puma energy|combustible\w*|nafta|taxi|aerolineas|flybondi|jetsmart|colectivo|subte|tren)\b/, 'Transporte'],
  [/\b(edenor|edesur|metrogas|naturgy|aysa|personal|claro|movistar|telecom|fibertel|flow|telecentro|internet|luz|gas)\b/, 'Servicios'],
  [/\b(alquiler|expensas|consorcio|inmobiliaria|abl)\b/, 'Vivienda'],
  [/\b(farmaci\w*|osde|swiss medical|galeno|medife|omint|prepaga|medic\w*|clinica|sanatorio|odonto\w*|laboratorio|optica)\b/, 'Salud'],
  [/\b(netflix|spotify|disney|hbo|max|youtube|google one|icloud|apple com|amazon prime|chatgpt|openai|microsoft|suscrip\w*)\b/, 'Suscripciones'],
  [/\b(cine|teatro|ticketek|entradas|gimnasio|megatlon|sportclub|steam|playstation|libreria)\b/, 'Ocio'],
  [/\b(impuesto|iva|percep\w*|sellos|comision\w*|mantenimiento|interes\w*|ley 25413|iibb|ingresos brutos|seguro)\b/, 'Impuestos y comisiones'],
  [/\b(extraccion\w*|cajero|atm|banelco|link)\b/, 'Efectivo'],
  [/\b(balanz|inversion|fci|suscripcion fondo|compra dolar|compra de dolar|compra usd|pago tarjeta|pago de tarjeta|plazo fijo|cta propia|cuenta propia)\b/, NO_GASTO],
  [/\b(transferencia|transf|debin|envio de dinero)\b/, 'Transferencias'],
  [/\b(mercadolibre|mercado libre|merpago|mercadopago|mercado pago|tienda|shop|indumentaria|zapat\w*|ferreter\w*|easy|sodimac|fravega|musimundo)\b/, 'Compras'],
];
const RUIDO = new Set(['compra', 'pago', 'debito', 'credito', 'tarjeta', 'visa', 'mastercard', 'maestro', 'con', 'en', 'de', 'del', 'la', 'el', 'pos', 'nro', 'cuota', 'operacion', 'comercio', 'electronico', 'cons', 'consumo', 'srl', 'sa', 'sas']);

// Palabras que identifican al comercio: es lo que se recuerda cuando corregís una categoría.
export function patronDe(desc) {
  return sinAcentos(desc).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(t => t.length >= 3 && !RUIDO.has(t)).slice(0, 2).join(' ');
}

export function categorizar(mov, reglasUsuario = []) {
  if (mov.m > 0) return INGRESO;
  const d = ' ' + sinAcentos(mov.d).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  for (let i = reglasUsuario.length - 1; i >= 0; i--) if (reglasUsuario[i].patron && d.includes(' ' + reglasUsuario[i].patron + ' ')) return reglasUsuario[i].categoria;
  for (const [re, cat] of BASE) if (re.test(d)) return cat;
  return 'Otros';
}

// ---------- números y fechas ----------
export function aNumeroBanco(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim();
  if (!s) return NaN;
  const negativo = /^\(.*\)$/.test(s) || /-\s*$/.test(s) || /^-/.test(s.replace(/[$\s]/g, ''));
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1 || /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return negativo ? -n : n;
}
export function fechaDe(v, anio) {
  if (v instanceof Date && !isNaN(v)) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 30000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?(?!\d)/);
  if (!m || +m[1] > 31 || +m[2] > 12 || !+m[1] || !+m[2]) return null;
  const a = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : anio;
  return a ? `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

// Cuando hay saldo, el signo sale de cómo se mueve el saldo: no depende de adivinar columnas.
function signosPorSaldo(movs) {
  const con = movs.filter(x => isFinite(x.s));
  if (con.length < 3) return false;
  const prueba = orden => {
    let ok = 0, total = 0;
    for (let i = 1; i < orden.length; i++) {
      const delta = orden[i].s - orden[i - 1].s, abs = Math.abs(orden[i].m);
      total++; if (Math.abs(Math.abs(delta) - abs) < 0.015) ok++;
    }
    return total ? ok / total : 0;
  };
  const asc = prueba(con), desc = prueba(con.slice().reverse());
  if (Math.max(asc, desc) < 0.8) return false;
  const orden = asc >= desc ? con : con.slice().reverse();
  for (let i = 1; i < orden.length; i++) {
    const delta = orden[i].s - orden[i - 1].s;
    if (Math.abs(Math.abs(delta) - Math.abs(orden[i].m)) < 0.015) orden[i].m = Math.sign(delta) * Math.abs(orden[i].m);
  }
  return true;
}
const pareceIngreso = d => /\b(haberes|sueldo|acreditacion\w*|deposito|transferencia recibida|credito inmediato|devolucion\w*|reintegro|cobro)\b/.test(sinAcentos(d));

// ---------- tabla (Excel o CSV ya separado en celdas) ----------
const ROLES = { fecha: /^fecha/, desc: /(concepto|descrip|detalle|movimiento|referencia|leyenda)/, debito: /(debito|egreso|cargo|salida)/, credito: /(credito|ingreso|abono|entrada)/, importe: /(importe|monto|valor)/, saldo: /saldo/ };

export function detectarColumnas(filas) {
  for (let i = 0; i < Math.min(filas.length, 40); i++) {
    const cab = (filas[i] || []).map(sinAcentos);
    const col = {};
    for (const [rol, re] of Object.entries(ROLES)) { const j = cab.findIndex((c, k) => re.test(c) && !Object.values(col).includes(k)); if (j >= 0) col[rol] = j; }
    if (col.fecha != null && col.desc != null && (col.importe != null || col.debito != null || col.credito != null)) return { fila: i, col, titulos: filas[i].map(c => String(c ?? '')) };
  }
  return null;
}

// filas: matriz de celdas. columnas: { fila, col } (de detectarColumnas o elegidas a mano). anio: para fechas sin año.
export function desdeTabla(filas, columnas = detectarColumnas(filas), anio) {
  if (!columnas) return { movimientos: [], avisos: ['No encontré los títulos de las columnas (fecha, concepto, importe). Elegilas a mano.'], columnas: null };
  const { fila, col } = columnas, movs = [];
  for (const f of filas.slice(fila + 1)) {
    const fecha = fechaDe(f[col.fecha], anio);
    const d = String(f[col.desc] ?? '').replace(/\s+/g, ' ').trim();
    if (!fecha || !d) continue;
    let m;
    if (col.debito != null || col.credito != null) {
      const deb = Math.abs(aNumeroBanco(f[col.debito]) || 0), cre = Math.abs(aNumeroBanco(f[col.credito]) || 0);
      m = cre - deb;
    } else m = aNumeroBanco(f[col.importe]);
    if (!isFinite(m) || m === 0) continue;
    movs.push({ f: fecha, d, m, s: col.saldo != null ? aNumeroBanco(f[col.saldo]) : NaN });
  }
  const avisos = [];
  if (col.debito == null && col.credito == null && movs.length && movs.every(x => x.m > 0)) {
    if (!signosPorSaldo(movs)) { for (const x of movs) if (!pareceIngreso(x.d)) x.m = -x.m; avisos.push('El archivo no distingue entradas de salidas: tomé todo como gasto salvo lo que parece un ingreso. Revisalo en el paso siguiente.'); }
  }
  return { movimientos: movs.map(({ f, d, m }) => ({ f, d, m: Math.round(m * 100) / 100 })), avisos, columnas };
}

// ---------- CSV ----------
export function celdasDeCSV(texto) {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const muestra = lineas.slice(0, 15).join('\n');
  const sep = [';', '\t', ','].map(s => [s, muestra.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  return lineas.map(l => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === sep) { out.push(cur.trim()); cur = ''; } else cur += c;
    }
    out.push(cur.trim());
    return out;
  });
}

// ---------- texto (pegado o sacado de un PDF) ----------
const RE_MONTO = /(?:-\s?)?\$?\s?\(?\d{1,3}(?:\.\d{3})*,\d{2}\)?-?/g;
export function desdeTexto(texto, anio) {
  const movs = [];
  let ultimo = null;
  for (const linea of String(texto).split(/\r?\n/)) {
    const l = linea.replace(/\s+/g, ' ').trim();
    if (!l) continue;
    const mf = l.match(/^(\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?)\s+(.*)$/);
    const fecha = mf && fechaDe(mf[1], anio);
    if (!fecha) { if (ultimo && !/\d{1,3}(?:\.\d{3})*,\d{2}/.test(l) && l.length < 80 && !/saldo|pagina|hoja|total|resumen/i.test(l)) ultimo.d += ' ' + l; continue; }
    const resto = mf[2];
    const montos = resto.match(RE_MONTO) || [];
    if (!montos.length) { ultimo = null; continue; }
    const d = resto.slice(0, resto.indexOf(montos[0])).trim() || resto.replace(RE_MONTO, ' ').replace(/\s+/g, ' ').trim();
    if (!d || /^saldo (anterior|inicial|final|al)/i.test(d)) { ultimo = null; continue; }
    const nums = montos.map(aNumeroBanco);
    const conSaldo = nums.length >= 2;
    ultimo = { f: fecha, d, m: nums[conSaldo ? nums.length - 2 : 0], s: conSaldo ? nums[nums.length - 1] : NaN, _signo: nums[conSaldo ? nums.length - 2 : 0] < 0 };
    movs.push(ultimo);
  }
  const avisos = [];
  const conSigno = movs.some(x => x._signo);
  if (!conSigno && !signosPorSaldo(movs)) {
    for (const x of movs) if (!pareceIngreso(x.d)) x.m = -Math.abs(x.m);
    if (movs.length) avisos.push('No pude distinguir entradas de salidas con seguridad: tomé todo como gasto salvo lo que parece un ingreso. Revisalo en el paso siguiente.');
  }
  return { movimientos: movs.map(({ f, d, m }) => ({ f, d: d.replace(/\s+/g, ' ').trim(), m: Math.round(m * 100) / 100 })), avisos };
}

// ---------- resumen ----------
export const mesDe = movs => { const c = {}; for (const x of movs) c[x.f.slice(0, 7)] = (c[x.f.slice(0, 7)] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null; };
export const esGasto = x => x.m < 0 && x.c !== NO_GASTO && x.c !== INGRESO;
export function resumenGastos(movs) {
  const porCat = {};
  for (const x of movs.filter(esGasto)) porCat[x.c] = (porCat[x.c] || 0) - x.m;
  return { total: suma(Object.values(porCat)), porCategoria: Object.entries(porCat).sort((a, b) => b[1] - a[1]), ingresos: suma(movs.filter(x => x.m > 0), x => x.m), cantidad: movs.filter(esGasto).length };
}
