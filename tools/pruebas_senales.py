"""Pruebas de la ronda 3 (qué seguir, SEC, calendario, noticias, IA y directivos), sin red.

Las corre tools/pruebas_mercado.py. Las respuestas grabadas están en tools/grabadas; las que dicen "formato" se
armaron a mano con el formato de la fuente (la SEC no responde sin un contacto declarado).
"""
import contextlib
import io
import json
import os
import pathlib
import socket
import sys
import tempfile
import types
import urllib.error

import calendario
import clasificar
import directivos
import mercado
import noticias
import sec
import senales

GRABADAS = pathlib.Path(__file__).resolve().parent / "grabadas"


def grabada(nombre):
    return (GRABADAS / nombre).read_text(encoding="utf-8")


@contextlib.contextmanager
def entorno(**variables):
    """Variables de entorno de prueba (None: la saca) que se restauran al salir."""
    previas = {k: os.environ.get(k) for k in variables}
    try:
        for k, v in variables.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        yield
    finally:
        for k, v in previas.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


@contextlib.contextmanager
def datos_temporales(**archivos):
    """data/ en una carpeta temporal, con los archivos dados (nombre sin .json → contenido)."""
    real = mercado.DATA
    with tempfile.TemporaryDirectory() as tmp:
        mercado.DATA = pathlib.Path(tmp)
        for nombre, obj in archivos.items():
            mercado.escribir(nombre + ".json", obj)
        try:
            yield
        finally:
            mercado.DATA = real


@contextlib.contextmanager
def parches(*cambios):
    """parches((objeto, 'atributo', valor), …): los pone y los restaura."""
    previos = [(o, a, getattr(o, a)) for o, a, _ in cambios]
    try:
        for o, a, v in cambios:
            setattr(o, a, v)
        yield
    finally:
        for o, a, v in previos:
            setattr(o, a, v)


def red(mapa, pedidos=None):
    """mercado.bajar simulado: {parte de la URL: texto o excepción}. Anota cada pedido con sus encabezados."""
    def bajar(url, **k):
        if pedidos is not None:
            pedidos.append((url, k.get("cabeceras") or {}))
        for parte, r in mapa.items():
            if parte in url:
                if isinstance(r, Exception):
                    raise r
                return r(url) if callable(r) else r
        raise AssertionError("pedido no grabado: " + url)
    return bajar


SIN_ESPERA = (sec, "_dormir", lambda s: None)
SEGUIMIENTO = {"tickers": [
    {"t": "SPY", "tipo": "cedear", "usa": "SPY", "en": ["cartera"]},
    {"t": "PAMP", "tipo": "accion_ar", "usa": "PAM", "en": ["cartera"]},
    {"t": "FCID", "tipo": "fci", "usa": None, "en": ["cartera"]},
    {"t": "AAPL", "tipo": "cedear", "usa": "AAPL", "en": ["watchlist"]},
    {"t": "BRKB", "tipo": "cedear", "usa": "BRK.B", "en": ["fantasma"]},
    {"t": "<script>", "tipo": "x", "usa": "X", "en": []},
]}


# ---------- etapa 1 · qué seguir ----------
def lista_de_seguimiento():
    with datos_temporales(seguimiento=SEGUIMIENTO):
        l = senales.leer_seguimiento(mercado)
        assert [f["t"] for f in l] == ["SPY", "PAMP", "FCID", "AAPL", "BRKB"], "descarta tickers raros"
        assert senales.subyacentes(l) == ["PAM", "SPY", "AAPL", "BRK.B"], "primero la cartera, sin los fondos"
    with datos_temporales():
        assert senales.leer_seguimiento(mercado) == []


def historico_con_seguidos():
    dias = {f"2026-01-0{i}": (10 + i, 10 + i) for i in range(2, 9)}
    pedidos = []

    def falsa(t, desde):
        pedidos.append(t)
        return dias
    cfg = dict(mercado.CFG, usd_tickers=["SPY"], historico_extra=["PAM"], historico_desde="2026-01-01")
    with parches((mercado, "yahoo", falsa), (mercado, "CFG", cfg)):
        usd, hist = mercado.usd_e_historico({}, ["PAM", "AAPL", "SPY", "MEP"])
    assert pedidos == ["SPY", "PAM", "AAPL"], pedidos
    assert sorted(hist["series"]) == ["AAPL", "PAM", "SPY"] and list(usd["precios"]) == ["SPY"]


def mapa_de_la_sec():
    pedidos, dormido = [], []
    reloj = iter([100.0, 100.0, 100.05, 100.2])
    with entorno(SEC_CONTACTO="José Pérez jose@example.com"), parches(
            (mercado, "bajar", red({"company_tickers": grabada("sec_company_tickers_formato.json")}, pedidos)),
            (sec, "_dormir", dormido.append), (sec, "_reloj", lambda: next(reloj)), (sec, "_ultimo", [0.0])):
        r = sec.mapa_cik(mercado, ["PAM", "YPF", "BRK.B", "ZZZZ", "NVDA"])
        sec.pedir(mercado, "https://data.sec.gov/otra-company_tickers")
    assert r["mapa"]["PAM"]["cik"] == 1469395 and r["mapa"]["YPF"], "los ADR figuran"
    assert r["mapa"]["BRK.B"]["cik"] == 1067983, "el punto se busca con guion"
    assert r["sin_cik"] == ["ZZZZ"], r["sin_cik"]
    assert pedidos[0][1]["User-Agent"] == "Jose Perez jose@example.com", pedidos[0][1]
    assert len(dormido) == 1 and abs(dormido[0] - 0.1) < 1e-6, f"espera entre pedidos seguidos: {dormido}"
    assert [sec.nombre_corto(n) for n in ("NVIDIA CORP", "Pampa Energy Inc.", "MERCADOLIBRE INC", "COCA COLA CO", "Alphabet Inc.")] == \
        ["NVIDIA", "Pampa Energy", "MERCADOLIBRE", "COCA COLA", "Alphabet"]


def sin_contacto_se_saltea():
    previo = {"mapa": {"NVDA": {"cik": 1, "nombre": "x"}}, "sin_cik": [], "stale": False}
    with entorno(SEC_CONTACTO=None), datos_temporales(sec_cik=previo), parches((mercado, "bajar", red({}))):
        r = senales.sec_cik(mercado, ["NVDA", "AAPL"])
        guardado = mercado.leer("sec_cik.json")
    assert r["stale"] and "SEC_CONTACTO" in r["aviso"] and r["mapa"] == previo["mapa"], r
    assert guardado == r


def mapa_se_reusa_y_conserva():
    pedidos = []
    with entorno(SEC_CONTACTO="x x@example.com"), datos_temporales(), parches(
            SIN_ESPERA, (mercado, "bajar", red({"company_tickers": grabada("sec_company_tickers_formato.json")}, pedidos))):
        senales.sec_cik(mercado, ["NVDA"])
        senales.sec_cik(mercado, ["NVDA"])
        assert len(pedidos) == 1, "al día y sin tickers nuevos no vuelve a pedir"
        senales.sec_cik(mercado, ["NVDA", "KO"])
        assert len(pedidos) == 2, "con un ticker nuevo sí"
        mercado.bajar = red({"company_tickers": RuntimeError("403")})
        r = senales.sec_cik(mercado, ["NVDA", "MELI"])
    assert r["stale"] and "NVDA" in r["mapa"] and "aviso" not in r, "si falla conserva lo anterior"


