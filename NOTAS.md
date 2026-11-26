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
4. Para comprar, mirá la ventana que dice el paso. Si dice que no hay precio justo, tocá **Actualizar ahora** dentro de la ventana.
5. Debajo del patrimonio se ve siempre de cuándo son los precios (tocá para ver cada fuente) y el estado de la sincronización.

## Comprar al mejor precio

- **Precio justo** de un CEDEAR = precio en EE.UU. × dólar de referencia ÷ ratio. El dólar de referencia es la mediana del dólar implícito (contado con liqui) de los 30 papeles con más volumen.
- **Prima**: cuánto más caro o barato está contra ese precio. Entre dos ETF igual de atrasados va primero el más barato. El que está **más de 1% caro se saltea** ese día, con el motivo. La banda y los ETF elegibles no cambian.
- **Precio límite**: el precio justo (o el de pantalla, si está más barato) más 1%.
- Solo se calcula con precios tomados **con Wall Street abierto**, de hoy o de ayer. Si no, no saltea nada ni pone límite.
- Si el ratio que surge de los precios difiere más de 5% del oficial, pide revisarlo y no usa el precio justo.
- **Ventana**: con Wall Street abierto y hasta media hora antes del cierre de BYMA. Avisa feriados y medias ruedas de EE.UU. (no los feriados argentinos).
- **Dólares en la cuenta**: si la especie en dólares (SPYD, por ejemplo) no es más cara que en pesos, la sugiere. Al registrarla se descuentan los dólares y se suma al mismo activo.

## Riesgo

**Cartera → "% del riesgo"** y **Informes → Trimestral → Riesgo** muestran cuánto de los altibajos de la cartera de largo plazo explica cada cosa, la pérdida de un mes malo (1 de cada 20), y dos escenarios: el peor mes de cada activo a la vez y "crisis argentina" (peor mes de YPF, PAM y el dólar MEP). Sale de la volatilidad y las correlaciones de los últimos dos años. Los fondos en dólares y las ON usan una volatilidad fija, que se muestra como supuesto. Un ticker sin historia aparece como tal: se suma a `historico_extra`.

## Predicciones y carteras fantasma

- **Predicciones**: ⋯ → Anotar una predicción (o Radar → "Antes de abrir una tesis nueva"). Cuando vence, aparece en Hoy para marcar si se cumplió. **Informes → Predicciones y fantasmas** muestra el puntaje de Brier (0 es perfecto) y el acierto por rango de probabilidad.
- **Fantasmas**: "Seguir como fantasma" en Radar. Se comparan con SPY a 1, 3, 6 y 12 meses. Sin historia de precios, avisa qué sumar a `historico_extra`.
- **Allaria**: Informes → Contraste con Allaria → "Cargar una rotación nueva". Guarda la fecha, actualiza la cartera modelo y la suma como fantasma.
- **Satélites contra su referencia**: en el Trimestral. Los pares por defecto están en `js/diario.js` (sin referencia propia, SPY) y se cambian en los datos.

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
- **A horario, con cron-job.org** (gratis): llama a `workflow_dispatch` con `origen: cron` de lunes a viernes a las 11:40, 14:40 y 17:40 (zona `America/Argentina/Buenos_Aires`). Si estaba configurado en el minuto 30, conviene pasarlo a 40: a las 11:30 Wall Street recién abre y la primera corrida puede quedar sin precio justo. La guía paso a paso, con los valores para copiar, está en ⋯ → Fuentes y fechas → "Que se actualicen solos a horario". Usa un permiso aparte que solo tiene **Actions: Read and write**.
  - URL: `POST https://api.github.com/repos/<usuario>/<repo>/actions/workflows/mercado.yml/dispatches`
  - Encabezados: `Accept: application/vnd.github+json`, `Authorization: Bearer <permiso>`, `X-GitHub-Api-Version: 2022-11-28`, `Content-Type: application/json`
  - Cuerpo: `{"ref":"main","inputs":{"origen":"cron"}}`. Respuesta esperada: `204`.

La corrida programada de GitHub queda como respaldo (minuto 40). Las que llegan con origen `schedule` o `cron` se saltean si `market.json` tiene menos de 40 minutos, así no se duplican commits ni alertas. Las de la app y las manuales corren siempre.

## Seguridad

- **Clave**: de la frase depende todo, porque el archivo cifrado es público. Para cambiarla: ⋯ → Seguridad → Cambiar la clave (exige frase larga, muestra la fortaleza y puede proponer una). Se recifra y se sube en el mismo paso.
- **Bloqueo** por inactividad (15 minutos por defecto) y "Bloquear ahora".
- **Olvidar este dispositivo**: borra clave, permiso y datos locales de ese navegador.
- Lo que se guarda en el dispositivo (cambios, permiso de GitHub) va cifrado con la misma clave.
- Las bibliotecas externas (Chart.js, SheetJS, pdf.js) solo se ejecutan si su huella SHA-384 coincide con la verificada en `js/ui/comun.js`. Para actualizar una versión hay que cambiar ahí la dirección y la huella.
- El extracto del banco se lee en el navegador y no se sube; lo que queda guardado va dentro de los datos cifrados.

