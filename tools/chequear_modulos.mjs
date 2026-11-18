// Carga cada módulo de js/ en Node para detectar errores de sintaxis o de importación.
// app.js y pagina-pruebas.js arrancan solos al cargarse: a esos solo se les revisa la sintaxis (en el workflow).
// Uso: node tools/chequear_modulos.mjs
import { readdirSync } from 'node:fs';
const raiz = new URL('../js/', import.meta.url);
const archivos = [...readdirSync(raiz).filter(f => f.endsWith('.js')), ...readdirSync(new URL('ui/', raiz)).filter(f => f.endsWith('.js')).map(f => 'ui/' + f)]
  .filter(f => !['app.js', 'pagina-pruebas.js'].includes(f));
let mal = 0;
for (const f of archivos) { try { await import(new URL(f, raiz)); } catch (e) { mal++; console.log('FALLA', f, '—', e.message); } }
console.log(`${archivos.length} módulos cargados, ${mal} con error`);
process.exit(mal ? 1 : 0);
