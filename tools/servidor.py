"""Servidor local para probar el tablero sin caché: python tools/servidor.py → http://localhost:8765"""
import http.server, functools, pathlib

class SinCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

if __name__ == "__main__":
    raiz = pathlib.Path(__file__).resolve().parent.parent
    http.server.ThreadingHTTPServer(("127.0.0.1", 8765), functools.partial(SinCache, directory=str(raiz))).serve_forever()
