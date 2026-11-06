// SecureDL background: right-click menu + automatic download detection.
//
// Detection modes (setting "mode"):
//   "off"      – right-click only (default)
//   "ask-docs" – when a document/image/archive download starts, pause it and ask
//   "ask-all"  – pause and ask for every download
// Asking opens prompt.html in "ask" mode: "Encrypt & save" (original cancelled/removed,
// file re-fetched or picked from disk, then encrypted) or "Save normally" (resumed).
//
// Every decision is written to a small activity log (shown in the popup) so it is always
// visible WHY a download was or wasn't intercepted.

const PROMPT = (params) =>
  chrome.tabs.create({ url: "prompt.html?" + new URLSearchParams(params).toString(), active: true });
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

chrome.runtime.onInstalled.addListener(() => {
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

chrome.downloads.onCreated.addListener(async (item) => {
  if (isOwnDownload(item)) return;                             // our own encrypted saves
  const { mode, neverAsk } = await getSettings();
  if (mode === "off") return;
  const url = item.finalUrl || item.url;
  if (!/^(https?|blob|data):/.test(url)) return logDecision(item, "skipped: not a web download");
  if (mode === "ask-docs" && !isDocument(item)) return logDecision(item, "skipped: not a document or image");
  const site = hostOf(item.referrer) || hostOf(url);
  if (neverAsk.includes(site) || neverAsk.includes(hostOf(url))) return logDecision(item, "skipped: you chose “always save normally” for this site");
  if (!(await chrome.permissions.contains(ALL))) {
    refreshBadge();
    return logDecision(item, "NOT intercepted: Chrome access for automatic detection isn't granted (click the icon to fix)");
  }

  // Pause first so as little as possible is written before the user decides.
  let paused = true;
  try { await chrome.downloads.pause(item.id); } catch { paused = false; /* already finished */ }
  const tab = await sourceTab(item);
  const t = await PROMPT({ url, tabId: tab?.id ?? "", ask: "1", dlId: item.id, name: displayName(item), site });
  await chrome.storage.session.set({ ["pending:" + t.id]: item.id });
  logDecision(item, paused ? "asked (download paused)" : "asked (download had already finished)");
});

// If the ask tab is closed without a choice, don't leave the user's download stuck on pause.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const key = "pending:" + tabId;
  const { [key]: dlId } = await chrome.storage.session.get(key);
  if (dlId === undefined) return;
  await chrome.storage.session.remove(key);
  const [d] = await chrome.downloads.search({ id: dlId });
  if (d && d.state === "in_progress" && d.paused) chrome.downloads.resume(dlId).catch(() => {});
});

// Prompt page tells us the choice was handled, so closing its tab shouldn't resume anything.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "handled" && sender.tab) chrome.storage.session.remove("pending:" + sender.tab.id);
});
