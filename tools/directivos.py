"""Radar de directivos: formularios 4 de la SEC de los últimos 30 días, con un puntaje para cada compra.

Se miran las empresas que seguís y las del radar general (OpenInsider). Solo operaciones de mercado: compras (P) y
ventas (S); las concesiones, ejercicios y retenciones de impuestos no cuentan. Las ventas se destacan si son de 3 o
más directivos.

El puntaje (0 a 100) pondera seis cosas con los pesos de data/supuestos.json ("radar_directivos", criterio propio):
oportunista o rutinaria (Cohen, Malloy y Pomorski, 2012: es rutinaria si ese directivo operó en el mismo mes tres
años seguidos), cargo, cuánto sube su tenencia, monto contra el tamaño de la empresa, caída del precio en los 6
meses previos y cantidad de directivos comprando. Lo que no se puede saber suma cero y queda anotado.

Escribe data/directivos.json. Sin SEC_CONTACTO se saltea con un aviso.
"""
import datetime as dt
import json
import re
import time
import xml.etree.ElementTree as ET

import sec

DIAS = 30
PRESUPUESTO_SEGUNDOS = 200
FORMULARIOS_POR_CORRIDA = 120  # documentos nuevos que se abren; lo que falta se completa en las próximas corridas
VENDEDORES_PARA_DESTACAR = 3
HISTORIA_POR_ANIO = 4          # formularios que se abren por año para confirmar si una compra es rutinaria
GUARDAR_DIAS = 45
_reloj = time.monotonic

PESOS = {
    "pesos": {"oportunista": 30, "cargo": 20, "tenencia": 15, "tamano": 15, "caida": 10, "cantidad": 10},
    "umbral": 60,
    "topes": {"tenencia": 0.5, "tamano": 0.001, "caida": 0.3, "cantidad": 4},
    "cargo": {"ceo_cfo": 1, "presidente": 0.7, "directivo": 0.5, "director": 0.4, "dueno": 0.3, "otro": 0.2},
    "rutina": {"oportunista": 1, "sin_historia": 0.5, "rutinaria": 0},
}


class SinTiempo(RuntimeError):
    pass


# ---------- formulario 4 ----------

def _texto(nodo, ruta):
    x = nodo.find(ruta)
    if x is None:
        return ""
    v = x.find("value")
    return ((v.text if v is not None else x.text) or "").strip()


def _numero(texto):
    try:
        return float(texto)
    except (TypeError, ValueError):
        return None


def _si(texto):
    return texto.lower() in ("1", "true")


def leer_formulario(xml):
    """Lo que importa de un formulario 4: empresa, quién y sus compras y ventas de mercado."""
    if "<ownershipDocument" not in xml:
        raise RuntimeError("no es un formulario 4")
    raiz = ET.fromstring(xml[xml.index("<ownershipDocument"):])
    duenos = []
    for d in raiz.findall("reportingOwner"):
        r = d.find("reportingOwnerRelationship")
        r = r if r is not None else ET.Element("x")
        duenos.append({"cik": int(_texto(d, "reportingOwnerId/rptOwnerCik") or 0), "nombre": _texto(d, "reportingOwnerId/rptOwnerName")[:60],
                       "director": _si(_texto(r, "isDirector")), "oficial": _si(_texto(r, "isOfficer")),
                       "dueno10": _si(_texto(r, "isTenPercentOwner")), "cargo": _texto(r, "officerTitle")[:60]})
    ops = []
    for t in raiz.findall("nonDerivativeTable/nonDerivativeTransaction"):
        codigo = _texto(t, "transactionCoding/transactionCode")
        acciones = _numero(_texto(t, "transactionAmounts/transactionShares"))
        fecha = _texto(t, "transactionDate")[:10]
        if codigo not in ("P", "S") or not acciones or acciones <= 0 or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", fecha):
            continue
        ops.append({"fecha": fecha, "codigo": codigo, "acciones": acciones,
                    "precio": _numero(_texto(t, "transactionAmounts/transactionPricePerShare")),
                    "despues": _numero(_texto(t, "postTransactionAmounts/sharesOwnedFollowingTransaction")),
                    "tenencia": (_texto(t, "ownershipNature/directOrIndirectOwnership") or "D") + "|" + _texto(t, "ownershipNature/natureOfOwnership")})
    return {"emisor": int(_texto(raiz, "issuer/issuerCik") or 0), "ticker": _texto(raiz, "issuer/issuerTradingSymbol").upper(),
            "duenos": duenos[:3], "plan": _si(_texto(raiz, "aff10b5One")), "ops": ops}


