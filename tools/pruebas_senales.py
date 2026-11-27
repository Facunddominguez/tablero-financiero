"""Pruebas de la ronda 3 (qué seguir, SEC, calendario, noticias, IA y directivos), sin red.

Las corre tools/pruebas_mercado.py. Las respuestas grabadas están en tools/grabadas; las que dicen "formato" se
armaron a mano con el formato de la fuente (la SEC no responde sin un contacto declarado).
"""
import contextlib
import json
import os
import pathlib
import tempfile

import calendario
import mercado
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


PRUEBAS = [
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
