// Arranque: desbloqueo, carga de datos, estado, sincronización y navegación.
import { h, poner, fechas, fmt, uid, clon } from './util.js';
import { db } from './db.js';
import { derivarClave, descifrar, cifrar } from './cripto.js';
import { guardarCifrado, leerCifrado, bloqueo } from './seguridad.js';
import { sincronizar, leerRemoto, repoDeUbicacion } from './sync.js';
import { aplicarEventos, valuar, snapshotDe } from './estado.js';
import { planificador } from './motor.js';
import { vistaHoy } from './ui/hoy.js';
import { vistaCartera } from './ui/cartera.js';
import { vistaAportar } from './ui/aportar.js';
import { vistaInformes } from './ui/informes.js';
import { vistaRadar } from './ui/radar.js';
import { abrirMenu } from './ui/menu.js';

const VISTAS = [
  { id: 'hoy', nombre: 'Hoy', vista: vistaHoy },
  { id: 'cartera', nombre: 'Cartera', vista: vistaCartera },
  { id: 'aportar', nombre: 'Aportar', vista: vistaAportar },
  { id: 'informes', nombre: 'Informes', vista: vistaInformes },
  { id: 'radar', nombre: 'Radar', vista: vistaRadar },
];
const LOCALES = ['eventos', 'snapshots', 'base_local', 'github', 'sync'];

const S = {
  sobre: null, clave: null, base: null, eventos: [], snaps: {}, ext: {}, estado: null, plan: null,
  gh: null,            // { repo, token }: permiso para guardar en GitHub (en memoria, descifrado)
  localManda: false,   // hay un respaldo importado que todavía no se subió
  sync: { fecha: null, ids: new Set(), error: null, enCurso: false },
  aviso: null,
};
const raiz = document.getElementById('app');
const json = (url) => fetch(url, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);

// ---------- tema ----------
export function aplicarTema(t) {
  if (t === 'claro' || t === 'oscuro') document.documentElement.dataset.tema = t; else delete document.documentElement.dataset.tema;
  try { t ? localStorage.setItem('tema', t) : localStorage.removeItem('tema'); } catch { /* sin almacenamiento */ }
}
try { aplicarTema(localStorage.getItem('tema')); } catch { /* sin almacenamiento */ }

// ---------- estado ----------
function recalcular() {
  const datos = aplicarEventos(S.base, S.eventos);
  Object.assign(datos.snapshots, S.snaps);
  S.estado = valuar(datos, S.ext, fechas.hoy());
  S.plan = planificador(S.estado, S.estado.hoy);
}
const persistir = (k, v) => guardarCifrado(k, v, S.clave, S.sobre.salt).catch(() => {});

async function guardarSnapshot() {
  const base = S.base.meta.fecha_snapshot;
  if (!S.estado.datos.snapshots[base]) {
    const limpio = clon(S.base); limpio.eventos = [];
    S.snaps[base] = snapshotDe(valuar(aplicarEventos(limpio), {}, base));
  }
  S.snaps[S.estado.hoy] = snapshotDe(S.estado);
  S.estado.datos.snapshots = { ...S.estado.datos.snapshots, ...S.snaps };
  await persistir('snapshots', S.snaps);
}

// Lo que ya está en el archivo publicado deja de guardarse aparte en este dispositivo.
function podar() {
  const enArchivo = new Set((S.base.eventos || []).map(e => e.id));
  const antes = S.eventos.length;
  S.eventos = S.eventos.filter(e => !enArchivo.has(e.id));
  return antes !== S.eventos.length;
}

// ---------- sincronización ----------
let temporizador;
function programarSync() {
  if (!S.gh) return;
  clearTimeout(temporizador);
  temporizador = setTimeout(() => ctx.sincronizarAhora().catch(() => {}), 4000);
}

// Trae la copia más nueva directo de GitHub: la página publicada puede tardar varios minutos en actualizarse.
async function refrescarRemoto() {
  const repo = S.gh?.repo || repoDeUbicacion();
  if (!repo || S.localManda) return;
  try {
    const { sobre } = await leerRemoto({ repo, token: S.gh?.token });
    if (sobre.iv === S.sobre.iv || sobre.salt !== S.sobre.salt) return;
    S.base = await descifrar(sobre, S.clave); S.sobre = sobre;
    if (podar()) await persistir('eventos', S.eventos);
    recalcular(); await guardarSnapshot(); pintar();
  } catch (err) { if (err.codigo === 'token') { S.sync.error = err.message; pintarSync(); } }
}

