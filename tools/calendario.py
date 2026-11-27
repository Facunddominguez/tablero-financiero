"""Balances, fechas ex dividendo y el movimiento que descuentan las opciones, para lo que se sigue (yfinance).

Escribe data/agenda.json. Cada empresa va por separado: si falla, conserva lo anterior marcado `stale`.
El movimiento descontado es el "straddle" al precio: (compra a futuro + venta a futuro) de la base más cercana al
precio, en el primer vencimiento posterior al balance, dividido por el precio. Solo con puntas válidas: sin puntas
no se inventa nada.
"""
import datetime as dt
import time

FUENTE = "Yahoo Finance (vía yfinance)"
PRESUPUESTO_SEGUNDOS = 150
DIAS_OPCIONES = 45        # solo se miran opciones si el balance está así de cerca
PUNTAS_MAXIMAS = 0.6      # si compra y venta distan más que esto sobre el punto medio, no es un precio confiable
_reloj = time.monotonic


def _yf(t):
    import yfinance as yf  # se importa acá para que el resto funcione aunque no esté instalado
    return yf.Ticker(t.replace(".", "-"))


def _iso(x):
    if isinstance(x, (dt.date, dt.datetime)):
        return x.isoformat()[:10]
    return str(x)[:10] if x else None


def yf_calendario(t):
    """{'Earnings Date': [fechas], 'Ex-Dividend Date': fecha, …} como lo da yfinance ({} si no publica nada)."""
    return _yf(t).calendar or {}


def yf_vencimientos(t):
    return list(_yf(t).options or [])


def yf_precio(t):
    return float(_yf(t).fast_info["lastPrice"])


def yf_cadena(t, vencimiento):
    ch = _yf(t).option_chain(vencimiento)

    def filas(df):
        return [{"strike": float(r.strike), "bid": float(r.bid), "ask": float(r.ask)} for r in df.itertuples()]
    return {"calls": filas(ch.calls), "puts": filas(ch.puts)}


def proximas_fechas(calendario, hoy):
    """(fecha del próximo balance, próxima fecha ex dividendo) desde la respuesta de yfinance, de hoy en adelante."""
    balance = calendario.get("Earnings Date")
    balance = balance if isinstance(balance, list) else [balance]
    futuras = sorted(f for f in (_iso(x) for x in balance) if f and f >= hoy)
    ex = _iso(calendario.get("Ex-Dividend Date"))
    return (futuras[0] if futuras else None), (ex if ex and ex >= hoy else None)


def _medio(f):
    bid, ask = f.get("bid") or 0, f.get("ask") or 0
    if not (bid > 0 and ask >= bid):
        return None
    medio = (bid + ask) / 2
    return medio if (ask - bid) <= PUNTAS_MAXIMAS * medio else None


def movimiento_descontado(precio, calls, puts):
    """{'strike', 'straddle', 'movimiento'} con la base más cercana al precio que tenga puntas en las dos; None si no hay."""
    if not precio or precio <= 0:
        return None
    c = {f["strike"]: _medio(f) for f in calls}
    p = {f["strike"]: _medio(f) for f in puts}
    comunes = sorted((k for k in c if c[k] and p.get(k)), key=lambda k: abs(k - precio))
    if not comunes or abs(comunes[0] / precio - 1) > 0.05:  # la base tiene que estar cerca del precio
        return None
    k = comunes[0]
    straddle = c[k] + p[k]
    movimiento = straddle / precio
    if not 0.002 < movimiento < 1:
        return None
    return {"strike": k, "straddle": round(straddle, 4), "movimiento": round(movimiento, 4)}


def opciones(t, balance, ahora):
    """Movimiento descontado en el primer vencimiento posterior al balance (None sin puntas válidas)."""
    posteriores = sorted(v for v in yf_vencimientos(t) if v > balance)
    if not posteriores:
        return None
    precio = yf_precio(t)
    cadena = yf_cadena(t, posteriores[0])
    r = movimiento_descontado(precio, cadena["calls"], cadena["puts"])
    return dict(r, vencimiento=posteriores[0], precio=round(precio, 4), balance=balance, tomado=ahora) if r else None


def empresa(t, hoy, ahora, anterior):
    """Fechas y movimiento de una empresa. Lanza si el calendario no se puede leer."""
    balance, ex = proximas_fechas(yf_calendario(t), hoy)
    previo = (anterior or {}).get("opciones")
    # lo calculado antes sirve mientras sea para el mismo balance
    out = {"consultado": hoy, "balance": balance, "ex_dividendo": ex, "stale": False,
           "opciones": previo if previo and previo.get("balance") == balance else None}
    if balance and (dt.date.fromisoformat(balance) - dt.date.fromisoformat(hoy)).days <= DIAS_OPCIONES:
        try:
            nuevo = opciones(t, balance, ahora)
            if nuevo:
                out["opciones"] = nuevo
        except Exception as e:  # noqa: BLE001
            print(f"FALLA opciones {t}: {type(e).__name__}")
    return out


def _al_dia(item, hoy):
    """¿Ya se consultó hoy y no falta nada? Si el balance está cerca y todavía no hay opciones, se reintenta."""
    if not item or item.get("stale") or item.get("consultado") != hoy:
        return False
    b = item.get("balance")
    cerca = b and (dt.date.fromisoformat(b) - dt.date.fromisoformat(hoy)).days <= DIAS_OPCIONES
    return not cerca or bool(item.get("opciones"))


def agenda(m, tickers, anterior):
    """data/agenda.json para `tickers` (en orden de prioridad). Respeta un tope de tiempo."""
    hoy, ahora = m.hoy_argentina(), m.ahora()
    previas = (anterior or {}).get("empresas") or {}
    limite = _reloj() + PRESUPUESTO_SEGUNDOS
    empresas, pedidas, fallas = {}, 0, 0
    for t in tickers:
        previo = previas.get(t)
        if _al_dia(previo, hoy):
            empresas[t] = previo
            continue
        if _reloj() > limite:  # lo que falta queda con lo anterior, para la próxima corrida
            if previo:
                empresas[t] = previo
            continue
        pedidas += 1
        try:
            empresas[t] = empresa(t, hoy, ahora, previo)
        except Exception as e:  # noqa: BLE001
            fallas += 1
            print(f"FALLA calendario {t}: {type(e).__name__}")
            if previo:
                empresas[t] = dict(previo, stale=True)
    todo_mal = pedidas > 0 and fallas == pedidas
    salida = {"generado": ahora, "fuente": FUENTE, "stale": todo_mal, "empresas": empresas,
              "actualizado": (anterior or {}).get("actualizado") if todo_mal else ahora}
    print(f"{'FALLA' if todo_mal else 'ok  '} calendario: {len(empresas)} empresas, {pedidas} consultadas, {fallas} con falla")
    return salida
