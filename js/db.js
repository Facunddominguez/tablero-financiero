// IndexedDB mínimo: un almacén clave → valor que vive solo en este dispositivo.

let conexion;
function abrir() {
  return conexion || (conexion = new Promise((ok, mal) => {
    const req = indexedDB.open('tablero', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => ok(req.result);
    req.onerror = () => mal(req.error);
  }));
}
async function tx(modo, fn) {
  const db = await abrir();
  return new Promise((ok, mal) => {
    const t = db.transaction('kv', modo);
    const req = fn(t.objectStore('kv'));
    t.oncomplete = () => ok(req.result);
    t.onerror = () => mal(t.error);
  });
}

export const db = {
  leer: k => tx('readonly', s => s.get(k)),
  guardar: (k, v) => tx('readwrite', s => s.put(v, k)),
  borrar: k => tx('readwrite', s => s.delete(k)),
};
