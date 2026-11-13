# Plan de trabajo por etapas

Rama: `etapas-0-6`. Nada de esto está en `main` hasta que se apruebe el PR.

Reglas: no perder ni exponer datos; `main` no se toca sin aprobación; cada etapa se valida antes de seguir; si una falla tres veces, se frena y se reporta.

| Etapa | Estado | Qué falta |
|---|---|---|
| 0 · Privacidad y seguridad | Hecha (código en la rama) | Decidir: repo privado, rotar clave, limpiar historial, separar los datos |
| 1 · Auditoría | Hecha | — |
| 2 · Sincronización | Hecha | Probar con un permiso real de GitHub (no se puede simular desde afuera) |
| 3 · Fuentes | Hecha (evaluación + "Fuentes y fechas") | Aprobar qué fuentes nuevas sumar |
| 4 · Cuánto invierto | Hecha | Probar con un extracto real del banco |
| 5 · Reglas e instrucciones | Propuesta | Aprobación punto por punto |
| 6 · Extras | Propuesta priorizada | Elegir cuáles |

Cómo probar todo: `python tools/servidor.py` y abrir http://localhost:8765 (pide la clave; lo que registres ahí queda solo en esa dirección local, no toca los datos publicados). Pruebas: http://localhost:8765/tests.html o `node tools/pruebas_node.mjs` (36 pruebas).

---

## Etapa 0 · Privacidad y seguridad

### Qué puede ver un tercero hoy (evidencia)

| Qué | Dónde | Qué revela |
|---|---|---|
| Código completo | `js/`, `tools/`, `index.html` | Cómo funciona la app y la forma de las reglas (R1–R7, C1–C3). **No** hay montos, cantidades ni tickers propios: los umbrales y las tenencias viven en el archivo cifrado; los valores de control de las pruebas también. |
| Archivo cifrado | `data/cartera.enc.json` (y la URL pública de Pages) | Tamaño (~25 KB), parámetros de cifrado y el texto cifrado. Cualquiera puede bajarlo y probar claves sin límite: **la única barrera es la frase**. |
| Historial de git | commits | Todas las versiones anteriores del archivo cifrado (misma clave) y **cuándo** se sincroniza (fecha y hora de cada commit `datos: sincronización…`). Autor: nombre de pila y mail `noreply` de GitHub. |
| Datos de mercado | `data/market.json`, `insiders.json`, `historico.json` | Listas completas (todos los CEDEARs, acciones, ON), para no delatar tenencias. |
| Pistas indirectas | `tools/mercado_config.json` (filtro de fondos por administradora, 4 ETF de referencia), `data/calendario.json` (una ON puntual), textos de la interfaz (broker, "YPF" como bloque, "Allaria") | Que es un inversor argentino, con qué broker opera, qué ETF usa de referencia y que tiene exposición a esa ON. No montos. |
| Logs del Action | pestaña Actions | Solo `ok`/`FALLA` por fuente. Sin datos privados. |
| Permiso de GitHub | IndexedDB del dispositivo (no viaja) | No es visible desde afuera. Riesgo: código que corra en la misma dirección (`usuario.github.io` es compartido por **todos** los sitios Pages de la cuenta) o una biblioteca externa adulterada. |

No se sube: `privado/`, `CLAUDE.md`, `.claude/`, PDFs, Excel.

### Qué se endureció en la rama

- **Bibliotecas externas verificadas**: Chart.js, SheetJS y pdf.js se bajan, se comprueba su huella SHA-384 y recién entonces se ejecutan. Si el CDN entrega otra cosa, no corre.
- **Política de contenido (CSP)**: la página solo ejecuta código propio o bibliotecas verificadas y solo se conecta a GitHub y a los dos CDN.
- **Guardado local cifrado**: eventos, valores diarios, respaldo importado y el permiso de GitHub se guardan cifrados con la clave de los datos (antes iban en claro en IndexedDB). Límite honesto: si el dispositivo "recuerda" la clave, quien tenga acceso al perfil del navegador puede usarla.
- **Bloqueo por inactividad** (5 / 15 / 60 min / nunca) y **Bloquear ahora**: pide la frase aunque el dispositivo la recuerde.
- **Olvidar este dispositivo**: borra clave, permiso y datos locales (avisa si hay cambios sin sincronizar).
- **Cambio de clave seguro**: exige frase larga (≥ 20 caracteres y ≥ 60 bits estimados), muestra un indicador de fortaleza, propone una frase al azar y solo cambia si la subida del archivo recifrado sale bien (antes se podía cambiar en el dispositivo y dejar el archivo publicado con la clave vieja).
- **Mostrar/Ocultar** la clave al escribirla.

