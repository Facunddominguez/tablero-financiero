// Arranque: desbloqueo, carga de datos, estado y navegación.
import { h, poner, fechas, uid, clon } from './util.js';
import { db } from './db.js';
import { derivarClave, descifrar, cifrar } from './cripto.js';
import { aplicarEventos, valuar, snapshotDe } from './estado.js';
import { planificador } from './motor.js';
import { vistaHoy } from './ui/hoy.js';
import { vistaCartera } from './ui/cartera.js';
import { vistaAportar } from './ui/aportar.js';
import { abrirMenu } from './ui/menu.js';

const VISTAS = [
  { id: 'hoy', nombre: 'Hoy', vista: vistaHoy },
  { id: 'cartera', nombre: 'Cartera', vista: vistaCartera },
  { id: 'aportar', nombre: 'Aportar', vista: vistaAportar },
];

const S = { sobre: null, clave: null, base: null, eventos: [], snaps: {}, ext: {}, estado: null, plan: null };
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

async function guardarSnapshot() {
  const base = S.base.meta.fecha_snapshot;
  if (!S.estado.datos.snapshots[base]) {
    const limpio = clon(S.base); limpio.eventos = [];
    S.snaps[base] = snapshotDe(valuar(aplicarEventos(limpio), {}, base));
  }
  S.snaps[S.estado.hoy] = snapshotDe(S.estado);
  S.estado.datos.snapshots = { ...S.estado.datos.snapshots, ...S.snaps };
  await db.guardar('snapshots', S.snaps).catch(() => {});
}

const ctx = {
  get estado() { return S.estado; },
  get plan() { return S.plan; },
  get pendientes() { const enArchivo = new Set((S.base.eventos || []).map(e => e.id)); return S.eventos.filter(e => !enArchivo.has(e.id)).length; },
  // Guarda uno o más eventos en este dispositivo y vuelve a calcular todo.
  async registrar(...eventos) {
    const ts = new Date().toISOString();
    eventos.forEach((e, i) => S.eventos.push({ id: uid(), ts: ts.slice(0, -1) + String(i).padStart(3, '0') + 'Z', ...e }));
    await db.guardar('eventos', S.eventos);
    recalcular(); await guardarSnapshot(); pintar();
  },
  menu: (seccion, arg) => abrirMenu(ctx, seccion, arg),
  ir: destino => { location.hash = destino; },
  // Estado completo para sincronizar: base + todos los eventos + snapshots.
  completo() {
    const d = clon(S.base);
    const vistos = new Set();
    d.eventos = [...(S.base.eventos || []), ...S.eventos].filter(e => !vistos.has(e.id) && vistos.add(e.id));
    d.snapshots = { ...(S.base.snapshots || {}), ...S.snaps };
    d.meta.sincronizado = new Date().toISOString();
    return d;
  },
  cifrarDatos: datos => cifrar(datos, S.clave, S.sobre.salt, S.sobre.iter),
  // Después de subir a GitHub: lo local ya está en el archivo publicado.
  async confirmarSincronizado(datos, sobre) {
    S.base = datos; S.sobre = sobre; S.eventos = [];
    await db.guardar('eventos', []); await db.borrar('base_local').catch(() => {});
    recalcular(); pintar();
  },
  // Reemplaza los datos base por un respaldo en JSON plano (queda solo en este dispositivo hasta sincronizar).
  async importarPlano(obj) {
    S.base = obj; S.eventos = []; S.snaps = {};
    await db.guardar('base_local', { datos: obj, guardado: new Date().toISOString() });
    await db.guardar('eventos', []); await db.guardar('snapshots', {});
    recalcular(); await guardarSnapshot(); pintar();
  },
  async olvidarClave() { await db.borrar('clave'); location.reload(); },
  async cambiarClave(frase) { // misma información, cifrada con otra frase (hay que sincronizar después)
    const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    S.clave = await derivarClave(frase, salt, S.sobre.iter);
    S.sobre = { ...S.sobre, salt };
    if (await db.leer('clave')) await db.guardar('clave', { clave: S.clave, salt });
  },
  aplicarTema, repintar: () => pintar(),
};

