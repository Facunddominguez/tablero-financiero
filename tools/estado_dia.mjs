// Anota una vez por día el color del semáforo y la lectura del clima (data/semaforo.json), para que el resumen
// del sábado pueda decir qué cambió. Solo datos públicos. Lo corre el Action después de bajar los precios.
import { readFileSync, writeFileSync } from 'node:fs';
import { lecturaDelDia, sumarDia } from '../js/resumen.js';

const raiz = new URL('../data/', import.meta.url);
const leer = n => { try { return JSON.parse(readFileSync(new URL(n, raiz), 'utf8')); } catch { return null; } };
const hoy = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const lectura = lecturaDelDia({ mercado: leer('market.json'), historico: leer('historico.json'), argentina: leer('argentina.json'), clima: leer('clima.json'), supuestos: leer('supuestos.json') }, hoy);
const anterior = leer('semaforo.json');
const nuevo = sumarDia(anterior, hoy, lectura);
if (JSON.stringify(nuevo) !== JSON.stringify(anterior)) writeFileSync(new URL('semaforo.json', raiz), JSON.stringify(nuevo));
console.log(`estado del día: semáforo ${lectura.semaforo || 'sin datos'}, clima ${lectura.clima || 'sin datos'}`);
