"""Noticias de lo que se sigue: presentaciones a la SEC y Google News. Escribe data/noticias.json.

- SEC EDGAR: 8-K (con sus ítems), 10-Q, 10-K, 6-K de los ADR y formulario 4 (agrupado por empresa y día).
- Google News RSS por empresa, en español y en inglés.
- No hay un acceso público estable a los hechos relevantes de BYMA ni de la CNV: para las argentinas se usan los 6-K.

Sin duplicados, con 30 días de historia. Cada fuente va por separado y, si falla, conserva lo anterior marcado
`stale`. La clasificación la pone tools/clasificar.py y queda guardada: una noticia ya clasificada no se repite.
"""
import datetime as dt
import email.utils
import hashlib
import html
import json
import re
import time
import unicodedata
import urllib.parse
import xml.etree.ElementTree as ET

import sec

DIAS = 30
MAXIMO_POR_TICKER = 40
MAXIMO_TOTAL = 900
MAXIMO_POR_BUSQUEDA = 8     # noticias nuevas por empresa e idioma en cada corrida
EXTRACTOS_POR_CORRIDA = 10  # documentos de 6-K que se abren para tener de qué tratan
PRESUPUESTO_SEGUNDOS = 180
PAUSA_GOOGLE = 0.4
_reloj = time.monotonic
_dormir = time.sleep

FORMULARIOS = ("8-K", "8-K/A", "10-Q", "10-Q/A", "10-K", "10-K/A", "6-K", "6-K/A", "4", "4/A")
ITEMS_8K = {
    "1.01": "firmó un acuerdo importante", "1.02": "terminó un acuerdo importante", "1.03": "quiebra o concurso",
    "1.05": "incidente de ciberseguridad", "2.01": "compra o venta de activos concretada", "2.02": "resultados",
    "2.03": "nueva deuda importante", "2.04": "se aceleran obligaciones", "2.05": "costos de reestructuración",
    "2.06": "deterioro de activos", "3.01": "aviso sobre su cotización en bolsa", "3.02": "venta de acciones no registradas",
    "3.03": "cambian derechos de los accionistas", "4.01": "cambio de auditor", "4.02": "balances anteriores ya no son confiables",
    "5.01": "cambio de control", "5.02": "cambios de directivos o directores", "5.03": "cambios en el estatuto",
    "5.07": "votación de accionistas", "7.01": "información para inversores", "8.01": "otro hecho", "9.01": "anexos",
}
GOOGLE = {
    "es": ("hl=es-419&gl=AR&ceid=AR:es-419", '"{nombre}" when:7d'),
    "en": ("hl=en-US&gl=US&ceid=US:en", '"{nombre}" stock when:7d'),
}
# Páginas de cotización y de opciones que Google News mezcla con las noticias.
RUIDO = re.compile(r"cotizaci[oó]n e historial|stock price, (news|quote)|quote (&|and) history|\b[A-Z]{1,6}\d{6}[CP]\d{8}\b", re.I)
NOTA_BYMA = "No hay un acceso público estable a los hechos relevantes de BYMA ni de la CNV: para las empresas argentinas se usan sus 6-K ante la SEC y Google News."


def _fecha_ar(f):
    return f"{f[8:10]}/{f[5:7]}" if f else ""


def titulo_sec(forma, ticker, items, reporte, descripcion):
    base = forma.split("/")[0]
    correccion = " (corrección)" if forma.endswith("/A") else ""
    if base == "8-K":
        nombres = [ITEMS_8K.get(i, "ítem " + i) for i in items if i != "9.01"] or [ITEMS_8K["9.01"]]
        return f"8-K de {ticker}{correccion}: {'; '.join(nombres)}"
    if base == "10-Q":
        return f"10-Q de {ticker}{correccion}: informe trimestral" + (f" al {_fecha_ar(reporte)}" if reporte else "")
    if base == "10-K":
        return f"10-K de {ticker}{correccion}: informe anual"
    extra = "" if not descripcion or descripcion.upper() in (base, "FORM " + base, forma) else f" · {descripcion[:80]}"
    return f"6-K de {ticker}{correccion}: comunicado del emisor{extra}"


