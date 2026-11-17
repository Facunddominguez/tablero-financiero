// Sincronización con GitHub: lee el archivo cifrado más nuevo, fusiona con lo local y lo sube.
// Nunca descarta cambios locales: lo local solo se da por sincronizado cuando GitHub confirma la subida.

const API = 'https://api.github.com';
const RUTA = 'data/cartera.enc.json';

export class ErrorSync extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}

// "usuario/repositorio" a partir de la dirección de GitHub Pages; '' si no se puede deducir (por ejemplo, en localhost).
export function repoDeUbicacion(loc = globalThis.location) {
  const m = loc?.hostname?.match(/^(.+)\.github\.io$/);
  const repo = loc?.pathname?.split('/').filter(Boolean)[0];
  return m && repo ? `${m[1]}/${repo}` : '';
}

const cabeceras = token => ({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) });
const deB64 = s => { const bin = atob(s.replace(/\s/g, '')); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); };

async function pedir(fetchFn, url, opciones) {
  try { return await fetchFn(url, opciones); }
  catch { throw new ErrorSync('red', 'No hay conexión con GitHub. Tus cambios siguen guardados en este dispositivo.'); }
}

// Lee el archivo cifrado directo de GitHub (sin la demora de la página publicada). Devuelve { sobre, sha }.
export async function leerRemoto({ repo, token, rama = 'main' }, fetchFn = fetch) {
  const r = await pedir(fetchFn, `${API}/repos/${repo}/contents/${RUTA}?ref=${rama}`, { headers: cabeceras(token), cache: 'no-store' });
  if (r.status === 401) throw new ErrorSync('token', 'GitHub no reconoce el permiso guardado: venció o se borró. Hay que generar uno nuevo.');
  if (r.status === 403 || r.status === 429) throw new ErrorSync(token ? 'permiso' : 'limite', token ? 'El permiso guardado no alcanza para leer este repositorio.' : 'GitHub limitó las consultas por un rato.');
  if (r.status === 404) throw new ErrorSync('repo', `No encuentro el repositorio "${repo}" o el archivo de datos.`);
  if (!r.ok) throw new ErrorSync('otro', `GitHub respondió ${r.status} al leer los datos.`);
  const j = await r.json();
  return { sobre: JSON.parse(deB64(j.content)), sha: j.sha };
}

async function subir({ repo, token, rama = 'main' }, sobre, sha, fetchFn) {
  const r = await pedir(fetchFn, `${API}/repos/${repo}/contents/${RUTA}`, {
    method: 'PUT', headers: cabeceras(token),
    body: JSON.stringify({ message: 'datos: sincronización desde la app', content: btoa(JSON.stringify(sobre)), sha, branch: rama }),
  });
  if (r.status === 409 || r.status === 422) throw new ErrorSync('conflicto', 'Otro dispositivo guardó al mismo tiempo.');
  if (r.status === 401) throw new ErrorSync('token', 'GitHub no reconoce el permiso guardado: venció o se borró. Hay que generar uno nuevo.');
  if (r.status === 403 || r.status === 404) throw new ErrorSync('permiso', 'El permiso no deja guardar en este repositorio. Al crearlo hay que elegir este repositorio y "Contents: Read and write".');
  if (!r.ok) throw new ErrorSync('otro', `GitHub respondió ${r.status} al guardar.`);
  return (await r.json()).content.sha;
}

// Une dos copias de los datos: manda la base remota (salvo que lo local sea un respaldo importado más nuevo),
// los eventos se unen por id y los valores diarios se combinan.
export function fusionar(remoto, local, { localManda = false } = {}) {
  const base = JSON.parse(JSON.stringify(localManda || !remoto ? local : remoto));
  const vistos = new Set();
  base.eventos = [...(remoto?.eventos || []), ...(local.eventos || [])].filter(e => !vistos.has(e.id) && vistos.add(e.id));
  base.snapshots = { ...(remoto?.snapshots || {}), ...(local.snapshots || {}) };
  base.meta = { ...base.meta, sincronizado: new Date().toISOString() };
  return base;
}

// Ciclo completo. `local` son los datos completos de este dispositivo; `abrir(sobre)` descifra un archivo remoto
// (o devuelve null si está cifrado con otra clave) y `cerrar(datos)` lo cifra con la clave vigente.
export async function sincronizar({ gh, local, localManda, abrir, cerrar }, fetchFn = fetch) {
  let ultimo;
  for (let intento = 0; intento < 3; intento++) {
    const remoto = await leerRemoto(gh, fetchFn);
    const datosRemotos = await abrir(remoto.sobre);
    if (!datosRemotos && !localManda) throw new ErrorSync('clave', 'Los datos publicados están cifrados con otra clave. Abrí el tablero de nuevo y escribí la clave vigente.');
    const datos = fusionar(datosRemotos, local, { localManda });
    const sobre = await cerrar(datos);
    try {
      const sha = await subir(gh, sobre, remoto.sha, fetchFn);
      const idsRemotos = new Set((datosRemotos?.eventos || []).map(e => e.id));
      return { datos, sobre, sha, recibidos: datos.eventos.length - (local.eventos || []).length, enviados: (local.eventos || []).filter(e => !idsRemotos.has(e.id)).length };
    } catch (err) { if (err.codigo !== 'conflicto') throw err; ultimo = err; }
  }
  throw ultimo;
}

// Enlace a GitHub con el permiso ya precargado (falta elegir el repositorio, que GitHub no deja precargar).
// "Actions" sirve para pedir precios nuevos desde la app.
export function enlacePermiso() {
  const p = new URLSearchParams({ name: 'Tablero (sincronizar)', description: 'Permite al tablero guardar el archivo de datos cifrado y pedir precios nuevos. Solo este repositorio.', expires_in: '366', contents: 'write', actions: 'write' });
  return `https://github.com/settings/personal-access-tokens/new?${p}`;
}

