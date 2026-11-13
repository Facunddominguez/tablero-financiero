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
import sys
import time
import urllib.request

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DATA = RAIZ / "data"
CFG = json.loads((RAIZ / "tools" / "mercado_config.json").read_text(encoding="utf-8"))
UA = "tablero-mercado/1.0 (script personal de seguimiento; python-urllib)"


def ahora():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def bajar(url, intentos=3, espera=4, timeout=30):
    ultimo = None
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", errors="replace")
        except Exception as e:  # noqa: BLE001
            ultimo = e
            time.sleep(espera * (i + 1))
    raise RuntimeError(f"{url[:60]}…: {ultimo}")


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


def data912(ruta, divisor=1):
    filas = json.loads(bajar(f"https://data912.com/live/{ruta}"))
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


def mep_mensual():
    """Promedio mensual del dólar MEP (punto medio compra/venta) de los últimos 36 meses."""
    filas = json.loads(bajar("https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa"))
    meses = {}
    for f in filas:
        if f.get("compra") and f.get("venta") and f.get("fecha"):
            meses.setdefault(f["fecha"][:7], []).append((f["compra"] + f["venta"]) / 2)
    if len(meses) < 3:
        raise RuntimeError("mep_mensual: sin historia")
    return {"meses": {m: round(sum(v) / len(v), 2) for m, v in sorted(meses.items())[-36:]}}


def yahoo(ticker, desde):
    """Cierres diarios (cierre, cierre ajustado) con yfinance."""
    import yfinance as yf  # se importa acá para que el resto funcione aunque no esté instalado
    h = yf.Ticker(ticker).history(start=desde, interval="1d", auto_adjust=False)
    out = {}
    for fecha, fila in h.iterrows():
        c, a = fila.get("Close"), fila.get("Adj Close")
        if c is None or a is None or c != c or a != a:  # NaN
            continue
        out[fecha.strftime("%Y-%m-%d")] = (round(float(c), 4), round(float(a), 4))
    if len(out) < 5:
        raise RuntimeError(f"{ticker}: sin historia")
    return out


def usd_e_historico(hist_anterior):
    """Cierres en USD de los ETF de referencia. Devuelve (sección usd de market, historico)."""
    series = {t: yahoo(t, CFG["historico_desde"]) for t in CFG["usd_tickers"]}
    usd = {}
    for t, s in series.items():
        fechas = sorted(s)
        usd[t] = {"c": s[fechas[-1]][0], "prev": s[fechas[-2]][0], "fecha": fechas[-1]}
    # histórico acumulado: se parte de lo guardado y se pisa con lo nuevo (cierre ajustado)
    viejo_f = hist_anterior.get("fechas") or []
    viejo_s = hist_anterior.get("series") or {}
    acum = {t: dict(zip(viejo_f, viejo_s.get(t) or [])) for t in CFG["usd_tickers"]}
    for t, s in series.items():
        for f, (_, aj) in s.items():
            acum[t][f] = aj
    fechas = sorted(set.intersection(*[set(v) for v in acum.values()]))
    hist = {"fechas": fechas, "series": {t: [acum[t][f] for f in fechas] for t in CFG["usd_tickers"]},
            "nota": "Cierres diarios ajustados por dividendos, en USD (yfinance)."}
    return {"precios": usd}, hist


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

    hist = h_prev
    try:
        usd, hist = usd_e_historico(h_prev)
        usd.update(stale=False, actualizado=ahora())
        hist.update(stale=False, actualizado=ahora())
        print("ok   usd + historico")
    except Exception as e:  # noqa: BLE001
        print(f"FALLA usd: {e}", file=sys.stderr)
        usd = dict(m_prev.get("usd") or {}, stale=True, intento=ahora(), error=str(e)[:160])
        hist = dict(h_prev, stale=True, intento=ahora())
    mercado["usd"] = usd

    escribir("market.json", mercado)
    escribir("historico.json", hist)
    escribir("insiders.json", seccion("insiders", i_prev, insiders))

    try:  # alertas de precio al teléfono (no detienen el resto si fallan)
        import alertas
        alertas.correr(mercado)
    except Exception as e:  # noqa: BLE001
        print(f"FALLA alertas: {type(e).__name__}", file=sys.stderr)


if __name__ == "__main__":
    main()