def desde_la_app_no_corre():
    with datos_temporales(), parches((mercado, "bajar", red({}))):
        senales.correr(mercado, origen="app")
        assert not (mercado.DATA / "sec_cik.json").exists()


# ---------- etapa 2 · calendario ----------
NVDA = json.loads(grabada("yfinance_nvda.json"))


def yahoo_grabado(pedidos=None, calendario_nvda=None, fallan=()):
    """Reemplaza las cuatro funciones de yfinance por la respuesta grabada de NVDA."""
    def anotar(que, t):
        if pedidos is not None:
            pedidos.append((que, t))
        if t in fallan:
            raise RuntimeError("sin red")
    return parches(
        (calendario, "yf_calendario", lambda t: anotar("calendario", t) or (calendario_nvda or NVDA["calendario"] if t == "NVDA" else {})),
        (calendario, "yf_vencimientos", lambda t: anotar("vencimientos", t) or NVDA["vencimientos"]),
        (calendario, "yf_precio", lambda t: anotar("precio", t) or NVDA["precio"]),
        (calendario, "yf_cadena", lambda t, v: anotar("cadena " + v, t) or NVDA["cadena"]))


def straddle():
    r = calendario.movimiento_descontado(NVDA["precio"], NVDA["cadena"]["calls"], NVDA["cadena"]["puts"])
    # base 149: compra (3,9+5,45)/2 = 4,675 y venta (0,8+0,9)/2 = 0,85; 5,525 sobre 149,30 = 3,7%
    assert r == {"strike": 149.0, "straddle": 5.525, "movimiento": 0.037}, r
    sin = [dict(f, bid=0) for f in NVDA["cadena"]["calls"]]
    assert calendario.movimiento_descontado(NVDA["precio"], sin, NVDA["cadena"]["puts"]) is None, "sin puntas no se inventa"
    abiertas = [dict(f, bid=0.1, ask=9.0) for f in NVDA["cadena"]["calls"]]
    assert calendario.movimiento_descontado(NVDA["precio"], abiertas, NVDA["cadena"]["puts"]) is None, "puntas muy separadas"
    lejos = calendario.movimiento_descontado(200, NVDA["cadena"]["calls"], NVDA["cadena"]["puts"])
    assert lejos is None, "sin una base cerca del precio"


def fechas_de_yahoo():
    assert calendario.proximas_fechas(NVDA["calendario"], "2026-11-10") == ("2026-11-17", "2026-12-01")
    assert calendario.proximas_fechas(NVDA["calendario"], "2026-11-27") == (None, "2026-12-01"), "un balance pasado no es el próximo"
    assert calendario.proximas_fechas({}, "2026-11-27") == (None, None)


def agenda_completa():
    pedidos = []
    with parches((mercado, "hoy_argentina", lambda: "2026-11-10")), yahoo_grabado(pedidos):
        a = calendario.agenda(mercado, ["NVDA", "SPY"], {})
        n = a["empresas"]["NVDA"]
        assert n["balance"] == "2026-11-17" and n["ex_dividendo"] == "2026-12-01" and not a["stale"], n
        assert n["opciones"]["vencimiento"] == "2026-11-27" and n["opciones"]["movimiento"] == 0.037, "primer vencimiento posterior"
        assert a["empresas"]["SPY"]["balance"] is None
        antes = len(pedidos)
        b = calendario.agenda(mercado, ["NVDA", "SPY"], a)
        assert len(pedidos) == antes and b["empresas"] == a["empresas"], "el mismo día no vuelve a pedir"
    # al día siguiente, si falla, conserva lo anterior marcado como viejo
    with parches((mercado, "hoy_argentina", lambda: "2026-11-11")), yahoo_grabado(fallan=("NVDA", "SPY")):
        c = calendario.agenda(mercado, ["NVDA", "SPY"], a)
        assert c["stale"] and c["empresas"]["NVDA"]["stale"] and c["empresas"]["NVDA"]["opciones"], c
        assert c["actualizado"] == a["actualizado"]
    # si cambia la fecha del balance, el movimiento viejo no sirve
    otro = dict(NVDA["calendario"], **{"Earnings Date": ["2027-02-24"]})
    with parches((mercado, "hoy_argentina", lambda: "2026-11-12")), yahoo_grabado(calendario_nvda=otro):
        d = calendario.agenda(mercado, ["NVDA"], a)
        assert d["empresas"]["NVDA"]["balance"] == "2027-02-24" and d["empresas"]["NVDA"]["opciones"] is None


def agenda_sin_tiempo():
    pedidos = []
    previo = {"empresas": {"SPY": {"consultado": "2026-11-01", "balance": None}}}
    with parches((mercado, "hoy_argentina", lambda: "2026-11-10"), (calendario, "PRESUPUESTO_SEGUNDOS", -1)), yahoo_grabado(pedidos):
        r = calendario.agenda(mercado, ["NVDA", "SPY"], previo)
    assert not pedidos and r["empresas"] == previo["empresas"], r


# ---------- etapa 3 · noticias ----------
ENVIOS = json.loads(grabada("sec_envios_nvda.json"))
RSS = grabada("google_news_nvda.xml")
ENVIOS_YPF = {"filings": {"recent": {
    "accessionNumber": ["0000904851-26-000050", "0000904851-26-000049"], "filingDate": ["2026-11-20", "2026-09-01"], "form": ["6-K", "6-K"],
    "acceptanceDateTime": ["2026-11-20T21:00:00.000Z", "2026-09-01T21:00:00.000Z"], "reportDate": ["", ""], "items": ["", ""],
    "primaryDocument": ["ypf6k.htm", "viejo.htm"], "primaryDocDescription": ["6-K", "6-K"]}}}
CIK = {"mapa": {"NVDA": {"cik": 1045810, "nombre": "NVIDIA CORP"}, "YPF": {"cik": 904851, "nombre": "YPF SOCIEDAD ANONIMA"}}, "sin_cik": []}


def red_noticias(cambios=None, pedidos=None):
    mapa = {"CIK0001045810.json": json.dumps(ENVIOS), "CIK0000904851.json": json.dumps(ENVIOS_YPF),
            "ypf6k.htm": grabada("sec_6k_formato.htm"), "news.google.com/rss": RSS}
    mapa.update(cambios or {})
    return red(mapa, pedidos)


def con_noticias(fn, hoy="2026-11-27", **archivos):
    cfg = dict(mercado.CFG, noticias={"nombres": {"YPF": "YPF"}, "sin_google": ["SPY"]})
    sec._envios.clear()
    with datos_temporales(sec_cik=CIK, **archivos), parches(
            (mercado, "hoy_argentina", lambda: hoy), (mercado, "CFG", cfg), SIN_ESPERA, (noticias, "_dormir", lambda s: None)):
        return fn()