def rol(dueno):
    """(clave del peso, nombre del cargo) de quien opera."""
    cargo = (dueno.get("cargo") or "").lower()
    if dueno.get("oficial"):
        if re.search(r"\b(ceo|cfo|chief executive|chief financial|principal (executive|financial))", cargo):
            return "ceo_cfo", "CFO" if re.search(r"cfo|financial", cargo) else "CEO"
        if re.search(r"\b(president|coo|chief operating|chair)", cargo) and "vice president" not in cargo:
            return "presidente", dueno["cargo"]
        return "directivo", dueno.get("cargo") or "Directivo"
    if dueno.get("director"):
        if "chair" in cargo:
            return "presidente", "Presidente del directorio"
        return "director", "Director"
    return ("dueno", "Accionista de más del 10%") if dueno.get("dueno10") else ("otro", dueno.get("cargo") or "Otro")


def url_formulario(cik_emisor, acceso, documento):
    # el documento principal viene como "xslF345X06/archivo.xml": sin la carpeta de estilo es el XML original
    return sec.URL_ARCHIVO.format(cik=cik_emisor, acceso=acceso.replace("-", ""), doc=documento.split("/")[-1])


def presentaciones(datos, desde, hasta=None):
    """[(número, fecha, documento)] de los formularios 4 de una respuesta de submissions, entre dos fechas."""
    r = ((datos.get("filings") or {}).get("recent")) or {}
    if not isinstance(r.get("form"), list):
        raise RuntimeError("sec: respuesta inesperada")
    out = []
    for forma, acceso, fecha, doc in zip(r["form"], r["accessionNumber"], r["filingDate"], r["primaryDocument"]):
        if forma in ("4", "4/A") and fecha >= desde and (hasta is None or fecha <= hasta) and doc.endswith(".xml"):
            out.append((acceso, fecha, doc))
    return out


# ---------- agregación ----------

def aumento(ops):
    """Cuánto subió la tenencia con las compras: compradas ÷ lo que tenía antes (1 = la duplicó o es nueva)."""
    finales, compradas, vendidas = {}, 0, 0
    for o in sorted(ops, key=lambda o: o["fecha"]):
        if o.get("despues") is not None:
            finales[o["tenencia"]] = o["despues"]
        if o["codigo"] == "P":
            compradas += o["acciones"]
        else:
            vendidas += o["acciones"]
    if not finales or not compradas:
        return None
    antes = sum(finales.values()) - compradas + vendidas
    return 1.0 if antes <= 0 else round(compradas / antes, 4)


def agregar(formularios, ticker, desde):
    """(compras por directivo, ventas por directivo) de un ticker desde los formularios ya leídos."""
    por = {}
    for acceso, f in formularios.items():
        if not f or f.get("t") != ticker or not f.get("duenos"):
            continue
        ops = [o for o in f["ops"] if o["fecha"] >= desde]
        if not ops:
            continue
        dueno = f["duenos"][0]
        x = por.setdefault(dueno["cik"], {"dueno": dueno, "ops": [], "plan": False, "presentado": "", "url": f["url"], "emisor": f["emisor"], "vistas": set()})
        for o in ops:  # una corrección repite la operación: se cuenta una vez
            clave = (o["fecha"], o["codigo"], o["acciones"], o.get("precio"), o["tenencia"])
            if clave not in x["vistas"]:
                x["vistas"].add(clave)
                x["ops"].append(o)
        x["plan"] = x["plan"] or f.get("plan", False)
        if f["presentado"] >= x["presentado"]:
            x["presentado"], x["url"] = f["presentado"], f["url"]
    compras, ventas = [], []
    for cik, x in por.items():
        for codigo, destino in (("P", compras), ("S", ventas)):
            ops = [o for o in x["ops"] if o["codigo"] == codigo]
            if not ops:
                continue
            acciones = sum(o["acciones"] for o in ops)
            con_precio = [o for o in ops if o.get("precio")]
            monto = sum(o["acciones"] * o["precio"] for o in con_precio)
            clave, nombre = rol(x["dueno"])
            destino.append({
                "id": f"{ticker}:{cik}", "t": ticker, "dueno_cik": cik, "dueno": x["dueno"]["nombre"], "rol": clave, "cargo": nombre,
                "acciones": round(acciones, 2), "monto": round(monto) if con_precio else None,
                "precio": round(monto / sum(o["acciones"] for o in con_precio), 4) if con_precio else None,
                "desde": min(o["fecha"] for o in ops), "fecha": max(o["fecha"] for o in ops), "presentado": x["presentado"],
                "aumento": aumento(x["ops"]) if codigo == "P" else None, "plan": x["plan"], "url": x["url"], "emisor": x["emisor"],
            })
    return compras, ventas


