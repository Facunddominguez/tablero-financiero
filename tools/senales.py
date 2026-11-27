#!/usr/bin/env python3
"""Lo que se sigue de cada empresa: mapa de la SEC, calendario, noticias, clasificación y compras de directivos.

La lista de qué seguir (data/seguimiento.json) la escribe la app al sincronizar: tickers, sin cantidades ni montos.
El Action nunca ve los datos cifrados. Cada fuente va por separado y, si falla, conserva el último dato y lo marca
`stale`. Si falta un secreto, esa parte se saltea con un aviso.

Lo llama mercado.main() (no en los pedidos de precios desde la app) y el resumen del sábado.
Uso: python tools/senales.py
"""
import datetime as dt
import os
import re
import sys

import calendario
import noticias
import sec

MAX_SEGUIDOS = 60  # tope de subyacentes que se siguen en una corrida


def leer_seguimiento(m):
    """Entradas válidas de data/seguimiento.json ([] si todavía no existe)."""
    filas = m.leer("seguimiento.json").get("tickers") or []
    valido = re.compile(r"^[A-Z0-9.]{1,12}$")
    out = []
    for f in filas:
        if not isinstance(f, dict) or not valido.match(str(f.get("t") or "")):
            continue
        usa = f.get("usa")
        out.append({"t": f["t"], "tipo": str(f.get("tipo") or ""), "usa": usa if usa and valido.match(str(usa)) else None,
                    "en": [x for x in f.get("en") or [] if x in ("cartera", "watchlist", "fantasma")]})
    return out


def subyacentes(lista):
    """Tickers de EE.UU. a seguir, sin repetir: primero lo que está en cartera, después la watchlist y los fantasmas."""
    orden = {"cartera": 0, "watchlist": 1, "fantasma": 2}
    filas = sorted((f for f in lista if f["usa"]), key=lambda f: (min([orden[x] for x in f["en"]] or [3]), f["usa"]))
    return list(dict.fromkeys(f["usa"] for f in filas))[:MAX_SEGUIDOS]


def sec_cik(m, tickers):
    """data/sec_cik.json: ticker → CIK de la SEC. Se vuelve a pedir una vez por semana o si aparece un ticker nuevo."""
    anterior = m.leer("sec_cik.json")
    cubiertos = set(anterior.get("mapa") or {}) | set(anterior.get("sin_cik") or [])
    if not tickers:
        return anterior
    if not sec.user_agent():
        print("sec: sin el secreto SEC_CONTACTO, se saltea el mapa de empresas")
        salida = dict(anterior, stale=True, aviso="Falta el secreto SEC_CONTACTO", intento=m.ahora())
    else:
        salida = m.seccion_diaria("sec_cik", anterior, lambda: sec.mapa_cik(m, tickers), dias=7,
                                  vigente=lambda a: set(tickers) <= cubiertos)
        salida.pop("aviso", None)
    m.escribir("sec_cik.json", salida)
    return salida


def parte(nombre, fn):
    """Cada parte va por separado: si una se rompe, las demás siguen."""
    try:
        return fn()
    except Exception as e:  # noqa: BLE001
        print(f"FALLA {nombre}: {type(e).__name__}: {str(e)[:160]}", file=sys.stderr)
        return None


def correr(m, origen=None):
    """Todo lo de seguimiento. m = módulo mercado (red, archivos y secciones)."""
    origen = origen if origen is not None else os.environ.get("ORIGEN", "")
    if origen == "app":  # el pedido de precios desde la app tiene que tardar poco
        print("señales: se saltean en un pedido de precios desde la app")
        return
    lista = leer_seguimiento(m)
    if not lista:
        print("señales: falta data/seguimiento.json (lo escribe la app al sincronizar)")
    tickers = subyacentes(lista)
    parte("sec_cik", lambda: sec_cik(m, tickers))
    if not tickers:  # sin lista no hay nada que buscar (y no se borra lo guardado)
        return
    parte("calendario", lambda: m.escribir("agenda.json", calendario.agenda(m, tickers, m.leer("agenda.json"))))
    parte("noticias", lambda: noticias.correr(m, tickers))


def main():
    import mercado
    sys.stdout.reconfigure(encoding="utf-8")
    mercado.DATA.mkdir(exist_ok=True)
    correr(mercado, origen=os.environ.get("ORIGEN") or "manual")
    print("señales:", dt.datetime.now(dt.timezone.utc).strftime("%H:%M UTC"))


if __name__ == "__main__":
    main()