def envios_de_la_sec():
    l = noticias.desde_envios(ENVIOS, "NVDA", 1045810, "2026-10-28")
    ocho = [x for x in l if x["forma"] == "8-K"]
    assert [x["items"] for x in ocho] == [["5.02", "9.01"], ["2.02", "9.01"], ["5.02", "9.01"]], ocho
    assert ocho[0]["titulo"] == "8-K de NVDA: cambios de directivos o directores", ocho[0]["titulo"]
    assert ocho[1]["titulo"] == "8-K de NVDA: resultados"
    assert ocho[0]["url"].startswith("https://www.sec.gov/Archives/edgar/data/1045810/000104581026000090/") and ocho[0]["id"].startswith("sec-")
    cuatro = [x for x in l if x["forma"] == "4"]
    assert cuatro and all(x["cantidad"] >= 1 and x["id"].startswith("sec-4-NVDA-") for x in cuatro), cuatro
    assert not [x for x in l if x["forma"] == "144"], "solo los formularios pedidos"
    assert noticias.desde_envios(ENVIOS, "NVDA", 1045810, "2027-01-01") == []
    assert noticias.titulo_sec("10-Q", "NVDA", [], "2026-10-25", "10-Q") == "10-Q de NVDA: informe trimestral al 25/10"
    try:
        noticias.desde_envios({"filings": {}}, "X", 1, "2026-01-01")
    except RuntimeError:
        return
    raise AssertionError("una respuesta rota no falló")


def extracto_del_6k():
    t = noticias.extracto_de(grabada("sec_6k_formato.htm"))
    assert t.startswith("City of Buenos Aires, November 20, 2026. Relevant Fact."), t
    assert "Commission File" not in t and "venta de un activo" in t and len(t) <= 600, t


def rss_de_google():
    l = noticias.desde_rss(RSS, "NVDA", "en", "2026-11-01")
    assert len(l) == 6 and l[0]["fecha"] >= l[-1]["fecha"], "las más nuevas primero"
    x = next(y for y in l if y["medio"] == "CNBC")
    assert x["titulo"].endswith("2008 financial crisis") and "- CNBC" not in x["titulo"] and x["url"].startswith("https://news.google.com/"), x
    assert len(noticias.desde_rss(RSS, "NVDA", "en", "2026-11-01", maximo=2)) == 2
    ruido = RSS.replace("</channel>", "<item><title>Precio de acciones, noticias, cotización e historial de NVDA Nov 2026 150.000 put (NVDA261125P00150000) - Yahoo</title>"
                        "<link>https://news.google.com/x</link><pubDate>Thu, 26 Nov 2026 10:00:00 GMT</pubDate></item></channel>")
    assert len(noticias.desde_rss(ruido, "NVDA", "es", "2026-11-01")) == 6, "las páginas de cotización no son noticias"
    assert noticias.desde_rss(RSS, "NVDA", "en", "2026-11-24") and all(y["fecha"] >= "2026-11-24" for y in noticias.desde_rss(RSS, "NVDA", "en", "2026-11-24"))


def sin_duplicados_y_con_tope():
    def n(i, fecha, titulo, fuente="Google News", t="AAA", **mas):
        return dict({"id": i, "t": t, "fecha": fecha, "titulo": titulo, "fuente": fuente}, **mas)
    previas = [n("a", "2026-11-20T10:00:00Z", "Gran noticia: AAA sube", materialidad=3), n("v", "2026-10-01T10:00:00Z", "Vieja"),
               n("s", "2026-11-19", "Formulario 4: una", "SEC", cantidad=1, materialidad=1)]
    nuevas = [n("a", "2026-11-20T10:00:00Z", "Gran noticia: AAA sube"), n("b", "2026-11-21T10:00:00Z", "GRAN NOTICIA, AAA SUBE!"),
              n("c", "2026-11-22T10:00:00Z", "Otra cosa"), n("d", "2026-11-22T10:00:00Z", "Gran noticia: AAA sube", t="BBB"),
              n("s", "2026-11-19", "Formulario 4: dos", "SEC", cantidad=2)]
    r = noticias.fusionar(previas, nuevas, "2026-11-27")
    assert sorted(x["id"] for x in r) == ["a", "c", "d", "s"], r
    assert next(x for x in r if x["id"] == "a")["materialidad"] == 3, "la clasificación se conserva"
    s = next(x for x in r if x["id"] == "s")
    assert s["titulo"] == "Formulario 4: dos" and s["materialidad"] == 1
    muchas = [n(f"m{i}", f"2026-11-{1 + i % 26:02d}T10:00:00Z", f"Nota {i}") for i in range(90)]
    r = noticias.fusionar([n("clave", "2026-10-29T10:00:00Z", "Importante", materialidad=3)], muchas, "2026-11-27")
    assert len(r) == noticias.MAXIMO_POR_TICKER and any(x["id"] == "clave" for x in r), "con el tope quedan las importantes"


def noticias_completas():
    pedidos = []

    def probar():
        r = noticias.correr(mercado, ["NVDA", "YPF", "SPY"])
        assert not r["fuentes"]["sec"]["stale"] and not r["fuentes"]["google"]["stale"], r["fuentes"]
        assert r["fuentes"]["byma"]["disponible"] is False
        seis = [x for x in r["items"] if x.get("forma") == "6-K"]
        assert len(seis) == 1 and "venta de un activo" in seis[0]["extracto"], seis
        google_items = [x for x in r["items"] if x["fuente"] == "Google News"]
        assert {x["t"] for x in google_items} == {"NVDA", "YPF"} and len(google_items) == 12, "sin repetir entre idiomas; SPY no se busca"
        assert not [u for u, _ in pedidos if "google" in u and "SPY" in u]
        assert all("example.com" not in str(c) for u, c in pedidos if "sec.gov" not in u), "el contacto solo va a la SEC"
        assert all(c.get("User-Agent") == "Prueba prueba@example.com" for u, c in pedidos if "sec.gov" in u)
        google = [u for u, _ in pedidos if "google" in u]
        assert any("gl=AR" in u for u in google) and any("gl=US" in u and "stock" in u for u in google), google
        antes = len([u for u, _ in pedidos if u.endswith("ypf6k.htm")])
        sec._envios.clear()  # cada corrida vuelve a pedir
        noticias.correr(mercado, ["NVDA", "YPF", "SPY"])
        assert len([u for u, _ in pedidos if u.endswith("ypf6k.htm")]) == antes == 1, "el 6-K no se vuelve a abrir"
        # si se cae todo, se conserva lo anterior marcado como viejo
        caida = RuntimeError("503")
        mercado.bajar = red_noticias({"CIK0001045810.json": caida, "CIK0000904851.json": caida, "news.google.com/rss": caida})
        sec._envios.clear()
        s = noticias.correr(mercado, ["NVDA", "YPF", "SPY"])
        assert s["fuentes"]["sec"]["stale"] and s["fuentes"]["google"]["stale"] and len(s["items"]) == len(r["items"]), s["fuentes"]
        assert s["fuentes"]["google"]["actualizado"]
    with entorno(SEC_CONTACTO="Prueba prueba@example.com"), parches((mercado, "bajar", red_noticias(pedidos=pedidos))):
        con_noticias(probar)


def noticias_sin_contacto():
    pedidos = []
    previa = {"items": [{"id": "sec-x", "t": "NVDA", "fecha": "2026-11-20", "fuente": "SEC", "titulo": "8-K"}]}

    def probar():
        r = noticias.correr(mercado, ["NVDA"])
        assert r["fuentes"]["sec"]["stale"] and "SEC_CONTACTO" in r["fuentes"]["sec"]["aviso"], r["fuentes"]
        assert any(x["id"] == "sec-x" for x in r["items"]) and any(x["fuente"] == "Google News" for x in r["items"])
        assert not [u for u, _ in pedidos if "sec.gov" in u]
    with entorno(SEC_CONTACTO=None), parches((mercado, "bajar", red_noticias(pedidos=pedidos))):
        con_noticias(probar, noticias=previa)


