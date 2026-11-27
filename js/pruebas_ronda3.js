// Pruebas públicas de la ronda 3 (sin datos privados). Corren junto con js/pruebas_publicas.js.
import { aplicarEventos, valuar } from './estado.js';
import { tickersASeguir, seguimiento, subyacenteUsa } from './seguimiento.js';
import { publicarSeguimiento } from './sync.js';
import { cerca, igual, si, mundo } from './pruebas_ronda2.js';
import { agendaProxima, calendarioPorVencer, comoLoSeguis, fechaCorta } from './calendario.js';
import { planificador } from './motor.js';
import { noticiasMateriales, avisoIA, usoIA, porReglas } from './noticias.js';
import { comprasPuntuadas, ventasDestacadas, senalesRadar, eventosSenales, umbralRadar } from './directivos.js';
import { compararFantasmas } from './diario.js';
import { hechos, plantilla, redactar, revisar, numeros, aviso as avisoTelefono, pedidoModelo, sumarDia, lecturaDelDia, llamarGemini, encadenar, LARGO_AVISO } from './resumen.js';
import { resumenSinLeer } from './ui/resumen.js';
import { simular } from './simulacion.js';
import { climaMercado, textoClima } from './clima.js';
import { proponerUmbrales, percentil } from './calibrar.js';
import { leerHistorialAllaria, medirHistorialAllaria, contraReferencia, FORMATO_ALLARIA } from './diario.js';
import { rendimientoHist } from './finanzas.js';
import { precioJusto } from './precios.js';

const evento = (id, resto) => ({ id: 'r3-' + id, ts: `2026-11-30T12:00:00.${String(id).padStart(3, '0')}Z`, ...resto });

// ---------- etapa 1 · qué seguir ----------
// GitHub simulado para un solo archivo: GET devuelve su contenido y PUT lo reemplaza.
function githubArchivo(inicial = null, { conflictos = 0 } = {}) {
  const g = { texto: inicial, puts: [], gets: 0 };
  const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const deB64 = s => new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
  g.fetch = async (url, op = {}) => {
    const r = (status, cuerpo) => ({ ok: status < 300, status, json: async () => cuerpo });
    if (op.method === 'PUT') {
      const body = JSON.parse(op.body);
      if (conflictos-- > 0) return r(409, {});
      g.puts.push(body); g.texto = deB64(body.content);
      return r(200, { content: { sha: 'nuevo' } });
    }
    g.gets++;
    return g.texto == null ? r(404, {}) : r(200, { content: b64(g.texto), sha: 'viejo' });
  };
  return g;
}

function etapa1() {
  return [
    ['Qué seguir: cartera, watchlist y fantasmas, con su tipo y su subyacente en EE.UU.', async () => {
      const { e } = mundo({ eventos: [evento(1, { tipo: 'fantasma', origen: 'radar', ticker: 'CTSO', fecha: '2026-11-20' }), evento(2, { tipo: 'fantasma', origen: 'allaria', ticker: 'AAPL', fecha: '2026-11-03', grupo: 'Allaria P3' })] });
      const l = tickersASeguir(e), por = Object.fromEntries(l.map(x => [x.t, x]));
      igual(por.SPY, { t: 'SPY', tipo: 'cedear', usa: 'SPY', en: ['cartera'] }, 'SPY');
      igual([por.PAMP.tipo, por.PAMP.usa], ['accion_ar', 'PAM'], 'acción local por su ADR');
      igual([por.ON1.tipo, por.ON1.usa], ['on', 'YPF'], 'la ON del bloque YPF se sigue por YPF');
      igual([por.FCID.tipo, por.FCID.usa], ['fci', null], 'un fondo no tiene subyacente');
      igual(por.AAPL.en, ['watchlist', 'fantasma'], 'junta las dos listas');
      igual(por.CTSO, { t: 'CTSO', tipo: 'usa', usa: 'CTSO', en: ['fantasma'] }, 'fantasma del radar sin CEDEAR');
      igual(l.map(x => x.t), [...l.map(x => x.t)].sort(), 'ordenado');
    }],
    ['Qué seguir: no lleva cantidades, montos ni fechas', async () => {
      const { e } = mundo();
      const s = seguimiento(e);
      for (const x of s.tickers) igual(Object.keys(x), ['t', 'tipo', 'usa', 'en'], 'solo esos campos');
      const texto = JSON.stringify(s.tickers);
      for (const p of e.datos.posiciones) si(!texto.includes(String(p.cantidad)), 'se filtró una cantidad de ' + p.ticker);
      si(!/\d{4}-\d{2}-\d{2}/.test(texto), 'se filtró una fecha');
      si(![...Object.values(s.tickers)].some(x => Object.values(x).some(v => typeof v === 'number')), 'hay un número');
    }],
    ['Qué seguir: usa el ticker de EE.UU. del archivo de ratios y respeta lo que no cotiza allá', async () => {
      const e = { ratios: { BRKB: { ratio: 22, usa: 'BRK.B' }, ADS: { ratio: 22, usa: null } } };
      igual([subyacenteUsa(e, 'BRKB', { tipo: 'cedear' }), subyacenteUsa(e, 'ADS', { tipo: 'cedear' }), subyacenteUsa(e, 'YPFD', {}), subyacenteUsa(e, 'XYZ', { tipo: 'on', grupo: 'renta_fija' })],
        ['BRK.B', null, 'YPF', null], 'mapeo');
    }],
    ['Qué seguir: se publica solo si cambió, con reintento si otro dispositivo escribió', async () => {
      const lista = seguimiento(mundo().e), gh = { repo: 'u/r', token: 't' };
      const vacio = githubArchivo();
      si(await publicarSeguimiento(gh, lista, vacio.fetch) === 'subido' && vacio.puts.length === 1 && !vacio.puts[0].sha, 'la primera vez crea el archivo');
      si(await publicarSeguimiento(gh, lista, vacio.fetch) === 'igual' && vacio.puts.length === 1, 'sin cambios no escribe');
      const otro = { ...lista, tickers: lista.tickers.slice(1) };
      si(await publicarSeguimiento(gh, otro, vacio.fetch) === 'subido' && vacio.puts[1].sha === 'viejo', 'con cambios reemplaza');
      const chocado = githubArchivo('{"tickers":[]}', { conflictos: 1 });
      si(await publicarSeguimiento(gh, lista, chocado.fetch) === 'subido' && chocado.gets === 2, 'reintenta tras el conflicto');
      JSON.parse(chocado.texto);
    }],
  ];
}

