#!/usr/bin/env python3
"""Datos de contexto que baja el Action: riesgo país, tasa de plazo fijo, cuotapartes históricas de los fondos,
indicadores de FRED, histórico mensual largo de los ETF y mercados de predicción de la elección presidencial.

Mismo patrón que mercado.py: cada fuente va por separado y, si falla, se conserva lo anterior marcado `stale`.
Escribe data/argentina.json, data/clima.json y data/largo_plazo.json. Lo llama mercado.main(), que se pasa a sí
mismo (`m`) para usar la misma red, la misma configuración y las mismas funciones de sección.
Todo es público y de solo lectura: acá no hay nada de la cartera.
"""
import datetime as dt
import json
import re

ARGENTINADATOS = "https://api.argentinadatos.com/v1"
FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv"
KALSHI = "https://api.elections.kalshi.com/trade-api/v2"
POLYMARKET = "https://gamma-api.polymarket.com"
# Riesgo de bonos de alto rendimiento, curva 10 años − 3 meses, VIX e índice de condiciones financieras de Chicago.
SERIES_FRED = ("BAMLH0A0HYM2", "T10Y3M", "VIXCLS", "NFCI")
MAX_PEDIDOS_HISTORIA = 80  # pedidos de cuotapartes viejas por corrida: la primera vez se completa en pocas corridas


def _serie(filas, desde):
    """{fechas, valores, ultimo} desde [{fecha, valor}], a partir de `desde`."""
    pares = sorted((f["fecha"], float(f["valor"])) for f in filas if f.get("fecha") and f.get("valor") is not None and f["fecha"] >= desde)
    if len(pares) < 5:
        raise RuntimeError("sin historia suficiente")
    return {"fechas": [f for f, _ in pares], "valores": [v for _, v in pares], "ultimo": {"fecha": pares[-1][0], "valor": pares[-1][1]}}


def riesgo_pais(m):
    return _serie(json.loads(m.bajar(f"{ARGENTINADATOS}/finanzas/indices/riesgo-pais")), m.CFG["contexto_desde"])


def plazo_fijo(m):
    s = _serie(json.loads(m.bajar(f"{ARGENTINADATOS}/finanzas/tasas/depositos30Dias")), m.CFG["historico_desde"])
    return dict(s, nota="Tasa nominal anual promedio de depósitos a 30 días (BCRA, vía ArgentinaDatos), como fracción.")


# ---------- cuotapartes históricas ----------

def _filas_fci(m, categoria, ruta="ultimo", intentos=2):
    filtro = m.CFG["fci_filtro"].lower()
    filas = json.loads(m.bajar(f"{ARGENTINADATOS}/finanzas/fci/{categoria}/{ruta}", intentos=intentos))
    return [f for f in filas if filtro in (f.get("fondo") or "").lower() and f.get("vcp") and f.get("fecha") and (f.get("patrimonio") or 0) > 0]


def _sumar(acumulado, filas, desde):
    for f in filas:
        if f["fecha"] >= desde:  # los fondos sin actividad vienen con fechas viejas
            acumulado.setdefault(f["fondo"], {})[f["fecha"]] = round(f["vcp"] / 1000, 6)  # vcp viene cada 1.000 cuotapartes


def _meses(desde, antes_de):
    """Meses 'AAAA-MM' desde `desde` hasta el anterior a `antes_de`."""
    a, mes = int(desde[:4]), int(desde[5:7])
    while f"{a}-{mes:02d}" < antes_de:
        yield f"{a}-{mes:02d}"
        a, mes = (a + 1, 1) if mes == 12 else (a, mes + 1)


def _ultimos_habiles(mes, cuantos=12):
    a, n = int(mes[:4]), int(mes[5:7])
    d = dt.date(a + (n == 12), n % 12 + 1, 1) - dt.timedelta(days=1)
    dias = []
    while len(dias) < cuantos:
        if d.weekday() < 5:
            dias.append(d.isoformat())
        d -= dt.timedelta(days=1)
    return dias