const ctx = {
  get estado() { return S.estado; },
  get plan() { return S.plan; },
  get permiso() { return S.gh ? { repo: S.gh.repo } : null; },
  get repoSugerido() { return S.gh?.repo || repoDeUbicacion(); },
  // Cambios que solo existen en este dispositivo.
  get pendientes() { const enArchivo = new Set((S.base.eventos || []).map(e => e.id)); return S.eventos.filter(e => !enArchivo.has(e.id) && !S.sync.ids.has(e.id)).length; },
  // Estado de la sincronización en una frase, para mostrar siempre lo mismo en todos lados.
  get sync() {
    const n = ctx.pendientes;
    if (S.sync.enCurso) return { clase: 'neutro', texto: 'Sincronizando…' };
    if (S.sync.error) return { clase: 'mal', texto: `No se pudo sincronizar: ${S.sync.error}`, n };
    if (!S.gh) return n ? { clase: 'alerta', texto: `${n} ${n === 1 ? 'cambio guardado' : 'cambios guardados'} solo en este dispositivo`, n } : { clase: 'neutro', texto: 'Este dispositivo todavía no sincroniza', n };
    if (n) return { clase: 'alerta', texto: `${n} ${n === 1 ? 'cambio' : 'cambios'} sin subir`, n };
    return { clase: 'ok', texto: S.sync.fecha ? `Sincronizado ${fmt.hace(S.sync.fecha)}` : 'Sincronización activada', n };
  },
  // Guarda uno o más eventos en este dispositivo, vuelve a calcular todo y los sube si hay permiso.
  async registrar(...eventos) {
    const ts = new Date().toISOString();
    eventos.forEach((e, i) => S.eventos.push({ id: uid(), ts: ts.slice(0, -1) + String(i).padStart(3, '0') + 'Z', ...e }));
    await guardarCifrado('eventos', S.eventos, S.clave, S.sobre.salt);
    recalcular(); await guardarSnapshot(); pintar();
    programarSync();
  },
  menu: (seccion, arg) => abrirMenu(ctx, seccion, arg),
  ir: destino => { location.hash = destino; },
  // Estado completo de este dispositivo: base + todos los eventos + valores diarios.
  completo() {
    const d = clon(S.base);
    const vistos = new Set();
    d.eventos = [...(S.base.eventos || []), ...S.eventos].filter(e => !vistos.has(e.id) && vistos.add(e.id));
    d.snapshots = { ...(S.base.snapshots || {}), ...S.snaps };
    d.meta.sincronizado = new Date().toISOString();
    return d;
  },
  cifrarDatos: datos => cifrar(datos, S.clave, S.sobre.salt, S.sobre.iter),

  // Lee lo último de GitHub, lo une con lo local y lo sube. Si falla, lo local queda intacto.
  async sincronizarAhora(opciones = {}) {
    if (!S.gh) throw new Error('Falta activar la sincronización en este dispositivo.');
    if (S.sync.enCurso) return null;
    const claveNueva = opciones.claveNueva; // { clave, salt } al cambiar la clave
    S.sync.enCurso = true; pintarSync();
    try {
      const r = await sincronizar({
        gh: S.gh, local: ctx.completo(), localManda: S.localManda,
        abrir: sobre => sobre.salt === S.sobre.salt ? descifrar(sobre, S.clave).catch(() => null) : null,
        cerrar: datos => claveNueva ? cifrar(datos, claveNueva.clave, claveNueva.salt, S.sobre.iter) : cifrar(datos, S.clave, S.sobre.salt, S.sobre.iter),
      });
      if (claveNueva) { S.clave = claveNueva.clave; if (await db.leer('clave').catch(() => null)) await db.guardar('clave', { clave: S.clave, salt: claveNueva.salt }); }
      S.base = r.datos; S.sobre = r.sobre; S.localManda = false;
      S.sync = { fecha: new Date().toISOString(), ids: new Set(r.datos.eventos.map(e => e.id)), error: null, enCurso: false };
      await db.borrar('base_local').catch(() => {});
      await persistir('sync', { fecha: S.sync.fecha, ids: [...S.sync.ids] });
      if (claveNueva) { await persistir('eventos', S.eventos); await persistir('snapshots', S.snaps); await persistir('github', S.gh); }
      if (r.recibidos > 0) { recalcular(); await guardarSnapshot(); pintar(); } else pintarSync();
      return r;
    } catch (err) {
      S.sync.enCurso = false; S.sync.error = err.message || 'Error inesperado.'; pintarSync();
      throw err;
    }
  },
  // Prueba el permiso haciendo una sincronización real; solo se guarda si funcionó.
  async guardarPermiso(repo, token) {
    const anterior = S.gh;
    S.gh = { repo, token }; S.sync.error = null;
    try { await ctx.sincronizarAhora(); await guardarCifrado('github', S.gh, S.clave, S.sobre.salt); }
    catch (err) { S.gh = anterior; S.sync.error = null; pintarSync(); throw err; }
  },
  async borrarPermiso() { S.gh = null; S.sync.error = null; await db.borrar('github'); pintarSync(); },

  // Reemplaza los datos base por un respaldo en JSON plano (queda en este dispositivo hasta sincronizar).
  async importarPlano(obj) {
    S.base = obj; S.eventos = []; S.snaps = {}; S.localManda = true; S.sync.ids = new Set();
    await guardarCifrado('base_local', { datos: obj, guardado: new Date().toISOString() }, S.clave, S.sobre.salt);
    await persistir('eventos', []); await persistir('snapshots', {});
    recalcular(); await guardarSnapshot(); pintar(); programarSync();
  },
  // Cambia la frase: se vuelve a cifrar todo y se sube en el mismo paso. Si la subida falla, no cambia nada.
  async cambiarClave(frase) {
    if (!S.gh) throw new Error('Para cambiar la clave primero activá la sincronización: el archivo publicado tiene que cambiar en el mismo momento.');
    const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    const clave = await derivarClave(frase, salt, S.sobre.iter);
    await ctx.sincronizarAhora({ claveNueva: { clave, salt } });
  },
  bloquear: motivo => bloquear(motivo),
  // Borra de este dispositivo la clave, el permiso de GitHub y todo lo guardado localmente.
  async olvidarDispositivo() {
    for (const k of ['clave', ...LOCALES]) await db.borrar(k).catch(() => {});
    bloqueo.marcar(false);
    location.hash = ''; location.reload();
  },
  aplicarTema, repintar: () => pintar(),
};

