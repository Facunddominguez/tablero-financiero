#!/usr/bin/env python3
"""Pruebas de tools/mercado.py que no usan la red (las fuentes se simulan). Uso: python tools/pruebas_mercado.py"""
import contextlib
import io
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import mercado  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")  # en Windows la consola no siempre es UTF-8

res = []


def prueba(nombre, fn):
    try:
        ruido = io.StringIO()  # los avisos de mercado.py ("ok", "FALLA …") son parte de lo simulado
        with contextlib.redirect_stdout(ruido), contextlib.redirect_stderr(ruido):
            fn()
        res.append((nombre, True, ""))
    except Exception as e:  # noqa: BLE001
        res.append((nombre, False, str(e)))


def cpi_csv():
    mercado.bajar = lambda url, **k: (
        "observation_date,CPIAUCSL\n2024-05-01,313.000\n2024-09-01,314.851\n2024-10-01,315.564\n2024-11-01,316.449\n2024-12-01,317.603\n"
        "2025-01-01,319.086\n2025-02-01,319.775\n2025-03-01,.\n2025-04-01,320.580\n"
    )
    r = mercado.cpi_usa()
    assert "2024-05" not in r["meses"] and "2024-09" in r["meses"], "no respeta historico_desde"
    assert "2025-03" not in r["meses"], "no saltea los meses sin dato"
    assert r["meses"]["2025-04"] == 320.58, r["meses"]
    assert list(r["meses"]) == sorted(r["meses"]), "no quedó ordenado"


def cpi_vacio():
    mercado.bajar = lambda url, **k: "DATE,CPIAUCSL\n"
    try:
        mercado.cpi_usa()
    except RuntimeError:
        return
    raise AssertionError("una respuesta vacía no falló")


def seccion_conserva():
    def falla():
        raise RuntimeError("sin red")
    r = mercado.seccion("cpi_usa", {"meses": {"2025-01": 1.0}}, falla)
    assert r["stale"] is True and r["meses"] == {"2025-01": 1.0}, r


def historico_extras():
    cfg = dict(mercado.CFG)
    mercado.CFG.update({"usd_tickers": ["SPY"], "historico_extra": ["NVDA", "PAM"], "historico_desde": "2026-01-01"})
    dias = {"2026-01-02": (10, 10), "2026-01-05": (11, 11), "2026-01-06": (12, 12), "2026-01-07": (13, 13), "2026-01-08": (14, 14)}

    def falsa(t, desde):
        if t == "PAM":
            raise RuntimeError("sin red")
        if t == "NVDA":
            return {f: v for f, v in dias.items() if f != "2026-01-06"}  # le falta un día
        return dias
    mercado.yahoo = falsa
    try:
        usd, hist = mercado.usd_e_historico({"fechas": ["2026-01-02"], "series": {"PAM": [7.5]}})
    finally:
        mercado.CFG.clear(); mercado.CFG.update(cfg)
    assert list(usd["precios"]) == ["SPY"], "los extras no van a los precios del día"
    assert hist["fechas"] == sorted(dias), hist["fechas"]
    assert hist["series"]["NVDA"][2] is None and hist["series"]["NVDA"][3] == 13, hist["series"]["NVDA"]
    assert hist["series"]["PAM"][0] == 7.5 and hist["series"]["PAM"][1] is None, "PAM conserva lo anterior"


# ---------- fuentes nuevas, con respuestas grabadas (tools/grabadas) ----------
GRABADAS = pathlib.Path(__file__).resolve().parent / "grabadas"


def grabada(nombre):
    return (GRABADAS / nombre).read_text(encoding="utf-8")


def red_grabada(cambios=None):
    """Simula la red con las respuestas grabadas. cambios = {parte de la url: texto o excepción}."""
    mapa = {
        "cotizaciones/dolares/bolsa": grabada("argentinadatos_bolsa.json"),
        "cotizaciones/dolares/contadoconliqui": grabada("argentinadatos_contadoconliqui.json"),
        "live/arg_cedears": grabada("data912_arg_cedears.json"),
        "live/usa_stocks": grabada("data912_usa_stocks.json"),
        "live/usa_adrs": grabada("data912_usa_adrs.json"),
        "live/ccl": grabada("data912_ccl_vacio.json"),
    }
    mapa.update(cambios or {})

    def bajar(url, **k):
        for parte, r in mapa.items():
            if url.endswith(parte):
                if isinstance(r, Exception):
                    raise r
                return r
        raise AssertionError("pedido no grabado: " + url)
    mercado.bajar = bajar
    mercado._filas.clear()
    mercado._cotizaciones.clear()


def yahoo_falso(ticker):
    return [{"SPY": 716.76, "EFA": 99.21, "EEM": 56.38, "IWM": 268.84, "SMH": 422.49, "ARGT": 67.53}[ticker], 0.5, "2026-11-25"]


