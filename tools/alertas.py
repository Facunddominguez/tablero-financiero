"""Alertas de precio: evalúa los umbrales y avisa al teléfono (ntfy). Solo biblioteca estándar.

La lista de activos y sus niveles NO está en el repositorio: llega por el secreto ALERTAS_CONFIG (lo arma
tools/alertas_config.py a partir de los datos descifrados). El estado que se guarda en data/alertas_estado.json
no tiene tickers ni precios: solo huellas con sal y contadores, para no repetir avisos.
Los registros del Action tampoco muestran qué se avisó: solo cuántos avisos salieron.
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


def _pct(x, dec=1):
    return f"{'+' if x > 0 else '−'}{abs(x) * 100:.{dec}f}%".replace(".", ",")


def _dias(a, b):
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days if a and b else 9999


def evaluar(cfg, mercado, estado, hoy):
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
    u = cfg["dia"].get("mep")
    if u and mep_prev and abs(cambio_mep) >= u and s.get("d") != hoy:
        s["d"] = hoy
        alertas.append({"titulo": f"Dólar MEP {_pct(cambio_mep)} hoy",
                        "cuerpo": "Salto fuerte del tipo de cambio. Lo que tenés en pesos vale distinto en dólares; tus reglas no piden hacer nada por esto.",
                        "prioridad": 4})

    for a in cfg["activos"]:
        fila = ((mercado.get(a["tabla"]) or {}).get("precios") or {}).get(a["t"])
        if not fila or (mercado.get(a["tabla"]) or {}).get("stale"):
            continue
        precio_usd = fila[0] / mep
        s = e.setdefault(clave(a["t"]), {})
        sufijo = "El próximo aporte va al núcleo como siempre." if a["g"] == "nucleo" else "Tus reglas no operan por un movimiento de precio: cualquier cambio espera 48 horas."

        # 1 · Movimiento del día, en dólares (precio en pesos corregido por el movimiento del MEP)
        u = cfg["dia"].get(a["g"])
        dia_usd = (1 + (fila[1] or 0) / 100) / (1 + cambio_mep) - 1
        if u and abs(dia_usd) >= u and s.get("d") != hoy and s.get("p") != fila[1]:
            s["d"], s["p"] = hoy, fila[1]
            alertas.append({"titulo": f"{a['t']} {_pct(dia_usd)} hoy", "cuerpo": f"Movimiento fuerte en dólares (tu umbral es ±{u * 100:.0f}%). {sufijo}", "prioridad": 4})

        # 2 · Acumulado desde el precio de referencia, por escalones
        u = cfg["nivel"].get(a["g"])
        if u and a.get("ref"):
            banda = math.trunc(math.log(precio_usd / a["ref"]) / math.log(1 + u))
            previa = s.get("k", 0)
            mas_lejos = abs(banda) > abs(previa) and (banda * previa >= 0)
            cruce = banda * previa < 0
            if (mas_lejos or cruce) and _dias(s.get("n"), hoy) >= 3:
                s["n"] = hoy
                alertas.append({"titulo": f"{a['t']} acumula {_pct(precio_usd / a['ref'] - 1)}",
                                "cuerpo": f"Desde el {cfg.get('fecha', 'precio de referencia')}, en dólares (escalones de {u * 100:.0f}%). {sufijo}", "prioridad": 4})
            s["k"] = banda

        # 3 · Precio en el que la posición cruza su tope duro
        if a.get("tope") and precio_usd >= a["tope"] and _dias(s.get("t"), hoy) >= 14:
            s["t"] = hoy
            alertas.append({"titulo": f"{a['t']} llegó a su tope",
                            "cuerpo": "A este precio pasa el tope duro de tu regla de satélites. Abrí el tablero: es la única regla que puede pedir reducir, y antes hay que revisar costos y esperar 48 horas.",
                            "prioridad": 5})
    return alertas, estado


def enviar(topic, alerta, url_app=None):
    cuerpo = {"topic": topic, "title": alerta["titulo"], "message": alerta["cuerpo"], "priority": alerta["prioridad"], "tags": ["chart_with_upwards_trend"]}
    if url_app:
        cuerpo["click"] = url_app
    req = urllib.request.Request("https://ntfy.sh/", data=json.dumps(cuerpo).encode("utf-8"), headers={"Content-Type": "application/json", "User-Agent": "tablero-alertas/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status == 200


def correr(mercado):
    """Lee la configuración de los secretos, evalúa, avisa y guarda el estado. Devuelve cuántos avisos salieron."""
    crudo = os.environ.get("ALERTAS_CONFIG")
    if not crudo:
        print("alertas: sin configurar")
        return 0
    cfg = json.loads(crudo)
    try:
        estado = json.loads(ESTADO.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        estado = {}
    hoy = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=3)).strftime("%Y-%m-%d")  # fecha de Argentina
    alertas, estado = evaluar(cfg, mercado, estado, hoy)
    topic, enviadas = os.environ.get("NTFY_TOPIC"), 0
    for a in alertas:
        try:
            if topic and enviar(topic, a, cfg.get("app")):
                enviadas += 1
        except Exception:  # noqa: BLE001
            pass
    ESTADO.write_text(json.dumps(estado, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    print(f"alertas: {len(alertas)} para avisar, {enviadas} enviadas")
    return enviadas