// ---------- etapa 2 · calendario ----------
function etapa2() {
  return [
    ['Calendario: balances y ex dividendo solo de lo que seguís, con el movimiento de las opciones', async () => {
      const { e } = mundo();
      const l = agendaProxima(e, 14);
      const nvda = l.find(x => x.tipo === 'balance' && x.ticker === 'NVDA');
      si(nvda && nvda.fecha === '2026-12-09' && /±7,5%/.test(nvda.detalle) && /en cartera/.test(nvda.titulo), JSON.stringify(nvda));
      si(l.some(x => x.tipo === 'ex_dividendo' && x.ticker === 'SPY' && x.fecha === '2026-12-03'), 'ex dividendo de SPY');
      si(!l.some(x => x.ticker === 'ZZZ'), 'lo que no seguís no entra');
      si(!l.some(x => x.ticker === 'PAM'), 'un balance a 40 días no entra en 14');
      si(agendaProxima(e, 90).some(x => x.ticker === 'PAM' && /PAM · PAMP \(en cartera\)/.test(x.titulo)), 'PAMP se sigue por su ADR');
    }],
    ['Calendario: eventos fijos, feriados y cupón, en orden y sin repetir lo pasado', async () => {
      const { e } = mundo();
      const l = agendaProxima(e, 90);
      si(l.some(x => x.grupo === 'fed' && x.fecha === '2026-12-09'), 'Fed');
      si(l.some(x => x.tipo === 'feriado' && x.fecha === '2026-12-07' && /sin liquidar/.test(x.titulo)), 'puente argentino');
      si(l.some(x => x.tipo === 'feriado' && x.fecha === '2026-12-08' && x.titulo === 'Sin rueda en BYMA'), 'feriado argentino');
      si(l.some(x => x.tipo === 'feriado' && x.fecha === '2026-12-25' && x.titulo === 'Feriado en EE.UU.'), 'feriado de EE.UU.');
      si(l.some(x => x.tipo === 'cupon' && x.fecha === '2027-01-14' && x.ticker === 'ON1'), 'cupón de la ON');
      si(!l.some(x => x.tipo === 'eleccion' || x.grupo === 'msci'), 'las elecciones y MSCI quedan fuera de los 90 días');
      si(l.every(x => (x.hasta || x.fecha) >= e.hoy), 'nada pasado');
      igual(l.map(x => x.orden), [...l.map(x => x.orden)].sort(), 'ordenado');
    }],
    ['Calendario: un mes sin día confirmado entra cuando se superpone, y avisa si faltan fechas', async () => {
      const { e } = mundo({ hoy: '2027-05-25' });
      const m = agendaProxima(e, 14).find(x => x.grupo === 'msci');
      si(m && fechaCorta(m) === 'junio de 2027', JSON.stringify(m));
      si(agendaProxima(mundo({ hoy: '2027-06-20' }).e, 14).some(x => x.grupo === 'msci' && x.orden === '2027-06-20'), 'dentro del mes se ordena como de hoy');
      igual(calendarioPorVencer(mundo().e).map(x => x.hasta), ['2027-01-27'], 'a la Fed de ejemplo le quedan menos de 90 días');
    }],
    ['Calendario: es informativo, no agrega pasos ni toca reglas', async () => {
      const con = mundo().e, sin = mundo({ ajustar: x => { delete x.ext.agenda; delete x.ext.eventosFijos; } }).e;
      igual(planificador(con, con.hoy), planificador(sin, sin.hoy), 'mismo plan');
      si(agendaProxima(sin, 14).every(x => x.tipo === 'feriado' || x.tipo === 'cupon'), 'sin archivos quedan feriados y cupones');
      si(comoLoSeguis('XYZ') === 'XYZ', 'sin dato');
    }],
  ];
}

