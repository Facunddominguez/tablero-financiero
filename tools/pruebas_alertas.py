"""Pruebas del evaluador de alertas (tools/alertas.py) con datos inventados. Uso: python tools/pruebas_alertas.py"""
import sys, json
import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import alertas

cfg = {"sal": "x", "fecha": "13/11/2026", "dia": {"nucleo": 0.05, "satelite": 0.10, "on": 0.04, "mep": 0.05}, "nivel": {"nucleo": 0.10, "satelite": 0.25, "on": 0.08},
       "activos": [{"t": "AAA", "tabla": "cedears", "g": "nucleo", "ref": 10.0}, {"t": "BBB", "tabla": "cedears", "g": "satelite", "ref": 5.0, "tope": 5.5}, {"t": "CCC", "tabla": "ons", "g": "on", "ref": 1.0}]}
def mercado(aaa, bbb, ccc, mep=1000.0, mep_prev=1000.0):
    return {"fx": {"mep": mep, "mep_prev": mep_prev}, "cedears": {"precios": {"AAA": aaa, "BBB": bbb}}, "ons": {"precios": {"CCC": ccc}}}
ok = lambda c, m: print(('ok   ' if c else 'FALLA') + ' ' + m) or c
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
print(f"\n{sum(res)}/{len(res)} pruebas de alertas pasan")
sys.exit(0 if all(res) else 1)
