"""Alertas de precio: evalúa los umbrales y avisa al teléfono (ntfy). Solo biblioteca estándar.

La lista de activos y sus niveles NO está en el repositorio: llega por el secreto ALERTAS_CONFIG (lo arma
tools/alertas_config.py a partir de los datos descifrados). El estado que se guarda en data/alertas_estado.json
no tiene tickers ni precios: solo huellas con sal y contadores, para no repetir avisos.
Los registros del Action tampoco muestran qué se avisó: solo cuántos avisos salieron.

El umbral del movimiento del día es un múltiplo de lo que cada activo suele moverse (volatilidad reciente, con
más peso en los últimos días), calculada con datos públicos (data/historico.json), y nunca pasa de 1,5 veces el
umbral fijo de la configuración (después de un salto grande la volatilidad queda alta). Sin historia de un activo,
se usan los umbrales fijos. Los escalones acumulados y el tope duro son los de la configuración.
"""
import datetime as dt
import hashlib
import json
import math
import os
import pathlib
import urllib.request

RAIZ = pathlib.Path(__file__).resolve().parent.parent
ESTADO = RAIZ / "data" / "alertas_estado.json"
SEMANA = RAIZ / "data" / "alertas_semana.json"
DIAS_GUARDADOS = 14

# Los mismos valores que usa la app (js/motor.js, VOLATILIDAD).
PARAMETROS = {"lambda": 0.94, "aviso": 2.5, "critico": 4.0, "grupo": {"nucleo": 1.25}, "min_datos": 40, "tope": 1.5}
# Acciones locales que se miden con la serie de su ADR.
ADR_DE_LOCAL = {"PAMP": "PAM", "YPFD": "YPF", "TGSU2": "TGS", "TECO2": "TEO", "CRES": "CRESY", "IRSA": "IRS",
                "GGAL": "GGAL", "BMA": "BMA", "BBAR": "BBAR", "SUPV": "SUPV", "CEPU": "CEPU", "EDN": "EDN", "LOMA": "LOMA"}


def _pct(x, dec=1):
    return f"{'+' if x > 0 else '−'}{abs(x) * 100:.{dec}f}%".replace(".", ",")


def _num(x, dec=1):
    return f"{x:.{dec}f}".replace(".", ",")


def _dias(a, b):
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days if a and b else 9999


# ---------- volatilidad ----------

def volatilidad(historico, serie, hasta, lam=PARAMETROS["lambda"], minimo=PARAMETROS["min_datos"]):
    """Volatilidad diaria reciente (promedio móvil exponencial, λ) con los datos anteriores a `hasta`. None si faltan."""
    valores = (historico or {}).get("series", {}).get(serie)
    if not valores:
        return None
    precios = [v for f, v in zip(historico["fechas"], valores) if f < hasta and v and v > 0]
    rend = [b / a - 1 for a, b in zip(precios, precios[1:])]
    if len(rend) < minimo:
        return None
    var = sum(r * r for r in rend[:20]) / len(rend[:20])
    for r in rend[20:]:
        var = lam * var + (1 - lam) * r * r
    return math.sqrt(var)


def serie_de(activo, ratios=None):
    """Serie del histórico con la que se mide un activo de la configuración (None: sin serie, como las ON)."""
    if activo["tabla"] == "cedears":
        return ((ratios or {}).get(activo["t"]) or {}).get("usa", activo["t"])  # el subyacente puede llamarse distinto
    if activo["tabla"] == "acciones":
        return ADR_DE_LOCAL.get(activo["t"])
    return None


def umbral(historico, serie, grupo, hoy, nivel="critico", parametros=None):
    """Umbral del movimiento del día: múltiplo de la volatilidad del activo (con el multiplicador de su grupo)."""
    p = {**PARAMETROS, **(parametros or {})}
    if not serie or serie in ("MEP", "CCL") and grupo != "mep":
        return None
    v = volatilidad(historico, serie, hoy, p["lambda"], p["min_datos"])
    return None if v is None else p[nivel] * p.get("grupo", {}).get(grupo, 1.0) * v


