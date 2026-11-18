// Pruebas que no necesitan los datos descifrados: las corre GitHub Actions en cada PR.
// Uso: node tools/pruebas_publicas.mjs
import { pruebasPrecios } from '../js/pruebas.js';
import { pruebasPublicas } from '../js/pruebas_publicas.js';

const res = [];
for (const [nombre, fn] of [...pruebasPrecios(), ...pruebasPublicas()]) {
  try { await fn(); res.push({ nombre, ok: true }); } catch (err) { res.push({ nombre, ok: false, detalle: String(err.message || err) }); }
}
for (const r of res) console.log((r.ok ? 'ok   ' : 'FALLA') + ' ' + r.nombre + (r.detalle ? ' — ' + r.detalle : ''));
console.log(`\n${res.filter(r => r.ok).length}/${res.length} pruebas pasan`);
process.exit(res.every(r => r.ok) ? 0 : 1);