// Permiso aparte para un servicio de cron externo: solo puede lanzar la actualización de precios.
export function enlacePermisoCron() {
  const p = new URLSearchParams({ name: 'Tablero (cron de precios)', description: 'Solo lanza la actualización de precios del tablero. Lo usa cron-job.org.', expires_in: '366', actions: 'write' });
  return `https://github.com/settings/personal-access-tokens/new?${p}`;
}
export const LISTA_PERMISOS = 'https://github.com/settings/personal-access-tokens';

// ---------- Actualizar precios a pedido ----------
// GitHub atrasa o saltea las corridas programadas; desde la app se puede lanzar una y esperar el resultado.
export const WORKFLOW = 'mercado.yml';
const ARCHIVOS_MERCADO = { mercado: 'data/market.json', insiders: 'data/insiders.json', historico: 'data/historico.json' };
const SIN_ACTIONS = 'El permiso guardado en este dispositivo no deja pedir precios. Si generaste un permiso nuevo, hay que pegarlo acá (⋯ → Sincronizar → Cambiar el permiso). Si editaste el que ya tenías, revisá que en "Repository permissions" diga "Actions: Read and write" y que lo hayas guardado con "Update".';

// Dirección y cuerpo de la llamada que lanza la actualización (los usa también la guía del cron externo).
export const urlDisparo = repo => `${API}/repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`;
export const cuerpoDisparo = (origen, rama = 'main') => JSON.stringify({ ref: rama, inputs: { origen } });

// Lo que GitHub dice del error, para mostrarlo tal cual (ayuda a saber si es el permiso u otra cosa).
async function motivo(r) {
  try { const j = await r.json(); return j?.message ? ` (GitHub: ${r.status} ${j.message})` : ` (GitHub: ${r.status})`; } catch { return ` (GitHub: ${r.status})`; }
}
async function revisarActions(r, que) {
  if (r.ok) return;
  const m = await motivo(r);
  if (r.status === 401) throw new ErrorSync('token', 'GitHub no reconoce el permiso guardado: venció o se borró. Hay que generar uno nuevo.' + m);
  if (r.status === 403 && /rate limit/i.test(m)) throw new ErrorSync('limite', 'GitHub limitó las consultas por un rato.' + m);
  if (r.status === 403 || r.status === 404) throw new ErrorSync('actions', SIN_ACTIONS + m);
  if (r.status === 429) throw new ErrorSync('limite', 'GitHub limitó las consultas por un rato.' + m);
  throw new ErrorSync('otro', `GitHub respondió ${r.status} al ${que}.` + m);
}

// ¿El permiso deja pedir precios? Devuelve null si sí, o el error si no.
export async function probarActions(gh, fetchFn = fetch) {
  try { await corridas(gh, fetchFn); return null; } catch (err) { return err; }
}

async function corridas({ repo, token }, fetchFn) {
  const r = await pedir(fetchFn, `${API}/repos/${repo}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=10`, { headers: cabeceras(token), cache: 'no-store' });
  await revisarActions(r, 'consultar las actualizaciones');
  return (await r.json()).workflow_runs || [];
}

// Lee los archivos de mercado directo de GitHub (la página publicada tarda en reflejarlos). Los que fallan quedan en null.
export async function leerArchivosMercado({ repo, token, rama = 'main' }, fetchFn = fetch) {
  const salida = {};
  await Promise.all(Object.entries(ARCHIVOS_MERCADO).map(async ([k, ruta]) => {
    try {
      const r = await fetchFn(`${API}/repos/${repo}/contents/${ruta}?ref=${rama}`, { headers: { ...cabeceras(token), Accept: 'application/vnd.github.raw+json' }, cache: 'no-store' });
      salida[k] = r.ok ? JSON.parse(await r.text()) : null;
    } catch { salida[k] = null; }
  }));
  return salida;
}

// Lanza la actualización, espera a que termine y devuelve los archivos nuevos.
// `alAvanzar(etapa)` recibe 'pedido', 'queued', 'in_progress' o 'leyendo'.
export async function actualizarMercado(gh, { fetchFn = fetch, esperar = ms => new Promise(ok => setTimeout(ok, ms)), alAvanzar = () => {}, vueltas = 36 } = {}) {
  const previas = new Set((await corridas(gh, fetchFn)).map(c => c.id)); // también comprueba el permiso antes de pedir nada
  const r = await pedir(fetchFn, urlDisparo(gh.repo), { method: 'POST', headers: cabeceras(gh.token), body: cuerpoDisparo('app', gh.rama) });
  await revisarActions(r, 'pedir precios');
  alAvanzar('pedido');
  for (let i = 0; i < vueltas; i++) {
    await esperar(i < 6 ? 4000 : 8000);
    const c = (await corridas(gh, fetchFn).catch(err => { if (err.codigo === 'red') return []; throw err; })).find(x => !previas.has(x.id));
    if (!c) continue;
    if (c.status !== 'completed') { alAvanzar(c.status); continue; }
    if (c.conclusion !== 'success') throw new ErrorSync('fallo', `La actualización terminó con error en GitHub (${c.conclusion}). Se siguen viendo los precios anteriores.`);
    alAvanzar('leyendo');
    return leerArchivosMercado(gh, fetchFn);
  }
  throw new ErrorSync('demora', 'GitHub todavía no terminó. Los precios nuevos van a aparecer solos la próxima vez que abras el tablero.');
}
