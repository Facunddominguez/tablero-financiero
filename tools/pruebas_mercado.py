#!/usr/bin/env python3
"""Pruebas de tools/mercado.py que no usan la red (las fuentes se simulan). Uso: python tools/pruebas_mercado.py"""
import contextlib
import io
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import contexto  # noqa: E402
import mercado  # noqa: E402
import pruebas_senales  # noqa: E402

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


# ---------- contexto: riesgo país, tasas, fondos, FRED, historia larga y elecciones ----------

NO_EXISTE = RuntimeError("HTTP Error 404: Not Found")


def red_contexto(cambios=None):
    """Red grabada para tools/contexto.py. Las cuotapartes de fechas no grabadas responden 404."""
    mapa = {
        "indices/riesgo-pais": grabada("argentinadatos_riesgo_pais.json"),
        "tasas/depositos30Dias": grabada("argentinadatos_depositos30.json"),
        "fci/mercadoDinero/ultimo": grabada("argentinadatos_fci_mm_ultimo.json"),
        "fci/rentaFija/ultimo": grabada("argentinadatos_fci_rf_ultimo.json"),
        "fci/mercadoDinero/2025/01/31": grabada("argentinadatos_fci_mm_2025_01_31.json"),
        "fci/rentaFija/2025/01/31": grabada("argentinadatos_fci_rf_2025_01_31.json"),
        "series_ticker=KXARGENTINAPRES&with_nested_markets=true": grabada("kalshi_argentinapres.json"),
        "events?slug=argentina-presidential-election-winner": grabada("polymarket_formato_inventado.json"),
    }
    for s in contexto.SERIES_FRED:
        mapa[f"id={s}&cosd=2005-01-01"] = grabada(f"fred_{s}.csv")
    mapa.update(cambios or {})
    pedidos = []

    def bajar(url, **k):
        pedidos.append(url)
        for parte, r in mapa.items():
            if url.endswith(parte):
                if isinstance(r, Exception):
                    raise r
                return r
        if "/fci/" in url:
            raise NO_EXISTE
        raise AssertionError("pedido no grabado: " + url)
    mercado.bajar = bajar
    contexto._limite = None
    return pedidos


def mensual_falso(ticker, desde):
    return {f"{a}-{m:02d}": 100 + a - 2005 + m / 100 for a in range(2019, 2027) for m in range(1, 13) if f"{a}-{m:02d}" <= "2026-11"}


def riesgo_pais_y_tasa():
    red_contexto()
    r = contexto.riesgo_pais(mercado)
    assert r["fechas"][0] >= "2020-01-01" and r["ultimo"] == {"fecha": "2026-11-25", "valor": 1067.0}, r["ultimo"]
    assert len(r["fechas"]) == len(r["valores"]) and r["fechas"] == sorted(r["fechas"])
    t = contexto.plazo_fijo(mercado)
    assert t["fechas"][0] >= mercado.CFG["historico_desde"] and 0 < t["ultimo"]["valor"] < 1, t["ultimo"]
    red_contexto({"indices/riesgo-pais": "[]"})
    s = mercado.seccion("riesgo_pais", r, lambda: contexto.riesgo_pais(mercado))
    assert s["stale"] is True and s["ultimo"] == r["ultimo"], "conserva lo anterior"


def con_historia_desde(desde):
    def decorar(fn):
        def envuelta():
            real = mercado.CFG["historico_desde"]
            mercado.CFG["historico_desde"] = desde
            try:
                fn()
            finally:
                mercado.CFG["historico_desde"] = real
        return envuelta
    return decorar


@con_historia_desde("2025-01-01")
def cuotapartes():
    pedidos = red_contexto()
    r = contexto.fondos(mercado, None, "2025-03-15")
    mm = "Balanz Capital Money Market - Clase A"
    valores = dict(zip(r["fechas"], r["series"][mm]))
    assert valores["2025-01-31"] == 8.347921 and valores["2026-11-25"] == 12.937735, valores
    assert "Balanz Capital Estrategia I USD - Clase A" in r["series"], "también los fondos en dólares"
    assert all(len(s) == len(r["fechas"]) for s in r["series"].values()) and r["fechas"][0] >= "2025-01-01"
    assert r["vacios"] == ["mercadoDinero:2025-02", "rentaFija:2025-02"], r["vacios"]
    # Segunda corrida: no vuelve a pedir lo que ya tiene ni lo que sabe que no existe.
    pedidos.clear()
    otra = contexto.fondos(mercado, r, "2025-03-15")
    assert len(pedidos) == 2 and otra["series"] == r["series"], pedidos


