// SecureDL background: right-click menu + automatic download detection.
//
// Detection modes (setting "mode"):
//   "off"      – right-click only (default)
//   "ask-docs" – when a document/image/archive download starts, stop it and ask
//   "ask-all"  – stop and ask for every download
// A detected download is CANCELLED immediately (Chrome deletes its partial file) and
// prompt.html opens in "ask" mode. Chrome gives extensions only ~10 s to hold a download, far
// too short to type a password, so stopping it is the only way to keep the unprotected file off
// the disk. "Encrypt & save" re-fetches and saves only the locked copy; "Save normally" restarts
// the download; if the file can't be fetched again, it is let through once and the user locks
// the downloaded copy (which is then deleted).
//
// Every decision is written to a small activity log (shown in the popup) so it is always
// visible WHY a download was or wasn't intercepted.

// The lock page opens as a compact window over the page you were on (a quick question, not a
// new page). Returns its tab, so callers can track it like before.
async function PROMPT(params) {
  const url = "prompt.html?" + new URLSearchParams({ ...params, w: "1" }).toString();
  try {
    const win = await chrome.windows.create({ url, type: "popup", width: 480, height: 720, focused: true });
    return win.tabs[0];
  } catch {
    return chrome.tabs.create({ url, active: true });           // e.g. no normal window available
  }
}
const ALL = { origins: ["<all_urls>"] };

// Document-like types that are worth asking about in "ask-docs" mode.
const DOC_EXT = new Set(["pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "txt", "rtf", "odt", "ods",
  "pages", "numbers", "key", "jpg", "jpeg", "png", "heic", "tif", "tiff", "zip", "json", "xml", "eml", "ofx", "qif"]);
const DOC_MIME = /^(application\/(pdf|msword|vnd\.ms-|vnd\.openxmlformats|vnd\.oasis|rtf|zip|json|xml)|image\/|text\/(csv|plain|xml))/i;

