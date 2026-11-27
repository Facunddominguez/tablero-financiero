#!/usr/bin/env python3
"""Baja los datos de mercado y escribe data/market.json, data/insiders.json y data/historico.json.

Biblioteca estándar + yfinance (para los cierres en USD). Cada fuente va por separado: si una falla, se conserva el último
dato bueno de esa sección y se marca `stale: true` con la fecha del intento.

Uso: python tools/mercado.py
"""
import datetime as dt
import html
import json
import pathlib
import re
import statistics
import sys
import time
import urllib.request

import senales

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DATA = RAIZ / "data"
CFG = json.loads((RAIZ / "tools" / "mercado_config.json").read_text(encoding="utf-8"))
UA = "tablero-mercado/1.0 (script personal de seguimiento; python-urllib)"
RATIOS = RAIZ / "tools" / "cedear_ratios.json"
PAPELES_LIQUIDOS = 30    # cuántos papeles (los de más volumen) forman la mediana del dólar implícito
MINIMO_PAPELES = 5       # con menos no hay mediana confiable
TOLERANCIA_RATIO = 0.05  # diferencia entre ratio oficial e inferido a partir de la cual hay que revisar


def ahora():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def bajar_bytes(url, intentos=3, espera=4, timeout=30, cabeceras=None):
    ultimo = None
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*", **(cabeceras or {})})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            ultimo = e
            time.sleep(espera * (i + 1))
    raise RuntimeError(f"{url[:60]}…: {ultimo}")


def bajar(url, **k):
    return bajar_bytes(url, **k).decode("utf-8", errors="replace")