### Decisión pendiente (no se hizo nada de esto)

| Opción | A favor | En contra |
|---|---|---|
| **A. Pasar el repo a privado** | Oculta código, historial y horarios de sincronización. | Con cuenta gratuita, Pages deja de funcionar; con plan pago el sitio sigue siendo público, así que el archivo cifrado se baja igual. No protege lo que importa. El Action pasa a consumir minutos (alcanzan). La lectura "fresca" sin permiso deja de andar. |
| **B. Rotar la clave y limpiar el historial** | Con una frase fuerte, el archivo publicado es inviolable en la práctica. Sacar las versiones viejas elimina lo cifrado con la clave anterior. | Limpiar no garantiza nada sobre copias ya hechas. Reescribir el historial es un `force-push` a `main` (irreversible); lo más limpio es borrar y recrear el repo. Lo ya publicado con la clave anterior hay que considerarlo expuesto a fuerza bruta para siempre. |
| **C. Sacar los datos a un repo privado aparte** | El archivo cifrado deja de ser público (dos barreras: permiso + clave). El permiso ya no puede tocar el código de la app (hoy sí: con escritura sobre este repo, un permiso robado permitiría cambiar la app). | Cada dispositivo nuevo necesita clave **y** permiso (dos minutos). Se pierde "abro el link y listo". Cambio de arquitectura. |

**Recomendación:** B ya (rotar a una frase de 6 palabras al azar desde Seguridad → Cambiar la clave, una vez mergeado esto y activada la sincronización) y C como paso siguiente. A no aporta. La limpieza del historial, solo recreando el repo y solo si se quiere: el repo es nuevo y el riesgo real es bajo, pero no es cero.

### Extractos bancarios

Se leen en el navegador (CSV, Excel, PDF o texto pegado); el archivo no se sube a ningún lado ni se guarda. Lo que queda (movimientos categorizados y totales del mes) va dentro de los datos cifrados: cifrado en IndexedDB y cifrado en el archivo publicado. Nunca en claro ni en el repo.

---

## Etapa 1 · Auditoría de punta a punta

### Fallas

1. **Sincronizar perdía cambios** (detalle en la Etapa 2).
2. Cambiar la clave sin sincronizar dejaba el dispositivo con una clave y el archivo publicado con otra.
3. El respaldo se exporta sin cifrar (queda propuesto cambiarlo en la Etapa 6).
4. La regla R5 figura "Excedida" de forma permanente (cuenta YPF dentro de satélites): ruido constante en rojo. Propuesta en la Etapa 5.
5. El rendimiento anual está probablemente inflado: el costo de lo que hay supera a los aportes cargados. Ya se avisa; depende de cargar los aportes que falten.

### Textos confusos (corregidos en la rama salvo indicación)

- "Sincronizar" decía "abrí Claude Code y decile…": incomprensible para quien usa la app. Reemplazado por una guía de cuatro pasos.
- El punto naranja no decía qué significaba: ahora hay una línea de estado ("2 cambios sin subir", "Sincronizado hace 3 min", "No se pudo sincronizar: …") en Hoy, en el menú y en el diálogo.
- "precios de hace 4 h" no decía de dónde: ahora abre "De dónde sale cada dato".
- Carteles "no es asesoramiento financiero / impositivo" y similares: eliminados de la interfaz, los informes y `NOTAS.md`.
- Pendiente (Etapa 5): siglas sin explicar (LP, R3, XIRR, "Δ tenencia"); "Reglas que mandan hoy" muestra identificadores en vez de frases.

### Pasos innecesarios

- "Cargar el mes" (5 campos a mano) duplicaba lo que ahora hace "Cuánto invierto": se quitó del menú.
- Configuración mezclaba clave, permiso y apariencia: se separó en Configuración (ingreso, día de cobro, apariencia) y Seguridad.
- En Cartera, 11 columnas obligan a deslizar en el celular (sin cambios; propuesta: vista resumida en móvil).

### De dónde sale cada dato