@con_historia_desde("2025-01-01")
def cuotapartes_con_fallas():
    # Un corte de red no se anota como "no existe".
    red_contexto({"fci/mercadoDinero/2025/01/31": RuntimeError("timed out"), "fci/rentaFija/2025/01/31": RuntimeError("timed out")})
    r = contexto.fondos(mercado, None, "2025-02-15")
    assert r["vacios"] == [], r["vacios"]
    tope, contexto.MAX_PEDIDOS_HISTORIA = contexto.MAX_PEDIDOS_HISTORIA, 3
    try:
        pedidos = red_contexto()
        contexto.fondos(mercado, None, "2026-11-01")
        assert len(pedidos) == 5, "dos de hoy y tres de historia: " + str(len(pedidos))
    finally:
        contexto.MAX_PEDIDOS_HISTORIA = tope
    red_contexto({"fci/mercadoDinero/ultimo": RuntimeError("sin red")})
    s = mercado.seccion("fondos", r, lambda: contexto.fondos(mercado, r, "2025-02-15"))
    assert s["stale"] is True and s["series"] == r["series"]


def fred_semanal():
    red_contexto()
    r = contexto.fred(mercado, "VIXCLS")
    texto = grabada("fred_VIXCLS.csv").strip().splitlines()
    ultimo = texto[-1].split(",")
    assert r["ultimo"] == {"fecha": ultimo[0], "valor": float(ultimo[1])}, r["ultimo"]
    assert "2005-01-17" not in r["fechas"], "saltea los días sin dato"
    assert "2005-01-07" in r["fechas"] and "2005-01-06" not in r["fechas"], "un valor por semana: el último"
    red_contexto({"id=NFCI&cosd=2005-01-01": "observation_date,NFCI\n"})
    s = mercado.seccion("fred NFCI", {"ultimo": 1}, lambda: contexto.fred(mercado, "NFCI"))
    assert s["stale"] is True and s["ultimo"] == 1


def historia_larga():
    real = contexto.yahoo_mensual
    contexto.yahoo_mensual = mensual_falso
    try:
        r = contexto.largo_plazo(mercado, "2026-11-26")
        assert r["hasta"] == "2026-10" and "2026-11" not in r["fechas"], r["hasta"]
        assert list(r["series"]) == mercado.CFG["usd_tickers"] and len(r["series"]["SPY"]) == len(r["fechas"])
        assert contexto.mes_anterior("2026-01-05") == "2025-12" and contexto.mes_anterior("2026-11-26") == "2026-10"
        contexto.yahoo_mensual = lambda t, d: {"2026-01": 1.0}
        s = mercado.seccion("largo_plazo", r, lambda: contexto.largo_plazo(mercado, "2026-11-26"))
        assert s["stale"] is True and s["hasta"] == "2026-10"
    finally:
        contexto.yahoo_mensual = real


def kalshi_grabado():
    red_contexto()
    r = contexto.kalshi(mercado)
    c = {x["nombre"]: x for x in r["candidatos"]}
    assert c["Javier Milei"]["prob"] == 0.465 and c["Javier Milei"]["volumen"] == 35796, c["Javier Milei"]
    # con puntas juntas manda el medio; un último precio viejo y sin movimiento no
    assert c["Horacio Rodríguez Larreta"]["prob"] == 0.006, c["Horacio Rodríguez Larreta"]
    assert [x["prob"] for x in r["candidatos"]] == sorted((x["prob"] for x in r["candidatos"]), reverse=True)
    red_contexto({"series_ticker=KXARGENTINAPRES&with_nested_markets=true": '{"events":[]}'})
    s = mercado.seccion("kalshi", r, lambda: contexto.kalshi(mercado))
    assert s["stale"] is True and s["candidatos"] == r["candidatos"]


def polymarket_apagado_y_prendido():
    cfg = mercado.CFG["elecciones"]
    configurado = cfg["polymarket_activado"]
    try:
        cfg["polymarket_activado"] = False
        pedidos = red_contexto()
        apagado = contexto.elecciones(mercado, {})
        assert apagado["polymarket"] == {"nombre": "Polymarket", "desactivado": True}, apagado["polymarket"]
        assert not any("polymarket" in u for u in pedidos), "apagado no se consulta"
        assert apagado["fecha"] == "2027-10-24" and apagado["kalshi"]["candidatos"]
        cfg["polymarket_activado"] = True
        r = contexto.elecciones(mercado, {})["polymarket"]
        assert [c["nombre"] for c in r["candidatos"]] == ["Javier Milei", "Axel Kicillof", "Sergio Massa", "Dante Gebel"], r["candidatos"]
        assert r["candidatos"][0] == {"nombre": "Javier Milei", "prob": 0.58, "volumen": 200000}
        otro = json.loads(grabada("polymarket_formato_inventado.json"))
        otro[0]["endDate"] = "2023-10-22T00:00:00Z"
        red_contexto({"events?slug=argentina-presidential-election-winner": json.dumps(otro)})
        s = contexto.elecciones(mercado, {"polymarket": r})["polymarket"]
        assert s["stale"] is True and s["candidatos"] == r["candidatos"], "un evento de otra elección no se usa"
        # sin dato anterior, una falla queda marcada y sin candidatos: el tablero muestra "sin datos"
        red_contexto({"events?slug=argentina-presidential-election-winner": "[]"})
        nada = contexto.elecciones(mercado, {"polymarket": {"nombre": "Polymarket"}})["polymarket"]
        assert nada["stale"] is True and "candidatos" not in nada and "desactivado" not in nada, nada
    finally:
        cfg["polymarket_activado"] = configurado