def umbral_del_dia(historico, serie, grupo, hoy, fijo, parametros=None):
    """El umbral que se usa: el de la volatilidad con un máximo de `tope` veces el fijo; sin volatilidad, el fijo.

    Devuelve (umbral, clase): "volatilidad", "tope" (quedó en el máximo) o "fijo".
    """
    propio = umbral(historico, serie, grupo, hoy, parametros=parametros)
    if propio is None:
        return fijo, "fijo"
    veces = {**PARAMETROS, **(parametros or {})}["tope"]
    if veces and fijo and propio > veces * fijo:
        return veces * fijo, "tope"
    return propio, "volatilidad"


# ---------- por qué se movió un CEDEAR ----------

def _verano_eeuu(f):
    """¿Rige el horario de verano de EE.UU.? Del segundo domingo de marzo al primer domingo de noviembre."""
    def domingo(anio, mes, n):
        primero = dt.date(anio, mes, 1)
        return primero + dt.timedelta(days=(6 - primero.weekday()) % 7 + 7 * (n - 1))
    return domingo(f.year, 3, 2) <= f < domingo(f.year, 11, 1)


def wall_street(generado, feriados=None):
    """¿Hubo rueda en EE.UU. hasta el momento de los datos? Devuelve None si sí, o el motivo si no."""
    if not generado:
        return None
    t = dt.datetime.fromisoformat(generado.replace("Z", "+00:00"))
    ny = t - dt.timedelta(hours=4 if _verano_eeuu(t.date()) else 5)
    if ny.weekday() >= 5 or ny.date().isoformat() in (feriados or {}).get("feriados", {}):
        return "Wall Street no operó"
    if (ny.hour, ny.minute) < (9, 30):
        return "Wall Street todavía no abrió"
    return None


def _usa_hoy(mercado, ticker):
    usa = (mercado.get("implicito") or {}).get("usa") or {}
    return None if usa.get("stale") else (usa.get("precios") or {}).get(ticker)


def explicar_dia(mercado, ticker, dia_usd, feriados=None):
    """Cuánto del movimiento (en dólares MEP) fue el subyacente en EE.UU. y cuánto el dólar implícito."""
    fila = _usa_hoy(mercado, ticker)
    if not fila:
        return ""
    cerrado = wall_street(mercado.get("generado"), feriados)
    hoy = (mercado.get("generado") or "")[:10]
    if not cerrado and len(fila) > 2 and fila[2] != hoy:
        cerrado = "Wall Street no operó"
    if cerrado:
        return f"{cerrado}: todo el movimiento vino del dólar implícito contra el MEP."
    afuera = (fila[1] or 0) / 100
    return f"En EE.UU. {ticker} se movió {_pct(afuera)} y el dólar implícito contra el MEP puso {_pct((1 + dia_usd) / (1 + afuera) - 1)}."


def explicar_acumulado(mercado, historico, ticker, desde, total):
    """Lo mismo desde la fecha de referencia (dd/mm/aaaa), con el cierre de ese día en el histórico."""
    fila = _usa_hoy(mercado, ticker)
    serie = (historico or {}).get("series", {}).get(ticker)
    try:
        f = dt.datetime.strptime(desde, "%d/%m/%Y").date().isoformat()
    except (TypeError, ValueError):
        return ""
    if not fila or not serie:
        return ""
    antes = [v for d, v in zip(historico["fechas"], serie) if d <= f and v]
    if not antes:
        return ""
    afuera = fila[0] / antes[-1] - 1
    return f"En EE.UU. {ticker} se movió {_pct(afuera)} y el dólar implícito contra el MEP puso {_pct((1 + total) / (1 + afuera) - 1)}."


# ---------- evaluación ----------

