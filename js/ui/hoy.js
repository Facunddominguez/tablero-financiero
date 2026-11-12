// Pantalla Hoy: estado en una línea, próximos pasos e indicadores.
import { h, fmt, fechas, aNumero } from '../util.js';
import { dialogo, campo, entrada, boton, chip, medidor, dialogoCompras, signoClase, NIVEL, proximaFecha } from './comun.js';

function antiguedad(e) {
  if (e.precios.origen === 'archivo') return `precios del resumen del ${fmt.fecha(e.precios.fecha_archivo)}`;
  const partes = [`precios actualizados ${fmt.hace(e.precios.generado)}`];
  if (e.precios.viejos.length) partes.push(`sin actualizar: ${e.precios.viejos.join(', ')}`);
  return partes.join(' · ');
}

function estadoLinea(ctx) {
  const e = ctx.estado;
  return h('section.estado',
    h('p.estado-etq', 'Patrimonio'),
    h('p.estado-total', h('span.moneda', 'USD'), fmt.num(e.total_usd)),
    h('p.estado-detalle',
      h('span.' + (signoClase(e.var_dia_usd) || 'plano'), `${fmt.usdSigno(e.var_dia_usd)} hoy (${fmt.pctSigno(e.var_dia_pct, 2)})`),
      h('span.sep', '·'), h('span', `${fmt.ars(e.total_ars)} a MEP ${fmt.num(e.mep, 2)}`)),
    h('p.estado-fuente',
      h('button.enlace', { type: 'button', title: 'Ver de dónde sale cada dato', onclick: () => ctx.menu('fuentes') }, antiguedad(e)),
      h('span.sep', ' · '),
      h('button.linea-sync.' + ctx.sync.clase, { type: 'button', dataset: { sync: '1' }, onclick: () => ctx.menu('sincronizar') }, ctx.sync.texto)));
}

// --- acciones de un paso ---
function hecho(ctx, paso) {
  const e = ctx.estado, a = paso.accion || {};
  const marcar = (nota) => ctx.registrar({ tipo: 'paso', paso_id: paso.id, estado: 'hecho', titulo: paso.titulo, fecha: e.hoy, nota });
  if (a.tipo === 'aporte' || a.tipo === 'compra')
    return dialogoCompras(ctx, { titulo: a.tipo === 'aporte' ? 'Registrar el aporte' : 'Registrar la reinversión', compras: a.compras, usd: a.usd, externo: a.tipo === 'aporte', paso });
  if (a.tipo === 'importar') return ctx.menu('importar');
  if (a.tipo === 'cobro' || a.tipo === 'suscripcion' || a.tipo === 'fecha_aporte') {
    const fFecha = entrada({ type: 'date', inputmode: null, value: a.tipo === 'fecha_aporte' ? a.fecha : e.hoy, max: e.hoy });
    const fUsd = entrada({ value: fmt.num(a.usd, 2) });
    const pos = e.posiciones.find(p => p.ticker === a.ticker);
    const error = h('p.error', { role: 'alert' });
    const titulo = { cobro: 'Registrar el cobro', suscripcion: 'Registrar la suscripción', fecha_aporte: 'Fecha del aporte' }[a.tipo];
    const d = dialogo(titulo, h('form.formulario', {
      onsubmit: async ev => {
        ev.preventDefault();
        const usd = aNumero(fUsd.value), fecha = fFecha.value;
        if (!fecha || (a.tipo !== 'fecha_aporte' && !(usd > 0))) { error.textContent = 'Completá la fecha y el monto.'; return; }
        const evento = a.tipo === 'cobro' ? { tipo: 'cobro', fecha, ticker: a.ticker, clase: a.clase, usd, ref: a.ref }
          : a.tipo === 'suscripcion' ? { tipo: 'aporte', fecha, usd, mep: e.mep, compras: [{ ticker: a.ticker, cantidad: usd / pos.precio, precio: pos.precio, moneda: pos.moneda, gastos: 0 }] }
            : { tipo: 'fecha_aporte', indice: a.indice, fecha };
        await ctx.registrar(evento, { tipo: 'paso', paso_id: paso.id, estado: 'hecho', titulo: paso.titulo, fecha: e.hoy });
        d.close();
      },
    },
      h('div.fila-campos', campo(a.tipo === 'fecha_aporte' ? 'Fecha exacta de la transferencia' : 'Fecha', fFecha),
        a.tipo === 'fecha_aporte' ? null : campo(a.tipo === 'cobro' ? 'Te acreditaron (USD)' : 'Suscribiste (USD)', fUsd)),
      error, h('div.acciones', boton('Cancelar', () => d.close(), 'fantasma'), h('button.boton.primario', { type: 'submit' }, 'Guardar'))));
    return d;
  }
  return marcar();
}

function posponer(ctx, paso) {
  const e = ctx.estado;
  const hasta = dias => ctx.registrar({ tipo: 'paso', paso_id: paso.id, estado: 'pospuesto', hasta: fechas.sumar(e.hoy, dias), titulo: paso.titulo, fecha: e.hoy }).then(() => d.close());
  const d = dialogo('Posponer', h('div.formulario', h('p.nota', paso.titulo),
    h('div.acciones.apiladas', boton('Hasta mañana', () => hasta(1)), boton('Tres días', () => hasta(3)), boton('Una semana', () => hasta(7)))), { ancho: '22rem' });
}