function extOf(s) { return (String(s || "").split(/[?#]/)[0].match(/\.([a-z0-9]{1,6})$/i) || [])[1]?.toLowerCase() || ""; }
function hostOf(u) {
  try { const x = new URL(u); return x.protocol === "blob:" ? new URL(x.pathname).host : x.host; } catch { return ""; }
}
function displayName(item) {
  const fromPath = (item.filename || "").split(/[\\/]/).pop();
  if (fromPath) return fromPath;
  const u = item.finalUrl || item.url;
  if (/^(blob|data):/.test(u)) return "file from " + (hostOf(u) || "page");
  try { return decodeURIComponent(u.split(/[?#]/)[0].split("/").pop()) || "download"; } catch { return "download"; }
}
function isDocument(item) {
  const ext = extOf(item.filename) || extOf(item.finalUrl || item.url);
  return DOC_EXT.has(ext) || DOC_MIME.test(item.mime || "");
}

async function getSettings() {
  const s = await chrome.storage.local.get(["mode", "neverAsk", "protectAll"]);
  if (!s.mode && s.protectAll) { s.mode = "ask-all"; chrome.storage.local.set({ mode: "ask-all" }); } // v0.x migration
  return { mode: s.mode || "off", neverAsk: s.neverAsk || [] };
}

// ---------- activity log ----------
async function logDecision(item, decision) {
  const { log = [] } = await chrome.storage.local.get("log");
  log.unshift({ t: Date.now(), name: displayName(item), site: hostOf(item.referrer) || hostOf(item.finalUrl || item.url), decision });
  await chrome.storage.local.set({ log: log.slice(0, 15) });
}

// ---------- badge: warn when detection is on but Chrome access is missing ----------
async function refreshBadge() {
  const { mode } = await getSettings();
  const missing = mode !== "off" && !(await chrome.permissions.contains(ALL));
  await chrome.action.setBadgeText({ text: missing ? "!" : "" });
  if (missing) await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  await chrome.action.setTitle({ title: missing ? "SecureDL: automatic detection needs access. Click to fix." : "SecureDL" });
}
chrome.permissions.onAdded.addListener(refreshBadge);
chrome.permissions.onRemoved.addListener(refreshBadge);
chrome.storage.onChanged.addListener((c) => { if (c.mode) refreshBadge(); });
chrome.runtime.onStartup.addListener(refreshBadge);

chrome.runtime.onInstalled.addListener((details) => {
  // First install: open the welcome tab (choose a mode, give access, try it).
  if (details.reason === "install") chrome.tabs.create({ url: "welcome.html" });
  chrome.contextMenus.create({
    id: "securedl",
    title: "Download with password (SecureDL)",
    contexts: ["link", "image", "video", "audio"]
  });
  refreshBadge();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.linkUrl || info.srcUrl;
  if (url) PROMPT({ url, tabId: tab?.id ?? "" });
});

// The tab the download most likely came from: the one showing the page that made it.
async function sourceTab(item) {
  const want = [item.referrer, item.url].map(hostOf).filter(Boolean);
  const tabs = await chrome.tabs.query({});
  const match = tabs.filter((t) => want.includes(hostOf(t.url))).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if (match) return match;
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return active;
}

// Our own encrypted saves are downloads of blob: URLs created by this extension. Chrome does
// NOT reliably set byExtensionId for those, so also recognise them by their origin.
const OWN_BLOB = "blob:" + chrome.runtime.getURL("").replace(/\/$/, "");
function isOwnDownload(item) {
  return item.byExtensionId === chrome.runtime.id ||
    [item.url, item.finalUrl].some((u) => u && (u.startsWith(OWN_BLOB) || u.startsWith(chrome.runtime.getURL(""))));
}

// ---------- Intercepting downloads ----------
// Names for our own saves. Once an extension listens to onDeterminingFilename, Chrome uses that
// listener's answer even for the extension's OWN downloads.download() calls, so we must hand the
// intended filename back here, or the file is saved under the blob's random ID.
const ownNames = new Map();   // blob URL -> filename
// Downloads we restart ourselves ("Save normally" / "download then lock"): url -> { filename, then }
const restarts = new Map();

// Settings cached in memory so the common "not intercepting" answer is given immediately.
let cache = null;
async function settings() {
  if (!cache) cache = { ...(await getSettings()), granted: await chrome.permissions.contains(ALL) };
  return cache;
}
chrome.storage.onChanged.addListener(() => { cache = null; });
chrome.permissions.onAdded.addListener(() => { cache = null; });
chrome.permissions.onRemoved.addListener(() => { cache = null; });

// One-time passes ("let the next download from this site through"), kept in session storage.
async function takePass(site) {
  const { passOnce = {} } = await chrome.storage.session.get("passOnce");
  const p = passOnce[site];
  if (!p) return null;
  delete passOnce[site];
  await chrome.storage.session.set({ passOnce });
  return p.exp > Date.now() ? p : null;
}
async function addLockWhenDone(id) {
  const { lockWhenDone = [] } = await chrome.storage.session.get("lockWhenDone");
  await chrome.storage.session.set({ lockWhenDone: [...lockWhenDone, id] });
}

async function decide(item) {
  const url = item.finalUrl || item.url;
  if (restarts.has(item.url) || restarts.has(url)) {             // downloads we restarted (before the own check)
    const r = restarts.get(item.url) || restarts.get(url); restarts.delete(item.url); restarts.delete(url);
    return { restart: r };
  }
  if (isOwnDownload(item)) return { own: true };                 // our own encrypted saves
  const { mode, neverAsk, granted } = await settings();
  if (mode === "off") return {};
  if (!/^(https?|blob|data):/.test(url)) return { log: "skipped: not a web download" };
  if (mode === "ask-docs" && !isDocument(item)) return { log: "skipped: not a document or image" };
  const site = hostOf(item.referrer) || hostOf(url);
  if (neverAsk.includes(site) || neverAsk.includes(hostOf(url))) return { log: "skipped: you chose “always save normally” for this site" };
  const pass = await takePass(site);
  if (pass) return { pass, log: pass.then === "lock" ? "let through once; you'll be asked to lock it when it finishes" : "let through once (you chose Save normally)" };
  if (!granted) { refreshBadge(); return { log: "NOT intercepted: Chrome access for automatic detection isn't granted (click the icon to fix)" }; }
  return { intercept: true, site, url };
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  decide(item).then(async (d) => {
    if (d.log) logDecision(item, d.log);
    if (d.own) {
      const filename = ownNames.get(item.url); ownNames.delete(item.url);
      return filename ? suggest({ filename, conflictAction: "uniquify" }) : suggest();
    }
    if (d.restart) {
      suggest(d.restart.filename ? { filename: d.restart.filename, conflictAction: "uniquify" } : undefined);
      if (d.restart.then === "lock") await addLockWhenDone(item.id);
      return;
    }
    if (d.pass) { suggest(); if (d.pass.then === "lock") await addLockWhenDone(item.id); return; }
    if (!d.intercept) return suggest();

    // Stop it NOW: cancelling deletes Chrome's partial file, so nothing unprotected is left.
    await chrome.downloads.cancel(item.id).catch(() => {});
    suggest();
    chrome.downloads.erase({ id: item.id }).catch(() => {});
    const tab = await sourceTab(item);
    const t = await PROMPT({ url: d.url, tabId: tab?.id ?? "", ask: "1", name: displayName(item), site: d.site });
    await chrome.storage.session.set({ ["pending:" + t.id]: { name: displayName(item), site: d.site } });
    logDecision(item, "stopped and asked (nothing saved yet)");
  }).catch((e) => { console.error("SecureDL", e); suggest(); });
  return true;                                                   // we answer asynchronously
});

// "Download it normally, then lock it": when that download finishes, open the lock page for it.
chrome.downloads.onChanged.addListener(async (delta) => {
  if (delta.state?.current !== "complete") return;
  const { lockWhenDone = [] } = await chrome.storage.session.get("lockWhenDone");
  if (!lockWhenDone.includes(delta.id)) return;
  await chrome.storage.session.set({ lockWhenDone: lockWhenDone.filter((x) => x !== delta.id) });
  const [d] = await chrome.downloads.search({ id: delta.id });
  if (!d) return;
  PROMPT({ url: d.finalUrl || d.url, ask: "1", pick: "1", dlId: d.id, name: d.filename.split(/[\\/]/).pop(),
    site: hostOf(d.referrer) || hostOf(d.finalUrl || d.url) });
});

// Asked, but the tab was closed without a choice: nothing was saved; note it in the log.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const key = "pending:" + tabId;
  const { [key]: p } = await chrome.storage.session.get(key);
  if (!p) return;
  await chrome.storage.session.remove(key);
  logDecision({ filename: p.name, referrer: "https://" + p.site + "/" }, "closed without choosing: nothing was saved");
});

async function restart(url, filename, then) {
  restarts.set(url, { filename, then });
  try { await chrome.downloads.download({ url, conflictAction: "uniquify", ...(filename ? { filename } : {}) }); return true; }
  catch (e) { restarts.delete(url); console.warn("SecureDL restart failed", e); return false; }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabKey = sender.tab ? "pending:" + sender.tab.id : null;
  const async = (p) => { p.then(reply, (e) => reply({ ok: false, error: String(e) })); return true; };
  switch (msg?.type) {
    case "ownName": ownNames.set(msg.url, msg.filename); reply({ ok: true }); return;
    case "handled": if (tabKey) chrome.storage.session.remove(tabKey); return;
    // Save normally: restart a web download ourselves; page-made (blob:) ones are handled by the page.
    case "savePlain": return async((async () => {
      if (tabKey) await chrome.storage.session.remove(tabKey);
      if (!/^https?:/.test(msg.url)) return { ok: false, needsPage: true };
      return { ok: await restart(msg.url, msg.filename, "plain") };
    })());
    // Let it download normally once, then ask to lock the downloaded copy.
    case "downloadThenLock": return async((async () => {
      if (tabKey) await chrome.storage.session.remove(tabKey);
      if (/^https?:/.test(msg.url) && await restart(msg.url, msg.filename, "lock")) return { ok: true, started: true };
      const { passOnce = {} } = await chrome.storage.session.get("passOnce");
      passOnce[msg.site] = { then: "lock", exp: Date.now() + 3 * 60 * 1000 };
      await chrome.storage.session.set({ passOnce });
      return { ok: true, clickAgain: true };
    })());
    case "passOnce": return async((async () => {
      if (tabKey) await chrome.storage.session.remove(tabKey);
      const { passOnce = {} } = await chrome.storage.session.get("passOnce");
      passOnce[msg.site] = { then: "plain", exp: Date.now() + 3 * 60 * 1000 };
      await chrome.storage.session.set({ passOnce });
      return { ok: true };
    })());
  }
});