| Dato | Fuente | Alimenta |
|---|---|---|
| MEP, CCL | dolarapi.com | Toda la valuación en USD |
| CEDEARs, acciones, ON (ARS) | data912.com | Valuación, Aportar, Radar ("Hay CEDEAR") |
| Cuotapartes de fondos | argentinadatos.com (CAFCI) | Emergencia, renta fija |
| ETF en USD + histórico | Yahoo Finance (yfinance) | Benchmark, rendimiento del mes |
| MEP promedio mensual | argentinadatos.com | Cuánto invierto (paso 4) |
| Compras de directivos | OpenInsider (SEC, formulario 4) | Radar, avisos de Hoy |
| Cupones de la ON | Suplemento de prospecto (fijo) | Avisos y cobros en Hoy |
| Cantidades, lotes, caja | Resumen del broker (manual) | Todo |
| Aportes | Manual | Rendimiento (XIRR) |
| Cartera modelo | Allaria (manual) | Solo referencia: Radar e informe de contraste |

Dependencias: sin MEP no hay valuación en USD (se usa el del último resumen); sin data912 se usan los precios del resumen; sin yfinance no hay benchmark; el resto degrada sin romper nada.

---

## Etapa 2 · Sincronización

### Causa raíz

- **Sin permiso**: "Sincronizar" solo descargaba un archivo. Nada salía del dispositivo; por eso "no sincronizaba".
- **Con permiso** había un bug de pérdida de datos: al subir, la app **borraba** los cambios locales; pero al recargar leía el archivo de la página publicada, que tarda en actualizarse (`Cache-Control: max-age=600` + el despliegue). Durante ese rato los cambios desaparecían, y si en esa ventana se sincronizaba de nuevo, la subida pisaba el archivo con una base vieja y los primeros cambios **se perdían**. Tampoco se fusionaba con lo que hubiera subido otro dispositivo.

### Arreglo

- Antes de subir se lee el archivo **directo de la API de GitHub** (siempre al día), se **fusiona** (eventos por id, valores diarios) y se sube con control de versión; si otro dispositivo se adelantó, reintenta.
- Los cambios locales **no se borran al subir**: se dan por sincronizados cuando GitHub confirma y se limpian recién cuando el archivo leído ya los contiene.
- Al abrir, la app lee primero la copia fresca de GitHub y cae a la página publicada si no puede.
- Con permiso activo, **cada cambio se sube solo** a los pocos segundos; si falla (sin conexión, permiso vencido), queda el aviso y los cambios siguen en el dispositivo; reintenta al volver la conexión.
- Estado y fecha de la última sincronización siempre visibles.
- Guía del permiso dentro de la app: enlace a GitHub con el permiso precargado, qué marcar, dónde pegar; "Probar y activar" hace una sincronización real y solo guarda el permiso si funcionó.

Probado con GitHub simulado (conflicto, sin red, sin permiso). **No probado** contra GitHub real: hace falta un permiso, que solo puede crear el dueño.

---

## Etapa 3 · Fuentes

Allaria queda solo como referencia: se quitó de Hoy, de Cartera y de las marcas del Radar. Sigue en "Cartera modelo de referencia" (Radar) y en el informe de contraste.

| Fuente | Para qué | Viabilidad (verificado el 11/11/2026) | Licencia / condiciones | Estabilidad | Si falla |
|---|---|---|---|---|---|
| dolarapi.com | MEP, CCL | En uso. Responde sin clave. | Proyecto abierto, sin SLA | Media | data912 `/live/mep` (verificado) o MEP promedio de argentinadatos |
| data912.com | Precios locales | En uso. | Datos "educativos", sin SLA | Media | Precios del último resumen; dato marcado "sin actualizar" |
| argentinadatos.com | Fondos, MEP histórico, inflación | En uso (fondos y MEP mensual). Inflación verificada. | Abierto, sin clave | Media | CAFCI directo (hoy responde 403) |
| yfinance | ETF en USD | En uso. | No oficial; términos de Yahoo | Media-baja | FRED `SP500` (verificado; solo índice de precios, sin dividendos) |
| OpenInsider | Compras de directivos | En uso (se lee la tabla). | Sitio de terceros | Media-baja | SEC EDGAR |
| **SEC EDGAR** `data.sec.gov` | Formulario 4 por empresa (más preciso que el filtro de OpenInsider) | Verificado: responde JSON. | Dominio público. Pide identificar al cliente con un contacto y máx. 10 consultas/seg | Alta | OpenInsider |
| **BCRA** `api.bcra.gob.ar` | Dólar oficial, variables monetarias | Cotizaciones v1.0 responde; estadísticas v3.0 fue dada de baja (410): hay que usar la versión vigente | Datos públicos | Media (cambian versiones) | dolarapi |
| **datos.gob.ar** (series de tiempo) | IPC de INDEC | Verificado. | Datos abiertos (CC BY) | Alta | argentinadatos (inflación) |
| **FRED** | S&P 500, tasas, IPC de EE.UU. | CSV público verificado; la API formal pide clave gratuita | Uso libre citando la fuente | Alta | yfinance |