function descartar(ctx, paso) {
  const nota = entrada({ inputmode: 'text', placeholder: 'Motivo (opcional)' });
  const d = dialogo('Descartar este paso', h('form.formulario', {
    onsubmit: async ev => { ev.preventDefault(); await ctx.registrar({ tipo: 'paso', paso_id: paso.id, estado: 'descartado', titulo: paso.titulo, fecha: ctx.estado.hoy, nota: nota.value.trim() || undefined }); d.close(); },
  }, h('p.nota', `"${paso.titulo}" no vuelve a aparecer. Queda anotado en el registro de decisiones.`), campo('¿Por qué?', nota),
    h('div.acciones', boton('Cancelar', () => d.close(), 'fantasma'), h('button.boton.primario', { type: 'submit' }, 'Descartar'))), { ancho: '26rem' });
}

function tarjetaPaso(ctx, paso, n) {
  const visto = () => ctx.registrar({ tipo: 'paso', paso_id: paso.id, estado: 'descartado', titulo: paso.titulo, fecha: ctx.estado.hoy, nota: 'visto' });
  return h('li.paso' + (paso.informativo ? '.informativo' : ''),
    h('span.paso-n', { 'aria-hidden': 'true' }, paso.informativo ? '·' : n),
    h('div.paso-cuerpo',
      paso.etiqueta ? chip(paso.etiqueta, 'neutro') : null,
      h('h3', paso.titulo),
      h('p.paso-porque', paso.porque),
      paso.como.length ? h('ol.paso-como', paso.como.map(c => h('li', c))) : null,
      h('div.paso-botones',
        paso.informativo ? boton('Visto', visto, 'chico')
          : [boton('Hecho', () => hecho(ctx, paso), 'primario.chico'),
            paso.accion?.tipo === 'ir' ? h('a.boton.chico', { href: paso.accion.destino }, paso.accion.etiqueta) : null,
            paso.accion?.extra ? h('a.boton.chico', { href: paso.accion.extra.destino }, paso.accion.extra.etiqueta) : null,
            paso.accion?.tipo === 'menu' ? boton(paso.accion.etiqueta, () => ctx.menu(paso.accion.seccion, paso.accion.arg), 'chico') : null,
            boton('Posponer', () => posponer(ctx, paso), 'fantasma.chico'), boton('Descartar', () => descartar(ctx, paso), 'fantasma.chico')])));
}

function indicadores(e) {
  const d = e.datos, [nMin, nMax] = d.nucleo.rango_LP, R6 = d.reglas.find(r => r.id === 'R6');
  const ind = (titulo, valor, meta, med) => h('div.indicador', h('p.indicador-etq', titulo), h('p.indicador-valor', valor), med, h('p.indicador-meta', meta));
  return h('section.indicadores', { 'aria-label': 'Indicadores' },
    ind('Núcleo en largo plazo', fmt.pct(e.nucleo_lp), `objetivo ${fmt.pct(d.nucleo.peso_en_LP_objetivo, 0)} · rango ${fmt.pct(nMin, 0)}–${fmt.pct(nMax, 0)}`,
      medidor({ valor: e.nucleo_lp, objetivo: d.nucleo.peso_en_LP_objetivo, rango: [nMin, nMax], max: 1, estado: e.nucleo_lp < nMin ? 'alerta' : 'ok' })),
    ind('Fondo de emergencia', fmt.num(e.meses_emergencia, 1) + ' meses', `objetivo ${d.emergencia.meses_obj} meses · ${fmt.usd(e.emergencia_usd)} de ${fmt.usd(d.emergencia.objetivo_usd)}`,
      medidor({ valor: e.meses_emergencia, objetivo: d.emergencia.meses_obj, rango: [d.emergencia.meses_min, d.emergencia.meses_obj * 4 / 3], max: d.emergencia.meses_obj * 4 / 3, estado: e.meses_emergencia < d.emergencia.meses_min ? 'mal' : 'ok' })),
    ind('YPF consolidada', fmt.pct(e.ypf_lp), `objetivo ${fmt.pct(R6?.objetivo ?? 0.1, 0)} de largo plazo · bono + acción`,
      medidor({ valor: e.ypf_lp, objetivo: R6?.objetivo ?? 0.1, max: 0.3, estado: e.ypf_lp > (R6?.objetivo ?? 0.1) ? 'alerta' : 'ok' })));
}

function vigentes(plan) {
  if (!plan.vigentes.length) return null;
  return h('section.vigentes',
    h('h2', 'Reglas que mandan hoy'),
    h('p.nota', 'No son tareas: ya están aplicadas en los pasos de arriba y en la calculadora de aportes.'),
    h('ul', plan.vigentes.map(r => h('li',
      h('span.regla-id', r.id), h('div', h('p.regla-accion', r.accion || r.politica), h('p.regla-detalle', r.detalle)),
      chip(NIVEL[r.nivel][0], NIVEL[r.nivel][1])))));
}

export function vistaHoy(ctx) {
  const e = ctx.estado, plan = ctx.plan;
  const tareas = plan.pasos.filter(p => !p.informativo), avisos = plan.pasos.filter(p => p.informativo);
  let n = 0;
  return h('div.vista.hoy',
    estadoLinea(ctx),
    h('section.pasos',
      h('h2', 'Próximos pasos'),
      tareas.length
        ? h('ol.lista-pasos', tareas.map(p => tarjetaPaso(ctx, p, ++n)))
        : h('div.todo-en-orden', h('p.todo-titulo', 'Todo en orden.'),
          plan.proxima ? h('p', `Próxima acción: ${proximaFecha(plan.proxima.fecha)}, ${plan.proxima.texto}.`) : null),
      avisos.length ? [h('h2.sub', 'Para saber'), h('ol.lista-pasos', avisos.map(p => tarjetaPaso(ctx, p)))] : null),
    indicadores(e),
    vigentes(plan));
}