def desde_envios(datos, ticker, cik, desde):
    """Noticias desde la respuesta de data.sec.gov/submissions, de la fecha `desde` en adelante."""
    r = ((datos.get("filings") or {}).get("recent")) or {}
    columnas = ("accessionNumber", "filingDate", "form")
    if not all(isinstance(r.get(c), list) for c in columnas):
        raise RuntimeError(f"sec {ticker}: respuesta inesperada")
    out, formularios4 = [], {}
    for i, forma in enumerate(r["form"]):
        fecha = r["filingDate"][i]
        if forma not in FORMULARIOS or fecha < desde:
            continue
        celda = lambda c: (r.get(c) or [""] * (i + 1))[i] or ""  # noqa: E731
        acceso = r["accessionNumber"][i]
        if forma.split("/")[0] == "4":
            formularios4.setdefault(fecha, []).append(acceso)
            continue
        items = [x.strip() for x in celda("items").split(",") if x.strip()]
        doc = celda("primaryDocument")
        out.append({
            "id": "sec-" + acceso, "t": ticker, "fecha": celda("acceptanceDateTime")[:19] + "Z" if celda("acceptanceDateTime") else fecha,
            "fuente": "SEC", "medio": "SEC EDGAR", "idioma": "en", "forma": forma, "items": items,
            "titulo": titulo_sec(forma, ticker, items, celda("reportDate"), celda("primaryDocDescription")),
            "url": sec.URL_ARCHIVO.format(cik=cik, acceso=acceso.replace("-", ""), doc=doc) if doc else
                   f"https://www.sec.gov/Archives/edgar/data/{cik}/{acceso.replace('-', '')}/",
        })
    for fecha, accesos in formularios4.items():
        n = len(accesos)
        out.append({
            "id": f"sec-4-{ticker}-{fecha}", "t": ticker, "fecha": fecha, "fuente": "SEC", "medio": "SEC EDGAR", "idioma": "en",
            "forma": "4", "items": [], "cantidad": n,
            "titulo": f"Formulario 4 de {ticker}: {'una presentación' if n == 1 else f'{n} presentaciones'} de directivos",
            "url": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik:010d}&type=4",
        })
    return out


def extracto_de(documento):
    """Las primeras frases con contenido de un documento HTML de la SEC (sin la carátula)."""
    texto = re.sub(r"(?is)<(script|style|ix:header)\b.*?</\1>", " ", documento)
    texto = re.sub(r"(?i)</(p|div|tr|li|h\d)>|<br\s*/?>", "\n", texto)
    texto = html.unescape(re.sub(r"<[^>]+>", " ", texto)).replace("\xa0", " ")
    caratula = re.compile(
        r"(?i)^(united states|securities and exchange commission|washington|form 6-k|report of foreign|pursuant to rule|"
        r"under the securities|for the month|commission file|\(exact name|\(translation|\(address|indicate by check|"
        r"form 20-f|yes\b|no\b|if .yes.|signature|[☐☒xX_\-\s|:]+$)")
    lineas = []
    for linea in texto.splitlines():
        linea = re.sub(r"\s+", " ", linea).strip()
        if len(linea) < 40 or caratula.search(linea):
            continue
        lineas.append(linea)
        if sum(len(x) for x in lineas) > 600:
            break
    return " ".join(lineas)[:600].strip()


