// Resumen del sábado: arma los hechos desde data/, los redacta (con el proveedor de mercado_config.json; sin clave,
// plantillas), guarda data/resumen.json y avisa por ntfy. Lo corre el workflow "Resumen del sábado".
// Uso: node tools/resumen.mjs. Secretos opcionales: GEMINI_API_KEY o ANTHROPIC_API_KEY y NTFY_TOPIC. Nunca se imprimen.
import { readFileSync, writeFileSync } from 'node:fs';
import { hechos, redactar, aviso, llamarGemini, encadenar } from '../js/resumen.js';

const raiz = new URL('../', import.meta.url);
const leer = ruta => { try { return JSON.parse(readFileSync(new URL(ruta, raiz), 'utf8')); } catch { return null; } };
const guardar = (ruta, obj) => writeFileSync(new URL(ruta, raiz), JSON.stringify(obj));
const hoy = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10); // fecha de Argentina
const ahora = () => new Date().toISOString().slice(0, 19) + 'Z';

const origen = process.env.ORIGEN || 'manual';
const anterior = leer('data/resumen.json');
// Si llegan la programada de GitHub y la del cron externo, la segunda no repite el aviso.
if (['schedule', 'cron'].includes(origen) && anterior?.id === hoy && anterior.enviado) {
  console.log('resumen: el de hoy ya salió');
  process.exit(0);
}

const publico = Object.fromEntries(Object.entries({
  seguimiento: 'seguimiento', noticias: 'noticias', agenda: 'agenda', eventos: 'eventos', calendario: 'calendario', feriados: 'feriados_eeuu',
  feriadosAr: 'feriados_ar', directivos: 'directivos', iaUso: 'ia_uso', semaforo: 'semaforo', alertasSemana: 'alertas_semana',
  argentina: 'argentina', clima: 'clima', historico: 'historico', mercado: 'market', supuestos: 'supuestos',
}).map(([k, archivo]) => [k, leer(`data/${archivo}.json`)]));
publico.ratios = leer('tools/cedear_ratios.json');
const cfg = leer('tools/mercado_config.json')?.ia || {};
const modelo = cfg.modelo_haiku || 'claude-haiku-5-5';

async function clienteHaiku(clave) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const cliente = new Anthropic({ apiKey: clave, timeout: 60000, maxRetries: 2 });
  return pedido => cliente.messages.create(pedido);
}

const h = hechos(publico, hoy);
const proveedor = cfg.proveedor || 'haiku';
const clave = (process.env.ANTHROPIC_API_KEY || '').trim(), claveGemini = (process.env.GEMINI_API_KEY || '').trim();
const errores = {}; // fallas de cada modelo en esta corrida
const anotar = (m, tipo) => { (errores[m] = errores[m] || {})[tipo] = (errores[m]?.[tipo] || 0) + 1; };
const gemini = proveedor === 'gemini' && claveGemini
  ? llamarGemini({ clave: claveGemini, modelos: cfg.modelos_gemini || [], tiempoMs: (cfg.timeout_s || 30) * 1000, reintentos: cfg.reintentos ?? 2, anotar }) : null;
let haiku = null;
if (clave && proveedor !== 'ninguno') {
  try { haiku = await clienteHaiku(clave); } catch { haiku = () => { throw new Error('falta la biblioteca de Anthropic'); }; }
}
const llamar = encadenar([gemini, haiku]) || undefined; // con Gemini, Claude queda de reserva si hay clave
const r = await redactar(h, { llamar, modelo });

const repo = process.env.GITHUB_REPOSITORY || '';
const [duenio, nombre] = repo.split('/');
const enlace = process.env.APP_URL || (nombre ? `https://${duenio.toLowerCase()}.github.io/${nombre}/` : '');
const resumen = { id: hoy, fecha: hoy, generado: ahora(), por: r.por, motivo: r.motivo || null, secciones: r.secciones, avisos: h.avisos, hechos: h, enlace };

const tema = (process.env.NTFY_TOPIC || '').trim();
resumen.enviado = false;
if (tema) {
  try {
    const res = await fetch('https://ntfy.sh/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'tablero-resumen/1.0' }, body: JSON.stringify({ topic: tema, ...aviso(resumen, enlace) }), signal: AbortSignal.timeout(20000) });
    resumen.enviado = res.ok;
  } catch { /* se informa abajo, sin mostrar el canal */ }
}
guardar('data/resumen.json', resumen);

// El uso de la API queda anotado junto al de las noticias.
if (llamar) {
  const usado = r.por !== 'plantilla';
  const nombre = usado ? r.por : gemini ? (cfg.modelos_gemini?.[0] || 'gemini') : modelo;
  const precio = (cfg.precios || {})[nombre] || (nombre === 'claude-haiku-5-5' ? [0.10, 0.50] : null);
  const entrada = r.uso?.input_tokens || 0, salida = r.uso?.output_tokens || 0;
  const costo = precio ? Math.round((entrada * precio[0] + salida * precio[1]) / 1e6 * 1e6) / 1e6 : null;
  const modelos = Object.fromEntries(Object.entries(errores).map(([m, e]) => [m, { pedidos: Object.values(e).reduce((a, b) => a + b, 0), ok: 0, errores: e, tokens_entrada: 0, tokens_salida: 0, costo_usd: null }]));
  const x = modelos[nombre] = modelos[nombre] || { pedidos: 0, ok: 0, errores: {}, tokens_entrada: 0, tokens_salida: 0, costo_usd: null };
  x.pedidos += usado || !Object.keys(x.errores).length ? 1 : 0; x.ok += usado ? 1 : 0;
  if (!usado && !Object.keys(x.errores).length) x.errores = { resumen: 1 };
  Object.assign(x, { tokens_entrada: entrada, tokens_salida: salida, costo_usd: costo });
  const corrida = { fecha: ahora(), tarea: 'resumen', proveedor, avisos: r.motivo ? [r.motivo] : [], con_ia: 0, por_reglas: 0, pendientes: 0, sin_ia: !usado, costo_usd: costo || 0, modelos };
  const uso = leer('data/ia_uso.json') || { corridas: [] };
  guardar('data/ia_uso.json', { corridas: [...(uso.corridas || []).slice(-59), corrida] });
}
console.log(`resumen: redactado por ${r.por}${r.motivo ? ` (${r.motivo})` : ''}; aviso ${tema ? (resumen.enviado ? 'enviado' : 'NO enviado') : 'sin canal'}`);