def usa_con_etf():
    red_grabada()
    mercado.yahoo_vivo = yahoo_falso
    r = mercado.usa_vivo()["precios"]
    assert r["SPY"] == [716.76, 0.5, "2026-11-25"], "el ETF que data912 no trae sale de yfinance"
    assert r["NVDA"][0] > 0 and len(r["NVDA"]) == 2 and r["YPF"][0] > 0, "acciones y ADR salen de data912"
    assert "BRK.B" in r, "respeta el ticker de EE.UU. del archivo de ratios"


def usa_sin_nucleo_falla():
    red_grabada()

    def falla(t):
        raise RuntimeError("sin red")
    mercado.yahoo_vivo = falla
    prev = {"precios": {"SPY": [1, 0]}}
    r = mercado.seccion("usa_vivo", prev, mercado.usa_vivo)
    assert r["stale"] is True and r["precios"] == prev["precios"], "sin los ETF del núcleo conserva lo anterior"


def ccl_calculado_si_viene_vacio():
    red_grabada()
    mercado.yahoo_vivo = yahoo_falso
    usa = mercado.usa_vivo()["precios"]
    r = mercado.ccl_implicito(usa)
    assert r["fuente"] == "calculado", r["fuente"]
    spy = r["papeles"]["SPY"]
    fila = next(f for f in json.loads(grabada("data912_arg_cedears.json")) if f["symbol"] == "SPY")
    assert abs(spy[0] - fila["c"] * 60 / 716.76) < 0.01 and spy[1] == round(fila["v"] * fila["c"]), spy
    assert "SPYD" not in r["papeles"], "la especie en dólares no cuenta"
    assert 1500 < r["mediana"] < 2100, r["mediana"]


def ccl_de_data912():
    # formato documentado por data912 para /live/ccl (el día de la grabación vino vacío)
    filas = [{"ticker_usa": f"T{i}", "ticker_ar": f"T{i}", "CCL_mark": 1000 + i, "ars_volume": 100 - i, "arg_panel": "cedear"} for i in range(40)]
    filas.append({"ticker_usa": "X", "ticker_ar": "X", "CCL_mark": 0, "CCL_close": 0, "ars_volume": 10**9})
    red_grabada({"live/ccl": json.dumps(filas)})
    r = mercado.ccl_implicito({})
    assert r["fuente"] == "data912" and "X" not in r["papeles"], r["fuente"]
    assert r["mediana"] == 1014.5, f"mediana de los 30 de más volumen: {r['mediana']}"


def ccl_sin_datos_falla():
    red_grabada({"live/ccl": RuntimeError("sin red"), "live/arg_cedears": RuntimeError("sin red")})
    prev = {"papeles": {"SPY": [1, 1]}, "mediana": 1}
    r = mercado.seccion("ccl_implicito", prev, lambda: mercado.ccl_implicito({}))
    assert r["stale"] is True and r["mediana"] == 1, r


def ratios_a_revisar():
    ratios = {"AAA": {"ratio": 10}, "BBB": {"ratio": 1}, "CCC": {"ratio": 2, "usa": None}, "DDD": {"ratio": 5, "usa": "D.D"}}
    cedears = {"AAA": [1000, 0], "BBB": [1000, 0], "CCC": [1, 0], "DDD": [400, 0]}
    usa = {"AAA": [10.2, 0], "BBB": [52.6, 0], "D.D": [2.0, 0]}
    r = mercado.revisar_ratios(ratios, cedears, usa, 1000)
    assert list(r) == ["BBB"], r  # AAA difiere 2%, CCC no cotiza en EE.UU., DDD coincide
    assert r["BBB"] == [1, 52.6], r


def ratios_oficiales():
    d = json.loads((GRABADAS.parent / "cedear_ratios.json").read_text(encoding="utf-8"))
    assert d["fuente"] and d["fecha"] and d["url"].startswith("https://"), "falta la fuente o la fecha"
    r = d["ratios"]
    assert len(r) > 300 and all(v["ratio"] > 0 for v in r.values()), len(r)
    for t in ("SPY", "EFA", "EEM", "IWM"):
        assert t in r, t
    assert r["BRKB"]["usa"] == "BRK.B" and r["GOOGL"]["d"] == "GOGLD"


