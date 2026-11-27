// Calendario en pantalla: los próximos 14 días en Hoy ("Para saber") y 90 días en Informes.
import { h, fmt, fechas } from '../util.js';
import { agendaProxima, calendarioPorVencer, fechaCorta, TIPOS, DIAS_HOY, DIAS_INFORME } from '../calendario.js';
import { tabla, chip, aviso } from './comun.js';

const MAXIMO_HOY = 6;
const linea = x => h('li', h('span.num.cuando', fechaCorta(x)), h('span', x.titulo, x.movimiento != null ? ` · opciones ±${fmt.pct(x.movimiento)}` : ''));

// Una línea plegable en "Para saber": lo que viene en los próximos 14 días. null si no hay nada.
export function lineaCalendario(e) {
  const lista = agendaProxima(e, DIAS_HOY);
  if (!lista.length) return null;
  const resto = lista.length - MAXIMO_HOY;
  return h('li.linea-contexto.proximos', h('span.punto.acento', { 'aria-hidden': 'true' }), h('details',
    h('summary', `Próximos ${DIAS_HOY} días: ${lista.length === 1 ? 'un evento' : `${lista.length} eventos`}. Primero: ${lista[0].titulo} (${fechaCorta(lista[0])})`),
    h('ul.agenda', lista.slice(0, MAXIMO_HOY).map(linea)),
    h('p.nota', resto > 0 ? `Y ${resto} más. ` : '', h('a', { href: '#informes/calendario' }, `Ver los ${DIAS_INFORME} días →`))));
}

export function informeCalendario(ctx, { hoja, sec }) {
  const e = ctx.estado, lista = agendaProxima(e, DIAS_INFORME), vencen = calendarioPorVencer(e);
  const sinEmpresas = !e.agenda?.empresas || !Object.keys(e.agenda.empresas).length;
  return hoja('Calendario', `del ${fmt.fecha(e.hoy)} al ${fmt.fecha(fechas.sumar(e.hoy, DIAS_INFORME))}`,
    sec(`Próximos ${DIAS_INFORME} días`,
      sinEmpresas ? aviso('Todavía no hay balances ni dividendos: aparecen cuando la app publica qué seguir (al sincronizar) y corre la actualización.', 'alerta') : null,
      e.agenda?.stale ? aviso('La última búsqueda de balances falló: se muestra el dato anterior.', 'alerta') : null,
      vencen.length ? aviso(`Falta cargar fechas nuevas en data/eventos.json: ${vencen.map(v => `${v.titulo} (hasta el ${fmt.fecha(v.hasta)})`).join('; ')}.`, 'alerta') : null,
      lista.length ? tabla([
        { titulo: 'Fecha', celda: x => [h('span.num', fechaCorta(x)), x.sinDia ? h('small.desglose', 'día a confirmar') : null] },
        { titulo: 'Qué', celda: x => [h('strong', x.titulo), ' ', chip(TIPOS[x.tipo] || x.tipo, x.tipo === 'balance' || x.tipo === 'cupon' ? 'acento' : 'neutro'),
          x.detalle ? h('small.desglose', x.detalle) : null,
          h('small.desglose', 'Fuente: ', x.url ? h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer' }, x.fuente) : x.fuente)] },
      ], lista, { clase: 'compacta.calendario-tabla' }) : h('p.nota', 'No hay eventos cargados para este período.'),
      h('p.nota', { style: 'margin-top:.6rem' }, 'Las fechas de balances las publica cada empresa y pueden cambiar. El movimiento de las opciones es lo que el mercado paga por cubrirse hasta ese vencimiento: no dice para qué lado.')));
}
