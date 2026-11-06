// SecureDL background: context menu + optional "protect every download" mode.
// tabId = the tab the download came from, so the file can be fetched with that page's
// cookies / bot-check clearance (see prompt.js).
const PROMPT = (params) =>
  chrome.tabs.create({ url: "prompt.html?" + new URLSearchParams(params).toString(), active: true });

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

// Protect-all mode: cancel normal downloads and route them through the prompt.
chrome.downloads.onCreated.addListener(async (item) => {
  const { protectAll } = await chrome.storage.local.get("protectAll");
  if (!protectAll) return;
  // Mode needs the optional all-sites permission; if it was revoked, leave downloads alone.
  if (!(await chrome.permissions.contains({ origins: ["<all_urls>"] }))) return;
  if (item.byExtensionId === chrome.runtime.id) return;
  const url = item.finalUrl || item.url;
  if (!/^https?:/.test(url)) return; // blob:/data: can't be refetched
  await chrome.downloads.cancel(item.id);
  chrome.downloads.erase({ id: item.id });
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  PROMPT({ url, tabId: tab?.id ?? "" });
});
