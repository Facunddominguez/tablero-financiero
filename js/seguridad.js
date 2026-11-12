// Fortaleza de la clave, generador de frases y almacenamiento local cifrado.
import { db } from './db.js';

// Intentos por segundo de una placa de video actual contra PBKDF2-SHA256 de 600.000 iteraciones (orden de magnitud).
const INTENTOS_POR_PLACA = 15000;
const MINIMO_BITS = 60;

// Estimación conservadora: las palabras comunes valen ~11 bits cada una; el resto, según el tipo de caracteres.
export function fortaleza(frase) {
  const f = String(frase || '').trim();
  if (!f) return { bits: 0, nivel: 0, texto: '', acepta: false };
  let bits = 0;
  for (const t of f.split(/[\s\-_.,;:/]+/).filter(Boolean)) {
    if (/^\p{L}{3,12}$/u.test(t)) { bits += 11; continue; }
    let pool = 0;
    if (/\p{Ll}/u.test(t)) pool += 26;
    if (/\p{Lu}/u.test(t)) pool += 26;
    if (/\d/.test(t)) pool += 10;
    if (/[^\p{L}\d]/u.test(t)) pool += 20;
    bits += t.length * Math.log2(pool || 10) * (/^\d+$/.test(t) ? 1 : 0.8);
  }
  const repetidas = new Set(f.toLowerCase().split(/[\s\-_.,;:/]+/)).size < f.split(/[\s\-_.,;:/]+/).filter(Boolean).length;
  if (repetidas) bits *= 0.7;
  bits = Math.round(bits);
  const anios = Math.pow(2, bits - 1) / (INTENTOS_POR_PLACA * 100) / 31557600; // 100 placas, mitad del espacio
  const tiempo = anios < 1 / 365 ? 'menos de un día' : anios < 1 ? `unos ${Math.max(1, Math.round(anios * 12))} meses` : anios < 1000 ? `unos ${Math.round(anios)} años` : anios < 1e6 ? 'miles de años' : 'millones de años';
  const nivel = bits < 45 ? 1 : bits < MINIMO_BITS ? 2 : bits < 75 ? 3 : 4;
  return {
    bits, nivel, acepta: bits >= MINIMO_BITS && f.length >= 20,
    texto: `${['', 'Débil', 'Floja', 'Buena', 'Muy buena'][nivel]} · a alguien con 100 placas de video le llevaría ${tiempo} adivinarla`,
    falta: f.length < 20 ? 'Usá al menos 20 caracteres (por ejemplo, 5 o 6 palabras sin relación entre sí).' : bits < MINIMO_BITS ? 'Sumá palabras que no tengan relación entre sí.' : '',
  };
}

// Frase al azar pronunciable: 6 grupos de dos sílabas (≈ 73 bits). No depende de una lista de palabras.
export function generarFrase() {
  const C = 'bcdfglmnprstvz', V = 'aeiou';
  const al = n => { const lim = Math.floor(256 / n) * n; let x; do { x = crypto.getRandomValues(new Uint8Array(1))[0]; } while (x >= lim); return x % n; };
  const silaba = () => C[al(C.length)] + V[al(V.length)];
  return Array.from({ length: 6 }, () => silaba() + silaba()).join('-');
}

// ---------- almacenamiento local cifrado ----------
// Lo que se guarda en este dispositivo (eventos, valores diarios, token) va cifrado con la clave de los datos.
export async function guardarCifrado(k, valor, clave, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, clave, new TextEncoder().encode(JSON.stringify(valor)));
  return db.guardar(k, { cifrado: 1, salt, iv, ct });
}
// Devuelve { valor } si se pudo leer, { ilegible: true, salt } si está cifrado con otra clave, o null si no hay nada.
export async function leerCifrado(k, clave) {
  const x = await db.leer(k);
  if (x == null) return null;
  if (!x.cifrado) return { valor: x, enClaro: true }; // formato anterior, sin cifrar: se migra al guardar
  try {
    const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: x.iv }, clave, x.ct);
    return { valor: JSON.parse(new TextDecoder().decode(claro)) };
  } catch { return { ilegible: true, salt: x.salt }; }
}

// ---------- bloqueo ----------
const K_BLOQUEO = 'tablero_bloqueado', K_MIN = 'tablero_bloqueo_min';
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } } };
export const bloqueo = {
  activo: () => ls.get(K_BLOQUEO) === '1',
  marcar: si => ls.set(K_BLOQUEO, si ? '1' : null),
  minutos: () => { const v = ls.get(K_MIN); return v == null ? 15 : Number(v); },
  fijarMinutos: n => ls.set(K_MIN, String(n)),
  // Llama a `alVencer` cuando pasan los minutos configurados sin tocar la pantalla.
  vigilar(alVencer) {
    let ultimo = Date.now();
    const toque = () => { ultimo = Date.now(); };
    const revisar = () => { const m = bloqueo.minutos(); if (m > 0 && Date.now() - ultimo > m * 60000) { ultimo = Date.now(); alVencer(); } };
    for (const ev of ['pointerdown', 'keydown', 'scroll']) window.addEventListener(ev, toque, { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });
    setInterval(revisar, 30000);
  },
};
