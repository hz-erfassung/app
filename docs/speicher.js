// IndexedDB: Ereignisse (mit Merker _sync) und ein Schlüssel-Wert-Speicher
// für Token, Konfiguration und Einstellungen. Alles bleibt auf dem Gerät.

const NAME = "hanna-erfassung";
let dbVersprechen = null;

function db() {
  if (!dbVersprechen) {
    dbVersprechen = new Promise((ok, fehler) => {
      const r = indexedDB.open(NAME, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains("ereignisse")) d.createObjectStore("ereignisse", { keyPath: "id" });
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fehler(r.error);
    });
  }
  return dbVersprechen;
}

async function tx(store, modus, arbeit) {
  const d = await db();
  return new Promise((ok, fehler) => {
    const t = d.transaction(store, modus);
    const s = t.objectStore(store);
    let ergebnis;
    Promise.resolve(arbeit(s)).then((r) => { ergebnis = r; });
    t.oncomplete = () => ok(ergebnis);
    t.onerror = () => fehler(t.error);
    t.onabort = () => fehler(t.error || new Error("abgebrochen"));
  });
}

const anfrage = (r) => new Promise((ok, fehler) => { r.onsuccess = () => ok(r.result); r.onerror = () => fehler(r.error); });

export const alleEreignisse = () => tx("ereignisse", "readonly", (s) => anfrage(s.getAll()));
export const speichere = (ev) => tx("ereignisse", "readwrite", (s) => anfrage(s.put(ev)));
export async function markiereSynchron(ids) {
  // Ohne await in der Transaktion: ältere Safari-Versionen schliessen sie sonst zu früh.
  return tx("ereignisse", "readwrite", (s) => {
    for (const id of ids) {
      const r = s.get(id);
      r.onsuccess = () => { const e = r.result; if (e && !e._sync) { e._sync = 1; s.put(e); } };
    }
  });
}
export const lies = (k) => tx("kv", "readonly", (s) => anfrage(s.get(k)));
export const schreibe = (k, v) => tx("kv", "readwrite", (s) => anfrage(s.put(v, k)));
export const loesche = (k) => tx("kv", "readwrite", (s) => anfrage(s.delete(k)));
