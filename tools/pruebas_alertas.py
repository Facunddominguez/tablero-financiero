"""Pruebas del evaluador de alertas (tools/alertas.py) con datos inventados. Uso: python tools/pruebas_alertas.py"""
import datetime as dt
import sys, json
import pathlib
import re
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import alertas
sys.stdout.reconfigure(encoding="utf-8")  # en Windows la consola no siempre es UTF-8

cfg = {"sal": "x", "fecha": "13/11/2026", "dia": {"nucleo": 0.05, "satelite": 0.10, "on": 0.04, "mep": 0.05}, "nivel": {"nucleo": 0.10, "satelite": 0.25, "on": 0.08},
       "activos": [{"t": "AAA", "tabla": "cedears", "g": "nucleo", "ref": 10.0}, {"t": "BBB", "tabla": "cedears", "g": "satelite", "ref": 5.0, "tope": 5.5}, {"t": "CCC", "tabla": "ons", "g": "on", "ref": 1.0}]}
def mercado(aaa, bbb, ccc, mep=1000.0, mep_prev=1000.0):
    return {"fx": {"mep": mep, "mep_prev": mep_prev}, "cedears": {"precios": {"AAA": aaa, "BBB": bbb}}, "ons": {"precios": {"CCC": ccc}}}
ok = lambda c, m: print(('ok   ' if c else 'FALLA') + ' ' + m) or bool(c)
res = []

# día tranquilo: nada
al, est = alertas.evaluar(cfg, mercado([10000, -1.0], [5000, 2.0], [1000, 0.1]), {}, "2026-11-13")
res.append(ok(len(al) == 0, "día tranquilo: sin avisos"))
# núcleo −6% y satélite +12%: dos avisos de día; BBB además cruza su tope (5,6 ≥ 5,5)
al, est = alertas.evaluar(cfg, mercado([9400, -6.0], [5600, 12.0], [1000, 0.0]), est, "2026-11-16")
res.append(ok(sorted(a["titulo"].split()[0] for a in al) == ["AAA", "BBB", "BBB"], "movimiento del día y tope: " + " | ".join(a["titulo"] for a in al)))
res.append(ok(any(a["prioridad"] == 5 for a in al), "el tope sale con prioridad máxima"))
# misma corrida repetida el mismo día: no repite
al2, est2 = alertas.evaluar(cfg, mercado([9400, -6.0], [5600, 12.0], [1000, 0.0]), est, "2026-11-16")
res.append(ok(len(al2) == 0, "no repite el mismo día"))
# feriado: al día siguiente el dato viene igual → no repite
al3, est3 = alertas.evaluar(cfg, mercado([9400, -6.0], [5600, 12.0], [1000, 0.0]), est2, "2026-11-17")
res.append(ok(len(al3) == 0, "no repite si el dato no cambió (feriado)"))
# el MEP sube 6%: aviso de dólar; y un −2% en pesos pasa a ser −7,5% en dólares → aviso del núcleo
al4, est4 = alertas.evaluar(cfg, mercado([9800, -2.0], [5300, 0.0], [1000, 0.0], mep=1060.0), est3, "2026-11-18")
t = [a["titulo"] for a in al4]
res.append(ok(any("MEP" in x for x in t) and any(x.startswith("AAA") for x in t), "salto del dólar: " + " | ".join(t)))
# acumulado: el núcleo queda −12% desde la referencia → aviso de nivel (una sola vez)
al5, est5 = alertas.evaluar(cfg, mercado([8800, -1.0], [5000, 0.0], [1000, 0.0]), est4, "2026-11-25")
res.append(ok(any("acumula" in a["titulo"] and a["titulo"].startswith("AAA") for a in al5), "acumulado: " + " | ".join(a["titulo"] for a in al5)))
al6, est6 = alertas.evaluar(cfg, mercado([8750, -0.5], [5000, 0.0], [1000, 0.0]), est5, "2026-11-30")
res.append(ok(not any("acumula" in a["titulo"] for a in al6), "el acumulado no se repite en el mismo escalón"))
# el estado guardado no tiene tickers ni precios
crudo = json.dumps(est6)
res.append(ok(not any(x in crudo for x in ("AAA", "BBB", "CCC", "8750", "5600")), "el estado no revela tickers ni precios"))
# ---------- umbral según la volatilidad de cada activo ----------
dias = [(dt.date(2026, 1, 1) + dt.timedelta(days=i)).isoformat() for i in range(120)]
def serie(amplitud, base=100.0):  # sube y baja siempre lo mismo: su volatilidad es exactamente `amplitud`
    v = [base]
    for i in range(1, len(dias)):
        v.append(v[-1] * (1 + amplitud * (1 if i % 2 else -1)))
    return v
