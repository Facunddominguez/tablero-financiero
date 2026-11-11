# Tablero — notas de uso y de mantenimiento

Herramienta personal de seguimiento de inversiones. No es asesoramiento financiero.

- App: `index.html` + `styles.css` + módulos ES en `js/`. Sin build ni frameworks.
- Los datos privados viajan **cifrados** en `data/cartera.enc.json` (AES-256-GCM, PBKDF2-SHA256 con 600.000 iteraciones) y se descifran en el navegador con la clave. La clave no está en ningún archivo.
- Datos de mercado: un GitHub Action corre `tools/mercado.py` tres veces por día hábil.

## Uso diario

1. Abrí el link. La primera vez en cada dispositivo pide la clave; con "Recordar en este dispositivo" no la vuelve a pedir.
2. **Hoy** dice qué hacer. Cada paso tiene Hecho / Posponer / Descartar.
3. Lo que registres queda guardado **en ese dispositivo**. El punto naranja sobre el "⋯" avisa que hay cambios sin sincronizar.

## Sincronizar (para ver los cambios en otros dispositivos)

**Opción A — con un clic (recomendada, se configura una vez por dispositivo)**

1. En GitHub: Settings → Developer settings → Personal access tokens → *Fine-grained tokens* → Generate new token.
2. *Repository access*: Only select repositories → este repositorio. *Permissions* → Repository permissions → **Contents: Read and write**. Nada más.
3. En el tablero: ⋯ → Configuración → pegá el token → Guardar token.
4. Desde entonces: ⋯ → Sincronizar → Guardar en GitHub.

El token queda guardado solo en ese dispositivo (IndexedDB) y solo puede tocar este repositorio.

**Opción B — con un archivo**

1. ⋯ → Sincronizar → Descargar `cartera.enc.json` (ya sale cifrado).
2. Abrí Claude Code en la carpeta del tablero y decile:
   > Commiteá el `cartera.enc.json` que está en Descargas.

   Claude lo copia a `data/cartera.enc.json`, hace commit y push.

## Pedirle cambios de datos a Claude

En la carpeta del proyecto, con la clave a mano:

> La clave es `<clave>`. Descifrá los datos, cambiá X, volvé a cifrar y commiteá.

Claude usa `tools/cripto.py` (`descifrar` → edita `privado/datos_iniciales.json` → `cifrar`). `privado/` nunca se sube. Al cifrar se conserva el *salt* del archivo, así los dispositivos que recuerdan la clave siguen abriendo sin volver a pedirla.

## Cómo funciona por dentro

| Archivo | Qué hace |
|---|---|
| `js/estado.js` | Aplica el registro de eventos sobre los datos base y valúa todo en USD MEP. Puro. |
| `js/motor.js` | `evaluarReglas(estado)`, `planificador(estado, hoy)` y `repartirAporte(estado, usd)`. Puros: todos los umbrales salen de los datos. |
| `js/finanzas.js` | Costo de lotes, XIRR, benchmark simulado, costos anuales. |
| `js/cripto.js`, `js/db.js` | WebCrypto e IndexedDB. |
| `js/ui/*.js` | Las cinco pantallas y el menú. |
| `js/pruebas.js` | Pruebas del motor; corren en `tests.html` y con `node tools/pruebas_node.mjs`. |
| `tools/mercado.py` | Escribe `data/market.json`, `data/insiders.json` y `data/historico.json`. Si una fuente falla, conserva el último dato y lo marca `stale`. |
| `data/calendario.json` | Cupones y amortización de la ON, por cada 1 de valor nominal. |

**Eventos.** Los cambios locales son un registro de eventos (`aporte`, `compra`, `cobro`, `venta`, `mes`, `paso`, `decision`, `config`, `fecha_aporte`, `aporte_historico`, `importar_lotes`) que se aplican encima de los datos base. Al sincronizar se guarda base + eventos + un valor de patrimonio por día (para el gráfico de evolución).

**Fuentes de mercado.**

| Dato | Fuente |
|---|---|
| MEP, CCL, oficial | dolarapi.com `/v1/dolares` (MEP = promedio compra/venta de "bolsa") |
| CEDEARs, acciones, ON | data912.com `live/arg_cedears`, `arg_stocks`, `arg_corp` (las ON vienen cada 100 VN: se divide por 100) |
| Cuotapartes de FCI | api.argentinadatos.com `/v1/finanzas/fci/{mercadoDinero,rentaFija}/ultimo` (`vcp` viene cada 1.000 cuotapartes) |
| ETF en USD e histórico | yfinance (cierre ajustado diario) |
| Insiders | OpenInsider, tabla HTML del filtro configurado en `tools/mercado_config.json` |

## Probar en la computadora

```bash
python tools/servidor.py
```

y abrir http://localhost:8765. Pruebas: http://localhost:8765/tests.html o `node tools/pruebas_node.mjs` (necesita los datos descifrados en `privado/`).