// ---------- etapa 4 · noticias clasificadas ----------
function etapa4() {
  return [
    ['Noticias: solo las de materialidad 2 o más, recientes y de lo que seguís, por empresa', async () => {
      const { e } = mundo();
      const g = noticiasMateriales(e);
      igual(g.map(x => x.ticker), ['NVDA', 'PAM', 'AAPL'], 'primero la cartera y lo más nuevo; después la watchlist');
      igual(g[0].items.map(x => x.id), ['e1', 'e2'], 'primero la más importante');
      si(/NVDA \(en cartera\)/.test(g[0].nombre) && /PAM · PAMP/.test(g[1].nombre), 'con qué lo seguís');
      si(porReglas(g[1].items[0]) && !porReglas(g[0].items[0]), 'marca las que no leyó una IA');
      si(noticiasMateriales(e, { minimo: 1 })[0].items.length === 3 && !noticiasMateriales(mundo({ ajustar: x => { delete x.ext.noticias; } }).e).length, 'mínimo y sin archivo');
    }],
    ['Noticias: avisa solo si la última corrida terminó sin ningún modelo de IA', async () => {
      si(avisoIA(mundo().e) === null, 'anduvo');
      const roto = mundo({ ajustar: x => { x.ext.iaUso.corridas.push({ fecha: '2026-11-30T18:00:00Z', sin_ia: true, avisos: [], modelos: { 'gemini-3.5-flash-lite': { errores: { 429: 3 } }, 'claude-haiku-5-5': { errores: { tiempo: 3 } } } }); } }).e;
      si(/sin IA.*filtro por reglas.*límite de uso, tiempo agotado/.test(avisoIA(roto).texto), avisoIA(roto).texto);
      const sinClave = mundo({ ajustar: x => { x.ext.iaUso.corridas = [{ fecha: '2026-11-30T18:00:00Z', sin_ia: true, avisos: ['Falta el secreto ANTHROPIC_API_KEY'], modelos: {} }]; } }).e;
      si(/ANTHROPIC_API_KEY/.test(avisoIA(sinClave).texto), avisoIA(sinClave).texto);
      igual(planificador(roto, roto.hoy).pasos, planificador(mundo().e, roto.hoy).pasos, 'no es una tarea');
    }],
    ['Noticias: el uso de la API se suma por modelo', async () => {
      const u = usoIA(mundo().e);
      igual([u.corridas, u.clasificadas, u.modelos[0].modelo], [1, 6, 'claude-haiku-5-5'], 'resumen');
      cerca(u.costo_usd, 0.00019, 1e-9, 'costo');
    }],
  ];
}

// ---------- etapa 5 · radar de directivos ----------
const aplicar = (x, eventos) => valuar(aplicarEventos(x.datos, eventos), x.ext, x.hoy || '2026-11-30');
function etapa5() {
  const conId = (l, desde = 100) => l.map((x, i) => evento(desde + i, x));
  return [
    ['Directivos: accionable si hay CEDEAR o la tenés; el resto aparte; ventas solo de 3 o más', async () => {
      const { e } = mundo();
      const c = comprasPuntuadas(e);
      igual(c.accionables.map(x => `${x.t}:${x.puntaje}`), ['NVDA:74', 'NVDA:66', 'KO:61', 'AAPL:35'], 'por puntaje, sin lo viejo');
      igual(c.otras.map(x => x.t), ['SINCEDEAR'], 'sin CEDEAR');
      si(c.accionables[0].propio === 'NVDA' && c.accionables[2].cedear && !c.accionables[2].propio, 'motivo');
      igual(ventasDestacadas(e).map(v => v.t), ['NVDA'], 'solo en grupo');
      si(comprasPuntuadas(mundo({ ajustar: x => { delete x.ext.directivos; } }).e).accionables.length === 0, 'sin archivo');
    }],
    ['Directivos: cada señal accionable sobre el umbral entra sola como fantasma "radar", una vez', async () => {
      const x = mundo();
      igual(senalesRadar(x.e).map(s => s.t), ['NVDA', 'KO'], 'una por empresa, desde 60 puntos y accionable');
      const evs = eventosSenales(x.e);
      igual(evs.map(v => [v.tipo, v.origen, v.ticker, v.fecha, v.puntaje]), [['fantasma', 'radar', 'NVDA', '2026-11-30', 74], ['fantasma', 'radar', 'KO', '2026-11-30', 61]], 'eventos');
      const e2 = aplicar(x, conId(evs));
      igual(e2.datos.fantasmas.map(f => f.ticker), ['NVDA', 'KO'], 'anotadas');
      igual(eventosSenales(e2), [], 'no se repite');
      // Otro dispositivo la anotó otro día: al unir los eventos queda una sola.
      const doble = aplicar(x, [...conId(evs), ...conId(evs.map(v => ({ ...v, fecha: '2026-12-02' })), 200)]);
      si(doble.datos.fantasmas.length === 2, 'sin duplicar entre dispositivos');
      // Borrarla no la trae de vuelta; pasados 90 días, una señal nueva sí.
      const borrada = aplicar(x, [...conId(evs), evento(300, { tipo: 'fantasma_borrar', clave: 'radar|NVDA|2026-11-30' })]);
      si(!borrada.datos.fantasmas.some(f => f.ticker === 'NVDA') && !eventosSenales(borrada).length, 'borrada');
      si(compararFantasmas(e2).grupos.every(g => g.origen === 'radar'), 'se comparan con SPY como las demás');
    }],
    ['Directivos: el umbral se cambia en Supuestos y no toca pasos ni reglas', async () => {
      const x = mundo({ ajustar: y => { y.datos.supuestos = { radar_directivos: { umbral: 70 } }; } });
      si(umbralRadar(x.e) === 70 && senalesRadar(x.e).map(s => s.t).join() === 'NVDA', 'umbral propio');
      const sin = mundo({ ajustar: y => { delete y.ext.directivos; } }).e;
      igual(planificador(mundo().e, sin.hoy).pasos, planificador(sin, sin.hoy).pasos, 'informativo');
    }],
  ];
}