H = {"fechas": dias, "series": {"AAA": serie(0.01), "BBB": serie(0.01), "PAM": serie(0.02), "MEP": serie(0.005, 1000), "CORTA": [1.0, 2.0] + [None] * 118}}
HOY = dias[-1]
cerca = lambda a, b: abs(a - b) < 1e-9
res.append(ok(cerca(alertas.volatilidad(H, "AAA", HOY), 0.01), "volatilidad de una serie que siempre se mueve 1%"))
salto = {"fechas": dias, "series": {"X": serie(0.01)}}
salto["series"]["X"][-2] = salto["series"]["X"][-3] * 1.05  # un salto de 5% el último día anterior
res.append(ok(cerca(alertas.volatilidad(salto, "X", HOY), (0.94 * 0.01 ** 2 + 0.06 * 0.05 ** 2) ** 0.5), "lo reciente pesa más (λ 0,94)"))
res.append(ok(alertas.volatilidad(H, "CORTA", HOY) is None and alertas.volatilidad(H, "ZZZ", HOY) is None, "sin historia suficiente no hay volatilidad"))
res.append(ok(cerca(alertas.umbral(H, "AAA", "satelite", HOY), 0.04) and cerca(alertas.umbral(H, "AAA", "nucleo", HOY), 0.05) and cerca(alertas.umbral(H, "AAA", "satelite", HOY, "aviso"), 0.025), "umbral: 4 veces (crítico), 2,5 (aviso), núcleo ×1,25"))

cfg2 = {"sal": "x", "fecha": dt.date.fromisoformat(dias[60]).strftime("%d/%m/%Y"), "dia": {"nucleo": 0.05, "satelite": 0.10, "on": 0.04, "mep": 0.05}, "nivel": {},
        "activos": [{"t": "AAA", "tabla": "cedears", "g": "nucleo", "ref": 10.0}, {"t": "BBB", "tabla": "cedears", "g": "satelite", "ref": 10.0},
                    {"t": "PAMP", "tabla": "acciones", "g": "satelite", "ref": 1.0}, {"t": "CCC", "tabla": "ons", "g": "on", "ref": 1.0}]}
def m2(aaa, bbb, pamp, ccc, usa_pct=-3.0, generado=HOY + "T18:00:00Z"):
    return {"generado": generado, "fx": {"mep": 1000.0, "mep_prev": 1000.0}, "cedears": {"precios": {"AAA": [10000, aaa], "BBB": [10000, bbb]}},
            "acciones": {"precios": {"PAMP": [1000, pamp]}}, "ons": {"precios": {"CCC": [1000, ccc]}},
            "implicito": {"usa": {"precios": {"AAA": [100, usa_pct], "BBB": [100, usa_pct]}}}}