Propuesta (para aprobar): 1) SEC EDGAR para insiders de lo que hay en cartera y en la watchlist (requiere un contacto en la identificación del script; decidir cuál); 2) inflación (datos.gob.ar + FRED) para mostrar rendimiento real en Informes; 3) FRED como respaldo del benchmark. BCRA no agrega nada que hoy haga falta.

En la app: "⋯ → Fuentes y fechas" (y tocando "precios actualizados…" en Hoy) muestra fuente y fecha de cada dato y marca lo que quedó sin actualizar.

---

## Etapa 4 · Cuánto invierto

**Banco**: no encontré una API ni open banking del banco para clientes particulares en Argentina; lo verificable es la descarga de resúmenes en PDF desde la banca online. Por eso: importación local de PDF, Excel, CSV o texto pegado.

Flujo (Aportar → "¿Cuánto invierto este mes?", o el botón "Calcular con el extracto" del paso Aportá):

1. **Extracto**: archivo o texto pegado (o solo el total). El signo de cada movimiento sale de cómo se mueve el saldo; si el archivo es una tabla y las columnas no coinciden, se eligen a mano.
2. **Gastos**: lista con categoría editable, importe ajustable y "No es gasto". Al corregir una categoría, aprende el comercio y lo aplica a los parecidos y a los próximos meses.
3. **Ingreso**: referencia editable (opcional: guardarla como nueva referencia).
4. **Dólar**: MEP promedio del mes del extracto (sugerido) o MEP de hoy; editable.
5. **Cuánto**: rango entre el piso de ahorro y todo el sobrante, con la justificación (tasa de ahorro, estado del fondo de emergencia); se puede separar plata para objetivos externos; el monto final lo elige la persona.
6. **En qué**: reparto con `repartirAporte` (unidades enteras, primero lo más lejos de su peso).

Al guardar: queda el mes (alimenta la regla de ahorro R2), y el paso "Aportá" de Hoy usa el monto elegido.

**No probado con un extracto real**: los formatos del banco no los pude ver. Probado con tablas, CSV y texto sintéticos (ver pruebas). PDF con contraseña: avisa y pide pegar el texto.

---

## Etapa 5 · Revisión de reglas e instrucciones (propuesta: nada aplicado)

### Reglas del motor

| Regla | Veredicto | Por qué / cambio propuesto |
|---|---|---|
| R1 Emergencia | Se mantiene, con ajuste | Medir los meses con el gasto real promedio de los últimos cierres (hoy usa el gasto "habitual" fijo). |
| R2 Ahorro | Se mantiene | Ahora se alimenta sola con el cierre del mes. |
| R3 Núcleo < 70% | Se mantiene | Es la regla que ordena todo. Agregar la proyección "a este ritmo llegás en N meses". |
| R3B-E Banda ±3 pp | Se mantiene | — |
| R4 / R4B Topes por satélite | Se cambia (precisar) | No está definido hasta dónde vender al pasar el tope duro: hoy la app asume "hasta volver bajo la alerta". Confirmar, y exigir el chequeo de C2 antes de proponer la venta. |
| R5 Satélites totales | Se cambia | Tal como está cuenta YPF y queda "Excedida" permanente. Opciones: excluir YPF (la cubre R6) o marcarla "aceptada transitoriamente" como R6. |
| R6 YPF consolidada | Se mantiene, con ajuste | Falta un umbral para "se pasó de lo aceptado" y una salida esperada (dilución por aportes / vencimiento de la ON). |
| R7 Nuevas tesis | Se mantiene | — |
| C1 Costo de entrada | Se mantiene, con ajuste | El 0,68% estimado es fijo; calcularlo de las últimas compras reales. |
| C2 Ida y vuelta | Se mantiene | Solo informativa; mostrarla al registrar una venta (ya hay una nota). |
| C3 Costo anual | Se mantiene | — |
| Caja mínima para reinvertir (USD 50) | Se mantiene | Evita órdenes mínimas. Es un umbral agregado, confirmar. |
| Aviso "Revisá si falta un aporte" | Se mantiene hasta resolver | Es un control de consistencia, no una regla. |
| Señales de Allaria en Hoy | Eliminada (en la rama) | Pedido de la Etapa 3. |