def evaluar(cfg, mercado, estado, hoy, historico=None, feriados=None, parametros=None, ratios=None):
    """Devuelve (alertas, estado nuevo). Cada alerta: {titulo, cuerpo, prioridad}. Función pura."""
    estado = json.loads(json.dumps(estado or {}))
    e = estado.setdefault("e", {})
    fx = mercado.get("fx") or {}
    mep, mep_prev = fx.get("mep"), fx.get("mep_prev")
    if not mep:
        return [], estado
    cambio_mep = mep / mep_prev - 1 if mep_prev else 0.0
    alertas = []
    clave = lambda t: hashlib.sha256((cfg["sal"] + "|" + t).encode()).hexdigest()[:16]

    # Dólar MEP
    s = e.setdefault(clave("MEP"), {})
    u, _ = umbral_del_dia(historico, "MEP", "mep", hoy, cfg["dia"].get("mep"), parametros)
    if u and mep_prev and abs(cambio_mep) >= u and s.get("d") != hoy:
        s["d"] = hoy
        alertas.append({"tipo": "mep", "ticker": "MEP", "cambio": cambio_mep, "titulo": f"Dólar MEP {_pct(cambio_mep)} hoy",
                        "cuerpo": f"Salto fuerte del tipo de cambio (tu umbral hoy es ±{_num(u * 100)}%). Lo que tenés en pesos vale distinto en dólares; tus reglas no piden hacer nada por esto.",
                        "prioridad": 4})

    for a in cfg["activos"]:
        fila = ((mercado.get(a["tabla"]) or {}).get("precios") or {}).get(a["t"])
        if not fila or (mercado.get(a["tabla"]) or {}).get("stale"):
            continue
        precio_usd = fila[0] / mep
        s = e.setdefault(clave(a["t"]), {})
        sufijo = "El próximo aporte va al núcleo como siempre." if a["g"] == "nucleo" else "Tus reglas no operan por un movimiento de precio: cualquier cambio espera 48 horas."
        es_cedear = a["tabla"] == "cedears"
        serie = serie_de(a, ratios)

        # 1 · Movimiento del día, en dólares (precio en pesos corregido por el movimiento del MEP)
        u, clase = umbral_del_dia(historico, serie, a["g"], hoy, cfg["dia"].get(a["g"]), parametros)
        dia_usd = (1 + (fila[1] or 0) / 100) / (1 + cambio_mep) - 1
        if u and abs(dia_usd) >= u and s.get("d") != hoy and s.get("p") != fila[1]:
            s["d"], s["p"] = hoy, fila[1]
            vara = {"volatilidad": f"Es mucho para lo que suele moverse (tu umbral hoy es ±{_num(u * 100)}%).",
                    "tope": f"Pasa el máximo de tu umbral (±{_num(u * 100)}%).",
                    "fijo": f"Movimiento fuerte en dólares (tu umbral es ±{_num(u * 100)}%)."}[clase]
            porque = explicar_dia(mercado, serie, dia_usd, feriados) if es_cedear and serie else ""
            alertas.append({"tipo": "dia", "ticker": a["t"], "cambio": dia_usd, "titulo": f"{a['t']} {_pct(dia_usd)} hoy", "cuerpo": " ".join(x for x in (vara, porque, sufijo) if x), "prioridad": 4})

        # 2 · Acumulado desde el precio de referencia, por escalones
        u = cfg["nivel"].get(a["g"])
        if u and a.get("ref"):
            banda = math.trunc(math.log(precio_usd / a["ref"]) / math.log(1 + u))
            previa = s.get("k", 0)
            mas_lejos = abs(banda) > abs(previa) and (banda * previa >= 0)
            cruce = banda * previa < 0
            if (mas_lejos or cruce) and _dias(s.get("n"), hoy) >= 3:
                s["n"] = hoy
                total = precio_usd / a["ref"] - 1
                base = f"Desde el {cfg.get('fecha', 'precio de referencia')}, en dólares (escalones de {u * 100:.0f}%)."
                porque = explicar_acumulado(mercado, historico, serie, cfg.get("fecha"), total) if es_cedear and serie else ""
                alertas.append({"tipo": "acumulado", "ticker": a["t"], "cambio": total, "titulo": f"{a['t']} acumula {_pct(total)}",
                                "cuerpo": " ".join(x for x in (base, porque, sufijo) if x), "prioridad": 4})
            s["k"] = banda

        # 3 · Precio en el que la posición cruza su tope duro
        if a.get("tope") and precio_usd >= a["tope"] and _dias(s.get("t"), hoy) >= 14:
            s["t"] = hoy
            alertas.append({"tipo": "tope", "ticker": a["t"], "titulo": f"{a['t']} llegó a su tope",
                            "cuerpo": "A este precio pasa el tope duro de tu regla de satélites. Abrí el tablero: es la única regla que puede pedir reducir, y antes hay que revisar costos y esperar 48 horas.",
                            "prioridad": 5})
    return alertas, estado