al, _ = alertas.evaluar(cfg2, m2(-4.5, -4.5, -7.0, -4.5), {}, HOY, historico=H)
t = sorted(a["titulo"].split()[0] for a in al)
res.append(ok(t == ["BBB", "CCC"], f"cada uno con su vara: AAA (núcleo, umbral 5%) y PAMP (umbral 8%) no avisan; BBB (4%) y la ON (fijo 4%) sí → {t}"))
bbb = next(a for a in al if a["titulo"].startswith("BBB"))["cuerpo"]
res.append(ok("En EE.UU. BBB se movió −3,0%" in bbb and "dólar implícito contra el MEP puso −1,5%" in bbb and "±4,0%" in bbb, "explica el movimiento del CEDEAR: " + bbb))
res.append(ok("EE.UU." not in next(a for a in al if a["titulo"].startswith("CCC"))["cuerpo"], "la ON no es un CEDEAR: sin desglose"))
al, _ = alertas.evaluar(cfg2, m2(0, -6.0, 0, 0, generado="2026-11-26T18:00:00Z"), {}, HOY, historico=H, feriados={"feriados": {"2026-11-26": "x"}})
res.append(ok("Wall Street no operó" in al[0]["cuerpo"], "feriado en EE.UU.: todo es dólar implícito"))
al, _ = alertas.evaluar(cfg2, m2(0, -6.0, 0, 0, generado="2026-11-30T14:20:00Z"), {}, HOY, historico=H)
res.append(ok("todavía no abrió" in al[0]["cuerpo"], "antes de la apertura de Wall Street"))
res.append(ok(alertas.wall_street("2026-11-30T14:31:00Z") is None and alertas.wall_street("2026-07-01T13:31:00Z") is None and alertas.wall_street("2026-07-01T13:20:00Z"), "apertura con y sin horario de verano"))
sin_usa = m2(0, -6.0, 0, 0)
sin_usa["implicito"]["usa"]["stale"] = True
al, _ = alertas.evaluar(cfg2, sin_usa, {}, HOY, historico=H)
res.append(ok("EE.UU." not in al[0]["cuerpo"], "sin precios de EE.UU. de ahora no inventa el desglose"))
al, _ = alertas.evaluar(cfg2, m2(0, -6.0, 0, 0), {}, HOY)  # sin histórico: los umbrales fijos de siempre (satélites 10%)
res.append(ok(al == [], "sin histórico quedan los umbrales fijos"))
cfg3 = dict(cfg2, nivel={"satelite": 0.25}, activos=[{"t": "BBB", "tabla": "cedears", "g": "satelite", "ref": 13.5}])
al, _ = alertas.evaluar(cfg3, m2(0, 0.0, 0, 0, usa_pct=0.0), {}, HOY, historico=H)
acum = al[0]["cuerpo"] if al else ""
res.append(ok(al and "acumula" in al[0]["titulo"] and "En EE.UU. BBB" in acum and "escalones de 25%" in acum, "el acumulado no cambia y explica el CEDEAR: " + acum))

# La app usa los mismos parámetros que el aviso al teléfono
js = (pathlib.Path(__file__).resolve().parent.parent / "js" / "motor.js").read_text(encoding="utf-8")
js_par = re.search(r"VOLATILIDAD = \{ lambda: ([\d.]+), aviso: ([\d.]+), critico: ([\d.]+), grupo: \{ nucleo: ([\d.]+) \}, min_datos: (\d+) \}", js)
p = alertas.PARAMETROS
res.append(ok(js_par and [float(x) for x in js_par.groups()] == [p["lambda"], p["aviso"], p["critico"], p["grupo"]["nucleo"], p["min_datos"]], "la app y el teléfono usan los mismos parámetros"))

# ---------- calibración: los críticos por año no pueden superar los de los umbrales fijos ----------
# Dos años de cierres públicos (grabados el 26/11/2026): 4 ETF del núcleo, 6 acciones y el dólar. Cada día se evalúa
# como lo haría el Action, en dólares MEP y con CEDEARs (subyacente × contado con liqui).
G = json.loads((pathlib.Path(__file__).resolve().parent / "grabadas" / "historico_calibracion.json").read_text(encoding="utf-8"))
NUCLEO, SATELITES = ["SPY", "EFA", "EEM", "IWM"], ["NVDA", "TSLA", "MELI", "GOOGL", "PAM", "YPF"]
def llenar(s):
    ultimo, out = None, []
    for v in s:
        ultimo = v if v is not None else ultimo
        out.append(ultimo)
    return out
mep, ccl = llenar(G["series"]["MEP"]), llenar(G["series"]["CCL"])
cal = {"sal": "x", "dia": cfg2["dia"], "nivel": {}, "activos": [{"t": t, "tabla": "cedears", "g": "nucleo" if t in NUCLEO else "satelite"} for t in NUCLEO + SATELITES]}
def criticos_por_anio(historico):
    estado, n = {}, 0
    for i in range(61, len(G["fechas"])):
        precios = {t: [G["series"][t][i] * ccl[i], (G["series"][t][i] * ccl[i] / (G["series"][t][i - 1] * ccl[i - 1]) - 1) * 100] for t in NUCLEO + SATELITES}
        al, estado = alertas.evaluar(cal, {"fx": {"mep": mep[i], "mep_prev": mep[i - 1]}, "cedears": {"precios": precios}}, estado, G["fechas"][i], historico=historico)
        n += len(al)
    return n / ((len(G["fechas"]) - 61) / 252)
fijos, propios = criticos_por_anio(None), criticos_por_anio(G)
print(f"     críticos del día por año: {fijos:.1f} con umbrales fijos, {propios:.1f} según la volatilidad de cada activo")
res.append(ok(propios <= fijos and propios <= 22, "calibración: no hay más críticos que antes (los escalones acumulados no cambian)"))

print(f"\n{sum(res)}/{len(res)} pruebas de alertas pasan")
sys.exit(0 if all(res) else 1)