def seccion_implicito():
    red_grabada()
    mercado.yahoo_vivo = yahoo_falso
    red = {"cedears": mercado.data912("arg_cedears"), "fx": {"ccl": 1766.75}}
    r = mercado.implicito({}, red)
    assert not r["usa"]["stale"] and not r["ccl"]["stale"], r
    assert "HWM" in r["revisar_ratios"] and "SPY" not in r["revisar_ratios"], r["revisar_ratios"]
    # si se cae todo data912, las dos partes conservan lo anterior y quedan marcadas
    red_grabada({"live/usa_stocks": RuntimeError("x"), "live/usa_adrs": RuntimeError("x"), "live/ccl": RuntimeError("x"), "live/arg_cedears": RuntimeError("x")})

    def falla(t):
        raise RuntimeError("sin red")
    mercado.yahoo_vivo = falla
    s = mercado.implicito(r, dict(red, cedears={"stale": True}))
    assert s["usa"]["stale"] and s["ccl"]["stale"] and s["usa"]["precios"] == r["usa"]["precios"]
    assert s["revisar_ratios"] == r["revisar_ratios"]


def canje_en_historico():
    red_grabada()
    bolsa = json.loads(grabada("argentinadatos_bolsa.json"))
    f1, f2 = bolsa[-3]["fecha"], bolsa[-2]["fecha"]
    hist = {"fechas": ["2020-01-01", f1, f2], "series": {"SPY": [1, 2, 3]}}
    r = mercado.sumar_canje(hist, {})
    assert r["series"]["MEP"][0] is None, "un día sin cotización queda vacío"
    assert r["series"]["MEP"][2] == round((bolsa[-2]["compra"] + bolsa[-2]["venta"]) / 2, 2), "punto medio"
    assert r["series"]["CCL"][1] > 0 and r["series"]["SPY"] == [1, 2, 3] and r["canje"]["stale"] is False
    red_grabada({"cotizaciones/dolares/bolsa": RuntimeError("sin red")})
    nuevo = mercado.sumar_canje({"fechas": ["2020-01-01", f1, f2, "2099-01-01"], "series": {"SPY": [1, 2, 3, 4]}}, r)
    assert nuevo["canje"]["stale"] is True, nuevo["canje"]
    assert nuevo["series"]["MEP"] == r["series"]["MEP"] + [None], "conserva lo anterior"


# ---------- ronda 2 ----------

def red_feriados(cambios=None):
    mapa = {"feriados/2026": grabada("argentinadatos_feriados_2026.json"), "feriados/2027": grabada("argentinadatos_feriados_2027.json")}
    mapa.update(cambios or {})
    red_grabada(mapa)


def con_anio(fn):
    """Fija "hoy" para que las pruebas no dependan del año en que corren."""
    def envuelta():
        real = mercado.hoy_argentina
        mercado.hoy_argentina = lambda: "2026-11-26"
        try:
            fn()
        finally:
            mercado.hoy_argentina = real
    return envuelta


def feriados_grabados():
    red_feriados()
    r = mercado.feriados_ar({})
    assert r["anios"] == [2026, 2027], r["anios"]
    assert r["feriados"]["2026-12-08"]["tipo"] == "inamovible" and r["feriados"]["2026-12-07"]["tipo"] == "puente", r["feriados"]["2026-12-07"]
    assert list(r["feriados"]) == sorted(r["feriados"]), "ordenado"


def feriados_sin_el_anio_que_viene():
    red_feriados()
    previo = mercado.feriados_ar({})
    red_feriados({"feriados/2027": RuntimeError("404")})
    r = mercado.feriados_ar(previo)
    assert r["anios"] == [2026, 2027] and r["feriados"]["2027-12-08"], "conserva el año que ya tenía"
    assert mercado.feriados_ar({})["anios"] == [2026], "sin el que viene sigue andando"


def feriados_si_falla_conserva():
    red_feriados()
    previo = mercado.feriados_ar({})
    red_feriados({"feriados/2026": "[]"})
    r = mercado.seccion("feriados_ar", previo, lambda: mercado.feriados_ar(previo))
    assert r["stale"] is True and r["feriados"] == previo["feriados"], r.get("error")


def lista_byma():
    pagina = grabada("byma_pagina_cedears.html")
    fecha, url = mercado.enlace_lista_byma(pagina + ' <a href="https://cdn.example/x_BYMA-CEDEARs-2025-01-02.pdf">vieja</a>')
    assert fecha == "2026-11-19" and url.endswith("_BYMA-CEDEARs-2026-11-19.pdf"), (fecha, url)
    lista = mercado.leer_lista_byma(grabada("byma_cedears_texto.txt"))
    assert len(lista) > 400 and lista["SPY"] == {60.0} and lista["ABEV"] == {0.333333}, len(lista)
    assert lista["ATAD"] == {4.0}, "las filas de Londres vienen partidas"
    assert lista["XLU"] == {10.0, 15.0}, "la lista de BYMA repite XLU con dos valores"
    propio = json.loads((GRABADAS.parent / "cedear_ratios.json").read_text(encoding="utf-8"))["ratios"]
    assert mercado.comparar_ratios(propio, lista) == {}, mercado.comparar_ratios(propio, lista)


