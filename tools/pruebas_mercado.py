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
        "observation_date,CPIAUCSL\n2024-09-01,314.851\n2024-10-01,315.564\n2024-11-01,316.449\n2024-12-01,317.603\n"
        "2025-01-01,319.086\n2025-02-01,319.775\n2025-03-01,.\n2025-04-01,320.580\n"
    )
    r = mercado.cpi_usa()
    assert "2024-09" not in r["meses"], "trae meses anteriores a historico_desde"
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


prueba("IPC de EE.UU.: lee el CSV de FRED, saltea meses sin dato y respeta la fecha de inicio", cpi_csv)
prueba("IPC de EE.UU.: una respuesta vacía cuenta como falla", cpi_vacio)
prueba("Si una fuente falla se conserva el dato anterior marcado como viejo", seccion_conserva)

for nombre, ok, det in res:
    print(("ok    " if ok else "FALLA ") + nombre + (f" — {det}" if det else ""))
print(f"\n{sum(ok for _, ok, _ in res)}/{len(res)} pruebas de mercado pasan")
sys.exit(0 if all(ok for _, ok, _ in res) else 1)