## Alertas de precio

Los movimientos fuertes aparecen en Hoy; los críticos además llegan al teléfono por la app **ntfy** (gratuita): se instala, se toca "Suscribirse a un tema" y se pega el nombre del canal. Los umbrales y el detalle están en `docs/plan.md`.

El umbral del día es **un múltiplo de lo que cada activo suele moverse** (volatilidad de las últimas semanas): aviso 2,5 veces, crítico 4 veces; para el núcleo, además ×1,25. Tiene un **máximo de 1,5 veces el umbral fijo** (crítico: 7,5% el núcleo, 15% los satélites, 7,5% el dólar). Lo que no tiene historia (las ON, por ejemplo) usa los umbrales fijos. Los escalones acumulados y el tope duro no cambian. Cada aviso de un CEDEAR dice cuánto fue EE.UU. y cuánto el dólar implícito. Los parámetros del teléfono están en `tools/alertas.py` (`PARAMETROS`) y los de la app en los datos (`alertas.volatilidad`); el secreto `ALERTAS_CONFIG` no cambia de formato.

Después de un salto muy grande la volatilidad queda alta durante algunas semanas: ahí es donde actúa el máximo.

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
| `js/motor.js` | `evaluarReglas`, `planificador`, `repartirAporte`, `recomendarAporte`, avisos de precio. Puros: los umbrales salen de los datos. |
| `js/finanzas.js` | Costo de lotes, XIRR, benchmark con CEDEARs, efecto canje, volatilidad reciente, historia de la cartera y rendimiento por período, costos anuales. |
| `js/precios.js` | Precio justo, precio límite, especie en dólares, ventana para comprar, por qué se movió un CEDEAR. Puro. |
| `js/riesgo.js` | Aporte de cada cosa al riesgo, mes malo y escenarios. Puro. |
| `js/diario.js` | Puntaje de las predicciones, carteras fantasma, satélites contra su referencia, rotaciones. Puro. |
| `js/ejemplo.js` | Cartera inventada para las pruebas públicas. |
| `js/extracto.js` | Lectura de extractos (tabla, CSV, texto) y categorización de gastos. Puro. |
| `js/sync.js` | Leer, fusionar y subir el archivo cifrado a GitHub; pedir precios nuevos (`actualizarMercado`). |
| `js/seguridad.js` | Fortaleza de la clave, generador de frases, guardado local cifrado, bloqueo. |
| `js/cripto.js`, `js/db.js` | WebCrypto e IndexedDB. |
| `js/ui/*.js` | Pantallas, menú y el paso a paso del mes (`mes.js`). |
| `js/pruebas.js` | Pruebas; corren en `tests.html` y con `node tools/pruebas_node.mjs`. |
| `js/pruebas_publicas.js` | Pruebas que no usan datos privados (precio justo, reparto, canje, riesgo, avisos, diario, historia, respaldo cifrado); también corren en cada PR. |
| `tools/mercado.py` | Escribe `data/market.json`, `data/insiders.json` y `data/historico.json`. Si una fuente falla, conserva el último dato y lo marca `stale`. |
| `tools/cedear_ratios.json` | Ratios oficiales de BYMA, con fuente y fecha. |
| `tools/grabadas/` | Respuestas grabadas y el histórico congelado para las pruebas de Python. |
| `data/calendario.json` | Cupones y amortización de la ON, por cada 1 de valor nominal. |
| `data/feriados_eeuu.json` | Feriados y medias ruedas de EE.UU. 2026 y 2027, y horario de BYMA. |

**Eventos**: `aporte`, `compra` (con `moneda: "USD"` y `especie` si se pagó en dólares), `cobro`, `venta`, `mes` (cierre con gastos), `reglas_gasto`, `paso`, `decision`, `config`, `perfil`, `fecha_aporte`, `aporte_historico`, `importar_lotes`, `prediccion`, `prediccion_resultado`, `fantasma`, `rotacion_allaria`. Se aplican encima de los datos base; al sincronizar se guarda base + eventos + un valor por día (patrimonio, largo plazo, núcleo, parte en CEDEARs y acciones, MEP y contado con liqui).

**Ajustes en los datos** (todos opcionales):

| Clave | Para qué | Por defecto |
|---|---|---|
| `config.prima_maxima` | Cuánto más caro que el precio justo se acepta comprar | 0,01 |
| `config.empate_deficit` | Atrasos que difieren menos que esto cuentan como iguales | 0,001 |
| `config.papeles_liquidos` | Papeles para la mediana del dólar implícito | 30 |
| `riesgo` | `vol_fija` (`fci_usd`, `on`, `sin_serie`), `series`, `percentil`, `ventana_dias`, `sigmas_peor_mes`, `crisis` | 3% · 8% · 35%; 5%; 504; 2,33; YPF, PAM, MEP |
| `alertas.volatilidad` | `aviso`, `critico`, `grupo`, `lambda`, `min_datos`, `tope` (0: sin máximo) | 2,5; 4; núcleo 1,25; 0,94; 40; 1,5 |
| `referencias` | Con qué se compara cada satélite | ver `js/diario.js` |

