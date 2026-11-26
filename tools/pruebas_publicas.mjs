// Pruebas que no necesitan los datos descifrados: las corre GitHub Actions en cada PR.
// Uso: node tools/pruebas_publicas.mjs
import { pruebasPrecios } from '../js/pruebas.js';
import { pruebasPublicas } from '../js/pruebas_publicas.js';
import { ventanaDelDia } from '../js/precios.js';
import { readFileSync } from 'node:fs';

const leer = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
// Solo en Node: revisa los archivos publicados.
const pruebasArchivos = [
  ['Supuestos publicados: cada grupo con fuente, fecha y valores razonables', async () => {
    const s = leer('../data/supuestos.json');
    for (const [g, v] of Object.entries(s)) if (g !== 'nota' && (!v.fuente || !/^\d{4}-\d{2}-\d{2}$/.test(v.fecha))) throw new Error('sin fuente o fecha: ' + g);
    for (const [t, r] of [['SPY', 0.058], ['EFA', 0.063], ['EEM', 0.047], ['IWM', 0.058]]) if (s.retornos_etf[t] !== r) throw new Error(`${t}: punto medio de Vanguard al 30/09/2026`);
    if (!(s.acciones.tasa_libre > 0.02 && s.acciones.tasa_libre < 0.08 && s.acciones.prima_mercado > 0.02 && s.acciones.prima_mercado < 0.08)) throw new Error('tasa y prima fuera de rango');
    for (const [k, u] of Object.entries(s.semaforo)) if (u.rojo != null && !(k === 'adr' ? u.rojo < u.amarillo : u.rojo > u.amarillo)) throw new Error('umbrales al revés: ' + k);
    for (const [k, u] of Object.entries(s.clima)) if (u.tenso != null && !(['curva', 'spy_promedio'].includes(k) ? u.tenso < u.atento : u.tenso > u.atento)) throw new Error('umbrales al revés: ' + k);
    const { EDITABLES } = await import('../js/supuestos.js');
    for (const [g, , campos] of EDITABLES) for (const [c] of campos) if (c.split('.').reduce((o, p) => o?.[p], s[g]) == null) throw new Error(`falta ${g}.${c}`);
  }],
  ['Feriados de EE.UU.: 2026 y 2027 con fuente, en días de semana y sin superponerse', async () => {
    const c = leer('../data/feriados_eeuu.json');
    if (!c.fuente || !/^https:/.test(c.url) || !c.byma?.url) throw new Error('falta la fuente');
    if (c.anios.join() !== '2026,2027') throw new Error('años: ' + c.anios);
    const fs = [...Object.keys(c.feriados), ...Object.keys(c.medias_ruedas)];
    if (new Set(fs).size !== fs.length) throw new Error('una fecha es feriado y media rueda');
    if (fs.some(f => [0, 6].includes(new Date(f + 'T12:00:00Z').getUTCDay()))) throw new Error('hay un fin de semana');
    for (const a of c.anios) if (Object.keys(c.feriados).filter(f => f.startsWith(String(a))).length !== 10) throw new Error('feriados de ' + a);
    if (ventanaDelDia(c, '2026-12-24').cierra !== '15:00' || !ventanaDelDia(c, '2027-07-05').cerrado) throw new Error('ventana con el archivo real');
  }],
];

const res = [];
for (const [nombre, fn] of [...pruebasPrecios(), ...pruebasPublicas(), ...pruebasArchivos]) {
  try { await fn(); res.push({ nombre, ok: true }); } catch (err) { res.push({ nombre, ok: false, detalle: String(err.message || err) }); }
}
for (const r of res) console.log((r.ok ? 'ok   ' : 'FALLA') + ' ' + r.nombre + (r.detalle ? ' — ' + r.detalle : ''));
console.log(`\n${res.filter(r => r.ok).length}/${res.length} pruebas pasan`);
process.exit(res.every(r => r.ok) ? 0 : 1);
