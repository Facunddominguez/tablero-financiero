// Pruebas que no necesitan los datos descifrados: las corre GitHub Actions en cada PR.
// Uso: node tools/pruebas_publicas.mjs
import { pruebasPrecios } from '../js/pruebas.js';
import { pruebasPublicas } from '../js/pruebas_publicas.js';
import { ventanaDelDia } from '../js/precios.js';
import { hechos, redactar, numeros } from '../js/resumen.js';
import { publicoEjemplo } from '../js/pruebas_ronda3.js';
import { readFileSync } from 'node:fs';

const leer = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
// Solo en Node: revisa los archivos publicados.
const pruebasArchivos = [
  ['Supuestos publicados: cada grupo con fuente, fecha y valores razonables', async () => {
    const s = leer('../data/supuestos.json');
    for (const [g, v] of Object.entries(s)) if (g !== 'nota' && (!v.fuente || !/^\d{4}-\d{2}-\d{2}$/.test(v.fecha))) throw new Error('sin fuente o fecha: ' + g);
    for (const [t, r] of [['SPY', 0.058], ['EFA', 0.063], ['EEM', 0.047], ['IWM', 0.058]]) if (s.retornos_etf[t] !== r) throw new Error(`${t}: punto medio de Vanguard al 30/09/2026`);
    if (!(s.acciones.prima_mercado > 0.02 && s.acciones.prima_mercado < 0.08)) throw new Error('prima fuera de rango');
    for (const [k, u] of Object.entries(s.semaforo)) if (u.rojo != null && !(k === 'adr' ? u.rojo < u.amarillo : u.rojo > u.amarillo)) throw new Error('umbrales al revés: ' + k);
    for (const [k, u] of Object.entries(s.clima)) if (u.tenso != null && !(['curva', 'spy_promedio'].includes(k) ? u.tenso < u.atento : u.tenso > u.atento)) throw new Error('umbrales al revés: ' + k);
    const { EDITABLES } = await import('../js/supuestos.js');
    for (const [g, , campos] of EDITABLES) for (const [c] of campos) if (c.split('.').reduce((o, p) => o?.[p], s[g]) == null) throw new Error(`falta ${g}.${c}`);
  }],
  ['Eventos fijos: cada grupo con fuente y dirección, fechas válidas, en orden y en días hábiles', async () => {
    const c = leer('../data/eventos.json');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.consultado)) throw new Error('sin fecha de consulta');
    if (c.grupos.map(g => g.id).join() !== 'fed,ipc_usa,ipc_ar,msci,elecciones') throw new Error('grupos: ' + c.grupos.map(g => g.id));
    for (const g of c.grupos) {
      if (!g.titulo || !g.fuente || !/^https:/.test(g.url) || !g.eventos.length) throw new Error('incompleto: ' + g.id);
      const fs = g.eventos.map(x => x.fecha || x.mes + '-01');
      if (g.eventos.some(x => !(/^\d{4}-\d{2}-\d{2}$/.test(x.fecha || '') || /^\d{4}-\d{2}$/.test(x.mes || '')))) throw new Error('fecha mal escrita en ' + g.id);
      if (fs.join() !== [...new Set(fs)].sort().join()) throw new Error('desordenado o repetido: ' + g.id);
      if (g.id !== 'elecciones' && g.eventos.some(x => x.fecha && [0, 6].includes(new Date(x.fecha + 'T12:00:00Z').getUTCDay()))) throw new Error('fin de semana en ' + g.id);
    }
    if (c.grupos.at(-1).eventos[0].fecha !== leer('./mercado_config.json').elecciones.fecha) throw new Error('la elección no coincide con la configuración');
  }],
  ['Resumen: la respuesta grabada de Claude se usa y todo número que trae está en los hechos', async () => {
    const grabada = leer('./grabadas/anthropic_resumen_formato.json');
    const h = hechos(publicoEjemplo(), '2026-11-30');
    const r = await redactar(h, { llamar: async () => grabada });
    if (r.por !== 'claude-haiku-5-5') throw new Error('no se usó: ' + r.motivo);
    const permitidos = numeros(JSON.stringify(h));
    const sueltos = [...numeros(Object.values(r.secciones).flat().join(' '))].filter(n => !permitidos.has(n));
    if (sueltos.length) throw new Error('números sueltos: ' + sueltos);
    if (r.uso.input_tokens !== 1450) throw new Error('uso sin anotar');
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