### Especificación (`CLAUDE.md`, fuera del repo)

Cambios a aprobar: quitar el pie y el cartel impositivo; quitar las señales de Allaria y la columna en Cartera; reemplazar "Cargar el mes" por el flujo nuevo; sincronización automática con permiso en vez de descarga; guardado local cifrado; pdf.js como tercera biblioteca (solo bajo demanda, verificada); fuentes actualizadas (CAFCI y Stooq ya no sirven); lista de pruebas mínimas ampliada; flujo de ramas (abajo).

### `NOTAS.md`

Actualizado en la rama: sin carteles, sincronización nueva, seguridad, fuentes, cierre del mes.

### Flujo de ramas

Propuesta: los cambios de código van siempre por rama + PR y se mergean con aprobación; a `main` solo escriben directo el Action (datos de mercado) y la app (archivo cifrado). Sin protección de rama, porque bloquearía esas dos escrituras.

### Workflow de GitHub Actions

Se mantiene (3 corridas por día hábil, permisos mínimos, sin secretos). Cambios propuestos: fijar la versión de `yfinance` y de las acciones (hoy toma la última, riesgo de cadena de suministro); correr las pruebas en cada PR con datos de ejemplo (hoy necesitan los datos reales descifrados).

---

### Revisión contra el Excel de decisiones (rama `reglas-y-aportes`)

**Aportes.** La hoja de cashflows del Excel tenía un aporte que no estaba cargado. Se agregó como evento (`aporte_historico`). Con eso los aportes cierran contra el costo de la cartera, desaparece el paso "Revisá si falta cargar algún aporte" y el rendimiento anual pasa a un valor realista (antes estaba inflado).

**Reglas: qué cambió y por qué.**

| Regla | Cambio | Origen en el Excel |
|---|---|---|
| R1 Emergencia | Escalones: bajo el mínimo va todo el ahorro; entre mínimo y objetivo, el 25% del ahorro (antes se reponía todo de una vez); más de 12 meses, paso para decidir el destino del excedente. Cuando haya tres cierres de mes, los meses se miden con el gasto real promedio. | R1A, R1B, R1C |
| R5 Satélites totales | Pasar el techo ya no figura como "Excedida": pide un plan de normalización sin ventas, con fecha estimada. | R5A, R5B ("no venta automática") |
| R3 Núcleo | Muestra en cuántos meses de aportes vuelve al rango. | — |
| R6B Argentina total (nueva) | Riesgo argentino (acciones, ON y renta fija en pesos) sobre el patrimonio invertible: objetivo 20%, alerta 25%, techo 30%. | R6C |
| R7 Nuevas tesis | Además del núcleo bajo, bloquea si hay más de 5 tesis abiertas (YPF cuenta como una). | R15 |
| R8 Sin deuda (nueva) | Avisa si la cuenta queda con saldo deudor. | R11 |
| R9 Datos conciliados (nueva) | Avisa si falta un aporte material o hay fechas estimadas: sin eso el rendimiento no se puede leer. | R14 |
| Condiciones para una tesis nueva | En Radar: espera de 24/48 h, riesgo máximo por tesis y checklist V-5. Sin calculadora todavía. | R8A, R8B, R10, R12 |

**No se cambió** (queda a decisión): la definición de satélites sigue incluyendo la ON (en el Excel el "bono de emisor único" va aparte); la reserva sigue contando los dos fondos al 100% (el Excel le aplica un descuento del 10% al fondo en dólares); R4 sigue sin definir hasta dónde vender al pasar el tope duro; la banda de rebalanceo por bloque del Excel (5 pp o 25% relativo) no se usa porque la app no propone ventas.

**Decisiones del ranking** (hoja 01): quedan cubiertas por la app la 1 (seguridad), 2 (ahorro, con el cierre mensual), 4 (asignación), 5 (concentración: YPF y ahora Argentina), 7 (costos), 8 (rebalanceo con aportes), 9 (registro de decisiones) y 10 (medición: flujos completos y benchmark). Pendientes: 3 (objetivos con fecha para lo que está fuera de la cuenta), 6 y 11 (calculadora V-5 y tesis de una página, para cuando se desbloqueen las tesis nuevas).

**Corrección técnica**: confirmar la fecha de un aporte ahora lo identifica por monto y fecha original, no por su posición en la lista.

