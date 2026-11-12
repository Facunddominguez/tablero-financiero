"""Servidor local para probar el tablero sin caché: python tools/servidor.py → http://localhost:8765
(o el puerto que indique la variable PORT)."""
import http.server, functools, os, pathlib

class SinCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

if __name__ == "__main__":
    raiz = pathlib.Path(__file__).resolve().parent.parent
    puerto = int(os.environ.get("PORT", "8765"))
    http.server.ThreadingHTTPServer(("127.0.0.1", puerto), functools.partial(SinCache, directory=str(raiz))).serve_forever()