def desde_rss(texto, ticker, idioma, desde, maximo=MAXIMO_POR_BUSQUEDA):
    """Noticias de un RSS de Google News: las `maximo` más nuevas desde `desde`."""
    raiz = ET.fromstring(texto.encode("utf-8"))
    out = []
    for item in raiz.iter("item"):
        campo = lambda c: (item.findtext(c) or "").strip()  # noqa: E731
        titulo, enlace = campo("title"), campo("link")
        medio = campo("source")
        if not titulo or not enlace.startswith("http") or RUIDO.search(titulo):
            continue
        try:
            cuando = email.utils.parsedate_to_datetime(campo("pubDate")).astimezone(dt.timezone.utc)
        except (TypeError, ValueError):
            continue
        if cuando.date().isoformat() < desde:
            continue
        if medio and titulo.endswith(" - " + medio):
            titulo = titulo[: -len(medio) - 3].strip()
        out.append({
            "id": "gn-" + hashlib.sha256(f"{ticker}|{enlace}".encode()).hexdigest()[:20], "t": ticker,
            "fecha": cuando.strftime("%Y-%m-%dT%H:%M:%SZ"), "fuente": "Google News", "medio": medio[:60] or "Google News",
            "idioma": idioma, "titulo": titulo[:220], "url": enlace,
        })
    out.sort(key=lambda x: x["fecha"], reverse=True)
    return out[:maximo]


def huella_titulo(x):
    """Mismo titular de la misma empresa = misma noticia, aunque venga de otro medio o con otra puntuación."""
    t = unicodedata.normalize("NFKD", x["titulo"].lower()).encode("ascii", "ignore").decode()
    return x["t"], " ".join(re.findall(r"[a-z0-9]+", t))


def fusionar(previas, nuevas, hoy):
    """Une lo anterior con lo nuevo: sin duplicados, 30 días y con tope por empresa. Lo ya clasificado se conserva."""
    desde = (dt.date.fromisoformat(hoy) - dt.timedelta(days=DIAS)).isoformat()
    por_id, titulos = {}, {}
    for x in list(previas) + list(nuevas):
        previo = por_id.get(x["id"])
        if previo:  # la misma presentación vuelve a aparecer: se actualiza sin perder la clasificación
            if x.get("cantidad", 0) > previo.get("cantidad", 0):
                previo.update({k: x[k] for k in ("titulo", "cantidad")})
            if x.get("extracto") and not previo.get("extracto"):
                previo["extracto"] = x["extracto"]
            continue
        if x["fecha"][:10] < desde:
            continue
        if x["fuente"] != "SEC":
            h = huella_titulo(x)
            if h in titulos:
                continue
            titulos[h] = x["id"]
        por_id[x["id"]] = dict(x)
    orden = sorted(por_id.values(), key=lambda x: (x.get("materialidad", 1), x["fecha"]), reverse=True)
    cuenta, elegidas = {}, []
    for x in orden:  # con el tope se quedan primero las más importantes y más nuevas
        cuenta[x["t"]] = cuenta.get(x["t"], 0) + 1
        if cuenta[x["t"]] <= MAXIMO_POR_TICKER:
            elegidas.append(x)
    return sorted(elegidas[:MAXIMO_TOTAL], key=lambda x: (x["fecha"], x["id"]), reverse=True)


def _estado(anterior, m, fallas, pedidos, aviso=None):
    """Estado de una fuente: viejo si falló todo lo que se pidió (o si no se pudo pedir)."""
    mal = bool(aviso) or (pedidos > 0 and fallas == pedidos) or pedidos == 0
    out = {"stale": mal, "actualizado": (anterior or {}).get("actualizado") if mal else m.ahora(),
           "pedidos": pedidos, "fallas": fallas}
    if aviso:
        out["aviso"] = aviso
    return out


def nombre_de(ticker, cfg, cik):
    """Con qué nombre se busca una empresa en las noticias."""
    propio = (cfg.get("nombres") or {}).get(ticker)
    if propio:
        return propio
    r = (cik.get("mapa") or {}).get(ticker)
    return sec.nombre_corto(r["nombre"]) if r else ticker


