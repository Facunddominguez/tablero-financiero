"""Arma la configuración privada de las alertas de precio a partir de los datos descifrados.

Uso (los datos descifrados viven en privado/, que no se sube):
    python tools/alertas_config.py privado/datos_actual.json | gh secret set ALERTAS_CONFIG

La sal y el canal de avisos se guardan en privado/alertas_local.json para que no cambien entre corridas.
Hay que volver a correrlo cuando cambian las tenencias o la watchlist (los precios de referencia se renuevan).
"""
import datetime as dt
import json
import pathlib
import secrets
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
TABLA = {"cedear": "cedears", "accion_ar": "acciones", "on": "ons"}
GRUPO = {"nucleo": "nucleo", "satelite_ypf": "satelite", "satelite": "satelite", "satelite_argentina": "satelite", "satelite_volatil": "satelite"}


def main():
    d = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    m = json.loads((RAIZ / "data" / "market.json").read_text(encoding="utf-8"))
    local_p = RAIZ / "privado" / "alertas_local.json"
    local = json.loads(local_p.read_text(encoding="utf-8")) if local_p.exists() else {}
    local.setdefault("sal", secrets.token_hex(16))
    local.setdefault("topic", "tablero-" + secrets.token_urlsafe(18))
    local_p.write_text(json.dumps(local), encoding="utf-8")

    mep = m["fx"]["mep"]
    precio = lambda p: ((m.get(TABLA.get(p["tipo"], "")) or {}).get("precios") or {}).get(p["ticker"], [None])[0]
    # valuación mínima para saber a qué precio un satélite cruza su tope duro
    valor = {}
    for p in d["posiciones"]:
        pr = precio(p) or p["precio"]
        valor[p["ticker"]] = p["cantidad"] * pr / (1 if p["moneda_precio"] == "USD" else mep)
    emergencia = sum(v for p, v in ((p, valor[p["ticker"]]) for p in d["posiciones"]) if p["bloque"] == "emergencia")
    caja = d["caja"]["ARS"] / mep + d["caja"]["USD_MEP"] + d["caja"].get("USD_cable", 0)
    lp = sum(valor.values()) + caja - emergencia
    reglas = {r["id"]: r for r in d["reglas"]}
    crit = d["alertas"]["critico"]

    activos = []
    for p in d["posiciones"]:
        if p["tipo"] not in TABLA or not precio(p):
            continue
        g = "on" if p["tipo"] == "on" else GRUPO.get(p["bloque"])
        if not g:
            continue
        a = {"t": p["ticker"], "tabla": TABLA[p["tipo"]], "g": g, "ref": round(precio(p) / mep, 6)}
        if p["bloque"] in ("satelite", "satelite_argentina", "satelite_volatil"):
            duro = reglas["R4B" if p["bloque"] == "satelite_volatil" else "R4"]["duro"]
            v = valor[p["ticker"]]
            v_tope = duro * (lp - v) / (1 - duro)
            if v_tope > v:
                a["tope"] = round(a["ref"] * v_tope / v, 6)
        activos.append(a)

    cfg = {"sal": local["sal"], "fecha": dt.date.today().strftime("%d/%m/%Y"), "app": d.get("alertas", {}).get("app"),
           "dia": crit["dia"], "nivel": crit["nivel"], "activos": activos}
    sys.stdout.write(json.dumps(cfg, separators=(",", ":")))
    sys.stderr.write(f"activos con alerta: {len(activos)} · con tope: {sum(1 for a in activos if 'tope' in a)}\n")


if __name__ == "__main__":
    main()
