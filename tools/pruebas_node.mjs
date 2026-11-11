// Corre las pruebas del motor en Node contra los datos descifrados en privado/ (no se sube).
// Uso: node tools/pruebas_node.mjs [--detalle]
import { readFileSync } from 'node:fs';
import { correrPruebas } from '../js/pruebas.js';
import { aplicarEventos, valuar } from '../js/estado.js';
import { planificador } from '../js/motor.js';
import { rendimiento } from '../js/finanzas.js';
const leer = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const base = leer('../privado/datos_iniciales.json');
const ext = { calendario: leer('../data/calendario.json'), historico: leer('../data/historico.json'), mercado: leer('../data/market.json'), insiders: leer('../data/insiders.json') };
const res = correrPruebas(base, ext);
for (const r of res) console.log((r.ok ? 'ok   ' : 'FALLA') + ' ' + r.nombre + (r.detalle ? ' — ' + r.detalle : ''));
console.log(`\n${res.filter(r => r.ok).length}/${res.length} pruebas pasan`);
if (process.argv.includes('--detalle')) {
  const hoy = process.argv[process.argv.indexOf('--detalle') + 1] || new Date().toISOString().slice(0, 10);
  const e = valuar(aplicarEventos(base), ext, hoy), plan = planificador(e, hoy);
  console.log('\nHOY', hoy, '| total', e.total_usd.toFixed(2), '| núcleo/LP', (e.nucleo_lp * 100).toFixed(1), '| YPF', (e.ypf_lp * 100).toFixed(1), '| sat', (e.satelites_lp * 100).toFixed(1), '| emerg meses', e.meses_emergencia.toFixed(1), '| var día', e.var_dia_usd.toFixed(2));
  for (const p of plan.pasos) console.log(`\n[${p.tipo}] ${p.titulo}\n   por qué: ${p.porque}\n   cómo: ${p.como.join(' | ')}`);
  console.log('\nREGLAS'); for (const r of plan.reglas) console.log(` ${r.id.padEnd(6)} ${r.nivel.padEnd(9)} ${String(r.valor).padEnd(28)} ${r.detalle}${r.activa ? ' → ' + r.accion : ''}`);
  console.log('\nPRÓXIMA', plan.proxima);
  const r = rendimiento(e); for (const f of [r.cartera, ...r.benchmarks]) console.log(' ', f.nombre.padEnd(22), f.valor.toFixed(0), 'xirr', f.xirr == null ? '—' : (f.xirr * 100).toFixed(1) + '%');
}
process.exit(res.every(r => r.ok) ? 0 : 1);