def leer(nombre):
    try:
        return json.loads((DATA / nombre).read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def escribir(nombre, obj):
    (DATA / nombre).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def seccion(nombre, anterior, fn):
    """Corre fn(); si falla devuelve la sección anterior marcada como vieja."""
    try:
        datos = fn()
        datos["stale"] = False
        datos["actualizado"] = ahora()
        print(f"ok   {nombre}")
        return datos
    except Exception as e:  # noqa: BLE001
        print(f"FALLA {nombre}: {e}", file=sys.stderr)
        prev = dict(anterior or {})
        prev["stale"] = True
        prev["intento"] = ahora()
        prev["error"] = str(e)[:160]
        return prev


# ---------- fuentes ----------

def fx():
    casas = {c["casa"]: c for c in json.loads(bajar("https://dolarapi.com/v1/dolares"))}
    medio = lambda c: round((c["compra"] + c["venta"]) / 2, 2)  # noqa: E731
    return {
        "mep": medio(casas["bolsa"]),
        "mep_compra": casas["bolsa"]["compra"],
        "mep_venta": casas["bolsa"]["venta"],
        "ccl": medio(casas["contadoconliqui"]),
        "oficial": casas["oficial"]["venta"],
        "fecha": casas["bolsa"].get("fechaActualizacion"),
    }


_filas = {}  # lo ya bajado de data912 en esta corrida (se vacía al empezar main)


def data912_filas(ruta):
    if ruta not in _filas:
        filas = json.loads(bajar(f"https://data912.com/live/{ruta}"))
        if not isinstance(filas, list):
            raise RuntimeError(f"{ruta}: respuesta inesperada")
        _filas[ruta] = filas
    return _filas[ruta]


def data912(ruta, divisor=1):
    filas = data912_filas(ruta)
    precios = {}
    for f in filas:
        c = f.get("c")
        if f.get("symbol") and c and c > 0:
            precios[f["symbol"]] = [round(c / divisor, 6), f.get("pct_change") or 0]
    if len(precios) < 5:
        raise RuntimeError(f"{ruta}: respuesta vacía")
    return {"precios": precios}


def fci():
    filtro = CFG["fci_filtro"].lower()
    precios, fecha = {}, ""
    for cat in CFG["fci_categorias"]:
        for f in json.loads(bajar(f"https://api.argentinadatos.com/v1/finanzas/fci/{cat}/ultimo")):
            nombre = f.get("fondo") or ""
            if filtro in nombre.lower() and f.get("vcp") and (f.get("patrimonio") or 0) > 0:
                precios[nombre] = round(f["vcp"] / 1000, 6)  # vcp viene por cada 1.000 cuotapartes
                fecha = max(fecha, f.get("fecha") or "")
    if not precios:
        raise RuntimeError("fci: sin fondos")
    return {"precios": precios, "fecha": fecha}


_cotizaciones = {}  # históricos ya bajados en esta corrida


def cotizaciones(casa):
    """Histórico diario de un dólar en ArgentinaDatos: {fecha: punto medio compra/venta}."""
    if casa not in _cotizaciones:
        filas = json.loads(bajar(f"https://api.argentinadatos.com/v1/cotizaciones/dolares/{casa}"))
        out = {f["fecha"]: (f["compra"] + f["venta"]) / 2 for f in filas if f.get("compra") and f.get("venta") and f.get("fecha")}
        if len(out) < 3:
            raise RuntimeError(f"cotizaciones {casa}: sin historia")
        _cotizaciones[casa] = out
    return _cotizaciones[casa]


def mep_mensual():
    """Promedio mensual del dólar MEP (punto medio compra/venta) de los últimos 36 meses."""
    meses = {}
    for fecha, medio in sorted(cotizaciones("bolsa").items()):
        meses.setdefault(fecha[:7], []).append(medio)
    if len(meses) < 3:
        raise RuntimeError("mep_mensual: sin historia")
    return {"meses": {m: round(sum(v) / len(v), 2) for m, v in sorted(meses.items())[-36:]}}


def cpi_usa():
    """IPC de EE.UU. (CPIAUCSL, mensual, desestacionalizado) desde FRED: CSV público, sin clave."""
    texto = bajar("https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL")
    desde = CFG["historico_desde"][:7]
    meses = {}
    for linea in texto.strip().splitlines()[1:]:
        partes = linea.strip().split(",")
        if len(partes) != 2:
            continue
        fecha, valor = partes
        try:
            v = float(valor)
        except ValueError:  # FRED marca con "." los meses sin dato
            continue
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", fecha) and fecha[:7] >= desde:
            meses[fecha[:7]] = round(v, 3)
    if len(meses) < 6:
        raise RuntimeError("cpi_usa: sin historia")
    return {"meses": dict(sorted(meses.items())), "serie": "CPIAUCSL"}


def yahoo(ticker, desde):
    """Cierres diarios (cierre, cierre ajustado) con yfinance."""
    import yfinance as yf  # se importa acá para que el resto funcione aunque no esté instalado
    h = yf.Ticker(ticker.replace(".", "-")).history(start=desde, interval="1d", auto_adjust=False)
    out = {}
    for fecha, fila in h.iterrows():
        c, a = fila.get("Close"), fila.get("Adj Close")
        if c is None or a is None or c != c or a != a:  # NaN
            continue
        out[fecha.strftime("%Y-%m-%d")] = (round(float(c), 4), round(float(a), 4))
    if len(out) < 5:
        raise RuntimeError(f"{ticker}: sin historia")
    return out


def usd_e_historico(hist_anterior, seguidos=()):
    """Cierres en USD de los ETF de referencia y, solo para el histórico, de lo que tenés: historico_extra y los
    subyacentes de data/seguimiento.json (cartera, watchlist y fantasmas).

    Devuelve (sección usd de market, historico). Las fechas salen de los ETF de referencia; si un ticker
    extra falla o le falta algún día, queda con lo anterior o con null, sin frenar al resto.
    """
    series = {t: yahoo(t, CFG["historico_desde"]) for t in CFG["usd_tickers"]}
    usd = {}
    for t, s in series.items():
        fechas = sorted(s)
        usd[t] = {"c": s[fechas[-1]][0], "prev": s[fechas[-2]][0], "fecha": fechas[-1]}
    extras = [t for t in dict.fromkeys(list(CFG.get("historico_extra", [])) + list(seguidos))
              if t not in CFG["usd_tickers"] and t not in ("MEP", "CCL")]
    for t in extras:
        try:
            series[t] = yahoo(t, CFG["historico_desde"])
        except Exception as e:  # noqa: BLE001
            print(f"FALLA historico {t}: {e}", file=sys.stderr)
    # histórico acumulado: se parte de lo guardado y se pisa con lo nuevo (cierre ajustado)
    viejo_f = hist_anterior.get("fechas") or []
    viejo_s = hist_anterior.get("series") or {}
    todos = list(CFG["usd_tickers"]) + extras
    acum = {t: {f: v for f, v in zip(viejo_f, viejo_s.get(t) or []) if v is not None} for t in todos}
    for t, s in series.items():
        for f, (_, aj) in s.items():
            acum[t][f] = aj
    fechas = sorted(f for f in set.intersection(*[set(acum[t]) for t in CFG["usd_tickers"]]) if f >= CFG["historico_desde"])
    hist = {"fechas": fechas, "series": {t: [acum[t].get(f) for f in fechas] for t in todos},
            "nota": "Cierres diarios ajustados por dividendos, en USD (yfinance)."}
    return {"precios": usd}, hist


# ---------- dólar implícito, precios de EE.UU. del momento y ratios ----------

def ratios_cedear():
    """Ratios oficiales (tools/cedear_ratios.json). {} si el archivo no se puede leer."""
    try:
        return json.loads(RATIOS.read_text(encoding="utf-8"))["ratios"]
    except Exception:  # noqa: BLE001
        return {}


def ticker_usa(t, info):
    """Ticker del subyacente en EE.UU. (None si no cotiza allá)."""
    return info["usa"] if "usa" in info else t


def mediana_implicito(papeles):
    """Mediana del dólar implícito de los papeles de más volumen. papeles = {ticker: [dólar, volumen en pesos]}."""
    liquidos = sorted((v for v in (papeles or {}).values() if v[0] > 0 and v[1] > 0), key=lambda v: -v[1])[:PAPELES_LIQUIDOS]
    return statistics.median(v[0] for v in liquidos) if len(liquidos) >= MINIMO_PAPELES else None


def yahoo_vivo(ticker):
    """Último precio y cierre anterior con yfinance (velas de 5 minutos): [precio, variación %, fecha]."""
    import yfinance as yf
    h = yf.Ticker(ticker).history(period="5d", interval="5m", auto_adjust=False)
    puntos = [(f.strftime("%Y-%m-%d"), float(c)) for f, c in zip(h.index, h["Close"]) if c == c]
    if not puntos:
        raise RuntimeError(f"{ticker}: sin precio del momento")
    fecha, precio = puntos[-1]
    previos = [c for f, c in puntos if f < fecha]
    if not previos:
        raise RuntimeError(f"{ticker}: sin cierre anterior")
    return [round(precio, 4), round((precio / previos[-1] - 1) * 100, 2), fecha]


def usa_vivo():
    """Precios de EE.UU. del mismo momento que los CEDEARs: data912 para acciones y ADR; yfinance para los ETF que no trae."""
    quiero = {ticker_usa(t, i) for t, i in ratios_cedear().items()} - {None}
    propios = list(dict.fromkeys(CFG["usd_tickers"] + CFG.get("historico_extra", [])))
    quiero |= set(propios)
    precios = {}
    for ruta in ("usa_stocks", "usa_adrs"):
        try:
            for f in data912_filas(ruta):
                s, c = f.get("symbol"), f.get("c")
                if s in quiero and c and c > 0:
                    precios[s] = [round(float(c), 4), f.get("pct_change") or 0]
        except Exception as e:  # noqa: BLE001
            print(f"FALLA {ruta}: {e}", file=sys.stderr)
    for t in propios:
        if t not in precios:
            try:
                precios[t] = yahoo_vivo(t)
            except Exception as e:  # noqa: BLE001
                print(f"FALLA precio {t}: {e}", file=sys.stderr)
    faltan = [t for t in CFG["usd_tickers"] if t not in precios]
    if faltan:
        raise RuntimeError("usa: faltan " + ", ".join(faltan))
    return {"precios": precios}


def ccl_calculado(filas, ratios, usa):
    """Dólar implícito de cada CEDEAR: precio en pesos × ratio ÷ precio en EE.UU."""
    papeles = {}
    for f in filas:
        t, c = f.get("symbol"), f.get("c")
        info = ratios.get(t)
        u = ticker_usa(t, info) if info else None
        if u in usa and c and c > 0:
            papeles[t] = [round(c * info["ratio"] / usa[u][0], 2), round((f.get("v") or 0) * c)]
    return papeles


def ccl_implicito(usa):
    """Dólar implícito por papel: data912 /live/ccl y, si viene vacío, calculado con los ratios oficiales."""
    papeles = {}
    try:
        for f in json.loads(bajar("https://data912.com/live/ccl")):
            t, x = f.get("ticker_ar"), f.get("CCL_mark") or f.get("CCL_close")
            if t and x and x > 0:
                papeles[t] = [round(float(x), 2), round(f.get("ars_volume") or 0)]
    except Exception as e:  # noqa: BLE001
        print(f"FALLA live/ccl: {e}", file=sys.stderr)
    fuente = "data912"
    if mediana_implicito(papeles) is None:
        papeles = ccl_calculado(data912_filas("arg_cedears"), ratios_cedear(), usa)
        fuente = "calculado"
    mediana = mediana_implicito(papeles)
    if mediana is None:
        raise RuntimeError("ccl implícito: sin papeles suficientes")
    return {"papeles": papeles, "mediana": round(mediana, 2), "fuente": fuente}


def revisar_ratios(ratios, cedears, usa, ccl_ref, tolerancia=TOLERANCIA_RATIO):
    """CEDEARs cuyo ratio inferido (subyacente × dólar ÷ precio en pesos) difiere del oficial: {t: [oficial, inferido]}."""
    out = {}
    for t, info in ratios.items():
        u = ticker_usa(t, info)
        local, afuera = cedears.get(t), usa.get(u) if u else None
        if not local or not afuera or not ccl_ref or local[0] <= 0:
            continue
        inferido = afuera[0] * ccl_ref / local[0]
        if abs(inferido / info["ratio"] - 1) > tolerancia:
            out[t] = [info["ratio"], round(inferido, 3)]
    return out


def implicito(anterior, mercado):
    """Sección nueva de market.json. Cada parte falla por separado y conserva su dato anterior marcado como viejo."""
    anterior = anterior or {}
    usa = seccion("usa_vivo", anterior.get("usa"), usa_vivo)
    # El dólar implícito calculado necesita precios de EE.UU. de ahora: con precios viejos no se calcula.
    ccl = seccion("ccl_implicito", anterior.get("ccl"), lambda: ccl_implicito({} if usa["stale"] else usa["precios"]))
    revisar = anterior.get("revisar_ratios") or {}
    cedears = mercado.get("cedears") or {}
    if not (usa["stale"] or cedears.get("stale")):
        ref = (mercado.get("fx") or {}).get("ccl") if ccl["stale"] else ccl.get("mediana")
        revisar = revisar_ratios(ratios_cedear(), cedears.get("precios") or {}, usa.get("precios") or {}, ref)
    return {"usa": usa, "ccl": ccl, "revisar_ratios": revisar}


# ---------- dólar MEP y contado con liqui dentro del histórico ----------

def sumar_canje(hist, anterior):
    """Agrega las series MEP y CCL alineadas con hist["fechas"] (null si ese día no hay cotización).

    Si la fuente falla conserva lo anterior y lo marca viejo en hist["canje"].
    """
    prev_f, prev_s = anterior.get("fechas") or [], anterior.get("series") or {}
    try:
        nuevas = {"MEP": cotizaciones("bolsa"), "CCL": cotizaciones("contadoconliqui")}
        meta = {"stale": False, "actualizado": ahora()}
        print("ok   canje (MEP y CCL históricos)")
    except Exception as e:  # noqa: BLE001
        print(f"FALLA canje: {e}", file=sys.stderr)
        nuevas, meta = {}, dict(anterior.get("canje") or {}, stale=True, intento=ahora(), error=str(e)[:160])
    series = dict(hist.get("series") or {})
    for n in ("MEP", "CCL"):
        acum = {f: v for f, v in zip(prev_f, prev_s.get(n) or []) if v is not None}
        acum.update(nuevas.get(n, {}))
        if acum:
            series[n] = [round(acum[f], 2) if f in acum else None for f in hist.get("fechas") or []]
    hist["series"] = series
    hist["canje"] = meta
    return hist


def hoy_argentina():
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=3)).strftime("%Y-%m-%d")