---

### Alertas de precio y ajustes (rama `alertas-y-ajustes`)

**Alertas de precio.** Dos niveles: *aviso* (se ve en Hoy) y *crítico* (además llega al teléfono). Todo se mide **en dólares**: el movimiento del precio en pesos corregido por lo que se movió el MEP, para que un salto del dólar no dispare todo junto.

| Qué dispara un crítico | Núcleo | Satélites | ON | Dólar MEP |
|---|---|---|---|---|
| Movimiento del día | ±5% | ±10% | ±4% | ±5% |
| Acumulado desde el precio de referencia, por escalones | ±10% | ±25% | ±8% | — |
| Tope duro de la regla de satélites | — | al precio en que la posición lo cruza | — | — |

Avisos en la app (no llegan al teléfono): núcleo ±3%, satélites ±6%, ON ±2%, watchlist ±8%, dólar ±3%.

Calibración con dos años de precios: con estos umbrales salen del orden de cuarenta críticos por año en total (menos de uno por semana, concentrados en semanas movidas). Bajando el núcleo a ±4% o los satélites a ±8% se duplican. Los umbrales están en los datos cifrados (`alertas`) y se pueden cambiar.

Cómo funciona: el Action de mercado (tres veces por día hábil) evalúa los umbrales con `tools/alertas.py` y avisa por ntfy. La lista de activos y sus niveles no está en el repositorio: va en el secreto `ALERTAS_CONFIG`, que arma `tools/alertas_config.py` desde los datos descifrados; el canal va en `NTFY_TOPIC`. El estado público (`data/alertas_estado.json`) solo tiene huellas con sal y contadores; los registros del Action solo dicen cuántos avisos salieron. Límites: la demora puede ser de hasta tres horas; hay que volver a armar el secreto cuando cambian las tenencias; los avisos pasan por ntfy.sh, un servicio de terceros (solo viaja el texto del aviso, no montos).

Cada aviso recuerda la regla: un movimiento de precio no dispara ninguna operación.

**Ajustes.**

- Informes → Rendimiento: tabla "Lo invertido a largo plazo, por bloque" (sin emergencia), comparada con el núcleo y con SPY. La vara principal pasa a ser el núcleo.
- Proyecciones: además del núcleo, cuándo bajan los satélites (techo, alerta y objetivo) y cuándo YPF llega a su objetivo. Cuando haya cierres de mes, usan el ahorro real en lugar del estimado.
- R4: queda escrito hasta dónde reducir si se pasa el tope duro (hasta la alerta) y qué revisar antes (costo de ida y vuelta y 48 horas).
- R6: el exceso de YPF se acepta hasta un máximo; por encima pide revisión. Muestra la fecha estimada de salida por dilución.
- R3: entre el mínimo y el objetivo, los aportes siguen al núcleo; una tesis nueva solo si R5 y R7 lo permiten.
- R1: muestra cuánto de la reserva está en pesos.
- Radar: cuánto sumaría abrir toda la watchlist frente al objetivo de satélites, cuándo sería posible y qué nombres ya están dentro de SPY.

Los valores de R4 (hasta la alerta) y R6 (máximo aceptado) son puntos de partida a confirmar.

---

## Etapa 6 · Extras (priorizados; nada implementado)

| # | Idea | Valor | Esfuerzo | Nota |
|---|---|---|---|---|
| 1 | Respaldo cifrado | Alto | Chico | Que "Exportar" baje el archivo cifrado; el JSON en claro, solo a pedido explícito. |
| 2 | Histórico de ahorro mensual | Alto | Chico | Los datos ya quedan con cada cierre: gasto, ingreso, tasa y categorías por mes. |
| 3 | Proyección al objetivo | Alto | Chico | "A este ritmo, el núcleo llega al 70% en N meses"; es el rebalanceo sin vender. |
| 4 | Datos de ejemplo + pruebas en cada PR | Medio | Medio | Permite validar cambios sin la clave. |
| 5 | Vencimientos (ON y otros) | Medio | Chico | El calendario de la ON ya existe; falta una vista de fechas. |
| 6 | Alertas de gasto atípico | Medio | Medio | Necesita al menos 3 meses cerrados. |
| 7 | Repo de datos aparte | Alto (seguridad) | Medio | Es la opción C de la Etapa 0. |
| 8 | Resumen semanal | Bajo | Medio | Sin notificaciones push, sería un bloque "desde la última vez". |