def ratios_cambiados():
    original = grabada("byma_cedears_texto.txt")
    assert "NVDA NASDAQ 24:1" in original
    propio = json.loads((GRABADAS.parent / "cedear_ratios.json").read_text(encoding="utf-8"))["ratios"]
    cambios = mercado.comparar_ratios(propio, mercado.leer_lista_byma(original.replace("NVDA NASDAQ 24:1", "NVDA NASDAQ 48:1")))
    assert cambios == {"NVDA": [24, 48.0]}, cambios
    try:
        mercado.comparar_ratios(propio, mercado.leer_lista_byma("formato nuevo\nSPY NYSE 20:1"))
    except RuntimeError:
        return
    raise AssertionError("si no reconoce la lista tiene que fallar")


def ratios_byma_completo():
    mercado.bajar = lambda url, **k: grabada("byma_pagina_cedears.html")
    mercado.bajar_bytes = lambda url, **k: b"%PDF"
    real, mercado.texto_pdf = mercado.texto_pdf, lambda contenido: grabada("byma_cedears_texto.txt")
    try:
        r = mercado.ratios_byma()
    finally:
        mercado.texto_pdf = real
    assert r["cambios"] == {} and r["lista_fecha"] == "2026-11-19" and r["archivo_fecha"], r
    mercado.bajar = lambda url, **k: "<html>sin enlace</html>"
    s = mercado.seccion("ratios_byma", r, mercado.ratios_byma)
    assert s["stale"] is True and s["lista_fecha"] == "2026-11-19", s


def una_vez_por_dia():
    llamadas = []
    fn = lambda: llamadas.append(1) or {"x": 2}  # noqa: E731
    fresco = {"x": 1, "stale": False, "actualizado": mercado.ahora()}
    assert mercado.seccion_diaria("n", fresco, fn) == fresco and not llamadas, "hoy ya se pidió"
    assert mercado.seccion_diaria("n", dict(fresco, stale=True), fn)["x"] == 2, "si quedó viejo se vuelve a pedir"
    assert mercado.seccion_diaria("n", dict(fresco, actualizado="2020-01-01T00:00:00Z"), fn)["x"] == 2
    assert mercado.seccion_diaria("n", fresco, fn, vigente=lambda a: False)["x"] == 2, "cambió algo que lo invalida"


prueba("Feriados argentinos: este año y el que viene, con su tipo", con_anio(feriados_grabados))
prueba("Feriados argentinos: si el año que viene no está publicado, sigue con lo que hay", con_anio(feriados_sin_el_anio_que_viene))
prueba("Feriados argentinos: una respuesta rota conserva lo anterior marcado como viejo", con_anio(feriados_si_falla_conserva))
prueba("Ratios de BYMA: encuentra la lista nueva, la lee y coincide con el archivo", lista_byma)
prueba("Ratios de BYMA: informa los que cambiaron y falla si cambia el formato", ratios_cambiados)
prueba("Ratios de BYMA: sin enlace conserva lo anterior", ratios_byma_completo)
prueba("Lo que cambia poco se pide una vez por día", una_vez_por_dia)
prueba("Precios de EE.UU.: data912 y, para los ETF que no trae, yfinance", usa_con_etf)
prueba("Precios de EE.UU.: sin los ETF del núcleo se conserva lo anterior", usa_sin_nucleo_falla)
prueba("Dólar implícito: si data912 viene vacío se calcula con los ratios oficiales", ccl_calculado_si_viene_vacio)
prueba("Dólar implícito: usa data912 cuando trae datos y toma la mediana de los líquidos", ccl_de_data912)
prueba("Dólar implícito: sin datos conserva lo anterior", ccl_sin_datos_falla)
prueba("Ratios: marca para revisar los que difieren más de 5%", ratios_a_revisar)
prueba("Ratios: el archivo oficial trae fuente, fecha y los ETF del núcleo", ratios_oficiales)
prueba("Sección nueva de market.json: cada parte falla por separado", seccion_implicito)
prueba("Histórico: suma MEP y CCL alineados con las fechas y conserva lo anterior si falla", canje_en_historico)
prueba("Histórico: los tickers extra que fallan o tienen huecos no frenan a los de referencia", historico_extras)
prueba("IPC de EE.UU.: lee el CSV de FRED, saltea meses sin dato y respeta la fecha de inicio", cpi_csv)
prueba("IPC de EE.UU.: una respuesta vacía cuenta como falla", cpi_vacio)
prueba("Si una fuente falla se conserva el dato anterior marcado como viejo", seccion_conserva)

for nombre, ok, det in res:
    print(("ok    " if ok else "FALLA ") + nombre + (f" — {det}" if det else ""))
print(f"\n{sum(ok for _, ok, _ in res)}/{len(res)} pruebas de mercado pasan")
sys.exit(0 if all(ok for _, ok, _ in res) else 1)