def bitacora(anterior, alertas, hoy):
    """Los movimientos avisados en las últimas dos semanas, para el resumen del sábado. Es público: solo ticker y
    porcentaje (datos de mercado). El aviso del tope duro no se guarda porque depende de cuánto pesa la posición."""
    desde = (dt.date.fromisoformat(hoy) - dt.timedelta(days=DIAS_GUARDADOS)).isoformat()
    items = [x for x in (anterior or {}).get("items") or [] if x.get("fecha", "") >= desde]
    vistos = {(x["fecha"], x["ticker"], x["tipo"]) for x in items}
    for a in alertas:
        clave = (hoy, a.get("ticker"), a.get("tipo"))
        if a.get("tipo") in ("dia", "acumulado", "mep") and clave not in vistos:
            vistos.add(clave)
            items.append({"fecha": hoy, "ticker": a["ticker"], "tipo": a["tipo"], "cambio": round(a["cambio"], 4)})
    return {"nota": "Movimientos de precio avisados. Sin montos ni cantidades.", "items": items}


def enviar(topic, alerta, url_app=None):
    cuerpo = {"topic": topic, "title": alerta["titulo"], "message": alerta["cuerpo"], "priority": alerta["prioridad"], "tags": ["chart_with_upwards_trend"]}
    if url_app:
        cuerpo["click"] = url_app
    req = urllib.request.Request("https://ntfy.sh/", data=json.dumps(cuerpo).encode("utf-8"), headers={"Content-Type": "application/json", "User-Agent": "tablero-alertas/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status == 200


def _leer(ruta):
    try:
        return json.loads(ruta.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def correr(mercado):
    """Lee la configuración de los secretos, evalúa, avisa y guarda el estado. Devuelve cuántos avisos salieron."""
    crudo = os.environ.get("ALERTAS_CONFIG")
    if not crudo:
        print("alertas: sin configurar")
        return 0
    cfg = json.loads(crudo)
    estado = _leer(ESTADO)
    hoy = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=3)).strftime("%Y-%m-%d")  # fecha de Argentina
    alertas, estado = evaluar(cfg, mercado, estado, hoy, historico=_leer(RAIZ / "data" / "historico.json"),
                              feriados=_leer(RAIZ / "data" / "feriados_eeuu.json"),
                              ratios=_leer(RAIZ / "tools" / "cedear_ratios.json").get("ratios"))
    topic, enviadas = os.environ.get("NTFY_TOPIC"), 0
    for a in alertas:
        try:
            if topic and enviar(topic, a, cfg.get("app")):
                enviadas += 1
        except Exception:  # noqa: BLE001
            pass
    ESTADO.write_text(json.dumps(estado, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    previa = _leer(SEMANA)
    nueva = bitacora(previa, alertas, hoy)
    if nueva.get("items") != previa.get("items"):
        SEMANA.write_text(json.dumps(nueva, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"alertas: {len(alertas)} para avisar, {enviadas} enviadas")
    return enviadas