function bloquear(motivo) {
  if (!S.base) return;
  bloqueo.marcar(true);
  clearTimeout(temporizador);
  Object.assign(S, { clave: null, base: null, eventos: [], snaps: {}, estado: null, plan: null, gh: null });
  document.querySelectorAll('dialog').forEach(d => d.close());
  pantallaClave(motivo || 'Bloqueado. Escribí la clave para seguir.');
}

// ---------- pantalla de clave ----------
function pantallaClave(mensaje) {
  const campo = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Clave', 'aria-label': 'Clave', required: true });
  const ver = h('button.fantasma-texto', { type: 'button', onclick: () => { campo.type = campo.type === 'password' ? 'text' : 'password'; ver.textContent = campo.type === 'password' ? 'Mostrar' : 'Ocultar'; } }, 'Mostrar');
  const bloqueado = bloqueo.activo(); // al desbloquear no se toca lo que el dispositivo ya recordaba
  const recordar = h('input', { type: 'checkbox', checked: true });
  const error = h('p.error', { role: 'alert' });
  const btn = h('button.boton.primario', { type: 'submit' }, 'Abrir');
  poner(raiz, h('main.puerta',
    h('form', {
      onsubmit: async ev => {
        ev.preventDefault();
        btn.disabled = true; btn.textContent = 'Abriendo…'; error.textContent = '';
        try {
          const clave = await derivarClave(campo.value, S.sobre.salt, S.sobre.iter);
          S.base = await descifrar(S.sobre, clave);
          S.clave = clave;
          if (!bloqueado) {
            if (recordar.checked) await db.guardar('clave', { clave, salt: S.sobre.salt }).catch(() => {});
            else await db.borrar('clave').catch(() => {});
          }
          bloqueo.marcar(false);
          await cargarTodo(campo.value);
        } catch {
          error.textContent = 'Esa clave no abre los datos. Probá de nuevo.';
          btn.disabled = false; btn.textContent = 'Abrir'; campo.select();
        }
      },
    },
      h('p.puerta-marca', 'Tablero'),
      h('h1', mensaje ? 'Tablero bloqueado' : 'Tus datos están cifrados'),
      h('p.nota', mensaje || 'Escribí la clave para verlos. Se descifran en este dispositivo; la clave no se envía a ningún lado.'),
      h('div.campo-clave', campo, ver),
      bloqueado ? null : h('label.casilla', recordar, h('span', 'Recordar en este dispositivo'), h('small', 'No lo marques si el dispositivo no es tuyo.')),
      error, btn)));
  campo.focus();
}

// ---------- carga ----------
// Lee lo guardado en este dispositivo. Si algo quedó cifrado con una clave anterior, intenta abrirlo con la misma frase.
async function leerLocal(k, frase) {
  let r = await leerCifrado(k, S.clave).catch(() => null);
  if (r?.ilegible && frase && r.salt && r.salt !== S.sobre.salt) {
    const vieja = await derivarClave(frase, r.salt, S.sobre.iter).catch(() => null);
    if (vieja) r = await leerCifrado(k, vieja).catch(() => null);
  }
  if (r?.ilegible) { // no se pudo abrir: se aparta sin borrarlo
    await db.guardar(k + '_sin_abrir', await db.leer(k)).catch(() => {});
    await db.borrar(k).catch(() => {});
    S.aviso = 'En este dispositivo había cambios guardados con una clave anterior y no se pudieron abrir. Quedaron apartados, no se borraron.';
    return null;
  }
  if (r?.enClaro && r.valor != null) await persistir(k, r.valor); // migra el formato viejo
  return r ? r.valor : null;
}