// ---------- pantalla de clave ----------
function pantallaClave(mensaje) {
  const campo = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Clave', 'aria-label': 'Clave', required: true });
  const recordar = h('input', { type: 'checkbox', checked: true });
  const error = h('p.error', { role: 'alert' }, mensaje || '');
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
          if (recordar.checked) await db.guardar('clave', { clave, salt: S.sobre.salt }).catch(() => {});
          await cargarTodo();
        } catch {
          error.textContent = 'Esa clave no abre los datos. Probá de nuevo.';
          btn.disabled = false; btn.textContent = 'Abrir'; campo.select();
        }
      },
    },
      h('p.puerta-marca', 'Tablero'),
      h('h1', 'Tus datos están cifrados'),
      h('p.nota', 'Escribí la clave para verlos. Se descifran en este dispositivo; nada sale de acá.'),
      campo,
      h('label.casilla', recordar, h('span', 'Recordar en este dispositivo'), h('small', 'No lo marques si el dispositivo no es tuyo.')),
      error, btn)));
  campo.focus();
}

// ---------- carga ----------
async function cargarTodo() {
  const [eventos, snaps, local, mercado, calendario, insiders, historico] = await Promise.all([
    db.leer('eventos').catch(() => null), db.leer('snapshots').catch(() => null), db.leer('base_local').catch(() => null),
    json('data/market.json'), json('data/calendario.json'), json('data/insiders.json'), json('data/historico.json'),
  ]);
  // Un respaldo importado manda hasta que el archivo del repositorio sea más nuevo.
  if (local && (!S.base.meta.sincronizado || S.base.meta.sincronizado < local.guardado)) S.base = local.datos;
  else if (local) await db.borrar('base_local').catch(() => {});
  const enArchivo = new Set((S.base.eventos || []).map(e => e.id));
  S.eventos = (eventos || []).filter(e => !enArchivo.has(e.id)); // lo ya sincronizado no se duplica
  S.snaps = snaps || {};
  S.ext = { mercado, calendario, insiders, historico };
  recalcular();
  await guardarSnapshot();
  armarMarco();
  pintar();
}

// ---------- marco y navegación ----------
let principal, nav;
function armarMarco() {
  principal = h('main#principal', { tabindex: '-1' });
  nav = h('nav.nav', { 'aria-label': 'Secciones' });
  poner(raiz, 
    h('header.barra', h('a.marca', { href: '#hoy' }, 'Tablero'), nav,
      h('button.icono.mas', { type: 'button', 'aria-label': 'Más opciones', onclick: () => abrirMenu(ctx) }, '⋯')),
    principal,
    h('footer.pie', 'Herramienta personal de seguimiento. No es asesoramiento financiero.'));
}

function pintar() {
  const [id, sub] = (location.hash.replace('#', '') || 'hoy').split('/');
  const v = VISTAS.find(x => x.id === id) || VISTAS[0];
  poner(nav, ...VISTAS.map(x => h('a', { href: '#' + x.id, 'aria-current': x === v ? 'page' : null }, x.nombre)));
  const pend = ctx.pendientes;
  document.querySelector('.mas').classList.toggle('con-punto', pend > 0);
  document.querySelector('.mas').title = pend ? `${pend} ${pend === 1 ? 'cambio' : 'cambios'} sin sincronizar` : 'Más opciones';
  poner(principal, v.vista(ctx, sub));
  document.title = v.id === 'hoy' ? 'Tablero' : `${v.nombre} · Tablero`;
}
window.addEventListener('hashchange', () => { if (S.estado) { pintar(); window.scrollTo(0, 0); } });

async function iniciar() {
  poner(raiz, h('p.cargando', 'Cargando…'));
  S.sobre = await json('data/cartera.enc.json');
  if (!S.sobre) { poner(raiz, h('main.puerta', h('p.error', 'No se pudieron cargar los datos. Revisá la conexión y recargá la página.'))); return; }
  const guardada = await db.leer('clave').catch(() => null);
  if (guardada && guardada.salt === S.sobre.salt) {
    try { S.base = await descifrar(S.sobre, guardada.clave); S.clave = guardada.clave; } catch { /* la clave guardada ya no sirve */ }
  }
  if (S.base) await cargarTodo(); else pantallaClave();
}

export { ctx, S, iniciar };
if (!window.__SIN_ARRANQUE) iniciar();
