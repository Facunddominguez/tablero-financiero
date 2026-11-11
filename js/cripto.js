// AES-256-GCM + PBKDF2-SHA256 (600.000 iteraciones). Mismo formato que tools/cripto.py.

const b64 = buf => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s); };
const deB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// Deriva la clave AES desde la frase. No es extraíble: se puede guardar en IndexedDB sin exponer la frase.
export async function derivarClave(frase, saltB64, iter = 600000) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(frase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: deB64(saltB64), iterations: iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function descifrar(sobre, clave) {
  const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(sobre.iv) }, clave, deB64(sobre.ct));
  return JSON.parse(new TextDecoder().decode(claro));
}

// Se conserva el salt (la clave derivada sigue valiendo) y se genera un IV nuevo en cada cifrado.
export async function cifrar(obj, clave, saltB64, iter = 600000) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, clave, new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter, salt: saltB64, iv: b64(iv), ct: b64(ct) };
}