def fondos(m, anterior, hoy):
    """Valor de cuotaparte de los fondos que sigue market.json: el de hoy se acumula y lo viejo se completa con
    un valor cercano a cada fin de mes desde historico_desde. A ArgentinaDatos le faltan días: se prueba hacia atrás."""
    anterior = anterior or {}
    previas = anterior.get("fechas") or []
    acumulado = {n: {f: v for f, v in zip(previas, s) if v is not None} for n, s in (anterior.get("series") or {}).items()}
    vacios, pedidos = set(anterior.get("vacios") or []), 0
    for categoria in m.CFG["fci_categorias"]:
        actuales = _filas_fci(m, categoria)
        if not actuales:
            raise RuntimeError(f"fci {categoria}: sin fondos")
        nombres = {f["fondo"] for f in actuales}
        desde = m.CFG["historico_desde"]
        _sumar(acumulado, actuales, desde)
        for mes in _meses(desde[:7], hoy[:7]):
            clave = f"{categoria}:{mes}"
            if clave in vacios or any(f[:7] == mes and f[8:] >= "10" for n in nombres for f in acumulado.get(n, {})):
                continue
            sin_dato = 0
            for dia in _ultimos_habiles(mes):
                if pedidos >= MAX_PEDIDOS_HISTORIA:
                    break
                pedidos += 1
                try:
                    filas = [f for f in _filas_fci(m, categoria, dia.replace("-", "/"), intentos=1) if f["fondo"] in nombres]
                except Exception as e:  # noqa: BLE001
                    sin_dato += "404" in str(e)  # "no existe" se recuerda; un corte de red, no
                    continue
                if len(filas) >= max(1, len(nombres) // 4):
                    _sumar(acumulado, filas, desde)
                    break
                sin_dato += 1
            if sin_dato == len(_ultimos_habiles(mes)):
                vacios.add(clave)
    fechas = sorted({f for s in acumulado.values() for f in s})
    return {"fechas": fechas, "series": {n: [acumulado[n].get(f) for f in fechas] for n in sorted(acumulado)},
            "vacios": sorted(vacios), "nota": "Valor de cada cuotaparte, en la moneda del fondo (ArgentinaDatos, datos de CAFCI)."}


# ---------- FRED ----------

def fred(m, serie):
    """Serie de FRED (CSV público, sin clave): un valor por semana (el último) y el último dato diario."""
    texto = m.bajar(f"{FRED}?id={serie}&cosd={m.CFG['largo_desde']}")
    pares = []
    for linea in texto.strip().splitlines()[1:]:
        partes = linea.strip().split(",")
        if len(partes) != 2 or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", partes[0]):
            continue
        try:
            pares.append((partes[0], float(partes[1])))
        except ValueError:  # días sin dato: vacío o "."
            continue
    if len(pares) < 20:
        raise RuntimeError(f"fred {serie}: sin historia")
    semanas = {}
    for f, v in sorted(pares):
        semanas[dt.date.fromisoformat(f).isocalendar()[:2]] = (f, v)
    valores = sorted(semanas.values())
    return {"serie": serie, "fechas": [f for f, _ in valores], "valores": [v for _, v in valores],
            "ultimo": {"fecha": valores[-1][0], "valor": valores[-1][1]}}


# ---------- histórico mensual largo ----------

def yahoo_mensual(ticker, desde):
    """{'AAAA-MM': cierre ajustado del mes} con yfinance."""
    import yfinance as yf  # se importa acá para que el resto funcione aunque no esté instalado
    h = yf.Ticker(ticker).history(start=desde, interval="1mo", auto_adjust=False)
    out = {}
    for fecha, fila in h.iterrows():
        a = fila.get("Adj Close")
        if a is None or a != a:  # NaN
            continue
        out[fecha.strftime("%Y-%m")] = round(float(a), 4)
    return out


def mes_anterior(hoy):
    return (dt.date.fromisoformat(hoy[:7] + "-01") - dt.timedelta(days=1)).isoformat()[:7]


def largo_plazo(m, hoy):
    """Cierres mensuales ajustados de los ETF de referencia desde 2005, sin el mes en curso."""
    series = {t: {k: v for k, v in yahoo_mensual(t, m.CFG["largo_desde"]).items() if k < hoy[:7]} for t in m.CFG["usd_tickers"]}
    cortos = [t for t, s in series.items() if len(s) < 60]
    if cortos:
        raise RuntimeError("largo plazo: sin historia de " + ", ".join(cortos))
    meses = sorted(set().union(*series.values()))
    return {"fechas": meses, "series": {t: [s.get(k) for k in meses] for t, s in series.items()}, "hasta": meses[-1],
            "nota": "Cierre de cada mes ajustado por dividendos, en USD (yfinance)."}


# ---------- elección presidencial: mercados de predicción (solo lectura) ----------

def kalshi(m):
    cfg = m.CFG["elecciones"]
    d = json.loads(m.bajar(f"{KALSHI}/events?series_ticker={cfg['kalshi_serie']}&with_nested_markets=true"))
    anio = cfg["fecha"][2:4]
    eventos = [e for e in d.get("events") or [] if str(e.get("event_ticker", "")).split("-", 1)[-1].startswith(anio)]
    candidatos = []
    for e in eventos[:1]:
        for x in e.get("markets") or []:
            if x.get("status") not in ("active", "open") or not x.get("yes_sub_title"):
                continue
            compra, venta, ultimo = (float(x.get(k) or 0) for k in ("yes_bid_dollars", "yes_ask_dollars", "last_price_dollars"))
            # punta media si las puntas están juntas; si no, el último precio operado
            prob = (compra + venta) / 2 if compra > 0 and venta > 0 and venta - compra <= 0.1 else ultimo
            candidatos.append({"nombre": x["yes_sub_title"].strip(), "prob": round(prob, 4), "volumen": round(float(x.get("volume_fp") or 0))})
    if not candidatos:
        raise RuntimeError("kalshi: sin mercados abiertos de la elección")
    return {"nombre": "Kalshi", "url": "https://kalshi.com/markets/" + cfg["kalshi_serie"].lower(), "evento": eventos[0].get("title"),
            "volumen_unidad": "contratos de USD 1", "candidatos": sorted(candidatos, key=lambda c: -c["prob"])}


def polymarket(m):
    cfg = m.CFG["elecciones"]
    eventos = json.loads(m.bajar(f"{POLYMARKET}/events?slug={cfg['polymarket_slug']}"))
    if not eventos or str(eventos[0].get("endDate", ""))[:4] != cfg["fecha"][:4]:
        raise RuntimeError("polymarket: no encuentro el evento de la elección")
    candidatos = []
    for x in eventos[0].get("markets") or []:
        nombre = (x.get("groupItemTitle") or "").strip()
        # los casilleros reservados ("Person A", "Other") no son candidatos
        if x.get("closed") or not nombre or re.fullmatch(r"(person|candidate|individual)\s+\w{1,3}|other|another.*", nombre, re.I):
            continue
        try:
            resultados, precios = json.loads(x.get("outcomes") or "[]"), json.loads(x.get("outcomePrices") or "[]")
            prob = float(precios[resultados.index("Yes")])
        except (ValueError, IndexError, TypeError):
            continue
        volumen = float(x.get("volumeNum") or x.get("volume") or 0)
        if volumen > 0:
            candidatos.append({"nombre": nombre, "prob": round(prob, 4), "volumen": round(volumen)})
    if not candidatos:
        raise RuntimeError("polymarket: sin mercados abiertos de la elección")
    return {"nombre": "Polymarket", "url": "https://polymarket.com/event/" + cfg["polymarket_slug"], "evento": eventos[0].get("title"),
            "volumen_unidad": "USD operados", "candidatos": sorted(candidatos, key=lambda c: -c["prob"])}


def elecciones(m, anterior):
    cfg, anterior = m.CFG["elecciones"], anterior or {}
    out = {"fecha": cfg["fecha"], "kalshi": m.seccion("kalshi", anterior.get("kalshi"), lambda: kalshi(m))}
    # Polymarket está bloqueado en Argentina por orden judicial: solo se lee si se activa en mercado_config.json.
    out["polymarket"] = (m.seccion("polymarket", anterior.get("polymarket"), lambda: polymarket(m))
                         if cfg.get("polymarket_activado") else {"nombre": "Polymarket", "desactivado": True})
    return out


def correr(m):
    """Baja todo el contexto y escribe sus tres archivos. m = módulo mercado."""
    hoy = m.hoy_argentina()
    a = m.leer("argentina.json")
    m.escribir("argentina.json", {
        "generado": m.ahora(),
        "riesgo_pais": m.seccion("riesgo_pais", a.get("riesgo_pais"), lambda: riesgo_pais(m)),
        "plazo_fijo": m.seccion_diaria("plazo_fijo", a.get("plazo_fijo"), lambda: plazo_fijo(m)),
        "fondos": m.seccion("fondos", a.get("fondos"), lambda: fondos(m, a.get("fondos"), hoy)),
        "elecciones": elecciones(m, a.get("elecciones")),
    })
    previo = m.leer("clima.json").get("series") or {}
    m.escribir("clima.json", {"series": {s: m.seccion_diaria(f"fred {s}", previo.get(s), lambda s=s: fred(m, s)) for s in SERIES_FRED}})
    l = m.leer("largo_plazo.json")
    # solo cambia cuando cierra un mes
    m.escribir("largo_plazo.json", m.seccion_diaria("largo_plazo", l, lambda: largo_plazo(m, hoy), dias=40,
                                                    vigente=lambda x: x.get("hasta") == mes_anterior(hoy)))