# ---------- rutina u oportunidad ----------

def clasificar_rutina(compra, envios_dueno, leer):
    """"rutinaria" si operó en ese mismo mes los tres años anteriores; "oportunista" si operó esos años pero no
    siempre en ese mes; "sin_historia" si no tiene tres años de presentaciones. leer(acceso, doc) → formulario."""
    anio, mes = int(compra["fecha"][:4]), int(compra["fecha"][5:7])
    todas = presentaciones(envios_dueno, f"{anio - 3}-01-01", f"{anio}-01-07")
    ventanas = []
    for k in (1, 2, 3):
        y = anio - k
        if not any(f[:4] == str(y) for _, f, _ in todas):
            return "sin_historia"
        # lo operado en el mes se presenta ese mes o los primeros días del siguiente
        siguiente = f"{y + 1}-01-07" if mes == 12 else f"{y}-{mes + 1:02d}-07"
        ventanas.append((f"{y}-{mes:02d}", [p for p in todas if f"{y}-{mes:02d}-01" <= p[1] <= siguiente]))
    if any(not lista for _, lista in ventanas):
        return "oportunista"
    for periodo, lista in ventanas:
        opero = False
        for acceso, _, doc in lista[:HISTORIA_POR_ANIO]:
            f = leer(acceso, doc)
            if f and f["emisor"] == compra["emisor"] and any(o["fecha"].startswith(periodo) for o in f["ops"]):
                opero = True
                break
        if not opero:
            return "oportunista"
    return "rutinaria"


# ---------- puntaje ----------

def pesos(m):
    propios = (m.leer("supuestos.json").get("radar_directivos")) or {}
    return {k: (dict(v, **(propios.get(k) or {})) if isinstance(v, dict) else propios.get(k, v)) for k, v in PESOS.items()}


def puntaje(compra, compradores, empresa, p):
    """(puntaje de 0 a 100, partes de 0 a 1, lo que no se pudo saber)."""
    topes = p["topes"]
    a, cap, monto, caida = compra.get("aumento"), (empresa or {}).get("capitalizacion"), compra.get("monto"), (empresa or {}).get("cambio_6m")
    partes = {
        "oportunista": p["rutina"].get(compra.get("rutina") or "sin_historia", 0),
        "cargo": p["cargo"].get(compra.get("rol"), 0),
        "tenencia": None if a is None else min(1, a / topes["tenencia"]),
        "tamano": None if not cap or monto is None else min(1, monto / cap / topes["tamano"]),
        "caida": None if caida is None else min(1, max(0, -caida) / topes["caida"]),
        "cantidad": min(1, max(0, compradores - 1) / max(1, topes["cantidad"] - 1)),
    }
    total = sum(p["pesos"].values())
    suma = sum(p["pesos"].get(k, 0) * (v or 0) for k, v in partes.items())
    return round(100 * suma / total) if total else 0, {k: None if v is None else round(v, 3) for k, v in partes.items()}, [k for k, v in partes.items() if v is None]


# ---------- tamaño y precio ----------