// ---------- etapa 6 · resumen del sábado ----------
// Los archivos públicos tal como los lee tools/resumen.mjs, armados con el ejemplo.
export function publicoEjemplo({ hoy = '2026-11-30', ajustar } = {}) {
  const { e, ext } = mundo({ hoy });
  const p = {
    ...ext, eventos: ext.eventosFijos, seguimiento: seguimiento(e), semaforo: { dias: { '2026-11-23': { semaforo: 'verde' } } },
    alertasSemana: { items: [{ fecha: '2026-11-25', ticker: 'NVDA', tipo: 'dia', cambio: -0.123 }, { fecha: '2026-11-10', ticker: 'SPY', tipo: 'dia', cambio: -0.08 }] },
  };
  ajustar?.(p);
  return p;
}
const respuesta = cambios => ({ stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: JSON.stringify({ cartera: ['NVDA presentó novedades el 29/11.'], senales: ['Sin señales nuevas.'], contexto: 'Argentina en amarillo.', ...cambios }) }] });

function etapa6() {
  return [
    ['Resumen: hechos de la semana en orden, con su fuente y archivo', async () => {
      const h = hechos(publicoEjemplo(), '2026-11-30');
      igual(Object.keys(h), ['fecha', 'semana', 'cartera', 'senales', 'contexto', 'avisos'], 'orden fijo');
      igual(h.cartera.noticias.map(x => x.ticker), ['NVDA', 'NVDA', 'PAM'], 'solo cartera, material y de la semana');
      si(h.cartera.agenda.some(x => /Ex dividendo de SPY/.test(x.titulo)) && !h.cartera.agenda.some(x => /NVDA|PAM/.test(x.titulo)), 'eventos de los próximos 7 días');
      igual(h.cartera.alertas.map(a => a.texto), ['NVDA −12,3% en el día (25/11)'], 'alertas de la semana');
      si(h.cartera.semaforo.hoy === 'amarillo' && h.cartera.semaforo.hace_una_semana === 'verde' && h.cartera.semaforo.cambios.length === 1, JSON.stringify(h.cartera.semaforo));
      igual(h.senales.directivos.map(d => d.ticker), ['NVDA', 'KO'], 'accionables sobre el umbral, de la semana');
      igual(h.senales.analistas.map(a => [a.ticker, a.recomendacion]), [['NVDA', 'compra']], 'recomendaciones explícitas');
      for (const x of [...h.cartera.noticias, ...h.cartera.agenda, ...h.cartera.alertas, ...h.senales.directivos, ...h.senales.analistas]) si(x.fuente && /data\//.test(x.archivo), 'sin fuente: ' + JSON.stringify(x));
    }],
    ['Resumen: los cupones van sin montos y un aviso dice si la IA no anduvo', async () => {
      const h = hechos(publicoEjemplo({ hoy: '2027-01-10', ajustar: p => { p.iaUso = { corridas: [{ fecha: '2027-01-08T15:00:00Z', sin_ia: true }, { fecha: '2027-01-09T15:00:00Z', sin_ia: true, tarea: 'resumen' }] }; } }), '2027-01-10');
      const cupon = h.cartera.agenda.find(x => /Cupón de ON1/.test(x.titulo));
      si(cupon && !/USD|\$/.test(cupon.titulo + cupon.detalle), JSON.stringify(cupon));
      si(h.avisos.some(a => /una actualización sin IA/.test(a)), h.avisos.join(' '));
      const vacio = hechos({}, '2026-11-30');
      si(plantilla(vacio).cartera[0].startsWith('Sin noticias') && revisar(plantilla(vacio), vacio) === null && vacio.avisos.length === 1, 'sin ningún archivo tampoco se rompe');
    }],
    ['Resumen: con plantillas, todo número del texto está en los hechos', async () => {
      const h = hechos(publicoEjemplo(), '2026-11-30');
      const r = await redactar(h);
      si(r.por === 'plantilla' && r.motivo === 'sin clave de IA' && revisar(r.secciones, h) === null, String(revisar(r.secciones, h)));
      const permitidos = numeros(JSON.stringify(h));
      for (const n of numeros(Object.values(r.secciones).flat().join(' '))) si(permitidos.has(n), 'número suelto: ' + n);
      igual([...numeros('USD 1.234,50 el 05/12, +4,4%')], ['1234.5', '5', '12', '4.4'], 'comparables');
    }],
    ['Resumen: se descarta lo que inventa números, empresas o recomienda; queda la plantilla', async () => {
      const h = hechos(publicoEjemplo(), '2026-11-30');
      const con = async r => redactar(h, { llamar: async () => r });
      si((await con(respuesta({}))).por === 'claude-haiku-5-5', 'una respuesta limpia se usa');
      for (const [cambios, motivo] of [[{ contexto: 'El VIX está en 47.' }, /número que no está/], [{ senales: ['TSLA subió.'] }, /nombra algo/], [{ cartera: ['Te conviene comprar NVDA.'] }, /recomendación propia/], [{ cartera: [] }, /forma/]]) {
        const r = await con(respuesta(cambios));
        si(r.por === 'plantilla' && motivo.test(r.motivo), `${JSON.stringify(cambios)} → ${r.motivo}`);
      }
      const cortada = await con({ ...respuesta({}), stop_reason: 'max_tokens' });
      si(cortada.por === 'plantilla' && /no terminó/.test(cortada.motivo), cortada.motivo);
      const caida = await redactar(h, { llamar: async () => { throw Object.assign(new Error('x'), { status: 529 }); } });
      si(caida.por === 'plantilla' && caida.motivo === 'la API respondió 529', caida.motivo);
    }],
    ['Resumen: el pedido a Haiku lleva los hechos sin direcciones y pide JSON', async () => {
      const h = hechos(publicoEjemplo(), '2026-11-30'), p = pedidoModelo(h, 'claude-haiku-5-5');
      si(p.model === 'claude-haiku-5-5' && p.output_config.format.type === 'json_schema' && !('temperature' in p), 'forma del pedido');
      si(!p.messages[0].content.includes('example.com') && p.messages[0].content.includes('150.000'), 'sin direcciones');
    }],
    ['Resumen: con Gemini prueba los modelos en orden, controla igual el texto y deja a Claude de reserva', async () => {
      const h = hechos(publicoEjemplo(), '2026-11-30');
      const limpio = { cartera: ['NVDA presentó novedades el 29/11.'], senales: ['Sin señales nuevas.'], contexto: 'Argentina en amarillo.' };
      const bien = cuerpo => ({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'x' }, { text: JSON.stringify(cuerpo) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 80, thoughtsTokenCount: 20 } }) });
      const estado = s => ({ ok: false, status: s, json: async () => ({}) });
      const red = guion => { const pedidos = []; return { pedidos, fetch: async (url, op) => { pedidos.push({ url, op }); const paso = guion.length > 1 ? guion.shift() : guion[0]; if (paso === 'tiempo') throw new Error('timeout'); return paso; } }; };
      const esperas = [], errores = [];
      const a = red([estado(429), 'tiempo', estado(503), estado(404), bien(limpio)]);
      const r = await redactar(h, { llamar: llamarGemini({ clave: 'k-prueba', modelos: ['m1', 'm2', 'm3'], fetchFn: a.fetch, esperar: async ms => esperas.push(ms), anotar: (m, t) => errores.push(`${m}:${t}`) }) });
      igual(errores, ['m1:429', 'm1:tiempo', 'm1:503', 'm2:404'], 'reintenta lo pasajero; un modelo que no existe se saltea');
      igual(esperas, [2000, 4000], 'espera creciente');
      si(r.por === 'm3' && r.uso.input_tokens === 900 && r.uso.output_tokens === 100, JSON.stringify(r));
      si(a.pedidos.every(p => !p.url.includes('k-prueba') && p.op.headers['x-goog-api-key'] === 'k-prueba'), 'la clave va en el encabezado');
      const cuerpo = JSON.parse(a.pedidos.at(-1).op.body);
      si(cuerpo.generationConfig.responseFormat.text.mimeType === 'APPLICATION_JSON' && !cuerpo.contents[0].parts[0].text.includes('example.com'), 'forma documentada, sin direcciones');
      const b = red([estado(400), bien(limpio)]);
      si((await redactar(h, { llamar: llamarGemini({ clave: 'k', modelos: ['m1'], fetchFn: b.fetch }) })).por === 'm1' && JSON.parse(b.pedidos[1].op.body).generationConfig.responseMimeType === 'application/json', 'forma anterior si rechaza la nueva');
      const c = red([bien({ ...limpio, contexto: 'El VIX está en 47.' })]);
      si(/número que no está/.test((await redactar(h, { llamar: llamarGemini({ clave: 'k', modelos: ['m1'], fetchFn: c.fetch }) })).motivo), 'mismo control de números');
      const caido = llamarGemini({ clave: 'k', modelos: ['m1'], fetchFn: red([estado(503)]).fetch, esperar: async () => {} });
      si((await redactar(h, { llamar: encadenar([caido, async () => respuesta({})]) })).por === 'claude-haiku-5-5', 'Claude de reserva');
      const nada = await redactar(h, { llamar: encadenar([caido]) });
      si(nada.por === 'plantilla' && nada.motivo === 'la API respondió 503' && encadenar([null, null]) === null, nada.motivo);
    }],
    ['Resumen: el aviso al teléfono es corto, en orden y con el enlace', async () => {
      const h = hechos(publicoEjemplo(), '2026-11-30'), r = await redactar(h);
      const a = avisoTelefono({ ...r, avisos: ['Aviso'] }, 'https://ejemplo.github.io/tablero/');
      si(a.message.length <= LARGO_AVISO + 60 && a.click.startsWith('https://') && a.message.indexOf('Tu cartera:') === 0 && a.message.indexOf('Señales:') > 0, a.message);
      si(/cosas más en el tablero/.test(a.message), 'avisa que hay más');
      const largo = avisoTelefono({ secciones: { cartera: Array(10).fill('x'.repeat(300)), senales: Array(8).fill('y'.repeat(300)), contexto: 'z' } }, '');
      si(largo.message.length <= LARGO_AVISO + 60 && !largo.click, 'recorta');
    }],
    ['Resumen: en Hoy aparece como "Desde la última vez" hasta marcarlo leído', async () => {
      const resumen = { id: '2026-11-28', secciones: { cartera: ['a'], senales: ['b'], contexto: 'c' }, por: 'plantilla' };
      const x = mundo({ ajustar: y => { y.ext.resumen = resumen; } });
      si(resumenSinLeer(x.e)?.id === '2026-11-28', 'sin leer');
      const leido = valuar(aplicarEventos(x.datos, [evento(1, { tipo: 'resumen_leido', resumen: '2026-11-28', fecha: '2026-11-30' })]), x.ext, '2026-11-30');
      si(resumenSinLeer(leido) === null, 'leído');
      si(resumenSinLeer({ ...leido, resumen: { ...resumen, id: '2026-12-05' } })?.id === '2026-12-05', 'el siguiente vuelve a aparecer');
      si(resumenSinLeer({ ...x.e, hoy: '2027-01-15' }) === null, 'uno viejo no');
      igual(planificador(x.e, x.e.hoy).pasos, planificador(mundo().e, x.e.hoy).pasos, 'no es una tarea');
    }],
    ['Resumen: el registro diario del semáforo guarda un punto por día', async () => {
      const l = lecturaDelDia(publicoEjemplo(), '2026-11-30');
      si(l.semaforo === 'amarillo' && l.clima === 'tranquilo', JSON.stringify(l));
      const r = sumarDia(sumarDia(null, '2026-11-29', l), '2026-11-30', l);
      igual(Object.keys(r.dias), ['2026-11-29', '2026-11-30'], 'dos días');
      let largo = null;
      for (let i = 0; i < 70; i++) largo = sumarDia(largo, `2027-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + i % 28).padStart(2, '0')}`, l);
      si(Object.keys(largo.dias).length === 60, 'como mucho 60');
    }],
  ];
}