## Mantenimiento

- **Ratios de CEDEARs**: cambian cuando hay splits o ajustes. Bajar la lista vigente de [BYMA](https://www.byma.com.ar/productos/productos-financieros/cedears), actualizar `tools/cedear_ratios.json` (ratios y fecha). El tablero marca para revisar el que no cierra (`market.json` → `implicito.revisar_ratios`).
- **Marzo de 2027**: confirmar el horario de BYMA cuando EE.UU. pase al horario de verano y cargarlo en `data/feriados_eeuu.json` (hoy se asume cierre a las 17:00).
- **Antes de 2028**: sumar los feriados de EE.UU. de ese año.
- **Historia de precios**: lo que quieras medir (fantasmas, satélites, riesgo) tiene que estar en `historico_extra`. El archivo es público: no hace falta que sea algo que tenés.

**Fuentes de mercado** (en la app: ⋯ → Fuentes y fechas):

| Dato | Fuente |
|---|---|
| MEP, CCL, oficial | dolarapi.com `/v1/dolares` (MEP = promedio compra/venta de "bolsa") |
| CEDEARs, acciones, ON | data912.com `live/arg_cedears`, `arg_stocks`, `arg_corp` (las ON vienen cada 100 VN) |
| Cuotapartes de fondos | api.argentinadatos.com `/v1/finanzas/fci/…/ultimo` (`vcp` viene cada 1.000 cuotapartes) |
| MEP promedio por mes | api.argentinadatos.com `/v1/cotizaciones/dolares/bolsa` |
| MEP y contado con liqui de cada día | api.argentinadatos.com `/v1/cotizaciones/dolares/bolsa` y `/contadoconliqui` (punto medio): series `MEP` y `CCL` en `historico.json` |
| Dólar implícito por papel | data912.com `live/ccl`; si viene vacío (el 26/11/2026 venía vacío), se calcula con precios de data912 y ratios de BYMA. `market.json` → `implicito.ccl` |
| Precios de EE.UU. del momento | data912.com `live/usa_stocks` y `usa_adrs`; los ETF que no trae, yfinance. `market.json` → `implicito.usa` |
| Ratios de CEDEARs | BYMA, "CEDEARs Negociables en BYMA" (19/11/2026) |
| Feriados de EE.UU. y horario de BYMA | NYSE "Holidays & Trading Hours"; BYMA Comunicado 19031 |
| ETF en USD e histórico | yfinance (cierre ajustado diario) |
| Compras de directivos | OpenInsider, tabla del filtro configurado en `tools/mercado_config.json` |
| Inflación de EE.UU. | FRED, serie `CPIAUCSL` (CSV público, sin clave): rendimiento real en Informes |
| Histórico de lo que tenés | Yahoo Finance, tickers de `historico_extra` en `tools/mercado_config.json` (solo para reconstruir la evolución de tu cartera antes de los registros diarios; si un ticker falla no frena al resto) |

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

## Cómo se mide el rendimiento (Informes)

Una sola vara en Rendimiento, Mensual y Trimestral: **rendimiento por tiempo** en USD MEP, sin descontar inflación salvo la columna "Descontando inflación".

- **Tu cartera**: encadena la variación de un punto al siguiente descontando lo que entró (los aportes no cuentan como ganancia).
  - Desde el primer registro diario: los valores guardados cada día que se abre la app (solo con precios de mercado). Un aporte cargado con fecha anterior cuenta el día en que se cargó, que es cuando aparece en los registros.
  - Antes: estimado con los lotes actuales (precio histórico del subyacente en EE.UU. escalado al valor de hoy; ON y FCI en línea recta entre costo y valor actual) más la caja estimada (aportes + cupones + dividendos + resultados de ventas − compras). Una compra sin plata cargada que la cubra es un aporte implícito. El salto entre lo estimado y el primer registro no cuenta; si supera el 5 % se avisa.
- **SPY y núcleo**: simulan comprar **CEDEARs**, al cierre del primer día hábil, exactamente la plata que entró en tu cartera (aportes cargados + implícitos), con dividendos reinvertidos y sin costos: precio en EE.UU. × (contado con liqui ÷ MEP) del día.
- **Efecto canje**: el canje es la diferencia entre el contado con liqui y el MEP. "Activos" es el rendimiento con el canje quieto; "Efecto canje" es el resto (suman el total). En tu cartera solo se mueven con el canje los CEDEARs y las acciones locales. Si falta el canje de un día, se usa el último anterior.
- **Períodos**: "Este mes" y "Este año" arrancan en el último punto anterior al día 1. "Por año" solo con un año o más. "Descontando inflación" usa el IPC de EE.UU. del último mes publicado contra el del mes de inicio.
- La tabla "por bloque" es otra cosa a propósito: tasa anual (XIRR) desde cada compra de lo que hoy tenés.
- Validación: con un mundo de prueba de verdad conocida (precios reales, caja exacta) los tres períodos coinciden con un cálculo independiente; las pruebas de `js/pruebas_publicas.js` fijan los casos (aporte atrasado, aporte de fin de semana, cupones y ventas, aportes implícitos).

