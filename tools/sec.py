"""Acceso a la SEC (EDGAR). Solo lectura de datos públicos.

La SEC pide que cada cliente se identifique en el User-Agent con un nombre y un mail: sale del secreto SEC_CONTACTO
(nunca se imprime ni se guarda). Sin ese secreto, todo lo de la SEC se saltea con un aviso. Se respeta su límite de
10 pedidos por segundo dejando 0,15 s entre pedido y pedido.
"""
import json
import os
import re
import time
import unicodedata

URL_TICKERS = "https://www.sec.gov/files/company_tickers.json"
URL_ENVIOS = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
URL_ARCHIVO = "https://www.sec.gov/Archives/edgar/data/{cik}/{acceso}/{doc}"
INTERVALO = 0.15  # segundos entre pedidos: menos de 10 por segundo
_ultimo = [0.0]
_reloj = time.monotonic
_dormir = time.sleep


class SinContacto(RuntimeError):
    """Falta el secreto SEC_CONTACTO."""


def user_agent():
    """Identificación que pide la SEC, en ASCII (los encabezados HTTP no llevan acentos). None sin secreto."""
    crudo = (os.environ.get("SEC_CONTACTO") or "").strip()
    if not crudo:
        return None
    limpio = unicodedata.normalize("NFKD", crudo).encode("ascii", "ignore").decode()
    return re.sub(r"[\r\n]+", " ", limpio).strip() or None


def pedir(m, url, intentos=2, timeout=20):
    """Un pedido a la SEC, identificado y sin pasar el límite de pedidos por segundo."""
    ua = user_agent()
    if not ua:
        raise SinContacto("Falta el secreto SEC_CONTACTO")
    espera = INTERVALO - (_reloj() - _ultimo[0])
    if espera > 0:
        _dormir(espera)
    _ultimo[0] = _reloj()
    return m.bajar(url, intentos=intentos, timeout=timeout, cabeceras={"User-Agent": ua, "Accept-Encoding": "identity"})


def clave_ticker(t):
    """La SEC escribe las clases con guion (BRK-B); BYMA y los CEDEARs, con punto."""
    return t.upper().replace(".", "-")


def mapa_cik(m, tickers):
    """{'mapa': {ticker: {cik, nombre}}, 'sin_cik': [...]} para lo que se pide (los ADR figuran igual que el resto)."""
    d = json.loads(pedir(m, URL_TICKERS))
    todos = {}
    for v in d.values():
        if isinstance(v, dict) and v.get("ticker") and v.get("cik_str"):
            todos.setdefault(v["ticker"].upper(), {"cik": int(v["cik_str"]), "nombre": v.get("title") or v["ticker"]})
    if len(todos) < 3:
        raise RuntimeError("sec: la lista de empresas vino vacía")
    mapa, sin = {}, []
    for t in sorted(set(tickers)):
        r = todos.get(clave_ticker(t))
        if r:
            mapa[t] = r
        else:
            sin.append(t)
    return {"mapa": mapa, "sin_cik": sin}


def nombre_corto(nombre):
    """"NVIDIA CORP" → "NVIDIA": el nombre sin la forma jurídica, para buscar noticias."""
    n = re.sub(r"\s*[/\\][A-Z]{2,3}[/\\]?\s*$", "", (nombre or "").strip())  # "/DE/", "/ADR/"
    previo = None
    while n and n != previo:
        previo = n
        n = re.sub(r"[\s,.]+(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|sa|s\.a|s\.a\.b|de c\.v|nv|n\.v|ag|se|holdings?|group|adr|ads|trust|lp|l\.p|llc)\.?$",
                   "", n, flags=re.I).strip(" ,.&")
    return n or (nombre or "").strip()