def buscar_sec(m, tickers, cik, desde, previas, limite):
    nuevas, pedidos, fallas = [], 0, 0
    for t in tickers:
        r = (cik.get("mapa") or {}).get(t)
        if not r or _reloj() > limite:
            continue
        pedidos += 1
        try:
            nuevas += desde_envios(sec.envios(m, r["cik"]), t, r["cik"], desde)
        except Exception as e:  # noqa: BLE001
            fallas += 1
            print(f"FALLA sec {t}: {type(e).__name__}")
    # de qué trata cada 6-K nuevo: se abre el documento (pocos por corrida)
    conocidas = {x["id"] for x in previas if "extracto" in x}
    abiertos = 0
    for x in sorted((x for x in nuevas if x["forma"].startswith("6-K") and x["id"] not in conocidas), key=lambda x: x["fecha"], reverse=True):
        if abiertos >= EXTRACTOS_POR_CORRIDA or _reloj() > limite:
            break
        abiertos += 1
        try:
            x["extracto"] = extracto_de(sec.pedir(m, x["url"], intentos=1))
        except Exception as e:  # noqa: BLE001
            print(f"FALLA 6-K {x['t']}: {type(e).__name__}")
    return nuevas, pedidos, fallas


def buscar_google(m, tickers, cfg, cik, desde, limite):
    nuevas, pedidos, fallas = [], 0, 0
    sin = set(cfg.get("sin_google") or [])
    for t in tickers:
        if t in sin:
            continue
        for idioma, (region, consulta) in GOOGLE.items():
            if _reloj() > limite:
                return nuevas, pedidos, fallas
            q = urllib.parse.quote(consulta.format(nombre=nombre_de(t, cfg, cik)))
            pedidos += 1
            try:
                texto = m.bajar(f"https://news.google.com/rss/search?q={q}&{region}", intentos=1, timeout=15)
                nuevas += desde_rss(texto, t, idioma, desde)
            except Exception as e:  # noqa: BLE001
                fallas += 1
                print(f"FALLA noticias {t} {idioma}: {type(e).__name__}")
                if fallas >= 6 and fallas == pedidos:  # la fuente está caída: no insistir
                    return nuevas, pedidos, fallas
            _dormir(PAUSA_GOOGLE)
    return nuevas, pedidos, fallas


def correr(m, tickers):
    """Baja lo nuevo y deja data/noticias.json. Devuelve lo que guardó."""
    cfg = m.CFG.get("noticias") or {}
    anterior = m.leer("noticias.json")
    previas = anterior.get("items") or []
    hoy = m.hoy_argentina()
    desde = (dt.date.fromisoformat(hoy) - dt.timedelta(days=DIAS)).isoformat()
    cik = m.leer("sec_cik.json")
    inicio = _reloj()
    fuentes = dict(anterior.get("fuentes") or {})
    nuevas = []
    if not sec.user_agent():
        print("noticias: sin el secreto SEC_CONTACTO, se saltea la SEC")
        fuentes["sec"] = _estado(fuentes.get("sec"), m, 0, 0, "Falta el secreto SEC_CONTACTO")
    else:  # la SEC usa como mucho la mitad del tiempo
        n, p, f = buscar_sec(m, tickers, cik, desde, previas, inicio + PRESUPUESTO_SEGUNDOS / 2)
        nuevas += n
        fuentes["sec"] = _estado(fuentes.get("sec"), m, f, p)
    n, p, f = buscar_google(m, tickers, cfg, cik, desde, inicio + PRESUPUESTO_SEGUNDOS)
    nuevas += n
    fuentes["google"] = _estado(fuentes.get("google"), m, f, p)
    fuentes["byma"] = {"disponible": False, "nota": NOTA_BYMA}
    seguidos = set(tickers)
    items = fusionar([x for x in previas if x.get("t") in seguidos], nuevas, hoy)
    salida = {"generado": m.ahora(), "fuentes": fuentes, "items": items}
    m.escribir("noticias.json", salida)
    print(f"ok   noticias: {len(items)} guardadas (SEC {fuentes['sec']['fallas']}/{fuentes['sec']['pedidos']} fallas, "
          f"Google {f}/{p} fallas)")
    return salida