def yf_empresa(t, hasta):
    """{'capitalizacion', 'cambio_6m'} con yfinance: cambio del precio en los 6 meses previos a `hasta`."""
    import yfinance as yf  # se importa acá para que el resto funcione aunque no esté instalado
    tk = yf.Ticker(t.replace(".", "-"))
    try:
        capitalizacion = float(tk.fast_info["marketCap"]) or None
    except Exception:  # noqa: BLE001
        capitalizacion = None
    h = tk.history(period="1y", interval="1d", auto_adjust=True)
    cierres = [(f.strftime("%Y-%m-%d"), float(c)) for f, c in zip(h.index, h["Close"]) if c == c]
    return {"capitalizacion": capitalizacion, "cambio_6m": cambio_previo(cierres, hasta)}


def cambio_previo(cierres, hasta, dias=182):
    """Cambio del precio desde unos 6 meses antes de `hasta` (último cierre anterior a cada fecha)."""
    desde = (dt.date.fromisoformat(hasta) - dt.timedelta(days=dias)).isoformat()
    antes = [v for f, v in cierres if f <= desde]
    despues = [v for f, v in cierres if f <= hasta]
    return round(despues[-1] / antes[-1] - 1, 4) if antes and despues and antes[-1] > 0 else None


# ---------- corrida ----------

def accionables(m):
    """Subyacentes con CEDEAR, para marcar qué se puede comprar desde acá."""
    ratios = m.archivo_ratios().get("ratios") or {}
    return {x for x in (m.ticker_usa(t, i) for t, i in ratios.items()) if x}