def al_dia(anterior, dias=1):
    """¿El dato anterior es bueno y tiene menos de `dias` días calendario? Para no pedir a cada rato lo que casi no cambia."""
    a = anterior or {}
    if a.get("stale") or not a.get("actualizado"):
        return False
    try:
        edad = dt.datetime.now(dt.timezone.utc).date() - dt.date.fromisoformat(a["actualizado"][:10])
    except ValueError:
        return False
    return edad.days < dias


def seccion_diaria(nombre, anterior, fn, dias=1, vigente=lambda a: True):
    """Como seccion(), pero si el dato anterior está al día (y sigue sirviendo) lo reusa sin volver a pedirlo."""
    if al_dia(anterior, dias) and vigente(anterior):
        print(f"ok   {nombre} (al día)")
        return anterior
    return seccion(nombre, anterior, fn)


# ---------- feriados argentinos ----------

def feriados_ar(anterior):
    """Feriados argentinos de este año y del que viene (ArgentinaDatos). Los años ya guardados se conservan."""
    anio = int(hoy_argentina()[:4])
    feriados = dict((anterior or {}).get("feriados") or {})
    anios = set((anterior or {}).get("anios") or [])
    for a in (anio, anio + 1):
        try:
            filas = json.loads(bajar(f"https://api.argentinadatos.com/v1/feriados/{a}", intentos=2))
            nuevos = {f["fecha"]: {"nombre": f["nombre"], "tipo": f.get("tipo") or "inamovible"}
                      for f in filas if str(f.get("fecha", "")).startswith(f"{a}-") and f.get("nombre")}
            if len(nuevos) < 8:
                raise RuntimeError(f"feriados {a}: lista incompleta ({len(nuevos)})")
        except Exception as e:  # noqa: BLE001
            if a == anio:
                raise
            print(f"FALLA feriados {a} (puede no estar publicado): {e}", file=sys.stderr)
            continue
        feriados = {f: v for f, v in feriados.items() if not f.startswith(f"{a}-")}
        feriados.update(nuevos)
        anios.add(a)
    return {"fuente": "ArgentinaDatos /v1/feriados/{año}", "anios": sorted(anios), "feriados": dict(sorted(feriados.items()))}