let vigilando = false;
async function cargarTodo(frase) {
  const [mercado, calendario, insiders, historico] = await Promise.all([json('data/market.json'), json('data/calendario.json'), json('data/insiders.json'), json('data/historico.json')]);
  const [eventos, snaps, local, gh, sync] = [await leerLocal('eventos', frase), await leerLocal('snapshots', frase), await leerLocal('base_local', frase), await leerLocal('github', frase), await leerLocal('sync', frase)];
  // Un respaldo importado manda hasta que se suba.
  S.localManda = !!(local && (!S.base.meta.sincronizado || S.base.meta.sincronizado < local.guardado));
  if (S.localManda) S.base = local.datos; else if (local) await db.borrar('base_local').catch(() => {});
  S.eventos = eventos || []; podar();
  S.snaps = snaps || {};
  S.gh = gh?.token ? gh : null;
  S.sync = { fecha: sync?.fecha || null, ids: new Set(sync?.ids || []), error: null, enCurso: false };
  S.ext = { mercado, calendario, insiders, historico };
  recalcular();
  await guardarSnapshot();
  armarMarco();
  pintar();
  if (!vigilando) { vigilando = true; bloqueo.vigilar(() => bloquear('Se bloqueó por inactividad. Escribí la clave para seguir.')); }
  refrescarRemoto().then(() => { if (ctx.pendientes) programarSync(); });
}

// ---------- marco y navegación ----------
let principal, nav;
function armarMarco() {
  principal = h('main#principal', { tabindex: '-1' });
  nav = h('nav.nav', { 'aria-label': 'Secciones' });
  poner(raiz,
    h('header.barra', h('a.marca', { href: '#hoy' }, 'Tablero'), nav,
      h('button.icono.mas', { type: 'button', 'aria-label': 'Más opciones', onclick: () => abrirMenu(ctx) }, '⋯')),
    principal);
}

// Actualiza solo los indicadores de sincronización (sin redibujar la pantalla, para no interrumpir lo que se esté escribiendo).
function pintarSync() {
  if (!S.estado) return;
  const s = ctx.sync, mas = document.querySelector('.mas');
  if (mas) { mas.classList.toggle('con-punto', s.clase === 'alerta' || s.clase === 'mal'); mas.classList.toggle('punto-mal', s.clase === 'mal'); mas.title = s.texto; }
  document.querySelectorAll('[data-sync]').forEach(el => { el.textContent = s.texto; el.className = `linea-sync ${s.clase}`; });
}

function pintar() {
  const [id, sub] = (location.hash.replace('#', '') || 'hoy').split('/');
  const v = VISTAS.find(x => x.id === id) || VISTAS[0];
  poner(nav, ...VISTAS.map(x => h('a', { href: '#' + x.id, 'aria-current': x === v ? 'page' : null }, x.nombre)));
  poner(principal, S.aviso ? h('p.aviso.alerta.aviso-global', S.aviso) : null, v.vista(ctx, sub));
  document.title = v.id === 'hoy' ? 'Tablero' : `${v.nombre} · Tablero`;
  pintarSync();
}
window.addEventListener('hashchange', () => { if (S.estado) { pintar(); window.scrollTo(0, 0); } });
window.addEventListener('online', () => { if (S.estado && ctx.pendientes) programarSync(); });

async function iniciar() {
  poner(raiz, h('p.cargando', 'Cargando…'));
  // Primero la copia directa de GitHub (siempre al día); si no se puede, la de la página publicada.
  const repo = repoDeUbicacion();
  if (repo) S.sobre = await Promise.race([leerRemoto({ repo }).then(r => r.sobre), new Promise(ok => setTimeout(() => ok(null), 4000))]).catch(() => null);
  if (!S.sobre) S.sobre = await json('data/cartera.enc.json');
  if (!S.sobre) { poner(raiz, h('main.puerta', h('p.error', 'No se pudieron cargar los datos. Revisá la conexión y recargá la página.'))); return; }
  if (bloqueo.activo()) return pantallaClave('Bloqueado. Escribí la clave para seguir.');
  const guardada = await db.leer('clave').catch(() => null);
  if (guardada && guardada.salt === S.sobre.salt) {
    try { S.base = await descifrar(S.sobre, guardada.clave); S.clave = guardada.clave; } catch { /* la clave guardada ya no sirve */ }
  }
  if (S.base) await cargarTodo(); else pantallaClave();
}

export { ctx, S, iniciar };
if (!globalThis.__SIN_ARRANQUE) iniciar();