def correr(m, lista):
    """lista = data/seguimiento.json ya validado. Deja data/directivos.json."""
    anterior = m.leer("directivos.json")
    if not sec.user_agent():
        print("directivos: sin el secreto SEC_CONTACTO, se saltea")
        m.escribir("directivos.json", dict(anterior, stale=True, aviso="Falta el secreto SEC_CONTACTO", intento=m.ahora()))
        return None
    hoy = m.hoy_argentina()
    desde = (dt.date.fromisoformat(hoy) - dt.timedelta(days=DIAS)).isoformat()
    limite = _reloj() + PRESUPUESTO_SEGUNDOS
    p = pesos(m)
    cik = m.leer("sec_cik.json").get("mapa") or {}
    radar = [f.get("ticker") for f in m.leer("insiders.json").get("filas") or [] if f.get("ticker")]
    seguidos = {f["usa"]: f for f in sorted(lista, key=lambda f: "cartera" in f["en"]) if f.get("usa")}
    tickers = list(dict.fromkeys(list(seguidos) + radar))
    formularios = {k: v for k, v in (anterior.get("formularios") or {}).items()
                   if v and v.get("presentado", "") >= (dt.date.fromisoformat(hoy) - dt.timedelta(days=GUARDAR_DIAS)).isoformat()}
    rutinas = dict(anterior.get("rutinas") or {})
    empresas = dict(anterior.get("empresas") or {})
    abiertos, pedidos, fallas, pendientes = [0], 0, 0, 0

    def abrir(cik_emisor, acceso, doc):
        if _reloj() > limite or abiertos[0] >= FORMULARIOS_POR_CORRIDA:
            raise SinTiempo()
        abiertos[0] += 1
        return leer_formulario(sec.pedir(m, url_formulario(cik_emisor, acceso, doc), intentos=1))

    for t in tickers:
        r = cik.get(t)
        if not r or _reloj() > limite:
            pendientes += 1 if r else 0
            continue
        pedidos += 1
        try:
            lista4 = presentaciones(sec.envios(m, r["cik"]), desde)
        except Exception as e:  # noqa: BLE001
            fallas += 1
            print(f"FALLA directivos {t}: {type(e).__name__}")
            continue
        for acceso, fecha, doc in lista4:
            if acceso in formularios:
                continue
            try:
                f = abrir(r["cik"], acceso, doc)
            except SinTiempo:
                pendientes += 1
                continue
            except Exception as e:  # noqa: BLE001
                print(f"FALLA formulario {t}: {type(e).__name__}")
                continue
            formularios[acceso] = {"t": t, "presentado": fecha, "url": sec.URL_ARCHIVO.format(cik=r["cik"], acceso=acceso.replace("-", ""), doc=doc),
                                   "emisor": r["cik"], "duenos": f["duenos"], "plan": f["plan"], "ops": f["ops"]}

    compras, ventas = [], []
    cedears = accionables(m)
    for t in tickers:
        c, v = agregar(formularios, t, desde)
        nombre = (cik.get(t) or {}).get("nombre") or t
        en = (seguidos.get(t) or {}).get("en") or []
        if c:
            ultima = max(x["fecha"] for x in c)
            previa = empresas.get(t)
            if not previa or previa.get("consultado") != hoy or previa.get("hasta") != ultima:
                try:
                    if _reloj() > limite:
                        raise SinTiempo()
                    empresas[t] = dict(yf_empresa(t, ultima), consultado=hoy, hasta=ultima)
                except Exception as e:  # noqa: BLE001
                    print(f"FALLA tamaño y precio {t}: {type(e).__name__}")
        for x in c:
            clave = f"{x['dueno_cik']}:{x['emisor']}:{x['fecha'][:7]}"
            if clave not in rutinas:
                try:
                    def leer(acceso, doc, dueno=x["dueno_cik"]):  # los archivos se sirven también bajo el CIK del directivo
                        return abrir(dueno, acceso, doc)
                    if _reloj() > limite:
                        raise SinTiempo()
                    rutinas[clave] = clasificar_rutina(x, sec.envios(m, x["dueno_cik"]), leer)
                except SinTiempo:
                    pendientes += 1
                except Exception as e:  # noqa: BLE001
                    print(f"FALLA historia de un directivo de {t}: {type(e).__name__}")
            x["rutina"] = rutinas.get(clave)  # None: todavía no se pudo mirar (puntúa como sin historia)
            x["puntaje"], x["partes"], x["faltan"] = puntaje(x, len(c), empresas.get(t), p)
            x.update(empresa=nombre[:80], compradores=len(c), en=en, cartera="cartera" in en, cedear=t in cedears)
            x["accionable"] = x["cedear"] or x["cartera"]
            compras.append({k: val for k, val in x.items() if k != "emisor"})
        if v:
            montos = [x["monto"] for x in v if x["monto"] is not None]
            ventas.append({"t": t, "empresa": nombre[:80], "vendedores": len(v), "monto": round(sum(montos)) if montos else None,
                           "desde": min(x["desde"] for x in v), "hasta": max(x["fecha"] for x in v), "en": en,
                           "destacar": len(v) >= VENDEDORES_PARA_DESTACAR, "url": v[0]["url"],
                           "quienes": sorted(({"dueno": x["dueno"], "cargo": x["cargo"], "monto": x["monto"], "plan": x["plan"]} for x in v),
                                             key=lambda q: -(q["monto"] or 0))[:6]})
    todo_mal = pedidos == 0 or fallas == pedidos
    vigentes = {f"{x['dueno_cik']}:" for x in compras}
    salida = {
        "generado": m.ahora(), "stale": todo_mal, "actualizado": anterior.get("actualizado") if todo_mal else m.ahora(),
        "umbral": p["umbral"], "dias": DIAS, "pendientes": pendientes,
        "compras": sorted(compras, key=lambda x: (-x["puntaje"], x["t"])) if not todo_mal else anterior.get("compras") or [],
        "ventas": sorted(ventas, key=lambda x: (not x["destacar"], -(x["monto"] or 0))) if not todo_mal else anterior.get("ventas") or [],
        "empresas": {t: v for t, v in empresas.items() if t in tickers},
        "rutinas": {k: v for k, v in rutinas.items() if todo_mal or any(k.startswith(pre) for pre in vigentes)},
        "formularios": formularios,
    }
    m.escribir("directivos.json", salida)
    print(f"{'FALLA' if todo_mal else 'ok  '} directivos: {len(salida['compras'])} compras, {len(salida['ventas'])} empresas con ventas, "
          f"{abiertos[0]} formularios abiertos, {pendientes} pendientes")
    return salida