# ---------- ratios de BYMA: solo avisa si cambió alguno ----------

BYMA_PAGINA = "https://www.byma.com.ar/productos/productos-financieros/cedears"
_MERCADOS_BYMA = r"NYSE Arca|NYSE ARCA|NYSE American|NYSE|NASDAQ GS|NASDAQ GM|NASDAQ CM|NASDAQ|XETRA|B3|FRANKFURT|OTC US|OTC|CBOE|BOVESPA|New York|-"


def enlace_lista_byma(pagina):
    """(fecha, url) de la lista de CEDEARs más nueva enlazada en la página de BYMA."""
    enlaces = {m.group(2): m.group(1) for m in re.finditer(r'(https://[^"\'\s<>]+?_BYMA-CEDEARs-(\d{4}-\d{2}-\d{2})\.pdf)', pagina)}
    if not enlaces:
        raise RuntimeError("byma: no encuentro el enlace a la lista de CEDEARs")
    fecha = max(enlaces)
    return fecha, enlaces[fecha]


def leer_lista_byma(texto):
    """{ticker: set de ratios} desde el texto de la lista. Cada fila termina en "MERCADO a:b" (a CEDEARs = b acciones);
    las de Londres vienen partidas: nombre y código, "LONDON STOCK", "EXCHANGE" y la relación."""
    filas, previa = {}, ""
    patron = re.compile(rf"^(.*)\s(\S+)\s+(?:{_MERCADOS_BYMA})\s+(\d+)\s*:\s*(\d+)$")
    sola = re.compile(r"^(\d+)\s*:\s*(\d+)$")
    for linea in texto.replace("\xa0", " ").splitlines():
        linea = linea.strip()
        m, s = patron.match(linea), sola.match(linea)
        if m:
            ticker, a, b = m.group(2), m.group(3), m.group(4)
        elif s and previa:
            ticker, a, b = previa.split()[-1], s.group(1), s.group(2)
        else:
            if linea and linea not in ("LONDON STOCK", "EXCHANGE"):
                previa = linea
            continue
        previa = ""
        if int(b) > 0 and int(a) > 0:
            filas.setdefault(ticker, set()).add(round(int(a) / int(b), 6))
    return filas


