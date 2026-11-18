# Tablero — notas de uso y de mantenimiento

Herramienta personal de seguimiento de inversiones.

- App: `index.html` + `styles.css` + módulos ES en `js/`. Sin build ni frameworks.
- Los datos privados viajan **cifrados** en `data/cartera.enc.json` (AES-256-GCM, PBKDF2-SHA256 con 600.000 iteraciones) y se descifran en el navegador con la clave. La clave no está en ningún archivo.
- Datos de mercado: un GitHub Action corre `tools/mercado.py` tres veces por día hábil (lo lanza un cron externo; ver "Precios a horario"), y a pedido desde la app.
- Plan de trabajo, auditoría y decisiones pendientes: `docs/plan.md`.

## Uso diario

1. Abrí el link. La primera vez en cada dispositivo pide la clave; con "Recordar en este dispositivo" no la vuelve a pedir (salvo que se bloquee por inactividad).
2. **Hoy** dice qué hacer. Cada paso tiene Hecho / Posponer / Descartar.
3. Una vez por mes: **Aportar → ¿Cuánto invierto este mes?** Cargás el extracto del banco y, en seis pasos, sale cuánto invertir y en qué.
4. Debajo del patrimonio se ve siempre de cuándo son los precios (tocá para ver cada fuente) y el estado de la sincronización.

## Sincronizar

Lo que registrás queda guardado, cifrado, en el dispositivo. Para verlo en los demás hay que darle permiso a ese dispositivo para guardar en GitHub, una sola vez:

1. ⋯ → Sincronizar → **Abrir GitHub** (el permiso ya viene armado: "Contents" y "Actions", ambos Read and write).
2. En "Repository access": "Only select repositories" → este repositorio.
3. "Generate token", copiar el texto `github_pat_…` y pegarlo en el tablero → **Probar y activar**.

Desde ahí cada cambio se sube solo. Si no hay conexión o el permiso venció (dura un año), avisa y los cambios quedan en el dispositivo hasta que se pueda.

Cómo funciona: antes de subir lee el archivo directo de la API de GitHub, lo fusiona con lo local (los eventos se unen por identificador) y sube con control de versión; si otro dispositivo guardó al mismo tiempo, reintenta. Nunca borra cambios locales antes de que GitHub confirme.

Sin permiso se puede bajar una copia cifrada (⋯ → Sincronizar → "Otra forma"), que sirve de respaldo.

**Respaldo** (⋯ → Respaldo): baja todo cifrado con la clave; se vuelve a abrir desde ahí mismo o con `tools/cripto.py descifrar`. Si se cifró con una clave anterior, pide esa frase. La copia sin cifrar queda plegada en "Bajar sin cifrar".

## Precios a horario

GitHub atrasa o saltea a veces las corridas programadas (`schedule`): en noviembre de 2026 corría una o dos de las tres por día. Por eso hay dos caminos más, y el workflow evita trabajo repetido:

- **A pedido, desde la app**: en Hoy, al lado de "precios actualizados…", **Actualizar ahora** (también en ⋯ → Fuentes y fechas). Lanza el workflow con `origen: app`, espera la corrida y lee los archivos nuevos directo de la API (sin esperar a que se publique la página). Tarda alrededor de un minuto. Usa el permiso de sincronizar, que necesita **Actions: Read and write** además de Contents: si es un permiso viejo, en GitHub → Settings → Developer settings → Fine-grained tokens → "Tablero (sincronizar)" → Edit → sumar Actions. El texto del permiso no cambia, no hay que volver a pegarlo.
- **A horario, con cron-job.org** (gratis): llama a `workflow_dispatch` con `origen: cron` de lunes a viernes a las 11:30, 14:30 y 17:30 (zona `America/Argentina/Buenos_Aires`). La guía paso a paso, con los valores para copiar, está en ⋯ → Fuentes y fechas → "Que se actualicen solos a horario". Usa un permiso aparte que solo tiene **Actions: Read and write**.
  - URL: `POST https://api.github.com/repos/<usuario>/<repo>/actions/workflows/mercado.yml/dispatches`
  - Encabezados: `Accept: application/vnd.github+json`, `Authorization: Bearer <permiso>`, `X-GitHub-Api-Version: 2022-11-28`, `Content-Type: application/json`
  - Cuerpo: `{"ref":"main","inputs":{"origen":"cron"}}`. Respuesta esperada: `204`.

La corrida programada de GitHub queda como respaldo (minuto 20). Las que llegan con origen `schedule` o `cron` se saltean si `market.json` tiene menos de 40 minutos, así no se duplican commits ni alertas. Las de la app y las manuales corren siempre.

## Seguridad

- **Clave**: de la frase depende todo, porque el archivo cifrado es público. Para cambiarla: ⋯ → Seguridad → Cambiar la clave (exige frase larga, muestra la fortaleza y puede proponer una). Se recifra y se sube en el mismo paso.
- **Bloqueo** por inactividad (15 minutos por defecto) y "Bloquear ahora".
- **Olvidar este dispositivo**: borra clave, permiso y datos locales de ese navegador.
- Lo que se guarda en el dispositivo (cambios, permiso de GitHub) va cifrado con la misma clave.
- Las bibliotecas externas (Chart.js, SheetJS, pdf.js) solo se ejecutan si su huella SHA-384 coincide con la verificada en `js/ui/comun.js`. Para actualizar una versión hay que cambiar ahí la dirección y la huella.
- El extracto del banco se lee en el navegador y no se sube; lo que queda guardado va dentro de los datos cifrados.

