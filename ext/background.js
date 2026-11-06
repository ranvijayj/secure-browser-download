// SecureDL background: right-click menu + automatic download detection.
//
// Detection modes (popup setting "mode"):
//   "off"      – right-click only (default)
//   "ask-docs" – when a document/image/archive download starts, pause it and ask
//   "ask-all"  – pause and ask for every download
// Asking opens prompt.html in "ask" mode. The user picks "Lock with password" (the paused
// download is cancelled and the file re-fetched + encrypted) or "Save normally" (resumed).
// tabId = the tab the download came from, so the file can be fetched with that page's
// cookies / bot-check clearance (see prompt.js).

const PROMPT = (params) =>
  chrome.tabs.create({ url: "prompt.html?" + new URLSearchParams(params).toString(), active: true });

// Document-like types that are worth asking about in "ask-docs" mode.
const DOC_EXT = new Set(["pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "txt", "rtf", "odt", "ods",
  "pages", "numbers", "key", "jpg", "jpeg", "png", "heic", "tif", "tiff", "zip", "json", "xml", "eml", "ofx", "qif"]);
const DOC_MIME = /^(application\/(pdf|msword|vnd\.ms-|vnd\.openxmlformats|vnd\.oasis|rtf|zip|json|xml)|image\/|text\/(csv|plain|xml))/i;

function extOf(s) { return (String(s || "").split(/[?#]/)[0].match(/\.([a-z0-9]{1,6})$/i) || [])[1]?.toLowerCase() || ""; }
function hostOf(u) { try { return new URL(u).host; } catch { return ""; } }

function isDocument(item) {
  const ext = extOf(item.filename) || extOf(item.finalUrl || item.url);
  return DOC_EXT.has(ext) || DOC_MIME.test(item.mime || "");
}

async function getSettings() {
  const s = await chrome.storage.local.get(["mode", "neverAsk", "protectAll"]);
  if (!s.mode && s.protectAll) { s.mode = "ask-all"; chrome.storage.local.set({ mode: "ask-all" }); } // v0.x migration
  return { mode: s.mode || "off", neverAsk: s.neverAsk || [] };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "securedl",
    title: "Download with password (SecureDL)",
    contexts: ["link", "image", "video", "audio"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.linkUrl || info.srcUrl;
  if (url) PROMPT({ url, tabId: tab?.id ?? "" });
});

chrome.downloads.onCreated.addListener(async (item) => {
  if (item.byExtensionId === chrome.runtime.id) return;        // our own encrypted saves
  const url = item.finalUrl || item.url;
  if (!/^https?:/.test(url)) return;                           // blob:/data: can't be re-fetched
  const { mode, neverAsk } = await getSettings();
  if (mode === "off") return;
  if (mode === "ask-docs" && !isDocument(item)) return;
  const site = hostOf(item.referrer) || hostOf(url);
  if (neverAsk.includes(site) || neverAsk.includes(hostOf(url))) return;
  // Needs the optional all-sites permission; if it was revoked, leave downloads alone.
  if (!(await chrome.permissions.contains({ origins: ["<all_urls>"] }))) return;

  // Pause first so as little as possible is written before the user decides.
  try { await chrome.downloads.pause(item.id); } catch { /* already finished (tiny file) */ }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const name = (item.filename || "").split(/[\\/]/).pop() || decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() || "download");
  const t = await PROMPT({ url, tabId: tab?.id ?? "", ask: "1", dlId: item.id, name, site });
  await chrome.storage.session.set({ ["pending:" + t.id]: item.id });
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