def comparar_ratios(archivo, lista, minimo=0.8):
    """{ticker: [ratio del tablero, ratio de BYMA]} para los que cambiaron. Si BYMA repite un código con dos valores
    y uno coincide, no es un cambio. Si no se reconoce la mayoría de la lista, el formato cambió: falla."""
    comunes = [t for t in archivo if t in lista]
    if not archivo or len(comunes) < minimo * len(archivo):
        raise RuntimeError(f"byma: solo reconozco {len(comunes)} de {len(archivo)} códigos; revisar el formato de la lista")
    cambios = {}
    for t in comunes:
        viejo, nuevos = archivo[t]["ratio"], lista[t]
        if not any(abs(n / viejo - 1) < 1e-4 for n in nuevos):
            cambios[t] = [viejo, sorted(nuevos)[0]]
    return cambios


def texto_pdf(contenido):
    import io
    import pypdf  # se importa acá para que el resto funcione aunque no esté instalado
    return "\n".join(p.extract_text() for p in pypdf.PdfReader(io.BytesIO(contenido)).pages)


def archivo_ratios():
    try:
        return json.loads(RATIOS.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def ratios_byma():
    """Compara la lista vigente de BYMA con tools/cedear_ratios.json. No cambia el archivo: solo informa."""
    fecha, url = enlace_lista_byma(bajar(BYMA_PAGINA, intentos=2, timeout=20))
    propio = archivo_ratios()
    lista = leer_lista_byma(texto_pdf(bajar_bytes(url, intentos=2, timeout=20)))
    cambios = comparar_ratios(propio.get("ratios") or {}, lista)
    return {"lista_fecha": fecha, "url": url, "archivo_fecha": propio.get("fecha"), "revisados": len(lista), "cambios": cambios}


def insiders():
    pagina = bajar(CFG["insiders_url"])
    m = re.search(r'<table[^>]*class="tinytable".*?</table>', pagina, re.S)
    if not m:
        if "tinytable" not in pagina and len(pagina) < 2000:
            raise RuntimeError("openinsider: página inesperada")
        return {"filas": []}
    limpio = lambda s: html.unescape(re.sub(r"<[^>]+>", "", s)).strip()  # noqa: E731
    enlace = lambda s: (re.findall(r">([^<>]+)</a>", s) or [limpio(s)])[-1].strip()  # noqa: E731
    num = lambda s: float(re.sub(r"[^0-9.\-]", "", s) or 0)  # noqa: E731
    filas = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", m.group(0), re.S)[1:]:
        td = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if len(td) < 13:
            continue
        filas.append({
            "presentado": limpio(td[1])[:10],
            "fecha": limpio(td[2])[:10],
            "ticker": enlace(td[3]).upper()[:10],
            "empresa": html.unescape(enlace(td[4]))[:80],
            "industria": limpio(td[5])[:60],
            "insiders": int(num(limpio(td[6]))),
            "tipo": limpio(td[7])[:20],
            "precio": num(limpio(td[8])),
            "cantidad": num(limpio(td[9])),
            "delta_tenencia": limpio(td[11])[:8],
            "monto": num(limpio(td[12])),
        })
    return {"filas": filas, "url": CFG["insiders_url"]}


def main():
    DATA.mkdir(exist_ok=True)
    _filas.clear()
    _cotizaciones.clear()
    m_prev, i_prev, h_prev = leer("market.json"), leer("insiders.json"), leer("historico.json")

    mercado = {"generado": ahora()}
    mercado["fx"] = seccion("fx", m_prev.get("fx"), fx)
    # MEP con el que cerró el día anterior: sirve para medir en dólares el movimiento diario de cada precio
    hoy_ar = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=3)).strftime("%Y-%m-%d")
    fx_prev = m_prev.get("fx") or {}
    mercado["fx"]["mep_prev"] = fx_prev.get("mep") if fx_prev.get("dia") not in (None, hoy_ar) else fx_prev.get("mep_prev")
    mercado["fx"]["dia"] = hoy_ar
    mercado["cedears"] = seccion("cedears", m_prev.get("cedears"), lambda: data912("arg_cedears"))
    mercado["acciones"] = seccion("acciones", m_prev.get("acciones"), lambda: data912("arg_stocks"))
    # las ON cotizan cada 100 de valor nominal: se guarda el precio por 1 VN
    mercado["ons"] = seccion("ons", m_prev.get("ons"), lambda: data912("arg_corp", 100))
    mercado["fci"] = seccion("fci", m_prev.get("fci"), fci)
    mercado["mep_mensual"] = seccion("mep_mensual", m_prev.get("mep_mensual"), mep_mensual)
    mercado["cpi_usa"] = seccion("cpi_usa", m_prev.get("cpi_usa"), cpi_usa)
    mercado["implicito"] = implicito(m_prev.get("implicito"), mercado)
    # La lista de BYMA cambia poco: una vez por día, o cuando se actualiza el archivo de ratios del repositorio.
    mercado["ratios_byma"] = seccion_diaria("ratios_byma", m_prev.get("ratios_byma"), ratios_byma,
                                            vigente=lambda a: a.get("archivo_fecha") == archivo_ratios().get("fecha"))
    f_prev = leer("feriados_ar.json")
    escribir("feriados_ar.json", seccion_diaria("feriados_ar", f_prev, lambda: feriados_ar(f_prev)))

    hist = h_prev
    try:
        propio = sys.modules[__name__]
        usd, hist = usd_e_historico(h_prev, senales.subyacentes(senales.leer_seguimiento(propio)) + senales.series_extra(propio))
        usd.update(stale=False, actualizado=ahora())
        hist.update(stale=False, actualizado=ahora())
        print("ok   usd + historico")
    except Exception as e:  # noqa: BLE001
        print(f"FALLA usd: {e}", file=sys.stderr)
        usd = dict(m_prev.get("usd") or {}, stale=True, intento=ahora(), error=str(e)[:160])
        hist = dict(h_prev, stale=True, intento=ahora())
    mercado["usd"] = usd
    if hist.get("fechas"):
        hist = sumar_canje(hist, h_prev)

    escribir("market.json", mercado)
    escribir("historico.json", hist)
    escribir("insiders.json", seccion("insiders", i_prev, insiders))

    try:  # contexto: riesgo país, tasas, fondos, FRED, historia larga y elecciones
        import contexto
        contexto.correr(sys.modules[__name__])
    except Exception as e:  # noqa: BLE001
        print(f"FALLA contexto: {e}", file=sys.stderr)

    try:  # alertas de precio al teléfono (no detienen el resto si fallan)
        import alertas
        alertas.correr(mercado)
    except Exception as e:  # noqa: BLE001
        print(f"FALLA alertas: {type(e).__name__}", file=sys.stderr)


if __name__ == "__main__":
    main()