// ---------- etapa 7 · pendientes de la ronda 2 ----------
// Todo quieto: sin volatilidad ni retornos, para ver solo adónde va la plata.
const SIN_RETORNOS = { escala_volatilidad: 0, retornos_etf: { SPY: 0, EFA: 0, EEM: 0, IWM: 0 }, acciones: { prima_mercado: 0 }, otros: { on: 0, fci_usd: 0, caja_usd: 0, pesos: 0 } };
const bono = flujos => mundo({ ajustar: x => { x.datos.supuestos = SIN_RETORNOS; x.datos.perfil.ingreso_mensual_usd = 500; x.ext.calendario = { flujos }; } }).e;
const CUPON = { ticker: 'ON1', fecha: '2027-01-14', tipo: 'cupon', por_vn: 0.04 };
const DEVOLUCION = { ticker: 'ON1', fecha: '2027-03-15', tipo: 'amortizacion', por_vn: 1 };

function etapa7() {
  return [
    ['Proyección: el cupón pasa al núcleo y la devolución de capital saca la ON de la cartera', async () => {
      const e = bono([CUPON, DEVOLUCION, { ...CUPON, fecha: '2026-11-01' }, { ...CUPON, ticker: 'OTRA' }]);
      const sim = simular(e, { escenarios: 3 });
      igual(sim.modelo.pagos.map(p => [p.mes, p.usd, p.fin]), [[2, 20, false], [4, 500, true]], 'solo lo futuro de lo que tenés');
      // El cupón no crea plata: sale de la ON (517,50 → 497,50) y entra al núcleo. Al vencer devuelve 500 (la par).
      cerca(sim.anios[0].p50, e.total_usd + 12 * sim.aporte + (500 - (517.5 - 20)), 0.01, 'a un año');
      si(sim.hitos.ypf.m50 === 4 && sim.hitos.ypf.m90 === 4, 'YPF queda en su objetivo cuando vence: ' + JSON.stringify(sim.hitos.ypf));
      const sin = simular(bono([]), { escenarios: 3 });
      si(sin.hitos.ypf.m50 == null || sin.hitos.ypf.m50 > 4, 'sin vencimiento tarda más');
      si(sin.modelo.pagos.length === 0, 'sin calendario no se inventa');
    }],
    ['Clima: las condiciones financieras (NFCI) se muestran con su lectura', async () => {
      const c = climaMercado(mundo().e), n = c.indicadores.find(i => i.id === 'condiciones');
      si(n.valor === -0.4 && n.lectura === 'tranquilo' && n.historia.fechas.length > 10, JSON.stringify(n.lectura));
      si(/condiciones financieras tranquilo \(−0,40\)/.test(textoClima(c)), textoClima(c));
    }],
    ['Umbrales: la propuesta sale de percentiles de la historia, del lado malo de cada uno', async () => {
      cerca(percentil([1, 2, 3, 4, 5], 0.75), 4, 1e-9, 'percentil');
      const x = mundo({ ajustar: y => {
        const fs = Array.from({ length: 200 }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10));
        y.ext.argentina.riesgo_pais = { fechas: fs, valores: fs.map((_, i) => 500 + i * 5), ultimo: { fecha: fs.at(-1), valor: 1495 } };
        y.ext.clima.series.T10Y3M = { fechas: fs, valores: fs.map((_, i) => 2 - i * 0.01), ultimo: { fecha: fs.at(-1), valor: 0 } };
        y.ext.clima.series.VIXCLS = { fechas: fs, valores: fs.map(() => 20), ultimo: { fecha: fs.at(-1), valor: 20 } };
      } });
      const p = Object.fromEntries(proponerUmbrales(x.e).map(r => [`${r.grupo}.${r.clave}`, r]));
      igual(p['semaforo.riesgo_pais'].propuesto, [1250, 1400], 'hacia arriba: percentiles 75 y 90');
      igual(p['clima.curva'].propuesto, [0.5, 0.2], 'hacia abajo: percentiles 25 y 10');
      igual(p['clima.vix'].propuesto, [20, 20.5], 'el segundo nivel queda más lejos aunque empaten');
      si(p['semaforo.brecha'].propuesto === null && /sin historia/.test(p['semaforo.brecha'].motivo), 'sin historia no propone');
      si(p['clima.condiciones'].propuesto === null && /poca historia/.test(p['clima.condiciones'].motivo), 'poca historia');
      si(p['semaforo.canje'].propuesto && p['semaforo.adr'].propuesto[1] < p['semaforo.adr'].propuesto[0], 'canje y acciones salen del histórico diario');
      si(p['clima.spy_promedio'].propuesto === null && p['clima.spy_promedio'].datos > 0, 'con poco más de un año no alcanza para SPY contra su promedio');
      si(proponerUmbrales(x.e, { atencion: 0.5, alarma: 0.99 })[0].propuesto[0] < 1250, 'los percentiles se cambian');
      igual(p['semaforo.riesgo_pais'].actual, [800, 1500], 'muestra lo de hoy: no cambia nada solo');
    }],
    ['Allaria: se pega el historial como JSON, se valida y se mide contra SPY y el núcleo', async () => {
      const ej = leerHistorialAllaria(FORMATO_ALLARIA.replace('"..."', '"Allaria"'), '2026-11-30');
      igual(ej.rotaciones[0], { id: 'P1', fecha: '2026-01-02', entran: ['TSLA'], salen: [], rendimiento: -0.0871 }, 'el formato de ejemplo entra');
      for (const [malo, motivo] of [['x', /JSON/], ['{"rotaciones":[]}', /fuente/], ['{"fuente":"a","rotaciones":[]}', /al menos una/],
        ['{"fuente":"a","rotaciones":[{"id":"P1","fecha":"2026-13-01"}]}', /fecha/], ['{"fuente":"a","rotaciones":[{"id":"P1","fecha":"2027-01-02"}]}', /futura/],
        ['{"fuente":"a","rotaciones":[{"id":"P1","fecha":"2026-01-02","rendimiento":-8.71}]}', /fracción/], ['{"fuente":"a","rotaciones":[{"id":"P1","fecha":"2026-01-02","entran":["<b>"]}]}', /ticker/],
        ['{"fuente":"a","rotaciones":[{"id":"P1","fecha":"2026-01-02"},{"id":"P1","fecha":"2026-02-02"}]}', /mismo/], ['{"fuente":"a","rotaciones":[{"id":"P1","fecha":"2026-01-02"},{"id":"P2","fecha":"2026-01-02"}]}', /misma fecha/]]) {
        let error = '';
        try { leerHistorialAllaria(malo, '2026-11-30'); } catch (err) { error = err.message; }
        si(motivo.test(error), `${malo} → ${error}`);
      }
      const h = leerHistorialAllaria(JSON.stringify({ fuente: 'Informe', rotaciones: [{ id: 'P2', fecha: '2026-06-01', rendimiento: 0.05 }, { id: 'P1', fecha: '2026-03-02', rendimiento: 0.02 }, { id: 'P0', fecha: '2024-01-02', rendimiento: 0.1 }, { id: 'P3', fecha: '2026-09-01' }] }), '2026-11-30');
      const x = mundo();
      const e = valuar(aplicarEventos(x.datos, [evento(1, { tipo: 'historial_allaria', fecha: '2026-11-30', ...h })]), x.ext, '2026-11-30');
      const m = medirHistorialAllaria(e);
      igual(m.filas.map(f => [f.id, f.desde, f.hasta, f.abierto]), [['P0', '2024-01-02', '2026-03-02', false], ['P1', '2026-03-02', '2026-06-01', false], ['P2', '2026-06-01', '2026-09-01', false], ['P3', '2026-09-01', '2026-11-30', true]], 'períodos');
      cerca(m.filas[1].spy, rendimientoHist(e.historico, 'SPY', '2026-03-02', '2026-06-01'), 1e-12, 'SPY en las mismas fechas');
      si(m.filas[1].nucleo != null && m.filas[0].spy === null && m.sin_historia.join() === 'P0', 'antes de la historia no se inventa');
      cerca(m.acumulado.rendimiento, 1.02 * 1.05 - 1, 1e-12, 'acumulado de los períodos completos');
      si(m.acumulado.periodos === 2 && medirHistorialAllaria(x.e) === null, 'dos completos; sin historial, nada');
      si(e.datos.cartera_modelo_allaria.activos.length === x.datos.cartera_modelo_allaria.activos.length, 'la cartera modelo vigente no cambia');
    }],
    ['Referencias: se cambian desde la app, vuelven a la predeterminada y se piden al histórico', async () => {
      const x = mundo();
      const con = evs => valuar(aplicarEventos(x.datos, evs), x.ext, '2026-11-30');
      const e = con([evento(1, { tipo: 'referencias', cambios: { NVDA: 'ARGT', PAMP: 'SOXX' } })]);
      const f = Object.fromEntries(contraReferencia(e).filas.map(r => [r.ticker, r]));
      si(f.NVDA.referencia === 'ARGT' && f.PAMP.referencia === 'SOXX' && contraReferencia(e).faltan.includes('SOXX'), JSON.stringify(f.NVDA));
      igual(seguimiento(e).series, ['ARGT', 'SOXX'], 'se publican para que el Action baje su historia');
      const vuelta = con([evento(1, { tipo: 'referencias', cambios: { NVDA: 'ARGT' } }), evento(2, { tipo: 'referencias', cambios: { NVDA: '' } })]);
      si(contraReferencia(vuelta).filas.find(r => r.ticker === 'NVDA').referencia === 'SMH', 'predeterminada');
      igual(seguimiento(x.e).series, [], 'sin cambios');
    }],
    ['Ratios: aceptar el de BYMA vuelve a poner precio justo y saca el aviso', async () => {
      const x = mundo({ ajustar: y => { y.ext.mercado.ratios_byma = { lista_fecha: '2026-11-26', cambios: { SPY: [60, 30] } }; y.ext.mercado.cedears.precios.SPY = [y.ext.mercado.cedears.precios.SPY[0] * 2, 0]; } });
      const aviso = planificador(x.e, x.e.hoy).pasos.find(p => p.accion?.tipo === 'ratio');
      si(aviso && aviso.informativo && aviso.accion.ratio === 30 && aviso.accion.anterior === 60, 'aviso con botón');
      si(precioJusto(x.e, 'SPY').revisar, 'sin aceptar, no pone límite');
      const ev = evento(1, { tipo: 'ratio_aceptado', ticker: 'SPY', ratio: 30, anterior: 60, fecha: '2026-11-30' });
      const e = valuar(aplicarEventos(x.datos, [ev]), x.ext, '2026-11-30');
      si(e.ratios.SPY.ratio === 30 && !precioJusto(e, 'SPY').revisar && !planificador(e, e.hoy).pasos.some(p => p.accion?.tipo === 'ratio'), 'aceptado');
      si(x.ext.ratios.ratios.SPY.ratio === 60 && x.ext.mercado.ratios_byma.cambios.SPY, 'no toca los archivos');
      // Si después cambia el archivo del tablero, manda el archivo.
      const nuevo = valuar(aplicarEventos(x.datos, [ev]), { ...x.ext, ratios: { fecha: 'x', ratios: { SPY: { ratio: 15 } } } }, '2026-11-30');
      si(nuevo.ratios.SPY.ratio === 15, 'manda el archivo nuevo');
    }],
  ];
}

export function pruebasRonda3() {
  return [...etapa1(), ...etapa2(), ...etapa4(), ...etapa5(), ...etapa6(), ...etapa7()];
}
