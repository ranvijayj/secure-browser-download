// A file SecureDL has read but not yet locked waits here, in the extension's private storage,
// so a one-time download (a service-account key, a recovery code) isn't lost while you pick a
// password. It is deleted as soon as the file is saved or the page is closed, and swept at startup.
// Used by background.js (service worker) and prompt.js (page).
const HELD_DB = "securedl-held";
function heldOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HELD_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function heldTx(mode, fn) {
  const db = await heldOpen();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("files", mode); const store = tx.objectStore("files");
      const out = fn(store);
      tx.oncomplete = () => resolve(out && "result" in out ? out.result : undefined);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
const heldPut = (key, rec) => heldTx("readwrite", (s) => s.put({ ...rec, t: Date.now() }, key));
const heldGet = (key) => heldTx("readonly", (s) => s.get(key));
const heldDelete = (key) => heldTx("readwrite", (s) => s.delete(key));
// Delete everything older than maxAgeMs (0 = everything).
async function heldSweep(maxAgeMs = 0) {
  const db = await heldOpen();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readwrite"); const store = tx.objectStore("files");
      const cur = store.openCursor();
      cur.onsuccess = () => { const c = cur.result; if (!c) return;
        if (!maxAgeMs || Date.now() - (c.value?.t || 0) > maxAgeMs) c.delete(); c.continue(); };
      tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