def contexto_completo():
    import tempfile
    real_data, real_yahoo, real_hoy = mercado.DATA, contexto.yahoo_mensual, mercado.hoy_argentina
    with tempfile.TemporaryDirectory() as tmp:
        mercado.DATA, contexto.yahoo_mensual, mercado.hoy_argentina = pathlib.Path(tmp), mensual_falso, lambda: "2026-11-26"
        try:
            red_contexto()
            contexto.correr(mercado)
            a, c, l = (mercado.leer(n) for n in ("argentina.json", "clima.json", "largo_plazo.json"))
            assert all(not a[k]["stale"] for k in ("riesgo_pais", "plazo_fijo", "fondos")) and not a["elecciones"]["kalshi"]["stale"]
            assert sorted(c["series"]) == sorted(contexto.SERIES_FRED) and l["hasta"] == "2026-10"
            # Si después se cae todo, cada parte conserva lo suyo; lo diario y lo mensual ni se vuelven a pedir.
            def caida(url, **k):
                raise RuntimeError("sin red")
            mercado.bajar = caida
            contexto.correr(mercado)
            b, c2, l2 = (mercado.leer(n) for n in ("argentina.json", "clima.json", "largo_plazo.json"))
            assert b["riesgo_pais"]["stale"] and b["riesgo_pais"]["valores"] == a["riesgo_pais"]["valores"]
            assert b["fondos"]["stale"] and b["elecciones"]["kalshi"]["stale"] and b["elecciones"]["kalshi"]["candidatos"]
            assert c2 == c and l2 == l and b["plazo_fijo"] == a["plazo_fijo"]
        finally:
            mercado.DATA, contexto.yahoo_mensual, mercado.hoy_argentina = real_data, real_yahoo, real_hoy


def fuentes_lentas():
    # Muchos cortes seguidos al completar historia: se deja para otra corrida, sin anotar nada como inexistente.
    real = mercado.CFG["historico_desde"]
    mercado.CFG["historico_desde"] = "2025-01-01"
    try:
        pedidos = red_contexto()
        de_verdad = mercado.bajar

        def cortada(url, **k):
            if "/fci/" in url and not url.endswith("/ultimo"):
                pedidos.append(url)
                raise RuntimeError("timed out")
            return de_verdad(url, **k)
        mercado.bajar = cortada
        r = contexto.fondos(mercado, None, "2026-11-26")
        historia = [u for u in pedidos if "/fci/" in u and not u.endswith("/ultimo")]
        assert len(historia) == contexto.MAX_CORTES and r["vacios"] == [], len(historia)
    finally:
        mercado.CFG["historico_desde"] = real
    # Sin tiempo: no se pide nada más y cada parte conserva lo anterior.
    import tempfile
    real_data, real_presupuesto, real_yahoo = mercado.DATA, contexto.PRESUPUESTO_SEGUNDOS, contexto.yahoo_mensual
    with tempfile.TemporaryDirectory() as tmp:
        mercado.DATA, contexto.PRESUPUESTO_SEGUNDOS, contexto.yahoo_mensual = pathlib.Path(tmp), -1, mensual_falso
        try:
            pedidos = red_contexto()
            contexto.correr(mercado)
            a = mercado.leer("argentina.json")
            assert not pedidos and a["riesgo_pais"]["stale"] and "sin tiempo" in a["fondos"]["error"], (pedidos, a["fondos"])
        finally:
            mercado.DATA, contexto.PRESUPUESTO_SEGUNDOS, contexto.yahoo_mensual = real_data, real_presupuesto, real_yahoo
            contexto._limite = None


prueba("Contexto: fuentes lentas o cortadas no se comen la corrida", fuentes_lentas)
prueba("Riesgo país y tasa de plazo fijo: desde la fecha configurada; si falla conserva lo anterior", riesgo_pais_y_tasa)
prueba("Cuotapartes: acumula la de hoy, completa los meses viejos y no repite pedidos", cuotapartes)
prueba("Cuotapartes: tope de pedidos, cortes de red y fallas", cuotapartes_con_fallas)
prueba("FRED: un valor por semana, el último diario y sin días vacíos", fred_semanal)
prueba("Historia larga: mensual, sin el mes en curso", historia_larga)
prueba("Kalshi: probabilidad por candidato desde las puntas, con volumen", kalshi_grabado)
prueba("Polymarket: apagado no se consulta; prendido, saltea casilleros vacíos y otras elecciones", polymarket_apagado_y_prendido)
prueba("Contexto completo: escribe los tres archivos y cada parte falla por separado", contexto_completo)
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
for nombre, fn in pruebas_senales.PRUEBAS:
    prueba(nombre, fn)

for nombre, ok, det in res:
    print(("ok    " if ok else "FALLA ") + nombre + (f" — {det}" if det else ""))
print(f"\n{sum(ok for _, ok, _ in res)}/{len(res)} pruebas de mercado pasan")
sys.exit(0 if all(ok for _, ok, _ in res) else 1)
