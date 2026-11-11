"""Cifra / descifra los datos privados (AES-256-GCM, PBKDF2-SHA256 600k). Formato compatible con WebCrypto.
Uso: python3 tools/cripto.py cifrar privado/datos_iniciales.json data/cartera.enc.json
     python3 tools/cripto.py descifrar data/cartera.enc.json privado/datos_iniciales.json
La clave se pide por consola o se toma de la variable TABLERO_CLAVE."""
import sys, os, json, base64, getpass
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
ITER = 600_000
b64 = lambda b: base64.b64encode(b).decode()
def clave(pw, salt): return PBKDF2HMAC(hashes.SHA256(), 32, salt, ITER).derive(pw.encode())
def main():
    modo, src, dst = sys.argv[1:4]
    pw = os.environ.get("TABLERO_CLAVE") or getpass.getpass("Clave: ")
    if modo == "cifrar":
        # Si el destino ya existe se reutiliza su salt (IV nuevo siempre): así la clave derivada que
        # el navegador recuerda en cada dispositivo sigue sirviendo después de cada actualización.
        try: salt = base64.b64decode(json.load(open(dst))["salt"])
        except Exception: salt = os.urandom(16)
        iv = os.urandom(12)
        ct = AESGCM(clave(pw, salt)).encrypt(iv, open(src, "rb").read(), None)
        json.dump({"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITER, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}, open(dst, "w"))
    else:
        e = json.load(open(src)); d = base64.b64decode
        open(dst, "wb").write(AESGCM(clave(pw, d(e["salt"]))).decrypt(d(e["iv"]), d(e["ct"]), None))
    print("ok ->", dst)
if __name__ == "__main__": main()