## Alertas de precio

Los movimientos fuertes aparecen en Hoy; los críticos además llegan al teléfono por la app **ntfy** (gratuita): se instala, se toca "Suscribirse a un tema" y se pega el nombre del canal. Los umbrales y el detalle están en `docs/plan.md`.

Cuando cambian las tenencias o la watchlist hay que rearmar la configuración privada (con los datos descifrados):

```bash
python tools/alertas_config.py privado/datos_actual.json | gh secret set ALERTAS_CONFIG
```

Pruebas del evaluador: `python tools/pruebas_alertas.py`.

## Cambios de datos a mano

En la carpeta del proyecto, con la clave:

```bash
python tools/cripto.py descifrar data/cartera.enc.json privado/datos_iniciales.json
```

Se edita `privado/datos_iniciales.json` y se vuelve a cifrar con `cifrar` (mismos argumentos, al revés). `privado/` nunca se sube. Al cifrar se conserva el *salt*, así los dispositivos que recuerdan la clave siguen abriendo.

## Cómo funciona por dentro

| Archivo | Qué hace |
|---|---|
| `js/estado.js` | Aplica el registro de eventos sobre los datos base y valúa todo en USD MEP. Puro. |
| `js/motor.js` | `evaluarReglas`, `planificador`, `repartirAporte`, `recomendarAporte`. Puros: los umbrales salen de los datos. |
| `js/finanzas.js` | Costo de lotes, XIRR, benchmark simulado, costos anuales. |
| `js/extracto.js` | Lectura de extractos (tabla, CSV, texto) y categorización de gastos. Puro. |
| `js/sync.js` | Leer, fusionar y subir el archivo cifrado a GitHub; pedir precios nuevos (`actualizarMercado`). |
| `js/seguridad.js` | Fortaleza de la clave, generador de frases, guardado local cifrado, bloqueo. |
| `js/cripto.js`, `js/db.js` | WebCrypto e IndexedDB. |
| `js/ui/*.js` | Pantallas, menú y el paso a paso del mes (`mes.js`). |
| `js/pruebas.js` | Pruebas; corren en `tests.html` y con `node tools/pruebas_node.mjs`. |
| `js/pruebas_publicas.js` | Pruebas que no usan datos privados (ADR, inflación, vencimientos, respaldo cifrado); también corren en cada PR. |
| `tools/mercado.py` | Escribe `data/market.json`, `data/insiders.json` y `data/historico.json`. Si una fuente falla, conserva el último dato y lo marca `stale`. |
| `data/calendario.json` | Cupones y amortización de la ON, por cada 1 de valor nominal. |

**Eventos**: `aporte`, `compra`, `cobro`, `venta`, `mes` (cierre con gastos), `reglas_gasto`, `paso`, `decision`, `config`, `perfil`, `fecha_aporte`, `aporte_historico`, `importar_lotes`. Se aplican encima de los datos base; al sincronizar se guarda base + eventos + un valor de patrimonio por día.

**Fuentes de mercado** (en la app: ⋯ → Fuentes y fechas):

| Dato | Fuente |
|---|---|
| MEP, CCL, oficial | dolarapi.com `/v1/dolares` (MEP = promedio compra/venta de "bolsa") |
| CEDEARs, acciones, ON | data912.com `live/arg_cedears`, `arg_stocks`, `arg_corp` (las ON vienen cada 100 VN) |
| Cuotapartes de fondos | api.argentinadatos.com `/v1/finanzas/fci/…/ultimo` (`vcp` viene cada 1.000 cuotapartes) |
| MEP promedio por mes | api.argentinadatos.com `/v1/cotizaciones/dolares/bolsa` |
| ETF en USD e histórico | yfinance (cierre ajustado diario) |
| Compras de directivos | OpenInsider, tabla del filtro configurado en `tools/mercado_config.json` |
| Inflación de EE.UU. | FRED, serie `CPIAUCSL` (CSV público, sin clave): rendimiento real en Informes |

## Probar en la computadora

```bash
python tools/servidor.py
```

y abrir http://localhost:8765. Pruebas: http://localhost:8765/tests.html o `node tools/pruebas_node.mjs` (necesita los datos descifrados en `privado/`).

Sin datos privados (lo mismo que corre GitHub Actions en cada PR, workflow `pruebas.yml`):

```bash
node tools/chequear_modulos.mjs && node tools/pruebas_publicas.mjs
python tools/pruebas_alertas.py && python tools/pruebas_mercado.py
```

El Action de mercado instala `yfinance` desde `tools/requirements.txt` (rango acotado a la versión mayor actual) y deja la versión en el registro de la corrida.

Los cambios de código van por rama y PR; a `main` solo escriben directo el Action de mercado y la sincronización de la app.
