// Página de pruebas: descifra los datos y corre js/pruebas.js en el navegador.
import { h } from './util.js';
import { db } from './db.js';
import { derivarClave, descifrar } from './cripto.js';
import { correrPruebas } from './pruebas.js';

const salida = document.getElementById('salida');
const json = url => fetch(url, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
const sobre = await json('data/cartera.enc.json');

async function correr(base) {
  const [calendario, historico] = await Promise.all([json('data/calendario.json'), json('data/historico.json')]);
  const asincronicas = [];
  const res = correrPruebas(base, { calendario, historico, asincronicas });
  for (const [nombre, fn] of asincronicas) { try { await fn(); res.push({ nombre, ok: true, detalle: '' }); } catch (err) { res.push({ nombre, ok: false, detalle: String(err.message || err) }); } }
  const bien = res.filter(r => r.ok).length;
  window.__resultado = { total: res.length, bien, fallas: res.filter(r => !r.ok).map(r => r.nombre + ': ' + r.detalle) };
  salida.replaceChildren(
    h('p.' + (bien === res.length ? 'aviso' : 'aviso.mal'), { id: 'resumen' }, bien === res.length ? `Pasan las ${res.length} pruebas.` : `Fallan ${res.length - bien} de ${res.length} pruebas.`),
    h('ul.pruebas', { style: 'margin-top:1.25rem' }, res.map(r => h('li' + (r.ok ? '' : '.falla'), h('span', r.ok ? '✓' : '✗'), h('div', r.nombre, r.detalle ? h('small', r.detalle) : null)))));
}

function pedirClave(mensaje) {
  const campo = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Clave', 'aria-label': 'Clave' });
  salida.replaceChildren(h('form.formulario', { style: 'max-width:22rem', onsubmit: async ev => {
    ev.preventDefault();
    try { await correr(await descifrar(sobre, await derivarClave(campo.value, sobre.salt, sobre.iter))); }
    catch { pedirClave('Esa clave no abre los datos.'); }
  } }, h('p.nota', 'Escribí la clave para correr las pruebas.'), campo, h('p.error', mensaje || ''), h('button.boton.primario', { type: 'submit' }, 'Correr pruebas')));
}

if (!sobre) salida.replaceChildren(h('p.aviso.mal', 'No se pudo cargar data/cartera.enc.json.'));
else {
  const guardada = await db.leer('clave').catch(() => null);
  let base = null;
  if (guardada && guardada.salt === sobre.salt) { try { base = await descifrar(sobre, guardada.clave); } catch { /* pide la clave */ } }
  if (base) await correr(base); else pedirClave();
}
