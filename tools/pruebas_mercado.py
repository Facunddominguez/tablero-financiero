#!/usr/bin/env python3
"""Pruebas de tools/mercado.py que no usan la red (las fuentes se simulan). Uso: python tools/pruebas_mercado.py"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import mercado  # noqa: E402

res = []


def prueba(nombre, fn):
    try:
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


prueba("Histórico: los tickers extra que fallan o tienen huecos no frenan a los de referencia", historico_extras)
prueba("IPC de EE.UU.: lee el CSV de FRED, saltea meses sin dato y respeta la fecha de inicio", cpi_csv)
prueba("IPC de EE.UU.: una respuesta vacía cuenta como falla", cpi_vacio)
prueba("Si una fuente falla se conserva el dato anterior marcado como viejo", seccion_conserva)

for nombre, ok, det in res:
    print(("ok    " if ok else "FALLA ") + nombre + (f" — {det}" if det else ""))
print(f"\n{sum(ok for _, ok, _ in res)}/{len(res)} pruebas de mercado pasan")
sys.exit(0 if all(ok for _, ok, _ in res) else 1)