# ---------- etapa 4 · clasificación ----------
ERRORES_GEMINI = dict(json.loads(grabada("gemini_errores_formato.json")), **{"400": {"error": {"code": 400, "status": "INVALID_ARGUMENT"}}})


def dos_noticias():
    return [
        {"id": "sec-1", "t": "YPF", "fuente": "SEC", "forma": "6-K", "items": [], "fecha": "2026-11-25T10:00:00Z", "medio": "SEC EDGAR",
         "titulo": "6-K de YPF: comunicado del emisor", "extracto": "Relevant Fact. La sociedad aprobó la venta de un activo no estratégico."},
        {"id": "gn-2", "t": "NVDA", "fuente": "Google News", "fecha": "2026-11-24T10:00:00Z", "medio": "Ejemplo",
         "titulo": "Nvidia revenue up 99% as bank upgrades the stock to buy"},
    ]


class Respuesta(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def gemini_simulado(guion, pedidos, modelos=None):
    """clasificar._abrir simulado. guion = {modelo: [respuesta, …]}; la última se repite. Errores: "429", "503", "404", "tiempo", "roto"."""
    def abrir(req, timeout=None):
        pedidos.append((req.full_url, dict(req.headers), req.data, timeout))
        if "/models?" in req.full_url:
            if isinstance(modelos, Exception):
                raise modelos
            return Respuesta((modelos or grabada("gemini_modelos_formato.json")).encode())
        modelo = req.full_url.split("/models/")[1].split(":")[0]
        cola = guion[modelo]
        paso = cola.pop(0) if len(cola) > 1 else cola[0]
        if paso == "tiempo":
            raise socket.timeout("timed out")
        if paso in ERRORES_GEMINI:
            raise urllib.error.HTTPError(req.full_url, int(paso), "error", {}, io.BytesIO(json.dumps(ERRORES_GEMINI[paso]).encode()))
        archivo = "gemini_json_roto_formato.json" if paso == "roto" else "gemini_respuesta_formato.json"
        return Respuesta(grabada(archivo).encode())
    return abrir


def como_objeto(x):
    if isinstance(x, dict):
        return types.SimpleNamespace(**{k: como_objeto(v) for k, v in x.items()})
    return [como_objeto(v) for v in x] if isinstance(x, list) else x


@contextlib.contextmanager
def sdk_falso(guion, pedidos):
    """Un módulo `anthropic` de mentira con las mismas excepciones del SDK y respuestas grabadas."""
    mod = types.ModuleType("anthropic")

    class APIError(Exception):
        pass

    class APIConnectionError(APIError):
        pass

    class APITimeoutError(APIConnectionError):
        pass

    class APIStatusError(APIError):
        def __init__(self, status_code):
            super().__init__(status_code)
            self.status_code = status_code

    class RateLimitError(APIStatusError):
        pass

    class NotFoundError(APIStatusError):
        pass

    class Anthropic:
        def __init__(self, **k):
            self.opciones, self.messages = k, self

        def create(self, **k):
            pedidos.append((self.opciones, k))
            paso = guion.pop(0) if len(guion) > 1 else guion[0]
            errores = {"429": RateLimitError(429), "503": APIStatusError(503), "404": NotFoundError(404), "tiempo": APITimeoutError(), "red": APIConnectionError()}
            if paso in errores:
                raise errores[paso]
            datos = json.loads(grabada("anthropic_clasificacion_formato.json"))
            if paso == "roto":
                datos["content"][-1]["text"] = '{"noticias": ['
            if paso == "rechazo":
                datos.update(stop_reason="refusal", content=[])
            return como_objeto(datos)

    for clase in (APIError, APIConnectionError, APITimeoutError, APIStatusError, RateLimitError, NotFoundError, Anthropic):
        setattr(mod, clase.__name__, clase)
    previo = sys.modules.get("anthropic")
    sys.modules["anthropic"] = mod
    try:
        yield
    finally:
        if previo is None:
            sys.modules.pop("anthropic", None)
        else:
            sys.modules["anthropic"] = previo


def config_ia(**cambios):
    return dict(clasificar.CONFIG, **cambios)


CLAVES = {"GEMINI_API_KEY": "clave-gemini-de-prueba", "ANTHROPIC_API_KEY": "clave-claude-de-prueba"}


def filtro_por_reglas():
    def c(titulo, **k):
        r = clasificar.reglas(dict({"t": "X", "titulo": titulo, "fuente": "Google News"}, **k))
        return r["materialidad"], r["categoria"], r["recomendacion"]
    assert c("8-K", fuente="SEC", forma="8-K", items=["2.02", "9.01"]) == (2, "resultados", "ninguna")
    assert c("8-K", fuente="SEC", forma="8-K", items=["5.02", "2.01"])[:2] == (3, "fusión o venta"), "gana el ítem más importante"
    assert c("10-Q", fuente="SEC", forma="10-Q")[:2] == (2, "resultados") and c("F4", fuente="SEC", forma="4")[0] == 1
    assert c("6-K", fuente="SEC", forma="6-K", extracto="aprobó la adquisición de una empresa")[1] == "fusión o venta"
    assert c("Goldman upgrades Nvidia to buy") == (2, "recomendación explícita de analista", "compra")
    assert c("Morgan Stanley downgrades Tesla, cuts rating to underweight")[2] == "venta"
    assert c("Barclays raises Apple price target to 300") == (1, "recomendación explícita de analista", "ninguna"), "un precio objetivo solo no es compra ni venta"
    assert c("Is Nvidia a Screaming Buy or a Value Trap?")[2] == "ninguna" and c("Is Nvidia a Screaming Buy or a Value Trap?")[1] == "otro"
    assert c("Moody's upgrades YPF credit rating")[1] == "calificación"
    assert c("Tribunal falló en el juicio contra YPF")[1] == "regulación o juicio"
    assert c("Nvidia CEO steps down")[1] == "cambio de directivos"
    assert c("Pampa Energía anuncia la adquisición de un parque eólico")[1] == "fusión o venta"
    assert c("MercadoLibre reports third quarter results")[:2] == (2, "resultados")
    assert c("Gualeguaychú ya tiene su estación premium") == (0, "otro", "ninguna")


def lineas_y_json():
    assert clasificar.numeros("1.234,50 y 1,234.5 y 16,0 y 05") == {"1234.5", "16", "05"}
    x = {"t": "NVDA", "titulo": "Nvidia revenue up 99% to $1,234 million", "fecha": "2026-11-24"}
    assert clasificar.linea_valida("NVDA: ingresos 99% arriba, USD 1.234 millones.", x) == "NVDA: ingresos 99% arriba, USD 1.234 millones."
    for mala in ("NVDA creció 45%.", "Te conviene comprar NVDA.", "Recomendamos vender.", "", "x" * 300):
        assert clasificar.linea_valida(mala, x) == x["titulo"], mala
    ok = '```json\n{"noticias":[{"id":"n1","materialidad":2,"categoria":"otro","recomendacion":"ninguna","linea":"a"},{"id":"n2","materialidad":9}]}\n```'
    assert list(clasificar.leer_respuesta(ok)) == ["n1"], "la fila mal formada se descarta"
    for malo in ("", "no es json", '{"noticias": []}', '{"otra": 1}', '{"noticias":[{"id":"n1","materialidad":true,"categoria":"otro","recomendacion":"ninguna","linea":"a"}]}'):
        try:
            clasificar.leer_respuesta(malo)
        except clasificar.ErrorModelo as e:
            assert e.tipo == "json"
            continue
        raise AssertionError("aceptó: " + malo)


def cadena_gemini():
    pedidos, esperas = [], []
    guion = {"gemini-3.5-flash-lite": ["429"], "gemini-3.1-flash-lite": ["503"], "gemini-3.8-flash": ["tiempo"], "gemini-3.6-flash": ["ok"]}
    cfg = config_ia(proveedor="gemini", modelos_gemini=["gemini-viejo"] + clasificar.CONFIG["modelos_gemini"])
    items = dos_noticias()
    salida = io.StringIO()
    with parches((clasificar, "_abrir", gemini_simulado(guion, pedidos)), (clasificar, "_dormir", esperas.append)), contextlib.redirect_stdout(salida):
        r = clasificar.clasificar(items, cfg, CLAVES, "2026-11-27T12:00:00Z")
    assert r["omitidos"] == ["gemini-viejo"], "saltea lo que ya no existe, sin fallar"
    m = r["modelos"]
    assert m["gemini-3.5-flash-lite"]["errores"] == {"429": 3} and m["gemini-3.1-flash-lite"]["errores"] == {"503": 3}
    assert m["gemini-3.8-flash"]["errores"] == {"tiempo": 3} and m["gemini-3.6-flash"]["ok"] == 1, m
    assert esperas == [2, 4] * 3, f"espera creciente, hasta 2 reintentos: {esperas}"
    assert items[0]["por"] == {"proveedor": "gemini", "modelo": "gemini-3.6-flash", "cuando": "2026-11-27T12:00:00Z"}
    assert items[0]["materialidad"] == 3 and items[1]["recomendacion"] == "compra" and not r["sin_ia"] and r["con_ia"] == 2
    generar = [p for p in pedidos if ":generateContent" in p[0]]
    assert all(p[3] == 30 for p in generar), "cada pedido con su tiempo límite"
    assert all("clave-gemini" not in p[0] and p[1]["X-goog-api-key"] == CLAVES["GEMINI_API_KEY"] for p in pedidos), "la clave va en el encabezado"
    cuerpo = json.loads(generar[0][2])
    formato = cuerpo["generationConfig"]["responseFormat"]["text"]
    assert formato["mimeType"] == "APPLICATION_JSON" and formato["schema"] == clasificar.ESQUEMA and "temperature" not in cuerpo["generationConfig"]
    assert "clave" not in salida.getvalue(), "no se imprime ninguna clave"


def modelo_inexistente_y_json_roto():
    pedidos = []
    guion = {"gemini-3.5-flash-lite": ["404"], "gemini-3.1-flash-lite": ["roto", "ok"]}
    cfg = config_ia(proveedor="gemini", modelos_gemini=["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"], lote=1)
    items = dos_noticias()
    with parches((clasificar, "_abrir", gemini_simulado(guion, pedidos)), (clasificar, "_dormir", lambda s: None)):
        r = clasificar.clasificar(items, cfg, CLAVES, "2026-11-27T12:00:00Z")
    m = r["modelos"]
    assert m["gemini-3.5-flash-lite"]["pedidos"] == 1 and m["gemini-3.5-flash-lite"]["errores"] == {"inexistente": 1}, "un 404 no se reintenta ni se vuelve a pedir"
    assert m["gemini-3.1-flash-lite"]["errores"] == {"json": 1} and m["gemini-3.1-flash-lite"]["ok"] == 2, "el JSON roto se reintenta"
    assert m["gemini-3.1-flash-lite"]["tokens_entrada"] == 640 * 3, "los pedidos fallidos también gastan"
    # si no se puede consultar la lista, prueba igual con los configurados
    pedidos.clear()
    guion = {"gemini-3.5-flash-lite": ["ok"]}
    with parches((clasificar, "_abrir", gemini_simulado(guion, pedidos, modelos=urllib.error.URLError("sin red")))):
        r = clasificar.clasificar(dos_noticias(), cfg, CLAVES, "x")
    assert r["con_ia"] >= 1 and any("lista de modelos" in a for a in r["avisos"]), r


def gemini_caido_pasa_a_haiku_o_a_reglas():
    caido = {x: ["503"] for x in clasificar.CONFIG["modelos_gemini"]}
    pedidos_g, pedidos_c = [], []
    items = dos_noticias()
    with parches((clasificar, "_abrir", gemini_simulado(dict(caido), pedidos_g)), (clasificar, "_dormir", lambda s: None)), sdk_falso(["ok"], pedidos_c):
        r = clasificar.clasificar(items, config_ia(proveedor="gemini"), CLAVES, "x")
    assert items[0]["por"]["proveedor"] == "anthropic" and items[0]["por"]["modelo"] == "claude-haiku-5-5" and not r["sin_ia"]
    items = dos_noticias()
    with parches((clasificar, "_abrir", gemini_simulado(dict(caido), [])), (clasificar, "_dormir", lambda s: None)):
        r = clasificar.clasificar(items, config_ia(proveedor="gemini"), {"GEMINI_API_KEY": "k"}, "x")
    assert r["sin_ia"] and items[0]["por"] == {"proveedor": "reglas"} and r["pendientes"] == 2, r
    assert all(v["errores"] == {"503": 3} for v in r["modelos"].values()) and len(r["modelos"]) == 4


def haiku_con_el_sdk():
    pedidos, esperas = [], []
    items = dos_noticias()
    with sdk_falso(["429", "tiempo", "ok"], pedidos), parches((clasificar, "_dormir", esperas.append)):
        r = clasificar.clasificar(items, config_ia(), CLAVES, "2026-11-27T12:00:00Z")
    m = r["modelos"]["claude-haiku-5-5"]
    assert m["errores"] == {"429": 1, "tiempo": 1} and m["ok"] == 1 and esperas == [2, 4], (m, esperas)
    assert m["tokens_entrada"] == 812 and abs(m["costo_usd"] - (812 * 0.10 + 154 * 0.50) / 1e6) < 1e-6 and r["costo_usd"] == m["costo_usd"]
    opciones, cuerpo = pedidos[-1]
    assert opciones == {"api_key": CLAVES["ANTHROPIC_API_KEY"], "timeout": 30, "max_retries": 0}
    assert cuerpo["model"] == "claude-haiku-5-5" and not {"temperature", "top_p", "top_k"} & set(cuerpo), "sin parámetros de muestreo"
    assert cuerpo["output_config"]["format"]["type"] == "json_schema" and cuerpo["output_config"]["effort"] == "low"
    assert items[1]["linea"] == "NVDA presentó resultados con ingresos 99% arriba.", "los números están en la noticia"
    for paso, tipo in (("503", "503"), ("roto", "json"), ("red", "red"), ("rechazo", "rechazo"), ("404", "inexistente")):
        with sdk_falso([paso], []), parches((clasificar, "_dormir", lambda s: None)):
            r = clasificar.clasificar(dos_noticias(), config_ia(), CLAVES, "x")
        assert r["sin_ia"] and list(r["modelos"]["claude-haiku-5-5"]["errores"]) == [tipo], (paso, r["modelos"])


def sin_clave_o_sin_ia():
    items = dos_noticias()
    with parches((clasificar, "_abrir", lambda *a, **k: (_ for _ in ()).throw(AssertionError("pidió algo")))):
        r = clasificar.clasificar(items, config_ia(), {}, "x")
        assert r["sin_ia"] and "ANTHROPIC_API_KEY" in r["avisos"][0] and r["por_reglas"] == 2 and all(x["por"]["proveedor"] == "reglas" for x in items)
        r = clasificar.clasificar(dos_noticias(), config_ia(proveedor="ninguno"), CLAVES, "x")
        assert not r["sin_ia"] and not r["modelos"]


def cache_y_topes():
    muchas = [{"id": f"gn-{i}", "t": "NVDA", "fuente": "Google News", "fecha": f"2026-11-{1 + i:02d}", "titulo": f"Nvidia reports results {i}"} for i in range(7)]
    muchas.append({"id": "sec-4", "t": "NVDA", "fuente": "SEC", "forma": "4", "fecha": "2026-11-20", "titulo": "Formulario 4"})
    pedidos = []
    with sdk_falso(["ok"], pedidos):
        r = clasificar.clasificar(muchas, config_ia(lote=2, max_noticias=4), CLAVES, "x")
    assert len(pedidos) == 2 and r["con_ia"] == 4 and r["pendientes"] == 3, (len(pedidos), r)
    assert '"Nvidia reports results 6"' in pedidos[0][1]["messages"][0]["content"], "primero lo más nuevo"
    assert muchas[-1]["por"]["proveedor"] == "reglas" and "Formulario" not in str(pedidos), "el formulario 4 no gasta IA"
    with sdk_falso(["ok"], pedidos):
        r = clasificar.clasificar(muchas, config_ia(lote=2), CLAVES, "x")
    assert r["con_ia"] == 3 and r["pendientes"] == 0, "solo lo que faltaba"
    ids = str([p[1]["messages"] for p in pedidos[2:]])
    assert "results 6" not in ids, "lo ya clasificado no se repite"
    # tope de tokens: después del primer lote no sigue
    pedidos.clear()
    with sdk_falso(["ok"], pedidos):
        r = clasificar.clasificar([dict(x) for x in dos_noticias() * 3], config_ia(lote=2, max_tokens=500), CLAVES, "x")
    assert len(pedidos) == 1 and r["pendientes"] > 0
    # tope de tiempo: sin margen ni arranca
    reloj = iter([0.0] + [1000.0] * 50)
    pedidos.clear()
    with sdk_falso(["ok"], pedidos), parches((clasificar, "_reloj", lambda: next(reloj))):
        r = clasificar.clasificar(dos_noticias(), config_ia(), CLAVES, "x")
    assert not pedidos and r["pendientes"] == 2 and r["sin_ia"]


def gemini_con_la_forma_anterior():
    pedidos = []
    guion = {"gemini-3.5-flash-lite": ["400", "ok"]}
    cfg = config_ia(proveedor="gemini", modelos_gemini=["gemini-3.5-flash-lite"])
    with parches((clasificar, "_abrir", gemini_simulado(guion, pedidos))):
        r = clasificar.clasificar(dos_noticias(), cfg, {"GEMINI_API_KEY": "k"}, "x")
    formas = [list(json.loads(p[2])["generationConfig"]) for p in pedidos if ":generateContent" in p[0]]
    assert formas == [["responseFormat"], ["responseMimeType", "responseJsonSchema"]], formas
    assert r["con_ia"] == 2 and r["modelos"]["gemini-3.5-flash-lite"]["errores"] == {}, r["modelos"]
    # si rechaza las dos, cuenta como falla y sigue sin trabarse
    with parches((clasificar, "_abrir", gemini_simulado({"gemini-3.5-flash-lite": ["400"]}, []))):
        r = clasificar.clasificar(dos_noticias(), cfg, {"GEMINI_API_KEY": "k"}, "x")
    assert r["sin_ia"] and r["modelos"]["gemini-3.5-flash-lite"]["errores"] == {"400": 1}, r["modelos"]


def corrida_guarda_el_uso():
    historial = {"corridas": [{"fecha": str(i)} for i in range(clasificar.CORRIDAS_GUARDADAS)]}
    con_haiku = dict(mercado.CFG, ia=dict(mercado.CFG.get("ia") or {}, proveedor="haiku"))
    with datos_temporales(noticias={"items": dos_noticias()}, ia_uso=historial), sdk_falso(["ok"], []), parches((mercado, "CFG", con_haiku)):
        clasificar.correr(mercado, entorno=CLAVES)
        n, u = mercado.leer("noticias.json"), mercado.leer("ia_uso.json")
    assert n["items"][0]["por"]["proveedor"] == "anthropic"
    assert len(u["corridas"]) == clasificar.CORRIDAS_GUARDADAS and u["corridas"][-1]["con_ia"] == 2 and u["corridas"][0]["fecha"] == "1"
    assert "clave" not in json.dumps(u)
    propia = clasificar.configuracion(mercado)
    assert propia["proveedor"] == mercado.CFG["ia"]["proveedor"] and propia["precios"], "el archivo manda sobre los valores por defecto"


# ---------- etapa 5 · directivos ----------
def formulario4(dueno=111, ops=(("2026-11-18", "P", 1000, 100.0, 3000),), cargo="Chief Executive Officer", oficial=1, director=0, emisor=1045810, plan=0):
    filas = "".join(
        f"""<nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>{f}</value></transactionDate>
        <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>{c}</transactionCode></transactionCoding>
        <transactionAmounts><transactionShares><value>{n}</value></transactionShares>{"<transactionPricePerShare><value>%s</value></transactionPricePerShare>" % p if p else ""}
        <transactionAcquiredDisposedCode><value>{"A" if c == "P" else "D"}</value></transactionAcquiredDisposedCode></transactionAmounts>
        <postTransactionAmounts><sharesOwnedFollowingTransaction><value>{d}</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
        <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature></nonDerivativeTransaction>"""
        for f, c, n, p, d in ops)
    return f"""<?xml version="1.0"?><ownershipDocument><documentType>4</documentType><issuer><issuerCik>{emisor:010d}</issuerCik>
    <issuerTradingSymbol>NVDA</issuerTradingSymbol></issuer><reportingOwner><reportingOwnerId><rptOwnerCik>{dueno:010d}</rptOwnerCik>
    <rptOwnerName>Persona {dueno}</rptOwnerName></reportingOwnerId><reportingOwnerRelationship><isDirector>{director}</isDirector>
    <isOfficer>{oficial}</isOfficer><officerTitle>{cargo}</officerTitle></reportingOwnerRelationship></reportingOwner>
    <aff10b5One>{plan}</aff10b5One><nonDerivativeTable>{filas}
    <nonDerivativeTransaction><transactionDate><value>2026-11-18</value></transactionDate><transactionCoding><transactionCode>A</transactionCode></transactionCoding>
    <transactionAmounts><transactionShares><value>99999</value></transactionShares></transactionAmounts></nonDerivativeTransaction>
    </nonDerivativeTable></ownershipDocument>"""


def envios4(*filas):
    """Respuesta de submissions con formularios 4: [(número, fecha)]."""
    return {"filings": {"recent": {"form": ["4"] * len(filas), "accessionNumber": [a for a, _ in filas], "filingDate": [f for _, f in filas],
                                   "primaryDocument": [f"xslF345X06/{a}.xml" for a, _ in filas], "items": [""] * len(filas)}}}


def leer_formulario_4():
    f = directivos.leer_formulario(formulario4(ops=(("2026-11-18", "P", 1000, 100.0, 3000), ("2026-11-18", "S", 50, 101.0, 2950))))
    assert f["emisor"] == 1045810 and f["ticker"] == "NVDA" and f["duenos"][0]["cik"] == 111 and f["duenos"][0]["oficial"]
    assert [o["codigo"] for o in f["ops"]] == ["P", "S"], "las concesiones y ejercicios no cuentan"
    assert f["ops"][0] == {"fecha": "2026-11-18", "codigo": "P", "acciones": 1000.0, "precio": 100.0, "despues": 3000.0, "tenencia": "D|"}
    assert directivos.leer_formulario(formulario4(ops=(("2026-11-18", "P", 10, None, 20),)))["ops"][0]["precio"] is None
    try:
        directivos.leer_formulario("<html>no</html>")
    except RuntimeError:
        pass
    else:
        raise AssertionError("aceptó otra cosa")
    assert directivos.url_formulario(1045810, "0001696841-26-000016", "xslF345X06/wk.xml") == \
        "https://www.sec.gov/Archives/edgar/data/1045810/000169684126000016/wk.xml"


def roles_y_tenencia():
    r = lambda cargo, **k: directivos.rol(dict({"cargo": cargo, "oficial": True}, **k))[0]  # noqa: E731
    assert [r("CEO"), r("EVP & Chief Financial Officer"), r("President"), r("Senior Vice President"), r("Chief Operating Officer")] == \
        ["ceo_cfo", "ceo_cfo", "presidente", "directivo", "presidente"]
    assert r("", oficial=False, director=True) == "director" and r("", oficial=False, dueno10=True) == "dueno" and r("", oficial=False) == "otro"
    ops = [{"fecha": "2026-11-01", "codigo": "P", "acciones": 100, "despues": 1100, "tenencia": "D|"},
           {"fecha": "2026-11-02", "codigo": "P", "acciones": 100, "despues": 1200, "tenencia": "D|"}]
    assert directivos.aumento(ops) == 0.2
    assert directivos.aumento([dict(ops[0], despues=100)]) == 1.0, "una tenencia nueva cuenta como el doble"
    assert directivos.aumento([dict(ops[0], despues=None)]) is None


def rutina_u_oportunidad():
    compra = {"fecha": "2026-11-18", "emisor": 1045810}

    def leer(operados):
        return lambda acceso, doc: directivos.leer_formulario(formulario4(ops=((operados[acceso], "P", 1, 1, 1),)))
    tres = envios4(("a", "2025-11-10"), ("b", "2024-11-12"), ("c", "2023-12-02"))
    en_noviembre = {"a": "2025-11-07", "b": "2024-11-08", "c": "2023-11-29"}
    assert directivos.clasificar_rutina(compra, tres, leer(en_noviembre)) == "rutinaria"
    assert directivos.clasificar_rutina(compra, tres, leer(dict(en_noviembre, b="2024-10-30"))) == "oportunista", "un año operó otro mes"
    otros_meses = envios4(("a", "2025-03-10"), ("b", "2024-11-12"), ("c", "2023-05-02"))
    assert directivos.clasificar_rutina(compra, otros_meses, leer({})) == "oportunista"
    assert directivos.clasificar_rutina(compra, envios4(("a", "2025-11-10"), ("b", "2024-11-12")), leer({})) == "sin_historia"
    otra_empresa = lambda a, d: directivos.leer_formulario(formulario4(emisor=999, ops=((en_noviembre[a], "P", 1, 1, 1),)))  # noqa: E731
    assert directivos.clasificar_rutina(compra, tres, otra_empresa) == "oportunista", "cuenta solo lo operado en esta empresa"


def puntaje_con_pesos():
    p = directivos.PESOS
    mejor = {"rutina": "oportunista", "rol": "ceo_cfo", "aumento": 0.8, "monto": 2_000_000}
    total, partes, faltan = directivos.puntaje(mejor, 4, {"capitalizacion": 1e9, "cambio_6m": -0.45}, p)
    assert total == 100 and not faltan and all(v == 1 for v in partes.values()), (total, partes)
    total, partes, _ = directivos.puntaje({"rutina": "rutinaria", "rol": "director", "aumento": 0.05, "monto": 50_000}, 1, {"capitalizacion": 1e10, "cambio_6m": 0.2}, p)
    # cargo 0,4×20 + tenencia 0,1×15 + tamaño 0,005×15 = 9,6 de 100
    assert total == 10 and partes["oportunista"] == 0 and partes["caida"] == 0 and partes["cantidad"] == 0, (total, partes)
    total, partes, faltan = directivos.puntaje({"rutina": None, "rol": "ceo_cfo", "aumento": None, "monto": None}, 1, None, p)
    assert total == 35 and sorted(faltan) == ["caida", "tamano", "tenencia"], (total, faltan)
    with datos_temporales(supuestos={"radar_directivos": {"pesos": {"cargo": 100}, "umbral": 40}}):
        mio = directivos.pesos(mercado)
    assert mio["umbral"] == 40 and mio["pesos"]["cargo"] == 100 and mio["pesos"]["oportunista"] == 30 and mio["topes"]["tamano"] == 0.001
    reales = json.loads((GRABADAS.parent.parent / "data" / "supuestos.json").read_text(encoding="utf-8"))["radar_directivos"]
    assert "a calibrar" in reales["fuente"] and sum(reales["pesos"].values()) == 100
    assert {k: reales[k] for k in directivos.PESOS} == directivos.PESOS, "el archivo y los valores por defecto coinciden"


def cierres_y_caida():
    cierres = [("2026-04-01", 100), ("2026-05-18", 120), ("2026-11-17", 90), ("2026-11-20", 60)]
    assert directivos.cambio_previo(cierres, "2026-11-18") == -0.25, "contra el cierre de unos 6 meses antes de la compra"
    assert directivos.cambio_previo([("2026-11-01", 5)], "2026-11-18") is None


def radar_completo():
    pedidos = []
    lista = [{"t": "NVDA", "tipo": "cedear", "usa": "NVDA", "en": ["cartera"]}]
    cik = {"mapa": {"NVDA": {"cik": 1045810, "nombre": "NVIDIA CORP"}, "CTSO": {"cik": 1175151, "nombre": "CYTOSORBENTS CORP"}}}
    ventas = {f"v{i}": formulario4(dueno=200 + i, cargo="", oficial=0, director=1, ops=(("2026-11-10", "S", 500, 150.0, 100),)) for i in range(3)}
    mapa = {
        "CIK0001045810.json": json.dumps(envios4(("c1", "2026-11-19"), ("v0", "2026-11-12"), ("v1", "2026-11-12"), ("v2", "2026-11-12"), ("viejo", "2026-09-01"))),
        "CIK0001175151.json": json.dumps(envios4(("c2", "2026-11-21"))),
        "CIK0000000111.json": json.dumps(envios4(("h1", "2025-03-01"), ("h2", "2024-04-01"), ("h3", "2023-06-01"))),
        "CIK0000000300.json": json.dumps(envios4()),
        "/c1.xml": formulario4(), "/c2.xml": formulario4(dueno=300, emisor=1175151, cargo="CFO", ops=(("2026-11-20", "P", 5000, 5.0, 15000),)),
        **{f"/{k}.xml": v for k, v in ventas.items()},
    }
    with entorno(SEC_CONTACTO="x x@example.com"), datos_temporales(sec_cik=cik, insiders={"filas": [{"ticker": "CTSO"}]}), parches(
            SIN_ESPERA, (mercado, "bajar", red(mapa, pedidos)), (mercado, "hoy_argentina", lambda: "2026-11-27"),
            (directivos, "yf_empresa", lambda t, hasta: {"capitalizacion": 3e8 if t == "CTSO" else 3.6e12, "cambio_6m": -0.3 if t == "CTSO" else 0.1})):
        sec._envios.clear()
        r = directivos.correr(mercado, lista)
        compras = {x["t"]: x for x in r["compras"]}
        assert not r["stale"] and set(compras) == {"NVDA", "CTSO"} and r["pendientes"] == 0, r
        n, c = compras["NVDA"], compras["CTSO"]
        assert n["cargo"] == "CEO" and n["rutina"] == "oportunista" and n["monto"] == 100000 and n["aumento"] == 0.5 and n["cartera"] and n["accionable"]
        assert c["rutina"] == "sin_historia" and not c["cartera"] and c["accionable"] == c["cedear"] is False, c
        # NVDA: oportunista 30 + CEO 20 + tenencia +50% 15. CTSO: sin historia 15 + CFO 20 + tenencia 15 + tamaño 1,25 + caída 10.
        assert n["puntaje"] == 65 and c["puntaje"] == 61 and [x["t"] for x in r["compras"]] == ["NVDA", "CTSO"], (n["puntaje"], c["puntaje"])
        v = r["ventas"][0]
        assert v["t"] == "NVDA" and v["vendedores"] == 3 and v["destacar"] and v["monto"] == 225000, v
        assert not [u for u, _ in pedidos if "viejo" in u], "solo los últimos 30 días"
        assert all(cab.get("User-Agent") == "x x@example.com" for u, cab in pedidos)
        # la segunda corrida no vuelve a abrir los documentos ni a mirar la historia
        antes = len([u for u, _ in pedidos if u.endswith(".xml")])
        sec._envios.clear()
        r2 = directivos.correr(mercado, lista)
        assert len([u for u, _ in pedidos if u.endswith(".xml")]) == antes and r2["compras"] == r["compras"]
        # si la SEC se cae, conserva lo anterior marcado como viejo
        mercado.bajar = red({"CIK": RuntimeError("503")})
        sec._envios.clear()
        r3 = directivos.correr(mercado, lista)
        assert r3["stale"] and r3["compras"] == r["compras"] and r3["actualizado"] == r2["actualizado"]


def radar_con_tope_y_sin_contacto():
    lista = [{"t": "NVDA", "tipo": "cedear", "usa": "NVDA", "en": ["watchlist"]}]
    cik = {"mapa": {"NVDA": {"cik": 1045810, "nombre": "NVIDIA CORP"}}}
    mapa = {"CIK0001045810.json": json.dumps(envios4(("c1", "2026-11-19"), ("c3", "2026-11-18"))), "CIK0000000111.json": json.dumps(envios4()), "/c1.xml": formulario4()}
    with entorno(SEC_CONTACTO="x x@example.com"), datos_temporales(sec_cik=cik), parches(
            SIN_ESPERA, (mercado, "bajar", red(mapa)), (mercado, "hoy_argentina", lambda: "2026-11-27"), (directivos, "FORMULARIOS_POR_CORRIDA", 1),
            (directivos, "yf_empresa", lambda t, h: (_ for _ in ()).throw(RuntimeError("sin red")))):
        sec._envios.clear()
        r = directivos.correr(mercado, lista)
    assert r["pendientes"] == 1 and len(r["compras"]) == 1 and "tamano" in r["compras"][0]["faltan"], r
    with entorno(SEC_CONTACTO=None), datos_temporales(directivos=r), parches((mercado, "bajar", red({}))):
        assert directivos.correr(mercado, lista) is None
        g = mercado.leer("directivos.json")
    assert g["stale"] and "SEC_CONTACTO" in g["aviso"] and g["compras"] == r["compras"]


PRUEBAS = [
    ("Directivos: lee el formulario 4 y cuenta solo compras y ventas de mercado", leer_formulario_4),
    ("Directivos: cargo y cuánto sube la tenencia", roles_y_tenencia),
    ("Directivos: rutinaria si operó el mismo mes tres años seguidos", rutina_u_oportunidad),
    ("Directivos: puntaje de 0 a 100 con los pesos del archivo; lo que falta suma cero", puntaje_con_pesos),
    ("Directivos: caída del precio en los 6 meses previos", cierres_y_caida),
    ("Directivos: lo tuyo y el radar general, ventas de 3 o más, sin repetir pedidos", radar_completo),
    ("Directivos: tope por corrida, y sin SEC_CONTACTO conserva lo anterior", radar_con_tope_y_sin_contacto),
    ("IA: filtro por reglas (ítems del 8-K y palabras clave)", filtro_por_reglas),
    ("IA: la línea no puede inventar números ni recomendar; el JSON se valida", lineas_y_json),
    ("IA: cadena de Gemini ante 429, 503 y tiempo agotado, con espera creciente", cadena_gemini),
    ("IA: modelo inexistente se saltea y el JSON roto se reintenta", modelo_inexistente_y_json_roto),
    ("IA: si Gemini no responde pasa a Haiku y, sin clave, al filtro por reglas", gemini_caido_pasa_a_haiku_o_a_reglas),
    ("IA: Haiku con el SDK, reintentos, costo anotado y cada falla", haiku_con_el_sdk),
    ("IA: sin clave usa las reglas y lo marca; con \"ninguno\" no pide nada", sin_clave_o_sin_ia),
    ("IA: caché por noticia y topes de cantidad, tokens y tiempo", cache_y_topes),
    ("IA: la corrida guarda las clasificaciones y el uso", corrida_guarda_el_uso),
    ("IA: si Gemini rechaza el formato nuevo, prueba el anterior", gemini_con_la_forma_anterior),
    ("Noticias SEC: 8-K con sus ítems, formulario 4 agrupado y solo lo pedido", envios_de_la_sec),
    ("Noticias SEC: del 6-K se saca de qué trata, sin la carátula", extracto_del_6k),
    ("Noticias Google: titular sin el medio, fecha y tope por búsqueda", rss_de_google),
    ("Noticias: sin duplicados, 30 días, tope por empresa y clasificación conservada", sin_duplicados_y_con_tope),
    ("Noticias: SEC y Google en español e inglés; si fallan conservan lo anterior", noticias_completas),
    ("Noticias: sin SEC_CONTACTO sigue Google y avisa", noticias_sin_contacto),
    ("Calendario: movimiento descontado por las opciones, solo con puntas válidas", straddle),
    ("Calendario: próximas fechas de balance y ex dividendo", fechas_de_yahoo),
    ("Calendario: escribe lo que seguís, no repite pedidos y conserva lo anterior si falla", agenda_completa),
    ("Calendario: sin tiempo deja lo anterior para la próxima corrida", agenda_sin_tiempo),
    ("Qué seguir: lee la lista de la app y ordena los subyacentes", lista_de_seguimiento),
    ("Histórico: suma los subyacentes de lo que seguís", historico_con_seguidos),
    ("SEC: mapa de empresas (ADR incluidos), identificación y límite de pedidos", mapa_de_la_sec),
    ("SEC: sin SEC_CONTACTO se saltea con aviso y no pide nada", sin_contacto_se_saltea),
    ("SEC: el mapa se reusa, se amplía y se conserva si falla", mapa_se_reusa_y_conserva),
    ("Pedido desde la app: no corre lo de seguimiento", desde_la_app_no_corre),
]
